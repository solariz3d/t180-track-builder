// core_gridturn.test.js: node --test test/core_gridturn.test.js
// TURN TO GRID (the keeper, 2026-10-12: "Its hard to get a straight aligned to the grid from a free flowing spiral turn"). Rows:
//   1  offGridDeg / gridTurnDeg: the nearest grid direction, either way; a tie goes the preferred way; on the grid is 0; a step that is not 90, 45 or 15 is refused
//   2  endHeadingDeg is the direction the path really ends in (its last sample's tangent), through turns and a free jump
//   3  after a free-flowing spiral, Turn to grid ends the track on a grid direction (within 0.01°), dead straight, in ONE undo step, at 90, 45 and 15
//   4  a track already on the grid: nothing is placed, and the message says so
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const AD = require('../src/core/adapter.js');
const GT = require('../src/core/gridturn.js');
const { createCoreShell } = require('../app/core/coreshell.js');

const wrap = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
const pathEndDeg = (doc) => { const S = AD.toPath(doc).path.samples, T = S[S.length - 1].T; return (Math.atan2(T[0], T[2]) * 180) / Math.PI; };
async function spiral() {
  const s = await createCoreShell({});
  s.extend({ length: 200, family: 'bowl' });
  for (const [length, kh] of [[300, 1 / 150], [250, 1 / 90], [400, -1 / 200], [180, 1 / 60]]) s.extend({ length, transition: 60, targets: { kh } });
  assert.equal(s.getState().message, null, s.getState().message);
  return s;
}

test('row 1: the nearest grid direction either way, a tie the preferred way, 0 on the grid, and only 90, 45 or 15', () => {
  assert.ok(Math.abs(GT.gridTurnDeg(83.2, 90) - 6.8) < 1e-9, 'short of 90: turn left onto it');
  assert.ok(Math.abs(GT.gridTurnDeg(-57.6, 90) + 32.4) < 1e-9, '-57.6: the nearest line is -90, a right turn');
  assert.ok(Math.abs(GT.gridTurnDeg(302.4, 90) + 32.4) < 1e-9, 'the same direction written as 302.4');
  assert.ok(Math.abs(GT.gridTurnDeg(100, 45) + 10) < 1e-9 && Math.abs(GT.gridTurnDeg(100, 15) - 5) < 1e-9, 'other steps');
  assert.equal(GT.gridTurnDeg(45, 90, +1), 45); assert.equal(GT.gridTurnDeg(45, 90, -1), -45); assert.equal(GT.gridTurnDeg(45, 90, 0), 45, 'a tie with no preference turns left');
  assert.equal(GT.gridTurnDeg(180, 90), 0); assert.equal(GT.gridTurnDeg(-270, 90), 0);
  assert.ok(Math.abs(GT.offGridDeg(89.0679, 90) + 0.9321) < 1e-9, 'off the grid: + means the line is to the right');
  assert.throws(() => GT.gridTurnDeg(10, 30), (e) => e.code === 'BAD_GRID_STEP');
  assert.throws(() => GT.offGridDeg(NaN, 90), (e) => e.code === 'BAD_HEADING');
});

test('row 2: endHeadingDeg is the direction the path really ends in, through turns and a free jump', async () => {
  const s = await spiral(), d = s.getState().history.present;
  assert.ok(Math.abs(wrap(GT.endHeadingDeg(AD.toSegments(d), d.start.heading) - pathEndDeg(d))) < 1e-6);
  s.commitDoc(D.appendPiece(s.getState().history.present, D.flightPiece({ forward: 40, left: 6, up: 0, heading: 0.3, pitch: 0, bank: 0 })));
  s.extend({ length: 150 });
  const j = s.getState().history.present;
  assert.ok(Math.abs(wrap(GT.endHeadingDeg(AD.toSegments(j), j.start.heading) - pathEndDeg(j))) < 1e-6, 'after a jump that lands turned');
  assert.ok(Math.abs(wrap(s.endHeadingDeg() - pathEndDeg(j))) < 1e-6, 'the shell reads the same');
});

test('row 3: after a free-flowing spiral, Turn to grid ends on a grid direction, dead straight, in one undo step (90, 45 and 15)', async () => {
  for (const step of [90, 45, 15]) {
    const s = await spiral();
    const before = s.getState().history.present, n = before.pieces.length;
    assert.ok(Math.abs(GT.offGridDeg(s.endHeadingDeg(), step)) > 0.5, `the spiral ends off the ${step}° grid`);
    s.extendTurnToGrid({ length: 400, targets: {} }, step);
    assert.equal(s.getState().message, null, s.getState().message);
    const d = s.getState().history.present, P = d.pieces[d.pieces.length - 1];
    assert.equal(d.pieces.length, n + 1, 'one piece');
    assert.ok(Math.abs(GT.offGridDeg(pathEndDeg(d), step)) < 0.01, `${step}: the path ends ${GT.offGridDeg(pathEndDeg(d), step)}° off the grid`);
    const end = D.pieceEnd(P); assert.ok(Math.abs(end.kh.v) < 1e-9 && Math.abs(end.kh.m) < 1e-9, 'it ends straight');
    s.undo(); assert.equal(s.getState().history.present, before, 'one undo step');
  }
});

test('row 4: a track already on the grid: nothing placed, and the message says so', async () => {
  const s = await createCoreShell({});
  s.extend({ length: 200, family: 'bowl' });
  const before = s.getState().history.present;
  s.extendTurnToGrid({ length: 200, targets: {} }, 90);
  assert.equal(s.getState().history.present, before);
  assert.match(s.getState().message, /already on the 90° grid/);
});
