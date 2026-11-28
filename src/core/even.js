// even.js: EVEN, Sculpt's level of a run's WIDTH to one value (D678). The plan and its calls: lighthouse
// exo_memory/loop/plan_t180_sculpt_even_2026-11-27.md, sections 3, 4 and 6, and the build packets of 2026-11-27.
//
//   even(doc, { from, to, value, hold, ramp, margin }) -> { doc, changed, window, value, hold }
//
// The road pieces `from`..`to` (a run, or one piece) are brought to one width, `value`, even from the run's first metre to its last:
//   - THE WINDOW: the run [lo, hi], then a MARGIN at the value beyond each end (20 m, one knot span), then a RAMP back to the road as it was (30 m, the
//     brush's smootherstep). The margin is there because settle (sculpt.js) carries a joint's slope into the next piece (value, then slope): without it the
//     run's first span would still be ramping. THE WINDOW'S ENDS (D678, the packet's "Amended 17:4x" item 1): first the knots over the window's two reaches
//     (the margin and the ramp, 50 m beyond each end of the run) are cut to spans of at most 3.75 m (refineEnds, document.js refineKnots, rounded once), so no
//     control point the margin or the ramp needs has a support reaching past the window and is left as it was; the window is then taken again on the cut track.
//     Outside the window the road is the same to within one stored step of each channel (a tenth of a millimetre in width, offset and height), not bit for bit:
//     the cut spans' new control points are stored at the channel's step. Where the window reaches a piece the reaches did not cover (the carry side: the
//     piece before has knots coarser than the cut, evenWindow), it reaches back to that piece's last knot span's control points, as before. At an open
//     track's ends the window stops, and a run that ends at the head gives the head the value. On a closed lap a window over the start line is refused: every
//     brush holds the lap's first two control points, so a level across it would leave a step.
//   - ONE EDGE KEPT (hold 'left' or 'right'; a drag on one rim's handle keeps the other): B (D678, the packet's "Amended 17:4x" item 3), the kept edge stays
//     WHERE IT IS on the track Even is given, grabs and all: no reading of the road before them. The sideways offset l is fitted by least squares (fitChannel)
//     to the place that keeps that edge, read on the cross-section the builder makes at the new width (rimReader, profile.js readAt; on a cupped road the rim is
//     not at l ± w/2), and the other edge moves. Where the kept edge is itself uneven, it stays uneven and the other edge follows it at the new width: keep the
//     edge you did not move, or the middle. 'centre' keeps the middle: only the width changes, l and h as they were, and both edges move.
//   - THE CENTRE'S HEIGHT (h) moves in the plane of the road AS BUILT (adapter.js bankPlan's roll, not the bank channel: the plan re-rounds the bank's corners),
//     so on a banked road a sideways move rises or falls with the bank; otherwise the height is as it was, so a hill made before stays (and so does the drop a
//     grab gives the middle). h is fitted by least squares at every quarter metre, because
//     its target is a product (the sideways move times the bank's tangent) that no control point value carries.
//   - THE BANK is not levelled (the call: kept as found), nor any other channel: where the window's reaches are cut, their new control points carry the bank
//     as it was, within one stored step.
// Pure: a document in, a new document out. Refusals are CoreErrors by name, and nothing changes.
'use strict';
const D = require('./document.js');
const SC = require('./sculpt.js');
const { toSegments, bankPlan } = require('./adapter.js');
const PR = require('../geom/profile.js');

