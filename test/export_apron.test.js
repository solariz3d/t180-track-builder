// export_apron.test.js: node --test test/export_apron.test.js
// D572, THE EDGE APRON (src/export/apron.js): outside every open edge of an equation-core road a physics strip runs OUTWARD and DOWN from the road's own edge row, and a
// scenery face joins it to the underside skin's edge row, so a wheel that drops off the edge has a surface under it and the side gap between road and skin is closed. Rows:
//   1  on a flat open road each grid cell gets two aprons: the outer row widthM out across and widthM·tan(25°) below the edge row (2.0 m: 0.93 m; 1.5 m: 0.70 m)
//   2  the wedge is closed: the join's lower row is the skin's edge vertices to the float; no face points into the wedge; the top faces up, the join down (D572's row,
//      back after D593 tried a lip's underside and a filled side face)
//   3  the road's own nodes are the same objects in the same places; the aprons are only appended, with one material added
//   4  a wall side (a cup at 90°) gets none; a closed tube ring gets none; a seam row gets none
//   5  a side whose edge zone turns down (e < 0) is open: its apron starts at the zone's outer row (the mesh's last column)
//   6  width 0: no apron, and a side face from the edge row straight down to the skin's edge row
//   7  only the top is physics: <prefix>APRON_<cell>_L/R (AC's ROAD; the soft block's 1ROAD? covers it); the join and side face are APRONSIDE_ scenery; never "seam";
//      the apron's own material is darker than the road's; a bad width, slope or lane side is refused
//   8  the aprons of consecutive cells meet, across a piece join too: each cell's first outer row is the last cell's last, to a millimetre
//   9  the full export: the kn5 carries the aprons, the road's meshes in it are the same at width 0 and 2, and the downforce-ray check finds no gap at the aprons
//  10  the pit lane's side gets no apron over the lane's span (its infill joins the road there); the other side, and the lane's side away from the span, do
//  11  a gripped piece's aprons are its own grip surface (1GRIP070_APRON_…), an ungripped piece's 1ROAD_APRON_
// D593, WHAT IS SEEN (the physics above kept byte for byte and hidden; a separate VISUAL lip drawn; exo_memory/loop/plan_apron_reads_as_part_of_the_road_2026-10-31.md):
//  12  the D563 wheel: 0.86 m out the physics apron is 0.40 m below the edge row, within 0.1 m of the 0.31 m the wheel was measured to fall
//  13  what is drawn is the physics: on a flat, a banked and a cupped edge every apron top is drawn as it is, beside its join; no other apron mesh (no lip)
//  14  the pit lane is one outline: a drawn physics apron round its ends and along its outer edge, onto the main apron either side, with its join; the 0.86 m case too
//  15  the apron wears the road's own asphalt a little darker: t180b_apron is the road material's texture with its light at LIP_SHADE, on the tops and the joins
//  16  every apron top and join is exactly apronOf's, byte for byte, and drawn (visible, renderable, casting shadows), on t180b_apron
//  17  the physics apron is byte for byte what the user drove, pinned at a93ae51, on a flat, a banked and a cupped edge
//  18  the pit IS the track: no drawn and no physics triangle clips through another round the lane, none overlaps another in one plane, none is a sliver under
//      1 cm, and no drawn edge is left open round either of its ends
//  19  the lane's drawn edge carries one texture along it: no edge of a face triangle round the lane squeezes more than 1 texture repeat into a metre (the road and
//      the lane's three parts each have their own uv space, and a drawn edge stepping between them in one row squeezed up to 41 per metre)
//  20  on a road cupped 15.5° with a pit lane (his case): no lip anywhere, and the outline's plank is drawn and has its join
//  21  the lane's surface wears the road's texture at the road's scale where it narrows too: on every lane triangle u changes 0.1 a metre (u = metres across / 10,
//      mesh.js), within 10% (its diverge kept the full width's u over 10 cm, 80 times squeezed, and its merge the narrow end's over 8 m, 80 times stretched)
//  22  the apron's caps across the lane's two ends face out of the lane's end: every drawn outline triangle lying across the road (its normal within 25° of the
//      road's direction there) faces away from the lane (half of them faced in and were culled: sky through the leave from below)
//  23  the road is a HULL (D604, the user 08:49: "the track gets 3D depth instead of a slice of a mesh"; 10:44, his red line): on a flat road the skin is
//      UNDERSKIN_OFFSET_M (1.5 m) under it all across, and each run under a plank goes from the tip only down and in to the skin's edge
//  25  the hull's bottom is ONE smooth curve tip to tip: on a banked and two cupped edges each run's slope in its section only flattens from the tip in, it runs on
//      into the skin with no corner, and no bottom vertex comes within 0.15 m of the road
//  24  the slab does not cut itself: on a flat, a banked and a cupped edge, two edges turned down (the convex case, where an offset can fold) and the pit lap, no drawn
//      triangle of the whole export clips through another, within one mesh or between meshes, and no physics one
//  27  the planks meet across a piece joint where the road's column count goes from even to odd (a cup ramp after a tube, then a cupped piece): in the scene
//      the kn5 is written from, each side's plank ends on the next piece's first plank row to a millimetre, its outer row too, and the run under it with it
//  28  every plank hangs at the apron's own slope from the road's frame (25° below the lateral, in the cross-section) on a cupped piece with an edge zone on
//      one side as on a symmetric one: it hangs from the section's own middle, not from column Math.floor(K / 2)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const G = require('../src/geom/index.js');
const S = require('../src/export/underskin.js');
const AP = require('../src/export/apron.js');
const FW = require('../src/export/fromwords.js');
const { walkScene, isDrivable } = require('../src/export/markers.js');
const { rayGaps } = require('../src/validate/raygap.js');
const { MACH6 } = require('../src/validate/limits.js');
const { readKn5 } = require('../tools/kn5.cjs');
const { startLayout } = require('../app/core/coreshell.js');

