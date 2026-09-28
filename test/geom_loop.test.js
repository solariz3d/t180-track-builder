// geom_loop.test.js: node --test test/geom_loop.test.js. A full loop-the-loop (the librarian's ruling on D166 §5:
// "pitch through ±90° and around ... because inversions are in the vocabulary"). Stated before these tests were written:
//   · The pitch passes +90°, 180° (upside down) and −90°, and comes back level.
//   · The frame is continuous: it turns by at most step/R (the loop's curvature × the sample step, + 1e-9) between
//     samples, and stays orthonormal (within 1e-9) the whole way round.
//   · No folds on a half-pipe loop of R = 12 m: the walls rise ~3.8 m, well inside 1/κ = 12 m.
//   · It closes: a pure vertical loop ends where it began, within 1e-6 m, with the same frame within 1e-9.
//   · An honest consequence, also tested: a pure loop's exit road runs over its own entry at the bottom, and selfCheck
//     finds it. A drivable loop needs a sideways offset of a road width; that belongs to the model (see the D167 hand-back).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GDIR = process.env.GEOM_DIR || require('path').join(__dirname, '..', 'src', 'geom');
const G = require(GDIR);
const F = require('./geom_fixtures.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

for (const yaw of [0, 0.004]) {
  test(`loop-the-loop (yaw ${yaw}): pitch goes through ±90° and upside down, the frame is continuous and orthonormal, and it exits level`, () => {
    const R = 12, step = 0.25, segs = F.loopTheLoop({ R, yaw }), p = G.buildPath(segs, { step });
    const loop = p.samples.filter((s) => s.seg === 1);
    assert.ok(Math.max(...loop.map((s) => s.T[1])) > 0.9999 && Math.min(...loop.map((s) => s.T[1])) < -0.9999, 'pitch reaches +90° and −90°');
    // upside down at the top: exactly for the pure loop; the yawed loop is rolled ~5.6° there (U.y −0.9953, measured
    // before this bound was set: yaw about world up during the inversion), so its bound is −0.99
    // (the pure loop's exact top falls between 0.25 m samples: the nearest is at most step/2 away, U.y ≤ −cos(0.125/12) = −0.99995)
    assert.ok(Math.min(...loop.map((s) => s.U[1])) < (yaw ? -0.99 : -0.9999), 'upside down at the top');
    const bound = step * Math.hypot(1 / R, yaw) + 1e-9;
    for (let i = 1; i < p.samples.length; i++) {
      const a = p.samples[i - 1], b = p.samples[i];
      for (const k of ['T', 'L', 'U']) assert.ok(ang(a[k], b[k]) <= bound * (b.s - a.s) / step + 1e-9, `${k} jumps by ${ang(a[k], b[k])} at s = ${b.s}`);
      assert.ok(Math.abs(len(b.T) - 1) < 1e-9 && Math.abs(len(b.U) - 1) < 1e-9 && Math.abs(dot(b.T, b.U)) < 1e-9 && Math.abs(dot(b.T, b.L)) < 1e-9, `orthonormal at ${b.s}`);
    }
    const e = p.segEnd[1];
    assert.ok(Math.abs(e.T[1]) < 1e-9 && Math.abs(e.U[1] - 1) < 1e-9, `exits level: T.y ${e.T[1]}, U.y ${e.U[1]}`);
  });
}
test('loop-the-loop: no folds on a half-pipe loop of R = 12 m', () => {
  const segs = F.loopTheLoop(), m = G.buildMesh(G.buildPath(segs), segs);
  assert.deepStrictEqual(m.folds, []);
});
test('loop-the-loop: a pure vertical loop closes, in position and in frame', () => {
  const p = G.buildPath(F.loopTheLoop()), a = p.samples[p.segFirst[1]], b = p.segEnd[1];
  assert.ok(len(sub(a.pos, b.pos)) < 1e-6, `gap ${len(sub(a.pos, b.pos))} m`);
  for (const k of ['T', 'L', 'U']) assert.ok(len(sub(a[k], b[k])) < 1e-9, `${k} differs by ${len(sub(a[k], b[k]))}`);
});
test('loop-the-loop: the exit over the entry at the bottom is found by selfCheck (a pure loop is not drivable as is)', () => {
  const segs = F.loopTheLoop(), p = G.buildPath(segs), r = G.selfCheck(G.buildMesh(p, segs), { lengthM: p.lengthM });
  assert.ok(r.intersections.length > 0);
});

// D177, option 2 (the gravity frame, left = (cos θ, 0, −sin θ)): the frame depends on the heading only, so it must stay
// well-defined where the tangent is vertical. The old level-left rule (up × T) is undefined there; the heading's left is not.
test('gravity frame at EXACTLY ±90° pitch: finite, orthonormal, right-handed, and its left is the heading\'s left', () => {
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let worst = 0;
  for (const p of [Math.PI / 2, -Math.PI / 2]) for (const theta of [0, 0.7, -2.1, Math.PI]) {
    const path = G.buildPath([{ id: 'v', kind: 'road', length: 20, kp0: 0.01, kp1: 0.01, profile: F.FLAT }], { start: { pos: [0, 0, 0], theta, p }, step: 0.5 });
    const s = path.samples[0], H = [Math.cos(theta), 0, -Math.sin(theta)];
    assert.ok(Math.abs(Math.abs(s.T[1]) - 1) < 1e-15, `the start is vertical: T.y ${s.T[1]}`);
    for (const k of ['T', 'L', 'U']) assert.ok(s[k].every(Number.isFinite), `${k} is finite at p ${p}, θ ${theta}`);
    worst = Math.max(worst, len(sub(s.L, H)), Math.abs(len(s.L) - 1), Math.abs(len(s.U) - 1), Math.abs(dot(s.T, s.L)), Math.abs(dot(s.T, s.U)), Math.abs(dot(s.L, s.U)), len(sub(s.L, cross(s.U, s.T))));
  }
  assert.ok(worst < 1e-12, `worst ${worst}`);
});
test('corkscrew: a full roll about a heartline turns the road upside down halfway, continuously, and exits as it entered', () => {
  // a 60 m straight rolled 0 → 2π (smoothstep) about a heartline 1.2 m above the road: an inversion with no pitch
  const segs = [{ id: 'in', kind: 'road', length: 20, profile: F.FLAT }, { id: 'cork', kind: 'road', length: 60, roll0: 0, roll1: 2 * Math.PI, heartline: 1.2, profile: F.FLAT },
    { id: 'out', kind: 'road', length: 20, profile: F.FLAT }];
  const step = 0.25, p = G.buildPath(segs, { step }), cork = p.samples.filter((s) => s.seg === 1);
  assert.ok(Math.min(...cork.map((s) => s.U[1])) < -0.9999, 'upside down in the middle');
  // continuity: the frame turns by at most the roll rate × the step (smoothstep's peak rate is 1.5 · 2π / 60 per metre)
  const bound = step * 1.5 * 2 * Math.PI / 60 + 1e-9;
  for (let i = 1; i < p.samples.length; i++) {
    const a = p.samples[i - 1], b = p.samples[i];
    for (const k of ['L', 'U']) assert.ok(ang(a[k], b[k]) <= bound * (b.s - a.s) / step + 1e-9, `${k} jumps by ${ang(a[k], b[k])} at s = ${b.s}`);
    assert.ok(Math.abs(len(b.L) - 1) < 1e-9 && Math.abs(dot(b.T, b.L)) < 1e-9 && Math.abs(dot(b.L, b.U)) < 1e-9, `orthonormal at ${b.s}`);
  }
  // on the level the bank against gravity IS the roll (folded into ±90°), which the gravity frame makes exact
  for (const s of cork) assert.ok(Math.abs(s.bankG - Math.asin(Math.sin(s.roll))) < 1e-9, `bankG ${s.bankG} vs roll ${s.roll} at ${s.s}`);
  const e = p.segEnd[1], a0 = p.samples[p.segFirst[1]];
  for (const k of ['T', 'L', 'U']) assert.ok(len(sub(e[k], a0[k])) < 1e-9, `${k} exits as it entered: ${len(sub(e[k], a0[k]))}`);
});
