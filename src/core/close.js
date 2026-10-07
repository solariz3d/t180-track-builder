// close.js: CLOSE THE LOOP in one click (D185, pane E; the spec's GO §4). A weighted least-norm correction to the channels'
// control points, iterated Gauss–Newton on the closure residual (ref 10 §3; the step is ref 04 §3,
// δ = −W⁻¹Jᵀ(JW⁻¹Jᵀ)⁻¹r, VMLS §16.1.1).
//
// The residual (ref 10 §3): the end meets the start in position (3 rows), measured on the ADAPTER's own path (src/core/adapter.js
// toPath), so the lap closes in the geometry the app draws and exports; the net heading is 2πk and the net pitch 0, on the
// adapter's segment rule, so the tangent closes (ref 02 §2); the bank ends where it began, mod 2π, so the frame closes (a closed
// curve's frame need not close by itself, ref 04 §4, WANG08); and every channel's value and slope continue round the seam, so
// the seam is a joint like any other: C1 in every channel (src/core/README.md), G2 in the line.
//
// The weight: control points of the stretch edited last get wEdit ≫ 1, so the correction goes round them (the user's work is not
// moved). A joint's two coefficients on the next piece are not free: the first IS the previous piece's last, and the second is
// set by its end slope (README), so they follow the parameters they depend on.
//
// Reused from D184 (tools/piecewise.cjs): `basis` (ref 03 §1) and `denseSolve`. NOT reused: its constrained fitter
// `fitSystem`, which minimises distance to DATA under joint rows; the close has no data, only a dense Jacobian of the lap's
// integral, and its step is the least-norm one (ref 04 §3), which `fitSystem` does not compute.
'use strict';
const { basis, denseSolve } = require('../../tools/piecewise.cjs');
const D = require('./document.js');
const { toPath, toSegments } = require('./adapter.js');
const { jointSteps } = require('../geom/profile.js');

// D258: the road AFTER a jump is the user's LANDING: it starts at the flight's pose, level and at the flight's bank, and is not C1 with the take-off
// (document.js landingProblem), so the close holds its first two control points in EVERY channel: the landing's pose and start are his, never solved

const EDGE_SEAM_TOL = 0.01;   // D225: an edge turned off by extend ends within a hair of 0 (the fit); under 0.01° (and 0.01°/m) it steps the lap seam by under a millimetre, so it is not an edge at the seam
const SEAM_MAX_M = 1e-3;   // D190 round 3: a lap seam steps at most 1 mm on the curve

const TAU = 2 * Math.PI;
/**
 * D239 (pane C): the step's linear solve, with the one way it can fail named. A SINGULAR closure system (a lap of straights: no channel
 * can bend the track round to meet its start) used to escape as the solver's plain Error, which the app's shell does not catch, so the
 * user saw nothing. It is a CoreError now, which the shell shows as its message. Any other error from the solver is not this case and
 * is thrown as it was.
 */
function solveOrRefuse(M, rhs) {
  try { return denseSolve(M, rhs); } catch (e) {
    if (!/^denseSolve: singular/.test(e && e.message)) throw e;
    throw new D.CoreError('CLOSE_SINGULAR', 'nothing to close yet: this track cannot be bent round to meet its start (the closing equations are singular). A loop needs a turn: extend with a turn, then close');
  }
}
const q = (x, dec) => { const v = Number(x.toFixed(dec)); return Object.is(v, -0) ? 0 : v; };   // document.js's quantisation
/** ref 02 §2: the unit tangent from heading θ (about world up, +y) and pitch p, and its derivatives. */
const dTdTh = (th, p) => [Math.cos(p) * Math.cos(th), 0, -Math.cos(p) * Math.sin(th)];
const dTdP = (th, p) => [-Math.sin(p) * Math.sin(th), Math.cos(p), -Math.sin(p) * Math.cos(th)];
const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };
const hEnd = (P) => P.length - (P.knots.length ? P.knots[P.knots.length - 1] : 0);   // the last span (README: pieceEnd)
const hStart = (P) => (P.knots.length ? P.knots[0] : P.length);                        // the first span

