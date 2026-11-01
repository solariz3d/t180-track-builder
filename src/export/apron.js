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
// own grip surface, 1GRIPnnn_, by gripkeys.js's gripKey) with the road's FRICTION and IS_VALID_TRACK, a wheel there still counting as on the track, and the soft-collision block's
// `MESHES=1ROAD?` (and `1GRIP?`) covers it (`?` is any symbols, gripkeys.js:7; catch.js's 1ROAD_CATCH_ relies on the same reading). The piece's name comes first so a merged
// chunk is named for its piece. The JOIN and the SIDE FACE are SCENERY (`APRONSIDE_…`, no leading digit): as road surfaces their lower edges, just under the road, would be
// open edges with road 0.1 m beyond them (the road's underside), which src/validate/raygap.js reads as a downforce-ray gap on every station; and a wall surface is not
// among AC's standard keys (ROAD, GRASS, KERB, SAND on the user's install) nor defined in this export's surfaces.ini. So at width 0 the gap is closed to the eye only.
// Nothing here moves a road vertex: the road's nodes are the same objects; the aprons are appended after everything the scene holds, with one material, darker than the road,
// and plain uvs (a tile of APRON_TILE_M).
//
// WHAT IS SEEN (D593). The user, 2026-10-31, on the first export with it: "at a first glance, the sides of the track look decent, but when you look at it closer, the texture
// and geometry look bad"; and 17:17, of the same export: "the sides work very well compared to hand made tracks for stopping wheel dropping off and clipping into the
// track". What is drawn is THE PHYSICS ITSELF: the plank a wheel rides and the join under it are drawn as they are, vertex for vertex, so nothing a driver sees lies
// anywhere a wheel does not. Two drawn forms over a hidden plank were tried and removed: a lip rolling 2 m out (the user, 21:54 on 0.4.35: "the edges are this thin
// blade"), and the wheels sank through what was drawn, the gap between drawn and physics ("look how the car falls through visible geometry"; 21:58: "we need to
// somehow revert back to what we had originally with the apron"). What stays of D593 here is the look he asked for: the apron's material (`t180b_apron`, the
// one every apron node has always had) is now THE ROAD'S OWN ASPHALT A LITTLE DARKER (the user, 18:0x, the road's own asphalt darker; 18:17, "not so dark...
// slightly darker"): a copy of the road material the first apron sits on, its samplers (so its texture) the same and its ambient, diffuse and specular LIP_SHADE of
// the road's, under the apron's own name, so every apron node keeps its material index and name byte for byte. Its uvs are the plank's own, as they were (a tile
// of APRON_TILE_M). With no road material, it is the plain dark one it was.
//
// WHERE: every core road cell's two sides, EXCEPT
//   a closed ring (a tube swept to 360: underskin.js ringCells; it has no edge); a seam row (its zipper is not a grid; the strips either side meet at the joint, the cells'
//   edge rows being the piece ends'); a WALL side (its last segment rises WALL_DEG or more above the road's lateral in any row of the cell: a cup or edge standing up as a
//   wall the car rides, not an edge it drops off); and the PIT LANE's side over the lane's span (`lane`: { side 'L' or 'R', s0, s1, mesh? }, the leave and the rejoin in the
//   main road's s, widened PIT_PAD_M each way), where the lane and its infill join the road and the edge is not open. Given the lane's own mesh (`lane.mesh`, laneForExport's),
//   that stretch is ONE OUTLINE instead (outlineRows, D593): the road's edge to the leave, round the lane's first row, along its outer edge, round its last row and back
//   to the road's edge, with an apron (the drawn physics plank and its join) all the way, so it neither stops square at the span nor leaves the lane's own edges bare. A side whose edge
//   zone turns down (e < 0) is open and its apron starts at the zone's outer row, which is the mesh's last column. Flights (jump segments) have no cells and no apron.
//   The mesh's column 0 is the road's right (−u) and column K − 1 its left (+u, the frame's L).
'use strict';
const { UNDERSKIN_OFFSET_M, ringCells } = require('./underskin.js');
const { gripKey } = require('./gripkeys.js');

