// underskin.js: the UNDERSIDE of an equation-core track is an object that casts shadows, and the inside of a closed tube is dark.
// The user, 02:22: "during day light leaks into the tube it should be inclosed and pitch black"; 02:25: "i guess we need to make it so the bottom side of the
// track is an object that casts shadows".
//
//   withUnderskin(scene, mesh, segments) -> scene      the export's scene with
//     1. an UNDERSIDE SKIN under EVERY core road cell: a second surface UNDERSKIN_OFFSET_M (0.93 m) along the road's own normal on the side AWAY from the driver
//        (below an open road; OUTWARD of a closed tube, whose normal faces in), normals facing away from the road, castShadows, its own plain dark material;
//     2. a DARK INTERIOR on the cells whose section is a CLOSED RING (a tube swept to 360, the same test as src/texture/flow.js): their material swapped for a
//        copy of itself with ksAmbient TUBE_RING_AMBIENT (0.02, from 0.45). Open roads, cups, edge curves and open tubes keep their light material.
//   the scene itself (the same object) when nothing is a core road cell: a word document's export is exactly what it was.
//
// WHY. A road is one single-sided, zero-thickness shell, so the sun's shadow pass sees only its top faces, and from the sun's side of a closed tube only its
// back faces: with the shadow bias a thin caster lets light through (inferred, not reproduced: the bands' striped edges in the screenshot read as shadow-map
// aliasing on a thin caster). A caster with THICKNESS is the usual cure on AC tracks. On a closed tube the underside skin IS the outside of the pipe wall, so the
// sun's shadow pass sees a surface facing it and everything inside is in its shadow; on an open road, a cup or a spiral it blocks light from below and the
// side, and the track is no longer see-through from underneath. One mechanism. The ambient term (0.45) lights the inside of a tube as brightly as an open road
// whatever the sun does, hence the low ambient on the ring's own material.
//
// THE SKIN IS NOT A PHYSICS SURFACE. Its meshes are named UNDERSKIN_…: no leading digit and no 1ROAD prefix, so AC reads them as scenery (a physics surface is a
// mesh named for a surfaces.ini key, `1ROAD…`; the soft-collision block is `MESHES=1ROAD?`), and the name never contains "seam" (acready.js weldSeams would take it
// for a zipper). Grip and collisions are the road cells', unchanged: the ROAD nodes of the scene are the ones mesh.js made (only a ring's material is the dark copy).
//
// THE SLOT ZONE (a tube closing or opening, where the section is not yet or no longer a ring): the skin runs under it like everywhere else (it is under every
// cell); the dark material only where the ring is closed, cell by cell (a cell is one 2 m chord segment, a seam row is a ring only when BOTH its segments are). At
// each end of a closed run the interior steps from dark to the road's own light over one cell.
//
// WHAT LIGHTS THE INSIDE AFTERWARDS: the ambient 0.02 (2% of the road's), whatever sun the shadow pass still lets in (ksDiffuse is as it was; nothing here proves the
// shadow holds in AC), the car's own lights if it has any, and CSP's if enabled. Whether a fully black interior needs more in AC or CSP is not settled here.
'use strict';
const { closedRing } = require('../texture/flow.js');
const { SLIVER } = require('./acready.js');