/**
 * The parameters. For each channel, every control point of every road piece is a column, EXCEPT a joint's first two on the next
 * piece: c₀ = the previous piece's last, c₁ = c₀ + (h_b/h_a)(c_{n−1} − c_{n−2}) (README: the second is set by the end slope,
 * m = 3(c_{n−1} − c_{n−2})/h_a, c₁ = c₀ + m·h_b/3). `expand[ch][p][i]` lists (column, coefficient) pairs.
 */
/**
 * D225: the channels in play. Every channel but the edge and tube ones is always a column (as before); e and s are columns only when some road piece carries an edge, t only
 * when one carries a tube, so a document without them solves exactly as it did. linkable(): the joint's first two coefficients follow the previous piece only where BOTH pieces carry
 * the channel (the cup's rule, and the same for e, s and t).
 */
function activeChannels(doc) { return D.CHANNELS.filter((ch) => ch === 'c' || !D.OPTIONAL[ch] || doc.pieces.some((P) => P.type === 'road' && P[D.OPTIONAL[ch]])); }
function linkable(ch, A, B) { const f = D.OPTIONAL[ch]; if (!f) return true; if (ch === 'c') return !!(A.cup && B.cup); return !!(A[f] && B[f]); }
/** The seam's kinds (D225): which optional channels continue round the lap (both end pieces carry them). */
function seamOf(doc) {
  const road = doc.pieces.filter((P) => P.type === 'road'), F = road[0], L = road[road.length - 1];
  return { F, L, cupBoth: !!(F.cup && L.cup), edgeBoth: !!(F.edge && L.edge), tubeBoth: !!(F.tube && L.tube) };
}
const seamJoined = (ch, sm) => !D.OPTIONAL[ch] || (ch === 'c' ? sm.cupBoth : ch === 't' ? sm.tubeBoth : sm.edgeBoth);
/**
 * A seam that joins an edge or a tube to something that cannot match it is REFUSED BY NAME, never solved around (seal E4 iii, T2): a tube against a different cross-section (TUBE_SEAM),
 * or an edge that is still active at one end of the lap against a piece with none (EDGE_SEAM: the unflagged end has e = 0 with slope 0, so the flagged end must end there too).
 */
function checkSeamKinds(doc) {
  const { F, L } = seamOf(doc);
  if (!!F.tube !== !!L.tube) throw new D.CoreError('TUBE_SEAM', 'close: the lap would join a tube to a different cross-section at the seam; start and end the lap on the same kind of road (both tubes, or neither)');
  if (!!F.edge !== !!L.edge) {
    const Fh = F.knots.length ? F.knots[0] : F.length, E = F.edge ? [F.channels.e[0], (3 * (F.channels.e[1] - F.channels.e[0])) / Fh] : [D.pieceEnd(L).e.v, D.pieceEnd(L).e.m];   // the flagged end of the seam: its e and slope there
    if (Math.abs(E[0]) > EDGE_SEAM_TOL || Math.abs(E[1]) > EDGE_SEAM_TOL) throw new D.CoreError('EDGE_SEAM', `close: the lap would join an edge (e ${E[0]}°, slope ${E[1]}) to a piece with none at the seam; bring the edge back to 0 before the end of the lap, or give both ends an edge`);
  }
}
function parameters(doc, edited, free = null) {
  const cols = [], expand = {}, fixedOf = (p) => !!free && !free.has(p);   // D242: a LOCAL close's columns outside its window are fixed (never moved)
  for (const ch of activeChannels(doc)) {
    expand[ch] = doc.pieces.map(() => null);
    let prev = -1, flightSince = false;
    doc.pieces.forEach((P, p) => {
      if (P.type !== 'road') {
        // D243: A JUMP. (The road before it must end with h and l at 0, value and slope: checkDoc FLIGHT_OFFSET. No closing row reaches those control
        // points, since the seam rows touch only the lap's first and last road pieces and a lap ending in a jump is refused, so they never move; and
        // if one ever did, the closed document's checkDoc would refuse it by name.)
        if (P.type === 'flight') flightSince = true;
        return;
      }
      const n = P.channels[ch].length, e = new Array(n);
      for (let i = 0; i < n; i++) {
        // D258: the LANDING's first two control points are held in every channel (above), never linked to the road before the jump
        if (prev >= 0 && i < 2 && flightSince) { e[i] = [[cols.length, 1]]; cols.push({ ch, p, i, edited: edited.has(p), fixed: true }); continue; }
        if (prev >= 0 && i < 2 && linkable(ch, doc.pieces[prev], P)) {   // the cup joins only cup to cup (a legacy piece's c is a placeholder); e, s and t the same
          const A = expand[ch][prev], na = A.length, rho = hStart(P) / hEnd(doc.pieces[prev]);
          e[i] = i === 0 ? A[na - 1] : [...A[na - 1].map(([c, k]) => [c, k * (1 + rho)]), ...A[na - 2].map(([c, k]) => [c, -k * rho])];
          if (edited.has(p)) for (const [c] of e[i]) cols[c].edited = true;
          continue;
        }
        e[i] = [[cols.length, 1]]; cols.push({ ch, p, i, edited: edited.has(p), fixed: fixedOf(p) });
      }
      expand[ch][p] = e; prev = p; flightSince = false;
    });
  }
  return { cols, expand };
}
/** The document with every channel rebuilt from the parameter vector x (joints follow; nothing quantised). `keep` (D242, a local close): pieces returned
 *  AS THEY ARE, the very same objects, because no free column reaches them, so they stay bit-identical rather than recomputed from their own values. */
