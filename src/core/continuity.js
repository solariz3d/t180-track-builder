// continuity.js: what a channel does at the two ends of a piece, and how it steps across a joint, read EXACTLY from the stored control points: no path is
// sampled, no difference is taken over metres. D459 (the user, 2026-10-25, TEST 10: "there is still a bump its not smooth"; plan_test10_bump_d459, the user's
// frame: "a C2 check on the document, not on a sampled path").
//
//   endDerivatives(piece, ch)   -> { start: { v, m, k }, end: { v, m, k } }: the channel's value, slope (per m) and second derivative (per m²) at s = 0 and at
//                                  s = length, in the channel's stored units (phi in rad, the cup and edges in degrees, w in m, kh and kv in rad/m)
//   jointSteps(doc, opts)       -> one entry per road joint and channel: { joint: 'p3|p4', k (the index of the piece before), s, ch, dv, dm, dk, dkDeg }, the
//                                  steps of the value, the slope and the second derivative from the piece before to the piece after, dk in the channel's stored
//                                  units and dkDeg in °/m² for an angle (phi converted; c, e, er are stored in degrees); on a closed lap the seam too
//   c2Breaks(doc, opts)         -> the entries whose |dkDeg| is over opts.tol (°/m², default TOL_K), for opts.channels (default C2_CHANNELS: the ones the wheels
//                                  ride on). Empty means every joint of those channels is C2.
//
// WHY THIS AND NOT A SAMPLED CHECK. Every check the room had before D459 sampled: the vertical curvature of a surface line by second differences over 2 m
// (kstep436.js, core_finish_joints.test.js) or rays cast down at a mesh (surf436.js). A sampled check turns a curvature STEP at a joint into a finite "change
// over 2 m" that is ranked against other places and judged by a bar; the step at every bank, cup and edge joint of TEST 10 was in those lists for three days
// (D433, D436) and read as "a design question", because nothing said what a ramp joint's curvature OUGHT to be. This reads the spline itself: a cubic B-spline's
// end value, slope and curvature are closed forms in its first three (last three) control points and the first (last) knot spans, so the step across a joint is
// one number per channel, exact to rounding, and the assertion is "0", not "under a bar".
//
// THE FORMULAS (a clamped cubic B-spline with knot vector U of n + 4 knots, U[0..3] = 0 and U[n..n+3] = L, control points P[0..n−1]; de Boor's derivative rule,
// ref 03 §1): with the first-derivative control points Qᵢ = 3 (Pᵢ₊₁ − Pᵢ) / (U[i+4] − U[i+1]) and the second's Rᵢ = 2 (Qᵢ₊₁ − Qᵢ) / (U[i+4] − U[i+2]),
//   c(0) = P₀,  c′(0) = Q₀ = 3 (P₁ − P₀) / U[4],  c″(0) = R₀ = 2 (Q₁ − Q₀) / U[4]   with Q₁ = 3 (P₂ − P₁) / U[5]
// and at the end, mirrored,
//   c(L) = Pₙ₋₁,  c′(L) = Qₙ₋₂ = 3 (Pₙ₋₁ − Pₙ₋₂) / (L − U[n−1]),  c″(L) = Rₙ₋₃ = 2 (Qₙ₋₂ − Qₙ₋₃) / (L − U[n−1])   with Qₙ₋₃ = 3 (Pₙ₋₂ − Pₙ₋₃) / (L − U[n−2]).
// (The value and slope are document.js pieceEnd's; test/core_joint_c2.test.js row 0 checks the curvature against a four-point reading of valuesAt on the end span.)
'use strict';

const D = require('./document.js');

