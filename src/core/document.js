// document.js: the equation core's document (src/core/README.md is the shape). A track is a list of PIECES; a road piece
// holds one clamped cubic B-spline per CHANNEL in its own arc length (ref 03 §1): heading rate κh, pitch rate κv, bank φ,
// width w, the cross-section's rise rate r and (D190) the CUP c, the cross-section's edge angle. Every road joint is C1 in every channel (ref 09 §1), so the line is G2 by
// construction. A flight piece is a jump, solved as the old jump word is (src/doc/resolve.js solveJump).
//
//   createDoc(name, { start })                 an empty open track
//   roadPiece({ length, family, from, channels, knotM })   a piece whose channels START at `from` (the previous end state)
//   flightPiece({ gap, drop, land })
//   appendPiece(doc, piece) / endState(doc)    grow at the open end; the end value and slope of every channel
//   channelAt(piece, ch, s)                    { v, d1, d2 } of one channel
//   serialize(doc) / parse(text) / checkDoc(doc)
//   createHistory / commit / beginDrag / dragTo / endDrag / undo / redo
//
// "ref NN §k" is the skill's shelf, .claude/skills/track-equations/references/NN_*.md.
'use strict';

const { basis, bandChol } = require('../../tools/piecewise.cjs');

// core/2 (D186) adds the OFFSET channels h and l; a core/1 file is read and upgraded with both at zero (parse).
// core/3 (D190) adds the CUP channel c (degrees). A /1 or /2 road piece loads as a LEGACY piece: its cross-section is the old
// profileAt(family, w, r), unchanged, and nothing of c reaches its render. A piece is a CUP piece only when P.cup is true, which is
// written as a `c` array in its canonical text; a legacy piece's c is zeros in memory and absent in the text (src/core/README.md "the cup").
const SCHEMA = 't180b.core/3', OLD_SCHEMAS = Object.freeze(['t180b.core/1', 't180b.core/2']), GENERATOR = 't180-track-builder/core 0.3.0';
// kh, kv, phi, w, r shape the base geometry; h (height, m, along WORLD up) and l (lateral, m, along the gravity frame's
// horizontal left) are VALUE channels the adapter applies AFTER it (src/core/README.md "the offset channels")
const CHANNELS = Object.freeze(['kh', 'kv', 'phi', 'w', 'r', 'h', 'l', 'c']);
// c is the cross-section's edge angle ψ at u = ±w/2, in DEGREES, in [0, CUP_MAX]. 150: the bowl's two walls touch at 159.681° (the D190 seal, V2)
const CUP_MAX = 150, CUP_JOINT_DEG = 0.05, CUP_EPS = 1e-9;   // CUP_EPS: the float noise a solver leaves on a control point at a limit (close.js)
const OFFSETS = Object.freeze(['h', 'l']);
const FAMILIES = Object.freeze(['bowl', 'half-pipe', 'flat']);
// decimals each number is quantised to when it enters (src/core/README.md "numbers are quantised")
const DEC = Object.freeze({ m: 4, kh: 9, kv: 9, phi: 9, w: 4, r: 6, h: 4, l: 4, c: 6, rad: 9 });
const { FLOORS } = require('../geom/fonts.js');
const KNOT_M = 20;   // default interior knot spacing, m

class CoreError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'CoreError'; this.code = code; }
}
const q = (x, dec) => { if (!Number.isFinite(x)) throw new CoreError('NOT_FINITE', `a number is ${x}`); const v = Number(x.toFixed(dec)); return Object.is(v, -0) ? 0 : v; };
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };

/** The clamped knot vector of a piece (ref 03 §1). */
const knotVector = (P) => [0, 0, 0, 0, ...P.knots, P.length, P.length, P.length, P.length];
/** Evenly spaced interior knots, one span per ≤ knotM metres (at least one span). */
function evenKnots(L, knotM = KNOT_M) { const m = Math.max(1, Math.ceil(L / knotM - 1e-9)), out = []; for (let j = 1; j < m; j++) out.push((j * L) / m); return out; }

