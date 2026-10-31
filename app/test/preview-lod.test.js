// preview-lod.test.js: node --test app/test/preview-lod.test.js
// The user, 2026-10-31: "in the previewer, the track doesnt have to be full fidelity topography until it is exported to ease strain on preview". The preview draws the
// placed road's far chunks from a thinned index list (app/preview/renderer.js LOD_NEAR, coarseIndices); near the eye it draws the triangles the export meshes. Rows:
//   1  a chunk near the eye is drawn from its own index list, the same triangles; one past LOD_NEAR and one past LOD_FAR from thinner lists over the SAME vertices
//   2  a thinned cell keeps its outline: its first and last rows, and both rims at every row it keeps; no triangle uses a vertex outside the cell or a row it dropped
//   3  without \`lod\`, a moved chunk (a drag's window) and the ghost are drawn whole whatever the distance
//   4  the far road's ties are not drawn once the chunk is wholly past the tie fade (they would be fully faded); the edges still are
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../src/geom/index.js');
const R = require('../preview/renderer.js');
const { batchesOf } = require('../preview/batches.js');

const half = (w) => ({ font: 'flat', u: [-w / 2, w / 2], psi: [0, 0], material: 'ROAD' });
const tube = { font: 'half-pipe', u: [-12, -6, 0, 6, 12], psi: [80 * Math.PI / 180, 30 * Math.PI / 180, 0, 30 * Math.PI / 180, 80 * Math.PI / 180], material: 'ROAD' };
/** a 3 km straight of 150 m cells (rows every few metres), each cell its own batch; mesh.js's own arrays */
function road(profile = tube, length = 3000) {
  const segs = [{ id: 'p0', kind: 'road', length, rampM: 0, profile }];
  return batchesOf(G.buildMesh(G.buildPath(segs), segs));
}

function fakeGL() {
  const drawn = [], bound = {}, data = new Map(); let id = 0, lineDraws = 0, since = [];   // since: the array buffers bound since the last draw (the first is the positions)
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7,
    COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13,
    BLEND: 14, LINES: 15, SRC_ALPHA: 17, ONE_MINUS_SRC_ALPHA: 18, depthMask() {}, blendFunc() {}, disableVertexAttribArray() {},
    createShader: () => ({ id: ++id }), shaderSource() {}, compileShader() {}, getShaderParameter: () => true, getShaderInfoLog: () => '',
    createProgram: () => ({ id: ++id }), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, getProgramInfoLog: () => '',
    getAttribLocation: () => 0, getUniformLocation: (p, n) => n, useProgram() {}, viewport() {}, clearColor() {}, clear() {}, enable() {}, disable() {},
    uniformMatrix4fv() {}, uniform3f() {}, uniform1f() {}, uniform2f() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
    createBuffer: () => ({ id: ++id }), bindBuffer(t, b) { bound[t] = b; if (t === 5) since.push(b); }, bufferData(t, arr) { data.set(bound[t], arr); }, deleteBuffer() {}, deleteProgram() {},
    drawElements(mode, n) { drawn.push({ indices: data.get(bound[6]), n, positions: data.get(since[0]) }); since = []; },
    drawArrays() { lineDraws++; since = []; },
  };
  return { gl, drawn, lineDraws: () => lineDraws };
}
const poseAt = (eye) => ({ eye, target: [eye[0], 0, eye[2] + 10], up: [0, 1, 0], fov: 1 });
const SIZE = { width: 800, height: 600 };
/** draw the batches once (chunks of at most 3,000 vertices, so the road is many chunks); the drawn index arrays in chunk order */
function drawOnce(bs, pose, extras) { const f = fakeGL(), r = R.createRenderer(f.gl, { chunkVertices: 3000 }); r.draw(bs, pose, SIZE, { look: 'words', ...extras }); return { ...f, r }; }