const EVEN_RAMP_M = 30, EVEN_MARGIN_M = 20, EVEN_SNAP_M = 0.5, EVEN_MIN_M = 0.5, EVEN_MAX_M = 400;
// THE WINDOW'S ENDS (D678, the packet's "Amended 17:4x" item 1): before it levels, Even cuts the knots over the window's two reaches to spans of at most this
// (refineEnds), so no control point the margin, the ramp or the height's fit needs is left as it was because its support reached past the window. 3.75 m is the
// ruling's: measured as a prototype, it brought the flat turn's exit margin from 13.28 m to within 0.0083 m of a value of 16, and the centre's height after a grab
// near the window's end from 0.05 m off its target to 0.0006 m (lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, section 4.4).
const EVEN_END_SPAN_M = 3.75;
const HOLDS = Object.freeze(['left', 'right', 'centre']);
const FIT_STEP_M = 0.25;   // the least-squares fit's sample step (each knot span gets at least 4)

const refuse = (code, words) => { throw new D.CoreError(code, `Even: ${words}. Nothing changed.`); };
// every document Even makes is frozen ALL THE WAY DOWN, as sculpt.js freezes its own (D678, the 23:26Z order's item 2; the hand-back's 5.4): the segment caches
// (sculpt.js pieceOffsets, rimReader below) are used only when every piece is frozen, and with the changed pieces left unfrozen every offset read converted the
// whole lap again (an Even drag step 5.2 s on a 27.6 km lap)
const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
/** 1 on [lo, hi], a smootherstep to 0 over `ramp` metres beyond each end. */
const weight = (s, lo, hi, ramp) => (s >= lo && s <= hi ? 1 : ((d) => (d >= ramp ? 0 : 1 - SC.smootherstep(d / ramp)))(s < lo ? lo - s : s - hi));

/** The first road piece holding lap distance s: { p, sl }, or null. */
function pieceAt(doc, off, s) {
  for (let p = 0; p < doc.pieces.length; p++) { const P = doc.pieces[p]; if (P.type === 'road' && s >= off[p] - 1e-9 && s <= off[p] + P.length + 1e-9) return { p, sl: Math.min(P.length, Math.max(0, s - off[p])) }; }
  return null;
}
const valueAt = (doc, off, ch, s) => { const a = pieceAt(doc, off, s); if (!a) throw new Error(`even: no road at ${s}`); return D.channelAt(doc.pieces[a.p], ch, a.sl).v; };

/** The built bank of piece p at its own distance sl (bankPlan's roll where it re-laid it, the channel elsewhere). */
const builtPhi = (doc, plan, p, sl) => (plan[p].fn ? plan[p].fn(sl) : D.channelAt(doc.pieces[p], 'phi', sl).v);

/**
 * A reader of the held rim's place across: (s) -> the rim's horizontal distance from the centre along the road's level left (the axis of l), on `doc` as the
 * builder makes it: the cross-section of the segment holding s (profile.js readAt, as app/core/zonegrab.js frameAt reads it), its rim on the held side, turned
 * by the built bank. side: +1 the left rim, -1 the right.
 */
// the adapter's per-piece segment cache (toSegments `cache`, exact: test/core_segcache.test.js), under src/core/sculpt.js SEG_CACHE's rule: only a document frozen
// all the way down. A drag reruns Even on the SAME base at every step, and the rim reader converted the whole lap three times a step (D678: 1.6 s of an 8.2 s
// step on a 27.6 km lap; lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, 5.2b); with it, a piece converted before is not converted again.
const SEG_CACHE = new WeakMap();
function rimReader(doc, side) {
  const segs = toSegments(doc, doc.pieces.every(Object.isFrozen) ? { cache: SEG_CACHE } : {}), plan = bankPlan(doc), off = SC.pieceOffsets(doc), byId = new Map();
  for (const g of segs) { let a = byId.get(g.id); if (!a) byId.set(g.id, (a = { list: [], acc: 0 })); a.list.push({ g, s0: a.acc }); a.acc += g.length; }
  return (s) => {
    const at = pieceAt(doc, off, s); if (!at) throw new Error(`even: no road at ${s}`);
    const P = doc.pieces[at.p], parts = byId.get(P.id).list;
    let k = 0; while (k + 1 < parts.length && parts[k + 1].s0 <= at.sl) k++;
    const { g, s0 } = parts[k];
    if (!g.profile) throw new Error(`even: piece ${P.id} has no cross-section at ${s}`);
    const X = PR.sealed(PR.readAt(g, Math.min(g.length, Math.max(0, at.sl - s0)))), E = [X.u[0], X.u[X.u.length - 1]];
    const o = PR.offsetAt(X, side > 0 ? E[1] : E[0]), phi = builtPhi(doc, plan, at.p, at.sl);
    return o[0] * Math.cos(phi) - o[1] * Math.sin(phi);
  };
}

