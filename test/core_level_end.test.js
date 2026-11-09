// core_level_end.test.js: node --test test/core_level_end.test.js
// Level the END of a piece already placed (the user, 2026-11-09: "made this nice turn but now I want the ending of it to level out … the level feature
// should work at the end of any piece to flatten it to level"). src/core/level.js levelEnd(doc, i) re-solves ONLY piece i's climb control points so the
// piece ends at pitch 0 with climb rate 0; its turn, bank, width and length are kept exactly, its joint's first two control points stay (C1 from the
// piece before it), and the pieces after it follow. The fixture is his track (three 1000 m pieces; the last turns and ends pitched +2.81°).
//   1  the last piece of his track ends level (|pitch| ≤ PITCH_TOL on the adapter's path) and straight (climb rate and its slope 0)
//   2  only the climb changes: the turn, bank, width, cup and every other channel, the knots and the length are the piece's own, bit for bit,
//      and the heading change (the turn readout and the end heading on the path) is unchanged
//   3  the joint's first two climb control points stay, so the piece still joins the one before it C1 (the document check)
//   4  a piece in the middle: it ends level, the pieces after it keep their shape, and a next piece that started on a climb is re-joined C1
//      (its first two climb control points carry the new end on; nothing else of it changes)
//   5  in the flipped frame (past the top of a loop, where more climb pitches the road DOWN) the piece still ends level
//   6  a piece too short to have a free climb control point is refused by name (LEVEL_TOO_SHORT) and nothing changes
//   7  refused by name: a piece that is not in the track (BAD_RANGE), a flight (LEVEL_NOT_ROAD), a closed loop (CLOSED)
//   8  Level as Extend with the fields' climb read as a corner (his: turn −540 as a corner, climb 10.66 carried from the last piece) places the
//      same piece as with no climb at all: the climb is what Level solves, so a climb corner is dropped, not refused
//   9  what is placed is what is stored: the saved text reads back to the same document, still level
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const RO = require('../src/core/readout.js');
const L = require('../src/core/level.js');
const { flippedLap } = require('./core_close_flip_lap.js');

const DEG = Math.PI / 180;
const PITCH_TOL = 1e-6;   // rad: level.js's own (its solve stops there; the bar is 0.01°)
const HIS = D.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'level-end-2026-11-09.t180track'), 'utf8'));
/** The pose at the end of piece i on the adapter's path (the track as drawn): pitch, heading (rad) and the tangent. */
const endOf = (d, i = d.pieces.length - 1) => {
  const S = A.toPath({ ...d, closed: false, pieces: d.pieces.slice(0, i + 1) }).path.samples, T = S[S.length - 1].T;
  return { pitch: Math.atan2(T[1], Math.hypot(T[0], T[2])), heading: Math.atan2(T[0], T[2]) };
};
const others = (P) => { const { kv, ...rest } = P.channels; return { ...P, channels: rest }; };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('row 1: the last piece of his track ends level (|pitch| ≤ PITCH_TOL on the adapter\'s path) and straight (climb rate 0, flat)', () => {
  const i = HIS.pieces.length - 1;
  assert.ok(endOf(HIS).pitch > 2 * DEG, `control: his last piece ends pitched ${(endOf(HIS).pitch / DEG).toFixed(3)}°`);
  const d = L.levelEnd(HIS, i), e = endOf(d), P = d.pieces[i];
  assert.ok(Math.abs(e.pitch) <= PITCH_TOL, `end pitch ${(e.pitch / DEG).toExponential(3)}°`);
  const end = D.channelAt(P, 'kv', P.length);
  assert.ok(Math.abs(end.v) < 1e-12 && Math.abs(end.d1) < 1e-12, `it ends straight: kv ${end.v}, its slope ${end.d1}`);
});

test('row 2: only the climb changes: every other channel, the knots and the length are its own, and the heading change is unchanged', () => {
  const i = HIS.pieces.length - 1, d = L.levelEnd(HIS, i);
  assert.deepEqual(others(d.pieces[i]), others(HIS.pieces[i]), 'turn, bank, width, cup, knots, length: the piece\'s own');
  assert.notDeepEqual(d.pieces[i].channels.kv, HIS.pieces[i].channels.kv, 'control: the climb did change');
  for (let k = 0; k < i; k++) assert.deepEqual(d.pieces[k], HIS.pieces[k], `piece ${k} before it is untouched`);
  assert.equal(RO.pieceReadout(d, i).turnDeg, RO.pieceReadout(HIS, i).turnDeg, 'the turn readout');
  assert.ok(Math.abs(wrap(endOf(d).heading - endOf(HIS).heading)) < 1e-9, `the end heading: ${endOf(d).heading} against ${endOf(HIS).heading}`);
});

test('row 3: the joint\'s first two climb control points stay, so it joins the piece before it C1', () => {
  const i = HIS.pieces.length - 1, d = L.levelEnd(HIS, i);
  assert.deepEqual(d.pieces[i].channels.kv.slice(0, 2), HIS.pieces[i].channels.kv.slice(0, 2));
  assert.doesNotThrow(() => D.checkDoc(d), 'C1 at every joint (the document check)');
});

/** Straight 300 m, 400 m easing to a climb of 0.5°/100 m (ending ON it), then 500 m easing it back to 0: the third piece starts on a climb. */
function climbing() {
  let d = extend(D.createDoc('climbing'), { length: 300 });
  d = extend(d, { length: 400, targets: { kv: 0.5 * DEG / 100, kh: 0.3 * DEG / 100 } });
  return extend(d, { length: 500, targets: { kv: 0, kh: 0 } });
}

