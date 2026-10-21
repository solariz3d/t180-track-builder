// readout.js: what a piece DOES, in numbers a person reads while shaping (ref 09 §8): its length in metres and the change
// it makes in turn, climb (pitch) and bank, in degrees. Pure and headless: it reads the document and computes nothing the
// document does not hold.
//
//   pieceReadout(doc, i)          -> the readout of piece i (0-based)
//   candidateReadout(doc, opts)   -> the readout of the piece extend(doc, opts) would place (the ghost), before it is placed
//
// A ROAD piece's readout:
//   { type: 'road', id, lengthM, turnDeg, climbDeg, bankFromDeg, bankToDeg, cupFromDeg, cupToDeg, edgeFromDeg, edgeToDeg, sliceFrom, sliceTo, tubeFromDeg, tubeToDeg, pitchFromDeg, pitchToDeg, offsets }
//   D225: edgeFrom/To = the edge curve's e at the ends (degrees; 0 on a piece without one), sliceFrom/To = its start s (a share of the half-width; the default 0.64 where there is no edge),
//   tubeFrom/To = the tube's sweep t at the ends (degrees; 0 on a piece that is not a tube). cupFrom/To of a TUBE piece is the edge it renders, t/2. All are read from the DOCUMENT.
//   turnDeg = ∫κh ds (+ = left), climbDeg = ∫κv ds (+ = nosing up): EXACT, by 3-point Gauss–Legendre on each knot span, where
//   the channel is one cubic (ref 09 §8). bankFrom/To = φ at the ends. pitchFrom = the start pitch plus every earlier road
//   piece's climb, a flight setting it to its landing pitch; pitchTo = pitchFrom + climb. cupFrom/To = the cup c(0) and c(L), degrees, of a
//   CUP piece (D190); of a LEGACY piece the edge its road renders, profileAt(family, w, r) at each end (D.legacyEdgeDeg).
//   offsets: null when the piece has no h/l; otherwise the EFFECTIVE { turnDeg, climbDeg, pitchFromDeg, pitchToDeg,
//   roadLengthM } with the lift of ref 09 §7 applied at the ends (a hill that fades inside the piece changes none of them) and
//   the road length over the lifted curve (∫|r̃′| ds by composite Gauss–Legendre, not exact). Bank is not changed by h or l.
// A FLIGHT piece's readout:
//   { type: 'flight', id, lengthM, turnDeg, climbDeg, bankFromDeg, bankToDeg, cupFromDeg, cupToDeg, pitchFromDeg, pitchToDeg, offsets: null, landing }
//   lengthM = the flight's curve across the air, as the adapter builds it (src/core/adapter.js toSegments); turnDeg = the landing's heading turn;
//   climbDeg = landing pitch − take-off pitch; bankTo = the landing's bank. landing (D258) = the pose { forwardM, leftM, upM, headingDeg, pitchDeg,
//   bankDeg } the UI's number boxes show. The cup is the take-off's (the landing's own cross-section is its own piece's).
'use strict';

const D = require('./document.js');
const { extend } = require('./extend.js');
const { extendCorner } = require('./turnby.js');   // D331 B: the ghost is the piece Extend places, the turn field read as a corner or as a rate
const { toSegments } = require('./adapter.js');

const DEG = 180 / Math.PI;
const GL3 = [[-Math.sqrt(3 / 5), 5 / 9], [0, 8 / 9], [Math.sqrt(3 / 5), 5 / 9]];   // WIKI-GAUSS: exact to degree 5
const GL5 = [[-0.9061798459386640, 0.2369268850561891], [-0.5384693101056831, 0.4786286704993665], [0, 0.5688888888888889],
  [0.5384693101056831, 0.4786286704993665], [0.9061798459386640, 0.2369268850561891]];

/** ∫ₐᵇ of one channel of a road piece: 3-point Gauss–Legendre on each knot span inside [a, b], exact for the cubic there (ref 09 §8). */
function channelIntegral(P, ch, a = 0, b = P.length) {
  const t = [0, ...P.knots, P.length]; let sum = 0;
  for (let j = 0; j + 1 < t.length; j++) {
    const lo = Math.max(a, t[j]), hi = Math.min(b, t[j + 1]);
    if (!(hi > lo)) continue;
    const half = (hi - lo) / 2, mid = (hi + lo) / 2;
    for (const [x, w] of GL3) sum += w * half * D.channelValue(P, ch, mid + half * x);
  }
  return sum;
}

