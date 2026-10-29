// bankswing.js: BANK THE BEND. The bank laid over a stretch of road as one swing, across every joint in it: from the bank there at s0, up (or down) to
// peakDeg at peakS, on to exitDeg at s1. Extend lays one held bank per piece; a bend's bank is its own line along the road, starting before the bend and
// running past it, so a swing over a bend took several pieces or several strokes of the brush, and care at every joint.
//
//   swingBank(doc, { s0, s1, peakS, peakDeg, exitDeg = null, shape = 'rounded' }) -> doc
//     s0, s1, peakS   lap distance (the adapter's s, src/core/sculpt.js pieceOffsets), s0 < peakS < s1; on a closed lap s may wrap past the length
//     peakDeg         the bank at peakS, degrees (+ = left side up, as phi)
//     exitDeg         the bank at s1, degrees; null: the bank there as it is. When it differs, the road after s1 keeps its own bank moved by the same
//                     amount (its shape and every joint as they were) up to the next jump or the end of the track
//     shape           each half's blend: 'rounded' (extend.js roundedLinear, the bank's rounded-linear ramp) or 'quintic' (6u⁵ − 15u⁴ + 10u³); both have
//                     zero slope and curvature at their ends, so the swing is C2 at s0, the peak and s1
//
// HOW: the swing's control points are fitted to it by least squares, on the pieces' OWN knots (shared with kh and kv, so keeping them keeps the route), with
// the bank held exactly at s0, peakS and s1 and with the document's joint rule as constraints solved with the fit: at every road-road joint a free point
// reaches, value and slope from both sides agree (C1, as document.js checks), and inside [s0, s1] where both pieces have six or more control points the
// curvature agrees too (C2, as smoothramps.js lays a ramp). The free points are those whose support meets (s0, s1); every other point keeps its value, so a
// joint the swing does not reach keeps its bytes. After the fit the points are quantised and each joint's two points re-set from the other side's end value and
// slope, exactly as pitflat.js does, so quantising cannot open a joint. Only phi changes: kh, kv, w, r, h, l, c, e, s, t, er, every knot, every length and every
// jump are the same bytes, and the centreline does not move (phi turns the cross-section about the road's direction).
//
// Refused by name (CoreError): BAD_RANGE (out of order, the peak not inside, off the road, or longer than the lap), NOT_ROAD (a jump inside the stretch),
// TOO_SHORT (a half shorter than one knot span of the road it lies on), BAD_SHAPE, BAD_TARGET (a bank that is not a finite number), and SWING_REFUSED with the
// cause: the joints cannot all be met, a closed lap with no jump cannot carry an exit bank round to where the swing starts, or checkDoc's own word.
'use strict';
const D = require('./document.js');
const SC = require('./sculpt.js');
const X = require('./extend.js');
const { toSegments } = require('./adapter.js');

const DEG = Math.PI / 180;
const SHAPES = ['rounded', 'quintic'];
const DS = 0.5;   // the fit's sample spacing, m
const MIN_C2 = 6;   // a free control point at each end of a piece (smoothramps.js MIN_POINTS)
// The fit's weight on the road either side of the stretch, against 1 inside it: a free point's support reaches up to four spans past s0 and s1, and the fit's
// ripple there is a change the user did not ask for. Measured on three 100 m straights, 40° over 100 m each way: the worst change before s0 was 0.148° (rounded)
// and 0.174° (quintic) at 1, 0.062° and 0.041° at 10, 0.073° and 0.033° at 100; the worst error inside 0.365°/0.306° at 1, 0.370°/0.316° at 10, and at 1000 the
// roll rose 0.526 against the ideal's 0.500 °/m.
const OUTSIDE = 10;

/**
 * One half of the swing: its share u in [0, 1] of a half `len` metres long, blended by `shape`. The rounded rate rounds over extend.js's 10 m, or over the
 * largest knot span under the half when that is longer (`span`), and never over more than a quarter of the half. Extend gives a short ramp extra knots to
 * round in; a swing keeps the knots it finds, and a cubic on 20 m spans cannot turn its rate round in 10 m: measured on three 100 m straights, 40° over 100 m
 * each way, rounding over 10 m fitted to a roll of 0.511 °/m against the ideal's 0.444 and rippled 0.031 °/m before the stretch; over the 20 m span, 0.508
 * against the ideal's 0.500, rippling 0.012.
 */
function blendOf(shape, len, span) {
  if (shape === 'quintic') return X.smoother;
  const a = Math.min(Math.max(X.BANK_ROUND_M, span), len / 4) / len;
  return (u) => X.roundedLinear(u, a);
}

