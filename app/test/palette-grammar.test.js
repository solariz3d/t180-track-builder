// palette-grammar.test.js: node --test app/test/palette-grammar.test.js. The palette shows what usually comes next
// (src/doc/grammar.js on the measured library's transitions, vocab.js GRAMMAR), as a hint that refuses nothing.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./palette-fakedom.js');
const { createShell } = require('../shell.js');
const { paletteModel, renderPalette } = require('../palette/palette.js');
const { GRAMMAR } = require('../../src/doc/vocab.js');
const D = require('../../src/doc/index.js');

const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib, saveAutosave: async () => {}, openAutosave: async () => null, clearAutosave: async () => {} }; };
const noop = new Proxy({}, { get: () => () => {} });

async function drawn(prep) {
  const restore = fake.install();
  try {
    const s = await createShell({ storage: mem() });
    if (prep) await prep(s);
    const root = new fake.Element('aside');
    renderPalette(root, paletteModel(s.getState(), s.pickers()), noop);
    return { s, root };
  } finally { restore(); }
}
const top3 = (cls) => GRAMMAR[cls].slice(0, 3).map((x) => x.to);
const NO_GRAMMAR = 'src/doc/corpus.json has no transitions yet (E, D182), so there is no grammar to suggest from';

test('with no grammar in the corpus the palette shows no hint, and says nothing it cannot back', async (t) => {
  if (GRAMMAR) return t.skip('the corpus has a grammar');
  assert.equal((await drawn((s) => { s.place('turn'); })).root.querySelector('.next'), null);
});

test('after a turn, the palette names the three words the library most often puts next, and marks their buttons', async (t) => {
  if (!GRAMMAR) return t.skip(NO_GRAMMAR);
  const { root } = await drawn((s) => { s.place('turn'); });
  const hint = root.querySelector('.next');
  assert.ok(hint, 'a hint is shown');
  assert.match(hint.textContent, /^Usually next after a turn: /);
  for (const w of top3('turn')) assert.ok(hint.textContent.includes(`${w} (`), `${w} in "${hint.textContent}"`);
  const marked = root.querySelectorAll('.suggested').map((b) => b.textContent);
  assert.deepEqual(marked.sort(), top3('turn').slice().sort());
});

test('an empty track and a closed loop show no hint', async () => {
  assert.equal((await drawn()).root.querySelector('.next'), null);
  const { s } = await drawn((sh) => { sh.place('turn'); });
  const closed = { ...D.appendWord(D.createDoc('c'), 'turn'), closed: true };
  const m = paletteModel({ ...s.getState(), history: { past: [], future: [], present: closed } }, s.pickers());
  assert.deepEqual(m.next.suggestions, []);
});

test('the hint refuses nothing: every word button stays enabled, suggested or not', async () => {
  const { root } = await drawn((s) => { s.place('straight'); });
  const words = root.querySelectorAll('.piece').filter((b) => b.className.includes('builtin'));
  assert.ok(words.length >= 7);
  assert.ok(words.every((b) => !b.hasAttribute('disabled')));
});
