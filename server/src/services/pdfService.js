// PDF -> per-page text -> cleaned text. No env/DB access so scripts can use it standalone.
// pdf-parse v2 (modern pdfjs-dist) returns text per page with one line per visual line.
import { PDFParse } from 'pdf-parse';

export class PdfError extends Error {}

const SENTENCE_END = /[.!?:;]["'”’)\]]?$/;

/**
 * pdf-parse gives lines but no paragraph breaks. Insert a blank line after
 *  - a short line that ends a sentence (last line of a paragraph), and
 *  - a very short line without end punctuation (likely a heading).
 */
function markParagraphs(text) {
  const lines = text.split('\n');
  const lengths = lines.map((l) => l.trim().length).filter((n) => n > 0).sort((a, b) => a - b);
  if (lengths.length < 4) return text;
  const typical = lengths[Math.floor(lengths.length * 0.75)]; // p75 = a "full" line
  const out = [];
  lines.forEach((line, i) => {
    out.push(line);
    const t = line.trim();
    const next = lines[i + 1]?.trim();
    if (!t || !next) return;
    if ((SENTENCE_END.test(t) && t.length < typical * 0.8) || (!SENTENCE_END.test(t) && t.length < typical * 0.5 && !/[,-]$/.test(t))) {
      out.push('');
    }
  });
  return out.join('\n');
}

/** @returns {Promise<{ pageCount: number, pages: { page: number, text: string }[] }>} */
export async function extractPages(buffer) {
  // Copy: pdf.js may transfer (detach) the underlying ArrayBuffer.
  const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
  try {
    const result = await parser.getText();
    return {
      pageCount: result.total,
      pages: result.pages.map((p) => ({ page: p.num, text: markParagraphs(p.text) })),
    };
  } catch (err) {
    const msg = err?.name === 'PasswordException' ? 'This PDF is password-protected.' : 'Could not read this PDF (it may be corrupted).';
    throw new PdfError(msg, { cause: err });
  } finally {
    await parser.destroy().catch(() => {});
  }
}

const PAGE_NUMBER = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;
const lineKey = (line) => line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const EDGE = 2; // lines at the top/bottom of a page checked for repeated headers/footers

function normalizePage(text) {
  return text
    .normalize('NFKC')
    .replace(/­/g, '') // soft hyphen
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ \t\f\v ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}

/**
 * Collapse whitespace, de-hyphenate line breaks, drop page numbers and headers/footers that
 * repeat across pages, and unwrap hard line breaks inside paragraphs.
 * @returns {{ pages: { page: number, text: string }[], removedLines: string[] }}
 */
export function cleanPages(rawPages) {
  const pages = rawPages.map((p) => ({ page: p.page, lines: normalizePage(p.text).split('\n') }));

  // Count how many pages each edge line (digits masked) appears on.
  const counts = new Map();
  for (const p of pages) {
    const nonEmpty = p.lines.map((l, i) => [l, i]).filter(([l]) => l);
    const edges = new Set([...nonEmpty.slice(0, EDGE), ...nonEmpty.slice(-EDGE)].map(([l]) => lineKey(l)));
    for (const k of edges) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.5));
  const repeated = new Set([...counts].filter(([k, n]) => n >= threshold && k.length > 0).map(([k]) => k));

  const removed = new Set();
  const cleaned = pages.map(({ page, lines }) => {
    const idx = lines.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
    const edgeIdx = new Set([...idx.slice(0, EDGE), ...idx.slice(-EDGE)]);
    const kept = lines.filter((l, i) => {
      if (!edgeIdx.has(i)) return true;
      if (PAGE_NUMBER.test(l) || repeated.has(lineKey(l))) {
        removed.add(l);
        return false;
      }
      return true;
    });
    const text = kept
      .join('\n')
      // Line-end hyphen: keep it and join ("light-\ndependent" -> "light-dependent"). Joining without the
      // hyphen would corrupt real compounds; a wrapped plain word ("exam-ple") stays readable.
      .replace(/(\p{L})-\n(\p{Ll})/gu, '$1-$2')
      .replace(/\n{3,}/g, '\n\n')
      // Unwrap single newlines inside paragraphs, but keep list items on their own lines.
      .replace(/([^\n])\n(?!\n|\s*(?:[-•*▪●◦]|\d{1,3}[.)]|[a-z][.)])\s)/g, '$1 ')
      .replace(/ {2,}/g, ' ')
      .trim();
    return { page, text };
  });

  return { pages: cleaned, removedLines: [...removed] };
}
