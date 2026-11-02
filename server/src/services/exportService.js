// Exports of already-generated content (no LLM calls): study notes, practice Q&A, quizzes, quiz attempts,
// and "everything for a document". Markdown -> HTML (marked + highlight.js + callouts) -> PDF (Puppeteer).
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Marked } from 'marked';
import hljs from 'highlight.js';
import puppeteer from 'puppeteer';
import { db } from '../db/index.js';
import { documents, generatedQuestions, quizDocument, quizQuestions, quizzes } from '../db/schema.js';
import { AppError } from '../utils/AppError.js';
import { RateQueue } from '../utils/rateQueue.js';
import logger from '../utils/logger.js';
import { getAttempt } from './quizService.js';

const log = logger.child({ module: 'export' });

const MODE_LABEL = { brief: 'Brief summary', detailed: 'Detailed notes', exam: 'Exam revision' };
const MODE_COLUMN = { brief: 'summaryBrief', detailed: 'summaryDetailed', exam: 'summaryExam' };
const TYPE_LABEL = { short: 'Short answer', long: 'Long answer', conceptual: 'Conceptual' };
const LETTERS = ['A', 'B', 'C', 'D'];

// ---------------------------------------------------------------- Markdown -> HTML

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';

const CALLOUT = {
  important: 'Important',
  mistake: 'Common pitfall',
  tip: 'Tip',
  example: 'Example',
  note: 'Note',
};
const ALERT = { important: 'important', mistake: 'mistake', warning: 'mistake', caution: 'mistake', tip: 'tip', example: 'example', note: 'note' };

function makeMarked() {
  const m = new Marked({ gfm: true });
  m.use({
    renderer: {
      code({ text, lang }) {
        const language = lang && hljs.getLanguage(lang) ? lang : null;
        const html = language ? hljs.highlight(text, { language }).value : esc(text);
        return `<pre class="code"><div class="code-lang">${esc(lang || 'code')}</div><code class="hljs">${html}</code></pre>\n`;
      },
    },
  });
  return m;
}

/** Same rules as the app: "> [!TYPE] …" or older "> ⚠️ …" / "> ⭐ …"; several in one quote are split. */
function calloutsToHtml(markdown, md) {
  const lines = String(markdown).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*>/.test(lines[i])) {
      out.push(lines[i]);
      continue;
    }
    const block = [];
    while (i < lines.length && /^\s*>/.test(lines[i])) block.push(lines[i++].replace(/^\s*>\s?/, ''));
    i--;
    const groups = [];
    for (const l of block) {
      const alert = /^\[!(\w+)\]\s*(.*)$/.exec(l.trim());
      const emoji = /^(⚠️?|⭐)\s*(.*)$/u.exec(l.trim());
      if (alert && ALERT[alert[1].toLowerCase()]) groups.push({ type: ALERT[alert[1].toLowerCase()], lines: [alert[2]] });
      else if (emoji) groups.push({ type: emoji[1].startsWith('⚠') ? 'mistake' : 'important', lines: [emoji[2].replace(/^\*\*(common mistakes?|important for exams?)\s*:?\*\*\s*:?\s*/i, '')] });
      else if (groups.length) groups[groups.length - 1].lines.push(l);
      else groups.push({ type: null, lines: [l] });
    }
    out.push('');
    for (const g of groups) {
      const inner = md.parse(g.lines.join('\n')).replace(/\n\s*\n/g, '\n');
      out.push(g.type ? `<div class="callout callout-${g.type}"><div class="callout-title">${CALLOUT[g.type]}</div>${inner}</div>` : `<blockquote>${inner}</blockquote>`, '');
    }
  }
  return out.join('\n');
}

