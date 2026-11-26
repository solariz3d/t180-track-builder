// ribbon.js (L243, a first look): ANOTHER TRACK'S ROAD AS A SHADOW LAYER, read from its Assetto Corsa AI line. The user picks an installed track
// (and layout) from AC's content/tracks; its ai/fast_lane.ai is read here and drawn under the user's road at TRUE SCALE, see-through and never
// pickable, to study a design by eye and to get a sense of scale. Nothing of it enters the document, a save or an export. No DOM: node --test runs it.
//
//   readAiShape(buf) -> { n, points: [{ pos, length }], extra: [{ ...EXTRA }], hasGrid, gridBytes }
//   ribbonOf(shape, opts?) -> { batches, edges, lengthM, width: { median, min, max }, closed, start: { pos, T }, points }
//   placeAt(ribbon, anchor, nudge?) -> 16 numbers, the row-vector model matrix (world = local · M, kn5's order; the renderer reads it as GL's)
//   moveOf(ribbon, model) -> { pos, T }   where the reference's start lands, for the tests and the readout
//
// WHY NOT readAiLine (src/export/ailine.js). readAiLine reads the builder's OWN lines back and refuses a grid (hasGrid = 1), by design. On L, 2026-11-26,
// it refused every installed line: 44 HAS_GRID and 2 TRUNCATED of 46 fast_lane.ai files in 61 layouts. The road's shape is all BEFORE the grid
// (the points, then the 18 extra floats a point, then the hasGrid int), so this reader takes the same layout up to hasGrid and does not read the
// grid that follows (the grid is AC's spatial lookup for the AI; it says nothing of the road's shape). readAiLine is unchanged.
//
// THE CROSS-SECTION. Each point's left and right edges are sideLeft and sideRight along the road surface from the line (ailine.js's meanings).
// Across the road is the left axis (up × forward, ailine.js's convention) laid into the surface: the stored NORMAL where it is a unit vector (43 of
// 44 installed lines carry unit normals everywhere), else the camber's lean (+ rises to the right, ailine.js), else flat. Forward is taken from the
// neighbouring points, not the stored fx/fy/fz.
//
// WHAT IT IS, HONESTLY: an AI line's road is the width the AI may use, centred on the line it drives. A recorded line is a RACING line, not the
// centreline, so the ribbon's middle swings to the apexes; sideLeft + sideRight still give the full width at each point. Pit lanes are not in
// fast_lane.ai (they are pit_lane.ai), and run-off appears only where the author widened the sides.
'use strict';

const { EXTRA } = require('../export/ailine.js');

const HEADER = 16, POINT = 20, EXTRA_BYTES = EXTRA.length * 4;
// the most points in one batch: two vertices a point, and the renderer's indices are Uint16 (65,535 vertices a batch)
const BATCH_POINTS = 30000;

class RefTrackError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'RefTrackError'; this.code = code; }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };

/** The shape part of a fast_lane.ai (version 7): the points and their extra fields. A grid after hasGrid is allowed and not read. */
// a Buffer, a Uint8Array or an ArrayBuffer (the page gets an ArrayBuffer from the native side, and has no Buffer): read through a DataView, little-endian
function readAiShape(buf) {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  if (!(u8 instanceof Uint8Array)) throw new RefTrackError('NOT_BYTES', 'an AI line is read from bytes (a Buffer, a Uint8Array or an ArrayBuffer)');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const b = { length: u8.byteLength, readInt32LE: (o) => dv.getInt32(o, true), readFloatLE: (o) => dv.getFloat32(o, true) };
  if (b.length < HEADER) throw new RefTrackError('TRUNCATED', `${b.length} bytes is shorter than the 16-byte header`);
  const version = b.readInt32LE(0), n = b.readInt32LE(4);
  if (version !== 7) throw new RefTrackError('BAD_VERSION', `version ${version}, not 7`);
  if (!(n >= 3)) throw new RefTrackError('TOO_FEW_POINTS', `${n} points; a road needs at least 3`);
  const end = HEADER + n * POINT + 4 + n * EXTRA_BYTES + 4;
  if (b.length < end) throw new RefTrackError('TRUNCATED', `${n} points need ${end} bytes before any grid, the file has ${b.length}`);
  let o = HEADER;
  const points = [];
  for (let k = 0; k < n; k++, o += POINT) points.push({ pos: [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)], length: b.readFloatLE(o + 12) });
  const n2 = b.readInt32LE(o); o += 4;
  if (n2 !== n) throw new RefTrackError('BAD_EXTRA', `extra count ${n2} is not the point count ${n}`);
  const extra = [];
  for (let k = 0; k < n; k++) { const e = {}; for (const f of EXTRA) { e[f] = b.readFloatLE(o); o += 4; } extra.push(e); }
  const hasGrid = b.readInt32LE(o); o += 4;
  if (hasGrid !== 0 && hasGrid !== 1) throw new RefTrackError('BAD_GRID_FLAG', `hasGrid is ${hasGrid}, not 0 or 1`);
  if (hasGrid === 0 && o !== b.length) throw new RefTrackError('TRAILING', `${b.length - o} bytes after hasGrid = 0`);
  for (const p of points) if (!p.pos.every(Number.isFinite)) throw new RefTrackError('NON_FINITE', 'a point has a non-finite position');
  return { n, points, extra, hasGrid, gridBytes: b.length - o };
}

