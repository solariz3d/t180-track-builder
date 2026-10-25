// catch.js: a PHYSICAL CATCH under the road (D341, plan :876-884).
//
//   withCatch(scene, mesh, segments, mode) -> scene     the export's scene with a second road surface CATCH_OFFSET_M under each chosen core road cell
//   catchCells(cells, segments, mode)      -> [index]   which of mesh.cells get one (pure)
//   rangesOfAmber(amber)                   -> [{s0,s1}] the stretches validation lists as load-sustained (pure)
//   catchOf(m, name, K)                    -> mesh      one cell's catch
//
// WHY. The road is one zero-thickness surface (CSP's soft block, MAX_DEPTH 4), and the skin under it (underskin.js) is scenery, so nothing physical stands behind a
// body that crosses the road. The 2026-10-16 replay of ELYSIUM (a sustained 56-62 g at 817 km/h on a 71 m radius at 70 degrees of bank) is the case: seven passes held with
// 4-8 cm of box clearance and the eighth's box went through the road 0.4 s after its peak, 2.2 m in three frames, and the car fell for five seconds. The catch is a second
// chance: a surface the body meets if it gets through the first.
//
// WHAT IT IS. The road cell's own vertices CATCH_OFFSET_M against the road's normal (below an open road, outward of a closed tube whose normal faces in), with the road's own
// normals and winding, so it faces the driver as the road does (a body coming down through the road meets its front side). It is named `1ROAD_CATCH_…`: the ROAD surface, and the
// soft-collision block's `MESHES=1ROAD?` covers the name, so it needs no surface of its own and surfaces.ini is the file it was. It has no light, no shadow and is not drawn. A
// column grid is kept to about CATCH_COLUMNS across, as the skin's is: a catch has to be there, not to be smooth, and the chord's sagitta stays far under the offset.
//
// WHERE (the switch, `underCatch` in the export's options):
//   'loaded' (the default)  the cells that overlap a stretch validation lists as load-sustained (a load past 55 g held more than 0.5 s, src/validate/limits.js), widened CATCH_PAD_M each
//                           side. A track with no such stretch exports the very kn5 it did before. Chosen over 'all' because the only measurement is of that load, a second
//                           drivable surface everywhere is unmeasured in AC, and it adds triangles (a catch is about the road's own count, decimated across).
//   'all'                   every core road cell.
//   'off'                   none.
//   [{ s0, s1 }, …]         the cells overlapping those ranges (the pad applies): a stretch chosen by hand.
//
// NOT MEASURED, and said so: that a second surface at this depth stops a body that has gone through the first in AC. The replay says where one is needed and why; whether the catch
// holds is the user's re-export and one fast pass. A catch that does not hold costs triangles and nothing else that is known.
'use strict';

const CATCH_OFFSET_M = 0.3;   // how far under the road: past the box's 5-7 cm of clearance at 62 g and a tyre's squash (about 17 cm), a fifth of the skin's 0.5 m so it is the body's NEXT surface
const CATCH_PAD_M = 40;       // each side of a loaded stretch
const CATCH_COLUMNS = 32;     // about this many vertices across a cell (the skin's SKIN_COLUMNS)
const CATCH_PREFIX = '1ROAD_CATCH';

const catchMaterial = () => ({
  name: 't180b_catch', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0,
  props: [{ name: 'ksAmbient', value: [0.05] }, { name: 'ksDiffuse', value: [0.1] }, { name: 'ksSpecular', value: [0] },
    { name: 'ksSpecularEXP', value: [1] }, { name: 'ksEmissive', value: [0, 0, 0] }, { name: 'ksAlphaRef', value: [0] }],
  samplers: [],
});

/** The stretches validation lists as load-sustained, as { s0, s1 }. */
function rangesOfAmber(amber) {
  return (amber || []).filter((a) => a.reason === 'load-sustained').map((a) => ({ s0: a.s0, s1: a.s1 }));
}

/**
 * Which of `cells` (mesh.cells: { piece, s0, s1, seam? }) get a catch: Array of cell indexes, ascending. `segments` is the export's, so only the equation core's own road
 * cells qualify (word 'core', the cells underskin.js skins). `mode` is 'off', 'all' or an array of { s0, s1 }; anything else throws, by the option's name.
 */
