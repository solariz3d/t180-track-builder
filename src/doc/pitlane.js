// pitlane.js: the document's PIT LANE (ARCHITECTURE §11.1: "a pit lane as a side road leaving and rejoining the loop";
// §5c: "the pit lane is a side road leaving and rejoining the loop").
//
// The loop stays ONE ordered list of words (§11.1, the keeper: "there are no shortcuts"). The lane is not a second loop
// and not a junction in it: it is a side road ANCHORED to the loop, the way the markers are (src/markers, E's D171
// interface), so it follows its words when they are sculpted. `doc.pitLane` is null, or:
//
//   { side: 'L' | 'R',                      which side of the road it leaves on
//     leave:  { word, along },              where it leaves: a word's id (`w3`, or `w2/1` inside a phrase), metres in
//     rejoin: { word, along },              where it comes back
//     offsetM,                              m: the gap between the road's edge and the lane's inner edge, on its run
//     width,                                m: the lane's own width (a flat road)
//     divergeM, mergeM,                     m of the MAIN road over which the lane peels off, and comes back
//     speedKmh }                            the pit limit, or null
//
// So the lane has three parts of its own, in order: DIVERGE (its inner edge leaves the road's edge, easing out to
// offsetM), RUN (offsetM beside the road), MERGE (easing back until its inner edge is the road's edge again). Those are
// the lane's words; their lengths are the two handles above (the run is what is left between the anchors).
// This differs from E's proposal (with the markers' lane placement, src/markers/index.js: `{ leave, rejoin, side, offsetM, width, speedKmh? }`) only by
// adding divergeM and mergeM: the ease is a shape the user sets, and leaving it implicit would hide a length the
// geometry needs and the export depends on. A free-form lane (its own turns and climbs) would need a lane that leaves
// the road's coordinates and a closing solve like closeLoop's to come back; pit lanes run beside the road, so it is
// not built.
//
// Checked here: the SHAPE, the ranges and the quanta. NOT checked here: that the anchors' words exist and the parts fit
// between them. A word may be removed while the lane still names it, and editing must never be blocked by that; the
// geometry refuses such a lane by name (src/geom/pitlane.js PIT_ANCHOR_MISSING, PIT_TOO_SHORT), as E's markers do.
'use strict';

const KEYS = ['side', 'leave', 'rejoin', 'offsetM', 'width', 'divergeM', 'mergeM', 'speedKmh'];
const LENGTHS = ['offsetM', 'width', 'divergeM', 'mergeM'];
const RANGE = { offsetM: [0, 200], width: [2, 30], divergeM: [5, 2000], mergeM: [5, 2000], along: [0, 1e6], speedKmh: [5, 400] };
const WORD_RE = /^[a-z]+[0-9]*(\/[1-9][0-9]*)?$/;
const DEFAULTS = Object.freeze({ side: 'R', offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 });

const inRange = (v, [a, b]) => Number.isFinite(v) && v >= a && v <= b;

/** Why `lane` is not a valid pit lane, or null. `null` itself (no lane) is valid. */
function problem(lane) {
  if (lane === null) return null;
  if (!lane || typeof lane !== 'object' || Array.isArray(lane)) return 'pitLane must be null or an object';
  const extra = Object.keys(lane).filter((k) => !KEYS.includes(k)); if (extra.length) return `pitLane: ${extra.join(', ')} not part of a pit lane (keys: ${KEYS.join(', ')})`;
  const missing = KEYS.filter((k) => !(k in lane)); if (missing.length) return `pitLane: missing ${missing.join(', ')}`;
  if (lane.side !== 'L' && lane.side !== 'R') return `pitLane: side is 'L' or 'R', not ${JSON.stringify(lane.side)}`;
  for (const end of ['leave', 'rejoin']) {
    const a = lane[end];
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).sort().join() !== 'along,word') return `pitLane.${end} must be { word, along }`;
    if (typeof a.word !== 'string' || !WORD_RE.test(a.word)) return `pitLane.${end}.word ${JSON.stringify(a.word)} is not a word id (w3, or w2/1 in a phrase)`;
    if (!inRange(a.along, RANGE.along)) return `pitLane.${end}.along = ${a.along} is outside [0, ${RANGE.along[1]}] m`;
  }
  for (const k of LENGTHS) if (!inRange(lane[k], RANGE[k])) return `pitLane.${k} = ${lane[k]} is outside [${RANGE[k][0]}, ${RANGE[k][1]}] m`;
  if (lane.speedKmh !== null && !inRange(lane.speedKmh, RANGE.speedKmh)) return `pitLane.speedKmh = ${lane.speedKmh} is not null or within [${RANGE.speedKmh[0]}, ${RANGE.speedKmh[1]}] km/h`;
  return null;
}

/** The lane with every length snapped by `qm` and the speed by `qk` (the document's own quanta, serial.js). */
function quantised(lane, qm, qk) {
  if (lane === null) return null;
  const end = (a) => ({ word: a.word, along: qm(a.along) });
  return { side: lane.side, leave: end(lane.leave), rejoin: end(lane.rejoin), offsetM: qm(lane.offsetM), width: qm(lane.width),
    divergeM: qm(lane.divergeM), mergeM: qm(lane.mergeM), speedKmh: lane.speedKmh === null ? null : qk(lane.speedKmh) };
}

/** Canonical text: keys in KEYS order; `m(x)` prints a length, `k(x)` a speed. */
function text(lane, m, k) {
  if (lane === null) return 'null';
  const s = JSON.stringify, end = (a) => `{${s('word')}:${s(a.word)},${s('along')}:${m(a.along)}}`;
  return `{${s('side')}:${s(lane.side)},${s('leave')}:${end(lane.leave)},${s('rejoin')}:${end(lane.rejoin)},` +
    LENGTHS.map((x) => `${s(x)}:${m(lane[x])}`).join(',') + `,${s('speedKmh')}:${lane.speedKmh === null ? 'null' : k(lane.speedKmh)}}`;
}

module.exports = { KEYS, LENGTHS, RANGE, DEFAULTS, problem, quantised, text };
