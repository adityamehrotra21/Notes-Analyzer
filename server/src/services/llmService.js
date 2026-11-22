// Provider-agnostic text generation. Pick the provider with LLM_PROVIDER; callers never touch SDKs.
//   generateText(opts)  -> { text, finishReason, usage }
//   streamText(opts)    -> async iterable of { type: 'text', text } | { type: 'finish', finishReason }
//   generateJSON(opts)  -> zod-validated structured output (retried once)
// opts: { step, system, messages: [{ role, content }], tier?, signal?, label?, cacheKey? }
//   step   decides the output cap and the billing feature: chat | chatLong | classify | questions | quiz | summaryMap | summaryReduce
//   tier   'main' (default) or 'cheap' (OPENAI_CHEAP_MODEL) for bulk/intermediate calls
//
// Paid providers go through budgetService: reserve worst case -> call -> settle actual usage.
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError, GenerationError } from '../utils/AppError.js';
import { RateQueue } from '../utils/rateQueue.js';
import { errorStatus, isDailyQuotaError, isOutOfCreditError, withRetry } from '../utils/retry.js';
import { countTokens } from '../utils/tokens.js';
import logger from '../utils/logger.js';
import budgetService from './budgetService.js';
import { geminiChat } from './providers/gemini.js';
import { openaiCompatibleChat } from './providers/openaiCompatible.js';
import { mockChat } from './providers/mockChat.js';

const log = logger.child({ module: 'llm' });
const providers = { gemini: geminiChat, openai: openaiCompatibleChat, mock: mockChat };
const provider = () => providers[env.LLM_PROVIDER];

const queue = new RateQueue({ name: 'llm', concurrency: env.LLM_CONCURRENCY, rpm: env.LLM_RPM, tpm: env.LLM_TPM });

/** Hard output caps per step (reasoning tokens count toward them). */
export const OUTPUT_CAPS = {
  chat: env.MAX_OUTPUT_TOKENS_CHAT,
  questions: env.MAX_OUTPUT_TOKENS_QUESTIONS,
  quiz: env.MAX_OUTPUT_TOKENS_QUIZ,
  summaryMap: env.MAX_OUTPUT_TOKENS_SUMMARY_MAP,
  summaryReduce: env.MAX_OUTPUT_TOKENS_SUMMARY_REDUCE,
  chatLong: env.MAX_OUTPUT_TOKENS_CHAT_LONG,
  notes: env.MAX_OUTPUT_TOKENS_NOTES,
  notesFill: env.MAX_OUTPUT_TOKENS_NOTES_FILL,
  outline: env.MAX_OUTPUT_TOKENS_OUTLINE,
  classify: env.MAX_OUTPUT_TOKENS_CLASSIFY,
  ocr: env.MAX_OUTPUT_TOKENS_OCR,
};
const FEATURE = { notes: 'summary', notesFill: 'summary', outline: 'summary', chat: 'chat', chatLong: 'chat', classify: 'chat', questions: 'questions', quiz: 'quiz', summaryMap: 'summary', summaryReduce: 'summary', ocr: 'upload' };

export const modelInfo = (tier = 'main') => ({ provider: env.LLM_PROVIDER, model: provider().model(tier) });

/** Prompt tokens as the API will count them (o200k is the GPT-5 tokenizer; ~4 tokens overhead per message). */
export const promptTokens = ({ system, messages }) => countTokens(system) + 4 + messages.reduce((n, m) => n + countTokens(m.content) + 4, 0);

function resolve(opts) {
  if (!opts.step || !(opts.step in OUTPUT_CAPS)) throw new Error(`llmService: unknown step "${opts.step}"`);
  const p = provider();
  const cap = OUTPUT_CAPS[opts.step] ?? env.LLM_MAX_OUTPUT_TOKENS;
  return {
    p,
    o: {
      temperature: 0.2,
      ...opts,
      tier: opts.tier ?? 'main',
      model: p.model(opts.tier ?? 'main'),
      maxOutputTokens: Math.round(cap * (opts.capMultiplier ?? 1)),
      cacheKey: opts.cacheKey ?? `na-${opts.step}`,
    },
  };
}

