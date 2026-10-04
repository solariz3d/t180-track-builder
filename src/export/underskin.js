// underskin.js: the UNDERSIDE of an equation-core track is an object that casts shadows, and the inside of a closed tube is dark (D230).
// The keeper, 02:22: "during day light leaks into the tube it should be inclosed and pitch black"; 02:25: "i guess we need to make it so the bottom side of the
// track is an object that casts shadows".
//
//   withUnderskin(scene, mesh, segments) -> scene      the export's scene with
//     1. an UNDERSIDE SKIN under EVERY core road cell: a second surface UNDERSKIN_OFFSET_M (0.5 m) along the road's own normal on the side AWAY from the driver
//        (below an open road; OUTWARD of a closed tube, whose normal faces in), normals facing away from the road, castShadows, its own plain dark material;
//     2. a DARK INTERIOR on the cells whose section is a CLOSED RING (a tube swept to 360, the same test as src/texture/flow.js): their material swapped for a
//        copy of itself with ksAmbient TUBE_RING_AMBIENT (0.02, from 0.45). Open roads, cups, edge curves and open tubes keep their light material.
//   the scene itself (the same object) when nothing is a core road cell: a word document's export is exactly what it was.
//
// WHY. A road is one single-sided, zero-thickness shell, so the sun's shadow pass sees only its top faces, and from the sun's side of a closed tube only its
// back faces: with the shadow bias a thin caster lets light through (inferred, not reproduced: the bands' striped edges in the screenshot read as shadow-map
// aliasing on a thin caster). A caster with THICKNESS is the usual cure on AC tracks. On a closed tube the underside skin IS the outside of the pipe wall, so the
// sun's shadow pass sees a surface facing it and everything inside is in its shadow; on an open road, a cup or a spiral it blocks light from below and the
// side, and the track is no longer see-through from underneath. One mechanism. The ambient term (0.45) lights the inside of a tube as brightly as an open road
// whatever the sun does, hence the low ambient on the ring's own material.
//
// THE SKIN IS NOT A PHYSICS SURFACE. Its meshes are named UNDERSKIN_…: no leading digit and no 1ROAD prefix, so AC reads them as scenery (a physics surface is a
// mesh named for a surfaces.ini key, `1ROAD…`; the soft-collision block is `MESHES=1ROAD?`), and the name never contains "seam" (acready.js weldSeams would take it
// for a zipper). Grip and collisions are the road cells', unchanged: the ROAD nodes of the scene are the ones mesh.js made (only a ring's material is the dark copy).
//
// THE SLOT ZONE (a tube closing or opening, where the section is not yet or no longer a ring): the skin runs under it like everywhere else (it is under every
// cell); the dark material only where the ring is closed, cell by cell (a cell is one 2 m chord segment, a seam row is a ring only when BOTH its segments are). At
// each end of a closed run the interior steps from dark to the road's own light over one cell.
//
// WHAT LIGHTS THE INSIDE AFTERWARDS: the ambient 0.02 (2% of the road's), whatever sun the shadow pass still lets in (ksDiffuse is as it was; nothing here proves the
// shadow holds in AC), the car's own lights if it has any, and CSP's if enabled. Whether a fully black interior needs more in AC or CSP is not settled here.
'use strict';
const { closedRing } = require('../texture/flow.js');

const UNDERSKIN_OFFSET_M = 0.5;    // how far the skin stands off the road surface, away from the driver (metres)
const TUBE_RING_AMBIENT = 0.02;    // ksAmbient of a closed ring's interior (an open road's is 0.45, src/geom/mesh.js)
const SKIN_AMBIENT = 0.05, SKIN_DIFFUSE = 0.1;   // the skin's own plain dark material: seen only from outside the pipe or below the road
// The skin only has to CAST A SHADOW, so a road cell's skin keeps about this many of the road's vertices across (a closed tube's rows carry 392; a full-size copy
// of a tube doubled the kn5). Chord sagitta at 32 columns round a 6.4 m radius ring is R(1 − cos(π/32)) = 3.1 cm against the 0.5 m offset, so the skin stays on the far
// side of the road. A seam row keeps all its vertices: its zipper is not a grid.
const SKIN_COLUMNS = 32;

const skinMaterial = () => ({
  name: 't180b_underskin', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0,
  props: [{ name: 'ksAmbient', value: [SKIN_AMBIENT] }, { name: 'ksDiffuse', value: [SKIN_DIFFUSE] }, { name: 'ksSpecular', value: [0] },
    { name: 'ksSpecularEXP', value: [1] }, { name: 'ksEmissive', value: [0, 0, 0] }, { name: 'ksAlphaRef', value: [0] }],
  samplers: [],
});
/** The material with its ambient lowered (the same samplers and every other property): the closed ring's interior. */
const darkOf = (m) => ({ ...m, name: `${m.name}_dark`, props: m.props.map((p) => (p.name === 'ksAmbient' ? { ...p, value: [TUBE_RING_AMBIENT] } : p)) });

