// gridturn.js: TURN TO GRID (the keeper, 2026-10-12: "for free flowing tracks, it should also connect to the 90 degree angle of the grid like snap to grid
// type things so that I can measure the degrees of turns connecting to the grid to have it all symmetrical or at least aligned to the grid. Its hard to get a
// straight aligned to the grid from a free flowing spiral turn"). The preview's grid runs along the world axes, and a heading θ = 0 points along +Z
// (src/geom/path.js tangent: [cos p·sin θ, sin p, cos p·cos θ]), so the grid's directions are the headings that are whole multiples of 90°.
//
//   endHeadingDeg(segments, startHeadingRad)   the heading at the end of the track, degrees, + = left (the adapter's own rule: a road segment turns by the
//                                             trapezoid of its turn rate, src/core/adapter.js; a free flight turns by its landing's heading, src/geom/path.js)
//   offGridDeg(headingDeg, stepDeg)            how far the heading is from the nearest grid direction, in (−step/2, step/2]: + = the grid line is to the RIGHT
//   gridTurnDeg(headingDeg, stepDeg, prefer)   the turn (degrees, + = left) that ends on the nearest grid direction; a tie (exactly half a step off) goes the
//                                             way `prefer` says (+1 left, −1 right, 0: left). 0 when it is already on the grid (within 1e-9°).
// Nothing here edits a document: the shell hands the turn to Turn by (src/core/turnby.js), which makes the piece end exactly on it and straight.
'use strict';

const DEG = 180 / Math.PI;
const STEPS = Object.freeze([90, 45, 15]);

function endHeadingDeg(segments, startHeadingRad = 0) {
  let th = startHeadingRad;
  for (const g of segments) {
    if (g.kind === 'gap') { if (g.to && Number.isFinite(g.to.theta)) th += g.to.theta; continue; }
    th += ((g.k0 + g.k1) / 2) * g.length;
  }
  return th * DEG;
}

function checkStep(stepDeg) {
  if (!STEPS.includes(stepDeg)) throw Object.assign(new Error(`BAD_GRID_STEP: the grid step must be one of ${STEPS.join(', ')} degrees, got ${stepDeg}`), { code: 'BAD_GRID_STEP' });
}

function offGridDeg(headingDeg, stepDeg = 90) {
  checkStep(stepDeg);
  if (!Number.isFinite(headingDeg)) throw Object.assign(new Error(`BAD_HEADING: the heading must be a finite number of degrees, got ${headingDeg}`), { code: 'BAD_HEADING' });
  const r = ((headingDeg % stepDeg) + stepDeg) % stepDeg;   // in [0, step)
  return r > stepDeg / 2 ? r - stepDeg : r;                  // in (−step/2, step/2]
}

function gridTurnDeg(headingDeg, stepDeg = 90, prefer = 0) {
  const off = offGridDeg(headingDeg, stepDeg);
  if (Math.abs(off) < 1e-9) return 0;
  if (Math.abs(Math.abs(off) - stepDeg / 2) < 1e-9) return prefer < 0 ? -off : stepDeg - off;   // exactly between two grid lines
  return -off;
}

module.exports = { endHeadingDeg, offGridDeg, gridTurnDeg, STEPS };
