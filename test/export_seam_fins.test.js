// export_seam_fins.test.js: node --test test/export_seam_fins.test.js
// D459/D460 (2026-10-25: a bump driven into in game on TEST 10, a ridge across the road in the screenshot). The seam between two pieces whose
// boundary rows differ (src/geom/mesh.js meshSeam) was zipped by each vertex's INDEX FRACTION across its row, not by where it sits across the road.
// Rows of different vertex counts on a cupped or edged profile then paired points metres apart, and the zipper's triangles stood up in the station's
// cross-section plane: a vertical sheet of ROAD triangles, a fin, 439 mm tall at TEST 10's s 3,700, 155 mm at 4,750, 67 mm at 2,300
// (exo_memory/handback/p-d459-kn5-C_2026-10-25.md). src/export/acready.js weldSeams kept them, as "bridging a real gap". Written RED first.
//   A STANDING triangle: thicker than SLIVER (so not a sliver the weld drops anyway) and with its own normal more than 60° from the road normals its
//   three vertices carry, i.e. it faces along the road instead of up out of it.
// Rows:
//   1  a seam between unequal rows on a CUPPED profile (a 15° cup, then a right edge brought in): no zipper triangle stands
//   2  a seam between unequal rows on an EDGED profile (a 35° right edge, then both edges at 20°): no zipper triangle stands
//   3  a closed lap laid like TEST 10's joints (a cupped turn, a deeper cup, a right edge onset, an edge on both sides), through the export's own route
//      (buildFromSegments, then weldSeams(flattenForAc(scene)) as fromwords.js writes the kn5): 0 standing triangles on the whole lap's road
//   4  weldSeams drops a standing triangle that reaches it, and keeps a flat bridge across a real gap along the road
//   5  the builder's PREVIEW of the same lap (the app's coreshell and trackmodel, which draw every seam with no weld) has no standing triangle in any seam:
//      on TEST 10 the preview's fin at s 3,700 stood 53 mm, over the centre line's 30 mm lift, and broke the drawn centre line there (the user's previewer
//      shot, 2026-10-25: "you see how the centerline splits and isnt continuous")
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const path = require('path');
const GDIR = process.env.GEOM_DIR || path.join(__dirname, '..', 'src', 'geom');   // the mutation harnesses (geom_mutation, acready_mutation) point these at a mutant
const { buildMesh } = require(path.join(GDIR, 'mesh.js'));
const FW = require('../src/export/fromwords.js');
const { startLayout, createCoreShell } = require('../app/core/coreshell.js');
const { createTrackModel } = require('../app/preview/trackmodel.js');
const { weldSeams, flattenForAc, SLIVER } = require(process.env.ACREADY_FILE || path.join(__dirname, '..', 'src', 'export', 'acready.js'));

const STAND_DEG = 60;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nz = (v) => { const l = Math.hypot(...v); return l ? v.map((x) => x / l) : v; };
/** the standing triangles of one mesh ({ positions, normals, indices }): how many, and the tallest (its thickness, m) */
function standing(m) {
  const P = (i) => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]], N = (i) => [m.normals[3 * i], m.normals[3 * i + 1], m.normals[3 * i + 2]];
  let n = 0, tallest = 0;
  for (let k = 0; k < m.indices.length; k += 3) {
    const t = [m.indices[k], m.indices[k + 1], m.indices[k + 2]], v = t.map(P), c = cr(sub(v[1], v[0]), sub(v[2], v[0]));
    const longest = Math.max(Math.hypot(...sub(v[1], v[0])), Math.hypot(...sub(v[2], v[0])), Math.hypot(...sub(v[2], v[1]))), thick = longest ? Math.hypot(...c) / longest : 0;
    const road = nz(t.map(N).reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]));
    if (thick < SLIVER || Math.hypot(...road) === 0) continue;
    if (Math.acos(Math.min(1, Math.abs(dot(nz(c), road)))) * 180 / Math.PI > STAND_DEG) { n++; tallest = Math.max(tallest, thick); }
  }
  return { n, tallest };
}
/** every seam of a document's mesh: [{ s, K, n, tallest }] */
function seamsOf(doc) {
  const segs = A.toSegments(doc), st = buildMesh(A.toPath(doc).path, segs)._state;
  return st.seams.map((sm, g) => (sm ? { s: sm.s, vertices: sm.vertices, ...standing(sm) } : null)).filter(Boolean);
}
/** a closed lap laid like the bumped one: a cupped turn, a deeper cup, a right edge brought in, an edge on both sides */
function finLap() {
  const R = 300, Q = Math.PI * R / 2;
  let d = extend(D.createDoc('fin lap'), { length: 300 });
  d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R, c: 15 } });   // a cupped turn
  d = extend(d, { length: 200, transition: 40, targets: { kh: 0 } });
  d = extend(d, { length: 100, targets: { c: 25 } });                           // a deeper cup, from the cup
  d = extend(d, { length: 50, targets: { er: 35 } });                           // a right edge brought in
  d = extend(d, { length: 200 });
  d = extend(d, { length: 50, targets: { e: 20 } });                            // an edge on both sides
  d = extend(d, { length: 200 });
  d = extend(d, { length: 400, targets: { c: 0, er: 0, e: 0 } });
  d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = extend(d, { length: 300, transition: 40, targets: { kh: 0 } });
  d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report);
  return r.doc;
}
const say = (list) => list.map((x) => `s ${x.s.toFixed(0)}: ${x.n} standing, ${(x.tallest * 1000).toFixed(1)} mm`).join('; ');

