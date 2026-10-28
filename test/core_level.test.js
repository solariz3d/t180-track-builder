// core_level.test.js: node --test test/core_level.test.js   (under the heavy-run lock)
// D271 (the user, 2026-10-08: "there needs to be a way to snap the track to the floor to be true flat … i wanted the downhill to straighten out but its hard
// to calculate by hand"): src/core/level.js. The climb is a RATE, so "climb 0" keeps the slope; Level solves the climb so the piece ends straight and level,
// To floor also at height 0, or refuses by name with the length that works. The track: a straight, a climb, then a piece easing the climb to 0, so the
// head is straight but tilted (as the user's track was, +3.2°). Rows:
//   1  Level on a 500 m piece: |end pitch| ≤ 0.01°, and it ENDS STRAIGHT (climb rate and its slope 0); the piece joins C1 and every other channel is Extend's own
//   2  To floor on a long enough piece: |end pitch| ≤ 0.01° and |height| ≤ 1 cm at its end, on the adapter's path, and the export's validator finds no red in it
//   3  too short a piece is REFUSED by name (FLOOR_TOO_SHORT) with a length that then works, and a length 2 m shorter does not
//   4  what is placed is what is stored: the saved text reads back to the same piece, still level (quantised as stored)
//   5  a closed loop has no open end: refused by name
// D516 (the user, 2026-10-28, on CRAZY TEST's end: a 200 m piece with turn 90, bank −85 and cup 20, then Level, "currently it does nothing if there is a turn
// value added"): with "turn & climb as" set to corner the turn arrives as turnDeg, and Level and To floor refused it. From a head pitched −14.63° (his):
//   6  Level with turnDeg 90 turns exactly 90.00° (the readout's turn, to its 0.01°, and equal to Extend's corner alone, whose turn control points it keeps),
//      ends level (pitch within level.js's PITCH_TOL on the adapter's path) and at the bank and cup typed
//   7  To floor the same, and at height 0 (≤ 1 cm)
//   8  the shell: Level and To floor place a turn corner; a climb corner is still refused by name, and the message names the climb
//   9  a turn read as a RATE is placed as before: the piece's turn control points are Extend's own
//  10  To floor's search with a corner, from a head already on the floor and level, tries lengths too short for the corner: they are too short, not an error,
//      and the length it names is the corner's own shortest (3 m), which then works
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const L = require('../src/core/level.js');

const DEG = Math.PI / 180;
/** Straight 300 m, then 400 m climbing at 0.5°/100 m, then 600 m easing the climb back to 0: the head is straight, tilted up, above the start. */
function tilted() {
  let d = extend(D.createDoc('tilted'), { length: 300 });
  d = extend(d, { length: 400, targets: { kv: 0.5 * DEG / 100 }, transition: 100 });
  return extend(d, { length: 600, targets: { kv: 0 } });
}
const endOf = (d) => { const S = A.toPath(d).path.samples, e = S[S.length - 1]; return { pitch: Math.atan2(e.T[1], Math.hypot(e.T[0], e.T[2])), y: e.pos[1] }; };
const T0 = tilted(), H0 = endOf(T0);

test('row 1: Level on a 500 m piece ends straight and level (|pitch| ≤ 0.01°, climb rate 0 and flat), joined C1, every other channel Extend\'s own', () => {
  assert.ok(H0.pitch > 2 * DEG, `control: the head is tilted ${(H0.pitch / DEG).toFixed(2)}°`);
  assert.ok(Math.abs(D.endState(T0).kv.v) < 1e-9, 'control: the head is straight (climb rate 0): climb 0 cannot level it');
  const opts = { length: 500, targets: { kh: 0.5 * DEG / 100 } }, d = L.extendLevel(T0, opts), e = endOf(d), P = d.pieces[d.pieces.length - 1];
  assert.ok(Math.abs(e.pitch) <= 0.01 * DEG, `end pitch ${(e.pitch / DEG).toFixed(5)}°`);
  const end = D.channelAt(P, 'kv', P.length); assert.ok(Math.abs(end.v) < 1e-12 && Math.abs(end.d1) < 1e-12, `it ends straight: kv ${end.v}, its slope ${end.d1}`);
  assert.doesNotThrow(() => D.checkDoc(d), 'C1 at the joint (the document check)');
  const plain = extend(T0, { ...opts, targets: { ...opts.targets, kv: 0 } }), Q = plain.pieces[plain.pieces.length - 1];
  for (const ch of D.CHANNELS.filter((c) => c !== 'kv')) assert.deepEqual(P.channels[ch], Q.channels[ch], `${ch} is Extend's own`);
  assert.deepEqual(P.channels.kv.slice(0, 2), Q.channels.kv.slice(0, 2), 'the joint\'s two control points are Extend\'s (the piece continues C1 from the head)');
});

