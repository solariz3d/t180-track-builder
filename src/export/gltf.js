// gltf.js: toGlb(scene, opts) -> { glb, nodes }, a glTF 2.0 binary (.glb) of the export's own scene, for Blender (the user, 2026-10-29: the track's geometry as a
// file to take into Blender, to tweak it or dress it with an environment, then FBX on to the game's pipeline).
//
// The scene is the one the kn5 is written from (src/export/fromwords.js acScene: flattened, welded, merged into chunks by src/export/acready.js, every material
// given a diffuse texture), so this is a second serialiser of the same meshes, not a second geometry path:
//   · every kn5 mesh is a node of the SAME NAME carrying the SAME Float32 positions and normals; its uv is written as the kn5 writes it (u, 1 − v: the scene
//     holds v = 0 at the bottom, kn5 and glTF at the top); its indices are the kn5's own unsigned shorts (a chunk never passes 65,536 vertices) or 32-bit
//     where a mesh would need them. Y up and metres, as AC has them; Blender's importer turns Y up into its Z up itself.
//   · the meshes are grouped ONE NODE PER PIECE PER KIND, named with the piece first so a Blender user selects "piece 7" by name: p07_road (its road chunks,
//     a gripped piece's 1GRIPnnn_ chunks too), p07_underskin, p07_catch; the pit lane's road is pitlane_road; a mesh that names no piece (the paint, a test
//     end wall) stays at the top under its own name. A group carries no transform.
//   · the AC_ markers are empty nodes of the same names, their matrices as the kn5 stores them (kn5's row-vector matrix with the translation in elements
//     12-14 is, number for number, glTF's column-major matrix).
//   · the AI line, when given (`ai`: its points' positions), is one node `ai_fast_lane` with one LINE_STRIP primitive (a LINE_LOOP on a closed lap); not with `pieces`.
//   · one material per scene material, of the same name: unlit-looking PBR (metallic 0, roughness 1) with the diffuse texture embedded as PNG (decoded from
//     the scene's own 32-bit DDS, level 0); a texture this cannot read back (a compressed DDS) is left out and listed in `skipped`.
// The writer refuses a mesh whose ancestors carry a transform (GLTF_NOT_FLAT): the export's scene is flat, and a writer that guessed would move the road.
// `pieces`, when given, keeps only the meshes of those piece ids (['p2', 'p7']) and the markers whose position lies within their bounds (10 m around).
'use strict';
const zlib = require('zlib');
const { ddsLevel } = require('../texture/dds.js');
const { encodePng } = require('../texture/png.js');
const { validateScene } = require('./scene.js');

class GltfError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'GltfError'; this.code = code; }
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const isIdentity = (m) => !m || m.every((x, i) => Math.abs(x - IDENTITY[i]) < 1e-12);
const FLOAT = 5126, USHORT = 5123, UINT = 5125, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963, LINE_LOOP = 2, LINE_STRIP = 3;
const MARGIN_M = 10;   // a marker within this many metres of the selected pieces' bounds goes with them

/** A mesh name's piece and kind: 1ROAD_p5_chunk_0 -> { piece: 5, kind: 'road' }; the pit lane's road -> { group: 'pitlane_road' }; null for a mesh of no piece. */
function pieceKind(name) {
  if (/^1ROAD_PIT_/i.test(name)) return { group: 'pitlane_road' };
  const m = /^(.+?)_p(\d+)_/.exec(name); if (!m) return null;
  let kind = m[1].replace(/^\d+/, '').toLowerCase();
  if (/^grip\d+$/.test(kind)) kind = 'road';   // a gripped piece's road (src/export/gripkeys.js: 1GRIPnnn_ in place of 1ROAD_)
  if (kind === 'road_catch') kind = 'catch';
  return { piece: Number(m[2]), kind };
}

/** The scene's meshes and markers, every mesh's ancestors checked to carry no transform. */
function flatOf(scene) {
  const meshes = [], markers = [];
  (function walk(n, moved) {
    if (n.type === 'mesh') { if (moved) throw new GltfError('GLTF_NOT_FLAT', `mesh ${n.name} sits under a node that moves it; the export's scene is flat (src/export/acready.js flattenForAc)`); meshes.push(n); return; }
    if (/^AC_/i.test(n.name)) markers.push(n);
    for (const c of n.children || []) walk(c, moved || !isIdentity(n.matrix));
  })(scene.root, false);
  return { meshes, markers };
}

