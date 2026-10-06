// piece.js: SAVED PIECES for the equation core (D240, the keeper: "can we keep only the equation mode? And then we can save pieces from that we make").
// A saved piece is one road piece, or a RUN of consecutive pieces (roads, and the flights between them), taken out of a core document and kept in a file that can be put back at
// the head of any open track. This file is the CORE only: no UI, no files on disk (the library list, "Save as piece...", rename and delete are the app's, after D239).
//
//   saveRun(doc, from, to, { name })        the run doc.pieces[from..to] (inclusive) as a piece: schema t180b.piece/1; on a closed lap from > to is the run across
//                                           the start line (D250 item 4), or SEAM_RUN when the road is not smooth across the line
//   serialize(piece) / parse(text)          the canonical text, and the checked piece read back from it (refused BY NAME when malformed)
//   checkPiece(piece)                       every rule the text must meet, on an object
//   insert(doc, piece, { mirror, keepStart }) the run added at the head: a new document (the old one is untouched)
//   mirrored(piece)                         the piece's left/right mirror image (kh, phi and l negated)
//   summary(piece)                          { pieces, roads, flights, kind, lengthM, turnDeg, climbDeg } for a library list
//
// THE RELATIVE FORM (the plan's rule, plan_t180_equation_only_pieces_2026-10-04.md, D240). A piece is stored relative to its OWN START, so it can start anywhere:
//   · TURN and CLIMB are RATES (kh, kv) and so are the two OFFSET channels (h, l, a hill and a swerve off the base line): stored as the document holds them, because each is a
//     property of the road and not a state that accumulates. (The plan names turn and climb; the offsets are the same kind of thing and are treated alike: a hill saved as
//     "10 m up and down" is that wherever it is put.)
//   · BANK (phi), WIDTH (w), the wall's rise (r), the CUP (c), the EDGE (e and s) and the TUBE sweep (t) are STATES: stored as their CHANGE from the run's first start value
//     (so each channel's first control point is 0), plus the start values themselves (`start`). Added at a head, the run's start becomes the head's end value and the change is
//     kept: a cup that went 15° to 60° (+45°) added where the cup is 30° goes 30° to 75°.
//   · THE JOINT IS C1, as Extend's is: every channel's first two control points are the head's end value and slope carried on (value + slope·span/3, ref 09 §1); the control
//     points after them are the saved ones (shifted, for a state). "keepStart" adds the pieces exactly as saved instead, and the document's own joint check decides (PIECE_START).
//   · WHEN THE RUN ALREADY JOINS THE HEAD (the same start: its values and slopes meet the head's within the document's own joint tolerance) it is added EXACTLY AS SAVED, not
//     recomputed: a track built from a saved and re-inserted run is then the same document as the one built by hand, and exports the same bytes (test/core_piece.test.js).
//   · MIRROR (left/right): kh, phi and l are negated (their raw arrays, or their change and start); everything else is symmetric. Mirror of mirror is the original, exactly.
// A RUN IS ONE CROSS-SECTION KIND (legacy, cup or tube, with or without an edge): a state shifted to meet a head cannot keep a legacy piece's drawn edge (a function of w and r)
// equal to a neighbouring cup's c at their joint, so a mixed run is refused at save (MIXED_RUN); save each kind's run on its own. The keeper's tracks are single-kind.
// Nothing here writes a document the document would refuse: every piece goes through D.appendPiece, whose checkDoc (joints, cup, tube and edge limits, flights) has the last word.
'use strict';

const D = require('./document.js');

const SCHEMA = 't180b.piece/1', GENERATOR = 't180-track-builder/core 0.3.0';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/;   // the shell's NAME_RE (app/core/coreshell.js): a piece name becomes a file name, so no path can ride in it
const RATE = Object.freeze(['kh', 'kv', 'h', 'l']);      // stored as the document holds them
const STATE = Object.freeze(['phi', 'w', 'r', 'c', 'e', 's', 't']);   // stored as their change from the run's start
const NEGATED = Object.freeze(['kh', 'phi', 'l']);        // what a left/right mirror flips
const MAX_CHARS = 8e6, MAX_PIECES = 2000, MAX_KNOTS = 4000;   // a text, a run and a piece's knots: far above any real track (a 1 km piece has 49 knots), far below a denial of service
const TOP_KEYS = Object.freeze(['schema', 'generator', 'name', 'start', 'pieces']);
// the cup, edge and tube flags are IMPLIED by the channel arrays in the text (as in a document's); a piece object may carry them (checkPiece's own output does), if they agree with the arrays
const ROAD_KEYS = Object.freeze(['type', 'length', 'family', 'knots', 'channels', 'cup', 'edge', 'tube']), FLIGHT_KEYS = Object.freeze(['type', 'gap', 'drop', 'land']);

