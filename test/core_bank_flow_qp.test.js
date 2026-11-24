// core_bank_flow_qp.test.js: node --test test/core_bank_flow_qp.test.js
// THE SOLVE THAT HOLDS A FLOWING BANK INSIDE ITS MARKS (src/core/extend.js flowInside: Goldfarb and Idnani's dual method). The drawn rows (core_bank_flow_drawn) read
// that the bank laid stays inside; these read that it is the LEAST bending that does, against known answers: a textbook problem, one with no answer, and random
// small problems checked against every active set tried by brute force.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { flowInside } = require('../src/core/extend.js');
const { denseSolve } = require('../tools/piecewise.cjs');

/** min ½yᵀGy + aᵀy with E·y = e: the KKT system solved (null when singular). */
function eqMin(G, a, E, e) {
  const n = a.length, m = E.length, A = Array.from({ length: n + m }, () => new Array(n + m).fill(0)), b = new Array(n + m).fill(0);
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] = G[i][j]; b[i] = -a[i]; }
  E.forEach((r, c) => { for (let i = 0; i < n; i++) { A[n + c][i] = r[i]; A[i][n + c] = r[i]; } b[n + c] = e[c]; });
  try { return denseSolve(A, b).slice(0, n); } catch (x) { return null; }
}
const f = (G, a, y) => { let s = 0; for (let i = 0; i < y.length; i++) { s += a[i] * y[i]; for (let j = 0; j < y.length; j++) s += 0.5 * y[i] * G[i][j] * y[j]; } return s; };
const rowsOf = (I) => I.map(({ c, b }) => ({ c: Float64Array.from(c), b }));

test('qp 1: the textbook problem (Nocedal and Wright, Numerical Optimization, example 16.4) ends at its known answer (1.4, 1.7)', () => {
  const G = [Float64Array.from([2, 0]), Float64Array.from([0, 2])], a = [-2, -5];
  const I = rowsOf([{ c: [1, -2], b: -2 }, { c: [-1, -2], b: -6 }, { c: [-1, 2], b: -2 }, { c: [1, 0], b: 0 }, { c: [0, 1], b: 0 }]);
  const y = flowInside(G, eqMin(G, a, [], []), [], I);
  assert.ok(y && Math.abs(y[0] - 1.4) < 1e-12 && Math.abs(y[1] - 1.7) < 1e-12, `${y}`);
});

test('qp 2: rows no point meets (y ≥ 1 and y ≤ 0) give no answer (null), never a point', () => {
  const G = [Float64Array.from([1])];
  assert.equal(flowInside(G, [0.5], [], rowsOf([{ c: [1], b: 1 }, { c: [-1], b: 0 }])), null);
});

test('qp 3: 300 random problems (4 unknowns, one equality, 6 rows) end where the best of every active set tried by brute force ends, or both find none', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  let met = 0, none = 0;
  for (let k = 0; k < 300; k++) {
    const n = 4, M = Array.from({ length: n }, () => Array.from({ length: n }, rnd));
    const G = Array.from({ length: n }, (_, i) => Float64Array.from({ length: n }, (__, j) => M.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? 0.5 : 0)));
    const a = Array.from({ length: n }, rnd), E = [Array.from({ length: n }, rnd)], e = [rnd()];
    const I = rowsOf(Array.from({ length: 6 }, () => ({ c: Array.from({ length: n }, rnd), b: rnd() + 0.3 })));
    let best = null;
    for (let mask = 0; mask < 64; mask++) {
      const S = I.filter((_, j) => mask & (1 << j)); if (S.length + 1 > n) continue;
      const y = eqMin(G, a, [...E, ...S.map((q) => Array.from(q.c))], [...e, ...S.map((q) => q.b)]);
      if (!y || I.some((q) => q.c.reduce((s, c, i) => s + c * y[i], 0) - q.b < -1e-9)) continue;
      if (!best || f(G, a, y) < f(G, a, best) - 1e-12) best = y;
    }
    const y = flowInside(G, eqMin(G, a, E, e), E.map((r) => Float64Array.from(r)), I);
    if (!best) { assert.equal(y, null, `problem ${k}: brute force finds none, flowInside ${y}`); none++; continue; }
    assert.ok(y, `problem ${k}: flowInside finds none, brute force ${best}`);
    assert.ok(Math.abs(f(G, a, y) - f(G, a, best)) < 1e-11 * Math.max(1, Math.abs(f(G, a, best))), `problem ${k}: ${f(G, a, y)} against ${f(G, a, best)}`);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(y[i] - best[i]) < 1e-7 * Math.max(1, Math.abs(best[i])), `problem ${k}: ${Array.from(y)} against ${best}`);
    met++;
  }
  assert.ok(met >= 150 && none >= 10, `met ${met}, none ${none}: the draw should give both`);
});
