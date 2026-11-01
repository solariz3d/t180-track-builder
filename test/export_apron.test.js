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
// D593: the visual lip (APRONLIP…) is gone (the keeper 21:54-21:55: a blade); vlips(scene) finds any, for the rows that hold it to none
const vlips = (scene) => scene.root.children.filter((c) => /^APRONLIP[LR]_/.test(c.name));
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], unit3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
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
// AMENDED (D593, the chair's 21:58 and 23:23, the keeper's 21:58: "we need to somehow revert back to what we had originally with the apron", after the wheels sank through
// a drawn lip, the gap between drawn and physics): what is drawn is 0.4.34's apron, THE PHYSICS ITSELF, the plank and its join, vertex for vertex; no lip, nothing hidden.
// Kept of D593: the apron's material (t180b_apron) is the road's own asphalt at LIP_SHADE, and the pit lane's outline has the same drawn plank and join.
test('row 2: the wedge is closed: the join\'s lower row is the skin\'s edge vertices to the float; no face points into the wedge; the top faces up, the join down', () => {
  const { skinned, out } = build(flat(), { widthM: 2.0 });
  const skins = new Map(skinned.root.children.filter((c) => /^SKIN_/.test(c.name)).map((c) => [c.name.replace(/^SKIN_/, ''), c.children[0]]));
  const topBy = new Map(tops(out).map((a) => [a.name.replace(/^APRON/, ''), a]));
  assert.ok(tops(out).length > 0); assert.equal(sides(out).length, tops(out).length, 'one join under every apron: the wedge is closed on every one');
  for (const sd of sides(out)) {
    const key = sd.name.replace(/^APRONSIDE/, ''), tp = topBy.get(key), right = key.startsWith('R'), sk = skins.get(cellOf(sd.name)), C = sk.positions.length / 3 / 2;
    assert.ok(tp, `${sd.name} has its apron top`);
    const tRows = pairs(tp), sRows = pairs(sd);
    sRows.forEach(([O, Sv], i) => {
      const j = (i * C + (right ? 0 : C - 1)) * 3;
      assert.deepEqual(Array.from(Float32Array.from(Sv)), [sk.positions[j], sk.positions[j + 1], sk.positions[j + 2]], `${sd.name} row ${i}: the skin's edge vertex`);
      assert.deepEqual(O, tRows[i][1], `${sd.name} row ${i}: the join starts at the apron's outer row`);
    });
    const Gc = (i) => { const [E, O] = tRows[i], Sv = sRows[i][1]; return [(E[0] + O[0] + Sv[0]) / 3, (E[1] + O[1] + Sv[1]) / 3, (E[2] + O[2] + Sv[2]) / 3]; };
    for (const node of [tp, sd]) {
      const m = node.children[0], P = m.positions, I = m.indices;
      for (let t = 0; t < I.length; t += 3) {
        const p = (k) => [P[I[t + k] * 3], P[I[t + k] * 3 + 1], P[I[t + k] * 3 + 2]], a = p(0), b = p(1), c = p(2), u = sub(b, a), v = sub(c, a);
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], g = Gc(Math.floor(I[t] / 2));
        assert.ok(n[0] * (mid[0] - g[0]) + n[1] * (mid[1] - g[1]) + n[2] * (mid[2] - g[2]) > 0, `${node.name} triangle ${t / 3} faces into the wedge`);
      }
    }
    assert.ok(tp.children[0].normals[1] > 0.8, `${tp.name}: the top's normal is up`); assert.ok(sd.children[0].normals[1] < 0, `${sd.name}: the join's normal is down`);
  }
});
// AMENDED (D593, twice): the lip's shades were added after the apron's own material; with the lip gone, the apron's own is the one added again (it is now the
// road's asphalt in its shade, row 15)
test('row 3: the road\'s own nodes are the same objects in the same places; the aprons are appended, with one material added', () => {
  const { skinned, out } = build(flat(), {});
  const k = skinned.root.children.length;
  skinned.root.children.forEach((c, i) => assert.equal(out.root.children[i], c, `node ${i} is the same object`));
  assert.ok(out.root.children.slice(k).every((c) => /^APRON(SIDE)?[LR]_/.test(c.name)));
  assert.equal(out.materials.length, skinned.materials.length + 1); skinned.materials.forEach((m, i) => assert.equal(out.materials[i], m));
  assert.equal(out.materials[out.materials.length - 1].name, 't180b_apron', 'the one material added is the apron\'s (D593: the road\'s asphalt in its shade, row 15)');
});

