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
const { resolveLayout, defaultLayout, gridSlots, runUpM, speedAfterM, PATTERNS, DEFAULTS, SLOT_HALF_LENGTH } = require('./layout.js');
const { placeMarker, segStarts } = require('./place.js');
const { checkPlaced } = require('./checks.js');
const { paintFor } = require('./paint.js');

function placeAll(layout, path, segments, { paintMaterial = 0, lane = null } = {}) {
  const starts = segStarts(path, segments), laneStarts = lane ? segStarts(lane.path, lane.segments) : null;
  const r = resolveLayout(layout, path, segments);
  if (lane) {   // the pit boxes move onto the lane
    r.markers = r.markers.filter((m) => m.kind !== 'pit');
    r.missing = r.missing.filter((m) => m.what !== 'the pit boxes');
    const s0 = lane.path.samples[0].s, n = layout.pits.count, gap = layout.pits.spacingM;
    if (layout.pits.lane && Number.isFinite(layout.pits.lane.along)) {   // set by hand: from `along` into the lane, backwards by the spacing (as it always was)
      for (let k = 0; k < n; k++) r.markers.push({ name: `AC_PIT_${k}`, kind: 'pit', n: k, s: s0 + layout.pits.lane.along - k * gap, u: layout.pits.u, h: layout.height, onLane: true });
    } else {
      // D285 (the keeper, 2026-10-10: "the pit lane spacing starts half way through the pit … Pit 1 starts half way to the back of the pits"): the row was
      // laid from the lane's MIDPOINT backwards, so the front half of the lane stood empty. Now it is CENTRED on the lane's usable straight (its 'body',
      // between the entry and exit tapers; a lane with no parts is usable end to end), box 0 first after the entry and each next box `spacingM` further
      // on, so the gap before the first box equals the gap after the last. A row longer than the straight is still centred: it spills onto both tapers
      // equally, and the amber below says so.
      const part = (name) => lane.segments.findIndex((g) => g.part === name);
      const iIn = part('in'), iBody = part('body');
      const a = iIn >= 0 && iBody >= 0 ? lane.segments[iIn].length : 0, b = iBody >= 0 ? a + lane.segments[iBody].length : lane.path.lengthM;
      const first = (a + b) / 2 - (n - 1) * gap / 2;
      for (let k = 0; k < n; k++) r.markers.push({ name: `AC_PIT_${k}`, kind: 'pit', n: k, s: s0 + first + k * gap, u: layout.pits.u, h: layout.height, onLane: true });
      const needM = (n - 1) * gap + 2 * SLOT_HALF_LENGTH;
      if (needM > b - a + 1e-9) r.notes.push({ id: 'pit-boxes-on-taper', level: 'amber', text: `the ${n} pit boxes need ${needM.toFixed(0)} m and the pit lane's straight part is ${(b - a).toFixed(0)} m: the first and last boxes stand on the lane's tapers` });
    }
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
