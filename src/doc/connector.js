// connector.js: close the loop (ARCHITECTURE §2 :50-51: "a connector solved from the end conditions (G1/G2 clothoid
// fitting). Candidates are ranked by their worst physics margin, not shortest length"; the design ruling
// 2026-09-27: the connector belongs to the document layer).
//
//   closeLoop(doc, opts) -> { candidates: [{ doc, words, R, winding, margin, maxG, red, closure, lengthM }], reason, opts }
//   marginOf(closedDoc, opts) -> { margin, maxG, red }     over s ≥ opts.connectorFromS (a candidate's `fromS`)
//
// A CANDIDATE is three ordinary words appended at the head, so it is undoable like any edit: a turn, a straight and a
// turn (the plan shape of a Dubins path), each with clothoid ease-in and ease-out. The candidate doc comes back marked
// `closed: true`.
// - HEADING AND PITCH CLOSE EXACTLY. The last turn is the exact complement of every turn before it, in quanta (360° is
//   a whole number of 0.00001° quanta), and the last climb the exact complement of the pitch. So tangent closure is exact
//   up to floating point.
// - POSITION CLOSES by Newton on (first turn, straight length, first climb). Each step is integrated the way the
//   geometry integrates (src/geom/path.js: heading and pitch turning at k and kp, position = ∫T by 5-point Gauss–Legendre
//   on substeps ≤ 0.25 m), from the head's own frame, taken from the geometry.
// - G2: the connector opens from the head's curvature (resolve does that), and closes to 0, which is where every
//   document's first word opens from. `closure.g2` reports whether the seam is curvature-continuous; it is not when the
//   first word has easeIn 0.
// RANKING calls validation (src/validate/index.js, unedited): each candidate's closed loop is built by the geometry and
// validated at one design speed. Candidates with red on the connector go last; the rest are ordered by their worst margin
// against the proven load (provenG − the largest specific force on the connector, in g), largest first.
// NO CANDIDATE is an answer, not an error: `reason` says what failed (no convergence, a climb over the limit, the
// geometry refusing the closure). Nothing is ever faked closed.
'use strict';

const { DEG, WORDS } = require('./vocab.js');
const { DocError, checkDoc } = require('./serial.js');
const { appendWord } = require('./document.js');
const { resolve, resolveFrom } = require('./resolve.js');
const { buildPath } = require('../geom/index.js');
const { validate } = require('../validate/index.js');
const { MACH6 } = require('../validate/limits.js');

const QDEG = 1e-5 * DEG;                 // the angle quantum (serial.js)
const TURN_Q = 36e6;                     // 360° in quanta
const qa = (rad) => Math.round(rad / QDEG), ra = (q) => q * QDEG;
const DEFAULTS = { radii: [60, 120, 250, 500, 1000], ease: 0.3, maxClimbDeg: 30, speedKmh: 300, step: 1, tol: 1e-4 };
// 300 km/h: the platform test's design speed (the middle of its jump band), inferred as a fair speed to compare
// connectors at; any caller can pass its own.

const tangent = (th, p) => [Math.cos(p) * Math.sin(th), Math.sin(p), Math.cos(p) * Math.cos(th)];
const GL5 = [[-0.906179845938664, 0.2369268850561891], [-0.5384693101056831, 0.4786286704993665], [0, 0.5688888888888889],
  [0.5384693101056831, 0.4786286704993665], [0.906179845938664, 0.2369268850561891]];

/** Integrate segments from a heartline point, heading and pitch, as the geometry does. */
function integrate(segs, x0, th0, p0) {
  let x = x0.slice(), th = th0, p = p0;
  for (const g of segs) {
    const L = g.length, n = Math.max(1, Math.ceil(L / 0.25)), h = L / n;
    const at = (s) => [th + g.k0 * s + ((g.k1 - g.k0) * s * s) / (2 * L), p + g.kp0 * s + ((g.kp1 - g.kp0) * s * s) / (2 * L)];
    for (let i = 0; i < n; i++) for (const [z, w] of GL5) {
      const s = (i + 0.5 + z / 2) * h, [a, b] = at(s), t = tangent(a, b);
      for (let j = 0; j < 3; j++) x[j] += w * (h / 2) * t[j];
    }
    [th, p] = at(L);
  }
  return { x, th, p };
}

/** The word a connector piece is named, by the track reader's radius bands (vocab.js). */
const nameFor = (R) => (R > 1500 ? 'sweep' : R >= 500 ? 'sweep' : R >= 180 ? 'turn' : 'tight');

function lastRoad(doc) {
  for (let i = doc.words.length - 1; i >= 0; i--) {
    const e = doc.words[i], ws = e.phrase !== undefined ? e.words : [e];
    for (let j = ws.length - 1; j >= 0; j--) if (ws[j].word !== 'jump') return ws[j];
  }
  return null;
}
function firstRoad(doc) {
  for (const e of doc.words) for (const w of e.phrase !== undefined ? e.words : [e]) if (w.word !== 'jump') return w;
  return null;
}

