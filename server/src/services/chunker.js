// Page-aware, token-aware chunking on paragraph/sentence boundaries with overlap. Pure function, no I/O.
//
// Rules:
//  - Chunks break at page boundaries, so citations point to real pages (one page per chunk for normal
//    pages; slide decks get one chunk per slide).
//  - Pages with very little text (< MIN_PAGE_TOKENS, e.g. a title slide or "Thank you") are merged
//    into the next page rather than becoming tiny chunks.
//  - Long pages are split at maxTokens on paragraph/sentence boundaries.
//  - A chunk never contains text from more than MAX_PAGES (2) pages, overlap included.
//  - Overlap: up to overlapTokens of trailing text, but never more than 20% of the previous chunk
//    (so tiny slides aren't duplicated into each other).
import { countTokens, splitByTokens } from '../utils/tokens.js';

export const DEFAULT_CHUNK_TOKENS = 800;
export const DEFAULT_OVERLAP_TOKENS = 100;
export const MAX_PAGES = 2;
export const MIN_PAGE_TOKENS = 20;
export const MIN_KEEP_TOKENS = 8; // a trailing chunk smaller than this that can't be merged is dropped // title-only slides (~5-15 tokens) merge forward; real slides (25+) stand alone

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Break text into units no bigger than maxTokens: paragraph -> sentences -> hard token split. */
function toUnits(paragraph, page, maxTokens) {
  const tokens = countTokens(paragraph);
  if (tokens <= maxTokens) return [{ text: paragraph, page, tokens }];
  const units = [];
  for (const { segment } of segmenter.segment(paragraph)) {
    const s = segment.trim();
    if (!s) continue;
    const t = countTokens(s);
    if (t <= maxTokens) units.push({ text: s, page, tokens: t });
    else for (const piece of splitByTokens(s, maxTokens)) units.push({ text: piece, page, tokens: countTokens(piece) });
  }
  return units;
}

function buildChunk(units, chunkIndex) {
  const text = units.map((u, i) => (i === 0 ? '' : u.paraStart ? '\n\n' : ' ') + u.text).join('');
  // Citation range = pages of the chunk's *new* (non-overlap) content.
  const fresh = units.filter((u) => !u.overlap).map((u) => u.page);
  return {
    chunkIndex,
    page: Math.min(...fresh),
    pageEnd: Math.max(...fresh),
    text,
    tokenCount: countTokens(text),
    pages: [...new Set(units.map((u) => u.page))], // every page with text in the chunk (incl. overlap); not stored
  };
}

/**
 * @param {{ page: number, text: string }[]} pages cleaned pages
 * @returns {{ chunkIndex, page, pageEnd, text, tokenCount, pages }[]}
 */
export function chunkPages(
  pages,
  { maxTokens = DEFAULT_CHUNK_TOKENS, overlapTokens = DEFAULT_OVERLAP_TOKENS, maxPages = MAX_PAGES, minPageTokens = MIN_PAGE_TOKENS } = {},
) {
  const units = [];
  for (const { page, text } of pages) {
    for (const para of text.split(/\n{2,}/)) {
      const p = para.trim();
      if (!p) continue;
      const parts = toUnits(p, page, maxTokens);
      parts[0].paraStart = true;
      units.push(...parts);
    }
  }

  const chunks = [];
  let cur = [];
  const freshUnits = () => cur.filter((u) => !u.overlap);
  const tokensOf = (list) => list.reduce((n, u) => n + u.tokens, 0);
  const pagesOf = (list) => new Set(list.map((u) => u.page));

  const flush = () => {
    const fresh = freshUnits();
    if (!fresh.length) return;
    const chunk = buildChunk(cur, chunks.length);
    chunks.push(chunk);
    // Overlap: trailing units from the chunk's last page only, within the token allowance.
    const allowance = Math.min(overlapTokens, Math.floor(chunk.tokenCount * 0.2));
    const lastPage = cur[cur.length - 1].page;
    const keep = [];
    let t = 0;
    for (let i = cur.length - 1; i >= 0; i--) {
      const u = cur[i];
      if (u.page !== lastPage || t + u.tokens > allowance) break;
      keep.unshift({ ...u, overlap: true });
      t += u.tokens;
    }
    // Last unit is a paragraph bigger than the allowance: take its trailing sentences instead.
    if (!keep.length && allowance > 0) {
      const last = cur[cur.length - 1];
      const sentences = [...segmenter.segment(last.text)].map((x) => x.segment.trim()).filter(Boolean);
      const tail = [];
      for (let i = sentences.length - 1; i > 0; i--) {
        const st = countTokens(sentences[i]);
        if (t + st > allowance) break;
        tail.unshift(sentences[i]);
        t += st;
      }
      if (tail.length) keep.push({ text: tail.join(' '), page: last.page, tokens: t, overlap: true, paraStart: true });
    }
    cur = keep;
  };

  for (const unit of units) {
    const fresh = freshUnits();
    const freshTokens = tokensOf(fresh);
    const lastFreshPage = fresh.length ? fresh[fresh.length - 1].page : null;
    const freshPages = pagesOf(fresh);

    // 1. Page boundary: start a new chunk unless the current page has too little text to stand alone.
    if (lastFreshPage !== null && unit.page !== lastFreshPage) {
      const curPageTokens = tokensOf(fresh.filter((u) => u.page === lastFreshPage));
      const wouldSpan = new Set([...freshPages, unit.page]).size;
      if (curPageTokens >= minPageTokens || wouldSpan > maxPages) flush();
    }
    // 2. Size limit.
    if (freshUnits().length && tokensOf(cur) + unit.tokens > maxTokens) flush();

    // 3. Page limit including overlap: drop overlap from the front until the chunk spans <= maxPages.
    while (cur.length && cur[0].overlap && new Set([...pagesOf(cur), unit.page]).size > maxPages) cur.shift();
    // Overlap alone + this unit too big: drop overlap from the front.
    while (cur.length && cur[0].overlap && tokensOf(cur) + unit.tokens > maxTokens) cur.shift();

    cur.push({ ...unit, overlap: false });
  }

  // A tiny trailing page ("Thank you", "Questions?") has no next page to merge into: merge it backwards.
  const tail = freshUnits();
  const prev = chunks[chunks.length - 1];
  if (tail.length && prev && tokensOf(tail) < minPageTokens) {
    const pages = new Set([...prev.pages, ...tail.map((u) => u.page)]);
    if (pages.size <= maxPages && prev.tokenCount + tokensOf(tail) <= maxTokens) {
      const text = `${prev.text}\n\n${tail.map((u) => u.text).join(' ')}`;
      chunks[chunks.length - 1] = {
        ...prev,
        text,
        tokenCount: countTokens(text),
        pageEnd: Math.max(prev.pageEnd, ...tail.map((u) => u.page)),
        pages: [...pages],
      };
      return chunks;
    }
    // Can't merge (would span 3 pages): drop a trailing scrap like "Thank you" rather than index noise.
    if (tokensOf(tail) < MIN_KEEP_TOKENS) return chunks;
  }
  flush();
  return chunks;
}