/** Each channel in `targets` ((s) -> value, or a number) brought there with weight g at every control point whose support lies inside [w0, w1]; the joints settled. */
function levelTo(doc, targets, win) {
  let cur = doc;
  for (const [ch, fn] of Object.entries(targets)) {
    const off = SC.pieceOffsets(cur);
    const res = cur.pieces.map((P, p) => {
      if (P.type !== 'road' || off[p] + P.length < win.w0 || off[p] > win.w1) return null;
      const t = D.knotVector(P), c = P.channels[ch], ctrl = c.slice(), changed = [];
      for (let i = 0; i < c.length; i++) {
        if (off[p] + t[i] < win.w0 - 1e-9 || off[p] + t[i + 4] > win.w1 + 1e-9) continue;
        const sI = off[p] + SC.knotAverage(t, i), g = weight(sI, win.lo, win.hi, win.ramp), v = typeof fn === 'function' ? fn(sI) : fn;
        ctrl[i] = c[i] + g * (v - c[i]); changed.push(i);
      }
      return { ctrl, changed };
    });
    cur = freeze(D.checkDoc({ ...cur, pieces: SC.settle(cur, ch, res).pieces }));
  }
  return cur;
}

/** Solve M x = r (M square, dense) by Gauss-Jordan with partial pivoting; throws on a singular M (a fit with no samples under a control point). */
function solve(M, r) {
  const m = r.length, A = M.map((row, k) => [...row, r[k]]);
  for (let k = 0; k < m; k++) {
    let pv = k; for (let q = k + 1; q < m; q++) if (Math.abs(A[q][k]) > Math.abs(A[pv][k])) pv = q;
    [A[k], A[pv]] = [A[pv], A[k]];
    if (!(Math.abs(A[k][k]) > 1e-14)) throw new Error('even: the fit is singular');
    for (let q = 0; q < m; q++) if (q !== k) { const f = A[q][k] / A[k][k]; if (f !== 0) for (let c = k; c <= m; c++) A[q][c] -= f * A[k][c]; }
  }
  return A.map((row, k) => row[m] / row[k]);
}

/**
 * The window's control points of channel `ch` fitted by least squares to `target` (lap distance -> value), the joints as settle (sculpt.js) will build them: a linked
 * joint whose four points all change takes the piece's first two from the piece before (value, then slope); a joint the window covers only in part keeps all four
 * as they were. The whole window is ONE fit: the first two points after a joint are written as the piece before's last two, so a joint's slope is fitted to the
 * samples on both sides of it (fitted piece by piece, each piece's end slope was set by its own samples alone, and the kept edge missed by up to 0.054 m one metre
 * past a joint after eight grabs). Each point is stored at the channel's step. Returns settle's input: per piece { ctrl, changed } or null.
 * B fits the sideways offset l with it (the kept edge) and then the height h (the plane of the road as built).
 */