/** Markdown -> HTML with heading ids; returns the h2 list for the table of contents. */
function renderMarkdown(markdown) {
  const md = makeMarked();
  let html = md.parse(calloutsToHtml(markdown, md));
  const toc = [];
  const used = new Set();
  html = html.replace(/<h([12])>([\s\S]*?)<\/h\1>/g, (all, level, inner) => {
    let id = slug(inner);
    while (used.has(id)) id += '-x';
    used.add(id);
    if (level === '2') toc.push({ id, text: inner.replace(/<[^>]+>/g, '') });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  return { html, toc };
}

// ---------------------------------------------------------------- print template

const PRINT_CSS = `
@page { size: A4; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #18181b; font-size: 10.5pt; line-height: 1.55; margin: 0; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.cover .brand { color: #4f46e5; font-weight: 700; letter-spacing: .04em; font-size: 11pt; }
.cover h1 { font-size: 26pt; margin: 10mm 0 4mm; line-height: 1.2; }
.cover .sub { color: #52525b; font-size: 12pt; }
.cover .meta { margin-top: 14mm; color: #71717a; font-size: 10pt; }
.toc { page-break-after: always; }
.toc h2 { border: 0; }
.toc ol { padding-left: 18px; }
.toc li { margin: 3px 0; }
.toc a { color: #18181b; text-decoration: none; }
h1 { font-size: 18pt; margin: 0 0 6mm; }
h2 { font-size: 14pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #e4e4e7; page-break-after: avoid; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; page-break-after: avoid; }
p, ul, ol, table, pre, .callout { margin: 0 0 3mm; }
ul, ol { padding-left: 18px; }
li { margin: 1mm 0; }
code { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 9pt; background: #f4f4f5; padding: .5px 4px; border-radius: 3px; }
pre.code { background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 6px; padding: 0; overflow: hidden; page-break-inside: avoid; }
pre.code .code-lang { font-family: Menlo, monospace; font-size: 7.5pt; color: #52525b; background: #e4e4e7; padding: 1.5mm 3mm; }
pre.code code { display: block; padding: 3mm; background: none; white-space: pre-wrap; word-break: break-word; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #d4d4d8; padding: 1.5mm 2.5mm; text-align: left; vertical-align: top; }
th { background: #f4f4f5; }
blockquote { border-left: 3px solid #d4d4d8; margin-left: 0; padding-left: 3mm; color: #52525b; }
.callout { border: 1px solid; border-left-width: 4px; border-radius: 6px; padding: 2.5mm 3.5mm; page-break-inside: avoid; }
.callout-title { font-weight: 700; font-size: 9pt; letter-spacing: .02em; margin-bottom: 1mm; }
.callout p:last-child { margin-bottom: 0; }
.callout-important { background: #eef2ff; border-color: #c7d2fe; border-left-color: #6366f1; } .callout-important .callout-title { color: #4338ca; }
.callout-mistake { background: #fffbeb; border-color: #fde68a; border-left-color: #f59e0b; } .callout-mistake .callout-title { color: #92400e; }
.callout-tip { background: #ecfdf5; border-color: #a7f3d0; border-left-color: #10b981; } .callout-tip .callout-title { color: #065f46; }
.callout-example { background: #f4f4f5; border-color: #d4d4d8; border-left-color: #71717a; } .callout-example .callout-title { color: #3f3f46; }
.callout-note { background: #f1f5f9; border-color: #cbd5e1; border-left-color: #64748b; } .callout-note .callout-title { color: #334155; }
.q { page-break-inside: avoid; margin-bottom: 5mm; }
.badge { display: inline-block; font-size: 8pt; font-weight: 600; padding: .5mm 2mm; border-radius: 3px; background: #eef2ff; color: #4338ca; }
.correct { color: #047857; font-weight: 600; } .wrong { color: #b45309; font-weight: 600; }
.answer-line { border-bottom: 1px solid #d4d4d8; height: 7mm; }
/* highlight.js (light, print) */
.hljs-keyword, .hljs-selector-tag { color: #6d28d9; } .hljs-string, .hljs-regexp { color: #047857; } .hljs-comment { color: #71717a; font-style: italic; }
.hljs-number, .hljs-literal { color: #b45309; } .hljs-title, .hljs-section { color: #1d4ed8; } .hljs-built_in, .hljs-type { color: #be185d; }
.hljs-attr, .hljs-variable, .hljs-params, .hljs-property { color: #0e7490; } .hljs-tag, .hljs-name { color: #9f1239; }
`;

function htmlDocument({ title, subtitle, sourceName, markdown }) {
  const { html, toc } = renderMarkdown(markdown);
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const tocHtml =
    toc.length >= 3
      ? `<section class="toc"><h2>Contents</h2><ol>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol></section>`
      : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>
<section class="cover"><div class="brand">NotesAnalyser</div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle ?? '')}</div>
<div class="meta">${sourceName ? `Source: ${esc(sourceName)}<br>` : ''}Exported ${esc(date)}</div></section>
${tocHtml}<main>${html}</main></body></html>`;
}

// ---------------------------------------------------------------- PDF (one shared browser)

let browserPromise = null;
const pdfQueue = new RateQueue({ name: 'pdf', concurrency: 2 });

async function getBrowser() {
  browserPromise ??= puppeteer
    .launch({ headless: true, args: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] })
    .catch((err) => {
      browserPromise = null;
      throw err;
    });
  return browserPromise;
}

export async function closePdfBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

async function toPdf(html, footerTitle) {
  return pdfQueue.add(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      return Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',
          footerTemplate: `<div style="font-size:7.5px;width:100%;padding:0 16mm;color:#71717a;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif"><span>${esc(footerTitle)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
          margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
        }),
      );
    } finally {
      await page.close().catch(() => {});
    }
  });
}

