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
const { segStarts, profileAt } = require('../markers/place.js');
const { walkScene, isDrivable } = require('./markers.js');
const { rayGaps } = require('../validate/raygap.js');
const { MACH6 } = require('../validate/limits.js');

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
  // D279: the infill between the road's edge and the lane's inner edge, then the downforce ray over road + lane + infill across the lane's span
  const fill = infill(mainPath, mainSegments, mainMesh, mesh, lane, pitLane, mesh.scene.root.children[0].children[0].material);
  const withFill = { ...mesh, scene: { ...mesh.scene, root: { ...mesh.scene.root, children: [...mesh.scene.root.children, fill] } } };
  if (selfCheck) red.push(...spanGaps(mainPath, mainMesh, withFill, lane));
  return { lane, mesh: withFill, red };
}

/* D279 INFILL (the keeper, 2026-10-09 16:27: "the pit lane arc that is made, i wonder if the inside could just be filled in so there is no gap between the
 * track and pit"). ONE drivable surface, 1ROAD_PIT_fill_0, from the road's edge to the lane's inner edge over the lane's whole span: the entry arc (where
 * the gap opens from 0), the body (offsetM wide) and the exit arc.
 * ITS TWO EDGES ARE THE MESHES' OWN, NOT A FORMULA. Measured on a core lap: the road mesh's edge vertices sit 2–9 cm from buildPitLane's analytic edge
 * (the road's offsets and profile blend), and the lane mesh does not keep a row at every lane station (321 stations, 294 rows), so a strip built from
 * the formulas welded to neither and the downforce ray found a gap along all of it. So:
 *   - the ROAD side is the road mesh's own boundary polyline on the lane's side, in the span (its boundary edges: used by one triangle);
 *   - the LANE side is the lane mesh's own boundary polyline on its inner side;
 * and the two are ZIPPED: walking both in order along the road, each triangle takes one edge of one polyline and a vertex of the other. Every infill vertex
 * IS a road or lane vertex and every infill boundary edge IS a road or lane boundary edge, so nothing is left for a ray to fall through.
 * Being 1ROAD_PIT_…, it is drivable road, wears the lane's floor (withLaneFloor), and stays out of the road merge (acready.js), as the lane does. Its
 * texture coordinates run as the road's do at the default 10 m tile: u = metres across from the road's edge u, v = the road's own s / 10. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const WELD = 1e-4, NEAR_EDGE = 0.3;   // m: the same vertex in two cells; how far a boundary vertex may sit from the analytic edge and still be that edge's
/** The boundary polyline of `meshes` (world space) near `target(s)` over [sA, sB]: [{ p, s }] sorted by s, each a vertex of those meshes. */
function boundaryNear(meshes, sOf, target, sA, sB) {
  const key = (x, y, z) => `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
  const verts = new Map(), edges = new Map();
  for (const m of meshes) {
    const P = m.positions, idx = m.indices, id = [];
    for (let i = 0; i < P.length; i += 3) { const k = key(P[i], P[i + 1], P[i + 2]); if (!verts.has(k)) verts.set(k, [P[i], P[i + 1], P[i + 2]]); id.push(k); }
    for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
      const e = id[a] < id[b] ? `${id[a]}|${id[b]}` : `${id[b]}|${id[a]}`; edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  const out = new Map();
  for (const [e, n] of edges) {
    if (n !== 1) continue;
    const ends = e.split('|').map((k) => ({ k, p: verts.get(k) }));
    const ok = ends.every((v) => { const s = sOf(v.p); if (s < sA - 1e-6 || s > sB + 1e-6) return false; const q = target(s); return Math.hypot(v.p[0] - q[0], v.p[1] - q[1], v.p[2] - q[2]) <= NEAR_EDGE; });
    if (ok) for (const v of ends) if (!out.has(v.k)) out.set(v.k, { p: v.p, s: sOf(v.p) });
  }
  return [...out.values()].sort((a, b) => a.s - b.s);
}
function infill(mainPath, mainSegments, mainMesh, laneMesh, lane, pitLane, material) {
  const S = mainPath.samples, sg = pitLane.side === 'L' ? 1 : -1, st = segStarts(mainPath, mainSegments), s0 = lane.joins.leave.s, s1 = lane.joins.rejoin.s;
  const span = S.filter((x) => x.s >= s0 - 4 && x.s <= s1 + 4);
  // s of a point: the nearest road sample in the span, moved along its tangent (enough to ORDER points beside the road, which is all the zipper needs)
  const sOf = (p) => { let best = null, bd = Infinity; for (const x of span) { const d = (p[0] - x.pos[0]) ** 2 + (p[1] - x.pos[1]) ** 2 + (p[2] - x.pos[2]) ** 2; if (d < bd) { bd = d; best = x; } } return best.s + (p[0] - best.pos[0]) * best.T[0] + (p[1] - best.pos[1]) * best.T[1] + (p[2] - best.pos[2]) * best.T[2]; };
  const cells = mainMesh.cells, roadW = walkScene(mainMesh.scene).meshes.filter((m, k) => cells[k] && cells[k].s1 >= s0 - 4 && cells[k].s0 <= s1 + 4 && m.indices && m.indices.length);
  const R = boundaryNear(roadW, sOf, (s) => lane.at(Math.min(s1, Math.max(s0, s))).edge, s0, s1);
  const L = boundaryNear(walkScene(laneMesh.scene).meshes.filter((m) => m.indices && m.indices.length), sOf, (s) => lane.at(Math.min(s1, Math.max(s0, s))).inner, s0, s1);
  if (R.length < 2 || L.length < 2) throw new Error(`PIT_INFILL: found ${R.length} road-edge and ${L.length} lane-edge vertices beside the lane; the infill needs both edges`);
  const edgeU = (s) => { let k = 0; for (let i = 0; i < st.length; i++) if (st[i] <= s + 1e-9) k = i; const P = profileAt(mainSegments[k], Math.max(0, s - st[k])); return sg > 0 ? P.u[P.u.length - 1] : P.u[0]; };
  const upAt = (s) => { let best = span[0]; for (const x of span) if (Math.abs(x.s - s) < Math.abs(best.s - s)) best = x; return best.U; };
  const P = [], N = [], UV = [], I = [];
  const push = (v, uAcross) => { P.push(...v.p); N.push(...upAt(v.s)); UV.push(uAcross / 10, v.s / 10); return P.length / 3 - 1; };
  const ri = R.map((v) => push(v, edgeU(v.s)));
  const li = L.map((v) => { let best = R[0]; for (const r of R) if (Math.abs(r.s - v.s) < Math.abs(best.s - v.s)) best = r; return push(v, edgeU(v.s) + sg * Math.hypot(v.p[0] - best.p[0], v.p[1] - best.p[1], v.p[2] - best.p[2])); });
  const tri = (a, b, c) => {   // CCW seen from above (the road's up); a degenerate one (a join, where both edges meet) is left out
    const p = P.slice(a * 3, a * 3 + 3), q = P.slice(b * 3, b * 3 + 3), r = P.slice(c * 3, c * 3 + 3), ux = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], vx = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const nx = [ux[1] * vx[2] - ux[2] * vx[1], ux[2] * vx[0] - ux[0] * vx[2], ux[0] * vx[1] - ux[1] * vx[0]], up = N.slice(a * 3, a * 3 + 3);
    if (Math.hypot(...nx) <= 1e-6) return;
    I.push(...(nx[0] * up[0] + nx[1] * up[1] + nx[2] * up[2] >= 0 ? [a, b, c] : [a, c, b]));
  };
  let i = 0, j = 0;   // the zipper: step whichever side's NEXT vertex comes first along the road
  while (i < R.length - 1 || j < L.length - 1) {
    if (j >= L.length - 1 || (i < R.length - 1 && R[i + 1].s <= L[j + 1].s)) { tri(ri[i], ri[i + 1], li[j]); i++; }
    else { tri(ri[i], li[j + 1], li[j]); j++; }
  }
  const mesh = { type: 'mesh', name: '1ROAD_PIT_fill_0', material, positions: Float32Array.from(P), normals: Float32Array.from(N), uvs: Float32Array.from(UV), indices: Uint16Array.from(I), castShadows: true, visible: true, transparent: false, renderable: true };
  return { type: 'dummy', name: 'CELL_PIT_fill_0', matrix: IDENTITY.slice(), children: [mesh] };
}

/** The car's downforce ray (src/validate/raygap.js) over the road cells beside the lane, the lane and the infill: a gap anywhere in the lane's span is RED. */
function spanGaps(mainPath, mainMesh, laneMesh, lane) {
  const s0 = lane.joins.leave.s, s1 = lane.joins.rejoin.s, near = (c) => c.s1 >= s0 - 10 && c.s0 <= s1 + 10;
  const roadW = walkScene(mainMesh.scene).meshes, cells = mainMesh.cells;
  const road = roadW.filter((m, k) => cells[k] && near(cells[k]) && isDrivable(m.name) && m.indices && m.indices.length);
  const pit = walkScene(laneMesh.scene).meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length);
  const stations = mainPath.samples.filter((x) => x.s >= s0 - 10 && x.s <= s1 + 10);
  return rayGaps([...road, ...pit], stations, MACH6.downforceRay).filter((g) => g.s != null && g.s >= s0 - 2 && g.s <= s1 + 2)
    .map((g) => ({ reason: 'downforce-ray-gap', s0: g.s, s1: g.s, detail: `a gap between the road, the pit lane and its infill at s ${g.s.toFixed(1)} m (u ${g.u == null ? '?' : g.u.toFixed(1)}, under ${g.widthM} m wide)`, source: 'FINDINGS.md:110' }));
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
