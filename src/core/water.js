// water.js: pour water down the track (the core spec §5, exo_memory/loop/spec_t180_equation_core_2026-09-28.md; D185, pane C).
//
//   surfaceFrom({ samples, closed, lengthM, profileAt })  -> a surface the water can ride
//   pour(surface, { speed, count | streams, s0, g, h, laps | distance, tMax, energyTol }) -> { streams, reds, energy }
//
// THE SURFACE is the adapter's shape: the SAME path samples src/geom builds, { s, pos, T, L, U, kvec, ... }, plus the
// cross-section at each sample (`profileAt(sample)` -> { u, psi }, as src/geom/profile.js reads it). A road point is
//   S(s, u) = pos(s) + L(s)·X(u) + U(s)·Y(u),   with X, Y the profile's exact offsets (profile.js offsetAt).
// Between samples:
//   · pos is a QUINTIC Hermite through each sample's pos, T (= dpos/ds) and kvec (= dT/ds), so the centreline is C2
//     and its second derivative is the builder's own curvature vector, not a finite difference;
//   · L and U are CUBIC Hermite, their slopes by central differences over the samples (one-sided at an open end);
//   · where two samples carry different profiles, X and Y are blended by the smoothstep 3t² − 2t³ (references/02 §4), so
//     the surface stays C1 along s.
// pos' = T holds only when the samples' pos is ∫T ds (no heartline offset). That is checked when the surface is built,
// and a sample list that breaks it is refused, loudly, never ridden.
//
// THE WATER (spec §5): frictionless particles under gravity, integrated in 3-D Cartesian by RK4 and projected onto the
// surface after every step (the position to its nearest surface point by Gauss–Newton in (s, u); the velocity into the
// tangent plane). The acceleration at a stage is gravity plus the normal force:
//   a = g_vec + (N/m)·n,   N/m = κn·v² + g·(n·up)          (references/06 §8; up is +y, as everywhere in this repo)
//   κn·v² = n · (S_ss·ṡ² + 2·S_su·ṡ·u̇ + S_uu·u̇²),   (ṡ, u̇) the surface coordinates' rates of the tangential velocity.
// Nothing restores the energy. ½|v|² + g·y is the INSTRUMENT (spec §5: within 0.5% over a lap), so it is measured,
// never enforced. Each stream reports E0, the largest |E − E0| (maxAbsDrift) and that over its starting ½v²
// (maxRelDrift, the one `energyTol` is held to), so a reader can score it against any base it registered.
//
// THE REDS (spec §5):
//   · LIFT-OFF: N < 0 at the end of a step. The stream stops there; its flight is not modelled.
//   · SPILL: u leaves the profile's edge, over the lip. The stream stops there.
//   · SHOCK: two neighbouring streams' paths cross, i.e. u_{i+1}(s) − u_i(s) changes sign at a common s.
// Each red carries s (along the centreline), u (across it), t and the world position, linearly interpolated inside the step.
'use strict';
const { normalize, offsetAt, psiAt } = require('../geom/profile.js');

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const G = 9.81;

// Hermite bases as coefficient lists in t (index = power), so value, first and second derivatives share one table.
const Q5 = [[1, 0, 0, -10, 15, -6], [0, 1, 0, -6, 8, -3], [0, 0, 0.5, -1.5, 1.5, -0.5], [0, 0, 0, 0.5, -1, 0.5], [0, 0, 0, -4, 7, -3], [0, 0, 0, 10, -15, 6]];
const C3 = [[1, 0, -3, 2], [0, 1, -2, 1], [0, 0, -1, 1], [0, 0, 3, -2]];
function basis(B, t) {
  return B.map((c) => { let v = 0, d = 0, e = 0; for (let k = c.length - 1; k >= 0; k--) v = v * t + c[k];
    for (let k = c.length - 1; k >= 1; k--) d = d * t + k * c[k]; for (let k = c.length - 1; k >= 2; k--) e = e * t + k * (k - 1) * c[k]; return [v, d, e]; });
}
const combo = (vecs, w) => { const o = [0, 0, 0]; for (let i = 0; i < vecs.length; i++) if (w[i]) { o[0] += vecs[i][0] * w[i]; o[1] += vecs[i][1] * w[i]; o[2] += vecs[i][2] * w[i]; } return o; };

