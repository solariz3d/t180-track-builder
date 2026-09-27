// geom_grow.test.js: node --test test/geom_grow.test.js. Growing the track from its OPEN END (the keeper, 12:20: the
// user builds the track, coaster-builder style). Stated before these tests were written:
//   · MATCH: an extended path and mesh equal a full rebuild of the same segments, with centreline and frame within
//     1e-9 (f64), identical station choice and cells, and float32 vertex data within 1e-6 m.
//   · COST, and how it is measured: by deterministic operation counts, not wall time (wall time is noise on a machine
//     shared with other panes). path.work = substeps + samples integrated in that call; mesh stats.work = vertex
//     evaluations + chord-check iterations in that call. The same one-word extension on a 10-word and a 100-word track
//     must cost the same path work exactly, and mesh work within 2× (the rebuilt open cell is up to one cellLength long,
//     depending on where the cell boundary falls). As a check that the counter can see growth, a FULL build of the
//     100-word track must cost more than 5× the 10-word one.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GDIR = process.env.GEOM_DIR || require('path').join(__dirname, '..', 'src', 'geom');
const G = require(GDIR);
const F = require('./geom_fixtures.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** An open track of n words: straights and gentle clothoid bends, alternating fonts, ending on a wall-ride. */
function words(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(i % 2
      ? { id: `b${i}`, kind: 'road', length: 30, k0: 0, k1: 0.012 * ((i % 3) - 1), kp0: 0.0004 * ((i % 5) - 2), kp1: 0, profile: F.WALLRIDE }
      : { id: `s${i}`, kind: 'road', length: 40, profile: i % 4 ? F.FLAT : F.HALFPIPE });
  }
  return out;
}
const TAIL = { id: 'tail', kind: 'road', length: 35, k0: 0.01, k1: 0.02, kp0: 0.0005, kp1: -0.0005, profile: F.WALLRIDE };

function compare(full, fm, p, em) {
  assert.strictEqual(p.samples.length, full.samples.length, 'sample count');
  let worst = 0;
  for (let i = 0; i < full.samples.length; i++) for (const k of ['pos', 'T', 'L', 'U']) worst = Math.max(worst, len(sub(full.samples[i][k], p.samples[i][k])));
  assert.ok(worst <= 1e-9, `centreline/frame differ by ${worst}`);
  assert.deepStrictEqual(em.stats.stationS, fm.stats.stationS, 'station choice');
  assert.deepStrictEqual(em.cells, fm.cells, 'cells');
  assert.deepStrictEqual(em.folds, fm.folds, 'folds');
  const meshes = (m) => m.scene.root.children.map((c) => c.children[0]);
  const A = meshes(fm), B = meshes(em);
  assert.strictEqual(A.length, B.length);
  for (let c = 0; c < A.length; c++) {
    assert.strictEqual(A[c].name, B[c].name);
    for (const f of ['positions', 'normals', 'uvs']) { let d = 0; for (let i = 0; i < A[c][f].length; i++) d = Math.max(d, Math.abs(A[c][f][i] - B[c][f][i])); assert.ok(d <= 1e-6, `${A[c].name}.${f} differ by ${d}`); }
    assert.deepStrictEqual(Array.from(A[c].indices), Array.from(B[c].indices));
  }
}

test('match: extending by one word equals a full rebuild (centreline, frame, stations, cells, vertices, folds)', () => {
  const base = words(24), all = [...base, TAIL];
  const full = G.buildPath(all, { step: 0.5 }), fm = G.buildMesh(full, all);
  const p = G.buildPath(base, { step: 0.5 }), m = G.buildMesh(p, base);
  G.extendPath(p, all); const em = G.extendMesh(m, p, all);
  compare(full, fm, p, em);
});
test('match: growing word by word from one word to thirty equals a full rebuild at the end', () => {
  const all = words(30);
  let segs = all.slice(0, 1), p = G.buildPath(segs, { step: 0.5 }), m = G.buildMesh(p, segs);
  for (let n = 2; n <= all.length; n++) { segs = all.slice(0, n); G.extendPath(p, segs); m = G.extendMesh(m, p, segs); }
  const full = G.buildPath(all, { step: 0.5 }), fm = G.buildMesh(full, all);
  compare(full, fm, p, m);
});
test('cost: a one-word extension costs the same on a 10-word and a 100-word track (operation counts)', () => {
  const run = (n) => {
    const base = words(n), all = [...base, TAIL];
    const fp = G.buildPath(all, { step: 0.5 }), fm = G.buildMesh(fp, all);
    const p = G.buildPath(base, { step: 0.5 }), m = G.buildMesh(p, base);
    G.extendPath(p, all); const em = G.extendMesh(m, p, all);
    return { pathExt: p.work, meshExt: em.stats.work, full: fp.work + fm.stats.work, lengthM: p.lengthM };
  };
  const a = run(10), b = run(100);
  assert.ok(b.lengthM > 9 * a.lengthM, 'the long track must really be ~10× longer');
  assert.strictEqual(b.pathExt, a.pathExt, `path work: ${a.pathExt} vs ${b.pathExt}`);
  const r = b.meshExt / a.meshExt;
  assert.ok(r >= 0.5 && r <= 2, `mesh work ratio ${r.toFixed(3)} (${a.meshExt} vs ${b.meshExt})`);
  assert.ok(b.full / a.full > 5, `the counter must see a full build grow: ${a.full} vs ${b.full}`);
});
test('build head: the open end\'s frame, and a build-view camera behind and above it looking along T', () => {
  const segs = words(9), p = G.buildPath(segs, { step: 0.5 }), last = p.samples[p.samples.length - 1];
  for (const k of ['pos', 'T', 'L', 'U']) assert.ok(len(sub(p.head[k], last[k])) === 0);
  assert.ok(Math.abs(p.head.s - p.lengthM) < 1e-9);
  const all = [...segs, TAIL]; G.extendPath(p, all);
  assert.ok(Math.abs(p.head.s - p.lengthM) < 1e-9 && p.head.seg === all.length - 1, 'the head moves to the new open end');
  const cam = G.headCamera(p.head, { back: 15, up: 6 }), rel = sub(cam.eye, p.head.pos);
  assert.ok(Math.abs(dot(rel, p.head.T) + 15) < 1e-9 && Math.abs(dot(rel, p.head.U) - 6) < 1e-9 && Math.abs(dot(rel, p.head.L)) < 1e-9);
  assert.deepStrictEqual(cam.look, p.head.T);
});
test('edges: a closed loop cannot be extended, a zero-length tail is refused, and a wider tail profile still extends exactly', () => {
  const loop = F.stadium(), lp = G.buildPath(loop, { closed: true });
  assert.throws(() => G.extendPath(lp, [...loop, TAIL]), /closed loop/);
  const segs = words(3), p = G.buildPath(segs);
  assert.throws(() => G.extendPath(p, [...segs, { id: 'z', kind: 'road', length: 0, profile: F.FLAT }]), /positive finite/);
  const flat = [{ id: 'a', kind: 'road', length: 40, profile: F.FLAT }], q = G.buildPath(flat), m = G.buildMesh(q, flat);
  const wide = [...flat, { id: 'w', kind: 'road', length: 30, profile: F.WALLRIDE }];   // needs far more vertices across
  G.extendPath(q, wide); const em = G.extendMesh(m, q, wide);
  // each piece has its own vertex count across, so a wider profile no longer forces a full rebuild
  const full = G.buildMesh(G.buildPath(wide), wide);
  assert.deepStrictEqual(em.cells, full.cells);
});