const err = (code, msg) => new D.CoreError(code, msg);
const q = (x, dec) => { const v = Number(x.toFixed(dec)); return Object.is(v, -0) ? 0 : v; };
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };
const hasChannel = (P, ch) => !(D.OPTIONAL[ch] && !P[D.OPTIONAL[ch]]);
const isRoad = (P) => P.type === 'road';
/** One cross-section signature for a whole run: 'legacy', 'cup' or 'tube', plus '+edge' for a piece with an edge. */
const signature = (P) => D.kindOf(P) + (P.edge ? '+edge' : '');
const checkName = (name) => { if (typeof name !== 'string' || !NAME_RE.test(name)) throw err('BAD_PIECE_NAME', `a piece name is 1 to 60 letters, digits, spaces, _ or -, starting with a letter or digit; got ${JSON.stringify(name)}`); };

// ── save ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The pieces of a run in lap order. ACROSS THE START LINE of a CLOSED lap (D250 item 4, the keeper: "Short way across start"; from > to) it is pieces from..last, then
 * 0..to. The bank may have turned whole times round the lap (TEST 1 ends at -4π: two rolls), so the pieces after the line get the lap's bank winding added, the same
 * whole turns close.js forgives at the seam (`bank - TAU * m`, close.js residual): the road leans the same way either side, and the joint is C1 as written.
 */
function runOf(doc, from, to) {
  if (from <= to) return doc.pieces.slice(from, to + 1);
  const n = doc.pieces.length, last = doc.pieces[n - 1], first = doc.pieces[0];
  let wind = 0;
  if (isRoad(last) && isRoad(first)) { const d = D.pieceEnd(last).phi.v - first.channels.phi[0], k = Math.round(d / (2 * Math.PI)); if (k !== 0 && Math.abs(d - 2 * Math.PI * k) < 1e-6) wind = d; }
  const after = doc.pieces.slice(0, to + 1).map((P) => (isRoad(P) && wind ? { ...P, channels: { ...P.channels, phi: P.channels.phi.map((v) => q(v + wind, D.DEC.phi)) } } : P));
  return [...doc.pieces.slice(from), ...after];
}
/** The run doc.pieces[from..to] (inclusive; `to` defaults to `from`: one piece) as a saved piece called `name`; on a CLOSED lap, from > to is the run across the start line. The document is not changed. */
function saveRun(doc, from, to = from, { name } = {}) {
  checkName(name);
  if (!doc || !Array.isArray(doc.pieces)) throw err('BAD_DOC', 'saveRun needs a core document');
  const n = Array.isArray(doc.pieces) ? doc.pieces.length : 0, wrap = !!doc.closed && Number.isInteger(from) && Number.isInteger(to) && to < from;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n || (to < from && !wrap)) throw err('BAD_RANGE', `the run must be pieces from..to of this track (0..${n - 1}, from <= to; from > to only across the start line of a closed lap), got ${from}..${to}`);
  const run = runOf(doc, from, to), roads = run.filter(isRoad);
  if (!roads.length) throw err('NO_ROAD', 'a run of flights alone has no road to save: a jump is saved with the road around it');
  const sig = signature(roads[0]);
  if (roads.some((P) => signature(P) !== sig)) throw err('MIXED_RUN', `the run mixes cross-sections (${[...new Set(roads.map(signature))].join(', ')}): a saved run is one kind, legacy, cup or tube (with or without an edge); save each kind's run on its own`);
  const first = roads[0], start = {};
  for (const ch of STATE) if (hasChannel(first, ch)) start[ch] = q(first.channels[ch][0], D.DEC[ch]);
  const pieces = run.map((P) => {
    if (!isRoad(P)) return { type: 'flight', gap: P.gap, drop: P.drop, land: P.land };
    const channels = {};
    for (const ch of D.CHANNELS) { if (!hasChannel(P, ch)) continue; channels[ch] = STATE.includes(ch) ? P.channels[ch].map((v) => q(v - start[ch], D.DEC[ch])) : P.channels[ch].slice(); }
    return { type: 'road', length: P.length, family: P.family, knots: P.knots.slice(), channels, ...(P.cup ? { cup: true } : {}), ...(P.edge ? { edge: true } : {}), ...(P.tube ? { tube: true } : {}) };
  });
  try { return freeze(checkPiece({ schema: SCHEMA, generator: GENERATOR, name, start, pieces })); } catch (e) {
    // every joint inside the lap was already C1, so across the start line a JOINT can only be the line itself (a step the close does not solve, as a cup against a legacy start)
    if (wrap && e.code === 'JOINT') throw err('SEAM_RUN', `this run crosses the lap's start line, and the road is not smooth across it (${e.message}), so it cannot be kept as one piece; save the pieces on each side of the line on their own`);
    throw e;
  }
}