test('row 1: a seam between unequal rows on a cupped profile lies in the road: no zipper triangle stands up out of it', () => {
  let d = extend(D.createDoc('fins cup'), { length: 150, first: { c: 15 } });
  d = extend(d, { length: 50, targets: { er: 35 } });
  d = extend(d, { length: 150 });
  const seams = seamsOf(d);
  assert.ok(seams.length >= 1, 'the cupped joint makes a seam (its rows differ)');
  assert.equal(seams.reduce((a, x) => a + x.n, 0), 0, `standing zipper triangles: ${say(seams)}`);
});

test('row 2: a seam between unequal rows on an edged profile lies in the road: no zipper triangle stands up out of it', () => {
  let d = extend(D.createDoc('fins edge'), { length: 150, first: { er: 35 } });
  d = extend(d, { length: 50, targets: { e: 20 } });
  d = extend(d, { length: 150 });
  const seams = seamsOf(d);
  assert.ok(seams.length >= 1, 'the edged joint makes a seam (its rows differ)');
  assert.equal(seams.reduce((a, x) => a + x.n, 0), 0, `standing zipper triangles: ${say(seams)}`);
});

test('row 3: a closed lap laid like the bumped one exports with 0 standing triangles on its road', () => {
  const doc = finLap(), segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const out = FW.buildFromSegments(segs, { name: 'fin lap', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start) });
  const road = weldSeams(flattenForAc(out.scene)).root.children.filter((m) => m.type === 'mesh' && /^1ROAD/.test(m.name));
  const found = road.map((m) => ({ name: m.name, ...standing(m) })).filter((x) => x.n);
  assert.deepEqual(found.map((x) => `${x.name}: ${x.n} standing, ${(x.tallest * 1000).toFixed(1)} mm`), []);
});

test('row 4: weldSeams drops a standing triangle that reaches it, and keeps a flat bridge across a real gap along the road', () => {
  const MAT = { name: 't180b_road', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0, props: [{ name: 'ksDiffuse', value: [0.5] }], samplers: [] };
  const mesh = (name, pts, idx) => ({ type: 'mesh', name, material: 0, positions: Float32Array.from(pts.flat()), normals: Float32Array.from(pts.flatMap(() => [0, 1, 0])),
    uvs: new Float32Array(pts.length * 2), indices: Uint16Array.from(idx), castShadows: true, visible: true, transparent: false, renderable: true });
  // the zipper's layout: row A then row B across the road (x), the road running along z, its normal up (y). Row B is 1 cm further along: a real gap
  const rowA = [[0, 0, 0], [5, 0, 0], [10, 0, 0]], rowB = [[0, 0, 0.01], [5, 0, 0.01], [10, 0, 0.01]];
  const idx = [0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5];
  // and one more triangle in the cross-section plane z = 0, standing 0.3 m up from the road: a fin
  const pts = [...rowA, ...rowB, [5, 0.3, 0]], fin = [0, 6, 2];
  const scene = { textures: [], materials: [MAT], root: { type: 'dummy', name: 't180b_track', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [mesh('1ROAD_seam_p1_body', pts, [...idx, ...fin])] } };
  assert.equal(standing(scene.root.children[0]).n, 1, 'the scene carries the fin');
  const out = weldSeams(scene), seam = out.root.children.find((m) => /seam/.test(m.name));
  assert.ok(seam, 'the bridge across the real gap is kept');
  assert.equal(standing(seam).n, 0, 'the fin is dropped');
  assert.equal(seam.indices.length, idx.length, 'the bridge keeps all four of its triangles');
});

test('row 5: the builder\'s preview of a lap laid like the bumped one draws no standing triangle in any seam (the centre line is not hidden)', async () => {
  const doc = finLap(), text = D.serialize(doc);
  const sh = await createCoreShell({ brushFn: null, exporter: null, storage: { openDoc: async () => text } }); await sh.open('fin lap');
  const seams = createTrackModel().update(sh.getState().resolved).batches.filter((b) => b.seam);
  assert.ok(seams.length >= 1, 'the preview draws the lap\'s seams');
  const found = seams.map((b) => ({ key: b.key, ...standing(b) })).filter((x) => x.n);
  assert.deepEqual(found.map((x) => `${x.key}: ${x.n} standing, ${(x.tallest * 1000).toFixed(1)} mm`), []);
});