// ── THE CORNER (D331, ledger D332: a hand-made "90°" turn on ELYSIUM turned 99.6°, and nothing on screen summed it) ───────────────────────────────────
// The turn channel is a RATE, so a piece eased to one ENDS STILL TURNING, and the next piece spends its first metres easing that rate out. A piece's own turn
// then tells only part of the corner. corner(doc, i) reads the corner piece i belongs to, from the document alone:
//   turnDeg    the heading change from where the road was last straight (κh = 0) to the end of piece i; a piece that ends straight is read up to its turning
//              part's start, so it reports the corner that ended in it. Across pieces and inside them; a flight or the track's start begins a corner.
//   fromId     the piece the corner began in
//   endsTurningDegPer100m   κh at the piece's end, degrees per 100 m (as the Extend field reads), or null when it ends straight
// and cornerNext(doc, i) (below) what comes after a piece that ends turning adds: { nextAddsDeg, nextFrom }:
//   'next piece'          the degrees the next piece turns before it is straight
//   'the corner goes on'  (no degrees) the next piece never goes straight
//   'turn 0 at start'     at the open end, what the panel's "turn 0, at start" would add (a 20 m ramp, app/core/panel.js:49 AT_START_M)
// null when the piece neither turns nor ends a corner. Straight is |κh| < 1e-9 rad/m (κh is stored to 1e-9), found on a 0.25 m scan.
const STRAIGHT = 1e-9, SCAN_M = 0.25, AT_START_M = 20;
const isRoad = (P) => P && P.type !== 'flight';
const khAt = (P, s, ch = 'kh') => D.channelValue(P, ch, s);   // (the climb's corner reads kv the same way: ch)
// THE SPANS. κh is a cubic B-spline: on knot span k (between [0, ...knots, L][k] and [k + 1]) it is a blend of control points k..k + 3 alone, and it lies
// inside their hull. So a span whose four are all 0 is straight throughout, one whose four are all non-zero and of one sign is straight nowhere, and only a
// span with mixed control points is scanned (SCAN_M steps). (A full read of ELYSIUM's 42 labels: 344 ms scanning every metre, against 177 ms before the corner.)
const spanEnds = (P) => [0, ...P.knots, P.length];
function spanKind(P, k, ch = 'kh') {
  const c = P.channels[ch].slice(k, k + 4);
  if (c.every((v) => Math.abs(v) < STRAIGHT)) return 'straight';
  return c.every((v) => v >= STRAIGHT) || c.every((v) => v <= -STRAIGHT) ? 'turning' : 'mixed';
}
/** The last s ≤ from where piece P is straight (span by span, scanning only mixed spans), or null. */
function lastStraight(P, from, ch = 'kh') {
  const t = spanEnds(P);
  for (let k = t.length - 2; k >= 0; k--) {
    if (t[k] > from) continue;
    const hi = Math.min(from, t[k + 1]), kind = spanKind(P, k, ch);
    if (kind === 'straight') return hi;
    if (kind === 'mixed') for (let s = hi; ; s -= SCAN_M) { const x = Math.max(t[k], s); if (Math.abs(khAt(P, x, ch)) < STRAIGHT) return x; if (x === t[k]) break; }
  }
  return null;
}
/** The first s ≥ 0 where piece P is straight (span by span), or null when it never is. */
function firstStraight(P, ch = 'kh') {
  const t = spanEnds(P);
  for (let k = 0; k + 1 < t.length; k++) {
    const kind = spanKind(P, k, ch);
    if (kind === 'straight') return t[k];
    if (kind === 'mixed') for (let s = t[k]; ; s += SCAN_M) { const x = Math.min(t[k + 1], s); if (Math.abs(khAt(P, x, ch)) < STRAIGHT) return x; if (x === t[k + 1]) break; }
  }
  return null;
}
/** Where piece P's trailing straight begins (P.length when it ends turning; 0 when it is straight throughout). */
function trailingStraightFrom(P, ch = 'kh') {
  const t = spanEnds(P);
  for (let k = t.length - 2; k >= 0; k--) {
    const kind = spanKind(P, k, ch);
    if (kind === 'straight') continue;
    if (kind === 'turning') return t[k + 1];
    let s = t[k + 1]; while (s > t[k] && Math.abs(khAt(P, s, ch)) < STRAIGHT) s = Math.max(t[k], s - SCAN_M);
    return s;
  }
  return 0;
}
/** The corner of channel ch (kh the turn, kv the climb) that piece i belongs to: { deg, fromId, endsPer100m }, or null (see THE CORNER above). */
function cornerOf(doc, i, ch) {
  const P = doc.pieces[i];
  if (!isRoad(P) || P.channels[ch].every((v) => Math.abs(v) < STRAIGHT)) return null;   // every control point 0: straight throughout (no scan)
  // the piece's own turning stretch ends where its trailing straight begins
  const end = trailingStraightFrom(P, ch);
  if (end === 0 && Math.abs(khAt(P, 0, ch)) < STRAIGHT) return null;   // straight from its start to its end
  // back to where the road was last straight, from inside piece i (before its turning end) and on into earlier pieces
  let j = i, s0 = lastStraight(P, end, ch);
  while (s0 === null) { if (j === 0 || !isRoad(doc.pieces[j - 1])) { s0 = 0; break; } j--; s0 = lastStraight(doc.pieces[j], doc.pieces[j].length, ch); }
  let turn = channelIntegral(doc.pieces[j], ch, s0, j === i ? P.length : doc.pieces[j].length);
  for (let k = j + 1; k <= i; k++) turn += channelIntegral(doc.pieces[k], ch);
  const kEnd = khAt(P, P.length, ch), ends = Math.abs(kEnd) >= STRAIGHT;
  return { deg: turn * DEG, fromId: doc.pieces[j].id, endsPer100m: ends ? kEnd * DEG * 100 : null };
}
function corner(doc, i) { const c = cornerOf(doc, i, 'kh'); return c && { turnDeg: c.deg, fromId: c.fromId, endsTurningDegPer100m: c.endsPer100m }; }
/** D331, the climb too (plan :387-399): the climb's corner, the pitch change since the climb rate was last 0 (a steady pitch, not necessarily level), where it
 *  began, and the climb rate it ends at, degrees per 100 m, or null when it ends at a steady pitch. */