/** The three connector words for parameters (θ1 quanta, L2 m, c1 quanta), from the head state. */
function connectorWords(doc, P, st, x) {
  const [q1, L2, c1q] = x;
  const q3 = P.turnTotalQ - q1, c3q = P.climbTotalQ - c1q, e = P.ease;
  const turnLen = (q) => Math.max(1, (Math.abs(ra(q)) * P.R) / (1 - e));
  const base = (dir) => ({ tempo: 'standard', font: P.font, dir, handles: { easeIn: e, easeOut: e, heartline: P.heart, width: P.width, wall: P.wall } });
  let d = doc;
  const add = (word, dir, h) => { const o = base(dir); d = appendWord(d, word, { ...o, handles: { ...o.handles, ...h } }); };
  add(nameFor(P.R), q1 >= 0 ? 'L' : 'R', { length: turnLen(q1), turn: ra(q1), climb: ra(c1q), roll0: st.roll, roll1: st.roll });
  add('straight', 'L', { length: L2, turn: 0, climb: 0, roll0: st.roll, roll1: P.rollTarget });
  add(nameFor(P.R), q3 >= 0 ? 'L' : 'R', { length: turnLen(q3), turn: ra(q3), climb: ra(c3q), roll0: P.rollTarget, roll1: P.rollTarget });
  return d;
}

const INFEASIBLE = { F: [Infinity, Infinity, Infinity] };
/** The end-point miss for parameters x. A step outside the handles' ranges is infeasible, not an error. */
function residual(doc, prev, P, st, x) {
  let d, r;
  try { d = connectorWords(doc, P, st, x); r = resolveFrom(prev, d); } catch (e) { if (e.name === 'DocError' || e.name === 'ResolveError') return INFEASIBLE; throw e; }
  const segs = r.segments.slice(prev.segments.length);
  const end = integrate(segs, P.headX, P.headTh, P.headP);
  return { d, F: end.x, end };
}

