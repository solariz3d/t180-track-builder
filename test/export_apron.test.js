// export_apron.test.js: node --test test/export_apron.test.js
// D572, THE EDGE APRON (src/export/apron.js): outside every open edge of an equation-core road a physics strip runs OUTWARD and DOWN from the road's own edge row, and a
// scenery face joins it to the underside skin's edge row, so a wheel that drops off the edge has a surface under it and the side gap between road and skin is closed. Rows:
//   1  on a flat open road each grid cell gets two aprons: the outer row widthM out across and widthM·tan(25°) below the edge row (2.0 m: 0.93 m; 1.5 m: 0.70 m)
//   2  the section under the edge is closed: the visual lip's UNDERSIDE runs from the skin's own edge vertex (to the float) to the lip's outer row; no face points into it;
//      the lip faces up, the underside down (amended, D593: it was the flat join under the physics top)
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
//  13  the visual lip leaves along the edge's own last segment, not the frame's lateral, on a flat, a banked and a cupped edge (no crease where it meets the road)
//  14  the pit lane is one outline: a hidden physics apron round its ends and along its outer edge, onto the main apron either side, with its lip; the 0.86 m case there too
//  15  the visual underside follows the lip (it bends with it) and meets the skin with the skin's own normal
//  16  the physics apron is exactly apronOf's plank and is hidden (not visible, not renderable, no shadow); the lip has no physics prefix, the road's material and uvs
//  17  the physics apron is byte for byte what the user drove, pinned at a93ae51, on a flat, a banked and a cupped edge
//  18  the pit IS the track: no drawn and no physics triangle clips through another round the lane, and no drawn edge is left open round either of its ends
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
// D593: the visual lip (APRONLIP…) and its underside have APRON_COLS + 1 vertices a row (apron.js grid() writes them row by row): lips(node) -> its rows, the edge first
const vlips = (scene) => scene.root.children.filter((c) => /^APRONLIP[LR]_/.test(c.name));
const lips = (node) => { const P = node.children[0].positions, C = AP.APRON_COLS + 1, out = []; for (let i = 0; i < P.length / 3; i += C) out.push(Array.from({ length: C }, (_, c) => [P[(i + c) * 3], P[(i + c) * 3 + 1], P[(i + c) * 3 + 2]])); return out; };
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
// skin, the "flat surface" the user saw from below. The rule is now that what is DRAWN closes it: the visual lip and an UNDERSIDE that follows it, each APRON_COLS + 1
// columns, the underside from the skin's edge vertex to the lip's outer row. "No face points into the section" is read per triangle against the other surface at the same
// row and column (the lip above it, or the underside under it), not a three-point centroid. The hidden physics top is row 16's.
test('row 2: the section under the edge is closed: the visual underside runs from the skin\'s edge vertex to the lip\'s outer row; no face points into it; the lip faces up, the underside down', () => {
  const { skinned, out } = build(flat(), { widthM: 2.0 });
  const skins = new Map(skinned.root.children.filter((c) => /^SKIN_/.test(c.name)).map((c) => [c.matrix, c.children[0]]));
  assert.ok(vlips(out).length > 0); assert.equal(sides(out).length, vlips(out).length, 'one underside under every lip: the section is closed on every one');
  const C = AP.APRON_COLS + 1;
  for (const sd of sides(out)) {
    const key = sd.name.replace(/^APRONSIDE/, ''), tp = vlips(out).find((a) => a.matrix === sd.matrix && a.name[8] === sd.name[9]), right = key.startsWith('R'), sk = skins.get(sd.matrix), SC = sk.positions.length / 3 / 2;
    assert.ok(tp, `${sd.name} has its lip`);
    const tRows = lips(tp), uRows = lips(sd);
    uRows.forEach((row, i) => {
      const j = (i * SC + (right ? 0 : SC - 1)) * 3;
      assert.deepEqual(row[0], [sk.positions[j], sk.positions[j + 1], sk.positions[j + 2]], `${sd.name} row ${i}: the underside starts at the skin's edge vertex`);
      assert.deepEqual(row[C - 1], tRows[i][C - 1], `${sd.name} row ${i}: the underside meets the lip's outer row`);
    });
    for (const [node, mine, other] of [[tp, tRows, uRows], [sd, uRows, tRows]]) {
      const m = node.children[0], P = m.positions, I = m.indices;
      for (let t = 0; t < I.length; t += 3) {
        const p = (k) => [P[I[t + k] * 3], P[I[t + k] * 3 + 1], P[I[t + k] * 3 + 2]], a = p(0), b = p(1), c = p(2), u = sub(b, a), v = sub(c, a);
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        let away = [0, 0, 0];   // from the other surface, at each vertex's own row and column, toward this one
        for (let k = 0; k < 3; k++) { const vi = I[t + k], r = Math.floor(vi / C), cc = vi % C, d = sub(mine[r][cc], other[r][cc]); away = [away[0] + d[0], away[1] + d[1], away[2] + d[2]]; }
        assert.ok(dot3(n, away) > 0, `${node.name} triangle ${t / 3} faces into the section`);
      }
    }
    const ny = (node) => { const N = node.children[0].normals, ys = []; for (let i = 1; i < N.length; i += 3) ys.push(N[i]); return ys; };
    assert.ok(ny(tp).every((y) => y > 0.8), `${tp.name}: the lip's normals are up`); assert.ok(ny(sd).every((y) => y < 0), `${sd.name}: the underside's normals are down`);
  }
});

