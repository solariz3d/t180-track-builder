// level.js: LEVEL and TO FLOOR (the user, 2026-10-08: "there needs to be a way to snap the track to the floor to be true flat … i wanted the
// downhill to straighten out but its hard to calculate by hand"). The climb channel kv is a RATE (rad per metre of road), so "climb 0" keeps whatever
// slope the road already has: on the user's track the last piece eases its climb to 0 and ends straight, but tilted +3.2° and 187 m below the start.
//
//   extendLevel(doc, opts)     Extend (opts as extend's: length, turn, width…) with a piece that ENDS STRAIGHT AND LEVEL: climb rate 0 and pitch 0.
//   extendToFloor(doc, opts)   …that ends straight, level AND on the floor: pitch 0 and the road centre at height 0 (the start's ground, the grid the view
//                              draws). Refused by name (FLOOR_TOO_SHORT) when the piece is too short to do it without the car leaving the road on the crest
//                              at the open track's speed; the refusal carries `needM`, the shortest length that does it.
//   shortestToFloor(doc, opts) that length (m, whole metres), or null when none up to MAX_SEARCH_M does.
//
// HOW. The piece is Extend's own piece with climb 0 (its easing, ending straight), and then ONLY its climb control points are corrected, by the least-norm
// step close.js takes (ref 04 §3: δ = Jᵀ(JJᵀ)⁻¹(−r)): the joint's first two stay (the piece continues C1 from the head, src/core/README.md) and the last
// two stay 0 (it ends straight: rate 0 and slope 0). For Level the end pitch is LINEAR in them (the adapter's rule: pitch += the trapezoid of kv over
// each 2 m segment, src/core/adapter.js toSegments), so one step is exact. To floor adds the end height, which is not linear (∫ sin p ds), so the
// step is iterated (Gauss–Newton) with the residual read on the adapter's own path (toPath: what the app draws and exports, offsets included).
// THE LIMIT (To floor's refusal, and nothing else): the road's centre must keep the car on it at the open track's speed, the validator's own
// check (src/validate/index.js 'leaves-surface' on the centreline: g·cos p + v²·κ_climb + the downforce ≥ 0 at vmax 970 km/h, src/validate/limits.js). A
// shape that would lift the car off is never placed, and never clamped: the user is told the length that does it.
// A TURN READ AS A CORNER (the user, 2026-10-28, on CRAZY TEST's end: "currently it does nothing if there is a turn value added"): with opts.turnDeg the
// piece is Turn by's (src/core/turnby.js extendCorner: its symmetric ease, the exact heading change, ending straight) instead of Extend's, and then its climb
// is corrected as above. The two are independent: the heading is ∫kh and the pitch ∫kv on the same 2 m segments (adapter.js toSegments), the correction
// changes only kv, so the piece turns exactly turnDeg AND ends level (and, for To floor, at height 0). A climb read as a corner (climbDeg) is DROPPED (the user,
// 2026-11-09: "when you press level with turns added it breaks"): the fields carry the last piece's climb on, so refusing it made Level fail on any track that had
// climbed, and the climb is what is solved here, so nothing typed is lost.
//   levelEnd(doc, i)           LEVEL THE END of piece i, already placed (the user, 2026-11-09: "the level feature should work at the end of any piece to flatten it
//                              to level"): only its climb is re-solved, the rest of it kept exactly, and the pieces after it follow (see the function).
'use strict';
const D = require('./document.js');
const { extend } = require('./extend.js');
const { extendCorner } = require('./turnby.js');
const { toPath } = require('./adapter.js');
const { basis, denseSolve } = require('../../tools/piecewise.cjs');
const { MACH6, G } = require('../validate/limits.js');
const { netRows } = require('./close.js');

const SEG_M = 2;               // the adapter's segment (toSegments segM): the pitch is integrated on its ends
const PITCH_TOL = 1e-6;        // rad (0.00006°): the bar is 0.01°
const Y_TOL = 5e-3;            // m: the bar is 1 cm. Not tighter: the climb is STORED to 1e-9 rad/m (document.js DEC.kv), and over a piece of several km that rounding alone moves the end height by millimetres
const MAX_ITER = 12;
const MAX_SEARCH_M = 50000;
const V_OPEN = MACH6.vmaxKmh / 3.6;   // the open track's speed (fullSpeed)
const q = (x, dec) => { const v = Number(x.toFixed(dec)); return Object.is(v, -0) ? 0 : v; };   // document.js's quantisation (what is stored is what is measured, as close.js)
const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };

/** The head's pose on the adapter's path (the end of the track as drawn): pitch (rad) and height (m). */
function headOf(doc) {
  if (!doc.pieces.length) return { p: doc.start.pitch, y: doc.start.pos[1] };
  const S = toPath(doc).path.samples, e = S[S.length - 1], T = e.T;
  return { p: Math.atan2(T[1], Math.hypot(T[0], T[2])), y: e.pos[1] };
}
/** The piece's stations (the adapter's segment ends) and, at each, the climb basis: kv(s_j) = Σ_a N[a]·c[first + a]. */
function stationsOf(P) {
  const n = Math.max(1, Math.ceil(P.length / SEG_M - 1e-9)), kv = [0, 0, 0, 0, ...P.knots, P.length, P.length, P.length, P.length];
  return Array.from({ length: n + 1 }, (_, j) => { const s = (P.length * j) / n, b = basis(kv, Math.min(Math.max(s, 0), P.length)); return { s, first: b.first, N: Array.from(b.N) }; });
}
// THE FLIPPED FRAME (2026-10-15, reported on ELYSIUM: Level curved the road DOWN). Past the top of a loop the frame is carried as (heading + π, π − pitch,
// bank + π) (src/core/close.js residual): there more climb rate pitches the road physically DOWN. The pitch here is the PHYSICAL pitch (headOf), so its
// response to the climb channel carries `sgn`: +1 upright, −1 flipped. Without it every correction went the wrong way (ELYSIUM: −0.50° became −1.01°).
function flipOf(doc) {
  if (!doc.pieces.some((P) => P.type === 'road')) return false;
  const rows = netRows(doc); let kv = rows.kvBase; for (const [key, w] of rows.kv) { const [pi, i] = key.split(':').map(Number); kv += w * doc.pieces[pi].channels.kv[i]; }
  return Math.cos(kv) < 0;
}
/** The end pitch's change over the piece as weights on the control points (the adapter's trapezoid), and the pitch at each station. */
function pitchRows(P, st, c, p0, sgn = 1) {
  const m = c.length, w = new Float64Array(m), cum = new Float64Array(m), p = [p0], dpdc = [new Float64Array(m)];
  const kvAt = (x) => x.N.reduce((a, N, k) => a + N * c[x.first + k], 0);
  for (let j = 1; j < st.length; j++) {
    const a = st[j - 1], b = st[j], h = b.s - a.s;
    for (let k = 0; k < 4; k++) { cum[a.first + k] += sgn * (h / 2) * a.N[k]; cum[b.first + k] += sgn * (h / 2) * b.N[k]; }
    p.push(p[j - 1] + sgn * ((kvAt(a) + kvAt(b)) / 2) * h); dpdc.push(Float64Array.from(cum));
  }
  w.set(cum);
  return { w, p, dpdc, kv: st.map((x) => sgn * kvAt(x)) };   // kv here: the PHYSICAL climb curvature (the crest check reads it)
}
/** The piece with its climb control points replaced (quantised as stored), and the document with it as the head. */
function withClimb(doc, c) {
  const pieces = doc.pieces.slice(), P = pieces[pieces.length - 1];
  pieces[pieces.length - 1] = { ...P, channels: { ...P.channels, kv: Array.from(c, (x) => q(x, D.DEC.kv)) } };
  return freeze(D.checkDoc({ ...doc, pieces }));
}
/** The least-norm step on the free columns (2 … m − 3 unless given): δ = Jᵀ(JJᵀ)⁻¹(−r). */
function step(J, r, m, given = null) {
  const free = given ? given.slice() : []; if (!given) for (let i = 2; i <= m - 3; i++) free.push(i);
  if (!free.length) throw new D.CoreError('LEVEL_TOO_SHORT', 'this piece is too short to shape: it has no free climb control point (make it longer)');
  const A = J.map((row) => free.map((i) => row[i])), JJt = A.map((ra) => A.map((rb) => ra.reduce((s, x, k) => s + x * rb[k], 0)));
  const lam = denseSolve(JJt, r.map((x) => -x)), d = new Float64Array(m);
  free.forEach((i, k) => { d[i] = A.reduce((s, row, q) => s + row[k] * lam[q], 0); });
  return d;
}
/** The car stays on the road's centre over the piece at the open track's speed: g·cos p + v²·kv + the downforce ≥ 0 at every station (the validator's own
 *  leaves-surface check, which counts the car's downforce since 2026-10-15: limits.js MACH6.downforce). The worst margin (m/s²; < 0 lifts off). */
const DF = MACH6.downforce ? (MACH6.downforce.nPerMps / MACH6.downforce.massKg) * V_OPEN : 0;
const crestMargin = (rows) => Math.min(...rows.kv.map((k, j) => G * Math.cos(rows.p[j]) + V_OPEN * V_OPEN * k + DF));