/** The profile's offsets and their u-derivatives at u: X, Y (profile.js, exact) and X', Y', X'', Y''. */
function across(P, u) {
  const [X, Y] = offsetAt(P, u), psi = psiAt(P, u), sg = u < 0 ? -1 : 1;
  let i = 1; while (i < P.u.length - 1 && P.u[i] < u) i++;
  const dpsi = u <= P.u[0] || u >= P.u[P.u.length - 1] ? 0 : (P.psi[i] - P.psi[i - 1]) / (P.u[i] - P.u[i - 1]);
  return { X, Y, X1: Math.cos(psi), Y1: sg * Math.sin(psi), X2: -Math.sin(psi) * dpsi, Y2: sg * Math.cos(psi) * dpsi };
}

/**
 * Build the surface the water rides from the adapter's samples. `profileAt(sample)` gives that sample's cross-section.
 * Refuses: fewer than 2 samples, s not strictly ascending, a missing field, and samples whose pos is not ∫T ds.
 */
function surfaceFrom({ samples, closed = false, lengthM, profileAt } = {}) {
  if (!Array.isArray(samples) || samples.length < 2) throw new Error('water: a surface needs at least 2 samples');
  if (typeof profileAt !== 'function') throw new Error('water: profileAt(sample) is required (the cross-section at each sample)');
  const n = samples.length, S = new Float64Array(n), pos = [], T = [], K = [], L = [], U = [], prof = [];
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    const m = samples[i];
    for (const f of ['pos', 'T', 'L', 'U', 'kvec']) if (!Array.isArray(m[f]) && !(m[f] && m[f].length === 3)) throw new Error(`water: sample ${i} has no ${f}`);
    if (!Number.isFinite(m.s) || (i && !(m.s > S[i - 1]))) throw new Error(`water: sample ${i}: s must be finite and strictly ascending`);
    S[i] = m.s; pos.push([...m.pos]); T.push([...m.T]); K.push([...m.kvec]); L.push([...m.L]); U.push([...m.U]);
    const raw = profileAt(m);
    if (raw == null) throw new Error(`water: sample ${i} (s ${m.s}) has no road under it (a flight's gap); pour each road run on its own. The flight itself is not modelled here`);
    if (!cache.has(raw)) cache.set(raw, normalize(raw)); prof.push(cache.get(raw));
  }
  const Lm = closed ? (Number.isFinite(lengthM) ? lengthM : S[n - 1] - S[0]) : S[n - 1] - S[0];
  if (closed && !(Lm > 0)) throw new Error('water: a closed surface needs its length');
  if (closed && S[n - 1] < S[0] + Lm - 1e-9) {   // a closed loop's samples may stop short of s0 + L: the first sample, one lap on, closes it
    const S2 = new Float64Array(n + 1); S2.set(S); S2[n] = S[0] + Lm;
    pos.push(pos[0]); T.push(T[0]); K.push(K[0]); L.push(L[0]); U.push(U[0]); prof.push(prof[0]);
    return finishSurface(S2, pos, T, K, L, U, prof, closed, Lm);
  }
  return finishSurface(S, pos, T, K, L, U, prof, closed, Lm);
}
function finishSurface(S, pos, T, K, L, U, prof, closed, Lm) {
  const n = S.length;
  // pos' = T, checked, not assumed: the chord between samples must be ∫T ds over the span, by the corrected trapezoid
  // h/2·(T_a + T_b) + h²/12·(K_a − K_b) (the cubic Hermite of T through its values and slopes, integrated; error O(h⁵)).
  // A plain h·(mean T) is wrong on a long span of a tight curve (0.993 over 20 m of a 100 m circle; found 2026-09-28).
  for (let i = 0; i + 1 < n; i++) {
    const h = S[i + 1] - S[i], chord = sub(pos[i + 1], pos[i]);
    const want = add(mul(add(T[i], T[i + 1]), h / 2), mul(sub(K[i], K[i + 1]), h * h / 12)), off = len(sub(chord, want)) / h;
    if (!(off <= 1e-3)) throw new Error(`water: samples ${i}–${i + 1}: pos is not ∫T ds (off by ${off.toExponential(2)} per metre); is there a heartline offset?`);
  }
  // frame slopes by the three-point difference for UNEVEN spacing, exact for a quadratic (wrapping on a closed loop, whose
  // last sample repeats the first at s = L). The spacing IS uneven: the builder adds a sample at every segment boundary,
  // and a closed loop's last span is whatever is left (0.093 m on a 500 m ring). An equal-spacing central difference is
  // off by f''·(h_b − h_a)/2 there, which put N 0.215 m/s² low 14 m off-centre at a seam (found 2026-09-28, tested).
  // One-sided at an open end.
  const slope = (A) => A.map((_, i) => {
    let a = i - 1, b = i + 1, sa, sb;
    if (closed) { const last = n - 1; if (a < 0) { a = last - 1; sa = S[a] - Lm; } else sa = S[a]; if (b > last) { b = 1; sb = S[b] + Lm; } else sb = S[b]; }
    else { a = Math.max(0, a); b = Math.min(n - 1, b); sa = S[a]; sb = S[b]; }
    if (a === i || b === i) return mul(sub(A[b], A[a]), 1 / (sb - sa));
    const ha = S[i] - sa, hb = sb - S[i];
    return add(add(mul(A[a], -hb / (ha * (ha + hb))), mul(A[i], (hb - ha) / (ha * hb))), mul(A[b], ha / (hb * (ha + hb))));
  });
  return { n, S, pos, T, K, L, U, prof, dL: slope(L), dU: slope(U), closed, lengthM: Lm, s0: S[0], _hint: 0 };
}

