// OpenAI embeddings (EMBED_PROVIDER=openai), e.g. text-embedding-3-small at 1536 dimensions.
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { getOpenAIClient } from './openaiCompatible.js';

const model = () => {
  if (!env.OPENAI_EMBED_MODEL) throw new AppError(500, 'OPENAI_EMBED_MODEL is not set in server/.env (EMBED_PROVIDER=openai)');
  return env.OPENAI_EMBED_MODEL;
};

export const openaiEmbeddings = {
  name: 'openai',
  priced: true,
  maxBatch: 2048, // API limit per request
  maxBatchTokens: 250_000, // API limit is 300k tokens per request; keep headroom
  model,
  /** taskType is ignored: OpenAI embeddings are symmetric. */
  async embed(texts) {
    const res = await getOpenAIClient().embeddings.create({ model: model(), input: texts, dimensions: env.EMBED_DIMENSIONS });
    const vectors = [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== texts.length) throw new Error(`Embedding API returned ${vectors.length} vectors for ${texts.length} inputs`);
    return { vectors, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, cachedTokens: 0, outputTokens: 0 } };
  },
};