// how far the skin stands off the road surface, away from the driver (metres): the HULL's depth under the road (D604, the user 2026-11-01 08:49: "the track gets 3D
// depth instead of a slice of a mesh"; 10:44, his red line drawn on the end-on cut: the bottom one smooth curve from one apron plank's tip to the other's, about 1.5 m
// under the road at the centre, following the road's sag). It follows the road's own cross-section at this depth, not a chord, so in a cup it stays under the road (a
// chord across a 57° cup would cut up through it); apron.js runs it on out to each plank's tip in one smooth curve. It was 0.5 m, a skin for shadows only, then for an
// hour the plank's drop (0.93 m).
const UNDERSKIN_OFFSET_M = 1.5;
// WHICH WAY THE SKIN HANGS (D604 redo, the user 10:32: "the apron itself connects right to the other one without having an extra thicker bottom than we need"). A
// vertex hangs along its ROW's section up (the row's centre vertex normal, the very up apron.js drops the plank along), not its own normal: hung along its own, the edge
// of a cup or a bank hung outward of the edge, and the apron's join ran from the plank's tip back in to it, a second inverted apron seen from below. Along the section's
// up the edge's skin vertex is straight under the edge at the plank's drop, level with the plank's tip, so the join is the slab's bottom run on out to the tip and
// tip, underside and tip are one bottom. A vertex turned more than SECTION_UP_DEG from the section's up (a wall, a tube's side) blends to its own normal by
// OWN_NORMAL_DEG, so it keeps standing off the surface: straight down, the offset of a surface at angle a stands only D·cos a off it.
const SECTION_UP_DEG = 60, OWN_NORMAL_DEG = 80;
/** The unit direction a skin vertex hangs along (its skin vertex is p − UNDERSKIN_OFFSET_M·dir), from its own normal nv and its row's centre normal nc (neither need be unit). */
function skinDir(nv, nc) {
  const lv = Math.hypot(nv[0], nv[1], nv[2]), lc = Math.hypot(nc[0], nc[1], nc[2]);
  const v = [nv[0] / lv, nv[1] / lv, nv[2] / lv], c = [nc[0] / lc, nc[1] / lc, nc[2] / lc];
  const a = (Math.acos(Math.max(-1, Math.min(1, v[0] * c[0] + v[1] * c[1] + v[2] * c[2]))) * 180) / Math.PI;
  if (a <= SECTION_UP_DEG) return c;
  if (a >= OWN_NORMAL_DEG) return v;
  const t = (a - SECTION_UP_DEG) / (OWN_NORMAL_DEG - SECTION_UP_DEG), w = t * t * (3 - 2 * t), d = [c[0] + (v[0] - c[0]) * w, c[1] + (v[1] - c[1]) * w, c[2] + (v[2] - c[2]) * w];
  const ld = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / ld, d[1] / ld, d[2] / ld];
}
// THE HULL'S EDGE (D604, the user's red line, 10:44: one smooth curve from the plank's tip, down and in, into the road's sag). At one depth all across, the run from
// a plank's tip to the skin's edge under a rising edge (a bowl, a cup) is steeper at both its ends than the chord between them, so a smooth run there must make an S (a
// shoulder under the road's edge, measured on his ELYSIUM's flat station). So under an edge that rises the skin hangs DEEPER (hullDepth), as his line does, and eases
// back to UNDERSKIN_OFFSET_M over HULL_EDGE_SPAN_M in from the edge (C1): the chord from the tip is then steeper than the road at the edge and the run only flattens.
// The edge's depth is the default plank's drop plus its width times tan(rim + HULL_EDGE_LEAD_DEG), never under UNDERSKIN_OFFSET_M (a flat or turned-down edge keeps it)
// and never past HULL_EDGE_MAX_M (a steep cup, where the run keeps a slight S: said in the hand-back). A wall side (rim WALL_DEG or more) has no apron; its depth eases back to the
// plain one by HULL_EASE_DEG past it. A closed ring (it has no edge) keeps the plain depth.
const HULL_EDGE_SPAN_M = 4, HULL_EDGE_LEAD_DEG = 5, HULL_EDGE_MAX_M = 3, HULL_WALL_DEG = 60, HULL_EASE_DEG = 10;
const HULL_PLANK_W = 2.0, HULL_PLANK_DROP = 2.0 * Math.tan((25 * Math.PI) / 180);   // the default edge apron (apron.js APRON_WIDTH_M, APRON_SLOPE_DEG)
/** The skin's depth under a road edge whose last segment rises rimDeg above the section's lateral. */
function hullDepth(rimDeg) {
  if (!(rimDeg < HULL_WALL_DEG + HULL_EASE_DEG)) return UNDERSKIN_OFFSET_M;
  const deep = Math.min(HULL_EDGE_MAX_M, Math.max(UNDERSKIN_OFFSET_M, HULL_PLANK_DROP + HULL_PLANK_W * Math.tan(((rimDeg + HULL_EDGE_LEAD_DEG) * Math.PI) / 180)));
  // past the wall (no apron there) eased back to the plain depth over HULL_EASE_DEG, so an edge that steepens into a wall along the road does not step the skin by metres
  const w = Math.min(1, (HULL_WALL_DEG + HULL_EASE_DEG - rimDeg) / HULL_EASE_DEG), e = w * w * (3 - 2 * w);
  return UNDERSKIN_OFFSET_M + (deep - UNDERSKIN_OFFSET_M) * e;
}
/**
 * The section's up a skin vertex hangs by (skinDir's centre): the normal at the middle of a road row of K vertices from `base` in N. With K odd that is the middle
 * vertex's own (as it always was, untouched); with K even it is the mean of the middle two, normalised. It was the vertex at floor(K / 2), half a column off the
 * middle when K is even, so two rows at one station with K of either parity hung their skins differently in skinDir's blend: 19 mm apart across a 401 | 402
 * seam on a tube, a crack (the tube test, D604 follow-up)
 */
