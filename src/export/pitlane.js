// pitlane.js (export): the document's pit lane into the exported scene (ARCHITECTURE §11.1, §5c), as E's D171 interface
// proposes for A: "exportTrack would pass the lane to placeAll ({ lane }) and add its mesh to the scene".
//
//   laneForExport(mainPath, mainSegments, mainMesh, pitLane, { selfCheck, mesh })
//     -> { lane, mesh, red: [{ reason, s0, s1, detail, source }] }     lane: src/geom/pitlane.js buildPitLane's result
//   withLane(scene, laneMesh) -> scene with the lane's cells appended, their materials matched to the scene's BY NAME
//
// SELF-CHECK, ON unless the export turned it off: the lane's own mesh gets buildMesh's selfCheck (a lane that crosses
// itself), and the lane against the road gets src/geom/pitlane.js laneCheck (the self-check's own triangle and
// stacked tests; only the two join zones, where the lane shares the road's edge line by design, are exempt). Every
// finding is a red range, as the road's own self-intersections are.
'use strict';
const { buildMesh } = require('../geom/index.js');
const { buildPitLane, laneCheck } = require('../geom/pitlane.js');

function laneForExport(mainPath, mainSegments, mainMesh, pitLane, { selfCheck = true, mesh: meshOpts = {} } = {}) {
  const lane = buildPitLane(mainPath, mainSegments, pitLane);
  const mesh = buildMesh(lane.path, lane.segments, { ...meshOpts, selfCheck });
  const red = [];
  if (selfCheck) {
    for (const x of mesh.selfCheck.intersections) red.push({ reason: 'self-intersection', s0: x.s, s1: x.sOther, detail: `the pit lane meets itself (${x.cell} and ${x.other}, lane s)`, source: 'ARCHITECTURE.md:58' });
    const c = laneCheck(mainMesh, mesh, lane);
    for (const x of c.intersections) red.push({ reason: 'self-intersection', s0: x.sMain, s1: x.sMain, detail: `the pit lane (${x.cell}, lane s ${x.sLane.toFixed(1)}) meets the road (${x.other})`, source: 'ARCHITECTURE.md:58' });
    const stacked = new Map(); for (const x of c.stacked) if (!stacked.has(x.other)) stacked.set(x.other, x);
    for (const x of stacked.values()) red.push({ reason: 'stacked', s0: x.sMain, s1: x.sMain, detail: `the pit lane (${x.cell}) is stacked ${x.gap.toFixed(2)} m from the road (${x.other})`, source: 'ARCHITECTURE.md:85' });
  }
  for (const f of mesh.folds.filter((x) => x.margin !== null)) red.push({ reason: 'fold', s0: f.s, s1: f.s, detail: `the pit lane folds (lane s ${f.s.toFixed(1)}, u ${f.u.toFixed(2)})`, source: 'ARCHITECTURE.md:57' });
  return { lane, mesh, red };
}

function withLane(scene, laneMesh) {
  const mats = scene.materials.slice(), idx = laneMesh.scene.materials.map((m) => {
    const i = mats.findIndex((x) => x.name === m.name); if (i >= 0) return i;
    mats.push(m); return mats.length - 1;
  });
  const remap = (n) => (n.type === 'mesh' ? { ...n, material: idx[n.material] } : { ...n, children: (n.children || []).map(remap) });
  return { ...scene, materials: mats, root: { ...scene.root, children: [...scene.root.children, ...laneMesh.scene.root.children.map(remap)] } };
}

/**
 * D279 (the keeper, 2026-10-09: "ALSO MAKE the pits the same texture as the track"): the lane wears the road's FLOOR. withTextureSet
 * (src/texture/set.js) gives a textured floor material to the road's own cells only, so the lane kept the plain road material while the
 * road around it wore the texture. Here every lane cell (1ROAD_PIT_…) takes the floor material of the road segment the lane LEAVES from:
 * the same material, so the same diffuse texture, under every setting (a made texture, the user's picture). An untextured floor changes
 * nothing (the lane and the road already share t180b_road). The surface key, the mesh count, the pit box paint and the texture
 * coordinates are untouched: a word document's road cells keep mesh.js's 10 m repeats too, and only an equation-core road re-runs its
 * coordinates (src/texture/flow.js), which has no pit lane today (app/core passes none to the export).
 *   withLaneFloor(scene, lane, mainSegments, set) -> scene    lane: buildPitLane's result (its joins.leave.s), set: the texture set or null
 */
function withLaneFloor(scene, lane, mainSegments, set) {
  if (!set || !lane) return scene;
  let at = 0, seg = null;
  for (const g of mainSegments) { if (at <= lane.joins.leave.s + 1e-9) seg = g; else break; at += g.length; }
  const slots = seg ? set.bySegment(seg.id) : null, f = slots && slots.floor;
  if (!f || !(f.settings.texture || f.settings.make)) return scene;
  const idx = scene.materials.findIndex((m) => m.name === f.material);
  if (idx < 0) throw new Error(`PIT_LANE_FLOOR: the lane leaves segment ${seg.id}, whose floor material ${f.material} is not in the scene`);
  const remap = (n) => (n.type === 'mesh' ? (/^1ROAD_PIT_/.test(n.name) ? { ...n, material: idx } : n) : { ...n, children: (n.children || []).map(remap) });
  return { ...scene, root: remap(scene.root) };
}

module.exports = { laneForExport, withLane, withLaneFloor };
