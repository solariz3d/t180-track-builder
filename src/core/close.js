// close.js: CLOSE THE LOOP in one click (D185, pane E; the spec's GO §4). A weighted least-norm correction to the channels'
// control points, iterated Gauss–Newton on the closure residual (ref 10 §3; the step is ref 04 §3,
// δ = −W⁻¹Jᵀ(JW⁻¹Jᵀ)⁻¹r, VMLS §16.1.1).
//
// The residual (ref 10 §3): the end meets the start in position (3 rows), measured on the ADAPTER's own path (src/core/adapter.js
// toPath), so the lap closes in the geometry the app draws and exports; the net heading is 2πk and the net pitch 0, on the
// adapter's segment rule, so the tangent closes (ref 02 §2); the bank ends where it began, mod 2π, so the frame closes (a closed
// curve's frame need not close by itself, ref 04 §4, WANG08); and every channel's value and slope continue round the seam, so
// the seam is a joint like any other: C1 in every channel (src/core/README.md), G2 in the line. D459 3c (2026-10-25): and the cross-section channels the
// wheels ride on (the bank, the cup, the edges: continuity.js C2_CHANNELS) continue their CURVATURE round the seam and across every joint the close
// moves, so a closed lap is C2 there as the words lay it (extend.js, the quintic): a closure that met value and slope only left a curvature step at the
// seam on 19 of 20 of the seeded sweep's closed laps (exo_memory/handback/p-d459-c2-P_2026-10-25.md §5). A curvature row is linear in the first and
// last three control points (the closed forms of continuity.js endDerivatives), so it joins the system as the value and slope rows do; a window whose
// pieces have too few free points for the extra row is refused by name as before (a piece needs six control points, two interior knots, for all four).
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
const CN = require('./continuity.js');   // D459 3c: the curvature at a piece's ends, in closed form

// D258: the road AFTER a jump is the user's LANDING: it starts at the flight's pose, level and at the flight's bank, and is not C1 with the take-off
// (document.js landingProblem), so the close holds its first two control points in EVERY channel: the landing's pose and start are his, never solved

const EDGE_SEAM_TOL = 0.01;   // D225: an edge turned off by extend ends within a hair of 0 (the fit); under 0.01° (and 0.01°/m) it steps the lap seam by under a millimetre, so it is not an edge at the seam
const SEAM_MAX_M = 1e-3;   // D190 round 3: a lap seam steps at most 1 mm on the curve

const TAU = 2 * Math.PI;
// D431 (the user, TEST 10: "a bump as the gen came out a bit higher than the end of the track"; "fix the close loop generation itself to be more accurate and
// smooth"): A WINDOWED CLOSE TAKES THE SMALLEST CHANGE TO THE ROAD, not to the control points. Its step was least-norm in the control points, each counted once,
// and at a joint the piece after takes its first two points from the piece before (parameters), so a joint's points drive two pieces' worth of curve at the price
// of one and the step loaded the correction onto them: on TEST 10's finish the climb rate spiked at both joints of the new road (-0.58 | -0.58, -1.19 against
// -0.30 either side: a crest) and the turn rate with it. A windowed close (Finish to start, the seam tries, D242's window) now measures a change by what it
// does to each channel's curve along the road, ∫ (Δ channel)² + ℓ²(Δ channel')² ds over the window's pieces (the B-spline Gram matrices, through the joints' links), plus
// GRAM_EPS of the plain norm so it is never singular. The rows it must meet are the same, so the lap closes to the same bars; only which closing change is
// taken differs. A metric of smoothness instead (second differences) was measured and refused: it removed the spikes by bending the finish's straights, up
// to 28 m sideways (exo_memory/handback/p-d431-O_2026-10-22.md §4). The whole-lap close (no window) is unchanged. test/core_close_joint.test.js.
// The measure also counts the change's SLOPE along the road, over GRAM_ELL_M: ∫ (Δ)² + ℓ²(Δ')² ds. Without it the step met the seam's value-and-slope rows with a
// zig-zag in the last knots, which barely changes the curve and so costs almost nothing (TEST 10's seam: kv -1.19, -1.68, -0.84, -2.57, 0). ℓ = 50 m (chosen
// from a sweep, 0 to 100 m, on TEST 10 and a 212 m climb: 10 m left a seam spike of 0.53°/100 m, 20 m 0.11; at 50 m no spike past 0.05 anywhere and the
// finish's straights within 0.1 and 0.8 m of where they were; 100 m bends the long straight 2 m further).
const GRAM_STEP_M = 2, GRAM_EPS = 1e-9, GRAM_ELL_M = 50;
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
/**
 * D431: the windowed close's metric over the FREE columns, W = ∫ (aᵀa + ℓ²a'ᵀa') ds + GRAM_EPS·I per channel, a(s) the row of each column's share in the channel's value
 * at s (its B-spline basis through expand, so a joint's linked points count for both pieces they shape), sampled every GRAM_STEP_M along each road piece a free
 * column reaches. W couples only the columns of one channel, so it is kept as one Cholesky factor per channel. Returns winvRow(row) = W⁻¹·row over all N
 * columns (a fixed column: 0).
 */
