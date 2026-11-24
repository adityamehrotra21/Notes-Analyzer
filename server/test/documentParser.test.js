// Unit tests for upload parsing and email checks:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { detectFormat, extractDocument, pagesNeedingVision, unsupportedReason } from '../src/services/documentParser.js';
import { domainAcceptsMail, isValidEmailFormat, suggestEmail } from '../src/utils/email.js';

const zip = (files) => { const z = new JSZip(); for (const [k, v] of Object.entries(files)) z.file(k, v); return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }); };
const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://x/${type}" Target="${target}"/>`;

test('docx: paragraphs, entities, tabs', async () => {
  const b = await zip({ 'word/document.xml': '<w:body><w:p><w:r><w:t>Cells &amp; tissues</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Mito </w:t></w:r><w:r><w:t>chondria</w:t></w:r></w:p></w:body>' });
  const { pages } = await extractDocument(b, 'a.docx');
  assert.equal(pages[0].text, 'Cells & tissues\n\nMito chondria');
});

test('pptx: presentation order (not file order) and speaker notes', async () => {
  const slide = (t) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
  const b = await zip({
    'ppt/presentation.xml': '<p:sldIdLst><p:sldId id="1" r:id="rId2"/><p:sldId id="2" r:id="rId1"/></p:sldIdLst>',
    'ppt/_rels/presentation.xml.rels': `<Relationships>${rel('rId1', 'slide', 'slides/slide1.xml')}${rel('rId2', 'slide', 'slides/slide2.xml')}</Relationships>`,
    'ppt/slides/slide1.xml': slide('Second'),
    'ppt/slides/slide2.xml': slide('First'),
    'ppt/slides/_rels/slide2.xml.rels': `<Relationships>${rel('rId1', 'notesSlide', '../notesSlides/n1.xml')}</Relationships>`,
    'ppt/notesSlides/n1.xml': '<a:p><a:r><a:t>Say this</a:t></a:r></a:p><a:p><a:fld><a:t>1</a:t></a:fld></a:p>',
  });
  const { pageCount, pages } = await extractDocument(b, 'a.pptx');
  assert.equal(pageCount, 2);
  assert.equal(pages[0].text, 'First\n\nSpeaker notes: Say this');
  assert.equal(pages[1].text, 'Second');
});

test('xlsx: shared strings, numbers, sheet names', async () => {
  const b = await zip({
    'xl/workbook.xml': '<sheets><sheet name="Marks" sheetId="1" r:id="rId1"/></sheets>',
    'xl/_rels/workbook.xml.rels': `<Relationships>${rel('rId1', 'worksheet', 'worksheets/sheet1.xml')}</Relationships>`,
    'xl/sharedStrings.xml': '<sst><si><t>Physics</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>91</v></c></row></sheetData>',
  });
  const { pages } = await extractDocument(b, 'a.xlsx');
  assert.equal(pages[0].text, 'Sheet: Marks\n\nPhysics | 91');
});

test('format comes from bytes: renamed files are refused', () => {
  assert.equal(detectFormat(Buffer.from('not a zip'), 'a.docx'), null);
  assert.equal(detectFormat(Buffer.from('hello'), 'a.png'), null);
  assert.equal(detectFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'photo.jpeg'), 'jpg');
  assert.equal(detectFormat(Buffer.from([0, 1, 2, 0xff]), 'a.txt'), null);
  assert.equal(detectFormat(Buffer.from('plain notes'), 'a.txt'), 'txt');
});

test('old Office and unknown types get a clear reason', () => {
  assert.match(unsupportedReason('a.doc'), /\.docx/);
  assert.match(unsupportedReason('a.exe'), /unsupported/);
  assert.equal(unsupportedReason('A.PPTX'), null);
});

test('email format', () => {
  for (const e of ['a@gmail.com', 'first.last+tag@sub.uni.ac.in', "o'neil@x.io"]) assert.ok(isValidEmailFormat(e), e);
  for (const e of ['a', 'a@', '@b.com', 'a@b', 'a@b.c', 'a..b@c.com', '.a@c.com', 'a.@c.com', 'a@-b.com', 'a@b-.com', 'a b@c.com', 'a@b@c.com', 'a@b..com', 'a@b.123']) assert.ok(!isValidEmailFormat(e), e);
});

test('email typo suggestion', () => {
  assert.equal(suggestEmail('me@gmial.com'), 'me@gmail.com');
  assert.equal(suggestEmail('me@gmail.com'), null);
});

test('domain check: MX, null MX, no domain, A fallback, DNS outage', async () => {
  const fail = (code) => async () => { throw Object.assign(new Error(code), { code }); };
  const r = (o) => ({ resolveMx: fail('ENODATA'), resolve4: fail('ENODATA'), resolve6: fail('ENODATA'), ...o });
  assert.equal(await domainAcceptsMail('x.com', r({ resolveMx: async () => [{ exchange: 'mx.x.com', priority: 1 }] })), true);
  assert.equal(await domainAcceptsMail('x.com', r({ resolveMx: async () => [{ exchange: '.', priority: 0 }] })), false);
  assert.equal(await domainAcceptsMail('x.com', r({ resolveMx: fail('ENOTFOUND') })), false);
  assert.equal(await domainAcceptsMail('x.com', r({ resolve4: async () => ['1.2.3.4'] })), true);
  assert.equal(await domainAcceptsMail('x.com', r()), false);
  assert.equal(await domainAcceptsMail('x.com', r({ resolveMx: fail('ETIMEOUT') })), true);
});

test('vision only for visual pages with little text', async () => {
  const pages = [{ page: 1, text: 'Fig 1' }, { page: 2, text: 'x'.repeat(2000) }, { page: 3, text: '' }, { page: 4, text: 'Plain short page' }];
  assert.deepEqual(pagesNeedingVision({ format: 'pdf', pages, graphics: new Set([1, 2, 3]) }), [1, 3]);
  assert.deepEqual(pagesNeedingVision({ format: 'png', pages: [{ page: 1, text: '' }], graphics: new Set([1]) }), [1]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const b = await zip({
    'ppt/presentation.xml': '<p:sldId id="1" r:id="rId1"/>',
    'ppt/_rels/presentation.xml.rels': `<Relationships>${rel('rId1', 'slide', 'slides/slide1.xml')}</Relationships>`,
    'ppt/slides/slide1.xml': '<a:p><a:r><a:t>Cycle</a:t></a:r></a:p>',
    'ppt/slides/_rels/slide1.xml.rels': `<Relationships>${rel('rId1', 'image', '../media/a.emf')}${rel('rId2', 'image', '../media/b.png')}</Relationships>`,
    'ppt/media/a.emf': 'x',
    'ppt/media/b.png': png,
  });
  const ex = await extractDocument(b, 'a.pptx');
  assert.deepEqual(pagesNeedingVision(ex), [1]);
  assert.equal((await ex.loadVisual(1)).mime, 'image/png'); // EMF is skipped: the vision model can't read it
});