/** Closed when the last point is within three median spacings of the first (encodeAiLine's own test). */
function isClosed(P) {
  const sp = []; for (let k = 1; k < P.length; k++) sp.push(len(sub(P[k], P[k - 1])));
  sp.sort((a, b) => a - b);
  const med = sp[sp.length >> 1], close = len(sub(P[P.length - 1], P[0]));
  return close > 0 && close <= 3 * med;
}

/** Across the road at one point: the left axis laid into the surface. */
function acrossAt(fwd, e) {
  const L = unit([fwd[2], 0, -fwd[0]]);   // up × forward
  const nStored = [e.nx, e.ny, e.nz], nl = len(nStored);
  let n;
  if (nl > 0.5 && nl < 1.5) n = unit(nStored);
  else if (Number.isFinite(e.camber) && e.camber !== 0) n = [Math.sin(e.camber) * L[0], Math.cos(e.camber), Math.sin(e.camber) * L[2]];   // up · cos + left · sin: a + camber leans the normal left, the surface rising to the right
  else n = [0, 1, 0];
  const a = sub(L, n.map((v) => v * dot(L, n)));
  const al = len(a);
  return al > 1e-6 ? [a[0] / al, a[1] / al, a[2] / al] : L;
}

/**
 * The road as triangles from the line: two vertices a point (left edge, right edge), a strip between each point and the next, closed when the
 * line closes. opts.batchPoints (default 30,000) splits it so a batch's indices fit Uint16. edges: the two edge lines as line pairs (for a faint
 * outline). Lengths in metres along the line, with the closing span on a closed line.
 */
function ribbonOf(shape, opts = {}) {
  const P = shape.points.map((p) => p.pos), E = shape.extra, n = P.length, per = opts.batchPoints || BATCH_POINTS;
  if (n < 3 || E.length !== n) throw new RefTrackError('BAD_SHAPE', 'a shape needs at least 3 points and one extra record a point');
  const closed = isClosed(P);
  const fwdAt = (k) => {
    const a = closed ? P[(k - 1 + n) % n] : P[Math.max(0, k - 1)], b = closed ? P[(k + 1) % n] : P[Math.min(n - 1, k + 1)];
    return unit(sub(b, a));
  };
  const left = new Float32Array(n * 3), right = new Float32Array(n * 3), nrm = new Float32Array(n * 3), widths = [];
  let lengthM = 0;
  for (let k = 0; k < n; k++) {
    const f = fwdAt(k), a = acrossAt(f, E[k]), sl = Math.max(0, E[k].sideLeft || 0), sr = Math.max(0, E[k].sideRight || 0), p = P[k];
    for (let i = 0; i < 3; i++) { left[k * 3 + i] = p[i] + a[i] * sl; right[k * 3 + i] = p[i] - a[i] * sr; }
    const up = unit([f[1] * a[2] - f[2] * a[1], f[2] * a[0] - f[0] * a[2], f[0] * a[1] - f[1] * a[0]]);   // forward × left = up
    nrm.set(up[1] < 0 ? up.map((v) => -v) : up, k * 3);
    widths.push(sl + sr);
    if (k > 0) lengthM += len(sub(p, P[k - 1]));
  }
  if (closed) lengthM += len(sub(P[0], P[n - 1]));
  const spans = closed ? n : n - 1, batches = [];
  for (let s0 = 0; s0 < spans; s0 += per) {
    const s1 = Math.min(spans, s0 + per), m = s1 - s0 + 1;   // points s0 .. s1 (wrapped), m of them
    const pos = new Float32Array(m * 6), nr = new Float32Array(m * 6), idx = new Uint16Array((m - 1) * 6);
    for (let j = 0; j < m; j++) {
      const k = (s0 + j) % n;
      pos.set(left.subarray(k * 3, k * 3 + 3), j * 6); pos.set(right.subarray(k * 3, k * 3 + 3), j * 6 + 3);
      nr.set(nrm.subarray(k * 3, k * 3 + 3), j * 6); nr.set(nrm.subarray(k * 3, k * 3 + 3), j * 6 + 3);
    }
    for (let j = 0; j < m - 1; j++) { const a = j * 2, q = j * 6; idx[q] = a; idx[q + 1] = a + 1; idx[q + 2] = a + 2; idx[q + 3] = a + 1; idx[q + 4] = a + 3; idx[q + 5] = a + 2; }
    batches.push({ positions: pos, normals: nr, indices: idx });
  }
  const edges = new Float32Array(spans * 12);
  for (let s = 0; s < spans; s++) {
    const k = s, k2 = (s + 1) % n;
    edges.set(left.subarray(k * 3, k * 3 + 3), s * 12); edges.set(left.subarray(k2 * 3, k2 * 3 + 3), s * 12 + 3);
    edges.set(right.subarray(k * 3, k * 3 + 3), s * 12 + 6); edges.set(right.subarray(k2 * 3, k2 * 3 + 3), s * 12 + 9);
  }
  const sorted = widths.slice().sort((a, b) => a - b);
  return { batches, edges, lengthM, width: { median: sorted[n >> 1], min: sorted[0], max: sorted[n - 1] }, closed, start: { pos: P[0].slice(), T: fwdAt(0) }, points: n };
}

