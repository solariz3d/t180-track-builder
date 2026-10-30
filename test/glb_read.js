// glb_read.js: a STRICT reader of a glTF 2.0 binary (.glb), for the tests of src/export/gltf.js. Not a test file itself. It refuses, by throwing, anything
// the glTF 2.0 specification (Khronos, glTF 2.0 §4.4 binary glTF, §5 the properties) makes invalid that a writer could get wrong:
//   the 12-byte header (magic "glTF", version 2, length = the file's), the JSON chunk first and the BIN chunk second, each chunk's length a multiple of 4,
//   every bufferView inside the BIN chunk and 4-byte aligned, every accessor inside its bufferView, aligned to its component size, its count × element size
//   fitting, POSITION accessors carrying min and max EQUAL to the data's, indices below the vertex count, a node's children existing and each node having
//   at most one parent, every mesh primitive's attributes counting the same vertices, images as embedded PNG (signature checked).
// readGlb(buffer) -> { json, bin, accessor(i) -> typed array copy, nodes, meshes, ... }
'use strict';
const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
function fail(msg) { throw new Error(`GLB: ${msg}`); }
function readGlb(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 20) fail('shorter than a header and a chunk');
  if (buf.toString('latin1', 0, 4) !== 'glTF') fail('magic is not glTF');
  if (buf.readUInt32LE(4) !== 2) fail(`version ${buf.readUInt32LE(4)}, not 2`);
  if (buf.readUInt32LE(8) !== buf.length) fail(`header length ${buf.readUInt32LE(8)} but the file is ${buf.length} bytes`);
  const chunks = []; let o = 12;
  while (o < buf.length) {
    if (o + 8 > buf.length) fail(`a chunk header runs past the end at ${o}`);
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4);
    if (len % 4) fail(`chunk ${chunks.length} length ${len} is not a multiple of 4`);
    if (o + 8 + len > buf.length) fail(`chunk ${chunks.length} runs past the end`);
    chunks.push({ type, data: buf.subarray(o + 8, o + 8 + len) }); o += 8 + len;
  }
  if (!chunks.length || chunks[0].type !== 0x4E4F534A) fail('the first chunk is not JSON');
  if (chunks.length > 1 && chunks[1].type !== 0x004E4942) fail('the second chunk is not BIN');
  const text = chunks[0].data.toString('utf8'), body = text.replace(/[ ]+$/, '');
  if (!/[}\]]$/.test(body)) fail('the JSON chunk is padded with something other than spaces (glTF 2.0: 0x20)');
  const json = JSON.parse(body), bin = chunks[1] ? chunks[1].data : Buffer.alloc(0);
  if (chunks[1] && bin.length % 4) fail(`the BIN chunk is ${bin.length} bytes, not a multiple of 4`);
  if (!json.asset || json.asset.version !== '2.0') fail('asset.version is not "2.0"');
  const buffers = json.buffers || [];
  if (buffers.length > 1 || (buffers[0] && (buffers[0].uri !== undefined || buffers[0].byteLength > bin.length || bin.length - buffers[0].byteLength > 3))) fail('the one buffer must be the BIN chunk (no uri, byteLength within 3 bytes of padding)');
  const views = json.bufferViews || [];
  views.forEach((v, i) => {
    const off = v.byteOffset || 0;
    if (v.buffer !== 0) fail(`bufferView ${i} does not use buffer 0`);
    if (off % 4) fail(`bufferView ${i} byteOffset ${off} is not 4-byte aligned`);
    if (off + v.byteLength > buffers[0].byteLength) fail(`bufferView ${i} runs past the buffer`);
  });
  const accessors = json.accessors || [];
  const arrays = accessors.map((a, i) => {
    const [T, size] = COMP[a.componentType] || fail(`accessor ${i} componentType ${a.componentType}`), w = WIDTH[a.type] || fail(`accessor ${i} type ${a.type}`);
    const v = views[a.bufferView] || fail(`accessor ${i} bufferView ${a.bufferView}`), off = a.byteOffset || 0;
    if (off % size) fail(`accessor ${i} byteOffset ${off} is not aligned to ${size}`);
    if (!(a.count > 0)) fail(`accessor ${i} count ${a.count}`);
    const stride = v.byteStride || size * w;
    if (off + stride * (a.count - 1) + size * w > v.byteLength) fail(`accessor ${i} runs past its bufferView (${off} + ${a.count} × ${stride} > ${v.byteLength})`);
    if (stride !== size * w) fail(`accessor ${i}: interleaved views are not written by this exporter`);
    const start = (v.byteOffset || 0) + off, data = new T(bin.buffer.slice(bin.byteOffset + start, bin.byteOffset + start + size * w * a.count));
    return { a, data, w };
  });
  const minmax = (x) => { const mn = new Array(x.w).fill(Infinity), mx = new Array(x.w).fill(-Infinity); for (let i = 0; i < x.data.length; i++) { const k = i % x.w; mn[k] = Math.min(mn[k], x.data[i]); mx[k] = Math.max(mx[k], x.data[i]); } return { mn, mx }; };
  const meshes = json.meshes || [];
  meshes.forEach((m, mi) => m.primitives.forEach((p, pi) => {
    const at = `mesh ${mi} (${m.name}) primitive ${pi}`, pos = arrays[p.attributes.POSITION];
    if (!pos || pos.a.type !== 'VEC3' || pos.a.componentType !== 5126) fail(`${at}: POSITION must be a float VEC3`);
    if (!pos.a.min || !pos.a.max) fail(`${at}: POSITION has no min/max`);
    const { mn, mx } = minmax(pos);
    for (let k = 0; k < 3; k++) if (Math.fround(mn[k]) !== Math.fround(pos.a.min[k]) || Math.fround(mx[k]) !== Math.fround(pos.a.max[k])) fail(`${at}: POSITION min/max ${JSON.stringify([pos.a.min, pos.a.max])} differ from the data's ${JSON.stringify([mn, mx])}`);
    const n = pos.a.count;
    for (const [name, acc] of Object.entries(p.attributes)) if (arrays[acc].a.count !== n) fail(`${at}: ${name} counts ${arrays[acc].a.count}, POSITION ${n}`);
    if (p.indices !== undefined) { const ix = arrays[p.indices]; if (ix.a.type !== 'SCALAR' || ![5121, 5123, 5125].includes(ix.a.componentType)) fail(`${at}: indices must be an unsigned scalar`); for (const v of ix.data) if (v >= n) fail(`${at}: index ${v} >= ${n} vertices`); }
    if (p.mode !== undefined && ![0, 1, 2, 3, 4, 5, 6].includes(p.mode)) fail(`${at}: mode ${p.mode}`);
    if (p.material !== undefined && !(json.materials && json.materials[p.material])) fail(`${at}: material ${p.material} does not exist`);
  }));
  const nodes = json.nodes || [], parent = new Array(nodes.length).fill(-1);
  nodes.forEach((nd, i) => {
    for (const c of nd.children || []) { if (!nodes[c]) fail(`node ${i} child ${c} does not exist`); if (parent[c] !== -1) fail(`node ${c} has two parents`); parent[c] = i; }
    if (nd.mesh !== undefined && !meshes[nd.mesh]) fail(`node ${i} mesh ${nd.mesh} does not exist`);
    if (nd.matrix && (nd.matrix.length !== 16 || !nd.matrix.every(Number.isFinite))) fail(`node ${i} matrix is not 16 finite numbers`);
  });
  for (const s of json.scenes || []) for (const r of s.nodes) if (parent[r] !== -1) fail(`scene root ${r} has a parent`);
  (json.images || []).forEach((im, i) => {
    if (im.mimeType !== 'image/png' || im.bufferView === undefined) fail(`image ${i} must be an embedded PNG`);
    const v = views[im.bufferView], b = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    if (!PNG_SIG.every((x, k) => b[k] === x)) fail(`image ${i} is not a PNG`);
  });
  (json.textures || []).forEach((t, i) => { if (!(json.images && json.images[t.source])) fail(`texture ${i} source ${t.source} does not exist`); });
  return { json, bin, nodes, meshes, parent, accessor: (i) => arrays[i].data, accessorInfo: (i) => arrays[i].a, image: (i) => { const v = views[json.images[i].bufferView]; return bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength); } };
}
module.exports = { readGlb };
