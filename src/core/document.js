// document.js: the equation core's document (src/core/README.md is the shape). A track is a list of PIECES; a road piece
// holds one clamped cubic B-spline per CHANNEL in its own arc length (ref 03 §1): heading rate κh, pitch rate κv, bank φ,
// width w, the cross-section's rise rate r and (D190) the CUP c, the cross-section's edge angle. Every road joint is C1 in every channel (ref 09 §1), so the line is G2 by
// construction. A flight piece is a jump (D258, the keeper's way): it carries the LANDING's start pose relative to the take-off end, and the road
// after it starts at that pose; the user places it by hand and tunes it by driving. Nothing is solved or generated between (no ramp, no arc).
//
//   createDoc(name, { start })                 an empty open track
//   roadPiece({ length, family, from, channels, knotM })   a piece whose channels START at `from` (the previous end state)
//   flightPiece({ forward, left, up, heading, pitch, bank })   a free flight (D258); LANDING_DEFAULT is the Jump button's
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
// core/4 (D225, the cross-section lap) adds the EDGE channels e and s (an extra turning of the outer zone, ref 09 §10) and the TUBE channel t (a circular-arc
// cross-section, sweep in degrees). Like the cup, each is carried only by the pieces that use it: a piece is an EDGE piece when P.edge is true (its text has e and s
// arrays), a TUBE piece when P.tube is true (a t array); a /1, /2 or /3 piece loads with none of them and renders byte for byte as before. The version bump is
// deliberate: a /3 reader would accept a file with e and s and drop them on its next save, a /4 file is refused by name by the older builder (seal V3).
const SCHEMA = 't180b.core/4', OLD_SCHEMAS = Object.freeze(['t180b.core/1', 't180b.core/2', 't180b.core/3']), GENERATOR = 't180-track-builder/core 0.3.0';
// kh, kv, phi, w, r shape the base geometry; h (height, m, along WORLD up) and l (lateral, m, along the gravity frame's
// horizontal left) are VALUE channels the adapter applies AFTER it (src/core/README.md "the offset channels")
const CHANNELS = Object.freeze(['kh', 'kv', 'phi', 'w', 'r', 'h', 'l', 'c', 'e', 's', 't']);
// the channels a piece carries only when its flag is set (cup: c; edge: e and s; tube: t), and what an unflagged piece reads for each
const OPTIONAL = Object.freeze({ c: 'cup', e: 'edge', s: 'edge', t: 'tube' });
// e: the extra edge angle ψ added over the outer zone, degrees, >= 0 (e < 0, a lip, is not in this version). s: where the outer zone starts, a share of the half-width.
// t: the tube's sweep, degrees; 360 closes the section into a cylinder. The tube's edge angle is t/2.
const EDGE_EPS = 1e-9, S_MIN = 0.5, S_MAX = 0.95, S_DEFAULT = 0.64, TUBE_MAX = 360, TUBE_EDGE_MAX = 180;
const OPT_DEFAULT = Object.freeze({ c: 0, e: 0, s: S_DEFAULT, t: 0 });
// c is the cross-section's edge angle ψ at u = ±w/2, in DEGREES, in [0, CUP_MAX]. 150: the bowl's two walls touch at 159.681° (the D190 seal, V2)
const CUP_MAX = 150, CUP_JOINT_DEG = 0.05, CUP_EPS = 1e-9;   // CUP_EPS: the float noise a solver leaves on a control point at a limit (close.js)
const OFFSETS = Object.freeze(['h', 'l']);
const FAMILIES = Object.freeze(['bowl', 'half-pipe', 'flat']);
// decimals each number is quantised to when it enters (src/core/README.md "numbers are quantised")
const DEC = Object.freeze({ m: 4, kh: 9, kv: 9, phi: 9, w: 4, r: 6, h: 4, l: 4, c: 6, e: 6, s: 6, t: 6, rad: 9 });
const { FLOORS } = require('../geom/fonts.js');
const { MACH6 } = require('../validate/limits.js');
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
  if (c === undefined && OPTIONAL[ch] && !P[OPTIONAL[ch]]) return { v: OPT_DEFAULT[ch], d1: 0, d2: 0 };   // a piece may be built without an optional channel's array (never rendered; an unflagged s reads its default)
  const b = basis(knotVector(P), Math.min(Math.max(s, 0), P.length));
  let v = 0, d1 = 0, d2 = 0;
  for (let a = 0; a < 4; a++) { const x = c[b.first + a]; v += x * b.N[a]; d1 += x * b.D1[a]; d2 += x * b.D2[a]; }
  return { v, d1, d2 };
}
/**
 * Every channel's VALUE at s, as { kh: v, kv: v, ... } over CHANNELS: exactly `channelAt(P, ch, s).v` for each, from ONE basis evaluation (the basis depends on the knots and
 * s alone, so channelAt rebuilt the very same one for each of the eleven channels; D236: the adapter reads all of them at every segment end of every piece, on every brush step).
 */