const DEG = Math.PI / 180;
const meshOf = (doc) => { const segs = A.toSegments(doc), { path } = A.toPath(doc), mesh = G.buildMesh(path, segs); return { segs, mesh }; };
const flat = (len = 60, extra = {}) => extend(D.createDoc('apron'), { length: len, family: 'bowl', first: { w: 20, c: 0, ...extra } });
const tops = (scene) => scene.root.children.filter((c) => /^APRON[LR]_/.test(c.name));
const sides = (scene) => scene.root.children.filter((c) => /^APRONSIDE[LR]_/.test(c.name));
const pairs = (node) => { const P = node.children[0].positions, out = []; for (let i = 0; i < P.length / 3; i += 2) { const v = (j) => [P[(i + j) * 3], P[(i + j) * 3 + 1], P[(i + j) * 3 + 2]]; out.push([v(0), v(1)]); } return out; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cellOf = (name) => name.replace(/^APRON(SIDE|LIP)?[LR]_/, '');   // (D593: the visual lip's APRONLIP too)
// D593: the visual lip (APRONLIP…) is gone (the user 21:54-21:55: a blade); vlips(scene) finds any, for the rows that hold it to none
const vlips = (scene) => scene.root.children.filter((c) => /^APRONLIP[LR]_/.test(c.name));
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], unit3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
// D604: a plank's run under it is IN its cell's skin (apron.js withRuns): the skin's own R×C vertices, then a side at a time (R, then L) the run's RUN_COLUMNS − 1
// points a row, the tip first (its last point is the skin's own edge vertex, shared). tip(i) and at(i, j) are vertex indexes
function runOf(out, tp) {
  const node = out.root.children.find((c) => /^SKIN_/.test(c.name) && c.matrix === tp.matrix), sk = node && node.children[0], J = AP.RUN_COLUMNS - 1;
  const R = tp.children[0].positions.length / 3 / 2, mine = tops(out).filter((a) => a.matrix === tp.matrix), right = tp.name.startsWith('APRONR');
  const C = sk ? sk.positions.length / 3 / R - mine.length * J : 0, base = R * C + (right || mine.length === 1 ? 0 : R * J);
  const edge = (i) => i * C + (right ? 0 : C - 1);
  return { node, sk, R, C, J, base, edge, tip: (i) => base + i * J, at: (i, j) => (j === J ? edge(i) : base + i * J + j) };
}
function build(doc, opts) { const { segs, mesh } = meshOf(doc), skinned = S.withUnderskin(mesh.scene, mesh, segs); return { segs, mesh, skinned, out: AP.withApron(skinned, mesh, segs, opts) }; }
const Rr = 180, Q = (Math.PI * Rr) / 2;
function lap(name = 'apron lap') {
  let d = extend(D.createDoc(name), { length: 400, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
function exportDoc(doc, o = {}, meta = {}) {
  const segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  return FW.buildFromSegments(segs, { name: 'apron', via: 'test', liftPath: lift, start, ...meta }, { markers: startLayout(segs, lift, start), ...o });
}

test('row 1: on a flat open road each cell gets two aprons, their outer row widthM out and widthM·tan(25°) below the edge row (2.0 m: 0.93 m; 1.5 m: 0.70 m)', () => {
  for (const W of [2.0, 1.5]) {
    const { mesh, out } = build(flat(), { widthM: W });
    const grid = mesh.cells.filter((c) => !c.seam).length, ap = tops(out);
    assert.equal(ap.length, 2 * grid, `two aprons a cell (${grid} cells)`);
    for (const a of ap) for (const [E, O] of pairs(a)) {
      const d = sub(O, E);
      assert.ok(Math.abs(Math.hypot(d[0], d[2]) - W) < 1e-4, `${a.name}: ${Math.hypot(d[0], d[2])} m out`);
      assert.ok(Math.abs(d[1] + W * Math.tan(25 * DEG)) < 1e-4, `${a.name}: ${-d[1]} m down`);
      assert.ok(Math.sign(E[0]) === Math.sign(d[0]), `${a.name}: outward, away from the road's centre`);
    }
  }
});

// AMENDED (D593, what is seen): the closed section was a wedge of three rows (the physics top's edge and outer row, the skin) with a flat join from the outer row to the
// skin, the "flat surface" the user saw from below; then a visual lip and an underside that followed it. The hidden physics top is row 16's.
// AMENDED (D593, the chair's 21:58 and 23:23, the user's 21:58: "we need to somehow revert back to what we had originally with the apron", after the wheels sank through
// a drawn lip, the gap between drawn and physics): what is drawn is 0.4.34's apron, THE PHYSICS ITSELF, the plank and its join, vertex for vertex; no lip, nothing hidden.
// Kept of D593: the apron's material (t180b_apron) is the road's own asphalt at LIP_SHADE, and the pit lane's outline has the same drawn plank and join.
// AMENDED (D604 redo, the user 2026-11-01 10:32: "the apron itself connects right to the other one without having an extra thicker bottom than we need"): the join is no
// longer a mesh of its own: its run under the plank is IN the cell's skin (apron.js withRuns), so the slab's bottom is one mesh from tip to tip.
// AMENDED (D604 hull, the user's red line, 2026-11-01 10:44: the bottom one smooth curve from one plank's tip to the other's, about 1.5 m under the road): the run is a curve of RUN_COLUMNS points now, not one span; the row reads it whole: its first point is the plank's tip, its last the
// skin's own edge vertex (shared), and no face of it points into the hull
test('row 2: the wedge is closed: each plank\'s tip row is in its cell\'s skin, its run meeting the skin\'s own edge vertices; no face points into the hull; the top faces up, the run down', () => {
  const { out } = build(flat(), { widthM: 2.0 });
  assert.ok(tops(out).length > 0); assert.equal(sides(out).length, 0, 'no join mesh: each run is in its cell\'s skin');
  for (const tp of tops(out)) {
    const { sk, R, J, base, edge, tip } = runOf(out, tp), tRows = pairs(tp);
    assert.ok(sk, `${tp.name} has its cell's skin`);
    const P = sk.positions, v = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], inRun = (x) => x >= base && x < base + R * J;
    tRows.forEach(([, O], i) => assert.deepEqual(v(tip(i)), Array.from(Float32Array.from(O)), `${tp.name} row ${i}: the run starts at the plank's tip`));
    const I = sk.indices; let n = 0;
    for (let t = 0; t < I.length; t += 3) {
      const ids = [I[t], I[t + 1], I[t + 2]], o = ids.find(inRun); if (o === undefined) continue; n++;
      const i = Math.floor((o - base) / J);
      for (const x of ids.filter((y) => !inRun(y))) assert.ok([i - 1, i, i + 1].some((j) => j >= 0 && j < R && x === edge(j)), `${tp.name} triangle ${t / 3}: the run meets the skin at its own edge vertex`);
      const [E, O] = tRows[i], Sv = v(edge(i)), g = [(E[0] + O[0] + Sv[0]) / 3, (E[1] + O[1] + Sv[1]) / 3, (E[2] + O[2] + Sv[2]) / 3];
      const a = v(ids[0]), b = v(ids[1]), c = v(ids[2]), u = sub(b, a), w = sub(c, a), nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      assert.ok(nn[0] * (mid[0] - g[0]) + nn[1] * (mid[1] - g[1]) + nn[2] * (mid[2] - g[2]) > 0, `${tp.name} run triangle ${t / 3} faces into the hull`);
    }
    assert.equal(n, 2 * (R - 1) * J, `${tp.name}: two run triangles a span a row`);
    for (let x = base; x < base + R * J; x++) assert.ok(sk.normals[x * 3 + 1] < 0, `${tp.name}: the run's normal is down`);
    assert.ok(tp.children[0].normals[1] > 0.8, `${tp.name}: the top's normal is up`);
  }
});
// AMENDED (D593, twice): the lip's shades were added after the apron's own material; with the lip gone, the apron's own is the one added again (it is now the
// road's asphalt in its shade, row 15)
// AMENDED (D604): the skin's own material is the road's asphalt in its shade too, under its name and at its index (the slab's underside); every other earlier material
// is the same object
// AMENDED (D604 redo, the user 2026-11-01 10:32: "the apron itself connects right to the other one without having an extra thicker bottom than we need"): a cell's skin with an apron is its skin with the run under the plank appended (the slab's bottom, one mesh): the same name, the
// same frame, its own vertices first byte for byte; every other node is the same object, and the nodes appended are the planks alone
test('row 3: the road\'s own nodes are the same objects in the same places; a skin with an apron is that skin with its runs appended; the planks are appended, with one material added, and the skin\'s in the road\'s shade', () => {
  const { skinned, out } = build(flat(), {});
  const k = skinned.root.children.length, bytes = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  let grown = 0;
  skinned.root.children.forEach((c, i) => {
    const o = out.root.children[i];
    if (o === c) return;
    assert.match(c.name, /^SKIN_/, `node ${i} is the same object`); grown++;
    assert.equal(o.name, c.name); assert.equal(o.matrix, c.matrix, `${c.name}: in the cell's own frame`);
    const a = c.children[0], b = o.children[0];
    assert.ok(bytes(b.positions).subarray(0, a.positions.byteLength).equals(bytes(a.positions)), `${c.name}: the skin's own vertices first, as they were`);
    assert.equal(b.material, a.material); assert.equal(b.name, a.name);
  });
  assert.ok(grown > 0, 'control: the skins under the planks took their runs');
  assert.ok(out.root.children.slice(k).every((c) => /^APRON[LR]_/.test(c.name)));
  assert.equal(out.materials.length, skinned.materials.length + 1);
  skinned.materials.forEach((m, i) => (m.name === 't180b_underskin' ? assert.equal(out.materials[i].name, m.name) : assert.equal(out.materials[i], m)));
  const skin = out.materials.find((m) => m.name === 't180b_underskin'), apron = out.materials.find((m) => m.name === 't180b_apron');
  assert.deepEqual(skin.props, apron.props, 'the skin wears the apron\'s asphalt'); assert.deepEqual(skin.samplers, apron.samplers);
  assert.equal(out.materials[out.materials.length - 1].name, 't180b_apron', 'the one material added is the apron\'s (D593: the road\'s asphalt in its shade, row 15)');
});

// AMENDED BY NAME (2026-11-02, the jag at a tube's opening, the tube test): a wall side still gets no plank and no physics, but it now gets its hull's side face (an
// APRONSIDE node, drawn only, as at width 0), straight from the road's edge row to the skin's edge: with none, the skin's edge hung free beside the wall, a fin
test('row 4: a wall side (a cup at 90°) gets no plank, only its side face from the edge to the skin; a closed tube ring gets none, a seam row gets none', () => {
  const wall = build(extend(D.createDoc('w'), { length: 60, family: 'bowl', first: { w: 20, c: 90 } }), {});
  assert.equal(wall.out.root.children.filter((c) => /^APRON[LR]_/.test(c.name) || (c.children || []).some((m) => /^1(ROAD|GRIP\d{3})_APRON_/.test(m.name))).length, 0, 'a 90° cup is a wall on both sides: no plank, no physics');
  const faces = sides(wall.out);
  assert.equal(faces.length, 2 * wall.mesh.cells.filter((c) => !c.seam).length, 'each wall side has its side face');
  for (const f of faces) { const m = f.children[0]; assert.equal(m.positions.length / 3 % 2, 0, `${f.name}: two vertices a row, the edge and the skin's edge`); assert.ok(m.indices.length > 0 && m.visible && m.renderable, `${f.name}: drawn`); }
  const ring = build(extend(D.createDoc('t'), { length: 60, first: { w: 20, t: 360 } }), {});
  assert.equal(ring.out.root.children.filter((c) => /^APRON/.test(c.name)).length, 0, 'a closed ring has no edge');
  const joined = build(extend(flat(60), { length: 60, transition: 40, targets: { w: 12 } }), {});
  assert.ok(joined.mesh.cells.some((c) => c.seam), 'the fixture has a seam row');
  assert.ok(tops(joined.out).every((a) => !/seam|join/i.test(a.name)));
  assert.equal(tops(joined.out).length, 2 * joined.mesh.cells.filter((c) => !c.seam).length);
});

test('row 5: a side whose edge zone turns down (e < 0) is open, and its apron starts at the zone\'s outer row, the mesh\'s last column', () => {
  const { mesh, out } = build(flat(60, { e: -20, s: 0.8 }), {});
  const ap = tops(out); assert.ok(ap.length > 0);
  for (const a of ap) {
    const node = mesh.scene.root.children.find((c) => c.name === `CELL_${cellOf(a.name)}`).children[0], K = mesh._state.pieces[0].K, left = a.name.startsWith('APRONL');
    pairs(a).forEach(([E], i) => { const j = (i * K + (left ? K - 1 : 0)) * 3; assert.deepEqual(Array.from(Float32Array.from(E)), [node.positions[j], node.positions[j + 1], node.positions[j + 2]]); });
  }
  const edgeRow = mesh.scene.root.children[0].children[0].positions;
  assert.ok(edgeRow[1] < edgeRow[Math.floor(mesh._state.pieces[0].K / 2) * 3 + 1] - 0.1, 'the zone turns down: the edge is below the centre');
});

test('row 6: width 0: no apron, and a side face from the edge row straight down to the skin\'s edge row', () => {
  const { out } = build(flat(), { widthM: 0 });
  assert.equal(tops(out).length, 0);
  const sd = sides(out); assert.ok(sd.length > 0);
  for (const a of sd) {
    for (const [E, Sk] of pairs(a)) assert.ok(Math.abs(E[1] - Sk[1] - S.UNDERSKIN_OFFSET_M) < 1e-4 && Math.abs(E[0] - Sk[0]) < 1e-4, `${a.name}: straight down the skin's depth (D604: it was 0.5 m)`);
    assert.ok(Math.sign(a.children[0].normals[0]) === Math.sign(a.children[0].positions[0]), `${a.name}: the face looks outward`);
  }
});

test('row 7: only the top is physics (<prefix>APRON_<cell>_L/R); the join and side face are APRONSIDE_ scenery; never "seam"; a darker material; bad options refused', () => {
  const { out } = build(flat(), {});
  for (const a of tops(out)) { const m = a.children[0]; assert.match(m.name, /^1ROAD_APRON_p\d+_.*_[LR]$/); assert.ok(isDrivable(m.name), `${m.name} is drivable`); assert.ok(!/seam/i.test(m.name)); assert.equal(out.materials[m.material].name, 't180b_apron'); }
  for (const a of sides(out)) { const m = a.children[0]; assert.match(m.name, /^APRONSIDE_p\d+_.*_[LR]$/); assert.ok(!isDrivable(m.name), `${m.name} is scenery`); assert.ok(!/^\d/.test(m.name)); }
  const mat = out.materials.find((m) => m.name === 't180b_apron'), road = out.materials.find((m) => /road/.test(m.name));
  const p = (m, n) => m.props.find((x) => x.name === n).value[0];
  assert.ok(p(mat, 'ksDiffuse') < p(road, 'ksDiffuse') && p(mat, 'ksAmbient') < p(road, 'ksAmbient'), 'darker than the road');
  const { segs, mesh } = meshOf(flat());
  for (const bad of [{ widthM: -1 }, { widthM: NaN }, { widthM: 11 }, { slopeDeg: 90 }, { slopeDeg: -5 }, { lane: { side: 'X', s0: 0, s1: 10 } }]) assert.throws(() => AP.withApron(mesh.scene, mesh, segs, bad), /edge apron|pit lane's side/);
});

test('row 8: the aprons of consecutive cells meet, across a piece join too: each cell\'s first outer row is the last cell\'s last, to a millimetre', () => {
  const doc = extend(flat(60), { length: 120, transition: 40, targets: { kh: 1 / 200, w: 14 } });
  const { mesh, out } = build(doc, {});
  // a piece's cells share their part's name (p1_body_0), so the aprons are paired by ORDER: withApron appends them in ascending cell order, a seam row skipped, so
  // consecutive aprons of one side are consecutive grid cells (or the two cells either side of a seam row)
  const grid = mesh.cells.filter((c) => !c.seam).length;
  for (const tag of ['L', 'R']) {
    // each cell's vertices are in its OWN frame (the dummy's matrix places it; the apron shares it), so the joints are compared in world space: p·M, row vectors, translation at 12–14
    const world = (M, p) => [0, 1, 2].map((j) => p[0] * M[j] + p[1] * M[4 + j] + p[2] * M[8 + j] + M[12 + j]);
    const mine = tops(out).filter((a) => a.name.startsWith(`APRON${tag}_`)).map((a) => pairs(a).map(([E, O]) => [world(a.matrix, E), world(a.matrix, O)]));
    assert.equal(mine.length, grid, `${tag}: one apron a grid cell`);
    for (let i = 1; i < mine.length; i++) {
      const gap = Math.hypot(...sub(mine[i - 1][mine[i - 1].length - 1][1], mine[i][0][1]));
      assert.ok(gap < 1e-3, `${tag} apron ${i - 1} → ${i}: ${gap} m apart`);
    }
  }
});

test('row 9: the full export: the kn5 carries the aprons, the road meshes are the same at width 0 and 2, and the downforce-ray check finds no gap at the aprons', () => {
  const doc = lap(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-apron-'));
  try {
    const read = (b, n) => { const f = path.join(dir, n); fs.writeFileSync(f, b.kn5); return readKn5(f); };
    const two = exportDoc(doc), zero = exportDoc(doc, { edgeApronM: 0 }), k2 = read(two, 'a.kn5'), k0 = read(zero, 'b.kn5');
    const roads = (k) => k.meshes.filter((m) => /^1(ROAD|GRIP\d{3})_/.test(m.name) && !/_APRON_/.test(m.name));
    // AMENDED (D604 redo): at width 2 the join is in the skin (no APRONSIDE_ node on the core road; the slab's bottom is one mesh)
    assert.ok(k2.meshes.some((m) => /^1ROAD_APRON_/.test(m.name)) && !k2.meshes.some((m) => /^APRONSIDE_/.test(m.name)), 'width 2: the apron, its run in the skin');
    assert.ok(!k0.meshes.some((m) => /^1ROAD_APRON_/.test(m.name)) && k0.meshes.some((m) => /^APRONSIDE_/.test(m.name)), 'width 0: the side face only');
    assert.deepEqual(roads(k2).map((m) => m.name), roads(k0).map((m) => m.name));
    roads(k2).forEach((m, i) => assert.ok(Buffer.from(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength).equals(Buffer.from(roads(k0)[i].pos.buffer, roads(k0)[i].pos.byteOffset, roads(k0)[i].pos.byteLength)), `${m.name}: the same vertices`));
    const drivable = walkScene(two.scene).meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length);
    assert.deepEqual(rayGaps(drivable, two.path.samples, MACH6.downforceRay, { lapM: two.path.lengthM }).map((g) => `s ${g.s} u ${g.u}`), [], 'no gap');
    // (the export's own check, validate's downforce-ray gap, reads the road mesh BEFORE the apron is added; this row is the check on the scene as written)
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('row 10: the pit lane\'s side gets no apron over the lane\'s span; the other side, and the lane\'s side away from it, do', () => {
  const doc = lap('apron pit lap'), lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  const b = exportDoc(doc, { mergeMeshes: false }, { pitLane: lane }), s0 = b.pitLane.joins.leave.s, s1 = b.pitLane.joins.rejoin.s;
  // a mesh's station: the path sample nearest (across the ground) its first vertex, per mesh OBJECT (with merging off, a piece's cells share one name)
  const meshes = walkScene(b.scene).meshes, cellS = (m) => { const st = b.path.samples, p = [m.positions[0], m.positions[1], m.positions[2]]; let best = 0, bd = Infinity; for (const q of st) { const d = (q.pos[0] - p[0]) ** 2 + (q.pos[2] - p[2]) ** 2; if (d < bd) { bd = d; best = q.s; } } return best; };
  const left = meshes.filter((m) => /^1ROAD_APRON_.*_L$/.test(m.name)), right = meshes.filter((m) => /^1ROAD_APRON_.*_R$/.test(m.name));
  assert.ok(right.length > 0 && left.length > 0);
  const leftIn = left.map(cellS).filter((s) => s >= s0 && s <= s1);
  assert.deepEqual(leftIn, [], `no left apron between the lane's leave (${s0.toFixed(0)}) and rejoin (${s1.toFixed(0)})`);
  assert.ok(right.some((m) => { const s = cellS(m); return s >= s0 && s <= s1; }), 'the right side keeps its apron beside the lane');
  assert.ok(left.some((m) => cellS(m) > s1 + 10), 'the side of the lane has its apron away from the span');
  const fillGaps = rayGaps(meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length), b.path.samples, MACH6.downforceRay, { lapM: b.path.lengthM }).filter((g) => g.s != null && g.s >= s0 - 2 && g.s <= s1 + 2);
  assert.deepEqual(fillGaps.map((g) => `s ${g.s.toFixed(1)} u ${g.u == null ? '?' : g.u.toFixed(1)}`), [], 'no gap over the lane\'s span');
});

test('row 11: a gripped piece\'s aprons are its own grip surface (1GRIP070_APRON_…), an ungripped piece\'s 1ROAD_APRON_', () => {
  const base = lap('apron grip lap'), lo = base.pieces.findIndex((P) => P.type === 'road'), gripped = D.setGrip(base, [lo], 70);
  const b = exportDoc(gripped, { mergeMeshes: false }), names = walkScene(b.scene).meshes.map((m) => m.name), id = String(base.pieces[lo].id).replace(/[^A-Za-z0-9]/g, '_');
  const mine = names.filter((n) => /_APRON_/.test(n) && n.includes(`_${id}_`)), others = names.filter((n) => /_APRON_/.test(n) && !n.includes(`_${id}_`));
  assert.ok(mine.length > 0 && mine.every((n) => n.startsWith('1GRIP070_APRON_')), `the gripped piece's aprons: ${mine.slice(0, 2)}`);
  assert.ok(others.length > 0 && others.every((n) => n.startsWith('1ROAD_APRON_')), 'the others are ROAD');
});

// ── D593: what is seen (exo_memory/loop/plan_apron_reads_as_part_of_the_road_2026-10-31.md, its 17:1x amendment) ──
// The edges the rows below look at: a flat one, one banked 30° (no cup) and one cupped 40° (under the 60° wall bar). A side's own last segment, from the ROAD's vertices, was
// the direction the visual lip left along (D593, until the user's 21:54-21:55: the lip is gone).
const EDGES = [['flat', flat()], ['banked 30°', extend(D.createDoc('bank'), { length: 60, family: 'bowl', first: { w: 20, c: 0, phi: 30 * DEG } })], ['cupped 40°', extend(D.createDoc('cup'), { length: 60, family: 'bowl', first: { w: 20, c: 40 } })]];

test('row 12: the D563 wheel: 0.86 m out the physics apron is 0.40 m below the edge row, within 0.1 m of the 0.31 m the wheel was measured to fall', () => {
  // exo_memory/handback/p-d563-wheel-under-O_2026-10-30.md: the Demo's rear right went 0.86 m past the edge and came back 0.31 m under the surface
  const { out } = build(flat(), {});
  assert.ok(tops(out).length > 0);
  for (const a of tops(out)) for (const [E, O] of pairs(a)) {
    const across = Math.hypot(O[0] - E[0], O[2] - E[2]), drop = (E[1] - O[1]) * 0.86 / across;
    assert.ok(Math.abs(drop - 0.31) <= 0.1, `${a.name}: 0.86 m out the apron is ${drop.toFixed(3)} m below the edge, more than 0.1 m from the wheel's 0.31 m`);
  }
});

// AMENDED (D593, the chair's 21:58 and 23:23, the user's 21:58: "we need to somehow revert back to what we had originally with the apron", after the wheels sank through
// a drawn lip, the gap between drawn and physics): what is drawn is 0.4.34's apron, THE PHYSICS ITSELF, the plank and its join, vertex for vertex; no lip, nothing hidden.
// Kept of D593: the apron's material (t180b_apron) is the road's own asphalt at LIP_SHADE, and the pit lane's outline has the same drawn plank and join.
// AMENDED (D604 redo, the user 2026-11-01 10:32: "the apron itself connects right to the other one without having an extra thicker bottom than we need"): the join is in the skin (row 2), so the only apron nodes are the tops; each top's skin, with its run, is drawn
test('row 13: what is drawn is the physics: on a flat, a banked and a cupped edge every apron top is drawn as it is, its run under it in its drawn skin, and no other apron mesh is drawn (no lip)', () => {
  for (const [label, doc] of EDGES) {
    const { out } = build(doc, {});
    assert.ok(tops(out).length > 0, `${label}: aprons`);
    assert.equal(vlips(out).length, 0, `${label}: no lip`);
    assert.equal(sides(out).length, 0, `${label}: no join node: each run is in its skin`);
    assert.ok(out.root.children.filter((c) => /^APRON/.test(c.name)).every((c) => /^APRON[LR]_/.test(c.name)), `${label}: no apron node but the tops`);
    for (const a of tops(out)) { const m = a.children[0], { sk } = runOf(out, a); for (const x of [m, sk]) assert.deepEqual([x.visible, x.renderable, x.castShadows], [true, true, true], `${label} ${x.name}: drawn as it is`); }
    for (const a of tops(out)) assert.ok(isDrivable(a.children[0].name), `${label} ${a.children[0].name}: the drawn top is the physics`);
  }
});// AMENDED (D593, the chair's 21:58: the drawn surface is the physics): the outline's plank was hidden under a lip, then a side face; it is drawn now, with its join
test('row 14: the pit lane is one outline: a drawn physics apron runs from the main apron before the lane, round its ends and along its outer edge, back onto the main apron after it, with its join; the D563 wheel case holds on the lane\'s edge', () => {
  // the user, 2026-10-31 17:18: "what about the pit lane included into the apron generation and track all at once"
  const doc = lap('apron outline lap'), lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  const b = exportDoc(doc, { mergeMeshes: false }, { pitLane: lane }), meshes = walkScene(b.scene).meshes;
  const phys = meshes.find((m) => m.name === '1ROAD_APRON_PIT_L'), under = meshes.find((m) => m.name === 'APRONSIDE_PIT_L');
  assert.ok(phys && under && !meshes.some((m) => /^APRONLIP/.test(m.name)), 'the outline: its physics apron and its join, and no lip');
  assert.ok(isDrivable(phys.name) && !isDrivable(under.name), 'only the outline\'s apron is physics');
  let physNode = null; const walk = (n) => { if (n.type === 'mesh' && n.name === phys.name) physNode = n; (n.children || []).forEach(walk); }; walk(b.scene.root);
  assert.deepEqual([physNode.visible, physNode.renderable, physNode.castShadows], [true, true, true], 'the outline\'s physics is drawn like the rest');
  // its full-width rows (apron.js outlineMeshes writes a run's rows as edge/outer vertex pairs; the corners' fans are not pairs and are not read here)
  const P = phys.positions, V = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], full = [];
  for (let i = 0; i + 1 < P.length / 3; i++) { const E = V(i), O = V(i + 1), across = Math.hypot(O[0] - E[0], O[2] - E[2]); if (Math.abs(across - AP.APRON_WIDTH_M) < 1e-3 && E[1] > O[1]) full.push({ E, O, across }); }
  assert.ok(under.positions.length > 0, 'the outline is drawn: its join has vertices');
  // the wheel: every full-width row drops by the main apron's rule, and they run along the lane's own outer edge too (rows more than half the lane's offset farther out
  // from the road's centre line than the road's own edge is)
  const mainE = []; for (const m of meshes.filter((x) => /^1ROAD_APRON_p.*_L$/.test(x.name))) for (let i = 0; i < m.positions.length / 3; i += 2) mainE.push([m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]);
  const st = b.path.samples, nearSt = (p) => { let bd = Infinity, s = 0; for (const q of st) { const d = (q.pos[0] - p[0]) ** 2 + (q.pos[2] - p[2]) ** 2; if (d < bd) { bd = d; s = q.s; } } return { off: Math.sqrt(bd), s }; };
  const edgeOff = nearSt(mainE[0]).off, onLane = full.filter((r) => nearSt(r.E).off > edgeOff + lane.offsetM / 2);
  assert.ok(onLane.length > 50, `full-width rows along the lane's outer edge (${onLane.length})`);
  for (const r of full) { const drop = (r.E[1] - r.O[1]) * 0.86 / r.across; assert.ok(Math.abs(drop - 0.31) <= 0.1, `0.86 m out the outline's apron is ${drop.toFixed(3)} m below its edge`); }
  // one outline, closed: no downforce-ray gap anywhere from 30 m before the lane to 30 m after it (the corners' two halves meet vertex for vertex)
  const s0 = b.pitLane.joins.leave.s, s1 = b.pitLane.joins.rejoin.s;
  const g = rayGaps(meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length), st, MACH6.downforceRay, { lapM: b.path.lengthM }).filter((x) => x.s != null && x.s >= s0 - 30 && x.s <= s1 + 30);
  assert.deepEqual(g.map((x) => `s ${x.s.toFixed(1)} u ${x.u == null ? '?' : x.u.toFixed(1)}`), [], 'no gap round the outline');
  // it joins the main apron either side: some of its vertices are the main apron's edge points, to a millimetre, before the leave and after the rejoin
  const joined = []; for (let i = 0; i < P.length / 3; i++) { const p = V(i); if (mainE.some((q) => Math.hypot(...sub(p, q)) < 1e-3)) joined.push(nearSt(p).s); }
  assert.ok(joined.some((s) => s < s0) && joined.some((s) => s > s1), `the outline meets the main apron before the leave and after the rejoin (at s ${joined.map((s) => s.toFixed(0)).join(', ')})`);
});

// AMENDED (D593, the chair's 21:58 and 23:23, the user's 21:58: "we need to somehow revert back to what we had originally with the apron", after the wheels sank through
// a drawn lip, the gap between drawn and physics): what is drawn is 0.4.34's apron, THE PHYSICS ITSELF, the plank and its join, vertex for vertex; no lip, nothing hidden.
// Kept of D593: the apron's material (t180b_apron) is the road's own asphalt at LIP_SHADE, and the pit lane's outline has the same drawn plank and join.
test('row 15: the apron wears the road\'s own asphalt a little darker: t180b_apron is the road material\'s texture with its ambient, diffuse and specular at LIP_SHADE, on the tops and the joins', () => {
  const prop = (x, n) => x.props.find((p) => p.name === n).value[0];
  for (const [label, doc] of EDGES) {
    const { out } = build(doc, {});
    const top = tops(out)[0].children[0], road = out.root.children.find((c) => /^CELL_/.test(c.name) && c.matrix === tops(out)[0].matrix).children[0];
    const own = out.materials[road.material], ap = out.materials[top.material];
    assert.equal(ap.name, 't180b_apron', `${label}: the apron's own material, at the index it had`);
    assert.deepEqual(ap.samplers, own.samplers, `${label}: the road's own texture`); assert.ok(own.samplers.length > 0 || label, 'control');
    for (const n of ['ksAmbient', 'ksDiffuse', 'ksSpecular']) assert.ok(Math.abs(prop(ap, n) - prop(own, n) * AP.LIP_SHADE) < 1e-12 && prop(ap, n) < prop(own, n), `${label}: ${n} ${prop(ap, n)} against the road's ${prop(own, n)}`);
    for (const a of [...tops(out), ...sides(out)]) assert.equal(a.children[0].material, top.material, `${label} ${a.name}: on the apron's material`);
  }
});// AMENDED (D604 redo, the user 2026-11-01 10:32: "the apron itself connects right to the other one without having an extra thicker bottom than we need"): the join is in the skin; each top is still apronOf's byte for byte, and its run's outer row in the skin is apronOf's join's outer
// row (positions and normals) byte for byte, on the skin's material (the road's asphalt in its shade, row 3), scenery
test('row 16: every apron top is exactly apronOf\'s, byte for byte, and the run under it, in its skin, is apronOf\'s run; all drawn (visible, renderable, casting shadows)', () => {
  const bytes = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  for (const [label, doc] of EDGES) {
    const { mesh, out } = build(doc, {}), K = mesh._state.pieces[0].K;
    assert.ok(tops(out).length > 0 && sides(out).length === 0, `${label}: tops, and no join node`);
    for (const a of tops(out)) {
      const m = a.children[0], road = out.root.children.find((c) => /^CELL_/.test(c.name) && c.matrix === a.matrix).children[0], left = /^APRONL_/.test(a.name);
      const want = AP.apronOf(road, K, left ? K - 1 : 0, {}, { top: m.name, side: 'x' });
      for (const fl of ['positions', 'normals', 'uvs', 'indices']) assert.ok(bytes(m[fl]).equals(bytes(want.top[fl])), `${label} ${m.name}: its ${fl} are apronOf's top's, byte for byte`);
      assert.deepEqual([m.visible, m.renderable, m.castShadows], [true, true, true], `${label} ${m.name}: drawn`);
      assert.equal(out.materials[m.material].name, 't180b_apron', `${label} ${m.name}: on the apron's material`); assert.ok(isDrivable(m.name), `${label} ${m.name}: the top is physics`);
      // AMENDED (D604 hull): apronOf's run is RUN_COLUMNS a row (the tip first, the skin's edge last); the skin carries all but its last, byte for byte
      const { sk, R, J, at } = runOf(out, a);
      for (let i = 0; i < R; i++) for (let j = 0; j < J; j++) for (const fl of ['positions', 'normals']) assert.ok(bytes(sk[fl].subarray(at(i, j) * 3, at(i, j) * 3 + 3)).equals(bytes(want.side[fl].subarray((i * (J + 1) + j) * 3, (i * (J + 1) + j) * 3 + 3))), `${label} ${sk.name} run row ${i} point ${j}: its ${fl} are apronOf's run's`);
      assert.deepEqual([sk.visible, sk.renderable, sk.castShadows], [true, true, true], `${label} ${sk.name}: drawn`);
      assert.equal(out.materials[sk.material].name, 't180b_underskin', `${label} ${sk.name}: the skin's own material`); assert.ok(!isDrivable(sk.name), `${label} ${sk.name}: scenery`);
    }
  }
});
// THE PHYSICS THE USER DROVE, PINNED (the 17:1x amendment: "the sides work very well compared to hand made tracks for stopping wheel dropping off and clipping into the
// track"; its falsifier: a wheel that behaves differently anywhere at the edge means the physics was touched). The sha256 of every physics apron node's name, material name,
// positions, normals, uvs and indices on the three edges above, in scene order, as land-0434 a93ae51 writes them (the export he drove): S\d593\physdigest.js on that tree.
// A change here changes what his wheels ride, which is his call, not a test to update.
const PHYSICS_SHA256 = 'ecb0db14aee953a309e9f675cdf4f6b8eaedcb4722e2b85e39c3d9c79cb51d75';
test('row 17: the physics apron is byte for byte what the user drove (pinned at a93ae51), on a flat, a banked and a cupped edge', () => {
  const h = require('crypto').createHash('sha256'), bytes = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  for (const [, doc] of EDGES) { const { out } = build(doc, {}); for (const a of tops(out)) { const m = a.children[0]; h.update(m.name); h.update(out.materials[m.material].name); for (const f of ['positions', 'normals', 'uvs', 'indices']) h.update(bytes(m[f])); } }
  assert.equal(h.digest('hex'), PHYSICS_SHA256);
});

// ── D593: the pit IS the track (the user, 18:11: "the pit and apron geometry clip through each other... I want it to look exactly how it does on the rest of the track
// like the pit IS the track"; 18:13, from below: "a big gap") ──
// CLIPS: an edge of one triangle passing through the inside of another of a different mesh (more than 0.1 mm off its plane on both sides, more than 0.1 mm inside its
// edges), between two triangles that share no vertex (welded within 1 mm), counted apart for the DRAWN meshes (renderable and visible) and the PHYSICS ones (1ROAD_…).
// HOLES: edges used by one triangle over all the drawn SURFACES together (road, lane, infill, lip, underside, skins; welded within 2 mm), around the lane's two ends.
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function acMeshes(b) { const out = []; const walk = (n) => { if (n.type === 'mesh') out.push(n); (n.children || []).forEach(walk); }; walk(b.acScene.root); return out; }
// sameMesh (D604): count a mesh clipping ITSELF too (a fold of an offset surface is one mesh); row 18 counts between meshes only, as before
function clipCount(meshes, lo, hi, { sameMesh = false } = {}) {
  const EPS = 1e-4, WELD = 1e-3, tris = [];
  meshes.forEach((m, mi) => {
    const drawn = m.renderable !== false && m.visible !== false, physics = /^1(?:ROAD|GRIP\d{3})_/.test(m.name), P = m.positions, I = m.indices;
    if (!drawn && !physics) return;
    for (let t = 0; t < I.length; t += 3) {
      const v = [0, 1, 2].map((k) => [P[I[t + k] * 3], P[I[t + k] * 3 + 1], P[I[t + k] * 3 + 2]]);
      if (v.every((p) => p.some((x, k) => x < lo[k] || x > hi[k]))) continue;
      tris.push({ v, mi, drawn, physics, bl: [0, 1, 2].map((k) => Math.min(v[0][k], v[1][k], v[2][k])), bh: [0, 1, 2].map((k) => Math.max(v[0][k], v[1][k], v[2][k])), keys: v.map((p) => p.map((x) => Math.round(x / WELD)).join(',')) });
    }
  });
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const pierces = (p, q, a, b, c) => {
    const n = cross(sub(b, a), sub(c, a)), ln = Math.hypot(...n); if (!(ln > 1e-12)) return false;
    const u = n.map((x) => x / ln), dp = dot3(sub(p, a), u), dq = dot3(sub(q, a), u);
    if (!((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS))) return false;
    const s = dp / (dp - dq), x = [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, p[2] + (q[2] - p[2]) * s];
    for (const [e0, e1] of [[a, b], [b, c], [c, a]]) { const inward = cross(u, sub(e1, e0)); if (dot3(sub(x, e0), inward) / Math.hypot(...inward) <= EPS) return false; }
    return true;
  };
  const CELL = 2, grid = new Map();
  tris.forEach((t, id) => { for (let i = Math.floor(t.bl[0] / CELL); i <= Math.floor(t.bh[0] / CELL); i++) for (let j = Math.floor(t.bl[1] / CELL); j <= Math.floor(t.bh[1] / CELL); j++) for (let k = Math.floor(t.bl[2] / CELL); k <= Math.floor(t.bh[2] / CELL); k++) { const kk = `${i},${j},${k}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(id); } });
  const seen = new Set(), out = { drawn: 0, physics: 0, where: [] };
  for (const list of grid.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
    const A = tris[list[x]], B = tris[list[y]]; if (A.mi === B.mi && !sameMesh) continue;
    const pk = `${Math.min(list[x], list[y])}:${Math.max(list[x], list[y])}`; if (seen.has(pk)) continue; seen.add(pk);
    if (A.keys.some((k) => B.keys.includes(k)) || A.bh.some((h, k) => h < B.bl[k]) || B.bh.some((h, k) => h < A.bl[k])) continue;
    const fam = A.drawn && B.drawn ? 'drawn' : A.physics && B.physics ? 'physics' : null; if (!fam) continue;
    let hit = false; for (let i = 0; i < 3 && !hit; i++) hit = pierces(A.v[i], A.v[(i + 1) % 3], ...B.v) || pierces(B.v[i], B.v[(i + 1) % 3], ...A.v);
    if (hit) { out[fam]++; if (out.where.length < 6) out.where.push(`${meshes[A.mi].name} × ${meshes[B.mi].name} at ${A.v[0].map((v) => v.toFixed(1))}`); }
  }
  return out;
}
// STRICT (D593 overnight): an edge used by one drawn triangle is open, T-junctions included. A first form credited a T-junction (one long edge laid along several
// short ones) as closed; one such, an apron join's long edge along the lane skin's end row, rendered as a dotted crack with the sky behind it.
// OVERLAPS and SLIVERS (the user, 18:54, "still geometry clipping inconsistencies", which the clip count could not see): over the drawn SURFACES round the lane,
// two triangles of different meshes in one plane (each vertex within 2 mm of the other's plane, normals within 2°, either way round) overlapping by more than 1 cm²
// (a surface drawn twice in one place: z-fighting), and triangles thinner than 1 cm (twice their area over their longest edge)
function overlapsAndSlivers(meshes, lo, hi) {
  const surf = meshes.filter((m) => m.renderable !== false && m.visible !== false && /^(1(?:ROAD|GRIP\d{3})_|APRON|UNDERSKIN)/.test(m.name)), tris = [], slivers = [];
  surf.forEach((m, mi) => {
    for (let t = 0; t < m.indices.length; t += 3) {
      const v = [0, 1, 2].map((k) => [m.positions[m.indices[t + k] * 3], m.positions[m.indices[t + k] * 3 + 1], m.positions[m.indices[t + k] * 3 + 2]]);
      if (v.every((p) => p.some((x, k) => x < lo[k] || x > hi[k]))) continue;
      const n = cross3(sub(v[1], v[0]), sub(v[2], v[0])), a2 = Math.hypot(...n); if (!(a2 > 1e-12)) continue;
      const longest = Math.max(Math.hypot(...sub(v[1], v[0])), Math.hypot(...sub(v[2], v[1])), Math.hypot(...sub(v[0], v[2])));
      if (a2 / longest < 0.01) slivers.push(`${m.name} ${(a2 / longest).toFixed(4)} m at ${v[0].map((x) => x.toFixed(2))}`);
      tris.push({ v, mi, u: n.map((x) => x / a2), bl: [0, 1, 2].map((k) => Math.min(v[0][k], v[1][k], v[2][k]) - 2e-3), bh: [0, 1, 2].map((k) => Math.max(v[0][k], v[1][k], v[2][k]) + 2e-3) });
    }
  });
  const area2 = (P) => { let s2 = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; s2 += p[0] * q[1] - q[0] * p[1]; } return s2 / 2; };
  const overlapArea = (A, B) => {
    const e1 = (() => { const a = sub(A.v[1], A.v[0]); const l = Math.hypot(...a); return a.map((x) => x / l); })(), e2 = cross3(A.u, e1), to2 = (p) => { const d = sub(p, A.v[0]); return [dot3(d, e1), dot3(d, e2)]; };
    const a = A.v.map(to2), sg = Math.sign(area2(a)); let poly = B.v.map(to2);
    for (let i = 0; i < 3 && poly.length; i++) {
      const p0 = a[i], p1 = a[(i + 1) % 3], side = (q) => sg * ((p1[0] - p0[0]) * (q[1] - p0[1]) - (p1[1] - p0[1]) * (q[0] - p0[0])), out = [];
      for (let j = 0; j < poly.length; j++) { const c = poly[j], d = poly[(j + 1) % poly.length], sc = side(c), sd = side(d); if (sc >= 0) out.push(c); if ((sc >= 0) !== (sd >= 0)) { const t = sc / (sc - sd); out.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t]); } }
      poly = out;
    }
    return poly.length >= 3 ? Math.abs(area2(poly)) : 0;
  };
  const CELL = 2, grid = new Map(), cosA = Math.cos(2 * DEG), seen = new Set(), overlaps = [];
  tris.forEach((t, id) => { for (let i = Math.floor(t.bl[0] / CELL); i <= Math.floor(t.bh[0] / CELL); i++) for (let j = Math.floor(t.bl[1] / CELL); j <= Math.floor(t.bh[1] / CELL); j++) for (let k = Math.floor(t.bl[2] / CELL); k <= Math.floor(t.bh[2] / CELL); k++) { const kk = `${i},${j},${k}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(id); } });
  for (const list of grid.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
    const A = tris[list[x]], B = tris[list[y]]; if (A.mi === B.mi) continue;
    const pk = `${Math.min(list[x], list[y])}:${Math.max(list[x], list[y])}`; if (seen.has(pk)) continue; seen.add(pk);
    if (A.bh.some((h, k) => h < B.bl[k]) || B.bh.some((h, k) => h < A.bl[k]) || Math.abs(dot3(A.u, B.u)) < cosA) continue;
    if (B.v.some((p) => Math.abs(dot3(sub(p, A.v[0]), A.u)) > 2e-3) || A.v.some((p) => Math.abs(dot3(sub(p, B.v[0]), B.u)) > 2e-3)) continue;
    const ar = overlapArea(A, B); if (ar > 1e-4) overlaps.push(`${surf[A.mi].name} × ${surf[B.mi].name} ${ar.toFixed(4)} m² at ${A.v[0].map((v) => v.toFixed(2))}`);
  }
  return { overlaps, slivers };
}
function holesAround(meshes, c, R) {
  const WELD = 2e-3, CUT = 2, ids = new Map(), pts = [], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const idOf = (p) => { const k = p.map((x) => Math.floor(x / WELD)); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let l = -1; l <= 1; l++) for (const id of ids.get(`${k[0] + i},${k[1] + j},${k[2] + l}`) || []) if (dist(pts[id], p) <= WELD) return id; const id = pts.length; pts.push(p); const kk = k.join(','); if (!ids.has(kk)) ids.set(kk, []); ids.get(kk).push(id); return id; };
  const edges = new Map();
  // the SURFACES (road, lane, infill, lip, underside, skins): a painted marker is a decal laid on the road, its border open by nature, not a hole in it
  for (const m of meshes.filter((x) => x.renderable !== false && x.visible !== false && /^(1(?:ROAD|GRIP\d{3})_|APRON|UNDERSKIN)/.test(x.name))) for (let t = 0; t < m.indices.length; t += 3) {
    const v = [0, 1, 2].map((k) => [m.positions[m.indices[t + k] * 3], m.positions[m.indices[t + k] * 3 + 1], m.positions[m.indices[t + k] * 3 + 2]]);
    if (v.every((p) => dist(p, c) > R + 5) || !(Math.hypot(...cross3(sub(v[1], v[0]), sub(v[2], v[0]))) > 1e-10)) continue;   // a triangle of no area closes nothing
    const id = v.map(idOf);
    for (const [x, y] of [[id[0], id[1]], [id[1], id[2]], [id[2], id[0]]]) { if (x === y) continue; const k = x < y ? `${x}|${y}` : `${y}|${x}`; edges.set(k, (edges.get(k) || 0) + 1); }
  }
  return [...edges].filter(([, n]) => n === 1).map(([k]) => k.split('|').map((i) => pts[+i])).filter(([a, b]) => dist(a, c) < R - CUT && dist(b, c) < R - CUT).map(([a, b]) => `${a.map((x) => x.toFixed(2))} → ${b.map((x) => x.toFixed(2))}`);
}

// AMENDED (D593, the user 18:54: "still geometry clipping inconsistencies"): the row counted clips and holes; it now also counts coplanar overlaps (z-fighting) and
// slivers under 1 cm, which the clip count cannot see, all 0
test('row 18: the pit IS the track: nothing clips, nothing overlaps in one plane, no sliver under 1 cm (all round the lane), and no open edge drawn round either end', () => {
  const doc = lap('apron pit-is-track lap'), lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  const b = exportDoc(doc, {}, { pitLane: lane }), meshes = acMeshes(b);
  const laneMeshes = meshes.filter((m) => /^1ROAD_PIT_/.test(m.name)); assert.ok(laneMeshes.length > 0, 'control: the lane is in the scene');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of laneMeshes) for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.positions[i + k] - 30); hi[k] = Math.max(hi[k], m.positions[i + k] + 30); }
  const c = clipCount(meshes, lo, hi);
  assert.equal(c.drawn, 0, `drawn triangles clip through each other: ${c.where.join('; ')}`);
  assert.equal(c.physics, 0, `physics triangles clip through each other: ${c.where.join('; ')}`);
  const os = overlapsAndSlivers(meshes, lo, hi);
  assert.deepEqual(os.overlaps.slice(0, 4), [], `${os.overlaps.length} coplanar overlaps (z-fighting) round the lane`);
  assert.deepEqual(os.slivers.slice(0, 4), [], `${os.slivers.length} slivers under 1 cm round the lane`);
  const at = (s) => { let best = b.path.samples[0]; for (const q of b.path.samples) if (Math.abs(q.s - s) < Math.abs(best.s - s)) best = q; return best.pos; };
  for (const [name, s] of [['leave', b.pitLane.joins.leave.s], ['rejoin', b.pitLane.joins.rejoin.s]]) {
    const holes = holesAround(meshes, at(s), 25);
    assert.deepEqual(holes.slice(0, 4), [], `${holes.length} open drawn edges round the ${name}`);
  }
});

