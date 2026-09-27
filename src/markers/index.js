// index.js: the §5c markers, in one call (ARCHITECTURE §5c; D171).
//
//   placeAll(layout, path, segments, { lane }) -> { layout, placed, paint, check, nodes }
//     lane    optional { path, segments }: the PIT LANE's own road (§5c: "a side road leaving and rejoining the loop").
//             With it, the pit boxes are placed along the lane from layout.pits.lane.along (metres into the lane),
//             and checked and painted on the lane's surface. The lane's geometry is not built yet (C and A: the D171
//             hand-back's proposed interface); without a lane the boxes sit on the main road, as before.
//     placed  every marker in the world, with its track coordinates (s, u, h); a marker that cannot be placed carries
//             `error` (off the track's ends, or over a jump's flight) instead of a position
//     paint   the painted marks, generated from `placed` (paint.js)
//     check   §5c's red checks and the ambers (checks.js); check.ok false refuses the export
//     nodes   the marker dummies, in the scene-node shape (src/export/scene.js), for the kn5
//   defaultLayout, gridSlots, runUpM, PATTERNS          re-exported from layout.js
//
// It needs only the resolved segments and C's path, and no node module, so it runs in the app's webview as it does
// under node (the export does, through app/export/node-shim.js).
'use strict';
const { resolveLayout, defaultLayout, gridSlots, runUpM, speedAfterM, PATTERNS, DEFAULTS } = require('./layout.js');
const { placeMarker, segStarts } = require('./place.js');
const { checkPlaced } = require('./checks.js');
const { paintFor } = require('./paint.js');

function placeAll(layout, path, segments, { paintMaterial = 0, lane = null } = {}) {
  const starts = segStarts(path, segments), laneStarts = lane ? segStarts(lane.path, lane.segments) : null;
  const r = resolveLayout(layout, path, segments);
  if (lane) {   // the pit boxes move onto the lane: from `along` into it, backwards by the spacing
    const at = layout.pits.lane && Number.isFinite(layout.pits.lane.along) ? layout.pits.lane.along : lane.path.lengthM / 2;
    r.markers = r.markers.filter((m) => m.kind !== 'pit');
    r.missing = r.missing.filter((m) => m.what !== 'the pit boxes');
    for (let k = 0; k < layout.pits.count; k++) r.markers.push({ name: `AC_PIT_${k}`, kind: 'pit', n: k, s: lane.path.samples[0].s + at - k * layout.pits.spacingM, u: layout.pits.u, h: layout.height, onLane: true });
  }
  const placed = r.markers.map((m) => {
    const [p, g, st] = m.onLane ? [lane.path, lane.segments, laneStarts] : [path, segments, starts];
    try { return { ...m, ...placeMarker(p, g, m, st), kind: m.kind, n: m.n }; } catch (e) {
      if (e.code !== 'OFF_TRACK' && e.code !== 'NO_ROAD') throw e;
      return { ...m, error: e.message };
    }
  });
  const check = checkPlaced(placed, layout, path, r.missing, r.notes, segments);
  const paint = paintFor(placed, path, segments, { material: paintMaterial, lane });
  const nodes = placed.filter((m) => !m.error).map((m) => ({ type: 'dummy', name: m.name, matrix: m.matrix, children: [] }));
  return { layout, placed, paint, check, nodes };
}

module.exports = { placeAll, defaultLayout, resolveLayout, gridSlots, runUpM, speedAfterM, PATTERNS, DEFAULTS };
