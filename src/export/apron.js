// apron.js: an EDGE APRON outside every open edge of an equation-core road, so a wheel that drops off the edge has a surface under it and rides back up (D572).
// The user, 2026-10-30 17:50: "sometimes when drivers get close to the edge of the track and a wheel goes off, it clips into the track when the car drives further into it";
// 17:59: "IT STARTS on the edge, but then can clip further into the road"; 18:43: "the underside geometry of the track leaves a little gap in between itself and the top of
// the track when viewed from the side".
//
//   withApron(scene, mesh, segments, { widthM, slopeDeg, lane }) -> scene    the export's scene with, on each open side of every core road cell,
//     widthM > 0: the APRON, a physics strip from the road's own edge row OUTWARD widthM (measured across, in the road's cross-section) and DOWN widthM·tan(slopeDeg), and
//                 under it a JOIN face from the apron's outer row back in to the underside skin's edge row (underskin.js: the edge vertex UNDERSKIN_OFFSET_M along its own
//                 normal), so the section under the edge is a closed wedge whose every face points out of it;
//     widthM = 0: no apron, and a SIDE FACE from the road's edge row straight to the skin's edge row, so the gap seen from the side is closed at every setting.
//   the scene itself (the same object) when nothing gets one.
//
// WHY. The road is one single-sided physics shell; the skin 0.5 m under it is scenery (underskin.js). Between the road's edge row and the skin's edge row the section is
// open to the side, and a wheel that drops past the edge and is steered back comes in UNDER the road and hangs there with nothing to lead it up (measured in the room's
// record: the Demo's rear right went 0.86 m past the edge at 655 km/h and came back 0.31 m under the surface, exo_memory/handback/p-d563-wheel-under-O_2026-10-30.md). The
// apron gives that wheel a surface while it is out, at the height it falls to: at 25°, 0.86 m out the apron is 0.40 m below the edge row. Steered back, it rides up onto the
// road, because the apron starts on the road's own edge vertices.
//
// WHAT IS PHYSICS. Only the apron's TOP, the surface a wheel rides: named `<the cell's own prefix>APRON_<the cell's name>_L` or `_R`, so it is AC's ROAD (or the piece's
// own grip surface, 1GRIPnnn_, gripkeys.js) with the road's FRICTION and IS_VALID_TRACK, a wheel there still counting as on the track, and the soft-collision block's
// `MESHES=1ROAD?` (and `1GRIP?`) covers it (`?` is any symbols, gripkeys.js:7; catch.js's 1ROAD_CATCH_ relies on the same reading). The piece's name comes first so a merged
// chunk is named for its piece. The JOIN and the SIDE FACE are SCENERY (`APRONSIDE_…`, no leading digit): as road surfaces their lower edges, just under the road, would be
// open edges with road 0.1 m beyond them (the road's underside), which src/validate/raygap.js reads as a downforce-ray gap on every station; and a wall surface is not
// among AC's standard keys (ROAD, GRASS, KERB, SAND on the user's install) nor defined in this export's surfaces.ini. So at width 0 the gap is closed to the eye only.
// Nothing here moves a road vertex: the road's nodes are the same objects; the aprons are appended after everything the scene holds, with one material, darker than the road,
// and plain uvs (a tile of APRON_TILE_M).
//
// WHERE: every core road cell's two sides, EXCEPT
//   a closed ring (a tube swept to 360: underskin.js ringCells; it has no edge); a seam row (its zipper is not a grid; the strips either side meet at the joint, the cells'
//   edge rows being the piece ends'); a WALL side (its last segment rises WALL_DEG or more above the road's lateral in any row of the cell: a cup or edge standing up as a
//   wall the car rides, not an edge it drops off); and the PIT LANE's side over the lane's span (`lane`: { side 'L' or 'R', s0, s1 }, the leave and the rejoin in the main
//   road's s, widened PIT_PAD_M each way), where the lane and its infill join the road and the edge is not open. A side whose edge zone turns down (e < 0) is open and its
//   apron starts at the zone's outer row, which is the mesh's last column. Flights (jump segments) have no cells and no apron.
//   The mesh's column 0 is the road's right (−u) and column K − 1 its left (+u, the frame's L).
'use strict';
const { UNDERSKIN_OFFSET_M, ringCells } = require('./underskin.js');

const APRON_WIDTH_M = 2.0;     // the default: one measured excursion reached 0.86 m past the edge (p-d563), and 2 m covers it with room
const APRON_SLOPE_DEG = 25;    // down from the road's lateral: 20° sits above a dropping wheel only for the first half metre, 30° starts to read as a wall
const WALL_DEG = 60;           // a side rising this steeply or more is a wall, and gets no apron
const APRON_TILE_M = 4;        // the uv tile, in metres
const PIT_PAD_M = 5;           // each way past the pit lane's leave and rejoin
const APRON_TAG = 'APRON', SIDE_PREFIX = 'APRONSIDE';