function fitChannel(doc, ch, target, win) {
  const off = SC.pieceOffsets(doc), res = doc.pieces.map(() => null), q = (x) => { const v = Number(x.toFixed(D.DEC[ch])); return Object.is(v, -0) ? 0 : v; };
  // the control points the window reaches, per road piece (the rule levelTo uses)
  const reach = doc.pieces.map((P, p) => {
    if (P.type !== 'road' || off[p] + P.length < win.w0 || off[p] > win.w1) return [];
    const t = D.knotVector(P), out = [];
    for (let i = 0; i < P.channels[ch].length; i++) if (!(off[p] + t[i] < win.w0 - 1e-9 || off[p] + t[i + 4] > win.w1 + 1e-9)) out.push(i);
    return out;
  });
  const roads = doc.pieces.map((P, p) => p).filter((p) => doc.pieces[p].type === 'road');
  // joint k between roads[k-1] and roads[k]: 'all' (value, then slope), 'part' (all four kept), or null (not linked: the piece after is free, as settle leaves it)
  const joint = (a, b) => { if (!SC.isLinked(doc, a, b, ch)) return null; const na = doc.pieces[a].channels[ch].length; return reach[a].includes(na - 1) && reach[a].includes(na - 2) && reach[b].includes(0) && reach[b].includes(1) ? 'all' : 'part'; };
  // every control point the window reaches as a linear form { c, t: [[column, coefficient]] } in the free points (the columns); a point held is a constant
  const form = doc.pieces.map(() => null), cols = [], plan = [];
  const lin = (x, kx, y, ky) => { const t = new Map(); for (const [F, k] of [[x, kx], [y, ky]]) for (const [j, v] of F.t) t.set(j, (t.get(j) || 0) + k * v); return { c: kx * x.c + ky * y.c, t: [...t] }; };
  for (let k = 0; k < roads.length; k++) {
    const p = roads[k], P = doc.pieces[p], changed = reach[p].slice(); if (!changed.length) continue;
    const n = P.channels[ch].length, E = P.channels[ch].map((v) => ({ c: v, t: [] })), set = new Set();
    const before = k > 0 ? joint(roads[k - 1], p) : null, after = k + 1 < roads.length ? joint(p, roads[k + 1]) : null;
    let ratio = null;
    if (before === 'all') {
      const a = roads[k - 1], Pa = doc.pieces[a], na = Pa.channels[ch].length, Ea = form[a];
      const hh = Pa.length - (Pa.knots.length ? Pa.knots[Pa.knots.length - 1] : 0), hb = P.knots.length ? P.knots[0] : P.length;
      ratio = hb / hh; E[0] = Ea[na - 1]; E[1] = lin(Ea[na - 1], 1 + ratio, Ea[na - 2], -ratio); set.add(0); set.add(1);
    } else if (before === 'part') { set.add(0); set.add(1); }
    if (after === 'part') { set.add(n - 1); set.add(n - 2); }
    const own = [];
    for (const i of changed) if (!set.has(i)) { E[i] = { c: 0, t: [[cols.length, 1]] }; own.push([i, cols.length]); cols.push([p, i]); }
    form[p] = E; plan.push({ p, changed, before, ratio, k, own });
  }
  if (!plan.length) return res;
  const m = cols.length, A = Array.from({ length: m }, () => new Array(m).fill(0)), rhs = new Array(m).fill(0);
  for (const { p } of plan) {
    const P = doc.pieces[p], t = D.knotVector(P), n = P.channels[ch].length, E = form[p];
    const unit = Array.from({ length: n }, (_, i) => { const e = new Array(n).fill(0); e[i] = 1; return { ...P, channels: { ...P.channels, [ch]: e } }; });
    const lo = Math.max(0, win.w0 - off[p]), hi = Math.min(P.length, win.w1 - off[p]), spans = [...new Set([lo, ...t.filter((x) => x > lo && x < hi), hi])].sort((a, b) => a - b);
    for (let sp = 0; sp + 1 < spans.length; sp++) {
      const a = spans[sp], b = spans[sp + 1], N = Math.max(4, Math.ceil((b - a) / FIT_STEP_M));
      for (let j = sp === 0 ? 0 : 1; j <= N; j++) {
        const sl = a + ((b - a) * j) / N, row = new Map();
        let r = target(off[p] + sl);
        for (let i = 0; i < n; i++) {
          if (sl < t[i] - 1e-9 || sl > t[i + 4] + 1e-9) continue;
          const v = D.channelAt(unit[i], ch, sl).v; if (v === 0) continue;
          r -= E[i].c * v; for (const [c, k] of E[i].t) row.set(c, (row.get(c) || 0) + k * v);
        }
        const B = [...row];
        for (const [a2, va] of B) { rhs[a2] += va * r; for (const [b2, vb] of B) A[a2][b2] += va * vb; }
      }
    }
  }
  const x = m ? solve(A, rhs) : [];
  // stored at the channel's step, in order, the points after a joint taken from the stored points before it (as settle builds them)
  for (const { p, changed, before, ratio, k, own } of plan) {
    const ctrl = doc.pieces[p].channels[ch].slice();
    for (const [i, c] of own) ctrl[i] = q(x[c]);
    if (before === 'all') { const pr = res[roads[k - 1]], na = pr.ctrl.length, v = q(pr.ctrl[na - 1]); ctrl[0] = v; ctrl[1] = v + (v - q(pr.ctrl[na - 2])) * ratio; }
    res[p] = { ctrl, changed };
  }
  return res;
}

