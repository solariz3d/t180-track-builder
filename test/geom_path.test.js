// geom_path.test.js: node --test test/geom_path.test.js. The centreline and its frame.
// D177 (the librarian's ruling on p-d177-rigid-C §2, OPTION 2): the frame is the curve model's gravity frame, unrolled
// left = (cos θ, 0, −sin θ), no longer rotation-minimising. Two tests that pinned the RMF were REPLACED, not deleted:
//   "closure: a NON-planar closed loop closes in frame too, because its closing twist is spread along the loop"
//     → "closure: a NON-planar closed loop closes in frame with no twist to spread (the gravity frame follows the heading)"
//   "RMF: on an open non-planar curve the frame does not spin about T (spin under 1e-3 of its own turning rate)"
//     → "gravity frame: on an open non-planar curve the unrolled left is the heading's left, so roll 0 means level"
// The reason: the RMF spins against gravity on a climbing turn (k·sin p per metre, 61° over a 360° turn at 10°), so a
// word's roll was not its bank; and it made a piece's shape depend on the twist carried in from upstream, so no edit
// on a slope could move what follows rigidly. The new tests pin the new rule on the same fixture (twistLoop, which
// carries a real RMF twist). The closing-twist spread itself is gone with the RMF (the frame closes with the heading).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = process.env.GEOM_DIR ? require(process.env.GEOM_DIR) : require('../src/geom');
const F = require('./geom_fixtures.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const first = (p) => p.samples[0], last = (p) => p.samples[p.samples.length - 1];

test('closure: a planar closed stadium closes in position (≤ 1e-6 m) and in frame (T, L, U within 1e-9)', () => {
  const p = G.buildPath(F.stadium(), { closed: true, step: 0.5 });
  const a = first(p), b = last(p);
  assert.ok(len(sub(a.pos, b.pos)) < 1e-6, `position gap ${len(sub(a.pos, b.pos))}`);
  for (const k of ['T', 'L', 'U']) assert.ok(len(sub(a[k], b[k])) < 1e-9, `${k} gap ${len(sub(a[k], b[k]))}`);
});
test('closure: a NON-planar closed loop closes in frame with no twist to spread (the gravity frame follows the heading)', () => {
  // twistLoop closes in heading and pitch exactly, in position only to ~0.1 m (see the fixture), hence closeTol. Under the
  // RMF it carried a closing twist of about rise/R (measured 0.075 rad before D177); the gravity frame has none
  const p = G.buildPath(F.twistLoop(), { closed: true, step: 0.5, closeTol: 0.5 });
  const a = first(p), b = last(p);
  assert.ok(Math.abs(p.twist) < 1e-9, `closing twist ${p.twist}`);
  for (const k of ['T', 'L', 'U']) assert.ok(len(sub(a[k], b[k])) < 1e-9, `${k} gap ${len(sub(a[k], b[k]))}`);
});
test('frame: twist is zero on a planar curve, and the frame stays level (|L·Y| < 1e-9 everywhere)', () => {
  const p = G.buildPath(F.stadium(), { closed: true, step: 0.5 });
  assert.ok(Math.abs(p.twist) < 1e-9, `twist ${p.twist}`);
  for (const s of p.samples) assert.ok(Math.abs(s.L[1]) < 1e-9, `L tilts at s=${s.s}: ${s.L[1]}`);
});
test("gravity frame: on an open non-planar curve the unrolled left is the heading's left, so roll 0 means level", () => {
  // twistLoop climbs while turning (the case where the RMF spun against gravity). With roll 0 the left must be horizontal
  // (L·Y = 0) and equal to (cos θ, 0, −sin θ) for the heading θ of T, and the bank against gravity must be 0, everywhere
  const p = G.buildPath(F.twistLoop(), { closed: false, step: 0.25 });
  let worst = 0;
  for (const s of p.samples) {
    const th = Math.atan2(s.T[0], s.T[2]), H = [Math.cos(th), 0, -Math.sin(th)];
    worst = Math.max(worst, Math.abs(s.L[1]), len(sub(s.L, H)), Math.abs(s.bankG));
  }
  assert.ok(Math.max(...p.samples.map((x) => Math.abs(x.T[1]))) > 0.01, 'the fixture must climb');
  assert.ok(worst < 1e-12, `the left leaves the heading's left by ${worst}`);
});
test('frame: (T, L, U) is orthonormal and right-handed, with L = U × T, at every sample', () => {
  const p = G.buildPath(F.saddleLoop(), { closed: true, step: 1 });
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (const s of p.samples) {
    for (const k of ['T', 'L', 'U']) assert.ok(Math.abs(len(s[k]) - 1) < 1e-9);
    assert.ok(Math.abs(dot(s.T, s.L)) < 1e-9 && Math.abs(dot(s.T, s.U)) < 1e-9 && Math.abs(dot(s.L, s.U)) < 1e-9);
    assert.ok(len(sub(s.L, cross(s.U, s.T))) < 1e-9);
  }
});
test('clothoid: heading change over a word is (k0 + k1)·L/2, and curvature is linear in s', () => {
  const g = [{ id: 'c', kind: 'road', length: 40, k0: 0, k1: 0.05, profile: F.FLAT }];
  const p = G.buildPath(g, { step: 0.5 });
  const b = last(p), heading = Math.atan2(b.T[0], b.T[2]);
  assert.ok(Math.abs(heading - (0 + 0.05) * 40 / 2) < 1e-9, `heading ${heading}`);
  const mid = p.samples.find((s) => Math.abs(s.s - 20) < 1e-9);
  assert.ok(Math.abs(len(mid.kvec) - 0.025) < 1e-9, `|kvec| at mid ${len(mid.kvec)}`);
});
test('edge: a straight line (k = 0) stays on a line with a constant frame', () => {
  const p = G.buildPath([{ id: 's', kind: 'road', length: 250, profile: F.FLAT }], { step: 0.5 });
  for (const s of p.samples) {
    assert.ok(Math.abs(s.pos[0]) < 1e-9 && Math.abs(s.pos[1]) < 1e-9 && Math.abs(s.pos[2] - s.s) < 1e-9);
    assert.ok(len(sub(s.L, [1, 0, 0])) < 1e-12 && len(sub(s.U, [0, 1, 0])) < 1e-12 && len(s.kvec) === 0);
  }
});
test('edge: a zero-length word is refused, and so is a loop that does not close', () => {
  assert.throws(() => G.buildPath([{ id: 'z', kind: 'road', length: 0, profile: F.FLAT }]), /positive finite/);
  assert.throws(() => G.buildPath([{ id: 'n', kind: 'road', length: NaN, profile: F.FLAT }]), /positive finite/);
  assert.throws(() => G.buildPath([]), /no segments/);
  assert.throws(() => G.buildPath([{ id: 's', kind: 'road', length: 100, profile: F.FLAT }], { closed: true }), /does not close/);
});