function apply(doc, expand, x, quantise, keep = null) {
  return { ...doc, pieces: doc.pieces.map((P, p) => {
    if (P.type !== 'road' || (keep && keep.has(p))) return P;
    const channels = { ...P.channels };
    for (const ch of Object.keys(expand)) channels[ch] = expand[ch][p].map((terms) => { const v = terms.reduce((s, [c, k]) => s + k * x[c], 0); return quantise ? q(v, D.DEC[ch]) : v; });
    return { ...P, channels };
  }) };
}

/**
 * The model's rows (ref 10 §3): the end position by the ref 02 §2 midpoint rebuild, and its derivatives with respect to every
 * kh and kv control point of every road piece (reverse accumulation). It is only the Jacobian's model: the residual itself is
 * measured on the adapter's path.
 */
function positionJacobian(doc, step = 1) {
  let th = doc.start.heading, p = doc.start.pitch; const G = [];
  doc.pieces.forEach((P, pi) => {
    // D258: A FREE JUMP (src/core/adapter.js toSegments): the landing starts at forward·F(θ) + left·Lh(θ) + up·ŷ from the take-off, in the take-off's
    // HEADING frame (F = (sin θ, 0, cos θ), Lh = (cos θ, 0, −sin θ)), whatever its pitch; then the heading turns by the flight's heading and the pitch IS the
    // landing's. So in heading the jump is one step, ∂/∂θ = forward·Lh(θ) − left·F(θ); in pitch it CUTS the chain (nothing before it reaches the end through pitch)
    if (P.type === 'flight') {
      const F = [Math.sin(th), 0, Math.cos(th)], Lh = [Math.cos(th), 0, -Math.sin(th)];
      G.push({ flight: true, Tt: [0, 1, 2].map((k) => P.forward * Lh[k] - P.left * F[k]) });
      th += P.heading; p = P.pitch;
      return;
    }
    if (P.type !== 'road') return;
    const U = D.knotVector(P), n = Math.max(1, Math.ceil(P.length / step)), h = P.length / n;
    const at = (ch, s) => { const b = basis(U, s); let v = 0; for (let a = 0; a < 4; a++) v += P.channels[ch][b.first + a] * b.N[a]; return { v, b }; };
    for (let i = 0; i < n; i++) {
      const s = i * h, sm = (i + 0.5) * h, kh0 = at('kh', s), kv0 = at('kv', s), khm = at('kh', sm), kvm = at('kv', sm);
      const te = th + 0.5 * h * kh0.v, pe = p + 0.5 * h * kv0.v;
      G.push({ pi, h, Tt: dTdTh(te, pe).map((v) => v * h), Tp: dTdP(te, pe).map((v) => v * h), kh0: kh0.b, kv0: kv0.b, khm: khm.b, kvm: kvm.b });
      th += h * khm.v; p += h * kvm.v;
    }
  });
  // ∂x_end/∂c = Σ_m h B(sm_m)·Σ_{i>m} G_i + Σ_i ½h B(s_i) G_i, with G_i = h ∂T/∂θ at step i (the same for pitch)
  const J = { kh: new Map(), kv: new Map() };
  const add = (ch, pi, b, coef) => { for (let a = 0; a < 4; a++) { const key = `${pi}:${b.first + a}`, v = J[ch].get(key) || [0, 0, 0]; for (let k = 0; k < 3; k++) v[k] += coef[k] * b.N[a]; J[ch].set(key, v); } };
  let sT = [0, 0, 0], sP = [0, 0, 0];
  for (let i = G.length - 1; i >= 0; i--) {
    const g = G[i];
    if (g.flight) { sT = sT.map((v, k) => v + g.Tt[k]); sP = [0, 0, 0]; continue; }   // D258: the free jump's offset turns with the take-off's heading; no pitch before it reaches the end
    add('kh', g.pi, g.kh0, g.Tt.map((v) => 0.5 * g.h * v)); add('kv', g.pi, g.kv0, g.Tp.map((v) => 0.5 * g.h * v));
    add('kh', g.pi, g.khm, sT.map((v) => g.h * v)); add('kv', g.pi, g.kvm, sP.map((v) => g.h * v));
    sT = sT.map((v, k) => v + g.Tt[k]); sP = sP.map((v, k) => v + g.Tp[k]);
  }
  return J;
}

