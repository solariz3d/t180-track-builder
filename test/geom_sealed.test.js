// geom_sealed.test.js: node --test test/geom_sealed.test.js
// D343: src/geom/profile.js sealed(P), a FROZEN copy of a profile, so offsetAt takes its running sums for a profile a caller builds and then reads at many u (the
// checker's cup blend at a station, a joint's two cross-sections). The numbers must not change: the running sums add the same pieces in the same order. Rows:
//   1  the copy is frozen (and its u and psi), the original is untouched, and a frozen profile is handed back as it is
//   2  offsetAt on the copy is the original's, bit for bit, at every u, on a bowl's edge profile and on a blend between two
//   3  stepBetween (which now reads sealed copies) is the same measure computed on unfrozen profiles
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/geom/profile.js');

const bowl = () => P.normalize({ u: [-17.5, -12, -6, -2, 0, 3, 8, 13, 17.5], psi: [1.21, 0.73, 0.22, 0.04, 0, 0.06, 0.31, 0.78, 1.33] });
const flat = () => P.normalize({ u: [-30, 0, 30], psi: [0, 0, 0] });

test('row 1: sealed is a frozen copy (u and psi too), the original is untouched, and a frozen profile comes back as it is', () => {
  const p = bowl(), s = P.sealed(p);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.u) && Object.isFrozen(s.psi));
  assert.ok(!Object.isFrozen(p) && !Object.isFrozen(p.u), 'the caller\'s profile is not frozen by it');
  assert.deepEqual({ ...s, u: [...s.u], psi: [...s.psi] }, p, 'the same fields and numbers');
  assert.equal(P.sealed(s), s, 'already frozen: the same object');
});

test('row 2: offsetAt on the sealed copy is the original\'s, bit for bit, at every u, on an edge profile and on a blend', () => {
  for (const [what, prof] of [['a bowl', bowl()], ['a blend at 0.37', P.normalize(P.blend(flat(), bowl(), 0.37))]]) {
    const s = P.sealed(prof), E = [prof.u[0], prof.u[prof.u.length - 1]];
    for (let k = 0; k <= 400; k++) {
      const u = E[0] + (E[1] - E[0]) * k / 400, a = P.offsetAt(prof, u), b = P.offsetAt(s, u);
      assert.ok(a[0] === b[0] && a[1] === b[1], `${what}, u ${u}: ${a} against ${b}`);
    }
  }
});

test('row 3: stepBetween is the same measure as on unfrozen profiles', () => {
  const A = bowl(), B = P.normalize(P.blend(flat(), bowl(), 0.6));
  const fr = (p) => { const r = p.u[0], l = p.u[p.u.length - 1]; return p.u.map((u) => (u < 0 ? (r < 0 ? -u / r : 0) : u > 0 ? (l > 0 ? u / l : 0) : 0)); };
  const uAt = (p, f) => (f < 0 ? -f * p.u[0] : f * p.u[p.u.length - 1]);
  let worst = 0;
  for (const f of [...new Set([...fr(A), ...fr(B), 0])]) { const pa = P.offsetAt(A, uAt(A, f)), pb = P.offsetAt(B, uAt(B, f)); worst = Math.max(worst, Math.hypot(pa[0] - pb[0], pa[1] - pb[1])); }
  assert.equal(P.stepBetween(A, B), worst);
});