// ---------------------------------------------------------------- content builders (Markdown)

async function loadDoc(userId, documentId) {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  if (!doc) throw AppError.notFound('Document not found');
  return doc;
}

function notesMarkdown(doc, mode) {
  const body = doc[MODE_COLUMN[mode]];
  if (!body) throw AppError.badRequest(`Generate the ${MODE_LABEL[mode].toLowerCase()} for this document first`);
  const cov = doc.summaryCoverage?.[mode];
  const coverage = cov?.total ? `\n\n*Coverage: ${cov.covered}/${cov.total} topics.*` : '';
  // Drop a leading "# Title" from the notes; the cover page already has the title.
  return `${body.replace(/^\s*#\s+[^\n]*\n/, '')}${coverage}`;
}

/** Map a page to the outline topic that covers it (for grouping Q&A by topic). */
const topicFor = (outline, page) => outline?.topics?.find((t) => page && page >= t.startPage && page <= t.endPage)?.title ?? 'General';

async function qaMarkdown(userId, documentIds, { questionsOnly = false } = {}) {
  const rows = await db
    .select()
    .from(generatedQuestions)
    .where(and(eq(generatedQuestions.userId, userId), inArray(generatedQuestions.documentId, documentIds)))
    .orderBy(asc(generatedQuestions.createdAt));
  if (!rows.length) throw AppError.badRequest('Generate some practice questions first');
  const docs = await db.select({ id: documents.id, outline: documents.outline }).from(documents).where(inArray(documents.id, documentIds));
  const outlines = new Map(docs.map((d) => [d.id, d.outline]));
  // Group by topic (outline order), then by type.
  const byTopic = new Map();
  for (const q of rows) {
    const topic = topicFor(outlines.get(q.documentId), q.sourcePage);
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic).push(q);
  }
  const order = (outlines.get(documentIds[0])?.topics ?? []).map((t) => t.title);
  const topics = [...byTopic.keys()].sort((a, b) => (order.indexOf(a) === -1 ? 999 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 999 : order.indexOf(b)));
  let n = 0;
  const parts = [];
  for (const topic of topics) {
    parts.push(`## ${topic}`);
    for (const type of ['short', 'long', 'conceptual']) {
      const qs = byTopic.get(topic).filter((q) => q.type === type);
      if (!qs.length) continue;
      parts.push(`### ${TYPE_LABEL[type]}`);
      for (const q of qs) {
        n++;
        const page = q.sourcePage ? ` *(p. ${q.sourcePage})*` : '';
        parts.push(`**Q${n}.** ${q.question}${page}`);
        if (questionsOnly) parts.push(type === 'short' ? '<div class="answer-line"></div><div class="answer-line"></div>' : '<div class="answer-line"></div><div class="answer-line"></div><div class="answer-line"></div><div class="answer-line"></div>');
        else parts.push(`**Model answer:**\n\n${q.answer}`);
      }
    }
  }
  return { markdown: parts.join('\n\n'), count: n };
}