// D593, the user 18:54: "a square notch" at the pit's rejoin, from above: the lane's lip stepped from the lane's uv space to the road's in one 2 m row
// AMENDED (D593, the user 21:54-21:55): the lip and its underside are gone; the same check on the filled face round the lane
test('row 19: the lane\'s drawn edge carries one texture along it: no face triangle edge round the lane squeezes more than 1 texture repeat into a metre', () => {
  const doc = lap('apron pit-is-track lap'), lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  const meshes = acMeshes(exportDoc(doc, {}, { pitLane: lane })).filter((m) => /^APRONSIDE_PIT_/.test(m.name));
  assert.ok(meshes.length >= 1, 'control: the lane has its drawn edge');
  const bad = [];
  for (const m of meshes) for (let t = 0; t < m.indices.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    const i = m.indices[t + a], j = m.indices[t + b], d = Math.hypot(m.positions[i * 3] - m.positions[j * 3], m.positions[i * 3 + 1] - m.positions[j * 3 + 1], m.positions[i * 3 + 2] - m.positions[j * 3 + 2]);
    const du = Math.hypot(m.uvs[i * 2] - m.uvs[j * 2], m.uvs[i * 2 + 1] - m.uvs[j * 2 + 1]);
    if (du > 1 * d + 1e-6) bad.push(`${m.name} ${(du / Math.max(d, 1e-9)).toFixed(1)} per m at ${[0, 1, 2].map((k) => m.positions[i * 3 + k].toFixed(2))}`);
  }
  assert.deepEqual(bad.slice(0, 4), [], `${bad.length} face edges round the lane squeeze the texture`);
});

