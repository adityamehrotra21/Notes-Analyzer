// Offline embedder for tests and demos without an API key: hashed bag of words + bigrams.
// Captures lexical overlap only (no semantics). Never use it for real data.
import { env } from '../../config/env.js';

const STOP = new Set(
  'a an and are as at be by for from has in is it its of on or that the this to was were with which what how does do why who when where tell me about explain describe'.split(' '),
);

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');

function embedOne(text, dims) {
  const v = new Array(dims).fill(0);
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)).map(stem);
  const add = (term, weight) => {
    const h = fnv1a(term);
    v[h % dims] += h & 0x80000000 ? -weight : weight;
  };
  words.forEach((w, i) => {
    add(w, 1);
    if (i > 0) add(`${words[i - 1]}_${w}`, 0.5);
  });
  return v;
}

export const hashEmbeddings = {
  name: 'hash',
  local: true, // no network: skip pacing, retries and billing
  model: () => 'hash',
  async embed(texts) {
    return { vectors: texts.map((t) => embedOne(t, env.EMBED_DIMENSIONS)), usage: null };
  },
};
