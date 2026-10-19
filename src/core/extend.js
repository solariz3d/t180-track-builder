// extend.js: grow the track from its open end (the spec's GO §2). The new piece's channels START at the previous piece's
// end value and slope and CONTINUE it (ref 09 §2: v + m·s), so with no handle touched a circle stays a circle and a
// clothoid stays a clothoid. A handle sets a TARGET for one channel, reached over a transition by the Bloss blend
// (1 − S(u))·cont(s) + S(u)·T with S(u) = 3u² − 2u³ (ref 02 §4, ref 09 §2): zero slope change at both ends, no jerk step.
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

const bloss = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));   // ref 02 §4, IFC-BLOSS

/** A channel's function over the new piece: the continuation, blended to the target if there is one (ref 09 §2). */
function channelFn({ v, m }, target, Lt) {
  const cont = (s) => v + m * s;
  if (target === undefined || target === null) return cont;
  if (!Number.isFinite(target)) throw new D.CoreError('BAD_TARGET', `a target must be a finite number, got ${target}`);
  return (s) => { const u = s / Lt, S = bloss(u); return u >= 1 ? target : (1 - S) * cont(s) + S * target; };
}

/** The ramp 'start' means: the first knot span of a piece of this length, at most KNOT_M (20 m); the whole piece when it is shorter than that. */
function startRampM(length, knotM) { const K = D.evenKnots(length, knotM); return K.length ? K[0] : length; }

/**
 * A short ramp cannot be LEAST-SQUARES fitted by a cubic spline with knots every ~20 m: the Bloss blend has zero slope at both ends but its curvature jumps,
 * which the fit follows by ringing. Measured (D195, probe1/2) on w 31 → 12 over a 100 m piece: a 20 m ramp fits to 1.5 m off the ideal, overshoots the target
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
function rampKnots(length, ramps, knotM) {
  const extra = []; for (const R of new Set(ramps)) for (let j = 1; j <= RAMP_KNOTS; j++) extra.push((R * j) / RAMP_KNOTS);
  const gap = Math.min(...ramps) / (2 * RAMP_KNOTS), keep = D.evenKnots(length, knotM).filter((k) => extra.every((e) => Math.abs(e - k) > gap));
  const all = [...extra, ...keep].filter((k) => k > 0.5 && k < length - 0.5).map((k) => +k.toFixed(4)).sort((a, b) => a - b);
  return all.filter((k, i) => i === 0 || k - all[i - 1] > 1e-6);
}
/**
 * Overwrite the free control points of channel `ch` (all but a joint's first two, which carry the continued value and slope, so the joint stays C1) with the
 * ideal ramp at the Greville abscissae, clamped into the range the start value, the target and those two points span (a no-op for a monotone ramp; the continued
 * slope of the joint may legitimately carry the first two points past the range and they are not touched).
 */
function rampControl(piece, ch, from, target, R, held) {
  const P = piece.channels[ch], U = D.knotVector(piece), free = held ? 2 : 0, dec = D.DEC[ch];
  const f = channelFn(from, target, Math.max(R - (2 * R) / RAMP_KNOTS, R / RAMP_KNOTS));
  let lo = Math.min(from.v, target), hi = Math.max(from.v, target); for (let i = 0; i < free; i++) { lo = Math.min(lo, P[i]); hi = Math.max(hi, P[i]); }
  for (let i = free; i < P.length; i++) {
    const xi = (U[i + 1] + U[i + 2] + U[i + 3]) / 3, v = Math.min(hi, Math.max(lo, f(xi)));
    P[i] = Number(v.toFixed(dec)) + 0;
  }
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
  const channels = Object.fromEntries(D.CHANNELS.map((ch) => [ch, channelFn(from[ch], targets[ch], Lof(ch))]));
  const knots = shortRamps.length ? rampKnots(length, shortRamps.map((ch) => ramp[ch]), knotM) : undefined;   // extra knots only where a ramp is short
  const piece = D.roadPiece({ length, family: fam, from: held ? from : null, channels, knotM, knots, cup, edge, tube, grip: grip === undefined ? D.gripOf(last) : grip });
  for (const ch of shortRamps) rampControl(piece, ch, from[ch], targets[ch], ramp[ch], held);   // not fitted: see rampControl
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
      const lo = Math.min(0, C[ch][0], given(targets[ch]) ? targets[ch] : 0);
      C[ch] = C[ch].map((x, i) => Math.min(Math.max(0, cap(i)), Math.max(Math.max(lo, floor(i)), x)));
      const ne = C[ch].length; if (C[ch][ne - 1] <= 1e-3) C[ch][ne - 2] = C[ch][ne - 1];   // an edge that ends at 0 ends flat, so the piece after it starts clean
    }
    C.s = C.s.map((x) => Math.min(D.S_MAX, Math.max(D.S_MIN, x)));
  }
  return D.appendPiece(doc, piece);
}

module.exports = { extend, channelFn, bloss, startRampM, rampKnots, RAMP_KNOTS };