function sectionUp(N, base, K) {
  const at = (i) => [N[(base + i) * 3], N[(base + i) * 3 + 1], N[(base + i) * 3 + 2]];
  if (K % 2) return at((K - 1) / 2);
  const a = at(K / 2 - 1), b = at(K / 2), m = [a[0] + b[0], a[1] + b[1], a[2] + b[2]], l = Math.hypot(m[0], m[1], m[2]);
  return l > 0 ? [m[0] / l, m[1] / l, m[2] / l] : b;
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
/** One road row's two edges (K vertices from `base` in P, N; side 0 the first vertex, side 1 the last): [{ E, X, rim }] with rim in degrees, as apron.js sideRows reads it. */
function rowEdges(P, N, base, K) {
  const p = (k) => [P[(base + k) * 3], P[(base + k) * 3 + 1], P[(base + k) * 3 + 2]];
  const ic = Math.floor(K / 2), Cv = p(ic), Nc = unit3([N[(base + ic) * 3], N[(base + ic) * 3 + 1], N[(base + ic) * 3 + 2]]);
  return [[0, 1], [K - 1, K - 2]].map(([i0, i1]) => {
    const E = p(i0), lat = sub3(E, Cv), l = dot3(lat, Nc), X = unit3([lat[0] - Nc[0] * l, lat[1] - Nc[1] * l, lat[2] - Nc[2] * l]), d = sub3(E, p(i1));
    return { E, X, rim: (Math.atan2(dot3(d, Nc), dot3(d, X)) * 180) / Math.PI };
  });
}
/**
 * THE HULL EASED OUT WHERE THE APRON STOPS (D604 follow-up: the jag at a tube's opening). A side of a cell gets its apron only when no row of it is a wall (rim
 * HULL_WALL_DEG or more: apron.js apronOf, WALL_DEG) and it is not a closed ring; where a side has none, nothing closes the skin's deepened edge to the road, and at a
 * tube's opening the skin hung up to HULL_EDGE_MAX_M under an edge with no plank above it, a fin, and stepped by metres where the planks began. So the deepening is
 * kept only on a side whose apron runs on both ways: it eases (smoothstep) from none at a cell side with no apron to all of it HULL_ALONG_M along the road away from
 * one. `hullEase(mesh, segments)` -> at(side, s) (side 0 the cells' first column, the right; 1 the last, the left), from 0 to 1.
 */
const HULL_ALONG_M = 10;
function hullEase(mesh, segments) {
  const shut = [[], []], st = mesh && mesh._state;
  if (!st) return { at: () => 1 };
  const rings = ringCells(mesh, segments);
  let L = 0, closed = false;
  mesh.cells.forEach((cell, k) => {
    L = Math.max(L, cell.s1);
    if (cell.seam) { if (cell.piece === 0) closed = true; return; }
    const seg = segments[cell.piece], pc = st.pieces[cell.piece];
    if (!seg || seg.word !== 'core' || !pc) { shut[0].push([cell.s0, cell.s1]); shut[1].push([cell.s0, cell.s1]); return; }
    if (rings.has(k)) { shut[0].push([cell.s0, cell.s1]); shut[1].push([cell.s0, cell.s1]); return; }
    const m = mesh.scene.root.children[k].children[0], K = pc.K, R = m.positions.length / 3 / K;
    if (!(K >= 3)) { shut[0].push([cell.s0, cell.s1]); shut[1].push([cell.s0, cell.s1]); return; }
    const wall = [false, false];
    for (let r = 0; r < R; r++) rowEdges(m.positions, m.normals, r * K, K).forEach((e, j) => { if (e.rim >= HULL_WALL_DEG) wall[j] = true; });
    wall.forEach((w, j) => { if (w) shut[j].push([cell.s0, cell.s1]); });
  });
  // each side's shut spans sorted and merged, so a station finds its nearest by bisection
  const merged = shut.map((l) => l.sort((x, y) => x[0] - y[0]).reduce((o, [a, b]) => { const t = o[o.length - 1]; if (t && a <= t[1] + 1e-9) t[1] = Math.max(t[1], b); else o.push([a, b]); return o; }, []));
  const ease = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
  const gap = (s, [a, b]) => { if (s >= a && s <= b) return 0; const g = s < a ? a - s : s - b; return closed && L > 0 ? Math.min(g, L - g) : g; };
  return {
    at(side, s) {
      const sp = merged[side]; if (!sp.length) return 1;
      let lo = 0, hi = sp.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sp[mid][0] <= s) lo = mid; else hi = mid - 1; }
      // the span starting at or before s, the one after it, and on a closed lap the first and the last (across the start)
      const d = Math.min(gap(s, sp[lo]), lo + 1 < sp.length ? gap(s, sp[lo + 1]) : Infinity, gap(s, sp[0]), gap(s, sp[sp.length - 1]));
      return ease(d / HULL_ALONG_M);
    },
  };
}
/** The skin's depth at each vertex of one road row (K vertices from `base` in P, N): UNDERSKIN_OFFSET_M, deepened toward each edge that rises (hullDepth) when `hull`,
 *  by each side's share `keep` ([side 0, side 1], hullEase). */