test('row 4: a wall side (a cup at 90°) gets none, a closed tube ring gets none, a seam row gets none', () => {
  const wall = build(extend(D.createDoc('w'), { length: 60, family: 'bowl', first: { w: 20, c: 90 } }), {});
  assert.equal(wall.out.root.children.filter((c) => /^APRON/.test(c.name)).length, 0, 'a 90° cup is a wall on both sides');
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
    for (const [E, Sk] of pairs(a)) assert.ok(Math.abs(E[1] - Sk[1] - 0.5) < 1e-4 && Math.abs(E[0] - Sk[0]) < 1e-4, `${a.name}: straight down 0.5 m`);
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
    assert.ok(k2.meshes.some((m) => /^1ROAD_APRON_/.test(m.name)) && k2.meshes.some((m) => /^APRONSIDE_/.test(m.name)), 'width 2: the apron and its join');
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
// the direction the visual lip left along (D593, until the keeper's 21:54-21:55: the lip is gone).
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

// AMENDED (D593, the chair's 21:58 and 23:23, the keeper's 21:58: "we need to somehow revert back to what we had originally with the apron", after the wheels sank through
// a drawn lip, the gap between drawn and physics): what is drawn is 0.4.34's apron, THE PHYSICS ITSELF, the plank and its join, vertex for vertex; no lip, nothing hidden.
// Kept of D593: the apron's material (t180b_apron) is the road's own asphalt at LIP_SHADE, and the pit lane's outline has the same drawn plank and join.
test('row 13: what is drawn is the physics: on a flat, a banked and a cupped edge every apron top is drawn as it is, beside its join, and no other apron mesh is drawn (no lip)', () => {
  for (const [label, doc] of EDGES) {
    const { out } = build(doc, {});
    assert.ok(tops(out).length > 0, `${label}: aprons`);
    assert.equal(vlips(out).length, 0, `${label}: no lip`);
    assert.equal(sides(out).length, tops(out).length, `${label}: one join beside every top`);
    assert.ok(out.root.children.filter((c) => /^APRON/.test(c.name)).every((c) => /^APRON(SIDE)?[LR]_/.test(c.name)), `${label}: no apron node but the tops and the joins`);
    for (const a of [...tops(out), ...sides(out)]) { const m = a.children[0]; assert.deepEqual([m.visible, m.renderable, m.castShadows], [true, true, true], `${label} ${m.name}: drawn as it is`); }
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

// AMENDED (D593, the chair's 21:58 and 23:23, the keeper's 21:58: "we need to somehow revert back to what we had originally with the apron", after the wheels sank through
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
});test('row 16: every apron top and join is exactly apronOf\'s, byte for byte, and drawn (visible, renderable, casting shadows), on t180b_apron', () => {
  const bytes = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  for (const [label, doc] of EDGES) {
    const { mesh, out } = build(doc, {}), K = mesh._state.pieces[0].K;
    assert.ok(tops(out).length > 0 && sides(out).length === tops(out).length, `${label}: a join beside every top`);
    for (const [list, which, re] of [[tops(out), 'top', /^APRON([LR])_/], [sides(out), 'side', /^APRONSIDE([LR])_/]]) for (const a of list) {
      const m = a.children[0], road = out.root.children.find((c) => /^CELL_/.test(c.name) && c.matrix === a.matrix).children[0], left = re.exec(a.name)[1] === 'L';
      const want = AP.apronOf(road, K, left ? K - 1 : 0, {}, { top: m.name, side: m.name })[which];
      for (const fl of ['positions', 'normals', 'uvs', 'indices']) assert.ok(bytes(m[fl]).equals(bytes(want[fl])), `${label} ${m.name}: its ${fl} are apronOf's ${which}'s, byte for byte`);
      assert.deepEqual([m.visible, m.renderable, m.castShadows], [true, true, true], `${label} ${m.name}: drawn`);
      assert.equal(out.materials[m.material].name, 't180b_apron', `${label} ${m.name}: on the apron's material`);
      assert.equal(isDrivable(m.name), which === 'top', `${label} ${m.name}: the top is physics, the join scenery`);
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
function clipCount(meshes, lo, hi) {
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
    const A = tris[list[x]], B = tris[list[y]]; if (A.mi === B.mi) continue;
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
// AMENDED (D593, the keeper 21:54-21:55): the lip and its underside are gone; the same check on the filled face round the lane
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

// AMENDED (D593, the chair's 21:58 and 23:23, the keeper's 21:58: "we need to somehow revert back to what we had originally with the apron", after the wheels sank through
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
test('row 22: the apron caps across the lane ends face out of the lane end: every drawn outline triangle lying across the road faces away from the lane', () => {
  const doc = lap('apron pit-is-track lap'), lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  const b = exportDoc(doc, {}, { pitLane: lane }), outline = acMeshes(b).filter((m) => /^(1ROAD_APRON|APRONSIDE)_PIT_/.test(m.name));
  assert.ok(outline.length >= 2, 'control: the outline has its plank and its join');
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
    caps++; if (along * way <= 0) bad.push(`${m.name} triangle ${t / 3} faces into the lane at ${c.map((x) => x.toFixed(2))}`);
  }
  assert.ok(caps > 0, 'control: the caps are found');
  assert.deepEqual(bad.slice(0, 4), [], `${bad.length} of ${caps} cap triangles face into the lane`);
});
