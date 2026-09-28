// Headless tests for app/markers (D171): the markers panel's logic against A's real shell, and its loading through A's
// webview loader. Run: node --test "app/test/*.test.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createShell } = require('../shell.js');
const { loadCjs } = require('../lib/cjs.js');
const { createMarkersController } = require('../markers/panel.js');
const D = require('../../src/doc/index.js');
const { appendOld } = require('../../test/pre_d182_words.js');

const REPO = path.resolve(__dirname, '..', '..');
const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
const by = (st, n) => st.placed.find((m) => m.name === n);

test('the panel drops the default layout on the first straight long enough, and says what stops it before that', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createMarkersController(shell);
  // named (p-d182-walltests-E): 100 m straights, the pre-D182 default. The measured default straight is 48 m, shorter than
  // the 67.4 m the default grid needs, and this test is about the LAYOUT, not the straight's default length
  shell.adopt(['turn'].reduce((d, w) => appendOld(D, d, w), D.createDoc('t')));
  assert.match(ctl.state.error, /no straight word/);
  shell.adopt(['turn', 'straight', 'straight'].reduce((d, w) => appendOld(D, d, w), D.createDoc('t')));
  assert.deepStrictEqual([ctl.state.error, ctl.state.custom, ctl.state.check.ok], [null, false, true]);
  assert.strictEqual(ctl.state.placed.filter((m) => m.kind === 'grid').length, 4);
});

test('once edited the layout is kept, and its markers ride along when an upstream word is sculpted', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createMarkersController(shell);
  // named (p-d182-walltests-E): 100 m straights, the pre-D182 default. The measured default straight is 48 m, shorter than
  // the 67.4 m the default grid needs, and this test is about the LAYOUT, not the straight's default length
  shell.adopt(['straight', 'straight', 'straight'].reduce((d, w) => appendOld(D, d, w), D.createDoc('t')));
  ctl.edit((l) => { l.grid.pattern = '3-abreast'; l.grid.count = 6; l.grid.colGapM = 5; return l; });
  assert.strictEqual(ctl.state.custom, true);
  const before = by(ctl.state, 'AC_START_5').s;
  shell.beginDrag(); shell.dragTo('w1', { handles: { length: 140 } }); shell.endDrag();   // w1 was 100 m
  assert.ok(Math.abs(by(ctl.state, 'AC_START_5').s - before - 40) < 1e-6);
  assert.strictEqual(ctl.state.check.ok, true);
});

test('a slot edited slot by slot, and an overlap it causes is red in the panel', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createMarkersController(shell);
  for (const w of ['straight', 'straight', 'straight']) shell.place(w);
  ctl.editSlot(1, { backM: 11, u: 2.5 });
  assert.strictEqual(by(ctl.state, 'AC_START_1').u, 2.5);
  assert.ok(ctl.state.check.checks.find((c) => c.id === 'slots').problems.some((p) => /AC_START_1 and AC_START_0 overlap/.test(p)));
  ctl.reset();
  assert.deepStrictEqual([ctl.state.custom, ctl.state.check.ok], [false, true]);
});

test('slot edits accumulate: an edit to a second slot keeps the first', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createMarkersController(shell);
  for (const w of ['straight', 'straight', 'straight']) shell.place(w);
  ctl.editSlot(2, { u: 2 }); ctl.editSlot(3, { u: -2 }); ctl.editSlot(2, { backM: 30 });
  assert.deepStrictEqual([by(ctl.state, 'AC_START_2').u, by(ctl.state, 'AC_START_2').backM, by(ctl.state, 'AC_START_3').u], [2, 30, -2]);
});

test('removing the word the layout sits on turns the panel red (anchors), not silent', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createMarkersController(shell);
  for (const w of ['straight', 'straight']) shell.place(w);
  ctl.edit((l) => l);                       // keep it
  const word = ctl.state.layout.line.word;
  shell.removeHead(); shell.removeHead(); shell.place('straight'); shell.place('straight');
  if (ctl.state.layout.line.word === word && !shell.getState().history.present.words.some((w) => w.id === word)) assert.ok(!ctl.state.check.ok && ctl.state.check.checks.find((c) => c.id === 'anchors').problems.length);
  else assert.fail(`the anchor word ${word} was expected to be gone`);
});

test('the markers panel loads through A\'s webview loader and exports mount(root, shell)', async () => {
  const m = await loadCjs('app/markers/index.js', async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));
  assert.strictEqual(typeof m.mount, 'function');
});
