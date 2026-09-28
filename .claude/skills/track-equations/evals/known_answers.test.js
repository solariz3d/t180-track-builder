// known_answers.test.js: node --test --test-concurrency=4 .claude/skills/track-equations/evals/known_answers.test.js
// The track-equations skill's references held to KNOWN ANSWERS (D184, pane C): every check in checks.js against the reference
// implementations in mathref.cjs. A formula is in references/ only when one of these exercises it (references/README.md).
'use strict';
const test = require('node:test');
const M = require('./mathref.cjs');
const CHECKS = require('./checks.js');

for (const c of CHECKS) test(`track-equations ${c.section}: ${c.name}`, () => c.run(M));

// The exported known meshes (references/06) are the ones the checks build: same vertex count, and the sphere's smoothed K at its
// exported radius is 1/R². A session re-running a check uses these, not a copy with its own radius.
test('track-equations 06: the exported meshes and parameters rebuild what the checks use', () => {
  const assert = require('node:assert/strict'), { meshes, params, meshCurvature, smoothK } = CHECKS;
  for (const k of ['sphere', 'cylinder', 'cone', 'torus', 'dishedCorner']) assert.equal(typeof meshes[k], 'function', k);
  const P = params.sphere, c = meshCurvature(meshes.sphere()), K = smoothK(c, P.smoothRadius);
  assert.equal(c.nV, 2 + (P.nv - 1) * P.nu);
  let n = 0; for (let i = 0; i < c.nV; i++) if (c.interior[i] && Math.abs(c.P[i * 3 + 1]) < P.awayFromPoles * P.R) { n++; assert.ok(Math.abs(K[i] - M.sphereK(P.R)) <= P.tolerance * M.sphereK(P.R)); }
  assert.ok(n > 200);
  assert.equal(meshes.torus().vs.length, params.torus.nu * params.torus.nv);
});
