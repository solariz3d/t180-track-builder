// turnby.js: TURN BY (D280; the keeper, 2026-10-09 18:52: "have a subtle problem with 90 degree turns not coming out straight, it should be but isnt"). The turn
// channel kh is a RATE (rad per metre of road), and Extend eases a piece to the rate it is given, so a piece that turns 90° that way ENDS still turning: on the
// keeper's TEST TRACK 3 (a copy) a 750 m piece turns −90.0° and ends at −24°/100 m, and the next piece's "turn 0, at start" spends −1.35° ramping that rate to 0.
//
//   extendTurnBy(doc, opts, theta)    Extend (opts as extend's: length, width, climb…) with a piece that turns EXACTLY theta (rad, + = left) and ENDS STRAIGHT:
//                                     turn rate 0 and its slope 0, so the next piece starts dead straight. Refused by name (TURN_TOO_SHORT) when the piece is
//                                     too short to have a free turn control point; the refusal carries `needM`, the shortest length that has one.
//   shortestTurnBy(doc, opts)         that length (m, whole metres).
//
// HOW (level.js's way for the climb, on the turn). The piece starts as TODAY'S broad curve, Extend's own piece eased to the end rate that turns theta (the
// keeper, 18:55: "THERE is nothign wrong with the 90 degree curves that can be made now"), and then ONLY its turn control points are corrected by the least-norm step close.js takes (ref 04 §3: δ = Jᵀ(JJᵀ)⁻¹(−r)): the joint's first two stay (the piece continues C1 from the head,
// src/core/README.md) and the last two stay 0 (it ends straight: rate 0 and slope 0). The heading change is LINEAR in them (the adapter's rule: the heading
// grows by the trapezoid of kh over each 2 m segment, src/core/adapter.js toSegments), so one step is exact; a second step takes up the storage rounding.
// THE LIMIT: none but having a free control point. Neither the document nor the validator bounds the turn rate (at the open track's 970 km/h the loads of a
// turn are amber, D256), so a short sharp turn is the user's to judge by driving it; how sharp a builder turn can be is D280 part 2's to measure.
'use strict';
const D = require('./document.js');
const { extend } = require('./extend.js');
const { basis } = require('../../tools/piecewise.cjs');

const SEG_M = 2;               // the adapter's segment (toSegments segM): the heading is integrated on its ends
const TURN_TOL = 1e-5;         // rad (0.00057°): the bar is 0.01°; kh's storage (1e-9 rad/m) leaves a floor near 1e-7 rad on a 750 m piece, so 1e-7 never met it
const MAX_ITER = 4;
const q = (x, dec) => { const v = Number(x.toFixed(dec)); return Object.is(v, -0) ? 0 : v; };   // document.js's quantisation (what is stored is what is measured)
const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };

/** The heading change over the piece as weights on its turn control points (the adapter's trapezoid on its 2 m segments): Δθ = Σ w[i]·c[i]. */
function turnWeights(P) {
  const n = Math.max(1, Math.ceil(P.length / SEG_M - 1e-9)), kv = [0, 0, 0, 0, ...P.knots, P.length, P.length, P.length, P.length], m = P.channels.kh.length;
  const w = new Float64Array(m);
  let prev = null;
  for (let j = 0; j <= n; j++) {
    const s = (P.length * j) / n, b = basis(kv, Math.min(Math.max(s, 0), P.length)), cur = { s, first: b.first, N: Array.from(b.N) };
    if (prev) { const h = cur.s - prev.s; for (let k = 0; k < 4; k++) { w[prev.first + k] += (h / 2) * prev.N[k]; w[cur.first + k] += (h / 2) * cur.N[k]; } }
    prev = cur;
  }
  return w;
}
/** The document with the head piece's turn control points replaced (quantised as stored). */
function withTurn(doc, c) {
  const pieces = doc.pieces.slice(), P = pieces[pieces.length - 1];
  pieces[pieces.length - 1] = { ...P, channels: { ...P.channels, kh: Array.from(c, (x) => q(x, D.DEC.kh)) } };
  return freeze(D.checkDoc({ ...doc, pieces }));
}
/** The free columns: all but the joint's first two and the last two. */
const freeOf = (m) => { const f = []; for (let i = 2; i <= m - 3; i++) f.push(i); return f; };

