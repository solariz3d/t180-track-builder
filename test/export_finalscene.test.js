// export_finalscene.test.js: node --test test/export_finalscene.test.js
// THE FINAL-SCENE CHECK (src/export/finalscene.js), run by the export on the scene the kn5 is written from. Validation reads the road before the skin, the
// apron and the catch exist, so until this check nothing at export time read the six defects the tests below were first written for. Rows:
//   1  a clean lap with a pit lane: the check finds nothing, and the export's result carries exactly what the check returns on its welded scene
//   2  the pit lane's ends: no drivable face stands across the road there and the lane is at most 0.1 m wide where it leaves and rejoins (the notch)
//   3  beside the pit lane on a cupped road the hull's bottom has no step (the step under the leave), the check reading the bottom all along
//   4  tubes, opened and closed, abrupt and gradual: no fold in the skin past the road's, no open edge, no sliver (the jag, the ring cracks, the zipper),
//      and no step in the bottom where the hull deepens evenly into the tube
//   5  on a damaged copy of a clean scene, each defect is found where it was made: a hole in the road refuses, a hole in the skin warns, a face across
//      the road refuses, a sliver warns, a skin pushed down warns as a step in the bottom, a skin row pressed down warns as a fold, a lane 0.5 m wide at
//      its end refuses
//   6  under the bars: a crack in the road narrower than the ray check's weld, a seam's zipper standing in the cross-section plane, and a hull that
//      deepens evenly (a slope, not a step), are not found
//   7  the export gives the check its path, segments and pit lane, refuses with SCENE on a drivable fault and writes nothing, lists it in the TEST route
//      instead, and passes each drawn fault on as a warning
//   8  bad input is refused by name
//   9  a piece joint where the road's column count goes from even to odd: the export refuses nothing (the edge apron's planks were 7.8 mm apart there
//      before the export welded them, acready.js weldApronJoints), and the skin's zipper there is no fold
//  10  a closed lap with a free jump: the road's lip and its landing are open by design, and nothing is refused
//  11  the triangles' tables (the welded vertices, the edges) keep every entry as they grow: one number per vertex and one group per edge, in the order first
//      seen. A table that lost entries would file them again as duplicates, which the open-edge check reads as covered (they coincide), so a clean lap
//      cannot show it
//  12  two passes, one lap's edge over the next lap's (a spiral of a lap and a half): the check warns nothing (a light hull's long triangle at a piece
//      joint touched the next piece's apron, and its centre's station made it another pass's); a copy of an upper skin cell laid onto the lower road by hand
//      warns, at its piece and station; a small drawn face 5 mm out of the lower road only grazes it and is not said, and one 50 mm out is
//  13  ELYSIUM (the fixture): its p38's hull, hung 2 to 3 m under a rising edge, passes through p40's road and apron, and the check says so in piece p38
//  14  the export warns by the builder's own pass-clearance rule (src/validate/passclear.js passClearance, called, not copied), one warning a stretch where
//      another pass comes within the car's room: on the two passes, the stretches are the rule's own findings; the clean pit lap has none
//  15  on the two passes, faces made by hand: a long face with two corners on its own pass's road is that pass's, though its centre lies 40 m on; a face
//      climbing out of a road face 4 mm over the face itself only grazes it, though it stands 50 mm over its plane further on; a road face filed under the
//      piece before, 15 m back along the road, is the same pass. Each beside a control that is said
// Rows 2-4 were red on the commits before their fixes: 8fb6ecc (the notch) and e911792 (the bottom's step and the tubes); see the hand-back.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
// FROMWORDS_FILE and FINALSCENE_FILE: a mutant's copy (test/finalscene_mutation.test.js); the real modules when unset
const FW_FILE = process.env.FROMWORDS_FILE || require.resolve('../src/export/fromwords.js');
const FW = require(FW_FILE);
const AR = require('../src/export/acready.js');
const FS = require(process.env.FINALSCENE_FILE || '../src/export/finalscene.js');
const { startLayout } = require('../app/core/coreshell.js');