function climbCorner(doc, i) { const c = cornerOf(doc, i, 'kv'); return c && { climbDeg: c.deg, fromId: c.fromId, endsClimbingDegPer100m: c.endsPer100m }; }
/**
 * cornerNext(doc, i): when piece i ends still turning, what comes after it adds to the corner: { nextAddsDeg, nextFrom }, or null when it ends straight.
 * Kept OUT of pieceReadout on purpose: a piece's readout reads only the start and the pieces up to it, and the shell reuses it on that promise
 * (app/core/coreshell.js pieceReadouts); this reads the piece after.
 */
function cornerNext(doc, i) {
  const P = doc.pieces[i];
  if (!isRoad(P) || Math.abs(khAt(P, P.length)) < STRAIGHT) return null;
  const N = doc.pieces[i + 1];
  if (isRoad(N)) {   // a next piece that never goes straight is not an ease-out: the corner goes on through it
    const f = firstStraight(N); return f === null ? { nextAddsDeg: null, nextFrom: 'the corner goes on' } : { nextAddsDeg: channelIntegral(N, 'kh', 0, f) * DEG, nextFrom: 'next piece' };
  }
  if (N) return null;   // a flight after it: the landing sets the heading
  // the open end: what "turn 0, at start" would add, by placing it (extend is pure)
  const d = extend(doc, { length: 2 * AT_START_M, targets: { kh: 0 }, transition: { kh: AT_START_M } }), M = d.pieces[d.pieces.length - 1];
  return { nextAddsDeg: channelIntegral(M, 'kh', 0, firstStraight(M) ?? M.length) * DEG, nextFrom: 'turn 0 at start' };
}
// ── THE GRAVITY BANK (D331 D): the road's bank against gravity, as src/geom/path.js reads it (sampleAt: bankG = asin(L.y)). With the gravity frame the
// unrolled left is horizontal and the unrolled up U0 = T × R has U0.y = cos p, so the rolled left's height is L.y = cos p · sin φ: past an inversion
// (pitch 186°) a bank of −234° reads −53.5°, the road's real tilt, where φ itself reads in the flipped form. Without the lift of h and l (ref 09 §7).
const gravityBank = (p, phi) => Math.asin(Math.max(-1, Math.min(1, Math.cos(p) * Math.sin(phi)))) * DEG;