/** Extend's piece with the turn eased over it to the rate R (the turn's own at-start ramp dropped): TODAY'S broad curve, as Extend makes it. */
function easedPiece(doc, opts, R) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to turn from');
  const targets = { ...(opts.targets || {}), kh: R }, o = { ...opts, targets };
  if (o.transition && typeof o.transition === 'object') { const { kh, ...rest } = o.transition; if (Object.keys(rest).length) o.transition = rest; else delete o.transition; }
  return extend(doc, o);
}
const headOf = (d) => d.pieces[d.pieces.length - 1];
const turnOf = (w, c) => w.reduce((a, wi, i) => a + wi * c[i], 0);
/** TODAY'S broad curve that turns theta: Extend's eased piece at the end rate R it would take (the piece is linear in R; its knots do not depend on it,
 *  so one solve), the keeper's 18:55 "THERE is nothign wrong with the 90 degree curves that can be made now". Turn by changes only how it ENDS. */
function broadCurve(doc, opts, theta) {
  const R1 = 1e-3, d0 = easedPiece(doc, opts, 0), w = turnWeights(headOf(d0)), t0 = turnOf(w, headOf(d0).channels.kh), t1 = turnOf(w, headOf(easedPiece(doc, opts, R1)).channels.kh);
  if (!(Math.abs(t1 - t0) > 0)) return d0;
  return easedPiece(doc, opts, q(((theta - t0) * R1) / (t1 - t0), D.DEC.kh));
}

function solve(doc, opts, theta) {
  if (!Number.isFinite(theta)) throw new D.CoreError('BAD_TARGET', `Turn by needs a finite angle, got ${theta}`);
  const d0 = broadCurve(doc, opts, theta), P0 = headOf(d0), m = P0.channels.kh.length, free = freeOf(m);
  if (!free.length) return { doc: null, converged: false, short: true };
  const w = turnWeights(P0);
  let c = Float64Array.from(P0.channels.kh); c[m - 1] = 0; c[m - 2] = 0;   // it ends straight: rate 0 and slope 0
  let d = withTurn(d0, c);
  for (let it = 0; it < MAX_ITER; it++) {
    c = Float64Array.from(d.pieces[d.pieces.length - 1].channels.kh);
    const r = w.reduce((a, wi, i) => a + wi * c[i], 0) - theta;
    if (Math.abs(r) <= TURN_TOL) return { doc: d, converged: true, residual: r };
    // the least-norm step on the free columns, for the one row w: δ_i = w_i·(−r)/Σ w_k² (k free)
    const ww = free.reduce((a, i) => a + w[i] * w[i], 0);
    if (!(ww > 0)) return { doc: null, converged: false, short: true };
    for (const i of free) c[i] += (w[i] * -r) / ww;
    d = withTurn(d0, c);
  }
  const cf = d.pieces[d.pieces.length - 1].channels.kh, r = w.reduce((a, wi, i) => a + wi * cf[i], 0) - theta;
  return { doc: d, converged: Math.abs(r) <= TURN_TOL, residual: r };
}

/** The shortest whole-metre length whose piece has a free turn control point (and converges), from this head with these fields. */
function shortestTurnBy(doc, opts, theta = 0) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to turn from');
  for (let L = Math.max(1, Math.ceil(Number(opts.length) || 1)); L <= 2000; L++) { const r = solve(doc, { ...opts, length: L }, theta); if (r.converged) return L; }
  return null;
}
/** Extend with a piece that turns exactly theta (rad) and ends straight, or refuse by name with the shortest length that does it. */
function extendTurnBy(doc, opts, theta) {
  const r = solve(doc, opts, theta);
  if (r.converged) return r.doc;
  const need = shortestTurnBy(doc, opts, theta);
  throw Object.assign(new D.CoreError('TURN_TOO_SHORT', need === null ? `a ${opts.length} m piece cannot be shaped to turn by ${(theta * 180 / Math.PI).toFixed(1)}°` : `a ${opts.length} m piece is too short to turn by ${(theta * 180 / Math.PI).toFixed(1)}° and end straight: it needs at least ${need} m`), { needM: need });
}

module.exports = { extendTurnBy, shortestTurnBy, turnWeights };
