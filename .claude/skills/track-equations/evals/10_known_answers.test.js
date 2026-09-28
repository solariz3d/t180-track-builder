// 10_known_answers.test.js: node --test .claude/skills/track-equations/evals/10_known_answers.test.js
// The KNOWN ANSWERS for references/10 (sculpt and close, D185, pane E). Each formula is written here INDEPENDENTLY of
// src/core (the reference form), checked against its closed-form answer, and then the core's own function is checked against
// the reference. The basis is 03 §1's Cox–de Boor, written out again here, not imported.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const S = require(path.join(REPO, 'src', 'core', 'sculpt.js'));

// ── the reference forms ──
const S2 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3);   // 10 §1, WIKI-SMOOTHSTEP
const S2d = (x) => 30 * x * x * (1 - x) * (1 - x), S2dd = (x) => 60 * x * (1 - x) * (1 - 2 * x);
function B(i, k, t, x) {                                                                  // 03 §1, Cox–de Boor
  if (k === 0) return t[i] <= x && x < t[i + 1] ? 1 : 0;
  const a = t[i + k] - t[i], b = t[i + k + 1] - t[i + 1];
  return (a > 0 ? (x - t[i]) / a * B(i, k - 1, t, x) : 0) + (b > 0 ? (t[i + k + 1] - x) / b * B(i + 1, k - 1, t, x) : 0);
}
const tstar = (t, j) => (t[j + 1] + t[j + 2] + t[j + 3]) / 3;                             // 10 §2, LYCHE-MORKEN (5.30)
const V = (g, t, x) => { let s = 0; for (let j = 0; j + 4 < t.length; j++) s += g(tstar(t, j)) * B(j, 3, t, x); return s; };
const T = [0, 0, 0, 0, 7, 13, 30, 31, 44, 60, 71, 90, 90, 90, 90];                        // clamped, deliberately uneven
const inside = (x) => Math.min(x, 90 - 1e-9);

test('10 §1: S₂ is 0, ½, 1 at 0, ½, 1; S₂′ is 0 at both ends and 15/8 at ½; S₂″ is 0 at both ends', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-14;
  assert.ok(near(S2(0), 0) && near(S2(0.5), 0.5) && near(S2(1), 1), 'values');
  assert.ok(near(S2d(0), 0) && near(S2d(1), 0) && near(S2d(0.5), 15 / 8), 'first derivative');
  assert.ok(near(S2dd(0), 0) && near(S2dd(1), 0), 'second derivative');
  const h = 1e-5; assert.ok(Math.abs((S2(0.3 + h) - S2(0.3 - h)) / (2 * h) - S2d(0.3)) < 1e-8, 'S₂′ is the derivative of S₂');
});
test('10 §1: the core\'s smootherstep IS S₂, at 101 points', () => {
  for (let k = 0; k <= 100; k++) { const x = k / 100; assert.ok(Math.abs(S.smootherstep(x) - S2(x)) < 1e-14, `at ${x}`); }
});
test('10 §2 (5.31): with clamped knots the first and last knot averages are the ends', () => {
  assert.equal(tstar(T, 0), 0); assert.equal(tstar(T, T.length - 5), 90);
  assert.equal(S.knotAverage(T, 0), 0); assert.equal(S.knotAverage(T, T.length - 5), 90);
});
test('10 §2: V reproduces a straight line exactly on uneven clamped knots (to 1e-12)', () => {
  for (let x = 0; x <= 90; x += 3.7) assert.ok(Math.abs(V((u) => 2 - 0.5 * u, T, inside(x)) - (2 - 0.5 * inside(x))) < 1e-12, `at ${x}`);
});
test('10 §2: V of the brush bump is close to the bump: within the knot spacing squared times its curvature', () => {
  const s0 = 45, r = 30, g = (u) => 1 - S2(Math.abs(u - s0) / r), h = 19;   // 19 m: the widest span in T
  for (let x = 0; x <= 90; x += 1) { const e = Math.abs(V(g, T, inside(x)) - g(x)); assert.ok(e < (h * h) * (60 / (r * r)) * 0.25, `at ${x}: ${e}`); }
});
test('10 §2: the core\'s brush on a bare channel equals Δ·f at the knot averages of the whole-support control points', () => {
  const c = Array.from({ length: T.length - 4 }, (_, i) => Math.sin(i)), s0 = 40, r = 35;
  const { ctrl, changed } = S.brushControls(c, T, { s0, r, delta: 2 });
  for (let i = 0; i < c.length; i++) {
    const whole = T[i] >= s0 - r && T[i + 4] <= s0 + r;
    assert.equal(changed.includes(i), whole, `control point ${i}`);
    if (whole) assert.ok(Math.abs(ctrl[i] - (c[i] + 2 * (1 - S2(Math.abs(tstar(T, i) - s0) / r)))) < 1e-14, `control point ${i}`);
    else assert.ok(Object.is(ctrl[i], c[i]), `control point ${i} (outside: identical)`);
  }
});
