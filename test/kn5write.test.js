// kn5write.test.js: node --test test/*.test.js
// The kn5 v5 writer (src/export/kn5write.js) and the scene validator (src/export/scene.js), dependency-free.
//
// TOLERANCES, stated before the first run:
// - Local positions and normals: EXACT. They are written verbatim as float32, so the bytes read back are the bytes given.
// - World positions and marker pos/fwd through tools/kn5.cjs: EXACT against the same float64 composition kn5.cjs does
//   (M = m x parent, p' = x*M0 + y*M4 + z*M8 + M12, stored as float32). The matrices are float32 on disk, so the
//   expectation composes the float32-rounded matrices.
// - u: EXACT. v: NOT exact, because the writer stores 1 - v as float32; the bound is |dv| <= 2^-23 * max(1, |v|).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeKn5 } = require('../src/export/kn5write.js');
const { validateScene, SceneError } = require('../src/export/scene.js');
const { readKn5 } = require('../tools/kn5.cjs');

const I16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// Rotation by `deg` about Y, then translation t: stored order, rows are the basis vectors, translation at [12..14].
function rotY(deg, t = [0, 0, 0]) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, t[0], t[1], t[2], 1];
}
const marker = (name, deg, t) => ({ type: 'dummy', name, matrix: rotY(deg, t), children: [] });
const mesh = (name, material, P, N, UV, idx) => ({
  type: 'mesh', name, material, positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(UV),
  indices: new Uint16Array(idx), castShadows: true, visible: true, transparent: false, renderable: true,
});