function quizMarkdown(quiz, { withAnswers }) {
  const parts = quiz.questions.map((q, i) => {
    const opts = q.options.map((o, j) => `- **${LETTERS[j]}.** ${o}${withAnswers && j === q.correctIndex ? ' ✅' : ''}`).join('\n');
    const extra = withAnswers ? `\n\n> [!NOTE]\n> **Answer: ${LETTERS[q.correctIndex]}.** ${q.explanation}${q.sourcePage ? ` (p. ${q.sourcePage})` : ''}` : '';
    return `### Question ${i + 1}${q.difficulty ? ` <span class="badge">${q.difficulty}</span>` : ''}\n\n${q.question}\n\n${opts}${extra}`;
  });
  const key = withAnswers ? `\n\n## Answer key\n\n| Q | Answer |\n|---|---|\n${quiz.questions.map((q, i) => `| ${i + 1} | ${LETTERS[q.correctIndex]} |`).join('\n')}` : '';
  return `## Questions\n\n${parts.join('\n\n')}${key}`;
}

/** Full quiz with answers, for the owner (loads correct answers server-side). */
async function loadQuizFull(userId, quizId) {
  const [quiz] = await db.select().from(quizzes).where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)));
  if (!quiz) throw AppError.notFound('Quiz not found');
  const questions = await db.select().from(quizQuestions).where(eq(quizQuestions.quizId, quizId)).orderBy(asc(quizQuestions.position));
  const docs = await db
    .select({ id: documents.id, filename: documents.filename })
    .from(quizDocument)
    .innerJoin(documents, eq(documents.id, quizDocument.documentId))
    .where(eq(quizDocument.quizId, quizId));
  return { ...quiz, questions, documents: docs };
}

function attemptMarkdown(attempt) {
  const pct = attempt.total ? Math.round((attempt.score / attempt.total) * 100) : 0;
  const rows = attempt.results.map((r, i) => {
    const mine = r.selectedIndex === null ? '—' : `${LETTERS[r.selectedIndex]}. ${r.options[r.selectedIndex]}`;
    const verdict = r.selectedIndex === null ? '<span class="wrong">Not answered</span>' : r.correct ? '<span class="correct">✓ Correct</span>' : '<span class="wrong">✗ Incorrect</span>';
    return `### Question ${i + 1}\n\n${r.question}\n\n${r.options.map((o, j) => `- **${LETTERS[j]}.** ${o}`).join('\n')}\n\n**Your answer:** ${mine} — ${verdict}  \n**Correct answer:** ${LETTERS[r.correctIndex]}. ${r.options[r.correctIndex]}\n\n> [!NOTE]\n> ${r.explanation}${r.sourcePage ? ` (p. ${r.sourcePage})` : ''}`;
  });
  return `## Result\n\n**Score: ${attempt.score} / ${attempt.total} (${pct}%)**\n\n| Q | Your answer | Correct | Result |\n|---|---|---|---|\n${attempt.results
    .map((r, i) => `| ${i + 1} | ${r.selectedIndex === null ? '—' : LETTERS[r.selectedIndex]} | ${LETTERS[r.correctIndex]} | ${r.selectedIndex === null ? 'Not answered' : r.correct ? '✓' : '✗'} |`)
    .join('\n')}\n\n## Review\n\n${rows.join('\n\n')}`;
}

const datePart = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the server's local time zone
const fileSlug = (s) => String(s).replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'notes';

/**
 * Build the export. Returns { title, subtitle, sourceName, markdown, filenameBase }.
 * spec: { type: notes|qa|quiz|attempt|all, documentId?, documentIds?, refId?, options }
 */
