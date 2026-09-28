// kn5scene.js: read a whole AC track kn5 for the look-match render: its textures (bytes), its materials (shader, flags,
// properties as ten floats in slots A B C D, samplers) and every visible mesh in WORLD space with its normals and uvs.
// tools/kn5.cjs reads triangles and marker dummies only (and is kept as it is); this follows its node walk exactly
// (classes 1 and 2, row-vector matrices, world = local × parent) and keeps what a render needs. Read-only.
//
//   readScene(buffer) -> { version, textures: [{ name, bytes }], materials: [{ name, shader, alphaBlend, alphaTested,
//                          props: { <name>: [f0..f9] }, samplers: { <sampler>: textureName } }],
//                          meshes: [{ name, material, pos: Float32Array, nrm: Float32Array, uv: Float32Array, idx }],
//                          dummies: [{ name, pos, fwd }] }
// A mesh flagged not visible or not renderable (AC's own flags) is skipped: those are collision or hidden geometry.
'use strict';

function readScene(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let o = 0;
  const need = (n, w) => { if (o + n > b.length) throw new Error(`lookmatch: the kn5 ends inside ${w} (offset ${o})`); };
  const i32 = (w) => { need(4, w); const v = b.readInt32LE(o); o += 4; return v; };
  const u32 = (w) => { need(4, w); const v = b.readUInt32LE(o); o += 4; return v; };
  const f32 = (w) => { need(4, w); const v = b.readFloatLE(o); o += 4; return v; };
  const u8 = (w) => { need(1, w); return b[o++]; };
  const str = (w) => { const n = i32(w); if (n < 0 || n > 1e6) throw new Error(`lookmatch: a ${n}-byte string in ${w}`); need(n, w); const s = b.toString('utf8', o, o + n); o += n; return s; };
  need(6, 'the magic'); if (b.toString('latin1', 0, 6) !== 'sc6969') throw new Error('lookmatch: not a kn5 (no sc6969)'); o = 6;
  const version = u32('the version'); if (version > 5) u32('the version 6 header');
  const textures = [];
  for (let n = i32('the texture count'), k = 0; k < n; k++) { i32('a texture flag'); const name = str('a texture name'), size = i32('a texture size'); need(size, 'texture bytes'); textures.push({ name, bytes: b.subarray(o, o + size) }); o += size; }
  const materials = [];
  for (let n = i32('the material count'), k = 0; k < n; k++) {
    const m = { name: str('a material name'), shader: str('a shader name'), alphaBlend: u8('alphaBlend'), alphaTested: u8('alphaTested') === 1, props: {}, samplers: {} };
    i32('depthMode');
    for (let p = i32('a property count'), j = 0; j < p; j++) { const name = str('a property name'), v = []; for (let q = 0; q < 10; q++) v.push(f32('property values')); m.props[name] = v; }
    for (let s = i32('a sampler count'), j = 0; j < s; j++) { const name = str('a sampler name'); i32('a sampler slot'); m.samplers[name] = str('a sampler texture'); }
    materials.push(m);
  }
  const meshes = [], dummies = [];
  const mul = (a, m) => { const r = new Float64Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * m[k * 4 + j]; r[i * 4 + j] = s; } return r; };
  const I = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  function node(parentM) {
    const cls = i32('a node class'), name = str('a node name'), nChild = i32('a child count'); u8('a node flag');
    let M = parentM;
    if (cls === 1) {
      const m = new Float64Array(16); for (let k = 0; k < 16; k++) m[k] = f32('a node matrix'); M = mul(m, parentM);
      if (/^AC_/i.test(name)) dummies.push({ name, pos: [M[12], M[13], M[14]], fwd: [M[8], M[9], M[10]] });
    } else if (cls === 2) {
      u8('castShadows'); const visible = u8('isVisible'); u8('isTransparent');
      const nv = u32('a vertex count'); need(nv * 44, 'vertices');
      const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
      for (let v = 0; v < nv; v++) {
        const x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8), nx = b.readFloatLE(o + 12), ny = b.readFloatLE(o + 16), nz = b.readFloatLE(o + 20);
        uv[v * 2] = b.readFloatLE(o + 24); uv[v * 2 + 1] = b.readFloatLE(o + 28); o += 44;   // pos, normal, uv, tangent
        pos[v * 3] = x * M[0] + y * M[4] + z * M[8] + M[12]; pos[v * 3 + 1] = x * M[1] + y * M[5] + z * M[9] + M[13]; pos[v * 3 + 2] = x * M[2] + y * M[6] + z * M[10] + M[14];
        const wx = nx * M[0] + ny * M[4] + nz * M[8], wy = nx * M[1] + ny * M[5] + nz * M[9], wz = nx * M[2] + ny * M[6] + nz * M[10], l = Math.hypot(wx, wy, wz) || 1;
        nrm[v * 3] = wx / l; nrm[v * 3 + 1] = wy / l; nrm[v * 3 + 2] = wz / l;
      }
      const ni = u32('an index count'); need(ni * 2, 'indices');
      const idx = new Uint32Array(ni); for (let k = 0; k < ni; k++) { idx[k] = b.readUInt16LE(o); o += 2; }
      const mat = u32('a material index'); u32('a layer'); f32('lodIn'); f32('lodOut'); need(16, 'a bounding sphere'); o += 16; const renderable = u8('isRenderable');
      if (visible && renderable) meshes.push({ name, material: mat, pos, nrm, uv, idx });
    } else throw new Error(`lookmatch: node class ${cls} (${name}) is not read (tools/kn5.cjs reads classes 1 and 2 too)`);
    for (let c = 0; c < nChild; c++) node(M);
  }
  node(I);
  if (o !== b.length) throw new Error(`lookmatch: ${b.length - o} bytes left after the node tree`);
  return { version, textures, materials, meshes, dummies };
}

module.exports = { readScene };