function smallScene() {
  // A 4 x 2 m road quad in the XZ plane (normal +Y, CCW seen from above), and a 1-triangle wall facing +Z.
  const road = mesh('1ROAD', 0,
    [0, 0, 0, 4, 0, 0, 4, 0, -2, 0, 0, -2], [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 1, 0.5, 0, 0.5], [0, 1, 2, 0, 2, 3]);
  const wall = mesh('1WALL', 1, [0, 0, 0, 1, 0, 0, 0, 1.5, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1], [0.1, 0.3, 0.7, 0.3, 0.1, 0.9], [0, 1, 2]);
  wall.renderable = false;
  return {
    textures: [{ name: 'road.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]) }],
    materials: [
      { name: 'road', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0,
        props: [{ name: 'ksDiffuse', value: [0.4] }, { name: 'ksAmbient', value: [0.4] }, { name: 'tint', value: [0.2, 0.3] }],
        samplers: [{ name: 'txDiffuse', slot: 0, texture: 'road.png' }] },
      { name: 'béton', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0, props: [], samplers: [] },   // non-ASCII: UTF-8 byte length != char length
    ],
    root: { type: 'dummy', name: 'track', matrix: I16.slice(), children: [
      { type: 'dummy', name: 'grp', matrix: rotY(90, [10, 2, -5]), children: [road] },
      wall,
      marker('AC_START_0', 30, [1, 1.5, -1]), marker('AC_START_1', 30, [-3, 1.5, 2]),
      marker('AC_PIT_0', -45, [5, 1.2, 5]), marker('AC_HOTLAP_START_0', 30, [-20, 1.5, 12]),
      marker('AC_TIME_0_L', 30, [2, 1.5, -4]), marker('AC_TIME_0_R', 30, [6, 1.5, 3]),
    ] },
  };
}

function withFile(buf, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn5write-'));
  const f = path.join(dir, 't.kn5');
  try { fs.writeFileSync(f, buf); return fn(f); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// The expectation, composed the way tools/kn5.cjs composes: float32 matrices, float64 arithmetic, float32 result.
function expected(scene) {
  const mul = (a, m) => { const r = new Float64Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * m[k * 4 + j]; r[i * 4 + j] = s; } return r; };
  const meshes = [], dummies = [];
  const walk = (n, parent) => {
    if (n.type === 'dummy') {
      const M = mul(Float32Array.from(n.matrix), parent);
      if (/^AC_/.test(n.name)) dummies.push({ name: n.name, pos: [M[12], M[13], M[14]], fwd: [M[8], M[9], M[10]] });
      n.children.forEach((c) => walk(c, M));
    } else {
      const M = parent, P = n.positions, out = new Float32Array(P.length);
      for (let v = 0; v < P.length; v += 3) {
        const [x, y, z] = [P[v], P[v + 1], P[v + 2]];
        out[v] = x * M[0] + y * M[4] + z * M[8] + M[12]; out[v + 1] = x * M[1] + y * M[5] + z * M[9] + M[13]; out[v + 2] = x * M[2] + y * M[6] + z * M[10] + M[14];
      }
      meshes.push({ name: n.name, material: scene.materials[n.material].name, pos: out, idx: n.indices });
    }
  };
  walk(scene.root, new Float64Array(I16));
  return { meshes, dummies };
}

// An independent walk of the bytes for what tools/kn5.cjs skips: texture blobs, material fields, and the vertex block.
function rawWalk(b) {
  let o = 0;
  const i32 = () => { const v = b.readInt32LE(o); o += 4; return v; }, f32 = () => { const v = b.readFloatLE(o); o += 4; return v; }, u8 = () => b[o++];
  const str = () => { const n = i32(); const s = b.toString('utf8', o, o + n); o += n; return s; };
  const out = { magic: b.toString('latin1', 0, 6) }; o = 6; out.version = i32();
  out.textures = []; for (let n = i32(); n > 0; n--) { const active = i32(), name = str(), size = i32(); out.textures.push({ active, name, data: b.subarray(o, o + size) }); o += size; }
  out.materials = [];
  for (let n = i32(); n > 0; n--) {
    const m = { name: str(), shader: str(), blend: u8(), alphaTested: u8(), depthMode: i32(), props: [], samplers: [] };
    for (let p = i32(); p > 0; p--) { const name = str(); const v = []; for (let q = 0; q < 10; q++) v.push(f32()); m.props.push({ name, v }); }
    for (let p = i32(); p > 0; p--) m.samplers.push({ name: str(), slot: i32(), texture: str() });
    out.materials.push(m);
  }
  out.nodes = [];
  const node = () => {
    const n = { cls: i32(), name: str(), nChild: i32(), active: u8() };
    if (n.cls === 1) { n.m = []; for (let q = 0; q < 16; q++) n.m.push(f32()); }
    else {
      n.flags = [u8(), u8(), u8()]; const nv = i32(); n.v = [];
      for (let k = 0; k < nv; k++) { const r = []; for (let q = 0; q < 11; q++) r.push(f32()); n.v.push(r); }
      const ni = i32(); o += 2 * ni;
      n.material = i32(); n.layer = i32(); n.lodIn = f32(); n.lodOut = f32(); n.sphere = [f32(), f32(), f32(), f32()]; n.renderable = u8();
    }
    out.nodes.push(n);
    for (let c = 0; c < n.nChild; c++) node();
  };
  node(); out.left = b.length - o;
  return out;
}

const meshNodes = (s) => { const r = []; const w = (n) => (n.type === 'mesh' ? r.push(n) : n.children.forEach(w)); w(s.root); return r; };

test('round-trip through tools/kn5.cjs: world positions, indices, mesh names, materials and AC_ markers', () => {
  const scene = smallScene(), want = expected(scene);
  const got = withFile(writeKn5(scene), readKn5);
  assert.equal(got.version, 5);
  assert.deepEqual(got.materials.map((m) => [m.name, m.shader]), scene.materials.map((m) => [m.name, m.shader]));
  assert.deepEqual(got.meshes.map((m) => [m.name, m.material]), want.meshes.map((m) => [m.name, m.material]));
  got.meshes.forEach((m, k) => {
    assert.deepEqual(Array.from(m.pos), Array.from(want.meshes[k].pos), `${m.name} world positions`);
    assert.deepEqual(Array.from(m.idx), Array.from(want.meshes[k].idx), `${m.name} indices`);
  });
  assert.deepEqual(got.dummies, want.dummies);
});

test('the road quad lands where its group matrix puts it (rotated 90 degrees about Y, moved to 10, 2, -5)', () => {
  const got = withFile(writeKn5(smallScene()), readKn5);
  const road = got.meshes.find((m) => m.name === '1ROAD');
  // Local (4, 0, 0) -> rotated by +90 about Y to (0, 0, -4) -> translated to (10, 2, -9).
  assert.deepEqual(Array.from(road.pos.slice(3, 6)).map((x) => Math.round(x * 1e5) / 1e5), [10, 2, -9]);
});

test('every AC_ marker reads back with its forward axis along matrix row 3', () => {
  const got = withFile(writeKn5(smallScene()), readKn5);
  const s = got.dummies.find((d) => d.name === 'AC_START_0');
  assert.deepEqual(s.fwd.map((x) => Math.round(x * 1e6) / 1e6), [Math.round(Math.sin(Math.PI / 6) * 1e6) / 1e6, 0, Math.round(Math.cos(Math.PI / 6) * 1e6) / 1e6]);
  assert.deepEqual(got.dummies.map((d) => d.name).sort(), ['AC_HOTLAP_START_0', 'AC_PIT_0', 'AC_START_0', 'AC_START_1', 'AC_TIME_0_L', 'AC_TIME_0_R']);
});

test('the header is kn5 version 5: sc6969, then int 5, and no version-6 extra int', () => {
  const b = writeKn5(smallScene());
  assert.equal(b.toString('latin1', 0, 6), 'sc6969');
  assert.equal(b.readInt32LE(6), 5);
  assert.equal(b.readInt32LE(10), 1, 'the texture count follows the version directly');
});

test('local vertex bytes: positions and normals exact, u exact, v flipped to 1 - v within 2^-23', () => {
  const scene = smallScene(), raw = rawWalk(writeKn5(scene));
  const byName = Object.fromEntries(raw.nodes.filter((n) => n.cls === 2).map((n) => [n.name, n]));
  for (const m of meshNodes(scene)) {
    const n = byName[m.name];
    n.v.forEach((r, k) => {
      assert.deepEqual(r.slice(0, 3), Array.from(m.positions.slice(3 * k, 3 * k + 3)), `${m.name} v${k} position`);
      assert.deepEqual(r.slice(3, 6), Array.from(m.normals.slice(3 * k, 3 * k + 3)), `${m.name} v${k} normal`);
      assert.equal(r[6], m.uvs[2 * k], `${m.name} v${k} u`);
      const v = m.uvs[2 * k + 1];
      assert.ok(Math.abs((1 - r[7]) - v) <= 2 ** -23 * Math.max(1, Math.abs(v)), `${m.name} v${k}: stored ${r[7]} is not 1 - ${v}`);
    });
  }
});

test('tangents are unit length, perpendicular to the normal, and follow +u', () => {
  const raw = rawWalk(writeKn5(smallScene()));
  const road = raw.nodes.find((n) => n.name === '1ROAD');
  for (const r of road.v) {
    const t = r.slice(8, 11), n = r.slice(3, 6);
    assert.ok(Math.abs(Math.hypot(...t) - 1) < 1e-6, 'unit');
    assert.ok(Math.abs(t[0] * n[0] + t[1] * n[1] + t[2] * n[2]) < 1e-6, 'perpendicular');
    assert.ok(t[0] > 0.999, 'along +x, where u grows on this quad');
  }
});

test('the mesh tail: material index, layer 0, lod 0/0, a bounding sphere holding every vertex, the renderable flag', () => {
  const scene = smallScene(), raw = rawWalk(writeKn5(scene));
  for (const m of meshNodes(scene)) {
    const n = raw.nodes.find((x) => x.name === m.name);
    assert.deepEqual([n.material, n.layer, n.lodIn, n.lodOut], [m.material, 0, 0, 0]);
    assert.deepEqual(n.flags, [1, 1, 0]);
    assert.equal(n.renderable, m.renderable ? 1 : 0);
    const [cx, cy, cz, r] = n.sphere;
    for (const v of n.v) assert.ok(Math.hypot(v[0] - cx, v[1] - cy, v[2] - cz) <= r * (1 + 1e-6), `${m.name} vertex outside its sphere`);
  }
  assert.equal(raw.left, 0);
});

test('textures, material fields and samplers are written as given; a prop of n floats fills slot n (A, B, C, D)', () => {
  const scene = smallScene(), raw = rawWalk(writeKn5(scene));
  assert.equal(raw.textures.length, 1);
  assert.equal(raw.textures[0].active, 1);
  assert.equal(raw.textures[0].name, 'road.png');
  assert.ok(raw.textures[0].data.equals(scene.textures[0].data));
  const road = raw.materials[0];
  assert.deepEqual([road.name, road.shader, road.blend, road.alphaTested, road.depthMode], ['road', 'ksPerPixel', 0, 0, 0]);
  assert.deepEqual(road.props[0].v.map((x) => Math.fround(x)), [0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0].map(Math.fround));
  assert.deepEqual(road.props[2].v.map((x) => Math.fround(x)), [0, 0.2, 0.3, 0, 0, 0, 0, 0, 0, 0].map(Math.fround));
  assert.deepEqual(road.samplers, [{ name: 'txDiffuse', slot: 0, texture: 'road.png' }]);
  assert.equal(raw.materials[1].name, 'béton');
});

test('writing the same scene twice gives byte-identical output', () => {
  assert.ok(writeKn5(smallScene()).equals(writeKn5(smallScene())));
});

test('edge case: an empty textures list is allowed and round-trips', () => {
  const s = smallScene(); s.textures = []; s.materials[0].samplers = [];
  const got = withFile(writeKn5(s), readKn5);
  assert.equal(rawWalk(writeKn5(s)).textures.length, 0);
  assert.equal(got.meshes.length, 2);
});

test('edge case: a mesh with 0 triangles is refused, although the byte format could encode it', () => {
  const s = smallScene(); meshNodes(s)[0].indices = new Uint16Array(0);
  assert.throws(() => validateScene(s), (e) => e instanceof SceneError && e.code === 'EMPTY_MESH');
});

const refuses = (mutate, code) => { const s = smallScene(); mutate(s); assert.throws(() => validateScene(s), (e) => e.name === 'SceneError' && e.code === code, code); };

test('validateScene refuses more than 65,535 vertices in one mesh, and takes exactly 65,535', () => {
  const big = (n) => (s) => { const m = meshNodes(s)[1]; m.positions = new Float32Array(3 * n); m.normals = new Float32Array(3 * n); m.uvs = new Float32Array(2 * n); m.indices = new Uint16Array([0, 1, 2]); };
  refuses(big(65536), 'TOO_MANY_VERTICES');
  const s = smallScene(); big(65535)(s);
  assert.doesNotThrow(() => validateScene(s));
});

test('validateScene refuses an index out of range', () => refuses((s) => { meshNodes(s)[1].indices = new Uint16Array([0, 1, 3]); }, 'INDEX_OUT_OF_RANGE'));
test('validateScene refuses a matrix of 15 entries', () => refuses((s) => { s.root.children[0].matrix = I16.slice(0, 15); }, 'BAD_MATRIX'));
test('validateScene refuses a non-finite matrix entry', () => refuses((s) => { s.root.children[0].matrix[13] = NaN; }, 'BAD_MATRIX'));
test('validateScene refuses a material index equal to the material count', () => refuses((s) => { meshNodes(s)[0].material = 2; }, 'MATERIAL_OUT_OF_RANGE'));
test('validateScene refuses a sampler naming a texture that is not embedded', () => refuses((s) => { s.materials[0].samplers[0].texture = 'nope.dds'; }, 'UNKNOWN_TEXTURE'));
test('validateScene refuses a mesh node with children', () => refuses((s) => { meshNodes(s)[0].children = [marker('AC_PIT_1', 0, [0, 0, 0])]; }, 'MESH_HAS_CHILDREN'));
test('validateScene refuses normals of the wrong length', () => refuses((s) => { meshNodes(s)[0].normals = new Float32Array(3); }, 'BAD_NORMALS'));
test('validateScene refuses a root that is not a dummy', () => refuses((s) => { s.root = meshNodes(s)[0]; }, 'BAD_ROOT'));
test('validateScene refuses a prop with 5 floats', () => refuses((s) => { s.materials[0].props[0].value = [1, 2, 3, 4, 5]; }, 'BAD_PROP'));

test('writeKn5 validates first: a bad scene throws SceneError, and no bytes come back', () => {
  const s = smallScene(); meshNodes(s)[1].indices = new Uint16Array([0, 1, 9]);
  assert.throws(() => writeKn5(s), (e) => e instanceof SceneError && e.code === 'INDEX_OUT_OF_RANGE');
});