/** The value, slope and curvature of phi at local s as a linear form in the piece's control points: [{ k, v, d1, d2 }] over the points that reach s. */
function formAt(P, s) {
  const n = P.channels.phi.length, out = [];
  for (let k = 0; k < n; k++) {
    const arr = new Array(n).fill(0); arr[k] = 1;
    const r = D.channelAt({ length: P.length, knots: P.knots, channels: { phi: arr } }, 'phi', s);
    if (r.v !== 0 || r.d1 !== 0 || r.d2 !== 0) out.push({ k, v: r.v, d1: r.d1, d2: r.d2 });
  }
  return out;
}
/** The basis values at local s of the points k − 4 .. k + 1 around s's span (a cubic's four, and its neighbours at a knot). */
function basisAt(P, U, s) {
  const n = P.channels.phi.length, x = Math.min(Math.max(s, 0), P.length);
  let k = 3; while (k < n - 1 && x >= U[k + 1]) k++;
  const out = [];
  for (let j = Math.max(0, k - 4); j <= Math.min(n - 1, k + 1); j++) {
    const arr = new Array(n).fill(0); arr[j] = 1;
    const v = D.channelValue({ length: P.length, knots: P.knots, channels: { phi: arr } }, 'phi', x);
    if (v !== 0) out.push({ k: j, v });
  }
  return out;
}

/** Solve the square system M·x = b by Gaussian elimination with partial pivoting; null when it is singular. */
function solve(M, b) {
  const n = b.length, A = M.map((r, i) => [...r, b[i]]);
  let scale = 0; for (const r of A) for (let j = 0; j < n; j++) scale = Math.max(scale, Math.abs(r[j]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (!(Math.abs(A[p][c]) > 1e-12 * scale)) return null;
    if (p !== c) [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; if (f) for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j]; }
  }
  const x = new Array(n).fill(0);
  for (let c = n - 1; c >= 0; c--) { let v = A[c][n]; for (let j = c + 1; j < n; j++) v -= A[c][j] * x[j]; x[c] = v / A[c][c]; }
  return x;
}