test('row 4: a piece in the middle ends level; the pieces after it keep their shape, and one that started on a climb is re-joined C1', () => {
  const H = HIS, d = L.levelEnd(H, 1);
  assert.ok(Math.abs(endOf(H, 1).pitch) > 0.1 * DEG, `control: his middle piece ends pitched ${(endOf(H, 1).pitch / DEG).toFixed(3)}°`);
  assert.ok(Math.abs(endOf(d, 1).pitch) <= PITCH_TOL, `his middle piece ends level: ${(endOf(d, 1).pitch / DEG).toExponential(3)}°`);
  assert.deepEqual(d.pieces[2], H.pieces[2], 'his last piece already started straight: it follows unchanged');
  const C = climbing(), c = L.levelEnd(C, 1), P = c.pieces[2], Q = C.pieces[2];
  assert.ok(Math.abs(D.channelAt(C.pieces[1], 'kv', C.pieces[1].length).v) > 1e-5, 'control: the middle piece ends ON a climb');
  assert.ok(Math.abs(endOf(c, 1).pitch) <= PITCH_TOL, `ends level: ${(endOf(c, 1).pitch / DEG).toExponential(3)}°`);
  const end = D.channelAt(c.pieces[1], 'kv', c.pieces[1].length);
  assert.ok(Math.abs(end.v) < 1e-12 && Math.abs(end.d1) < 1e-12, `and straight, though it ended on a climb: kv ${end.v}, its slope ${end.d1}`);
  assert.deepEqual(P.channels.kv.slice(0, 2), [0, 0], 'the next piece\'s joint carries the new end on: climb rate 0 and flat');
  assert.deepEqual(P.channels.kv.slice(2), Q.channels.kv.slice(2), 'and the rest of its climb is its own');
  assert.deepEqual(others(P), others(Q), 'every other channel of it is its own');
  assert.doesNotThrow(() => D.checkDoc(c));
});

test('row 5: in the flipped frame (past the top of a loop) the piece still ends level', () => {
  let f = extend(flippedLap(), { length: 300, targets: { kv: 0.0015 } });
  f = extend(f, { length: 400 });
  assert.ok(Math.abs(endOf(f).pitch) > 0.05, `control: the end slopes ${(endOf(f).pitch / DEG).toFixed(2)}°`);
  for (const i of [f.pieces.length - 1, f.pieces.length - 2]) {
    const d = L.levelEnd(f, i);
    assert.ok(Math.abs(endOf(d, i).pitch) <= PITCH_TOL, `piece ${i} ends level in the flipped frame: ${(endOf(d, i).pitch / DEG).toExponential(3)}°`);
  }
});

test('row 6: a piece too short to have a free climb control point is refused by name, and nothing changes', () => {
  const d = extend(HIS, { length: 10 });
  assert.equal(d.pieces.at(-1).knots.length, 0, 'control: a 10 m piece has no interior knot');
  assert.throws(() => L.levelEnd(d, d.pieces.length - 1), { code: 'LEVEL_TOO_SHORT' });
  const e = extend(HIS, { length: 30 }), r = L.levelEnd(e, e.pieces.length - 1);   // one interior knot: one free point, enough for one condition
  assert.ok(Math.abs(endOf(r).pitch) <= PITCH_TOL, `a 30 m piece levels: ${(endOf(r).pitch / DEG).toExponential(3)}°`);
});

test('row 7: refused by name: a piece not in the track, a flight, a closed loop', () => {
  for (const i of [-1, 3, 1.5, undefined]) assert.throws(() => L.levelEnd(HIS, i), { code: 'BAD_RANGE' }, String(i));
  const { jumpHere } = require('../src/core/jump.js'), j = jumpHere(HIS, null), fi = j.pieces.findIndex((P) => P.type !== 'road');
  assert.ok(fi >= 0, 'control: the jump placed a flight');
  assert.throws(() => L.levelEnd(j, fi), { code: 'LEVEL_NOT_ROAD' });
  assert.throws(() => L.levelEnd({ ...HIS, closed: true }, 2), { code: 'CLOSED' });
});

test('row 8: Level as Extend with a climb read as a corner places the same piece as with no climb: it is dropped, not refused', () => {
  const opts = { length: 1000, turnDeg: -540 }, d = L.extendLevel(HIS, { ...opts, climbDeg: 10.66 });
  assert.deepEqual(d, L.extendLevel(HIS, opts), 'the climb corner is dropped');
  assert.ok(Math.abs(endOf(d).pitch) <= PITCH_TOL, `ends level: ${(endOf(d).pitch / DEG).toExponential(3)}°`);
  assert.ok(Math.abs(RO.pieceReadout(d, d.pieces.length - 1).turnDeg + 540) <= 0.01, 'turns −540°');
});

test('row 9: what is placed is what is stored: the saved text reads back to the same document, still level', () => {
  for (const i of [1, 2]) {
    const d = L.levelEnd(HIS, i), back = D.parse(D.serialize(d));
    assert.deepEqual(back.pieces, d.pieces, `piece ${i}: the same pieces after a save and a load`);
    assert.ok(Math.abs(endOf(back, i).pitch) <= PITCH_TOL, `still level: ${(endOf(back, i).pitch / DEG).toExponential(3)}°`);
  }
});