function logCall({ p, o, usage, cost, t0, finishReason, estimated = false }) {
  log.info(`${o.label ?? o.step}`, {
    provider: p.name,
    model: o.model,
    feature: FEATURE[o.step],
    step: o.step,
    inputTokens: usage?.inputTokens,
    cachedTokens: usage?.cachedTokens,
    outputTokens: usage?.outputTokens,
    reasoningTokens: usage?.reasoningTokens,
    maxOutputTokens: o.maxOutputTokens,
    reasoningEffort: o.reasoningEffort,
    costUsd: cost === null ? undefined : Math.round(cost * 1e6) / 1e6,
    finishReason,
    estimated: estimated || undefined,
    durationMs: Date.now() - t0,
  });
}

/** Log anything unusual about a finished call (incomplete, refusal, empty). Returns the problem or null. */
function inspect(o, res) {
  const empty = !res.text?.trim();
  const problem = res.refusal ? 'refusal' : res.finishReason === 'length' ? (empty ? 'incomplete_empty' : 'incomplete_truncated') : empty ? 'empty' : null;
  if (problem) {
    log.warn(`${o.label ?? o.step}: ${problem.replace('_', ' ')}`, {
      reason: problem,
      model: o.model,
      step: o.step,
      finishReason: res.finishReason,
      maxOutputTokens: o.maxOutputTokens,
      outputTokens: res.usage?.outputTokens,
      reasoningTokens: res.usage?.reasoningTokens,
      visibleChars: res.text?.length ?? 0,
      refusal: res.refusal ? String(res.refusal).slice(0, 200) : undefined,
    });
  }
  return problem;
}

/** Reserve budget (paid providers only). */
function reserve(p, o, inputTokens) {
  if (p.local || !p.priced) return null;
  return budgetService.reserve({ model: o.model, inputTokens, maxOutputTokens: o.maxOutputTokens, feature: FEATURE[o.step] });
}

/** Run a provider call through the pacing queue with backoff (skipped for local providers). */
function execute(p, o, fn, inputTokens) {
  if (p.local) return Promise.resolve().then(() => fn(p));
  return withRetry(() => queue.add(() => fn(p), { weight: inputTokens + o.maxOutputTokens }), { label: o.label ?? o.step });
}

// Upper bound for one high-detail image, so the reservation covers it; settle() uses the real count.
const IMAGE_INPUT_TOKENS = 3000;

/** One billed call: reserve -> provider -> settle -> log. */
async function callOnce(opts) {
  const { p, o } = resolve(opts);
  const inputTokens = promptTokens(o) + (o.image ? IMAGE_INPUT_TOKENS : 0);
  const reservation = reserve(p, o, inputTokens);
  const t0 = Date.now();
  let res;
  try {
    res = await execute(p, o, (prov) => prov.generate(o), inputTokens);
  } catch (err) {
    budgetService.release(reservation);
    throw toAppError(err);
  }
  const usage = res.usage ?? { inputTokens, cachedTokens: 0, outputTokens: countTokens(res.text ?? '') };
  const cost = reservation ? await budgetService.settle(reservation, usage, { estimated: !res.usage }) : null;
  logCall({ p, o, usage, cost, t0, finishReason: res.finishReason, estimated: !res.usage });
  return { ...res, text: res.text ?? '', usage, o };
}

/** One vision call: opts.image = { mime, base64 }. No continuation (it would resend the image). */
export const generateFromImage = (opts) => callOnce(opts);

export const CONTINUE_PROMPT =
  'Continue exactly where you stopped. Do not repeat anything you already wrote, do not add a preamble, and keep the same format.';

/** Join a continuation onto the text so far, dropping any repeated overlap at the seam. */
export function stitch(text, more) {
  // Models often resume by repeating the half-written last words ("…ends mid-sent" + "ends mid-sentence…").
  // Drop the longest repeated seam: >= 6 chars if it spans a word break, otherwise >= 12.
  const tail = text.slice(-200);
  for (let n = Math.min(tail.length, more.length); n >= 6; n--) {
    const seam = tail.slice(-n);
    if (more.startsWith(seam) && (n >= 12 || /\s/.test(seam))) return text + more.slice(n);
  }
  return text + more;
}