const APRON_WIDTH_M = 2.0;     // the default: one measured excursion reached 0.86 m past the edge (p-d563), and 2 m covers it with room
const APRON_SLOPE_DEG = 25;    // down from the road's lateral: 20° sits above a dropping wheel only for the first half metre, 30° starts to read as a wall
const WALL_DEG = 60;           // a side rising this steeply or more is a wall, and gets no apron
const APRON_TILE_M = 4;        // the uv tile, in metres
const PIT_PAD_M = 5;           // each way past the pit lane's leave and rejoin
const APRON_TAG = 'APRON', SIDE_PREFIX = 'APRONSIDE';
const LIP_SHADE = 0.88;         // the drawn edge's share of its road material's light (ambient, diffuse, specular): the road's own texture a little darker, lit and shadowed by
                               // the game as the road is (the user, 18:17: "perhaps slightly darker, not like crazy dark"; it was 0.45, "not so dark")
/** The road material `m` in the drawn edge's darker shade (the name kept from the lip it was first made for): its name with _lipshade, its samplers as they are, ksAmbient, ksDiffuse and ksSpecular times LIP_SHADE. */
const shadeOf = (m) => ({ ...m, name: `${m.name}_lipshade`, props: m.props.map((p) => (/^ks(Ambient|Diffuse|Specular)$/.test(p.name) ? { ...p, value: p.value.map((v) => v * LIP_SHADE) } : p)) });