const wrap = (F, s) => (F.closed ? F.s0 + ((((s - F.s0) % F.lengthM) + F.lengthM) % F.lengthM) : s);
function spanOf(F, s) {
  let i = Math.min(Math.max(F._hint, 0), F.n - 2);
  while (i > 0 && s < F.S[i]) i--; while (i < F.n - 2 && s >= F.S[i + 1]) i++;
  F._hint = i; return i;
}

/** S and its derivatives at (s, u). Off an open end, s is clamped to the end (the caller stops the stream there). */
function at(F, sIn, u) {
  const s = F.closed ? wrap(F, sIn) : Math.min(Math.max(sIn, F.S[0]), F.S[F.n - 1]);
  const i = spanOf(F, s), h = F.S[i + 1] - F.S[i], t = (s - F.S[i]) / h, j = i + 1;
  const q = basis(Q5, t), c = basis(C3, t);
  const P = [F.pos[i], F.T[i], F.K[i], F.K[j], F.T[j], F.pos[j]], sc = [1, h, h * h, h * h, h, 1];
  const pw = (d) => q.map((b, k) => b[d] * sc[k] / h ** d);
  const p = combo(P, pw(0)), p1 = combo(P, pw(1)), p2 = combo(P, pw(2));
  const Fr = (A, D) => { const V = [A[i], D[i], D[j], A[j]], s2 = [1, h, h, 1], w = (d) => c.map((b, k) => b[d] * s2[k] / h ** d); return [combo(V, w(0)), combo(V, w(1)), combo(V, w(2))]; };
  const [Lv, L1, L2] = Fr(F.L, F.dL), [Uv, U1, U2] = Fr(F.U, F.dU);
  const Pa = F.prof[i], Pb = F.prof[j], A = across(Pa, u);
  let x = A;
  let lo = Pa.u[0], hi = Pa.u[Pa.u.length - 1];
  if (Pa !== Pb) {   // blend the two cross-sections by smoothstep along s (C1)
    const B = across(Pb, u), w = t * t * (3 - 2 * t), w1 = 6 * t * (1 - t) / h, w2 = (6 - 12 * t) / (h * h), mix = (k) => A[k] + (B[k] - A[k]) * w;
    x = { X: mix('X'), Y: mix('Y'), X1: mix('X1'), Y1: mix('Y1'), X2: mix('X2'), Y2: mix('Y2'), Xs: (B.X - A.X) * w1, Ys: (B.Y - A.Y) * w1,
      Xss: (B.X - A.X) * w2, Yss: (B.Y - A.Y) * w2, Xsu: (B.X1 - A.X1) * w1, Ysu: (B.Y1 - A.Y1) * w1 };
    lo += (Pb.u[0] - lo) * w; hi += (Pb.u[Pb.u.length - 1] - hi) * w;
  }
  const Xs = x.Xs || 0, Ys = x.Ys || 0;
  const Sv = add(p, add(mul(Lv, x.X), mul(Uv, x.Y)));
  const Ss = add(p1, add(add(mul(L1, x.X), mul(U1, x.Y)), add(mul(Lv, Xs), mul(Uv, Ys))));
  const Su = add(mul(Lv, x.X1), mul(Uv, x.Y1));
  const Sss = add(p2, add(add(mul(L2, x.X), mul(U2, x.Y)), add(mul(add(mul(L1, Xs), mul(U1, Ys)), 2), add(mul(Lv, x.Xss || 0), mul(Uv, x.Yss || 0)))));
  const Ssu = add(add(mul(L1, x.X1), mul(U1, x.Y1)), add(mul(Lv, x.Xsu || 0), mul(Uv, x.Ysu || 0)));
  const Suu = add(mul(Lv, x.X2), mul(Uv, x.Y2));
  const nv = cross(Ss, Su), nl = len(nv);
  if (!(nl > 1e-12)) throw new Error(`water: the surface folds at s ${s.toFixed(2)}, u ${u.toFixed(2)}`);
  return { s, u, p: Sv, Ss, Su, Sss, Ssu, Suu, n: mul(nv, 1 / nl), lo, hi };
}

