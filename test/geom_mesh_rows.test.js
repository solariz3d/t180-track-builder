// geom_mesh_rows.test.js: node --test test/geom_mesh_rows.test.js
// A piece's boundary rows (src/geom/mesh.js: pc.first, pc.last, the rows a seam zips) are kept for every piece of a preview
// mesh, so a later extend, sculpt or reuse can make its seams. On a 24 km track that is millions of vertices; held as
// { p, n, q } objects they filled the page's 4 GB pointer cage (about 430 MB of a ~780 MB page at rest). They are now
// packed in Float64Arrays (whose data lives outside the cage), six numbers a vertex: p then n.
// Rows:
//   1  the mesh is the same, to the byte: every scene array, every node matrix, every cell and fold, for a build with zipper seams, a closed lap's
//      joint, a tube's shared row grid, a lean build, and a reuse whose moved pieces recompute their stale rows for the seams beside a remeshed one
//      (sha256 pinned on 6c37902, before the rows were packed)
//   2  the rows are packed: a Float64Array of 6·K numbers, the same numbers vertex() makes, and rowVertices() reads them back
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const { close } = require('../src/core/close.js');
const M = require('../src/geom/mesh.js');
const S = require('../src/core/sculpt.js');

const Rr = 180, Q = Math.PI * Rr / 2;
/** sha256 of everything a mesh hands on: the scene tree (names, matrices, the four arrays of every mesh), the cells and the folds. */
function digest(mesh) {
  const h = crypto.createHash('sha256');
  const eat = (n) => {
    h.update(`${n.type}|${n.name}|${JSON.stringify(n.matrix || null)}|${n.material === undefined ? '' : n.material}|`);
    if (n.positions) for (const k of ['positions', 'normals', 'uvs', 'indices']) { h.update(k); h.update(Buffer.from(n[k].buffer, n[k].byteOffset, n[k].byteLength)); }
    (n.children || []).forEach(eat);
  };
  eat(mesh.scene.root);
  h.update(JSON.stringify(mesh.cells)); h.update(JSON.stringify(mesh.folds));
  return h.digest('hex');
}
// the documents: an open road that changes font (a half-pipe into a cup piece: zipper seams and a ramp), a closed lap of cup pieces (the joint), a tube
const openDoc = () => { let d = extend(D.createDoc('o'), { length: 100, family: 'half-pipe', first: { w: 24 } }); d = extend(d, { length: 120, transition: 60, targets: { c: 60 } }); return extend(d, { length: 80, transition: 30, targets: { kh: 1 / Rr } }); };
function lapDoc() {
  let d = extend(D.createDoc('lap'), { length: 300, first: { c: 20 } });
  for (const c of [60, 90, 60, 90]) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0, c: 20 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const tubeDoc = () => { let d = extend(D.createDoc('t'), { length: 200, first: { w: 31, t: 360 } }); return extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } }); };
const meshOf = (d) => { const segs = A.toSegments(d), path = A.toPath(d).path; return { segs, path, mesh: M.buildMesh(path, segs) }; };
/** The reuse case: a curvature brush on the open road (60 m in) remeshes the pieces under it; the 100 later pieces only move (their rows go stale and are
 * recomputed for the seams beside the remeshed ones). */
function reuseCase() {
  const d0 = openDoc(), a = meshOf(d0), d1 = S.sculpt(d0, { channel: 'kh', s0: 60, r: 8, delta: 0.002 }).doc;
  const segs = A.toSegments(d1), path = A.toPath(d1).path, key = (x) => JSON.stringify(x);
  return M.reuseMesh(a.mesh, path, segs, segs.map((x, j) => j < a.segs.length && key(x) === key(a.segs[j])));
}
const PINNED = {
  open: 'b154a8e19c93c893fe060f8e65af8724953f0b8c970f35a03e4f869ad20936cf',
  lap: '52f5fbf017ff47328be2a4e013bee2ec9f9cc27eda878f9aeed2956ab9e523fd',
  tube: '25882fc878244dd0078c3d1dbb83e6068cc31a09755f37397b0a990f3cbf3610',
  reuse: '654e65786d0e3306ff5d349cdbb177a100892a5229c614d3c0be4c53a8e066f8',
  lean: '52f5fbf017ff47328be2a4e013bee2ec9f9cc27eda878f9aeed2956ab9e523fd',
};
test('row 1: the mesh is the same to the byte (scene arrays, matrices, cells, folds) for zipper seams, a closed lap\'s joint, a tube, a reuse with stale rows, and a lean build', () => {
  const got = {
    open: digest(meshOf(openDoc()).mesh), lap: digest(meshOf(lapDoc()).mesh), tube: digest(meshOf(tubeDoc()).mesh), reuse: digest(reuseCase()),
    lean: (() => { const d = lapDoc(); return digest(M.buildMesh(A.toPath(d).path, A.toSegments(d), { lean: true })); })(),
  };
  if (process.env.PIN_MESH) console.log(JSON.stringify(got));
  const r = reuseCase(); assert.ok(r.stats.reused > 0, 'the reuse case moved pieces (stale rows were recomputed)');
  assert.ok(r.cells.some((c) => c.seam), 'the cases include seams');
  assert.deepEqual(got, PINNED);
});
test('row 2: a piece\'s boundary rows are packed: a Float64Array of 6·K numbers (p, n), equal to vertex(); rowVertices reads them back', () => {
  const { mesh, path, segs } = meshOf(openDoc()), pc = mesh._state.pieces.find(Boolean);
  for (const w of ['first', 'last']) {
    assert.ok(pc[w] instanceof Float64Array, `${w} is a ${pc[w] && pc[w].constructor.name}`);
    assert.equal(pc[w].length, 6 * pc.K);
  }
  const sm = pc.firstS, want = pc.ends.first.Us.map((u) => M.vertex(sm, pc.ends.first.P, u)), got = M.rowVertices(pc.first);
  assert.equal(got.length, pc.K);
  got.forEach((v, k) => { assert.deepEqual(v.p, want[k].p); assert.deepEqual(v.n, want[k].n); });
  assert.ok(path && segs);
});