// AMENDED (D593): the appended nodes were the physics top and its join (APRON… and APRONSIDE…). Now the drawn lip is appended beside them (APRONLIP…), and on a track with
// a pit lane its one outline (APRON_PIT_L/R and its lip and underside); still only appended. The materials: the apron's own was the one added; now after it come
// the lips' darker shades, one per road material a lip sits on (the user, 18:0x), the earlier materials still the same objects in the same places.
test('row 3: the road\'s own nodes are the same objects in the same places; the aprons are appended, and the apron\'s material then the lips\' shades after the scene\'s own', () => {
  const { skinned, out } = build(flat(), {});
  const k = skinned.root.children.length;
  skinned.root.children.forEach((c, i) => assert.equal(out.root.children[i], c, `node ${i} is the same object`));
  assert.ok(out.root.children.slice(k).every((c) => /^APRON(SIDE|LIP)?([LR]_|_PIT_[LR]$)/.test(c.name)));
  skinned.materials.forEach((m, i) => assert.equal(out.materials[i], m));
  const added = out.materials.slice(skinned.materials.length);
  assert.equal(added[0].name, 't180b_apron', 'the apron\'s own material first, at the index the physics had');
  assert.ok(added.length >= 2 && added.slice(1).every((x) => /_lipshade$/.test(x.name)), `then the lips' shades: ${added.map((x) => x.name).join(', ')}`);
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
// The edges the rows below look at: a flat one, one banked 30° (no cup) and one cupped 40° (under the 60° wall bar). A side's own last segment, from the ROAD's vertices, is
// the direction the visual lip must leave along; `up` is the edge vertex's normal made square to it.
const EDGES = [['flat', flat()], ['banked 30°', extend(D.createDoc('bank'), { length: 60, family: 'bowl', first: { w: 20, c: 0, phi: 30 * DEG } })], ['cupped 40°', extend(D.createDoc('cup'), { length: 60, family: 'bowl', first: { w: 20, c: 40 } })]];
function edgeFrames(mesh, out) {
  const K = mesh._state.pieces[0].K, list = [];
  for (const a of vlips(out)) {
    const road = out.root.children.find((c) => /^CELL_/.test(c.name) && c.matrix === a.matrix).children[0], left = a.name.startsWith('APRONLIPL'), P = road.positions, Nn = road.normals;
    lips(a).forEach((row, r) => {
      const at = (A, k) => [A[(r * K + k) * 3], A[(r * K + k) * 3 + 1], A[(r * K + k) * 3 + 2]], E = at(P, left ? K - 1 : 0), Dd = unit3(sub(E, at(P, left ? K - 2 : 1))), NE = at(Nn, left ? K - 1 : 0);
      list.push({ name: a.name, r, row, E, D: Dd, up: unit3(sub(NE, Dd.map((x) => x * dot3(NE, Dd)))) });
    });
  }
  return list;
}

test('row 12: the D563 wheel: 0.86 m out the physics apron is 0.40 m below the edge row, within 0.1 m of the 0.31 m the wheel was measured to fall', () => {
  // exo_memory/handback/p-d563-wheel-under-O_2026-10-30.md: the Demo's rear right went 0.86 m past the edge and came back 0.31 m under the surface
  const { out } = build(flat(), {});
  assert.ok(tops(out).length > 0);
  for (const a of tops(out)) for (const [E, O] of pairs(a)) {
    const across = Math.hypot(O[0] - E[0], O[2] - E[2]), drop = (E[1] - O[1]) * 0.86 / across;
    assert.ok(Math.abs(drop - 0.31) <= 0.1, `${a.name}: 0.86 m out the apron is ${drop.toFixed(3)} m below the edge, more than 0.1 m from the wheel's 0.31 m`);
  }
});

test('row 13: the visual lip leaves along the edge\'s own last segment, not the frame\'s lateral: its first column turns no more than θ/APRON_COLS from it, on a flat, a banked and a cupped edge', () => {
  const bound = 25 / AP.APRON_COLS + 0.01;
  for (const [label, doc] of EDGES) {
    const { mesh, out } = build(doc, {}), frames = edgeFrames(mesh, out);
    assert.ok(frames.length > 0, `${label}: lips`);
    for (const f of frames) {
      const first = unit3(sub(f.row[1], f.row[0])), deg = Math.acos(Math.max(-1, Math.min(1, dot3(first, f.D)))) / DEG;
      assert.ok(deg <= bound, `${label} ${f.name} row ${f.r}: the lip leaves ${deg.toFixed(2)}° off the edge's last segment (a crease), over ${bound.toFixed(2)}°`);
      const ys = f.row.map((p) => dot3(sub(p, f.E), f.up));
      assert.ok(ys.every((y) => y <= 1e-4), `${label} ${f.name} row ${f.r}: the lip rises ${Math.max(...ys).toFixed(4)} m above the edge's surface carried on`);
    }
  }
});

test('row 14: the pit lane is one outline: a hidden physics apron runs from the main apron before the lane, round its ends and along its outer edge, back onto the main apron after it, with its lip; the D563 wheel case holds on the lane\'s edge', () => {
  // the user, 2026-10-31 17:18: "what about the pit lane included into the apron generation and track all at once"
  const doc = lap('apron outline lap'), lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  const b = exportDoc(doc, { mergeMeshes: false }, { pitLane: lane }), meshes = walkScene(b.scene).meshes;
  const phys = meshes.find((m) => m.name === '1ROAD_APRON_PIT_L'), lip = meshes.find((m) => m.name === 'APRONLIP_PIT_L'), under = meshes.find((m) => m.name === 'APRONSIDE_PIT_L');
  assert.ok(phys && lip && under, 'the outline: its physics apron, its lip and its underside');
  assert.ok(isDrivable(phys.name) && !isDrivable(lip.name) && !isDrivable(under.name), 'only the outline\'s apron is physics');
  let physNode = null; const walk = (n) => { if (n.type === 'mesh' && n.name === phys.name) physNode = n; (n.children || []).forEach(walk); }; walk(b.scene.root);
  assert.deepEqual([physNode.visible, physNode.renderable, physNode.castShadows], [false, false, false], 'the outline\'s physics is hidden like the rest');
  // its full-width rows (apron.js outlineMeshes writes a run's rows as edge/outer vertex pairs; the corners' fans are not pairs and are not read here)
  const P = phys.positions, V = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], full = [];
  for (let i = 0; i + 1 < P.length / 3; i++) { const E = V(i), O = V(i + 1), across = Math.hypot(O[0] - E[0], O[2] - E[2]); if (Math.abs(across - AP.APRON_WIDTH_M) < 1e-3 && E[1] > O[1]) full.push({ E, O, across }); }
  assert.ok(lip.positions.length > 0 && under.positions.length > 0, 'the outline is drawn: its lip and underside have vertices');
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

test('row 15: the visual underside follows the lip: it bends with it (its middle column off the straight line from the skin to the outer row) and meets the skin with the skin\'s own normal', () => {
  for (const [label, doc] of EDGES) {
    const { skinned, out } = build(doc, {});
    const skins = new Map(skinned.root.children.filter((c) => /^SKIN_/.test(c.name)).map((c) => [c.matrix, c.children[0]])), C = AP.APRON_COLS + 1, mid = Math.floor(C / 2);
    assert.ok(sides(out).length > 0, `${label}: undersides`);
    for (const sd of sides(out)) {
      const sk = skins.get(sd.matrix), SC = sk.positions.length / 3 / 2, right = sd.name.startsWith('APRONSIDER'), N = sd.children[0].normals;
      lips(sd).forEach((row, i) => {
        const a = row[0], b = row[C - 1], m = row[mid], ab = unit3(sub(b, a)), am = sub(m, a), off = Math.hypot(...sub(am, ab.map((x) => x * dot3(am, ab))));
        assert.ok(off > 0.02, `${label} ${sd.name} row ${i}: the underside is a flat sheet (its middle ${off.toFixed(3)} m off the straight line)`);
        const j = (i * SC + (right ? 0 : SC - 1)) * 3;
        assert.deepEqual([N[i * C * 3], N[i * C * 3 + 1], N[i * C * 3 + 2]], [sk.normals[j], sk.normals[j + 1], sk.normals[j + 2]], `${label} ${sd.name} row ${i}: the skin's own normal where they meet`);
      });
    }
  }
});

test('row 16: the physics apron is exactly apronOf\'s plank and is hidden; the visual lip has no physics prefix and carries the road\'s material and uvs', () => {
  const bytes = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  for (const [label, doc] of EDGES) {
    const { mesh, out } = build(doc, {}), K = mesh._state.pieces[0].K, C = AP.APRON_COLS + 1;
    assert.ok(tops(out).length > 0 && vlips(out).length === tops(out).length, `${label}: one lip over every physics apron`);
    for (const a of tops(out)) {
      const m = a.children[0], road = out.root.children.find((c) => /^CELL_/.test(c.name) && c.matrix === a.matrix).children[0], left = a.name.startsWith('APRONL');
      const plank = AP.apronOf(road, K, left ? K - 1 : 0, {}, { top: m.name, side: 'x' }).top;
      for (const f of ['positions', 'normals', 'uvs', 'indices']) assert.ok(bytes(m[f]).equals(bytes(plank[f])), `${label} ${m.name}: its ${f} are apronOf's plank's, byte for byte`);
      assert.ok(isDrivable(m.name), `${m.name}: still physics`);
      assert.deepEqual([m.visible, m.renderable, m.castShadows], [false, false, false], `${label} ${m.name}: hidden (not visible, not renderable, no shadow)`);
      assert.equal(out.materials[m.material].name, 't180b_apron', `${m.name}: its material as it was`);
    }
    for (const a of vlips(out)) {
      const m = a.children[0], road = out.root.children.find((c) => /^CELL_/.test(c.name) && c.matrix === a.matrix).children[0], left = a.name.startsWith('APRONLIPL');
      assert.match(m.name, /^APRONLIP_p\d+_.*_[LR]$/); assert.ok(!isDrivable(m.name) && !/^\d/.test(m.name), `${m.name}: scenery, no physics prefix`);
      assert.deepEqual([m.visible, m.renderable], [true, true], `${m.name}: drawn`);
      // AMENDED (D593, the user 18:0x): the lip wore its cell's road material; it now wears that material's darker shade (the same texture, ambient, diffuse and specular at LIP_SHADE)
      const own = out.materials[road.material], shade = out.materials[m.material], prop = (x, n) => x.props.find((p) => p.name === n).value[0];
      assert.equal(shade.name, `${own.name}_lipshade`, `${label} ${m.name}: its own cell's road material, in the lip's shade`);
      assert.deepEqual(shade.samplers, own.samplers, `${label} ${m.name}: the road's own texture`);
      for (const n of ['ksAmbient', 'ksDiffuse', 'ksSpecular']) assert.ok(Math.abs(prop(shade, n) - prop(own, n) * AP.LIP_SHADE) < 1e-12 && prop(shade, n) < prop(own, n), `${label} ${m.name}: ${n} darker, ${prop(shade, n)} against the road's ${prop(own, n)}`);
      for (let r = 0; r < m.uvs.length / 2 / C; r++) {
        const j = (r * K + (left ? K - 1 : 0)) * 2, jn = (r * K + (left ? K - 2 : 1)) * 2, last = m.uvs[(r * C + C - 1) * 2];
        assert.deepEqual([m.uvs[r * C * 2], m.uvs[r * C * 2 + 1]], [road.uvs[j], road.uvs[j + 1]], `${label} ${m.name} row ${r}: the edge vertex's own uv`);
        assert.ok(road.uvs[j] !== road.uvs[jn] && Math.sign(last - road.uvs[j]) === Math.sign(road.uvs[j] - road.uvs[jn]), `${label} ${m.name} row ${r}: u carries on outward past the edge`);
        assert.equal(m.uvs[(r * C + C - 1) * 2 + 1], road.uvs[j + 1], `${label} ${m.name} row ${r}: v is the road's along the whole lip`);
      }
    }
    // AMENDED (D593, the user 18:0x): the underside wore the skin's material; it now wears the same darker shade of the road as the lip above it
    for (const a of sides(out)) { const lipNode = vlips(out).find((x) => x.matrix === a.matrix && x.name[8] === a.name[9]); assert.equal(a.children[0].material, lipNode.children[0].material, `${label} ${a.name}: the underside wears the lip's shade`); }
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

test('row 18: the pit IS the track: nothing clips (no drawn and no physics triangle through another, round the whole lane) and nothing gaps (no open edge drawn round either end)', () => {
  const doc = lap('apron pit-is-track lap'), lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  const b = exportDoc(doc, {}, { pitLane: lane }), meshes = acMeshes(b);
  const laneMeshes = meshes.filter((m) => /^1ROAD_PIT_/.test(m.name)); assert.ok(laneMeshes.length > 0, 'control: the lane is in the scene');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of laneMeshes) for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.positions[i + k] - 30); hi[k] = Math.max(hi[k], m.positions[i + k] + 30); }
  const c = clipCount(meshes, lo, hi);
  assert.equal(c.drawn, 0, `drawn triangles clip through each other: ${c.where.join('; ')}`);
  assert.equal(c.physics, 0, `physics triangles clip through each other: ${c.where.join('; ')}`);
  const at = (s) => { let best = b.path.samples[0]; for (const q of b.path.samples) if (Math.abs(q.s - s) < Math.abs(best.s - s)) best = q; return best.pos; };
  for (const [name, s] of [['leave', b.pitLane.joins.leave.s], ['rejoin', b.pitLane.joins.rejoin.s]]) {
    const holes = holesAround(meshes, at(s), 25);
    assert.deepEqual(holes.slice(0, 4), [], `${holes.length} open drawn edges round the ${name}`);
  }
});