/** One channel of a road piece at s ∈ [0, length]: its value and first two derivatives (ref 03 §1, WIKI-BSPLINE). */
function channelAt(P, ch, s) {
  const c = P.channels[ch];
  if (c === undefined && ch === 'c' && !P.cup) return { v: 0, d1: 0, d2: 0 };   // a legacy piece may be built without a c array (its c is never rendered)
  const b = basis(knotVector(P), Math.min(Math.max(s, 0), P.length));
  let v = 0, d1 = 0, d2 = 0;
  for (let a = 0; a < 4; a++) { const x = c[b.first + a]; v += x * b.N[a]; d1 += x * b.D1[a]; d2 += x * b.D2[a]; }
  return { v, d1, d2 };
}
/**
 * The edge angle (degrees) the OLD profile renders at width w and rise rate r: the family's measured floor, each quarter's rise capped at
 * r·w/8 (ref 09 §3), the sum over the four quarters. Exactly adapter.js profileAt's arithmetic, for its last quarter (test: core_cup).
 */
function legacyEdgeDeg(family, w, r) {
  const F = FLOORS[family], quarter = w / 8; let prev = 0;
  F.forEach((target, i) => { prev += Math.min(target - (i ? F[i - 1] : 0), Math.max(0, r) * quarter); });
  return prev;
}
/** The end value and slope of every channel (ref 09 §1: c(L) = P_last, c′(L) = 3(P_last − P_prev)/(L − last interior knot)). A LEGACY piece's cup is the edge it renders (held, slope 0). */
function pieceEnd(P) {
  const h = P.length - (P.knots.length ? P.knots[P.knots.length - 1] : 0), out = {};
  for (const ch of CHANNELS) { const c = P.channels[ch]; if (c === undefined && ch === 'c' && !P.cup) continue; const n = c.length; out[ch] = { v: c[n - 1], m: (3 * (c[n - 1] - c[n - 2])) / h }; }
  if (!P.cup) out.c = { v: legacyEdgeDeg(P.family, out.w.v, out.r.v), m: 0 };
  return out;
}
/** The document with every legacy road piece that was built without a c array given zeros for it (the same object when none was). */
function fillCup(doc) {
  if (!doc.pieces.some((P) => P.type === 'road' && P.channels && P.channels.c === undefined && !P.cup)) return doc;
  return { ...doc, pieces: doc.pieces.map((P) => (P.type === 'road' && P.channels && P.channels.c === undefined && !P.cup ? { ...P, channels: { ...P.channels, c: new Array(P.knots.length + 4).fill(0) } } : P)) };
}
/** True when the last road piece is a cup piece (a piece extended after it is one too). */
function endIsCup(doc) { for (let i = doc.pieces.length - 1; i >= 0; i--) if (doc.pieces[i].type === 'road') return !!doc.pieces[i].cup; return false; }
/** The state a new road piece must start from: the last road piece's end; after a flight, level (κh = κv = 0) with the rest carried. */
function endState(doc) {
  let flightAfter = false;
  for (let i = doc.pieces.length - 1; i >= 0; i--) {
    const P = doc.pieces[i];
    if (P.type === 'flight') { flightAfter = true; continue; }
    const e = pieceEnd(P);
    return flightAfter ? { ...e, kh: { v: 0, m: 0 }, kv: { v: 0, m: 0 }, h: { v: 0, m: 0 }, l: { v: 0, m: 0 } } : e;
  }
  return null;   // an empty track: the first piece starts where its channels say
}

/**
 * Fit one channel's control points to a function f(s) on [0, L] by least squares (ref 03 §2), with P0 and P1 HELD so the
 * channel starts at value v and slope m (ref 09 §1) when `start` is given. Banded normal equations, solved by the
 * repository's banded Cholesky (tools/piecewise.cjs). Samples: 8 per span and both ends.
 */
function fitChannel(f, L, knots, start) {
  const U = [0, 0, 0, 0, ...knots, L, L, L, L], n = knots.length + 4, spans = [0, ...knots, L];
  const ss = []; for (let j = 0; j + 1 < spans.length; j++) for (let k = 0; k < 8; k++) ss.push(spans[j] + ((spans[j + 1] - spans[j]) * k) / 8); ss.push(L);
  const held = start ? 2 : 0, P = new Array(n).fill(0);
  if (start) { P[0] = start.v; P[1] = start.v + (start.m * (knots.length ? knots[0] : L)) / 3; }
  const m = n - held;
  if (m === 0) return P;
  const B = Array.from({ length: m }, () => new Float64Array(4)), rhs = new Float64Array(m);
  for (const s of ss) {
    const b = basis(U, s); let y = f(s);
    for (let a = 0; a < 4; a++) { const i = b.first + a; if (i < held) y -= P[i] * b.N[a]; }
    for (let a = 0; a < 4; a++) {
      const i = b.first + a - held; if (i < 0) continue;
      rhs[i] += b.N[a] * y;
      for (let c = 0; c <= a; c++) { const j = b.first + c - held; if (j < 0) continue; B[i][i - j] += b.N[a] * b.N[c]; }
    }
  }
  for (let i = 0; i < m; i++) B[i][0] += 1e-12;
  const x = bandChol(B.map((r) => Array.from(r)), 3)(Array.from(rhs));
  for (let i = 0; i < m; i++) P[held + i] = x[i];
  return P;
}

