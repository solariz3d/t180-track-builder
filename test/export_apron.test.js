// export_apron.test.js: node --test test/export_apron.test.js
// D572, THE EDGE APRON (src/export/apron.js): outside every open edge of an equation-core road a physics strip runs OUTWARD and DOWN from the road's own edge row, and a
// scenery face joins it to the underside skin's edge row, so a wheel that drops off the edge has a surface under it and the side gap between road and skin is closed. Rows:
//   1  on a flat open road each grid cell gets two aprons: the outer row widthM out across and widthM·tan(25°) below the edge row (2.0 m: 0.93 m; 1.5 m: 0.70 m)
//   2  the wedge is closed: the join's lower row is the skin's own edge vertices, to the float; no face points into the wedge; the top faces up, the join down
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
const cellOf = (name) => name.replace(/^APRON(SIDE)?[LR]_/, '');
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

test('row 2: the wedge is closed: the join\'s lower row is the skin\'s edge vertices to the float; no face points into the wedge; the top faces up, the join down', () => {
  const { skinned, out } = build(flat(), { widthM: 2.0 });
  const skins = new Map(skinned.root.children.filter((c) => /^SKIN_/.test(c.name)).map((c) => [c.name.replace(/^SKIN_/, ''), c.children[0]]));
  const topBy = new Map(tops(out).map((a) => [a.name.replace(/^APRON/, ''), a]));
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

test('row 3: the road\'s own nodes are the same objects in the same places; the aprons are appended, with one material added', () => {
  const { skinned, out } = build(flat(), {});
  const k = skinned.root.children.length;
  skinned.root.children.forEach((c, i) => assert.equal(out.root.children[i], c, `node ${i} is the same object`));
  assert.ok(out.root.children.slice(k).every((c) => /^APRON(SIDE)?[LR]_/.test(c.name)));
  assert.equal(out.materials.length, skinned.materials.length + 1); skinned.materials.forEach((m, i) => assert.equal(out.materials[i], m));
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
