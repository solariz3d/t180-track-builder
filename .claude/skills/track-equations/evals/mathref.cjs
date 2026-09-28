// mathref.cjs: the track-equations skill's REFERENCE implementations (D184, pane C). One small, dependency-free function per
// formula the references state (references/*.md), so evals/known_answers.test.js can hold each to a KNOWN ANSWER: a formula
// is in the references only when a test exercises it. Each function names its reference section; the sources are in
// references/MATH_SOURCES.md. Every body is written from the formula; nothing is copied from a source.
// Conventions (references/README.md): world up is +y; T = (cos p sin θ, sin p, cos p cos θ); metres, radians.
'use strict';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

// ── 01 centreline: cross-rays against the road triangles ──────────────────────────────────────────────────────────
/**
 * 01 §1 Möller–Trumbore: the ray O + tD against the triangle (a, b, c). Returns { t, u, v } for a hit (u, v ≥ 0, u + v ≤ 1,
 * t > 0) or null (a miss, or a ray parallel to the triangle's plane).
 */
function rayTriangle(O, D, a, b, c, eps = 1e-12) {
  const e1 = sub(b, a), e2 = sub(c, a), h = cross(D, e2), det = dot(e1, h);
  if (Math.abs(det) < eps) return null;
  const f = 1 / det, s = sub(O, a), u = f * dot(s, h);
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1), v = f * dot(D, q);
  if (v < 0 || u + v > 1) return null;
  const t = f * dot(e2, q);
  return t > eps ? { t, u, v } : null;
}
/** 01 §2: of several hits, the one whose point is nearest a reference height (the previous station's), never merely the first. */
function nearestHit(points, yRef) { let best = null; for (const p of points) if (!best || Math.abs(p[1] - yRef) < Math.abs(best[1] - yRef)) best = p; return best; }
/** 01 §3: the centre of a cross-section is the midpoint of its left and right edge points; its width their distance. */
const midpoint = (l, r) => [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];

// ── 02 curvature from position, and the curve functions ───────────────────────────────────────────────────────────
/** 02 §1: the curvature of any parametrised space curve: κ = |r′ × r″| / |r′|³. */
const curvature = (d1, d2) => norm(cross(d1, d2)) / norm(d1) ** 3;
/** 02 §2: the unit tangent from heading θ (about world up) and pitch p. */
function tangent(theta, p) { return [Math.cos(p) * Math.sin(theta), Math.sin(p), Math.cos(p) * Math.cos(theta)]; }
/** 02 §2: rebuild a line from θ′ = k(s), p′ = kp(s), x′ = T, by the midpoint rule over n steps of L/n. */
function rebuild(k, kp, L, n, { theta0 = 0, p0 = 0, x0 = [0, 0, 0] } = {}) {
  const h = L / n, pts = [x0.slice()]; let th = theta0, p = p0, x = x0.slice();
  for (let i = 0; i < n; i++) {
    const sm = (i + 0.5) * h, T = tangent(th + 0.5 * h * k(i * h), p + 0.5 * h * kp(i * h));
    x = [x[0] + h * T[0], x[1] + h * T[1], x[2] + h * T[2]]; pts.push(x);
    th += h * k(sm); p += h * kp(sm);
  }
  return { pts, theta: th, p };
}
/** 02 §3: the discrete curvature at the middle of three points: turning angle over the mean arc. */
function discreteCurvature(a, b, c) {
  const u = sub(b, a), w = sub(c, b), lu = norm(u), lw = norm(w);
  return Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (lu * lw)))) / ((lu + lw) / 2);
}
/** 02 §4: the clothoid, κ(s) = s/A² (A² = R·L); and the Bloss / smoothstep ramp S(u) = 3u² − 2u³, steepest 1.5 at u = ½. */
const clothoidKappa = (s, A) => s / (A * A);
const smoothstep = (u) => 3 * u * u - 2 * u * u * u;