export async function buildExport(userId, { type, documentId, documentIds, refId, options = {} }) {
  if (type === 'notes') {
    const doc = await loadDoc(userId, documentId);
    const mode = options.mode ?? 'detailed';
    return { title: `${MODE_LABEL[mode]}`, subtitle: doc.filename, sourceName: doc.filename, markdown: notesMarkdown(doc, mode), filenameBase: `${fileSlug(doc.filename)}_${mode}-notes_${datePart()}` };
  }
  if (type === 'qa') {
    const ids = documentIds?.length ? documentIds : [documentId];
    const docs = await Promise.all(ids.map((id) => loadDoc(userId, id)));
    const { markdown, count } = await qaMarkdown(userId, ids, options);
    const name = docs.map((d) => d.filename).join(', ');
    return {
      title: options.questionsOnly ? 'Practice questions' : 'Important questions & answers',
      subtitle: `${count} question${count === 1 ? '' : 's'}${options.questionsOnly ? ' · questions only' : ' · with model answers and marking points'}`,
      sourceName: name,
      markdown,
      filenameBase: `${fileSlug(docs[0].filename)}_${options.questionsOnly ? 'questions' : 'qa'}_${datePart()}`,
    };
  }
  if (type === 'quiz') {
    const quiz = await loadQuizFull(userId, refId);
    const withAnswers = options.variant === 'answers';
    const name = quiz.documents.map((d) => d.filename).join(', ');
    return {
      title: withAnswers ? 'Quiz with answer key' : 'Practice quiz',
      subtitle: `${quiz.questions.length} questions · ${quiz.difficulty}${quiz.topic ? ` · ${quiz.topic}` : ''}`,
      sourceName: name,
      markdown: quizMarkdown(quiz, { withAnswers }),
      filenameBase: `${fileSlug(quiz.documents[0]?.filename ?? 'quiz')}_${withAnswers ? 'quiz-answers' : 'quiz'}_${datePart()}`,
    };
  }
  if (type === 'attempt') {
    const { attempt, quiz } = await getAttempt({ userId, attemptId: refId });
    const name = quiz.documents.map((d) => d.filename).join(', ');
    return {
      title: 'Quiz results',
      subtitle: `Score ${attempt.score}/${attempt.total} · ${quiz.difficulty}${quiz.topic ? ` · ${quiz.topic}` : ''}`,
      sourceName: name,
      markdown: attemptMarkdown(attempt),
      filenameBase: `${fileSlug(quiz.documents[0]?.filename ?? 'quiz')}_results_${datePart()}`,
    };
  }
  if (type === 'all') {
    const doc = await loadDoc(userId, documentId);
    const sections = [];
    const mode = ['detailed', 'exam', 'brief'].find((m) => doc[MODE_COLUMN[m]]);
    if (mode) sections.push(`# ${MODE_LABEL[mode]}\n\n${notesMarkdown(doc, mode)}`);
    try {
      sections.push(`# Important questions & answers\n\n${(await qaMarkdown(userId, [doc.id])).markdown}`);
    } catch {
      /* no Q&A yet */
    }
    const [latest] = await db
      .select({ id: quizzes.id })
      .from(quizzes)
      .innerJoin(quizDocument, eq(quizDocument.quizId, quizzes.id))
      .where(and(eq(quizzes.userId, userId), eq(quizDocument.documentId, doc.id)))
      .orderBy(desc(quizzes.createdAt))
      .limit(1);
    if (latest) sections.push(`# Quiz with answer key\n\n${quizMarkdown(await loadQuizFull(userId, latest.id), { withAnswers: true })}`);
    if (!sections.length) throw AppError.badRequest('Nothing to export yet: generate notes, questions or a quiz first');
    // Demote one level so each part's "#" becomes a TOC entry.
    const markdown = sections.join('\n\n').replace(/^(#{1,5}) /gm, '#$1 ');
    return { title: 'Study pack', subtitle: doc.filename, sourceName: doc.filename, markdown, filenameBase: `${fileSlug(doc.filename)}_study-pack_${datePart()}` };
  }
  throw AppError.badRequest('Unknown export type');
}

/** @returns {{ buffer, filename, contentType, title }} */
export async function renderExport(userId, spec, format = 'pdf') {
  const t0 = Date.now();
  const built = await buildExport(userId, spec);
  if (format === 'md') {
    const md = `# ${built.title}\n\n_${built.subtitle}_${built.sourceName ? `  \nSource: ${built.sourceName}` : ''}\n\n${built.markdown}\n`;
    log.info('export rendered', { type: spec.type, format, bytes: md.length, durationMs: Date.now() - t0 });
    return { buffer: Buffer.from(md, 'utf8'), filename: `${built.filenameBase}.md`, contentType: 'text/markdown; charset=utf-8', title: built.title };
  }
  const html = htmlDocument(built);
  const buffer = await toPdf(html, `${built.title} · ${built.sourceName ?? ''}`);
  log.info('export rendered', { type: spec.type, format, bytes: buffer.length, durationMs: Date.now() - t0 });
  return { buffer, filename: `${built.filenameBase}.pdf`, contentType: 'application/pdf', title: built.title, sourceName: built.sourceName };
}

export { htmlDocument as _htmlDocument, renderMarkdown as _renderMarkdown };