function valuesAt(P, s) {
  const out = {}; let b = null;
  for (const ch of CHANNELS) {
    const c = P.channels[ch];
    if (c === undefined && OPTIONAL[ch] && !P[OPTIONAL[ch]]) { out[ch] = OPT_DEFAULT[ch]; continue; }
    if (!b) b = basis(knotVector(P), Math.min(Math.max(s, 0), P.length));
    let v = 0; for (let a = 0; a < 4; a++) v += c[b.first + a] * b.N[a];
    out[ch] = v;
  }
  return out;
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
  for (const ch of CHANNELS) { const c = P.channels[ch]; if (c === undefined && OPTIONAL[ch] && !P[OPTIONAL[ch]]) continue; const n = c.length; out[ch] = { v: c[n - 1], m: (3 * (c[n - 1] - c[n - 2])) / h }; }
  // the RENDERED edge angle c: a cup's own channel, a legacy piece's profileAt edge, a tube's t/2 (held: the morph into a different kind carries the rest)
  if (P.tube) out.c = { v: out.t.v / 2, m: 0 };
  else if (!P.cup) out.c = { v: legacyEdgeDeg(P.family, out.w.v, out.r.v), m: 0 };
  // out.t is the tube's sweep and exists ONLY at a tube head: a non-tube head reads 0 (the shell shows "none", the contract for C). tNext is the INTERNAL value a tube started
  // after this piece continues from: a tube head's own end, otherwise twice the edge the piece renders, held (extend reads it; nothing else should)
  out.tNext = P.tube ? { v: out.t.v, m: out.t.m } : { v: 2 * out.c.v, m: 0 };
  if (!P.tube) out.t = { v: 0, m: 0 };
  if (!P.edge) { out.e = { v: 0, m: 0 }; out.s = { v: S_DEFAULT, m: 0 }; }
  return out;
}
/** 'tube', 'cup' or 'legacy': the cross-section family a road piece is drawn as (a tube wins over nothing: a piece is never both a cup and a tube). */
const kindOf = (P) => (P.tube ? 'tube' : P.cup ? 'cup' : 'legacy');
/** kindOf of the last road piece ('legacy' for an empty track): what a piece extended after it continues as. */
function endKind(doc) { for (let i = doc.pieces.length - 1; i >= 0; i--) if (doc.pieces[i].type === 'road') return kindOf(doc.pieces[i]); return 'legacy'; }
/**
 * The sweep t (degrees) at which a tube of width w has its two tips this close (m), the root of 2·(w/t)·sin(t/2) = gap in (π, 2π) by bisection (ref 09 §10).
 * An open tube HELD between this and 360 leaves a slot narrower than the downforce ray's reach (MACH6.downforceRay.aheadM): refused by name (BAD_TUBE).
 */
function tubeSlotMinDeg(w, gap = MACH6.downforceRay.aheadM) {
  const g = (t) => (2 * w / t) * Math.sin(t / 2) - gap;
  if (!(w > 0) || g(Math.PI) <= 0) return 180;   // so narrow that even a half-circle's slot is under the reach
  let lo = Math.PI, hi = 2 * Math.PI;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (g(m) > 0) lo = m; else hi = m; }
  return ((lo + hi) / 2) * 180 / Math.PI;
}
/** The document with every legacy road piece that was built without a c array given zeros for it (the same object when none was). */
function fillCup(doc) {
  const missing = (P) => P.type === 'road' && P.channels && Object.keys(OPTIONAL).some((ch) => P.channels[ch] === undefined && !P[OPTIONAL[ch]]);
  if (!doc.pieces.some(missing)) return doc;
  return { ...doc, pieces: doc.pieces.map((P) => (missing(P) ? { ...P, channels: { ...P.channels, ...Object.fromEntries(Object.keys(OPTIONAL).filter((ch) => P.channels[ch] === undefined && !P[OPTIONAL[ch]]).map((ch) => [ch, new Array(P.knots.length + 4).fill(OPT_DEFAULT[ch])])) } } : P)) };
}
/** True when the last road piece is a cup piece (a piece extended after it is one too). */
function endIsCup(doc) { for (let i = doc.pieces.length - 1; i >= 0; i--) if (doc.pieces[i].type === 'road') return !!doc.pieces[i].cup; return false; }
/** The state a new road piece must start from: the last road piece's end; after a flight (D258), level (κh = κv = 0, no offset) at the flight's bank, the rest carried as a default. */
function endState(doc) {
  let flight = null;
  for (let i = doc.pieces.length - 1; i >= 0; i--) {
    const P = doc.pieces[i];
    if (P.type === 'flight') { flight = P; continue; }
    const e = pieceEnd(P);
    return flight ? afterFlight(e, flight) : e;
  }
  return null;   // an empty track: the first piece starts where its channels say
}
/** The start a landing takes after flight F, from the take-off's end state e: level (κh = κv = 0, h = l = 0, value and slope), at the flight's bank. */
const afterFlight = (e, F) => ({ ...e, kh: { v: 0, m: 0 }, kv: { v: 0, m: 0 }, h: { v: 0, m: 0 }, l: { v: 0, m: 0 }, phi: { v: F.bank, m: 0 } });

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
// ── D261, GRIP PER PIECE ─────────────────────────────────────────────────────────────────────────────────────────────────
// A road piece's grip: an integer percent of AC's road friction (ROAD, FRICTION 1: AC's system/data/surfaces.ini), from GRIP_MIN to GRIP_MAX, default 100.
// It lives ON THE PIECE, not in a channel: grip changes at piece boundaries, never smoothly. A piece at 100 carries NO grip field, in memory and in the file,
// so every track made before it, and every all-100 track, is the same document and the same text as before (the keeper's range, 2026-10-06: 50–150%).
const GRIP_MIN = 50, GRIP_MAX = 150, GRIP_DEFAULT = 100;
/** A road piece's grip, percent (100 when it carries none). */
const gripOf = (P) => (P && P.grip !== undefined ? P.grip : GRIP_DEFAULT);
/** A grip value checked: an integer percent within GRIP_MIN..GRIP_MAX, or a CoreError BAD_GRIP naming what was wrong. */
function checkGrip(g, at = 'grip') {
  if (typeof g !== 'number' || !Number.isInteger(g) || g < GRIP_MIN || g > GRIP_MAX) throw new CoreError('BAD_GRIP', `${at}: a grip is a whole percent of AC's road grip, from ${GRIP_MIN} to ${GRIP_MAX}, got ${JSON.stringify(g)}`);
  return g;
}
/** The piece with grip g: no field at all at the default, so a 100% piece is exactly the piece it was before grip existed. */
const withGrip = (P, g) => { const { grip, ...rest } = P; return checkGrip(g) === GRIP_DEFAULT ? rest : { ...rest, grip: g }; };
/** The document with the road pieces at the given indices set to grip g (any track, open or closed: grip moves no geometry). */
function setGrip(doc, indices, g) {
  checkGrip(g);
  if (!Array.isArray(indices) || !indices.length) throw new CoreError('BAD_INDEX', 'setGrip needs a list of piece indices');
  const pieces = doc.pieces.slice();
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= pieces.length) throw new CoreError('BAD_INDEX', `piece ${i} does not exist: the track has ${pieces.length} (0 to ${pieces.length - 1})`);
    if (pieces[i].type !== 'road') throw new CoreError('NOT_ROAD', `piece ${pieces[i].id} is a ${pieces[i].type}: only road has grip`);
    pieces[i] = withGrip(pieces[i], g);
  }
  return deepFreeze(checkDoc({ ...doc, pieces }));
}

