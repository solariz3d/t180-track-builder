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

const TAU = 2 * Math.PI;
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
function parameters(doc, edited) {
  const cols = [], expand = {};
  for (const ch of D.CHANNELS) {
    expand[ch] = doc.pieces.map(() => null);
    let prev = -1;
    doc.pieces.forEach((P, p) => {
      if (P.type !== 'road') return;
      const n = P.channels[ch].length, e = new Array(n);
      for (let i = 0; i < n; i++) {
        if (prev >= 0 && i < 2) {
          const A = expand[ch][prev], na = A.length, rho = hStart(P) / hEnd(doc.pieces[prev]);
          e[i] = i === 0 ? A[na - 1] : [...A[na - 1].map(([c, k]) => [c, k * (1 + rho)]), ...A[na - 2].map(([c, k]) => [c, -k * rho])];
          if (edited.has(p)) for (const [c] of e[i]) cols[c].edited = true;
          continue;
        }
        e[i] = [[cols.length, 1]]; cols.push({ ch, p, i, edited: edited.has(p) });
      }
      expand[ch][p] = e; prev = p;
    });
  }
  return { cols, expand };
}
/** The document with every channel rebuilt from the parameter vector x (joints follow; nothing quantised). */
function apply(doc, expand, x, quantise) {
  return { ...doc, pieces: doc.pieces.map((P, p) => {
    if (P.type !== 'road') return P;
    const channels = {};
    for (const ch of D.CHANNELS) channels[ch] = expand[ch][p].map((terms) => { const v = terms.reduce((s, [c, k]) => s + k * x[c], 0); return quantise ? q(v, D.DEC[ch]) : v; });
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
  const out = { kh: new Map(), kv: new Map() };
  const segs = toSegments(doc), byId = new Map(doc.pieces.map((P, p) => [P.id, p]));
  let s = new Map();
  for (const g of segs) {
    if (g.part !== 'body') continue;
    const p = byId.get(g.id), P = doc.pieces[p], U = D.knotVector(P), s0 = s.get(p) || 0, s1 = s0 + g.length; s.set(p, s1);
    for (const x of [s0, s1]) {
      const b = basis(U, Math.min(x, P.length));
      for (const ch of ['kh', 'kv']) for (let a = 0; a < 4; a++) { const key = `${p}:${b.first + a}`; out[ch].set(key, (out[ch].get(key) || 0) + 0.5 * g.length * b.N[a]); }
    }
  }
  return out;
}

/** The residual, measured on the adapter's path and the document itself (ref 10 §3). */
function residual(doc) {
  if (!doc.pieces.some((P) => P.type === 'road')) throw new D.CoreError('EMPTY', 'close: no road to close');
  const S = toPath({ ...doc, closed: false }).path.samples, a = S[0], z = S[S.length - 1];
  const road = doc.pieces.filter((P) => P.type === 'road'), F = road[0], L = road[road.length - 1];
  const net = { kh: 0, kv: 0 }; const rows = netRows(doc);
  for (const ch of ['kh', 'kv']) for (const [key, w] of rows[ch]) { const [p, i] = key.split(':').map(Number); net[ch] += w * doc.pieces[p].channels[ch][i]; }
  const turns = Math.round(net.kh / TAU), bank = L.channels.phi.at(-1) - F.channels.phi[0], m = Math.round(bank / TAU);
  const r = [z.pos[0] - a.pos[0], z.pos[1] - a.pos[1], z.pos[2] - a.pos[2], net.kh - TAU * turns, net.kv, bank - TAU * m];
  const names = ['x', 'y', 'z', 'net heading − 2πk', 'net pitch', 'bank at the seam'];
  for (const ch of ['kh', 'kv', 'w', 'r']) { r.push(L.channels[ch].at(-1) - F.channels[ch][0]); names.push(`${ch} value at the seam`); }
  for (const ch of D.CHANNELS) {
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
  D.checkDoc(doc);
  if (doc.pieces.some((P) => P.type === 'flight')) throw new D.CoreError('NOT_YET', 'close: a track with a jump is not closed by this version (the flight fixes a displacement the close would have to carry; not built)');
  const roadIdx = doc.pieces.map((P, i) => (P.type === 'road' ? i : -1)).filter((i) => i >= 0);
  const edited = new Set(opts.edited || [roadIdx[roadIdx.length - 1]]), wEdit = opts.wEdit || 1e6, tolM = opts.tolM || 1e-3, maxIter = opts.maxIter || 30;
  const { cols, expand } = parameters(doc, edited), N = cols.length, winv = cols.map((c) => (c.edited ? 1 / wEdit : 1));
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

  let work = apply(doc, expand, x, false), m = residual(work), it = 0;
  for (; it < maxIter && !done(m); it++) {
    const Jp = positionJacobian(work), nr = netRows(work), J = [];
    for (let k = 0; k < 3; k++) { const row = new Float64Array(N); toCols('kh', Jp.kh, row, k); toCols('kv', Jp.kv, row, k); J.push(row); }
    for (const ch of ['kh', 'kv']) { const row = new Float64Array(N); toCols(ch, nr[ch], row); J.push(row); }
    J.push(valueRow('phi', 'value'));
    for (const ch of ['kh', 'kv', 'w', 'r']) J.push(valueRow(ch, 'value'));
    for (const ch of D.CHANNELS) J.push(valueRow(ch, 'slope'));
    // δ = −W⁻¹Jᵀ(JW⁻¹Jᵀ)⁻¹ r (ref 04 §3)
    const M = J.map((a) => J.map((b) => { let s = 0; for (let k = 0; k < N; k++) s += a[k] * winv[k] * b[k]; return s; }));
    const y = denseSolve(M, m.r.map((v) => -v)), delta = new Float64Array(N);
    J.forEach((row, i) => { for (let k = 0; k < N; k++) delta[k] += winv[k] * row[k] * y[i]; });
    let alpha = 1, xn, wn, mn;                                  // halve the step while it makes things worse (E's rule, not a formula)
    for (let hh = 0; hh < 12; hh++, alpha /= 2) { xn = x.map((v, k) => v + alpha * delta[k]); wn = apply(doc, expand, xn, false); mn = residual(wn); if (merit(mn) < merit(m)) break; }
    x = xn; work = wn; m = mn;
  }
  // what is STORED is quantised (README): measure the quantised document, and report that
  const stored = apply(doc, expand, x, true), ms = residual(stored), converged = done(m) && ms.gapM < 0.01;
  const out = freeze(D.checkDoc({ ...stored, closed: converged }));
  return { doc: out, converged, iterations: it, turns: ms.turns, gapM: ms.gapM, tangentRad: ms.tangentRad,
    residual: Object.fromEntries(ms.names.map((n, i) => [n, ms.r[i]])),
    report: converged ? `closed in ${it} step(s): ${(ms.gapM * 1000).toFixed(3)} mm, tangent ${ms.tangentRad.toExponential(1)} rad`
      : `NOT CLOSED after ${it} step(s): ${ms.gapM.toFixed(4)} m, tangent ${ms.tangentRad.toExponential(1)} rad` };
}

module.exports = { close, residual, parameters, positionJacobian, netRows };
