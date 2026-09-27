// preview.test.js: node --test app/test/preview.test.js. The preview's non-GL logic, headless: the draw batches, the
// incremental track model, and the renderer's buffer cache against a recording stand-in for WebGL (no real GPU).
// Stated before these tests were written:
//   · A batch's node matrix, read column-major as GL reads it, puts every vertex where the geometry put it: within
//     1e-4 m of the geometry's own float64 surface (the arrays are float32, local to a piece).
//   · The track model's result equals a full build after every kind of change: append ('extend'), a word edit
//     ('sculpt'), a removal ('full'), and no change ('same'); a document that does not resolve keeps the last track.
//   · Through A's real shell (app/shell.js): placing words grows the preview by 'extend'.
//   · The renderer uploads each array once. Drawing the same batches again uploads nothing. After a sculpt that only
//     moves later pieces, it uploads the edited piece's arrays and its seams' arrays, and nothing else; the buffers of
//     arrays no longer drawn are deleted.
//   · A shader that does not compile throws with the compiler's log.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const B = require(path.join(ADIR, 'preview', 'batches.js'));
const TM = require(path.join(ADIR, 'preview', 'trackmodel.js'));
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const P = require(path.join(ADIR, 'preview', 'preview.js'));
const M = require(path.join(ADIR, 'camera', 'math.js'));
const G = require('../../src/geom/index.js');
const F = require('../../test/geom_fixtures.js');

const len = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function words(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i % 3 === 0 ? { id: `t${i}`, kind: 'road', length: 35, k0: 0.01, k1: 0.02, kp0: 0.001, kp1: 0, roll0: 0, roll1: 0.1, profile: F.HALFPIPE }
    : i % 3 === 1 ? { id: `s${i}`, kind: 'road', length: 45, profile: F.FLAT } : { id: `w${i}`, kind: 'road', length: 30, k0: 0.02, k1: 0, profile: F.WALLRIDE });
  return out;
}
const fullOf = (segs) => B.batchesOf(G.buildMesh(G.buildPath(segs), segs));
/**
 * Equal to a full build: the same batches and indices exactly, matrices within 1e-9, positions within 1e-5 m. Why not
 * exact: a piece a sculpt only MOVED keeps the local arrays made at its old placement, and a full build makes them at
 * the new one, so they agree to round-off (measured 1.7e-14 m); the geometry's own sculpt tests use 1e-5 m.
 */
function sameBatches(a, b) {
  assert.deepEqual(a.map((x) => x.key), b.map((x) => x.key));
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(Array.from(a[i].indices), Array.from(b[i].indices), a[i].key);
    let dm = 0, dp = 0;
    for (let k = 0; k < 16; k++) dm = Math.max(dm, Math.abs(a[i].model[k] - b[i].model[k]));
    assert.equal(a[i].positions.length, b[i].positions.length, a[i].key);
    for (let k = 0; k < a[i].positions.length; k++) dp = Math.max(dp, Math.abs(a[i].positions[k] - b[i].positions[k]));
    assert.ok(dm <= 1e-9 && dp <= 1e-5, `${a[i].key}: matrix ${dm}, positions ${dp}`);
  }
}

