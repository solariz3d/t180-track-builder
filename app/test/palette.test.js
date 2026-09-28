// palette.test.js: node --test app/test/*.test.js
// The build palette's model: what it lists, in what groups, and which buttons are live. The DOM half (renderPalette)
// runs only in the webview and is not tested here. Dependency-free.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShell } = require('../shell.js');
const { paletteModel } = require('../palette/palette.js');
const D = require('../../src/doc/index.js');

const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };

test('the palette lists every built-in word, then the starter phrases, then the user\'s own pieces, in three groups', async () => {
  const s = await createShell({ storage: mem() });
  s.place('turn'); s.place('tight'); s.select('w1', 'w2'); await s.saveSelectionAsPiece('my-bend');
  const m = paletteModel(s.getState(), s.pickers());
  assert.deepEqual(m.groups.map((g) => g.title), ['Words', 'Starter phrases', 'My pieces']);
  assert.deepEqual(m.groups[0].items.map((i) => i.name), Object.keys(D.WORDS));
  assert.deepEqual(m.groups[1].items.map((i) => i.name), ['sakura flow', 'S', 'bowl hairpin', 'spiral climb']);   // D180: src/doc/phrasebook.js's order, whose chain is clean
  assert.deepEqual(m.groups[2].items.map((i) => [i.name, i.kind, i.words.join(' ')]), [['my-bend', 'phrase', 'turn tight']]);
});

test('with no saved pieces the last group is present and empty, so the palette does not jump when the first is saved', async () => {
  const s = await createShell({ storage: mem() });
  const m = paletteModel(s.getState(), s.pickers());
  assert.deepEqual(m.groups[2], { title: 'My pieces', items: [] });
});

test('the pickers show every font, tempo and direction, with the current choice', async () => {
  const s = await createShell({ storage: mem() });
  s.setPicker('tempo', 'serpents');
  const m = paletteModel(s.getState(), s.pickers());
  assert.deepEqual(m.pickers.font.options, ['auto', ...Object.keys(D.FONTS)]);
  assert.deepEqual(m.pickers.tempo.options, Object.keys(D.TEMPOS));
  assert.equal(m.pickers.tempo.value, 'serpents');
  assert.deepEqual(m.pickers.dir.options, ['L', 'R']);
});

test('undo, redo and save-as-piece are live only when they can do something', async () => {
  const s = await createShell({ storage: mem() });
  let m = paletteModel(s.getState(), s.pickers());
  assert.deepEqual([m.can.undo, m.can.redo, m.can.saveSelection, m.can.removeHead], [false, false, false, false]);
  s.place('turn');
  m = paletteModel(s.getState(), s.pickers());
  assert.deepEqual([m.can.undo, m.can.redo, m.can.saveSelection, m.can.removeHead], [true, false, false, true]);
  s.undo();
  m = paletteModel(s.getState(), s.pickers());
  assert.deepEqual([m.can.undo, m.can.redo], [false, true]);
  s.redo(); s.select('w1');
  assert.equal(paletteModel(s.getState(), s.pickers()).can.saveSelection, true);
});

test('"Close the loop" is live only for an open track with words on it', async () => {
  const s = await createShell({ storage: mem() });
  assert.equal(paletteModel(s.getState(), s.pickers()).can.closeLoop, false);
  s.place('turn');
  assert.equal(paletteModel(s.getState(), s.pickers()).can.closeLoop, true);
  s.adopt({ ...s.getState().history.present, closed: true });
  assert.equal(paletteModel(s.getState(), s.pickers()).can.closeLoop, false);
});

test('the head is named: the word the next piece will follow, or none on an empty track', async () => {
  const s = await createShell({ storage: mem() });
  assert.equal(paletteModel(s.getState(), s.pickers()).head, null);
  s.place('straight'); s.place('wall-ride');
  assert.deepEqual(paletteModel(s.getState(), s.pickers()).head, { id: 'w2', word: 'wall-ride' });
});

test('the track list shows every placed word in order, and marks the selection', async () => {
  const s = await createShell({ storage: mem() });
  for (const w of ['straight', 'turn', 'tight']) s.place(w);
  s.select('w2', 'w3');
  assert.deepEqual(paletteModel(s.getState(), s.pickers()).track.map((t) => [t.id, t.word, t.selected]), [['w1', 'straight', false], ['w2', 'turn', true], ['w3', 'tight', true]]);
});