/**
 * Where the reference goes. By default its start goes at the anchor (the user's track start, { pos, T }), facing the same way along the ground,
 * at the same height. nudge { dx, dy, dz (metres, world), yawDeg (about the start, + turns the forward toward the left axis, up × forward) } moves it by hand.
 * There is NO scale, on purpose: 1 m of the reference is 1 m of the user's road.
 */
function placeAt(ribbon, anchor, nudge = {}) {
  const s = ribbon.start, a = anchor || { pos: [0, 0, 0], T: [0, 0, 1] };
  for (const v of [s.pos, s.T, a.pos, a.T]) if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new RefTrackError('BAD_ANCHOR', 'a start and an anchor need pos and T, three numbers each');
  const { dx = 0, dy = 0, dz = 0, yawDeg = 0 } = nudge;
  if (![dx, dy, dz, yawDeg].every(Number.isFinite)) throw new RefTrackError('BAD_NUDGE', 'a nudge is finite numbers: dx, dy, dz in metres and yawDeg in degrees');
  // a row vector [x, y, z] · R turns (x, z) by -th in the (x, z) plane, so th = heading(ref) - heading(anchor) lays the ref's forward on the anchor's
  const th = Math.atan2(s.T[2], s.T[0]) - Math.atan2(a.T[2], a.T[0]) + yawDeg * Math.PI / 180;
  const c = Math.cos(th), sn = Math.sin(th);
  const R = [c, 0, -sn, 0, 1, 0, sn, 0, c];   // rows
  const rp = [s.pos[0] * R[0] + s.pos[1] * R[3] + s.pos[2] * R[6], s.pos[0] * R[1] + s.pos[1] * R[4] + s.pos[2] * R[7], s.pos[0] * R[2] + s.pos[1] * R[5] + s.pos[2] * R[8]];
  const t = [a.pos[0] + dx - rp[0], a.pos[1] + dy - rp[1], a.pos[2] + dz - rp[2]];
  return [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, t[0], t[1], t[2], 1];
}

/** A local point through a row-vector model matrix. */
function apply(M, p, w = 1) {
  return [p[0] * M[0] + p[1] * M[4] + p[2] * M[8] + w * M[12], p[0] * M[1] + p[1] * M[5] + p[2] * M[9] + w * M[13], p[0] * M[2] + p[1] * M[6] + p[2] * M[10] + w * M[14]];
}
function moveOf(ribbon, M) { return { pos: apply(M, ribbon.start.pos), T: apply(M, ribbon.start.T, 0) }; }

module.exports = { readAiShape, ribbonOf, placeAt, moveOf, apply, isClosed, RefTrackError, BATCH_POINTS };
