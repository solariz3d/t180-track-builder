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

module.exports = { laneForExport, withLane };