function gramMetric(doc, expand, cols) {
  const N = cols.length, byCh = new Map();
  cols.forEach((c, k) => { if (!c.fixed) { if (!byCh.has(c.ch)) byCh.set(c.ch, []); byCh.get(c.ch).push(k); } });
  const blocks = [];
  for (const [ch, ks] of byCh) {
    const at = new Map(ks.map((k, j) => [k, j])), n = ks.length, W = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n); r[i] = GRAM_EPS; return r; });
    doc.pieces.forEach((P, p) => {
      const e = P.type === 'road' && expand[ch] && expand[ch][p];
      if (!e || !e.some((terms) => terms.some(([c]) => at.has(c)))) return;
      const U = D.knotVector(P), m = Math.max(2, Math.ceil(P.length / GRAM_STEP_M)), w = P.length / m;
      for (let q = 0; q < m; q++) {
        const b = basis(U, (P.length * (q + 0.5)) / m), row = new Map(), drow = new Map();
        for (let a = 0; a < 4; a++) { const i = b.first + a; if (!e[i]) continue; for (const [c, k] of e[i]) if (at.has(c)) { row.set(at.get(c), (row.get(at.get(c)) || 0) + k * b.N[a]); drow.set(at.get(c), (drow.get(at.get(c)) || 0) + k * b.D1[a]); } }
        const ent = [...row]; for (const [x, vx] of ent) for (const [y, vy] of ent) W[x][y] += w * vx * vy;
        const dent = [...drow]; for (const [x, vx] of dent) for (const [y, vy] of dent) W[x][y] += w * GRAM_ELL_M * GRAM_ELL_M * vx * vy;
      }
    });
    const L = Array.from({ length: n }, () => new Float64Array(n));   // W = LLᵀ: W is symmetric positive definite (a Gram matrix plus GRAM_EPS·I)
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = W[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (!(s > 0)) throw new D.CoreError('CLOSE_SINGULAR', 'close: the window\'s metric is not positive definite'); L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
    }
    blocks.push({ ks, L, n });
  }
  return (row) => {
    const out = new Float64Array(N);
    for (const { ks, L, n } of blocks) {
      const y = new Float64Array(n); for (let i = 0; i < n; i++) { let s = row[ks[i]]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
      for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * out[ks[k]]; out[ks[i]] = s / L[i][i]; }
    }
    return out;
  };
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
function netRows(doc, { cache = null } = {}) {
  const out = { kh: new Map(), kv: new Map(), kvBase: 0, khBase: 0 };
  const segs = toSegments(doc, { cache }), byId = new Map(doc.pieces.map((P, p) => [P.id, p]));
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
const valueChannels = (sm) => ['kh', 'kv', 'w', 'r', ...(sm.cupBoth ? ['c'] : []), ...(sm.edgeBoth ? ['e', 's', 'er'] : []), ...(sm.tubeBoth ? ['t'] : [])];
// D343: a document is immutable (frozen, src/core/document.js), so its residual is computed once and remembered: one press asked it of the same open track four
// times (finish.js isNear, its gap, and twice inside finishToStart), each building the whole path again (about 2 s apiece on a 25 km track). The remembered
// answer is frozen, so no reader can change what the next one gets. A document that is not frozen is computed every time, as before.
const residualMemo = new WeakMap();
function residual(doc, opts = {}) {
  if (!Object.isFrozen(doc)) return residualOf(doc, opts);
  let v = residualMemo.get(doc);
  if (!v) { v = residualOf(doc, opts); Object.freeze(v.r); Object.freeze(v.names); Object.freeze(v); residualMemo.set(doc, v); }
  return v;
}
function residualOf(doc, { cache = null, c2Pairs = [], c2Channels = CN.C2_CHANNELS } = {}) {
  if (!doc.pieces.some((P) => P.type === 'road')) throw new D.CoreError('EMPTY', 'close: no road to close');
  const S = toPath({ ...doc, closed: false }, { cache }).path.samples, a = S[0], z = S[S.length - 1];
  const road = doc.pieces.filter((P) => P.type === 'road'), F = road[0], L = road[road.length - 1];
  const rows = netRows(doc, { cache }), net = { kh: rows.khBase, kv: rows.kvBase };   // kvBase: a jump's landing pitch, when the lap has one (D243); khBase: the jumps' heading turns (D258)
  for (const ch of ['kh', 'kv']) for (const [key, w] of rows[ch]) { const [p, i] = key.split(':').map(Number); net[ch] += w * doc.pieces[p].channels[ch][i]; }
  // THE FLIPPED FRAME (2026-10-14, ELYSIUM: the end met the start to 18 cm and 0.57°, and Close refused, setting out to roll it 180°). Over the top of a loop
  // the frame is carried as (heading + π, π − pitch, bank + π): the same orientation, written the other way. When the net pitch is nearer π than 0, the seam
  // is measured in that form, so the target is the orientation and not the numbers: heading − π, π − pitch, bank − π (each to the nearest whole turn).
  // `flip` tells the solver the pitch row's sign is reversed (its derivative is minus the net pitch's)
  const flip = Math.cos(net.kv) < 0, half = flip ? Math.PI : 0;
  const turns = Math.round((net.kh - half) / TAU), bank = L.channels.phi.at(-1) - F.channels.phi[0], m = Math.round((bank - half) / TAU);
  const pitch = flip ? Math.PI - net.kv : net.kv, pTurns = Math.round(pitch / TAU);
  const r = [z.pos[0] - a.pos[0], z.pos[1] - a.pos[1], z.pos[2] - a.pos[2], net.kh - half - TAU * turns, pitch - TAU * pTurns, bank - half - TAU * m];
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
  // D459 3c: the C2 channels' curvature round the seam, and across every joint the close moves (c2Pairs: the pairs of consecutive road pieces close() names)
  for (const ch of c2Channels) { if (!seamJoined(ch, sm) || (ch === 'c' && held)) continue; r.push(CN.endDerivatives(L, ch).end.k - CN.endDerivatives(F, ch).start.k); names.push(`${ch} curvature at the seam`); }
  for (const [a, b, ch] of c2Pairs) { const A = doc.pieces[a], B = doc.pieces[b]; r.push(CN.endDerivatives(A, ch).end.k - CN.endDerivatives(B, ch).start.k); names.push(`${ch} curvature at ${A.id}|${B.id}`); }   // the end's less the start's, as curvRow's coefficients are
  return { r, names, turns, flip, gapM: Math.hypot(r[0], r[1], r[2]), tangentRad: Math.acos(Math.max(-1, Math.min(1, a.T[0] * z.T[0] + a.T[1] * z.T[1] + a.T[2] * z.T[2]))), pathEnd: z, pathStart: a };
}

/**
 * Close the lap, in one call. Options: edited (the piece INDICES of the stretch edited last; default the last road piece), wEdit
 * (default 1e6), tolM (default 1e-3 m), maxIter (default 30). Returns { doc (closed: true, checked, frozen; the input untouched),
 * converged, iterations, residual: every row by name, report }. A close that does not converge SAYS so (converged false,
 * report "NOT CLOSED …"), and still returns its best document with closed false, so nothing silently claims a closure.
 */
function close(doc, opts = {}) {
  // D469 (P; C's D467 review §5): THE CUP'S CURVATURE ROWS RESPECT c ≥ 0. Where the seam's cup row (3c) meets a flat cup at p1 against a fade that ends C1 on the
  // other side (TEST 10's p23: 15 15 0 0, laid before D459), the least-norm step bends p1's cup BELOW 0 to match the curvature (−2.0° on TEST 10), and the document
  // refuses the step as it is measured (residualOf → toPath → checkDoc: BAD_CUP). The cup cannot go below 0, so the row is left out and the cup stays C1 at the
  // seam, the way cupHome falls back to its straight fade where the quintic would be too fast; the other channels keep their rows, and the report says so. Once:
  // the second pass has no cup row to drop, and whatever it refuses is the close's own
  const c2Asked = opts.c2Channels === undefined ? CN.C2_CHANNELS : opts.c2Channels;
  if (!opts.cupRowLeftOut && c2Asked.includes('c')) {
    try { return closeOnce(doc, opts); } catch (e) {
      if (e instanceof D.CoreError && e.code === 'BAD_CUP') return closeOnce(doc, { ...opts, c2Channels: c2Asked.filter((ch) => ch !== 'c'), cupRowLeftOut: true });
      throw e;
    }
  }
  return closeOnce(doc, opts);
}
function closeOnce(doc, opts = {}) {
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
  // D459 3c: the channels whose curvature the closure carries round the seam and across the joints it moves. Every one by default (the Close button's bends, the
  // sweep). Finish passes fewer: its bank plan owns the bank at its own joints (D447: C1, bounded by BANK_ACCEL) and cupHome owns the cup's fade (3b)
  const c2Channels = opts.c2Channels === undefined ? CN.C2_CHANNELS : opts.c2Channels;
  const { cols, expand } = parameters(doc, edited, free), N = cols.length, winv = cols.map((c) => (c.fixed ? 0 : c.edited ? 1 / wEdit : 1));
  const keep = local ? keptPieces(doc, expand, cols) : null;   // the pieces no free column reaches: returned as the very same objects
  const winvRow = local ? gramMetric(doc, expand, cols) : null;   // D431: a windowed close takes the smallest change to the road (gramMetric); the whole lap keeps the plain metric
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
    else if (which === 'slope') { const a = 3 / hEnd(doc.pieces[L]), b = 3 / hStart(doc.pieces[F]); put(L, nL - 1, a); put(L, nL - 2, -a); put(F, 1, -b); put(F, 0, b); }
    else curvRow(ch, L, F, row);
    return row; };
  // D459 3c: the curvature row across a joint A|B (A's end against B's start), from the closed forms of continuity.js: k(L) = 6/h₁·[(Pₙ₋₁ − Pₙ₋₂)/h₁ − (Pₙ₋₂ − Pₙ₋₃)/h₂] with
  // h₁ the last span and h₂ the last two spans; k(0) = 6/g₁·[(P₂ − P₁)/g₂ − (P₁ − P₀)/g₁] with g₁ the first span and g₂ the first two
  const curvRow = (ch, A, B, row) => { const put = (p, i, s) => { for (const [c, coef] of expand[ch][p][i]) row[c] += s * coef; };
    const PA = doc.pieces[A], UA = D.knotVector(PA), nA = PA.channels[ch].length, h1 = PA.length - UA[nA - 1], h2 = PA.length - UA[nA - 2];
    const PB = doc.pieces[B], UB = D.knotVector(PB), g1 = UB[4], g2 = UB[5];
    put(A, nA - 1, 6 / (h1 * h1)); put(A, nA - 2, -6 / (h1 * h1) - 6 / (h1 * h2)); put(A, nA - 3, 6 / (h1 * h2));
    put(B, 2, -6 / (g1 * g2)); put(B, 1, 6 / (g1 * g2) + 6 / (g1 * g1)); put(B, 0, -6 / (g1 * g1)); };
  // the joints the close MOVES (a free column on either side of the joint in that channel): their curvature rows, so a lap stays C2 where the words made it so
  const c2Pairs = [];
  for (let b = 1; b < doc.pieces.length; b++) { const a = b - 1, A = doc.pieces[a], B = doc.pieces[b]; if (A.type !== 'road' || B.type !== 'road') continue;
    for (const ch of c2Channels) { if (!expand[ch] || !linkable(ch, A, B)) continue; const nA = A.channels[ch].length;
      const touched = [[a, nA - 1], [a, nA - 2], [a, nA - 3], [b, 2]].some(([p, i]) => expand[ch][p][i].some(([c]) => !cols[c].fixed)); if (touched) c2Pairs.push([a, b, ch]); } }

  // ONE SEGMENT CACHE FOR THE WHOLE CLOSE (2026-10-14, Finish to start on ELYSIUM: each step converted all 43 pieces again, twice, ~4 s of a step's ~4.4 s,
  // 234 s for one close). A step changes only the pieces it may move; every other piece is the same object and its segments are toSegments' cached ones,
  // which equal the uncached exactly (src/core/adapter.js, test/core_segcache.test.js)
  const cache = new WeakMap();
  let work = apply(doc, expand, x, false, keep), m = residual(work, { cache, c2Pairs, c2Channels }), it = 0;
  for (; it < maxIter && !done(m); it++) {
    const Jp = positionJacobian(work), nr = netRows(work, { cache }), J = [];
    for (let k = 0; k < 3; k++) { const row = new Float64Array(N); toCols('kh', Jp.kh, row, k); toCols('kv', Jp.kv, row, k); J.push(row); }
    for (const ch of ['kh', 'kv']) { const row = new Float64Array(N); toCols(ch, nr[ch], row); if (ch === 'kv' && m.flip) row.forEach((v, k) => { row[k] = -v; }); J.push(row); }   // the flipped frame: the pitch row is π − pitch
    J.push(valueRow('phi', 'value'));
    for (const ch of valueChannels(seamOf(doc))) J.push(valueRow(ch, 'value'));
    if (held) { const row = new Float64Array(N), Pi = held.end === 'last' ? roadIdx[roadIdx.length - 1] : roadIdx[0], ii = held.end === 'last' ? doc.pieces[Pi].channels.c.length - 1 : 0; for (const [c, coef] of expand.c[Pi][ii]) row[c] += coef; J.push(row); }
    for (const ch of D.CHANNELS) { if (!seamJoined(ch, seamOf(doc))) continue; J.push(valueRow(ch, 'slope')); }
    for (const ch of c2Channels) { if (!seamJoined(ch, seamOf(doc)) || (ch === 'c' && held)) continue; J.push(valueRow(ch, 'curv')); }   // D459 3c: the seam's curvature rows
    for (const [a, b, ch] of c2Pairs) { const row = new Float64Array(N); curvRow(ch, a, b, row); J.push(row); }   // and the moved joints'
    // δ = −W⁻¹Jᵀ(JW⁻¹Jᵀ)⁻¹ r (ref 04 §3); W diagonal (winv) for the whole lap, the window's Gram metric for a windowed close (D431)
    const WJ = J.map((row) => (winvRow ? winvRow(row) : row.map((v, k) => winv[k] * v)));
    const M = J.map((a) => WJ.map((b) => { let s = 0; for (let k = 0; k < N; k++) s += a[k] * b[k]; return s; }));
    const y = solve(M, m.r.map((v) => -v)), delta = new Float64Array(N);
    WJ.forEach((row, i) => { for (let k = 0; k < N; k++) delta[k] += row[k] * y[i]; });
    let alpha = 1, xn, wn, mn;                                  // halve the step while it makes things worse (E's rule, not a formula)
    for (let hh = 0; hh < 12; hh++, alpha /= 2) { xn = x.map((v, k) => v + alpha * delta[k]); wn = apply(doc, expand, xn, false, keep); mn = residual(wn, { cache, c2Pairs, c2Channels }); if (merit(mn) < merit(m)) break; }
    x = xn; work = wn; m = mn;
  }
  // what is STORED is quantised (README): measure the quantised document, and report that
  // converged: the closed path's own bar (src/geom/path.js closeTol 1e-3 m): a stored gap past it was reported closed (it was 0.01) and then could not be built (2026-10-14, 1.65 mm on ELYSIUM)
  const stored = apply(doc, expand, x, true, keep), ms = residual(stored, { cache, c2Pairs, c2Channels }), converged = done(m) && ms.gapM < 1e-3;
  const cupNote = opts.cupRowLeftOut ? "; the cup's curvature row at the seam was left out (it would have taken the cup below 0), so the cup is C1 there" : '';
  // D242: a local close that does not close is a REFUSAL by name, never a best try handed back: the window could not do it, and nothing outside it may help
  if (local && !converged) throw refuse(`it gets no closer than ${ms.gapM.toFixed(3)} m (tangent ${ms.tangentRad.toExponential(1)} rad) in ${it} step(s)`);
  let out;
  try { out = freeze(D.checkDoc({ ...stored, closed: converged })); } catch (e) {
    if (local && e.name === 'CoreError') throw refuse(`the closed track would break a limit of the document (${e.code}: ${e.message})`);
    throw e;
  }
  if (local) {   // the roll-rate bar (src/validate: 20 m chord), read in the window only: a close may not push the window past it (a red that was already there elsewhere is not the close's)
    const V = require('../validate/index.js');
    const rollIn = (d, closed) => { const { path } = toPath({ ...d, closed }, { cache }); let mx = 0; for (const q of V._internal.rollRates(path.samples, () => true, closed, path.lengthM)) if (q.s >= win.fromS - 1e-9) mx = Math.max(mx, q.rate); return mx; };
    const after = rollIn(out, true);
    if (after > V.ROLL_RED_DEG_M) { const before = rollIn(doc, false); if (after > before + 1e-9) throw refuse(`the road would roll too fast there: ${after.toFixed(3)}°/m over 20 m, past the ${V.ROLL_RED_DEG_M}°/m bar (it was ${before.toFixed(3)}°/m)`); }
  }
  if (held && converged) {   // never converged over a step: the seam's curve, measured on the segments the lap will be drawn from
    const lap = jointSteps(toSegments({ ...out, closed: true }, { cache }), true).find((x) => x.lap);
    if (lap && lap.m > SEAM_MAX_M) throw new D.CoreError('CUP_SEAM', `close: the lap seam would step ${(lap.m * 1000).toFixed(2)} mm (more than ${SEAM_MAX_M * 1000} mm) between the cup and the legacy piece at the start: the closing piece is too short to fade one into the other; lengthen it`);
  }
  // a seam between a cup piece and a legacy one is not solved (the cup would have to move to a rendered edge): its step is reported
  const endE = D.pieceEnd(stored.pieces[roadIdx[roadIdx.length - 1]]).c.v, startP = stored.pieces[roadIdx[0]];
  const cupSeamStepDeg = cupBoth || !(startP.cup || stored.pieces[roadIdx[roadIdx.length - 1]].cup) ? 0 : Math.abs(endE - (startP.cup ? startP.channels.c[0] : D.legacyEdgeDeg(startP.family, startP.channels.w[0], startP.channels.r[0])));
  return { doc: out, converged, iterations: it, turns: ms.turns, gapM: ms.gapM, tangentRad: ms.tangentRad, cupSeamStepDeg,
    window: win ? { pieces: [...win.set].sort((a, b) => a - b), ids: win.ids, fromS: win.fromS, lengthM: win.lengthM, text: win.text } : null,
    residual: Object.fromEntries(ms.names.map((n, i) => [n, ms.r[i]])),
    report: converged ? `closed in ${it} step(s): ${(ms.gapM * 1000).toFixed(3)} mm, tangent ${ms.tangentRad.toExponential(1)} rad${cupNote}${cupSeamStepDeg > D.CUP_JOINT_DEG ? `; the cup steps ${cupSeamStepDeg.toFixed(2)}° at the seam (a cup meets a legacy piece there)` : ''}`
      : `NOT CLOSED after ${it} step(s): ${ms.gapM.toFixed(4)} m, tangent ${ms.tangentRad.toExponential(1)} rad` };
}

/**
 * D242, THE LOCAL CLOSE's window (the user, TEST 1: "completing the loop altered the rest of the track equation": the whole-lap close moved
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
 * (the whole lap, kept for when the user asks for it). Returns piece indices.
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
