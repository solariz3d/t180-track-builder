// Tests for src/validate/raygap.js and its place in validate(): gaps in the PHYSICS road under the Mach 6's downforce
// ray are RED ('downforce-ray-gap'), because the ray (1 m ahead of the car, 1 m long; R1, research §4, from the installed
// car's script.lua:424-433) gives ZERO downforce on a miss. Synthetic meshes only.
// Run: node --test --test-concurrency=4 test/validate_raygap.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { rayGaps } = require('../src/validate/raygap.js');
const { validate, SRC } = require('../src/validate/index.js');
const { MACH6 } = require('../src/validate/limits.js');
const L = require('../app/validate-ui/labels.js');
const X = require('./validate_paths.js');

const RAY = MACH6.downforceRay;
/** A flat strip x ∈ [x0, x1], z ∈ [z0, z1], 1 m cells, as one mesh { positions, indices }. */
function strip(x0, x1, z0, z1, y = 0) {
  const nx = Math.round(x1 - x0), nz = Math.round(z1 - z0), pos = [], idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) pos.push(x0 + (x1 - x0) * i / nx, y, z0 + (z1 - z0) * j / nz);
  const at = (i, j) => j * (nx + 1) + i;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  return { positions: Float64Array.from(pos), indices: idx };
}
const stations = (z1) => Array.from({ length: z1 + 1 }, (_, z) => ({ s: z, pos: [0, 0, z], L: [1, 0, 0], T: [0, 0, 1] }));

test('an unbroken road has no gap: its outer edges and its two ends are not gaps', () => {
  assert.deepStrictEqual(rayGaps([strip(-5, 5, 0, 60)], stations(60), RAY), []);
});

test('a 0.3 m slit across the road is a gap, at its s, narrower than the ray\'s reach', () => {
  const g = rayGaps([strip(-5, 5, 0, 30), strip(-5, 5, 30.3, 60)], stations(60), RAY);
  assert.ok(g.length > 0, 'found');
  assert.ok(g.every((x) => Math.abs(x.s - 30) <= 1 && x.widthM <= 0.5), JSON.stringify(g.slice(0, 3)));
});

test('a 0.2 m tear ALONG the road (two pieces side by side) is a gap', () => {
  const g = rayGaps([strip(-5, 0, 0, 60), strip(0.2, 5, 0, 60)], stations(60), RAY);
  assert.ok(g.length > 0 && g.every((x) => Math.abs(x.u - 0.1) < 0.2), JSON.stringify(g.slice(0, 3)));
});

test('an opening wider than the ray reaches (a 5 m flight) is not a ray gap: that is a jump\'s business', () => {
  assert.deepStrictEqual(rayGaps([strip(-5, 5, 0, 30), strip(-5, 5, 35, 60)], stations(60), RAY), []);
});

test('road 0.7 m BELOW the far side of a slit is beyond the ray (0.4 m up, 1 m long: 0.6 m down): not a gap', () => {
  assert.deepStrictEqual(rayGaps([strip(-5, 5, 0, 30), strip(-5, 5, 30.3, 60, -0.7)], stations(60), RAY), []);
});

test('triangles that face along the road (a seam\'s zip fan in the cross-section plane) are neither gap edges nor road', () => {
  const fan = { positions: Float64Array.from([-5, 0, 30, 5, 0, 30, 0, 3, 30, -5, 0, 30, 0, 3, 30, -6, 3, 30]), indices: [0, 1, 2, 3, 4, 5] };
  assert.deepStrictEqual(rayGaps([strip(-5, 5, 0, 30), strip(-5, 5, 30, 60), fan], stations(60), RAY), []);
});

// ── inside validate() ──
const straightPath = () => ({ path: X.pathOf(X.straight(60, { seg: 0 })), segs: [X.seg({ id: 'run' })] });

test('validate: a slit in the built road is RED "downforce-ray-gap", in plain words, with its source', () => {
  const { path, segs } = straightPath();
  const v = validate(path, segs, { roadMesh: [strip(-5, 5, 0, 30), strip(-5, 5, 30.3, 60)] });
  const r = v.red.find((x) => x.reason === 'downforce-ray-gap');
  assert.ok(r, JSON.stringify(v.red));
  assert.ok(Math.abs(r.s0 - 30) <= 2, `at s ${r.s0}`);
  assert.match(SRC['downforce-ray-gap'], /research\/04_ac_physics_drivability\.md §4/);
  assert.match(L.reasonText('downforce-ray-gap'), /loses all its downforce/);
});