function rowDepths(P, N, base, K, hull = true, keep = [1, 1], scale = 1) {
  const out = new Float64Array(K).fill(UNDERSKIN_OFFSET_M);
  if (scale !== 1) { const d = rowDepths(P, N, base, K, hull, keep, 1); for (let k = 0; k < K; k++) out[k] = d[k] * scale; return out; }   // the twisted zone's thinner hull (twistZone)
  if (!hull || K < 3) return out;
  const p = (k) => [P[(base + k) * 3], P[(base + k) * 3 + 1], P[(base + k) * 3 + 2]], dot = dot3, sub = sub3;
  for (const [j, { E, X, rim }] of rowEdges(P, N, base, K).entries()) {
    const dE = keep[j] === 1 ? hullDepth(rim) : UNDERSKIN_OFFSET_M + (hullDepth(rim) - UNDERSKIN_OFFSET_M) * keep[j];   // the rim, as apron.js sideRows reads it
    if (!(dE > UNDERSKIN_OFFSET_M)) continue;
    for (let k = 0; k < K; k++) { const t = dot(sub(E, p(k)), X); if (t < HULL_EDGE_SPAN_M) { const x = 1 - Math.max(0, t) / HULL_EDGE_SPAN_M; out[k] += (dE - UNDERSKIN_OFFSET_M) * x * x; } }
  }
  return out;
}
/** The road columns a grid cell's skin keeps: every `step`-th and the last, about SKIN_COLUMNS across. */
function skinColumns(K) {
  const step = Math.max(1, Math.ceil((K - 1) / (SKIN_COLUMNS - 1))), cols = [];
  for (let k = 0; k < K; k += step) cols.push(k);
  if (cols[cols.length - 1] !== K - 1) cols.push(K - 1);
  return cols;
}
const TUBE_RING_AMBIENT = 0.02;    // ksAmbient of a closed ring's interior (an open road's is 0.45, src/geom/mesh.js)
const SKIN_AMBIENT = 0.05, SKIN_DIFFUSE = 0.1;   // the skin's own plain dark material: seen only from outside the pipe or below the road
// The skin only has to CAST A SHADOW, so a road cell's skin keeps about this many of the road's vertices across (a closed tube's rows carry 392; a full-size copy
// of a tube doubled the kn5). Chord sagitta at 32 columns round a 6.4 m radius ring is R(1 − cos(π/32)) = 3.1 cm against the 0.93 m offset, so the skin stays on the far
// side of the road. A seam row keeps all its vertices: its zipper is not a grid.
const SKIN_COLUMNS = 32;
// A cell whose road normals turn more than this from one row to the next, at any column, keeps every column (withUnderskin). Decimated, a skin quad spans
// about K / SKIN_COLUMNS road columns; where the section changes fast along the road (a tube's abrupt opening or closing: a column rises 2 m in one 2 m row) such a
// quad twists across it and folds along its diagonal, 22° to 37° on the tube test where the road itself bends at most 12.5° (the jag outside an abrupt opening).
// The export's own normals there turn past this; on an open road far less (his own 25 km track: no cell of more than 32 columns reaches 1°). The zone takes
// SKIN_TWIST_PAD cells more each way along the road, where the section has begun to turn but not yet past the threshold (a 25° fold in the cell before it)
const SKIN_TWIST_DEG = 8, SKIN_TWIST_PAD = 2;

const skinMaterial = () => ({
  name: 't180b_underskin', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0,
  props: [{ name: 'ksAmbient', value: [SKIN_AMBIENT] }, { name: 'ksDiffuse', value: [SKIN_DIFFUSE] }, { name: 'ksSpecular', value: [0] },
    { name: 'ksSpecularEXP', value: [1] }, { name: 'ksEmissive', value: [0, 0, 0] }, { name: 'ksAlphaRef', value: [0] }],
  samplers: [],
});
/** The material with its ambient lowered (the same samplers and every other property): the closed ring's interior. */
const darkOf = (m) => ({ ...m, name: `${m.name}_dark`, props: m.props.map((p) => (p.name === 'ksAmbient' ? { ...p, value: [TUBE_RING_AMBIENT] } : p)) });

/** Which of `mesh.cells` are core road cells (every one gets a skin): Set of cell indexes. */
function skinCells(mesh, segments) {
  const out = new Set();
  if (!mesh._state) return out;
  mesh.cells.forEach((cell, k) => { const seg = segments[cell.piece]; if (seg && seg.word === 'core') out.add(k); });
  return out;
}
/** Which of `mesh.cells` are closed-ring cells (the dark interior): a road cell when its segment is a ring; a seam row when both neighbours are. */
function ringCells(mesh, segments) {
  const st = mesh._state, out = new Set();
  mesh.cells.forEach((cell, k) => {
    if (!st) return;
    const seg = segments[cell.piece];
    if (!seg || seg.word !== 'core' || !closedRing(seg)) return;
    if (cell.seam) { const ia = cell.piece === 0 ? st.pieces.length - 1 : cell.piece - 1; if (!closedRing(segments[ia])) return; }
    out.add(k);
  });
  return out;
}

