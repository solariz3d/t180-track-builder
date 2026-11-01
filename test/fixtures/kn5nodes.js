// kn5nodes.js (D593): every MESH node of a kn5, as the bytes of its own record (the node's class, name, child count and active flag, then its mesh data, not its
// children), for the fixture seal's D593 amendment (test/core_cup_fixtures.test.js and the script that wrote manifest.d593.json read it the same way):
//   kn5Nodes(buffer) -> { materials: [names, in order], materialDigests: [sha256 of each material's own record, in order], meshes: [{ name, full, geo, flags }] }
//   full  sha256 of the record's bytes
//   geo   the same with its four flags zeroed (castShadows, visible, transparent before the vertices; renderable last), so a node that was only hidden keeps it
//   flags { castShadows, visible, transparent, renderable }
// The layout is tools/kn5.cjs readKn5's (each vertex 44 bytes: position, normal, uv, tangent); an unknown node class is refused, by name.
'use strict';
const crypto = require('crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function kn5Nodes(b) {
  let o = 0;
  const i32 = () => { const v = b.readInt32LE(o); o += 4; return v; }, u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; };
  const str = () => { const n = i32(); if (n < 0 || n > 1e6) throw new Error(`kn5Nodes: bad string length ${n} at ${o - 4}`); const s = b.toString('utf8', o, o + n); o += n; return s; };
  if (b.toString('latin1', 0, 6) !== 'sc6969') throw new Error('kn5Nodes: not a kn5 (no sc6969 magic)');
  o = 6; const version = u32(); if (version > 5) u32();
  const nTex = i32(); for (let k = 0; k < nTex; k++) { i32(); str(); const size = i32(); o += size; }
  const nMat = i32(), materials = [], materialDigests = [];
  for (let k = 0; k < nMat; k++) {
    const at = o, name = str(); str(); o += 6;
    const nProp = i32(); for (let p = 0; p < nProp; p++) { str(); o += 40; }
    const nSamp = i32(); for (let p = 0; p < nSamp; p++) { str(); i32(); str(); }
    materials.push(name); materialDigests.push(sha(b.subarray(at, o)));
  }
  const meshes = [];
  const node = () => {
    const start = o, cls = i32(), name = str(), nChild = i32(); o += 1;
    if (cls === 1) o += 64;
    else if (cls === 2) {
      const flagsAt = o; o += 3;
      const nv = u32(); o += nv * 44;
      const ni = u32(); o += ni * 2;
      o += 4 + 4 + 4 + 4 + 16; const renderAt = o; o += 1;
      const rec = Buffer.from(b.subarray(start, o)), g = Buffer.from(rec);
      for (const at of [flagsAt, flagsAt + 1, flagsAt + 2, renderAt]) g[at - start] = 0;
      meshes.push({ name, full: sha(rec), geo: sha(g), flags: { castShadows: !!b[flagsAt], visible: !!b[flagsAt + 1], transparent: !!b[flagsAt + 2], renderable: !!b[renderAt] } });
    } else throw new Error(`kn5Nodes: node class ${cls} (${name}) not supported at ${start}`);
    for (let c = 0; c < nChild; c++) node();
  };
  node();
  if (o !== b.length) throw new Error(`kn5Nodes: ${b.length - o} bytes left after the node tree`);
  return { materials, materialDigests, meshes };
}

module.exports = { kn5Nodes };