const apronMaterial = () => ({
  name: 't180b_apron', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0,
  props: [{ name: 'ksAmbient', value: [0.25] }, { name: 'ksDiffuse', value: [0.3] }, { name: 'ksSpecular', value: [0.05] },
    { name: 'ksSpecularEXP', value: [1] }, { name: 'ksEmissive', value: [0, 0, 0] }, { name: 'ksAlphaRef', value: [0] }],
  samplers: [],
});

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(a[0], a[1], a[2]), unit = (a) => { const l = len(a); return l > 0 ? mul(a, 1 / l) : a; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * One side of one grid cell, row by row: { E, X, N, NE, rim }. E the edge vertex; X the outward lateral (the edge minus the centre vertex, its component along the centre's
 * normal removed); N the centre vertex's normal (the section's up); NE the edge vertex's normal AS STORED (so E − UNDERSKIN_OFFSET_M·NE is the very vertex underskin.js
 * skinOf writes there); rim the side's last segment's angle above X, in degrees.
 */
function sideRows(m, K, side) {
  const P = m.positions, Nn = m.normals, R = P.length / 3 / K, ic = Math.floor(K / 2), i0 = side === 0 ? 0 : K - 1, i1 = side === 0 ? 1 : K - 2, rows = [];
  const at = (A, r, k) => [A[(r * K + k) * 3], A[(r * K + k) * 3 + 1], A[(r * K + k) * 3 + 2]];
  for (let r = 0; r < R; r++) {
    const E = at(P, r, i0), C = at(P, r, ic), N = unit(at(Nn, r, ic)), lat = sub(E, C), X = unit(sub(lat, mul(N, dot(lat, N)))), d = sub(E, at(P, r, i1));
    rows.push({ E, X, N, NE: at(Nn, r, i0), rim: (Math.atan2(dot(d, N), dot(d, X)) * 180) / Math.PI });
  }
  return rows;
}

/** A strip of two vertices a row (a[r], b[r]): one quad per pair of rows, each triangle wound so its normal points away from G[r] (the wedge's inside). */
function strip(name, a, b, na, nb, uva, uvb, G, physics) {
  const R = a.length, V = [], Nv = [], UV = [], idx = [];
  for (let r = 0; r < R; r++) { V.push(a[r], b[r]); Nv.push(na[r], nb[r]); UV.push(uva[r], uvb[r]); }
  for (let r = 0; r + 1 < R; r++) {
    const A0 = 2 * r, B0 = A0 + 1, C0 = A0 + 2, D0 = A0 + 3, n = cross(sub(V[C0], V[A0]), sub(V[B0], V[A0])), mid = mul(add(add(V[A0], V[B0]), V[C0]), 1 / 3);
    if (dot(n, sub(mid, G[r])) >= 0) idx.push(A0, C0, B0, B0, C0, D0); else idx.push(A0, B0, C0, B0, D0, C0);
  }
  const positions = new Float32Array(V.length * 3), normals = new Float32Array(V.length * 3), uvs = new Float32Array(V.length * 2);
  V.forEach((p, i) => { positions.set(p, i * 3); normals.set(Nv[i], i * 3); uvs.set(UV[i], i * 2); });
  return { type: 'mesh', name, material: -1, castShadows: true, visible: true, transparent: false, renderable: true, positions, normals, uvs, indices: Uint16Array.from(idx), physics };
}

/**
 * One side of one grid cell, in the cell's own frame: { top, side } (top null at width 0), or null for a wall side or a cell too narrow to have a centre apart from its edge.
 * `names`: { top, side }.
 */
function apronOf(m, K, side, { widthM = APRON_WIDTH_M, slopeDeg = APRON_SLOPE_DEG } = {}, names) {
  if (!(K >= 3)) return null;
  const rows = sideRows(m, K, side);
  if (rows.some((q) => q.rim >= WALL_DEG)) return null;
  const drop = widthM * Math.tan((slopeDeg * Math.PI) / 180), S = rows.map((q) => sub(q.E, mul(q.NE, UNDERSKIN_OFFSET_M))), vAt = [];
  let along = 0; rows.forEach((q, r) => { if (r > 0) along += len(sub(q.E, rows[r - 1].E)); vAt.push(along / APRON_TILE_M); });
  const T = rows.map((q, r) => unit(sub((rows[r + 1] || q).E, (rows[r - 1] || q).E)));
  if (!(widthM > 0)) {
    const G = rows.map((q) => sub(q.E, q.X));   // the inside is toward the road: a metre in from the edge
    const face = strip(names.side, rows.map((q) => q.E), S, rows.map((q) => q.X), rows.map((q) => q.X), vAt.map((v) => [0, v]), vAt.map((v) => [UNDERSKIN_OFFSET_M / APRON_TILE_M, v]), G, false);
    return { top: null, side: face };
  }
  const O = rows.map((q) => add(add(q.E, mul(q.X, widthM)), mul(q.N, -drop))), G = rows.map((q, r) => mul(add(add(q.E, O[r]), S[r]), 1 / 3));
  const nTop = rows.map((q, r) => { const n = unit(cross(T[r], unit(sub(O[r], q.E)))); return dot(n, q.N) >= 0 ? n : mul(n, -1); });
  const nJoin = rows.map((q, r) => { const n = unit(cross(T[r], unit(sub(S[r], O[r])))), mid = mul(add(O[r], S[r]), 0.5); return dot(n, sub(mid, G[r])) >= 0 ? n : mul(n, -1); });
  const top = strip(names.top, rows.map((q) => q.E), O, nTop, nTop, vAt.map((v) => [0, v]), vAt.map((v) => [widthM / APRON_TILE_M, v]), G, true);
  const join = strip(names.side, O, S, nJoin, nJoin, vAt.map((v) => [0, v]), O.map((o, r) => [len(sub(S[r], o)) / APRON_TILE_M, vAt[r]]), G, false);
  return { top, side: join };
}