/**
 * EVEN: the run from..to brought to width `value`. `hold`: 'left' | 'right' | 'centre' (default). `ramp` and `margin` in metres (defaults 30 and 20).
 * Returns { doc, changed (piece indices), window { lo, hi, w0, w1 } (lap distance), value, hold, shiftAt (s -> the centre's move across the road, in its built plane, m) }.
 */
function even(doc, { from, to, value, hold = 'centre', ramp = EVEN_RAMP_M, margin = EVEN_MARGIN_M } = {}) {
  const W0 = evenWindow(doc, { from, to, ramp, margin }), { off, L, lo, hi } = W0;   // the refusals, read on the track as given (as the shell reads them when a drag opens)
  if (!isNum(value)) refuse('EVEN_VALUE', `the width must be a number of metres, got ${value}`);
  if (value < EVEN_MIN_M || value > EVEN_MAX_M) refuse('EVEN_VALUE', `the width must be between ${EVEN_MIN_M} and ${EVEN_MAX_M} m, got ${value}`);
  if (!HOLDS.includes(hold)) refuse('EVEN_HOLD', `hold is one of ${HOLDS.join(', ')}, got ${hold}`);
  // the knots over the window's reaches cut first, then the window taken again on the cut track: with the piece before the run cut, its last span no longer
  // carries a slope into the run, so the carry side (evenWindow) has nothing to reach back for and the window is the 20 m margin and the 30 m ramp
  const cut = refineEnds(doc, off, L, lo, hi, margin + ramp);
  const W = cut === doc ? W0 : evenWindow(cut, { from, to, ramp, margin });
  return evenIn(cut, { off: W.off, L: W.L, lo: W.lo, hi: W.hi, win: W.win, w0: W.win.w0, w1: W.win.w1, value, hold, given: doc });
}

/**
 * The window's two reaches, [lo − reach, lo] and [hi, hi + reach] clipped to the road, with every road piece's knots there cut to spans of at most EVEN_END_SPAN_M
 * (document.js refineKnots with roundOnce: exact insertion, the new control points rounded once to each channel's step at the end, so the road moves by at most
 * half a stored step; rounding after each knot carried the bank past one step on a banked turn). Returns `doc` itself when no span needed cutting.
 */
function refineEnds(doc, off, L, lo, hi, reach) {
  let out = doc;
  for (const [a, b] of [[Math.max(0, lo - reach), lo], [hi, Math.min(L, hi + reach)]]) {
    doc.pieces.forEach((P, p) => {
      if (P.type !== 'road') return;
      const x = Math.max(0, a - off[p]), y = Math.min(P.length, b - off[p]);
      if (y > x + 1e-6) out = D.refineKnots(out, P.id, x, y, EVEN_END_SPAN_M, { roundOnce: true }).doc;
    });
  }
  return out;
}

