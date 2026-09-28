// m2m3_tools.test.js: node --test --test-concurrency=4 test/m2m3_tools.test.js. The M2 and M3 instruments (tools/geodesic.cjs,
// tools/meshcurv.cjs) on data whose answer is known, so their numbers mean what they say. Stated before the run:
//   · Spearman is +1 / −1 on perfectly monotone data, and the M2 score PASSES a share that falls with load and FAILS one that rises;
//   · the angle defect is 0 at every interior vertex of a flat grid, > 0 on a bowl z = x² + y², < 0 on a saddle z = x² − y²,
//     and boundary vertices are never counted as interior.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spearman, score } = require(path.join(__dirname, '..', 'tools', 'geodesic.cjs'));
const { curvature } = require(path.join(__dirname, '..', 'tools', 'meshcurv.cjs'));

test('M2: Spearman is +1 and −1 on monotone data', () => {
  const up = Array.from({ length: 50 }, (_, i) => [i, i * i]), down = up.map(([x, y]) => [x, -y]);
  assert.equal(spearman(up), 1); assert.equal(spearman(down), -1);
});

test('M2: a share that falls as load rises PASSES; one that rises FAILS', () => {
  const run = (sign) => [{ frames: Array.from({ length: 4000 }, (_, i) => { const load = (i % 400) / 10; return [load, 0.5 + sign * load / 100 + ((i * 7919) % 13) / 1000]; }) }];
  const fall = score(run(-1)), rise = score(run(1));
  assert.equal(fall.verdict, 'PASS', JSON.stringify(fall)); assert.ok(fall.ci95[1] < 0);
  assert.equal(rise.verdict, 'FAILS', JSON.stringify(rise)); assert.ok(rise.rho > 0);
});

/** A (2n+1)² grid of z = f(x, y) over [-1, 1]², as one kn5-like mesh { pos, idx }. */
function grid(f, n = 10) {
  const pos = [], idx = [], at = (i, j) => i * (2 * n + 1) + j;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const x = i / n, y = j / n; pos.push(x, f(x, y), y); }
  for (let i = 0; i < 2 * n; i++) for (let j = 0; j < 2 * n; j++) { idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1)); }
  return [{ pos: Float32Array.from(pos), idx: Uint32Array.from(idx) }];
}
const signs = (c) => { let neg = 0, pos = 0, zero = 0; for (let i = 0; i < c.nV; i++) if (c.interior[i]) { if (c.K[i] < 0) neg++; else if (c.K[i] > 0) pos++; else zero++; } return { neg, pos, zero }; };

test('M3: flat grid → K = 0 at every interior vertex; only the (2n−1)² interior ones count', () => {
  const c = curvature(grid(() => 0));
  assert.equal(c.nInterior, 19 * 19);
  assert.deepEqual(signs(c), { neg: 0, pos: 0, zero: 361 });
});

test('M3: bowl z = x² + y² → K > 0; saddle z = x² − y² → K < 0 (interior vertices)', () => {
  const bowl = signs(curvature(grid((x, y) => x * x + y * y))), saddle = signs(curvature(grid((x, y) => x * x - y * y)));
  assert.ok(bowl.pos > 300 && bowl.neg === 0, JSON.stringify(bowl));
  assert.ok(saddle.neg > 300 && saddle.pos === 0, JSON.stringify(saddle));
});

// M2b / M3b (registration exo_memory/loop/m2b_m3b_registration_2026-09-28.md): the new scorers on data whose answer is known
const { scoreSpeed } = require(path.join(__dirname, '..', 'tools', 'geodesic.cjs'));
const { smoothK } = require(path.join(__dirname, '..', 'tools', 'meshcurv.cjs'));

test('M2b: a share that falls with SPEED passes on 5 replays; one that rises fails', () => {
  const run = (sign) => Array.from({ length: 5 }, (_, r) => ({ file: `r${r}`, frames: Array.from({ length: 1200 }, (_, i) => { const v = 30 + (i % 300) / 2; return [5, 0.5 + sign * (v - 30) / 400 + ((i * 7919 + r) % 13) / 1000, 0.01, v]; }) }));
  const fall = scoreSpeed(run(-1)), rise = scoreSpeed(run(1));
  assert.equal(fall.verdict, 'PASS', JSON.stringify(fall)); assert.equal(fall.negativeReplays, 5);
  assert.equal(rise.verdict, 'FAILS');
});

test('M3b: smoothed K is 0 on a flat grid, > 0 on a bowl, < 0 on a saddle (interior vertices, r = 0.3 on a 2 m grid)', () => {
  const sign = (f) => { const c = curvature(grid(f)), K = smoothK(c, 0.3); let neg = 0, pos = 0, zero = 0; for (let i = 0; i < c.nV; i++) if (c.interior[i]) { if (K[i] < 0) neg++; else if (K[i] > 0) pos++; else zero++; } return { neg, pos, zero }; };
  assert.deepEqual(sign(() => 0), { neg: 0, pos: 0, zero: 361 });
  const b = sign((x, y) => x * x + y * y), s = sign((x, y) => x * x - y * y);
  assert.ok(b.pos > 300 && b.neg === 0, JSON.stringify(b)); assert.ok(s.neg > 300 && s.pos === 0, JSON.stringify(s));
});
