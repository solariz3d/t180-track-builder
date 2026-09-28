// Tests for tools/spectrum.cjs (M1, docs/FINDINGS.md §7g): the Welch estimator and its summary numbers on signals whose
// spectrum is known. Run: node --test --test-concurrency=4 test/spectrum.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { welch, summary } = require('../tools/spectrum.cjs');

const N = 4000, DS = 4;
const lcg = (seed) => { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; }; };
test('a sine of a 128 m wavelength peaks at 128 m', () => {
  const x = Float64Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * i * DS) / 128));
  assert.strictEqual(summary(welch(x)).periodM, 128);
});
test('white noise falls off by about nothing (β ≈ 0), a random walk by about −2', () => {
  const R = lcg(7), white = Float64Array.from({ length: N }, R), walk = new Float64Array(N);
  for (let i = 1; i < N; i++) walk[i] = walk[i - 1] + R();
  assert.ok(Math.abs(summary(welch(white)).beta) < 0.3, `white β ${summary(welch(white)).beta}`);
  assert.ok(Math.abs(summary(welch(walk)).beta + 2) < 0.3, `walk β ${summary(welch(walk)).beta}`);
});
test('a signal shorter than one 1,024 m segment is refused, not estimated', () => {
  assert.throws(() => welch(new Float64Array(100)), /shorter than one segment/);
});