// ── 03 cubic B-splines ────────────────────────────────────────────────────────────────────────────────────────────
/** 03 §1 Cox–de Boor: the basis function B_{i,k} on knots t, at x (degree 0 is 1 on [t_i, t_{i+1})). */
function bspline(i, k, t, x) {
  if (k === 0) return t[i] <= x && x < t[i + 1] ? 1 : 0;   // half-open; callers clamp x = the last knot inside (inside())
  const a = t[i + k] - t[i], b = t[i + k + 1] - t[i + 1];
  return (a > 0 ? (x - t[i]) / a * bspline(i, k - 1, t, x) : 0) + (b > 0 ? (t[i + k + 1] - x) / b * bspline(i + 1, k - 1, t, x) : 0);
}
/** 03 §1: a clamped cubic knot vector on [0, L] with interior knots `inner`: [0,0,0,0, ...inner, L,L,L,L]. */
const clampedKnots = (L, inner) => [0, 0, 0, 0, ...inner, L, L, L, L];
/** The end of a clamped spline belongs to its last span: evaluate there just inside it. */
const inside = (t, x) => Math.min(x, t[t.length - 1] * (1 - 1e-12));
/** 03 §2: the least-squares cubic B-spline fit of samples (s_j, y_j) on knots t: the control values c minimising Σ(y − Bc)². */
function fitBspline(s, y, t) {
  const n = t.length - 4, A = s.map((x) => Array.from({ length: n }, (_, i) => bspline(i, 3, t, inside(t, x))));
  return lstsq(A, y);
}
const evalBspline = (c, t, x) => c.reduce((acc, ci, i) => acc + ci * bspline(i, 3, t, inside(t, x)), 0);
/** 03 §3: adaptive refinement: every knot span whose largest |error| exceeds tol gets a knot at its midpoint. */
function refineKnots(t, s, err, tol) {
  const inner = t.slice(4, -4), spans = [...new Set(t)], out = inner.slice();
  for (let j = 0; j + 1 < spans.length; j++) {
    const lo = spans[j], hi = spans[j + 1], worst = Math.max(0, ...s.map((x, i) => (x >= lo && x <= hi ? Math.abs(err[i]) : 0)));
    if (worst > tol) out.push((lo + hi) / 2);
  }
  return clampedKnots(t[t.length - 1], out.sort((a, b) => a - b));
}

// ── 04 least squares, joints and closure ──────────────────────────────────────────────────────────────────────────
/** Solve A x = b (small, dense) by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) throw new Error('solve: singular system');
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
/** 04 §1: ordinary least squares, minimise ‖Ax − b‖², by the normal equations AᵀA x = Aᵀb. */
function lstsq(A, b) {
  const n = A[0].length, AtA = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => A.reduce((s, r) => s + r[i] * r[j], 0)));
  return solve(AtA, Array.from({ length: n }, (_, i) => A.reduce((s, r, k) => s + r[i] * b[k], 0)));
}
/**
 * 04 §2: EQUALITY-CONSTRAINED least squares, minimise ‖Ax − b‖² subject to Cx = d, by its KKT system
 * [2AᵀA Cᵀ; C 0] [x; z] = [2Aᵀb; d]. Joints (G0/G1/G2) and closure are rows of C.
 */