/**
 * The linear rows on the ADAPTER's segment rule (adapter.js toSegments: heading and pitch rates linear over each segment, so
 * the net heading is Σ ½(a + b)·Δs). Returns the gradient of the net heading and net pitch with respect to each control point.
 */
function netRows(doc) {
  const out = { kh: new Map(), kv: new Map(), kvBase: 0, khBase: 0 };
  const segs = toSegments(doc), byId = new Map(doc.pieces.map((P, p) => [P.id, p]));
  let s = new Map();
  for (const g of segs) {
    // D258: A JUMP sets the pitch to its landing's (adapter.js), so the net pitch is counted again from there: the lap's end pitch is the last jump's
    // landing pitch plus the road after it, and no kv before that jump reaches it. Its heading TURN adds to the net heading (a constant: the user's)
    if (g.part === 'gap') { const F = doc.pieces[byId.get(g.id)]; out.kv = new Map(); out.kvBase = F.pitch - doc.start.pitch; out.khBase += F.heading; continue; }
    if (g.part !== 'body') continue;
    const p = byId.get(g.id), P = doc.pieces[p], U = D.knotVector(P), s0 = s.get(p) || 0, s1 = s0 + g.length; s.set(p, s1);
    for (const x of [s0, s1]) {
      const b = basis(U, Math.min(x, P.length));
      for (const ch of ['kh', 'kv']) for (let a = 0; a < 4; a++) { const key = `${p}:${b.first + a}`; out[ch].set(key, (out[ch].get(key) || 0) + 0.5 * g.length * b.N[a]); }
    }
  }
  return out;
}

/**
 * The seam between a cup end and a legacy end (D190 round 3): the cup's value there is HELD at the edge the legacy piece renders (its rendered
 * edge is the legacy piece's c, `D.pieceEnd`, or `D.legacyEdgeDeg` at its start). Null when both ends are the same kind (cup to cup closes c as a channel).
 * `value` is the cup's c minus that edge; `piece` and `index` say which control point moves it.
 */
function heldCup(F, L) {
  if (!!F.cup === !!L.cup) return null;
  if (L.cup) return { value: L.channels.c.at(-1) - D.legacyEdgeDeg(F.family, F.channels.w[0], F.channels.r[0]), end: 'last' };
  return { value: F.channels.c[0] - D.pieceEnd(L).c.v, end: 'first' };
}