// ── the fin guard (acready.js findFins) and the export's self-check (fromwords.js refuses FINS) ─────────────────────────────────────────────────────────
// The guard reads the MESH, not a ray: a ray cast down cannot see a vertical sheet (D436 and D459 part 1 measured the road that way and saw at most its top
// edge). At a station joint (a seam mesh) no triangle may face along the road (its normal more than 60° from its vertices' road normals, i.e. within 30° of
// the road's own plane) and every triangle must lie within the surface it bridges (each edge's midpoint within 10 mm of one of the two rows).
const guardScene = (extra) => {
  const MAT = { name: 't180b_road', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0, props: [{ name: 'ksDiffuse', value: [0.5] }], samplers: [] };
  const rowA = [[0, 0, 0], [5, 0, 0], [10, 0, 0]], rowB = [[0, 0, 0.01], [5, 0, 0.01], [10, 0, 0.01]], pts = [...rowA, ...rowB, ...extra.pts];
  const m = { type: 'mesh', name: '1ROAD_seam_p7_body', material: 0, positions: Float32Array.from(pts.flat()), normals: Float32Array.from(pts.flatMap(() => [0, 1, 0])),
    uvs: new Float32Array(pts.length * 2), indices: Uint16Array.from([0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5, ...extra.idx]), castShadows: true, visible: true, transparent: false, renderable: true };
  return { textures: [], materials: [MAT], root: { type: 'dummy', name: 't180b_track', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [m] } };
};
test('row 6: the fin guard finds a standing seam triangle and one off the surface it bridges, and passes a flat bridge across a real gap', () => {
  const { findFins } = require(process.env.ACREADY_FILE || path.join(__dirname, '..', 'src', 'export', 'acready.js'));
  assert.deepEqual(findFins(guardScene({ pts: [], idx: [] })), [], 'a flat bridge across a 1 cm gap is in the surface');
  const stand = findFins(guardScene({ pts: [[5, 0.3, 0]], idx: [0, 6, 2] }));
  assert.equal(stand.length, 1, 'the standing triangle is found'); assert.equal(stand[0].mesh, '1ROAD_seam_p7_body'); assert.equal(stand[0].standing, 1);
  assert.match(stand[0].message, /p7/, 'the report names the piece');
  const off = findFins(guardScene({ pts: [[5, 0, 1.5]], idx: [0, 6, 2] }));   // flat, facing up, but reaching 1.5 m along the road from rows 1 cm apart
  assert.equal(off.length, 1, 'the triangle off the surface it bridges is found'); assert.equal(off[0].offSurface, 1); assert.equal(off[0].standing, 0);
});
test('row 7: the export refuses with a plain message, and writes nothing, when a fin reaches the scene it is about to write', () => {
  const { spawnSync } = require('child_process');
  // a child process in which the weld lets one standing sheet through (a weld that regresses), then the export of a closed lap
  const child = `
    const path = require('path'), T = ${JSON.stringify(path.join(__dirname, '..'))};
    const acr = require(path.join(T, 'src/export/acready.js')), weld = acr.weldSeams;
    acr.weldSeams = (scene) => { const w = weld(scene), pts = [[0, 0, 0], [10, 0, 0], [5, 0.4, 0]];
      const fin = { type: 'mesh', name: '1ROAD_seam_p3_body', material: 0, positions: Float32Array.from(pts.flat()), normals: Float32Array.from(pts.flatMap(() => [0, 1, 0])),
        uvs: new Float32Array(6), indices: Uint16Array.from([0, 2, 1]), castShadows: true, visible: true, transparent: false, renderable: true };
      return { ...w, root: { ...w.root, children: [...w.root.children, fin] } }; };
    const D = require(path.join(T, 'src/core/document.js')), { extend } = require(path.join(T, 'src/core/extend.js')), { close } = require(path.join(T, 'src/core/close.js'));
    const A = require(path.join(T, 'src/core/adapter.js')), FW = require(path.join(T, 'src/export/fromwords.js')), { startLayout } = require(path.join(T, 'app/core/coreshell.js'));
    const R = 300, Q = Math.PI * R / 2;
    let d = extend(D.createDoc('fin lap'), { length: 300 });
    for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
    d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
    const doc = close(d, { edited: [0] }).doc, segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
    try { FW.buildFromSegments(segs, { name: 'fin lap', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start) }); console.log(JSON.stringify({ refused: false })); }
    catch (e) { console.log(JSON.stringify({ refused: true, code: e.code, message: e.message })); }`;
  const r = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8', timeout: 180000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.refused, true, 'the export wrote a kn5 with a fin in it');
  assert.equal(out.code, 'FINS');
  assert.match(out.message, /p3/, 'the message names where');
  assert.match(out.message, /nothing was written/i, 'the message says nothing was written');
});
