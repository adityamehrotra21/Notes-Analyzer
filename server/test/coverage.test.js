// Coverage check (no API calls):  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCoverage, insertSections, normTitle } from '../src/services/coverage.js';

const outline = {
  topics: [
    { title: 'Asynchronous programming' },
    { title: 'Callbacks' },
    { title: 'Promises' },
    { title: 'The await keyword' },
    { title: 'Error handling with try/catch' },
  ],
};

test('normalises numbering, page ranges and markup', () => {
  assert.equal(normTitle('## 3. **Promises** (pp. 6–7)'), 'promises');
});

test('detailed: every topic needs its own heading', () => {
  const md = `# Notes\n\n## 1. Asynchronous Programming (p. 4)\n...\n## Callbacks (pp. 5–6)\n...\n## Promises (p. 7)\n...\n## Await keyword (p. 9)\n...\n## Key takeaways\n- x`;
  const r = checkCoverage(outline, md, 'detailed');
  assert.deepEqual(r, { total: 5, covered: 4, missing: ['Error handling with try/catch'] });
});

test('a topic mentioned only in body text is NOT covered', () => {
  const md = `## Callbacks\nPromises are mentioned here but have no section.`;
  assert.ok(checkCoverage(outline, md, 'detailed').missing.includes('Promises'));
});

test('exam checklist alone does not count as coverage', () => {
  const md = `## Must-know checklist\n- [ ] Promises (p. 7)\n- [ ] Callbacks (p. 5)\n## Callbacks\n...`;
  const r = checkCoverage(outline, md, 'exam');
  assert.ok(r.missing.includes('Promises'));
  assert.ok(!r.missing.includes('Callbacks'));
});

test('bullet mode accepts bold topic labels', () => {
  const md = `**Asynchronous programming (p. 4)**\n- a\n**Callbacks (p. 5)**\n- b\n**Promises**\n- c\n**The await keyword**\n- d\n- **Error handling with try/catch** (p. 12)\n- e`;
  assert.equal(checkCoverage(outline, md, 'bullet').covered, 5);
});

test('missing sections are inserted before Key takeaways', () => {
  const md = '# T\n## A\n...\n## Key takeaways\n- k';
  const out = insertSections(md, '## B\n...');
  assert.ok(out.indexOf('## B') < out.indexOf('## Key takeaways'));
  assert.ok(insertSections('# T\n## A', '## B').trimEnd().endsWith('## B'), 'appended when there is no closing section');
});
