// OpenAI (and any OpenAI-compatible API via OPENAI_BASE_URL) using Chat Completions.
// - Reasoning models (gpt-5*, o-series): max_completion_tokens + reasoning_effort, no temperature
//   (they reject it). Reasoning tokens are billed as output and count toward the cap.
// - Structured outputs via response_format json_schema (strict); falls back to json_object for
//   compatible APIs that lack json_schema.
// - Returns normalised usage { inputTokens, cachedTokens, outputTokens, reasoningTokens } for billing.
import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { errorStatus } from '../../utils/retry.js';
import { toOpenAIStrictSchema } from '../../utils/jsonSchema.js';
import logger from '../../utils/logger.js';

const log = logger.child({ module: 'llm' });
let client;

function requireVar(name) {
  if (!env[name]) throw new AppError(500, `${name} is not set in server/.env (LLM_PROVIDER=openai)`);
  return env[name];
}

export function getOpenAIClient() {
  client ??= new OpenAI({ apiKey: requireVar('OPENAI_API_KEY'), baseURL: env.OPENAI_BASE_URL, maxRetries: 0 }); // we retry ourselves
  return client;
}

const FINISH = { stop: 'stop', length: 'length', content_filter: 'safety' };
export const isReasoningModel = (model) => /^(gpt-5|o\d)/i.test(model ?? '');

// Optional parameters some models/APIs reject; once rejected we stop sending them.
const unsupported = new Set();
let jsonSchemaUnsupported = false;

function buildBody({ model, tier, system, messages, maxOutputTokens, temperature, json, cacheKey, reasoningEffort }) {
  let sys = system;
  let responseFormat;
  if (json && !jsonSchemaUnsupported) {
    responseFormat = { type: 'json_schema', json_schema: { name: json.name ?? 'output', schema: toOpenAIStrictSchema(json.schema), strict: true } };
  } else if (json) {
    responseFormat = { type: 'json_object' };
    sys = `${system}\n\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(json.schema)}`;
  }
  const body = {
    model,
    // System prompt first and stable: OpenAI caches identical prompt prefixes (>= 1024 tokens).
    messages: [{ role: 'system', content: sys }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
  };
  if (isReasoningModel(model)) {
    body.max_completion_tokens = maxOutputTokens;
    // nano (cheap tier) -> minimal, mini (main) -> low; a recovery retry may force 'minimal'.
    const effort = reasoningEffort ?? (tier === 'cheap' ? env.OPENAI_REASONING_EFFORT_CHEAP : env.OPENAI_REASONING_EFFORT);
    if (!unsupported.has('reasoning_effort')) body.reasoning_effort = effort;
  } else {
    body.max_tokens = maxOutputTokens;
    if (temperature !== undefined) body.temperature = temperature;
  }
  if (cacheKey && !unsupported.has('prompt_cache_key')) body.prompt_cache_key = cacheKey;
  if (responseFormat) body.response_format = responseFormat;
  return body;
}

export function normalizeUsage(u) {
  if (!u) return null;
  return {
    inputTokens: u.prompt_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

/** Send a request; if the API rejects an optional parameter (or json_schema), drop it and retry once. */
async function create(opts, extra = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getOpenAIClient().chat.completions.create({ ...buildBody(opts), ...extra }, { signal: opts.signal });
    } catch (err) {
      const msg = String(err?.message ?? '');
      if (attempt >= 2 || errorStatus(err) !== 400) throw err;
      const param = ['prompt_cache_key', 'reasoning_effort'].find((p) => msg.includes(p) && !unsupported.has(p));
      if (param) {
        unsupported.add(param);
        log.warn(`API rejected "${param}"; sending requests without it`, { model: opts.model, reason: msg.slice(0, 200) });
        continue;
      }
      if (opts.json && !jsonSchemaUnsupported && /response_format|json_schema/i.test(msg)) {
        jsonSchemaUnsupported = true;
        log.warn('model does not support json_schema; falling back to json_object', { model: opts.model });
        continue;
      }
      throw err;
    }
  }
}

export const openaiCompatibleChat = {
  name: 'openai',
  priced: true, // goes through the budget guard
  model: (tier) => (tier === 'cheap' ? env.OPENAI_CHEAP_MODEL || requireVar('OPENAI_CHAT_MODEL') : requireVar('OPENAI_CHAT_MODEL')),

  async generate(opts) {
    const res = await create(opts);
    const choice = res.choices[0];
    return {
      text: choice?.message?.content ?? '',
      refusal: choice?.message?.refusal ?? null, // model declined (safety); content is then empty
      finishReason: FINISH[choice?.finish_reason] ?? 'other',
      usage: normalizeUsage(res.usage),
    };
  },

  async startStream(opts) {
    const stream = await create(opts, { stream: true, stream_options: { include_usage: true } });
    return (async function* () {
      let finishReason = null;
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) yield { type: 'text', text: choice.delta.content };
        if (choice?.delta?.refusal) yield { type: 'refusal', text: choice.delta.refusal };
        if (choice?.finish_reason) finishReason = FINISH[choice.finish_reason] ?? 'other';
        if (chunk.usage) yield { type: 'usage', usage: normalizeUsage(chunk.usage) };
      }
      yield { type: 'finish', finishReason: finishReason ?? 'stop' };
    })();
  },
};