// AMENDED (D593, the chair's 21:58 and 23:23, the user's 21:58: "we need to somehow revert back to what we had originally with the apron", after the wheels sank through
// a drawn lip, the gap between drawn and physics): what is drawn is 0.4.34's apron, THE PHYSICS ITSELF, the plank and its join, vertex for vertex; no lip, nothing hidden.
// Kept of D593: the apron's material (t180b_apron) is the road's own asphalt at LIP_SHADE, and the pit lane's outline has the same drawn plank and join.
// The case he drove: a cupped road with a pit lane.
test('row 20: on a road cupped 15.5° with a pit lane (his case): no lip anywhere, and the outline\'s plank is drawn and has its join', () => {
  const CUP = 15.5;
  let d = extend(D.createDoc('apron cupped pit lap'), { length: 400, family: 'bowl', first: { w: 20, c: CUP } });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report);
  const lane = { side: 'L', leave: { word: r.doc.pieces[0].id, along: 40 }, rejoin: { word: r.doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  const all = acMeshes(exportDoc(r.doc, {}, { pitLane: lane }));
  assert.equal(all.filter((m) => /^APRONLIP/.test(m.name)).length, 0, 'no lip anywhere');
  const plank = all.filter((m) => /^1ROAD_APRON_PIT_/.test(m.name)), join = all.filter((m) => /^APRONSIDE_PIT_/.test(m.name));
  assert.ok(plank.length > 0 && join.length > 0, 'the outline has its plank and its join');
  for (const m of [...plank, ...all.filter((x) => /^1(ROAD|GRIP\d{3})_APRON_/.test(x.name))]) assert.deepEqual([m.visible !== false, m.renderable !== false], [true, true], `${m.name}: drawn`);
});

// D593, the user 18:54, on the pit's rejoin from above: "z-fighting stripes". Not two surfaces (row 18 counts those, 0): the merge part's texture, stretched 80
// times across, read as stripes; mesh.js lays one u per piece from the piece's own profile, and the lane's diverge and merge are blends of two widths
test('row 21: the lane surface wears the road texture at the road scale where it narrows too: on every lane triangle u changes 0.1 a metre, within 10%', () => {
  const doc = lap('apron pit-is-track lap'), lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  const parts = acMeshes(exportDoc(doc, {}, { pitLane: lane })).filter((m) => /^1ROAD_PIT_(in|body|out)_/.test(m.name));
  assert.ok(parts.some((m) => /_in_/.test(m.name)) && parts.some((m) => /_out_/.test(m.name)), 'control: the lane has its diverge and merge parts');
  const bad = [];
  for (const m of parts) for (let t = 0; t < m.indices.length; t += 3) {
    const v = [0, 1, 2].map((k) => m.indices[t + k]), p = v.map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]), u = v.map((i) => m.uvs[i * 2]);
    const e1 = sub(p[1], p[0]), e2 = sub(p[2], p[0]), n = cross3(e1, e2), nn = dot3(n, n); if (!(nn > 1e-12)) continue;
    // u's gradient in the triangle's plane: (Δu1 (e2 × n) + Δu2 (n × e1)) / |n|²
    const g = [0, 1, 2].map((k) => ((u[1] - u[0]) * cross3(e2, n)[k] + (u[2] - u[0]) * cross3(n, e1)[k]) / nn), rate = Math.hypot(...g);
    if (Math.abs(rate - 0.1) > 0.01) bad.push(`${m.name} ${rate.toFixed(4)} a metre at ${p[0].map((x) => x.toFixed(2))}`);
  }
  assert.deepEqual(bad.slice(0, 4), [], `${bad.length} lane triangles wear the texture at another scale`);
});