/** The residual, measured on the adapter's path and the document itself (ref 10 §3). */
/** The channels whose VALUE must meet round the seam: heading, pitch, width and rise always; the cup, the edge pair and the tube sweep where both ends carry them. */
const valueChannels = (sm) => ['kh', 'kv', 'w', 'r', ...(sm.cupBoth ? ['c'] : []), ...(sm.edgeBoth ? ['e', 's'] : []), ...(sm.tubeBoth ? ['t'] : [])];
function residual(doc) {
  if (!doc.pieces.some((P) => P.type === 'road')) throw new D.CoreError('EMPTY', 'close: no road to close');
  const S = toPath({ ...doc, closed: false }).path.samples, a = S[0], z = S[S.length - 1];
  const road = doc.pieces.filter((P) => P.type === 'road'), F = road[0], L = road[road.length - 1];
  const rows = netRows(doc), net = { kh: rows.khBase, kv: rows.kvBase };   // kvBase: a jump's landing pitch, when the lap has one (D243); khBase: the jumps' heading turns (D258)
  for (const ch of ['kh', 'kv']) for (const [key, w] of rows[ch]) { const [p, i] = key.split(':').map(Number); net[ch] += w * doc.pieces[p].channels[ch][i]; }
  const turns = Math.round(net.kh / TAU), bank = L.channels.phi.at(-1) - F.channels.phi[0], m = Math.round(bank / TAU);
  const r = [z.pos[0] - a.pos[0], z.pos[1] - a.pos[1], z.pos[2] - a.pos[2], net.kh - TAU * turns, net.kv, bank - TAU * m];
  const names = ['x', 'y', 'z', 'net heading − 2πk', 'net pitch', 'bank at the seam'];
  const sm = seamOf(doc), cupBoth = sm.cupBoth;   // the cup continues round the seam only when both ends are cup pieces (a mixed seam is reported, not solved); e, s, t likewise (D225)
  for (const ch of valueChannels(sm)) { r.push(L.channels[ch].at(-1) - F.channels[ch][0]); names.push(`${ch} value at the seam`); }
  const held = heldCup(F, L);   // a cup meeting a legacy piece round the seam is held at the legacy piece's RENDERED edge (D190 R3)
  if (held) { r.push(held.value); names.push('cup edge at the seam (held at the legacy end rendered edge)'); }
  for (const ch of D.CHANNELS) {
    if (!seamJoined(ch, sm)) continue;
    const cl = L.channels[ch], n = cl.length, cf = F.channels[ch];
    r.push((3 * (cl[n - 1] - cl[n - 2])) / hEnd(L) - (3 * (cf[1] - cf[0])) / hStart(F)); names.push(`${ch} slope at the seam`);
  }
  return { r, names, turns, gapM: Math.hypot(r[0], r[1], r[2]), tangentRad: Math.acos(Math.max(-1, Math.min(1, a.T[0] * z.T[0] + a.T[1] * z.T[1] + a.T[2] * z.T[2]))), pathEnd: z, pathStart: a };
}

/**
 * Close the lap, in one call. Options: edited (the piece INDICES of the stretch edited last; default the last road piece), wEdit
 * (default 1e6), tolM (default 1e-3 m), maxIter (default 30). Returns { doc (closed: true, checked, frozen; the input untouched),
 * converged, iterations, residual: every row by name, report }. A close that does not converge SAYS so (converged false,
 * report "NOT CLOSED …"), and still returns its best document with closed false, so nothing silently claims a closure.
 */
