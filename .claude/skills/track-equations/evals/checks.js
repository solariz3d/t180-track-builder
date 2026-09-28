// checks.js: the track-equations skill's KNOWN-ANSWER checks (D184, pane C). Not a test file itself: known_answers.test.js
// runs each against mathref.cjs, and mutation.test.js runs all of them against mutated copies (each mutant must be caught by a
// check that passes on the original). Every check names the reference section it holds to account, and every answer is
// known in closed form. The discrete curvature on meshes is tools/meshcurv.cjs (the M3/M3b instrument), read from the repo.
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const { curvature: meshCurvature, smoothK } = require(path.join(REPO, 'tools', 'meshcurv.cjs'));

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} (±${tol})`);
const TAU = 2 * Math.PI;

// ── meshes with known curvature (closed ones share their seam vertices, so every vertex is interior) ──
// EXPORTED as `require('./checks.js').meshes`, with named parameters, so a session re-running a check builds the SAME mesh the
// check builds. Each check's own parameters and averaging radius are exported beside them as `.params`. Every mesh is
// [{ pos: Float64Array, idx: Uint32Array }], the shape tools/meshcurv.cjs reads. Units are metres and radians; world up is +y.
function sphere(R, nu = 48, nv = 24) {
  const pos = [0, R, 0], idx = [];
  for (let j = 1; j < nv; j++) { const phi = Math.PI * j / nv; for (let i = 0; i < nu; i++) { const th = TAU * i / nu; pos.push(R * Math.sin(phi) * Math.cos(th), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(th)); } }
  pos.push(0, -R, 0); const N = 1 + (nv - 1) * nu, at = (j, i) => 1 + (j - 1) * nu + ((i % nu) + nu) % nu;
  for (let i = 0; i < nu; i++) idx.push(0, at(1, i + 1), at(1, i));
  for (let j = 1; j < nv - 1; j++) for (let i = 0; i < nu; i++) idx.push(at(j, i), at(j, i + 1), at(j + 1, i + 1), at(j, i), at(j + 1, i + 1), at(j + 1, i));
  for (let i = 0; i < nu; i++) idx.push(N, at(nv - 1, i), at(nv - 1, i + 1));
  return [{ pos: Float64Array.from(pos), idx: Uint32Array.from(idx) }];
}
// a near-SQUARE grid by default: the angle defect converges to K only on regular meshes (references/06 §5)
function torus(R, r, nu = Math.round(48 * (R + r) / r), nv = 48) {
  const pos = [], idx = [], vs = [], at = (i, j) => ((i % nu) + nu) % nu * nv + ((j % nv) + nv) % nv;
  for (let i = 0; i < nu; i++) { const u = TAU * i / nu; for (let j = 0; j < nv; j++) { const v = TAU * j / nv; pos.push((R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)); vs.push(v); } }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  return { mesh: [{ pos: Float64Array.from(pos), idx: Uint32Array.from(idx) }], vs };
}
function sweep(rad, h0, h1, nu = 64, nh = 20, span = Math.PI) {
  const pos = [], idx = [], at = (i, j) => i * (nh + 1) + j;
  for (let i = 0; i <= nu; i++) { const a = span * i / nu; for (let j = 0; j <= nh; j++) { const h = h0 + (h1 - h0) * j / nh, r = rad(h); pos.push(r * Math.cos(a), r * Math.sin(a), h); } }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nh; j++) idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  return [{ pos: Float64Array.from(pos), idx: Uint32Array.from(idx) }];
}
// A dished road corner banked into its turn (references/06 §6): a horizontal turn of radius Rh, a cross-section of curvature
// dpsi across a width W, banked by beta toward the turn's centre, over an angle span of the turn.
function dishedCorner(Rh, beta, dpsi, W = 30, span = 0.4, nu = 120, nw = 40) {
  const pos = [], idx = [], at = (i, j) => i * (nw + 1) + j;
  for (let i = 0; i <= nu; i++) { const a = span * (i / nu - 0.5); for (let j = 0; j <= nw; j++) { const w = W * (j / nw - 0.5);
    const X = Math.sin(dpsi * w) / dpsi, Y = (1 - Math.cos(dpsi * w)) / dpsi;                 // the dish: X toward the turn's inside, Y up
    const lx = X * Math.cos(beta) + Y * Math.sin(beta), ly = -X * Math.sin(beta) + Y * Math.cos(beta);   // banked INTO the turn
    const rr = Rh - lx; pos.push(rr * Math.cos(a), ly, rr * Math.sin(a)); } }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nw; j++) idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  return [{ pos: Float64Array.from(pos), idx: Uint32Array.from(idx) }];
}
// The parameters each surface check uses, named. smoothRadius is the ball radius (m) the angle defect is averaged over
// (meshcurv's smoothK); null means the check reads the raw defect or its sums, never a smoothed value.
const P = {
  sphere: { R: 5, nu: 48, nv: 24, smoothRadius: 1, awayFromPoles: 0.6, tolerance: 0.05 },
  cylinder: { r: 8, h0: 0, h1: 10, smoothRadius: null },
  cone: { r0: 2, slope: 0.5, h0: 0, h1: 10, smoothRadius: null },
  torus: { R: 10, r: 3, nu: 208, nv: 48, smoothRadius: null },
  gaussBonnet: { sphereR: 3, torusR: 10, torusr: 3, smoothRadius: null },
  dishedCorner: { Rh: 200, beta: 0.5, dpsi: 0.01, W: 30, span: 0.4, nu: 120, nw: 40, smoothRadius: 6, tolerance: 0.25 },
};
const interior = (c, K) => { const out = []; for (let i = 0; i < c.nV; i++) if (c.interior[i]) out.push({ i, K: K[i], p: [c.P[i * 3], c.P[i * 3 + 1], c.P[i * 3 + 2]] }); return out; };

module.exports = [
  // ── 01 centreline ──
  { section: '01 §1', name: 'Möller–Trumbore: a ray through a triangle hits at the right t and barycentrics; outside, parallel or behind is a miss', run(M) {
    const a = [0, 0, 0], b = [2, 0, 0], c = [0, 0, 2], down = [0, -1, 0];
    const h = M.rayTriangle([0.5, 3, 0.5], down, a, b, c); assert.ok(h); close(h.t, 3, 1e-12); close(h.u, 0.25, 1e-12); close(h.v, 0.25, 1e-12);
    assert.equal(M.rayTriangle([1.6, 3, 1.6], down, a, b, c), null, 'outside (u + v > 1)');
    assert.equal(M.rayTriangle([0.5, 3, 0.5], [1, 0, 0], a, b, c), null, 'parallel');
    assert.equal(M.rayTriangle([0.5, -3, 0.5], down, a, b, c), null, 'behind the origin');
  } },
  { section: '01 §2', name: 'of stacked road hits, the one nearest the previous station\'s height is taken, not the first', run(M) {
    assert.deepEqual(M.nearestHit([[0, 40, 0], [0, 12, 0], [0, -30, 0]], 10), [0, 12, 0]);
  } },
  { section: '01 §3', name: 'the centre is the midpoint of the left and right edges', run(M) {
    assert.deepEqual(M.midpoint([-15, 1, 4], [15, 3, 4]), [0, 2, 4]);
  } },
  // ── 02 curvature and curve functions ──
  { section: '02 §1', name: 'curvature from position: a circle 1/R, a line 0, a helix a/(a² + b²)', run(M) {
    const R = 40, t = 0.7; close(M.curvature([-R * Math.sin(t), 0, R * Math.cos(t)], [-R * Math.cos(t), 0, -R * Math.sin(t)]), 1 / R, 1e-15, 'circle');
    close(M.curvature([1, 2, 3], [0, 0, 0]), 0, 1e-15, 'line');
    const a = 5, b = 3; close(M.curvature([-a * Math.sin(t), b, a * Math.cos(t)], [-a * Math.cos(t), 0, -a * Math.sin(t)]), a / (a * a + b * b), 1e-15, 'helix');
  } },
  { section: '02 §2', name: 'the tangent is a unit vector; heading 0 is +z, heading 90° is +x, pitch 90° is up', run(M) {
    for (const [t, p] of [[0.3, 0.2], [2, -1]]) close(Math.hypot(...M.tangent(t, p)), 1, 1e-15);
    close(M.tangent(0, 0)[2], 1, 1e-15); close(M.tangent(Math.PI / 2, 0)[0], 1, 1e-15); close(M.tangent(0.7, Math.PI / 2)[1], 1, 1e-15);
  } },
  { section: '02 §2', name: 'a constant heading rate 1/R for 2πR rebuilds a circle of radius R that closes, net heading 2π', run(M) {
    const R = 50, r = M.rebuild(() => 1 / R, () => 0, TAU * R, 4000);
    close(Math.hypot(...r.pts.at(-1)), 0, 1e-6 * R, 'closes'); close(r.theta, TAU, 1e-9);
    for (const p of r.pts.filter((_, i) => i % 400 === 0)) close(Math.hypot(p[0] - R, p[1], p[2]), R, 1e-6 * R, 'radius');
  } },
  { section: '02 §3', name: 'a circle\'s heading rate, read back from its points, is 1/R', run(M) {
    const R = 80, r = M.rebuild(() => 1 / R, () => 0, TAU * R, 3000);
    for (const i of [10, 1500]) close(M.discreteCurvature(r.pts[i - 1], r.pts[i], r.pts[i + 1]), 1 / R, 1e-6 / R);
  } },
  { section: '02 §4', name: 'a clothoid\'s κ is linear in s, reaching 1/R at L with A² = R·L; the smoothstep ramp\'s steepest slope is 1.5 at ½', run(M) {
    const R = 500, L = 4000, A = Math.sqrt(R * L); close(M.clothoidKappa(L, A), 1 / R, 1e-15);
    const k = [0, 0.25, 0.5, 0.75, 1].map((f) => M.clothoidKappa(f * L, A)); for (let i = 2; i < 5; i++) close(k[i] - 2 * k[i - 1] + k[i - 2], 0, 1e-18);
    const h = 1e-6; close(M.smoothstep(0), 0, 0); close(M.smoothstep(1), 1, 1e-15); close((M.smoothstep(0.5 + h) - M.smoothstep(0.5 - h)) / (2 * h), 1.5, 1e-8);
    close((M.smoothstep(h) - M.smoothstep(0)) / h, 0, 1e-5, 'flat start');
  } },
  // ── 03 B-splines ──
  { section: '03 §1', name: 'cubic B-spline basis: partition of unity, and each function is zero outside its 4 spans', run(M) {
    const t = M.clampedKnots(10, [2.5, 5, 7.5]), n = t.length - 4;
    for (const x of [0, 1.3, 5, 9.2]) close(Array.from({ length: n }, (_, i) => M.bspline(i, 3, t, x)).reduce((a, b) => a + b, 0), 1, 1e-14, `Σ at ${x}`);
    for (let i = 0; i < n; i++) for (const x of [0.1, 3, 6, 9.9]) if (x < t[i] || x >= t[i + 4]) close(M.bspline(i, 3, t, x), 0, 0, `B${i} at ${x}`);
  } },
  { section: '03 §2', name: 'a least-squares cubic B-spline fit reproduces a cubic polynomial exactly', run(M) {
    const t = M.clampedKnots(10, [2.5, 5, 7.5]), s = Array.from({ length: 101 }, (_, i) => i / 10), y = s.map((x) => x ** 3 - 2 * x + 1), c = M.fitBspline(s, y, t);
    for (const x of [0, 3.33, 10]) close(M.evalBspline(c, t, x), x ** 3 - 2 * x + 1, 1e-6, `at ${x}`);
  } },
  { section: '03 §3', name: 'knot refinement adds a midpoint knot only where the error exceeds the tolerance', run(M) {
    const t = M.clampedKnots(10, [5]), s = [1, 2, 6, 8], err = [0.1, 0.2, 3, 0.1], t2 = M.refineKnots(t, s, err, 1);
    assert.deepEqual(t2.slice(4, -4), [5, 7.5]);
  } },
  // ── 04 least squares, joints, closure ──
  { section: '04 §1', name: 'least squares recovers an exact line from its samples', run(M) {
    const A = [[1, 0], [1, 1], [1, 2], [1, 3]], x = M.lstsq(A, [1, 3, 5, 7]); close(x[0], 1, 1e-12); close(x[1], 2, 1e-12);
  } },
  { section: '04 §2', name: 'KKT: two cubic pieces fitted to data meet at their joint in value, slope AND curvature (G2), as constrained', run(M) {
    // piece 1 on [0,1], piece 2 on [1,2], each a cubic c0 + c1 s + c2 s² + c3 s³ in its own coordinate s ∈ [0, 1]
    const row = (s, piece) => { const r = Array(8).fill(0); [1, s, s * s, s ** 3].forEach((v, k) => { r[piece * 4 + k] = v; }); return r; };
    const A = [], b = []; for (let i = 0; i <= 20; i++) { const s = i / 20; A.push(row(s, 0)); b.push(Math.sin(s)); A.push(row(s, 1)); b.push(Math.sin(1 + s) + 0.3); }
    const C = [[1, 1, 1, 1, -1, 0, 0, 0], [0, 1, 2, 3, 0, -1, 0, 0], [0, 0, 2, 6, 0, 0, -2, 0]], x = M.kkt(A, b, C, [0, 0, 0]);
    const v1 = x[0] + x[1] + x[2] + x[3], d1 = x[1] + 2 * x[2] + 3 * x[3], dd1 = 2 * x[2] + 6 * x[3];
    close(v1, x[4], 1e-10, 'G0'); close(d1, x[5], 1e-10, 'G1'); close(dd1, 2 * x[6], 1e-10, 'G2');
    const free = M.lstsq(A, b); assert.ok(Math.abs(free[0] + free[1] + free[2] + free[3] - free[4]) > 0.1, 'unconstrained, the pieces would NOT meet (so the test means something)');
  } },
  { section: '04 §2', name: 'KKT closure: a fitted cubic constrained to end where it starts, and with the same slope, does', run(M) {
    const A = [], b = []; for (let i = 0; i <= 30; i++) { const s = i / 30; A.push([1, s, s * s, s ** 3]); b.push(s * 2 + 0.1 * Math.cos(9 * s)); }
    const x = M.kkt(A, b, [[0, 1, 1, 1], [0, 0, 2, 3]], [0, 0]);
    close(x[1] + x[2] + x[3], 0, 1e-10, 'end = start'); close(2 * x[2] + 3 * x[3], 0, 1e-10, 'slope(1) = slope(0)');
  } },
  { section: '04 §3', name: 'least-norm: J δ = −r, δ orthogonal to J\'s null space; weighted, no dearer than any feasible step', run(M) {
    const J = [[1, 2, 0, -1], [0, 1, 3, 1]], r = [0.5, -1.25], d = M.leastNorm(J, r);
    J.forEach((row, a) => close(row.reduce((s, x, j) => s + x * d[j], 0), -r[a], 1e-12));
    for (const v of [[6, -3, 1, 0], [3, -1, 0, 1]]) { J.forEach((row) => close(row.reduce((s, x, j) => s + x * v[j], 0), 0, 1e-12, 'null basis')); close(v.reduce((s, x, j) => s + x * d[j], 0), 0, 1e-12, 'δ ⟂ null'); }
    const w = [1, 4, 9], dw = M.leastNorm([[1, 1, 1]], [3], w), cost = (x) => x.reduce((s, v, j) => s + w[j] * v * v, 0);
    close(dw.reduce((s, x) => s + x, 0), -3, 1e-12); for (const alt of [[-3, 0, 0], [-1, -1, -1]]) assert.ok(cost(dw) <= cost(alt) + 1e-12);
  } },
  { section: '04 §3', name: 'a perturbed loop starts open and closes to < 1e-9·L under least-norm Newton steps', run(M) {
    const L = 1000, out = M.closeLoop([[0.3, -0.2], [0.1, 0.05]], L, { n: 1000, iters: 25, eps: 1e-10 });
    assert.ok(out.residual[0] > 1); assert.ok(out.residual.at(-1) < 1e-9 * L, `closure error ${out.residual.at(-1)}`);
  } },
  // ── 05 flight ──
  { section: '05 §1', name: 'a projectile on level ground lands at v²·sin2θ/g after 2v·sinθ/g, and conserves ½v² + g·y', run(M) {
    const v = 150, th = 0.15, g = 9.81, v0 = [v * Math.cos(th), v * Math.sin(th), 0], T = 2 * v * Math.sin(th) / g, p = M.projectile([0, 0, 0], v0, g, T);
    close(p[1], 0, 1e-9, 'lands at y 0'); close(p[0], v * v * Math.sin(2 * th) / g, 1e-9, 'range');
    for (const t of [0.3, 1.1, T]) { const vy = v0[1] - g * t, e = 0.5 * (v0[0] ** 2 + vy * vy) + g * M.projectile([0, 0, 0], v0, g, t)[1]; close(e, 0.5 * v * v, 1e-9, 'energy'); }
  } },
  { section: '05 §2', name: 'the time to come down to a landing height is the later root; the arc passes through that height then', run(M) {
    const y0 = 20, vy = 5, g = 9.81, yl = 6, t = M.timeToHeight(y0, vy, g, yl);
    close(y0 + vy * t - 0.5 * g * t * t, yl, 1e-12); assert.ok(t > vy / g, 'after the apex');
  } },
  // ── 06 surfaces ──
  { section: '06 §2', name: 'a sphere has K = 1/R² (angle defect smoothed over 1 m, away from the poles)', run(M) {
    const { R, nu, nv, smoothRadius, awayFromPoles, tolerance } = P.sphere;
    const c = meshCurvature(sphere(R, nu, nv)), K = smoothK(c, smoothRadius), eq = interior(c, K).filter((v) => Math.abs(v.p[1]) < awayFromPoles * R);
    assert.ok(eq.length > 200); for (const v of eq) close(v.K, M.sphereK(R), tolerance * M.sphereK(R), 'K');
  } },
  { section: '06 §2', name: 'a cylinder and a cone have zero angle defect at every interior vertex (K = 0)', run() {
    const cy = P.cylinder, co = P.cone;
    for (const mesh of [sweep(() => cy.r, cy.h0, cy.h1), sweep((h) => co.r0 + co.slope * h, co.h0, co.h1)]) { const c = meshCurvature(mesh), iv = interior(c, c.delta); assert.ok(iv.length > 500); for (const v of iv) close(v.K, 0, 1e-9); }
  } },
  // Integrated, not per vertex: the angle defect summed around each ring of vertices (one tube angle v) equals ∫K dA over that
  // ring's band (discrete Gauss–Bonnet is exact for sums). The per-vertex K̄ was 8.7% off at v 0.52 on this very mesh, even on a
  // near-square grid: the triangulation biases how the defect is SHARED between vertices (references/06 §5), not its total.
  { section: '06 §3', name: 'a torus has K = cos v/(r(R + r cos v)): each ring\'s summed angle defect equals ∫K dA over its band', run(M) {
    const { R, r, nu, nv } = P.torus, { mesh, vs } = torus(R, r, nu, nv), c = meshCurvature(mesh), dv = TAU / nv;
    const ring = new Map(); for (let i = 0; i < c.nV; i++) ring.set(vs[i], (ring.get(vs[i]) || 0) + c.delta[i]);
    const band = (v) => { let s = 0; const n = 64, h = dv / n; for (let k = 0; k <= n; k++) { const x = v - dv / 2 + k * h, w = k === 0 || k === n ? 1 : k % 2 ? 4 : 2; s += w * M.torusK(x, R, r) * r * (R + r * Math.cos(x)); } return TAU * s * h / 3; };
    const top = band(0); for (const [v, sum] of ring) close(sum, band(v), 0.01 * top, `ring at v ${v.toFixed(2)}`);
    assert.ok(band(0) > 0 && band(Math.PI) < 0, 'positive outside, negative inside');
  } },
  { section: '06 §4', name: 'Gauss–Bonnet (Descartes): angle defects of a closed mesh sum to exactly 2πχ (sphere 4π, torus 0)', run() {
    const g = P.gaussBonnet;
    for (const [mesh, chi] of [[sphere(g.sphereR), 2], [torus(g.torusR, g.torusr).mesh, 0]]) { const c = meshCurvature(mesh); let s = 0; for (let i = 0; i < c.nV; i++) s += c.delta[i]; close(s, TAU * chi, 1e-9, `χ ${chi}`); }
  } },
  { section: '06 §6', name: 'DERIVED: a dished corner banked into its turn is elliptic, K ≈ κh·sin β·dψ/du at its centre (within 25%)', run(M) {
    const { Rh, beta, dpsi, W, span, nu, nw, smoothRadius, tolerance } = P.dishedCorner;
    const c = meshCurvature(dishedCorner(Rh, beta, dpsi, W, span, nu, nw)), K = smoothK(c, smoothRadius), iv = interior(c, K);
    const d = (v) => Math.abs(v.p[2]) + Math.abs(Math.hypot(v.p[0], v.p[2]) - Rh), mid = iv.reduce((b, v) => (d(v) < d(b) ? v : b));
    const want = M.dishedCornerK(1 / Rh, beta, dpsi); assert.ok(mid.K > 0, `elliptic (${mid.K})`); close(mid.K, want, tolerance * want);
  } },
  { section: '06 §7', name: 'a frictionless particle on a surface conserves ½v² + g·y; over a crest it lifts off exactly when v² > gR', run(M) {
    const bowl = (x, z) => ({ f: 0.01 * x * x + 0.02 * z * z, fx: 0.02 * x, fz: 0.04 * z, fxx: 0.02, fxz: 0, fzz: 0.04 });
    const out = M.particleOnGraph(bowl, [30, -10, -5, 8], { h: 2e-3, steps: 5000 }), E = (p) => 0.5 * (p.vx ** 2 + p.vy ** 2 + p.vz ** 2) + 9.81 * p.y, e0 = E(out[0]);
    for (const p of out) close(E(p), e0, 1e-6 * Math.abs(e0) + 1e-6, 'energy');
    const R = 100, crest = (x) => ({ f: -x * x / (2 * R), fx: -x / R, fz: 0, fxx: -1 / R, fxz: 0, fzz: 0 }), N = (v) => M.particleOnGraph(crest, [0, 0, v, 0], { steps: 0 })[0].N;
    close(N(20), 9.81 - 4, 1e-12); assert.ok(N(Math.sqrt(9.81 * R) * 0.99) > 0); assert.ok(N(Math.sqrt(9.81 * R) * 1.01) < 0);
  } },
  // ── 07 Fourier ──
  { section: '07 §1', name: 'a Fourier fit of cos(3·2πs/L) gives a₃ = 1; a square wave (a jump) gives b_k = 4/(πk) on odd k: 1/k decay', run(M) {
    const f = Array.from({ length: 256 }, (_, i) => Math.cos(TAU * 3 * i / 256)), c = M.fourierFit(f, 6);
    close(c.a[3], 1, 1e-12); for (let k = 1; k <= 6; k++) { if (k !== 3) close(c.a[k], 0, 1e-12); close(c.b[k], 0, 1e-12); }
    const sq = Array.from({ length: 4096 }, (_, i) => (i < 2048 ? 1 : -1)), q = M.fourierFit(sq, 7);
    for (const k of [1, 3, 5, 7]) close(q.b[k], 4 / (Math.PI * k), 2e-3); for (const k of [2, 4, 6]) close(q.b[k], 0, 1e-9);
  } },
];

// The known meshes, with named parameters (defaults = what the checks use), and each check's parameters. module.exports stays
// the array of checks, so the runners are unchanged; these ride on it as properties.
module.exports.meshes = {
  sphere: ({ R = P.sphere.R, nu = P.sphere.nu, nv = P.sphere.nv } = {}) => sphere(R, nu, nv),
  cylinder: ({ r = P.cylinder.r, h0 = P.cylinder.h0, h1 = P.cylinder.h1 } = {}) => sweep(() => r, h0, h1),
  cone: ({ r0 = P.cone.r0, slope = P.cone.slope, h0 = P.cone.h0, h1 = P.cone.h1 } = {}) => sweep((h) => r0 + slope * h, h0, h1),
  torus: ({ R = P.torus.R, r = P.torus.r, nu = P.torus.nu, nv = P.torus.nv } = {}) => torus(R, r, nu, nv),   // { mesh, vs: each vertex's tube angle v }
  dishedCorner: ({ Rh = P.dishedCorner.Rh, beta = P.dishedCorner.beta, dpsi = P.dishedCorner.dpsi, W = P.dishedCorner.W,
    span = P.dishedCorner.span, nu = P.dishedCorner.nu, nw = P.dishedCorner.nw } = {}) => dishedCorner(Rh, beta, dpsi, W, span, nu, nw),
};
module.exports.params = P;
module.exports.meshCurvature = meshCurvature;   // tools/meshcurv.cjs: angle defect per vertex
module.exports.smoothK = smoothK;               // tools/meshcurv.cjs: Σδ / ΣA over a ball of smoothRadius