// D593 overnight: the outline's caps across the lane's ends lie in the cross-section's plane, where the outline's own normal rules have no sign; half of them faced
// into the lane and were culled, and the sky showed through the leave from below (pit-leave-low). Each must face out of the lane's end
// AMENDED BY NAME (2026-11-02, the user on the pit's rejoin from above, "looks small but is fatal": a notch in the lane's edge, and a seam across the plank at the
// leave): the caps were the notch. The plank walked across the lane's end, out and back, a square step as wide as the lane's end (0.5 m since 8fb6ecc); now it goes
// straight from the road's row to the lane's and a fan in the road's plane covers the end, so NO plank triangle lies across the road there, and the lane's ends are
// 0.1 m wide again. Any join triangle that still lies across the road faces out of the lane's end, as before
test('row 22: the lane\'s ends have no cap and no step: no plank triangle lies across the road there, the lane is at most 0.1 m wide where it leaves and rejoins, and a join triangle across the road faces out of the lane', () => {
  const doc = lap('apron pit-is-track lap'), lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  const b = exportDoc(doc, {}, { pitLane: lane }), outline = acMeshes(b).filter((m) => /^(1ROAD_APRON|APRONSIDE)_PIT_/.test(m.name));
  assert.ok(outline.length >= 2, 'control: the outline has its plank and its join');
  for (const [name, s] of [['leave', b.pitLane.joins.leave.s], ['rejoin', b.pitLane.joins.rejoin.s]]) assert.ok(b.pitLane.widthAt(s) <= 0.1 + 1e-9, `the lane is ${b.pitLane.widthAt(s).toFixed(2)} m wide at its ${name}: a step that wide in the road's edge`);
  const at = (s) => { let best = b.path.samples[0]; for (const q of b.path.samples) if (Math.abs(q.s - s) < Math.abs(best.s - s)) best = q; return best; };
  const ends = [[at(b.pitLane.joins.leave.s), -1], [at(b.pitLane.joins.rejoin.s), 1]];   // out of the lane: back along the road at the leave, on along it at the rejoin
  let caps = 0; const bad = [];
  for (const m of outline) for (let t = 0; t < m.indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => { const i = m.indices[t + k]; return [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]; });
    const n = cross3(sub(p[1], p[0]), sub(p[2], p[0])), nl = Math.hypot(...n); if (!(nl > 1e-12)) continue;
    const c = p.reduce((a, q) => a.map((x, k) => x + q[k] / 3), [0, 0, 0]);
    const [end, way] = ends.reduce((a, e) => (Math.hypot(...sub(e[0].pos, c)) < Math.hypot(...sub(a[0].pos, c)) ? e : a));
    const T = unit3(end.T), along = dot3(n, T) / nl;
    if (Math.abs(along) < Math.cos(25 * DEG) || Math.hypot(...sub(end.pos, c)) > 30) continue;
    if (/^1ROAD_APRON_/.test(m.name)) { caps++; continue; }
    if (along * way <= 0) bad.push(`${m.name} triangle ${t / 3} faces into the lane at ${c.map((x) => x.toFixed(2))}`);
  }
  assert.equal(caps, 0, `${caps} plank triangles lie across the road at the lane's ends: a cap, the notch`);
  assert.deepEqual(bad.slice(0, 4), [], `${bad.length} join triangles across the road face into the lane`);
});

