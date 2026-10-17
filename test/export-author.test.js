// export-author.test.js: node --test test/export-author.test.js. D365: the export's author is the person's name when one is given,
// else exactly today's "t180-track-builder"; the builder is credited either way (its tag, and the description as today). Both paths:
// the single export (exportTrack) and the layouts export (src/export/layouts.js exportBuilt). Temp folders only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/doc/index.js');
const { buildExport, exportTrack, ExportError } = require('../src/export/fromwords.js');
const L = require('../src/export/layouts.js');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-author-')); made.push(d); return d; };
const kmh = (v) => v / 3.6;
const TIGHT90 = { turn: Math.PI / 2, length: (Math.PI / 2) * 120 / 0.7 };
function stadium(name, straightM) {
  let d = D.createDoc(name);
  const S = { font: 'flat', handles: { length: straightM, width: 20 } }, T = { font: 'flat', handles: { ...TIGHT90, width: 20 } };
  for (const [w, o] of [['straight', S], ['tight', T], ['tight', T], ['straight', S], ['tight', T], ['tight', T]]) d = D.appendWord(d, w, { ...o, speed: kmh(200) });
  return D.checkDoc({ ...d, closed: true });
}
const DOC = stadium('Authored', 400);
const ui = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'ui', 'ui_track.json'), 'utf8'));

test('single export: a name set is the author, and the builder is still credited (its tag, the description)', () => {
  const r = exportTrack(DOC, { outDir: tmp(), author: '  Jane Doe  ' }), j = ui(r.folders[0].dir);
  assert.equal(j.author, 'Jane Doe', 'trimmed');
  assert.ok(j.tags.includes('t180-track-builder'), `the credit tag: ${j.tags}`);
  assert.ok(j.tags.includes('t180') && j.tags.includes('original'), 'today\'s tags stay');
  assert.equal(j.description, 'Built from words by t180-track-builder.', "the description still credits the builder (a word document's own sentence, as today)");
});

test('single export: no name, a blank one or a non-string gives exactly today\'s author', () => {
  for (const author of [undefined, null, '', '   ']) {
    const j = ui(exportTrack(DOC, { outDir: tmp(), ...(author === undefined ? {} : { author }) }).folders[0].dir);
    assert.equal(j.author, 't180-track-builder', `author ${JSON.stringify(author)}`);
    assert.ok(j.tags.includes('t180-track-builder'));
  }
  // the bytes of the author field, as today's export writes them
  const text = fs.readFileSync(path.join(exportTrack(DOC, { outDir: tmp() }).folders[0].dir, 'ui', 'ui_track.json'), 'utf8');
  assert.match(text, /\n  "author": "t180-track-builder",\n/);
});

test('a name longer than 64 characters, or one that is not text, is refused by name before anything is written', () => {
  const out = tmp();
  assert.throws(() => exportTrack(DOC, { outDir: out, author: 'x'.repeat(65) }), (e) => e instanceof ExportError && e.code === 'BAD_AUTHOR');
  assert.throws(() => exportTrack(DOC, { outDir: out, author: 42 }), (e) => e instanceof ExportError && e.code === 'BAD_AUTHOR');
  assert.deepEqual(fs.readdirSync(out), []);
  assert.equal(buildExport(DOC, { author: 'x'.repeat(64) }).desc.author, 'x'.repeat(64), '64 is allowed');
});

test('layouts export: each layout carries the author given, with the credit tag; blank keeps today\'s', () => {
  const named = L.exportBuilt([{ layout: 'a', name: 'A', main: true, b: buildExport(DOC, { author: 'Jane Doe' }) }, { layout: 'b', name: 'B', b: buildExport(stadium('Other', 300), { author: 'Jane Doe' }) }], { outDir: tmp(), name: 'Pair' });
  for (const Lid of ['a', 'b']) {
    const j = JSON.parse(fs.readFileSync(path.join(named.dir, 'ui', Lid, 'ui_track.json'), 'utf8'));
    assert.equal(j.author, 'Jane Doe'); assert.ok(j.tags.includes('t180-track-builder'));
  }
  const plain = L.exportBuilt([{ layout: 'a', name: 'A', main: true, b: buildExport(DOC) }], { outDir: tmp(), name: 'Solo' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(plain.dir, 'ui', 'a', 'ui_track.json'), 'utf8')).author, 't180-track-builder');
});