function close(doc, opts = {}) {
  D.checkDoc(doc); doc = D.fillCup(doc);
  checkSeamKinds(doc);
  // D243, D258: a track WITH JUMPS closes like any other (the landing's pose is the user's and stays as it is; see parameters, positionJacobian and netRows).
  // The one shape refused is a lap that ENDS in a jump: its seam would join the air to the lap's start
  if (doc.pieces.length && doc.pieces[doc.pieces.length - 1].type === 'flight') throw new D.CoreError('FLIGHT_AT_END', 'close: the track ends in a jump, so the lap would join the air to its start; place the landing and extend road after it, then close');
  const roadIdx = doc.pieces.map((P, i) => (P.type === 'road' ? i : -1)).filter((i) => i >= 0);
  const cupBoth = !!(doc.pieces[roadIdx[0]].cup && doc.pieces[roadIdx[roadIdx.length - 1]].cup);
  const held = heldCup(doc.pieces[roadIdx[0]], doc.pieces[roadIdx[roadIdx.length - 1]]);
  // D242: a LOCAL close (opts.window, the piece indices allowed to move): only their control points are variables, every other piece is kept as it is
  const local = opts.window !== undefined && opts.window !== null, win = local ? windowOf(doc, opts.window) : null, free = win ? win.set : null;
  const edited = local ? new Set() : new Set(opts.edited || [roadIdx[roadIdx.length - 1]]), wEdit = opts.wEdit || 1e6, tolM = opts.tolM || 1e-3, maxIter = opts.maxIter || 30;
  const { cols, expand } = parameters(doc, edited, free), N = cols.length, winv = cols.map((c) => (c.fixed ? 0 : c.edited ? 1 / wEdit : 1));
  const keep = local ? keptPieces(doc, expand, cols) : null;   // the pieces no free column reaches: returned as the very same objects
  const refuse = (why) => new D.CoreError('CLOSE_WINDOW', `close: can't close using only ${win.text}: ${why}. Widen the window or reshape the end`);
  const solve = (M, rhs) => { try { return solveOrRefuse(M, rhs); } catch (e) { if (local && e.code === 'CLOSE_SINGULAR') throw refuse('the closing equations cannot be met by moving only these pieces'); throw e; } };
  let x = Float64Array.from(cols, (c) => doc.pieces[c.p].channels[c.ch][c.i]);
  const angleTol = 1e-9, done = (m) => m.gapM < tolM && m.r.slice(3).every((v) => Math.abs(v) < angleTol);
  const merit = (m) => m.gapM + 100 * m.r.slice(3).reduce((s, v) => s + Math.abs(v), 0);   // for step halving only: 1 rad ~ 100 m
  // a row over raw control points → a row over the columns (the joints' dependents fold in)
  const toCols = (ch, entries, row, k = 0) => { for (const [key, w] of entries) { const [p, i] = key.split(':').map(Number); for (const [c, coef] of expand[ch][p][i]) row[c] += coef * (Array.isArray(w) ? w[k] : w); } };
  const valueRow = (ch, which) => { const row = new Float64Array(N), F = roadIdx[0], L = roadIdx[roadIdx.length - 1];
    const put = (p, i, s) => { for (const [c, coef] of expand[ch][p][i]) row[c] += s * coef; };
    const nL = doc.pieces[L].channels[ch].length;
    if (which === 'value') { put(L, nL - 1, 1); put(F, 0, -1); }
    else { const a = 3 / hEnd(doc.pieces[L]), b = 3 / hStart(doc.pieces[F]); put(L, nL - 1, a); put(L, nL - 2, -a); put(F, 1, -b); put(F, 0, b); }
    return row; };

  let work = apply(doc, expand, x, false, keep), m = residual(work), it = 0;
  for (; it < maxIter && !done(m); it++) {
    const Jp = positionJacobian(work), nr = netRows(work), J = [];
    for (let k = 0; k < 3; k++) { const row = new Float64Array(N); toCols('kh', Jp.kh, row, k); toCols('kv', Jp.kv, row, k); J.push(row); }
    for (const ch of ['kh', 'kv']) { const row = new Float64Array(N); toCols(ch, nr[ch], row); J.push(row); }
    J.push(valueRow('phi', 'value'));
    for (const ch of valueChannels(seamOf(doc))) J.push(valueRow(ch, 'value'));
    if (held) { const row = new Float64Array(N), Pi = held.end === 'last' ? roadIdx[roadIdx.length - 1] : roadIdx[0], ii = held.end === 'last' ? doc.pieces[Pi].channels.c.length - 1 : 0; for (const [c, coef] of expand.c[Pi][ii]) row[c] += coef; J.push(row); }
    for (const ch of D.CHANNELS) { if (!seamJoined(ch, seamOf(doc))) continue; J.push(valueRow(ch, 'slope')); }
    // δ = −W⁻¹Jᵀ(JW⁻¹Jᵀ)⁻¹ r (ref 04 §3)
    const M = J.map((a) => J.map((b) => { let s = 0; for (let k = 0; k < N; k++) s += a[k] * winv[k] * b[k]; return s; }));
    const y = solve(M, m.r.map((v) => -v)), delta = new Float64Array(N);
    J.forEach((row, i) => { for (let k = 0; k < N; k++) delta[k] += winv[k] * row[k] * y[i]; });
    let alpha = 1, xn, wn, mn;                                  // halve the step while it makes things worse (E's rule, not a formula)
    for (let hh = 0; hh < 12; hh++, alpha /= 2) { xn = x.map((v, k) => v + alpha * delta[k]); wn = apply(doc, expand, xn, false, keep); mn = residual(wn); if (merit(mn) < merit(m)) break; }
    x = xn; work = wn; m = mn;
  }
  // what is STORED is quantised (README): measure the quantised document, and report that
  const stored = apply(doc, expand, x, true, keep), ms = residual(stored), converged = done(m) && ms.gapM < 0.01;
  // D242: a local close that does not close is a REFUSAL by name, never a best try handed back: the window could not do it, and nothing outside it may help
  if (local && !converged) throw refuse(`it gets no closer than ${ms.gapM.toFixed(3)} m (tangent ${ms.tangentRad.toExponential(1)} rad) in ${it} step(s)`);
  let out;
  try { out = freeze(D.checkDoc({ ...stored, closed: converged })); } catch (e) {
    if (local && e.name === 'CoreError') throw refuse(`the closed track would break a limit of the document (${e.code}: ${e.message})`);
    throw e;
  }
  if (local) {   // the roll-rate bar (src/validate: 20 m chord), read in the window only: a close may not push the window past it (a red that was already there elsewhere is not the close's)
    const V = require('../validate/index.js');
    const rollIn = (d, closed) => { const { path } = toPath({ ...d, closed }); let mx = 0; for (const q of V._internal.rollRates(path.samples, () => true, closed, path.lengthM)) if (q.s >= win.fromS - 1e-9) mx = Math.max(mx, q.rate); return mx; };
    const after = rollIn(out, true);
    if (after > V.ROLL_RED_DEG_M) { const before = rollIn(doc, false); if (after > before + 1e-9) throw refuse(`the road would roll too fast there: ${after.toFixed(3)}°/m over 20 m, past the ${V.ROLL_RED_DEG_M}°/m bar (it was ${before.toFixed(3)}°/m)`); }
  }
  if (held && converged) {   // never converged over a step: the seam's curve, measured on the segments the lap will be drawn from
    const lap = jointSteps(toSegments({ ...out, closed: true }), true).find((x) => x.lap);
    if (lap && lap.m > SEAM_MAX_M) throw new D.CoreError('CUP_SEAM', `close: the lap seam would step ${(lap.m * 1000).toFixed(2)} mm (more than ${SEAM_MAX_M * 1000} mm) between the cup and the legacy piece at the start: the closing piece is too short to fade one into the other; lengthen it`);
  }
  // a seam between a cup piece and a legacy one is not solved (the cup would have to move to a rendered edge): its step is reported
  const endE = D.pieceEnd(stored.pieces[roadIdx[roadIdx.length - 1]]).c.v, startP = stored.pieces[roadIdx[0]];
  const cupSeamStepDeg = cupBoth || !(startP.cup || stored.pieces[roadIdx[roadIdx.length - 1]].cup) ? 0 : Math.abs(endE - (startP.cup ? startP.channels.c[0] : D.legacyEdgeDeg(startP.family, startP.channels.w[0], startP.channels.r[0])));
  return { doc: out, converged, iterations: it, turns: ms.turns, gapM: ms.gapM, tangentRad: ms.tangentRad, cupSeamStepDeg,
    window: win ? { pieces: [...win.set].sort((a, b) => a - b), ids: win.ids, fromS: win.fromS, lengthM: win.lengthM, text: win.text } : null,
    residual: Object.fromEntries(ms.names.map((n, i) => [n, ms.r[i]])),
    report: converged ? `closed in ${it} step(s): ${(ms.gapM * 1000).toFixed(3)} mm, tangent ${ms.tangentRad.toExponential(1)} rad${cupSeamStepDeg > D.CUP_JOINT_DEG ? `; the cup steps ${cupSeamStepDeg.toFixed(2)}° at the seam (a cup meets a legacy piece there)` : ''}`
      : `NOT CLOSED after ${it} step(s): ${ms.gapM.toFixed(4)} m, tangent ${ms.tangentRad.toExponential(1)} rad` };
}

