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
  // the first i >= 1 with P.u[i] >= u (the linear scan it replaces found the same i; a binary search keeps a 500-knot edge profile cheap, D225)
  let lo = 1, hi = P.u.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (P.u[m] < u) lo = m + 1; else hi = m; }
  const i = lo, t = (u - P.u[i - 1]) / (P.u[i] - P.u[i - 1]); return P.psi[i - 1] + (P.psi[i] - P.psi[i - 1]) * t;
};
/** ∫ from a to b of (cos ψ, sin ψ) with ψ linear from pa to pb. */
function piece(a, b, pa, pb) {
  const h = b - a, d = pb - pa;
  if (Math.abs(d) < 1e-9) return [Math.cos(pa) * h, Math.sin(pa) * h];
  return [h * (Math.sin(pb) - Math.sin(pa)) / d, -h * (Math.cos(pb) - Math.cos(pa)) / d];
}
// THE RUNNING SUMS OF A FROZEN PROFILE (2026-10-12, the placement lag): offsetAt sums the closed-form pieces from the centre out through every knot
// before u, so a caller that asks at each of a profile's n knots (the checker's constOf, the stacked check) paid O(n² log n), and an edge or tube
// profile has 64+ knots a side. For a FROZEN profile (the window's cached segments, src/core/adapter.js toSegments `cache`) the sums at each knot
// are made once, in the same order, so offsetAt adds only the last partial piece: the same additions in the same order, so bit-identical.
// Any other profile is summed as before.
const sumsMemo = new WeakMap();
function sumsOf(P) {
  let m = sumsMemo.get(P);
  if (m) return m;
  const side = (sgn) => {
    const knots = P.u.filter((x) => (sgn > 0 ? x > 0 : x < 0)).sort((x, y) => sgn * (x - y)), X = [], S = [], psi = [];
    let x = 0, s = 0, a = 0, pa = psiAt(P, 0);
    for (const k of knots) { const pb = psiAt(P, k), [c, d] = piece(a, k, pa, pb); x += c; s += d; X.push(x); S.push(s); psi.push(pb); a = k; pa = pb; }
    return { knots, X, S, psi };
  };
  m = { pos: side(1), neg: side(-1), psi0: psiAt(P, 0) };
  sumsMemo.set(P, m);
  return m;
}
/**
 * D343: a FROZEN copy of profile P (P itself when it is frozen already), so offsetAt takes its running sums above. For a profile a caller builds and then reads at
 * many u (a cup blend at a station, a joint's two cross-sections): an unfrozen one is summed from the centre out to every u, each time; on a 25 km cup track that was
 * 18 of the checker's 23 s. The copy has the same fields and the same numbers, and the running sums add the same pieces in the same order, so every figure is
 * the same. The copy is the caller's own: no profile anyone else holds is frozen by it.
 */
function sealed(P) {
  if (Object.isFrozen(P) && Object.isFrozen(P.u) && Object.isFrozen(P.psi)) return P;
  return Object.freeze({ ...P, u: Object.freeze(P.u.slice()), psi: Object.freeze(P.psi.slice()) });
}
/**
 * D407: normalize + sealed, remembered BY CONTENT. The mesher normalised the piece's profile afresh for every chord (a new, unfrozen object, so every offsetAt ran the slow unfrozen sum:
 * 25% of the full ghost, the measurement of 2026-10-19). The same knots, angles, font and material give the same frozen normalised profile (validated once, on the first), so its
 * running sums are made once. A profile that normalize() refuses is refused every time. At most SEALED_MAX are kept, the oldest dropped first.
 */
