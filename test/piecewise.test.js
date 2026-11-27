// Tests for tools/piecewise.cjs (D184: the track's line as piecewise equations fitted to the mesh), on SYNTHETIC
// geometry only: the B-spline basis, the constrained fit (G2 joints, closure), the cross-section walk (edges, the centre
// on the surface, a road above not captured), and the whole pipeline on a ring road with and without a jump.
// Run: node --test --test-concurrency=4 test/piecewise.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PW = require('../tools/piecewise.cjs');

// ── the basis ──
test('the cubic basis: a partition of unity, and its first and second derivatives agree with finite differences', () => {
  const U = PW.knotsOf(0, 100, [13, 30, 31, 57, 80]), h = 1e-4;
  for (const s of [0, 0.5, 12.9, 13, 30.5, 55, 79.99, 99.5, 100]) {
    const b = PW.basis(U, s);
    assert.ok(Math.abs(b.N.reduce((a, v) => a + v, 0) - 1) < 1e-12, `sum at ${s}`);
    if (s <= h || s >= 100 - h) continue;
    const f = (x) => { const q = PW.basis(U, x); const out = new Map(); q.N.forEach((v, j) => out.set(q.first + j, v)); return out; };
    const lo = f(s - h), hi = f(s + h), mid = f(s);
    b.N.forEach((_, j) => { const i = b.first + j, fd1 = ((hi.get(i) || 0) - (lo.get(i) || 0)) / (2 * h), fd2 = ((hi.get(i) || 0) - 2 * (mid.get(i) || 0) + (lo.get(i) || 0)) / (h * h);
      assert.ok(Math.abs(b.D1[j] - fd1) < 1e-5, `D1 at ${s}, fn ${i}: ${b.D1[j]} vs ${fd1}`);
      assert.ok(Math.abs(b.D2[j] - fd2) < 1e-2, `D2 at ${s}, fn ${i}: ${b.D2[j]} vs ${fd2}`); });
  }
});

// ── the constrained fit ──
const piece = (a, b, step) => { const inner = []; for (let t = a + step; t < b - 1e-9; t += step) inner.push(t); return { U: PW.knotsOf(a, b, inner) }; };
test('a G2 joint holds: value, slope and curvature agree at the joint to 1e-8, even over data with a kink there', () => {
  const P = [piece(0, 100, 20), piece(100, 200, 20)], rows = [];
  for (let s = 0; s <= 200; s += 2) rows.push({ piece: s <= 100 ? 0 : 1, s, values: [0.1 * Math.abs(s - 100)] });
  const fit = PW.fitSystem(P, rows, [{ a: { piece: 0, s: 100 }, b: { piece: 1, s: 100 }, orders: [0, 1, 2] }], 1);
  const A = PW.evalPiece(fit, P, 0, 0, 100), B = PW.evalPiece(fit, P, 1, 0, 100);
  assert.ok(Math.abs(A.v - B.v) < 1e-8 && Math.abs(A.d1 - B.d1) < 1e-8 && Math.abs(A.d2 - B.d2) < 1e-8, JSON.stringify({ A, B }));
});
test('closure: a self-closing piece ends where it began, to G2, with its data never forced to meet', () => {
  const L = 300, P = [piece(0, L, 30)], rows = [];
  for (let s = 0; s < L; s += 3) rows.push({ piece: 0, s, values: [Math.sin(2 * Math.PI * s / L) + 0.3 * s / L] });   // a drift of 0.3 that the closure must absorb
  const fit = PW.fitSystem(P, rows, [{ a: { piece: 0, s: L }, b: { piece: 0, s: 0 }, orders: [0, 1, 2] }], 1);
  const A = PW.evalPiece(fit, P, 0, 0, L), B = PW.evalPiece(fit, P, 0, 0, 0);
  assert.ok(Math.abs(A.v - B.v) < 1e-8 && Math.abs(A.d1 - B.d1) < 1e-8 && Math.abs(A.d2 - B.d2) < 1e-8, JSON.stringify({ A, B }));
});

