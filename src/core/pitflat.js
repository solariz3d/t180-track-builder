// pitflat.js: FLATTEN FOR THE PIT (the keeper, 2026-10-09: "make it so a cupped track could change its cupping directly at the part the flat pit connects
// to the track"). A pit lane leaves the road's EDGE (src/geom/pitlane.js), and beside a cup wall or a tube there is no edge it can leave from (it joins an
// edge of 35° or less). Along its run it rides that edge too, so lowering the cup only at the joins would leave the lane climbing to the wall's top and
// back. So this lowers the road's SHAPE beside the whole lane: every cup (c), tube sweep (t) and edge angle (e) control point under [s0, s1] goes to 0
// (the plain road's own profile, the shape a pit lane already joins), easing back to what it was over `ramp` metres either side with the brush's
// smootherstep (src/core/sculpt.js). Shape only: no turn, climb, bank, width or offset channel is touched, so the route does not move.
//
//   flattenUnder(doc, { s0, s1, ramp = 60 }) -> doc      s0, s1: lap distance (the adapter's s, src/core/sculpt.js pieceOffsets)
//
// A control point i is scaled by (1 − w(τᵢ)), τᵢ its knot average (sculpt.js knotAverage) and w 1 on [s0, s1], falling to 0 over `ramp`. Scaling toward
// 0 keeps every value in its own range (a cup stays in [0, CUP_MAX], a tube sweep in [0, TUBE_MAX]). The joints are then made C1 again exactly as the
// document builds a piece: where two pieces both carry the channel, the next piece's first point is the previous one's last, and its second is set from
// the previous piece's end slope. checkDoc has the last word: a flatten that would break a rule (a cup meeting an uncupped piece at a new angle) is
// refused by name and nothing changes.
'use strict';
const D = require('./document.js');
const SC = require('./sculpt.js');

const SHAPE = ['c', 't', 'e'];
const FLAG = { c: 'cup', t: 'tube', e: 'edge' };

function weight(s, s0, s1, ramp) {
  if (s >= s0 && s <= s1) return 1;
  const d = s < s0 ? s0 - s : s - s1;
  return ramp > 0 ? 1 - SC.smootherstep(d / ramp) : 0;
}

function flattenUnder(doc, { s0, s1, ramp = 60 } = {}) {
  if (!(Number.isFinite(s0) && Number.isFinite(s1) && s1 > s0)) throw new D.CoreError('BAD_RANGE', `flatten for the pit needs a stretch of road, got ${s0} to ${s1} m`);
  const off = SC.pieceOffsets(doc), lo = s0 - ramp, hi = s1 + ramp;
  let touched = false;
  const pieces = doc.pieces.map((P, i) => {
    if (P.type !== 'road' || off[i] + P.length < lo || off[i] > hi) return P;
    const t = [0, 0, 0, 0, ...P.knots, P.length, P.length, P.length, P.length], channels = { ...P.channels };
    for (const ch of SHAPE) {
      if (!P[FLAG[ch]]) continue;
      const c = P.channels[ch], out = c.map((v, k) => v * (1 - weight(off[i] + SC.knotAverage(t, k), s0, s1, ramp)));
      if (out.some((v, k) => v !== c[k])) { channels[ch] = out.map((v) => Number(v.toFixed(D.DEC[ch]))); touched = true; }
    }
    return channels === P.channels ? P : { ...P, channels };
  });
  if (!touched) throw new D.CoreError('NOTHING_TO_FLATTEN', 'there is no cup, tube or edge beside the pit lane: the road there is already plain');
  // C1 again at every joint between two pieces that both carry a changed channel (document.js builds a piece from the last one's end value and slope)
  for (let i = 1; i < pieces.length; i++) {
    if (pieces[i - 1].type !== 'road' || pieces[i].type !== 'road') continue;
    for (const ch of SHAPE) {
      const A = pieces[i - 1], B = pieces[i];   // re-read: an earlier channel may have replaced either piece
      if (!A[FLAG[ch]] || !B[FLAG[ch]] || (A.channels[ch] === doc.pieces[i - 1].channels[ch] && B.channels[ch] === doc.pieces[i].channels[ch])) continue;
      // a joint the flattening does not reach (the ramp has ended by it): both sides keep the points that make the joint, exactly as they were, so the
      // joint is the very same and the next piece is not pushed (found: a tube's next piece extrapolated to 363.9°, past its 360° cap)
      if (weight(off[i], s0, s1, ramp) === 0) {
        const oa = doc.pieces[i - 1].channels[ch], ob = doc.pieces[i].channels[ch], na = oa.length;
        const a2 = A.channels[ch].slice(); a2[na - 1] = oa[na - 1]; a2[na - 2] = oa[na - 2];
        const b2 = B.channels[ch].slice(); b2[0] = ob[0]; b2[1] = ob[1];
        pieces[i - 1] = { ...A, channels: { ...A.channels, [ch]: a2 } }; pieces[i] = { ...B, channels: { ...B.channels, [ch]: b2 } };
        continue;
      }
      const a = A.channels[ch], n = a.length, hA = A.length - (A.knots.length ? A.knots[A.knots.length - 1] : 0), hB = B.knots.length ? B.knots[0] : B.length;
      const b = B.channels[ch].slice(), slope = (3 * (a[n - 1] - a[n - 2])) / hA;
      b[0] = a[n - 1]; b[1] = Number((b[0] + (slope * hB) / 3).toFixed(D.DEC[ch]));
      pieces[i] = { ...B, channels: { ...B.channels, [ch]: b } };
    }
  }
  try { return Object.freeze(D.checkDoc({ ...doc, pieces: Object.freeze(pieces) })); }
  catch (e) {
    if (e && e.name === 'CoreError') throw new D.CoreError('FLATTEN_REFUSED', `flattening the road beside the pit lane would break a rule of the track (${e.message}); move the lane or flatten that stretch by hand`);
    throw e;
  }
}

module.exports = { flattenUnder, weight };
