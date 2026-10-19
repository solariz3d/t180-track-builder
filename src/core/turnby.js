// turnby.js: TURN BY (D280; the keeper, 2026-10-09 18:52: "have a subtle problem with 90 degree turns not coming out straight, it should be but isnt"). The turn
// channel kh is a RATE (rad per metre of road), and Extend eases a piece to the rate it is given, so a piece that turns 90° that way ENDS still turning: on the
// keeper's TEST TRACK 3 (a copy) a 750 m piece turns −90.0° and ends at −24°/100 m, and the next piece's "turn 0, at start" spends −1.35° ramping that rate to 0.
//
//   extendTurnBy(doc, opts, theta)    Extend (opts as extend's: length, width, climb…) with a piece that turns EXACTLY theta (rad, + = left) and ENDS STRAIGHT:
//                                     turn rate 0 and its slope 0, so the next piece starts dead straight. Refused by name (TURN_TOO_SHORT) when the piece is
//                                     too short to have a free turn control point; the refusal carries `needM`, the shortest length that has one.
//   shortestTurnBy(doc, opts)         that length (m, whole metres).
//   extendCorner(doc, opts)           Extend with the panel's turn field read as a CORNER (D331 B, the panel's default): opts.turnDeg (degrees, + = left) is the
//                                     exact map heading change of the piece, which ends straight (extendTurnBy, so the same refusals); without turnDeg, Extend.
//
// HOW. D331 C (ledger D332; the keeper, 2026-10-15: "the turn angle should take into account the banking to make the turns more intuitive ... but then turns that
// have less banking or no banking also just work how it should to convey the proper degrees to line up with the grid"). The turn rate is a SYMMETRIC EASE: it
// rises over the first half of the piece and falls over the second by the same Bloss blend (extend.js bloss), so it peaks at the middle and lets go exactly as
// gently as it built up. Before D331 the piece started as Extend's, eased to an end rate (the keeper's 18:55 "THERE is nothign wrong with the 90 degree curves
// that can be made now"), and was ended in its last two knot spans, so a 90° Turn by over 105 m peaked at 74% of the piece and let go about four times as fast as it
// came in; on a steep bank, where most of a turn bends through the road's up (on 53.5°, cos = 0.59 of it lies in the road's plane), a quick let-go is a sudden
// twist-and-dip. The ease is read at the knot averages (extend.js rampControl's variation-diminishing way: no ringing, and symmetric knots give symmetric
// control points); a head still turning fades out over the first half; the joint's first two control points stay (the piece continues C1 from the head,
// src/core/README.md) and the last two are 0 (it ends straight: rate 0 and slope 0). The heading change is LINEAR in the control points (the adapter's rule: the
// heading grows by the trapezoid of kh over each 2 m segment, src/core/adapter.js toSegments), so the ease's height that turns theta is one solve; the stored
// rounding is then taken up by the least-norm step close.js takes (ref 04 §3: δ = Jᵀ(JJᵀ)⁻¹(−r)) on the free control points.
// THE LIMIT: none but having a free control point. Neither the document nor the validator bounds the turn rate (at the open track's 970 km/h the loads of a
// turn are amber, D256), so a short sharp turn is the user's to judge by driving it; how sharp a builder turn can be is D280 part 2's to measure.
'use strict';
const D = require('./document.js');
const { extend, bloss } = require('./extend.js');
const { basisN } = require('../../tools/piecewise.cjs');

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
    const s = (P.length * j) / n, b = basisN(kv, Math.min(Math.max(s, 0), P.length)), cur = { s, first: b.first, N: Array.from(b.N) };
    if (prev) { const h = cur.s - prev.s; for (let k = 0; k < 4; k++) { w[prev.first + k] += (h / 2) * prev.N[k]; w[cur.first + k] += (h / 2) * cur.N[k]; } }
    prev = cur;
  }
  return w;
}
/** The document with the head piece's control points of each channel in `cs` ({ kh, kv }) replaced (quantised as stored). */
function withChannels(doc, cs) {
  const pieces = doc.pieces.slice(), P = pieces[pieces.length - 1], channels = { ...P.channels };
  for (const [ch, c] of Object.entries(cs)) channels[ch] = Array.from(c, (x) => q(x, D.DEC[ch]));
  pieces[pieces.length - 1] = { ...P, channels };
  return freeze(D.checkDoc({ ...doc, pieces }));
}
/** The free columns: all but the joint's first two and the last two. */
const freeOf = (m) => { const f = []; for (let i = 2; i <= m - 3; i++) f.push(i); return f; };