// ── SPAWNS (the keeper, 2026-10-09: "move the start line around the first piece … a numbered grid … a hotlap spawn I plop down") ───────────────────────
// Where the cars start, chosen by hand. It lives ON THE DOCUMENT, and a track that never had one carries NO spawns field, in memory and in the file, so
// every track made before it is the same document and the same text (D261's rule for grip). Without it the export places the start itself
// (app/core/coreshell.js startLayout, the longest straight); with it the export uses exactly this.
//   { line: { along },                         the start/finish line, metres into the FIRST piece (clamped to its length where it is used)
//     grid: { count, rowGapM, colGapM },       the grid pack: how many slots, the along-the-road spacing of one column (a staggered pair every
//                                              rowGapM) and the across-the-road spacing of the two columns
//     hotlap?: { piece, along } }              the hotlap spawn, a piece id and metres into it; absent until placed
// Pieces are NOT required to exist here: an edit that deletes the hotlap's piece must not be refused for it. The export says so instead.
const SPAWN_COUNT_MAX = 64, SPAWN_GAP_MAX = 200;
function checkSpawns(sp, at = 'spawns') {
  const bad = (m) => { throw new CoreError('BAD_SPAWNS', `${at}: ${m}`); };
  const pos = (x, what, max) => { if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || x > max) bad(`${what} must be a number above 0 and at most ${max}, got ${JSON.stringify(x)}`); };
  if (!sp || typeof sp !== 'object') bad('must be an object with a line and a grid');
  if (!sp.line || typeof sp.line.along !== 'number' || !Number.isFinite(sp.line.along) || sp.line.along < 0) bad(`line.along must be a distance of 0 m or more into the first piece, got ${JSON.stringify(sp.line && sp.line.along)}`);
  const g = sp.grid;
  if (!g || !Number.isInteger(g.count) || g.count < 1 || g.count > SPAWN_COUNT_MAX) bad(`grid.count must be a whole number from 1 to ${SPAWN_COUNT_MAX}, got ${JSON.stringify(g && g.count)}`);
  pos(g.rowGapM, 'grid.rowGapM', SPAWN_GAP_MAX); pos(g.colGapM, 'grid.colGapM', SPAWN_GAP_MAX);
  if (sp.hotlap !== undefined) {
    const h = sp.hotlap;
    if (!h || typeof h.piece !== 'string' || !h.piece) bad(`hotlap.piece must be a piece id, got ${JSON.stringify(h && h.piece)}`);
    if (typeof h.along !== 'number' || !Number.isFinite(h.along) || h.along < 0) bad(`hotlap.along must be a distance of 0 m or more, got ${JSON.stringify(h.along)}`);
  }
  for (const k of Object.keys(sp)) if (!['line', 'grid', 'hotlap'].includes(k)) bad(`unknown field "${k}" (a spawns block has line, grid and hotlap)`);
  return sp;
}
/** The spawns block in its canonical, quantised form (the order and the numbers the file carries). */
function normSpawns(sp) {
  checkSpawns(sp);
  const out = { line: { along: q(sp.line.along, DEC.m) }, grid: { count: sp.grid.count, rowGapM: q(sp.grid.rowGapM, DEC.m), colGapM: q(sp.grid.colGapM, DEC.m) } };
  if (sp.hotlap !== undefined) out.hotlap = { piece: sp.hotlap.piece, along: q(sp.hotlap.along, DEC.m) };
  return checkSpawns(out);
}
/** The document with spawns sp, or with NO spawns field at all when sp is null (back to the export's own placement). */
function setSpawns(doc, sp) {
  const { spawns, ...rest } = doc;
  return deepFreeze(checkDoc(sp == null ? rest : { ...rest, spawns: normSpawns(sp) }));
}