function catchCells(cells, segments, mode) {
  const ok = (cell) => { const g = segments[cell.piece]; return !!g && g.word === 'core'; };
  if (mode === 'off') return [];
  if (mode === 'all') return cells.map((c, k) => (ok(c) ? k : -1)).filter((k) => k >= 0);
  if (!Array.isArray(mode)) throw new Error(`underCatch must be 'loaded', 'all', 'off' or a list of { s0, s1 }, not ${JSON.stringify(mode)}`);
  const out = [];
  cells.forEach((c, k) => {
    if (!ok(c)) return;
    if (mode.some((r) => Number.isFinite(r.s0) && Number.isFinite(r.s1) && c.s1 >= r.s0 - CATCH_PAD_M && c.s0 <= r.s1 + CATCH_PAD_M)) out.push(k);
  });
  return out;
}

/**
 * The catch of one road mesh: its vertices CATCH_OFFSET_M against the road's normal, the road's normals, uvs and winding. `K` is the vertices across of a grid cell (R rows of K):
 * about CATCH_COLUMNS are kept (every step-th column and the last); without K (a seam row) every vertex and the road's own triangles are kept.
 */
function catchOf(m, name, K = null) {
  const P = m.positions, N = m.normals, base = { type: 'mesh', name, material: -1, castShadows: false, visible: false, transparent: false, renderable: false };
  if (!K) {
    const positions = new Float32Array(P.length);
    for (let i = 0; i < P.length; i++) positions[i] = P[i] - CATCH_OFFSET_M * N[i];
    return { ...base, positions, normals: N.slice(), uvs: m.uvs, indices: m.indices.slice() };
  }
  const R = P.length / 3 / K, step = Math.max(1, Math.ceil((K - 1) / (CATCH_COLUMNS - 1))), cols = [];
  for (let k = 0; k < K; k += step) cols.push(k);
  if (cols[cols.length - 1] !== K - 1) cols.push(K - 1);
  const C = cols.length, positions = new Float32Array(R * C * 3), normals = new Float32Array(R * C * 3), uvs = new Float32Array(R * C * 2), indices = new Uint16Array((R - 1) * (C - 1) * 6);
  for (let r = 0; r < R; r++) cols.forEach((k, c) => {
    const s = (r * K + k) * 3, d = (r * C + c) * 3;
    for (let a = 0; a < 3; a++) { positions[d + a] = P[s + a] - CATCH_OFFSET_M * N[s + a]; normals[d + a] = N[s + a]; }
    uvs[(r * C + c) * 2] = m.uvs[(r * K + k) * 2]; uvs[(r * C + c) * 2 + 1] = m.uvs[(r * K + k) * 2 + 1];
  });
  let t = 0;   // the road's own quads: (A, C, B) and (B, C, D), A this vertex, B the next across, C the next row's (underskin.js reverses these; the catch keeps them)
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) { const A = r * C + c, B = A + 1, Cc = A + C, D = Cc + 1; indices[t++] = A; indices[t++] = Cc; indices[t++] = B; indices[t++] = B; indices[t++] = Cc; indices[t++] = D; }
  return { ...base, positions, normals, uvs, indices };
}

/**
 * The scene with a catch under the cells `mode` chooses, appended after everything the scene already holds (so the road cells keep their places, which gripkeys.js
 * and the merge rely on) and with one material added at the end. The same scene when no cell is chosen. `mesh` is geometry/mesh.js's result (its cells and scene).
 */
function withCatch(scene, mesh, segments, mode) {
  if (!mesh || !mesh.cells || !mesh.scene || !mesh._state) return scene;
  const chosen = catchCells(mesh.cells, segments, mode);
  if (!chosen.length) return scene;
  const kids = scene.root.children, orig = mesh.scene.root.children, materials = scene.materials.slice(), matIndex = materials.push(catchMaterial()) - 1, catches = [];
  for (const k of chosen) {
    const c = kids[k], m = c && c.children && c.children[0], o = orig[k] && orig[k].children[0];
    if (!m || !o || m.name !== o.name) throw new Error(`withCatch: scene node ${k} is not the mesh's cell ${k} (${m && m.name} against ${o && o.name})`);
    const cell = mesh.cells[k], name = m.name.replace(/^1ROAD/, CATCH_PREFIX).replace(/seam/gi, 'join'), ct = catchOf(m, name, cell.seam ? null : mesh._state.pieces[cell.piece].K);
    ct.material = matIndex;
    catches.push({ type: 'dummy', name: c.name.replace(/^CELL_/, 'CATCH_').replace(/^SEAM_/, 'CATCHJOIN_'), matrix: c.matrix, children: [ct] });
  }
  return { ...scene, materials, root: { ...scene.root, children: [...kids, ...catches] } };
}

module.exports = { withCatch, catchCells, catchOf, rangesOfAmber, CATCH_OFFSET_M, CATCH_PAD_M, CATCH_COLUMNS, CATCH_PREFIX };