/** The channels the C2 rule covers: the cross-section the wheels ride on (extend.js C2_CHANNELS, kept in step here so this file needs nothing of extend's). */
const C2_CHANNELS = Object.freeze(['phi', 'c', 'e', 'er']);
/** The curvature step that counts as none, in °/m² for every angle channel: 5e-4 is 35× under the smallest step TEST 10 carried (0.0178 °/m² at a 30° bank over 100 m) and about 10× over what a quintic ramp's fitted ends read (the fit's ringing continued into the next piece: up to 6e-5 measured). */
const TOL_K = 5e-4;
const DEG = Math.PI / 180, ANGLE_RAD = new Set(['phi', 'kh', 'kv']);   // the channels stored in radians (kh and kv per metre)

/** The channel's control points, or null when the piece does not carry it (an optional channel of a kind the piece is not). */
function pointsOf(P, ch) {
  const c = P.channels[ch];
  if (c === undefined && D.OPTIONAL[ch] && !P[D.OPTIONAL[ch]]) return null;
  if (!Array.isArray(c)) throw new D.CoreError('NO_CHANNEL', `channel ${ch} is missing`);
  return c;
}

/** value, slope and second derivative of channel ch at s = 0 and s = length, from the control points and the knot vector (closed forms above). */
function endDerivatives(P, ch) {
  const c = pointsOf(P, ch);
  if (!c) { const v = D.OPT_DEFAULT[ch]; return { start: { v, m: 0, k: 0 }, end: { v, m: 0, k: 0 } }; }
  const U = D.knotVector(P), n = c.length, L = P.length;
  if (n < 4 || U.length !== n + 4) throw new D.CoreError('BAD_CHANNEL', `${ch}: ${n} control points on ${U.length} knots`);
  const q0 = (3 * (c[1] - c[0])) / U[4], q1 = (3 * (c[2] - c[1])) / U[5];
  const qe = (3 * (c[n - 1] - c[n - 2])) / (L - U[n - 1]), qd = (3 * (c[n - 2] - c[n - 3])) / (L - U[n - 2]);
  return { start: { v: c[0], m: q0, k: (2 * (q1 - q0)) / U[4] }, end: { v: c[n - 1], m: qe, k: (2 * (qe - qd)) / (L - U[n - 1]) } };
}

/**
 * The steps across every road joint: for consecutive road pieces (and, on a closed lap, the last road piece into the first), per channel, the value,
 * slope and second-derivative steps from the end of the piece before to the start of the piece after. `channels` defaults to every channel.
 */
function jointSteps(doc, { channels = D.CHANNELS } = {}) {
  const road = []; doc.pieces.forEach((P, k) => { if (P.type === 'road') road.push(k); });
  let s = 0; const startS = new Map(); for (const P of doc.pieces) { startS.set(P, s); s += P.length || 0; }
  const out = [];
  const pairs = []; for (let i = 1; i < road.length; i++) if (road[i] === road[i - 1] + 1) pairs.push([road[i - 1], road[i]]);
  if (doc.closed && road.length > 1 && road[0] === 0 && road[road.length - 1] === doc.pieces.length - 1) pairs.push([road[road.length - 1], road[0]]);
  for (const [a, b] of pairs) {
    const A = doc.pieces[a], B = doc.pieces[b], sJ = b === 0 ? 0 : startS.get(B);
    for (const ch of channels) {
      const ea = endDerivatives(A, ch).end, sb = endDerivatives(B, ch).start;
      const dk = sb.k - ea.k;
      out.push({ joint: `${A.id}|${B.id}`, k: a, s: sJ, ch, dv: sb.v - ea.v, dm: sb.m - ea.m, dk, dkDeg: ANGLE_RAD.has(ch) ? dk / DEG : dk });
    }
  }
  return out;
}

/** The joints where a C2 channel's curvature steps by more than tol (°/m²): empty when every such joint is C2. */
function c2Breaks(doc, { channels = C2_CHANNELS, tol = TOL_K } = {}) {
  return jointSteps(doc, { channels }).filter((e) => Math.abs(e.dkDeg) > tol);
}

module.exports = { endDerivatives, jointSteps, c2Breaks, C2_CHANNELS, TOL_K };
