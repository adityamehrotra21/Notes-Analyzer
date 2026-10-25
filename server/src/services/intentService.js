// Classify a chat message as "lookup" (specific question -> vector retrieval) or "document"
// (whole-notes request -> full document / summary). Keyword heuristics first; gpt-5-nano only when
// the message is ambiguous (e.g. "explain it", "teach me this").
import { z } from 'zod';
import logger from '../utils/logger.js';
import { INTENT_SYSTEM_PROMPT, buildIntentMessage } from '../../prompts/intent.js';
import { generateJSON } from './llmService.js';

const log = logger.child({ module: 'intent' });

const DOC_NOUN = '(?:notes?|document|doc|pdf|lecture|chapter|slides?|deck|file|material|content|syllabus|unit|module|course)';
const DOCUMENT_WIDE = [
  // "explain my notes", "summarise the whole lecture", "teach me this chapter", "go through the slides"
  new RegExp(`\\b(?:explain|summari[sz]e|summary of|teach(?: me)?|go (?:through|over)|walk me through|break down|overview of|recap|revise|cover|study)\\b[^?.!]{0,40}\\b(?:my|the|these|this|whole|entire|all|full)\\b[^?.!]{0,15}\\b${DOC_NOUN}\\b`, 'i'),
  /\b(?:all|every)\s+(?:the\s+)?(?:main\s+|key\s+|important\s+)?(?:points?|topics?|concepts?|sections?|details?|parts?)\b/i,
  /\b(?:everything|whole thing|the entire thing|from (?:the )?(?:start|beginning) to (?:the )?end|cover to cover)\b/i,
  new RegExp(`\\bwhat (?:is|are) (?:this|these|the|my) ${DOC_NOUN} about\\b`, 'i'),
  new RegExp(`^(?:please\\s+)?(?:summari[sz]e|recap|overview)(?:\\s+(?:it|this|them|please))?[.!?]*$`, 'i'),
];
// Messages that name no topic ("explain it", "more", "continue") could mean either; the classifier decides.
const NO_TOPIC = /^(?:more|continue|go on|keep going|and\??|next|again|elaborate|go deeper)[.!?]*$/i;
const PRONOUN_ONLY = /^(?:please\s+)?(?:explain|teach me|describe|elaborate|detail)(?:\s+(?:it|this|that|them|these|those|more|again|further|in (?:detail|depth|simple terms)|simply|briefly))*[.!?]*$/i;

/** Heuristic only. Returns 'document' | 'lookup' | 'ambiguous'. */
export function heuristicIntent(question) {
  const q = question.trim();
  if (DOCUMENT_WIDE.some((re) => re.test(q))) return 'document';
  if (PRONOUN_ONLY.test(q) || NO_TOPIC.test(q)) return 'ambiguous';
  return 'lookup';
}

const schema = z.object({ intent: z.enum(['lookup', 'document']) });

/**
 * @returns {Promise<{ intent: 'lookup'|'document', method: 'heuristic'|'llm'|'fallback' }>}
 */
export async function classifyIntent({ question, history = [] }) {
  const h = heuristicIntent(question);
  if (h !== 'ambiguous') {
    log.info('intent', { intent: h, method: 'heuristic' });
    return { intent: h, method: 'heuristic' };
  }
  const previousQuestion = [...history].reverse().find((m) => m.role === 'user')?.content;
  try {
    const out = await generateJSON({
      step: 'classify',
      tier: 'cheap',
      name: 'intent',
      schema,
      system: INTENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildIntentMessage({ question, previousQuestion }) }],
      label: 'intent classify',
    });
    log.info('intent', { intent: out.intent, method: 'llm' });
    return { intent: out.intent, method: 'llm' };
  } catch (err) {
    // Never block chat on the classifier (including a budget refusal for this tiny call).
    log.warn('intent classifier failed; defaulting to lookup', { reason: err.message });
    return { intent: 'lookup', method: 'fallback' };
  }
}
