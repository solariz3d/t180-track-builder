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
// and geometry look bad... underneath that side its like a flat surface because of the cupping x banking"; and 17:17, of the same export: "the sides work very well compared
// to hand made tracks for stopping wheel dropping off and clipping into the track". So the PHYSICS above is kept exactly (its vertices, names and material, byte for byte) and
// only HIDDEN (visible, renderable and castShadows off, as catch.js hides its catch surface), and what is drawn is a separate VISUAL lip on every side that has a physics
// apron (widthM > 0):
//   the LIP (`APRONLIP_<the cell's name>_L/R`, scenery: no physics prefix) leaves the road's edge row along the EDGE'S OWN LAST SEGMENT, not the frame's lateral, and rolls
//     down at a constant curvature to slopeDeg below that segment at its outer row, widthM along itself (APRON_COLS columns): on a cupped or banked edge it continues the
//     curl instead of sticking out of it as a plank. It carries its own cell's ROAD material and the road's uvs continued past the edge (v the edge vertex's, u on at the
//     road's rate across), and the road's own edge normal on its first column, so the texture and the shading run on over the edge;
//   the UNDERSIDE (`APRONSIDE_…`, scenery: it replaces the flat join that was the "flat surface" seen from below) follows the lip, from the skin's edge
//     vertex, with the skin's own normal there, to the lip's outer row.
//   BOTH IN THE ROAD'S OWN MATERIAL, DARKER (the user, 2026-10-31 18:0x: the road's own asphalt in a darker shade, as if in shadow): one copy of each road material
//     a lip sits on, its samplers (so its texture) the same and its ambient, diffuse and specular LIP_SHADE of the road's, appended after the apron's own material so
//     the physics' material index is the one it had. From above it reads as a thin dark line along the edge; up close, darker asphalt rolling over.
//   The visual lip is not the physics surface: 0.86 m out on a flat edge the lip is 0.08 m below the edge carried on and the physics apron 0.40 m below the lateral, so a
//   wheel that drops there is drawn into the lip by the difference (his eye in the game is the check).
//
// WHERE: every core road cell's two sides, EXCEPT
//   a closed ring (a tube swept to 360: underskin.js ringCells; it has no edge); a seam row (its zipper is not a grid; the strips either side meet at the joint, the cells'
//   edge rows being the piece ends'); a WALL side (its last segment rises WALL_DEG or more above the road's lateral in any row of the cell: a cup or edge standing up as a
//   wall the car rides, not an edge it drops off); and the PIT LANE's side over the lane's span (`lane`: { side 'L' or 'R', s0, s1, mesh? }, the leave and the rejoin in the
//   main road's s, widened PIT_PAD_M each way), where the lane and its infill join the road and the edge is not open. Given the lane's own mesh (`lane.mesh`, laneForExport's),
//   that stretch is ONE OUTLINE instead (outlineRows, D593): the road's edge to the leave, round the lane's first row, along its outer edge, round its last row and back
//   to the road's edge, with an apron (hidden physics, drawn lip) all the way, so it neither stops square at the span nor leaves the lane's own edges bare. A side whose edge
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
const APRON_COLS = 6;          // the visual lip's columns across (a 2 m lip: one every 0.33 m, each turning about 4°)
const APRON_TAG = 'APRON', SIDE_PREFIX = 'APRONSIDE', LIP_PREFIX = 'APRONLIP';
const LIP_SHADE = 0.45;         // the lip's share of its road material's light (ambient, diffuse, specular): the road's own texture, darker, as if in shadow
/** The road material `m` in the lip's darker shade: its name with _lipshade, its samplers as they are, ksAmbient, ksDiffuse and ksSpecular times LIP_SHADE. */
const shadeOf = (m) => ({ ...m, name: `${m.name}_lipshade`, props: m.props.map((p) => (/^ks(Ambient|Diffuse|Specular)$/.test(p.name) ? { ...p, value: p.value.map((v) => v * LIP_SHADE) } : p)) });

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
 * skinOf writes there); rim the side's last segment's angle above X, in degrees. For the visual lip (D593): D that segment's direction in the section (cos rim·X + sin rim·N)
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

