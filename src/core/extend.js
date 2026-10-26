// extend.js: grow the track from its open end (the spec's GO §2). The new piece's channels START at the previous piece's
// end value and slope and CONTINUE it (ref 09 §2: v + m·s), so with no handle touched a circle stays a circle and a
// clothoid stays a clothoid. A handle sets a TARGET for one channel, reached over a transition by a blend
// (1 − S(u))·cont(s) + S(u)·T. For the ROUTE channels (kh, kv, w, r, …) S is the Bloss cubic 3u² − 2u³ (ref 02 §4, ref 09 §2): zero slope change at
// both ends. For the CROSS-SECTION channels the car's wheels ride on (the bank phi, the cup c, the edges e and er) S is the C2 quintic 6u⁵ − 15u⁴ + 10u³
// (D459, 2026-10-25): zero slope AND zero curvature at both ends. The cubic's curvature is 6·Δ/L² at its ends, so under a wheel 8.4 m out a bank of 30° over
// 100 m arrived with a vertical-curvature step of 15 °/100 m (1.8 g at 300 km/h) at both of its joints, the bump the user felt on TEST 10 at every bank, cup and
// edge joint; the quintic arrives with none (test/core_joint_c2.test.js). Its price: the quintic peaks at 1.875·Δ/L against the cubic's 1.5·Δ/L mid-ramp, so
// a roll sized for the roll-rate amber is longer (finish.js ROLL_PEAK_OVER_MEAN).
//
//   extend(doc, { length, transition, targets: { kh, kv, phi, w, r, c, e, s, t }, family, knotM, grip })  -> a new document, one piece longer
// grip (D261): the new piece's grip, a whole percent 50..150; left out, it is the last road piece's (the road keeps its surface until it is changed), 100 on an empty track.
//
// D225 (ref 09 §10): e (the EDGE angle, degrees >= 0) and s (where the outer zone starts, 0.5 to 0.95 of the half-width) give a piece an edge; t (the TUBE sweep, degrees 0 to 360)
// makes it a tube. A piece is a cup OR a tube (c and t together are refused, BAD_TARGET); a target c after a tube, or t after a cup, switches the kind, starting at the edge the
// previous piece renders. A piece after an edge piece stays an edge piece while its edge is still active (e or its slope not 0), so "turning the edge off" is a target e = 0.
//
// `transition` is a number (metres, one for every channel, as ever) OR a per-channel map { w: 20, phi: 'start', … } (D194b): a channel missing from the
// map uses the piece's length; a value 'start' is the SHORT RAMP AT THE START, startRampM(length, knotM) = the first knot span (≤ 20 m, or the whole
// piece if shorter). A channel with a short ramp reaches its target inside it and HOLDS it for the rest of the piece (the whole piece at the new width,
// with no jump: a later piece's joint is C1). See rampKnots and rampControl for how a short ramp is kept from ringing.
//
// `targets` are ABSOLUTE channel values: kh and kv in rad/m (+ = left, + = nosing up), phi in rad (+ = left side up), w in
// m, r in °/m, c (the CUP, D190) in degrees, 0 to 150. A channel with no target continues. A piece is a CUP piece when a c target is
// given, or when it is extended after a cup piece (the cup then continues like any channel); otherwise it is a LEGACY piece, rendered by
// the old profileAt, unchanged. The first piece of a track takes a cup with first: { c }; a cup that follows a legacy piece starts at the
// edge that piece renders (D.pieceEnd), held. The fit of a short transition can ring past its target (measured: 174.65° for a 150° target
// over 10 m), so the cup's control points are clamped to [0, 150] after the fit: the document never holds a cup outside that range. `transition` (m, default the piece's length) is where each target is
// reached; past it the channel holds the target. On an EMPTY track the first piece starts from `first` (default: level,
// straight, the family's measured width and rate, src/geom/fonts.js), since there is nothing to continue.
'use strict';