const SEALED = new Map(), SEALED_MAX = 64;
// D483: and by IDENTITY for a profile that is frozen with its knots (the core's, which cannot change): a drag's ghost meshes its 48 chords on every move, and with an edge typed
// each chord's 137 knots were written out as text for the key above (numKey: 83 ms of a 3 s drag's 974 ms of rebuilds, D483 §2). A profile frozen with its knots is told by
// its object; any other is keyed by value, as before. A profile that normalize() refuses is never kept, so it is refused every time.
const SEALED_BY = new WeakMap();
const valuesOnly = (o, keys) => keys.every((k) => { const d = Object.getOwnPropertyDescriptor(o, k); return !d || 'value' in d; });
const knotsFrozen = (p) => Object.isFrozen(p) && Object.isFrozen(p.u) && Object.isFrozen(p.psi) && valuesOnly(p, ['u', 'psi', 'font', 'material']) && valuesOnly(p.u, Object.keys(p.u)) && valuesOnly(p.psi, Object.keys(p.psi));
function sealedNormal(profile) {
  if (!profile || !Array.isArray(profile.u) || !Array.isArray(profile.psi)) return sealed(normalize(profile));
  const held = SEALED_BY.get(profile); if (held) return held;
  const k = (profile.font || 'custom') + '|' + (profile.material || 'ROAD') + '|' + numKey(profile.u) + '|' + numKey(profile.psi);
  let r = SEALED.get(k);
  if (!r) { r = sealed(normalize(profile)); if (SEALED.size >= SEALED_MAX) SEALED.delete(SEALED.keys().next().value); SEALED.set(k, r); }
  if (knotsFrozen(profile)) SEALED_BY.set(profile, r);
  return r;
}
/** Offset [X, Y] of the surface point at u, exactly (piecewise closed form). */
function offsetAt(P, u) {
  if (u === 0) return [0, 0];
  if (Object.isFrozen(P) && Object.isFrozen(P.u) && Object.isFrozen(P.psi)) {
    const sgn = u > 0 ? 1 : -1, m = sumsOf(P), sd = sgn > 0 ? m.pos : m.neg, K = sd.knots;
    let lo = 0, hi = K.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sgn * K[mid] < sgn * u) lo = mid + 1; else hi = mid; }   // c = knots strictly inside (0, u)
    const c = lo, a = c ? K[c - 1] : 0, pa = c ? sd.psi[c - 1] : m.psi0, [dx, ds] = piece(a, u, pa, psiAt(P, u));
    return [(c ? sd.X[c - 1] : 0) + dx, sgn * ((c ? sd.S[c - 1] : 0) + ds)];
  }
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
  samplesAcross.runs++;
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
samplesAcross.runs = 0;   // how many times the 4,000-sample walk has run (the work counted by app/test/release-ghost.test.js)
/**
 * D407: samplesAcross, remembered BY CONTENT. A piece's cross-section is nearly one thing for all of its 2 m chords (500 chords in a 1,000 m ghost, 5 different cross-sections among them,
 * each chord running the walk above again: 45% of the full ghost's cost, the measurement of 2026-10-19), and the walk is a function of the knots, the angles and the limits alone, so the
 * answer is kept under exactly those numbers (a -0 is told from a 0): an edited profile is a different key, and nothing can change under the cache. At most SAMPLES_MAX answers are kept
 * (the oldest dropped first). samplesAcrossFor hands back the caller's own copy; samplesShared (the mesher's) hands back the one kept answer, its array FROZEN, so the same chords share one
 * samples array and the mesher can tell it by identity.
 */
const SAMPLES = new Map(), SAMPLES_MAX = 64;
function numKey(a) { let s = ''; for (let i = 0; i < a.length; i++) s += (Object.is(a[i], -0) ? '-0' : a[i]) + ','; return s; }
function samplesShared(P, lim = {}) {
  const k = lim.maxAcross + '|' + lim.maxSeam + '|' + lim.count + '|' + numKey(P.u) + '|' + numKey(P.psi);
  let r = SAMPLES.get(k);
  if (!r) { const w = samplesAcross(P, lim); r = { u: Object.freeze(w.u), need: w.need }; if (SAMPLES.size >= SAMPLES_MAX) SAMPLES.delete(SAMPLES.keys().next().value); SAMPLES.set(k, r); }
  return r;
}
/** The answer as the caller's own copy. */
function samplesAcrossFor(P, lim = {}) { const r = samplesShared(P, lim); return { u: r.u.slice(), need: r.need }; }
/**
 * How wide the cross-section stands across the road (m): the spread of X, the offset along L, over every knot. A wall
 * past vertical folds back, so this is the extreme X, not the edges'. The build view is framed on it (app/camera).
 */
