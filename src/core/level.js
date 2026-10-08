// level.js: LEVEL and TO FLOOR (D271; the keeper, 2026-10-08: "there needs to be a way to snap the track to the floor to be true flat … i wanted the
// downhill to straighten out but its hard to calculate by hand"). The climb channel kv is a RATE (rad per metre of road), so "climb 0" keeps whatever
// slope the road already has: on the keeper's track the last piece eases its climb to 0 and ends straight, but tilted +3.2° and 187 m below the start.
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
// THE LIMIT (To floor's refusal, and nothing else): the road's centre must keep the car on it at the open track's speed, the validator's own D256
// check (src/validate/index.js 'leaves-surface' on the centreline: fN = g·cos p + v²·κ_climb ≥ 0 at vmax 970 km/h, src/validate/limits.js). A
// shape that would lift the car off is never placed, and never clamped: the user is told the length that does it.
'use strict';
const D = require('./document.js');
const { extend } = require('./extend.js');
const { toPath } = require('./adapter.js');
const { basis, denseSolve } = require('../../tools/piecewise.cjs');
const { MACH6, G } = require('../validate/limits.js');

const SEG_M = 2;               // the adapter's segment (toSegments segM): the pitch is integrated on its ends
const PITCH_TOL = 1e-6;        // rad (0.00006°): the bar is 0.01°
const Y_TOL = 5e-3;            // m: the bar is 1 cm. Not tighter: the climb is STORED to 1e-9 rad/m (document.js DEC.kv), and over a piece of several km that rounding alone moves the end height by millimetres
const MAX_ITER = 12;
const MAX_SEARCH_M = 50000;
const V_OPEN = MACH6.vmaxKmh / 3.6;   // the open track's speed (D256 fullSpeed)
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
/** The end pitch's change over the piece as weights on the control points (the adapter's trapezoid), and the pitch at each station. */
function pitchRows(P, st, c, p0) {
  const m = c.length, w = new Float64Array(m), cum = new Float64Array(m), p = [p0], dpdc = [new Float64Array(m)];
  const kvAt = (x) => x.N.reduce((a, N, k) => a + N * c[x.first + k], 0);
  for (let j = 1; j < st.length; j++) {
    const a = st[j - 1], b = st[j], h = b.s - a.s;
    for (let k = 0; k < 4; k++) { cum[a.first + k] += (h / 2) * a.N[k]; cum[b.first + k] += (h / 2) * b.N[k]; }
    p.push(p[j - 1] + ((kvAt(a) + kvAt(b)) / 2) * h); dpdc.push(Float64Array.from(cum));
  }
  w.set(cum);
  return { w, p, dpdc, kv: st.map(kvAt) };
}
/** The piece with its climb control points replaced (quantised as stored), and the document with it as the head. */
function withClimb(doc, c) {
  const pieces = doc.pieces.slice(), P = pieces[pieces.length - 1];
  pieces[pieces.length - 1] = { ...P, channels: { ...P.channels, kv: Array.from(c, (x) => q(x, D.DEC.kv)) } };
  return freeze(D.checkDoc({ ...doc, pieces }));
}
/** The least-norm step on the free columns (2 … m − 3): δ = Jᵀ(JJᵀ)⁻¹(−r). */
function step(J, r, m) {
  const free = []; for (let i = 2; i <= m - 3; i++) free.push(i);
  if (!free.length) throw new D.CoreError('LEVEL_TOO_SHORT', 'this piece is too short to shape: it has no free climb control point (make it longer)');
  const A = J.map((row) => free.map((i) => row[i])), JJt = A.map((ra) => A.map((rb) => ra.reduce((s, x, k) => s + x * rb[k], 0)));
  const lam = denseSolve(JJt, r.map((x) => -x)), d = new Float64Array(m);
  free.forEach((i, k) => { d[i] = A.reduce((s, row, q) => s + row[k] * lam[q], 0); });
  return d;
}
/** The car stays on the road's centre over the piece at the open track's speed: g·cos p + v²·kv ≥ 0 at every station. The worst margin (m/s²; < 0 lifts off). */
const crestMargin = (rows) => Math.min(...rows.kv.map((k, j) => G * Math.cos(rows.p[j]) + V_OPEN * V_OPEN * k));