function swingBank(doc, { s0, s1, peakS, peakDeg, exitDeg = null, shape = 'rounded' } = {}) {
  if (!SHAPES.includes(shape)) throw new D.CoreError('BAD_SHAPE', `the swing's shape is 'rounded' or 'quintic', got ${shape}`);
  if (!Number.isFinite(peakDeg) || (exitDeg !== null && exitDeg !== undefined && !Number.isFinite(exitDeg))) throw new D.CoreError('BAD_TARGET', `the peak and exit bank must be finite numbers of degrees, got ${peakDeg} and ${exitDeg}`);
  if (!([s0, s1, peakS].every(Number.isFinite) && s0 < peakS && peakS < s1)) throw new D.CoreError('BAD_RANGE', `bank the bend needs a stretch with its peak inside it (s0 < peak < s1), got ${s0}, ${peakS}, ${s1} m`);
  const N = doc.pieces.length, off = SC.pieceOffsets(doc);
  if (!N) throw new D.CoreError('BAD_RANGE', 'there is no road to bank');
  const last = doc.pieces[N - 1];
  const total = off[N - 1] + (last.type === 'road' ? last.length : toSegments(doc).filter((g) => g.id === last.id).reduce((a, g) => a + g.length, 0));
  const lenOf = (i) => (i + 1 < N ? off[i + 1] : total) - off[i];
  if (doc.closed) {
    const w = Math.floor(s0 / total) * total; s0 -= w; peakS -= w; s1 -= w;
    if (s1 - s0 >= total) throw new D.CoreError('BAD_RANGE', `the stretch (${(s1 - s0).toFixed(1)} m) is as long as the lap (${total.toFixed(1)} m) or longer`);
  } else {
    let roadEnd = 0; doc.pieces.forEach((P, i) => { if (P.type === 'road') roadEnd = off[i] + P.length; });
    if (s0 < 0 || s1 > roadEnd + 1e-9) throw new D.CoreError('BAD_RANGE', `the stretch ${s0} to ${s1} m runs off the road (0 to ${roadEnd.toFixed(1)} m)`);
  }

  // the pieces unrolled along s: on a closed lap three times round, from −L to 2L, so every joint a free point can reach has both its pieces in the list
  const E = [];
  for (const r of doc.closed ? [-1, 0, 1] : [0]) doc.pieces.forEach((P, i) => E.push({ x: E.length, i, P, o: off[i] + r * total, end: off[i] + r * total + lenOf(i) }));
  for (const e of E) if (e.P.type !== 'road' && e.end > s0 && e.o < s1) throw new D.CoreError('NOT_ROAD', `there is a jump (${e.P.id}) inside the stretch; bank the road either side of it`);
  const roadAt = (s) => { let hit = null; for (const e of E) if (e.P.type === 'road' && e.o <= s + 1e-9 && s <= e.end + 1e-9) { hit = e; if (s < e.end - 1e-9) break; } return hit; };
  const spans = [[s0, peakS], [peakS, s1]].map(([a, b]) => {
    let span = 0;
    for (const e of E) {
      if (e.P.type !== 'road' || e.end < a || e.o > b) continue;
      const t = [0, ...e.P.knots, e.P.length]; for (let k = 0; k + 1 < t.length; k++) if (e.o + t[k + 1] >= a && e.o + t[k] <= b) span = Math.max(span, t[k + 1] - t[k]);
    }
    if (b - a < span) throw new D.CoreError('TOO_SHORT', `a half of the swing is ${(b - a).toFixed(1)} m, shorter than one knot span of the road under it (${span.toFixed(1)} m); lengthen it`);
    return span;
  });

  const orig = (s) => { const e = roadAt(s); return D.channelValue(e.P, 'phi', s - e.o); };
  const v0 = orig(s0), vp = peakDeg * DEG, v1 = exitDeg === null || exitDeg === undefined ? orig(s1) : exitDeg * DEG, shift = v1 - orig(s1);
  const S1 = blendOf(shape, peakS - s0, spans[0]), S2 = blendOf(shape, s1 - peakS, spans[1]);
  const target = (s, was) => (s <= s0 ? was : s <= peakS ? v0 + (vp - v0) * S1((s - s0) / (peakS - s0)) : s <= s1 ? vp + (v1 - vp) * S2((s - peakS) / (s1 - peakS)) : was + shift);

  // after s1 the road keeps its own bank, moved by `shift`, to the next jump or the track's end; on a closed lap with no jump that would come round to s0
  const qd = 10 ** -D.DEC.phi, moved = Math.abs(shift) > qd / 2;
  let shiftEnd = Infinity;
  if (moved) {
    for (const e of E) if (e.P.type !== 'road' && e.o >= s1 && e.o < shiftEnd) shiftEnd = e.o;
    if (doc.closed && !(shiftEnd < s0 + total)) throw new D.CoreError('SWING_REFUSED', `on a closed lap with no jump an exit bank of ${exitDeg}° (the road there is ${(orig(s1) / DEG).toFixed(2)}°) would have to carry all the way round to where the swing starts; leave the exit bank as it is and swing the next stretch from there`);
  }

  // the working arrays, by piece index: the bank as it is, moved after s1, then the free points from the fit
  const work = new Map(), owner = new Map(), free = [], col = new Map();
  const claim = (e) => {
    if (owner.has(e.i) && owner.get(e.i) !== e) throw new D.CoreError('BAD_RANGE', `the stretch reaches piece ${e.P.id} twice: it is as long as the lap or longer`);
    owner.set(e.i, e); if (!work.has(e.i)) work.set(e.i, e.P.channels.phi.slice()); return work.get(e.i);
  };
  for (const e of E) {
    if (e.P.type !== 'road' || e.end < s0 - 1e-9 || e.o > Math.min(shiftEnd, moved ? Infinity : s1) + 1e-9) continue;
    const U = D.knotVector(e.P), n = e.P.channels.phi.length; let mine = null;
    for (let k = 0; k < n; k++) {
      const a = e.o + U[k], b = e.o + U[k + 4];
      if (a < s1 && b > s0) { mine = mine || claim(e); col.set(`${e.x}:${k}`, free.length); free.push({ e, k }); }
      else if (moved && a >= s1 && a < shiftEnd) { mine = mine || claim(e); mine[k] = Number((e.P.channels.phi[k] + shift).toFixed(D.DEC.phi)) + 0; }
    }
  }
  const m = free.length, H = Array.from({ length: m }, () => new Array(m).fill(0)), g = new Array(m).fill(0);
  const value = (e, k) => (work.get(e.i) || e.P.channels.phi)[k];

  // the least-squares fit, over every piece that has a free point, sampled every DS metres where a free point reaches
  for (const e of new Set(free.map((f) => f.e))) {
    const U = D.knotVector(e.P), L = e.P.length, steps = Math.max(1, Math.ceil(L / DS));
    for (let q = 0; q <= steps; q++) {
      const u = (L * q) / steps, B = basisAt(e.P, U, u), fr = B.filter((b) => col.has(`${e.x}:${b.k}`));
      if (!fr.length) continue;
      let rest = target(e.o + u, orig(e.o + u)); for (const b of B) if (!col.has(`${e.x}:${b.k}`)) rest -= b.v * value(e, b.k);
      const wt = e.o + u < s0 || e.o + u > s1 ? OUTSIDE : 1;
      for (const a of fr) { const ia = col.get(`${e.x}:${a.k}`); g[ia] += wt * a.v * rest; for (const c of fr) H[ia][col.get(`${e.x}:${c.k}`)] += wt * a.v * c.v; }
    }
  }
  // the constraints: rows [{ idx: free column, w }] = rhs, the held points' share moved to the right
  const C = [];
  const row = (terms, rhs) => {
    const r = new Map(); let b = rhs;
    for (const { e, k, w } of terms) { if (!w) continue; const c = col.get(`${e.x}:${k}`); if (c === undefined) b -= w * value(e, k); else r.set(c, (r.get(c) || 0) + w); }
    if (r.size) C.push({ r, b });
  };
  const pointForm = (s, key) => { const e = roadAt(s); return formAt(e.P, s - e.o).map((f) => ({ e, k: f.k, w: f[key] })); };
  row(pointForm(s0, 'v'), v0); row(pointForm(peakS, 'v'), vp); row(pointForm(s1, 'v'), v1);
  const joints = [];
  for (let x = 1; x < E.length; x++) {
    const a = E[x - 1], b = E[x];
    if (b.P.type !== 'road') continue;
    const nA = a.P.type === 'road' ? a.P.channels.phi.length : 0, hits = (e, ks) => ks.some((k) => col.has(`${e.x}:${k}`));
    if (a.P.type !== 'road') {   // a landing starts at its flight's bank (document.js landingProblem): its first point stays where it is
      if (hits(b, [0])) row([{ e: b, k: 0, w: 1 }], b.P.channels.phi[0]);
      continue;
    }
    if (!hits(a, [nA - 3, nA - 2, nA - 1]) && !hits(b, [0, 1, 2])) continue;
    const fa = formAt(a.P, a.P.length), fb = formAt(b.P, 0), J = b.o;
    for (const key of ['v', 'd1']) row([...fa.map((f) => ({ e: a, k: f.k, w: f[key] })), ...fb.map((f) => ({ e: b, k: f.k, w: -f[key] }))], 0);
    if (J >= s0 && J <= s1 && nA >= MIN_C2 && b.P.channels.phi.length >= MIN_C2) row([...fa.map((f) => ({ e: a, k: f.k, w: f.d2 })), ...fb.map((f) => ({ e: b, k: f.k, w: -f.d2 }))], 0);
    joints.push([a, b]);
  }
  // the fit with the constraints, by its normal equations and Lagrange multipliers: [H Cᵀ; C 0] [x; λ] = [g; c]
  const K = m + C.length, M = Array.from({ length: K }, () => new Array(K).fill(0)), rhs = new Array(K).fill(0);
  for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) M[i][j] = H[i][j]; rhs[i] = g[i]; }
  C.forEach(({ r, b }, c) => { for (const [j, w] of r) { M[m + c][j] = w; M[j][m + c] = w; } rhs[m + c] = b; });
  const x = solve(M, rhs);
  if (!x) throw new D.CoreError('SWING_REFUSED', 'the road under the stretch has too few control points to carry the swing and keep its joints smooth; lengthen the stretch');
  free.forEach(({ e, k }, c) => { work.get(e.i)[k] = Number(x[c].toFixed(D.DEC.phi)) + 0; });

  // quantised, each joint made C1 again exactly as the document builds a piece (pitflat.js): the side the fit moved takes the other side's end value and slope
  for (const [a, b] of joints) {
    const A0 = work.get(a.i) || a.P.channels.phi, B0 = work.get(b.i) || b.P.channels.phi, n = A0.length, isFree = (e, k) => col.has(`${e.x}:${k}`);
    const hA = a.P.length - (a.P.knots.length ? a.P.knots[a.P.knots.length - 1] : 0), hB = b.P.knots.length ? b.P.knots[0] : b.P.length;
    const slopeA = () => (3 * (A0[n - 1] - A0[n - 2])) / hA, slopeB = () => (3 * (B0[1] - B0[0])) / hB, qt = (v) => Number(v.toFixed(D.DEC.phi)) + 0;
    if (isFree(b, 0)) { B0[0] = A0[n - 1]; B0[1] = qt(B0[0] + (slopeA() * hB) / 3); }
    else if (isFree(a, n - 1)) { A0[n - 1] = B0[0]; A0[n - 2] = qt(A0[n - 1] - (slopeB() * hA) / 3); }
    else if (isFree(b, 1)) B0[1] = qt(B0[0] + (slopeA() * hB) / 3);
    else if (isFree(a, n - 2)) A0[n - 2] = qt(A0[n - 1] - (slopeB() * hA) / 3);
  }

  const pieces = doc.pieces.map((P, i) => {
    const w = work.get(i);
    return !w || w.every((v, k) => v === P.channels.phi[k]) ? P : { ...P, channels: { ...P.channels, phi: w } };
  });
  try { return Object.freeze(D.checkDoc({ ...doc, pieces: Object.freeze(pieces) })); }
  catch (e) {
    if (e && e.name === 'CoreError') throw new D.CoreError('SWING_REFUSED', `this swing would break a rule of the track (${e.message}); change the stretch or the bank`);
    throw e;
  }
}

module.exports = { swingBank };