// D604, the user 2026-11-01 08:49: "the apron needs to connect to the other side of the track at the other apron, which creates a thickening of the track… the track
// gets 3D depth instead of a slice of a mesh". The skin is at the plank's drop (underskin.js UNDERSKIN_OFFSET_M), so on a flat road the join under each plank is level:
// the slab's bottom runs at one depth from one apron's outer row, under the road, to the other's
// AMENDED (D604 redo): the join is the run in the skin (row 2); the same check on it, its tip row against the skin's own edge vertex of the same row
// AMENDED (D604 hull, the user's red line, 2026-11-01 10:44: the bottom one smooth curve from one plank's tip to the other's, about 1.5 m under the road): the slab became a hull: under a flat road the skin is UNDERSKIN_OFFSET_M (1.5 m) down all across, and each run goes from the tip
// only down and in, point by point, to the skin's edge (the plank's tip is 0.93 m down, so the run is no longer level)
test('row 23: the road is a hull: on a flat road the skin is 1.5 m under it all across, and each run goes from the plank tip only down and in to the skin edge', () => {
  const { out } = build(flat(), {});
  assert.equal(S.UNDERSKIN_OFFSET_M, 1.5, 'the hull is 1.5 m under the road');
  assert.ok(tops(out).length > 0, 'control: the planks');
  const bad = [];
  for (const sk of out.root.children.filter((c) => /^SKIN_/.test(c.name)).map((c) => c.children[0])) {
    const road = out.root.children.find((c) => /^CELL_/.test(c.name) && c.name.replace(/^CELL_/, '') === sk.name.replace(/^UNDERSKIN_/, '')).children[0];
    const ys = new Set(); for (let i = 0; i < road.positions.length / 3; i++) ys.add(road.positions[i * 3 + 1].toFixed(4));
    assert.equal(ys.size, 1, `control: ${road.name} is flat`);
    const y0 = road.positions[1], n = road.positions.length / 3;
    for (let i = 0; i < Math.min(n, sk.positions.length / 3); i++) if (sk.positions[i * 3 + 1] < y0 - 1.5 - 1e-4 || sk.positions[i * 3 + 1] > y0 - 0.9) bad.push(`${sk.name} vertex ${i} at ${sk.positions[i * 3 + 1].toFixed(4)}`);
  }
  for (const tp of tops(out)) {
    const { sk, R, J, at } = runOf(out, tp), y = (i, j) => sk.positions[at(i, j) * 3 + 1], x = (i, j) => Math.abs(sk.positions[at(i, j) * 3]);
    for (let i = 0; i < R; i++) for (let j = 1; j <= J; j++) if (!(y(i, j) < y(i, j - 1) + 1e-6 && x(i, j) < x(i, j - 1))) bad.push(`${tp.name} row ${i} point ${j}: not down and in from the last`);
    for (let i = 0; i < R; i++) if (Math.abs(y(i, J) - (tp.children[0].positions[i * 6 + 1] - 1.5)) > 1e-4) bad.push(`${tp.name} row ${i}: the skin edge is not 1.5 m under the road edge`);
  }
  assert.deepEqual(bad.slice(0, 4), [], `${bad.length} faults`);
});

