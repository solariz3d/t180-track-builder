// kn5write.js: writeKn5(scene) -> Buffer, an Assetto Corsa .kn5 at version 5 ("sc6969").
// The byte layout follows AcTools' Kn5Writer.cs (Ms-PL, github.com/gro-ove/actools, AcTools/Kn5File); the GPL
// exporters were reference only. tools/kn5.cjs reads it back (test/kn5write.test.js), and blackbox's kn5 reader too.
//
// The scene is plain world data (src/export/scene.js says the shape and refuses anything else). The writer does the
// kn5-side work:
// - V is flipped: kn5 stores the image's top row at v = 0, the scene holds v = 0 at the bottom, so it writes 1 - v.
// - Matrices: the scene already holds them in kn5's stored order, so they are written as given, with no transpose.
//   (The "transposed matrices" in docs/research/01 is the step from Blender's column convention to this order.)
// - Winding: the scene's triangles are CCW seen from outside, the order real tracks store (measured on two reference
//   tracks: 938,068 of 938,072 and 94,283 of 94,375 triangles wind CCW about their stored normals), so the indices are
//   written as given. (docs/research/01's "(1, 2, 0)" is a rotation of (0, 1, 2); it does not reverse a triangle.)
// - Tangents are computed here (the scene carries none): per-vertex sums of each triangle's d(position)/du,
//   orthogonalised against the normal, as the reference tracks store them.
// - The bounding sphere is computed here: the centre of the vertices' box, and the farthest vertex from it.
// - Layer 0, lodIn 0, lodOut 0, every node active: the values both reference tracks use for nearly every mesh.
// Strings are an int32 BYTE length and UTF-8 bytes.
// A mesh with 0 triangles is refused by validateScene: the format could encode it, but it has no bounding sphere to
// write and nothing says AC loads one.
const { validateScene } = require('./scene.js');

class Out {
  constructor() { this.parts = []; }
  raw(b) { this.parts.push(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); this.parts.push(b); }
  u8(v) { this.parts.push(Buffer.from([v])); }
  f32(v) { const b = Buffer.alloc(4); b.writeFloatLE(v); this.parts.push(b); }
  str(s) { const b = Buffer.from(s, 'utf8'); this.i32(b.length); this.parts.push(b); }
  done() { return Buffer.concat(this.parts); }
}

function tangents(P, N, UV, I) {
  const nv = P.length / 3, T = new Float64Array(3 * nv);
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k], b = I[k + 1], c = I[k + 2];
    const e1 = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]];
    const e2 = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]];
    // The kn5-side v (1 - v) is the one the shader samples with; the tangent follows +u either way.
    const du1 = UV[2 * b] - UV[2 * a], dv1 = (1 - UV[2 * b + 1]) - (1 - UV[2 * a + 1]);
    const du2 = UV[2 * c] - UV[2 * a], dv2 = (1 - UV[2 * c + 1]) - (1 - UV[2 * a + 1]);
    const det = du1 * dv2 - du2 * dv1;
    if (det === 0) continue;
    const r = 1 / det;
    for (const v of [a, b, c]) for (let j = 0; j < 3; j++) T[3 * v + j] += (e1[j] * dv2 - e2[j] * dv1) * r;
  }
  const out = new Float32Array(3 * nv);
  for (let v = 0; v < nv; v++) {
    const n = [N[3 * v], N[3 * v + 1], N[3 * v + 2]], nl = Math.hypot(...n) || 1;
    for (let j = 0; j < 3; j++) n[j] /= nl;
    let t = [T[3 * v], T[3 * v + 1], T[3 * v + 2]];
    const d = t[0] * n[0] + t[1] * n[1] + t[2] * n[2];
    t = [t[0] - n[0] * d, t[1] - n[1] * d, t[2] - n[2] * d];
    let tl = Math.hypot(...t);
    if (!(tl > 1e-12)) {   // no usable u direction: any unit vector perpendicular to the normal
      t = Math.abs(n[0]) < 0.9 ? [0, -n[2], n[1]] : [n[2], 0, -n[0]];
      tl = Math.hypot(...t);
    }
    for (let j = 0; j < 3; j++) out[3 * v + j] = t[j] / tl;
  }
  return out;
}

