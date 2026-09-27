// place.js: a point on the road surface in TRACK COORDINATES (ARCHITECTURE §5c: "distance along the road, position
// across it, and height above the surface"), and a marker placed there.
//
//   surfaceAt(path, segments, s, u) -> { pos, n, T, L, U, s, u, seg, P, span: [u0, u1] }
//   placeMarker(path, segments, { name, s, u, h }) -> { name, s, u, h, pos, surface, fwd, up, left, matrix }
//
// THE SURFACE is the one the mesh builds (src/geom/mesh.js): the station frame at s, the cross-section of the segment
// there (with the font transition's blend, weight smoothstep((blend.s0 + d) / blend.length), exactly as meshPiece does),
// and the point at arc length u along that cross-section (src/geom/profile.js offsetAt), with its normal (normalAt). So a
// marker on a banked floor sits along the ROLLED up axis, and one on a half-pipe wall stands off the wall, not up.
// BETWEEN STATIONS the frame is interpolated linearly and renormalised. The position error is the chord error of the
// path's own step: at most step² / (8R), 1.7 cm at a 2 m step on a 30 m radius (inferred from the formula, not measured).
// THE MARKER stands h above the surface along its normal; its forward axis is the road's tangent with the normal part
// removed (so it points along the road and lies in the surface), and its left axis completes a right-handed frame. Its
// matrix is kn5's stored order, rows left, up, forward, then the position (src/export/scene.js, markers.js).
'use strict';
const Prof = require('../geom/profile.js');

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? mul(a, 1 / l) : [0, 0, 0]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The start s of every segment (the running sum of their lengths, from the path's first station). */
function segStarts(path, segments) {
  const out = []; let s = path.samples[0].s;
  for (const g of segments) { out.push(s); s += g.length; }
  return out;
}

/** The cross-section of segment g at distance d into it, as the mesh builds it (the blend on a font transition). */
function profileAt(seg, d) {
  const P = Prof.normalize(seg.profile);
  if (!seg.blend) return P;
  const w = Prof.smoothstep((seg.blend.s0 + d) / seg.blend.length);
  return w >= 1 ? P : Prof.normalize(Prof.blend(Prof.normalize(seg.blend.from), P, w));
}

/** The station index i with S[i].s ≤ s < S[i+1].s (clamped to the path). */
function bracket(S, s) {
  let lo = 0, hi = S.length - 1;
  if (s <= S[0].s) return 0;
  if (s >= S[hi].s) return hi - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; }
  return lo;
}

function surfaceAt(path, segments, s, u, starts = segStarts(path, segments)) {
  const S = path.samples;   // s is in range: the layout wraps a closed loop's s before it gets here (layout.js back)
  if (!(s >= S[0].s - 1e-9 && s <= S[S.length - 1].s + 1e-9)) throw Object.assign(new Error(`markers: s = ${s} m is off the track (0–${S[S.length - 1].s} m)`), { code: 'OFF_TRACK' });
  const i = bracket(S, s), a = S[i], b = S[Math.min(i + 1, S.length - 1)], t = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 0;
  // the segment at s: the last one starting at or before it that is road (a flight has no surface)
  let g = 0; for (let k = 0; k < segments.length; k++) if (starts[k] <= s + 1e-9) g = k;
  const seg = segments[g];
  if (seg.kind === 'gap') throw Object.assign(new Error(`markers: s = ${s.toFixed(2)} m is over a jump's flight, where there is no road`), { code: 'NO_ROAD' });
  const P = profileAt(seg, s - starts[g]);
  const T = unit(lerp(a.T, b.T, t)), L = unit(lerp(a.L, b.L, t)), U = unit(lerp(a.U, b.U, t)), centre = lerp(a.pos, b.pos, t);
  const [X, Y] = Prof.offsetAt(P, u), [nl, nu] = Prof.normalAt(P, u);
  return { pos: add(centre, add(mul(L, X), mul(U, Y))), n: unit(add(mul(L, nl), mul(U, nu))), T, L, U, s, u, seg: g, P, span: [P.u[0], P.u[P.u.length - 1]] };
}

function placeMarker(path, segments, { name, s, u, h }, starts) {
  const sf = surfaceAt(path, segments, s, u, starts);
  const up = sf.n, fwd = unit(add(sf.T, mul(up, -dot(sf.T, up)))), left = cross(up, fwd);
  const pos = add(sf.pos, mul(up, h));
  return { name, s: sf.s, u, h, pos, surface: sf.pos, normal: sf.n, T: sf.T, fwd, up, left, span: sf.span, seg: sf.seg, matrix: [...left, 0, ...up, 0, ...fwd, 0, ...pos, 1] };
}

module.exports = { surfaceAt, placeMarker, segStarts, profileAt, _vec: { add, mul, dot, cross, unit } };
