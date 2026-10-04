// USD per 1M tokens. Used by budgetService to estimate (before) and record (after) every OpenAI call.
//
// ⚠️  VERIFY these against https://openai.com/api/pricing before relying on the budget guard.
//     They were filled in from the published prices known when this file was written and may be stale.
//     If a model's price rises, the guard under-counts; if a model is missing here, calls to it are refused.
//
// cachedInput applies to prompt tokens served from OpenAI's prompt cache (usage.prompt_tokens_details.cached_tokens).
// Output includes reasoning tokens.
export const PRICING = {
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2.0 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'text-embedding-3-small': { input: 0.02, cachedInput: 0.02, output: 0 },
};

/**
 * Price entry for a model name. Accepts dated snapshots ("gpt-5-mini-2025-08-07") by prefix.
 * @returns {{ input: number, cachedInput: number, output: number } | null}
 */
export function priceFor(model) {
  if (!model) return null;
  if (PRICING[model]) return PRICING[model];
  const key = Object.keys(PRICING)
    .filter((k) => model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICING[key] : null;
}

/** Cost in USD for a call. */
export function costUsd(price, { inputTokens = 0, cachedTokens = 0, outputTokens = 0 }) {
  const uncached = Math.max(0, inputTokens - cachedTokens);
  return (uncached * price.input + cachedTokens * price.cachedInput + outputTokens * price.output) / 1_000_000;
}