/** The pose entering piece i: heading θ and pitch p (rad), from the start and every earlier piece. */
function poseBefore(doc, i) {
  let theta = doc.start.heading, p = doc.start.pitch;
  for (let j = 0; j < i; j++) {
    const P = doc.pieces[j];
    if (P.type === 'flight') { theta += P.heading; p = P.pitch; continue; }   // D258: the landing's pose
    theta += channelIntegral(P, 'kh'); p += channelIntegral(P, 'kv');
  }
  return { theta, p };
}

/** The lifted tangent's heading and pitch at s (ref 09 §7): T̃ ∝ T + h′ŷ + l′R + l·θ′R_θ. */
function liftedAngles(P, s, theta, p) {
  const h = D.channelAt(P, 'h', s), l = D.channelAt(P, 'l', s), dth = D.channelAt(P, 'kh', s).v;
  const T = [Math.cos(p) * Math.sin(theta), Math.sin(p), Math.cos(p) * Math.cos(theta)];
  const R = [Math.cos(theta), 0, -Math.sin(theta)], Rth = [-Math.sin(theta), 0, -Math.cos(theta)];
  const V = [0, 1, 2].map((k) => T[k] + (k === 1 ? h.d1 : 0) + l.d1 * R[k] + l.v * dth * Rth[k]), n = Math.hypot(V[0], V[1], V[2]);
  return { theta: Math.atan2(V[0], V[2]), p: Math.asin(Math.max(-1, Math.min(1, V[1] / n))) };
}
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** The road over the lifted curve: ∫|r̃′| ds, |r̃′|² = 1 + h′² + l′² + (lθ′)² + 2h′ sin p − 2lθ′ cos p (ref 09 §8), by 5-point GL on 1 m panels. */
function roadLength(P, p0) {
  const n = Math.max(1, Math.ceil(P.length)), step = P.length / n; let sum = 0, pAcc = p0, sPrev = 0;
  for (let j = 0; j < n; j++) {
    const a = j * step, half = step / 2, mid = a + half;
    for (const [x, w] of GL5) {
      const s = mid + half * x, h = D.channelAt(P, 'h', s).d1, l = D.channelAt(P, 'l', s), dth = D.channelAt(P, 'kh', s).v;
      pAcc += channelIntegral(P, 'kv', sPrev, s); sPrev = s;
      const lt = l.v * dth, v2 = 1 + h * h + l.d1 * l.d1 + lt * lt + 2 * h * Math.sin(pAcc) - 2 * lt * Math.cos(pAcc);
      sum += w * half * Math.sqrt(Math.max(0, v2));
    }
  }
  return sum;
}

