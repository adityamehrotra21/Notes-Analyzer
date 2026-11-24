// Uploaded file -> per-page text. No env/DB/API access: images are transcribed by imageTextService.
// "Pages" are real pages (PDF), slides (PPTX), sheets (XLSX), or ~1 screen of text (DOCX, TXT, MD, CSV).
import JSZip from 'jszip';
import { extractPages, pdfPageRenderer, PdfError } from './pdfService.js';

const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024; // zip-bomb guard
const TEXT_PAGE_CHARS = 3000;
// A page/slide with a picture or drawing and less text than this is read by the vision model,
// so diagrams, charts and scanned pages aren't lost. Text-heavy pages keep their extracted text.
const VISION_MAX_TEXT_CHARS = 700;
const SLIDE_IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
export const UPLOAD_EXTENSIONS = ['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg', 'webp'];
const OLD_OFFICE = { doc: '.docx', ppt: '.pptx', xls: '.xlsx' };
const TEXT_EXT = new Set(['txt', 'md', 'csv']);
const OFFICE_EXT = new Set(['docx', 'pptx', 'xlsx']);

export const extensionOf = (name) => /\.([a-z0-9]+)$/i.exec(name ?? '')?.[1]?.toLowerCase() ?? '';

/** Message for a type we refuse by name, or null if the extension is allowed. */
export function unsupportedReason(name) {
  const ext = extensionOf(name);
  if (OLD_OFFICE[ext]) return `${name}: old .${ext} files aren't supported. Save it as ${OLD_OFFICE[ext]} and upload again`;
  if (ext === 'heic' || ext === 'heif') return `${name}: HEIC photos aren't supported. Export it as JPG or PNG`;
  if (UPLOAD_EXTENSIONS.includes(ext)) return null;
  return `${name}: unsupported file type. Use PDF, Word, PowerPoint, Excel, an image (PNG, JPG, WEBP) or a text file`;
}