function qChannel(ch, arr) { return arr.map((x) => q(x, DEC[ch])); }

/**
 * A road piece. `channels` maps each channel to a function of s on [0, length] (or a control-point array of the right
 * length). `from` is the state it must start from (endState), or null for a first piece. Each channel is fitted with its
 * start held (fitChannel), then quantised.
 */
function roadPiece({ id, length, family = 'bowl', from = null, channels, knotM = KNOT_M, knots, cup = false }) {
  if (!(length > 0)) throw new CoreError('BAD_LENGTH', `a piece's length must be positive, got ${length}`);
  if (!FAMILIES.includes(family)) throw new CoreError('BAD_FAMILY', `family "${family}" (known: ${FAMILIES.join(', ')})`);
  const L = q(length, DEC.m), K = (knots || evenKnots(L, knotM)).map((t) => q(t, DEC.m)), out = {};
  for (const ch of CHANNELS) {
    const src = channels[ch];
    if (ch === 'c' && !cup) { out.c = new Array(K.length + 4).fill(0); continue; }   // a legacy piece: zeros, never rendered
    if (src === undefined && OFFSETS.includes(ch)) { const e = from ? from[ch] : { v: 0, m: 0 }; out[ch] = qChannel(ch, fitChannel((s) => e.v + e.m * s, L, K, from ? e : null)); continue; }
    if (src === undefined) throw new CoreError('NO_CHANNEL', `channel ${ch} is missing`);
    if (Array.isArray(src)) {
      if (src.length !== K.length + 4) throw new CoreError('BAD_CHANNEL', `${ch} has ${src.length} control points, the knots need ${K.length + 4}`);
      out[ch] = qChannel(ch, src);
    } else out[ch] = qChannel(ch, fitChannel(src, L, K, from ? from[ch] : null));
  }
  const P = { id: id || null, type: 'road', length: L, family, knots: K, channels: out };
  return cup ? { ...P, cup: true } : P;
}
function flightPiece({ id, gap, drop, land }) {
  return { id: id || null, type: 'flight', gap: q(gap, DEC.m), drop: q(drop, DEC.m), land: q(land, DEC.rad) };
}

function createDoc(name = 'Untitled', { start = {} } = {}) {
  const st = { pos: (start.pos || [0, 0, 0]).map((x) => q(x, DEC.m)), heading: q(start.heading || 0, DEC.rad), pitch: q(start.pitch || 0, DEC.rad) };
  return deepFreeze(checkDoc({ schema: SCHEMA, generator: GENERATOR, name, closed: false, start: st, nextId: 1, pieces: [] }));
}
/** Append a piece at the open end; it gets the next id. Refused on a closed track, or when its joint is not C1. */
function appendPiece(doc, piece) {
  if (doc.closed) throw new CoreError('CLOSED', 'a closed track has no open end; open it first');
  const P = { ...piece, id: `p${doc.nextId}` };
  return deepFreeze(checkDoc({ ...doc, nextId: doc.nextId + 1, pieces: [...doc.pieces, P] }));
}

