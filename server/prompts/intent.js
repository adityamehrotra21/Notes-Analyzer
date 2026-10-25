// Fallback intent classifier (gpt-5-nano), used only when the keyword heuristics are unsure.

export const INTENT_SYSTEM_PROMPT = `You route a student's chat message about their study notes.
Reply with JSON only.
- "document": the student wants the WHOLE notes explained, summarised, taught, revised or covered (e.g. "explain my notes", "teach me all of this", "go through everything", "what is this lecture about").
- "lookup": the student asks about a specific concept, fact, term, example or part (e.g. "what is a promise?", "explain async/await in detail", "give an example of try/catch").
If unsure, answer "lookup".`;

export function buildIntentMessage({ question, previousQuestion }) {
  return `${previousQuestion ? `Previous message: ${previousQuestion.slice(0, 300)}\n` : ''}Message: ${question.slice(0, 500)}

IMPORTANT: answer immediately with the JSON object.`;
}