test('batches: the node matrix read column-major (as GL reads it) puts every vertex on the geometry\'s surface', () => {
  // ramps off (rampM: 0): this checks the matrix convention, so every row is compared with its piece's own font
  const segs = words(4), p = G.buildPath(segs), m = G.buildMesh(p, segs, { rampM: 0 }), bs = B.batchesOf(m);
  assert.equal(bs.length, m.scene.root.children.length);
  let worst = 0, checked = 0;
  for (const b of bs.filter((x) => !x.seam)) {
    const pc = m._state.pieces[b.piece], cell = pc.cells[Number(b.key.slice(b.key.lastIndexOf('_') + 1))];
    for (let r = 0; r < cell.rowS.length; r += 7) {   // its OWN sample below: at a join two samples share s
      const sm = p.samples.find((x) => x.seg === b.piece && Math.abs(x.s - cell.rowS[r]) < 1e-9) || (Math.abs(p.segEnd[b.piece].s - cell.rowS[r]) < 1e-9 ? p.segEnd[b.piece] : null);
      if (!sm) continue;
      for (let k = 0; k < pc.K; k += 5) {
        const i = r * pc.K + k, w = M.apply(b.model, [b.positions[i * 3], b.positions[i * 3 + 1], b.positions[i * 3 + 2]]);
        const e = pc.ends && r === 0 ? pc.ends.first : null, prof = e ? e.P : pc.P, u = e ? e.Us[k] : pc.Us[k];
        const [X, Y] = G.profile.offsetAt(prof, u), want = sm.pos.map((c, d) => c + sm.L[d] * X + sm.U[d] * Y);
        assert.equal(w[3], 1);
        worst = Math.max(worst, len(sub(w.slice(0, 3), want))); checked++;
      }
    }
  }
  assert.ok(checked > 50, `checked ${checked}`);
  assert.ok(worst < 1e-4, `worst ${worst} m`);
});
test('batches: one colour per placed word, alternating along the track; a seam is darker than its piece', () => {
  const bs = fullOf(words(4));
  const byPiece = new Map(); for (const b of bs.filter((x) => !x.seam)) { if (!byPiece.has(b.piece)) byPiece.set(b.piece, b.colour); assert.deepEqual(b.colour, byPiece.get(b.piece)); }
  assert.notDeepEqual(byPiece.get(0), byPiece.get(1));
  for (const s of bs.filter((x) => x.seam)) { const c = byPiece.get(s.piece); assert.ok(s.colour.reduce((a, x) => a + x) < c.reduce((a, x) => a + x)); }
});
test('track model: append → extend, a word edit → sculpt, a removal → full, no change → same; each equals a full build', () => {
  const tm = TM.createTrackModel(), all = words(9);
  assert.equal(tm.update({ segments: all.slice(0, 6), closed: false }).how, 'full');
  let r = tm.update({ segments: all, closed: false }); assert.equal(r.how, 'extend'); sameBatches(r.batches, fullOf(all));
  const edited = all.slice(); edited[4] = { ...all[4], length: 70 };
  r = tm.update({ segments: edited, closed: false }); assert.equal(r.how, 'sculpt'); sameBatches(r.batches, fullOf(edited));
  r = tm.update({ segments: edited, closed: false }); assert.equal(r.how, 'same');
  r = tm.update({ segments: edited.slice(0, 7), closed: false }); assert.equal(r.how, 'full'); sameBatches(r.batches, fullOf(edited.slice(0, 7)));
});
test('track model: a document that does not resolve keeps the last good track and marks it stale', () => {
  const tm = TM.createTrackModel(), r = tm.update({ segments: words(3), closed: false }), k = tm.update(null);
  assert.equal(k.how, 'kept'); assert.equal(k.stale, true); assert.equal(k.batches, r.batches);
  assert.throws(() => TM.createTrackModel().update(null), /no resolved document yet/);
});
test('track model through A\'s shell: placing words grows the preview by extend, and it equals a full build', async () => {
  const { createShell } = require('../shell.js');
  const store = { saveDoc: async () => {}, openDoc: async () => '', listDocs: async () => [], saveLibrary: async () => {}, openLibrary: async () => null };
  const s = await createShell({ storage: store }), tm = TM.createTrackModel();
  s.place('straight'); tm.update(s.getState().resolved);
  s.place('turn'); const r = tm.update(s.getState().resolved);
  assert.equal(r.how, 'extend');
  const segs = s.getState().resolved.segments;
  assert.ok(segs.length >= 2);
  sameBatches(r.batches, fullOf(segs));
});