// ── the checks ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** A joint is C1 when value and slope agree to within what quantisation can move them (ref 09 §1). */
function jointProblem(prevEnd, P, prevCup = false) {
  const h = P.knots.length ? P.knots[0] : P.length;
  for (const ch of CHANNELS) {
    if (ch === 'c') {   // cup ↔ cup: C1 like the others; legacy ↔ cup: the RENDERED edge must be continuous (0.05°); legacy ↔ legacy: nothing
      if (prevCup && P.cup) { /* falls through to the general test */ }
      else if (prevCup || P.cup) {
        const here = P.cup ? P.channels.c[0] : legacyEdgeDeg(P.family, P.channels.w[0], P.channels.r[0]);
        if (Math.abs(here - prevEnd.c.v) > CUP_JOINT_DEG) return `the cup starts at ${here}°, the previous piece ends at ${prevEnd.c.v}° (a legacy piece's cup is the edge it renders)`;
        continue;
      } else continue;
    }
    const c = P.channels[ch], v = c[0], m = (3 * (c[1] - c[0])) / h, qv = 10 ** -DEC[ch];
    if (Math.abs(v - prevEnd[ch].v) > 1.01 * qv) return `${ch} starts at ${v}, the previous piece ends at ${prevEnd[ch].v}`;
    const slopeTol = (6 * qv) / Math.min(h, 1) + 6 * qv * Math.abs(prevEnd[ch].m);
    if (Math.abs(m - prevEnd[ch].m) > slopeTol) return `${ch} starts with slope ${m}, the previous piece ends with ${prevEnd[ch].m}`;
  }
  return null;
}
function checkDoc(doc) {
  const bad = (msg) => { throw new CoreError('BAD_DOC', msg); };
  if (!doc || doc.schema !== SCHEMA) bad(`schema must be ${SCHEMA}, got ${doc && doc.schema}`);
  if (typeof doc.name !== 'string') bad('name must be a string');
  if (typeof doc.closed !== 'boolean') bad('closed must be true or false');
  if (!doc.start || !Array.isArray(doc.start.pos) || doc.start.pos.length !== 3 || !doc.start.pos.every(Number.isFinite) || !Number.isFinite(doc.start.heading) || !Number.isFinite(doc.start.pitch)) bad('start needs pos [x, y, z], heading and pitch');
  if (!Number.isInteger(doc.nextId) || doc.nextId < 1) bad('nextId must be a positive integer');
  if (!Array.isArray(doc.pieces)) bad('pieces must be an array');
  const ids = new Set(); let prev = null, afterFlight = false;
  doc.pieces.forEach((P, i) => {
    const at = `piece ${i} (${P && P.id})`;
    if (!P || typeof P.id !== 'string' || ids.has(P.id)) bad(`${at}: needs a unique string id`); ids.add(P.id);
    if (P.type === 'flight') {
      if (prev) { const e = pieceEnd(prev); for (const ch of OFFSETS) if (Math.abs(e[ch].v) > 10 ** -DEC[ch] || Math.abs(e[ch].m) > 1e-6) throw new CoreError('FLIGHT_OFFSET', `${at}: ${ch} must fade to 0 (value and slope) before a jump, got ${e[ch].v} m, slope ${e[ch].m}: the adapter cannot lift a jump's gap or its landing ramp`); }
      if (!(P.gap > 0) || !Number.isFinite(P.drop) || !Number.isFinite(P.land)) bad(`${at}: a flight needs gap > 0, drop and land`);
      if (!prev) bad(`${at}: a flight must follow a road piece`);
      afterFlight = true; return;
    }
    if (P.type !== 'road') bad(`${at}: type must be road or flight, got ${P.type}`);
    if (!(P.length > 0)) bad(`${at}: length must be positive`);
    if (!FAMILIES.includes(P.family)) bad(`${at}: family "${P.family}"`);
    if (!Array.isArray(P.knots) || P.knots.some((t, k) => !(t > 0 && t < P.length) || (k && !(t > P.knots[k - 1])))) bad(`${at}: knots must be ascending, strictly inside (0, length)`);
    for (const ch of CHANNELS) { const c = P.channels && P.channels[ch]; if (ch === 'c' && c === undefined && !P.cup) continue; if (!Array.isArray(c) || c.length !== P.knots.length + 4 || !c.every(Number.isFinite)) bad(`${at}: channel ${ch} needs ${P.knots.length + 4} finite control points`); }
    if (P.cup !== undefined && P.cup !== true) bad(`${at}: cup is true on a cup piece and absent on a legacy piece, got ${P.cup}`);
    // a cup piece's c stays in [0, CUP_MAX]: every control point is, so the curve is (its basis is non-negative and sums to 1: the convex hull, ref 03 §1b)
    if (P.cup && P.channels.c.some((v) => v < -CUP_EPS || v > CUP_MAX + CUP_EPS)) throw new CoreError('BAD_CUP', `${at}: the cup must stay within 0 to ${CUP_MAX}°, but a control point is ${Math.min(...P.channels.c)} to ${Math.max(...P.channels.c)}° (the walls of a ${CUP_MAX}°+ bowl touch)`);
    if (prev) {
      const e = pieceEnd(prev), want = afterFlight ? { ...e, kh: { v: 0, m: 0 }, kv: { v: 0, m: 0 }, h: { v: 0, m: 0 }, l: { v: 0, m: 0 } } : e;
      const p = jointProblem(want, P, !!prev.cup); if (p) throw new CoreError('JOINT', `${at}: ${p} (every road joint is C1 in every channel, ref 09 §1)`);
    }
    prev = P; afterFlight = false;
  });
  if (doc.nextId <= doc.pieces.reduce((a, P) => Math.max(a, Number(String(P.id).replace(/^p/, '')) || 0), 0)) bad('nextId must exceed every piece id');
  return doc;
}