const D = require('./document.js');
const { WIDTHS, RATES } = require('../geom/fonts.js');

const bloss = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));   // ref 02 §4, IFC-BLOSS: the route channels' blend (C1 at its ends: S″(0) = 6, S″(1) = −6)
const smoother = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (6 * u - 15) + 10));   // 6u⁵ − 15u⁴ + 10u³ (Perlin's smootherstep): S′ = S″ = 0 at both ends, C2
/** The channels blended by the C2 quintic: what the wheels ride on across the road. The route's own (kh, kv, w, r, s, t, h, l) keep the Bloss cubic. */
const C2_CHANNELS = new Set(['phi', 'c', 'e', 'er']);

/** A channel's function over the new piece: the continuation, blended to the target if there is one (ref 09 §2); `ch` picks the blend (C2_CHANNELS). */
function channelFn({ v, m }, target, Lt, ch) {
  const cont = (s) => v + m * s;
  if (target === undefined || target === null) return cont;
  if (!Number.isFinite(target)) throw new D.CoreError('BAD_TARGET', `a target must be a finite number, got ${target}`);
  const blend = C2_CHANNELS.has(ch) ? smoother : bloss;
  return (s) => { const u = s / Lt, S = blend(u); return u >= 1 ? target : (1 - S) * cont(s) + S * target; };
}

/** The ramp 'start' means: the first knot span of a piece of this length, at most KNOT_M (20 m); the whole piece when it is shorter than that. */
function startRampM(length, knotM) { const K = D.evenKnots(length, knotM); return K.length ? K[0] : length; }

/**
 * A short ramp cannot be LEAST-SQUARES fitted by a cubic spline with knots every ~20 m: the Bloss blend has zero slope at both ends but its curvature jumps,
 * which the fit follows by ringing (the C2 quintic of the cross-section channels rings less at its ends and the same in its middle; the ramp is built the same way). Measured (D195, probe1/2) on w 31 → 12 over a 100 m piece: a 20 m ramp fits to 1.5 m off the ideal, overshoots the target
 * by 1.05 m and puts control points 5.1 m outside the range; a 10 m or 5 m ramp is worse; extra knots shrink it (0.28 m past the target at 4 subdivisions) but never
 * remove it; and the fitted hold is not flat (still 0.35 m off the target at twice the ramp). So a channel with a short ramp is NOT fitted: its control points
 * are the ideal ramp read at the KNOT AVERAGES ξᵢ = (uᵢ₊₁ + uᵢ₊₂ + uᵢ₊₃)/3, the variation-diminishing approximation (ref 10 §2, SOURCED: LYCHE-MORKEN Definition 5.25,
 * eq. (5.30); exact for a constant or a line). The curve lies in the convex hull of its control points (ref 03 §1b, SOURCED: WIKI-BSPLINE), so control points in
 * [start, target] cannot overshoot; and for a monotone ramp the control points are monotone, so the derivative's control points (the differences of these,
 * scaled by positive spans) are all one sign and the curve is monotone (derived, not sourced; sampled in test/core_ramp.test.js). The price is a slightly
 * smoothed ramp (measured in the tests).
 * The piece gets RAMP_KNOTS subdivisions of the ramp as extra knots, so the smoothing is a few tenths of the change and not more, and the ideal ramp is
 * compressed to R − 2 subdivisions (R/2 at 4) because the curve at s depends on points up to about 2 subdivisions ahead: the CURVE then reaches its target by
 * R and holds it exactly afterwards (the control points from ξ ≥ R/2 ARE the target).
 */
const RAMP_KNOTS = 4;
/** D459: a C2 channel's short ramp is read at twice the subdivisions. With 4, the compressed quintic read at the Greville abscissae (ξ₃ at the ramp's end) and the zero-curvature
 *  start (P₂ = P₀) left the whole change to one span: a 54° roll over 100 m read 1.62 °/m against 0.80 before; with 8 it reads the quintic's shape to a few tenths. */