/**
 * The run's window, or a refusal by name (CoreError, nothing changes): a run that is not road pieces of this track, a closed lap's start line within reach, a jump,
 * a tube or a split width in the window. Returns { off (piece offsets), L (the road's length), lo, hi (the run), win { lo, hi, ramp, w0, w1 } }. The shell asks it
 * when a drag opens, so a refused run is said before the drag rather than at its first step.
 */
function evenWindow(doc, { from, to, ramp = EVEN_RAMP_M, margin = EVEN_MARGIN_M } = {}) {
  if (!doc || !Array.isArray(doc.pieces)) throw new D.CoreError('BAD_DOC', 'Even needs a track document');
  const n = doc.pieces.length;
  // a closed lap's run across its start line (the shell's short-way selection: from > to)
  if (doc.closed && Number.isInteger(from) && Number.isInteger(to) && from > to && from < n && to >= 0) refuse('EVEN_START_LINE', `this run crosses the start line of a closed lap, where Even would leave a step; pick a run that stays at least ${margin + ramp} m from the line`);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to >= n || from > to) refuse('EVEN_RUN', `pieces ${from} to ${to} are not a run of this track`);
  if (doc.pieces[from].type !== 'road' || doc.pieces[to].type !== 'road') refuse('EVEN_RUN', 'a run starts and ends on road; select the road pieces either side of the jump');
  if (!isNum(ramp) || !(ramp > 0)) refuse('EVEN_RAMP', `the ramp must be more than 0 m, got ${ramp}`);
  if (!isNum(margin) || margin < 0) refuse('EVEN_RAMP', `the margin must be 0 m or more, got ${margin}`);
  D.checkDoc(doc);
  const off = SC.pieceOffsets(doc);
  let L = 0; for (let p = 0; p < n; p++) if (doc.pieces[p].type === 'road') L = Math.max(L, off[p] + doc.pieces[p].length);
  const lo = off[from], hi = off[to] + doc.pieces[to].length;
  let vlo = lo - margin, w0 = lo - margin - ramp, w1 = hi + margin + ramp;
  // THE CARRY SIDE. settle carries the joint at the run's start from the piece before it (value, then slope), so the four control points of that piece's
  // last knot span must lie inside the window at the value, or the run's first span inherits their slope (with 20 m spans, a bump of 0.8 m in the held rim for a
  // 31 m road brought to 9.25). Where that piece's knots are coarser than the margin and ramp allow for, the value starts at the first of the four and the
  // window at its support. The far side needs none: there the run carries outward
  const pv = from - 1, PV = pv >= 0 ? doc.pieces[pv] : null;
  if (PV && PV.type === 'road' && SC.isLinked(doc, pv, from, 'w')) {
    const t = D.knotVector(PV), i = PV.channels.w.length - 4;
    vlo = Math.min(vlo, off[pv] + SC.knotAverage(t, i)); w0 = Math.min(vlo - ramp, off[pv] + t[i]);
  }
  if (doc.closed && (w0 < 0 || w1 > L)) refuse('EVEN_START_LINE', `this lap is closed and the run, with its ramps (${+(lo - w0).toFixed(1)} m before it and ${margin + ramp} m after), reaches its start line, where it would leave a step; pick a run farther from the start line`);
  w0 = Math.max(0, w0); w1 = Math.min(L, w1);
  const win = { lo: vlo, hi: hi + margin, ramp, w0, w1 };
  const ends = (p) => (p + 1 < n ? off[p + 1] : off[p] + (doc.pieces[p].type === 'road' ? doc.pieces[p].length : 0));
  for (let p = 0; p < n; p++) {
    const P = doc.pieces[p]; if (!(ends(p) > w0 + 1e-9 && off[p] < w1 - 1e-9) && !(p >= from && p <= to)) continue;
    if (P.type === 'flight') refuse('EVEN_JUMP', `a jump lies within the level's reach (${+(lo - w0).toFixed(1)} m before the run, ${+(w1 - hi).toFixed(1)} m after it; piece ${P.id}); Even does not level across a jump`);
    if (D.kindOf(P) === 'tube') refuse('EVEN_TUBE', `piece ${P.id} is a tube; Even levels open road only`);
    if (D.isWidthSplit(P)) refuse('EVEN_SPLIT', `piece ${P.id} has its own width on the right side; Even does not level a split width yet`);
  }
  return { off, L, lo, hi, win };
}