// ── canonical text ─────────────────────────────────────────────────────────────────────────────────────────────────
const pieceText = (P) => (P.type === 'flight'
  ? JSON.stringify({ id: P.id, type: 'flight', gap: P.gap, drop: P.drop, land: P.land })
  : JSON.stringify({ id: P.id, type: 'road', length: P.length, family: P.family, knots: P.knots, channels: Object.fromEntries(CHANNELS.filter((ch) => ch !== 'c' || P.cup).map((ch) => [ch, P.channels[ch]])) }));
function serialize(doc) {
  checkDoc(doc);
  const head = [`  "schema": ${JSON.stringify(doc.schema)}`, `  "generator": ${JSON.stringify(GENERATOR)}`, `  "name": ${JSON.stringify(doc.name)}`, `  "closed": ${doc.closed}`,
    `  "start": ${JSON.stringify({ pos: doc.start.pos, heading: doc.start.heading, pitch: doc.start.pitch })}`, `  "nextId": ${doc.nextId}`];
  const body = doc.pieces.length ? `  "pieces": [\n${doc.pieces.map((P) => `    ${pieceText(P)}`).join(',\n')}\n  ]` : '  "pieces": []';
  return `{\n${[...head, body].join(',\n')}\n}\n`;
}
/** A road piece read from text is a cup piece exactly when its text carries a `c` array (the only way the canonical text says so). */
function cupOf(P, out) { return P && P.channels && Array.isArray(P.channels.c) ? { ...out, cup: true } : out; }
/** Parse a document; every number is quantised as it enters, so a hand-edited value finer than its quantum is snapped. */
function parse(text) {
  let o; try { o = JSON.parse(text); } catch (e) { throw new CoreError('BAD_JSON', e.message); }
  if (!o || (o.schema !== SCHEMA && !OLD_SCHEMAS.includes(o.schema))) throw new CoreError('BAD_DOC', `schema must be ${SCHEMA} (or an older ${OLD_SCHEMAS.join(', ')}), got ${o && o.schema} (a newer file needs a newer builder)`);
  const upgrade = o.schema === 't180b.core/1';   // a core/1 file has no offsets: they are zero, one per control point; core/1 and /2 have no cup: legacy pieces
  const pieces = (o.pieces || []).map((P) => (P && P.type === 'flight'
    ? { id: P.id, type: 'flight', gap: q(P.gap, DEC.m), drop: q(P.drop, DEC.m), land: q(P.land, DEC.rad) }
    : cupOf(P, { id: P.id, type: P.type, length: q(P.length, DEC.m), family: P.family, knots: (P.knots || []).map((t) => q(t, DEC.m)),
      channels: Object.fromEntries(CHANNELS.map((ch) => [ch, ((upgrade && OFFSETS.includes(ch)) || (ch === 'c' && !((P.channels || {}).c)) ? new Array(((P.knots || []).length) + 4).fill(0) : ((P.channels || {})[ch] || [])).map((x) => q(x, DEC[ch]))])) })));
  const s = o.start || {};
  return deepFreeze(checkDoc({ schema: SCHEMA, generator: GENERATOR, name: o.name, closed: o.closed, start: { pos: (s.pos || []).map((x) => q(x, DEC.m)), heading: q(s.heading, DEC.rad), pitch: q(s.pitch, DEC.rad) }, nextId: o.nextId, pieces }));
}

