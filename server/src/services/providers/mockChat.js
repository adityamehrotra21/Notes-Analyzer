// Offline "LLM" for UI testing without an API key (LLM_PROVIDER=mock). It answers extractively
// from the [S#] sources in the last user message so citations and streaming can be exercised.
// It does not understand anything; never use it for real answers.
import { sleep } from '../../utils/retry.js';

const firstSentence = (text) => text.replace(/\s+/g, ' ').trim().match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? text.slice(0, 160);

/** Page-tagged units from a <document> block: [{ page, endPage, text }]. */
function docUnits(last) {
  const body = last.match(/<(document|notes)>\n?([\s\S]*?)<\/\1>/)?.[2] ?? '';
  return [...body.matchAll(/\[pp?\. (\d+)(?:–(\d+))?\]\n([\s\S]*?)(?=\n\n\[pp?\. |$)/g)].map(([, a, b, text]) => ({ page: Number(a), endPage: Number(b ?? a), text: text.replace(/\s+/g, ' ').trim() }));
}

/** Outline: one topic per unit, titled by its first few words. */
function fakeOutline(last) {
  const units = docUnits(last).filter((u) => u.text.length > 25).slice(0, 8);
  const seen = new Set();
  const topics = [];
  for (const u of units) {
    const title = u.text.split(/[.:]/)[0].split(' ').slice(0, 4).join(' ');
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    topics.push({ title, startPage: u.page, endPage: u.endPage, subtopics: [] });
  }
  return { documentType: /function|await|const |=>/.test(last) ? 'programming' : 'general', topics: topics.length ? topics : [{ title: 'Overview', startPage: 1, endPage: 1, subtopics: [] }] };
}

/** Notes following a TOPIC OUTLINE: every topic except the LAST (so the coverage check has a gap to fill). */
function fakeOutlinedNotes(last, mode) {
  const titles = [...last.matchAll(/^\d+\. (.+?) \(pp?\. (\d+)(?:–(\d+))?\)/gm)].map(([, t, a, b]) => ({ t, a, b: b ?? a }));
  const shown = titles.slice(0, Math.max(1, titles.length - 1));
  const section = ({ t, a, b }, i) =>
    mode === 'bullet'
      ? `**${t} (pp. ${a}–${b})**\n- (mock) key point about ${t} (p. ${a})`
      : `## ${t} (pp. ${a}–${b})\n**Definition:** (mock) ${t} as described on p. ${a}.\n\n**In simple terms:** (mock) a plain explanation.\n\n${i === 0 ? '**Example (added):** (mock) an illustration that is not from the notes.\n\n```js\nconst value = await Promise.resolve(42); // (mock)\n```\n\n> [!MISTAKE] (mock) forgetting to await the promise.\n\n> [!IMPORTANT] (mock) know this definition.\n\n> [!TIP] (mock) say it out loud once.' : `**Example (from notes, p. ${a}):** (mock) example.`}`;
  return `# (mock) ${mode} notes\n\n(mock) overview.\n\n${shown.map(section).join('\n\n')}\n\n## Key takeaways\n- (mock) takeaway one\n- (mock) takeaway two`;
}

/** Fill: sections for exactly the listed missing topics. */
function fakeMissing(last) {
  const items = [...last.matchAll(/^- (.+?) \(pp?\. (\d+)(?:–(\d+))?\)/gm)];
  return items.map(([, t, a, b = a]) => `## ${t} (pp. ${a}–${b})\n**Definition:** (mock, filled by coverage check) ${t}.`).join('\n\n');
}

/** Summary-style prompts: pick a few sentences from the <document>/<notes> block. */
function fakeSummary(last) {
  if (/Task: some topics were missing/.test(last)) return fakeMissing(last);
  if (/TOPIC OUTLINE/.test(last)) {
    const mode = /EXAM REVISION/.test(last) ? 'exam' : 'detailed';
    return fakeOutlinedNotes(last, mode);
  }
  const body = last.match(/<(document|notes)>\n?([\s\S]*?)<\/\1>/)?.[2] ?? '';
  const sentences = body
    .replace(/\[pp?\. [^\]]+\]/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x.length > 30);
  const picks = [...new Set(sentences)].slice(0, 5);
  return `**(mock provider)** Summary:\n\n${picks.map((x) => `- ${x}`).join('\n') || '- (no text)'}`;
}

/** Document-wide mode: one heading per source + a highlighted code sample, to exercise the UI. */
function fakeDocumentAnswer(last) {
  const sources = parseSources(last).slice(0, 4);
  const sections = sources.map((s, i) => `## Topic ${i + 1}\n${s.sentences[0] ?? '(no text)'} [${s.tag}]`);
  return `**(mock provider, document-wide)** Here is a walk-through of your notes:\n\n${sections.join('\n\n')}\n\n\`\`\`js\n// (mock) example code block\nasync function load(url) {\n  const res = await fetch(url); // waits for the response\n  return res.json();\n}\n\`\`\``;
}