/**
 * The VISUAL lip over a run of edge rows (sideRows' shape: E, D, Dn, NE, uv, du), each row w[r] wide: { lip, under }. `names`: { lip, under }.
 * In the section, from the edge E along D, turning toward Dn at a constant rate: at column c the turn is φ = θ·c/C and the point E + (w/θ)·(D sin φ + Dn (1 − cos φ)), a circular
 * arc of length w that leaves along the road's last segment and has rolled θ below it at its outer row. Its upward normal is up = D sin φ − Dn cos φ (−Dn at the edge: N on a
 * flat one). The underside is the arc moved along −up by a thickness from UNDERSKIN_OFFSET_M at the edge to 0 at the outer row, plus `fix`, which puts its first column on
 * the skin's edge vertex S (E − UNDERSKIN_OFFSET_M·NE) and fades out the same way, so lip and underside meet at the outer row; its first column IS S, not a sum that rounds to it.
 */
function visualRows(rows, w, slopeDeg, names) {
  const th = (slopeDeg * Math.PI) / 180, lip = [], under = [], nLip = [], nUnder = [], uvs = [];
  rows.forEach((q, r) => { const x = lipRow(q, w[r], th); lip.push(x.L); under.push(x.U); nLip.push(x.NL); nUnder.push(x.NU); uvs.push(x.UV); });
  const flat = w.map((x) => !(x > 0));
  return { lip: grid(names.lip, lip, nLip, uvs, flat), under: grid(names.under, under, nUnder, uvs, flat) };
}

/** One row of the visual lip, w wide, rolled th radians (visualRows above): its APRON_COLS + 1 lip points L and underside points U, their normals NL and NU, and uvs UV. */
function lipRow(q, w, th) {
  const C = APRON_COLS, S = sub(q.E, mul(q.NE, UNDERSKIN_OFFSET_M)), fix = sub(S, add(q.E, mul(q.Dn, UNDERSKIN_OFFSET_M))), L = [], U = [], NL = [], NU = [], UV = [];
  for (let c = 0; c <= C; c++) {
    const phi = th * c / C, k = c / C, along = th > 0 ? w / th : 0;
    const p = th > 0 ? add(q.E, add(mul(q.D, along * Math.sin(phi)), mul(q.Dn, along * (1 - Math.cos(phi))))) : add(q.E, mul(q.D, w * k));
    const up = sub(mul(q.D, Math.sin(phi)), mul(q.Dn, Math.cos(phi)));
    L.push(p); U.push(c === 0 ? S : add(add(p, mul(up, -UNDERSKIN_OFFSET_M * (1 - k))), mul(fix, 1 - k)));
    NL.push(c === 0 ? q.NE : up); NU.push(c === 0 ? mul(q.NE, -1) : mul(up, -1));   // at the edge: the road's own normal on the lip, the skin's (its negation, skinOf) under it
    UV.push(q.uv ? [q.uv[0] + q.du * w * k, q.uv[1]] : [w * k / APRON_TILE_M, 0]);
  }
  return { L, U, NL, NU, UV };
}