// ── undo as history (the same contract as src/doc/history.js, for this document) ────────────────────────────────────
const freezeH = (h) => Object.freeze(h);
function createHistory(doc) { return freezeH({ past: Object.freeze([]), present: checkDoc(doc), future: Object.freeze([]), dragBase: null }); }
function commit(h, doc) { if (h.dragBase) throw new CoreError('IN_DRAG', 'commit during a drag; end the drag first'); if (doc === h.present) return h; return freezeH({ past: Object.freeze([...h.past, h.present]), present: checkDoc(doc), future: Object.freeze([]), dragBase: null }); }
function beginDrag(h) { if (h.dragBase) throw new CoreError('IN_DRAG', 'a drag is already open'); return freezeH({ ...h, dragBase: h.present }); }
function dragTo(h, doc) { if (!h.dragBase) throw new CoreError('NO_DRAG', 'dragTo outside a drag'); return freezeH({ ...h, present: checkDoc(doc) }); }
function endDrag(h) {
  if (!h.dragBase) throw new CoreError('NO_DRAG', 'endDrag outside a drag');
  if (h.present === h.dragBase) return freezeH({ ...h, dragBase: null });
  return freezeH({ past: Object.freeze([...h.past, h.dragBase]), present: h.present, future: Object.freeze([]), dragBase: null });
}
function undo(h) { if (h.dragBase) throw new CoreError('IN_DRAG', 'undo during a drag'); if (!h.past.length) return h; return freezeH({ past: Object.freeze(h.past.slice(0, -1)), present: h.past[h.past.length - 1], future: Object.freeze([h.present, ...h.future]), dragBase: null }); }
function redo(h) { if (h.dragBase) throw new CoreError('IN_DRAG', 'redo during a drag'); if (!h.future.length) return h; return freezeH({ past: Object.freeze([...h.past, h.present]), present: h.future[0], future: Object.freeze(h.future.slice(1)), dragBase: null }); }

// ── loading a real track (a LOCAL example: its equation is another author's layout; it lives in reads/, never committed) ──
/**
 * A document from D184's position fit (`tools/piecewise.cjs --write`, schema t180b.pieces/1) and the read it was fitted
 * from. Each fitted road piece becomes a road piece:
 *   - κh and κv come from the position spline's derivatives (ref 09 §4), re-parameterised by true arc length;
 *   - φ is the READ's normal against the geometry's gravity frame at the nearest read station. The fit's own bank is
 *     against a rotation-minimising frame whose start is not in the file, so it cannot be turned into a gravity roll;
 *   - w is the read's width there; r is the family's measured rate.
 * A jump joint becomes a flight: gap = the horizontal distance between the take-off and landing points, drop = their height
 * difference, land = the landing pitch. The core then puts validation's landing ramp after it, so the line after a jump
 * sits one ramp further on than the real track's (a stated difference, measured by the round trip, spec test 1).
 * The lap is returned OPEN: closing it is close.js's (the spec's GO §1 "then close").
 */