function spanOf(P) { const X = P.u.map((u) => offsetAt(P, u)[0]); return Math.max(...X) - Math.min(...X); }
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
/**
 * Fractions across for meshing a WHOLE PIECE of chord segments (D225): the same measure as blendSamples, but the turning term is the largest |Δψ| of ANY profile in
 * `list`, so one fraction array serves every segment of the piece and the rows two neighbouring segments share are the same cross-section at the same fractions
 * (the mesh then emits no seam zip between them). The list is subsampled to at most `cap` profiles, keeping the first and last.
 */
// D421 (O's shell cut): the answer is a pure function of the subsampled, normalised profiles' u and psi and of maxAcross and maxSeam, and a sculpt step on a tube
// converts the same profiles again and again (20 Grab steps on a tube lap: 842 ms of a 1,551 ms profile was this function's own time). Kept by VALUE, exactly: the key holds every number
// as its shortest exact text (-0 apart), and each caller gets its own copy. Exact (test/core_stepcache.test.js).
const FRACTIONS = new Map(), FRACTIONS_MAX = 64;
const keyNum = (x) => (Object.is(x, -0) ? '-0' : String(x));
function commonFractions(list, { maxAcross = 1, maxSeam = Math.PI / 180, cap = 40 } = {}) {
  const step = Math.max(1, Math.ceil(list.length / cap)), ps = list.filter((_, i) => i % step === 0 || i === list.length - 1).map((p) => normalize(p));
  const key = [keyNum(maxAcross), keyNum(maxSeam), ...ps.map((p) => `${p.u.map(keyNum).join(',')};${p.psi.map(keyNum).join(',')}`)].join('|');
  const hit = FRACTIONS.get(key); if (hit) return hit.slice();
  const out = fractionsOf(ps, maxAcross, maxSeam);
  FRACTIONS.set(key, out); if (FRACTIONS.size > FRACTIONS_MAX) FRACTIONS.delete(FRACTIONS.keys().next().value);
  return out.slice();
}
function fractionsOf(ps, maxAcross, maxSeam) {
  const Es = ps.map(edgesOf), R = Math.max(...Es.map((e) => -e[0])), Lw = Math.max(...Es.map((e) => e[1]));
  const f0 = R > 0 ? -1 : 0, f1 = Lw > 0 ? 1 : 0, N = 4000, fine = []; for (let i = 0; i <= N; i++) fine.push(f0 + (f1 - f0) * i / N);
  const m = [0];
  for (let i = 1; i <= N; i++) {
    const a = fine[i - 1], b = fine[i], side = (a + b) / 2 < 0 ? R : Lw;
    let d = 0; for (let k = 0; k < ps.length; k++) d = Math.max(d, Math.abs(psiAt(ps[k], uAt(Es[k], b)) - psiAt(ps[k], uAt(Es[k], a))));
    m.push(m[i - 1] + (b - a) * side / maxAcross + d / maxSeam);
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

/**
 * The cross-section of a road segment at distance d into it, as the mesh builds it: the segment's own profile, or, where it carries a
 * `blend: { from, s0, length }`, the mix from `from` at weight smoothstep((s0 + d)/length). A reader of segment.profile that is not the mesh
 * must use this, or it sees a blended segment's TARGET for the whole segment (D190: the cup's segments carry blends; markers/place.js and
 * geom/pitlane.js evaluate the same blend for their own purposes).
 */
function atSegment(seg, d) {
  const P = normalize(seg.profile);
  if (!seg.blend) return P;
  const w = smoothstep((seg.blend.s0 + d) / seg.blend.length);
  return w >= 1 ? P : normalize(blend(normalize(seg.blend.from), P, w));
}

/**
 * The cross-section a READER of a segment (not the mesh) takes at distance d into it: the blend evaluated for a CUP segment (`seg.cup`), the
 * segment's own profile for every other. A word document's font-transition blends have always been ignored by the readers (they judge the
 * target font for the whole word); D190 does not change that, so the paused piece builder's validation, layout and export read as before.
 */
function readAt(seg, d) { return readsBlend(seg) ? atSegment(seg, d) : normalize(seg.profile); }
/** The segments whose blend a reader evaluates: a cup's, and a legacy CHORD (D196: the core's width or r changing inside a segment); never a word document's font transition. */
function readsBlend(seg) { return !!(seg && (seg.cup || seg.chord)); }

/**
 * The largest distance (m) between two cross-sections at the same fractions of each side's width: the step a zip between a segment's last row
 * and the next one's first row would span (both are piecewise linear in ψ on the same fractions, so the vertex distance is the curve's gap to
 * within the chord). 0 for identical profiles.
 */
function stepBetween(A, B) {
  A = sealed(normalize(A)); B = sealed(normalize(B));   // D343: read at every fraction, so frozen copies (sealed)
  const EA = edgesOf(A), EB = edgesOf(B), fs = [...new Set([...fractions(A), ...fractions(B), 0])];
  let worst = 0;
  for (const f of fs) { const pa = offsetAt(A, uAt(EA, f)), pb = offsetAt(B, uAt(EB, f)); worst = Math.max(worst, Math.hypot(pa[0] - pb[0], pa[1] - pb[1])); }
  return worst;
}
/**
 * The joints of a segment list whose two sides are drawn from different rows, for the segments a CUP touches (a word document's joints between
 * pieces are what they always were): [{ j, lap, m }] with j the segment that STARTS the joint and m the step in metres between the previous
 * segment's last cross-section and its first. lap is true for the closed lap's seam (last road segment to the first). A joint inside a cup
 * piece is 0 by construction (the run scheme shares rows); the legacy <-> cup joints are matched by the morphs (src/core/adapter.js).
 */
// A joint's step depends on its two segments alone. The window's shell reuses an unchanged piece's segments FROZEN (src/core/adapter.js
// toSegments `cache`), so a joint between two frozen segments is measured once and remembered: the track checker measured every joint of
// the user's 6 km track again on every placement, 6 of the 11 s that a place-then-undo cost (2026-10-12). Any other joint is measured each time.
const stepMemo = new WeakMap();
function jointSteps(segments, closed) {
  if (!segments.some(readsBlend)) return [];
  const out = [], road = (g) => g && g.kind === 'road' && g.profile;
  const measure = (a, b) => stepBetween(readAt(a, a.length), readAt(b, 0));
  const step = (a, b) => {
    if (!Object.isFrozen(a) || !Object.isFrozen(b)) return measure(a, b);
    let byNext = stepMemo.get(a); if (!byNext) { byNext = new WeakMap(); stepMemo.set(a, byNext); }
    let m = byNext.get(b); if (m === undefined) { m = measure(a, b); byNext.set(b, m); }
    return m;
  };
  for (let j = 1; j < segments.length; j++) { const a = segments[j - 1], b = segments[j]; if (road(a) && road(b) && (readsBlend(a) || readsBlend(b))) out.push({ j, lap: false, m: step(a, b) }); }
  const a = segments[segments.length - 1], b = segments[0];
  if (closed && segments.length > 1 && road(a) && road(b) && (readsBlend(a) || readsBlend(b))) out.push({ j: 0, lap: true, m: step(a, b) });
  return out;
}

module.exports = { normalize, sealed, psiAt, offsetAt, normalAt, samplesAcross, samplesAcrossFor, samplesShared, sealedNormal, maxPsi, spanOf, blend, blendSamples, commonFractions, usOf, smoothstep, atSegment, readAt, readsBlend, stepBetween, jointSteps };
