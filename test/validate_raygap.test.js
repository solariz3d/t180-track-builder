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