/** The VISUAL lip of one side of one grid cell (D593): { lip, under }, every row widthM. Called only where apronOf gave that side a physics top (so not a wall side), and drawn over it. */
function visualOf(m, K, side, { widthM = APRON_WIDTH_M, slopeDeg = APRON_SLOPE_DEG } = {}, names) {
  if (!(K >= 3) || !(widthM > 0)) return null;
  const rows = sideRows(m, K, side);
  return visualRows(rows, rows.map(() => widthM), slopeDeg, names);
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
const FAN_STEPS = 6;   // rows round a convex corner of the outline (the lane's outer start and end), every 15° or so of a square turn

/**
 * THE PIT LANE'S OUTLINE (the user, 2026-10-31 17:18: "what about the pit lane included into the apron generation and track all at once"). Over the lane's span the road's
 * edge on its side is joined (the infill and the lane), and before this the main apron simply stopped PIT_PAD_M short of it, square, and the lane's own edges had none. The
 * open edge there is one outline: the road's edge up to the leave, the lane's FIRST ROW out to its outer edge (the lane leaves at full width, its inner edge on the road's
 * edge: src/geom/pitlane.js), the lane's OUTER EDGE, its LAST ROW back in, and the road's edge from the rejoin. One apron runs along all of it, in world space:
 *   - at the two CONCAVE corners (the road's edge meeting the lane's first or last row) the two sides would cross. Each runs at full width only to its last row widthM or
 *     more from the corner, both of those rows end at ONE point Q (the road side's outer row; the lane side's is set to it), and a FAN from Q covers every edge vertex
 *     nearer the corner than that, road and lane, the corner's two vertices included (the road's edge vertex and the lane's first inner one stand 2-9 cm apart: pitlane.js's
 *     infill). A first form cut both sides back to the corner's bisector instead; its two halves met along that line at different vertices, and the downforce-ray check
 *     read the line between them as six gaps (test/export_apron.test.js row 10). With the fan every edge there is shared, vertex for vertex;
 *   - at the two CONVEX corners (the lane's outer start and end) FAN_STEPS rows turn from one side's outward direction to the other's, all widthM;
 *   - the road's rows are those of the cells withApron leaves to it (the ones the padded span touches), so it starts on the last row of the main apron before it and ends
 *     on the first after it; the lane's rows are its own grid cells' outer side (`laneMesh`: laneForExport's mesh, its cells, _state and cell matrices).
 * Returns { A, B, C, P1, P2 } in world space, or null when the lane has no grid cell: A the road's rows before the leave and C after the rejoin, B the lane's (its first row
 * from widthM out, the convex fan, its outer edge, the other fan, its last row in to widthM), each a run of full-width rows (sideRows' shape); P1 and P2 the concave corners'
 * fans, each { inner: [points E, NE, uv in order from A's last row to B's first, or B's last to C's first] }.
 */
function outlineRows(mainRows, laneMesh, lane, widthM) {
  const cells = laneMesh.cells.map((cell, k) => ({ cell, k })).filter(({ cell }) => !cell.seam && laneMesh._state.pieces[cell.piece]);
  if (!cells.length) return null;
  const nodeOf = (k) => laneMesh.scene.root.children[k], meshOf = (k) => nodeOf(k).children[0];
  const before = mainRows.filter((q) => q.s <= lane.s0), after = mainRows.filter((q) => q.s >= lane.s1);
  // the lane's outer side: of its first row's two end columns, the one FARTHER from the road's edge at the leave (its inner edge lies on it)
  const k0 = cells[0].k, K0 = laneMesh._state.pieces[cells[0].cell.piece].K, M0 = nodeOf(k0).matrix, P0 = meshOf(k0).positions;
  const firstRow = Array.from({ length: K0 }, (_, c) => toWorld(M0, [P0[c * 3], P0[c * 3 + 1], P0[c * 3 + 2]]));
  const corner = before.length ? before[before.length - 1].E : firstRow[0];
  const outer = len(sub(firstRow[K0 - 1], corner)) > len(sub(firstRow[0], corner)) ? 'last' : 'first';
  const laneRows = [];
  for (const { cell, k } of cells) {
    const K = laneMesh._state.pieces[cell.piece].K, rows = rowsWorld(sideRows(meshOf(k), K, outer === 'last' ? K - 1 : 0), nodeOf(k).matrix);
    for (const q of rows) if (!laneRows.length || len(sub(q.E, laneRows[laneRows.length - 1].E)) > 1e-6) laneRows.push(q);
  }
  // the lane's first and last rows, inner to outer, with their own normals and uvs, in world space
  const endRow = (k, which) => {
    const K = laneMesh._state.pieces[laneMesh.cells[k].piece].K, M = nodeOf(k).matrix, m = meshOf(k), R = m.positions.length / 3 / K, r = which === 'first' ? 0 : R - 1;
    const pts = Array.from({ length: K }, (_, c) => { const i = r * K + c; return { E: toWorld(M, [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]), NE: turnWorld(M, [m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]]), uv: m.uvs ? [m.uvs[i * 2], m.uvs[i * 2 + 1]] : null }; });
    return outer === 'last' ? pts : pts.reverse();
  };
  const crossRow = (pts, along) => {   // a lane end row as edge rows: outward is along the lane (back at the leave, on at the rejoin), square to the row in its own plane
    const inner = pts[0].E, across = unit(sub(pts[pts.length - 1].E, inner));
    return pts.map((p) => { const N = unit(p.NE), o = unit(sub(sub(along, mul(across, dot(along, across))), mul(N, dot(along, N))));
      return { E: p.E, X: o, N, NE: p.NE, D: o, Dn: mul(N, -1), uv: p.uv, du: 0, d: len(sub(p.E, inner)) }; });
  };
  const first = laneRows[0], last = laneRows[laneRows.length - 1], kN = cells[cells.length - 1].k;
  const startRow = crossRow(endRow(k0, 'first'), mul(unit(sub(laneRows[Math.min(1, laneRows.length - 1)].E, first.E)), -1));
  const endRowR = crossRow(endRow(kN, 'last'), unit(sub(last.E, laneRows[Math.max(0, laneRows.length - 2)].E))).reverse();
  const fan = (at, from, to) => {   // rows at one point turning from one outward direction to another about its normal
    const a = Math.acos(Math.max(-1, Math.min(1, dot(from, to)))), out = [];
    for (let i = 1; i < FAN_STEPS; i++) {
      const t = i / FAN_STEPS, o = a > 1e-6 ? unit(add(mul(from, Math.sin((1 - t) * a) / Math.sin(a)), mul(to, Math.sin(t * a) / Math.sin(a)))) : from;
      out.push({ ...at, X: o, D: o, Dn: mul(at.N, -1), du: 0 });
    }
    return out;
  };
  const sOut = startRow[startRow.length - 1], eOut = endRowR[0];
  const A = before.filter((q) => lane.s0 - q.s >= widthM), C = after.filter((q) => q.s - lane.s1 >= widthM);
  const B = [...startRow.filter((q) => q.d >= widthM), ...fan({ ...sOut, N: first.N, NE: first.NE }, sOut.X, first.X), ...laneRows, ...fan({ ...eOut, N: last.N, NE: last.NE }, last.X, eOut.X), ...endRowR.filter((q) => q.d >= widthM)];
  const pt = (q) => ({ E: q.E, NE: q.NE, N: q.N, uv: q.uv });
  const P1 = { inner: [...(A.length ? [A[A.length - 1]] : []), ...before.filter((q) => lane.s0 - q.s < widthM), ...startRow.filter((q) => q.d < widthM), B[0]].map(pt) };
  const P2 = { inner: [B[B.length - 1], ...endRowR.filter((q) => q.d < widthM), ...after.filter((q) => q.s - lane.s1 < widthM), ...(C.length ? [C[0]] : [])].map(pt) };
  return { A, B, C, P1, P2 };
}

