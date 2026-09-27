// profile.js: the cross-section as ONE data type, a 2D curve by its own arc length u with a turning angle ψ(u)
// (ARCHITECTURE §2 `:39-40`; docs/INTERFACES.md §1 `profile`). u is 0 at the centreline, + to the left; ψ is measured
// from the flat floor and may pass π/2 (a wall past vertical) or π (a tube's roof).
//
// Geometry, exactly: walking outward from u = 0 the surface turns by ψ, so the offset from the centreline in the
// station frame (L = left, U = up) is
//   X(u) = ∫₀ᵘ cos ψ du'                       (negative on the right, because u is)
//   Y(u) = sign(u) · ∫₀ᵘ sin ψ du'             (up on both sides: a wall rises whichever edge it is on)
// with ψ linear between samples, so each piece integrates in closed form. The drivable-side normal is
//   n(u) = cos ψ · U − sign(u) · sin ψ · L,
// so a left wall at ψ = 110° faces down and to the right, back over the road, as an overhang must.
'use strict';

/** Validate and normalise a profile: ascending u including 0, finite ψ, ψ(0) = 0 if absent. */
function normalize(profile) {
  if (!profile || !Array.isArray(profile.u) || !Array.isArray(profile.psi) || profile.u.length !== profile.psi.length || profile.u.length < 2)
    throw new Error('profile: needs u[] and psi[] of the same length (≥ 2)');
  const u = profile.u.slice(), psi = profile.psi.slice();
  for (let i = 0; i < u.length; i++) {
    if (!Number.isFinite(u[i]) || !Number.isFinite(psi[i])) throw new Error(`profile: sample ${i} is not finite`);
    if (i && !(u[i] > u[i - 1])) throw new Error(`profile: u must be strictly ascending (sample ${i})`);
  }
  if (!(u[0] <= 0 && u[u.length - 1] >= 0)) throw new Error('profile: u must span 0 (the centreline)');
  if (!u.includes(0)) { let i = u.findIndex((x) => x > 0); const t = -u[i - 1] / (u[i] - u[i - 1]); u.splice(i, 0, 0); psi.splice(i, 0, psi[i - 1] + (psi[i] - psi[i - 1]) * t); }
  return { u, psi, font: profile.font || 'custom', material: profile.material || 'ROAD' };
}
const psiAt = (P, u) => {
  if (u <= P.u[0]) return P.psi[0]; if (u >= P.u[P.u.length - 1]) return P.psi[P.psi.length - 1];
  let i = 1; while (P.u[i] < u) i++; const t = (u - P.u[i - 1]) / (P.u[i] - P.u[i - 1]); return P.psi[i - 1] + (P.psi[i] - P.psi[i - 1]) * t;
};
/** ∫ from a to b of (cos ψ, sin ψ) with ψ linear from pa to pb. */
function piece(a, b, pa, pb) {
  const h = b - a, d = pb - pa;
  if (Math.abs(d) < 1e-9) return [Math.cos(pa) * h, Math.sin(pa) * h];
  return [h * (Math.sin(pb) - Math.sin(pa)) / d, -h * (Math.cos(pb) - Math.cos(pa)) / d];
}
/** Offset [X, Y] of the surface point at u, exactly (piecewise closed form). */
function offsetAt(P, u) {
  if (u === 0) return [0, 0];
  const sgn = u > 0 ? 1 : -1; let X = 0, S = 0, a = 0, pa = psiAt(P, 0);
  const knots = P.u.filter((x) => (sgn > 0 ? x > 0 && x < u : x < 0 && x > u)).sort((x, y) => sgn * (x - y));
  for (const k of [...knots, u]) { const pb = psiAt(P, k), [c, s] = piece(a, k, pa, pb); X += c; S += s; a = k; pa = pb; }
  return [X, sgn * S];
}
function normalAt(P, u) { const p = psiAt(P, u), sg = u > 0 ? 1 : u < 0 ? -1 : 0; return [-sg * Math.sin(p), Math.cos(p)]; } // [L, U] components

/**
 * Sample positions across the profile for meshing: at most `maxAcross` metres apart and at most `maxSeam` radians of
 * turning apart, placed by equalising the measure ∫ (1/maxAcross + |dψ/du|/maxSeam) du. `count` forces the number of
 * points (so profiles meshed together share a vertex count); otherwise the fewest that satisfy both limits.
 */
function samplesAcross(P, { maxAcross = 1, maxSeam = Math.PI / 180, count } = {}) {
  const fine = []; const N = 4000, u0 = P.u[0], u1 = P.u[P.u.length - 1];
  for (let i = 0; i <= N; i++) fine.push(u0 + (u1 - u0) * i / N);
  const m = [0]; for (let i = 1; i <= N; i++) { const du = fine[i] - fine[i - 1], dpsi = Math.abs(psiAt(P, fine[i]) - psiAt(P, fine[i - 1])); m.push(m[i - 1] + du / maxAcross + dpsi / maxSeam); }
  const need = Math.max(2, Math.ceil(m[N]) + 1), K = count === undefined ? need : count;
  if (K < need) throw new Error(`profile: ${K} samples cannot meet the limits, ${need} are needed`);
  const out = []; let j = 0;
  for (let k = 0; k < K; k++) { const target = m[N] * k / (K - 1); while (j < N - 1 && m[j + 1] < target) j++; const t = m[j + 1] > m[j] ? (target - m[j]) / (m[j + 1] - m[j]) : 0; out.push(fine[j] + (fine[j + 1] - fine[j]) * Math.min(1, Math.max(0, t))); }
  out[0] = u0; out[K - 1] = u1;
  return { u: out, need };
}
/** Largest |ψ| on the profile, for reporting (rad). */
const maxPsi = (P) => Math.max(...P.psi.map(Math.abs));