// ── the absolute pieces a saved piece stands for ───────────────────────────────────────────────────────────────────────
/** The run as document pieces (no ids), a state channel put back on its start: q(change + start). Exactly what was saved when nothing is shifted. */
function absolute(piece, shifts = null) {
  return piece.pieces.map((P) => {
    if (!isRoad(P)) return { type: 'flight', gap: P.gap, drop: P.drop, land: P.land };
    const channels = {};
    for (const ch of D.CHANNELS) {
      const c = P.channels[ch]; if (c === undefined) continue;
      const base = STATE.includes(ch) ? (shifts ? shifts[ch] : piece.start[ch]) : 0;
      channels[ch] = STATE.includes(ch) ? c.map((v) => q(v + base, D.DEC[ch])) : c.slice();
    }
    for (const ch of Object.keys(D.OPTIONAL)) if (!P[D.OPTIONAL[ch]]) channels[ch] = new Array(P.knots.length + 4).fill(D.OPT_DEFAULT[ch]);   // a piece without the channel: its default, as roadPiece and parse make it (never rendered)
    return { type: 'road', length: P.length, family: P.family, knots: P.knots.slice(), channels, ...(P.cup ? { cup: true } : {}), ...(P.edge ? { edge: true } : {}), ...(P.tube ? { tube: true } : {}) };
  });
}