const Rr = 180, Q = (Math.PI * Rr) / 2;
function lap(name, first = { w: 20, c: 0 }) {
  let d = extend(D.createDoc(name), { length: 400, family: 'bowl', first });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
function exportDoc(doc, o = {}, meta = {}) {
  const segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  return FW.buildFromSegments(segs, { name: doc.name, via: 'test', liftPath: lift, start, ...meta }, { markers: startLayout(segs, lift, start, o.test ? { open: true } : undefined), ...o });
}
/** The check on an export's own scene, welded as the export welds it (so the rows run on a tree whose export does not call it yet). */
const checked = (b, o = {}) => FS.checkFinalScene((AR.weldApronJoints || ((x) => x))(AR.weldSeams(AR.flattenForAc(b.scene))), { path: b.path, segments: b.segments, lane: b.pitLane, open: !b.path.closed, ...o });
const said = (list, kind) => list.filter((f) => f.kind === kind).map((f) => f.message);

let memo = {};
// AMENDED BY NAME (2026-11-02, the light hull, src/export/lighthull.js): `full` builds the same lap with the full skin, one node per 2 m cell (lightHull: false), which
// row 5's hand-made defects are cut from: "this cell's skin" sunk, "this cell and the one before" pressed. With the light hull a cell's node is a piece of up to 100 m.
const pitLap = (full = false) => memo[full ? 'pitFull' : 'pit'] || (memo[full ? 'pitFull' : 'pit'] = (() => {
  const doc = lap('scene pit lap'), lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
  return exportDoc(doc, full ? { lightHull: false } : {}, { pitLane: lane });
})());

test('row 1: a clean lap with a pit lane: the check finds nothing, and the export carries exactly what the check returns on its welded scene', () => {
  const b = pitLap(), r = checked(b);
  assert.deepEqual(r.refuse.map((f) => f.message), []);
  assert.deepEqual(r.warn.map((f) => f.message), []);
  assert.ok(b.sceneCheck, 'the export returns the check\'s result');
  assert.deepEqual(b.sceneCheck, r);
  assert.deepEqual(b.warnings.filter((w) => w.startsWith('scene: ')), []);
});

test('row 2: the pit lane\'s ends: no drivable face stands across the road there, and the lane is at most 0.1 m wide where it leaves and rejoins (the notch)', () => {
  const b = pitLap(), r = checked(b);
  assert.ok(b.pitLane && b.pitLane.joins, 'control: the lane is built');
  assert.deepEqual([...said(r.refuse, 'lane'), ...said(r.refuse, 'across')], []);
});

test('row 3: beside the pit lane on a cupped road the hull\'s bottom has no step, and the check reads the bottom all along', () => {
  const doc = lap('scene cupped pit lap', { w: 20, c: 15.5 });
  const lane = { side: 'L', leave: { word: doc.pieces[0].id, along: 120 }, rejoin: { word: doc.pieces[0].id, along: 320 }, offsetM: 12, width: 8, divergeM: 60, mergeM: 60, speedKmh: 80 };
  const b = exportDoc(doc, {}, { pitLane: lane }), r = checked(b, { detail: true });
  // control: the bottom is read on both sides at most stations, and compared a metre or two apart all along (the lane's side beside its span excepted)
  assert.ok(r.detail.read > 0.8 * r.detail.rays && r.detail.compared > 0.8 * r.detail.rays, `the bottom was read at ${r.detail.read} and compared at ${r.detail.compared} of ${r.detail.rays} rays`);
  assert.deepEqual(said(r.warn, 'bottom'), []);
});

test('row 4: tubes opened and closed, abrupt and gradual: no fold in the skin past the road\'s, no open edge, no sliver, no step in the bottom', () => {
  const doc = D.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tube-cases-2026-11-02.t180track'), 'utf8'));
  const b = exportDoc(doc, { test: true }), r = checked(b);
  // and the hull deepening evenly where a tube closes is a slope, not a step
  assert.deepEqual([...said(r.warn, 'fold'), ...said(r.refuse, 'open'), ...said(r.warn, 'open'), ...said(r.warn, 'sliver'), ...said(r.warn, 'bottom')], []);
});

// ── a damaged copy of the clean lap's scene: each defect made by hand, at a known place ──
function cleanScene(full = false) { const b = pitLap(full); return { b, scene: (AR.weldApronJoints || ((x) => x))(AR.weldSeams(AR.flattenForAc(b.scene))) }; }
const meshNamed = (scene, re) => scene.root.children.find((n) => n.type === 'mesh' && re.test(n.name) && n.indices.length >= 6);
const withMesh = (scene, name, f) => ({ ...scene, root: { ...scene.root, children: scene.root.children.map((n) => (n.name === name ? f(n) : n)) } });
const dropTriangle = (n, k = 0) => ({ ...n, indices: Uint16Array.from([...n.indices.slice(0, 3 * k), ...n.indices.slice(3 * k + 3)]) });
const sOf = (b, n) => { const P = n.positions, p = [P[0], P[1], P[2]]; let best = b.path.samples[0]; for (const q of b.path.samples) if (Math.hypot(...q.pos.map((x, k) => x - p[k])) < Math.hypot(...best.pos.map((x, k) => x - p[k]))) best = q; return best.s; };
const near = (f, s) => Math.abs(f.s - s) < 4;

test('row 5: each defect made by hand is found where it was made: a hole in the road refuses, in the skin warns, a face across the road refuses, a sliver warns, a sunk skin warns, a wide lane end refuses', () => {
  // AMENDED BY NAME (the light hull): the defects are cut from the full skin, a node per cell (see pitLap); rows 1 and 7 read the light one clean
  const { b, scene } = cleanScene(true), opt = { path: b.path, segments: b.segments, lane: b.pitLane, open: false };
  const road = meshNamed(scene, /^1ROAD_p\d+_body_0_40$/), skin = meshNamed(scene, /^UNDERSKIN_p\d+_body_0_40$/), apron = meshNamed(scene, /^1ROAD_APRON_p\d+_body_0_R_40$/);
  assert.ok(road && skin && apron, 'control: the meshes to damage are in the scene');
  // a hole in the road
  let r = FS.checkFinalScene(withMesh(scene, road.name, (n) => dropTriangle(n, 4)), opt);
  assert.equal(r.refuse.length, 1, r.refuse.map((f) => f.message).join('; '));
  assert.equal(r.refuse[0].kind, 'open'); assert.ok(near(r.refuse[0], sOf(b, road)), `found at s ${r.refuse[0].s}, made at ${sOf(b, road)}`);
  assert.match(r.refuse[0].message, /the road are open by up to .* in piece p\d+: a crack in the road's surface/);
  // a hole in the skin: drawn only, a warning
  r = FS.checkFinalScene(withMesh(scene, skin.name, (n) => dropTriangle(n, 4)), opt);
  assert.deepEqual(r.refuse, []);
  assert.deepEqual(r.warn.map((f) => f.kind), ['open']); assert.match(r.warn[0].message, /underside skin are open .*a line of sky through the hull/);
  // a face of the apron turned to stand across the road: its first triangle's third vertex lifted 0.5 m along the road's up, at its first vertex's station
  r = FS.checkFinalScene(withMesh(scene, apron.name, (n) => {
    const P = Float32Array.from(n.positions), I = n.indices, q = b.path.samples.find((x) => Math.abs(x.s - sOf(b, n)) < 0.3), [i0, i1, i2] = [I[0], I[1], I[2]];
    // the triangle laid in the road's cross-section plane: its three vertices at one station, one lifted
    for (const [k, along] of [[i1, 0], [i2, 0]]) for (let a = 0; a < 3; a++) P[3 * k + a] = P[3 * i0 + a] + along;
    for (let a = 0; a < 3; a++) { P[3 * i1 + a] += q.L[a] * 0.5; P[3 * i2 + a] += q.U[a] * 0.5; }
    return { ...n, positions: P };
  }), opt);
  assert.ok(r.refuse.some((f) => f.kind === 'across' && /edge apron stand across the road/.test(f.message)), r.refuse.map((f) => f.message).join('; '));
  // a sliver laid into the skin: a triangle 1 mm thick, its own new vertices, on the skin's first vertex
  r = FS.checkFinalScene(withMesh(scene, skin.name, (n) => {
    const P = n.positions, nv = P.length / 3, p = [P[0], P[1], P[2]], add = [p, [p[0] + 1, p[1], p[2]], [p[0] + 0.5, p[1] + 0.001, p[2]]].flat();
    return { ...n, positions: Float32Array.from([...P, ...add]), normals: Float32Array.from([...n.normals, ...n.normals.slice(0, 9)]), indices: Uint16Array.from([...n.indices, nv, nv + 1, nv + 2]) };
  }), opt);
  assert.ok(r.warn.some((f) => f.kind === 'sliver' && /thinner than 4 mm/.test(f.message)), r.warn.map((f) => f.message).join('; '));
  // the skin of one cell pushed 0.3 m further down: its bottom steps there
  r = FS.checkFinalScene(withMesh(scene, skin.name, (n) => {
    const P = Float32Array.from(n.positions), q = b.path.samples.find((x) => Math.abs(x.s - sOf(b, n)) < 0.3);
    for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] -= q.U[a] * 0.3;
    return { ...n, positions: P };
  }), opt);
  assert.ok(r.warn.some((f) => f.kind === 'bottom' && near(f, sOf(b, skin)) && /the hull's bottom steps/.test(f.message)), r.warn.map((f) => f.message).join('; '));
  // the skin's row at the station where this cell begins pressed 0.5 m down, in this cell and the one before alike, under the road only (the apron's
  // planks keep their runs, so the hull stays closed): it folds there
  const s0 = sOf(b, skin), q0 = b.path.samples.find((x) => Math.abs(x.s - s0) < 0.3), at0 = (P, i, d) => (P[i] - q0.pos[0]) * d[0] + (P[i + 1] - q0.pos[1]) * d[1] + (P[i + 2] - q0.pos[2]) * d[2];
  const onRow = (P, i) => Math.abs(at0(P, i, q0.T)) < 0.05 && Math.abs(at0(P, i, q0.L)) < 8;
  const press = (n) => { const P = Float32Array.from(n.positions); let k = 0; for (let i = 0; i < P.length; i += 3) if (onRow(P, i)) { k++; for (let a = 0; a < 3; a++) P[i + a] -= q0.U[a] * 0.5; } return k ? { ...n, positions: P } : n; };
  const pressed = { ...scene, root: { ...scene.root, children: scene.root.children.map((n) => (n.type === 'mesh' && /^UNDERSKIN_/.test(n.name) ? press(n) : n)) } };
  r = FS.checkFinalScene(pressed, opt);
  assert.ok(r.warn.some((f) => f.kind === 'fold' && /the underside skin folds/.test(f.message)), r.warn.map((f) => f.message).join('; '));
  assert.deepEqual(r.warn.filter((f) => f.kind === 'open').map((f) => f.message), [], 'control: the pressed row stays closed');
  // the lane 0.5 m wide where it leaves and rejoins
  r = FS.checkFinalScene(scene, { ...opt, lane: { ...b.pitLane, widthAt: () => 0.5 } });
  assert.deepEqual(r.refuse.map((f) => f.kind), ['lane', 'lane']);
  assert.match(r.refuse[0].message, /the pit lane is 0\.50 m wide where it leaves the road at 0\.\d\d km \(s \d+ m\)/);
});

test('row 6: under the bars: a crack in the road narrower than the ray check\'s 5 mm weld, a seam\'s zipper standing in the cross-section plane, and a hull that deepens evenly, are not found', () => {
  const { b, scene } = cleanScene(), opt = { path: b.path, segments: b.segments, lane: b.pitLane, open: false };
  const road = meshNamed(scene, /^1ROAD_p\d+_body_0_40$/);
  // the cell's every vertex moved 3 mm along the road: a 3 mm crack at one end, the cell pressed 3 mm into the next at the other
  const q = b.path.samples.find((x) => Math.abs(x.s - sOf(b, road)) < 0.3);
  let r = FS.checkFinalScene(withMesh(scene, road.name, (n) => { const P = Float32Array.from(n.positions); for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] += q.T[a] * 0.003; return { ...n, positions: P }; }), opt);
  assert.deepEqual(r.refuse.map((f) => f.message), []);
  // the same moved 12 mm: a crack the car's ray falls into
  r = FS.checkFinalScene(withMesh(scene, road.name, (n) => { const P = Float32Array.from(n.positions); for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] += q.T[a] * 0.012; return { ...n, positions: P }; }), opt);
  assert.ok(r.refuse.some((f) => f.kind === 'open'), 'control: 12 mm is found');
  // a seam mesh that is a fan standing in the cross-section plane (the zip between two fonts): not a face across the road
  const fan = { type: 'mesh', name: '1ROAD_seam_p2_body', material: road.material, visible: true, renderable: true, castShadows: true, transparent: false,
    positions: Float32Array.from([...q.pos, ...q.pos.map((x, a) => x + q.L[a]), ...q.pos.map((x, a) => x + q.U[a] * 0.5)]), normals: Float32Array.from([...q.T, ...q.T, ...q.T]), uvs: new Float32Array(6), indices: Uint16Array.from([0, 1, 2]) };
  r = FS.checkFinalScene({ ...scene, root: { ...scene.root, children: [...scene.root.children, fan] } }, opt);
  assert.deepEqual(said(r.refuse, 'across'), []);
  // a hull that deepens evenly, 5 cm a metre over 20 m, holds 1 m deeper for 20 m and comes back the same way (on the first straight, the side away from
  // the lane read): a slope, not a step, though each metre of it changes depth by more than the step's 3 cm
  const qa = b.path.samples.find((x) => Math.abs(x.s - 150) < 1.01), drop = (s) => (s < 150 ? 0 : s < 170 ? 0.05 * (s - 150) : s < 190 ? 1 : s < 210 ? 0.05 * (210 - s) : 0);
  const slope = (n) => {
    const P = Float32Array.from(n.positions);
    for (let i = 0; i < P.length; i += 3) {
      const d = [P[i] - qa.pos[0], P[i + 1] - qa.pos[1], P[i + 2] - qa.pos[2]]; if (Math.hypot(...d) > 90) continue;
      const k = drop(qa.s + d[0] * qa.T[0] + d[1] * qa.T[1] + d[2] * qa.T[2]); for (let a = 0; a < 3; a++) P[i + a] -= qa.U[a] * k;
    }
    return { ...n, positions: P };
  };
  r = FS.checkFinalScene({ ...scene, root: { ...scene.root, children: scene.root.children.map((n) => (n.type === 'mesh' && /^UNDERSKIN_/.test(n.name) ? slope(n) : n)) } }, opt);
  assert.deepEqual(said(r.warn, 'bottom'), []);
  // a seam's skin zipper standing in the joint's plane on the last row of a skin cell (the cell after it taken out, so the zipper meets that row alone): it stands
  // 90° to the skin by design, and is no fold
  const sk = meshNamed(scene, /^UNDERSKIN_p\d+_body_0_40$/), skNext = meshNamed(scene, /^UNDERSKIN_p\d+_body_0_41$/), SP = sk.positions, vtx = (i) => [SP[i * 3], SP[i * 3 + 1], SP[i * 3 + 2]];
  const qz = b.path.samples.find((x) => Math.abs(x.s - sOf(b, sk)) < 0.6), alongZ = (p) => (p[0] - qz.pos[0]) * qz.T[0] + (p[1] - qz.pos[1]) * qz.T[1] + (p[2] - qz.pos[2]) * qz.T[2];
  const acrossZ = (p) => (p[0] - qz.pos[0]) * qz.L[0] + (p[1] - qz.pos[1]) * qz.L[1] + (p[2] - qz.pos[2]) * qz.L[2];
  // the cell's far row (2 m on), by the road's own frame: its two vertices nearest the centre line, an edge of one skin triangle once the next cell is gone
  const far = Array.from({ length: SP.length / 3 }, (_, i) => i).filter((i) => alongZ(vtx(i)) > 1.5).sort((x, y) => Math.abs(acrossZ(vtx(x))) - Math.abs(acrossZ(vtx(y))));
  const [ia, ib] = far.slice(0, 2), a = vtx(ia), c2 = vtx(ib), down = [0, 1, 2].map((k) => (a[k] + c2[k]) / 2 - qz.U[k] * 0.3);
  assert.ok(skNext && Math.abs(alongZ(a) - alongZ(c2)) < 0.01 && Math.hypot(a[0] - c2[0], a[1] - c2[1], a[2] - c2[2]) > 0.2, 'control: two neighbouring vertices of the skin\'s far row, the next cell\'s skin there to take out');
  const zip = { type: 'mesh', name: 'UNDERSKIN_join_p1_body', material: sk.material, visible: true, renderable: true, castShadows: true, transparent: false,
    positions: Float32Array.from([...a, ...c2, ...down]), normals: Float32Array.from([...qz.T, ...qz.T, ...qz.T]), uvs: new Float32Array(6), indices: Uint16Array.from([0, 1, 2]) };
  r = FS.checkFinalScene({ ...scene, root: { ...scene.root, children: [...scene.root.children.filter((n) => n !== skNext), zip] } }, opt);
  assert.deepEqual(said(r.warn, 'fold'), []);
});

test('row 7: the export gives the check its path, segments and pit lane, refuses with SCENE on a drivable fault and writes nothing, lists it in the TEST route instead, and passes each drawn fault on as a warning', () => {
  // the check is the export's own; a finding is added on its way back, at the module boundary, to reach the export's handling of it
  // the module the export itself loads (a mutant's copy of the check is not it): its function is what the export calls
  const FS0 = require('../src/export/finalscene.js'), real = FS0.checkFinalScene, key = FW_FILE, seen = [];
  const fault = { refuse: [{ kind: 'open', piece: 'p2', s: 410, u: 3, count: 1, message: '1 edge(s) of the road are open by up to 9 mm at 0.41 km (s 410 m), 3.0 m left of the centre, in piece p2: a crack in the road\'s surface' }],
    warn: [{ kind: 'sliver', piece: 'p3', s: 700, u: -2, count: 1, message: '1 triangle(s) of the underside skin thinner than 4 mm at 0.70 km (s 700 m)' }] };
  delete require.cache[key];
  FS0.checkFinalScene = (...a) => { seen.push(a[1]); const r = real(...a); return { refuse: [...r.refuse, ...fault.refuse], warn: [...r.warn, ...fault.warn] }; };
  try {
    const FW2 = require(FW_FILE), doc = lap('scene wiring lap'), segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q);
    const start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
    const pitLane = { side: 'L', leave: { word: doc.pieces[0].id, along: 40 }, rejoin: { word: doc.pieces[0].id, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };
    assert.throws(() => FW2.buildFromSegments(segs, { name: 'wiring', via: 'test', liftPath: lift, start, pitLane }, { markers: startLayout(segs, lift, start) }),
      (e) => e.code === 'SCENE' && /a crack in the road's surface/.test(e.message) && /nothing was written/.test(e.message) && e.sceneCheck && e.sceneCheck.refuse.length === 1);
    assert.equal(seen.length, 1, 'the export ran the check once');
    assert.ok(seen[0].lane && seen[0].lane.joins && typeof seen[0].lane.widthAt === 'function', 'the export gave the check its pit lane');
    assert.equal(seen[0].open, false, 'a closed lap is read whole, its ends included');
    assert.ok(Array.isArray(seen[0].segments) && seen[0].path && seen[0].path.closed, 'the export gave the check its path and segments');
    const t = FW2.buildFromSegments(segs, { name: 'wiring', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start), test: true });
    assert.ok(t.test.reds.some((x) => x.startsWith('scene: ') && /a crack in the road's surface/.test(x)), t.test.reds.join(' | '));
    assert.ok(t.warnings.includes(`scene: ${fault.warn[0].message}`), t.warnings.join(' | '));
  } finally { FS0.checkFinalScene = real; delete require.cache[key]; }
});

test('row 9: a piece joint where the road\'s column count goes from even to odd (a cup ramp after a tube, then a cupped piece): the export refuses nothing, the planks there welded', () => {
  let d = extend(D.createDoc('scene joint parity'), { length: 100, family: 'bowl', first: { w: 60, t: 360 } });
  d = extend(d, { length: 100, targets: { t: 0, w: 32 } });
  d = extend(d, { length: 100, targets: { c: 16 } });
  d = extend(d, { length: 200, targets: {} });
  const b = exportDoc(d, { test: true }), r = checked(b);
  assert.deepEqual(r.refuse.map((f) => f.message), []);
  assert.deepEqual(b.test.reds.filter((x) => x.startsWith('scene: ')), []);
  // the skin's zipper at that joint stands in the joint's plane by design: it is no fold in the pieces either side
  assert.deepEqual(r.warn.filter((f) => f.kind === 'fold' && (f.piece === 'p3' || f.piece === 'p4')).map((f) => f.message), []);
});

test('row 10: a closed lap with a free jump: its road stops at the lip and starts again at the landing, and the export refuses nothing there', () => {
  const J = require('../src/core/jump.js'), R = 180, Q = (Math.PI * R) / 2;
  let d = J.jumpHere(extend(D.createDoc('scene jump lap'), { length: 300, family: 'bowl' }), null, { landing: { forward: 50, left: 3, up: -2, heading: 2 * Math.PI / 180 }, landingM: 300 });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const shut = close(d, { edited: [0] }); assert.equal(shut.converged, true, shut.report);
  const b = exportDoc(shut.doc), r = checked(b);
  assert.ok(A.toSegments(shut.doc).some((g) => g.kind === 'gap'), 'control: the lap has its jump');
  assert.deepEqual(r.refuse.map((f) => f.message), []);
});

test('row 8: bad input is refused by name', () => {
  const { b, scene } = cleanScene();
  assert.throws(() => FS.checkFinalScene(scene, { segments: b.segments }), /needs the scene, the path and its segments/);
  assert.throws(() => FS.checkFinalScene(null, { path: b.path, segments: b.segments }), /needs the scene/);
  assert.throws(() => FS.checkFinalScene(scene, { path: { samples: [] }, segments: b.segments }), /needs the scene/);
  const empty = FS.checkFinalScene({ ...scene, root: { ...scene.root, children: [] } }, { path: b.path, segments: b.segments });
  assert.deepEqual(empty, { refuse: [], warn: [] }, 'an empty scene has nothing to find');
  const road = scene.root.children.find((m) => m.type === 'mesh' && /^1ROAD_p/.test(m.name)), P = road.positions.slice(); P[0] = NaN;
  const broken = { ...scene, root: { ...scene.root, children: scene.root.children.map((m) => (m === road ? { ...m, positions: P } : m)) } };
  assert.throws(() => FS.checkFinalScene(broken, { path: b.path, segments: b.segments }), /is not a finite point/, 'a vertex that is not a number is refused by name');
});

test('row 11: the triangles\' tables keep every vertex and every edge as they grow, numbered in the order first seen', () => {
  const V = 200000, ids = FS.tripleIds();   // far past the table's first size, so it grows several times
  for (let i = 0; i < V; i++) assert.equal(ids.id(i, -3 * i, 7 * i - 1000), i);
  assert.equal(ids.size, V);
  for (let i = 0; i < V; i += 997) assert.equal(ids.id(i, -3 * i, 7 * i - 1000), i, `vertex ${i} keeps its number after the table grew`);
  assert.equal(ids.id(-5, 0, 0), V, 'a new vertex takes the next number'); assert.equal(ids.size, V + 1);
  const E = 100000, ed = FS.edgeGroups();
  for (let i = 0; i < E; i++) ed.add(i, i + 1, 2 * i);
  for (let i = 0; i < E; i++) ed.add(i, i + 1, 2 * i + 1);
  for (let i = 0; i < E; i += 7) ed.add(i, i + 1, -1);
  assert.equal(ed.size, E, 'one group per edge');
  for (let g = 0; g < E; g++) {
    if (ed.first[g] !== 2 * g || ed.second[g] !== 2 * g + 1 || ed.count[g] !== (g % 7 === 0 ? 3 : 2)) assert.fail(`edge ${g}: first ${ed.first[g]}, second ${ed.second[g]}, count ${ed.count[g]}`);
  }
});

// two passes: a lap at radius 120 m, then 0.6 of a lap 21 m further in, climbing 3.4 m a lap, so the second lap's edge apron comes down by the first lap's inner
// edge, through the hull's run under that edge's plank
function twoPasses() {
  const gap = 3.4, R1 = 120, R2 = R1 - 21, turn = 2 * Math.PI * R1, p = Math.atan(gap / turn);
  let d = D.createDoc('two passes'); d = { ...d, start: { ...d.start, pitch: p } };
  d = extend(d, { length: 300, family: 'bowl', first: { w: 20, c: 15.5 } });
  d = extend(d, { length: 0.75 * turn, transition: 40, targets: { kh: Math.cos(p) / R1 } });
  return extend(d, { length: 0.6 * 2 * Math.PI * R2, transition: 40, targets: { kh: Math.cos(p) / R2 } });
}

test("row 12: a drawn surface that passes through another pass's road or apron warns at its piece and station, and the two passes alone warn nothing", () => {
  const b = exportDoc(twoPasses(), { test: true, lightHull: false }), clean = checked(b);
  assert.deepEqual(b.test.reds, [], 'control: the two passes export as a clean test route');
  assert.deepEqual(clean.warn.filter((f) => f.kind === 'through').map((f) => f.message), []);
  assert.deepEqual(checkedLight().warn.filter((f) => f.kind === 'through').map((f) => f.message), [], 'and with the light hull, whose long triangles cross piece joints');
  // a copy of one of the upper lap's skin cells (its station about 1,029 m), laid onto the lower lap's road where it passes under (about 286 m); a copy, so the
  // cell's own place keeps its skin (moved away, its apron's tip edge opened, a crack the check refuses)
  const scene = (AR.weldApronJoints || ((x) => x))(AR.weldSeams(AR.flattenForAc(b.scene))), S = b.path.samples, at = (s) => S.reduce((a, q) => (Math.abs(q.s - s) < Math.abs(a.s - s) ? q : a)).pos;
  const up = at(1029), low = at(286), cen = (n) => { const P = n.positions, c = [0, 0, 0]; for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) c[k] += P[i + k] / (P.length / 3); return c; };
  const skin = scene.root.children.filter((n) => n.type === 'mesh' && /^UNDERSKIN_p3_body_/.test(n.name)).reduce((a, n) => (Math.hypot(...cen(n).map((x, k) => x - up[k])) < Math.hypot(...cen(a).map((x, k) => x - up[k])) ? n : a));
  const c = cen(skin), d = low.map((x, k) => x - c[k]);
  const moved = { ...scene, root: { ...scene.root, children: [...scene.root.children, { ...skin, name: `${skin.name}_copy`, positions: Float32Array.from(skin.positions, (x, i) => x + d[i % 3]) }] } };
  const r = FS.checkFinalScene(moved, { path: b.path, segments: b.segments, open: true }), through = r.warn.filter((f) => f.kind === 'through');
  assert.equal(through.length, 1, r.warn.map((f) => f.message).join('; '));
  assert.match(through[0].message, /^\d+ face\(s\) of the underside skin pass through (the road|the edge apron) of another pass \(standing up to .* out of it\) at .* in piece p3: the hull shows through a surface the car drives on$/);
  assert.ok(Math.abs(through[0].s - 1029) < 25, `found at s ${through[0].s}, made from the cell at s 1,029`);
  assert.deepEqual(r.refuse, [], 'drawn only: nothing is refused');
  // a small drawn face across one face of the lower road, two corners 20 mm under it and one standing H over it, all within it: at 5 mm it only grazes the road
  // (under the floor, THROUGH_MIN_M) and is not said; at 50 mm it is
  const road = scene.root.children.filter((n) => n.type === 'mesh' && /^1ROAD_p1_body_/.test(n.name)).reduce((x, n) => (Math.hypot(...cen(n).map((v, k) => v - low[k])) < Math.hypot(...cen(x).map((v, k) => v - low[k])) ? n : x));
  const w = [0, 1, 2].map((j) => { const i = road.indices[j] * 3; return [road.positions[i], road.positions[i + 1], road.positions[i + 2]]; });
  const sb = (p, o) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]], cr = (p, o) => [p[1] * o[2] - p[2] * o[1], p[2] * o[0] - p[0] * o[2], p[0] * o[1] - p[1] * o[0]], un = (p) => { const l = Math.hypot(...p); return p.map((x) => x / l); };
  const n = un(cr(sb(w[1], w[0]), sb(w[2], w[0]))), e1 = un(sb(w[1], w[0])), e2 = cr(n, e1), c0 = [0, 1, 2].map((k) => (w[0][k] + w[1][k] + w[2][k]) / 3);
  const pt = (x, y, h) => [0, 1, 2].map((k) => c0[k] + x * e1[k] + y * e2[k] + h * n[k]);
  const face = (H) => ({ type: 'mesh', name: `UNDERSKIN_p3_body_graze_${H}`, visible: true, renderable: true, positions: Float32Array.from([...pt(-0.08, -0.05, -0.02), ...pt(0.08, -0.05, -0.02), ...pt(0, 0.08, H)]), normals: new Float32Array(9), uvs: new Float32Array(6), indices: Uint16Array.from([0, 1, 2]) });
  const said = (H) => FS.checkFinalScene({ ...scene, root: { ...scene.root, children: [...scene.root.children, face(H)] } }, { path: b.path, segments: b.segments, open: true }).warn.filter((f) => f.kind === 'through').map((f) => f.message);
  assert.deepEqual(said(0.005), [], "a face 5 mm out of the other pass's road only grazes it");
  assert.equal(said(0.05).length, 1, 'a face 50 mm out of it is said');
});
const checkedLight = () => checked(exportDoc(twoPasses(), { test: true }));