/** The piece Extend would place with climb 0 (its easing: the rate to 0 over the whole piece), the climb's own at-start ramp dropped; with opts.turnDeg, the
 *  corner's piece (Turn by's ease, turning exactly turnDeg and ending straight). */
function basePiece(doc, opts) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to level');
  const { climbDeg, ...given } = opts;   // a climb read as a corner is dropped: the climb is what Level and To floor solve (the fields carry the last piece's climb on)
  const targets = { ...(given.targets || {}), kv: 0 }, o = { ...given, targets };
  if (o.transition && typeof o.transition === 'object') { const { kv, ...rest } = o.transition; o.transition = Object.keys(rest).length ? rest : undefined; if (o.transition === undefined) delete o.transition; }
  return 'turnDeg' in o ? extendCorner(doc, o) : extend(doc, o);
}

function solve(doc, opts, floor, { model = false, head: given = null, flip = null } = {}) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to level');
  const head = given || headOf(doc), d0 = basePiece(doc, opts), P0 = d0.pieces[d0.pieces.length - 1], st = stationsOf(P0), m = P0.channels.kv.length;
  const sgn = (flip === null ? flipOf(doc) : flip) ? -1 : 1;
  let c = Float64Array.from(P0.channels.kv); c[m - 1] = 0; c[m - 2] = 0;   // it ends straight: rate 0 and slope 0
  let d = withClimb(d0, c), rows = pitchRows(P0, st, c, head.p, sgn);
  for (let it = 0; it < MAX_ITER; it++) {
    const pEnd = rows.p[rows.p.length - 1];
    if (!floor) {
      if (Math.abs(pEnd) <= PITCH_TOL && it > 0) break;
      const dl = step([rows.w], [pEnd], m); c = c.map((x, i) => x + dl[i]);
    } else {
      const yEnd = model ? yModel(rows, st, head.y) : headOf(d).y;
      if (Math.abs(pEnd) <= PITCH_TOL && Math.abs(yEnd) <= Y_TOL) break;
      // ∂y_end/∂c = Σ_j cos p_j · ∂p_j/∂c · Δs (the height is ∫ sin p ds), on the same stations
      const wy = new Float64Array(m); for (let j = 1; j < st.length; j++) { const h = st[j].s - st[j - 1].s, ca = Math.cos(rows.p[j - 1]), cb = Math.cos(rows.p[j]); for (let i = 0; i < m; i++) wy[i] += (h / 2) * (ca * rows.dpdc[j - 1][i] + cb * rows.dpdc[j][i]); }
      const dl = step([rows.w, wy], [pEnd, yEnd], m); c = c.map((x, i) => x + dl[i]);
    }
    d = withClimb(d0, c); c = Float64Array.from(d.pieces[d.pieces.length - 1].channels.kv); rows = pitchRows(P0, st, c, head.p, sgn);
  }
  const yEnd = model ? yModel(rows, st, head.y) : headOf(d).y, pEnd = rows.p[rows.p.length - 1];
  return { doc: d, pEnd, yEnd, crest: crestMargin(rows), converged: Math.abs(pEnd) <= PITCH_TOL && (!floor || Math.abs(yEnd) <= Y_TOL) };
}

/** The end height on the model (the trapezoid of sin p on the stations): the search's only, so it does not rebuild the whole path at every try; the answer is then checked on the adapter's path. */
const yModel = (rows, st, y0) => { let y = y0; for (let j = 1; j < st.length; j++) y += ((Math.sin(rows.p[j - 1]) + Math.sin(rows.p[j])) / 2) * (st[j].s - st[j - 1].s); return y; };

/** Extend with a piece that ends straight and level (pitch 0). */
function extendLevel(doc, opts) { return solve(doc, opts, false).doc; }