test('row 2: To floor on a long enough piece ends level (|pitch| ≤ 0.01°) at height 0 (≤ 1 cm) on the adapter\'s path, and the validator finds no red in it', () => {
  assert.ok(H0.y > 10, `control: the head is ${H0.y.toFixed(1)} m above the floor`);
  const need = L.shortestToFloor(T0, { length: 100 }), d = L.extendToFloor(T0, { length: need + 200 }), e = endOf(d);
  assert.ok(Math.abs(e.pitch) <= 0.01 * DEG && Math.abs(e.y) <= 0.01, `end pitch ${(e.pitch / DEG).toFixed(5)}°, height ${e.y.toFixed(4)} m`);
  const { path, segments } = A.toPath(d), s0 = T0.pieces.reduce((a, P) => a + P.length, 0);
  const reds = V.validate(path, segments, { csp: true, softCollision: true, fullSpeed: true }).red.filter((x) => x.s >= s0 - 1);
  assert.deepEqual(reds.map((x) => x.reason), [], 'no red in the piece (the car stays on the road at the open track\'s speed)');
});

test('row 3: too short a piece is refused by name with a length that then works; 2 m shorter than it does not', () => {
  let err = null; try { L.extendToFloor(T0, { length: 300 }); } catch (e) { err = e; }
  assert.ok(err, 'a 300 m piece is refused'); assert.equal(err.code, 'FLOOR_TOO_SHORT'); assert.ok(Number.isInteger(err.needM) && err.needM > 300, `needM ${err.needM}`);
  assert.match(err.message, new RegExp(`needs at least ${err.needM} m`));
  const d = L.extendToFloor(T0, { length: err.needM }), e = endOf(d);
  assert.ok(Math.abs(e.pitch) <= 0.01 * DEG && Math.abs(e.y) <= 0.01, `at ${err.needM} m: pitch ${(e.pitch / DEG).toFixed(5)}°, height ${e.y.toFixed(4)} m`);
  assert.throws(() => L.extendToFloor(T0, { length: err.needM - 2 }), { code: 'FLOOR_TOO_SHORT' }, 'the named length is the shortest (to the metre or two)');
});

test('row 4: what is placed is what is stored: the saved text reads back to the same piece, and it still ends level', () => {
  for (const d of [L.extendLevel(T0, { length: 500 }), L.extendToFloor(T0, { length: L.shortestToFloor(T0, { length: 100 }) })]) {
    const back = D.parse(D.serialize(d));
    assert.deepEqual(back.pieces[back.pieces.length - 1].channels.kv, d.pieces[d.pieces.length - 1].channels.kv, 'the climb control points are stored as placed');
    assert.ok(Math.abs(endOf(back).pitch) <= 0.01 * DEG);
  }
});

test('row 5: a closed loop has no open end: Level and To floor refuse by name', () => {
  const closed = D.checkDoc({ ...T0, closed: true });
  assert.throws(() => L.extendLevel(closed, { length: 500 }), { code: 'CLOSED' });
  assert.throws(() => L.extendToFloor(closed, { length: 500 }), { code: 'CLOSED' });
});
// ── D516: a turn read as a corner (turnDeg), placed exactly by Level and To floor ──
const TB = require('../src/core/turnby.js');
const RD = require('../src/core/readout.js');
const PITCH_TOL = 1e-6;   // rad: level.js's own (its solve stops there; the bar is 0.01°)
/** His head, in the part that matters: straight, pitched −14.63° (CRAZY TEST's last piece ends there), 600 m above the floor. */
const DOWN = extend(D.createDoc('down', { start: { pos: [0, 600, 0], pitch: -14.63 * DEG } }), { length: 300 }), HD = endOf(DOWN);
const HIS = { length: 200, turnDeg: 90, targets: { phi: -85 * DEG, c: 20 } };   // his piece: turn 90 (a corner), bank −85, cup 20
const turnOf = (d) => RD.pieceReadout(d, d.pieces.length - 1).turnDeg;   // the readout's turn (what the panel shows)

test('row 6: Level with a corner turn of 90° from a head pitched −14.63° turns exactly 90.00° (as Extend\'s corner), ends level, at the bank and cup typed', () => {
  assert.ok(Math.abs(HD.pitch / DEG + 14.63) <= 0.01, `control: the head is pitched ${(HD.pitch / DEG).toFixed(2)}°`);
  const d = L.extendLevel(DOWN, HIS), alone = TB.extendCorner(DOWN, HIS), P = d.pieces.at(-1), Q = alone.pieces.at(-1), e = endOf(d), end = D.endState(d);
  assert.ok(Math.abs(turnOf(d) - 90) <= 0.01, `Level's piece turns ${turnOf(d)}°`);
  assert.ok(Math.abs(turnOf(d) - turnOf(alone)) <= 0.01, `as Extend's corner alone: ${turnOf(d)}° against ${turnOf(alone)}°`);
  assert.deepEqual(P.channels.kh, Q.channels.kh, 'the turn control points are the corner\'s own: the climb correction leaves the heading alone');
  assert.ok(Math.abs(e.pitch) <= PITCH_TOL, `end pitch ${(e.pitch / DEG).toExponential(3)}°`);
  assert.ok(Math.abs(end.kh.v) < 1e-12 && Math.abs(end.kv.v) < 1e-12, `it ends straight: turn rate ${end.kh.v}, climb rate ${end.kv.v}`);
  assert.ok(Math.abs(end.phi.v - -85 * DEG) <= 1e-6, `bank ${end.phi.v / DEG}°`); assert.ok(Math.abs(end.c.v - 20) <= 1e-6, `cup ${end.c.v}°`);
});