/** Which of `mesh.cells` are core road cells (every one gets a skin): Set of cell indexes. */
function skinCells(mesh, segments) {
  const out = new Set();
  if (!mesh._state) return out;
  mesh.cells.forEach((cell, k) => { const seg = segments[cell.piece]; if (seg && seg.word === 'core') out.add(k); });
  return out;
}
/** Which of `mesh.cells` are closed-ring cells (the dark interior): a road cell when its segment is a ring; a seam row when both neighbours are. */
function ringCells(mesh, segments) {
  const st = mesh._state, out = new Set();
  mesh.cells.forEach((cell, k) => {
    if (!st) return;
    const seg = segments[cell.piece];
    if (!seg || seg.word !== 'core' || !closedRing(seg)) return;
    if (cell.seam) { const ia = cell.piece === 0 ? st.pieces.length - 1 : cell.piece - 1; if (!closedRing(segments[ia])) return; }
    out.add(k);
  });
  return out;
}

/**
 * The skin of one road mesh: its vertices UNDERSKIN_OFFSET_M against the road's normal (away from the driver), normals reversed (facing away from the road),
 * triangle winding reversed. `K` is the vertices across of a grid cell (R rows of K): the skin keeps every `step`-th column and the last, so about SKIN_COLUMNS
 * across; without K (a seam row) it keeps every vertex and the road's own triangles, reversed.
 */
function skinOf(m, name, K = null) {
  const P = m.positions, N = m.normals, base = { type: 'mesh', name, material: -1, castShadows: true, visible: true, transparent: false, renderable: true };
  if (!K) {
    const positions = new Float32Array(P.length), normals = new Float32Array(N.length), indices = new Uint16Array(m.indices.length);
    for (let i = 0; i < P.length; i++) { positions[i] = P[i] - UNDERSKIN_OFFSET_M * N[i]; normals[i] = -N[i]; }
    for (let t = 0; t < m.indices.length; t += 3) { indices[t] = m.indices[t]; indices[t + 1] = m.indices[t + 2]; indices[t + 2] = m.indices[t + 1]; }
    return { ...base, positions, normals, uvs: m.uvs, indices };
  }
  const R = P.length / 3 / K, step = Math.max(1, Math.ceil((K - 1) / (SKIN_COLUMNS - 1))), cols = [];
  for (let k = 0; k < K; k += step) cols.push(k);
  if (cols[cols.length - 1] !== K - 1) cols.push(K - 1);
  const C = cols.length, positions = new Float32Array(R * C * 3), normals = new Float32Array(R * C * 3), uvs = new Float32Array(R * C * 2), indices = new Uint16Array((R - 1) * (C - 1) * 6);
  for (let r = 0; r < R; r++) cols.forEach((k, c) => {
    const s = (r * K + k) * 3, d = (r * C + c) * 3;
    for (let a = 0; a < 3; a++) { positions[d + a] = P[s + a] - UNDERSKIN_OFFSET_M * N[s + a]; normals[d + a] = -N[s + a]; }
    uvs[(r * C + c) * 2] = m.uvs[(r * K + k) * 2]; uvs[(r * C + c) * 2 + 1] = m.uvs[(r * K + k) * 2 + 1];
  });
  let t = 0;   // the road's quads are (A, C, B) and (B, C, D) with A = this vertex, B = the next across, C = the next row's; the skin's are wound the other way
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) { const A = r * C + c, B = A + 1, Cc = A + C, D = Cc + 1; indices[t++] = A; indices[t++] = B; indices[t++] = Cc; indices[t++] = B; indices[t++] = D; indices[t++] = Cc; }
  return { ...base, positions, normals, uvs, indices };
}

function withUnderskin(scene, mesh, segments) {
  if (!mesh || !mesh.cells || !mesh.scene) return scene;
  const skinned = skinCells(mesh, segments);
  if (!skinned.size) return scene;
  const rings = ringCells(mesh, segments), kids = scene.root.children, orig = mesh.scene.root.children;
  const materials = scene.materials.slice(), dark = new Map(), skinIndex = materials.push(skinMaterial()) - 1;
  const darkIndex = (i) => { if (!dark.has(i)) dark.set(i, materials.push(darkOf(scene.materials[i])) - 1); return dark.get(i); };
  const skins = [];
  const children = kids.map((c, k) => {
    if (!skinned.has(k)) return c;
    const m = c.children && c.children[0], o = orig[k] && orig[k].children[0];
    if (!m || !o || m.name !== o.name) throw new Error(`withUnderskin: scene node ${k} is not the mesh's cell ${k} (${m && m.name} against ${o && o.name})`);
    const cell = mesh.cells[k], name = m.name.replace(/^1ROAD/, 'UNDERSKIN').replace(/seam/gi, 'join'), sk = skinOf(m, name, cell.seam ? null : mesh._state.pieces[cell.piece].K); sk.material = skinIndex;
    skins.push({ type: 'dummy', name: c.name.replace(/^CELL_/, 'SKIN_').replace(/^SEAM_/, 'JOIN_'), matrix: c.matrix, children: [sk] });
    return rings.has(k) ? { ...c, children: [{ ...m, material: darkIndex(m.material) }, ...c.children.slice(1)] } : c;
  });
  return { ...scene, materials, root: { ...scene.root, children: [...children, ...skins] } };
}

module.exports = { withUnderskin, skinCells, ringCells, skinOf, darkOf, UNDERSKIN_OFFSET_M, TUBE_RING_AMBIENT, SKIN_AMBIENT, SKIN_DIFFUSE, SKIN_COLUMNS };