/**
 * The skin of one road mesh: its vertices UNDERSKIN_OFFSET_M away from the driver along skinDir (their row's section up; their own normal on a wall), normals the
 * reverse of that direction (facing away from the road), triangle winding reversed. `K` is the vertices across of a grid cell (R rows of K): the skin keeps every
 * `step`-th column and the last, so about SKIN_COLUMNS across; without K (a seam row) it keeps every vertex and the road's own triangles, reversed. A seam row is two
 * road rows, `seamKa` vertices of the piece before and then the piece's own (src/geom/mesh.js meshSeam); each row's centre is its own section's up.
 */
function skinOf(m, name, K = null, seamKa = null, hull = true, keep = null, full = false) {
  const P = m.positions, N = m.normals, base = { type: 'mesh', name, material: -1, castShadows: true, visible: true, transparent: false, renderable: true };
  const at = (i) => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
  if (!K) {
    const n = P.length / 3, Ka = seamKa, Kb = n - Ka;
    if (!(Ka >= 1 && Kb >= 1)) throw new Error(`skinOf: the seam ${name} has ${n} vertices, not two rows (${Ka} of the piece before)`);
    const positions = new Float32Array(P.length), normals = new Float32Array(N.length), indices = new Uint16Array(m.indices.length);
    const ncA = sectionUp(N, 0, Ka), ncB = sectionUp(N, Ka, Kb), depA = rowDepths(P, N, 0, Ka, hull, keep ? keep(0) : undefined, keep ? keep(0)[2] : 1), depB = rowDepths(P, N, Ka, Kb, hull, keep ? keep(1) : undefined, keep ? keep(1)[2] : 1);
    for (let i = 0; i < n; i++) { const d = skinDir(at(i), i < Ka ? ncA : ncB), dep = i < Ka ? depA[i] : depB[i - Ka]; for (let a = 0; a < 3; a++) { positions[i * 3 + a] = P[i * 3 + a] - dep * d[a]; normals[i * 3 + a] = -d[a]; } }
    for (let t = 0; t < m.indices.length; t += 3) { indices[t] = m.indices[t]; indices[t + 1] = m.indices[t + 2]; indices[t + 2] = m.indices[t + 1]; }
    // THE SEAM'S ZIPPER IS DROPPED WHERE IT IS A SLIVER (D604 follow-up, the tube test: 441 to 561 slivers at every piece joint). A seam's two rows lie at one station,
    // so its triangles are zero-width strips wherever the rows meet; the road's own are dropped by acready.js weldSeams (by name), the skin's (named JOIN) were not. A
    // triangle thinner than acready.js SLIVER is dropped here the same way; one bridging a real gap is kept. The rows' grid cells beside a seam keep every column
    // (withUnderskin), so what is left meets them vertex for vertex, and the two rows meet each other within float precision where nothing is kept
    const keepT = [];
    for (let t = 0; t < indices.length; t += 3) {
      const v = [0, 1, 2].map((j) => [positions[indices[t + j] * 3], positions[indices[t + j] * 3 + 1], positions[indices[t + j] * 3 + 2]]);
      const e1 = sub3(v[1], v[0]), e2 = sub3(v[2], v[0]), e3 = sub3(v[2], v[1]), x = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const longest = Math.max(Math.hypot(...e1), Math.hypot(...e2), Math.hypot(...e3));
      if (longest > 0 && Math.hypot(...x) / longest >= SLIVER) keepT.push(indices[t], indices[t + 1], indices[t + 2]);
    }
    // only the vertices a kept triangle uses (one no triangle uses is dropped by an importer: Blender's count of the skin then differs); `roadIndex`: each one's road
    // vertex in the seam (apron.js pitSkins reads a seam's skin vertex by it)
    const used = [...new Set(keepT)].sort((a, b) => a - b), re = new Map(used.map((v, i) => [v, i]));
    const pick = (A, w) => { const o = new Float32Array(used.length * w); used.forEach((v, i) => { for (let a = 0; a < w; a++) o[i * w + a] = A[v * w + a]; }); return o; };
    return { ...base, positions: pick(positions, 3), normals: pick(normals, 3), uvs: pick(m.uvs, 2), indices: Uint16Array.from(keepT.map((v) => re.get(v))), roadIndex: Int32Array.from(used) };
  }
  // `full`: the rows that keep every column (withUnderskin: a row on a seam, or every row of a cell whose section turns fast, and its neighbours' shared rows). Such a row keeps EVERY column: its
  // decimated columns are the grid's own vertices and the others (K − C a row) are appended after the grid, so the grid's R × C layout is untouched for apron.js withRuns and
  // pitSkins (`gridColumns`, `fullRows`) and no vertex goes unused (a vertex no triangle uses is dropped by an importer: Blender's count of the skin then differs); and the strip beside it is a zipper from it to the decimated row 2 m on
  // (its triangles a column wide and a row long): so the row is the seam's own, vertex for vertex. Decimated there, its chords stood up to 3 cm off a tube's ring
  // against the seam's every-vertex row: a crack of sky at every joint (the tube test, 301 open edges each)
  const R = P.length / 3 / K, cols = skinColumns(K), fr = [...new Set((full || []).filter((r) => r >= 0 && r < R))].sort((a, b) => a - b);
  const C = cols.length, nV = R * C + fr.length * (K - C), positions = new Float32Array(nV * 3), normals = new Float32Array(nV * 3), uvs = new Float32Array(nV * 2), idx = [];
  const hang = (r, k, d) => {   // road vertex (r, k) hung into skin vertex d, by its row's depths and section's up (sectionUp, as apron.js sideRows reads it)
    const s = (r * K + k) * 3, dir = skinDir(at(r * K + k), rowUp[r]);
    for (let a = 0; a < 3; a++) { positions[d * 3 + a] = P[s + a] - rowDep[r][k] * dir[a]; normals[d * 3 + a] = -dir[a]; }
    uvs[d * 2] = m.uvs[(r * K + k) * 2]; uvs[d * 2 + 1] = m.uvs[(r * K + k) * 2 + 1];
  };
  const rowDep = [], rowUp = [];
  for (let r = 0; r < R; r++) { rowDep.push(rowDepths(P, N, r * K, K, hull, keep ? keep(r) : undefined, keep ? keep(r)[2] : 1)); rowUp.push(sectionUp(N, r * K, K)); }
  for (let r = 0; r < R; r++) cols.forEach((k, c) => hang(r, k, r * C + c));
  const extra = []; for (let k = 0, c = 0; k < K; k++) { if (c < C && cols[c] === k) { c++; continue; } extra.push(k); }   // the columns a full row adds
  const colOf = new Map(cols.map((k, c) => [k, c])), extraOf = new Map(extra.map((k, x) => [k, x]));
  fr.forEach((r, j) => { for (const k of extra) hang(r, k, R * C + j * extra.length + extraOf.get(k)); });
  // the road's quads are (A, C, B) and (B, C, D) with A = this vertex, B = the next across, C = the next row's; the skin's are wound the other way: (L_i, L_i+1, U_j)
  // and (L_i+1, U_j+1, U_j) for a lower row L and the upper row U
  const full_ = (r) => fr.indexOf(r), at_ = (r, i) => (full_(r) < 0 ? r * C + i : colOf.has(i) ? r * C + colOf.get(i) : R * C + full_(r) * extra.length + extraOf.get(i));   // i: a column (full row) or a grid column (decimated)
  for (let r = 0; r < R - 1; r++) {
    const lf = full_(r) >= 0, uf = full_(r + 1) >= 0, L = (i) => at_(r, i), U = (i) => at_(r + 1, i);
    if (lf === uf) { const n = lf ? K : C; for (let c = 0; c < n - 1; c++) idx.push(L(c), L(c + 1), U(c), L(c + 1), U(c + 1), U(c)); continue; }
    for (let c = 0; c < C - 1; c++) {
      const k0 = cols[c], k1 = cols[c + 1];
      if (uf) { for (let k = k0; k < k1; k++) idx.push(L(c), U(k + 1), U(k)); idx.push(L(c), L(c + 1), U(k1)); }   // the full row above: a fan at L(c), then one across
      else { for (let k = k0; k < k1; k++) idx.push(L(k), L(k + 1), U(c)); idx.push(L(k1), U(c + 1), U(c)); }      // the full row below: a fan at U(c), then one across
    }
  }
  if (nV > 65535) throw new Error(`skinOf: ${name} has ${nV} vertices, past a kn5 mesh's 16-bit indices`);
  return { ...base, positions, normals, uvs, indices: Uint16Array.from(idx), gridColumns: C, fullRows: fr };
}