function pieceReadout(doc, i) {
  D.checkDoc(doc);
  if (!doc.pieces.length) throw new D.CoreError('EMPTY', 'an empty track has no pieces to read');
  if (!Number.isInteger(i) || i < 0 || i >= doc.pieces.length) throw new D.CoreError('BAD_INDEX', `piece ${i} does not exist: the track has ${doc.pieces.length} (0 to ${doc.pieces.length - 1})`);
  return readoutAt(doc, i, poseBefore(doc, i));
}
/** The pose entering EVERY piece, in poseBefore's own order of sums, so poses[i] is poseBefore(doc, i) to the bit. */
function posesOf(doc) {
  const out = []; let theta = doc.start.heading, p = doc.start.pitch;
  for (const P of doc.pieces) {
    out.push({ theta, p });
    if (P.type === 'flight') { theta += P.heading; p = P.pitch; continue; }
    theta += channelIntegral(P, 'kh'); p += channelIntegral(P, 'kv');
  }
  return out;
}
// whether a carried road readout's corner on channel ch (kh the turn, kv the climb) still reads what it read: cornerOf walks back from piece i to the piece the corner
// begins on (fromId), reading of each its id, its length, its knots and that one channel (a Grab's new piece has the same turn, to the bit), and of the piece before
// the first only whether it is a road (a flight or the track's start begins a corner); a null corner reads piece i alone, which is the very piece it was
const sameArr = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, j) => Object.is(x, b[j])));
const readsAlike = (P, W, ch) => P === W || (!!P && !!W && P.type === 'road' && W.type === 'road' && P.id === W.id && Object.is(P.length, W.length) && sameArr(P.knots, W.knots) && sameArr(P.channels[ch], W.channels[ch]));
const cornerHolds = (c, ch, i, doc, was) => {
  if (!c) return true;
  const k = doc.pieces.findIndex((P) => P.id === c.fromId);
  if (k < 0 || k > i) return false;
  if (k > 0 && isRoad(doc.pieces[k - 1]) !== isRoad(was.pieces[k - 1])) return false;
  for (let j = k; j <= i; j++) if (!readsAlike(doc.pieces[j], was.pieces[j], ch)) return false;
  return true;
};
/**
 * D421c: EVERY piece's readout at once, each pieceReadout(doc, i)'s to the bit: the document checked once and the pose carried on, where pieceReadout checks the
 * whole document and sums the pose from the start for each piece (a 50-piece lap: 50 checks and 1,225 pose sums; 85-91 ms of row 3's re-close frame, the labels').
 * `prev` is an earlier answer ({ doc, reads, poses }): a ROAD piece keeps its readout (the very object) when it is the very piece it was, at the same place, entering
 * at the same pitch (and the same heading when it has offsets, whose lifted turn reads it), and its corners read the very pieces they read. A road readout reads
 * nothing else: its own piece, the pose entering it, and its corners (above). A flight's reads the whole track, so it is always read again.
 * Returns { doc, reads, poses }. Throws what pieceReadout throws for a bad document, when there is a piece to read.
 */