/** The real format, from the file's bytes (the name only separates formats that share a container). */
export function detectFormat(buffer, name) {
  const ext = extensionOf(name);
  // Checked first: a text file or zip may legitimately contain the bytes "%PDF-".
  if (OFFICE_EXT.has(ext) && buffer.subarray(0, 2).toString('latin1') === 'PK') return ext;
  if (TEXT_EXT.has(ext) && decodeText(buffer) !== null) return ext;
  if (buffer.subarray(0, 1024).includes('%PDF-')) return 'pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export const isImageFormat = (format) => format in IMAGE_MIME;

function decodeText(buffer) {
  const utf16 = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le' : buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be' : null;
  try {
    const text = new TextDecoder(utf16 ?? 'utf-8', { fatal: true }).decode(buffer);
    return text.includes('\u0000') ? null : text.replace(/^﻿/, '');
  } catch {
    return null;
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

/** Reads zip entries (text, or a Buffer with binary=true) and stops once the total unzipped size passes the limit. */
function zipReader(zip) {
  let total = 0;
  return (path, binary = false) => {
    const entry = zip.file(path);
    if (!entry) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const parts = [];
      const stream = entry.nodeStream();
      stream.on('data', (c) => {
        total += c.length;
        if (total > MAX_UNZIPPED_BYTES) {
          stream.pause();
          reject(new PdfError('This file is too large to read once unpacked.'));
        } else parts.push(c);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(binary ? Buffer.concat(parts) : Buffer.concat(parts).toString('utf8')));
    });
  };
}

/** Paragraphs from WordprocessingML/DrawingML: split at paragraph ends, then collect runs. */
function paragraphs(xml, ns) {
  const run = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([^<]*)</${ns}:t>|<${ns}:(tab|br)(?:\\s[^>]*)?/>`, 'g');
  return xml
    .split(`</${ns}:p>`)
    .map((p) => [...p.matchAll(run)].map((m) => (m[2] === 'tab' ? '\t' : m[2] === 'br' ? '\n' : decodeXml(m[1]))).join('').trim())
    .filter(Boolean);
}

/** Relationship id -> target path, resolved against the part's folder. */
function relationships(xml, baseDir) {
  const map = new Map();
  for (const [tag] of (xml ?? '').matchAll(/<Relationship\s[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    const type = /\bType="([^"]+)"/.exec(tag)?.[1] ?? '';
    if (!id || !target || /TargetMode="External"/.test(tag)) continue;
    const parts = target.startsWith('/') ? [] : baseDir.split('/');
    for (const seg of target.replace(/^\//, '').split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    map.set(id, { path: parts.join('/'), type });
  }
  return map;
}

/** Group paragraphs into pages of about TEXT_PAGE_CHARS so citations stay useful. */
function paginate(paras) {
  const pages = [];
  let current = [];
  let size = 0;
  for (const p of paras) {
    if (size && size + p.length > TEXT_PAGE_CHARS) {
      pages.push(current.join('\n\n'));
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.length + 2;
  }
  if (current.length) pages.push(current.join('\n\n'));
  return pages.map((text, i) => ({ page: i + 1, text }));
}

async function parseDocx(read) {
  const xml = await read('word/document.xml');
  if (xml === null) throw new PdfError('Could not read this Word file (it may be corrupted).');
  return paginate(paragraphs(xml, 'w'));
}

async function parsePptx(read) {
  const pres = await read('ppt/presentation.xml');
  if (pres === null) throw new PdfError('Could not read this PowerPoint file (it may be corrupted).');
  const rels = relationships(await read('ppt/_rels/presentation.xml.rels'), 'ppt');
  const ids = [...pres.matchAll(/<p:sldId\s[^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
  const pages = [];
  for (const id of ids) {
    const path = rels.get(id)?.path;
    const xml = path ? await read(path) : null;
    if (xml === null) continue;
    const parts = paragraphs(xml, 'a');
    const file = path.split('/').pop();
    const slideRels = relationships(await read(`ppt/slides/_rels/${file}.rels`), 'ppt/slides');
    const notesPath = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'))?.path;
    const notesXml = notesPath ? await read(notesPath) : null;
    const notes = notesXml ? paragraphs(notesXml, 'a').filter((l) => !/^\d+$/.test(l)) : [];
    if (notes.length) parts.push(`Speaker notes: ${notes.join(' ')}`);
    // Pictures the vision model can read (EMF/WMF/SVG/TIFF aren't supported by it).
    const media = [...slideRels.values()].filter((r) => r.type.endsWith('/image') && SLIDE_IMAGE_MIME[extensionOf(r.path)]).map((r) => r.path);
    pages.push({ page: pages.length + 1, text: parts.join('\n\n'), media });
  }
  return pages;
}

async function parseXlsx(read) {
  const book = await read('xl/workbook.xml');
  if (book === null) throw new PdfError('Could not read this Excel file (it may be corrupted).');
  const rels = relationships(await read('xl/_rels/workbook.xml.rels'), 'xl');
  const shared = [...((await read('xl/sharedStrings.xml')) ?? '').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) =>
    [...(m[1] ?? '').matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decodeXml(t[1])).join(''),
  );
  const pages = [];
  for (const [tag] of book.matchAll(/<sheet\s[^>]*>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(tag)?.[1] ?? 'Sheet');
    const path = rels.get(/r:id="([^"]+)"/.exec(tag)?.[1])?.path;
    const xml = path ? await read(path) : null;
    if (xml === null) continue;
    const rows = [];
    for (const [, row] of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const [, attrs, body] of row.matchAll(/<c(\s[^>]*?)?>([\s\S]*?)<\/c>/g)) {
        const type = /\bt="([^"]+)"/.exec(attrs ?? '')?.[1];
        const value = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        if (type === 's') cells.push(shared[Number(value)] ?? '');
        else if (type === 'inlineStr') cells.push([...body.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decodeXml(t[1])).join(''));
        else if (value !== undefined) cells.push(decodeXml(value));
      }
      if (cells.some((c) => c.trim())) rows.push(cells.join(' | '));
    }
    if (rows.length) pages.push({ page: pages.length + 1, text: [`Sheet: ${name}`, ...rows].join('\n\n') });
  }
  return pages;
}

const OFFICE = { docx: parseDocx, pptx: parsePptx, xlsx: parseXlsx };

const noVisuals = { graphics: new Set(), loadVisual: async () => null, close: () => {} };

/**
 * Text per page (CPU only), plus which pages have pictures/drawings and a loader that turns
 * such a page into an image for the vision model.
 * @returns {Promise<{ format, pageCount, pages: { page, text }[], graphics: Set<number>,
 *   loadVisual(page): Promise<{ data: Buffer, mime: string } | null>, close(): void }>}
 */
export async function extractDocument(buffer, filename) {
  const format = detectFormat(buffer, filename);
  if (format === 'pdf') {
    const { pageCount, pages, graphics } = await extractPages(buffer);
    const renderer = pdfPageRenderer(buffer);
    return { format, pageCount, pages, graphics, loadVisual: (p) => renderer.render(p), close: renderer.close };
  }
  if (isImageFormat(format)) {
    return { format, pageCount: 1, pages: [{ page: 1, text: '' }], graphics: new Set([1]), loadVisual: async () => ({ data: buffer, mime: IMAGE_MIME[format] }), close: () => {} };
  }
  if (OFFICE[format]) {
    let zip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (err) {
      throw new PdfError('Could not read this file (it may be corrupted or password-protected).', { cause: err });
    }
    const read = zipReader(zip);
    const parsed = await OFFICE[format](read);
    const media = new Map(parsed.filter((p) => p.media?.length).map((p) => [p.page, p.media]));
    const pages = parsed.map(({ page, text }) => ({ page, text }));
    // The biggest picture on the slide is the one worth reading.
    const loadVisual = async (page) => {
      let best = null;
      for (const path of media.get(page) ?? []) {
        const data = await read(path, true);
        if (data && (!best || data.length > best.data.length)) best = { data, mime: SLIDE_IMAGE_MIME[extensionOf(path)] };
      }
      return best;
    };
    return { format, pageCount: pages.length, pages, graphics: new Set(media.keys()), loadVisual, close: () => {} };
  }
  if (format) {
    const text = decodeText(buffer) ?? '';
    const paras = text.replace(/\r\n?/g, '\n').split(format === 'csv' ? /\n+/ : /\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const pages = paginate(paras);
    return { format, pageCount: pages.length, pages, ...noVisuals };
  }
  throw new PdfError('Unsupported or damaged file.');
}

/** Pages to send to the vision model: every image upload, and visual pages with little text. */
export function pagesNeedingVision({ format, pages, graphics }) {
  if (isImageFormat(format)) return [1];
  return pages.filter((p) => graphics.has(p.page) && p.text.trim().length < VISION_MAX_TEXT_CHARS).map((p) => p.page);
}
