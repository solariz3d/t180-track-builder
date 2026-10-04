// look.js: what makes the preview read as a track (D170, the D170 review of the D169 window captures, items 1, 2, 7).
// Pure numbers, no GL, so each piece is tested headless; the renderer draws what this returns.
//
//   LIGHT, shade(n)          the lighting: one key light low and to the side, a weak fill from the other side, ambient.
//                            The GLSL in renderer.js is generated from these same numbers, so the test of shade() is a
//                            test of what the shader computes.
//   linesFor(batch)          road lines in the batch's own frame: the two EDGES and the CENTRE along the road, and a TIE
//                            across the road every TIE_M metres (a tie shows banking and the profile's shape).
//   localBounds(batch)       the axis-aligned box of a batch's vertices in its own frame (memoised per array)
//   worldBounds(batches)     the world box of every batch: each local box's 8 corners through its model matrix. It
//                            contains every vertex (a box of a box is conservative).
//   gridLines(bounds)        a faint ground grid at y = 0 under the track (editor UI: scale and height, not scenery)
//   headMarker(head)         a mast and a cross at the build head, so the head is visible from overhead
'use strict';

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return l > 0 ? v.map((x) => x / l) : v; };
/** Key light from low and to the side (so a floor and a wall differ), fill from the opposite side, and ambient. */
const LIGHT = Object.freeze({ key: norm([-0.45, 0.7, 0.55]), fill: norm([0.5, 0.35, -0.6]), keyK: 0.72, fillK: 0.22, ambient: 0.2 });
/**
 * The brightness of a surface with unit normal n: ambient + key·max(n·key, 0) + fill·max(n·fill, 0). Two-sided: a
 * normal facing away from both lights is flipped first, so an overhang or a tube roof is lit from below like a floor
 * from above (the track has no back faces a driver sees).
 */
function shade(n) {
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const m = d(n, LIGHT.key) < 0 && d(n, LIGHT.fill) < 0 ? n.map((x) => -x) : n;
  return LIGHT.ambient + LIGHT.keyK * Math.max(d(m, LIGHT.key), 0) + LIGHT.fillK * Math.max(d(m, LIGHT.fill), 0);
}

const TIE_M = 10, LIFT = 0.03;        // a tie every 10 m (inferred: two ties per car length at 5 m would clutter); lines 3 cm off the surface
const lineMemo = new WeakMap();
/**
 * The road lines of one cell batch, in its own frame (drawn with its model matrix). Needs batch.cols (vertices across),
 * batch.us (their u), batch.rowS (each row's s). Returns { edges: Float32Array, ties: Float32Array } as GL LINES pairs,
 * each vertex lifted LIFT m along its normal so the line never fights the surface. Seams have no lines.
 * Memoised by the batch's positions array, so a piece the geometry only moved keeps the same line arrays.
 */
function linesFor(b) {
  if (b.seam || !b.cols || !b.rowS) return null;
  const hit = lineMemo.get(b.positions); if (hit) return hit;
  const K = b.cols, R = b.rowS.length, P = b.positions, N = b.normals;
  let kc = 0; for (let k = 1; k < K; k++) if (Math.abs(b.us[k]) < Math.abs(b.us[kc])) kc = k;
  const v = (r, k) => { const i = (r * K + k) * 3; return [P[i] + N[i] * LIFT, P[i + 1] + N[i + 1] * LIFT, P[i + 2] + N[i + 2] * LIFT]; };
  const edges = [], ties = [];
  for (let r = 0; r + 1 < R; r++) for (const k of [0, kc, K - 1]) edges.push(...v(r, k), ...v(r + 1, k));
  for (let r = 0; r < R; r++) {
    if (!(r === 0 || Math.floor(b.rowS[r] / TIE_M) !== Math.floor(b.rowS[r - 1] / TIE_M))) continue;
    for (let k = 0; k + 1 < K; k++) ties.push(...v(r, k), ...v(r, k + 1));
  }
  const out = { edges: new Float32Array(edges), ties: new Float32Array(ties), centre: kc };
  lineMemo.set(b.positions, out);
  return out;
}

const boxMemo = new WeakMap();
function localBounds(b) {
  const hit = boxMemo.get(b.positions); if (hit) return hit;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], P = b.positions;
  for (let i = 0; i < P.length; i += 3) for (let d = 0; d < 3; d++) { if (P[i + d] < lo[d]) lo[d] = P[i + d]; if (P[i + d] > hi[d]) hi[d] = P[i + d]; }
  const box = { min: lo, max: hi }; boxMemo.set(b.positions, box); return box;
}
function worldBounds(batches) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of batches) {
    const { min, max } = localBounds(b), M = b.model;
    for (let c = 0; c < 8; c++) {
      const p = [c & 1 ? max[0] : min[0], c & 2 ? max[1] : min[1], c & 4 ? max[2] : min[2]];
      for (let d = 0; d < 3; d++) { const w = p[0] * M[d] + p[1] * M[4 + d] + p[2] * M[8 + d] + M[12 + d]; if (w < lo[d]) lo[d] = w; if (w > hi[d]) hi[d] = w; }
    }
  }
  return lo[0] === Infinity ? null : { min: lo, max: hi };
}

/**
 * Grid lines at y = 0 covering the track's box plus 50 m, on a 10 m spacing that widens (×5) until each axis has at
 * most 200 lines, so a 14 km track stays a few hundred lines. Returns { positions (world, GL LINES), spacing }.
 */