/** The nearest surface point to x, by Gauss–Newton in (s, u) from a guess. */
function project(F, x, s, u) {
  let r = at(F, s, u);
  for (let it = 0; it < 8; it++) {
    const d = sub(x, r.p), a = dot(r.Ss, r.Ss), b = dot(r.Ss, r.Su), c = dot(r.Su, r.Su), e = dot(r.Ss, d), f = dot(r.Su, d), det = a * c - b * b;
    const ds = (c * e - b * f) / det, du = (a * f - b * e) / det;
    s += ds; u += du; r = at(F, s, u);
    if (Math.abs(ds) < 1e-10 && Math.abs(du) < 1e-10) break;
  }
  return { ...r, sRaw: s };
}

/** Normal force per unit mass, N/m = κn·v² + g·(n·up), from the surface's second derivatives along v (references/06 §8). */
function normalForce(r, v, g) {
  const a = dot(r.Ss, r.Ss), b = dot(r.Ss, r.Su), c = dot(r.Su, r.Su), e = dot(r.Ss, v), f = dot(r.Su, v), det = a * c - b * b;
  const sd = (c * e - b * f) / det, ud = (a * f - b * e) / det;
  const knv2 = dot(r.n, add(add(mul(r.Sss, sd * sd), mul(r.Ssu, 2 * sd * ud)), mul(r.Suu, ud * ud)));
  return knv2 + g * r.n[1];
}

/**
 * Pour water. `speed` (m/s) is the design speed, required and > 0. The streams start at s0, spread across the width at
 * `count` evenly spaced u (fractions (i + ½)/count of the edge-to-edge span), each moving along the road; or give
 * `streams: [{ u, speed?, angle? }]` (angle in rad from the along-road direction toward +u). They run until `laps` laps
 * (closed; default 1) or `distance` metres along s, or `tMax` seconds, whichever comes first.
 * Returns { streams: [{ u0, outcome, t, s, u, y, energy }], reds: [{ type, streams, s, u, t, pos }], energy }.
 */