function kkt(A, b, C, d) {
  const n = A[0].length, m = C.length, K = Array.from({ length: n + m }, () => Array(n + m).fill(0)), r = Array(n + m).fill(0);
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) K[i][j] = 2 * A.reduce((s, row) => s + row[i] * row[j], 0); r[i] = 2 * A.reduce((s, row, k) => s + row[i] * b[k], 0); }
  for (let a = 0; a < m; a++) { for (let j = 0; j < n; j++) { K[n + a][j] = C[a][j]; K[j][n + a] = C[a][j]; } r[n + a] = d[a]; }
  return solve(K, r).slice(0, n);
}
/** 04 §3: the least-norm correction δ = −W⁻¹Jᵀ(J W⁻¹ Jᵀ)⁻¹ r for J δ = −r (W = diag(w), default I). */
function leastNorm(J, r, w = null) {
  const m = J.length, n = J[0].length, wi = (j) => (w ? 1 / w[j] : 1);
  const JWJ = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => { let s = 0; for (let j = 0; j < n; j++) s += J[a][j] * wi(j) * J[b][j]; return s; }));
  const y = solve(JWJ, r.map((x) => -x));
  return Array.from({ length: n }, (_, j) => { let s = 0; for (let a = 0; a < m; a++) s += J[a][j] * y[a]; return wi(j) * s; });
}
/** 04 §3: close a planar loop θ(s) = 2πs/L + Σ(a_k cos + b_k sin)(2πks/L) by least-norm Newton steps on (a₁, b₁). */
function closeLoop(coef, L, { n = 2000, iters = 20, eps = 1e-12 } = {}) {
  const c = coef.map((x) => x.slice());
  const residual = (cc) => {
    const k = (s) => 2 * Math.PI / L + cc.reduce((acc, [a, b], i) => acc + (2 * Math.PI * (i + 1) / L) * (-a * Math.sin(2 * Math.PI * (i + 1) * s / L) + b * Math.cos(2 * Math.PI * (i + 1) * s / L)), 0);
    const e = rebuild(k, () => 0, L, n, { theta0: cc.reduce((acc, [a]) => acc + a, 0) }).pts.at(-1); return [e[0], e[2]];
  };
  const hist = [];
  for (let it = 0; it < iters; it++) {
    const r0 = residual(c); hist.push(Math.hypot(...r0)); if (hist.at(-1) < eps * L) break;
    const h = 1e-7, J = [[0, 0], [0, 0]];
    for (let j = 0; j < 2; j++) { const cp = c.map((x) => x.slice()); cp[0][j] += h; const rp = residual(cp); J[0][j] = (rp[0] - r0[0]) / h; J[1][j] = (rp[1] - r0[1]) / h; }
    const dd = leastNorm(J, r0); c[0][0] += dd[0]; c[0][1] += dd[1];
  }
  return { coef: c, residual: hist };
}

// ── 05 flight: the ballistic arc of a jump ────────────────────────────────────────────────────────────────────────
/** 05 §1: position at time t of a point launched from p0 with velocity v0 under downward acceleration g (−y). */
const projectile = (p0, v0, g, t) => [p0[0] + v0[0] * t, p0[1] + v0[1] * t - 0.5 * g * t * t, p0[2] + v0[2] * t];
/** 05 §2: the time a projectile from height y0 with upward speed vy comes down to height yLand (the later root). */
const timeToHeight = (y0, vy, g, yLand) => (vy + Math.sqrt(vy * vy + 2 * g * (y0 - yLand))) / g;

// ── 06 surfaces ───────────────────────────────────────────────────────────────────────────────────────────────────
/** 06 §2: a sphere of radius R has K = 1/R². */
const sphereK = (R) => 1 / (R * R);
/** 06 §3: a torus (centre radius R, tube radius r, v = 0 on the outer equator): K = cos v / (r(R + r cos v)). */
const torusK = (v, R, r) => Math.cos(v) / (r * (R + r * Math.cos(v)));
/** 06 §6 DERIVED: a dished corner banked β into a turn of curvature κh: K ≈ κh · sin β · dψ/du (elliptic). */
const dishedCornerK = (kh, beta, dpsidu) => kh * Math.sin(beta) * dpsidu;
/**
 * 06 §7: a frictionless particle on y = f(x, z) under gravity g: with q = g + f_xx ẋ² + 2 f_xz ẋż + f_zz ż² and D = 1 + f_x² + f_z²,
 * ẍ = −f_x q/D, z̈ = −f_z q/D, and N/m = q/√D (N < 0: lift-off). Classical RK4; returns the samples.
 */