/**
 * THE TWISTED ZONE (D604 follow-up, the jag at a tube's abrupt opening, the tube test row 2): the grid cells whose section turns fast, by the scene's own road normals
 * (`kids`, the export scene's root children, one per mesh cell): a cell of more than SKIN_COLUMNS columns, not a closed ring, where some column's normal turns more than
 * SKIN_TWIST_DEG from one row to the next; widened SKIN_TWIST_PAD cells each way along an unbroken run of cells that meet. In the zone the skin keeps every column
 * (withUnderskin), and the hull is thinner: a skin hung 1.5 m off a road that twists that fast lies on the concave side of the twist and folds several times sharper than
 * the road (15° to 22° where the road bends 5°; at 0.5 m it bends within the road's own). So the whole hull's depth there scales to HULL_TWIST_DEPTH, easing back to 1
 * over HULL_TWIST_EASE_M of road either side of the zone (`at(s)`), on the skin and on every edge piece that meets it (apron.js). On a road with no such cell (his own
 * track) `at` is 1 everywhere and nothing changes.
 * Returns { list (the grid cells by s), zone (per list entry), meets(a, b), at(s) }.
 */
const HULL_TWIST_DEPTH = 1 / 3, HULL_TWIST_EASE_M = 10;
function twistZone(kids, mesh, segments) {
  const cosTwist = Math.cos((SKIN_TWIST_DEG * Math.PI) / 180), rings = ringCells(mesh, segments);
  const list = mesh.cells.map((c, j) => j).filter((j) => !mesh.cells[j].seam).sort((a, b) => mesh.cells[a].s0 - mesh.cells[b].s0);
  const twisted = list.map((j) => {
    const K = mesh._state.pieces[mesh.cells[j].piece].K, m = kids[j] && kids[j].children && kids[j].children[0];
    if (!m || !(K > SKIN_COLUMNS) || rings.has(j)) return false;
    const Nn = m.normals, R = Nn.length / 3 / K, n = (i) => [Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]];
    for (let r = 0; r + 1 < R; r++) for (let k = 0; k < K; k++) { const a = n(r * K + k), b = n((r + 1) * K + k), l = Math.hypot(...a) * Math.hypot(...b); if (l > 0 && dot3(a, b) / l < cosTwist) return true; }
    return false;
  });
  const meets = (a, b) => Math.abs(mesh.cells[a].s1 - mesh.cells[b].s0) < 1e-6;   // b starts where a ends
  const zone = twisted.slice();
  twisted.forEach((t, i) => { if (!t) return; for (let d = 1; d <= SKIN_TWIST_PAD; d++) { if (i - d >= 0 && meets(list[i - d], list[i - d + 1])) zone[i - d] = true; else break; } for (let d = 1; d <= SKIN_TWIST_PAD; d++) { if (i + d < list.length && meets(list[i + d - 1], list[i + d])) zone[i + d] = true; else break; } });
  const spans = []; list.forEach((j, i) => { if (!zone[i]) return; const c = mesh.cells[j], t = spans[spans.length - 1]; if (t && c.s0 <= t[1] + 1e-6) t[1] = Math.max(t[1], c.s1); else spans.push([c.s0, c.s1]); });
  const at = (s) => {
    if (!spans.length) return 1;
    let d = Infinity; for (const [a, b] of spans) { if (s >= a && s <= b) return HULL_TWIST_DEPTH; d = Math.min(d, s < a ? a - s : s - b); }
    const x = Math.min(1, d / HULL_TWIST_EASE_M), e = x * x * (3 - 2 * x);
    return HULL_TWIST_DEPTH + (1 - HULL_TWIST_DEPTH) * e;
  };
  return { list, zone, meets, at };
}