/** A mesh built triangle by triangle: v() adds a vertex and returns its index; tri() adds a triangle wound to face along `hint`, and drops one of no area. */
function meshAcc() {
  const P = [], N = [], U = [], I = [];
  return {
    v(p, n, uv) { P.push(p); N.push(n); U.push(uv || [0, 0]); return P.length - 1; },
    tri(a, b, c, hint) { const n = cross(sub(P[b], P[a]), sub(P[c], P[a])); if (!(len(n) > 1e-12)) return; if (dot(n, hint) >= 0) I.push(a, b, c); else I.push(a, c, b); },
    node(name) {
      if (P.length > 65535) throw new Error(`withApron: ${name} has ${P.length} vertices, past a kn5 mesh's 16-bit indices`);
      const positions = new Float32Array(P.length * 3), normals = new Float32Array(P.length * 3), uvs = new Float32Array(P.length * 2);
      P.forEach((p, i) => { positions.set(p, i * 3); normals.set(N[i], i * 3); uvs.set(U[i], i * 2); });
      return { type: 'mesh', name, material: -1, castShadows: true, visible: true, transparent: false, renderable: true, positions, normals, uvs, indices: Uint16Array.from(I) };
    },
    add(m) {   // another mesh's vertices and triangles, as they are
      const o = P.length;
      for (let i = 0; i < m.positions.length / 3; i++) { P.push([m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]); N.push([m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]]); U.push([m.uvs[i * 2], m.uvs[i * 2 + 1]]); }
      for (const x of m.indices) I.push(x + o);
    },
  };
}

/**
 * The outline's PHYSICS (apronOf's rule on every row: out along X, down along N by widthM·tan slope) and its VISUAL lip and underside (visualRows), as three meshes:
 * { physics, lip, under }. The concave corners' fans: the physics from Q (A's last outer point, or B's first where A is empty; B's first row takes it as its own) to every
 * inner point; the lip the same fan; the underside a fan from Q to the inner points' underside points (E − UNDERSKIN_OFFSET_M·NE).
 */