// D604: the offset underside folds where the road's cross-section is convex with a radius under the slab's depth (an edge turned down), and an offset that folds is one
// mesh cutting itself, which row 18's count (between meshes) cannot see
test('row 24: the slab does not cut itself: on flat, banked, cupped and turned-down edges and the pit lap, no drawn triangle clips another, within one mesh or between meshes', () => {
  const ALL = [-Infinity, -Infinity, -Infinity], NONE = [Infinity, Infinity, Infinity];
  const pit = lap('apron slab lap'), lane = { side: 'L', leave: { word: pit.pieces[0].id, along: 40 }, rejoin: { word: pit.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  // an open road's scene (withApron's, cell frames) in world space: each mesh's points through its node's matrix (row vector times M, as apron.js toWorld); a closed
  // lap through the whole export
  const world = (scene) => { const out = []; for (const c of scene.root.children) for (const m of (c.children || []).filter((x) => x.type === 'mesh')) { const M = c.matrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], P = m.positions, W = new Float64Array(P.length); for (let i = 0; i < P.length; i += 3) for (let j = 0; j < 3; j++) W[i + j] = P[i] * M[j] + P[i + 1] * M[4 + j] + P[i + 2] * M[8 + j] + M[12 + j]; out.push({ ...m, positions: W }); } return out; };
  const cases = [...EDGES.map(([label, doc]) => [label, () => world(build(doc, {}).out)]), ['turned down 20°', () => world(build(flat(60, { e: -20, s: 0.8 }), {}).out)], ['turned down 30° (the floor), narrow zone', () => world(build(flat(60, { e: -30, s: 0.9 }), {}).out)], ['the pit lap', () => acMeshes(exportDoc(pit, {}, { pitLane: lane }))]];
  for (const [label, meshesOf] of cases) {
    const meshes = meshesOf(), c = clipCount(meshes, ALL, NONE, { sameMesh: true });
    // AMENDED (D604 redo): the core road's joins are in its skins; the control is the slab's underside and the planks
    assert.ok(meshes.some((m) => /^UNDERSKIN_/.test(m.name)) && meshes.some((m) => /^1ROAD_APRON_/.test(m.name)), `${label}: control: the slab's underside and the planks are there`);
    assert.equal(c.drawn, 0, `${label}: drawn triangles clip: ${c.where.join('; ')}`);
    assert.equal(c.physics, 0, `${label}: physics triangles clip: ${c.where.join('; ')}`);
  }
});

// D604 redo (the user 2026-11-01 10:32: "the apron itself connects right to the other one without having an extra thicker bottom than we need"): the skin's edge hung along the edge vertex's OWN normal sat off under a curved edge, and the run from the plank's tip back to it was a second,
// inverted apron seen from below. The brief's guard: the bottom follows the road's shape and never comes within about 0.15 m of it (a chord across a 57° cup would cut it).
// AMENDED (D604 hull, the user's red line, 2026-11-01 10:44: the bottom one smooth curve from one plank's tip to the other's, about 1.5 m under the road): the run is a curve; its slope in the section (its fall going in) only flattens from the tip in (no S, the shoulder the first hull had),
// and it runs on into the skin with no corner (its last span and the skin's first, from the edge in, within 12°)
test('row 25: the hull\'s bottom is one smooth curve tip to tip: on a banked and two cupped edges each run only flattens from the tip in and runs on into the skin with no corner, and the bottom keeps 0.15 m off the road', () => {
  const cases = [EDGES[1], EDGES[2], ['cupped 57° (the brief)', extend(D.createDoc('cup57'), { length: 60, family: 'bowl', first: { w: 20, c: 57 } })]];
  for (const [label, doc] of cases) {
    const { mesh, out } = build(doc, {}), K = mesh._state.pieces[0].K;
    assert.ok(tops(out).length > 0, `${label}: control: planks`);
    let steepens = 0, corner = 0, closest = Infinity;
    for (const tp of tops(out)) {
      const cellNode = out.root.children.find((c) => /^CELL_/.test(c.name) && c.matrix === tp.matrix), road = cellNode.children[0], left = /^APRONL_/.test(tp.name);
      const rows = AP.sideRows(road, K, left ? K - 1 : 0), { sk, R, C, J, at, edge } = runOf(out, tp), p = (x) => [0, 1, 2].map((a) => sk.positions[x * 3 + a]);
      for (let i = 0; i < R; i++) {
        // the fall going in, in the section (q.N up, −q.X in), span by span from the tip, then the skin's first span from its edge in
        const q = rows[i], fall = (a, b) => { const d = sub(p(b), p(a)); return Math.atan2(-dot3(d, q.N), -dot3(d, q.X)); };
        let last = Infinity; for (let j = 0; j < J; j++) { const f = fall(at(i, j), at(i, j + 1)); steepens = Math.max(steepens, f - last); last = f; }
        const inner = edge(i) + (left ? -1 : 1);
        corner = Math.max(corner, Math.abs(fall(at(i, J), inner) - last));
      }
      // the bottom's clearance: every skin vertex against every road triangle of its own cell (the skin hangs under its own cell)
      const P = road.positions, I = road.indices, tri = (t) => [0, 1, 2].map((k) => [P[I[t + k] * 3], P[I[t + k] * 3 + 1], P[I[t + k] * 3 + 2]]);
      for (let v = 0; v < sk.positions.length / 3; v += 3) {
        const q = [sk.positions[v * 3], sk.positions[v * 3 + 1], sk.positions[v * 3 + 2]];
        for (let t = 0; t < I.length; t += 3) closest = Math.min(closest, pointTri(q, ...tri(t)));
      }
    }
    assert.ok(steepens < (1 * Math.PI) / 180, `${label}: a run steepens by ${((steepens * 180) / Math.PI).toFixed(2)}° going in (it should only flatten)`);
    assert.ok(corner < (12 * Math.PI) / 180, `${label}: a run meets the skin at a corner of ${((corner * 180) / Math.PI).toFixed(1)}°`);
    assert.ok(closest >= 0.15, `${label}: the bottom comes ${closest.toFixed(3)} m from the road (the floor is 0.15 m)`);
  }
});
// the least distance from a point to a triangle (the closest point on its face, edges or corners)
function pointTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot3(ab, ap), d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
  const bp = sub(p, b), d3 = dot3(ab, bp), d4 = dot3(ac, bp); if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return Math.hypot(...sub(p, [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]])); }
  const cp = sub(p, c), d5 = dot3(ab, cp), d6 = dot3(ac, cp); if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return Math.hypot(...sub(p, [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]])); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); const bc = sub(c, b); return Math.hypot(...sub(p, [b[0] + w * bc[0], b[1] + w * bc[1], b[2] + w * bc[2]])); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return Math.hypot(...sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
}

