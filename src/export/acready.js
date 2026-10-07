// acready.js: the last step before writeKn5, making the scene into what Assetto Corsa actually loads correctly.
// Both rules were found in the first in-game drive (2026-10-02, TEST OVAL in AC + CSP, docs/FINDINGS.md §9):
//
//   flattenForAc(scene)  every mesh's vertices and normals baked into WORLD space under identity nodes, and every mesh
//                        name made unique. The builder's scene places each road cell under its own CELL_/SEAM_ dummy
//                        with a transform, and reuses the cell's name 500 times per piece. AC drew that track, but its
//                        physics did not collide with it: the car fell through. A copy with only these two changes
//                        drove at 900+ km/h. Markers (AC_*) keep their world matrix, since their placement IS their
//                        meaning. The preview keeps the per-cell transforms (fast sculpting); only the export flattens.
//   ensureDiffuse(scene) every material without a txDiffuse sampler gets a small solid-colour DDS bound as txDiffuse.
//                        ksPerPixel takes its colour from txDiffuse; with none bound the road rendered black under any
//                        light. A copy with a grey diffuse bound rendered lit.
//   mergeForAc(scene)    after weldSeams: consecutive road meshes (`1ROAD_…`, not the pit lane) and underside-skin meshes
//                        (`UNDERSKIN_…`) of the same material and flags are joined into chunks, so AC draws a few dozen
//                        meshes instead of one per cell (D260: an equation track's cells are its 2 m segments, so TEST 1
//                        recovered exported 15,271 meshes of ~95 triangles each, and the keeper's frame rate dropped).
//
// None changes geometry: the flattened positions equal the nested scene's world positions (tested), and a merge only concatenates
// the same world-space vertices and triangles (tested: the triangle set is the same, vertex for vertex).
'use strict';
const { encodeDds } = require('../texture/dds.js');

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const isIdentity = (m) => m.every((v, k) => Math.abs(v - IDENTITY[k]) < 1e-12);
/** Row-vector composition, the kn5 convention (tools/kn5.cjs): world = local · parent. */
function mul(a, b) {
  const r = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j]; r[i * 4 + j] = s; }
  return r;
}

function flattenForAc(scene) {
  const out = [], used = new Map();
  const unique = (name) => {
    let n = used.get(name) || 0;
    used.set(name, n + 1);
    if (n === 0) return name;
    let cand; do { n++; cand = `${name}_${n}`; } while (used.has(cand));
    used.set(name, n); used.set(cand, 1);
    return cand;
  };
  (function walk(node, parent) {
    if (node.type === 'mesh') {
      const M = parent, P = node.positions, N = node.normals, nv = P.length / 3;
      let positions = P, normals = N;
      if (!isIdentity(M)) {
        positions = new Float32Array(P.length); normals = new Float32Array(N.length);
        for (let v = 0; v < nv; v++) {
          const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
          positions[3 * v] = x * M[0] + y * M[4] + z * M[8] + M[12];
          positions[3 * v + 1] = x * M[1] + y * M[5] + z * M[9] + M[13];
          positions[3 * v + 2] = x * M[2] + y * M[6] + z * M[10] + M[14];
          const a = N[3 * v], b = N[3 * v + 1], c = N[3 * v + 2];   // rotation only: the builder's frames are rigid
          normals[3 * v] = a * M[0] + b * M[4] + c * M[8];
          normals[3 * v + 1] = a * M[1] + b * M[5] + c * M[9];
          normals[3 * v + 2] = a * M[2] + b * M[6] + c * M[10];
        }
      }
      out.push({ ...node, name: unique(node.name), positions, normals });
      return;
    }
    const W = mul(node.matrix, parent);
    if (/^AC_/i.test(node.name)) out.push({ ...node, name: unique(node.name), matrix: W, children: [] });   // a marker keeps its place
    for (const c of node.children || []) walk(c, W);   // anything under a marker (none today) is flattened beside it
  })(scene.root, IDENTITY);
  return { ...scene, root: { type: 'dummy', name: scene.root.name, matrix: IDENTITY.slice(), children: out } };
}

/**
 * weldSeams(scene): run AFTER flattenForAc (world space). A seam mesh (name contains "seam") is the zipper the builder puts
 * between two pieces whose boundary rows are not identical (src/geom/mesh.js meshSeam). Where the two rows lie within
 * SNAP of each other, that zipper is a strip of slivers (area ~1e-4 m²) whose normals face ALONG the road: AC's tyre rays
 * that land on one see a wall, and at 900+ km/h that is a bump at every such join (the 2026-10-02 oval: the crossed creases
 * peaked at 167° there and at 0.34° anywhere else on the lap). Per point: every second-row point within SNAP of the first
 * row is moved onto it, in the strip and in the next piece alike, so the pieces share that edge; then every strip triangle
 * thinner than SLIVER (its height over its longest edge) is dropped: thinness, not area, is what makes a wall. Triangles that bridge a real gap (a font change across part of the width) are kept, and
 * a strip left with no triangle is removed.
 */
