// Parse + clean + chunk a local PDF and print stats. No database, no API calls.
//   node scripts/inspectPdf.js path/to/notes.pdf [--show 3] [--page 2]
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { extractPages, cleanPages } from '../src/services/pdfService.js';
import { chunkPages } from '../src/services/chunker.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { show: { type: 'string', default: '2' }, page: { type: 'string' } },
});
if (!positionals[0]) {
  console.error('Usage: node scripts/inspectPdf.js <file.pdf> [--show N] [--page N]');
  process.exit(1);
}

const t0 = performance.now();
let extracted;
try {
  extracted = await extractPages(await readFile(positionals[0]));
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
const { pageCount, pages } = extracted;
const { pages: cleaned, removedLines } = cleanPages(pages);
const chunks = chunkPages(cleaned);
const ms = Math.round(performance.now() - t0);

const toks = chunks.map((c) => c.tokenCount);
console.log(`Pages: ${pageCount} (${cleaned.filter((p) => p.text).length} with text)   time: ${ms}ms`);
console.log(`Removed header/footer/page-number lines: ${removedLines.length ? removedLines.map((l) => JSON.stringify(l)).join(', ') : 'none'}`);
console.log(
  chunks.length
    ? `Chunks: ${chunks.length}   tokens min/avg/max: ${Math.min(...toks)}/${Math.round(toks.reduce((a, b) => a + b, 0) / toks.length)}/${Math.max(...toks)}`
    : 'Chunks: 0 (no extractable text: scanned or image-only PDF?)',
);
console.log(`Chunk pages: ${chunks.map((c) => (c.page === c.pageEnd ? c.page : `${c.page}-${c.pageEnd}`)).join(' ')}`);

if (values.page) {
  const p = cleaned.find((x) => x.page === Number(values.page));
  console.log(`\n--- cleaned page ${values.page} ---\n${p?.text ?? '(no such page)'}`);
}
for (const c of chunks.slice(0, Number(values.show))) {
  console.log(`\n--- chunk ${c.chunkIndex} · p.${c.page}${c.pageEnd !== c.page ? '-' + c.pageEnd : ''} · ${c.tokenCount} tokens ---\n${c.text.slice(0, 700)}${c.text.length > 700 ? ' …' : ''}`);
}