// ── checks ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A piece object, checked (and quantised: every number as it enters, like a document). Returns it; throws a CoreError with a code that names the fault. */
function checkPiece(piece) {
  const bad = (code, msg) => { throw err(code, msg); };
  if (!piece || typeof piece !== 'object' || Array.isArray(piece)) bad('BAD_PIECE_FIELD', 'a piece is an object');
  if (piece.schema !== SCHEMA) bad('BAD_PIECE_SCHEMA', `schema must be ${SCHEMA}, got ${JSON.stringify(piece.schema)}${typeof piece.schema === 'string' && /^t180b\.core\//.test(piece.schema) ? ' (that is a whole track, not a piece)' : typeof piece.schema === 'string' && /^t180b\.piece\//.test(piece.schema) ? ' (a newer piece needs a newer builder)' : ''}`);
  for (const k of Object.keys(piece)) if (!TOP_KEYS.includes(k)) bad('BAD_PIECE_FIELD', `unknown field "${k}" (a /1 piece has ${TOP_KEYS.join(', ')}): refused rather than dropped on the next save`);
  if (piece.generator !== undefined && typeof piece.generator !== 'string') bad('BAD_PIECE_FIELD', 'generator must be a string');
  checkName(piece.name);
  if (!Array.isArray(piece.pieces) || !piece.pieces.length || piece.pieces.length > MAX_PIECES) bad('BAD_PIECE_RUN', `pieces must be a list of 1 to ${MAX_PIECES} road or flight pieces`);
  if (!piece.start || typeof piece.start !== 'object' || Array.isArray(piece.start)) bad('BAD_PIECE_START', 'start must be an object of the state channels\' first values');
  const roads = piece.pieces.filter((P) => P && P.type === 'road');
  if (!roads.length) bad('NO_ROAD', 'a run needs at least one road piece');
  const flagsOf = (P) => ({ cup: !!(P.channels && Array.isArray(P.channels.c)), edge: !!(P.channels && (Array.isArray(P.channels.e) || Array.isArray(P.channels.s))), tube: !!(P.channels && Array.isArray(P.channels.t)) });
  const out = { schema: SCHEMA, generator: GENERATOR, name: piece.name, start: {}, pieces: [] };
  piece.pieces.forEach((P, i) => {
    const at = `piece ${i}`;
    if (!P || typeof P !== 'object' || Array.isArray(P)) bad('BAD_PIECE_FIELD', `${at}: must be an object`);
    if (P.type === 'flight') {
      for (const k of Object.keys(P)) if (!FLIGHT_KEYS.includes(k)) bad('BAD_PIECE_FIELD', `${at}: unknown field "${k}" in a flight`);
      for (const k of ['gap', 'drop', 'land']) if (!isNum(P[k])) bad('BAD_PIECE_NUMBER', `${at}: a flight's ${k} must be a finite number, got ${JSON.stringify(P[k])}`);
      if (!(P.gap > 0)) bad('BAD_PIECE_NUMBER', `${at}: a flight needs gap > 0, got ${P.gap}`);
      out.pieces.push({ type: 'flight', gap: q(P.gap, D.DEC.m), drop: q(P.drop, D.DEC.m), land: q(P.land, D.DEC.rad) }); return;
    }
    if (P.type !== 'road') bad('BAD_PIECE_FIELD', `${at}: type must be road or flight, got ${JSON.stringify(P.type)}`);
    for (const k of Object.keys(P)) if (!ROAD_KEYS.includes(k)) bad('BAD_PIECE_FIELD', `${at}: unknown field "${k}" in a road piece (a cup, edge or tube is carried by its channel arrays)`);
    if (!isNum(P.length) || !(P.length > 0)) bad('BAD_PIECE_NUMBER', `${at}: length must be a positive finite number, got ${JSON.stringify(P.length)}`);
    if (!D.FAMILIES.includes(P.family)) bad('BAD_PIECE_FIELD', `${at}: family must be one of ${D.FAMILIES.join(', ')}, got ${JSON.stringify(P.family)}`);
    if (!Array.isArray(P.knots) || P.knots.length > MAX_KNOTS || !P.knots.every(isNum)) bad('BAD_PIECE_KNOTS', `${at}: knots must be a list of at most ${MAX_KNOTS} finite numbers`);
    const length = q(P.length, D.DEC.m), knots = P.knots.map((t) => q(t, D.DEC.m));
    if (knots.some((t, k) => !(t > 0 && t < length) || (k && !(t > knots[k - 1])))) bad('BAD_PIECE_KNOTS', `${at}: knots must be ascending and strictly inside (0, ${length})`);
    if (!P.channels || typeof P.channels !== 'object' || Array.isArray(P.channels)) bad('BAD_PIECE_CHANNEL', `${at}: channels must be an object`);
    for (const k of Object.keys(P.channels)) if (!D.CHANNELS.includes(k)) bad('BAD_PIECE_CHANNEL', `${at}: no channel "${k}" (known: ${D.CHANNELS.join(', ')})`);
    const f = flagsOf(P);
    for (const k of ['cup', 'edge', 'tube']) if (P[k] !== undefined && (P[k] !== true || !f[k])) bad('BAD_PIECE_CHANNEL', `${at}: ${k} is true only on a piece that carries its channel arrays, got ${JSON.stringify(P[k])}`);
    if (f.cup && f.tube) bad('BAD_PIECE_CHANNEL', `${at}: a piece is a cup or a tube, not both (it carries both c and t)`);
    if ((P.channels.e === undefined) !== (P.channels.s === undefined)) bad('BAD_PIECE_CHANNEL', `${at}: an edge piece carries both e and s, or neither`);
    const channels = {};
    for (const ch of D.CHANNELS) {
      const c = P.channels[ch];
      if (D.OPTIONAL[ch] && !f[D.OPTIONAL[ch]]) { if (c !== undefined) bad('BAD_PIECE_CHANNEL', `${at}: channel ${ch}`); continue; }
      if (!Array.isArray(c) || c.length !== knots.length + 4) bad('BAD_PIECE_CHANNEL', `${at}: channel ${ch} needs ${knots.length + 4} control points (the knots make ${knots.length + 4}), got ${Array.isArray(c) ? c.length : JSON.stringify(c)}`);
      if (!c.every(isNum)) bad('BAD_PIECE_NUMBER', `${at}: channel ${ch} has a control point that is not a finite number`);
      channels[ch] = c.map((v) => q(v, D.DEC[ch]));
      if (STATE.includes(ch) && channels[ch][0] !== 0 && roads[0] === P) bad('BAD_PIECE_CHANNEL', `${at}: the first piece's ${ch} change must start at 0 (it is stored as the change from the run's start), got ${channels[ch][0]}`);
    }
    out.pieces.push({ type: 'road', length, family: P.family, knots, channels, ...(f.cup ? { cup: true } : {}), ...(f.edge ? { edge: true } : {}), ...(f.tube ? { tube: true } : {}) });
  });
  const first = out.pieces.find(isRoad), sig = signature(first);
  if (out.pieces.filter(isRoad).some((P) => signature(P) !== sig)) bad('MIXED_RUN', 'the run mixes cross-sections (legacy, cup, tube, with or without an edge): a saved run is one kind');
  const want = D.CHANNELS.filter((ch) => STATE.includes(ch) && hasChannel(first, ch));
  for (const k of Object.keys(piece.start)) if (!want.includes(k)) bad('BAD_PIECE_START', `start has "${k}", which this ${sig} run does not carry (it needs ${want.join(', ')})`);
  for (const ch of want) { const v = piece.start[ch]; if (!isNum(v)) bad('BAD_PIECE_START', `start needs a finite ${ch} (the run carries it), got ${JSON.stringify(v)}`); out.start[ch] = q(v, D.DEC[ch]); }
  // the run as the document would hold it: its own joints (C1 in every channel), cup, tube and edge limits, flights, all by the document's own checks.
  // ONE checkDoc of the assembled run (C's D240 F1): appending piece by piece re-checked the whole growing document each time, so the time grew with
  // the square of the run (800 pieces took about 1 s). appendPiece adds nothing checkDoc lacks here: its CLOSED check cannot fire on this fresh scratch
  // document, and the ids and nextId are the ones it would have given (p1..pN, N + 1). checkDoc walks the pieces in order and judges each one against
  // the one before it only, so the first failure, its code and its message are the same.
  const i0 = out.pieces.indexOf(first), run = absolute(out).slice(i0).map((P, k) => ({ ...P, id: `p${k + 1}` }));
  // LAND ON ROAD FIRST (D243) for the flights BEFORE the first road too, which the check below never sees: refused when the file is read, so the library lists why
  if (i0 > 1) bad('JUMP_AFTER_JUMP', `piece 1: the run starts with ${i0} jumps in a row: a jump must land on road before the next one takes off; put a road piece between them`);
  D.checkDoc({ ...D.createDoc('piece check'), nextId: run.length + 1, pieces: run });
  return out;
}

