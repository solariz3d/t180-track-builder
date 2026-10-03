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
//   { type: 'flight', id, lengthM, turnDeg: 0, climbDeg, bankFromDeg, bankToDeg, cupFromDeg, cupToDeg, pitchFromDeg, pitchToDeg, offsets: null }
//   lengthM = the flight plus its landing ramp, as the adapter builds them (src/core/adapter.js toSegments), and climbDeg =
//   landing pitch − take-off pitch. The bank and the cup are carried through a jump.
'use strict';

const D = require('./document.js');
const { extend } = require('./extend.js');
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
    for (const [x, w] of GL3) sum += w * half * D.channelAt(P, ch, mid + half * x).v;
  }
  return sum;
}

/** The pose entering piece i: heading θ and pitch p (rad), from the start and every earlier piece. */
function poseBefore(doc, i) {
  let theta = doc.start.heading, p = doc.start.pitch;
  for (let j = 0; j < i; j++) {
    const P = doc.pieces[j];
    if (P.type === 'flight') { p = P.land; continue; }
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
  const P = doc.pieces[i], pose = poseBefore(doc, i);
  if (P.type === 'flight') {
    let bank = 0, cupEnd = 0, edgeEnd = 0, sliceEnd = D.S_DEFAULT, tubeEnd = 0; for (let j = i - 1; j >= 0; j--) if (doc.pieces[j].type === 'road') { const Pj = doc.pieces[j], e = D.pieceEnd(Pj); bank = e.phi.v; cupEnd = e.c.v; edgeEnd = e.e.v; sliceEnd = e.s.v; tubeEnd = Pj.tube ? e.t.v : 0; break; }
    const lengthM = toSegments(doc).filter((g) => g.id === P.id).reduce((a, g) => a + g.length, 0);
    return { type: 'flight', id: P.id, lengthM, turnDeg: 0, climbDeg: (P.land - pose.p) * DEG, bankFromDeg: bank * DEG, bankToDeg: bank * DEG, cupFromDeg: cupEnd, cupToDeg: cupEnd, edgeFromDeg: edgeEnd, edgeToDeg: edgeEnd, sliceFrom: sliceEnd, sliceTo: sliceEnd, tubeFromDeg: tubeEnd, tubeToDeg: tubeEnd,
      pitchFromDeg: pose.p * DEG, pitchToDeg: P.land * DEG, offsets: null };
  }
  const turn = channelIntegral(P, 'kh'), climb = channelIntegral(P, 'kv');
  const out = { type: 'road', id: P.id, lengthM: P.length, turnDeg: turn * DEG, climbDeg: climb * DEG,
    bankFromDeg: D.channelAt(P, 'phi', 0).v * DEG, bankToDeg: D.channelAt(P, 'phi', P.length).v * DEG,
    cupFromDeg: P.tube ? D.channelAt(P, 't', 0).v / 2 : P.cup ? D.channelAt(P, 'c', 0).v : D.legacyEdgeDeg(P.family, D.channelAt(P, 'w', 0).v, D.channelAt(P, 'r', 0).v),
    cupToDeg: P.tube ? D.channelAt(P, 't', P.length).v / 2 : P.cup ? D.channelAt(P, 'c', P.length).v : D.legacyEdgeDeg(P.family, D.channelAt(P, 'w', P.length).v, D.channelAt(P, 'r', P.length).v),
    edgeFromDeg: P.edge ? D.channelAt(P, 'e', 0).v : 0, edgeToDeg: P.edge ? D.channelAt(P, 'e', P.length).v : 0,
    sliceFrom: P.edge ? D.channelAt(P, 's', 0).v : D.S_DEFAULT, sliceTo: P.edge ? D.channelAt(P, 's', P.length).v : D.S_DEFAULT,
    tubeFromDeg: P.tube ? D.channelAt(P, 't', 0).v : 0, tubeToDeg: P.tube ? D.channelAt(P, 't', P.length).v : 0,
    pitchFromDeg: pose.p * DEG, pitchToDeg: (pose.p + climb) * DEG, offsets: null };
  if (D.OFFSETS.some((ch) => P.channels[ch].some((v) => v !== 0))) {
    const a = liftedAngles(P, 0, pose.theta, pose.p), b = liftedAngles(P, P.length, pose.theta + turn, pose.p + climb);
    out.offsets = {
      turnDeg: (turn + wrap(b.theta - (pose.theta + turn)) - wrap(a.theta - pose.theta)) * DEG,
      climbDeg: (b.p - a.p) * DEG, pitchFromDeg: a.p * DEG, pitchToDeg: b.p * DEG, roadLengthM: roadLength(P, pose.p),
    };
  }
  return out;
}

/** The readout of the piece extend(doc, opts) would place: the ghost, before it is placed. Same numbers as after placing. */
function candidateReadout(doc, opts) {
  const d = extend(doc, opts);
  return pieceReadout(d, d.pieces.length - 1);
}

module.exports = { pieceReadout, candidateReadout, channelIntegral };