function fromPositionFit(fit, read, { name = 'Local example', family = 'bowl', sampleM = 1 } = {}) {
  if (!fit || fit.schema !== 't180b.pieces/1') throw new CoreError('BAD_FIT', `expected schema t180b.pieces/1, got ${fit && fit.schema}`);
  const { RATES } = require('../geom/fonts.js');
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const lenv = (a) => Math.hypot(a[0], a[1], a[2]);
  // the read's stations in a 10 m grid, for the nearest station to a point
  const st = read.stations.filter((x) => x.c && x.n), cell = 10, grid = new Map(), key = (p) => `${Math.floor(p[0] / cell)},${Math.floor(p[2] / cell)}`;
  st.forEach((x, i) => { const k = key(x.c); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const nearest = (p) => {
    let best = -1, bd = Infinity; const cx = Math.floor(p[0] / cell), cz = Math.floor(p[2] / cell);
    for (let r = 0; r <= 3 && best < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const i of grid.get(`${cx + dx},${cz + dz}`) || []) { const d = lenv(sub(st[i].c, p)); if (d < bd) { bd = d; best = i; } }
    return best < 0 ? null : st[best];
  };
  const pieces = fit.pieces.map((F) => {
    const U = [F.a, F.a, F.a, F.a, ...F.knots, F.b, F.b, F.b, F.b];
    const ev = (t) => { const b = basis(U, t), r = [0, 0, 0], d1 = [0, 0, 0], d2 = [0, 0, 0]; for (let c = 0; c < 3; c++) for (let a = 0; a < 4; a++) { const x = F.x[c][b.first + a]; r[c] += x * b.N[a]; d1[c] += x * b.D1[a]; d2[c] += x * b.D2[a]; } return { r, d1, d2 }; };
    // true arc length σ(t), by Simpson on a fine grid, and the channels at each grid point (ref 09 §4)
    const n = Math.max(8, Math.ceil((F.b - F.a) / sampleM)), ts = [], sig = [0], rows = [];
    for (let i = 0; i <= n; i++) ts.push(F.a + ((F.b - F.a) * i) / n);
    const speed = (t) => lenv(ev(t).d1);
    for (let i = 1; i <= n; i++) { const t0 = ts[i - 1], t1 = ts[i]; sig.push(sig[i - 1] + ((t1 - t0) / 6) * (speed(t0) + 4 * speed((t0 + t1) / 2) + speed(t1))); }
    for (let i = 0; i <= n; i++) {
      const { r, d1, d2 } = ev(ts[i]), sp = lenv(d1), T = d1.map((x) => x / sp), a2 = dot(d2, T), dT = d2.map((x, c) => (x - a2 * T[c]) / (sp * sp));
      const horiz = T[0] * T[0] + T[2] * T[2], p = Math.asin(Math.max(-1, Math.min(1, T[1])));
      const kh = (T[2] * dT[0] - T[0] * dT[2]) / horiz, kv = dT[1] / Math.cos(p);
      // φ against the gravity frame (src/geom/path.js FRAME): L0 = (cos θ, 0, −sin θ), U0 = T × L0; + = left side up
      const th = Math.atan2(T[0], T[2]), L0 = [Math.cos(th), 0, -Math.sin(th)], U0 = [T[1] * L0[2] - T[2] * L0[1], T[2] * L0[0] - T[0] * L0[2], T[0] * L0[1] - T[1] * L0[0]];
      const s0 = nearest(r); const nn = s0 ? s0.n : U0, phi = Math.atan2(-dot(nn, L0), dot(nn, U0));
      rows.push({ s: sig[i], kh, kv, phi, w: s0 && s0.width > 0 ? s0.width : 31, r, T, p });
    }
    for (let i = 1; i < rows.length; i++) { const d = rows[i].phi - rows[i - 1].phi; rows[i].phi -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); }
    return { F, L: sig[n], rows };
  });
  const interp = (rows, key) => (s) => { let lo = 0, hi = rows.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rows[m].s <= s) lo = m; else hi = m; } const a = rows[lo], b = rows[hi], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0; return a[key] + (b[key] - a[key]) * t; };
  const r0 = pieces[0].rows[0];
  let doc = createDoc(name, { start: { pos: r0.r, heading: Math.atan2(r0.T[0], r0.T[2]), pitch: r0.p } });
  pieces.forEach((pc, i) => {
    if (i > 0 && fit.pieces[i - 1].endType === 'jump') {
      const a = pieces[i - 1].rows[pieces[i - 1].rows.length - 1], b = pc.rows[0];
      doc = appendPiece(doc, flightPiece({ gap: Math.hypot(b.r[0] - a.r[0], b.r[2] - a.r[2]), drop: a.r[1] - b.r[1], land: b.p }));
    }
    const from = endState(doc), ch = { kh: interp(pc.rows, 'kh'), kv: interp(pc.rows, 'kv'), phi: interp(pc.rows, 'phi'), w: interp(pc.rows, 'w'), h: () => 0, l: () => 0, r: () => RATES[family] };
    if (from) { const off = from.phi.v - ch.phi(0); const base = ch.phi; ch.phi = (s) => base(s) + 2 * Math.PI * Math.round(off / (2 * Math.PI)); }
    doc = appendPiece(doc, roadPiece({ length: pc.L, family, from, channels: ch }));
  });
  return doc;
}

// ── knot insertion (ref 09 §6, Boehm): finer knots under a brush, the curve unchanged ─────────────────────────────────
/**
 * The control points of a clamped cubic (full knot vector U, points P) after inserting t, by Boehm's rule (ref 09 §6):
 * t in [U_k, U_{k+1}); q_i = P_i for i ≤ k − 3; q_i = (1 − a_i)P_{i−1} + a_i P_i with a_i = (t − U_i)/(U_{i+3} − U_i) for
 * k − 2 ≤ i ≤ k; q_i = P_{i−1} for i ≥ k + 1. Pure and unquantised: the curve is unchanged up to float rounding.
 */
