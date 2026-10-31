// fbx_read.js: a small reader of BINARY FBX (the format Blender writes and ksEditor reads), for the tests of the export for Blender. Not a test file itself.
// The layout as the Blender FBX exporter (io_scene_fbx, encode_bin.py) writes it and as the community documents it (Blender's own fbx2json.py): a 23-byte
// magic "Kaydara FBX Binary  \0", 0x1A 0x00, a uint32 version; then node records: end offset, property count, property list length (uint32 each below
// version 7500, uint64 from 7500), a name (uint8 length), the properties, the children, ended by a null record. Property types: Y int16, C bool, I int32,
// F float32, D float64, L int64, S string and R raw (uint32 length), and f d l i b arrays (uint32 count, encoding 0 raw or 1 zlib, compressed length).
// readFbx(buffer) -> { version, unitScale, models: [{ id, name, kind, translation, rotation, scaling }], geometries: Map(id -> { name, vertices }), parentOf: Map(id -> id) }
'use strict';
const zlib = require('zlib');
function fail(m) { throw new Error(`FBX: ${m}`); }
function readFbx(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.toString('latin1', 0, 20) !== 'Kaydara FBX Binary  ' || buf[20] !== 0) fail('not a binary FBX (no Kaydara magic)');
  const version = buf.readUInt32LE(23), wide = version >= 7500, nullLen = wide ? 25 : 13;
  let o = 27;
  const u = () => { const v = wide ? Number(buf.readBigUInt64LE(o)) : buf.readUInt32LE(o); o += wide ? 8 : 4; return v; };
  function prop() {
    const t = String.fromCharCode(buf[o++]);
    switch (t) {
      case 'Y': { const v = buf.readInt16LE(o); o += 2; return v; }
      case 'C': return buf[o++] !== 0;
      case 'I': { const v = buf.readInt32LE(o); o += 4; return v; }
      case 'F': { const v = buf.readFloatLE(o); o += 4; return v; }
      case 'D': { const v = buf.readDoubleLE(o); o += 8; return v; }
      case 'L': { const v = buf.readBigInt64LE(o); o += 8; return v; }
      case 'S': case 'R': { const n = buf.readUInt32LE(o); o += 4; const b = buf.subarray(o, o + n); o += n; return t === 'S' ? b.toString('utf8') : b; }
      case 'f': case 'd': case 'l': case 'i': case 'b': {
        const n = buf.readUInt32LE(o), enc = buf.readUInt32LE(o + 4), len = buf.readUInt32LE(o + 8); o += 12;
        let b = buf.subarray(o, o + len); o += len; if (enc === 1) b = zlib.inflateSync(b); else if (enc !== 0) fail(`array encoding ${enc}`);
        const size = { f: 4, d: 8, l: 8, i: 4, b: 1 }[t]; if (b.length !== n * size) fail(`array of ${n} ${t} has ${b.length} bytes`);
        const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
        return t === 'f' ? new Float32Array(ab) : t === 'd' ? new Float64Array(ab) : t === 'l' ? new BigInt64Array(ab) : t === 'i' ? new Int32Array(ab) : new Uint8Array(ab);
      }
      default: return fail(`property type ${t} at ${o - 1}`);
    }
  }
  function node() {
    const end = u(), np = u(); u(); const nl = buf[o++], name = buf.toString('latin1', o, o + nl); o += nl;
    if (end === 0) return null;
    const props = []; for (let k = 0; k < np; k++) props.push(prop());
    const children = []; while (o < end) { const c = node(); if (!c) break; children.push(c); }
    if (o !== end) fail(`node ${name} ends at ${o}, not ${end}`);
    return { name, props, children };
  }
  const top = [];
  while (o + nullLen <= buf.length) { const save = o, n = node(); if (!n) { o = save + nullLen; break; } top.push(n); }
  const find = (list, n) => list.find((x) => x.name === n);
  const p70 = (n) => { const out = {}; const P = n && find(n.children, 'Properties70'); for (const p of (P ? P.children : [])) out[p.props[0]] = p.props.slice(4); return out; };
  const gs = find(top, 'GlobalSettings'), unitScale = (p70(gs).UnitScaleFactor || [1])[0];
  const objs = find(top, 'Objects') || fail('no Objects'), conns = find(top, 'Connections') || fail('no Connections');
  const clean = (s) => String(s).split('\u0000\u0001')[0];
  const models = [], geometries = new Map(), parentOf = new Map();
  for (const n of objs.children) {
    if (n.name === 'Model') { const P = p70(n); models.push({ id: n.props[0], name: clean(n.props[1]), kind: n.props[2], translation: P['Lcl Translation'] || [0, 0, 0], rotation: P['Lcl Rotation'] || [0, 0, 0], scaling: P['Lcl Scaling'] || [1, 1, 1] }); }
    if (n.name === 'Geometry') { const v = find(n.children, 'Vertices'); geometries.set(n.props[0], { name: clean(n.props[1]), vertices: v ? v.props[0] : null }); }
  }
  for (const c of conns.children) if (c.props[0] === 'OO') parentOf.set(c.props[1], c.props[2]);
  return { version, unitScale, models, geometries, parentOf };
}
module.exports = { readFbx };