test('validate: without the built road the check is listed as not done, never passed silently', () => {
  const { path, segs } = straightPath();
  const v = validate(path, segs);
  assert.ok(!v.red.some((x) => x.reason === 'downforce-ray-gap'));
  assert.match(v.notChecked.join('\n'), /downforce-ray-gap/);
});

test('validate: every checked jump notes the downforce step at its lip and its landing', () => {
  const run = X.straight(100, { seg: 0 }), gap = X.straight(40, { seg: 1, start: [0, 0, 100], s0: 100 }).slice(1, -1), land = X.straight(120, { seg: 2, start: [0, -3, 140], s0: 140 });
  const segs = [X.seg({ id: 'run', speed: 200 }), X.seg({ id: 'j', kind: 'gap', word: 'jump', speed: 200 }), X.seg({ id: 'land', speed: 200 })];
  const j = validate(X.pathOf([...run, ...gap, ...land]), segs).jumps[0];
  assert.strictEqual(j.downforceStep.aheadM, RAY.aheadM);
  assert.match(j.downforceStep.note, /returns in one step when it finds the landing/);
});

test('two pieces whose shared row lies 0.2 mm apart ACROSS a 5 mm rounding boundary are welded, not a gap', () => {
  // the first weld rounded each vertex to one bucket: 30.0024 and 30.0026 round to different buckets (6000.48, 6000.52) (doc-e2e's loop)
  assert.deepStrictEqual(rayGaps([strip(-5, 5, 0, 30.0024), strip(-5, 5, 30.0026, 60)], stations(60), RAY), []);
});

// ── D446: road beyond an edge counts only on the SAME PASS (a track, TEST 10 banked: a banked piece curled back on itself, its two edges 0.64 m apart,
// read as two ray gaps 355 m apart along the lap). Another pass beside the edge is not a gap; it is a near-touch, reported as information ──
/** Pass B: a flat strip beside pass A, x ∈ [x0, x0 + 10], running back down z, with its own stations far on along the lap (s 400 on). */
const passB = (x0, z1 = 60) => ({ mesh: strip(x0, x0 + 10, 0, z1), stations: Array.from({ length: z1 + 1 }, (_, k) => ({ s: 400 + k, pos: [x0 + 5, 0, z1 - k], L: [-1, 0, 0], T: [0, 0, -1] })) });

test('D446: another pass 0.6 m beside an edge, 400 m on along the lap, is not a gap: the edge is a near-touch, 0.6 m from it', () => {
  const B = passB(5.6), near = [];
  const g = rayGaps([strip(-5, 5, 0, 60), B.mesh], [...stations(60), ...B.stations], RAY, { near });
  assert.deepStrictEqual(g, [], JSON.stringify(g.slice(0, 3)));
  assert.ok(near.length > 0, 'the near-touch is reported');
  assert.ok(near.every((x) => Math.abs(x.edgeM - 0.6) < 1e-6 && Math.abs(x.otherS - x.s) > 300), JSON.stringify(near.slice(0, 3)));
});

/** A slit across the road at z 30–30.3 is found from BOTH its sides: an edge at z 30 (probing on) and one at z 30.3 (probing back). */
const bothSides = (g) => g.some((x) => Math.abs(x.at[2] - 30) < 1e-6) && g.some((x) => Math.abs(x.at[2] - 30.3) < 1e-6);
test('D446: a slit across the road is still a gap, from both its sides, with another pass beside it', () => {
  const B = passB(5.6);
  const g = rayGaps([strip(-5, 5, 0, 30), strip(-5, 5, 30.3, 60), B.mesh], [...stations(60), ...B.stations], RAY);
  assert.ok(g.some((x) => Math.abs(x.s - 30) <= 1 && x.widthM <= 0.5), JSON.stringify(g.slice(0, 3)));
  assert.ok(bothSides(g), `both sides: ${JSON.stringify(g.map((x) => x.at[2]))}`);
});

test('D446: on a closed lap the same pass is measured round the seam: a slit AT the seam is still a gap, from both its sides', () => {
  // stations s = (z + 30.5) mod 61: the seam (s 60.5 back to 0.5) falls at z 30–31, where the slit is; along s without the lap the two sides are 60 m apart
  const st = Array.from({ length: 61 }, (_, z) => ({ s: (z + 30.5) % 61, pos: [0, 0, z], L: [1, 0, 0], T: [0, 0, 1] }));
  const meshes = [strip(-5, 5, 0, 30), strip(-5, 5, 30.3, 60)];
  const g = rayGaps(meshes, st, RAY, { lapM: 61 });
  assert.ok(bothSides(g), `both sides: ${JSON.stringify(g.map((x) => [x.s, x.at[2]]))}`);
});