function roadPiece({ id, length, family = 'bowl', from = null, channels, knotM = KNOT_M, knots, cup = false, edge = false, tube = false, grip = GRIP_DEFAULT }) {
  checkGrip(grip);
  if (!(length > 0)) throw new CoreError('BAD_LENGTH', `a piece's length must be positive, got ${length}`);
  if (!FAMILIES.includes(family)) throw new CoreError('BAD_FAMILY', `family "${family}" (known: ${FAMILIES.join(', ')})`);
  if (cup && tube) throw new CoreError('BAD_TUBE', 'a piece is a cup or a tube, not both');
  const flags = { cup, edge, tube };
  const L = q(length, DEC.m), K = (knots || evenKnots(L, knotM)).map((t) => q(t, DEC.m)), out = {};
  for (const ch of CHANNELS) {
    const src = channels[ch];
    if (OPTIONAL[ch] && !flags[OPTIONAL[ch]]) { out[ch] = new Array(K.length + 4).fill(OPT_DEFAULT[ch]); continue; }   // a piece without the channel: its default, never rendered
    if (src === undefined && OFFSETS.includes(ch)) { const e = from ? from[ch] : { v: 0, m: 0 }; out[ch] = qChannel(ch, fitChannel((s) => e.v + e.m * s, L, K, from ? e : null)); continue; }
    if (src === undefined) throw new CoreError('NO_CHANNEL', `channel ${ch} is missing`);
    if (Array.isArray(src)) {
      if (src.length !== K.length + 4) throw new CoreError('BAD_CHANNEL', `${ch} has ${src.length} control points, the knots need ${K.length + 4}`);
      out[ch] = qChannel(ch, src);
    } else out[ch] = qChannel(ch, fitChannel(src, L, K, from ? from[ch] : null));
  }
  const P = { id: id || null, type: 'road', length: L, family, knots: K, channels: out };
  return { ...P, ...(grip !== GRIP_DEFAULT ? { grip } : {}), ...(cup ? { cup: true } : {}), ...(edge ? { edge: true } : {}), ...(tube ? { tube: true } : {}) };
}
// ── D258, THE FREE FLIGHT ──────────────────────────────────────────────────────────────────────────────────────────────
// The landing's start POSE relative to the take-off end: forward, left and up (m) in the take-off's HEADING frame (forward along its heading on the
// ground, left across it on the ground, up along world up, so "the same height" is up 0 whatever the take-off's climb), heading (rad, a TURN from the
// take-off's heading, + = left), pitch (rad, the landing's own pitch, + = nose up) and bank (rad, the landing's own bank: its φ at its start).
const FLIGHT_POSE = Object.freeze(['forward', 'left', 'up', 'heading', 'pitch', 'bank']);
const FLIGHT_MIN_M = 1;   // a landing at least a metre from its take-off (a curve across the air needs a direction)
const FLIGHT_PITCH_MAX = Math.PI / 2 - 1e-3;   // a landing pitched short of vertical: the heading frame needs a horizontal direction
// the Jump button's landing (the keeper: "a blank straight piece just like the first piece"): lined up with the take-off, 40 m ahead, at the same height, level
const LANDING_DEFAULT = Object.freeze({ forward: 40, left: 0, up: 0, heading: 0, pitch: 0, bank: 0 });
function flightPiece({ id, forward, left = 0, up = 0, heading = 0, pitch = 0, bank = 0 } = {}) {
  return { id: id || null, type: 'flight', forward: q(forward, DEC.m), left: q(left, DEC.m), up: q(up, DEC.m), heading: q(heading, DEC.rad), pitch: q(pitch, DEC.rad), bank: q(bank, DEC.phi) };
}
/** A flight's own domain: every number finite, the landing at least FLIGHT_MIN_M away, its pitch short of vertical, its heading a turn within ±180°. */
function checkFlight(P, at) {
  for (const k of FLIGHT_POSE) if (!Number.isFinite(P[k])) throw new CoreError('BAD_FLIGHT', `${at}: a flight needs a finite ${k}, got ${P[k]} (a flight is forward, left, up, heading, pitch and bank)`);
  const d = Math.hypot(P.forward, P.left, P.up);
  if (!(d >= FLIGHT_MIN_M)) throw new CoreError('FLIGHT_TOO_SHORT', `${at}: the landing starts ${d.toFixed(3)} m from the take-off; put it at least ${FLIGHT_MIN_M} m away`);
  if (!(Math.abs(P.pitch) <= FLIGHT_PITCH_MAX)) throw new CoreError('BAD_FLIGHT', `${at}: the landing's pitch must be short of vertical (inside ±${(FLIGHT_PITCH_MAX * 180 / Math.PI).toFixed(2)}°), got ${(P.pitch * 180 / Math.PI).toFixed(2)}°`);
  if (!(Math.abs(P.heading) <= Math.PI + 1e-9)) throw new CoreError('BAD_FLIGHT', `${at}: the landing's heading is a turn from the take-off within ±180°, got ${(P.heading * 180 / Math.PI).toFixed(2)}°`);
}
/** Why a landing P does not start as flight F says (null when it does): level (κh, κv, h, l: 0 in value and slope) and at F's bank. Its other channels are its own (D258: not C1 with the take-off). */
function landingProblem(F, P) {
  const h = P.knots.length ? P.knots[0] : P.length;
  for (const ch of ['kh', 'kv', 'h', 'l']) {
    const c = P.channels[ch], qv = 10 ** -DEC[ch], m = (3 * (c[1] - c[0])) / h;
    if (Math.abs(c[0]) > 1.01 * qv) return `${ch} starts at ${c[0]}: a landing starts level (no turn, no climb, no hill or swerve offset)`;
    if (Math.abs(m) > (6 * qv) / Math.min(h, 1)) return `${ch} starts with slope ${m}: a landing starts level`;
  }
  if (Math.abs(P.channels.phi[0] - F.bank) > 1.01 * 10 ** -DEC.phi) return `the landing's bank starts at ${P.channels.phi[0]} rad, its flight says ${F.bank}`;
  return null;
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
function jointProblem(prevEnd, P, prevKind = 'legacy') {
  const h = P.knots.length ? P.knots[0] : P.length, kind = kindOf(P);
  for (const ch of CHANNELS) {
    if (ch === 'c') {   // cup ↔ cup: C1 like the others; two different kinds (legacy, cup, tube): the RENDERED edge must be continuous (0.05°); two legacy or two tube pieces: nothing here (t is checked below)
      if (prevKind === 'cup' && kind === 'cup') { /* falls through to the general test */ }
      else if (prevKind !== kind) {
        const here = kind === 'tube' ? P.channels.t[0] / 2 : kind === 'cup' ? P.channels.c[0] : legacyEdgeDeg(P.family, P.channels.w[0], P.channels.r[0]);
        if (Math.abs(here - prevEnd.c.v) > CUP_JOINT_DEG) return `the ${kind === 'tube' ? 'tube' : 'cup'} starts at an edge of ${here}°, the previous piece ends at ${prevEnd.c.v}° (a piece of another kind hands over the edge it renders; a tube's is t/2)`;
        continue;
      } else continue;
    }
    if (ch === 't' && !(prevKind === 'tube' && kind === 'tube')) continue;   // the sweep joins only tube to tube (a tube after another kind is matched by its rendered edge above)
    if (ch === 's' && Math.abs(prevEnd.e.v) < EDGE_EPS && Math.abs((P.channels.e || [0])[0]) < EDGE_EPS) continue;   // the slice is invisible while e is 0 on both sides of the joint
    const c = P.channels[ch] || [OPT_DEFAULT[ch], OPT_DEFAULT[ch]], v = c[0], m = (3 * (c[1] - c[0])) / h, qv = 10 ** -DEC[ch];   // a hand-built piece may lack an optional channel: its default
    if (Math.abs(v - prevEnd[ch].v) > 1.01 * qv) return `${ch} starts at ${v}, the previous piece ends at ${prevEnd[ch].v}`;
    const slopeTol = (6 * qv) / Math.min(h, 1) + 6 * qv * Math.abs(prevEnd[ch].m);
    if (Math.abs(m - prevEnd[ch].m) > slopeTol) return `${ch} starts with slope ${m}, the previous piece ends with ${prevEnd[ch].m}`;
  }
  return null;
}
/** The tube's own domain (D225): the sweep in [0, 360], and not HELD where the two tips are closer than the downforce ray reaches (every control point in the band). */
function checkTube(P, at) {
  const t = P.channels.t, w = P.channels.w;
  if (t.some((v) => v < -EDGE_EPS || v > TUBE_MAX + EDGE_EPS)) throw new CoreError('BAD_TUBE', `${at}: the tube sweep must stay within 0 to ${TUBE_MAX}°, but a control point is ${Math.min(...t)} to ${Math.max(...t)}°`);
  if (t.every((v, i) => v > tubeSlotMinDeg(w[i]) + 1e-6 && v < TUBE_MAX - 1e-6)) throw new CoreError('BAD_TUBE', `${at}: a tube held at ${Math.min(...t).toFixed(2)}° to ${Math.max(...t).toFixed(2)}° leaves a slot under ${MACH6.downforceRay.aheadM} m between its tips, which the car's downforce ray falls through (a sweep below ${tubeSlotMinDeg(Math.max(...w)).toFixed(1)}° is open, 360° is closed; pass through the band, do not stay in it)`);
}
/**
 * The edge's own domain (D225, seal V4 and E2): e >= 0, s in [0.5, 0.95], and the total edge angle (the middle profile's edge angle plus e) within the cap: CUP_MAX = 150 on a legacy
 * or cup piece, 180 on an open tube (t/2 + e), each bound on the CONTROL POINTS by the convex hull (ref 03 §1b). A closed tube takes no edge: the edge is moot there.
 */
function checkEdge(P, at) {
  const e = P.channels.e, s = P.channels.s;
  if (e.some((v) => v < -EDGE_EPS)) throw new CoreError('BAD_EDGE', `${at}: the edge angle e must be 0 or more, but a control point is ${Math.min(...e)}° (an outer zone that flattens, a lip, is not in this version)`);
  if (s.some((v) => v < S_MIN - EDGE_EPS || v > S_MAX + EDGE_EPS)) throw new CoreError('BAD_EDGE', `${at}: the edge start s must stay within ${S_MIN} to ${S_MAX} of the half-width, but a control point is ${Math.min(...s)} to ${Math.max(...s)}`);
  if (P.tube) {
    const t = P.channels.t;
    if (t.some((v) => v >= TUBE_MAX - 1e-9) && e.some((v) => v > EDGE_EPS)) throw new CoreError('BAD_TUBE', `${at}: a tube that closes (a sweep of ${TUBE_MAX}°) takes no edge: with the section closed the edge curve has no edge to act on`);
    t.forEach((v, i) => { if (v / 2 + e[i] > TUBE_EDGE_MAX + EDGE_EPS) throw new CoreError('BAD_EDGE', `${at}: the tube's edge angle t/2 plus e is ${v / 2 + e[i]}° at a control point, past ${TUBE_EDGE_MAX}° (the walls of a tube with an edge would touch)`); });
  } else if (P.cup) {
    P.channels.c.forEach((v, i) => { if (v + e[i] > CUP_MAX + EDGE_EPS) throw new CoreError('BAD_EDGE', `${at}: the cup's edge angle c plus e is ${v + e[i]}° at a control point, past ${CUP_MAX}° (the walls of a ${CUP_MAX}°+ bowl touch)`); });
  } else {
    const mid = legacyEdgeDeg(P.family, Math.max(...P.channels.w), Math.max(...P.channels.r)) + Math.max(...e);
    if (mid > CUP_MAX + EDGE_EPS) throw new CoreError('BAD_EDGE', `${at}: the road's edge angle plus e reaches ${mid.toFixed(3)}°, past ${CUP_MAX}° (the walls of a ${CUP_MAX}°+ bowl touch)`);
  }
}
function checkDoc(doc) {
  const bad = (msg) => { throw new CoreError('BAD_DOC', msg); };
  if (!doc || doc.schema !== SCHEMA) bad(`schema must be ${SCHEMA}, got ${doc && doc.schema}`);
  if (typeof doc.name !== 'string') bad('name must be a string');
  if (typeof doc.closed !== 'boolean') bad('closed must be true or false');
  if (!doc.start || !Array.isArray(doc.start.pos) || doc.start.pos.length !== 3 || !doc.start.pos.every(Number.isFinite) || !Number.isFinite(doc.start.heading) || !Number.isFinite(doc.start.pitch)) bad('start needs pos [x, y, z], heading and pitch');
  if (!Number.isInteger(doc.nextId) || doc.nextId < 1) bad('nextId must be a positive integer');
  if (!Array.isArray(doc.pieces)) bad('pieces must be an array');
  if (doc.spawns !== undefined) checkSpawns(doc.spawns);
  const ids = new Set(); let prev = null, flight = null;
  doc.pieces.forEach((P, i) => {
    const at = `piece ${i} (${P && P.id})`;
    if (!P || typeof P.id !== 'string' || ids.has(P.id)) bad(`${at}: needs a unique string id`); ids.add(P.id);
    if (P.type === 'flight') {
      if (prev) { const e = pieceEnd(prev); for (const ch of OFFSETS) if (Math.abs(e[ch].v) > 10 ** -DEC[ch] || Math.abs(e[ch].m) > 1e-6) throw new CoreError('FLIGHT_OFFSET', `${at}: ${ch} must fade to 0 (value and slope) before a jump, got ${e[ch].v} m, slope ${e[ch].m}: the adapter cannot lift a jump's gap or its landing ramp`); }
      checkFlight(P, at);
      if (!prev) bad(`${at}: a flight must follow a road piece`);
      // D243 (B's look): LAND ON ROAD FIRST. Two flights in a row would take the second off from the first one's landing ramp, which no road piece
      // describes; jump() never makes one, and an opened or hand-edited file may not hold one either
      if (flight) throw new CoreError('JUMP_AFTER_JUMP', `${at}: two jumps in a row (${doc.pieces[i - 1].id}, then ${P.id}): a jump must land on road before the next one takes off; put a road piece between them`);
      flight = P; return;
    }
    if (P.type !== 'road') bad(`${at}: type must be road or flight, got ${P.type}`);
    if (P.grip !== undefined) checkGrip(P.grip, `${at}: grip`);   // D261
    if (!(P.length > 0)) bad(`${at}: length must be positive`);
    if (!FAMILIES.includes(P.family)) bad(`${at}: family "${P.family}"`);
    if (!Array.isArray(P.knots) || P.knots.some((t, k) => !(t > 0 && t < P.length) || (k && !(t > P.knots[k - 1])))) bad(`${at}: knots must be ascending, strictly inside (0, length)`);
    for (const ch of CHANNELS) { const c = P.channels && P.channels[ch]; if (OPTIONAL[ch] && c === undefined && !P[OPTIONAL[ch]]) continue; if (!Array.isArray(c) || c.length !== P.knots.length + 4 || !c.every(Number.isFinite)) bad(`${at}: channel ${ch} needs ${P.knots.length + 4} finite control points`); }
    if (P.cup !== undefined && P.cup !== true) bad(`${at}: cup is true on a cup piece and absent on a legacy piece, got ${P.cup}`);
    if (P.edge !== undefined && P.edge !== true) bad(`${at}: edge is true on an edge piece and absent otherwise, got ${P.edge}`);
    if (P.tube !== undefined && P.tube !== true) bad(`${at}: tube is true on a tube piece and absent otherwise, got ${P.tube}`);
    if (P.tube && P.cup) throw new CoreError('BAD_TUBE', `${at}: a piece is a cup or a tube, not both`);
    if (P.tube) checkTube(P, at);
    if (P.edge) checkEdge(P, at);
    // a cup piece's c stays in [0, CUP_MAX]: every control point is, so the curve is (its basis is non-negative and sums to 1: the convex hull, ref 03 §1b)
    if (P.cup && P.channels.c.some((v) => v < -CUP_EPS || v > CUP_MAX + CUP_EPS)) throw new CoreError('BAD_CUP', `${at}: the cup must stay within 0 to ${CUP_MAX}°, but a control point is ${Math.min(...P.channels.c)} to ${Math.max(...P.channels.c)}° (the walls of a ${CUP_MAX}°+ bowl touch)`);
    if (prev && flight) {   // D258: a LANDING starts at its flight's pose, not C1 with the take-off: level, at the flight's bank, the rest its own
      const p = landingProblem(flight, P); if (p) throw new CoreError('LANDING', `${at}: ${p}`);
    } else if (prev) {
      const p = jointProblem(pieceEnd(prev), P, kindOf(prev)); if (p) throw new CoreError('JOINT', `${at}: ${p} (every road joint is C1 in every channel, ref 09 §1)`);
    }
    prev = P; flight = null;
  });
  if (doc.nextId <= doc.pieces.reduce((a, P) => Math.max(a, Number(String(P.id).replace(/^p/, '')) || 0), 0)) bad('nextId must exceed every piece id');
  return doc;
}

// ── canonical text ─────────────────────────────────────────────────────────────────────────────────────────────────
const pieceText = (P) => (P.type === 'flight'
  ? JSON.stringify({ id: P.id, type: 'flight', forward: P.forward, left: P.left, up: P.up, heading: P.heading, pitch: P.pitch, bank: P.bank })
  : JSON.stringify({ id: P.id, type: 'road', length: P.length, family: P.family, ...(P.grip !== undefined && P.grip !== GRIP_DEFAULT ? { grip: P.grip } : {}), knots: P.knots, channels: Object.fromEntries(CHANNELS.filter((ch) => !OPTIONAL[ch] || P[OPTIONAL[ch]]).map((ch) => [ch, P.channels[ch]])) }));
function serialize(doc) {
  checkDoc(doc);
  const head = [`  "schema": ${JSON.stringify(doc.schema)}`, `  "generator": ${JSON.stringify(GENERATOR)}`, `  "name": ${JSON.stringify(doc.name)}`, `  "closed": ${doc.closed}`,
    `  "start": ${JSON.stringify({ pos: doc.start.pos, heading: doc.start.heading, pitch: doc.start.pitch })}`, `  "nextId": ${doc.nextId}`,
    ...(doc.spawns !== undefined ? [`  "spawns": ${JSON.stringify(normSpawns(doc.spawns))}`] : [])];
  const body = doc.pieces.length ? `  "pieces": [\n${doc.pieces.map((P) => `    ${pieceText(P)}`).join(',\n')}\n  ]` : '  "pieces": []';
  return `{\n${[...head, body].join(',\n')}\n}\n`;
}
/** A road piece read from text is a cup / edge / tube piece exactly when its text carries a `c` / `e` or `s` / `t` array (the only way the canonical text says so). */
function cupOf(P, out) {
  const has = (...ks) => !!(P && P.channels && ks.some((k) => Array.isArray(P.channels[k])));
  return { ...out, ...(has('c') ? { cup: true } : {}), ...(has('e', 's') ? { edge: true } : {}), ...(has('t') ? { tube: true } : {}) };
}
/** One channel of a parsed road piece: the text's array, quantised; an optional channel the text lacks takes its default (an edge piece may carry e without s or s without e); a /1 file's offsets are zeros. */
function parseChannel(P, ch, upgrade) {
  const have = (k) => Array.isArray((P.channels || {})[k]), n = (P.knots || []).length + 4;
  if (upgrade && OFFSETS.includes(ch)) return new Array(n).fill(0);
  if (OPTIONAL[ch] && !have(ch)) return new Array(n).fill(OPT_DEFAULT[ch]);
  return ((P.channels || {})[ch] || []).map((x) => q(x, DEC[ch]));
}
/** Parse a document; every number is quantised as it enters, so a hand-edited value finer than its quantum is snapped. */
function parse(text) {
  let o; try { o = JSON.parse(text); } catch (e) { throw new CoreError('BAD_JSON', e.message); }
  if (!o || (o.schema !== SCHEMA && !OLD_SCHEMAS.includes(o.schema))) throw new CoreError('BAD_DOC', `schema must be ${SCHEMA} (or an older ${OLD_SCHEMAS.join(', ')}), got ${o && o.schema} (a newer file needs a newer builder)`);
  const upgrade = o.schema === 't180b.core/1';   // a core/1 file has no offsets: they are zero, one per control point; core/1 and /2 have no cup: legacy pieces
  const read = (o.pieces || []).map((P) => (P && P.type === 'flight'
    ? (P.gap !== undefined || P.drop !== undefined || P.land !== undefined ? { id: P.id, type: 'flight', old: { gap: q(P.gap, DEC.m), drop: q(P.drop, DEC.m), land: q(P.land, DEC.rad) } } : { ...flightPiece(P), id: P.id })
    : cupOf(P, { id: P.id, type: P.type, length: q(P.length, DEC.m), family: P.family, ...(P && P.grip !== undefined && P.grip !== GRIP_DEFAULT ? { grip: checkGrip(P.grip, `piece ${P.id}: grip`) } : {}), knots: (P.knots || []).map((t) => q(t, DEC.m)),
      channels: Object.fromEntries(CHANNELS.map((ch) => [ch, parseChannel(P, ch, upgrade)])) })));
  const s = o.start || {}, start = { pos: (s.pos || []).map((x) => q(x, DEC.m)), heading: q(s.heading, DEC.rad), pitch: q(s.pitch, DEC.rad) };
  return deepFreeze(checkDoc({ schema: SCHEMA, generator: GENERATOR, name: o.name, closed: o.closed, start, nextId: o.nextId, pieces: convertOldFlights(read, start),
    ...(o.spawns !== undefined ? { spawns: normSpawns(o.spawns) } : {}) }));
}

/**
 * D258: an OLD flight (D243's { gap, drop, land }: a solved flight plus a landing ramp the adapter generated, sized at the design speed) opens as the FREE
 * flight that lands where the road after it already was: at the END of that ramp. The ramp was `gap` along the ground and `drop` down to the lip, then a
 * horizontal landingRamp(...).length more at the landing pitch, sized from the take-off's pitch, which is reckoned here by the adapter's own rule (pitch
 * rate linear over 2 m chords). Nothing turns; the bank is the take-off's, as the road after it already carried. So every road piece keeps its place (a
 * closed lap still closes) and the generated ramp becomes air: the car now lands on the road that followed it. No keeper track or saved piece held one (checked).
 */
function convertOldFlights(pieces, start) {
  if (!pieces.some((P) => P && P.type === 'flight' && P.old)) return pieces;
  const { landingRamp } = require('../validate/jumps.js');
  let pitch = start.pitch, prev = null;
  return pieces.map((P) => {
    if (!P || P.type !== 'flight') {
      if (P && P.type === 'road' && P.length > 0 && Array.isArray(P.knots)) {
        const n = Math.max(1, Math.ceil(P.length / 2 - 1e-9)); let a = valuesAt(P, 0);
        for (let j = 0; j < n; j++) { const s0 = (P.length * j) / n, s1 = (P.length * (j + 1)) / n, b = valuesAt(P, s1); pitch += ((a.kv + b.kv) / 2) * (s1 - s0); a = b; }
      }
      prev = P; return P;
    }
    if (!P.old) { pitch = P.pitch; prev = P; return P; }
    const { gap, drop, land } = P.old;
    if (!(gap > 0) || !Number.isFinite(drop) || !(Math.abs(land) < Math.PI / 2)) throw new CoreError('BAD_FLIGHT', `piece ${P.id}: an old flight needs gap > 0, drop and a landing pitch short of vertical`);
    if (!prev || prev.type !== 'road') throw new CoreError('BAD_DOC', `piece ${P.id}: a flight must follow a road piece`);
    const r = landingRamp({ D: gap, dh: -drop, thetaRad: pitch, landRad: land, v: MACH6.designSpeedKmh / 3.6 }).length;
    const out = { ...flightPiece({ forward: gap + r, left: 0, up: -drop + r * Math.tan(land), heading: 0, pitch: land, bank: pieceEnd(prev).phi.v }), id: P.id };
    pitch = out.pitch; prev = out; return out;
  });
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
 * A jump joint becomes a FREE flight (D258): the landing point's place in the take-off's heading frame, the turn between their headings, the landing's
 * pitch and bank, so the line after a jump starts where the real track's does (no generated ramp any more).
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
      const tha = Math.atan2(a.T[0], a.T[2]), thb = Math.atan2(b.T[0], b.T[2]), d = sub(b.r, a.r), dh = thb - tha;
      const prevPhi = endState(doc).phi.v, bank = b.phi + 2 * Math.PI * Math.round((prevPhi - b.phi) / (2 * Math.PI));
      doc = appendPiece(doc, flightPiece({ forward: d[0] * Math.sin(tha) + d[2] * Math.cos(tha), left: d[0] * Math.cos(tha) - d[2] * Math.sin(tha), up: d[1], heading: Math.atan2(Math.sin(dh), Math.cos(dh)), pitch: b.p, bank }));
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
    if (OPTIONAL[ch] && P.channels[ch] === undefined && !P[OPTIONAL[ch]]) continue;
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
  OPTIONAL, OPT_DEFAULT, EDGE_EPS, S_MIN, S_MAX, S_DEFAULT, TUBE_MAX, TUBE_EDGE_MAX, kindOf, endKind, tubeSlotMinDeg,
  checkSpawns, normSpawns, setSpawns, SPAWN_COUNT_MAX, SPAWN_GAP_MAX,
  createDoc, roadPiece, flightPiece, GRIP_MIN, GRIP_MAX, GRIP_DEFAULT, gripOf, checkGrip, withGrip, setGrip, FLIGHT_POSE, FLIGHT_MIN_M, LANDING_DEFAULT, afterFlight, appendPiece, endState, pieceEnd, channelAt, valuesAt, knotVector, evenKnots, fitChannel, checkDoc,
  serialize, parse, createHistory, commit, beginDrag, dragTo, endDrag, undo, redo,
};