/** The piece Extend would place with climb 0 (its easing: the rate to 0 over the whole piece), the climb's own at-start ramp dropped. */
function basePiece(doc, opts) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to level');
  const targets = { ...(opts.targets || {}), kv: 0 }, o = { ...opts, targets };
  if (o.transition && typeof o.transition === 'object') { const { kv, ...rest } = o.transition; o.transition = Object.keys(rest).length ? rest : undefined; if (o.transition === undefined) delete o.transition; }
  return extend(doc, o);
}

function solve(doc, opts, floor, { model = false, head: given = null } = {}) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to level');
  const head = given || headOf(doc), d0 = basePiece(doc, opts), P0 = d0.pieces[d0.pieces.length - 1], st = stationsOf(P0), m = P0.channels.kv.length;
  let c = Float64Array.from(P0.channels.kv); c[m - 1] = 0; c[m - 2] = 0;   // it ends straight: rate 0 and slope 0
  let d = withClimb(d0, c), rows = pitchRows(P0, st, c, head.p);
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
    d = withClimb(d0, c); c = Float64Array.from(d.pieces[d.pieces.length - 1].channels.kv); rows = pitchRows(P0, st, c, head.p);
  }
  const yEnd = model ? yModel(rows, st, head.y) : headOf(d).y, pEnd = rows.p[rows.p.length - 1];
  return { doc: d, pEnd, yEnd, crest: crestMargin(rows), converged: Math.abs(pEnd) <= PITCH_TOL && (!floor || Math.abs(yEnd) <= Y_TOL) };
}

/** The end height on the model (the trapezoid of sin p on the stations): the search's only, so it does not rebuild the whole path at every try; the answer is then checked on the adapter's path. */
const yModel = (rows, st, y0) => { let y = y0; for (let j = 1; j < st.length; j++) y += ((Math.sin(rows.p[j - 1]) + Math.sin(rows.p[j])) / 2) * (st[j].s - st[j - 1].s); return y; };

/** Extend with a piece that ends straight and level (pitch 0). */
function extendLevel(doc, opts) { return solve(doc, opts, false).doc; }

const feasible = (doc, opts, L, how = {}) => { try { const r = solve(doc, { ...opts, length: L }, true, how); return r.converged && r.crest >= 0; } catch (e) { if (e && e.code === 'LEVEL_TOO_SHORT') return false; throw e; } };
/** The shortest whole-metre length at which To floor works from this head (with these fields), or null when none up to MAX_SEARCH_M does. */
function shortestToFloor(doc, opts) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to level');
  const how = { model: true, head: headOf(doc) };   // the search on the model, from the head read once
  let lo = 0, hi = Math.max(40, Number(opts.length) || 40);
  while (!feasible(doc, opts, hi, how)) { lo = hi; hi *= 1.5; if (hi > MAX_SEARCH_M) return null; }
  while (hi - lo > 1) { const mid = Math.round((lo + hi) / 2); if (feasible(doc, opts, mid, how)) hi = mid; else lo = mid; }
  let L = Math.ceil(hi);
  for (let k = 0; k < 20 && !feasible(doc, opts, L, { head: how.head }); k++) L++;   // the named length must WORK on the adapter's path: checked there, a metre at a time if the model was short
  return L;
}
/** Extend with a piece that ends straight, level and on the floor (height 0), or refuse by name with the shortest length that does it. */
function extendToFloor(doc, opts) {
  const r = solve(doc, opts, true);
  if (r.converged && r.crest >= 0) return r.doc;
  const need = shortestToFloor(doc, opts), why = !r.converged ? 'cannot reach the floor level in that length' : `would lift the car off its crest at ${MACH6.vmaxKmh} km/h`;
  throw Object.assign(new D.CoreError('FLOOR_TOO_SHORT', need === null ? `a ${opts.length} m piece ${why}, and no piece up to ${MAX_SEARCH_M} m reaches the floor from here` : `a ${opts.length} m piece ${why}: it needs at least ${need} m to reach the floor (height 0, level) from here`), { needM: need });
}

module.exports = { extendLevel, extendToFloor, shortestToFloor, headOf, V_OPEN };