test('row 7: To floor with a corner turn of 90° from a head pitched −14.63° turns exactly 90.00°, ends level and at height 0, at the bank and cup typed', () => {
  assert.ok(HD.y > 100, `control: the head is ${HD.y.toFixed(1)} m above the floor`);
  const need = L.shortestToFloor(DOWN, HIS), d = L.extendToFloor(DOWN, { ...HIS, length: need }), e = endOf(d), end = D.endState(d);
  assert.ok(Math.abs(turnOf(d) - 90) <= 0.01, `the piece turns ${turnOf(d)}°`);
  assert.ok(Math.abs(e.pitch) <= PITCH_TOL, `end pitch ${(e.pitch / DEG).toExponential(3)}°`); assert.ok(Math.abs(e.y) <= 0.01, `end height ${e.y.toFixed(4)} m`);
  assert.ok(Math.abs(end.phi.v - -85 * DEG) <= 1e-6 && Math.abs(end.c.v - 20) <= 1e-6, `bank ${end.phi.v / DEG}°, cup ${end.c.v}°`);
});

test('row 8: the shell places a corner turn with Level and To floor; a climb corner is still refused by name and placed nothing', async () => {
  const { createCoreShell } = require('../app/core/coreshell.js');
  for (const fn of ['extendLevel', 'extendToFloor']) {
    const s = await createCoreShell({ brushFn: null }); s.adopt(DOWN);
    s[fn]({ ...HIS, length: fn === 'extendLevel' ? 200 : L.shortestToFloor(DOWN, HIS), climbDeg: 5 });
    assert.equal(s.getState().history.present.pieces.length, 1, `${fn}: a climb corner placed nothing`);
    assert.match(s.getState().message || '', /place the climb 5° with Extend first/, `${fn} names the climb: ${s.getState().message}`);
    s[fn]({ ...HIS, length: fn === 'extendLevel' ? 200 : L.shortestToFloor(DOWN, HIS) });
    assert.equal(s.getState().message, null, `${fn}: no refusal`); assert.equal(s.getState().history.present.pieces.length, 2, `${fn} placed the corner`);
    assert.ok(Math.abs(turnOf(s.getState().history.present) - 90) <= 0.01);
  }
  // and the core refuses it too, by name, should a climb corner reach it some other way: the climb is what Level and To floor solve, so it would be lost
  for (const f of [L.extendLevel, L.extendToFloor]) assert.throws(() => f(DOWN, { ...HIS, climbDeg: 5 }), { code: 'CLIMB_AS_CORNER', message: /climb of 5°/ });
});

test('row 9: a turn read as a rate is placed as before: Level keeps Extend\'s own turn control points and ends level', () => {
  const opts = { length: 200, targets: { kh: 30 * DEG / 100, phi: -85 * DEG, c: 20 } }, d = L.extendLevel(DOWN, opts);
  const plain = extend(DOWN, { ...opts, targets: { ...opts.targets, kv: 0 } });
  assert.deepEqual(d.pieces.at(-1).channels.kh, plain.pieces.at(-1).channels.kh, 'the turn is Extend\'s rate ease');
  assert.ok(Math.abs(endOf(d).pitch) <= PITCH_TOL);
});

test('row 10: from a head on the floor and level, To floor\'s search treats a length too short for the corner as too short (not an error) and names one that works', () => {
  const flat = extend(D.createDoc('flat'), { length: 300 }), o = HIS;   // his piece's fields (with them the corner's shortest is 3 m; with none it is 21 m)
  assert.equal(TB.shortestTurnBy(flat, { ...o, length: 1 }, 90 * DEG), 3, 'control: the corner needs 3 m, so the search tries lengths below it');
  const need = L.shortestToFloor(flat, o); assert.equal(need, 3, `the length named: ${need}`);
  const d = L.extendToFloor(flat, { ...o, length: need }), e = endOf(d);
  // the turn as Extend's corner alone places it: on a piece this short the readout's exact integral reads 94.50° where the drawn path turns 90.000° (Turn by's own
  // solve is on the path's 2 m trapezoid; the gap is under 0.01° from about 20 m), so the row compares with the corner, not with 90
  const alone = TB.extendCorner(flat, { ...o, length: need });
  assert.ok(Math.abs(turnOf(d) - turnOf(alone)) <= 0.01 && Math.abs(e.pitch) <= PITCH_TOL && Math.abs(e.y) <= 0.01, `turn ${turnOf(d)}° (the corner alone: ${turnOf(alone)}°), pitch ${e.pitch}, height ${e.y}`);
});