function sphere(P) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < P.length; k += 3) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], P[k + j]); hi[j] = Math.max(hi[j], P[k + j]); }
  const c = [0, 1, 2].map((j) => Math.fround((lo[j] + hi[j]) / 2));
  let r = 0;
  for (let k = 0; k < P.length; k += 3) r = Math.max(r, Math.hypot(P[k] - c[0], P[k + 1] - c[1], P[k + 2] - c[2]));
  // Round the radius UP to the next float32, so the stored sphere still holds the farthest vertex.
  let rf = Math.fround(r);
  if (rf < r) rf = Math.fround(rf + Math.max(rf * 2 ** -23, 2 ** -149));
  return [...c, rf];
}

function writeNode(out, n) {
  if (n.type === 'dummy') {
    out.i32(1); out.str(n.name); out.i32(n.children.length); out.u8(1);
    for (const x of n.matrix) out.f32(x);
    for (const c of n.children) writeNode(out, c);
    return;
  }
  out.i32(2); out.str(n.name); out.i32(0); out.u8(1);
  out.u8(n.castShadows ? 1 : 0); out.u8(n.visible ? 1 : 0); out.u8(n.transparent ? 1 : 0);
  const P = n.positions, N = n.normals, UV = n.uvs, nv = P.length / 3, T = tangents(P, N, UV, n.indices);
  out.i32(nv);
  const vb = Buffer.alloc(nv * 44);
  for (let v = 0; v < nv; v++) {
    const o = v * 44;
    vb.writeFloatLE(P[3 * v], o); vb.writeFloatLE(P[3 * v + 1], o + 4); vb.writeFloatLE(P[3 * v + 2], o + 8);
    vb.writeFloatLE(N[3 * v], o + 12); vb.writeFloatLE(N[3 * v + 1], o + 16); vb.writeFloatLE(N[3 * v + 2], o + 20);
    vb.writeFloatLE(UV[2 * v], o + 24); vb.writeFloatLE(1 - UV[2 * v + 1], o + 28);
    vb.writeFloatLE(T[3 * v], o + 32); vb.writeFloatLE(T[3 * v + 1], o + 36); vb.writeFloatLE(T[3 * v + 2], o + 40);
  }
  out.raw(vb);
  out.i32(n.indices.length);
  const ib = Buffer.alloc(n.indices.length * 2);
  for (let k = 0; k < n.indices.length; k++) ib.writeUInt16LE(n.indices[k], 2 * k);
  out.raw(ib);
  out.i32(n.material); out.i32(0); out.f32(0); out.f32(0);   // material, layer, lodIn, lodOut
  for (const x of sphere(P)) out.f32(x);
  out.u8(n.renderable ? 1 : 0);
}

function writeKn5(scene) {
  validateScene(scene);
  const out = new Out();
  out.raw(Buffer.from('sc6969', 'latin1'));
  out.i32(5);
  out.i32(scene.textures.length);
  for (const t of scene.textures) { out.i32(1); out.str(t.name); out.i32(t.data.length); out.raw(t.data); }
  out.i32(scene.materials.length);
  for (const m of scene.materials) {
    out.str(m.name); out.str(m.shader);
    out.u8(m.alphaBlend); out.u8(m.alphaTested ? 1 : 0); out.i32(m.depthMode);
    out.i32(m.props.length);
    for (const p of m.props) {
      out.str(p.name);
      // Ten floats: A (1), B (2), C (3), D (4). A value of n floats fills slot n; the rest are 0.
      const slots = [[0], [0, 0], [0, 0, 0], [0, 0, 0, 0]];
      slots[p.value.length - 1] = p.value.slice();
      for (const s of slots) for (const x of s) out.f32(x);
    }
    out.i32(m.samplers.length);
    for (const s of m.samplers) { out.str(s.name); out.i32(s.slot); out.str(s.texture); }
  }
  writeNode(out, scene.root);
  return out.done();
}

module.exports = { writeKn5 };
