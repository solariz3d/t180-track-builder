// geom_fixtures.js: hand-made segment lists for the geometry tests (docs/INTERFACES.md §1 shape), so the tests do not
// wait on the document model. Not a test file itself (no .test.js).
'use strict';
const D = Math.PI / 180;
const prof = (font, u, psiDeg) => ({ font, u, psi: psiDeg.map((x) => x * D), material: 'ROAD' });
const FLAT = prof('flat', [-13, 0, 13], [0, 0, 0]);
const HALFPIPE = prof('half-pipe', [-13, -5, 0, 5, 13], [60, 0, 0, 0, 60]);
const WALLRIDE = prof('wall-ride', [-13, -5, 0, 5, 13], [30, 0, 0, 0, 110]);   // left edge past vertical

/** A 180° left hairpin with clothoid entry and exit (curvature ramped 0 → 1/R → 0). */
function hairpin(id, R, La, profile) {
  return [
    { id: `${id}.in`, word: 'turn', kind: 'road', length: La, k0: 0, k1: 1 / R, profile },
    { id: `${id}.arc`, word: 'turn', kind: 'road', length: Math.PI * R - La, k0: 1 / R, k1: 1 / R, profile },
    { id: `${id}.out`, word: 'turn', kind: 'road', length: La, k0: 1 / R, k1: 0, profile },
  ];
}
/** A planar closed stadium: straight, hairpin, straight, hairpin. Closes by point symmetry. */
function stadium({ straight = 100, R = 30, La = 20, wallTurn = WALLRIDE, otherTurn = HALFPIPE } = {}) {
  return [
    { id: 'B', word: 'straight', kind: 'road', length: straight, profile: FLAT },
    ...hairpin('T1', R, La, otherTurn),
    { id: 'A', word: 'straight', kind: 'road', length: straight, profile: FLAT },
    ...hairpin('T2', R, La, wallTurn),
  ];
}
/**
 * A NON-planar closed loop: one full left circle whose pitch rises then falls, p(s + L/2) = −p(s), so both position
 * and height close by symmetry, while the RMF picks up a real closing twist that must be spread.
 */
function saddleLoop({ R = 40, c = 0.0004 } = {}) {
  const L = 2 * Math.PI * R, q = L / 4, k = 1 / R;
  return [
    { id: 'q1', kind: 'road', length: q, k0: k, k1: k, kp0: c, kp1: c, profile: FLAT },
    { id: 'q2', kind: 'road', length: q, k0: k, k1: k, kp0: -c, kp1: -c, profile: FLAT },
    { id: 'q3', kind: 'road', length: q, k0: k, k1: k, kp0: -c, kp1: -c, profile: FLAT },
    { id: 'q4', kind: 'road', length: q, k0: k, k1: k, kp0: c, kp1: c, profile: FLAT },
  ];
}
/**
 * A NON-planar closed loop that DOES carry a closing twist. The RMF holonomy is 2π minus the area the tangent
 * indicatrix encloses, and that area's departure from 2π is ∫ sin p dθ. With a uniform yaw rate, ∫ sin p dθ is
 * height/R, which is 0 on any loop that closes in height, so saddleLoop's twist is 0. Here the stadium CLIMBS while
 * turning (turn 1) and DESCENDS on a straight (dθ = 0), so the twist is real (about rise/R). Heading and pitch close
 * exactly; position closes only to O(p²) (millimetres to centimetres), so tests pass closeTol and check the FRAME.
 */
function twistLoop({ R = 30, straight = 100, c = 0.0008 } = {}) {
  const k = 1 / R, h = Math.PI * R / 2, c2 = c * (h * h) / ((straight / 2) * (straight / 2));
  return [
    { id: 'B', kind: 'road', length: straight, profile: FLAT },
    { id: 'T1a', kind: 'road', length: h, k0: k, k1: k, kp0: c, kp1: c, profile: FLAT },
    { id: 'T1b', kind: 'road', length: h, k0: k, k1: k, kp0: -c, kp1: -c, profile: FLAT },
    { id: 'Aa', kind: 'road', length: straight / 2, kp0: -c2, kp1: -c2, profile: FLAT },
    { id: 'Ab', kind: 'road', length: straight / 2, kp0: c2, kp1: c2, profile: FLAT },
    { id: 'T2', kind: 'road', length: 2 * h, k0: k, k1: k, profile: FLAT },
  ];
}
/**
 * A figure-8 style CROSSING (D167): a straight, a 270° left turn that climbs by about `h` metres (pitch ramps up over
 * 20 m, holds, ramps down over 20 m), then a level straight that crosses over the first straight at right angles.
 * With R = 25 the crossing is about 55 m along the first straight and ~225 m along the path, far beyond one pass.
 * Height by the small-angle sum: h ≈ a·(20²/2 + 20·Lh + 20²/2), Lh = 270°·R − 40 (the tests read the real height).
 */
function crossing(h, { R = 25, lead = 80, tail = 80, profile = FLAT, tailRoll = 0 } = {}) {
  const T = 1.5 * Math.PI * R, Lh = T - 40, a = h / (200 + 20 * Lh + 200), k = 1 / R;
  const out = [{ id: 'lead', kind: 'road', length: lead, profile }];
  if (h === 0) out.push({ id: 'turn', kind: 'road', length: T, k0: k, k1: k, profile });
  else out.push({ id: 'up', kind: 'road', length: 20, k0: k, k1: k, kp0: a, kp1: a, profile }, { id: 'hold', kind: 'road', length: Lh, k0: k, k1: k, profile },
    { id: 'down', kind: 'road', length: 20, k0: k, k1: k, kp0: -a, kp1: -a, profile });
  out.push({ id: 'over', kind: 'road', length: tail, roll0: tailRoll, roll1: tailRoll, profile });
  return out;
}
/** A vertical loop-the-loop of radius R between two straights; `yaw` (1/m) adds a constant yaw curvature through it. */
function loopTheLoop({ R = 12, yaw = 0, profile = HALFPIPE, lead = 30, tail = 30 } = {}) {
  return [{ id: 'in', kind: 'road', length: lead, profile }, { id: 'loop', kind: 'road', length: 2 * Math.PI * R, kp0: 1 / R, kp1: 1 / R, k0: yaw, k1: yaw, profile },
    { id: 'out', kind: 'road', length: tail, profile }];
}
module.exports = { D, prof, FLAT, HALFPIPE, WALLRIDE, hairpin, stadium, saddleLoop, twistLoop, crossing, loopTheLoop };