// ── text ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const roadText = (P) => JSON.stringify({ type: 'road', length: P.length, family: P.family, knots: P.knots, channels: Object.fromEntries(D.CHANNELS.filter((ch) => P.channels[ch] !== undefined).map((ch) => [ch, P.channels[ch]])) });
const pieceText = (P) => (isRoad(P) ? roadText(P) : JSON.stringify({ type: 'flight', gap: P.gap, drop: P.drop, land: P.land }));
/** The canonical text of a piece (checked first): stable key order, one piece to a line, a final newline. */
function serialize(piece) {
  const p = checkPiece(piece), start = Object.fromEntries(D.CHANNELS.filter((ch) => p.start[ch] !== undefined).map((ch) => [ch, p.start[ch]]));
  const head = [`  "schema": ${JSON.stringify(SCHEMA)}`, `  "generator": ${JSON.stringify(GENERATOR)}`, `  "name": ${JSON.stringify(p.name)}`, `  "start": ${JSON.stringify(start)}`];
  return `{\n${[...head, `  "pieces": [\n${p.pieces.map((P) => `    ${pieceText(P)}`).join(',\n')}\n  ]`].join(',\n')}\n}\n`;
}
/** A piece from its text. Refused BY NAME when it is not JSON, not the /1 schema, has an unknown field, a bad name, a missing or short channel, a non-number, a mixed run, or a run the document itself would refuse. */
function parse(text) {
  if (typeof text !== 'string') throw err('BAD_PIECE_JSON', 'a piece file is text');
  if (text.length > MAX_CHARS) throw err('BAD_PIECE_SIZE', `a piece file is at most ${MAX_CHARS} characters, this is ${text.length}`);
  let o; try { o = JSON.parse(text); } catch (e) { throw err('BAD_PIECE_JSON', e.message); }
  return freeze(checkPiece(o));
}