/** Extend's piece with each channel aimed at (kh, kv) eased over it to a rate of 0 (its own at-start ramp dropped): its knots and its joint are the corner's. */
function easedPiece(doc, opts, chs) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to turn from');
  const targets = { ...(opts.targets || {}) }, o = { ...opts, targets };
  for (const ch of chs) targets[ch] = 0;
  if (o.transition && typeof o.transition === 'object') { const rest = { ...o.transition }; for (const ch of chs) delete rest[ch]; if (Object.keys(rest).length) o.transition = rest; else delete o.transition; }
  return extend(doc, o);
}
const headOf = (d) => d.pieces[d.pieces.length - 1];
const turnOf = (w, c) => w.reduce((a, wi, i) => a + wi * c[i], 0);
/** The symmetric ease, 0 → 1 → 0 over u in [0, 1]: the Bloss blend up over the first half and down over the second (1 at u = ½; slope 0 at both ends and at the peak). */
const ease = (u) => (u <= 0 || u >= 1 ? 0 : u <= 0.5 ? bloss(2 * u) : bloss(2 - 2 * u));
/** Channel ch's control points as base + A·shape: the symmetric ease of height A, plus the head's rate fading out over the first half, read at the knot
 *  averages; the joint's first two control points are Extend's (C1 from the head) and the last two 0. null when the piece has no free control point. */
function symmetricEase(P, ch) {
  const m = P.channels[ch].length, U = D.knotVector(P), L = P.length, k0 = P.channels[ch][0], base = Float64Array.from(P.channels[ch]), shape = new Float64Array(m);
  if (!freeOf(m).length) return null;
  for (let i = 2; i <= m - 3; i++) { const u = (U[i + 1] + U[i + 2] + U[i + 3]) / 3 / L; base[i] = u < 0.5 ? k0 * (1 - bloss(2 * u)) : 0; shape[i] = ease(u); }
  base[m - 1] = base[m - 2] = 0;   // it ends straight (level-rate for the climb): rate 0 and slope 0
  return { base, shape };
}

/** The piece whose channels in `aims` ({ kh: θ, kv: Δp }, rad) change the heading and the pitch by exactly those angles, each ending at rate 0. The two are solved
 *  apart: the heading is ∫kh and the pitch ∫kv on the same segments (adapter.js toSegments), and neither channel enters the other's integral. */
/** D404: what a solve starts from does not depend on the angle aimed at: Extend's piece with the channels aimed at eased to 0 (the document and the fields without the angle), and the
 *  heading weights of it (a basis evaluation every 2 m of the piece). A handle drag changes only the angle, so the last few are kept by document and fields (a frozen document, an
 *  answer that did not throw): the next move starts from them. Nothing here is changed by a solve: the weights are read, and every document it makes is a new one. */
const START = new WeakMap(), START_MAX = 4;
/** The key both memos keep answers by: the fields as JSON, with a non-finite number written apart (JSON writes NaN, Infinity and null all as null, so a NaN target
 *  came back with the answer kept for a null one, where a fresh document refuses it; E's review of D404, §0). null when the fields cannot be written. */
const memoKey = (v) => { try { return JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? `\u0000${x}` : x)); } catch (e) { return null; } };
/** A document whose answers may be kept: frozen, and its pieces array too (one frozen at the top only can be edited in place; E's review of D404, §1b). */
const keepable = (doc) => Object.isFrozen(doc) && Object.isFrozen(doc.pieces);
function startOf(doc, opts, chs) {
  const key = memoKey([opts, chs]);
  let memo = key === null || !keepable(doc) ? null : START.get(doc);
  if (memo && memo.has(key)) return memo.get(key);
  const d0 = easedPiece(doc, opts, chs), P0 = headOf(d0), out = { d0, P0, w: turnWeights(P0), free: freeOf(P0.channels.kh.length) };
  if (key !== null && keepable(doc) && Object.isFrozen(d0)) {
    if (!memo) START.set(doc, memo = new Map());
    if (memo.size >= START_MAX) memo.delete(memo.keys().next().value);
    memo.set(key, out);
  }
  return out;
}
function solve(doc, opts, aims) {
  for (const [ch, a] of Object.entries(aims)) if (!Number.isFinite(a)) throw new D.CoreError('BAD_TARGET', `${ch === 'kh' ? 'Turn by' : 'Climb by'} needs a finite angle, got ${a}`);
  const chs = Object.keys(aims), { d0, P0, w, free } = startOf(doc, opts, chs), cs = {};
  for (const ch of chs) {
    const st = symmetricEase(P0, ch), t1 = st ? turnOf(w, st.shape) : 0;
    if (!st || !(Math.abs(t1) > 0)) return { doc: null, converged: false, short: true };
    const A = (aims[ch] - turnOf(w, st.base)) / t1;   // the ease's height that turns (or pitches) by the aim: the angle is linear in it
    cs[ch] = Float64Array.from(st.base, (b, i) => b + A * st.shape[i]);
  }
  let d = withChannels(d0, cs);
  for (let it = 0; it < MAX_ITER; it++) {
    let done = true;
    for (const ch of chs) {
      const c = Float64Array.from(headOf(d).channels[ch]), r = turnOf(w, c) - aims[ch];
      if (Math.abs(r) <= TURN_TOL) { cs[ch] = c; continue; }
      done = false;
      // the least-norm step on the free columns, for the one row w: δ_i = w_i·(−r)/Σ w_k² (k free)
      const ww = free.reduce((a, i) => a + w[i] * w[i], 0);
      if (!(ww > 0)) return { doc: null, converged: false, short: true };
      for (const i of free) c[i] += (w[i] * -r) / ww;
      cs[ch] = c;
    }
    if (done) return { doc: d, converged: true };
    d = withChannels(d0, cs);
  }
  const converged = chs.every((ch) => Math.abs(turnOf(w, headOf(d).channels[ch]) - aims[ch]) <= TURN_TOL);
  return { doc: d, converged };
}

