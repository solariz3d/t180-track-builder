// road.js (L250): ANOTHER TRACK'S ROAD FROM ITS KN5, as the shadow pass draws it. The native side reads the track's kn5 files and sends only the
// meshes AC counts as valid track (ROAD, KERB and every key its surfaces.ini marks IS_VALID_TRACK=1), as positions and 16-bit indices
// (read_reference_road, src-tauri/src/kn5road.rs; never the files themselves, 450 to 634 MB for three tracks on L). No DOM: node --test runs it.
//
//   decodeRoad(bytes) -> { batches: [{ positions, normals, indices }], triangles, vertices, meta }   the native side's bytes, refused whole if they do not read
//                        (meta: the header's { files, missing, meshes, triangles, vertices, keys, surfaces })
//   encodeRoad(batches, meta?) -> bytes                                                           the same layout, for the tests (the native side writes it in Rust)
//   roadReference(road, line) -> what the preview's setReference takes: the road's batches, PLACED BY THE LAYOUT'S AI LINE (its start and way), so
//                                Line and Road of one layout lie on each other across and share the nudge; with no line, by the start its kn5 names.
//                                Either start is set down on the road under it, so Road is flush with his road (the second repair)
//   groundUnder(batches, pos) -> the height of the highest road at or below a point, or null
//
// WHY THE AI LINE PLACES IT. A kn5's road meshes carry no direction of travel. The layout's AI line is in the same world coordinates as its kn5 (both
// are the track's own), so its first point and its way are the start the Line mode already uses; the road goes where the line says. A layout with no
// AI line (15 of 61 on L) is placed by the start its kn5 names (the header's start: AC_START_0 is the grid's first slot, a median 11.2 m from the
// line's first point where there is both, pane O's survey), set down on the road under it.
//
// THE BYTES (little-endian), as kn5road.rs encode() writes them (its header says the same):
//   "T180ROAD" · u32 format (1) · u32 J · J bytes of JSON, space-padded to a multiple of 4 ({ files, missing, meshes, triangles, vertices, keys, surfaces })
//   u32 batch count, then for each batch: u32 vertex count V, u32 index count I, V × 3 f32 positions (x, y, z), I × u16 indices, and 2 bytes of
//   padding when I is odd (so the next batch starts on 4 bytes). Nothing after the last batch.
'use strict';

const { RefTrackError } = require('./ribbon.js');

const MAGIC = 'T180ROAD', FORMAT = 1;

/** Area-weighted vertex normals, turned to face up (the road is seen from above; a kn5's winding is not ours to trust). */
function normalsOf(P, I) {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
  }
  for (let k = 0; k < N.length; k += 3) { const l = Math.hypot(N[k], N[k + 1], N[k + 2]); if (l > 0) { N[k] /= l; N[k + 1] /= l; N[k + 2] /= l; } else N[k + 1] = 1; }
  return N;
}

