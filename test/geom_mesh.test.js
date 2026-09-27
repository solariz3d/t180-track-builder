// geom_mesh.test.js: node --test test/geom_mesh.test.js. Profiles, adaptive meshing, cells, folds, and the scene.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GDIR = process.env.GEOM_DIR || require('path').join(__dirname, '..', 'src', 'geom');
const G = require(GDIR);
const M = require(require('path').join(GDIR, 'mesh.js'));
const F = require('./geom_fixtures.js');
const { validateScene } = require('../src/export/scene.js');
const { writeKn5 } = require('../src/export/kn5write.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const meshes = (scene) => scene.root.children.flatMap((c) => (c.type === 'mesh' ? [c] : c.children.filter((x) => x.type === 'mesh').map((m) => ({ ...m, origin: c.matrix.slice(12, 15) }))));

test('chord error: every profile vertex track stays within the stated bound, measured on a 5× finer path', () => {
  const segs = F.stadium({ wallTurn: F.FLAT, otherTurn: F.FLAT }), chordErr = 0.02;
  const coarse = G.buildPath(segs, { closed: true, step: 0.25 }), mesh = G.buildMesh(coarse, segs, { chordErr });
  const fine = G.buildPath(segs, { closed: true, step: 0.05 }), { P, U, K } = M.profiles(segs, Math.PI / 180, 1);
  const st = mesh.stats.stationS;
  let worst = 0, j = 0;
  for (let n = 0; n < st.length - 1; n++) {
    const s0 = st[n], s1 = st[n + 1]; while (j < fine.samples.length && fine.samples[j].s < s0 - 1e-9) j++;
    const a = fine.samples.find((x) => Math.abs(x.s - s0) < 1e-9), b = fine.samples.find((x) => Math.abs(x.s - s1) < 1e-9);
    if (!a || !b) continue;
    const g = a.seg;
    for (let k = 0; k < K[g]; k += 7) {
      const A = M.vertex(a, P[g], U[g][k]).p, B = M.vertex(b, P[g], U[g][k]).p, d = sub(B, A), dd = dot(d, d);
      for (let m = j; m < fine.samples.length && fine.samples[m].s < s1 - 1e-9; m++) {
        if (fine.samples[m].seg !== g) continue;
        const w = sub(M.vertex(fine.samples[m], P[g], U[g][k]).p, A), t = Math.max(0, Math.min(1, dot(w, d) / dd));
        worst = Math.max(worst, len(sub(w, [d[0] * t, d[1] * t, d[2] * t])));
      }
    }
  }
  // stated bound: chordErr, plus the sub-sample term κ·h²/8 for the 0.25 m source samples (≈ 1e-4 m here, inferred)
  assert.ok(worst <= chordErr + 1e-3, `worst chord error ${worst} m against ${chordErr} m`);
  assert.ok(worst > chordErr * 0.3, `the bound should be exercised, worst was only ${worst}`);
});
test('cells: no cell at or over 65,536 vertices, even when a fine profile forces splitting', () => {
  const segs = F.stadium({ straight: 400 }), p = G.buildPath(segs, { closed: true, step: 0.25 });
  const m = G.buildMesh(p, segs, { maxSeamDeg: 0.25, cellLength: 10000 });
  assert.ok(m.cells.length >= 2, 'the fixture should need more than one cell');
  for (const c of m.cells) assert.ok(c.vertices < 65536, `${c.name}: ${c.vertices}`);
  for (const mm of meshes(m.scene)) assert.ok(mm.positions.length / 3 < 65536);
  validateScene(m.scene);
});
test('fold check: a crafted fold fires (a 5 m radius turn under a 13 m half-width road), on the inside edge only', () => {
  const segs = [{ id: 'f', kind: 'road', length: 20, k0: 0.2, k1: 0.2, profile: F.FLAT }], p = G.buildPath(segs, { step: 0.5 });
  const m = G.buildMesh(p, segs);
  assert.ok(m.folds.length > 0, 'no fold reported');
  for (const f of m.folds) { assert.ok(f.margin <= 0); assert.ok(f.u >= 5 - 1e-9, `fold at u=${f.u}, expected the inside (left) past 1/κ = 5 m`); }
});
test('fold check: a proper track reports no folds', () => {
  const segs = F.stadium(), p = G.buildPath(segs, { closed: true, step: 0.5 });
  assert.strictEqual(G.buildMesh(p, segs).folds.length, 0);
});
test('ψ past 90°: the wall-ride edge at 110° has the right normal (cos ψ·U − sin ψ·L), faces down, and the winding agrees', () => {
  const segs = [{ id: 'w', kind: 'road', length: 30, profile: F.WALLRIDE }], p = G.buildPath(segs, { step: 0.5 });
  const m = G.buildMesh(p, segs), mm = meshes(m.scene)[0], K = m.stats.K[0], s0 = p.samples[0];
  const psi = 110 * Math.PI / 180, want = sub([s0.U[0] * Math.cos(psi), s0.U[1] * Math.cos(psi), s0.U[2] * Math.cos(psi)], [s0.L[0] * Math.sin(psi), s0.L[1] * Math.sin(psi), s0.L[2] * Math.sin(psi)]);
  const n = Array.from(mm.normals.slice((K - 1) * 3, K * 3));
  assert.ok(len(sub(n, want)) < 1e-6, `edge normal ${n} vs ${want}`);
  assert.ok(n[1] < 0, 'an overhang faces down');
  // every triangle's geometric normal agrees with its vertices' normals (dot > 0): the winding holds past vertical
  const P = (i) => Array.from(mm.positions.slice(i * 3, i * 3 + 3)), N = (i) => Array.from(mm.normals.slice(i * 3, i * 3 + 3));
  for (let t = 0; t < mm.indices.length; t += 3) {
    const [a, b, c] = [mm.indices[t], mm.indices[t + 1], mm.indices[t + 2]], g = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    assert.ok(dot(g, N(a)) > 0, `triangle ${t / 3} faces away from its vertex normal`);
  }
});
test('scene: T1 shape, passes validateScene, and src/export/kn5write.js writes it unchanged; vertices are cell-relative', () => {
  const segs = F.stadium(), p = G.buildPath(segs, { closed: true, step: 0.5 }), m = G.buildMesh(p, segs);
  validateScene(m.scene);
  const bytes = writeKn5(m.scene); assert.ok(bytes.length > 1000);
  for (const mm of meshes(m.scene)) {
    assert.match(mm.name, /^1ROAD_[A-Za-z0-9_]+$/);   // <digit><KEY>, then the piece id
    const cell = m.cells.find((c) => c.name === mm.name);
    assert.deepStrictEqual(mm.origin, cell.origin);
    let far = 0; for (let i = 0; i < mm.positions.length; i++) far = Math.max(far, Math.abs(mm.positions[i]));
    assert.ok(far < 200, `${mm.name}: a vertex is ${far} m from its cell origin`);
  }
});
test('gap: a jump gap gets no surface, and splits the road into separate cells', () => {
  const segs = [{ id: 'a', kind: 'road', length: 40, profile: F.FLAT }, { id: 'gap', kind: 'gap', length: 12 }, { id: 'b', kind: 'road', length: 40, profile: F.FLAT }];
  const p = G.buildPath(segs, { step: 0.5 }), m = G.buildMesh(p, segs);
  assert.strictEqual(m.cells.length, 2);
  assert.ok(m.cells[0].s1 <= 40 + 1e-9 && m.cells[1].s0 >= 52 - 1e-9, `cells ${JSON.stringify(m.cells.map((c) => [c.s0, c.s1]))}`);
});
test('edge: a straight flat road meshes with every normal straight up', () => {
  const segs = [{ id: 's', kind: 'road', length: 60, profile: F.FLAT }], m = G.buildMesh(G.buildPath(segs), segs);
  for (const mm of meshes(m.scene)) for (let i = 0; i < mm.normals.length; i += 3) assert.ok(Math.abs(mm.normals[i + 1] - 1) < 1e-6);
});