// ── the cross-section walk ──
/** Triangles of a surface given by its cross-section profile (a function u → [x, y]) swept along z from z0 to z1. */
function swept(profile, uMin, uMax, du, z0, z1, dz) {
  const T = [];
  for (let z = z0; z < z1 - 1e-9; z += dz) for (let u = uMin; u < uMax - 1e-9; u += du) {
    const [a, b, c, d] = [[u, z], [u + du, z], [u + du, z + dz], [u, z + dz]].map(([uu, zz]) => { const [x, y] = profile(uu); return [x, y, zz]; });
    T.push([...a, ...b, ...c], [...a, ...c, ...d]);
  }
  return T;
}
const flat = (u) => [u, 0];
/** A half-pipe: a flat floor of 16 m, then walls of 8 m arc length whose angle rises linearly to 60°. */
function halfpipe(u) {
  const w = 8, L = 8, psi = 60 * Math.PI / 180, k = psi / L, a = Math.abs(u), sg = Math.sign(u) || 1;
  if (a <= w) return [u, 0];
  const t = Math.min(L, a - w), x = w + Math.sin(k * t) / k, y = (1 - Math.cos(k * t)) / k;
  return [sg * x, y];
}
test('a flat 20 m strip reads 20 m wide, its centre on the midline', () => {
  const ix = PW.rayIndex(swept(flat, -10, 10, 1, 0, 100, 2)), cs = PW.crossSection(ix, [0.3, 0, 50], [0, 0, 1], [0, 1, 0]);
  assert.ok(Math.abs(cs.width - 20) < 0.05 && Math.abs(cs.centre[0]) < 0.05, JSON.stringify({ w: cs.width, c: cs.centre }));
});
test('a half-pipe reads its width ALONG the surface (32 m), and its centre sits on the floor, not in the air between the rims', () => {
  const ix = PW.rayIndex(swept(halfpipe, -16, 16, 0.5, 0, 100, 2)), cs = PW.crossSection(ix, [0.4, 0, 50], [0, 0, 1], [0, 1, 0]);
  assert.ok(Math.abs(cs.width - 32) < 0.3, `width ${cs.width}`);
  assert.ok(Math.abs(cs.centre[0]) < 0.3 && Math.abs(cs.centre[1]) < 1e-6, `centre ${cs.centre}`);
});
test('a road 5 m above is not captured: the walk stays on the surface it started on (trap b)', () => {
  const T = [...swept(flat, -10, 10, 1, 0, 100, 2), ...swept((u) => [u, 5], -10, 10, 1, 0, 100, 2)];
  const cs = PW.crossSection(PW.rayIndex(T), [0, 0, 50], [0, 0, 1], [0, 1, 0]);
  assert.ok(Math.abs(cs.centre[1]) < 1e-6 && Math.abs(cs.width - 20) < 0.05, JSON.stringify({ c: cs.centre, w: cs.width }));
});

