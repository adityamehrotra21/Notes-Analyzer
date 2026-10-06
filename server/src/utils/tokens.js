// Token estimates. Gemini uses its own tokenizer; o200k_base is close enough for budgeting
// as long as callers leave SAFETY_MARGIN headroom (see fitBudget).
import { Tiktoken } from 'js-tiktoken/lite';
import o200k from 'js-tiktoken/ranks/o200k_base';

const enc = new Tiktoken(o200k);
export const SAFETY_MARGIN = 0.15;

export function countTokens(text) {
  return text ? enc.encode(text, 'all').length : 0;
}

/** Budget after the safety margin, e.g. fitBudget(1000) -> 850. */
export function fitBudget(tokens) {
  return Math.floor(tokens * (1 - SAFETY_MARGIN));
}

/** Cut text to at most maxTokens (by estimate). */
export function truncateToTokens(text, maxTokens) {
  const ids = enc.encode(text, 'all');
  return ids.length <= maxTokens ? text : enc.decode(ids.slice(0, maxTokens));
}

/** Split text into consecutive pieces of at most maxTokens each. */
export function splitByTokens(text, maxTokens) {
  const ids = enc.encode(text, 'all');
  const out = [];
  for (let i = 0; i < ids.length; i += maxTokens) out.push(enc.decode(ids.slice(i, i + maxTokens)).trim());
  return out.filter(Boolean);
}