// ── mirror ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The left/right mirror image of a piece: kh (turn), phi (bank) and l (a swerve) negated, in their raw arrays or, for the bank, in its change and its start. Mirror of mirror is the piece itself. */
function mirrored(piece) {
  const neg = (a) => a.map((v) => (v === 0 ? 0 : -v));
  const start = { ...piece.start }; if (start.phi !== undefined) start.phi = start.phi === 0 ? 0 : -start.phi;
  const pieces = piece.pieces.map((P) => {
    if (!isRoad(P)) return P;
    const channels = { ...P.channels }; for (const ch of NEGATED) if (channels[ch] !== undefined) channels[ch] = neg(channels[ch]);
    return { ...P, channels };
  });
  return freeze({ ...piece, start, pieces });
}

// ── insert ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The run made to start where the head ends: a state shifted to the head's value, and every channel's first two control points the head's value and slope carried on (C1). */
function continued(p, head) {
  const i0 = p.pieces.findIndex(isRoad), after = i0 > 0;
  const want = after ? { ...head, kh: { v: 0, m: 0 }, kv: { v: 0, m: 0 }, h: { v: 0, m: 0 }, l: { v: 0, m: 0 } } : head;   // a jump between the head and the road: level, no offset, the rest carried
  const at = (ch) => (ch === 't' ? want.tNext : want[ch]);   // a tube started after any piece continues from tNext (endState reports t only at a tube head)
  const shifts = Object.fromEntries(STATE.filter((ch) => p.start[ch] !== undefined).map((ch) => [ch, at(ch).v]));
  const out = absolute(p, shifts), first = out[i0], h1 = first.knots.length ? first.knots[0] : first.length;
  for (const ch of D.CHANNELS) {
    if (!hasChannel(first, ch)) continue;   // an unflagged piece's default array is not the head's to continue
    const { v, m } = at(ch), c = first.channels[ch]; c[0] = q(v, D.DEC[ch]); c[1] = q(v + (m * h1) / 3, D.DEC[ch]);
  }
  return out;
}
/**
 * The run added at the open end of `doc`: a NEW document (the old one is untouched), each piece through D.appendPiece so the document's own checks have the last word. `mirror`
 * adds the left/right mirror image. `keepStart` adds the pieces exactly as saved, with their own start values, instead of continuing from the head (refused by name, PIECE_START, when
 * they do not meet it). On an empty track the run goes in as saved. A legacy piece cannot follow a cup or a tube (Extend never makes that either): PIECE_KIND.
 */
function insert(doc, piece, { mirror = false, keepStart = false } = {}) {
  const p0 = checkPiece(piece), p = mirror ? mirrored(p0) : p0, head = D.endState(doc);
  const add = (pieces) => pieces.reduce((d, P) => D.appendPiece(d, P), doc);
  if (!head) return add(absolute(p));
  if (keepStart) { try { return add(absolute(p)); } catch (e) { if (e.code === 'JOINT') throw err('PIECE_START', `the piece's own start values do not meet the head: ${e.message}; add it without keeping its own start to continue from the head`); throw e; } }
  try { return add(absolute(p)); } catch (e) { if (e.code !== 'JOINT') throw e; }   // already joins the head (the same start): exactly as saved
  const first = p.pieces.find(isRoad);
  if (D.kindOf(first) === 'legacy' && D.endKind(doc) !== 'legacy') throw err('PIECE_KIND', `a legacy piece cannot be added after a ${D.endKind(doc)} piece (the track would have to change cross-section back, which Extend cannot do either); save the run as a ${D.endKind(doc)} piece`);
  return add(continued(p, head));
}