const RAMP_KNOTS_C2 = 8;
function rampKnots(length, ramps, knotM, sub = RAMP_KNOTS) {
  const extra = []; for (const R of new Set(ramps)) for (let j = 1; j <= sub; j++) extra.push((R * j) / sub);
  const gap = Math.min(...ramps) / (2 * sub), keep = D.evenKnots(length, knotM).filter((k) => extra.every((e) => Math.abs(e - k) > gap));
  const all = [...extra, ...keep].filter((k) => k > 0.5 && k < length - 0.5).map((k) => +k.toFixed(4)).sort((a, b) => a - b);
  return all.filter((k, i) => i === 0 || k - all[i - 1] > 1e-6);
}
/**
 * Overwrite the free control points of channel `ch` (all but a joint's first two, which carry the continued value and slope, so the joint stays C1) with the
 * ideal ramp at the Greville abscissae, clamped into the range the start value, the target and those two points span (a no-op for a monotone ramp; the continued
 * slope of the joint may legitimately carry the first two points past the range and they are not touched).
 */
function rampControl(piece, ch, from, target, R, held, sub = RAMP_KNOTS) {
  const P = piece.channels[ch], U = D.knotVector(piece), free = held ? 2 : 0, dec = D.DEC[ch];
  const f = channelFn(from, target, Math.max(R - (2 * R) / sub, R / sub), ch);
  let lo = Math.min(from.v, target), hi = Math.max(from.v, target); for (let i = 0; i < free; i++) { lo = Math.min(lo, P[i]); hi = Math.max(hi, P[i]); }
  for (let i = free; i < P.length; i++) {
    const xi = (U[i + 1] + U[i + 2] + U[i + 3]) / 3, v = Math.min(hi, Math.max(lo, f(xi)));
    P[i] = Number(v.toFixed(dec)) + 0;
  }
}

/**
 * D459: the fitted cubic spline does not carry the quintic's zero curvature at the ramp's two ends (a least-squares fit over knots every ~20 m read 0.0034 °/m²
 * at the start of a 30° bank over 100 m and 0.038 at the start of a 35° edge over 50 m, against the cubic's 0.0178 and 0.0823), so after the fit the one free
 * control point at each end is moved to make the channel's second derivative exactly 0 there: P[2] at the start (P[0] and P[1] carry the continued value and
 * slope and are not touched) and P[n − 3] at the end (P[n − 2] and P[n − 1] carry the end value and slope). The second derivative at an end is read exactly from
 * four samples on the end span (one-sided, exact for the cubic the span is), it is linear in those two points, and the 2 × 2 system is solved; with two interior
 * knots the two points reach both ends, with more they are independent. A piece with fewer than six control points has no free point for both ends and is left
 * as fitted; extend gives a piece with a cross-section target at least THREE interior knots (below), so one point stays free for the least-squares shape: with
 * two, the ramp is the one C2 cubic spline through its ends and peaks 1.20–1.24 times the quintic's rate (30° over 50 m); with three, 1.07–1.09 (measured,
 * D459 peak.js). The next piece continues value and slope by a line (curvature 0), so every joint of a bank, cup or edge ramp is C2 both ways.
 */
