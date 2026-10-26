// startlayout.js: the start straight for the export's grid on a core track, and the two constants that say what "nearly straight" is.
// D467 (E): moved VERBATIM out of app/core/coreshell.js, which still requires and exports these names, so that app/core/closejob.js (and the close worker, which never
// loads the shell) can run the exporter's own start-straight check on a close's result.
'use strict';

/**
 * THE START STRAIGHT for the export's grid, on a core track. src/markers/layout.js defaultLayout puts the grid on the longest run
 * of segments that are EXACTLY straight words (word 'straight', every curvature and roll 0). A core track has no words, and a
 * closed one has no exactly straight segment (the close leaves |κ| ~1e-4 rad/m on a guarded straight). So the layout is computed
 * by defaultLayout itself, on the REAL closed path, with each segment that is nearly straight (|κh|, |κv| ≤ STRAIGHT_K, radius
 * ≥ 5 km; |roll| ≤ STRAIGHT_ROLL) marked as a straight for the choice ONLY. Its result is anchors (segment id and distance
 * along it) and the grid's size; the export then places every marker on the real road and runs its own checks on them, unchanged.
 */
const STRAIGHT_K = 1 / 5000, STRAIGHT_ROLL = 0.5 * Math.PI / 180;
function startLayout(segments, lift, start, { open = false, base = null } = {}) {   // open (D243a): the test export of an unfinished track lays its grid on an OPEN path; base (D407): that path, already built
  const { buildPath } = require('../../src/geom/index.js'), Markers = require('../../src/markers/layout.js');
  const nearly = (g) => g.kind === 'road' && [g.k0, g.k1, g.kp0, g.kp1].every((x) => Math.abs(x) <= STRAIGHT_K) && [g.roll0, g.roll1].every((x) => Math.abs(x) <= STRAIGHT_ROLL);
  const marked = segments.map((g) => (nearly(g) ? { ...g, word: 'straight', k0: 0, k1: 0, kp0: 0, kp1: 0, roll0: 0, roll1: 0 } : g));
  const p = base || buildPath(segments, { step: 2, closed: !open, ...(start ? { start } : {}) });
  return Markers.defaultLayout(lift ? lift(p) : p, marked, open ? { firstPiece: true } : {});   // D284: on an open track the line stays on its straight's first piece as pieces are added
}

module.exports = { STRAIGHT_K, STRAIGHT_ROLL, startLayout };