const SNAP = 2e-3, SLIVER = 2 * SNAP;
function weldSeams(scene) {
  const kids = scene.root.children, seams = new Map(), moves = new Map();
  const key = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
  const segDist = (p, a, b) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2], t = L ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L)) : 0;
    const q = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]];
    return { d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), q };
  };
  for (const n of kids) {
    if (n.type !== 'mesh' || !/seam/i.test(n.name)) continue;
    // the zipper is written as row A (the earlier piece's last row) then row B (the later piece's first row); the split is
    // where consecutive points jump back across the road, the largest step in the list
    const P = n.positions, nv = P.length / 3; let split = -1, big = -1;
    for (let i = 1; i < nv; i++) { const d = Math.hypot(P[3 * i] - P[3 * i - 3], P[3 * i + 1] - P[3 * i - 2], P[3 * i + 2] - P[3 * i - 1]); if (d > big) { big = d; split = i; } }
    if (split < 2 || nv - split < 2) continue;
    const A = [], B = []; for (let i = 0; i < nv; i++) (i < split ? A : B).push([P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
    const onA = (p) => { let best = null; for (let i = 1; i < A.length; i++) { const r = segDist(p, A[i - 1], A[i]); if (!best || r.d < best.d) best = r; } return best; };
    let welded = 0;
    for (const p of B) { const s = onA(p); if (s.d <= SNAP) { moves.set(key(...p), s.q); welded++; } }
    if (welded) seams.set(n, true);
  }
  if (!seams.size) return scene;
  const moved = (n) => {   // the mesh with every welded point moved; the same object when nothing in it moves
    let positions = null;
    for (let v = 0; v < n.positions.length; v += 3) {
      const q = moves.get(key(n.positions[v], n.positions[v + 1], n.positions[v + 2]));
      if (!q) continue;
      if (!positions) positions = Float32Array.from(n.positions);
      positions[v] = q[0]; positions[v + 1] = q[1]; positions[v + 2] = q[2];
    }
    return positions ? { ...n, positions } : n;
  };
  const children = [];
  for (const n0 of kids) {
    if (n0.type !== 'mesh') { children.push(n0); continue; }
    const n = moved(n0);
    if (!seams.has(n0)) { children.push(n); continue; }
    const P = n.positions, keep = [];
    for (let i = 0; i < n.indices.length; i += 3) {
      const [a, b, c] = [n.indices[i], n.indices[i + 1], n.indices[i + 2]].map((j) => 3 * j);
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
      const e3 = [P[c] - P[b], P[c + 1] - P[b + 1], P[c + 2] - P[b + 2]], longest = Math.max(Math.hypot(...e1), Math.hypot(...e2), Math.hypot(...e3));
      if (longest > 0 && (2 * area) / longest >= SLIVER) keep.push(n.indices[i], n.indices[i + 1], n.indices[i + 2]);
    }
    if (keep.length) children.push({ ...n, indices: Uint16Array.from(keep) });   // a strip with nothing left is removed
  }
  return { ...scene, root: { ...scene.root, children } };
}

/**
 * A solid-colour diffuse for every material that has none. Paint is near-white; everything else mid-grey. PURE: no node, texture data is a
 * plain Uint8Array. The PREVIEW (app/preview/aclook.js) calls this one in the webview, where there is no Buffer (D224: 5debee8 called the
 * Buffer version from the preview and the first Extend drew nothing). The export uses ensureDiffuse below, which is this plus a Buffer wrap.
 */
function ensureDiffusePlain(scene) {
  const textures = [...scene.textures], made = new Map();
  const tex = (v) => {
    const name = `t180b_solid_${v}.dds`;
    if (!made.has(name)) {
      const W = 4, rgba = new Uint8Array(W * W * 4);
      for (let k = 0; k < W * W; k++) { rgba[4 * k] = v; rgba[4 * k + 1] = v; rgba[4 * k + 2] = v; rgba[4 * k + 3] = 255; }
      if (!textures.some((t) => t.name === name)) textures.push({ name, data: encodeDds({ width: W, height: W, rgba }) });
      made.set(name, true);
    }
    return name;
  };
  const materials = scene.materials.map((m) => (m.samplers.some((s) => s.name === 'txDiffuse') ? m
    : { ...m, samplers: [...m.samplers, { name: 'txDiffuse', slot: 0, texture: tex(/paint/i.test(m.name) ? 235 : 128) }] }));
  return { ...scene, textures, materials };
}

/** The export's: ensureDiffusePlain with every texture's bytes as a Buffer (the scene contract, src/export/scene.js). Buffer is touched only here, at the write. */
function ensureDiffuse(scene) {
  const r = ensureDiffusePlain(scene);
  return { ...r, textures: r.textures.map((t) => (Buffer.isBuffer(t.data) ? t : { ...t, data: Buffer.from(t.data) })) };
}

/**
 * mergeForAc(scene, { maxVerts, chunkM }): run AFTER flattenForAc and weldSeams (world space, seams already welded: weldSeams finds a zipper by its
 * name, which a merge would lose). WHY (D260): each kn5 mesh is at least one draw call (inferred: AC on DirectX 11), and an equation track's
 * cells are its 2 m adapter segments (src/core/adapter.js toSegments, segM 2; src/geom/mesh.js assemble makes one mesh per piece cell), so a
 * 13 km lap came out as ~7,600 road meshes plus as many underside skins. Here consecutive meshes of one CLASS (road `1ROAD_…` except the pit lane
 * `1ROAD_PIT_…`, which keeps its own meshes; the skin `UNDERSKIN_…`) with the same material and flags (castShadows, visible, transparent, renderable:
 * every per-mesh field writeKn5 writes besides the geometry) are joined: positions, normals and uvs concatenated as they are (the same Float32
 * values, so every vertex is byte-identical in world space), the indices offset. A chunk closes before it would pass `maxVerts` (65,536: writeKn5
 * stores 16-bit indices) or when its bounding box's diagonal would pass `chunkM` (400 m, so AC can still leave off what is out of view).
 * The merged meshes are named `1ROAD_chunk_<n>` and `UNDERSKIN_chunk_<n>`: a road chunk keeps the `1ROAD` physics prefix (surfaces.ini's ROAD, and
 * the soft-collision block's `MESHES=1ROAD?`), and a skin chunk stays a non-physics name. A chunk of ONE mesh is that mesh, unchanged (its name too).
 * Everything else (markers, walls, paint, the pit lane, a test export's end wall) is kept as it is, in place: a chunk sits where its first mesh sat.
 * Tangents are writeKn5's, from each vertex's own triangles; a merge shares no vertex between meshes, so they are the same.
 */
const MERGE_CLASSES = Object.freeze([{ re: /^1ROAD_(?!PIT)/, prefix: '1ROAD_chunk_' }, { re: /^UNDERSKIN_/, prefix: 'UNDERSKIN_chunk_' }]);
const MERGE_MAX_VERTS = 65536, MERGE_CHUNK_M = 400;
function mergeForAc(scene, { maxVerts = MERGE_MAX_VERTS, chunkM = MERGE_CHUNK_M } = {}) {
  const kids = scene.root.children, out = [], open = new Map(), taken = new Set(kids.map((n) => n.name));
  const box = (P) => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { if (P[i + k] < b[k]) b[k] = P[i + k]; if (P[i + k] > b[k + 3]) b[k + 3] = P[i + k]; } return b; };
  const join = (a, b) => [0, 1, 2].map((k) => Math.min(a[k], b[k])).concat([3, 4, 5].map((k) => Math.max(a[k], b[k])));
  const diag = (b) => Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
  for (const n of kids) {
    const c = n.type === 'mesh' ? MERGE_CLASSES.findIndex((x) => x.re.test(n.name)) : -1;
    if (c < 0) { out.push(n); continue; }
    const key = [c, n.material, !!n.castShadows, n.visible !== false, !!n.transparent, n.renderable !== false].join('|'), nv = n.positions.length / 3, bb = box(n.positions);
    let ch = open.get(key);
    if (ch) { const u = join(ch.bb, bb); if (ch.nv + nv > maxVerts || diag(u) > chunkM) ch = null; else ch.bb = u; }
    if (!ch) { ch = { c, parts: [], nv: 0, bb }; open.set(key, ch); out.push(ch); }
    ch.parts.push(n); ch.nv += nv;
  }
  const count = MERGE_CLASSES.map(() => 0);
  const children = out.map((x) => {
    if (!x.parts) return x;
    if (x.parts.length === 1) return x.parts[0];
    let name; do { name = `${MERGE_CLASSES[x.c].prefix}${count[x.c]++}`; } while (taken.has(name)); taken.add(name);
    const positions = new Float32Array(x.nv * 3), normals = new Float32Array(x.nv * 3), uvs = new Float32Array(x.nv * 2);
    const indices = new Uint16Array(x.parts.reduce((a, p) => a + p.indices.length, 0));
    let v = 0, t = 0;
    for (const p of x.parts) {
      const pv = p.positions.length / 3;
      positions.set(p.positions, v * 3); normals.set(p.normals, v * 3); uvs.set(p.uvs, v * 2);
      for (let i = 0; i < p.indices.length; i++) indices[t++] = p.indices[i] + v;
      v += pv;
    }
    return { ...x.parts[0], name, positions, normals, uvs, indices };
  });
  return { ...scene, root: { ...scene.root, children } };
}

module.exports = { flattenForAc, ensureDiffuse, ensureDiffusePlain, weldSeams, mergeForAc, MERGE_MAX_VERTS, MERGE_CHUNK_M, SNAP, SLIVER };