function c2Ends(piece, ch) {
  const P = piece.channels[ch], n = P.length, L = piece.length, U = D.knotVector(piece), dec = D.DEC[ch];
  if (n < 6) return;
  const h0 = Math.min(0.5, U[4] / 10), h1 = Math.min(0.5, (L - U[n - 1]) / 10);   // the end spans: U[4] is the first interior knot, U[n − 1] the last (clamped vector)
  const d2 = (arr) => { const Q = { ...piece, channels: { ...piece.channels, [ch]: arr } }, g = (s) => D.valuesAt(Q, s)[ch];
    return [(2 * g(0) - 5 * g(h0) + 4 * g(2 * h0) - g(3 * h0)) / (h0 * h0), (2 * g(L) - 5 * g(L - h1) + 4 * g(L - 2 * h1) - g(L - 3 * h1)) / (h1 * h1)]; };
  const base = d2(P), bump = (i, dv) => { const a = P.slice(); a[i] += dv; return d2(a); };
  const ea = bump(2, 1), eb = bump(n - 3, 1), J = [[ea[0] - base[0], eb[0] - base[0]], [ea[1] - base[1], eb[1] - base[1]]];
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0]; if (!(Math.abs(det) > 1e-12)) return;
  const x = (-base[0] * J[1][1] + base[1] * J[0][1]) / det, y = (-base[1] * J[0][0] + base[0] * J[1][0]) / det;
  P[2] = Number((P[2] + x).toFixed(dec)) + 0; P[n - 3] = Number((P[n - 3] + y).toFixed(dec)) + 0;
}

/**
 * D459: the least-squares fit of a cross-section ramp with its hold PINNED. document.js fitChannel holds the start pair only; the Bloss cubic needed nothing more (a
 * cubic in s, it was fitted exactly, hold and all), but the fitted quintic rang in the hold and at the piece's end (0.02° on a 17° bank, 0.1° at the transition when
 * the hold alone was overwritten). Here every control point whose Greville abscissa lies past the transition, and the last two, are set to the target, and the
 * remaining free points are refitted to the ideal ramp by least squares with those held (the normal equations over samples every ~0.5 m; the basis values come
 * from channelValue on one-hot control points). The ramp then reaches its target at the transition and holds it exactly, as the blend's own definition says.
 */
function fitWithHold(piece, ch, f, Lt, target) {
  const C = piece.channels[ch], n = C.length, U = D.knotVector(piece), L = piece.length, dec = D.DEC[ch], t = Number(target.toFixed(dec)) + 0;
  const pinned = new Set([0, 1, n - 2, n - 1]); for (let i = 2; i < n; i++) if ((U[i + 1] + U[i + 2] + U[i + 3]) / 3 >= Lt - 1e-9) pinned.add(i);
  for (const i of pinned) if (i >= 2) C[i] = t;
  const free = []; for (let i = 0; i < n; i++) if (!pinned.has(i)) free.push(i);
  if (!free.length) return;
  const S = []; const ds = Math.max(0.25, Math.min(0.5, L / 400)); for (let s = 0; s < L; s += ds) S.push(s); S.push(L);
  const one = (i) => ({ ...piece, channels: { ...piece.channels, [ch]: C.map((_, k) => (k === i ? 1 : 0)) } });
  const B = free.map((i) => { const Q = one(i); return S.map((s) => D.channelValue(Q, ch, s)); });
  const held = { ...piece, channels: { ...piece.channels, [ch]: C.map((v, k) => (pinned.has(k) ? v : 0)) } }, rest = S.map((s, q) => f(s) - D.channelValue(held, ch, s));
  const m = free.length, A = Array.from({ length: m }, () => new Float64Array(m + 1));
  for (let a = 0; a < m; a++) { for (let b = 0; b < m; b++) { let v = 0; for (let q = 0; q < S.length; q++) v += B[a][q] * B[b][q]; A[a][b] = v; } let r = 0; for (let q = 0; q < S.length; q++) r += B[a][q] * rest[q]; A[a][m] = r; }
  for (let c = 0; c < m; c++) {   // Gaussian elimination with partial pivoting (m is at most a few tens)
    let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; if (p !== c) [A[c], A[p]] = [A[p], A[c]];
    if (!(Math.abs(A[c][c]) > 1e-12)) return;   // a singular system: the fit as it was
    for (let r = 0; r < m; r++) { if (r === c) continue; const k = A[r][c] / A[c][c]; if (k) for (let j = c; j <= m; j++) A[r][j] -= k * A[c][j]; }
  }
  free.forEach((i, a) => { C[i] = Number((A[a][m] / A[a][a]).toFixed(dec)) + 0; });
}

