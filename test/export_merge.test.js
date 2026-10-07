// export_merge.test.js: node --test test/export_merge.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D260 (the keeper, 2026-10-06 18:31: "i should be getting 400-500 frames in a map with no complex lighting, is the track geometry like too complex"):
// an equation track's cells are its 2 m adapter segments, so the export wrote one mesh per 2 m of road and one per 2 m of underside skin (TEST 1
// recovered: 15,271 meshes of ~95 triangles). src/export/acready.js mergeForAc joins them into chunks after the weld. Rows:
//   1  the merge keeps every vertex and every triangle (positions, normals, uvs, world space, byte for byte) and only regroups them
//   2  a chunk stays inside the 16-bit index budget and inside its length; a lone mesh is left as it is; different materials or flags never join
//   3  everything that is not a road cell or a skin (markers, walls, paint, the pit lane) stays where it was, unchanged
//   4  an exported closed lap: a handful of meshes instead of hundreds, the SAME triangle set as the unmerged export, every road chunk a 1ROAD physics name
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { mergeForAc, MERGE_MAX_VERTS, MERGE_CHUNK_M } = require('../src/export/acready.js');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const AD = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const { startLayout } = require('../app/core/coreshell.js');
const { readKn5 } = require('../tools/kn5.cjs');

const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** A flat strip mesh (world space, as flattenForAc leaves it): `rows` rows of `cols` vertices from x0 along x, with its own uvs and normals. */
function strip(name, { x0 = 0, rows = 3, cols = 4, material = 0, step = 2, ...flags } = {}) {
  const nv = rows * cols, positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), idx = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const v = r * cols + c; positions.set([x0 + r * step + 0.1 * c, 0.01 * c, c * 1.5], v * 3); normals.set([0, 1, 0.001 * v], v * 3); uvs.set([c / 10, (x0 + r * step) / 10], v * 2); }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) { const a = r * cols + c; idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1); }
  return { type: 'mesh', name, material, positions, normals, uvs, indices: Uint16Array.from(idx), castShadows: true, visible: true, transparent: false, renderable: true, ...flags };
}
const scene = (children) => ({ textures: [], materials: [{ name: 'a' }, { name: 'b' }], root: { type: 'dummy', name: 't180b_track', matrix: ID.slice(), children } });
/** Every triangle as its three vertices (position, normal, uv), winding kept, rotated to start at the smallest; a multiset per material. */
function triangles(sc) {
  const m = new Map();
  for (const n of sc.root.children) {
    if (n.type !== 'mesh') continue;
    const v = (i) => [...n.positions.subarray(3 * i, 3 * i + 3), ...n.normals.subarray(3 * i, 3 * i + 3), ...n.uvs.subarray(2 * i, 2 * i + 2)].join(',');
    for (let t = 0; t < n.indices.length; t += 3) {
      const a = [v(n.indices[t]), v(n.indices[t + 1]), v(n.indices[t + 2])]; let r = 0; if (a[1] < a[r]) r = 1; if (a[2] < a[r]) r = 2;
      const k = `${n.material}|${a[r]}|${a[(r + 1) % 3]}|${a[(r + 2) % 3]}`; m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
}
const meshes = (sc) => sc.root.children.filter((n) => n.type === 'mesh');

test('row 1: the merge keeps every vertex and every triangle (position, normal, uv), byte for byte, and joins consecutive road cells and skins', () => {
  const kids = []; for (let i = 0; i < 20; i++) kids.push(strip(`1ROAD_p1_body_${i}`, { x0: 4 * i }), strip(`UNDERSKIN_p1_${i}`, { x0: 4 * i, material: 1 }));
  const before = scene(kids), after = mergeForAc(before);
  assert.deepEqual([...triangles(after)].sort(), [...triangles(before)].sort(), 'the same triangles, each as often');
  assert.deepEqual(meshes(after).map((n) => n.name), ['1ROAD_chunk_0', 'UNDERSKIN_chunk_0'], 'twenty road cells and twenty skins became one chunk each');
  const v = (sc) => meshes(sc).reduce((a, n) => a + n.positions.length / 3, 0); assert.equal(v(after), v(before), 'no vertex added or lost');
  assert.equal(meshes(before).length, 40, 'control: the scene it was given is untouched');
});

test('row 2: a chunk never passes the 16-bit index budget or its length; a lone mesh stays as it was; another material or other flags never join', () => {
  assert.equal(MERGE_MAX_VERTS, 65536, 'writeKn5 writes 16-bit indices'); assert.equal(MERGE_CHUNK_M, 400);
  const big = []; for (let i = 0; i < 6; i++) big.push(strip(`1ROAD_w_${i}`, { x0: 2 * i, rows: 100, cols: 50, step: 0.01 }));   // 5,000 vertices each
  const b = meshes(mergeForAc(scene(big), { maxVerts: 12000 })); assert.deepEqual(b.map((n) => n.positions.length / 3), [10000, 10000, 10000], 'by the vertex budget');
  assert.ok(b.every((n) => Math.max(...n.indices) < 12000));
  const far = []; for (let i = 0; i < 12; i++) far.push(strip(`1ROAD_f_${i}`, { x0: 100 * i }));
  const f = meshes(mergeForAc(scene(far))); assert.ok(f.length >= 3 && f.length <= 4, `1.1 km of road in ${f.length} chunks of at most 400 m`);
  for (const n of f) { const xs = []; for (let k = 0; k < n.positions.length; k += 3) xs.push(n.positions[k]); assert.ok(Math.max(...xs) - Math.min(...xs) <= 400, n.name); }
  const lone = strip('1ROAD_only_0'), l = meshes(mergeForAc(scene([lone]))); assert.equal(l[0], lone, 'a chunk of one mesh is that mesh, name and all');
  const mixed = meshes(mergeForAc(scene([strip('1ROAD_a_0'), strip('1ROAD_a_1', { material: 1 }), strip('1ROAD_a_2', { x0: 2 }), strip('1ROAD_a_3', { x0: 4, castShadows: false })])));
  assert.deepEqual(mixed.map((n) => [n.name, n.material, n.castShadows]), [['1ROAD_chunk_0', 0, true], ['1ROAD_a_1', 1, true], ['1ROAD_a_3', 0, false]], 'only the two with one material and one set of flags joined');
});

test('row 3: markers, walls, paint and the pit lane stay where they were, unchanged; a chunk sits where its first mesh sat', () => {
  const marker = { type: 'dummy', name: 'AC_START_0', matrix: ID.slice(), children: [] }, wall = strip('1WALL_T180_END'), paint = strip('t180b_paint_0', { material: 1 }), pit = strip('1ROAD_PIT_lane_0');
  const kids = [strip('1ROAD_p_0'), marker, strip('1ROAD_p_1', { x0: 4 }), wall, pit, paint, strip('1ROAD_p_2', { x0: 8 })];
  const out = mergeForAc(scene(kids)).root.children;
  assert.deepEqual(out.map((n) => n.name), ['1ROAD_chunk_0', 'AC_START_0', '1WALL_T180_END', '1ROAD_PIT_lane_0', 't180b_paint_0']);
  for (const n of [marker, wall, pit, paint]) assert.equal(out.find((x) => x.name === n.name), n, `${n.name} is the very same node`);
  const taken = mergeForAc(scene([strip('1ROAD_chunk_0', { material: 1 }), strip('1ROAD_x_0'), strip('1ROAD_x_1', { x0: 4 })])).root.children.map((n) => n.name);
  assert.equal(new Set(taken).size, taken.length, `names stay unique: ${taken.join(', ')}`);
});

test('row 4: an exported closed lap has a few meshes instead of hundreds, the SAME triangle set as the unmerged export, and every road chunk is a 1ROAD physics name', () => {
  let d = extend(D.createDoc('merge lap'), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Math.PI * 90, transition: 40, targets: { kh: 1 / 180 } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const lap = close(d, { edited: [0] }); assert.equal(lap.converged, true, lap.report);
  const doc = lap.doc, segs = AD.toSegments(doc), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }, lift = (q) => AD.offsetPath(doc, segs, q);
  const exp = (mergeMeshes) => FW.buildFromSegments(segs, { name: 'merge lap', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start), mergeMeshes });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't180-merge-'));
  try {
    const read = (b) => { const f = path.join(tmp, `${Math.random()}.kn5`); fs.writeFileSync(f, Buffer.from(b.kn5.buffer ? Buffer.from(b.kn5.buffer, b.kn5.byteOffset, b.kn5.byteLength) : b.kn5)); return readKn5(f); };
    const off = exp(false), on = exp(undefined), k0 = read(off), k1 = read(on);
    const tris = (k) => { const m = new Map(); for (const me of k.meshes) for (let t = 0; t < me.idx.length; t += 3) { const v = [0, 1, 2].map((j) => Array.from(me.pos.slice(3 * me.idx[t + j], 3 * me.idx[t + j] + 3)).join(',')); let r = 0; if (v[1] < v[r]) r = 1; if (v[2] < v[r]) r = 2; const key = `${me.material}|${v[r]}|${v[(r + 1) % 3]}|${v[(r + 2) % 3]}`; m.set(key, (m.get(key) || 0) + 1); } return m; };
    assert.ok(k0.meshes.length > 1000, `control: the unmerged lap has ${k0.meshes.length} meshes`);
    assert.ok(k1.meshes.length < 40, `merged: ${k1.meshes.length} meshes`);
    assert.deepEqual([...tris(k1)].sort(), [...tris(k0)].sort(), 'the same triangles in the same places');
    const road0 = k0.meshes.filter((m) => /^1ROAD_/.test(m.name)).reduce((a, m) => a + m.idx.length, 0), road1 = k1.meshes.filter((m) => /^1ROAD_/.test(m.name));
    assert.equal(road1.reduce((a, m) => a + m.idx.length, 0), road0, 'every road triangle is still in a 1ROAD_ (physics) mesh');
    assert.ok(road1.some((m) => /^1ROAD_chunk_\d+$/.test(m.name)), 'the road is in chunks');
    assert.ok(k1.meshes.filter((m) => /^UNDERSKIN_/.test(m.name)).every((m) => !/^\d/.test(m.name)), 'the skin is still not a physics surface');
    assert.deepEqual(k1.dummies.map((x) => x.name).sort(), k0.dummies.map((x) => x.name).sort(), 'the markers are the same');
    assert.equal(Buffer.compare(Buffer.from(on.ai), Buffer.from(off.ai)), 0, 'the AI line is byte for byte the same');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