const feasible = (doc, opts, L, how = {}) => { try { const r = solve(doc, { ...opts, length: L }, true, how); return r.converged && r.crest >= 0; } catch (e) { if (e && (e.code === 'LEVEL_TOO_SHORT' || e.code === 'TURN_TOO_SHORT')) return false; throw e; } };   // too short for the corner is too short
/** The shortest whole-metre length at which To floor works from this head (with these fields), or null when none up to MAX_SEARCH_M does. */
function shortestToFloor(doc, opts) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to level');
  const how = { model: true, head: headOf(doc), flip: flipOf(doc) };   // the search on the model, from the head (and its frame) read once
  let lo = 0, hi = Math.max(40, Number(opts.length) || 40);
  while (!feasible(doc, opts, hi, how)) { lo = hi; hi *= 1.5; if (hi > MAX_SEARCH_M) return null; }
  while (hi - lo > 1) { const mid = Math.round((lo + hi) / 2); if (feasible(doc, opts, mid, how)) hi = mid; else lo = mid; }
  let L = Math.ceil(hi);
  for (let k = 0; k < 20 && !feasible(doc, opts, L, { head: how.head, flip: how.flip }); k++) L++;   // the named length must WORK on the adapter's path: checked there, a metre at a time if the model was short
  return L;
}
/** Extend with a piece that ends straight, level and on the floor (height 0), or refuse by name with the shortest length that does it. */
function extendToFloor(doc, opts) {
  const r = solve(doc, opts, true);
  if (r.converged && r.crest >= 0) return r.doc;
  const need = shortestToFloor(doc, opts), why = !r.converged ? 'cannot reach the floor level in that length' : `would lift the car off its crest at ${MACH6.vmaxKmh} km/h`;
  throw Object.assign(new D.CoreError('FLOOR_TOO_SHORT', need === null ? `a ${opts.length} m piece ${why}, and no piece up to ${MAX_SEARCH_M} m reaches the floor from here` : `a ${opts.length} m piece ${why}: it needs at least ${need} m to reach the floor (height 0, level) from here`), { needM: need });
}

/**
 * LEVEL THE END of piece i, already placed, over a TAIL at its end (the user, 2026-11-09: "the level shouldnt level the whole turn, just the ending of the
 * piece, even if it has the turns like shown"). Only the climb control points whose support lies inside the tail are re-solved (the least-norm step above),
 * so the piece ends at pitch 0 with climb rate 0 and slope 0, and BEFORE the tail its climb is bit for bit what it was. Its turn, bank, width, cup, knots and
 * length are kept exactly; the joint's first two control points are never free (it still continues C1 from the piece before); the pitch is read from that
 * piece's end in its own frame (flipOf: past the top of a loop more climb pitches the road down). The pieces after it follow: when the next is road its
 * first two climb control points carry the new end on (value 0, slope 0, the way Extend makes a joint) and nothing else of it changes.
 * THE TAIL. A control point a moves the climb over [U[a], U[a+4]], so a tail that starts at s0 frees the points from the first a with U[a] ≥ s0 up to m − 3
 * (the last two are the end's). opts.tailM (m, from the end) is used as asked; left out, it is the SHORTEST tail that keeps the car on the road over it at
 * the open track's speed (the crest check To floor uses: g·cos p + v²·κ + the downforce ≥ 0) and off its chassis (that load ≤ 40 g, limits.js chassisG),
 * each or no worse than it was where the piece already failed it,
 * which levelEndTail reports for the panel to draw.
 * Refused by name: BAD_RANGE, LEVEL_NOT_ROAD, CLOSED, BAD_TAIL (not a positive number); LEVEL_TOO_SHORT (the piece has no free climb point at all);
 * LEVEL_TAIL_SHORT (the tail asked for holds no free point, or would lift the car off: `needM` is the shortest that works, or null); LEVEL_LIFTS_OFF (no
 * tail in this piece levels it without lifting the car off: make the piece longer). The document's own check has the last word.
 */