function pieceReadouts(doc, prev = null) {
  const poses = posesOf(doc), was = prev && prev.doc && Array.isArray(prev.reads) && Array.isArray(prev.poses) ? prev : null;
  let checked = false;
  const reads = doc.pieces.map((P, i) => {
    const old = was && was.doc.pieces[i] === P && P.type === 'road' ? was.reads[i] : null, op = old && was.poses[i];
    if (old && op && op.p === poses[i].p && (old.offsets === null || op.theta === poses[i].theta) && cornerHolds(old.corner, 'kh', i, doc, was.doc) && cornerHolds(old.climbCorner, 'kv', i, doc, was.doc)) return old;
    if (!checked) { D.checkDoc(doc); checked = true; }
    return readoutAt(doc, i, poses[i]);
  });
  return { doc, reads, poses };
}
/** The readout of piece i of a CHECKED document, entering at `pose` (poseBefore's). */
function readoutAt(doc, i, pose) {
  const P = doc.pieces[i];
  if (P.type === 'flight') {
    let bank = 0, cupEnd = 0, edgeEnd = 0, sliceEnd = D.S_DEFAULT, tubeEnd = 0; for (let j = i - 1; j >= 0; j--) if (doc.pieces[j].type === 'road') { const Pj = doc.pieces[j], e = D.pieceEnd(Pj); bank = e.phi.v; cupEnd = e.c.v; edgeEnd = e.e.v; sliceEnd = e.s.v; tubeEnd = Pj.tube ? e.t.v : 0; break; }
    const lengthM = toSegments(doc).filter((g) => g.id === P.id).reduce((a, g) => a + g.length, 0);
    return { type: 'flight', id: P.id, lengthM, turnDeg: P.heading * DEG, climbDeg: (P.pitch - pose.p) * DEG, bankFromDeg: bank * DEG, bankToDeg: P.bank * DEG, cupFromDeg: cupEnd, cupToDeg: cupEnd, edgeFromDeg: edgeEnd, edgeToDeg: edgeEnd, sliceFrom: sliceEnd, sliceTo: sliceEnd, tubeFromDeg: tubeEnd, tubeToDeg: tubeEnd,
      pitchFromDeg: pose.p * DEG, pitchToDeg: P.pitch * DEG, offsets: null,
      landing: { forwardM: P.forward, leftM: P.left, upM: P.up, headingDeg: P.heading * DEG, pitchDeg: P.pitch * DEG, bankDeg: P.bank * DEG } };   // D258: the pose the UI's number boxes show
  }
  const turn = channelIntegral(P, 'kh'), climb = channelIntegral(P, 'kv');
  const out = { type: 'road', id: P.id, lengthM: P.length, gripPct: D.gripOf(P), turnDeg: turn * DEG, climbDeg: climb * DEG,   // gripPct: D261, the piece's grip for the hover label
    bankFromDeg: D.channelAt(P, 'phi', 0).v * DEG, bankToDeg: D.channelAt(P, 'phi', P.length).v * DEG,
    cupFromDeg: P.tube ? D.channelAt(P, 't', 0).v / 2 : P.cup ? D.channelAt(P, 'c', 0).v : D.legacyEdgeDeg(P.family, D.channelAt(P, 'w', 0).v, D.channelAt(P, 'r', 0).v),
    cupToDeg: P.tube ? D.channelAt(P, 't', P.length).v / 2 : P.cup ? D.channelAt(P, 'c', P.length).v : D.legacyEdgeDeg(P.family, D.channelAt(P, 'w', P.length).v, D.channelAt(P, 'r', P.length).v),
    edgeFromDeg: P.edge ? D.channelAt(P, 'e', 0).v : 0, edgeToDeg: P.edge ? D.channelAt(P, 'e', P.length).v : 0,
    sliceFrom: P.edge ? D.channelAt(P, 's', 0).v : D.S_DEFAULT, sliceTo: P.edge ? D.channelAt(P, 's', P.length).v : D.S_DEFAULT,
    tubeFromDeg: P.tube ? D.channelAt(P, 't', 0).v : 0, tubeToDeg: P.tube ? D.channelAt(P, 't', P.length).v : 0,
    pitchFromDeg: pose.p * DEG, pitchToDeg: (pose.p + climb) * DEG, offsets: null,
    gravityBankFromDeg: gravityBank(pose.p, D.channelAt(P, 'phi', 0).v), gravityBankToDeg: gravityBank(pose.p + climb, D.channelAt(P, 'phi', P.length).v),   // D331 D
    corner: corner(doc, i), climbCorner: climbCorner(doc, i) };   // D331 A, and the climb's
  if (D.OFFSETS.some((ch) => P.channels[ch].some((v) => v !== 0))) {
    const a = liftedAngles(P, 0, pose.theta, pose.p), b = liftedAngles(P, P.length, pose.theta + turn, pose.p + climb);
    out.offsets = {
      turnDeg: (turn + wrap(b.theta - (pose.theta + turn)) - wrap(a.theta - pose.theta)) * DEG,
      climbDeg: (b.p - a.p) * DEG, pitchFromDeg: a.p * DEG, pitchToDeg: b.p * DEG, roadLengthM: roadLength(P, pose.p),
    };
  }
  return out;
}

/** The readout of the piece Extend would place (extendCorner: extend, or with opts.turnDeg the corner, D331 B): the ghost, before it is placed. Same numbers as after placing. */
function candidateReadout(doc, opts) {
  const d = extendCorner(doc, opts);
  return pieceReadout(d, d.pieces.length - 1);
}
/** D331 A: what easing the piece extend(doc, opts) would place out would add (cornerNext of the ghost, the open end). Apart from candidateReadout, whose numbers are the placed piece's. */
function candidateCorner(doc, opts) {
  const d = extendCorner(doc, opts);
  return cornerNext(d, d.pieces.length - 1);
}

module.exports = { pieceReadout, pieceReadouts, candidateReadout, candidateCorner, cornerNext, channelIntegral };
