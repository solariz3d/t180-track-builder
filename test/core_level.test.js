// core_level.test.js: node --test test/core_level.test.js   (under the heavy-run lock)
// D271 (the keeper, 2026-10-08: "there needs to be a way to snap the track to the floor to be true flat … i wanted the downhill to straighten out but its hard
// to calculate by hand"): src/core/level.js. The climb is a RATE, so "climb 0" keeps the slope; Level solves the climb so the piece ends straight and level,
// To floor also at height 0, or refuses by name with the length that works. The track: a straight, a climb, then a piece easing the climb to 0, so the
// head is straight but tilted (as the keeper's track was, +3.2°). Rows:
//   1  Level on a 500 m piece: |end pitch| ≤ 0.01°, and it ENDS STRAIGHT (climb rate and its slope 0); the piece joins C1 and every other channel is Extend's own
//   2  To floor on a long enough piece: |end pitch| ≤ 0.01° and |height| ≤ 1 cm at its end, on the adapter's path, and the export's validator finds no red in it
//   3  too short a piece is REFUSED by name (FLOOR_TOO_SHORT) with a length that then works, and a length 2 m shorter does not
//   4  what is placed is what is stored: the saved text reads back to the same piece, still level (quantised as stored)
//   5  a closed loop has no open end: refused by name
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
