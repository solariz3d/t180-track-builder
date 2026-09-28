// mutation.test.js: node --test --test-concurrency=4 .claude/skills/track-equations/evals/mutation.test.js
// Each mutant changes ONE formula in mathref.cjs (one exact string replacement, in a temporary copy). Every known-answer check is
// run against the copy, and the mutant must be CAUGHT by a check that passes on the ORIGINAL (the control below). A mutant whose
// string is not found is NOT APPLIED, and fails. Each result line says which checks caught it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const SRC = path.join(__dirname, 'mathref.cjs');
const CHECKS = require('./checks.js');

const MUTANTS = [
  ['K1 ray: accept u + v up to 2', 'if (v < 0 || u + v > 1) return null;', 'if (v < 0 || u + v > 2) return null;'],
  ['K2 ray: accept hits behind the origin', 'return t > eps ? { t, u, v } : null;', 'return { t, u, v };'],
  ['K3 nearest hit: take the first', 'for (const p of points) if (!best || Math.abs(p[1] - yRef) < Math.abs(best[1] - yRef)) best = p; return best;', 'return points[0];'],
  ['K4 curvature: |r′|² not |r′|³', 'const curvature = (d1, d2) => norm(cross(d1, d2)) / norm(d1) ** 3;', 'const curvature = (d1, d2) => norm(cross(d1, d2)) / norm(d1) ** 2;'],
  ['K5 tangent: sin and cos of heading swapped', 'return [Math.cos(p) * Math.sin(theta), Math.sin(p), Math.cos(p) * Math.cos(theta)];', 'return [Math.cos(p) * Math.cos(theta), Math.sin(p), Math.cos(p) * Math.sin(theta)];'],
  ['K6 rebuild: explicit Euler', 'const sm = (i + 0.5) * h, T = tangent(th + 0.5 * h * k(i * h), p + 0.5 * h * kp(i * h));', 'const sm = (i + 0.5) * h, T = tangent(th, p);'],
  ['K7 discrete curvature: over the sum of arcs', 'return Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (lu * lw)))) / ((lu + lw) / 2);', 'return Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (lu * lw)))) / (lu + lw);'],
  ['K8 clothoid: κ ∝ s²', 'const clothoidKappa = (s, A) => s / (A * A);', 'const clothoidKappa = (s, A) => (s * s) / (A * A * A);'],
  ['K9 smoothstep: 2u² − u³', 'const smoothstep = (u) => 3 * u * u - 2 * u * u * u;', 'const smoothstep = (u) => 2 * u * u - u * u * u;'],
  ['K10 Cox–de Boor: drop the right term', ': 0) + (b > 0 ? (t[i + k + 1] - x) / b * bspline(i + 1, k - 1, t, x) : 0);', ': 0);'],
  ['K11 knot refinement: refine every span', 'if (worst > tol) out.push((lo + hi) / 2);', 'out.push((lo + hi) / 2);'],
  ['K12 least squares: drop Aᵀ on the right', 'return solve(AtA, Array.from({ length: n }, (_, i) => A.reduce((s, r, k) => s + r[i] * b[k], 0)));', 'return solve(AtA, Array.from({ length: n }, (_, i) => b[i] || 0));'],
  ['K13 KKT: ignore the constraint rows', 'r[n + a] = d[a]; }', 'r[n + a] = d[a]; for (let j = 0; j < n; j++) { K[n + a][j] = 0; K[j][n + a] = 0; } K[n + a][n + a] = 1; }'],
  ['K14 least norm: sign', 'const y = solve(JWJ, r.map((x) => -x));', 'const y = solve(JWJ, r);'],
  ['K15 least norm: no weights', "const m = J.length, n = J[0].length, wi = (j) => (w ? 1 / w[j] : 1);", "const m = J.length, n = J[0].length, wi = (j) => 1;"],
  ['K16 close loop: no correction applied', 'c[0][0] += dd[0]; c[0][1] += dd[1];', 'c[0][0] += 0 * dd[0]; c[0][1] += 0 * dd[1];'],
  ['K17 projectile: g not halved', 'p0[1] + v0[1] * t - 0.5 * g * t * t', 'p0[1] + v0[1] * t - g * t * t'],
  ['K18 time to height: the earlier root', 'const timeToHeight = (y0, vy, g, yLand) => (vy + Math.sqrt(', 'const timeToHeight = (y0, vy, g, yLand) => (vy - Math.sqrt('],
  ['K19 sphere K: 1/R', 'const sphereK = (R) => 1 / (R * R);', 'const sphereK = (R) => 1 / R;'],
  ['K20 torus K: sin v', 'const torusK = (v, R, r) => Math.cos(v) / (r * (R + r * Math.cos(v)));', 'const torusK = (v, R, r) => Math.sin(v) / (r * (R + r * Math.cos(v)));'],
  ['K21 dished corner: cos β', 'const dishedCornerK = (kh, beta, dpsidu) => kh * Math.sin(beta) * dpsidu;', 'const dishedCornerK = (kh, beta, dpsidu) => kh * Math.cos(beta) * dpsidu;'],
  ['K22 particle: gravity sign', 'const s = surf(x, z), q = g + s.fxx', 'const s = surf(x, z), q = -g + s.fxx'],
  ['K23 particle: no 1/D', 'return { ax: -s.fx * q / D, az: -s.fz * q / D, N: q / Math.sqrt(D) };', 'return { ax: -s.fx * q, az: -s.fz * q, N: q / Math.sqrt(D) };'],
  ['K24 Fourier: 1/M not 2/M', 'a.push(2 * ak / M); b.push(2 * bk / M);', 'a.push(ak / M); b.push(bk / M);'],
];

const src = fs.readFileSync(SRC, 'utf8'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-trackeq-'));
const baseline = new Set(); { const M = require(SRC); for (const c of CHECKS) { try { c.run(M); baseline.add(c); } catch (e) { /* the control reports it */ } } }
test('CONTROL: every known-answer check passes on the unmutated mathref.cjs', () => {
  assert.deepEqual(CHECKS.filter((c) => !baseline.has(c)).map((c) => `${c.section} ${c.name}`), []);
});
for (const [name, from, to] of MUTANTS) {
  test(`mutant ${name}: applied, and CAUGHT`, (t) => {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in mathref.cjs`);
    const f = path.join(dir, `${name.split(' ')[0]}.cjs`); fs.writeFileSync(f, src.replace(from, () => to));
    const M = require(f), caught = [];
    for (const c of CHECKS) { if (!baseline.has(c)) continue; try { c.run(M); } catch (e) { caught.push(c.section); } }
    t.diagnostic(`${name}: caught by ${caught.length ? caught.join(', ') : 'NOTHING'}`);
    assert.ok(caught.length > 0, `${name} was NOT CAUGHT`);
  });
}