// ── the pipeline on a ring road ──
const R = 200;
function ringMesh(gapFrom = null, gapTo = null) {
  const T = [], n = 628, lanes = 10;
  for (let i = 0; i < n; i++) {
    const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n;
    if (gapFrom != null && a0 >= gapFrom && a1 <= gapTo) continue;
    for (let j = 0; j < lanes; j++) {
      const r0 = R - 10 + 2 * j, r1 = r0 + 2, P = (r, a) => [r * Math.sin(a), 0, r * Math.cos(a)];
      const A = P(r0, a0), B = P(r1, a0), C = P(r1, a1), D = P(r0, a1);
      T.push([...A, ...B, ...C], [...A, ...C, ...D]);
    }
  }
  return T;
}
function ringRead(gapFrom = null, gapTo = null) {
  const st = [], L = 2 * Math.PI * R;
  for (let d = 0, i = 0; d < L - 1e-6; d += 4, i++) {
    const a = d / R;
    if (gapFrom != null && a > gapFrom && a < gapTo) { if (!st.some((x) => x.jump)) st.push({ jump: true, d, gap_m: R * (gapTo - gapFrom), drop_m: 0 }); continue; }
    st.push({ d, c: [R * Math.sin(a), 0, R * Math.cos(a)], f: [Math.cos(a), 0, -Math.sin(a)], n: [0, 1, 0], k: -1 / R });
  }
  return { end: 'closed', stations: [...st, { closed: true, d: L }] };
}
test('a closed ring road: one self-closing piece, rebuilt within 5 m and 5° everywhere, and it closes', () => {
  const mc = PW.meshCentreline(ringRead(), PW.rayIndex(ringMesh())), t = PW.fitTrack(mc, { tol: 5 }), sum = PW.summarise(t, 5);
  assert.deepStrictEqual([sum.pieces, sum.jumps, sum.lineWithin5, sum.bankWithin5], [1, 0, 1, 1]);
  const P = t.pieces, end = [0, 1, 2].map((c) => PW.evalPiece(t.fitPos, P, 0, c, P[0].b).v), start = [0, 1, 2].map((c) => PW.evalPiece(t.fitPos, P, 0, c, P[0].a).v);
  assert.ok(Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) < 1e-6);
});
test('a ring road with a 40 m gap: split at the jump, rebuilt within tolerance, and the flight checked', () => {
  const g0 = 1.0, g1 = 1.0 + 40 / R, mc = PW.meshCentreline(ringRead(g0, g1), PW.rayIndex(ringMesh(g0, g1))), t = PW.fitTrack(mc, { tol: 5 }), sum = PW.summarise(t, 5);
  assert.deepStrictEqual([sum.pieces, sum.jumps, sum.lineWithin5, sum.bankWithin5], [1, 1, 1, 1]);
  const j = PW.jumpChecks(t, mc);
  assert.strictEqual(j.length, 1);
  assert.ok(j[0].gapM > 30 && j[0].gapM < 50, JSON.stringify(j));
});

test('a row with no value moves nothing: the fit with null rows added equals the fit without them', () => {
  const P = [piece(0, 100, 20)], rows = [];
  for (let s = 0; s <= 100; s += 2) rows.push({ piece: 0, s, values: [5 + Math.sin(s / 10)] });
  const nul = rows.map((r) => ({ ...r, s: r.s + 1 > 100 ? 99.5 : r.s + 1, values: [null] }));
  const a = PW.fitSystem(P, rows, [], 1), b = PW.fitSystem(P, [...rows, ...nul], [], 1);
  assert.ok(a.x[0].every((v, i) => Math.abs(v - b.x[0][i]) < 1e-12), 'null rows changed the fit');
});

test('the banded Cholesky solves a symmetric banded system exactly as a dense solve does', () => {
  const n = 40, bw = 3, M = Array.from({ length: n }, () => new Array(n).fill(0));
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < n; i++) for (let j = Math.max(0, i - bw); j <= i; j++) { const v = i === j ? 10 + rnd() : rnd(); M[i][j] = v; M[j][i] = v; }
  const B = M.map((r, i) => Array.from({ length: bw + 1 }, (_, j) => (i - j >= 0 ? r[i - j] : 0))), b = Array.from({ length: n }, rnd);
  const x = PW.bandChol(B, bw)(b), r = M.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
  assert.ok(r.every((v, i) => Math.abs(v - b[i]) < 1e-10), 'M x = b');
});

test('the rotation-minimising frame (double reflection) on a planar circle keeps its up vector the plane\'s normal', () => {
  const R = 50, N = 200, xs = [], ts = [];
  for (let i = 0; i <= N; i++) { const a = (2 * Math.PI * i) / N; xs.push([R * Math.sin(a), 0, R * Math.cos(a)]); ts.push([Math.cos(a), 0, -Math.sin(a)]); }
  const r = PW.rmf(xs, ts, [0, 1, 0]);
  assert.ok(r.every((v) => Math.abs(v[1] - 1) < 1e-9), 'stays (0, 1, 0)');
});