/** A recording stand-in for WebGL: every call is counted; shaders compile unless told otherwise. */
function fakeGL({ compiles = true } = {}) {
  const calls = { bufferData: 0, deleteBuffer: 0, drawElements: 0 }; let id = 0;
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7,
    COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13,
    BLEND: 14, LINES: 15, SRC_ALPHA: 17, ONE_MINUS_SRC_ALPHA: 18, depthMask() {}, blendFunc() {}, disableVertexAttribArray() {},
    createShader: () => ({ id: ++id }), shaderSource() {}, compileShader() {}, getShaderParameter: () => compiles, getShaderInfoLog: () => "ERROR: 0:3: 'foo' : undeclared identifier",
    createProgram: () => ({ id: ++id }), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, getProgramInfoLog: () => '',
    getAttribLocation: () => 0, getUniformLocation: (p, n) => n, useProgram() {}, viewport() {}, clearColor() {}, clear() {}, enable() {}, disable() {},
    uniformMatrix4fv() {}, uniform3f() {}, uniform1f() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
    createBuffer: () => ({ id: ++id }), bindBuffer() {}, bufferData() { calls.bufferData++; }, deleteBuffer() { calls.deleteBuffer++; }, deleteProgram() {},
    drawElements() { calls.drawElements++; },
    drawArrays() { calls.drawArrays = (calls.drawArrays || 0) + 1; },
  };
  return { gl, calls };
}
const pose = { eye: [0, 50, -50], target: [0, 0, 0], up: [0, 1, 0], fov: 1 };
/** The arrays a batch puts on the GPU: positions, normals, indices, and (D170) a road cell's two line arrays. */
const arraysOf = (b) => 3 + (b.seam ? 0 : 2);
const sum = (bs) => bs.reduce((a, b) => a + arraysOf(b), 0);

test('renderer: every array is uploaded once; drawing the same batches again uploads nothing', () => {
  const { gl, calls } = fakeGL(), r = R.createRenderer(gl), bs = fullOf(words(6));
  r.draw(bs, pose, { width: 800, height: 600 });
  assert.equal(calls.bufferData, sum(bs)); assert.equal(calls.drawElements, bs.length);
  r.draw(bs, pose, { width: 800, height: 600 });
  assert.equal(calls.bufferData, sum(bs), 'no upload for arrays already on the GPU');
});
test('renderer: after a sculpt that moves later pieces, only the edited piece and its seams are uploaded; stale buffers are deleted', () => {
  const { gl, calls } = fakeGL(), r = R.createRenderer(gl), tm = TM.createTrackModel(), segs = words(12);
  let t = tm.update({ segments: segs, closed: false }); r.draw(t.batches, pose, { width: 800, height: 600 });
  const up0 = calls.bufferData, before = new Set(t.batches.map((b) => b.positions));
  const edited = segs.slice(); edited[4] = { ...segs[4], length: 70 };
  t = tm.update({ segments: edited, closed: false }); assert.equal(t.how, 'sculpt');
  const fresh = t.batches.filter((b) => !before.has(b.positions));
  assert.ok(fresh.every((b) => b.key.includes(`_${segs[4].id}`) || b.key.includes(`_${segs[5].id}`)), `fresh: ${fresh.map((b) => b.key)}`);
  r.draw(t.batches, pose, { width: 800, height: 600 });
  assert.equal(calls.bufferData - up0, sum(fresh), 'uploads = the new arrays only');
  assert.ok(fresh.length < t.batches.length / 3, `${fresh.length} of ${t.batches.length} batches re-uploaded`);
  assert.equal(r.stats().buffers, sum(t.batches), 'no buffer kept for an array no longer drawn');
  assert.ok(calls.deleteBuffer > 0);
});
test('renderer: a shader that does not compile throws with the compiler\'s log; a canvas without size is refused', () => {
  assert.throws(() => R.createRenderer(fakeGL({ compiles: false }).gl), /shader compile failed:\nERROR: 0:3/);
  const r = R.createRenderer(fakeGL().gl); assert.throws(() => r.draw([], pose, { width: 0, height: 10 }), /no size/);
});
test('keys: C switches, B is the build view, WASD/QE fly, arrows turn, anything else does nothing', () => {
  assert.deepEqual(P.keyAction('c'), { camera: 'c' }); assert.deepEqual(P.keyAction('C'), { camera: 'c' }); assert.deepEqual(P.keyAction('b'), { camera: 'b' });
  assert.deepEqual(P.keyAction('w'), { fly: [1, 0, 0] }); assert.deepEqual(P.keyAction('ArrowLeft'), { turn: [-1, 0] });
  assert.equal(P.keyAction('x'), null); assert.equal(P.keyAction('Enter'), null);
});
test('the preview shader sources carry no environment (v1 is the track only): no sky, texture or sampler', () => {
  assert.ok(!/sampler|texture|sky/i.test(R.VS + R.FS));
});