/**
 * D242, THE LOCAL CLOSE's window (the keeper, TEST 1: "completing the loop altered the rest of the track equation": the whole-lap close moved
 * every control point, the 1,000 m opening straight's heading rate by 0.00204 rad/m, and the lap ran into itself). `spec` is the piece indices
 * allowed to move. Only road pieces count; at least one must be given. Returns { set, ids, fromS (the window's start along the lap),
 * lengthM, text } where text names it for a person ("the last 1,234 m (p44–p46)").
 */
function windowOf(doc, spec) {
  if (!Array.isArray(spec)) throw new D.CoreError('CLOSE_WINDOW', 'close: a window is a list of the pieces allowed to move');
  const set = new Set(spec.filter((i) => Number.isInteger(i) && doc.pieces[i] && doc.pieces[i].type === 'road'));
  if (!set.size) throw new D.CoreError('CLOSE_WINDOW', 'close: the window holds no road piece: give it at least the last piece');
  const starts = []; let s = 0; for (const P of doc.pieces) { starts.push(s); s += P.length; }
  const idx = [...set].sort((a, b) => a - b), fromS = starts[idx[0]], lengthM = idx.reduce((a, i) => a + doc.pieces[i].length, 0);
  const ids = idx.map((i) => doc.pieces[i].id), contiguousTail = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1) && idx[idx.length - 1] === doc.pieces.length - 1;
  const span = ids.length === 1 ? ids[0] : `${ids[0]}–${ids[ids.length - 1]}`;
  const text = `${contiguousTail ? 'the last ' : ''}${Math.round(lengthM).toLocaleString('en-US')} m (${contiguousTail ? span : ids.join(', ')})`;
  return { set, ids, fromS, lengthM, text };
}
/** The pieces no free column reaches (a local close): every term of every one of their control points names only fixed columns. */
function keptPieces(doc, expand, cols) {
  const keep = new Set();
  doc.pieces.forEach((P, p) => {
    if (P.type !== 'road') return;
    let reached = false;
    for (const ch of Object.keys(expand)) { const e = expand[ch][p]; if (e && e.some((terms) => terms.some(([c]) => !cols[c].fixed))) { reached = true; break; } }
    if (!reached) keep.add(p);
  });
  return keep;
}
/**
 * The DEFAULT window for the app's Close (D242): the trailing road pieces that cover at least `fraction` of the lap (default 0.2, the plan's
 * "the last ~20%"), always at least the last road piece. `{ last: true }` is the last road piece alone; `{ fraction: 1 }` is every road piece
 * (the whole lap, kept for when the keeper asks for it). Returns piece indices.
 */
function closeWindow(doc, { fraction = 0.2, last = false } = {}) {
  const road = doc.pieces.map((P, i) => (P.type === 'road' ? i : -1)).filter((i) => i >= 0);
  if (!road.length) return [];
  if (last) return [road[road.length - 1]];
  const total = road.reduce((a, i) => a + doc.pieces[i].length, 0), want = Math.max(0, Math.min(1, fraction)) * total, out = [];
  let got = 0; for (let k = road.length - 1; k >= 0 && (got < want - 1e-9 || !out.length); k--) { out.unshift(road[k]); got += doc.pieces[road[k]].length; }
  return out;
}

module.exports = { close, residual, parameters, positionJacobian, netRows, closeWindow, windowOf };