function gridExtent(bounds) {
  let sp = 10; const pad = 50;
  const span = (d) => bounds.max[d] - bounds.min[d] + 2 * pad;
  while (Math.max(span(0), span(2)) / sp > 200) sp *= 5;
  return { sp, x0: Math.floor((bounds.min[0] - pad) / sp) * sp, x1: Math.ceil((bounds.max[0] + pad) / sp) * sp, z0: Math.floor((bounds.min[2] - pad) / sp) * sp, z1: Math.ceil((bounds.max[2] + pad) / sp) * sp };
}
/** `y` is the height of the grid (default 0: the ground; D237's 3D grid puts it at the track's lowest point). `extent` (gridExtent) may be passed when the caller has it already. */
function gridLines(bounds, y = 0, extent = null) {
  if (!bounds) return null;
  const { sp, x0, x1, z0, z1 } = extent || gridExtent(bounds);
  const p = [];
  for (let x = x0; x <= x1 + 1e-9; x += sp) p.push(x, y, z0, x, y, z1);
  for (let z = z0; z <= z1 + 1e-9; z += sp) p.push(x0, y, z, x1, y, z);
  return { positions: new Float32Array(p), spacing: sp };
}
/**
 * The build head's marker, world coordinates: a mast along the ROAD's up and a cross in the road plane (along T and L), plus a
 * square ring around the head in that plane, so it reads from overhead too (a vertical mast seen from above is a point).
 * `size` is the cross's half-length; the preview scales it with the camera's distance so it stays readable at any zoom.
 * Default 3 m: a 10 m mast and a 6 m cross.
 * THE MAST FOLLOWS THE ROAD'S U (D225, E's seal X2 ii and the librarian's ruling): it used to rise along WORLD y, so on an inverted road
 * it pointed down through the floor and in a closed tube it left through the roof. `clear` (optional, preview.js clearanceAtHead) is
 * the room inside a CLOSED tube at the head, { up, lat } in metres: the mast is held below `up` and the cross and ring's sideways arms
 * inside `lat`, so the marker never leaves the tube. With no head.U (an old caller) the mast stands on world y as before.
 */
function headMarker(head, size = 3, clear = null) {
  if (!head) return null;
  const U = Array.isArray(head.U) && head.U.length === 3 && head.U.every(Number.isFinite) ? head.U : [0, 1, 0];
  const at = (v, k) => head.pos.map((x, i) => x + v[i] * k), r = size * 1.6;
  const mast = clear ? Math.min(size * 10 / 3, clear.up) : size * 10 / 3, side = (k) => (clear ? Math.sign(k) * Math.min(Math.abs(k), clear.lat) : k);
  const c = (a, b) => head.pos.map((x, i) => x + head.T[i] * a + head.L[i] * side(b));
  const ring = [[r, r], [r, -r], [-r, -r], [-r, r]].flatMap((p, i, q) => [...c(...p), ...c(...q[(i + 1) % 4])]);
  return { positions: new Float32Array([...head.pos, ...at(U, mast), ...at(head.T, -size), ...at(head.T, size), ...at(head.L, side(-size)), ...at(head.L, side(size)), ...ring]) };
}

/**
 * Per-vertex tangents (the direction of increasing u, orthogonalised against the normal), for the normal-mapped shader:
 * each triangle's dPosition/du is summed into its vertices, then made perpendicular to the normal, as
 * src/export/kn5write.js writes the kn5's tangents. Memoised per positions array. A degenerate one falls back to the
 * normal's own perpendicular.
 */
const tanMemo = new WeakMap();
function tangentsFor(b) {
  const hit = tanMemo.get(b.positions); if (hit) return hit;
  const P = b.positions, N = b.normals, U = b.uvs, I = b.indices, T = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const [a, c, d] = [I[t], I[t + 1], I[t + 2]], du1 = U[c * 2] - U[a * 2], dv1 = U[c * 2 + 1] - U[a * 2 + 1], du2 = U[d * 2] - U[a * 2], dv2 = U[d * 2 + 1] - U[a * 2 + 1];
    const det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-12) continue;
    const r = 1 / det;
    for (let k = 0; k < 3; k++) {
      const e1 = P[c * 3 + k] - P[a * 3 + k], e2 = P[d * 3 + k] - P[a * 3 + k], tk = (e1 * dv2 - e2 * dv1) * r;
      T[a * 3 + k] += tk; T[c * 3 + k] += tk; T[d * 3 + k] += tk;
    }
  }
  for (let v = 0; v < P.length; v += 3) {
    const n = [N[v], N[v + 1], N[v + 2]], t = [T[v], T[v + 1], T[v + 2]], nt = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
    let o = [t[0] - n[0] * nt, t[1] - n[1] * nt, t[2] - n[2] * nt], l = Math.hypot(o[0], o[1], o[2]);
    if (!(l > 1e-9)) { o = Math.abs(n[0]) < 0.9 ? [0, -n[2], n[1]] : [-n[1], n[0], 0]; l = Math.hypot(o[0], o[1], o[2]); }
    T[v] = o[0] / l; T[v + 1] = o[1] / l; T[v + 2] = o[2] / l;
  }
  tanMemo.set(b.positions, T); return T;
}

module.exports = { LIGHT, shade, linesFor, tangentsFor, localBounds, worldBounds, gridLines, gridExtent, headMarker, TIE_M, LIFT };