// ── delete ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * `doc.pieces[from..to]` (inclusive; one piece when `to` is left out) taken out: a NEW document; the others keep their ids (nextId is not wound back: an id is never reused). At the open
 * end the pieces are simply removed. In the MIDDLE the two sides must meet C1 again. First the far side is tried exactly as it is (it joins when the deleted run began and ended in the
 * same state: nothing is changed anywhere). Otherwise the far side's FIRST road piece is re-joined the way Extend makes a joint and the librarian matched p7 to p6 in TEST 1's recovery
 * (D190, ref 09 §1): every channel's first two control points become the near side's end value and slope carried on, and NOTHING else changes (that piece's own end, so its joint with the
 * next, and every piece after it are bit for bit as they were: the far side keeps its shape and moves along as one). When that does not make a valid document (a limit, a cup or tube that
 * cannot start there, a jump that needs a level road with no hill or swerve in front of it, a jump with nothing before it) it is REFUSED BY NAME, DELETE_REJOIN, and nothing is reshaped.
 * A closed track has no open end to delete from (CLOSED); a range that is not in the track is BAD_RANGE.
 */
function deleteRun(doc, from, to = from) {
  if (doc.closed) throw err('CLOSED', 'a closed track has no open end; open it first');
  const n = doc.pieces.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= n) throw err('BAD_RANGE', `pieces ${from} to ${to}: the track has pieces 0 to ${n - 1}`);
  const near = doc.pieces.slice(0, from), far = doc.pieces.slice(to + 1), make = (pieces) => freeze(D.checkDoc({ ...doc, pieces }));
  if (!far.length) return make(near);   // the open end: nothing after it to re-join
  let why;
  try { return make([...near, ...far]); } catch (e) { if (!(e instanceof D.CoreError)) throw e; why = e.message; }   // the same state on both sides: as it is
  const head = near.length ? D.endState({ ...doc, pieces: near }) : null;
  if (isRoad(far[0]) && head) {
    const first = JSON.parse(JSON.stringify(far[0])), h1 = first.knots.length ? first.knots[0] : first.length;
    for (const ch of D.CHANNELS) {
      if (!hasChannel(first, ch)) continue;
      const { v, m } = ch === 't' ? head.tNext : head[ch], c = first.channels[ch];
      c[0] = q(v, D.DEC[ch]); c[1] = q(v + (m * h1) / 3, D.DEC[ch]);
    }
    try { return make([...near, first, ...far.slice(1)]); } catch (e) { if (!(e instanceof D.CoreError)) throw e; why = e.message; }
  }
  throw err('DELETE_REJOIN', `the two sides cannot be joined C1 without moving the far side, so nothing was deleted: ${why}`);
}

// ── a library list's numbers ───────────────────────────────────────────────────────────────────────────────────────────
const GL3 = [[-Math.sqrt(0.6), 5 / 9], [0, 8 / 9], [Math.sqrt(0.6), 5 / 9]];   // 3-point Gauss-Legendre: exact for a cubic, which is each span of a channel
function integral(P, ch) {
  const t = [0, ...P.knots, P.length]; let sum = 0;
  for (let j = 0; j + 1 < t.length; j++) { const mid = (t[j] + t[j + 1]) / 2, half = (t[j + 1] - t[j]) / 2; for (const [x, w] of GL3) sum += w * half * D.channelAt(P, ch, mid + half * x).v; }
  return sum;
}
/** { pieces, roads, flights, kind, lengthM (the roads' own length), turnDeg (net heading change, + = left), climbDeg (net pitch change, + = up) } of a piece: the numbers a list shows beside its name. */
function summary(piece) {
  const roads = piece.pieces.filter(isRoad), RAD = 180 / Math.PI;
  return { pieces: piece.pieces.length, roads: roads.length, flights: piece.pieces.length - roads.length, kind: signature(roads[0]), lengthM: roads.reduce((a, P) => a + P.length, 0),
    turnDeg: RAD * roads.reduce((a, P) => a + integral(P, 'kh'), 0), climbDeg: RAD * roads.reduce((a, P) => a + integral(P, 'kv'), 0) };
}

module.exports = { SCHEMA, NAME_RE, RATE, STATE, saveRun, serialize, parse, checkPiece, insert, mirrored, summary, absolute, deleteRun };