function toGlb(scene, { name = 'track', ai = null, closed = false, pieces = null, generator = 't180-track-builder' } = {}) {
  validateScene(scene);
  let { meshes, markers } = flatOf(scene);
  if (pieces) {
    const want = new Set(pieces.map((p) => Number(String(p).replace(/^p/, ''))));
    meshes = meshes.filter((m) => { const pk = pieceKind(m.name); return pk && pk.piece !== undefined && want.has(pk.piece); });
    if (!meshes.length) throw new GltfError('GLTF_NO_PIECES', `no mesh belongs to the pieces ${pieces.join(', ')}`);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of meshes) for (let i = 0; i < m.positions.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a], m.positions[i]); hi[a] = Math.max(hi[a], m.positions[i]); }
    markers = markers.filter((d) => [0, 1, 2].every((a) => d.matrix[12 + a] >= lo[a] - MARGIN_M && d.matrix[12 + a] <= hi[a] + MARGIN_M));
  }
  // the binary chunk: one bufferView per array, each 4-byte aligned
  const parts = []; let len = 0;
  const bufferViews = [], accessors = [];
  const view = (bytes, target) => {
    const pad = (4 - (len % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }
    const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength); parts.push(b);
    bufferViews.push({ buffer: 0, byteOffset: len, byteLength: b.length, ...(target ? { target } : {}) }); len += b.length;
    return bufferViews.length - 1;
  };
  const accessor = (data, type, componentType, target, withBounds) => {
    const a = { bufferView: view(data, target), componentType, count: data.length / { SCALAR: 1, VEC2: 2, VEC3: 3 }[type], type };
    if (withBounds) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < data.length; i++) { const k = i % 3; if (data[i] < mn[k]) mn[k] = data[i]; if (data[i] > mx[k]) mx[k] = data[i]; } a.min = mn; a.max = mx; }
    accessors.push(a); return accessors.length - 1;
  };
  // materials and their textures (PNG, decoded from the scene's own DDS)
  const images = [], textures = [], skipped = [], texIndex = new Map();
  const textureOf = (file) => {
    if (texIndex.has(file)) return texIndex.get(file);
    const t = scene.textures.find((x) => x.name === file); let idx = null;
    if (t) {
      try { const img = ddsLevel(t.data, 0), png = encodePng(img, (raw) => zlib.deflateSync(raw)); images.push({ name: file.replace(/\.dds$/i, ''), mimeType: 'image/png', bufferView: view(png) }); textures.push({ source: images.length - 1, sampler: 0 }); idx = textures.length - 1; }
      catch (e) { if (e.name !== 'TextureError') throw e; skipped.push(`${file}: ${e.message}`); }
    }
    texIndex.set(file, idx); return idx;
  };
  const used = new Map(), materials = [];
  const materialOf = (i) => {
    if (used.has(i)) return used.get(i);
    const m = scene.materials[i], diffuse = m.samplers.find((s) => s.name === 'txDiffuse'), tx = diffuse ? textureOf(diffuse.texture) : null;
    materials.push({ name: m.name, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1, ...(tx !== null ? { baseColorTexture: { index: tx } } : {}) } });
    used.set(i, materials.length - 1); return materials.length - 1;
  };
  // nodes: the meshes, grouped by piece and kind; the markers; the AI line
  const nodes = [], gltfMeshes = [], roots = [], groups = new Map();
  const maxPiece = Math.max(1, ...meshes.map((m) => { const pk = pieceKind(m.name); return pk && pk.piece !== undefined ? pk.piece : 0; }));
  const width = Math.max(2, String(maxPiece).length);
  const groupOf = (m) => {
    const pk = pieceKind(m.name); if (!pk) return null;
    const g = pk.group || `p${String(pk.piece).padStart(width, '0')}_${pk.kind}`;
    if (!groups.has(g)) { nodes.push({ name: g, children: [] }); groups.set(g, nodes.length - 1); roots.push(nodes.length - 1); }
    return groups.get(g);
  };
  for (const m of meshes) {
    const uv = new Float32Array(m.uvs.length); for (let i = 0; i < uv.length; i += 2) { uv[i] = m.uvs[i]; uv[i + 1] = 1 - m.uvs[i + 1]; }
    const big = m.indices.some((x) => x > 65535), idx = big ? Uint32Array.from(m.indices) : (m.indices instanceof Uint16Array ? m.indices : Uint16Array.from(m.indices));
    const prim = {
      attributes: { POSITION: accessor(m.positions, 'VEC3', FLOAT, ARRAY_BUFFER, true), NORMAL: accessor(m.normals, 'VEC3', FLOAT, ARRAY_BUFFER, false), TEXCOORD_0: accessor(uv, 'VEC2', FLOAT, ARRAY_BUFFER, false) },
      indices: accessor(idx, 'SCALAR', big ? UINT : USHORT, ELEMENT_ARRAY_BUFFER, false), material: materialOf(m.material),
    };
    gltfMeshes.push({ name: m.name, primitives: [prim] });
    nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 });
    const at = nodes.length - 1, g = groupOf(m);   // the mesh's index first: a new group is pushed after it
    if (g === null) roots.push(at); else nodes[g].children.push(at);
  }
  for (const d of markers) { nodes.push({ name: d.name, ...(isIdentity(d.matrix) ? {} : { matrix: d.matrix.slice() }) }); roots.push(nodes.length - 1); }
  if (ai && ai.length > 1 && !pieces) {   // the AI line is the whole lap's: a selection of pieces leaves it out
    const pos = new Float32Array(ai.length * 3); ai.forEach((p, i) => { pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; });
    gltfMeshes.push({ name: 'ai_fast_lane', primitives: [{ attributes: { POSITION: accessor(pos, 'VEC3', FLOAT, ARRAY_BUFFER, true) }, mode: closed ? LINE_LOOP : LINE_STRIP }] });
    nodes.push({ name: 'ai_fast_lane', mesh: gltfMeshes.length - 1 }); roots.push(nodes.length - 1);
  }
  const pad = (4 - (len % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }
  const json = {
    asset: { version: '2.0', generator },
    scene: 0, scenes: [{ name, nodes: roots }], nodes, meshes: gltfMeshes, accessors, bufferViews, buffers: [{ byteLength: len }],
    ...(materials.length ? { materials } : {}), ...(images.length ? { images, textures, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] } : {}),
  };
  let jb = Buffer.from(JSON.stringify(json), 'utf8'); const jpad = (4 - (jb.length % 4)) % 4; if (jpad) jb = Buffer.concat([jb, Buffer.alloc(jpad, 0x20)]);
  const bin = Buffer.concat(parts), total = 12 + 8 + jb.length + 8 + bin.length, head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.write('glTF', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  jh.writeUInt32LE(jb.length, 0); jh.writeUInt32LE(0x4E4F534A, 4); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  return { glb: Buffer.concat([head, jh, jb, bh, bin]), nodes: nodes.map((n) => n.name), meshes: meshes.length, markers: markers.length, skipped };
}

module.exports = { toGlb, pieceKind, GltfError };
