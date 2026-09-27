// shell-ghost.test.js: node --test app/test/*.test.js
// The ghost of the next piece (the D170 review, item 6: "pick the word, see it ghosted, click to place"). The shell
// gives the preview a CANDIDATE: the resolved track as it would be with the piece placed, built by the same code as
// place(), so the ghost is exactly what a click then builds. Nothing is committed: the history does not move.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShell } = require('../shell.js');
const D = require('../../src/doc/index.js');

const mem = () => { let lib = null; return { saveDoc: async () => {}, openDoc: async () => null, listDocs: async () => [], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };

test('the candidate for a built-in word is exactly the track place() then builds, pickers and all', async () => {
  const s = await createShell({ storage: mem() });
  s.place('straight'); s.setPicker('tempo', 'aurora'); s.setPicker('dir', 'R'); s.setPicker('font', 'half-pipe');
  const c = s.candidate('sweep');
  s.place('sweep');
  assert.deepEqual(c.segments, s.getState().resolved.segments);
});

test('the candidate for one of the user\'s own pieces is what placing it builds', async () => {
  const s = await createShell({ storage: mem() });
  for (const w of ['straight', 'turn', 'tight']) s.place(w);
  s.select('w2', 'w3'); await s.saveSelectionAsPiece('my-bend');
  const c = s.candidate('my-bend');
  s.place('my-bend');
  assert.deepEqual(c.segments, s.getState().resolved.segments);
});

test('asking for a candidate commits nothing: the document, the history and the state stay as they were', async () => {
  const s = await createShell({ storage: mem() });
  s.place('straight');
  const before = s.getState();
  s.candidate('jump'); s.candidate('wall-ride');
  assert.equal(s.getState(), before);
});

test('the candidate for a jump ends on its landing ramp, so the ghost shows where the next piece will start', async () => {
  const s = await createShell({ storage: mem() });
  s.place('straight');
  const c = s.candidate('jump'), last = c.segments[c.segments.length - 1];
  assert.deepEqual([last.word, last.part, last.kind], ['jump', 'land', 'road']);
});

test('a candidate that cannot be built is refused with the model\'s reason, and nothing changes', async () => {
  const s = await createShell({ storage: mem() });
  assert.throws(() => s.candidate('no-such-piece'), (e) => e.code === 'NO_SUCH_PIECE');
});