function extend(doc, opts = {}) {
  let { length, transition, targets = {}, family, knotM, first, grip } = opts;
  if (!(length > 0)) throw new D.CoreError('BAD_LENGTH', `extend needs a positive length, got ${length}`);
  // er, the RIGHT edge angle (document.js): an edge angle typed without a right one sets both sides, as before er existed; a right one typed alone
  // splits them. Its ramp follows e's unless it has its own.
  const set = (v) => v !== undefined && v !== null;
  if (set(targets.e) && !set(targets.er)) targets = { ...targets, er: targets.e };
  if (first && set(first.e) && !set(first.er)) first = { ...first, er: first.e };
  if (transition !== null && typeof transition === 'object' && !Array.isArray(transition) && transition.e !== undefined && transition.er === undefined) transition = { ...transition, er: transition.e };
  for (const k of Object.keys(targets)) if (!D.CHANNELS.includes(k)) throw new D.CoreError('BAD_TARGET', `no channel "${k}" (known: ${D.CHANNELS.join(', ')})`);
  if (targets.c !== undefined && targets.c !== null && !(Number.isFinite(targets.c) && targets.c >= 0 && targets.c <= D.CUP_MAX)) throw new D.CoreError('BAD_CUP', 'the cup target must be from 0 to ' + D.CUP_MAX + ' degrees, got ' + targets.c);
  if (first && first.c !== undefined && !(Number.isFinite(first.c) && first.c >= 0 && first.c <= D.CUP_MAX)) throw new D.CoreError('BAD_CUP', 'the first piece cup must be from 0 to ' + D.CUP_MAX + ' degrees, got ' + first.c);
  const given = (v) => v !== undefined && v !== null;
  for (const [where, o] of [['target', targets], ['first-piece', first || {}]]) {
    // an edge may be below 0 (D406: the zone turns down); how far is the floor's, against the profile it sits on, below
    if (given(o.e) && !Number.isFinite(o.e)) throw new D.CoreError('BAD_EDGE', `the ${where} edge angle e must be a number of degrees, got ${o.e}`);
    if (given(o.er) && !Number.isFinite(o.er)) throw new D.CoreError('BAD_EDGE', `the ${where} right edge angle er must be a number of degrees, got ${o.er}`);
    if (given(o.s) && !(Number.isFinite(o.s) && o.s >= D.S_MIN && o.s <= D.S_MAX)) throw new D.CoreError('BAD_EDGE', `the ${where} edge start s must be from ${D.S_MIN} to ${D.S_MAX} of the half-width, got ${o.s}`);
    if (given(o.t) && !(Number.isFinite(o.t) && o.t >= 0 && o.t <= D.TUBE_MAX)) throw new D.CoreError('BAD_TUBE', `the ${where} tube sweep t must be from 0 to ${D.TUBE_MAX} degrees, got ${o.t}`);
    if (given(o.c) && given(o.t)) throw new D.CoreError('BAD_TARGET', `a piece is a cup or a tube, not both: the ${where} gives a cup c and a tube sweep t`);
  }
  // one ramp length per channel: a number is the same for all (as before); a map gives some channels their own, the rest use the piece's length
  const perChannel = transition !== null && typeof transition === 'object' && !Array.isArray(transition), ramp = {};
  if (perChannel) {
    for (const [ch, v] of Object.entries(transition)) {
      if (!D.CHANNELS.includes(ch)) throw new D.CoreError('BAD_TRANSITION', `the transition map has no channel "${ch}" (known: ${D.CHANNELS.join(', ')})`);
      const R = v === 'start' ? startRampM(length, knotM) : v;
      if (!(Number.isFinite(R) && R > 0 && R <= length)) throw new D.CoreError('BAD_TRANSITION', `the transition of ${ch} must be in (0, length] or 'start', got ${v}`);
      ramp[ch] = R;
    }
  } else {
    const Lt = transition === undefined ? length : transition;
    if (!(Lt > 0 && Lt <= length)) throw new D.CoreError('BAD_TRANSITION', `the transition must be in (0, length], got ${Lt}`);
  }
  const Lof = (ch) => (perChannel ? (ramp[ch] === undefined ? length : ramp[ch]) : transition === undefined ? length : transition);
  const shortRamps = Object.keys(ramp).filter((ch) => ramp[ch] < length - 1e-9 && targets[ch] !== undefined && targets[ch] !== null);
  const last = [...doc.pieces].reverse().find((P) => P.type === 'road');
  const fam = family || (last ? last.family : 'bowl');
  let from = D.endState(doc), held = true; const from0 = from;   // from0: null on an empty track (the at-start `first` applies)
  const f0 = first || {}, kind = given(targets.c) ? 'cup' : given(targets.t) ? 'tube' : !from && given(f0.c) ? 'cup' : !from && given(f0.t) ? 'tube' : D.endKind(doc), cup = kind === 'cup', tube = kind === 'tube';
  if (cup && from && from.c.v > D.CUP_MAX + 1e-6) throw new D.CoreError('BAD_CUP', `a cup cannot start where the tube before it ends: its edge is ${from.c.v.toFixed(2)}° (t/2), past the cup's ${D.CUP_MAX}°; open the tube to a sweep of ${2 * D.CUP_MAX}° or less first (t <= ${2 * D.CUP_MAX}), then switch to a cup`);
  const lastEnd = last && last.edge ? D.pieceEnd(last) : null, lastE = lastEnd && lastEnd.e, lastER = lastEnd && lastEnd.er;
  const live = (x) => !!(x && (Math.abs(x.v) > 1e-9 || Math.abs(x.m) > 1e-9));   // a side still turning its edge
  const edge = given(targets.e) || given(targets.er) || given(targets.s) || (!from && (given(f0.e) || given(f0.er) || given(f0.s))) || live(lastE) || live(lastER);
  if (!from) {   // an empty track: the start state, and nothing held
    const f = { kh: 0, kv: 0, phi: 0, w: WIDTHS[fam], r: RATES[fam], h: 0, l: 0, ...(first || {}) };
    if (f.c === undefined) f.c = D.legacyEdgeDeg(fam, f.w, f.r);   // a cup asked for on an empty track starts at the edge the family renders
    if (f.e === undefined) f.e = 0;
    if (f.er === undefined) f.er = f.e;
    if (f.s === undefined) f.s = D.S_DEFAULT;
    if (f.t === undefined) f.t = 2 * f.c;   // a tube asked for on an empty track starts at twice that edge (its own edge is t/2)
    from = Object.fromEntries(D.CHANNELS.map((ch) => [ch, { v: f[ch], m: 0 }])); held = false;
  }
  if (from.tNext) from = { ...from, t: from.tNext };   // the tube this piece may start continues from tNext (endState reports t only at a tube head)
  const channels = Object.fromEntries(D.CHANNELS.map((ch) => [ch, channelFn(from[ch], targets[ch], Lof(ch), ch)]));
  const c2Targets = [...C2_CHANNELS].filter((ch) => given(targets[ch]));
  const sub = shortRamps.some((ch) => C2_CHANNELS.has(ch)) ? RAMP_KNOTS_C2 : RAMP_KNOTS;   // D459: the short-ramp subdivisions, 8 when a cross-section channel ramps short
  // extra knots only where a ramp is short; D459: a piece with a bank, cup or edge target has at least three interior knots, so c2Ends has a free point at each end and one is left for the shape
  const knots = shortRamps.length ? rampKnots(length, shortRamps.map((ch) => ramp[ch]), knotM, sub) : c2Targets.length && D.evenKnots(length, knotM === undefined ? D.KNOT_M : knotM).length < 3 ? D.evenKnots(length, length / 4) : undefined;
  const piece = D.roadPiece({ length, family: fam, from: held ? from : null, channels, knotM, knots, cup, edge, tube, grip: grip === undefined ? D.gripOf(last) : grip });
  for (const ch of shortRamps) rampControl(piece, ch, from[ch], targets[ch], ramp[ch], held, sub);   // not fitted: see rampControl
  for (const ch of c2Targets) if (!shortRamps.includes(ch)) fitWithHold(piece, ch, channels[ch], Lof(ch), targets[ch]);   // D459: the fitted quintic, its hold and end pinned (fitWithHold)
  // D459: the clamps below may move a channel's last two points ("an edge that ends at 0 ends flat"), so the ends are pinned to zero curvature AFTER them (c2Ends moves
  // only P[2] and P[n − 3]) and the clamps run once more on what it moved: a point pushed past a cap or the floor is held there, and that one end stays C1 (a ramp from
  // rest at the cap: P[2] = P[0], inside; a continued slope at the cap can go past it: rare, and the sweep says where)
  const clamps = () => {
  if (cup) {
    const c = piece.channels.c = piece.channels.c.map((x) => Math.min(D.CUP_MAX, Math.max(0, x))), n = c.length;   // the fit's ringing never leaves [0, 150]
    // a cup that ends AT a limit ends flat, so the piece after it can continue C1 without a control point past the limit (its end slope was a rounding away from 0)
    if (c[n - 1] <= 1e-3 || c[n - 1] >= D.CUP_MAX - 1e-3) c[n - 2] = c[n - 1];
  }
  if (tube) {
    const t = piece.channels.t = piece.channels.t.map((x) => Math.min(D.TUBE_MAX, Math.max(0, x))), n = t.length;   // the fit's ringing never leaves [0, 360]
    if (t[n - 1] <= 1e-3 || t[n - 1] >= D.TUBE_MAX - 1e-3) t[n - 2] = t[n - 1];   // a tube that ends at open or closed ends flat, so the piece after it can continue C1
  }
  if (edge) {
    const C = piece.channels, legacyMid = !cup && !tube ? D.legacyEdgeDeg(fam, Math.max(...C.w), Math.max(...C.r)) : 0;
    const cap = (i) => (tube ? D.TUBE_EDGE_MAX - C.t[i] / 2 : cup ? D.CUP_MAX - C.c[i] : D.CUP_MAX - legacyMid);   // the total edge angle's cap, per control point (the convex hull, ref 03 §1b)
    // and its floor (D406, document.js EDGE_FLOOR): the least a side may add to the profile's own rim angle there (a legacy road's least is at its least width and rise)
    const legacyLeast = !cup && !tube ? D.legacyEdgeDeg(fam, Math.min(...C.w), Math.min(...C.r)) : 0;
    const floor = (i) => D.EDGE_FLOOR - (tube ? C.t[i] / 2 : cup ? C.c[i] : legacyLeast);
    // a TARGET the cap cannot hold is refused by name (only the fit's ringing is clamped, below): the typed e, or the at-start first.e, against what the total cap leaves there
    const what = tube ? 'tube (180°, t/2 + e)' : 'cup/bowl (150°, c + e)';
    if (given(targets.e) && targets.e > cap(C.e.length - 1) + 1e-6) throw new D.CoreError('BAD_EDGE', `the edge target ${targets.e}° is past what the ${what} cap leaves at the end of this piece (${Math.max(0, cap(C.e.length - 1)).toFixed(3)}°)`);
    if (!from0 && given(f0.e) && f0.e > cap(0) + 1e-6) throw new D.CoreError('BAD_EDGE', `the first piece's edge ${f0.e}° is past what the ${what} cap leaves at its start (${Math.max(0, cap(0)).toFixed(3)}°)`);
    if (given(targets.er) && targets.er > cap(C.er.length - 1) + 1e-6) throw new D.CoreError('BAD_EDGE', `the right edge target ${targets.er}° is past what the ${what} cap leaves at the end of this piece (${Math.max(0, cap(C.er.length - 1)).toFixed(3)}°)`);
    if (!from0 && given(f0.er) && f0.er > cap(0) + 1e-6) throw new D.CoreError('BAD_EDGE', `the first piece's right edge ${f0.er}° is past what the ${what} cap leaves at its start (${Math.max(0, cap(0)).toFixed(3)}°)`);
    const under = (side, v, i, where) => { if (given(v) && v < floor(i) - 1e-6) throw new D.CoreError('BAD_EDGE', `the ${side} ${v}° ${where} takes the rim to ${+(v - floor(i) + D.EDGE_FLOOR).toFixed(6)}°, under the floor of ${D.EDGE_FLOOR}° (30° past flat, a lip): the least it may be there is ${+floor(i).toFixed(6)}°`); };
    under('edge target', targets.e, C.e.length - 1, 'at the end of this piece'); under('right edge target', targets.er, C.er.length - 1, 'at the end of this piece');
    if (!from0) { under("first piece's edge", f0.e, 0, 'at its start'); under("first piece's right edge", f0.er, 0, 'at its start'); }
    for (const ch of ['e', 'er']) {
      // the fit's ringing never leaves [0, cap], as before, unless the side is asked below 0 (D406): then it may ring down to the lower of the value it starts at and its target,
      // never under the floor. The asked values, not the fitted end: a fit to a target of 0 can end a hair under it (-0.0069 measured), which must still clamp to 0
      // and the mirror of that above (E's D406 review §4): a side asked only at or below 0, with some of it below, rings no higher than the higher of its two asked
      // values, so a side brought back up to 0 lands at 0 and ends flat (a numeric transition rang -45.5 -> 0 up to +8.28 and ended at +0.67). A side asked above 0
      // keeps the cap, so its bytes do not move. The ceiling never falls under the floor (E's D406 short read §3): a side that only carries on while the floor rises
      // under it (a cup narrowing under e -45) is lifted to the floor, as the low end always did, not refused
      const lo = Math.min(0, C[ch][0], given(targets[ch]) ? targets[ch] : 0), top = Math.max(C[ch][0], given(targets[ch]) ? targets[ch] : C[ch][0]);
      const hi = (i) => (lo < 0 && top <= 0 ? Math.max(top, floor(i)) : Math.max(0, cap(i)));
      // D468 (P's D466 §4): the joint's own two points, the head's value and slope continued, are the head's and not the fit's: a tail still sloping at a limit
      // took P₁ past lo or hi, the clamp moved it, and the piece was refused with the document's raw JOINT error. They are left to checkDoc, which refuses a point
      // past the cap or under the floor BY NAME (a tail still rising at the cap cannot be continued inside it: BAD_EDGE, as it should be)
      C[ch] = C[ch].map((x, i) => (held && i < 2 ? x : Math.min(hi(i), Math.max(Math.max(lo, floor(i)), x))));
      const ne = C[ch].length; if (C[ch][ne - 1] <= 1e-3) C[ch][ne - 2] = C[ch][ne - 1];   // an edge that ends at 0 ends flat, so the piece after it starts clean
    }
    C.s = C.s.map((x) => Math.min(D.S_MAX, Math.max(D.S_MIN, x)));
  }
  };
  clamps();
  for (const ch of c2Targets) c2Ends(piece, ch);   // D459: zero curvature at both ends of a bank, cup or edge ramp
  if (c2Targets.length) clamps();
  return D.appendPiece(doc, piece);
}

module.exports = { extend, channelFn, bloss, smoother, C2_CHANNELS, c2Ends, fitWithHold, startRampM, rampKnots, RAMP_KNOTS, RAMP_KNOTS_C2 };