/** The native side's road bytes as drawable batches; anything that does not read whole is refused (a RefTrackError, BAD_ROAD with what was wrong), never drawn in part. */
function decodeRoad(buf) {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  if (!(u8 instanceof Uint8Array)) throw new RefTrackError('NOT_BYTES', 'a road is read from bytes (a Buffer, a Uint8Array or an ArrayBuffer)');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), end = u8.byteLength;
  const need = (o, n, what) => { if (o + n > end) throw new RefTrackError('BAD_ROAD', `it ends at ${end} bytes; ${what} needs ${o + n}`); };
  need(0, 16, 'the header');
  let magic = ''; for (let k = 0; k < 8; k++) magic += String.fromCharCode(u8[k]);
  if (magic !== MAGIC) throw new RefTrackError('BAD_ROAD', 'it does not start with T180ROAD: it is not the native side\'s road');
  const format = dv.getUint32(8, true), J = dv.getUint32(12, true);
  if (format !== FORMAT) throw new RefTrackError('BAD_ROAD', `format ${format}, not ${FORMAT}`);
  need(16, J + 4, 'the header\'s JSON and the batch count');
  let meta;
  try { meta = JSON.parse(new TextDecoder().decode(u8.subarray(16, 16 + J))); } catch (e) { throw new RefTrackError('BAD_ROAD', `its header is not JSON (${e.message})`); }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new RefTrackError('BAD_ROAD', 'its header is not a JSON object');
  const count = dv.getUint32(16 + J, true);
  if (count > 100000) throw new RefTrackError('BAD_ROAD', `${count} batches is not a road`);
  let o = 20 + J, triangles = 0, vertices = 0;
  const batches = [];
  for (let b = 0; b < count; b++) {
    need(o, 8, `batch ${b}'s counts`);
    const V = dv.getUint32(o, true), I = dv.getUint32(o + 4, true); o += 8;
    if (V > 65536 || I % 3 !== 0) throw new RefTrackError('BAD_ROAD', `batch ${b} has ${V} vertices and ${I} indices (16-bit indices, three a triangle)`);
    need(o, V * 12 + I * 2, `batch ${b}`);
    const positions = new Float32Array(V * 3);
    for (let k = 0; k < V * 3; k++, o += 4) positions[k] = dv.getFloat32(o, true);
    const indices = new Uint16Array(I);
    for (let k = 0; k < I; k++, o += 2) { const v = dv.getUint16(o, true); if (v >= V) throw new RefTrackError('BAD_ROAD', `batch ${b} index ${k} is ${v}, past its ${V} vertices`); indices[k] = v; }
    if (I % 2) { need(o, 2, `batch ${b}'s padding`); o += 2; }
    for (const v of positions) if (!Number.isFinite(v)) throw new RefTrackError('BAD_ROAD', `batch ${b} has a position that is not a number`);
    batches.push({ positions, normals: normalsOf(positions, indices), indices });
    triangles += I / 3; vertices += V;
  }
  if (o !== end) throw new RefTrackError('BAD_ROAD', `${end - o} bytes after the last batch`);
  if (Number.isFinite(meta.triangles) && meta.triangles !== triangles) throw new RefTrackError('BAD_ROAD', `its header says ${meta.triangles} triangles, its batches hold ${triangles}`);
  return { batches, triangles, vertices, meta };
}

/** The same layout, written (for the tests: the native side writes it in Rust). */
function encodeRoad(batches, meta = {}) {
  const tris = batches.reduce((a, b) => a + b.indices.length / 3, 0), verts = batches.reduce((a, b) => a + b.positions.length / 3, 0);
  let head = JSON.stringify({ files: 1, missing: 0, meshes: batches.length, triangles: tris, vertices: verts, keys: ['ROAD', 'KERB'], surfaces: 'defaults', ...meta });
  while (head.length % 4) head += ' ';
  const hb = new TextEncoder().encode(head);
  let size = 20 + hb.length; for (const b of batches) size += 8 + b.positions.length * 4 + b.indices.length * 2 + (b.indices.length % 2 ? 2 : 0);
  const out = new Uint8Array(size), dv = new DataView(out.buffer); let o = 0;
  for (let k = 0; k < 8; k++) out[k] = MAGIC.charCodeAt(k);
  dv.setUint32(8, FORMAT, true); dv.setUint32(12, hb.length, true); out.set(hb, 16); o = 16 + hb.length;
  dv.setUint32(o, batches.length, true); o += 4;
  for (const b of batches) {
    dv.setUint32(o, b.positions.length / 3, true); dv.setUint32(o + 4, b.indices.length, true); o += 8;
    for (const v of b.positions) { dv.setFloat32(o, v, true); o += 4; }
    for (const i of b.indices) { dv.setUint16(o, i, true); o += 2; }
    if (b.indices.length % 2) o += 2;
  }
  return out;
}

