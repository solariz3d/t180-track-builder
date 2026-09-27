// join.test.js: node --test test/*.test.js
// The join between the document model and the geometry core, WHEN THE USER BUILDS (docs/INTERFACES.md §4, §4b):
// appending at the head and sculpting a placed word must give what a full rebuild gives. doc-geom.test.js checks a
// whole resolved document once; this file checks the incremental paths the build head and the sculpt handles use.
// Tolerances, stated before the tests were run: paths exact (the same f64 arithmetic on the same inputs), meshes
// byte-identical after an append, and within 1e-5 m after a sculpt (geom_sculpt.test.js's stated bound: a re-placed
// piece's local coordinates are re-derived from a different world placement). Dependency-free.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const G = require('../src/geom/index.js');

const STEP = 0.5;
const plain = (v) => (v instanceof Float32Array || v instanceof Uint16Array ? Array.from(v) : v);
const sceneText = (m) => JSON.stringify(m.scene, (k, v) => plain(v));
function meshes(scene) { const out = []; (function walk(n) { if (n.positions) out.push(n); (n.children || []).forEach(walk); })(scene.root); return out; }
function maxPathDiff(a, b) {
  assert.equal(a.samples.length, b.samples.length, 'sample counts differ');
  let m = 0;
  a.samples.forEach((x, i) => { const y = b.samples[i]; m = Math.max(m, Math.abs(x.s - y.s)); for (const f of ['pos', 'T', 'L', 'U']) for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(x[f][c] - y[f][c])); });
  return m;
}
function build(words) { let d = D.createDoc('join'); for (const [w, o] of words) d = D.appendWord(d, w, o || {}); return d; }
const BASE = [['straight'], ['sweep'], ['turn'], ['wall-ride']];

test('append at the head: resolveFrom keeps every earlier segment, and equals a full resolve', () => {
  const d = build(BASE), r = D.resolve(d);
  const d2 = D.appendWord(D.appendWord(d, 'jump', {}), 'straight', {});
  const r2 = D.resolveFrom(r, d2);
  r.segments.forEach((g, i) => assert.equal(r2.segments[i], g, `segment ${i} (${g.id}) was not kept`));
  assert.equal(JSON.stringify(r2.segments), JSON.stringify(D.resolve(d2).segments));
});

test('append at the head: extendPath and extendMesh equal a full rebuild of the resolved document', () => {
  const d = build(BASE), r = D.resolve(d), p = G.buildPath(r.segments, { step: STEP }), m = G.buildMesh(p, r.segments, {});
  const d2 = D.appendWord(D.appendWord(d, 'jump', {}), 'straight', {}), r2 = D.resolveFrom(r, d2);
  G.extendPath(p, r2.segments);
  const pf = G.buildPath(r2.segments, { step: STEP });
  assert.equal(maxPathDiff(p, pf), 0);
  const m2 = G.extendMesh(m, p, r2.segments), mf = G.buildMesh(pf, r2.segments, {});
  assert.equal(sceneText(m2), sceneText(mf));
});

test('the build head: resolve().head names the last word, and path.head is the open end of the same document', () => {
  const d = build([...BASE, ['straight', { handles: { climb: -2 * Math.PI / 180 } }]]), r = D.resolve(d), p = G.buildPath(r.segments, { step: STEP });
  assert.equal(r.head.id, d.words[d.words.length - 1].id);
  assert.equal(p.head.seg, r.segments.length - 1);
  assert.ok(Math.abs(p.head.s - r.segments.reduce((a, g) => a + g.length, 0)) < 1e-9);
  const pitch = Math.atan2(p.head.T[1], Math.hypot(p.head.T[0], p.head.T[2]));
  assert.ok(Math.abs(pitch - r.head.pitch) < 1e-9, `path pitch ${pitch} vs resolve pitch ${r.head.pitch}`);
});

test('sculpt: an edited word restarts the path at its first segment, and path and mesh equal a full rebuild', () => {
  const words = [...BASE, ['jump'], ['straight']];
  for (const [id, handles] of [['w2', { length: 333 }], ['w2', { turn: 0.2 }], ['w3', { length: 250 }]]) {
    const d = build(words), r = D.resolve(d), p = G.buildPath(r.segments, { step: STEP }), m = G.buildMesh(p, r.segments, {});
    const d2 = D.editWord(d, id, { handles }), r2 = D.resolveFrom(r, d2);
    const g = r2.marks[r2.resolvedFrom].segStart;
    assert.equal(r2.segments[g].id, id, 'the restart segment is the edited word\'s first');
    G.rebuildPathFrom(p, r2.segments, g);
    const pf = G.buildPath(r2.segments, { step: STEP });
    assert.equal(maxPathDiff(p, pf), 0, `${id} ${JSON.stringify(handles)}: path`);
    const ms = meshes(G.sculptMesh(m, p, r2.segments, g).scene), mf = meshes(G.buildMesh(pf, r2.segments, {}).scene);
    assert.equal(ms.length, mf.length, 'mesh count');
    ms.forEach((a, i) => {
      assert.deepEqual(Array.from(a.indices), Array.from(mf[i].indices), `${a.name} indices`);
      let mx = 0; for (let k = 0; k < a.positions.length; k++) mx = Math.max(mx, Math.abs(a.positions[k] - mf[i].positions[k]));
      assert.ok(mx <= 1e-5, `${id} ${JSON.stringify(handles)}: ${a.name} positions differ by ${mx}`);
    });
  }
});

// ── D167 landing: two joins that were broken or missing at D166 ──────────────────────────────────────────────────
test('a resolved multi-part word meshes with unique node names, and the self-check finds no crossing on a plain track', () => {
  const d = build([['straight'], ['turn'], ['wall-ride'], ['jump'], ['straight']]), r = D.resolve(d);
  const m = G.buildMesh(G.buildPath(r.segments, { step: STEP }), r.segments, { selfCheck: true });
  const names = []; (function walk(n) { names.push(n.name); (n.children || []).forEach(walk); })(m.scene.root);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'node names repeat');
  assert.deepEqual(m.folds.filter((f) => f.other !== undefined), [], 'false self-intersections on a track that does not cross itself');
});

test('a font change in the document reaches the geometry: resolve emits blend, and the mesh ramps by it', () => {
  const d = build([['straight'], ['straight', { font: 'half-pipe' }], ['jump'], ['straight']]), r = D.resolve(d);
  const w2 = r.segments.filter((g) => g.id === 'w2'), first = w2[0];
  assert.ok(first.blend && first.blend.from.font === 'flat' && first.blend.s0 === 0, 'the entering word blends from the flat font');
  assert.equal(first.blend.length, Math.min(d.words[1].handles.ramp, d.words[1].handles.length));
  assert.ok(r.segments.filter((g) => g.id === 'w1').every((g) => g.blend === null), 'the first word has nothing to blend from');
  assert.ok(r.segments.filter((g) => g.id === 'w4').every((g) => g.blend === null), 'after a jump the road starts on its own font');
  const p = G.buildPath(r.segments, { step: STEP });
  const ramped = G.buildMesh(p, r.segments, {}), stepped = G.buildMesh(p, r.segments.map((g) => (g.blend ? { ...g, blend: null } : g)), {});
  assert.notEqual(sceneText(ramped), sceneText(stepped), 'the blend field changed nothing in the mesh');
});
