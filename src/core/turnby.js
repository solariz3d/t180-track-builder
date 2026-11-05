// turnby.js: TURN BY (the user, 2026-10-09 18:52: "have a subtle problem with 90 degree turns not coming out straight, it should be but isnt"). The turn
// channel kh is a RATE (rad per metre of road), and Extend eases a piece to the rate it is given, so a piece that turns 90° that way ENDS still turning: on the
// user's TEST TRACK 3 (a copy) a 750 m piece turns −90.0° and ends at −24°/100 m, and the next piece's "turn 0, at start" spends −1.35° ramping that rate to 0.
//
//   extendTurnBy(doc, opts, theta)    Extend (opts as extend's: length, width, climb…) with a piece that turns EXACTLY theta (rad, + = left) and ENDS STRAIGHT:
//                                     turn rate 0 and its slope 0, so the next piece starts dead straight. Refused by name (TURN_TOO_SHORT) when the piece is
//                                     too short to have a free turn control point; the refusal carries `needM`, the shortest length that has one.
//   shortestTurnBy(doc, opts)         that length (m, whole metres).
//   extendCorner(doc, opts)           Extend with the panel's turn field read as a CORNER (the panel's default): opts.turnDeg (degrees, + = left) is the
//                                     exact map heading change of the piece, which ends straight (extendTurnBy, so the same refusals); without turnDeg, Extend.
//
// HOW. (The user, 2026-10-15: "the turn angle should take into account the banking to make the turns more intuitive ... but then turns that
// have less banking or no banking also just work how it should to convey the proper degrees to line up with the grid"). The turn rate is a SYMMETRIC EASE: it
// rises over the first half of the piece and falls over the second by the same Bloss blend (extend.js bloss), so it peaks at the middle and lets go exactly as
// gently as it built up. Before this the piece started as Extend's, eased to an end rate (the user's 18:55 "THERE is nothign wrong with the 90 degree curves
// that can be made now"), and was ended in its last two knot spans, so a 90° Turn by over 105 m peaked at 74% of the piece and let go about four times as fast as it
// came in; on a steep bank, where most of a turn bends through the road's up (on 53.5°, cos = 0.59 of it lies in the road's plane), a quick let-go is a sudden
// twist-and-dip. The ease is read at the knot averages (extend.js rampControl's variation-diminishing way: no ringing, and symmetric knots give symmetric
// control points); a head still turning fades out over the first half; the joint's first two control points stay (the piece continues C1 from the head,
// src/core/README.md) and the last two are 0 (it ends straight: rate 0 and slope 0). The heading change is LINEAR in the control points (the adapter's rule: the
// heading grows by the trapezoid of kh over each 2 m segment, src/core/adapter.js toSegments), so the ease's height that turns theta is one solve; the stored
// rounding is then taken up by the least-norm step close.js takes (ref 04 §3: δ = Jᵀ(JJᵀ)⁻¹(−r)) on the free control points.
// THE LIMIT: none but having a free control point. Neither the document nor the validator bounds the turn rate (at the open track's 970 km/h the loads of a
// turn are amber), so a short sharp turn is the user's to judge by driving it; how sharp a builder turn can be is still to measure.
'use strict';
const D = require('./document.js');
const { extend, bloss, SECOND_MIN_K } = require('./extend.js');
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
/** What a solve starts from does not depend on the angle aimed at: Extend's piece with the channels aimed at eased to 0 (the document and the fields without the angle), and the
 *  heading weights of it (a basis evaluation every 2 m of the piece). A handle drag changes only the angle, so the last few are kept by document and fields (a frozen document, an
 *  answer that did not throw): the next move starts from them. Nothing here is changed by a solve: the weights are read, and every document it makes is a new one. */
const START = new WeakMap(), START_MAX = 4;
/** The key both memos keep answers by: the fields as JSON, with a non-finite number written apart (JSON writes NaN, Infinity and null all as null, so a NaN target
 *  came back with the answer kept for a null one, where a fresh document refuses it). null when the fields cannot be written. */