/**
 * Text generation with recovery:
 *  1. Reasoning ate the cap (finish "length" with no visible text), or JSON was cut off
 *     -> retry ONCE with reasoning effort "minimal" and 1.5x the cap.
 *  2. Refused, or still empty -> GenerationError (friendly message; details only in the logs).
 *  3. Long text cut off mid-way (opts.continueOnLength > 0) -> up to N "continue where you stopped"
 *     calls, stitched together.
 * Returns { text, finishReason, usage, continuations, retried }.
 */
export async function generateText(opts) {
  let res = await callOnce(opts);
  let problem = inspect(res.o, res);
  let retried = false;

  if (problem === 'incomplete_empty' || (problem === 'incomplete_truncated' && opts.json)) {
    retried = true;
    log.warn(`${opts.label ?? opts.step}: retrying once with reasoning effort "minimal" and 1.5x the output cap`);
    res = await callOnce({ ...opts, reasoningEffort: 'minimal', capMultiplier: 1.5, label: `${opts.label ?? opts.step} (retry)` });
    problem = inspect(res.o, res);
  }
  if (problem === 'refusal' || problem === 'empty' || problem === 'incomplete_empty') {
    throw new GenerationError(problem === 'refusal' ? 'refusal' : 'empty', { step: opts.step, label: opts.label });
  }

  let text = res.text;
  let continuations = 0;
  while (res.finishReason === 'length' && !opts.json && continuations < (opts.continueOnLength ?? 0)) {
    continuations++;
    log.info(`${opts.label ?? opts.step}: output was cut off, continuing (${continuations}/${opts.continueOnLength})`, { charsSoFar: text.length });
    res = await callOnce({
      ...opts,
      messages: [...opts.messages, { role: 'assistant', content: text }, { role: 'user', content: CONTINUE_PROMPT }],
      label: `${opts.label ?? opts.step} (continue ${continuations})`,
    });
    inspect(res.o, res);
    if (!res.text.trim()) break;
    text = stitch(text, res.text);
  }
  if (res.finishReason === 'length' && !opts.json) {
    log.warn(`${opts.label ?? opts.step}: still cut off after ${continuations} continuation(s); returning what we have`, { chars: text.length });
  }
  return { text, finishReason: res.finishReason, usage: res.usage, continuations, retried, refusal: res.refusal ?? null };
}

/** Open a billed stream (retries only until it opens). */
async function openStream(opts) {
  const { p, o } = resolve(opts);
  const inputTokens = promptTokens(o);
  const reservation = reserve(p, o, inputTokens);
  try {
    const inner = await execute(p, o, (prov) => prov.startStream(o), inputTokens);
    return { p, o, inner, reservation, inputTokens, t0: Date.now() };
  } catch (err) {
    budgetService.release(reservation);
    throw toAppError(err);
  }
}

/** Yield text events from one stream attempt; settle + log it; return what happened. */
async function* consume(attempt) {
  const { p, o, inner, reservation, inputTokens, t0 } = attempt;
  let text = '';
  let refusal = '';
  let usage = null;
  let finishReason = 'aborted';
  try {
    for await (const ev of inner) {
      if (ev.type === 'usage') usage = ev.usage;
      else if (ev.type === 'refusal') refusal += ev.text;
      else if (ev.type === 'finish') finishReason = ev.finishReason;
      else if (ev.type === 'text') {
        text += ev.text;
        yield ev;
      }
    }
  } finally {
    // Runs on completion, error, or client disconnect. Without the API's usage (aborted stream) bill an
    // estimate: full input + tokens produced so far.
    const used = usage ?? { inputTokens, cachedTokens: 0, outputTokens: countTokens(text) };
    const cost = reservation ? await budgetService.settle(reservation, used, { estimated: !usage }) : null;
    logCall({ p, o, usage: used, cost, t0, finishReason, estimated: !usage });
  }
  const res = { text, refusal: refusal || null, finishReason, usage };
  inspect(o, res);
  return res;
}