// ── the down-ray re-read (a station on a lower layer of cupped road) ──
/** A cupped road: a flat floor of 10 m whose sides rise linearly to 50° over 4 m of arc (18 m along the surface). */
function cupped(u) {
  const w = 5, L = 4, psi = 50 * Math.PI / 180, k = psi / L, a = Math.abs(u), sg = Math.sign(u) || 1;
  if (a <= w) return [u, 0];
  const t = Math.min(L, a - w), x = w + Math.sin(k * t) / k, y = (1 - Math.cos(k * t)) / k;
  return [sg * x, y];
}
// The layer under it is a 2 m strip 1.5 m down (measured on a real lap: the read's station sat 1.5 m under the top, and the
// cross-section walked the strip). The read itself says the road is 18 wide.
const stacked = () => [...swept(cupped, -9, 9, 0.5, 0, 100, 2), ...swept((u) => [u, -1.5], -1, 1, 0.5, 0, 100, 2)];
const stackedRead = (width) => { const st = []; for (let z = 4; z <= 96; z += 4) st.push({ d: z, c: [0.2, -1.5, z], f: [0, 0, 1], n: [0, 1, 0], k: 0, width }); return { end: 'limit', stations: st }; };
test('a station on a narrow layer under cupped road is re-read by down-rays: the full width, the centre on the top surface', () => {
  const mc = PW.meshCentreline(stackedRead(18), PW.rayIndex(stacked()));
  assert.strictEqual(mc.missing, 0);
  for (const x of mc.st) {
    assert.ok(Math.abs(x.w - 18) < 0.5, `width ${x.w.toFixed(2)} at d ${x.d}`);
    assert.ok(Math.abs(x.p[1]) < 1e-6 && Math.abs(x.p[0]) < 0.3, `centre ${x.p} at d ${x.d}`);
  }
  assert.strictEqual(mc.reread, mc.st.length);
});
test('the re-read does not take a road 5 m above, and leaves a read with no width of its own as the cross-section found it', () => {
  const above = [...stacked(), ...swept((u) => [u, 3.5], -10, 10, 1, 0, 100, 2)];
  const mc = PW.meshCentreline(stackedRead(18), PW.rayIndex(above));
  assert.ok(mc.st.every((x) => Math.abs(x.p[1]) < 1e-6), 'a station moved onto the road above');
  const bare = PW.meshCentreline(stackedRead(undefined), PW.rayIndex(stacked()));
  assert.ok(bare.st.every((x) => Math.abs(x.w - 2) < 0.1), 'without a read width there is nothing to call narrow');
  assert.strictEqual(bare.reread, 0);
});

// Banked cupped road wider than a fixed height window (pane C's read of dab271b, 2026-11-26, its cases A): the band was cast from 8 m over the station to 3 m
// under it, so on a banked road it stopped where the surface left that window (about window / sin(bank) along it) and its centre moved uphill. The window now
// moves with the band, and its step across is refined at steep sides and edges. A cupped road (a floor, 4 m sides rising to 50°, or 30° at
// the 52° bank, where 50° sides would turn past vertical: rays from above cannot read an overhang) of width W, banked, the read's station on a 2 m strip 1.5 m under the top.
const rotB = (b) => ([x, y]) => [x * Math.cos(b) - y * Math.sin(b), x * Math.sin(b) + y * Math.cos(b)];
const cupW = (W, psiDeg) => (u) => { const half = W / 2 - 4, k = (psiDeg * Math.PI / 180) / 4, a = Math.abs(u), sg = Math.sign(u) || 1; if (a <= half) return [u, 0];
  const t = Math.min(4, a - half); return [sg * (half + Math.sin(k * t) / k), (1 - Math.cos(k * t)) / k]; };
