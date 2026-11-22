// Gemini adapter (@google/genai). Model names come only from env.
import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { toGeminiSchema } from '../../utils/jsonSchema.js';

let client;

function requireVar(name) {
  if (!env[name]) throw new AppError(500, `${name} is not set in server/.env`);
  return env[name];
}

function getClient() {
  client ??= new GoogleGenAI({ apiKey: requireVar('GEMINI_API_KEY') });
  return client;
}

const FINISH = { STOP: 'stop', MAX_TOKENS: 'length', SAFETY: 'safety', RECITATION: 'safety', PROHIBITED_CONTENT: 'safety', BLOCKLIST: 'safety', SPII: 'safety' };

function buildRequest({ model, system, messages, maxOutputTokens, temperature, signal, json }) {
  const config = { systemInstruction: system, maxOutputTokens, temperature, abortSignal: signal };
  if (env.GEMINI_THINKING_BUDGET !== undefined) config.thinkingConfig = { thinkingBudget: env.GEMINI_THINKING_BUDGET };
  if (json) {
    config.responseMimeType = 'application/json';
    config.responseSchema = toGeminiSchema(json.schema);
  }
  return {
    model: model ?? requireVar('GEMINI_CHAT_MODEL'),
    contents: messages.map((m, i) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }, ...(image && i === messages.length - 1 ? [{ inlineData: { mimeType: image.mime, data: image.base64 } }] : [])],
    })),
    config,
  };
}

const usageOf = (u) =>
  u
    ? {
        inputTokens: u.promptTokenCount ?? 0,
        cachedTokens: u.cachedContentTokenCount ?? 0,
        outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        reasoningTokens: u.thoughtsTokenCount ?? 0,
      }
    : null;

const finishOf = (res) => {
  const r = res?.candidates?.[0]?.finishReason;
  return r ? (FINISH[r] ?? 'other') : res?.promptFeedback?.blockReason ? 'safety' : null;
};

export const geminiChat = {
  name: 'gemini',
  priced: false, // free tier: usage is logged, not budgeted
  model: () => requireVar('GEMINI_CHAT_MODEL'),

  async generate(opts) {
    const res = await getClient().models.generateContent(buildRequest(opts));
    return { text: res.text ?? '', finishReason: finishOf(res) ?? 'stop', usage: usageOf(res.usageMetadata) };
  },

  /** Resolves once the HTTP stream is open (so 429s can be retried), then yields events. */
  async startStream(opts) {
    const iter = await getClient().models.generateContentStream(buildRequest(opts));
    return (async function* () {
      let finishReason = null;
      let usage = null;
      for await (const chunk of iter) {
        const text = chunk.text;
        if (text) yield { type: 'text', text };
        finishReason = finishOf(chunk) ?? finishReason;
        usage = usageOf(chunk.usageMetadata) ?? usage;
      }
      if (usage) yield { type: 'usage', usage };
      yield { type: 'finish', finishReason: finishReason ?? 'stop' };
    })();
  },
};

export const geminiEmbeddings = {
  name: 'gemini',
  priced: false,
  maxBatch: 100,
  model: () => requireVar('GEMINI_EMBED_MODEL'),
  /** @param {string[]} texts  @param {{ taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' }} opts */
  async embed(texts, { taskType }) {
    const res = await getClient().models.embedContent({
      model: requireVar('GEMINI_EMBED_MODEL'),
      // One Content per text -> one batchEmbedContents request with one embedding per text.
      // (A plain string[] is folded into a single multi-part Content and yields ONE embedding.)
      contents: texts.map((text) => ({ role: 'user', parts: [{ text }] })),
      config: { taskType, outputDimensionality: env.EMBED_DIMENSIONS },
    });
    const vectors = (res.embeddings ?? []).map((e) => e.values);
    if (vectors.length !== texts.length || vectors.some((v) => !v?.length)) {
      throw new Error(`Embedding API returned ${vectors.length} vectors for ${texts.length} inputs`);
    }
    return { vectors, usage: null };
  },
};