// ── FONT RAMPS (the librarian's ruling on D166 §5: "Fonts RAMP; they never jump ... The geometry blends width, wall
// height and ψ(u) along s, smoothstep in s") ──
// Two profiles are matched at FRACTIONS of each side's width: f ∈ [−1, 0] runs from the right edge to the centreline,
// f ∈ [0, 1] from the centreline to the left edge, and u = f · edge on that side. At weight w (0 = A, 1 = B):
//   edge_w = (1 − w)·edgeA + w·edgeB                                  (the width blends)
//   ψ_w(f) = (1 − w)·ψA(f·edgeA) + w·ψB(f·edgeB)                     (the turning angle blends, so wall height follows)
// ψA and ψB are piecewise linear in f, so ψ_w is exactly piecewise linear on the union of both profiles' knots in f.
const edgesOf = (P) => [P.u[0], P.u[P.u.length - 1]];
const uAt = (E, f) => (f < 0 ? -f * E[0] : f * E[1]);
/** The fractions of a profile's knots (sides of zero width contribute only f = 0). */
function fractions(P) {
  const [r, l] = edgesOf(P);
  return P.u.map((u) => (u < 0 ? (r < 0 ? -u / r : 0) : u > 0 ? (l > 0 ? u / l : 0) : 0));
}
/** The profile at weight w between A and B (both normalised). w = 0 returns A's shape, w = 1 returns B's, exactly. */
function blend(A, B, w) {
  const EA = edgesOf(A), EB = edgesOf(B), E = [EA[0] + (EB[0] - EA[0]) * w, EA[1] + (EB[1] - EA[1]) * w];
  const fs = [...new Set([...fractions(A), ...fractions(B), 0])].filter((f) => (f < 0 ? E[0] < 0 : f > 0 ? E[1] > 0 : true)).sort((a, b) => a - b);
  const u = [], psi = [];
  for (const f of fs) {
    const x = uAt(E, f); if (u.length && !(x > u[u.length - 1])) continue;
    u.push(x); psi.push(psiAt(A, uAt(EA, f)) * (1 - w) + psiAt(B, uAt(EB, f)) * w);
  }
  return { u, psi, font: w < 0.5 ? A.font : B.font, material: B.material };
}
/**
 * Fractions across a ramp for meshing: ONE vertex count for the whole ramp, dense enough for both ends. The measure
 * ∫ (maxEdge/maxAcross + max(|dψA|, |dψB|)/maxSeam) df bounds every blend in between: |Δu_w| ≤ Δf·max edge, and
 * |Δψ_w| ≤ max(|ΔψA|, |ΔψB|) on each interval, because ψ_w is a convex combination.
 */
function blendSamples(A, B, { maxAcross = 1, maxSeam = Math.PI / 180 } = {}) {
  const EA = edgesOf(A), EB = edgesOf(B), R = Math.max(-EA[0], -EB[0]), Lw = Math.max(EA[1], EB[1]);
  const f0 = R > 0 ? -1 : 0, f1 = Lw > 0 ? 1 : 0, N = 4000;
  const fine = []; for (let i = 0; i <= N; i++) fine.push(f0 + (f1 - f0) * i / N);
  const m = [0];
  for (let i = 1; i <= N; i++) {
    const a = fine[i - 1], b = fine[i], side = (a + b) / 2 < 0 ? R : Lw;
    const dA = Math.abs(psiAt(A, uAt(EA, b)) - psiAt(A, uAt(EA, a))), dB = Math.abs(psiAt(B, uAt(EB, b)) - psiAt(B, uAt(EB, a)));
    m.push(m[i - 1] + (b - a) * side / maxAcross + Math.max(dA, dB) / maxSeam);
  }
  const K = Math.max(2, Math.ceil(m[N]) + 1), out = []; let j = 0;
  for (let k = 0; k < K; k++) { const target = m[N] * k / (K - 1); while (j < N - 1 && m[j + 1] < target) j++; const t = m[j + 1] > m[j] ? (target - m[j]) / (m[j + 1] - m[j]) : 0; out.push(fine[j] + (fine[j + 1] - fine[j]) * Math.min(1, Math.max(0, t))); }
  out[0] = f0; out[K - 1] = f1;
  return out;
}
/** The u of each fraction on a profile (its own edges). */
const usOf = (P, fr) => { const E = edgesOf(P); return fr.map((f) => uAt(E, f)); };
/** smoothstep, clamped: 0 below 0, 1 above 1, zero slope at both ends (no kink where a ramp starts or ends). */
const smoothstep = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

module.exports = { normalize, psiAt, offsetAt, normalAt, samplesAcross, maxPsi, blend, blendSamples, usOf, smoothstep };
