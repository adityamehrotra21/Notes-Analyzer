// Coverage check for generated notes (pure, no LLM): does every outline topic have its own section?
//  - detailed / exam : a Markdown heading (#..####) per topic
//  - bullet          : a bold topic label at the start of a line (or a heading)
// The exam "Must-know checklist" deliberately does NOT count, otherwise a sheet with missing sections
// would look fully covered.

const STOP = new Set('a an and the of in on for to with vs versus is are how what why using use your its by from into as or at be'.split(' '));

export function normTitle(s) {
  return String(s)
    .toLowerCase()
    .replace(/\(pp?\.[^)]*\)/g, ' ') // "(pp. 3–4)"
    .replace(/[`*_#>[\]()"'“”‘’:;,!?]/g, ' ')
    .replace(/^\s*(?:\d+|[ivx]+)[.)]\s+/, '') // "3. " numbering (after markup is gone)
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s) => normTitle(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));

/** Heading-like lines that can stand for a topic section in the given mode. */
export function extractSectionTitles(markdown, mode) {
  const out = [];
  for (const line of String(markdown).split('\n')) {
    const h = /^\s{0,3}#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) out.push(h[1]);
    else if (mode === 'bullet') {
      const b = /^\s*(?:[-*]\s+)?\*\*(.+?)\*\*/.exec(line);
      if (b) out.push(b[1]);
    }
  }
  return out;
}

/** A topic is covered by a section title that contains it, or shares >= 60% of its significant words. */
function matches(topicTitle, sectionTitle) {
  const t = normTitle(topicTitle);
  const s = normTitle(sectionTitle);
  if (!t) return false;
  if (s.includes(t)) return true;
  const tw = words(topicTitle);
  if (!tw.length) return false;
  const sw = new Set(words(sectionTitle));
  const hit = tw.filter((w) => sw.has(w) || sw.has(w.replace(/s$/, '')) || sw.has(`${w}s`)).length;
  return hit >= Math.max(1, Math.ceil(tw.length * 0.6));
}

/**
 * @param {{ topics: { title: string }[] }} outline
 * @returns {{ total: number, covered: number, missing: string[] }}
 */
export function checkCoverage(outline, markdown, mode) {
  const topics = outline?.topics ?? [];
  const sections = extractSectionTitles(markdown, mode);
  const missing = topics.filter((t) => !sections.some((s) => matches(t.title, s))).map((t) => t.title);
  return { total: topics.length, covered: topics.length - missing.length, missing };
}

/** Insert extra sections before the closing section (Key takeaways / Last-minute recap / Exam focus), else append. */
export function insertSections(markdown, sections) {
  const extra = String(sections).trim();
  if (!extra) return markdown;
  const lines = String(markdown).split('\n');
  const idx = lines.findIndex((l) => /^\s{0,3}#{1,3}\s+(key takeaways|last-minute recap)\b/i.test(l) || /^\s*\*\*exam focus/i.test(l));
  if (idx < 0) return `${markdown.trimEnd()}\n\n${extra}\n`;
  return [...lines.slice(0, idx), extra, '', ...lines.slice(idx)].join('\n');
}