/** The shortest whole-metre length whose piece has a free control point (and converges), from this head with these fields; aims as solve's (a number: the turn). */
function shortestTurnBy(doc, opts, aims = 0) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to turn from');
  const a = typeof aims === 'number' ? { kh: aims } : aims;
  for (let L = Math.max(1, Math.ceil(Number(opts.length) || 1)); L <= 2000; L++) { const r = solve(doc, { ...opts, length: L }, a); if (r.converged) return L; }
  return null;
}
const DEGS = (x) => `${((x * 180) / Math.PI).toFixed(1)}°`;
/** Extend with the piece solve(aims) makes, or refuse by name (TURN_TOO_SHORT with a turn aimed at, CLIMB_TOO_SHORT for a climb alone) with the shortest length that does it. */
function extendBy(doc, opts, aims) {
  for (const k of ['turnDeg', 'climbDeg']) if (opts && k in opts) { const { [k]: _, ...rest } = opts; opts = rest; }   // the fields read as corners are extendCorner's
  const r = solve(doc, opts, aims);
  if (r.converged) return r.doc;
  const need = shortestTurnBy(doc, opts, aims), what = [aims.kh !== undefined ? `turn by ${DEGS(aims.kh)}` : null, aims.kv !== undefined ? `climb by ${DEGS(aims.kv)}` : null].filter(Boolean).join(' and ');
  const ends = aims.kh !== undefined ? 'end straight' : 'end at a steady pitch';
  throw Object.assign(new D.CoreError(aims.kh !== undefined ? 'TURN_TOO_SHORT' : 'CLIMB_TOO_SHORT', need === null ? `a ${opts.length} m piece cannot be shaped to ${what}` : `a ${opts.length} m piece is too short to ${what} and ${ends}: it needs at least ${need} m`), { needM: need });
}
/** Extend with a piece that turns exactly theta (rad) and ends straight, or refuse by name with the shortest length that does it. Turn by's angle is its own (a
 *  turn field read as a corner is dropped); a climb field read as a corner is kept, as Turn by keeps a climb rate typed in the fields. */
const extendTurnBy = (doc, opts, theta) => extendBy(doc, opts, { kh: theta, ...(opts && Number.isFinite(opts.climbDeg) ? { kv: (opts.climbDeg * Math.PI) / 180 } : {}) });
/** D331 (climb): Extend with a piece whose pitch changes by exactly dp (rad, + = nosing up) and ends at a climb rate of 0 (a steady pitch, not necessarily level). */
const extendClimbBy = (doc, opts, dp) => extendBy(doc, opts, { kv: dp });
/** D331 B: Extend with the turn and the climb fields read as corners when opts.turnDeg / opts.climbDeg are given (those exact changes of heading and pitch,
 *  each ending at rate 0), else Extend as it always was. */
function extendCorner(doc, opts = {}) {
  // D404: the panel asks for the same piece three times for every move of a handle drag (the readout's numbers, the corner's, the ghost), and each is the solve below
  // (about 2.5 ms on a 2,000 m piece). The last few answers for one document are kept by its fields, so the move costs one solve. A document is frozen and so is
  // what this returns, and an answer that throws is never kept: the same call is the same document, or the same error.
  const key = memoKey(opts);
  let memo = key === null || !keepable(doc) ? null : MEMO.get(doc);
  if (memo && memo.has(key)) return memo.get(key);
  const out = cornerOf(doc, opts);
  if (key !== null && Object.isFrozen(out) && keepable(doc)) {
    if (!memo) MEMO.set(doc, memo = new Map());
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
    memo.set(key, out);
  }
  return out;
}
const MEMO = new WeakMap(), MEMO_MAX = 6;
function cornerOf(doc, opts) {
  if (!('turnDeg' in opts) && !('climbDeg' in opts)) return extend(doc, opts);
  const { turnDeg, climbDeg, ...rest } = opts, aims = {};
  for (const [ch, k, v] of [['kh', 'turnDeg', turnDeg], ['kv', 'climbDeg', climbDeg]]) {
    if (!(k in opts)) continue;
    if (!Number.isFinite(v)) throw new D.CoreError('BAD_TARGET', `a corner needs a finite number of degrees, got ${k} ${v}`);
    aims[ch] = (v * Math.PI) / 180;
  }
  return extendBy(doc, rest, aims);
}

module.exports = { extendTurnBy, extendClimbBy, extendCorner, shortestTurnBy, turnWeights };