/**
 * The hull's depth scale at main s: the twisted zone's (twistZone `at`), but never so thin that a plank's tip hangs below the bottom: where an apron runs (hullEase's
 * share of the default plank, as apron.js tapers it) the hull keeps HULL_TWIST_CLEAR_M under that plank's drop. A wall's side has no plank (share 0), so there the
 * zone's full thinning holds. Outside the zone, exactly 1. Shared by the skin (withUnderskin) and every edge piece that meets it (apron.js).
 */
const HULL_TWIST_CLEAR_M = 0.4;
function hullScaleAt(he, tz, s) {
  const t = tz.at(s); if (t === 1) return 1;
  const drop = HULL_PLANK_DROP * Math.max(he.at(0, s), he.at(1, s));
  return Math.max(t, Math.min(1, (drop + HULL_TWIST_CLEAR_M) / UNDERSKIN_OFFSET_M));
}

function withUnderskin(scene, mesh, segments) {
  if (!mesh || !mesh.cells || !mesh.scene) return scene;
  const skinned = skinCells(mesh, segments);
  if (!skinned.size) return scene;
  const rings = ringCells(mesh, segments), kids = scene.root.children, orig = mesh.scene.root.children, he = hullEase(mesh, segments), tz = twistZone(kids, mesh, segments);
  // the grid cells beside a seam: the piece before's last cell and the seam's own piece's first (by s along the piece: the cells are not listed in road order there)
  const firstOf = new Map(), lastOf = new Map(), np = mesh._state.pieces.length;
  mesh.cells.forEach((c, j) => { if (c.seam) return; if (!firstOf.has(c.piece) || c.s0 < mesh.cells[firstOf.get(c.piece)].s0) firstOf.set(c.piece, j); if (!lastOf.has(c.piece) || c.s1 > mesh.cells[lastOf.get(c.piece)].s1) lastOf.set(c.piece, j); });
  const seamRows = new Map(), mark = (j, which) => { if (!seamRows.has(j)) seamRows.set(j, []); seamRows.get(j).push(which); };   // cell -> its full rows: 'first' / 'last' / 'all'
  // the cells of the twisted zone (twistZone) keep every row whole, and the grid cell before and after the zone along the road its row beside it
  {
    const { list, zone, meets } = tz;
    list.forEach((j, i) => { if (!zone[i]) return; mark(j, 'all'); if (i > 0 && !zone[i - 1] && meets(list[i - 1], j)) mark(list[i - 1], 'last'); if (i + 1 < list.length && !zone[i + 1] && meets(j, list[i + 1])) mark(list[i + 1], 'first'); });
  }
  mesh.cells.forEach((c) => { if (!c.seam) return; const ia = c.piece === 0 ? np - 1 : c.piece - 1; if (lastOf.has(ia)) mark(lastOf.get(ia), 'last'); if (firstOf.has(c.piece)) mark(firstOf.get(c.piece), 'first'); });
  const materials = scene.materials.slice(), dark = new Map(), skinIndex = materials.push(skinMaterial()) - 1;
  const darkIndex = (i) => { if (!dark.has(i)) dark.set(i, materials.push(darkOf(scene.materials[i])) - 1); return dark.get(i); };
  const skins = [];
  const children = kids.map((c, k) => {
    if (!skinned.has(k)) return c;
    const m = c.children && c.children[0], o = orig[k] && orig[k].children[0];
    if (!m || !o || m.name !== o.name) throw new Error(`withUnderskin: scene node ${k} is not the mesh's cell ${k} (${m && m.name} against ${o && o.name})`);
    const cell = mesh.cells[k], name = m.name.replace(/^1ROAD/, 'UNDERSKIN').replace(/seam/gi, 'join'), pcs = mesh._state.pieces;
    let seamKa = null;
    if (cell.seam) {   // the seam's first row is the piece before's last (a closed lap's seam at piece 0 follows the last piece)
      const before = pcs[cell.piece === 0 ? pcs.length - 1 : cell.piece - 1], own = pcs[cell.piece];
      if (!before || !own || before.K + own.K !== m.positions.length / 3) throw new Error(`withUnderskin: the seam ${m.name} has ${m.positions.length / 3} vertices, not its two pieces' rows (${before && before.K} + ${own && own.K})`);
      seamKa = before.K;
    }
    // each row's share of the hull's deepening on either side (hullEase), by its main s: a grid cell's rows evenly from s0 to s1, a seam's two rows at its ends
    const Rr = cell.seam ? 2 : m.positions.length / 3 / pcs[cell.piece].K, keep = (r) => { const sr = cell.s0 + (Rr > 1 ? (cell.s1 - cell.s0) * r / (Rr - 1) : 0); return [he.at(0, sr), he.at(1, sr), hullScaleAt(he, tz, sr)]; };   // and the hull's depth scale (twistZone, hullScaleAt)
    // a grid cell beside a seam keeps every column, so its row there is the seam's row vertex for vertex (decimated, its chords stood up to 3 cm off a tube's ring, a
    // crack of sky at every joint: the tube test, 301 open edges each); a seam whose zipper was all sliver has no skin of its own
    const full = cell.seam || !seamRows.has(k) ? null : seamRows.get(k).flatMap((w) => (w === 'all' ? Array.from({ length: Rr }, (_, r) => r) : [w === 'first' ? 0 : Rr - 1]));
    const sk = skinOf(m, name, cell.seam ? null : pcs[cell.piece].K, seamKa, !rings.has(k), keep, full); sk.material = skinIndex;
    if (sk.indices.length) skins.push({ type: 'dummy', name: c.name.replace(/^CELL_/, 'SKIN_').replace(/^SEAM_/, 'JOIN_'), matrix: c.matrix, children: [sk] });
    return rings.has(k) ? { ...c, children: [{ ...m, material: darkIndex(m.material) }, ...c.children.slice(1)] } : c;
  });
  return { ...scene, materials, root: { ...scene.root, children: [...children, ...skins] } };
}

module.exports = { withUnderskin, skinCells, ringCells, skinOf, skinDir, sectionUp, twistZone, hullScaleAt, HULL_TWIST_DEPTH, hullDepth, hullEase, HULL_ALONG_M, rowDepths, skinColumns, HULL_EDGE_SPAN_M, darkOf, UNDERSKIN_OFFSET_M, TUBE_RING_AMBIENT, SKIN_AMBIENT, SKIN_DIFFUSE, SKIN_COLUMNS };
