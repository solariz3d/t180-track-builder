// core-leveltail.test.js: node --test app/test/core-leveltail.test.js
// LEVEL END OF A PIECE, in the app (the user, 2026-11-09: "the level feature should work at the end of any piece to flatten it to level"; "the level shouldnt level
// the whole turn, just the ending of the piece"; his pick for the command: the Build menu, under Level and To floor). Build ▸ Level end of <piece> levels the
// selected piece's end over its default tail (src/core/level.js levelEnd), and the tail then shows on the track as a span whose start is dragged earlier or
// later (app/core/leveltail.js). What cannot be seen by looking, tested here on the shell and the layer's pure half, with his track (test/fixtures/level-end-2026-11-09.t180track):
//   1  with one piece selected, the shell levels its end over the default tail in ONE undo step, keeps it selected, and reports the span (its id, tail, start, end)
//   2  with no piece, or more than one, selected it is refused with the reason as the message, and nothing changes
//   3  a drag of the span's start re-solves from the track as it was before the level (never from the last step), and the whole drag is ONE undo step back to it
//   4  a drag to a tail too short is refused with the reason (the length that works) as the message, and the track stays at the last tail that worked
//   5  the span is gone once the track changes another way (another edit, or an undo)
//   6  the layer's pure half: a station on the piece gives the tail from there to its end, clamped to the piece; the mark is a line across the road at the span's start
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { createCoreShell } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const LV = require('../../src/core/level.js');
const LT = require('../core/leveltail.js');

const HIS = D.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', 'level-end-2026-11-09.t180track'), 'utf8'));
async function his() { const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.adopt(HIS); return s; }
const present = (s) => s.getState().history.present;

test('row 1: with one piece selected, its end is levelled over the default tail in one undo step, it stays selected, and the span is reported', async () => {
  const s = await his(); s.selectPiece(2);
  s.levelEndSelected();
  assert.equal(s.getState().message, null, 'no refusal');
  assert.deepEqual(present(s).pieces, LV.levelEnd(HIS, 2).pieces, 'the core\'s level end over its default tail');
  assert.deepEqual(s.getState().selection && s.getState().selection.ids, ['p3'], 'still selected');
  const t = s.levelTailInfo();
  assert.equal(t.id, 'p3'); assert.equal(t.tailM, LV.levelEndTail(HIS, 2));
  assert.ok(Math.abs(t.s1 - 3000) < 1e-6 && Math.abs(t.s0 - 2000) < 1e-6 && Math.abs(t.from - (3000 - t.tailM)) < 1e-6, `the span ${t.from}..${t.s1} on the piece ${t.s0}..${t.s1}`);
  s.undo(); assert.deepEqual(present(s).pieces, HIS.pieces, 'one undo step back to his track');
});

test('row 2: with no piece, or more than one, selected it is refused with the reason as the message, and nothing changes', async () => {
  const s = await his();
  s.levelEndSelected();
  assert.match(s.getState().message || '', /select one road piece/, `the reason: ${s.getState().message}`);
  assert.equal(present(s), s.getState().history.present); assert.deepEqual(present(s).pieces, HIS.pieces);
  s.selectPiece(1); s.selectPiece(2, { extend: true });
  s.levelEndSelected();
  assert.match(s.getState().message || '', /select one road piece/, 'two pieces: the same reason');
  assert.deepEqual(present(s).pieces, HIS.pieces);
});

test('row 3: a drag of the span re-solves from the track before the level, and the whole drag is one undo step', async () => {
  const s = await his(); s.selectPiece(2); s.levelEndSelected();
  s.beginLevelTailDrag();
  for (const T of [300, 500, 200]) s.levelTailDragTo(T);
  s.endLevelTailDrag();
  assert.deepEqual(present(s).pieces, LV.levelEnd(HIS, 2, { tailM: 200 }).pieces, 'the last tail, solved from his track (not from the 500 m step)');
  assert.equal(s.levelTailInfo().tailM, 200);
  s.undo(); assert.deepEqual(present(s).pieces, LV.levelEnd(HIS, 2).pieces, 'one undo: the default tail again');
  s.undo(); assert.deepEqual(present(s).pieces, HIS.pieces, 'and one more: his track');
});

test('row 4: a drag to a tail too short says why and keeps the last tail that worked', async () => {
  const s = await his(); s.selectPiece(2); s.levelEndSelected();
  const T0 = LV.levelEndTail(HIS, 2);
  s.beginLevelTailDrag(); s.levelTailDragTo(300); s.levelTailDragTo(5);
  assert.match(s.getState().message || '', new RegExp(`at least ${T0} m`), `the reason names the length that works: ${s.getState().message}`);
  assert.deepEqual(present(s).pieces, LV.levelEnd(HIS, 2, { tailM: 300 }).pieces, 'the track stays at the last tail that worked');
  assert.equal(s.levelTailInfo().tailM, 300);
  s.levelTailDragTo(250); assert.equal(s.getState().message, null, 'a tail that works clears the reason');
  s.endLevelTailDrag();
});

test('row 5: the span is gone once the track changes another way', async () => {
  const s = await his(); s.selectPiece(2); s.levelEndSelected();
  assert.ok(s.levelTailInfo());
  s.extend({ length: 100 }); assert.equal(s.levelTailInfo(), null, 'another edit');
  const t = await his(); t.selectPiece(2); t.levelEndSelected(); t.undo(); assert.equal(t.levelTailInfo(), null, 'an undo');
});

test('row 6: the layer\'s pure half: the tail from a station, clamped to the piece, and the mark across the road at the span\'s start', async () => {
  const info = { s0: 2000, s1: 3000, from: 2900, tailM: 100 };
  assert.equal(LT.tailAt(info, 2700), 300);
  assert.equal(LT.tailAt(info, 1500), 1000, 'before the piece: the whole piece');
  assert.equal(LT.tailAt(info, 3100), LT.MIN_TAIL_M, 'past its end: the least the drag asks for');
  const s = await his(); s.selectPiece(2); s.levelEndSelected();
  const t = s.levelTailInfo(), m = LT.markOf(t);
  const at = t.path.samples.reduce((a, b) => (Math.abs(b.s - t.from) < Math.abs(a.s - t.from) ? b : a));
  const mid = m.line[0].map((v, k) => (v + m.line[1][k]) / 2), across = m.line[0].map((v, k) => v - m.line[1][k]);
  assert.ok(Math.hypot(...mid.map((v, k) => v - at.pos[k])) < 2.5, 'the mark stands on the road at the span\'s start');
  const sq = Math.abs(across.reduce((a, v, k) => a + v * at.T[k], 0)) / Math.hypot(...across);   // the nearest 2 m station's direction: within a degree on his turning road
  assert.ok(sq < Math.sin(Math.PI / 180), `across the road, square to its direction within a degree (cos ${sq.toExponential(2)})`);
  assert.ok(m.band.length > 10 && m.band.every((p) => p.length === 3), 'the span is a line of points along the road');
});