const memoKey = (v) => { try { return JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? `\u0000${x}` : x)); } catch (e) { return null; } };
/** A document whose answers may be kept: frozen, and its pieces array too (one frozen at the top only can be edited in place). */
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
/** Climb: Extend with a piece whose pitch changes by exactly dp (rad, + = nosing up) and ends at a climb rate of 0 (a steady pitch, not necessarily level). */
const extendClimbBy = (doc, opts, dp) => extendBy(doc, opts, { kv: dp });
/** Extend with the turn and the climb fields read as corners when opts.turnDeg / opts.climbDeg are given (those exact changes of heading and pitch,
 *  each ending at rate 0), else Extend as it always was. */
function extendCorner(doc, opts = {}) {
  // the panel asks for the same piece three times for every move of a handle drag (the readout's numbers, the corner's, the ghost), and each is the solve below
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
// ── L139, A LIST OF CORNERS IN ONE PIECE (the keeper, 2026-11-05 06:49Z: "With turns you can create multiple snaking curves with one piece, the same with the climb if you
// are inverted or upside down"). extendCorner(doc, { turnDeg, changes: { turnDeg: [{ from, deg }, ...] } }) (and climbDeg the same): corner 0 is turnDeg over [0, the first
// mark], corner k its deg over [its mark, the next mark or the end]. Each corner is the symmetric ease of its own segment (0 at both of its marks, so the road runs straight,
// or at a steady pitch, at every mark), and the heights are solved together so the angle up to each mark is exact: the angle to a point s is linear in the control points
// (the trapezoid of the adapter's segments, as turnWeights), one row per mark and one for the end. Each corner after the first is refused by name when its segment is shorter
// than the shortest corner from a straight (cornerMinM: every mark is straight); the first, when the head cannot make it before the first mark (shortestTurnBy).
const CORNER_SUB = 8;   // knots inserted across each corner's segment, as extend.js inserts SECOND_SUB across each change
const CORNER_FIELDS = [['kh', 'turnDeg', 'TURN_TOO_SHORT', 'turn'], ['kv', 'climbDeg', 'CLIMB_TOO_SHORT', 'climb']];
/** The angle from 0 to s1 as weights on the control points: the adapter's trapezoid on its 2 m segments over the piece (turnWeights), cut at s1. */
function weightsTo(P, s1) {
  if (s1 >= P.length - 1e-9) return turnWeights(P);
  const n = Math.max(1, Math.ceil(P.length / SEG_M - 1e-9)), kv = [0, 0, 0, 0, ...P.knots, P.length, P.length, P.length, P.length], w = new Float64Array(P.channels.kh.length);
  const node = (s) => { const b = basisN(kv, Math.min(Math.max(s, 0), P.length)); return { s, first: b.first, N: Array.from(b.N) }; };
  const add = (a, b) => { const h = b.s - a.s; for (let k = 0; k < 4; k++) { w[a.first + k] += (h / 2) * a.N[k]; w[b.first + k] += (h / 2) * b.N[k]; } };
  let prev = node(0);
  for (let j = 1; j <= n; j++) { const s = (P.length * j) / n; if (s >= s1) { add(prev, node(s1)); break; } const cur = node(s); add(prev, cur); prev = cur; }
  return w;
}
/** Solve the small dense system M·x = r (Gaussian elimination, partial pivoting). */
function dense(M, r) {
  const n = r.length, A = M.map((row, i) => [...row, r[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    [A[c], A[p]] = [A[p], A[c]];
    if (!(Math.abs(A[c][c]) > 0)) return null;
    for (let i = c + 1; i < n; i++) { const f = A[i][c] / A[c][c]; for (let j = c; j <= n; j++) A[i][j] -= f * A[c][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let v = A[i][n]; for (let j = i + 1; j < n; j++) v -= A[i][j] * x[j]; x[i] = v / A[i][i]; }
  return x;
}
/** The shortest corner from a straight, in whole metres, with these fields (the knot spacing decides it): every corner after the first starts on one. */
const CORNER_MIN = new Map();
function cornerMinM(doc, opts = {}) {
  const fam = opts.family || ((doc.pieces || []).filter((P) => P.type === 'road').slice(-1)[0] || {}).family || 'bowl', key = `${fam}|${opts.knotM}`;
  if (!CORNER_MIN.has(key)) {
    const straight = extend(D.createDoc('corner min'), { length: 1000, family: fam });
    CORNER_MIN.set(key, shortestTurnBy(freeze(straight), { length: 1, family: fam, ...(opts.knotM === undefined ? {} : { knotM: opts.knotM }) }, { kh: Math.PI / 2 }));
  }
  return CORNER_MIN.get(key);
}
/**
 * THE SHORTEST LATER CORNER (L139 R1, pane E's review §3): a corner after the first is the symmetric ease of its own segment, whose curvature rate (the built heading's,
 * or the pitch's, second difference) scales as Δθ/L²: 90° read 1.021 × ROUTE_BAR over 300 m and 194 × over cornerMinM's 21 m. Under the bar from about 31.5–31.8·√(Δθ in
 * degrees), the bank's own constant from the same ease physics, so: max(cornerMinM, SECOND_MIN_K·√|Δθ°|). Exported for the panel (its offers and default marks).
 */
function cornerChangeMinM(doc, opts, deg) {
  if (!Number.isFinite(deg)) throw new D.CoreError('BAD_TARGET', `a corner's minimum needs a finite number of degrees, got ${deg}`);
  return Math.max(cornerMinM(doc, opts), SECOND_MIN_K * Math.sqrt(Math.abs(deg)));
}
/** The corner lists asked for, checked: { kh: { marks, angles } } (rad), or null when no list has a change. */
function cornerLists(opts) {
  const ch = opts.changes, given = (v) => v !== undefined && v !== null;
  if (!given(ch) || typeof ch !== 'object') return null;
  const out = {};
  for (const [c, k, code, word] of CORNER_FIELDS) {
    const li = ch[k];
    if (given(ch[c]) && k in opts && (!Array.isArray(ch[c]) || ch[c].length)) throw new D.CoreError('BAD_SECOND', `the ${word} is read as corners (${k}): change it with changes.${k}, not changes.${c}`);
    if (!given(li)) continue;
    if (!Array.isArray(li)) throw new D.CoreError('BAD_SECOND', `changes.${k} is a list [{ from, deg }, ...], got ${JSON.stringify(li)}`);
    if (!li.length) continue;
    if (!(k in opts)) throw new D.CoreError('BAD_SECOND', `changes.${k} follows a first corner: give ${k} too`);
    const L = opts.length, marks = [], angles = [(opts[k] * Math.PI) / 180];
    li.forEach((it, j) => {
      const { from: F, deg } = it || {};
      if (!Number.isFinite(deg)) throw new D.CoreError('BAD_TARGET', `the ${word} change ${j + 1}: a corner needs a finite number of degrees, got ${deg}`);
      const lo = j ? marks[j - 1] : 0;
      if (!(Number.isFinite(F) && F > lo && F < L)) throw new D.CoreError('BAD_SECOND', `the ${word} change ${j + 1} starts after ${j ? `change ${j} (${lo} m)` : 'the piece\'s start'} and before its end (${L} m), got ${F}`);
      marks.push(F); angles.push((deg * Math.PI) / 180);
    });
    out[c] = { marks, angles, k, code, word };
  }
  return Object.keys(out).length ? out : null;
}
/** The piece whose channels in `lists` turn (or pitch) by each corner exactly between its marks, at rate 0 at every mark and at the end; channels in `aims` alone as solve's. */
function solveList(doc, opts, lists, aims) {
  const chs = Object.keys(aims), d0 = easedPiece(doc, opts, chs), P0 = headOf(d0), L = P0.length;
  // L140: with later corners, the FIRST corner turns over its own smooth length (cornerChangeMinM) and the road runs straight from there to the first mark (the keeper's
  // drive of L139: his first corner stretched over the whole first half); a first mark nearer than that keeps the corner to the mark. ends(ch)[j]: where corner j's ease ends
  const ends = (ch) => { const b = [0, ...(lists[ch] ? lists[ch].marks : []), L]; return b.slice(1).map((x, j) => (j === 0 && lists[ch] ? Math.min(x, cornerChangeMinM(doc, opts, (lists[ch].angles[0] * 180) / Math.PI)) : x)); };
  const ts = [];
  for (const ch of chs) { const b = [0, ...(lists[ch] ? lists[ch].marks : []), L], e = ends(ch); for (let j = 0; j + 1 < b.length; j++) for (let i = 0; i < CORNER_SUB; i++) ts.push(+(b[j] + ((e[j] - b[j]) * i) / CORNER_SUB).toFixed(4)); }
  const add = [...new Set(ts)].filter((k) => k > 0.5 && k < L - 0.5 && P0.knots.every((h) => Math.abs(h - k) > 1e-3)).sort((a, b) => a - b);
  const P = add.length ? D.insertKnots(P0, add) : P0, d1 = freeze(D.checkDoc({ ...d0, pieces: [...d0.pieces.slice(0, -1), P] }));
  const m = P.channels.kh.length, U = D.knotVector(P), free = freeOf(m), cs = {}, rows = {};
  if (!free.length) return { doc: null, converged: false };
  for (const ch of chs) {
    const marks = lists[ch] ? lists[ch].marks : [], angles = lists[ch] ? lists[ch].angles : [aims[ch]], b = [0, ...marks, L], e = ends(ch), k0 = P.channels[ch][0];
    const base = Float64Array.from(P.channels[ch]), shapes = angles.map(() => new Float64Array(m));
    for (let i = 2; i <= m - 3; i++) {
      const s = (U[i + 1] + U[i + 2] + U[i + 3]) / 3, u0 = s / e[0];
      base[i] = u0 < 0.5 ? k0 * (1 - bloss(2 * u0)) : 0;   // the head's rate fades over the first half of the first corner
      for (let j = 0; j < angles.length; j++) shapes[j][i] = ease((s - b[j]) / (e[j] - b[j]));
    }
    base[m - 1] = base[m - 2] = 0;
    const W = b.slice(1).map((s) => weightsTo(P, s)), want = angles.map((_, r) => angles.slice(0, r + 1).reduce((a, x) => a + x, 0));
    const M = W.map((w) => shapes.map((sh) => turnOf(w, sh))), A = dense(M, W.map((w, r) => want[r] - turnOf(w, base)));
    if (!A) return { doc: null, converged: false };
    cs[ch] = Float64Array.from(base, (x, i) => x + A.reduce((a, h, j) => a + h * shapes[j][i], 0));
    rows[ch] = { W, want };
  }
  const resid = (ch, c) => rows[ch].W.map((w, r) => turnOf(w, c) - rows[ch].want[r]);
  let d = withChannels(d1, cs);
  for (let it = 0; it < MAX_ITER; it++) {
    let done = true;
    for (const ch of chs) {
      const c = Float64Array.from(headOf(d).channels[ch]), r = resid(ch, c);
      if (r.every((x) => Math.abs(x) <= TURN_TOL)) { cs[ch] = c; continue; }
      done = false;
      // the least-norm step on the free columns for the rows W: δ = Wᵀ(WWᵀ)⁻¹(−r)
      const W = rows[ch].W, G = W.map((a) => W.map((b2) => free.reduce((s, i) => s + a[i] * b2[i], 0))), y = dense(G, r.map((x) => -x));
      if (!y) return { doc: null, converged: false };
      for (const i of free) c[i] += W.reduce((s, w, k) => s + w[i] * y[k], 0);
      cs[ch] = c;
    }
    if (done) return { doc: d, converged: true };
    d = withChannels(d1, cs);
  }
  return { doc: d, converged: chs.every((ch) => resid(ch, headOf(d).channels[ch]).every((x) => Math.abs(x) <= TURN_TOL)) };
}
/** Extend with the corner lists laid, or refuse by name: a corner after the first shorter than cornerMinM, the first shorter than the head can make it. */
function extendList(doc, opts, rest, lists, aims) {
  const changes = { ...(rest.changes || {}) };
  for (const [, k] of CORNER_FIELDS) delete changes[k];
  const o = { ...rest }; if (Object.keys(changes).length) o.changes = changes; else delete o.changes;
  for (const ch of Object.keys(lists)) {
    const { marks, angles, k, code, word } = lists[ch];
    marks.forEach((F, j) => {
      const end = j + 1 < marks.length ? marks[j + 1] : o.length, min = cornerChangeMinM(doc, o, (angles[j + 1] * 180) / Math.PI);
      if (end - F < min - 1e-9) throw Object.assign(new D.CoreError(code, `the ${word} change ${j + 1} (a corner of ${DEGS(angles[j + 1])}) needs at least ${min.toFixed(1)} m before ${j + 1 < marks.length ? `change ${j + 2}'s mark` : "the piece's end"} (shorter, the road turns faster than it can be ridden smoothly): from at most ${(end - min).toFixed(1)}, got ${F}`), { needM: min });
    });
    const { changes: _c, ...bare } = o, need = shortestTurnBy(doc, { ...bare, length: 1 }, { [ch]: angles[0] });   // the head alone decides the first corner
    if (need === null || marks[0] < need - 1e-9) throw Object.assign(new D.CoreError(code, `the ${word} change 0 (the first corner, ${DEGS(angles[0])}) needs at least ${need} m before change 1's mark, got ${marks[0]}`), { needM: need });
  }
  const r = solveList(doc, o, lists, aims);
  if (r.converged) return r.doc;
  const first = lists.kh || lists.kv;
  throw new D.CoreError(first.code, `a ${o.length} m piece cannot lay the ${Object.values(lists).map((x) => x.word).join(' and ')} corners asked for, each exact and ending straight`);
}

function cornerOf(doc, opts) {
  const lists = cornerLists(opts);   // L139: checked first, so a corner list with no first corner is refused by name
  if (!('turnDeg' in opts) && !('climbDeg' in opts)) return extend(doc, opts);
  const { turnDeg, climbDeg, ...rest } = opts, aims = {};
  for (const [ch, k, v] of [['kh', 'turnDeg', turnDeg], ['kv', 'climbDeg', climbDeg]]) {
    if (!(k in opts)) continue;
    if (!Number.isFinite(v)) throw new D.CoreError('BAD_TARGET', `a corner needs a finite number of degrees, got ${k} ${v}`);
    aims[ch] = (v * Math.PI) / 180;
  }
  if (lists) return extendList(doc, opts, rest, lists, aims);   // L139: corners after the first, in one piece
  if (rest.changes && typeof rest.changes === 'object' && !Array.isArray(rest.changes) && CORNER_FIELDS.some(([, k]) => k in rest.changes)) {   // empty corner lists: the corner as before
    const changes = { ...rest.changes }; for (const [, k] of CORNER_FIELDS) delete changes[k];
    if (Object.keys(changes).length) rest.changes = changes; else delete rest.changes;
  }
  return extendBy(doc, rest, aims);
}

module.exports = { extendTurnBy, extendClimbBy, extendCorner, shortestTurnBy, turnWeights, cornerMinM, cornerChangeMinM };
