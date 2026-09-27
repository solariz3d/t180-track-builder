// paint.js: the visible half of §5c ("markers are invisible to drivers, so the builder paints what they mean, GENERATED
// FROM THE MARKERS THEMSELVES so paint and marker can never disagree").
//
//   paintFor(placed, path, segments) -> { material, meshes: [scene mesh node], items: [{ name, from, s, u, kind }] }
//
//   · the START/FINISH LINE across the whole cross-section at AC_TIME_0, wall to wall: up a half-pipe's walls too
//   · a GRID BOX at every AC_START_n: the car slot's outline, ±1.0 m across and ±2.4 m along (the slot the checks use)
//   · a PIT BOX at every AC_PIT_n, the same outline
//
// WHY GEOMETRY, NOT A TEXTURE LAYER. §5c asks for texture layers on the road (§5b), and there is no texture system yet
// (no road texture, no layer compositor, no DDS writer). So the paint is thin meshes laid ON the surface: each is a patch
// in track coordinates (s along, u across), mapped through the same surfaceAt the markers use, so it bends with banking
// and walls exactly as a texture in the road's own coordinates would, and lifted 2 cm along the surface normal (inferred:
// clear of z-fighting at preview distances, invisible to a car). They are in the scene-node shape of
// src/export/scene.js, so the kn5 writer exports them as visual meshes (their names do not start with a digit, so AC
// does not treat them as physics, ARCHITECTURE §6), and the preview can draw the same arrays. When §5b lands, the same
// patches (s, u rectangles) become the texture layer's rectangles.
// Not painted: grid position numbers (need glyphs), the pit lane's entry and exit lines (no pit lane yet), sector lines
// (§5c paints only the start/finish).
'use strict';
const { surfaceAt, segStarts, _vec: { add, mul } } = require('./place.js');
const { SLOT_HALF_LENGTH, SLOT_HALF_WIDTH } = require('./layout.js');

const LIFT = 0.02, LINE_W = 0.6, EDGE_W = 0.15, ACROSS_STEP = 0.5;   // m (inferred: display choices)
const MATERIAL = Object.freeze({ name: 't180b_paint', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0,
  props: [{ name: 'ksAmbient', value: [0.9] }, { name: 'ksDiffuse', value: [0.9] }, { name: 'ksSpecular', value: [0] }, { name: 'ksSpecularEXP', value: [1] }, { name: 'ksEmissive', value: [0.3, 0.3, 0.3] }, { name: 'ksAlphaRef', value: [0] }],
  samplers: [] });

/** One patch s ∈ [sA, sB] × u ∈ [uA, uB], as grid quads on the surface. Returns { P, N, UV, I } (plain arrays). */
function patch(path, segments, starts, sA, sB, uA, uB) {
  const nU = Math.max(2, Math.ceil((uB - uA) / ACROSS_STEP) + 1), rows = [sA, sB];
  const P = [], N = [], UV = [], I = [];
  for (const [r, s] of rows.entries()) for (let j = 0; j < nU; j++) {
    const u = uA + (uB - uA) * j / (nU - 1), sf = surfaceAt(path, segments, s, u, starts);
    P.push(...add(sf.pos, mul(sf.n, LIFT))); N.push(...sf.n); UV.push(j / (nU - 1), r);
  }
  for (let j = 0; j < nU - 1; j++) { const A = j, B = j + 1, C = nU + j, D = C + 1; I.push(A, C, B, B, C, D); }   // u rises to the left: CCW from above
  return { P, N, UV, I };
}

function node(name, parts, material) {
  const P = [], N = [], UV = [], I = [];
  for (const p of parts) { const base = P.length / 3; P.push(...p.P); N.push(...p.N); UV.push(...p.UV); I.push(...p.I.map((k) => k + base)); }
  return { type: 'mesh', name, material, positions: Float32Array.from(P), normals: Float32Array.from(N), uvs: Float32Array.from(UV), indices: Uint16Array.from(I), castShadows: false, visible: true, transparent: false, renderable: true };
}

/** The outline of a car slot around (s, u): four strips EDGE_W wide, inside the slot. */
function box(path, segments, starts, s, u) {
  const a = s - SLOT_HALF_LENGTH, b = s + SLOT_HALF_LENGTH, r = u - SLOT_HALF_WIDTH, l = u + SLOT_HALF_WIDTH, e = EDGE_W;
  return [patch(path, segments, starts, b - e, b, r, l), patch(path, segments, starts, a, a + e, r, l),
    patch(path, segments, starts, a + e, b - e, l - e, l), patch(path, segments, starts, a + e, b - e, r, r + e)];
}

function paintFor(placed, path, segments, { material = 0, lane = null } = {}) {
  const starts = segStarts(path, segments), laneStarts = lane ? segStarts(lane.path, lane.segments) : null, meshes = [], items = [], skipped = [];
  const add1 = (name, from, kind, s, u, parts) => { meshes.push(node(name, parts, material)); items.push({ name, from, kind, s, u }); };
  const l = placed.find((m) => m.name === 'AC_TIME_0_L' && !m.error);
  if (l) {
    const sp = l.span;
    try { add1('PAINT_START_LINE', 'AC_TIME_0', 'line', l.s, (sp[0] + sp[1]) / 2, [patch(path, segments, starts, l.s - LINE_W / 2, l.s + LINE_W / 2, sp[0], sp[1])]); } catch (e) { skipped.push({ name: 'PAINT_START_LINE', why: e.message }); }
  }
  for (const m of placed) {
    if (m.error || (m.kind !== 'grid' && m.kind !== 'pit')) continue;
    const name = m.kind === 'grid' ? `PAINT_GRID_${m.n}` : `PAINT_PIT_${m.n}`;
    const [p, g, st] = m.onLane ? [lane.path, lane.segments, laneStarts] : [path, segments, starts];   // a lane's box on the lane
    try { add1(name, m.name, m.kind, m.s, m.u, box(p, g, st, m.s, m.u)); } catch (e) { skipped.push({ name, why: e.message }); }
  }
  return { material: MATERIAL, meshes, items, skipped };
}

module.exports = { paintFor, MATERIAL, LIFT, LINE_W, EDGE_W };
