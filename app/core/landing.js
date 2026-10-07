// landing.js: WHERE THE FREE JUMP'S LANDING IS ON THE TRACK, for the drag handles (D258, the keeper's jump: a landing piece you place by hand and tune by driving; the core is src/core/jump.js, E's).
// Pure: it reads a built path and its segments and gives the landing's start and the two frames its handles work in. The pose is given in the TAKE-OFF's HEADING frame (forward along the take-off's
// horizontal heading, left of it, world up: src/core/document.js flightPiece), so the handles' arrows are that frame's axes and a drag moves the number in the box of the same name.
//
//   framesOf(track, flightId) -> { pos, T0, L0, U0, T1, L1 } | null
//        pos = the landing's start; T0, L0, U0 = the take-off's horizontal forward, left and world up; T1, L1 = the landing's own direction and left. `track` = { path, segments } as the preview's
//        't180:track-request' gives it. Null where the flight is not on the path.
//   BOXES, boxValues(landing), poseOf(field, value)   the number boxes: their fields, the values the readout gives, and the pose a typed value is (degrees to the core's radians)
'use strict';

const DEG = 180 / Math.PI;
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : null; };

/** The boxes, in the order they show: the pose's field, its label and its unit. forward, sideways (+ left) and height (+ up) in m; heading, pitch, bank in degrees. */
const BOXES = Object.freeze([
  { field: 'forward', label: 'forward m', unit: 'm', step: 1, title: 'metres ahead of the take-off, along its heading (horizontal). Type a number, or drag the white arrow on the landing' },
  { field: 'left', label: 'sideways m', unit: 'm', step: 1, title: 'metres to the LEFT of the take-off (negative = right), across its heading. Type a number, or drag the orange arrow' },
  { field: 'up', label: 'height m', unit: 'm', step: 0.5, title: 'metres ABOVE the take-off (negative = lower). 0 is the same height as the take-off, whatever its climb. Type a number, or drag the yellow arrow' },
  { field: 'heading', label: 'heading °', unit: '°', step: 1, title: 'the landing\'s heading, as degrees turned LEFT from the take-off\'s heading (negative = right). 0 is lined up. Type a number, or drag the purple arrow ahead of the landing' },
  { field: 'pitch', label: 'pitch °', unit: '°', step: 0.5, title: 'the landing\'s own pitch in degrees (+ nose up; 0 is level, negative slopes down)' },
  { field: 'bank', label: 'bank °', unit: '°', step: 0.5, title: 'the landing\'s own bank in degrees (+ left side up)' },
]);
/** The readout's landing { forwardM, leftM, upM, headingDeg, pitchDeg, bankDeg } as the boxes' values (numbers, rounded to the 0.01 a box shows; no "-0"). */
function boxValues(l) {
  const r = (x) => { const v = Math.round(x * 100) / 100; return Object.is(v, -0) ? 0 : v; };
  return l ? { forward: r(l.forwardM), left: r(l.leftM), up: r(l.upM), heading: r(l.headingDeg), pitch: r(l.pitchDeg), bank: r(l.bankDeg) } : null;
}
/** A typed value as the pose the core's setLanding takes: metres stay, degrees become radians. */
function poseOf(field, value) {
  const v = Number(value);
  return { [field]: field === 'heading' || field === 'pitch' || field === 'bank' ? v / DEG : v };
}

function framesOf(track, flightId) {
  const S = track && track.path && track.path.samples, segs = track && track.segments;
  if (!S || !S.length || !Array.isArray(segs)) return null;
  let acc = 0, j = -1, sGap = 0;
  for (let k = 0; k < segs.length; k++) { if (segs[k] && segs[k].id === flightId && segs[k].kind === 'gap') { j = k; sGap = S[0].s + acc; break; } acc += segs[k].length; }
  if (j < 0) return null;
  let first = -1, last = -1;
  for (let i = 0; i < S.length; i++) if (S[i].seg === j) { if (first < 0) first = i; last = i; }
  if (first < 0 || last < 0) return null;
  // the take-off end is the station AT the gap's start: the path gives a boundary to the segment it starts, so it is S[first]; sampled the other way it is S[first - 1]
  const take = first > 0 && Math.abs(S[first - 1].s - sGap) < Math.abs(S[first].s - sGap) ? first - 1 : first, A = S[take], B = last + 1 < S.length ? S[last + 1] : S[last];
  const T0 = norm([A.T[0], 0, A.T[2]]); if (!T0) return null;
  const U0 = [0, 1, 0], L0 = [T0[2], 0, -T0[0]];   // U0 x T0: left of the heading (with forward +z, left is +x)
  return { pos: B.pos.slice(), T0, L0, U0, T1: B.T.slice(), L1: B.L ? B.L.slice() : L0 };
}

module.exports = { framesOf, BOXES, boxValues, poseOf };
