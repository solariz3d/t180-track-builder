// kn5.cjs: reads an Assetto Corsa .kn5 model (the format as the modding community documents it, e.g. AcTools'
// Kn5Reader) far enough to get every mesh's triangles in WORLD space. Textures are skipped, materials are skipped
// over, and the node tree's transforms are applied. Throws on anything it does not understand rather than guessing.
const fs = require('fs');

function readKn5(file) {
  const b = fs.readFileSync(file); let o = 0;
  const i32 = () => { const v = b.readInt32LE(o); o += 4; return v; };
  const u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; };
  const f32 = () => { const v = b.readFloatLE(o); o += 4; return v; };
  const u8 = () => b[o++];
  const str = () => { const n = i32(); if (n < 0 || n > 1e6) throw new Error(`bad string length ${n} at ${o - 4}`); const s = b.toString('utf8', o, o + n); o += n; return s; };
  if (b.toString('latin1', 0, 6) !== 'sc6969') throw new Error(file + ': not a kn5 (no sc6969 magic)');
  o = 6; const version = u32(); if (version > 5) u32();
  const nTex = i32(); for (let k = 0; k < nTex; k++) { i32(); str(); const size = i32(); o += size; }
  const nMat = i32(); const materials = [];
  for (let k = 0; k < nMat; k++) {
    const name = str(), shader = str(); u8(); u8(); i32();
    const nProp = i32(); for (let p = 0; p < nProp; p++) { str(); o += 40; }
    const nSamp = i32(); for (let p = 0; p < nSamp; p++) { str(); i32(); str(); }
    materials.push({ name, shader });
  }
  const meshes = [], dummies = [];
  const mul = (a, m) => { const r = new Float64Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * m[k * 4 + j]; r[i * 4 + j] = s; } return r; };
  const I = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  function node(parentM, path) {
    const cls = i32(), name = str(), nChild = i32(); u8();
    let M = parentM;
    if (cls === 1) { const m = new Float64Array(16); for (let k = 0; k < 16; k++) m[k] = f32(); M = mul(m, parentM);
      if (/^AC_/i.test(name)) dummies.push({ name, pos: [M[12], M[13], M[14]], fwd: [M[8], M[9], M[10]] }); }   // start/pit/time markers
    else if (cls === 2) {
      u8(); u8(); u8();
      const nv = u32(), pos = new Float32Array(nv * 3);
      for (let v = 0; v < nv; v++) {
        const x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8); o += 44;   // pos, normal, uv, tangent
        pos[v * 3] = x * M[0] + y * M[4] + z * M[8] + M[12]; pos[v * 3 + 1] = x * M[1] + y * M[5] + z * M[9] + M[13]; pos[v * 3 + 2] = x * M[2] + y * M[6] + z * M[10] + M[14];
      }
      const ni = u32(), idx = new Uint16Array(ni); for (let k = 0; k < ni; k++) { idx[k] = b.readUInt16LE(o); o += 2; }
      const mat = u32(); u32(); f32(); f32(); o += 16; u8();
      meshes.push({ name, path, material: materials[mat] && materials[mat].name, pos, idx });
    } else throw new Error(`${file}: node class ${cls} (${name}) not supported at ${o}`);
    for (let c = 0; c < nChild; c++) node(M, path + '/' + name);
  }
  node(I, '');
  if (o !== b.length) throw new Error(`${file}: ${b.length - o} bytes left after the node tree`);
  return { version, materials, meshes, dummies };
}
module.exports = { readKn5 };