function boehm(U, P, t) {
  let k = 3; while (k + 1 < U.length - 4 && U[k + 1] <= t) k++;
  const Q = [];
  for (let i = 0; i <= P.length; i++) {
    if (i <= k - 3) Q.push(P[i]);
    else if (i <= k) { const a = (t - U[i]) / (U[i + 3] - U[i]); Q.push((1 - a) * P[i - 1] + a * P[i]); }
    else Q.push(P[i - 1]);
  }
  return Q;
}
/**
 * A road piece with the knot t inserted into every channel (ref 09 §6). t is quantised like any knot, must lie strictly
 * inside (0, length) and must not be a knot already. Only the three control points around t are new; they are quantised to
 * their channel's step, so the stored curve moves by at most half a step there and not at all elsewhere.
 */
function insertKnot(P, t) {
  if (!P || P.type !== 'road') throw new CoreError('NOT_ROAD', 'knots are inserted into road pieces only');
  const tq = q(t, DEC.m);
  if (!(tq > 0 && tq < P.length)) throw new CoreError('BAD_KNOT', `a knot must lie strictly inside (0, ${P.length}), got ${t}`);
  if (P.knots.includes(tq)) throw new CoreError('BAD_KNOT', `${tq} is a knot already`);
  const U = knotVector(P), channels = {};
  for (const ch of CHANNELS) {
    if (ch === 'c' && P.channels.c === undefined && !P.cup) continue;
    const Q = boehm(U, P.channels[ch], tq);
    // the untouched points are the SAME numbers (no requantising moves them); only the three new ones are quantised
    let k = 3; while (k + 1 < U.length - 4 && U[k + 1] <= tq) k++;
    channels[ch] = Q.map((x, i) => (i >= k - 2 && i <= k ? q(x, DEC[ch]) : x));
  }
  const knots = [...P.knots, tq].sort((a, b) => a - b);
  return { ...P, knots, channels };
}
/** Several knots, in any order (each by insertKnot). */
function insertKnots(P, ts) { return ts.reduce((acc, t) => insertKnot(acc, t), P); }

/**
 * THE API FOR A NARROW BRUSH (src/core/README.md "knot insertion"). Every span of road piece `pieceId` that overlaps [a, b]
 * (the piece's own s) and is longer than maxSpan is cut into equal spans no longer than maxSpan, by exact insertion. Spans
 * outside [a, b] keep their knots and control points. Returns { doc: a new checked document, inserted: [t …] } (doc is the
 * same object when nothing was needed). Undo removes the knots like any other edit.
 */
function refineKnots(doc, pieceId, a, b, maxSpan) {
  const i = doc.pieces.findIndex((P) => P.id === pieceId);
  if (i < 0) throw new CoreError('NO_PIECE', `no piece ${pieceId}`);
  const P = doc.pieces[i];
  if (P.type !== 'road') throw new CoreError('NOT_ROAD', `${pieceId} is a ${P.type}, not road`);
  if (!(maxSpan >= 0.01)) throw new CoreError('BAD_SPAN', `maxSpan must be at least 0.01 m, got ${maxSpan}`);
  if (!(b > a)) throw new CoreError('BAD_RANGE', `the range must have b > a, got [${a}, ${b}]`);
  const t = [0, ...P.knots, P.length], add = [];
  for (let j = 0; j + 1 < t.length; j++) {
    const x = t[j], y = t[j + 1];
    if (!(y > a && x < b) || y - x <= maxSpan) continue;
    const m = Math.ceil((y - x) / maxSpan - 1e-9);
    for (let n = 1; n < m; n++) { const v = q(x + ((y - x) * n) / m, DEC.m); if (v > x && v < y && !add.includes(v)) add.push(v); }
  }
  if (add.length > 20000) throw new CoreError('TOO_MANY', `refining would add ${add.length} knots; use a larger maxSpan`);
  if (!add.length) return { doc, inserted: [] };
  const pieces = doc.pieces.slice(); pieces[i] = insertKnots(P, add);
  return { doc: deepFreeze(checkDoc({ ...doc, pieces })), inserted: add.sort((u, v) => u - v) };
}

module.exports = {
  boehm, insertKnot, insertKnots, refineKnots,
  fromPositionFit,
  SCHEMA, OLD_SCHEMAS, CHANNELS, OFFSETS, FAMILIES, DEC, KNOT_M, CUP_MAX, CUP_JOINT_DEG, legacyEdgeDeg, endIsCup, fillCup, CoreError,
  createDoc, roadPiece, flightPiece, appendPiece, endState, pieceEnd, channelAt, knotVector, evenKnots, fitChannel, checkDoc,
  serialize, parse, createHistory, commit, beginDrag, dragTo, endDrag, undo, redo,
};