const knotsOf = (P) => [0, 0, 0, 0, ...P.knots, P.length, P.length, P.length, P.length];
function endFrame(doc, i) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: levelling a piece would open its seam');
  const n = doc.pieces.length;
  if (!Number.isInteger(i) || i < 0 || i >= n) throw new D.CoreError('BAD_RANGE', `piece ${i}: the track has pieces 0 to ${n - 1}`);
  const P = doc.pieces[i];
  if (P.type !== 'road') throw new D.CoreError('LEVEL_NOT_ROAD', `piece ${i + 1} is a flight: only a road piece has a climb to level`);
  const before = { ...doc, pieces: doc.pieces.slice(0, i) }, m = P.channels.kv.length;
  if (m - 3 < 2) throw new D.CoreError('LEVEL_TOO_SHORT', 'this piece is too short to shape: it has no free climb control point (make it longer)');
  const st = stationsOf(P), head = headOf(before), sgn = flipOf(before) ? -1 : 1, r0 = pitchRows(P, st, Float64Array.from(P.channels.kv), head.p, sgn);
  return { P, m, U: knotsOf(P), st, head, sgn, was: r0.kv.map((k, j) => G * Math.cos(r0.p[j]) + V_OPEN * V_OPEN * k + DF) };   // was: each station's margin as placed
}
/** The tail from control point a0 solved: its climb points, and whether it ends level with the car on the road over the tail. */
function tailSolve(F, a0) {
  const { P, m, U, st, head, sgn } = F, free = []; for (let a = a0; a <= m - 3; a++) free.push(a);
  let c = Float64Array.from(P.channels.kv); c[m - 1] = 0; c[m - 2] = 0;   // it ends straight: rate 0 and slope 0
  let rows = pitchRows(P, st, c, head.p, sgn);
  for (let it = 0; it < MAX_ITER; it++) {
    const pEnd = rows.p[rows.p.length - 1];
    if (Math.abs(pEnd) <= PITCH_TOL && it > 0) break;
    const dl = step([rows.w], [pEnd], m, free);
    c = Float64Array.from(c, (x, k) => q(x + dl[k], D.DEC.kv));   // quantised as stored: what is placed is what is measured
    rows = pitchRows(P, st, c, head.p, sgn);
  }
  // over the tail the car is never lifted off, nor pressed onto its chassis, where it was not already: each station's load into the road (m/s², at the
  // open track's speed) stays ≥ 0 and ≤ the chassis line (limits.js chassisG, 40 g: the validator's 'load-on-the-chassis'), or no worse than it was.
  // A short tail that pulled a nose-down end up at hundreds of g would be no level end at all; a piece that already lifts the car off on its own climb
  // is not made a reason to refuse levelling its end
  const s0 = U[a0], was = F.was, load = (j) => G * Math.cos(rows.p[j]) + V_OPEN * V_OPEN * rows.kv[j] + DF, CH = MACH6.chassisG * G;
  const lifts = st.some((x, j) => x.s >= s0 - 1e-9 && (load(j) < Math.min(0, was[j]) - 1e-9 || load(j) > Math.max(CH, was[j]) + 1e-9));
  return { c, tailM: P.length - s0, ok: Math.abs(rows.p[rows.p.length - 1]) <= PITCH_TOL && !lifts };
}
/** The shortest tail that works, from the last free point back to the first after the joint; null when none does. */
function shortestTail(F) { for (let a0 = F.m - 3; a0 >= 2; a0--) { const r = tailSolve(F, a0); if (r.ok) return r; } return null; }
/** The default tail of piece i (m, from its end), or null when no tail levels it without lifting the car off. */
function levelEndTail(doc, i) { const r = shortestTail(endFrame(doc, i)); return r ? r.tailM : null; }

function levelEnd(doc, i, opts = {}) {
  const F = endFrame(doc, i), { P, m, U } = F;
  let r;
  if (opts.tailM === undefined) {
    r = shortestTail(F);
    if (!r) throw new D.CoreError('LEVEL_LIFTS_OFF', `no tail of this ${P.length} m piece levels its end without lifting the car off at ${MACH6.vmaxKmh} km/h: make the piece longer`);
  } else {
    const T = opts.tailM;
    if (typeof T !== 'number' || !Number.isFinite(T) || T <= 0) throw new D.CoreError('BAD_TAIL', `the tail is a length in metres from the end of the piece, more than 0 (got ${T})`);
    let a0 = 2; while (a0 <= m - 3 && U[a0] < P.length - T - 1e-9) a0++;
    r = a0 <= m - 3 ? tailSolve(F, a0) : null;
    if (!r || !r.ok) {
      const best = shortestTail(F), why = !r ? 'holds no climb point it can move' : `would lift the car off at ${MACH6.vmaxKmh} km/h`;
      throw Object.assign(new D.CoreError('LEVEL_TAIL_SHORT', best ? `a tail of ${T} m ${why}: it needs at least ${Math.ceil(best.tailM)} m` : `a tail of ${T} m ${why}, and no tail of this piece levels it: make the piece longer`), { needM: best ? best.tailM : null });
    }
  }
  const pieces = doc.pieces.slice();
  pieces[i] = { ...P, channels: { ...P.channels, kv: Array.from(r.c) } };
  const N = pieces[i + 1];
  if (N && N.type === 'road') {
    const e = D.endState({ ...doc, pieces: pieces.slice(0, i + 1) }).kv, h1 = N.knots.length ? N.knots[0] : N.length, kv = N.channels.kv.slice();
    kv[0] = q(e.v, D.DEC.kv); kv[1] = q(e.v + (e.m * h1) / 3, D.DEC.kv);
    pieces[i + 1] = { ...N, channels: { ...N.channels, kv } };
  }
  return freeze(D.checkDoc({ ...doc, pieces }));
}

module.exports = { extendLevel, extendToFloor, shortestToFloor, levelEnd, levelEndTail, headOf, V_OPEN };