/** The curled bowl (D446): a square inward spiral of bowl road whose 5th leg runs beside its 1st, their centre lines one road width apart, the 5th banked 0.3 rad so its lip leans toward the 1st's: the lips come within 0.5 m (measured), as TEST 10 banked's within 0.64 m. */
function curledBowl(apart = 0) {
  const D = require('../src/core/document.js'), { extend } = require('../src/core/extend.js'), { WIDTHS } = require('../src/geom/fonts.js');
  const R = 60, q = R * Math.PI / 2, turn = (d) => extend(extend(d, { length: q, transition: q, targets: { kh: -1 / R } }), { length: q, transition: q, targets: { kh: 0 } });
  let d = extend(D.createDoc('curled bowl'), { length: 300, family: 'bowl' });
  for (const L of [200, 150, 200 - WIDTHS.bowl - apart]) d = extend(turn(d), { length: L });   // apart: m more between the two centre lines (row 15)
  return extend(turn(d), { length: 150, transition: 40, targets: { phi: -0.3 } });
}
test('D446: validate on a built curled bowl, two passes whose lips come within 1 m: no downforce-ray-gap red; a near-touch, in plain words, with its source', () => {
  const G = require('../src/geom/index.js'), OJ = require('../app/core/overlapjob.js'), { walkScene, isDrivable } = require('../src/export/markers.js');
  const r = OJ.resolveDoc(curledBowl()), p0 = G.buildPath(r.segments, { step: 2, closed: false, start: r.start }), p = r.lift ? r.lift(p0) : p0;
  const mesh = G.buildMesh(p, r.segments, { selfCheck: true }), roadMesh = walkScene(mesh.scene).meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length);
  const v = validate(p, r.segments, { csp: true, softCollision: true, folds: mesh.folds, roadMesh, fullSpeed: true });
  assert.deepStrictEqual(v.red.filter((x) => x.reason === 'downforce-ray-gap'), [], 'the other pass is not a gap');
  const t = v.info.filter((x) => x.reason === 'near-touch');
  assert.ok(t.length > 0 && t.every((x) => x.worst > 0 && x.worst <= MACH6.nearEdgeM), JSON.stringify(t));
  assert.ok(t.some((x) => x.s0 > 100 && x.s0 < 300), `on the first leg: ${JSON.stringify(t)}`);
  assert.match(SRC['near-touch'], /ARCHITECTURE.md:85/);
  assert.match(L.reasonText('near-touch'), /two parts of the road come within 1 m of each other edge to edge/);
});

// Row 15 (D446, the chair's addition): the near-touch is only for edges within MACH6.nearEdgeM. An edge whose probe meets another pass is always within
// about 1.17 m of it (the probe is at most 1 m out in the edge's plane and the ray reaches 0.6 m below it: sqrt(1 + 0.6^2)), so the filter's range is
// 1 to 1.17 m, and an edge farther off never reaches it. This curled bowl, its centre lines 0.6 m farther apart than row 14's, puts the closest approach there.
function nearTouchesOf(doc) {
  const G = require('../src/geom/index.js'), OJ = require('../app/core/overlapjob.js'), { walkScene, isDrivable } = require('../src/export/markers.js');
  const r = OJ.resolveDoc(doc), p0 = G.buildPath(r.segments, { step: 2, closed: false, start: r.start }), p = r.lift ? r.lift(p0) : p0;
  const mesh = G.buildMesh(p, r.segments, { selfCheck: true }), roadMesh = walkScene(mesh.scene).meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length);
  const near = []; rayGaps(roadMesh, p.samples, RAY, { near });
  return { near, v: validate(p, r.segments, { csp: true, softCollision: true, folds: mesh.folds, roadMesh, fullSpeed: true }) };
}
test('D446: another pass whose edge comes no closer than about 1.1 m is NOT a near-touch: only edges within 1 m are', () => {
  const { near, v } = nearTouchesOf(curledBowl(0.6));
  assert.ok(near.length > 0 && near.every((x) => x.edgeM > MACH6.nearEdgeM && x.edgeM < 1.2), `control: the probe met the other pass, every edge over 1 m from it: ${JSON.stringify(near.map((x) => [x.s, +x.edgeM.toFixed(3)]))}`);
  assert.deepStrictEqual(v.info.filter((x) => x.reason === 'near-touch'), [], 'no near-touch');
  assert.deepStrictEqual(v.red.filter((x) => x.reason === 'downforce-ray-gap'), [], 'and no gap');
});
