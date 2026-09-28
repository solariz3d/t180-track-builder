// doc-geom.test.js: node --test test/*.test.js
// The contract between the document model and the geometry core (docs/INTERFACES.md §1–§2): what resolve() hands
// buildPath() is built as meant. If either side changes its shape, this goes red. Dependency-free.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const G = require('../src/geom/index.js');
const { validateScene } = require('../src/export/scene.js');

const DEG = Math.PI / 180;
function track() {
  let d = D.createDoc('contract');
  for (const [w, o] of [['straight'], ['sweep', { tempo: 'aurora', handles: { easeOut: 0 } }], ['turn'], ['tight', { dir: 'R' }],
    // the jump NAMED (12 m across, 0.7 m down, landing at −2°): from D182 the default jump is the library's p10 gap
    ['straight', { handles: { climb: 4 * DEG } }], ['jump', { handles: { gap: 12, drop: 0.7, land: -2 * DEG } }], ['straight', { handles: { length: 60 } }], ['wall-ride'], ['inversion']]) d = D.appendWord(d, w, o || {});
  return D.resolve(d);
}

test('the path is as long as the segments, and every segment is walked', () => {
  const r = track(), p = G.buildPath(r.segments, { step: 1 });
  const sum = r.segments.reduce((a, g) => a + g.length, 0);
  assert.ok(Math.abs(p.lengthM - sum) < 1e-9, `${p.lengthM} vs ${sum}`);
  assert.equal(new Set(p.samples.map((s) => s.seg)).size, r.segments.length);
  assert.equal(p.closed, false);
});

test('the geometry flies the jump where resolve solved it: 12 m across, 0.7 m down, landing at -2°', () => {
  const r = track(), p = G.buildPath(r.segments, { step: 0.5 }), gi = r.segments.findIndex((g) => g.kind === 'gap');
  const a = p.samples.find((s) => s.seg === gi), b = p.samples.find((s) => s.seg === gi + 1);
  assert.ok(Math.abs(Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]) - 12) < 1e-6);
  assert.ok(Math.abs(b.pos[1] - a.pos[1] + 0.7) < 1e-6);
  assert.ok(Math.abs(Math.atan2(b.T[1], Math.hypot(b.T[0], b.T[2])) / DEG + 2) < 1e-4);
});

test('the mesh built from a resolved document passes the export validator', () => {
  const r = track(), m = G.buildMesh(G.buildPath(r.segments, { step: 1 }), r.segments, {});
  assert.doesNotThrow(() => validateScene(m.scene));
  assert.equal(m.folds.length, 0);
});
