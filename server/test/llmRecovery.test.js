// LLM output recovery (no network, no spend: OpenAI responses are stubbed):  npm test
//   - reasoning used the whole cap (finish "length", empty text) -> retry once, effort "minimal", 1.5x cap
//   - still empty / refusal -> friendly GenerationError (never a raw "empty" message)
//   - long text cut off -> continuation calls stitched together (max 2)
//   - streams: empty + length -> one retry
//   - per-tier reasoning effort: nano "minimal", mini "low"
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://test@127.0.0.1:1/none', // never reached; usage rows just fail to insert (logged)
  JWT_SECRET: 'x'.repeat(40),
  LLM_PROVIDER: 'openai',
  LLM_MOCK: 'false',
  EMBED_PROVIDER: 'hash',
  OPENAI_API_KEY: 'sk-test-0000000000000000000000',
  OPENAI_CHAT_MODEL: 'gpt-5-mini',
  OPENAI_CHEAP_MODEL: 'gpt-5-nano',
  OPENAI_REASONING_EFFORT: 'low',
  OPENAI_REASONING_EFFORT_CHEAP: 'minimal',
  MAX_OUTPUT_TOKENS_CHAT: '2000',
  MAX_OUTPUT_TOKENS_NOTES: '12000',
  LLM_RPM: '100000',
  LOG_LEVEL: 'error',
});

// Scripted fake OpenAI: each call takes the next queued reply; every request body is recorded.
const requests = [];
let replies = [];
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const completion = ({ content = '', finish = 'stop', refusal = null, out = 50, reasoning = 0 }) =>
  json({
    id: 'x',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-5-mini',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal }, finish_reason: finish }],
    usage: { prompt_tokens: 100, completion_tokens: out, completion_tokens_details: { reasoning_tokens: reasoning } },
  });