test("row 13: ELYSIUM: its p38's hull passes through p40's road and apron, and the check says so in piece p38", () => {
  const doc = D.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'), 'utf8')), b = exportDoc(doc), r = checked(b);
  const through = r.warn.filter((f) => f.kind === 'through');
  assert.ok(through.some((f) => f.piece === 'p38' && /of the underside skin pass through (the road|the edge apron) of another pass/.test(f.message)), through.map((f) => f.message).join('; ') || 'nothing found');
  assert.deepEqual(r.refuse, [], 'drawn only: nothing is refused');
});

test("row 14: the export warns by the builder's pass-clearance rule, a stretch at a time, and the clean pit lap has no such warning", () => {
  const { passClearance, CAR_MARGIN_M } = require('../src/validate/passclear.js');
  const b = exportDoc(twoPasses(), { test: true }), said = b.warnings.filter((w) => w.startsWith('clearance: '));
  const found = passClearance(b.path, b.segments, { apronM: 2 });
  assert.ok(found.length > 0, "control: by the rule, the two passes are closer than the car's room");
  assert.equal(said.length, b.clearance.length, 'one warning a stretch');
  assert.ok(said.length > 0 && said.length <= found.length, `${said.length} warnings for ${found.length} stations`);
  assert.equal(said.length, 1, `the rule's ${found.length} stations, 2 m apart against one other pass, are one stretch`);
  for (const w of said) assert.match(w, new RegExp(`^clearance: another stretch of the road \\(at [0-9.]+ km\\) passes [0-9.]+ m (over|through) the road at .* where a car needs ${CAR_MARGIN_M.toFixed(1)} m: [0-9.]+ m short.*The builder refuses an edit that brings a pass this close$`));
  // every station the rule found lies in a stretch, and each stretch's worst is the rule's own
  for (const x of found) assert.ok(b.clearance.some((c) => x.s >= c.s0 - 1e-9 && x.s <= c.s1 + 1e-9), `the rule's station s ${x.s} is in a stretch`);
  for (const c of b.clearance) assert.equal(c.shortM, Math.max(...found.filter((x) => x.s >= c.s0 - 1e-9 && x.s <= c.s1 + 1e-9).map((x) => x.shortM)));
  assert.deepEqual(b.test.reds, [], 'a warning, not a red');
  assert.deepEqual(pitLap().warnings.filter((w) => w.startsWith('clearance: ')), []);
});

