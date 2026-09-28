// core_water_mutation.test.js: node --test --test-concurrency=4 test/core_water_mutation.test.js
// Each mutant changes ONE thing in src/core/water.js (one exact string replacement, in a temporary copy whose require of
// src/geom is made absolute). Every check in core_water.test.js runs against the copy, and the mutant must be CAUGHT by a
// check that passes on the ORIGINAL (the CONTROL below). A mutant whose string is not found exactly once is NOT APPLIED,
// and fails. Each result line says which checks caught it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'core', 'water.js');
const CHECKS = require('./core_water.test.js');

const MUTANTS = [
  ['W1 normal force: gravity term dropped', 'return knv2 + g * r.n[1];', 'return knv2;'],
  ['W2 normal force: the cross term not doubled', 'mul(r.Ssu, 2 * sd * ud)', 'mul(r.Ssu, sd * ud)'],
  ['W3 no velocity projection onto the tangent plane', 'vn = sub(vn, mul(r.n, dot(vn, r.n)));', 'vn = vn;'],
  ['W4 RK4: middle stages weighted 1, not 2', 'mul(add(v2, v3), 2)', 'mul(add(v2, v3), 1)'],
  ['W5 spill: the −u lip never checked', 'if (r.u > r.hi || r.u < r.lo) {', 'if (r.u > r.hi || r.u < r.lo - 1e9) {'],
  ['W6 spill: the +u lip never checked', 'if (r.u > r.hi || r.u < r.lo) {','if (r.u > r.hi + 1e9 || r.u < r.lo) {'],
  ['W7 lift-off never flagged', 'else if (Nn < 0) {', 'else if (Nn < -1e9) {'],
  ['W8 shock never flagged', 'if (prev !== null && prev > 0 && d <= 0)', 'if (prev !== null && prev > 0 && d < -1e9)'],
  ['W9 quintic Hermite: a basis coefficient off', '[0, 0, 0.5, -1.5, 1.5, -0.5]', '[0, 0, 0.5, -1.5, 1.5, -0.4]'],
  ['W10 frame slope: equal-spacing central difference', 'if (a === i || b === i) return mul(sub(A[b], A[a]), 1 / (sb - sa));', 'return mul(sub(A[b], A[a]), 1 / (sb - sa));'],
  ['W11 profile: Y′ without the side\'s sign', 'Y1: sg * Math.sin(psi)', 'Y1: Math.sin(psi)'],
  ['W12 profile blend: no s-derivative', 'w1 = 6 * t * (1 - t) / h', 'w1 = 0'],
  ['W13 spill located at the step\'s end, not inside it', 'const edge = r.u > r.hi ? r.hi : r.lo, w = lerp(u - edge, r.u - edge);', 'const edge = r.u > r.hi ? r.hi : r.lo, w = 1;'],
  ['W14 projection: Gauss–Newton step reversed', 's += ds; u += du; r = at(F, s, u);', 's -= ds; u -= du; r = at(F, s, u);'],
  ['W15 energy instrument reads nothing', 'maxAbs = Math.max(maxAbs, Math.abs(E - E0));', 'maxAbs = 0;'],
  ['W16 the pos′ = T refusal disabled', 'if (!(off <= 1e-3))', 'if (!(off <= 1e9))'],
  ['W18 the pos′ = T check without the h²/12 correction', 'mul(sub(K[i], K[i + 1]), h * h / 12)', 'mul(sub(K[i], K[i + 1]), 0)'],
  ['W19 a lifted sample\'s d1 ignored', 'T.push([...(m.d1 || m.T)]);', 'T.push([...m.T]);'],
  ['W17 closed seam: the wrap sample not appended', 'if (closed && S[n - 1] < S[0] + Lm - 1e-9) {', 'if (false) {'],
];

const src = fs.readFileSync(SRC, 'utf8').replace("require('../geom/profile.js')", () => `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'geom', 'profile.js'))})`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-water-'));
const baseline = new Set(); { const W = require(SRC); for (const c of CHECKS) { try { c.run(W); baseline.add(c); } catch (e) { /* the control reports it */ } } }
test('CONTROL: every water check passes on the unmutated water.js', () => {
  assert.deepEqual(CHECKS.filter((c) => !baseline.has(c)).map((c) => c.name), []);
});
for (const [name, from, to] of MUTANTS) {
  test(`mutant ${name}: applied, and CAUGHT`, (t) => {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in water.js`);
    const f = path.join(dir, `${name.split(' ')[0]}.js`); fs.writeFileSync(f, src.replace(from, () => to));
    const W = require(f), caught = [];
    for (const c of CHECKS) { if (!baseline.has(c)) continue; try { c.run(W); } catch (e) { caught.push(c.name.split(':')[0]); } }
    t.diagnostic(`${name}: caught by ${caught.length ? caught.join(' | ') : 'NOTHING'}`);
    assert.ok(caught.length > 0, `${name} was NOT CAUGHT`);
  });
}
