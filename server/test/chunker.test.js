// Unit tests for the page-aware chunker:  npm test  (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages, DEFAULT_CHUNK_TOKENS, MIN_KEEP_TOKENS } from '../src/services/chunker.js';
import { countTokens } from '../src/utils/tokens.js';

const SENTENCES = [
  'Asynchronous programming lets tasks run independently while the program waits for slow operations.',
  'A promise represents a value that may be available now, later, or never.',
  'The async keyword makes a function return a promise automatically.',
  'The await keyword pauses an async function until the promise settles.',
  'Errors in async functions are handled with try and catch blocks.',
  'Callbacks were the original way to handle asynchronous results in JavaScript.',
  'Promise chaining with then avoids deeply nested callback pyramids.',
  'Promise.all waits for several promises and rejects if any of them rejects.',
];
const para = (n, seed) => Array.from({ length: n }, (_, i) => SENTENCES[(i + seed) % SENTENCES.length]).join(' ');

/** Dense lecture notes: ~32 pages of ~450 tokens, several paragraphs each. */
const densePages = () => Array.from({ length: 32 }, (_, i) => ({ page: i + 1, text: [para(8, i), para(8, i + 3), para(8, i + 5)].join('\n\n') }));

/** Slide deck like "lecture 13.pdf": 32 pages averaging ~50 tokens, some nearly empty. */
const slidePages = () =>
  Array.from({ length: 32 }, (_, i) => ({
    page: i + 1,
    text: i % 9 === 0 ? `Section ${i / 9 + 1}` : i === 31 ? 'Thank you' : `Slide ${i + 1}: ${para(2, i)}`,
  }));

function checkInvariants(chunks, pages) {
  const last = pages[pages.length - 1].page;
  chunks.forEach((c, i) => {
    assert.equal(c.chunkIndex, i, 'chunk indexes are sequential');
    assert.ok(c.tokenCount <= DEFAULT_CHUNK_TOKENS + 20, `chunk ${i} has ${c.tokenCount} tokens`);
    assert.ok(c.pages.length <= 2, `chunk ${i} spans pages ${c.pages.join(',')}`);
    assert.ok(c.pageEnd - c.page <= 1, `chunk ${i} cites ${c.page}-${c.pageEnd}`);
    assert.ok(c.page >= 1 && c.pageEnd <= last, 'page numbers are real');
    if (i > 0) assert.ok(c.page >= chunks[i - 1].page, 'pages are monotonic');
  });
  // Every page with text is covered by some chunk's citation range.
  const cited = new Set(chunks.flatMap((c) => Array.from({ length: c.pageEnd - c.page + 1 }, (_, k) => c.page + k)));
  // (A trailing scrap under MIN_KEEP_TOKENS, e.g. "Thank you", may be dropped.)
  for (const p of pages) if (countTokens(p.text) >= MIN_KEEP_TOKENS) assert.ok(cited.has(p.page), `page ${p.page} is cited`);
}

test('32-page dense notes -> ~25-60 chunks, 2 pages max, page numbers kept', () => {
  const pages = densePages();
  const chunks = chunkPages(pages);
  assert.ok(chunks.length >= 25 && chunks.length <= 60, `got ${chunks.length} chunks`);
  checkInvariants(chunks, pages);
  const avg = chunks.reduce((n, c) => n + c.tokenCount, 0) / chunks.length;
  assert.ok(avg >= 300 && avg <= 800, `average chunk ${Math.round(avg)} tokens`);
});

test('32-page slide deck (the "lecture 13" case) -> ~25-60 chunks instead of 2', () => {
  const pages = slidePages();
  const total = pages.reduce((n, p) => n + countTokens(p.text), 0);
  const chunks = chunkPages(pages);
  assert.ok(total < 2500, 'sample is sparse like the real deck');
  assert.ok(chunks.length >= 25 && chunks.length <= 60, `got ${chunks.length} chunks`);
  checkInvariants(chunks, pages);
  // Near-empty pages (titles, "Thank you") are merged, not left as tiny chunks.
  assert.ok(chunks.every((c) => c.tokenCount >= 3), 'no empty chunks');
  assert.ok(!chunks.some((c) => c.text.trim() === 'Section 2'), 'title slide merged into the next page');
});

test('one very long page splits at ~800 tokens with ~100-token overlap, all citing that page', () => {
  const pages = [{ page: 7, text: Array.from({ length: 24 }, (_, i) => para(10, i)).join('\n\n') }]; // ~3,150 tokens
  const chunks = chunkPages(pages);
  assert.ok(chunks.length >= 3, `got ${chunks.length} chunks`);
  checkInvariants(chunks, pages);
  assert.ok(chunks.every((c) => c.page === 7 && c.pageEnd === 7));
  // Consecutive chunks share text (overlap).
  const tail = chunks[0].text.slice(-80);
  assert.ok(chunks[1].text.includes(tail.slice(-40)), 'second chunk starts with overlap from the first');
});

test('overlap never pulls in a third page', () => {
  const pages = [
    { page: 1, text: para(30, 0) },
    { page: 2, text: 'Tiny.' }, // < 40 tokens: merges forward with page 3
    { page: 3, text: para(30, 2) },
  ];
  const chunks = chunkPages(pages);
  checkInvariants(chunks, pages);
});

test('unmergeable trailing scrap ("Thank you") is dropped', () => {
  const pages = [
    { page: 1, text: 'Tiny.' },
    { page: 2, text: para(4, 1) },
    { page: 3, text: 'Thank you' },
  ];
  const chunks = chunkPages(pages);
  checkInvariants(chunks, pages);
  assert.ok(!chunks.some((c) => c.text.includes('Thank you')), 'scrap not indexed on its own or as a 3rd page');
});

test('empty input -> no chunks', () => {
  assert.deepEqual(chunkPages([]), []);
  assert.deepEqual(chunkPages([{ page: 1, text: '   ' }]), []);
});
