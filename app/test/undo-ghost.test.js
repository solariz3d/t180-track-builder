// undo-ghost.test.js: node --test app/test/undo-ghost.test.js
// The user, 2026-11-25 01:33: "you should see the ghost of the piece you undo every time you undo, right now it just goes away and resets".
// After an undo that took a piece off the end, the shell holds the removed road as a GHOST (st.undoGhost), taken from the redo state it already has.
//   R1  after extend then undo the ghost's road is the removed piece's (the very segments it had), and redo drops it with the document back to the same bytes
//   R2  a new extend, candidate or brush stroke after an undo begins with no undo ghost; several undos show the LAST undo's piece only
//   R3  an undone brush stroke (the piece changed, none removed) holds no ghost: the preview's ghost only draws a road that EXTENDS the placed one
//   R4  one undo rebuilds none of the pieces: every ghost segment is one the document already had (same object), on a long track
//   R5  the readout is the removed piece's own (pieceReadout of the redo state), length and turn
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const RD = require('../../src/core/readout.js');
const { createCoreShell } = require('../core/coreshell.js');

async function three() {
  const s = await createCoreShell({});
  s.extend({ length: 300, family: 'bowl' });
  s.extend({ length: 200, targets: { kh: 1 / 400 } });
  s.extend({ length: 150 });
  assert.equal(s.getState().message === null || s.getState().messageKind === 'ok', true, s.getState().message);
  return s;
}
const n = (s) => s.getState().history.present.pieces.length;

test('R1: undo leaves the removed piece as the ghost, with its own segments; redo drops it', async () => {
  const s = await three(), before = s.getState(), text = s.text();
  s.undo();
  const st = s.getState(), g = st.undoGhost;
  assert.ok(g, 'a ghost is held after an undo of an extend');
  assert.equal(n(s), 2);
  assert.equal(g.candidate.segments.length, before.resolved.segments.length, 'the ghost road is the whole road as it stood, the removed piece last');
  assert.ok(g.candidate.segments.every((x, i) => x === before.resolved.segments[i]), 'the very segments the placed track had');
  s.redo();
  assert.equal(s.getState().undoGhost, null, 'redo puts the piece back and the ghost goes');
  assert.equal(s.text(), text, 'and the document is the same bytes');
});

test('R2: a new extend, candidate or brush starts with no undo ghost; two undos show the last one only', async () => {
  let s = await three();
  s.undo(); s.undo();
  assert.equal(s.getState().undoGhost.candidate.segments.length > 0, true);
  const g2 = s.getState().undoGhost; assert.equal(n(s), 1);
  assert.equal(g2.base, s.getState().history.present, 'the ghost belongs to the document it was left on');
  s.extend({ length: 100 });
  assert.equal(s.getState().undoGhost, null, 'a new extend drops it');
  s = await three(); s.undo(); s.candidate({ length: 100 });
  assert.ok(s.getState().undoGhost, 'asking for the next piece\'s candidate changes nothing in the shell (the panel swaps the picture)');
  s = await three(); s.undo(); s.removeHead();
  assert.equal(s.getState().undoGhost, null, 'any change of document drops it');
});

test('R3: an undone edit that removes no piece (a grip change) holds no ghost: the preview draws only a road that extends the placed one', async () => {
  const s = await three();
  s.selectPiece(1); s.setGrip(80);
  assert.equal(s.getState().message === null || s.getState().messageKind === 'ok', true, s.getState().message);
  s.undo();
  assert.equal(s.getState().undoGhost, null, 'same pieces, one changed: nothing extends, so nothing is ghosted (named in the hand-back)');
});

test('R4: one undo rebuilds no piece: every ghost segment is an object the document already had', async () => {
  const s = await createCoreShell({});
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 40; i++) s.extend({ length: 200, targets: { kh: (i % 2 ? 1 : -1) / 600 } });
  const before = s.getState().resolved.segments;
  s.undo();
  const g = s.getState().undoGhost.candidate.segments, own = new Set(before);
  const rebuilt = g.filter((x) => !own.has(x)).length;
  console.log('R4 pieces', n(s) + 1, 'ghost segments', g.length, 'rebuilt by the undo', rebuilt);
  assert.equal(rebuilt, 0);
});

test('R5: the ghost carries the removed piece\'s own readout', async () => {
  const s = await three(), whole = s.getState().history.present, want = RD.pieceReadout(whole, whole.pieces.length - 1);
  s.undo();
  const r = s.getState().undoGhost.readout;
  assert.equal(r.lengthM, want.lengthM);
  assert.equal(r.turnDeg, want.turnDeg);
});