/** Whether a cell [c0, c1] (main s) overlaps the lane's span, widened PIT_PAD_M each way; a span with s0 > s1 wraps over a closed lap's start. */
function inLaneSpan(cell, lane) {
  if (!lane) return false;
  const a = lane.s0 - PIT_PAD_M, b = lane.s1 + PIT_PAD_M;
  return lane.s0 <= lane.s1 ? cell.s1 >= a && cell.s0 <= b : cell.s1 >= a || cell.s0 <= b;
}

/** Which of `mesh.cells` may get an apron: the core road cells that are a grid (not a seam row) and not a closed ring. Set of cell indexes. */
function apronCells(mesh, segments) {
  const out = new Set();
  if (!mesh || !mesh._state) return out;
  const rings = ringCells(mesh, segments);
  mesh.cells.forEach((cell, k) => { const seg = segments[cell.piece]; if (seg && seg.word === 'core' && !cell.seam && !rings.has(k) && mesh._state.pieces[cell.piece]) out.add(k); });
  return out;
}

const PREFIX_RE = /^1(?:ROAD|GRIP\d{3})_/;
function withApron(scene, mesh, segments, opts = {}) {
  const widthM = opts.widthM === undefined ? APRON_WIDTH_M : opts.widthM, slopeDeg = opts.slopeDeg === undefined ? APRON_SLOPE_DEG : opts.slopeDeg, lane = opts.lane || null;
  if (!(Number.isFinite(widthM) && widthM >= 0 && widthM <= 10)) throw new Error(`the edge apron's width must be from 0 to 10 m, not ${widthM}`);
  if (!(Number.isFinite(slopeDeg) && slopeDeg >= 0 && slopeDeg < 90)) throw new Error(`the edge apron's slope must be from 0 to under 90 degrees, not ${slopeDeg}`);
  if (lane && !(lane.side === 'L' || lane.side === 'R') ) throw new Error(`the pit lane's side must be 'L' or 'R', not ${lane.side}`);
  if (!mesh || !mesh.cells || !mesh.scene) return scene;
  const chosen = apronCells(mesh, segments);
  if (!chosen.size) return scene;
  const kids = scene.root.children, orig = mesh.scene.root.children, materials = scene.materials.slice(), matIndex = materials.length, add = [];
  for (const k of [...chosen].sort((a, b) => a - b)) {
    const c = kids[k], m = c && c.children && c.children[0], o = orig[k] && orig[k].children[0];
    // the scene's cell may carry its piece's grip prefix (gripkeys.js renames 1ROAD_ to 1GRIPnnn_); the rest of its name is the mesh's own
    if (!m || !o || !PREFIX_RE.test(m.name) || m.name.replace(PREFIX_RE, '') !== o.name.replace(PREFIX_RE, '')) throw new Error(`withApron: scene node ${k} is not the mesh's cell ${k} (${m && m.name} against ${o && o.name})`);
    const K = mesh._state.pieces[mesh.cells[k].piece].K, prefix = PREFIX_RE.exec(m.name)[0], rest = m.name.replace(PREFIX_RE, '');
    for (const [side, tag] of [[0, 'R'], [K - 1, 'L']]) {
      if (lane && lane.side === tag && inLaneSpan(mesh.cells[k], lane)) continue;
      const ap = apronOf(m, K, side, { widthM, slopeDeg }, { top: `${prefix}${APRON_TAG}_${rest}_${tag}`, side: `${SIDE_PREFIX}_${rest}_${tag}` });
      if (!ap) continue;
      for (const [mm, dn] of [[ap.top, `APRON${tag}_`], [ap.side, `APRONSIDE${tag}_`]]) {
        if (!mm) continue;
        const { physics, ...node } = mm; void physics; node.material = matIndex;
        add.push({ type: 'dummy', name: c.name.replace(/^CELL_/, dn), matrix: c.matrix, children: [node] });
      }
    }
  }
  if (!add.length) return scene;
  materials.push(apronMaterial());
  return { ...scene, materials, root: { ...scene.root, children: [...kids, ...add] } };
}

module.exports = { withApron, apronOf, apronCells, sideRows, inLaneSpan, APRON_WIDTH_M, APRON_SLOPE_DEG, WALL_DEG, APRON_TILE_M, PIT_PAD_M, SIDE_PREFIX };