function pour(F, opts = {}) {
  const g = opts.g === undefined ? G : opts.g, h = opts.h === undefined ? 0.01 : opts.h, tol = opts.energyTol === undefined ? 0.005 : opts.energyTol;
  if (!(Number.isFinite(opts.speed) && opts.speed > 0)) throw new Error('water: speed must be a positive number (m/s)');
  if (!(h > 0) || !(g >= 0)) throw new Error('water: h must be positive and g not negative');
  const s0 = opts.s0 === undefined ? F.s0 : opts.s0;
  let seeds = opts.streams;
  if (!seeds) {
    const count = opts.count === undefined ? 9 : opts.count;
    if (!(Number.isInteger(count) && count >= 1)) throw new Error('water: count must be a positive integer');
    const e = at(F, s0, 0); seeds = Array.from({ length: count }, (_, i) => ({ u: e.lo + (e.hi - e.lo) * (i + 0.5) / count }));
  }
  if (!Array.isArray(seeds) || seeds.length === 0) throw new Error('water: no streams to pour');
  const run = F.closed ? (opts.distance === undefined ? (opts.laps === undefined ? 1 : opts.laps) * F.lengthM : opts.distance) : (opts.distance === undefined ? Infinity : opts.distance);
  const tMax = opts.tMax === undefined ? Infinity : opts.tMax;
  if (!Number.isFinite(run) && !Number.isFinite(tMax) && F.closed) throw new Error('water: give laps, distance or tMax');
  const reds = [], out = [];
  const N0 = (r, v) => normalForce(r, v, g);
  seeds.forEach((sd, k) => {
    const v0 = sd.speed === undefined ? opts.speed : sd.speed, ang = sd.angle || 0;
    const r0 = at(F, s0, sd.u), eS = mul(r0.Ss, 1 / len(r0.Ss)), eU = sub(r0.Su, mul(eS, dot(r0.Su, eS)));
    let x = r0.p, v = add(mul(eS, v0 * Math.cos(ang)), mul(mul(eU, 1 / len(eU)), v0 * Math.sin(ang)));
    let s = s0, u = sd.u, sUn = s0, t = 0, outcome = 'ran', at_ = null;
    const E0 = 0.5 * dot(v, v) + g * x[1], scale = 0.5 * v0 * v0;
    const tr = { t: [0], s: [s0], u: [u], y: [x[1]], N: [N0(r0, v)] }; let maxDrift = 0, maxAbs = 0;
    const acc = (X, V, guess) => { const r = project(F, X, guess.s, guess.u); return { a: add([0, -g, 0], mul(r.n, normalForce(r, V, g))), r }; };
    let N = tr.N[0];
    if (N < 0) { outcome = 'liftoff'; at_ = { s, u, t, pos: x }; }
    while (outcome === 'ran') {
      const guess = { s, u };
      const k1 = acc(x, v, guess), x2 = add(x, mul(v, h / 2)), v2 = add(v, mul(k1.a, h / 2));
      const k2 = acc(x2, v2, guess), x3 = add(x, mul(v2, h / 2)), v3 = add(v, mul(k2.a, h / 2));
      const k3 = acc(x3, v3, guess), x4 = add(x, mul(v3, h)), v4 = add(v, mul(k3.a, h));
      const k4 = acc(x4, v4, guess);
      let xn = add(x, mul(add(add(v, mul(add(v2, v3), 2)), v4), h / 6));
      let vn = add(v, mul(add(add(k1.a, mul(add(k2.a, k3.a), 2)), k4.a), h / 6));
      const r = project(F, xn, s, u); xn = r.p; vn = sub(vn, mul(r.n, dot(vn, r.n)));
      const dsStep = r.sRaw - s, sUnN = sUn + dsStep, Nn = normalForce(r, vn, g), tn = t + h;
      const lerp = (fa, fb) => (fb === fa ? 1 : fa / (fa - fb));
      if (r.u > r.hi || r.u < r.lo) {
        const edge = r.u > r.hi ? r.hi : r.lo, w = lerp(u - edge, r.u - edge);
        outcome = 'spill'; at_ = { s: wrap(F, sUn + dsStep * w), u: edge, t: t + h * w, pos: add(x, mul(sub(xn, x), w)) };
      } else if (Nn < 0) {
        const w = lerp(N, Nn); outcome = 'liftoff'; at_ = { s: wrap(F, sUn + dsStep * w), u: u + (r.u - u) * w, t: t + h * w, pos: add(x, mul(sub(xn, x), w)) };
      }
      x = xn; v = vn; s = F.closed ? r.s : r.sRaw; u = r.u; sUn = sUnN; t = tn; N = Nn;
      const E = 0.5 * dot(v, v) + g * x[1]; maxAbs = Math.max(maxAbs, Math.abs(E - E0)); maxDrift = maxAbs / scale;
      tr.t.push(t); tr.s.push(sUn); tr.u.push(u); tr.y.push(x[1]); tr.N.push(N);
      if (outcome !== 'ran') break;
      if (!F.closed && (r.sRaw >= F.S[F.n - 1] || r.sRaw <= F.S[0])) { outcome = 'end'; break; }
      if (sUn - s0 >= run || t >= tMax) break;
    }
    if (outcome === 'spill' || outcome === 'liftoff') reds.push({ type: outcome, streams: [k], ...at_ });
    out.push({ u0: sd.u, outcome, at: at_, track: tr, energy: { E0, maxAbsDrift: maxAbs, maxRelDrift: maxDrift, ok: maxDrift <= tol } });
  });
  // SHOCK: neighbouring streams (in starting u) whose paths cross at a common s
  const order = out.map((_, k) => k).sort((a, b) => out[a].u0 - out[b].u0);
  for (let q = 0; q + 1 < order.length; q++) {
    const A = out[order[q]].track, B = out[order[q + 1]].track, cross_ = shockBetween(A, B);
    if (cross_) reds.push({ type: 'shock', streams: [order[q], order[q + 1]], s: wrap(F, cross_.s), u: cross_.u, t: cross_.t, pos: null });
  }
  const worst = Math.max(0, ...out.map((o) => o.energy.maxRelDrift));
  return { streams: out, reds, energy: { maxRelDrift: worst, tolerance: tol, ok: worst <= tol } };
}

