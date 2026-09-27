// geom_path.test.js: node --test test/geom_path.test.js. The centreline and its rotation-minimising frame.
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
test('closure: a NON-planar closed loop closes in frame too, because its closing twist is spread along the loop', () => {
  // twistLoop closes in heading and pitch exactly, in position only to ~0.1 m (see the fixture), hence closeTol
  const p = G.buildPath(F.twistLoop(), { closed: true, step: 0.5, closeTol: 0.5 });
  const a = first(p), b = last(p);
  assert.ok(Math.abs(p.twist) > 1e-3, `the fixture must carry a real twist to spread, got ${p.twist}`);
  for (const k of ['T', 'L', 'U']) assert.ok(len(sub(a[k], b[k])) < 1e-9, `${k} gap ${len(sub(a[k], b[k]))}`);
});
test('RMF: twist is zero on a planar curve, and the frame stays level (|L·Y| < 1e-9 everywhere)', () => {
  const p = G.buildPath(F.stadium(), { closed: true, step: 0.5 });
  assert.ok(Math.abs(p.twist) < 1e-9, `twist ${p.twist}`);
  for (const s of p.samples) assert.ok(Math.abs(s.L[1]) < 1e-9, `L tilts at s=${s.s}: ${s.L[1]}`);
});
test('RMF: on an open non-planar curve the frame does not spin about T (spin under 1e-3 of its own turning rate)', () => {
  const p = G.buildPath(F.twistLoop(), { closed: false, step: 0.25 });
  let worst = 0;
  for (let i = 1; i < p.samples.length; i++) {
    const a = p.samples[i - 1], b = p.samples[i], ds = b.s - a.s;
    // central difference: against the mid-step U (the start-of-step U carries an O(ds·κ²) bias of its own)
    const um = [(a.U[0] + b.U[0]) / 2, (a.U[1] + b.U[1]) / 2, (a.U[2] + b.U[2]) / 2];
    worst = Math.max(worst, Math.abs(dot(sub(b.L, a.L), um)) / ds);
  }
  const kmax = Math.max(...p.samples.map((x) => len(x.kvec)));
  assert.ok(worst < 1e-3 * kmax, `frame spin ${worst} rad/m against the frame's turning rate ${kmax} rad/m`);
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