function fakeAnswer(messages) {
  const last = messages.at(-1)?.content ?? '';
  if (/about their notes as a whole/.test(last)) return fakeDocumentAnswer(last);
  if (/<(document|notes)>/.test(last)) return fakeSummary(last);
  const sources = [...last.matchAll(/^\[S(\d+)\][^\n]*\n([\s\S]*?)(?=\n\[S\d+\] |\n<\/sources>|(?![\s\S]))/gm)];
  if (!sources.length) return '**(mock provider)** Your notes don\'t cover this directly.\n\n**Beyond your notes:** here is a general explanation (mock).';
  const lines = sources.slice(0, 3).map(([, n, text]) => {
    return `- ${firstSentence(text)} [S${n}]`;
  });
  return `**(mock provider)** Here is what your notes say:\n\n${lines.join('\n')}`;
}

function parseSources(last) {
  return [...last.matchAll(/^\[S(\d+)\][^\n]*\n([\s\S]*?)(?=\n\[S\d+\] |\n<\/sources>|(?![\s\S]))/gm)].map(([, n, text]) => ({
    tag: `S${n}`,
    sentences: text
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 25),
  }));
}

/** Structured output for questions/quiz prompts, built from source sentences. */
function fakeJSON(name, last) {
  if (name === 'outline') return JSON.stringify(fakeOutline(last));
  if (name === 'intent') {
    const msg = last.match(/Message: ([\s\S]*?)\n/)?.[1] ?? '';
    return JSON.stringify({ intent: /notes|lecture|everything|whole|all/i.test(msg) ? 'document' : 'lookup' });
  }
  const count = Number(last.match(/Write exactly (\d+)/)?.[1] ?? 3);
  const sources = parseSources(last).filter((s) => s.sentences.length);
  const pool = sources.flatMap((s) => s.sentences.map((sentence) => ({ tag: s.tag, sentence })));
  const unique = [...new Map(pool.map((p) => [p.sentence, p])).values()];
  // Skip past sentences already used by questions listed under "Do not repeat".
  const offset = (last.match(/Do not repeat[\s\S]*?\n((?:- .*\n?)+)/)?.[1].split('\n').filter(Boolean).length ?? 0);
  const pick = (i) => unique[(i + offset) % Math.max(1, unique.length)] ?? { tag: 'S1', sentence: 'No text.' };
  const lead = (x) => x.split(' ').slice(0, 6).join(' ');
  const questions = Array.from({ length: count }, (_, i) => {
    const p = pick(i);
    if (name === 'questions') {
      return {
        question: `(mock) Q${i + offset + 1}: What do your notes say about "${lead(p.sentence)}…"?`,
        answer: p.sentence,
        markingPoints: [`States: ${lead(p.sentence)}…`],
        sourceTag: p.tag,
        verified: true,
      };
    }
    const distractors = unique.filter((u) => u.sentence !== p.sentence).slice(i, i + 3).map((u) => u.sentence);
    while (distractors.length < 3) distractors.push(`(mock) Not stated in the notes #${distractors.length + 1}`);
    return {
      question: `(mock) Q${i + 1}: Which statement appears in your notes?`,
      options: [p.sentence, ...distractors],
      correctIndex: 0,
      difficulty: ['easy', 'medium', 'hard'][i % 3],
      explanation: `The notes state: "${p.sentence}"`,
      sourceTag: p.tag,
      verified: true,
    };
  });
  return JSON.stringify({ questions });
}

export const mockChat = {
  name: 'mock',
  model: () => 'mock',
  local: true, // no network, no billing

  async generate({ messages, json, image }) {
    if (image) return { text: '# Mock transcription\n\nPhotosynthesis converts light energy into chemical energy stored in glucose.', finishReason: 'stop' };
    if (json) return { text: fakeJSON(json.name, messages.at(-1)?.content ?? ''), finishReason: 'stop' };
    return { text: fakeAnswer(messages), finishReason: 'stop' };
  },

  async startStream({ messages, signal }) {
    const words = fakeAnswer(messages).split(/(?<=\s)/);
    return (async function* () {
      for (const w of words) {
        if (signal?.aborted) return;
        await sleep(Number(process.env.MOCK_STREAM_DELAY_MS) || 12); // dev/test knob: slow streams to exercise Stop
        yield { type: 'text', text: w };
      }
      yield { type: 'finish', finishReason: 'stop' };
    })();
  },
};
