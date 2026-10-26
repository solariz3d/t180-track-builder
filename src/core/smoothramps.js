// smoothramps.js: Track ▸ Smooth ramps (D465, 2026-10-25). Re-lays the bank, cup and edge ramps of a track that was laid before 0.4.20 with the C2 quintic
// extend.js now lays them with, so a saved track gets the smooth joints too. A saved document stores control points, not the words that laid it, so it does
// NOT reshape on load (D459 3b, P §0): this is the one way an existing track gets them, and it runs only when the user asks.
//
//   smoothRamps(doc)  -> { doc, ramps, moved, left }
//     doc     the new document (the same object when nothing moved)
//     ramps   one entry per ramp found: { id, ch, from, to, over, moved } (over: the metres the ramp is laid over, from the piece's start)
//     moved   how many of them changed
//     left    the channels that change across a piece but are not a ramp this can re-lay: { id, ch, why }
//
// WHAT IS A RAMP HERE: a road piece's phi, c, e or er (extend.js C2_CHANNELS) that goes from one held value to another: its first two control points level
// (it leaves at rest) and its last two level (it arrives at rest), the two values different. That is what Extend lays for a target (P's requintic.js, D459
// 3b §4: 13 channels of 9 pieces on TEST 10). It is laid FROM THE PIECE'S START, as Extend lays every ramp, TO WHERE THE PIECE REACHES ITS END VALUE: the knot
// past which every control point holds it (a ramp typed with a transition keeps it; a ramp over the whole piece stays over the whole piece). A piece that held
// its value first and dropped late (the cup home of a lap closed before 0.4.20) is laid over the whole piece, as P's tool did.
//
// HOW: on the piece's OWN knots (the knots are shared with kh and kv, so keeping them keeps the route), with extend.js's own steps: the quintic blend
// (channelFn), the fit with the start pair kept and the hold and end pinned (fitWithHold), and the ends pinned to zero curvature (c2Ends); where that fit would
// turn back (uneven knots, see relay), the quintic read at the knot averages instead. Either way the control points go one way from the start value to the end
// value, so the curve stays between them (the convex hull): a cup stays in [0, 150]. The first two and last
// two control points are never moved, so every joint keeps its value and slope (C1, as it was), and the joint's curvature goes to 0.
// kh, kv, w, r, h, l, s, t, every length, every knot and everything that is not a road piece are the same bytes (test/core_smooth_ramps.test.js).
// A piece with fewer than six control points (under two interior knots) has no free point at each end and cannot be made C2: it is left, and said.
'use strict';

const D = require('./document.js');
const X = require('./extend.js');

const MIN_POINTS = 6;   // c2Ends' own floor: a free control point at each end, P[2] and P[n − 3]

/** The ramp channel ch of road piece P, or null when it is none: { v0, v1, Lt } (Lt the metres it reaches v1 in), or { why } when it changes but cannot be re-laid. */
function rampOf(P, ch) {
  const c = P.channels[ch];
  if (!Array.isArray(c)) return null;
  const n = c.length, v0 = c[0], v1 = c[n - 1], q = 10 ** -D.DEC[ch];
  if (c.every((x) => Math.abs(x - v0) < q / 2)) return null;   // it holds one value: no ramp
  if (Math.abs(c[1] - v0) > q / 2 || Math.abs(c[n - 2] - v1) > q / 2) return { why: 'it does not leave and arrive at rest (a continued slope)' };
  if (Math.abs(v1 - v0) < q / 2) return { why: 'it comes back to the value it started at (a bump, not a ramp)' };
  if (n < MIN_POINTS) return { why: `the piece is too short for its ends to be made smooth (${n} control points, at least ${MIN_POINTS} needed)` };
  let j = n - 2; while (j > 2 && Math.abs(c[j - 1] - v1) < q / 2) j--;   // every point from j on holds v1
  const U = D.knotVector(P);
  return { v0, v1, Lt: Math.min(P.length, U[j + 3]) };   // the curve is v1 from U[j + 3] on: each span reads four points, the first of them P[j] at the earliest
}

/** The control points never turn back on the way from v0 to v1 (to the channel's quantum): the curve is then monotone and inside the two values (the convex hull). */
function monotone(c, ch) {
  const q = 10 ** -D.DEC[ch], up = c[c.length - 1] >= c[0];
  return c.every((x, i) => i === 0 || (up ? x >= c[i - 1] - q : x <= c[i - 1] + q));
}

/**
 * The channel re-laid by the quintic: a new control-point array (the piece is not changed). The fit first, as Extend lays a ramp. On UNEVEN knots (a piece that
 * also carried a short ramp of another channel, so its knots crowd its first metres) the least-squares fit can ring: measured, a bank held from 20 m on a 200 m
 * piece with a 5 m width ramp went 15% of its change below where it started, then up again. A ramp from rest to rest never turns back, so a fit that does is
 * not used: the quintic is read at the knot averages instead, as extend.js rampControl lays a short ramp (monotone by construction, ref 10 §2), and its ends
 * pinned the same way.
 */
function relay(P, ch, { v0, v1, Lt }) {
  const f = X.channelFn({ v: v0, m: 0 }, v1, Lt, ch), withCh = (arr) => ({ ...P, channels: { ...P.channels, [ch]: arr } });
  const fit = withCh(P.channels[ch].slice());
  X.fitWithHold(fit, ch, f, Lt, v1);
  X.c2Ends(fit, ch);
  if (monotone(fit.channels[ch], ch)) return fit.channels[ch];
  const U = D.knotVector(P), n = P.channels[ch].length, dec = D.DEC[ch];
  const read = withCh(P.channels[ch].map((x, i) => (i < 2 ? x : i >= n - 2 ? v1 : Number(f((U[i + 1] + U[i + 2] + U[i + 3]) / 3).toFixed(dec)) + 0)));
  X.c2Ends(read, ch);
  return read.channels[ch];
}

/** Every bank, cup and edge ramp of the track re-laid by the C2 quintic. The route does not move. */
function smoothRamps(doc) {
  D.checkDoc(doc);
  const ramps = [], left = [];
  const pieces = doc.pieces.map((P) => {
    if (P.type !== 'road') return P;
    let channels = null;
    for (const ch of X.C2_CHANNELS) {
      const r = rampOf(P, ch);
      if (!r) continue;
      if (r.why) { left.push({ id: P.id, ch, why: r.why }); continue; }
      // moved: by more than half the channel's quantum. extend.js's edge clamp can leave a point unrounded (150 − 128.113932 = 21.886067999999995), which the
      // re-lay rounds; that is the same ramp, and counting it would copy, commit and report a change of 5e-15° (found by row 10's track, D465)
      const now = relay(P, ch, r), q = 10 ** -D.DEC[ch], moved = now.some((x, i) => Math.abs(x - P.channels[ch][i]) > q / 2);
      ramps.push({ id: P.id, ch, from: r.v0, to: r.v1, over: r.Lt, moved });
      if (moved) (channels = channels || { ...P.channels })[ch] = now;
    }
    return channels ? { ...P, channels } : P;
  });
  const moved = ramps.filter((r) => r.moved).length;
  if (!moved) return { doc, ramps, moved, left };
  return { doc: Object.freeze(D.checkDoc({ ...doc, pieces: Object.freeze(pieces) })), ramps, moved, left };
}

module.exports = { smoothRamps, rampOf };
