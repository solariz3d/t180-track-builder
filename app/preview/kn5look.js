// kn5look.js: read what a kn5 says about its LOOK: its textures (name, bytes) and its materials (name, shader, flags,
// properties, samplers), the head of the file as src/export/kn5write.js writes it. For the test that the preview draws
// exactly the materials and textures the export writes (ARCHITECTURE §5.1). tools/kn5.cjs reads meshes and material
// names but not properties, samplers or texture bytes; this reads only those, and nothing of the node tree.
//
//   readLook(bytes) -> { version, textures: [{ name, bytes }], materials: [{ name, shader, alphaBlend, alphaTested,
//                        depthMode, props: [{ name, a, b, c, d }], samplers: [{ name, slot, texture }] }] }
// A property is stored as ten floats, slots A(1) B(2) C(3) D(4) (kn5write.js); all four slots are returned.
'use strict';

function readLook(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let o = 0;
  const need = (n, what) => { if (o + n > b.length) throw new Error(`kn5look: the file ends inside ${what} (offset ${o})`); };
  const i32 = (w) => { need(4, w); const v = b.readInt32LE(o); o += 4; return v; };
  const f32 = (w) => { need(4, w); const v = b.readFloatLE(o); o += 4; return v; };
  const u8 = (w) => { need(1, w); return b[o++]; };
  const str = (w) => { const n = i32(w); if (n < 0 || n > 1 << 20) throw new Error(`kn5look: a ${n}-byte string in ${w}`); need(n, w); const s = b.toString('utf8', o, o + n); o += n; return s; };
  need(6, 'the magic'); if (b.toString('latin1', 0, 6) !== 'sc6969') throw new Error('kn5look: not a kn5 (no sc6969)'); o = 6;
  const version = i32('the version');
  if (version > 5) i32('the extra header of version 6');
  const textures = [];
  for (let n = i32('the texture count'), k = 0; k < n; k++) {
    i32('a texture flag'); const name = str('a texture name'), size = i32('a texture size'); need(size, 'texture bytes');
    textures.push({ name, bytes: b.subarray(o, o + size) }); o += size;
  }
  const materials = [];
  for (let n = i32('the material count'), k = 0; k < n; k++) {
    const m = { name: str('a material name'), shader: str('a shader name'), alphaBlend: u8('alphaBlend'), alphaTested: u8('alphaTested') === 1, depthMode: i32('depthMode'), props: [], samplers: [] };
    for (let p = i32('a property count'), j = 0; j < p; j++) {
      const name = str('a property name'), fl = []; for (let q = 0; q < 10; q++) fl.push(f32('property values'));
      m.props.push({ name, a: fl.slice(0, 1), b: fl.slice(1, 3), c: fl.slice(3, 6), d: fl.slice(6, 10) });
    }
    for (let s = i32('a sampler count'), j = 0; j < s; j++) m.samplers.push({ name: str('a sampler name'), slot: i32('a sampler slot'), texture: str('a sampler texture') });
    materials.push(m);
  }
  return { version, textures, materials };
}
/** A scene material's property as the kn5 stores it (float32, in the slot its length names), for comparing. */
function propSlots(p) {
  const f = (x) => Math.fround(x), s = [[0], [0, 0], [0, 0, 0], [0, 0, 0, 0]];
  s[p.value.length - 1] = p.value.map(f);
  return { name: p.name, a: s[0], b: s[1], c: s[2], d: s[3] };
}

module.exports = { readLook, propSlots };
