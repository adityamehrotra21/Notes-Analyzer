// How retrieved/sampled chunks are shown to the model. Shared by chat, questions and quiz prompts.

/** @param {{ tag: string, filename: string, pages: string, text: string }[]} sources */
export function formatSources(sources) {
  const blocks = sources.map((s) => `[${s.tag}] ${s.filename}, ${s.pages}\n${s.text}`).join('\n\n');
  return `<sources>\n${blocks || '(no sources found)'}\n</sources>`;
}