/** The height of the road under a point: the highest road surface whose triangle holds its (x, z) AT OR BELOW it, or null when no road is under it.
 *  (Second repair, pane E's bridge_check: it was "at most 2 m above it", which took a deck 5.5 m over a start 3.562 m up for the ground; every start on
 *  L is at least 1.112 m above its road, and every AI line's first point 0.276 m, so at or below finds each.) "At" is a hair, HAIR m, above the point
 *  (L256, pane O's read): a road at the point's own height comes back a few ulps above it at heights that are not powers of two, and a header's start
 *  is the decimal of an f32, below the f32 the road holds; either way its own road was dropped for a lower one. */
const HAIR = 0.01;
function groundUnder(batches, pos) {
  const x = pos[0], z = pos[2], top = pos[1] + HAIR; let best = null;
  for (const { positions: P, indices: I } of batches) {
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, x0 = P[a], z0 = P[a + 2], x1 = P[b], z1 = P[b + 2], x2 = P[c], z2 = P[c + 2];
      if ((x < x0 && x < x1 && x < x2) || (x > x0 && x > x1 && x > x2) || (z < z0 && z < z1 && z < z2) || (z > z0 && z > z1 && z > z2)) continue;
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2); if (d === 0) continue;
      const u = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d, v = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d, w = 1 - u - v;
      if (u < 0 || v < 0 || w < 0) continue;
      const y = u * P[a + 1] + v * P[b + 1] + w * P[c + 1];
      if (y <= top && (best === null || y > best)) best = y;
    }
  }
  return best;
}

/**
 * The road, ready for the preview: its own batches and no edge lines, placed by the layout's AI line where it has one (its start and way, so Line and
 * Road lie on each other and share the nudge), else (L250 repair, for the 15 of 61 layouts on L with no AI line) by the start its kn5 names, which
 * the native side puts in the header (kn5road.rs: AC_START_0, else the middle of the time line AC_TIME_0_L/R), set down on the road under it; else
 * refused (NO_START), with the native side's reason. A start is never guessed.
 * Either start is set down on the road under it (setDown): a start dummy is where a car is set down, and an AI line rides above its road (0.276 to
 * 0.573 m on L, pane E's start_survey), so the road under it goes on his start and Road is flush with his road in both cases. Line and Road of one
 * layout then lie on each other across, not in height (the second repair: the librarian's call, on pane E's weighing).
 */
function roadReference(road, line) {
  if (!road || !Array.isArray(road.batches)) throw new RefTrackError('BAD_ROAD', 'a road needs its batches (decodeRoad)');
  const common = { kind: 'road', batches: road.batches, edges: new Float32Array(0), triangles: road.triangles };
  const setDown = (s) => { const y = groundUnder(road.batches, s.pos); return { start: { pos: [s.pos[0], y === null ? s.pos[1] : y, s.pos[2]], T: s.T.slice() }, startAbove: y === null ? null : s.pos[1] - y }; };
  // to undo the set-down with a line (Road on the line's own start, as before the second repair): `start: line.start` in place of `...setDown(line.start)`
  if (line && line.start) return { ...common, ...setDown(line.start), lengthM: line.lengthM, width: line.width, closed: line.closed, points: line.points, placedBy: 'its AI line' };
  const s = road.meta && road.meta.start;
  if (!s) throw new RefTrackError('NO_START', (road.meta && road.meta.noStart) || 'its kn5 names no start');
  const three = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!three(s.pos) || !three(s.T)) throw new RefTrackError('BAD_ROAD', 'its start is not a position and a way, three numbers each');
  if (Math.hypot(s.T[0], s.T[2]) < 0.1) throw new RefTrackError('BAD_ROAD', 'its start does not face along the ground');
  // AC_START_0 is the grid's first slot: the panel says so in his words (second repair; it said "AC_START_0")
  return { ...common, ...setDown(s), lengthM: null, width: null, closed: null, points: null,
    placedBy: `its kn5's start (${s.from === 'AC_TIME_0' ? 'the middle of its time line' : 'its first grid slot'})` };
}

module.exports = { decodeRoad, encodeRoad, roadReference, normalsOf, groundUnder };