test('row 1: near the eye the chunk is drawn from its own index list; far away from thinner ones over the same vertices', () => {
  const bs = road(), eye = [0, 2, 0];   // standing at the start of the straight, which runs along +z
  const lod = drawOnce(bs, poseAt(eye), { lod: true }), whole = drawOnce(bs, poseAt(eye), {});
  assert.equal(lod.drawn.length, whole.drawn.length, 'one draw a chunk either way');
  let near = 0, mid = 0, far = 0;
  for (let i = 0; i < lod.drawn.length; i++) {
    const a = lod.drawn[i], b = whole.drawn[i], P = a.positions;
    let dz = Infinity; for (let k = 2; k < P.length; k += 3) dz = Math.min(dz, Math.abs(P[k] - eye[2]));
    if (dz < R.LOD_NEAR - 30) { assert.deepEqual(a.indices, b.indices, `chunk ${i} (${dz.toFixed(0)} m away) is drawn from its own index list`); near++; }
    else if (dz > R.LOD_NEAR + 30 && dz < R.LOD_FAR - 30) { assert.ok(a.n < b.n * 0.75, `chunk ${i} at ${dz.toFixed(0)} m: ${a.n} indices of ${b.n}`); mid++; }
    else if (dz > R.LOD_FAR + 30) { assert.ok(a.n < b.n * 0.35, `chunk ${i} at ${dz.toFixed(0)} m: ${a.n} indices of ${b.n}`); far++; }
    assert.deepEqual(a.positions, b.positions, `chunk ${i}: the same vertices`);
    for (const x of a.indices) assert.ok(x < P.length / 3, `chunk ${i}: an index within its vertices`);
  }
  assert.ok(near >= 1 && mid >= 1 && far >= 1, `chunks near ${near}, between ${mid}, far ${far}`);
});

test('row 2: a thinned cell keeps its outline: its first and last rows and both rims at every row it keeps, and nothing outside the cell', () => {
  let cells = 0;
  for (const profile of [tube, half(12)]) for (const b of road(profile, 600)) {
    if (b.seam || !(b.cols > 1)) continue;
    const K = b.cols, Rn = b.positions.length / 3 / K;
    for (const level of [1, 2]) {
      const ix = R.coarseIndices({ list: [b], positions: b.positions }, level), used = new Set(ix);
      assert.ok(ix.length < b.indices.length, `${b.key} level ${level}: ${ix.length} indices of ${b.indices.length}`);
      assert.equal(ix.length % 3, 0);
      for (const x of ix) assert.ok(x >= 0 && x < Rn * K, `${b.key}: an index inside the cell`);
      // the rows kept: every LOD_STEP-th and always the last; at each, both rims; the first and last rows whole at the columns kept, and the last column always
      const step = R.LOD_STEP[level], rows = []; for (let r = 0; r < Rn; r += step.rows) rows.push(r); if (rows[rows.length - 1] !== Rn - 1) rows.push(Rn - 1);
      for (const r of rows) for (const k of [0, K - 1]) assert.ok(used.has(r * K + k), `${b.key} level ${level}: rim vertex row ${r} col ${k}`);
      for (const r of [0, Rn - 1]) for (let k = 0; k < K; k += step.cols) assert.ok(used.has(r * K + k), `${b.key} level ${level}: end row ${r} col ${k}`);
      const kept = new Set(); for (const x of used) kept.add(Math.floor(x / K)); assert.deepEqual([...kept].sort((x, y) => x - y), rows, `${b.key} level ${level}: only the kept rows`);
    }
    cells++;
  }
  assert.ok(cells >= 4, `${cells} cells checked`);
});

test('row 3: without lod, for a moved chunk, and for the ghost, the road is drawn whole whatever the distance', () => {
  const bs = road(), far = poseAt([0, 2, 9000]);
  const plain = drawOnce(bs, far, {}), whole = drawOnce(bs, poseAt([0, 2, 0]), {});
  plain.drawn.forEach((d, i) => assert.equal(d.n, whole.drawn[i].n, `chunk ${i} whole without lod`));
  const X = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1]);
  const moved = drawOnce(bs.map((b) => ({ ...b, xform: X })), far, { lod: true });
  moved.drawn.forEach((d, i) => assert.equal(d.n, whole.drawn[i].n, `moved chunk ${i} whole`));
  const ghost = drawOnce([], far, { lod: true, ghost: bs });
  assert.equal(ghost.drawn.reduce((a, d) => a + d.n, 0), whole.drawn.reduce((a, d) => a + d.n, 0), 'the ghost whole');
  assert.equal(ghost.r.stats().coarse, 0);
});

test('row 4: past the tie fade a chunk draws its edges and no ties; near it draws both', () => {
  const bs = road(half(12), 3000);
  const near = drawOnce(bs, poseAt([0, 2, 0]), { lod: true }), whole = drawOnce(bs, poseAt([0, 2, 0]), {});
  const chunks = whole.r.stats().chunks;
  assert.equal(whole.lineDraws(), 2 * chunks, 'edges and ties for every chunk without lod');
  assert.ok(near.lineDraws() > chunks && near.lineDraws() < 2 * chunks, `${near.lineDraws()} line draws for ${chunks} chunks: ties only near the eye`);
  const gone = drawOnce(bs, poseAt([0, 2, 9000]), { lod: true });
  assert.equal(gone.lineDraws(), chunks, 'only the edges when every chunk is past the fade');
});