const sse = (frames) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(f)}\n\n`));
        c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
const chunk = (delta, finish = null) => ({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'gpt-5-mini', choices: [{ index: 0, delta, finish_reason: finish }] });
const usageChunk = (out, reasoning) => ({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'gpt-5-mini', choices: [], usage: { prompt_tokens: 100, completion_tokens: out, completion_tokens_details: { reasoning_tokens: reasoning } } });

globalThis.fetch = async (url, init) => {
  requests.push(JSON.parse(init.body));
  const next = replies.shift();
  if (!next) throw new Error('no scripted reply left');
  return next();
};

let llm;
let GenerationError;
before(async () => {
  llm = await import('../src/services/llmService.js');
  ({ GenerationError } = await import('../src/utils/AppError.js'));
  const budget = (await import('../src/services/budgetService.js')).default;
  await budget.init({ spentUsd: 0 });
  // No database in unit tests: make usage-row inserts no-ops (spend is still tracked in memory).
  const { db } = await import('../src/db/index.js');
  db.insert = () => ({ values: async () => {} });
});
const reset = (...r) => {
  requests.length = 0;
  replies = r;
};
const base = { system: 'S', messages: [{ role: 'user', content: 'hi' }] };

test('reasoning ate the cap with no text -> one retry with "minimal" effort and 1.5x cap', async () => {
  reset(
    () => completion({ finish: 'length', out: 2000, reasoning: 2000 }),
    () => completion({ content: 'Here is the answer.', out: 300 }),
  );
  const r = await llm.generateText({ step: 'chat', ...base });
  assert.equal(r.text, 'Here is the answer.');
  assert.equal(r.retried, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].reasoning_effort, 'low');
  assert.equal(requests[0].max_completion_tokens, 2000);
  assert.equal(requests[1].reasoning_effort, 'minimal');
  assert.equal(requests[1].max_completion_tokens, 3000);
});

test('still empty after the retry -> friendly GenerationError', async () => {
  reset(
    () => completion({ finish: 'length', out: 2000, reasoning: 2000 }),
    () => completion({ finish: 'length', out: 3000, reasoning: 3000 }),
  );
  await assert.rejects(llm.generateText({ step: 'chat', ...base }), (err) => {
    assert.ok(err instanceof GenerationError);
    assert.equal(err.status, 502);
    assert.equal(err.message, "Couldn't generate this right now, please try again.");
    assert.doesNotMatch(err.message, /empty/i);
    return true;
  });
  assert.equal(requests.length, 2, 'exactly one retry');
});

test('refusal -> friendly GenerationError (reason: refusal), no retry', async () => {
  reset(() => completion({ content: null, refusal: "I can't help with that." }));
  await assert.rejects(llm.generateText({ step: 'chat', ...base }), (err) => err instanceof GenerationError && err.reason === 'refusal' && !/can't help/.test(err.message));
  assert.equal(requests.length, 1);
});

test('plain empty response (finish "stop") -> friendly error, no retry', async () => {
  reset(() => completion({ content: '' }));
  await assert.rejects(llm.generateText({ step: 'chat', ...base }), (err) => err instanceof GenerationError && err.reason === 'empty');
  assert.equal(requests.length, 1);
});

test('long notes cut off -> up to 2 continuations, stitched without duplicating the seam', async () => {
  reset(
    () => completion({ content: '## A\nFirst part of the notes that ends mid-sent', finish: 'length', out: 12000 }),
    () => completion({ content: 'ends mid-sentence and continues.\n## B\nMore', finish: 'length', out: 12000 }),
    () => completion({ content: ' text.\n## Key takeaways\n- done', finish: 'stop', out: 400 }),
  );
  const r = await llm.generateText({ step: 'notes', ...base, continueOnLength: 2 });
  assert.equal(r.continuations, 2);
  assert.equal(r.text, '## A\nFirst part of the notes that ends mid-sentence and continues.\n## B\nMore text.\n## Key takeaways\n- done');
  const cont = requests[1].messages;
  assert.equal(cont.at(-2).role, 'assistant', 'continuation sees what was written so far');
  assert.match(cont.at(-1).content, /Continue exactly where you stopped/);
});

test('continuations are capped at 2', async () => {
  reset(
    () => completion({ content: 'part1 ', finish: 'length' }),
    () => completion({ content: 'part2 ', finish: 'length' }),
    () => completion({ content: 'part3 ', finish: 'length' }),
  );
  const r = await llm.generateText({ step: 'notes', ...base, continueOnLength: 2 });
  assert.equal(r.continuations, 2);
  assert.equal(requests.length, 3);
  assert.equal(r.text, 'part1 part2 part3 ');
});

test('truncated JSON is retried with a bigger cap (no continuation for JSON)', async () => {
  reset(
    () => completion({ content: '{"items":["a","b', finish: 'length', out: 4000 }),
    () => completion({ content: '{"items":["a","b"]}', out: 30 }),
  );
  const { z } = await import('zod');
  const out = await llm.generateJSON({ step: 'quiz', name: 't', schema: z.object({ items: z.array(z.string()) }), ...base });
  assert.deepEqual(out, { items: ['a', 'b'] });
  assert.equal(requests[1].reasoning_effort, 'minimal');
  assert.equal(requests[1].max_completion_tokens, 6000);
});

test('stream that ends with no text because of the cap is retried once', async () => {
  reset(
    () => sse([chunk({}, 'length'), usageChunk(2000, 2000)]),
    () => sse([chunk({ content: 'Hello ' }), chunk({ content: 'there.' }), chunk({}, 'stop'), usageChunk(20, 0)]),
  );
  let text = '';
  let finish;
  for await (const ev of await llm.streamText({ step: 'chat', ...base })) {
    if (ev.type === 'text') text += ev.text;
    if (ev.type === 'finish') finish = ev.finishReason;
  }
  assert.equal(text, 'Hello there.');
  assert.equal(finish, 'stop');
  assert.equal(requests[1].reasoning_effort, 'minimal');
});

test('stream that is empty twice -> friendly GenerationError', async () => {
  reset(() => sse([chunk({}, 'length'), usageChunk(2000, 2000)]), () => sse([chunk({}, 'length'), usageChunk(3000, 3000)]));
  const run = async () => {
    for await (const _ of await llm.streamText({ step: 'chat', ...base })) {
      /* drain */
    }
  };
  await assert.rejects(run(), (err) => err instanceof GenerationError && err.message === "Couldn't generate this right now, please try again.");
});

test('reasoning effort per tier: cheap (nano) = minimal, main (mini) = low', async () => {
  reset(() => completion({ content: 'a' }), () => completion({ content: 'b' }));
  await llm.generateText({ step: 'summaryMap', tier: 'cheap', ...base });
  await llm.generateText({ step: 'questions', ...base });
  assert.equal(requests[0].model, 'gpt-5-nano');
  assert.equal(requests[0].reasoning_effort, 'minimal');
  assert.equal(requests[1].model, 'gpt-5-mini');
  assert.equal(requests[1].reasoning_effort, 'low');
});