/**
 * Streamed text. Retries only until the stream opens. If a stream ends with NO visible text because
 * reasoning used the whole cap, it is retried once (effort "minimal", 1.5x cap) before failing with
 * a friendly GenerationError. Yields { type: 'text', text } ... then { type: 'finish', finishReason }.
 */
export async function streamText(opts) {
  const first = await openStream(opts);
  return (async function* () {
    let attempt = first;
    let retried = false;
    for (;;) {
      const r = yield* consume(attempt);
      if (!r.text.trim() && r.finishReason === 'length' && !retried) {
        retried = true;
        log.warn(`${opts.label ?? opts.step}: stream ended with no text; retrying once with reasoning effort "minimal" and 1.5x the cap`);
        attempt = await openStream({ ...opts, reasoningEffort: 'minimal', capMultiplier: 1.5, label: `${opts.label ?? opts.step} (retry)` });
        continue;
      }
      if (!r.text.trim() && r.finishReason !== 'aborted') throw new GenerationError(r.refusal ? 'refusal' : 'empty', { step: opts.step });
      yield { type: 'finish', finishReason: r.finishReason };
      return;
    }
  })();
}

const stripFences = (t) => t.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

function describeError(err) {
  if (err instanceof SyntaxError) return `it was not valid JSON (${err.message})`;
  if (err instanceof z.ZodError) {
    return err.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
  }
  return err.message;
}

/**
 * Structured output: JSON matching a zod schema. Uses the provider's native JSON mode with the
 * schema, validates with zod, and retries once (showing the model its error) if invalid.
 * Truncated JSON is handled by generateText's retry (minimal effort, 1.5x cap).
 * opts: { step, system, messages, schema: ZodType, name, tier?, label? }
 */
export async function generateJSON({ schema, name, ...opts }) {
  const json = { name, schema: z.toJSONSchema(schema) };
  let messages = opts.messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const label = `${opts.label ?? name}${attempt ? ' (retry)' : ''}`;
    const { text, finishReason } = await generateText({ ...opts, messages, json, label });
    try {
      return schema.parse(JSON.parse(stripFences(text)));
    } catch (err) {
      log.warn(`${label}: invalid structured output`, { reason: 'invalid_json', detail: describeError(err), finishReason, model: modelInfo(opts.tier).model });
      if (finishReason === 'length') break; // already retried with a bigger cap inside generateText
      messages = [
        ...opts.messages,
        { role: 'assistant', content: text.slice(0, 6000) },
        { role: 'user', content: `Your previous reply was invalid: ${describeError(err)}. Reply again with ONLY the corrected JSON object matching the schema.` },
      ];
    }
  }
  throw new GenerationError('invalid_json', { step: opts.step, name });
}

/** Map provider/SDK errors to user-facing AppErrors without leaking internals. */
export function toAppError(err) {
  if (err instanceof AppError) return err;
  if (err?.name === 'AbortError' || err?.name === 'APIUserAbortError') return new AppError(499, 'Request cancelled');
  const status = errorStatus(err);
  const name = modelInfo().model;
  if (isOutOfCreditError(err)) {
    log.error('AI provider account is out of credit (insufficient_quota)');
    return new AppError(402, 'Generation is temporarily unavailable. Please try again later.');
  }
  if (isDailyQuotaError(err)) return new AppError(429, 'Daily AI quota reached. Try again tomorrow.');
  if (status === 429) return new AppError(429, 'The AI service is busy (rate limited). Try again in a minute.');
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(err.message))) {
    return new AppError(502, 'The AI provider rejected the API key. Check server/.env.');
  }
  if (status === 404) return new AppError(502, `AI model "${name}" was not found. Check the model name in server/.env.`);
  if (status === 400) return new AppError(502, `The AI provider rejected the request: ${String(err.message).slice(0, 200)}`);
  if (status >= 500) return new AppError(503, 'The AI service is temporarily unavailable. Try again shortly.');
  log.error('unexpected LLM error', { err });
  return new AppError(502, 'The AI request failed.');
}