test("row 15: a drawn face is another pass's only when all its corners are, 15 m along the road is the same pass, and it stands out by what lies over the road face", () => {
  const b = exportDoc(twoPasses(), { test: true, lightHull: false }), S = b.path.samples, scene = (AR.weldApronJoints || ((x) => x))(AR.weldSeams(AR.flattenForAc(b.scene)));
  const at = (s) => S.reduce((a, q) => (Math.abs(q.s - s) < Math.abs(a.s - s) ? q : a));
  const sb = (p, o) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]], cr = (p, o) => [p[1] * o[2] - p[2] * o[1], p[2] * o[0] - p[0] * o[2], p[0] * o[1] - p[1] * o[0]], un = (p) => { const l = Math.hypot(...p); return p.map((x) => x / l); };
  const dt = (p, o) => p[0] * o[0] + p[1] * o[1] + p[2] * o[2];
  // the lower lap's road face nearest the path at s: its corners, its unit normal (its drivable side, as row 12's), the road's way along it in its plane and across
  // it, and pt(x along, y across, h out) from its centre
  const faceAt = (s) => {
    const q = at(s); let w = null, bd = Infinity;
    for (const m of scene.root.children) if (m.type === 'mesh' && /^1ROAD_p[0-9]+_body_/.test(m.name)) for (let t = 0; t < m.indices.length; t += 3) {
      const v = [0, 1, 2].map((j) => { const i = m.indices[t + j] * 3; return [m.positions[i], m.positions[i + 1], m.positions[i + 2]]; }), c = [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3), d = Math.hypot(...sb(c, q.pos));
      if (d < bd) { bd = d; w = v; }
    }
    const n = un(cr(sb(w[1], w[0]), sb(w[2], w[0]))), along = un(sb(q.T, n.map((x) => x * dt(q.T, n)))), across = cr(n, along), c0 = [0, 1, 2].map((k) => (w[0][k] + w[1][k] + w[2][k]) / 3);
    // how far from the centre, straight along, the face ends (its edge the ray leaves by)
    const P = w.map((p) => [dt(sb(p, c0), along), dt(sb(p, c0), across)]); let xe = Infinity;
    for (let e = 0; e < 3; e++) { const [a, c] = [P[e], P[(e + 1) % 3]]; if ((a[1] > 0) !== (c[1] > 0)) { const x = a[0] + ((c[0] - a[0]) * a[1]) / (a[1] - c[1]); if (x > 0) xe = Math.min(xe, x); } }
    return { w, xe, pt: (x, y, h) => [0, 1, 2].map((k) => c0[k] + x * along[k] + y * across[k] + h * n[k]) };
  };
  const mesh = (name, pts) => ({ type: 'mesh', name, visible: true, renderable: true, positions: Float32Array.from(pts.flat()), normals: new Float32Array(3 * pts.length), uvs: new Float32Array(2 * pts.length), indices: Uint16Array.from([0, 1, 2]) });
  const said = (...extra) => FS.checkFinalScene({ ...scene, root: { ...scene.root, children: [...scene.root.children, ...extra] } }, { path: b.path, segments: b.segments, open: true }).warn.filter((f) => f.kind === 'through').map((f) => f.message);
  // (1) a long drawn face of the lower lap's own piece through its own road at s 400, 50 mm out over the road face, its third corner 120 m out along the road's way
  // and 12 m up: its centre's station is some 40 m on, but two of its corners are on the road it crosses, so it is the same pass and not said
  const a = faceAt(400), longPts = [a.pt(-0.05, -0.08, -0.02), a.pt(-0.05, 0.08, -0.02), a.pt(120, 0, 12)];
  assert.ok(a.xe > 0.25, `control: the road face reaches ${a.xe} m on, past where the long face comes out of it`);
  assert.equal(said(mesh('UNDERSKIN_p3_body_long', longPts)).length, 1, "control: the same face filed under the upper lap's piece is said");
  assert.deepEqual(said(mesh('UNDERSKIN_p2_body_long', longPts)), [], "a face with corners on its own pass's road is that pass's, wherever its centre lies");
  // (2) the upper lap's drawn face laid onto the lower road at s 286 (as row 12's), climbing out of the road face so gently that over the face itself it stands 4 mm
  // out (under THROUGH_MIN_M), and 50 mm only some metres on, where it is over no face it crosses: not said
  const g = faceAt(286), k = 0.008 / g.xe, x0 = g.xe / 2, slope = mesh('UNDERSKIN_p3_body_slope', [g.pt(0, -0.02, -k * x0), g.pt(0, 0.02, -k * x0), g.pt(x0 + 0.05 / k, 0, 0.05)]);
  const k5 = 5 * k;   // control: five times as steep, it stands 20 mm out over the road face itself, and is said
  assert.equal(said(mesh('UNDERSKIN_p3_body_steeper', [g.pt(0, -0.02, -k5 * x0), g.pt(0, 0.02, -k5 * x0), g.pt(x0 + 0.05 / k5, 0, 0.05)])).length, 1, 'control: 20 mm out over the road face is said');
  assert.deepEqual(said(slope), [], `a face 4 mm out over the road face it crosses only grazes it, though it is 50 mm over that face's plane ${(x0 + 0.05 / k).toFixed(1)} m on`);
  // (3) one face of the lower road at s 315 copied and filed under the piece before it, p1, whose own station there is its end (300): a drawn face of p2 through it,
  // 50 mm out, is 15 m along the road from it, the same pass, and not said
  const c = faceAt(315), copy = mesh('1ROAD_p1_body_copy', c.w), near = mesh('UNDERSKIN_p2_body_near', [c.pt(-0.08, -0.05, -0.02), c.pt(0.08, -0.05, -0.02), c.pt(0, 0.08, 0.05)]);
  assert.equal(said(mesh('1ROAD_p3_body_copy', c.w), near).length, 1, "control: the same face filed under the upper lap's piece is another pass's, and said");
  assert.deepEqual(said(copy, near), [], 'a road face 15 m along the road is the same pass');
});