function outlineMeshes(ol, widthM, slopeDeg, names) {
  const tan = Math.tan((slopeDeg * Math.PI) / 180), Oof = (q) => add(add(q.E, mul(q.X, widthM)), mul(q.N, -widthM * tan));
  const { A, B, C, P1, P2 } = ol;
  const Q1 = A.length ? Oof(A[A.length - 1]) : Oof(B[0]), Q2 = C.length ? Oof(C[0]) : Oof(B[B.length - 1]);
  const phys = meshAcc(), lip = meshAcc(), under = meshAcc();
  const strip = (rows, firstO, lastO) => {   // two vertices a row, edge and outer; the run's first and last outer points may be given (the corners' Q)
    let prev = null, along = 0;
    rows.forEach((q, r) => {
      if (r > 0) along += len(sub(q.E, rows[r - 1].E));
      const O = r === 0 && firstO ? firstO : r === rows.length - 1 && lastO ? lastO : Oof(q), uvV = along / APRON_TILE_M;
      const e = phys.v(q.E, q.N, [0, uvV]), o = phys.v(O, q.N, [widthM / APRON_TILE_M, uvV]);
      if (prev) { phys.tri(prev.e, prev.o, e, q.N); phys.tri(prev.o, o, e, q.N); }
      prev = { e, o };
    });
  };
  strip(A, null, null); strip(B, Q1, Q2); strip(C, null, null);
  const visual = (rows) => { if (rows.length < 2) return; const v = visualRows(rows, rows.map(() => widthM), slopeDeg, { lip: 'x', under: 'x' }); lip.add(v.lip); under.add(v.under); };
  visual(A); visual(B); visual(C);
  // THE CONCAVE CORNERS. The physics: a fan from Q over the inner points. What is drawn: a fan from the outer point of the lip row the corner hangs from (A's last at the
  // leave, C's first at the rejoin, or B's when that side is empty) over the WHOLE curled rows either side and the inner points between, so it meets both lips along their
  // own rows. (A first form fanned the lip from the physics Q, 0.93 m down where the lips either side reach 0.43 m: it showed as a square tab at each corner.)
  const th = (slopeDeg * Math.PI) / 180, NC = APRON_COLS;
  for (const [P, Q, rowF, rowL, hangF] of [[P1, Q1, A.length ? A[A.length - 1] : null, B[0], A.length > 0], [P2, Q2, B[B.length - 1], C.length ? C[0] : null, !C.length]]) {
    const up = unit(P.inner.reduce((s, p) => add(s, p.N || unit(p.NE)), [0, 0, 0]));
    const qp = phys.v(Q, up, [widthM / APRON_TILE_M, 0]);
    let pp = null;
    for (const p of P.inner) {
      const now = phys.v(p.E, up, p.uv || [0, 0]);
      if (pp !== null) phys.tri(qp, pp, now, up);
      pp = now;
    }
    const hang = hangF ? rowF : rowL, rF = rowF ? lipRow(rowF, widthM, th) : null, rL = rowL ? lipRow(rowL, widthM, th) : null, rH = lipRow(hang, widthM, th);
    // the boundary round the fan, in order: rowF's curl from its outer row in to its edge (its edge is the first inner point), the inner points, rowL's curl out
    const ring = [];
    if (rF) for (let c = NC; c >= 1; c--) if (!(hang === rowF && c === NC)) ring.push({ l: rF.L[c], u: rF.U[c], nl: rF.NL[c], nu: rF.NU[c], uv: rF.UV[c] });
    for (const p of P.inner) ring.push({ l: p.E, u: sub(p.E, mul(p.NE, UNDERSKIN_OFFSET_M)), nl: p.NE, nu: mul(p.NE, -1), uv: p.uv || [0, 0] });
    if (rL) for (let c = 1; c <= NC; c++) if (!(hang === rowL && c === NC)) ring.push({ l: rL.L[c], u: rL.U[c], nl: rL.NL[c], nu: rL.NU[c], uv: rL.UV[c] });
    const ql = lip.v(rH.L[NC], rH.NL[NC], rH.UV[NC]), qu = under.v(rH.U[NC], rH.NU[NC], rH.UV[NC]);
    let prev = null;
    for (const x of ring) {
      const now = { l: lip.v(x.l, x.nl, x.uv), u: under.v(x.u, x.nu, x.uv) };
      if (prev) { lip.tri(ql, prev.l, now.l, up); under.tri(qu, prev.u, now.u, mul(up, -1)); }
      prev = now;
    }
  }
  return { physics: phys.node(names.physics), lip: lip.node(names.lip), under: under.node(names.under) };
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
  // the lip and its underside wear their road material's darker shade: one copy per road material, numbered after the apron's own (matIndex, pushed first at the end)
  const shades = new Map(), shaded = [], shadeIndex = (i) => { if (!shades.has(i)) { shades.set(i, matIndex + 1 + shaded.length); shaded.push(shadeOf(materials[i])); } return shades.get(i); };
  const toOutline = [];   // the road rows of the cells the lane's padded span touches, on its side: they are the pit lane outline's (outlineRows), in world space
  let outlineMat = null;
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
            if (outlineMat === null) outlineMat = m.material;
          }
        }
        continue;
      }
      const ap = apronOf(m, K, side, { widthM, slopeDeg }, { top: `${prefix}${APRON_TAG}_${rest}_${tag}`, side: `${SIDE_PREFIX}_${rest}_${tag}` });
      if (!ap) continue;
      if (!ap.top) {   // width 0: the side face, as it was
        const { physics, ...node } = ap.side; void physics; node.material = matIndex;
        add.push({ type: 'dummy', name: c.name.replace(/^CELL_/, `APRONSIDE${tag}_`), matrix: c.matrix, children: [node] });
        continue;
      }
      // THE PHYSICS, as it was (its vertices, name and material), HIDDEN: not drawn and casting no shadow (catch.js hides its catch surface the same way)
      { const { physics, ...node } = ap.top; void physics; node.material = matIndex; node.visible = false; node.renderable = false; node.castShadows = false;
        add.push({ type: 'dummy', name: c.name.replace(/^CELL_/, `APRON${tag}_`), matrix: c.matrix, children: [node] }); }
      // WHAT IS DRAWN: the visual lip and its underside (the flat join is not written)
      const vis = visualOf(m, K, side, { widthM, slopeDeg }, { lip: `${LIP_PREFIX}_${rest}_${tag}`, under: `${SIDE_PREFIX}_${rest}_${tag}` });
      add.push({ type: 'dummy', name: c.name.replace(/^CELL_/, `APRONLIP${tag}_`), matrix: c.matrix, children: [{ ...vis.lip, material: shadeIndex(m.material) }] });
      add.push({ type: 'dummy', name: c.name.replace(/^CELL_/, `APRONSIDE${tag}_`), matrix: c.matrix, children: [{ ...vis.under, material: shadeIndex(m.material) }] });
    }
  }
  // THE PIT LANE'S OUTLINE: new physics where there was none (the road's edge either side of the lane, the lane's ends and its outer edge), hidden like the rest, and its lip
  if (lane && lane.mesh && widthM > 0) {
    const ol = outlineRows(toOutline, lane.mesh, lane, widthM);
    if (ol) {
      const tag = `PIT_${lane.side}`, name = (p) => `${p}_${tag}`;
      const out = outlineMeshes(ol, widthM, slopeDeg, { physics: `1ROAD_${APRON_TAG}_${tag}`, lip: name(LIP_PREFIX), under: name(SIDE_PREFIX) });
      add.push({ type: 'dummy', name: name('APRON'), matrix: IDENTITY.slice(), children: [{ ...out.physics, material: matIndex, visible: false, renderable: false, castShadows: false }] });
      add.push({ type: 'dummy', name: name('APRONLIP'), matrix: IDENTITY.slice(), children: [{ ...out.lip, material: outlineMat === null ? matIndex : shadeIndex(outlineMat) }] });
      add.push({ type: 'dummy', name: name('APRONSIDE'), matrix: IDENTITY.slice(), children: [{ ...out.under, material: outlineMat === null ? matIndex : shadeIndex(outlineMat) }] });
    }
  }
  if (!add.length) return scene;
  materials.push(apronMaterial(), ...shaded);
  return { ...scene, materials, root: { ...scene.root, children: [...kids, ...add] } };
}

module.exports = { LIP_SHADE, shadeOf, withApron, apronOf, visualOf, visualRows, outlineRows, outlineMeshes, apronCells, sideRows, inLaneSpan, APRON_WIDTH_M, APRON_SLOPE_DEG, APRON_COLS, WALL_DEG, APRON_TILE_M, PIT_PAD_M, FAN_STEPS, SIDE_PREFIX, LIP_PREFIX };