function solve3(J, F) {   // Gaussian elimination with partial pivoting, 3×3
  const A = J.map((row, i) => [...row, -F[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (!(Math.abs(A[p][c]) > 1e-300)) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((row, i) => row[3] / A[i][i]);
}

function newton(doc, prev, P, st, x0) {
  const norm = (v) => Math.hypot(v[0], v[1], v[2]);
  const snap = (x) => [Math.round(x[0]), Math.max(1, Math.round(x[1] * 1e4) / 1e4), Math.round(x[2])];
  let x = snap(x0), cur = residual(doc, prev, P, st, x);
  if (!Number.isFinite(norm(cur.F))) return null;
  const H = [qa(1e-3), 1e-2, qa(1e-3)];
  for (let it = 0; it < 40 && norm(cur.F) > P.tol; it++) {
    if (it === 15 && norm(cur.F) > 1) return null;   // not converging: give the start up rather than spend it
    const J = [[], [], []];
    for (let k = 0; k < 3; k++) {
      const xp = x.slice(); xp[k] += H[k];
      const Fp = residual(doc, prev, P, st, xp).F;
      if (!Number.isFinite(Fp[0])) return null;
      for (let i = 0; i < 3; i++) J[i][k] = (Fp[i] - cur.F[i]) / H[k];
    }
    const dx = solve3(J, cur.F); if (!dx) return null;
    let lam = 1, next = null;
    for (let b = 0; b < 12; b++) {
      const xt = snap([x[0] + lam * dx[0], x[1] + lam * dx[1], x[2] + lam * dx[2]]);
      const rt = residual(doc, prev, P, st, xt);
      if (norm(rt.F) < norm(cur.F)) { next = { x: xt, r: rt }; break; }
      lam /= 2;
    }
    if (!next) break;
    x = next.x; cur = next.r;
  }
  // polish on the quantum grid: the answer is a document, and a document holds quanta
  for (let pass = 0; pass < 3 && norm(cur.F) > P.tol; pass++) {
    let best = { x, r: cur };
    for (const d0 of [-1, 0, 1]) for (const d1 of [-1e-4, 0, 1e-4]) for (const d2 of [-1, 0, 1]) {
      const xt = [x[0] + d0, Math.max(1, x[1] + d1), x[2] + d2], rt = residual(doc, prev, P, st, xt);
      if (norm(rt.F) < norm(best.r.F)) best = { x: xt, r: rt };
    }
    x = best.x; cur = best.r;
  }
  return { x, r: cur, closed: norm(cur.F) };
}

/** Validation's worst margin on the connector of a closed candidate: provenG − the largest specific force, and red count. */
function marginOf(closedDoc, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const open = { ...closedDoc, closed: false };
  const all = resolve(open).segments, v = (o.speedKmh / 3.6);
  const segs = all.map((g) => ({ ...g, speed: v }));
  const path = buildPath(segs, { step: o.step, closed: true });
  const s0 = o.connectorFromS === undefined ? 0 : o.connectorFromS;
  const res = validate(path, segs, o.validateOpts || {});
  let maxG = 0;
  for (const l of res.lines) if (l.s >= s0 - 1e-9 && Number.isFinite(l.f_g)) maxG = Math.max(maxG, l.f_g);
  const red = res.red.filter((r) => (r.s1 === undefined ? r.s : r.s1) >= s0 - 1e-9).length;
  return { margin: MACH6.provenG - maxG, maxG, red };
}

function closeLoop(doc, opts = {}) {
  checkDoc(doc);
  const o = { ...DEFAULTS, ...opts };
  if (doc.closed) throw new DocError('ALREADY_CLOSED', 'the loop is already closed');
  if (doc.words.length === 0) throw new DocError('EMPTY_DOC', 'there is no track to close');
  const head = lastRoad(doc), first = firstRoad(doc);
  if (!head) throw new DocError('EMPTY_DOC', 'there is no road to close from');
  const prev = resolve(doc), segs = prev.segments;
  const path = buildPath(segs, { step: o.step }), lastS = path.samples[path.samples.length - 1];
  const heart = head.handles.heartline;
  if (Math.abs(first.handles.heartline - heart) > 1e-9) return { candidates: [], reason: 'no connector: the first and last words have different heartlines, and a heartline cannot ramp', opts: o };
  const turnSumQ = segs.reduce((a, g) => a + ((g.k0 + g.k1) / 2) * g.length, 0);
  const st = { roll: prev.head.roll };
  const r0 = first.handles.roll0, rollTarget = r0 + 2 * Math.PI * Math.round((st.roll - r0) / (2 * Math.PI));
  const base = {
    font: head.font, width: head.handles.width, wall: head.handles.wall, heart, ease: o.ease, tol: o.tol, rollTarget,
    headX: lastS.pos.map((x, j) => x + heart * lastS.U[j]), headTh: turnSumQ, headP: prev.head.pitch,
    climbTotalQ: -qa(prev.head.pitch),
  };
  const thQ = qa(turnSumQ), m0 = Math.round(thQ / TURN_Q);
  const dist = Math.hypot(base.headX[0], base.headX[2]);
  const tries = { total: 0, converged: 0, climb: 0, noConverge: 0, geometry: 0 }, found = new Map();
  for (const R of o.radii) for (const m of [m0, m0 - 1, m0 + 1]) {
    const P = { ...base, R, turnTotalQ: m * TURN_Q - thQ };
    for (const extra of [0, TURN_Q / 4, -TURN_Q / 4]) {
      const f = 0.5;
      tries.total++;
      const q1 = Math.round(P.turnTotalQ * f + extra);
      const sol = newton(doc, prev, P, st, [q1, Math.max(1, dist), Math.round(P.climbTotalQ / 2)]);
      if (!sol || !(sol.closed <= 5 * o.tol)) { tries.noConverge++; continue; }
      tries.converged++;
      const [x1, L2, c1q] = sol.x, c3q = P.climbTotalQ - c1q, lim = qa(o.maxClimbDeg * DEG);
      if (Math.abs(c1q) > lim || Math.abs(c3q) > lim) { tries.climb++; tries.worstClimbDeg = Math.max(tries.worstClimbDeg || 0, Math.abs(ra(c1q)) / DEG, Math.abs(ra(c3q)) / DEG); continue; }
      const key = `${R}|${m}|${Math.round(x1 / 1e3)}|${Math.round(L2 * 10)}`;
      if (found.has(key)) continue;
      const closedDoc = checkDoc({ ...sol.r.d, closed: true });
      let mg;
      try { mg = marginOf(closedDoc, { ...o, connectorFromS: path.lengthM }); } catch (e) { tries.geometry++; tries.geometryWhy = e.message; continue; }
      const T = tangent(sol.r.end.th, sol.r.end.p);
      const all = resolve({ ...closedDoc, closed: false }).segments, lastSeg = all[all.length - 1], firstSeg = all[0];
      found.set(key, {
        doc: Object.freeze(closedDoc), words: closedDoc.words.slice(doc.words.length), R, winding: m,
        margin: mg.margin, maxG: mg.maxG, red: mg.red, fromS: path.lengthM,   // the margin covers the connector, from the old head on
        closure: { position: sol.closed, tangent: Math.hypot(T[0], T[1], T[2] - 1), g2: Math.abs(lastSeg.k1 - firstSeg.k0) < 1e-12 && Math.abs(lastSeg.kp1 - firstSeg.kp0) < 1e-12 },
        lengthM: all.reduce((a, g) => a + g.length, 0) - path.lengthM, key,
      });
    }
  }
  const candidates = [...found.values()].sort((a, b) => a.red - b.red || b.margin - a.margin || a.lengthM - b.lengthM || (a.key < b.key ? -1 : 1));
  let reason = null;
  if (!candidates.length) {
    const bits = [`${tries.total} starts`, `${tries.noConverge} did not converge`];
    if (tries.climb) bits.push(`${tries.climb} converged but needed a climb of up to ${tries.worstClimbDeg.toFixed(1)}° against the ${o.maxClimbDeg}° limit`);
    if (tries.geometry) bits.push(`${tries.geometry} were refused by the geometry (${tries.geometryWhy})`);
    reason = `no connector closes this loop within the limits: ${bits.join('; ')}`;
  }
  return { candidates, reason, opts: o };
}

module.exports = { closeLoop, marginOf, integrate, DEFAULTS };