/** The level itself, on a window evenWindow gave. `given`: the track Even was handed, when `doc` is it with its window's reaches cut (refineEnds); `changed` is counted against it. */
function evenIn(doc, { off, L, lo, hi, win, w0, w1, value, hold, given = doc }) {
  const d1 = levelTo(doc, { w: value }, win);   // the width at the value, l and h as they were
  const side = hold === 'left' ? 1 : hold === 'right' ? -1 : 0;
  const plan = bankPlan(doc);
  let out = d1;   // 'centre': the middle kept where it is, only the width changes
  if (side) {
    // l: fitted so the kept edge stays where the track as given has it, read on the cross-section at the new width (rim1) against the one it has now (rim0)
    const rim0 = rimReader(doc, side), rim1 = rimReader(d1, side);
    const keep = (s) => { const x = Math.min(L, Math.max(0, s)); return valueAt(doc, off, 'l', x) + rim0(x) - rim1(x); };
    const c1 = freeze(D.checkDoc({ ...d1, pieces: SC.settle(d1, 'l', fitChannel(d1, 'l', keep, win)).pieces }));
    // h: in the plane of the road as built, fitted (Alt F): the height as it is plus the bank's tangent times the sideways move, so a hill made before stays
    const offC = SC.pieceOffsets(c1);
    const phiAt = (s) => { const a = pieceAt(doc, off, s); return builtPhi(doc, plan, a.p, a.sl); };
    const target = (s) => {
      const l = valueAt(c1, offC, 'l', s), hs = valueAt(doc, off, 'h', s), ls = valueAt(doc, off, 'l', s);
      return hs + Math.tan(phiAt(s)) * (l - ls);
    };
    out = freeze(D.checkDoc({ ...c1, pieces: SC.settle(c1, 'h', fitChannel(c1, 'h', target, win)).pieces }));
  }
  const changed = []; out.pieces.forEach((P, p) => { if (P !== given.pieces[p]) changed.push(p); });
  return { doc: out, changed, window: Object.freeze({ lo, hi, w0, w1 }), value, hold, shiftAt: shiftOf(doc, out, plan) };
}

/**
 * The centre's move across the road from `before` to `after`, in the plane of the road as built on `before` (its bankPlan roll): (s) -> m, at lap distance s.
 * Even's result carries it as shiftAt; the sentence's job (app/core/evenwords.js evenCheck) has only the two documents, so it is a function of them.
 */
function shiftOf(before, after, plan = bankPlan(before)) {
  const off = SC.pieceOffsets(before), offA = SC.pieceOffsets(after);
  return (s) => { const a = pieceAt(before, off, s); if (!a) throw new Error(`even: no road at ${s}`); return (valueAt(after, offA, 'l', s) - valueAt(before, off, 'l', s)) / Math.cos(builtPhi(before, plan, a.p, a.sl)); };
}

module.exports = { even, evenWindow, shiftOf, HOLDS, EVEN_RAMP_M, EVEN_MARGIN_M, EVEN_SNAP_M, EVEN_MIN_M, EVEN_MAX_M, EVEN_END_SPAN_M, _internal: { weight, rimReader, levelTo, fitChannel, fitHeight: (doc, target, win) => fitChannel(doc, 'h', target, win), builtPhi, refineEnds } };