/** The first s at which B's u minus A's u changes sign, both read at the same s (linear in each track). */
function shockBetween(A, B) {
  const uAt = (Tr, s) => { const S = Tr.s; if (s < S[0] || s > S[S.length - 1]) return null; let i = 1; while (i < S.length - 1 && S[i] < s) i++;
    const a = S[i - 1], b = S[i], w = b > a ? (s - a) / (b - a) : 0; return { u: Tr.u[i - 1] + (Tr.u[i] - Tr.u[i - 1]) * w, t: Tr.t[i - 1] + (Tr.t[i] - Tr.t[i - 1]) * w }; };
  for (let i = 1; i < A.s.length; i++) if (!(A.s[i] > A.s[i - 1])) return null;   // a stream running backwards has no u(s): not compared
  for (let i = 1; i < B.s.length; i++) if (!(B.s[i] > B.s[i - 1])) return null;
  let prev = null, prevS = null;
  for (const s of A.s) {
    const b = uAt(B, s); if (!b) continue; const a = uAt(A, s), d = b.u - a.u;
    if (prev !== null && prev > 0 && d <= 0) { const w = prev / (prev - d), sc = prevS + (s - prevS) * w; return { s: sc, u: uAt(A, sc).u, t: uAt(A, sc).t }; }
    prev = d; prevS = s;
  }
  return null;
}

module.exports = { surfaceFrom, pour, _at: at, _project: project, _normalForce: normalForce };