function particleOnGraph(surf, state0, { g = 9.81, h = 1e-3, steps = 1000 } = {}) {
  const acc = (x, z, vx, vz) => { const s = surf(x, z), q = g + s.fxx * vx * vx + 2 * s.fxz * vx * vz + s.fzz * vz * vz, D = 1 + s.fx * s.fx + s.fz * s.fz; return { ax: -s.fx * q / D, az: -s.fz * q / D, N: q / Math.sqrt(D) }; };
  let [x, z, vx, vz] = state0; const out = [];
  const rec = () => { const s = surf(x, z), a = acc(x, z, vx, vz); out.push({ x, y: s.f, z, vx, vy: s.fx * vx + s.fz * vz, vz, N: a.N }); };
  rec();
  for (let i = 0; i < steps; i++) {
    const F = (X, Z, VX, VZ) => { const a = acc(X, Z, VX, VZ); return [VX, VZ, a.ax, a.az]; };
    const k1 = F(x, z, vx, vz), k2 = F(x + h / 2 * k1[0], z + h / 2 * k1[1], vx + h / 2 * k1[2], vz + h / 2 * k1[3]);
    const k3 = F(x + h / 2 * k2[0], z + h / 2 * k2[1], vx + h / 2 * k2[2], vz + h / 2 * k2[3]), k4 = F(x + h * k3[0], z + h * k3[1], vx + h * k3[2], vz + h * k3[3]);
    x += h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); z += h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    vx += h / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]); vz += h / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
    rec();
  }
  return out;
}

// ── 07 Fourier on a loop (M4) ─────────────────────────────────────────────────────────────────────────────────────
/** 07 §1: the Fourier fit of M uniform samples of one period, truncated at N. */
function fourierFit(f, N) {
  const M = f.length, a = [0], b = [0]; let a0 = 0;
  for (let i = 0; i < M; i++) a0 += f[i]; a0 /= M;
  for (let k = 1; k <= N; k++) { let ak = 0, bk = 0; for (let i = 0; i < M; i++) { const t = 2 * Math.PI * k * i / M; ak += f[i] * Math.cos(t); bk += f[i] * Math.sin(t); } a.push(2 * ak / M); b.push(2 * bk / M); }
  return { a0, a, b };
}

// ── 06 §8: the water's laws (D185). The normal force in the surface's own frame; the frictionless banked turn; a particle on a
// surface of revolution about the vertical (energy + angular momentum about the axis); lift-off over a circular crest ──
// N/m = κn·v² + g·(n·up), with κn·v² = n·(the path's second derivative on the surface)
const normalForce = (knv2, nUp, g) => knv2 + g * nUp;
// the frictionless balanced speed of a banked turn: v² = r·g·tan β
const bankedSpeed = (r, beta, g) => Math.sqrt(r * g * Math.tan(beta));
// on a cone y = (r − R)·tan β, released at radius r0 moving along the ring at speed v: the OTHER turning radius, from
// ½v²·r0²/r² + g·tan β·(r − r0) = ½v² (energy, with r²·dφ/dt = r0·v conserved), i.e. v²(r + r0) = 2g·tan β·r²
const coneTurn = (r0, v, beta, g) => { const t = Math.tan(beta); return (v * v + Math.sqrt(v ** 4 + 8 * g * t * v * v * r0)) / (4 * g * t); };
// over a circular crest of radius Rv, entered at pitch p0 at speed v0: lift-off where g·cos p = v²/Rv with
// v² = v0² − 2g·Rv·(cos p − cos p0), so cos p* = (v0²/Rv + 2g·cos p0) / (3g)
const crestLiftoffCos = (v0, Rv, p0, g) => (v0 * v0 / Rv + 2 * g * Math.cos(p0)) / (3 * g);

module.exports = {
  rayTriangle, nearestHit, midpoint,
  curvature, tangent, rebuild, discreteCurvature, clothoidKappa, smoothstep,
  bspline, clampedKnots, fitBspline, evalBspline, refineKnots,
  solve, lstsq, kkt, leastNorm, closeLoop,
  projectile, timeToHeight,
  sphereK, torusK, dishedCornerK, particleOnGraph,
  normalForce, bankedSpeed, coneTurn, crestLiftoffCos,
  fourierFit,
};
