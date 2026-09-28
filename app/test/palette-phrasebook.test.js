'use strict';
const test = require('node:test'), assert = require('node:assert');
const { createShell } = require('../shell.js');
const L = require('../../src/doc/library.js');
const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
test('the palette lists the starter phrases, and placing one through the shell is one undo step with all its words', async () => {
  const s = await createShell({ storage: mem() });
  const names = s.palette().map((p) => p.name);
  for (const n of ['sakura flow', 'bowl hairpin', 'S', 'spiral climb']) assert.ok(names.includes(n), n);
  s.place('straight');
  const before = s.getState().history.past.length;
  s.place('sakura flow');
  const st = s.getState();
  assert.strictEqual(st.history.past.length, before + 1);
  assert.deepStrictEqual(st.history.present.words[1].words.map((w) => w.word), ['sweep', 'turn', 'tight', 'turn', 'sweep']);
  assert.strictEqual(st.resolveError, null);
  s.undo();
  assert.strictEqual(s.getState().history.present.words.length, 1);
});
test('a user piece may not take a starter phrase name', () => {
  const D = require('../../src/doc/index.js');
  const d = D.appendWord(D.createDoc('x'), 'straight');
  assert.throws(() => L.savePiece(L.builtinLibrary(), { name: 'S', doc: d, ids: ['w1'] }), /NAME_IS_BUILTIN/);
});
test('a saved library still holds only the user pieces (the phrasebook comes from the program)', () => {
  const lib = L.builtinLibrary();
  assert.ok(!/sakura flow/.test(L.serializeLibrary(lib)));
});