/** The apron's material: the road material `road` in its darker shade (shadeOf), under the apron's own name; with none, the plain dark one it was. */
const apronMaterial = (road) => (road ? { ...shadeOf(road), name: 't180b_apron' } : {
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
 * skinOf writes there); rim the side's last segment's angle above X, in degrees. For the drawn edge (D593; D and Dn were the lip's): D that segment's direction in the section (cos rim·X + sin rim·N)
 * and Dn the direction under it (sin rim·X − cos rim·N: −N on a flat edge); uv the edge vertex's own uv and du the road's u per metre outward across that last segment (no
 * `m.uvs`: uv null). The physics apron reads only E, X, N, NE and rim, computed as before.
 */
function sideRows(m, K, side) {
  const P = m.positions, Nn = m.normals, U = m.uvs, R = P.length / 3 / K, ic = Math.floor(K / 2), i0 = side === 0 ? 0 : K - 1, i1 = side === 0 ? 1 : K - 2, rows = [];
  const at = (A, r, k) => [A[(r * K + k) * 3], A[(r * K + k) * 3 + 1], A[(r * K + k) * 3 + 2]];
  for (let r = 0; r < R; r++) {
    const E = at(P, r, i0), C = at(P, r, ic), N = unit(at(Nn, r, ic)), lat = sub(E, C), X = unit(sub(lat, mul(N, dot(lat, N)))), d = sub(E, at(P, r, i1));
    const rimRad = Math.atan2(dot(d, N), dot(d, X)), cr = Math.cos(rimRad), sr = Math.sin(rimRad), seg = len(d);
    const uv = U ? [U[(r * K + i0) * 2], U[(r * K + i0) * 2 + 1]] : null, du = U && seg > 0 ? (U[(r * K + i0) * 2] - U[(r * K + i1) * 2]) / seg : 0;
    rows.push({ E, X, N, NE: at(Nn, r, i0), rim: (Math.atan2(dot(d, N), dot(d, X)) * 180) / Math.PI, D: add(mul(X, cr), mul(N, sr)), Dn: sub(mul(X, sr), mul(N, cr)), uv, du });
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

/**
 * A grid of rows of C columns, V[r][c] with normals Nv[r][c] and uvs UV[r][c]: each triangle wound so its normal agrees with its own vertices' normals (the side the
 * surface faces). A quad whose two rows both have zero width (`flat[r]`: the outline's corner tips) is left out, and so is a triangle of no area (a fan's rows share
 * their edge point).
 */
function grid(name, V, Nv, UV, flat) {
  const R = V.length, C = V[0].length, P = [], Ns = [], Us = [], idx = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { P.push(V[r][c]); Ns.push(Nv[r][c]); Us.push(UV[r][c]); }
  for (let r = 0; r + 1 < R; r++) {
    if (flat[r] && flat[r + 1]) continue;
    for (let c = 0; c + 1 < C; c++) {
      const a = r * C + c, b = a + 1, d = a + C, e = d + 1;
      for (const [x, y, z] of [[a, b, d], [b, e, d]]) {
        const n = cross(sub(P[y], P[x]), sub(P[z], P[x]));
        if (!(len(n) > 1e-12)) continue;
        if (dot(n, add(add(Ns[x], Ns[y]), Ns[z])) >= 0) idx.push(x, y, z); else idx.push(x, z, y);
      }
    }
  }
  if (P.length > 65535) throw new Error(`withApron: ${name} has ${P.length} vertices, past a kn5 mesh's 16-bit indices`);
  const positions = new Float32Array(P.length * 3), normals = new Float32Array(P.length * 3), uvs = new Float32Array(P.length * 2);
  P.forEach((p, i) => { positions.set(p, i * 3); normals.set(Ns[i], i * 3); uvs.set(Us[i], i * 2); });
  return { type: 'mesh', name, material: -1, castShadows: true, visible: true, transparent: false, renderable: true, positions, normals, uvs, indices: Uint16Array.from(idx) };
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

// cell-local to world: a row vector times the cell's matrix (mesh.js matrixOf: L, U, T, origin; translation at 12–14), and the same rotation for a direction
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const toWorld = (M, p) => [0, 1, 2].map((j) => p[0] * M[j] + p[1] * M[4 + j] + p[2] * M[8 + j] + M[12 + j]);
const turnWorld = (M, v) => [0, 1, 2].map((j) => v[0] * M[j] + v[1] * M[4 + j] + v[2] * M[8 + j]);
const rowsWorld = (rows, M) => rows.map((q) => ({ ...q, E: toWorld(M, q.E), X: turnWorld(M, q.X), N: turnWorld(M, q.N), NE: turnWorld(M, q.NE), D: turnWorld(M, q.D), Dn: turnWorld(M, q.Dn) }));
/**
 * THE PIT LANE'S OUTLINE (the user, 2026-10-31 17:18: "what about the pit lane included into the apron generation and track all at once"; 18:11: "I want it to look
 * exactly how it does on the rest of the track like the pit IS the track"). The lane grows out of the road (src/geom/pitlane.js: its width eases from TAPER_MIN_W at
 * the leave to full over the diverge, and back over the merge), so its outer edge leaves the road's edge tangentially and the open edge over the lane's span is ONE
 * line: the road's edge up to the leave, the lane's outer edge, and the road's edge from the rejoin. The apron runs along it like any other edge, one row per edge
 * vertex, every row widthM: there are no corners to turn. (A first form went round a lane that began square at full width, with fans at its corners: the user,
 * 18:02, "the pit implementation looks like garbage straight up".)
 *   - the road's rows are those of the cells withApron leaves to it (the ones the padded span touches) up to the leave and from the rejoin, so the outline starts on
 *     the last row of the main apron before it and ends on the first after it;
 *   - the lane's rows are its own grid cells' OUTER side (`laneMesh`: laneForExport's mesh, its cells, _state and cell matrices): of its first row's two end columns,
 *     the one farther from the road's edge at the leave.
 * Returns the rows in order (sideRows' shape, in world space), or null when the lane has no grid cell.
 */
// two outline rows within SAME_M are one point: the lane's cells repeat their boundary row, and the two cells' transforms put the copies 1-3 µm apart in float32, past
// a 1e-6 test (a drawn cell of no width between them: 4 slivers on the pit test lap)
const SAME_M = 1e-4;
function outlineRows(mainRows, laneMesh, lane) {
  const cells = laneMesh.cells.map((cell, k) => ({ cell, k })).filter(({ cell }) => !cell.seam && laneMesh._state.pieces[cell.piece]);
  if (!cells.length) return null;
  const nodeOf = (k) => laneMesh.scene.root.children[k], meshOf = (k) => nodeOf(k).children[0];
  const before = mainRows.filter((q) => q.s <= lane.s0), after = mainRows.filter((q) => q.s >= lane.s1);
  const k0 = cells[0].k, K0 = laneMesh._state.pieces[cells[0].cell.piece].K, M0 = nodeOf(k0).matrix, P0 = meshOf(k0).positions;
  const firstRow = Array.from({ length: K0 }, (_, c) => toWorld(M0, [P0[c * 3], P0[c * 3 + 1], P0[c * 3 + 2]]));
  const corner = before.length ? before[before.length - 1].E : firstRow[0];
  const outer = len(sub(firstRow[K0 - 1], corner)) > len(sub(firstRow[0], corner)) ? 'last' : 'first';
  const laneRows = [];
  for (const { cell, k } of cells) {
    const K = laneMesh._state.pieces[cell.piece].K;
    for (const q of rowsWorld(sideRows(meshOf(k), K, outer === 'last' ? K - 1 : 0), nodeOf(k).matrix)) if (!laneRows.length || len(sub(q.E, laneRows[laneRows.length - 1].E)) > SAME_M) laneRows.push(q);
  }
  // the lane's FIRST and LAST rows (TAPER_MIN_W across), vertex by vertex, inner to outer and back: each a row of the strip pointing out as the lane's edge row
  // beside it does, so the strip's inner edge IS those rows' edges (a strip that crossed one in a single step left its edges open with apron beside them, which
  // the downforce-ray check read as gaps at the leave and the rejoin)
  const endRow = (kc, first, like) => {
    const K = laneMesh._state.pieces[laneMesh.cells[kc].piece].K, M = nodeOf(kc).matrix, m = meshOf(kc), R = m.positions.length / 3 / K, r = first ? 0 : R - 1, cols = Array.from({ length: K }, (_, c) => c);
    if (outer === 'first') cols.reverse();   // inner to outer
    return cols.map((c) => { const i = r * K + c; return { ...like, end: true, E: toWorld(M, [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]), NE: turnWorld(M, [m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]]), uv: m.uvs ? [m.uvs[i * 2], m.uvs[i * 2 + 1]] : null, du: 0 }; });
  };
  const rows = [];
  // a row on the same point as the last replaces it when the last is an end-row vertex and this one is not: the drawn edge (which skips end rows) keeps its row
  const push = (q) => { const last = rows[rows.length - 1]; if (!last || len(sub(q.E, last.E)) > SAME_M) rows.push(q); else if (last.end && !q.end) rows[rows.length - 1] = q; };
  before.forEach(push);
  endRow(cells[0].k, true, laneRows[0]).forEach(push);
  laneRows.forEach((q) => push({ ...q, lane: true }));
  endRow(cells[cells.length - 1].k, false, laneRows[laneRows.length - 1]).reverse().forEach(push);
  after.forEach(push);
  return rows;
}

/**
 * The outline's PHYSICS (apronOf's rule on every row: out along X, down along N by widthM·tan slope; two vertices a row, its top facing along N) and its JOIN (apronOf's
 * too: from the outer row back to the skin's edge vertex, E − UNDERSKIN_OFFSET_M·NE, each normal turned away from the section's inside): { physics, side }. Both are
 * drawn as they are. The lane's end rows (`end`) are walked like every other row, so the plank and its join go round the lane's ends as one strip (fanned: the
 * across runs below).
 */
function outlineMeshes(rows, widthM, slopeDeg, names) {
  const tan = Math.tan((slopeDeg * Math.PI) / 180), V = [], Nv = [], UV = [], J = [], Nj = [], UVj = [];
  // ACROSS RUNS: at the leave and the rejoin the outline walks the lane's end row, TAPER_MIN_W across in K − 1 steps along the rows' own X, all at one s, so those
  // cells lie in one plane with the section. Each with its own outer point, the plank there was a run of slivers (2 m long, 1.25 cm apart: 64 on the pit test lap)
  // and its plank and join bands overlapped (3); with the end row cut to its two ends, the lane's end edge met the plank's in a T and the downforce ray fell
  // through the seam. So every row of an across run takes the LANE row's outer point: its plank cells fan out from it to the end row's own vertices, and its join
  // cells fan back from it to the skin's, in separate directions, watertight on the lane's edge
  const Os = rows.map((q) => add(add(q.E, mul(q.X, widthM)), mul(q.N, -widthM * tan)));
  const across = (r) => { const d = sub(rows[r + 1].E, rows[r].E), l = len(d); return l > 0 && l < 0.5 && Math.abs(dot(d, rows[r].X)) > 0.7 * l; };
  for (let r = 0; r + 1 < rows.length; r++) {
    if (!across(r)) continue;
    let j = r; while (j + 1 < rows.length - 1 && across(j + 1)) j++;
    const run = []; for (let i = r; i <= j + 1; i++) run.push(i);
    const k = run.find((i) => rows[i].lane);
    if (k !== undefined) for (const i of run) Os[i] = Os[k];
    r = j;
  }
  let along = 0;
  rows.forEach((q, r) => {
    if (r > 0) along += len(sub(q.E, rows[r - 1].E));
    const O = Os[r], T = sub((rows[r + 1] || q).E, (rows[r - 1] || q).E);
    let n = len(T) > 1e-9 ? unit(cross(unit(T), unit(sub(O, q.E)))) : q.N; if (dot(n, q.N) < 0) n = mul(n, -1);
    V.push([q.E, O]); Nv.push([n, n]); UV.push([[0, along / APRON_TILE_M], [widthM / APRON_TILE_M, along / APRON_TILE_M]]);
    const S = sub(q.E, mul(q.NE, UNDERSKIN_OFFSET_M)), G = mul(add(add(q.E, O), S), 1 / 3), mid = mul(add(O, S), 0.5);
    let nj = len(T) > 1e-9 ? unit(cross(unit(T), unit(sub(S, O)))) : mul(q.N, -1); if (dot(nj, sub(mid, G)) < 0) nj = mul(nj, -1);
    J.push([O, S]); Nj.push([nj, nj]); UVj.push([[0, along / APRON_TILE_M], [len(sub(S, O)) / APRON_TILE_M, along / APRON_TILE_M]]);
  });
  return { physics: grid(names.physics, V, Nv, UV, rows.map(() => false)), side: grid(names.side, J, Nj, UVj, rows.map(() => false)) };
}

/**
 * THE UNDERSIDE UNDER THE LANE (the user, 18:13, on the pit leave from below: "smooth in red before but then in after orange there is a big gap"): the lane's cells
 * and the infill get a skin as the road's cells have (UNDERSKIN_OFFSET_M along the surface's normal, away from the driver, wound the other way), so from below road,
 * infill and lane are one surface.
 * ONE NORMAL AT EVERY JOIN. Where road, infill and lane meet (the road's edge beside the lane, the lane's inner edge, every infill vertex: each IS a road or a lane
 * vertex, src/export/pitlane.js infill), each surface's own normal differs (the road's edge is cupped, the lane level), and skins hung along different normals from one
 * crease CROSS below it: a first form did, 49 times on his ELYSIUM, the road's skin (hung along the cupped edge's own normal, 13 cm outward) through the lane's. The
 * lane lies level in the road's own frame (src/geom/pitlane.js), so its normal is the road frame's UP; every skin at a join vertex (every infill vertex: on the road's
 * side, the road cell's frame up; on the lane's side, the lane's own normal) hangs along that (`joinNormal`), the road's skin edge inside the lane's span is hung
 * again along it (its own `SKIN_` node replaced, its other vertices as they were), and the apron outline's join ends there too. (A second form took the mean
 * of the road's and the lane's normals, only where a point was both a road and a lane vertex: the infill joins them at different points, so it reached almost none.)
 * Elsewhere each keeps its own normal, as underskin.js's skinOf does.
 * Returns { add: the lane's and the infill's skin nodes, replace: Map(scene child index -> the road skin node hung again), joinNormal(p) -> the normal at a join
 * point, or null where p is not one }. A vertex of the infill that is neither a road nor a lane vertex is refused, by name.
 */
function pitSkins(scene, mesh, laneMesh, lane, skinMat) {
  // the road's and the lane's vertices, each in 1 cm buckets; a point is found by the nearest within OWNER_M, the neighbouring buckets searched too (a rounded key alone
  // misses a vertex whose two transforms differ in the last float across a bucket's boundary, as raygap.js's weld once did)
  const OWNER_M = 2e-3, B = 0.01, cellOf = (p) => p.map((x) => Math.floor(x / B));
  const index = () => new Map(), roadIx = index(), laneIx = index();
  const own = (ix, m, M) => { const up = unit(turnWorld(M, [0, 1, 0])); for (let i = 0; i < m.positions.length / 3; i++) { const p = toWorld(M, [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]), k = cellOf(p).join(','); let l = ix.get(k); if (!l) ix.set(k, (l = [])); l.push({ p, n: unit(turnWorld(M, [m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]])), up }); } };
  const entry = (ix, p) => { const c = cellOf(p); let best = null, bd = OWNER_M; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) for (const x of ix.get(`${c[0] + i},${c[1] + j},${c[2] + k}`) || []) { const d = len(sub(x.p, p)); if (d <= bd) { bd = d; best = x; } } return best; };
  const find = (ix, p) => { const e = entry(ix, p); return e ? e.n : null; };
  const near = [];
  mesh.cells.forEach((cell, k) => { if (cell.s1 >= lane.s0 - 10 && cell.s0 <= lane.s1 + 10) { const c = scene.root.children[k]; own(roadIx, c.children[0], c.matrix); near.push(k); } });
  laneMesh.cells.forEach((cell, k) => { const c = laneMesh.scene.root.children[k]; own(laneIx, c.children[0], c.matrix); });
  const fillNode = laneMesh.scene.root.children.slice(laneMesh.cells.length).find((c) => c.children && c.children[0] && /^1ROAD_PIT_fill/.test(c.children[0].name)), fillIx = index();
  if (fillNode) own(fillIx, fillNode.children[0], fillNode.matrix);
  // a JOIN point is an infill vertex; its skin hangs along the road cell's frame up where it is a road vertex, else along the lane's own normal
  const joinNormal = (p) => { if (!entry(fillIx, p)) return null; const r = entry(roadIx, p); if (r) return r.up; return find(laneIx, p); };
  const skinNormal = (p, own_) => joinNormal(p) || own_;
  // a world point and normal into a cell's own frame (the matrix is a rotation and a translation: its transpose undoes the rotation)
  const toLocal = (M, p) => { const d = [p[0] - M[12], p[1] - M[13], p[2] - M[14]]; return [0, 1, 2].map((i) => d[0] * M[4 * i] + d[1] * M[4 * i + 1] + d[2] * M[4 * i + 2]); };
  const turnLocal = (M, v) => [0, 1, 2].map((i) => v[0] * M[4 * i] + v[1] * M[4 * i + 1] + v[2] * M[4 * i + 2]);
  const add_ = [], replace = new Map();
  // the lane's cells: every vertex hung along its skin normal, the triangles wound the other way
  laneMesh.cells.forEach((cell, k) => {
    const c = laneMesh.scene.root.children[k], m = c.children[0], M = c.matrix, n = m.positions.length / 3, P = new Float32Array(n * 3), N = new Float32Array(n * 3), I = new Uint16Array(m.indices.length);
    for (let i = 0; i < n; i++) {
      const p = toWorld(M, [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]), nw = skinNormal(p, unit(turnWorld(M, [m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]])));
      P.set(toLocal(M, sub(p, mul(nw, UNDERSKIN_OFFSET_M))), i * 3); N.set(turnLocal(M, mul(nw, -1)), i * 3);
    }
    for (let t = 0; t < m.indices.length; t += 3) { I[t] = m.indices[t]; I[t + 1] = m.indices[t + 2]; I[t + 2] = m.indices[t + 1]; }
    add_.push({ type: 'dummy', name: c.name.replace(/^CELL_/, 'SKIN_'), matrix: M, children: [{ type: 'mesh', name: m.name.replace(/^1ROAD/, 'UNDERSKIN'), material: skinMat, castShadows: true, visible: true, transparent: false, renderable: true, positions: P, normals: N, uvs: m.uvs, indices: I }] });
  });
  // the infill: its own triangles, every vertex a join vertex (or, refused, none)
  if (fillNode) {
    const f = fillNode.children[0], P = new Float32Array(f.positions.length), N = new Float32Array(f.normals.length), I = new Uint16Array(f.indices.length);
    for (let i = 0; i < f.positions.length / 3; i++) {
      const p = toWorld(fillNode.matrix, [f.positions[i * 3], f.positions[i * 3 + 1], f.positions[i * 3 + 2]]), nw = joinNormal(p);
      if (!nw) throw new Error(`withApron: the pit lane's infill vertex at ${p.map((x) => x.toFixed(3)).join(', ')} is neither a road nor a lane vertex, so its skin has no normal to take`);
      for (let a = 0; a < 3; a++) { P[i * 3 + a] = p[a] - UNDERSKIN_OFFSET_M * nw[a]; N[i * 3 + a] = -nw[a]; }
    }
    for (let t = 0; t < f.indices.length; t += 3) { I[t] = f.indices[t]; I[t + 1] = f.indices[t + 2]; I[t + 2] = f.indices[t + 1]; }
    add_.push({ type: 'dummy', name: 'SKIN_PIT_fill_0', matrix: IDENTITY.slice(), children: [{ type: 'mesh', name: 'UNDERSKIN_PIT_fill_0', material: skinMat, castShadows: true, visible: true, transparent: false, renderable: true, positions: P, normals: N, uvs: f.uvs, indices: I }] });
  }
  // the road's own skin beside the lane: a vertex whose road vertex is a join vertex is hung again along the join's normal (each skin vertex is its road vertex
  // − UNDERSKIN_OFFSET_M·N with its normal −N, underskin.js skinOf, so the road vertex is the skin vertex − UNDERSKIN_OFFSET_M·(its normal))
  const skins = new Map(); scene.root.children.forEach((c, i) => { if (/^SKIN_/.test(c.name)) skins.set(c.matrix, i); });
  for (const k of near) {
    const cellNode = scene.root.children[k], si = skins.get(cellNode.matrix); if (si === undefined) continue;
    const sn = scene.root.children[si], sm = sn.children[0], M = sn.matrix; let P = null, N = null;
    for (let i = 0; i < sm.positions.length / 3; i++) {
      const pl = [sm.positions[i * 3], sm.positions[i * 3 + 1], sm.positions[i * 3 + 2]], nl = [sm.normals[i * 3], sm.normals[i * 3 + 1], sm.normals[i * 3 + 2]];
      const E = toWorld(M, sub(pl, mul(nl, UNDERSKIN_OFFSET_M))), nj = joinNormal(E); if (!nj) continue;
      if (!P) { P = Float32Array.from(sm.positions); N = Float32Array.from(sm.normals); }
      P.set(toLocal(M, sub(E, mul(nj, UNDERSKIN_OFFSET_M))), i * 3); N.set(turnLocal(M, mul(nj, -1)), i * 3);
    }
    if (P) replace.set(si, { ...sn, children: [{ ...sm, positions: P, normals: N }] });
  }
  return { add: add_, replace, joinNormal };
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
  let roadMat = null;   // the road material the first apron sits on: the apron's material is its darker shade (apronMaterial)
  let replaced = null;   // the road's own skin nodes beside the pit lane, hung again along the joins' normals (pitSkins)
  const toOutline = [];   // the road rows of the cells the lane's padded span touches, on its side: they are the pit lane outline's (outlineRows), in world space
  for (const k of [...chosen].sort((a, b) => a - b)) {
    const c = kids[k], m = c && c.children && c.children[0], o = orig[k] && orig[k].children[0];
    // the scene's cell may carry its piece's grip prefix (gripkeys.js renames 1ROAD_ to 1GRIPnnn_); the rest of its name is the mesh's own
    if (!m || !o || !PREFIX_RE.test(m.name) || m.name.replace(PREFIX_RE, '') !== o.name.replace(PREFIX_RE, '')) throw new Error(`withApron: scene node ${k} is not the mesh's cell ${k} (${m && m.name} against ${o && o.name})`);
    // the cell's own surface, by gripkeys.js's rule (1GRIPnnn_ for a piece whose grip is not 100, else 1ROAD_): computed here, so the apron can run BEFORE the catch and the
    // grip keys (which rename only the road cells, by index) and the catch stays the last thing appended, its material last
    const seg = segments[mesh.cells[k].piece], key = seg && seg.grip !== undefined ? gripKey(seg.grip) : null;
    const K = mesh._state.pieces[mesh.cells[k].piece].K, prefix = key ? `1${key}_` : '1ROAD_', rest = m.name.replace(PREFIX_RE, '');
    for (const [side, tag] of [[0, 'R'], [K - 1, 'L']]) {
      if (lane && lane.side === tag && inLaneSpan(mesh.cells[k], lane)) {
        if (lane.mesh && widthM > 0 && K >= 3) {
          const rows = sideRows(m, K, side), cell = mesh.cells[k], R = rows.length;
          if (!rows.some((q) => q.rim >= WALL_DEG)) {
            rowsWorld(rows, c.matrix).forEach((q, r) => { const s = cell.s0 + (R > 1 ? (cell.s1 - cell.s0) * r / (R - 1) : 0); if (!toOutline.length || len(sub(q.E, toOutline[toOutline.length - 1].E)) > 1e-6) toOutline.push({ ...q, s }); });
            if (roadMat === null) roadMat = m.material;
          }
        }
        continue;
      }
      const ap = apronOf(m, K, side, { widthM, slopeDeg }, { top: `${prefix}${APRON_TAG}_${rest}_${tag}`, side: `${SIDE_PREFIX}_${rest}_${tag}` });
      if (!ap) continue;
      if (roadMat === null) roadMat = m.material;
      // the plank and its join, DRAWN as they are (0.4.34's apron, the physics the user drove), on the apron's material; at width 0 the side face alone
      for (const [mm, dn] of [[ap.top, `APRON${tag}_`], [ap.side, `APRONSIDE${tag}_`]]) {
        if (!mm) continue;
        const { physics, ...node } = mm; void physics; node.material = matIndex;
        add.push({ type: 'dummy', name: c.name.replace(/^CELL_/, dn), matrix: c.matrix, children: [node] });
      }
    }
  }
  // THE PIT LANE'S OUTLINE: new physics where there was none (the road's edge either side of the lane and the lane's outer edge), drawn like the rest, and its join;
  // and the skin under the lane and the infill, so from below road and lane are one surface
  if (lane && lane.mesh && widthM > 0) {
    const skinMat = materials.findIndex((x) => x && x.name === 't180b_underskin');
    if (skinMat < 0) throw new Error('withApron: the scene has no underside skin material (t180b_underskin), which the skin under the pit lane takes; run withUnderskin first');
    const ps = pitSkins(scene, mesh, lane.mesh, lane, skinMat);
    add.push(...ps.add); replaced = ps.replace;
    // the outline's rows at a join take the join's normal too, so its join ends where every other skin there does
    const ol0 = outlineRows(toOutline, lane.mesh, lane), ol = ol0 && ol0.map((q) => { const nj = ps.joinNormal(q.E); return nj ? { ...q, NE: nj } : q; });
    if (ol) {
      const tag = `PIT_${lane.side}`, name = (p) => `${p}_${tag}`;
      const out = outlineMeshes(ol, widthM, slopeDeg, { physics: `1ROAD_${APRON_TAG}_${tag}`, side: name(SIDE_PREFIX) });
      add.push({ type: 'dummy', name: name('APRON'), matrix: IDENTITY.slice(), children: [{ ...out.physics, material: matIndex }] });
      add.push({ type: 'dummy', name: name('APRONSIDE'), matrix: IDENTITY.slice(), children: [{ ...out.side, material: matIndex }] });
    }
  }
  if (!add.length) return scene;
  materials.push(apronMaterial(roadMat === null ? null : materials[roadMat]));
  return { ...scene, materials, root: { ...scene.root, children: [...(replaced && replaced.size ? kids.map((c, i) => replaced.get(i) || c) : kids), ...add] } };
}

module.exports = { LIP_SHADE, shadeOf, apronMaterial, withApron, apronOf, outlineRows, outlineMeshes, pitSkins, apronCells, sideRows, inLaneSpan, APRON_WIDTH_M, APRON_SLOPE_DEG, WALL_DEG, APRON_TILE_M, PIT_PAD_M, SIDE_PREFIX };
