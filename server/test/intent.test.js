// Intent heuristics (no API calls):  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicIntent } from '../src/services/intentService.js';

const CASES = {
  document: [
    'explain my notes in detail',
    'Explain the whole lecture',
    'summarise this pdf',
    'teach me everything',
    'give me all the important points',
    'what is this lecture about?',
    'summarize',
    'go through the slides one by one',
  ],
  lookup: [
    'What is a promise?',
    'explain async/await in detail',
    'how does error handling work with try catch?',
    'give an example of Promise.all',
    'difference between callbacks and promises',
    'explain promises',
    'what are the key points about callbacks',
  ],
  ambiguous: ['explain it', 'explain this in simple terms', 'more', 'continue'],
};

for (const [want, questions] of Object.entries(CASES)) {
  test(`heuristic routes to "${want}"`, () => {
    for (const q of questions) assert.equal(heuristicIntent(q), want, JSON.stringify(q));
  });
}