for (const [bankDeg, W, psiDeg] of [[20, 27, 50], [20, 49, 50], [40, 38, 50], [52, 49, 30]]) {
  test(`banked ${bankDeg}°, ${W} m wide, sides rising to ${psiDeg}°: the re-read band follows the surface past a fixed height window, the full width, the centre on the top's centre`, () => {
    const R = rotB(bankDeg * Math.PI / 180), prof = (u) => R(cupW(W, psiDeg)(u)), c0 = R([0.2, -1.5]), n0 = R([0, 1]);
    const T = [...swept(prof, -W / 2, W / 2, 0.5, 0, 100, 2), ...swept((u) => R([u, -1.5]), -1, 1, 0.5, 0, 100, 2)], st = [];
    for (let z = 8; z <= 92; z += 4) st.push({ d: z, c: [c0[0], c0[1], z], f: [0, 0, 1], n: [n0[0], n0[1], 0], k: 0, width: W });
    const mc = PW.meshCentreline({ end: 'limit', stations: st }, PW.rayIndex(T));
    assert.strictEqual(mc.reread, mc.st.length);
    for (const x of mc.st) {
      assert.ok(Math.abs(x.w - W) <= 0.5, `width ${x.w.toFixed(2)} at d ${x.d}`);
      assert.ok(Math.hypot(x.p[0], x.p[1]) <= 0.3, `centre ${x.p[0].toFixed(2)}, ${x.p[1].toFixed(2)} off the top's centre at d ${x.d}`);
    }
  });
}
test('the band stops at its edge where the next layer is a step of more than 1 m (a lower road beside it), and does not walk onto it', () => {
  // flat road 20 m wide at y 0, the station on a strip 1.5 m under it; beside its right edge a second road 2.5 m lower, 20 m wide, inside the height window
  const T = [...swept(flat, -10, 10, 0.5, 0, 100, 2), ...swept((u) => [u, -1.5], -1, 1, 0.5, 0, 100, 2), ...swept((u) => [u, -2.5], 10, 30, 0.5, 0, 100, 2)], st = [];
  for (let z = 8; z <= 92; z += 4) st.push({ d: z, c: [0.2, -1.5, z], f: [0, 0, 1], n: [0, 1, 0], k: 0, width: 20 });
  const mc = PW.meshCentreline({ end: 'limit', stations: st }, PW.rayIndex(T));
  assert.strictEqual(mc.reread, mc.st.length);
  for (const x of mc.st) assert.ok(Math.abs(x.w - 20) <= 0.5 && Math.abs(x.p[0]) <= 0.3 && Math.abs(x.p[1]) < 1e-6, `width ${x.w.toFixed(2)}, centre ${x.p[0].toFixed(2)}, ${x.p[1].toFixed(2)} at d ${x.d}`);
});

// ── the landing guard (a jump that lands on road already driven) ──
test('a jump whose landing lies on road the read already took ends the line at the take-off, and says where it landed', () => {
  // a straight out along +z with a flat road the whole way; the read jumps at z 200 and "lands" back at z 120, on road it drove
  const T = swept(flat, -10, 10, 1, -10, 410, 2), st = [];
  for (let z = 0; z <= 200; z += 4) st.push({ d: z, c: [0, 0, z], f: [0, 0, 1], n: [0, 1, 0], k: 0 });
  st.push({ jump: true, d: 200, gap_m: 80, drop_m: 0 });
  for (let z = 120, d = 280; z >= 0; z -= 4, d += 4) st.push({ d, c: [0, 0, z], f: [0, 0, -1], n: [0, 1, 0], k: 0 });
  const mc = PW.meshCentreline({ end: 'limit', stations: st }, PW.rayIndex(T));
  assert.strictEqual(mc.st[mc.st.length - 1].d, 200, 'the line runs past the take-off');
  assert.strictEqual(mc.falseLandings.length, 1);
  assert.deepStrictEqual([mc.falseLandings[0].d, mc.falseLandings[0].landingD, mc.falseLandings[0].onD], [200, 280, 120]);
});
test('a jump that lands on new road is kept as it was', () => {
  const g0 = 1.0, g1 = 1.0 + 40 / R, mc = PW.meshCentreline(ringRead(g0, g1), PW.rayIndex(ringMesh(g0, g1)));
  assert.deepStrictEqual([mc.jumps.length, mc.falseLandings.length], [1, 0]);
});