// The user 2026-11-02, on the pit's leave from below ("pit-leave-low"): a seam in the bottom. The hull hangs deeper under an edge that rises (underskin.js
// hullDepth), but beside the lane every skin hangs at the plain depth, so on his own cupped track the bottom under the road's edge dropped 0.83 m in one 2 m row where the
// lane began. It now eases out over apron.js PIT_HULL_EASE_M before the leave and after the rejoin (padEase), so the bottom has no step there
test('row 26: beside the pit lane the hull\'s bottom has no step: on a cupped road the skin under the lane\'s side of the road, 0.5 m in from its edge, changes depth by at most 0.03 m a metre over the 40 m before the leave and after the rejoin', () => {
  let d = extend(D.createDoc('apron cupped pit lap'), { length: 400, family: 'bowl', first: { w: 20, c: 15.5 } });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report);
  const lane = { side: 'L', leave: { word: r.doc.pieces[0].id, along: 120 }, rejoin: { word: r.doc.pieces[0].id, along: 320 }, offsetM: 12, width: 8, divergeM: 60, mergeM: 60, speedKmh: 80 };
  const b = exportDoc(r.doc, {}, { pitLane: lane }), all = acMeshes(b);
  const tris = (re) => { const out = []; for (const m of all.filter((x) => re.test(x.name) && x.visible !== false && x.renderable !== false)) for (let t = 0; t < m.indices.length; t += 3) out.push([0, 1, 2].map((k) => { const i = m.indices[t + k]; return [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]; })); return out; };
  const road = tris(/^1(ROAD|GRIP\d{3})_p/), skin = tris(/^UNDERSKIN_/);
  // the nearest hit along a ray (Möller–Trumbore), from o along unit d, or null
  const hit = (list, o, dd) => { let best = null; for (const [a, b2, c] of list) { const e1 = sub(b2, a), e2 = sub(c, a), pv = cross3(dd, e2), det = dot3(e1, pv); if (Math.abs(det) < 1e-12) continue; const tv = sub(o, a), u = dot3(tv, pv) / det; if (u < 0 || u > 1) continue; const qv = cross3(tv, e1), v = dot3(dd, qv) / det; if (v < 0 || u + v > 1) continue; const t = dot3(e2, qv) / det; if (t > 0 && (best === null || t < best)) best = t; } return best; };
  const depthAt = (s) => { const x = b.pitLane.at(s), down = x.U.map((v) => -v), o = sub(x.edge, x.L.map((v) => v * 0.5)).map((v, k) => v - down[k] * 3); const tr = hit(road, o, down), ts = hit(skin, o, down); return tr === null || ts === null ? null : ts - tr; };
  // a quarter metre off each join: at the join itself the ray runs down the line the road, the lane and the infill share
  const { leave, rejoin } = b.pitLane.joins;
  for (const [name, from, to] of [['leave', leave.s - 40.25, leave.s - 0.25], ['rejoin', rejoin.s + 0.25, rejoin.s + 40.25]]) {
    const dep = []; for (let s = from; s <= to + 1e-9; s += 1) dep.push(depthAt(s));
    assert.ok(dep.every((x) => x !== null), `${name}: control: the ray meets the road and the skin at every metre (misses at ${dep.map((x, i) => (x === null ? from + i : null)).filter((x) => x !== null).map((x) => x.toFixed(0)).join(', ')})`);
    const far = name === 'leave' ? dep[0] : dep[dep.length - 1], near = name === 'leave' ? dep[dep.length - 1] : dep[0];
    assert.ok(far > near + 0.05, `${name}: control: the hull is deeper 40 m from the lane (${far.toFixed(3)} m) than at it (${near.toFixed(3)} m)`);
    let worst = 0; for (let i = 1; i < dep.length; i++) worst = Math.max(worst, Math.abs(dep[i] - dep[i - 1]));
    assert.ok(worst <= 0.03, `${name}: the bottom steps ${worst.toFixed(3)} m in one metre beside the lane`);
  }
});

// A plank hangs from its own cell's row (sideRows: the section's up is its centre column's normal, Math.floor(K / 2)). On a piece whose column count K is even that
// column is half a column off the middle, so on a cupped section its normal leans: 0.2° on a 16° cup 32 m wide, after a tube (K 66). The next piece (K 65) hangs its
// first plank row from the true middle, so the two planks met at the road's edge and parted by 7.8 mm at their outer rows: a crack in a surface the car drives on,
// at every such joint since the apron was built (found on two of the user's tracks, 6 to 8 mm). The export welds the planks' rows across a joint, as it welds the
// road's (acready.js weldApronJoints)
test('row 27: the planks meet across a piece joint where the road\'s column count goes from even to odd: each side\'s plank ends on the next piece\'s first row to a millimetre, its outer row and the run under it too', () => {
  let d = extend(D.createDoc('apron joint parity'), { length: 100, family: 'bowl', first: { w: 60, t: 360 } });
  d = extend(d, { length: 100, targets: { t: 0, w: 32 } });
  d = extend(d, { length: 100, targets: { c: 16 } });
  d = extend(d, { length: 200, targets: {} });
  const segs = A.toSegments(d), lift = (q) => A.offsetPath(d, segs, q), start = { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch };
  const { buildMesh } = require('../src/geom/index.js'), st = buildMesh(A.toPath(d).path, segs, { selfCheck: false })._state, K = (id) => st.pieces[segs.findIndex((g) => g.id === id)].K;
  assert.deepEqual([K('p3') % 2, K('p4') % 2], [0, 1], `control: the cup ramp's column count is even and the next piece's odd (${K('p3')}, ${K('p4')})`);
  const b = FW.buildFromSegments(segs, { name: 'apron parity', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: true }), test: true, mergeMeshes: false });
  const all = b.acScene.root.children.filter((n) => n.type === 'mesh'), cellNo = (n) => +((/_(\d+)$/.exec(n.name) || [0, 1])[1]);
  const pt = (n, i) => [n.positions[3 * i], n.positions[3 * i + 1], n.positions[3 * i + 2]], mm = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) * 1000;
  const skin = all.filter((n) => /^UNDERSKIN_p4_/.test(n.name));
  for (const tag of ['R', 'L']) {
    const planks = (p) => all.filter((n) => new RegExp(`^1ROAD_APRON_${p}_body_0_${tag}(_\\d+)?$`).test(n.name)).sort((x, y) => cellNo(x) - cellNo(y));
    const last = planks('p3').pop(), first = planks('p4')[0], n = last.positions.length / 3;
    assert.ok(last && first, `control: ${tag} has its planks either side of the joint`);
    const gapE = mm(pt(last, n - 2), pt(first, 0)), gapO = mm(pt(last, n - 1), pt(first, 1));
    assert.ok(gapE <= 1 && gapO <= 1, `${tag}: at the joint the planks part by ${gapE.toFixed(2)} mm at the road's edge and ${gapO.toFixed(2)} mm at their outer row`);
    const O = pt(first, 1), tip = Math.min(...skin.map((s) => { let m = Infinity; for (let i = 0; i < s.positions.length / 3; i++) m = Math.min(m, mm(pt(s, i), O)); return m; }));
    assert.ok(tip <= 0.01, `${tag}: the run under the next piece's first plank row starts ${tip.toFixed(3)} mm from the plank's outer row: the hull is open there`);
  }
});

// THE LEAN behind row 27's crack, and the larger one it hides. A plank's outward lateral and its up were read at column Math.floor(K / 2), the section's
// middle only when its columns lie evenly either side of the centre line. An edge zone on one side adds columns on that side, so the column read lies metres
// off the centre (7.0 m on a 15° cup 25 m wide with a 35° right edge, laid as the user's TEST 10 is), where the cup has turned the normal, and every plank of
// the piece hangs at the wrong slope (15° there instead of 25°), not only at a joint. The plank now hangs from the section's own middle, its centre line column
test('row 28: every plank hangs at the apron\'s own slope from the road\'s frame, on a cupped piece with an edge zone on one side as on a symmetric one: 25° below the lateral, in the cross-section', () => {
  const { buildMesh } = require('../src/geom/index.js');
  // four sections: a 35° right edge (its middle column 7 m off the centre), a 30° left edge, a plain cup, and a cup ramp after a tube (an even K: the centre half a
  // column off, between two columns), each read on its own piece
  const twoPieces = (first) => extend(extend(D.createDoc('apron lean'), { length: 100, family: 'bowl', first }), { length: 100, targets: {} });
  const afterTube = () => extend(extend(extend(extend(D.createDoc('apron lean'), { length: 100, family: 'bowl', first: { w: 60, t: 360 } }), { length: 100, targets: { t: 0, w: 32 } }), { length: 100, targets: { c: 16 } }), { length: 200, targets: {} });
  for (const [first, d, piece] of [[{ w: 25, c: 15, er: 35 }], [{ w: 25, c: 15, e: 30 }], [{ w: 25, c: 15 }], [{ evenK: true }, afterTube(), 'p3']].map(([f0, d0, p0]) => [f0, d0 || twoPieces(f0), p0 || 'p1'])) {
    const segs = A.toSegments(d), st = buildMesh(A.toPath(d).path, segs, { selfCheck: false })._state.pieces[segs.findIndex((g) => g.id === piece)], U = Array.from(st.Us);
    if (first.evenK) assert.ok(st.K % 2 === 0 && !U.includes(0), `control: the cup ramp after a tube has an even K (${st.K}) and no column on the centre line`);
    if (first.er) assert.ok(Math.abs(U[Math.floor(st.K / 2)]) > 5, `control: with a right edge zone the column Math.floor(K / 2) lies ${U[Math.floor(st.K / 2)].toFixed(2)} m off the centre`);
    const lift = (q) => A.offsetPath(d, segs, q), start = { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch };
    const b = FW.buildFromSegments(segs, { name: 'apron lean', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: true }), test: true, mergeMeshes: false });
    const S = b.path.samples, bad = []; let rows = 0;
    for (const n of b.acScene.root.children.filter((x) => x.type === 'mesh' && x.name.startsWith(`1ROAD_APRON_${piece}_`))) {
      const P = n.positions;
      for (let i = 0; i + 5 < P.length; i += 6) {
        const E = [P[i], P[i + 1], P[i + 2]], O = [P[i + 3], P[i + 4], P[i + 5]], v = sub(O, E); if (Math.hypot(...v) < 0.5) continue;   // a tapered row near the plank's end
        const q = S.reduce((a, x) => (Math.hypot(...sub(x.pos, E)) < Math.hypot(...sub(a.pos, E)) ? x : a)), lat = Math.abs(dot3(v, q.L)), up = dot3(v, q.U), along = dot3(v, q.T);
        const deg = Math.atan2(-up, lat) / DEG; rows++;
        if (Math.abs(deg - AP.APRON_SLOPE_DEG) > 0.05 || Math.abs(along) > 0.01) bad.push(`${n.name}: ${deg.toFixed(2)}° below the lateral, ${(along * 1000).toFixed(0)} mm along the road`);
      }
    }
    assert.ok(rows > 100, `control: ${rows} plank rows read`);
    assert.deepEqual(bad.slice(0, 4), [], `${JSON.stringify(first)}: ${bad.length} of ${rows} plank rows lean`);
  }
});
