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
// a full build with the model's own path options (D177: the model's path is at the export's step, TM.STEP)
const fullOf = (segs) => B.batchesOf(G.buildMesh(G.buildPath(segs, { step: TM.STEP }), segs));
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
    uniformMatrix4fv() {}, uniform3f() {}, uniform1f() {}, uniform2f() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
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

// ── 2026-09-29, the keeper: "the camera will keep moving forward by itself", "shift to speed camera too", "move and mouse look
//    simultaneously". Stated first: a key held when the window loses focus is let go (its key-up never comes); a key pressed
//    as 'w' and released as 'W' lets go; Shift sprints; the first move from a follow view takes it over into free; a right
//    drag looks from any view, and a drag to the right turns right. ──
function liveFake() {
  const L = {}, on = (t) => (k, f) => { (t[k] = t[k] || []).push(f); }, off = () => {};
  const winL = {}, canL = {}, docL = {};
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  let q = [], t = 0;
  const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, addEventListener: on(docL), removeEventListener: off }, addEventListener: on(winL), removeEventListener: off, requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {},
    step(ms = 100) { t += ms; const f = q; q = []; for (const g of f) g(t); } };
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener: on(canL), removeEventListener: off };
  const fire = (tbl, k, e) => (tbl[k] || []).forEach((f) => f({ preventDefault() {}, ...e }));
  return { win, canvas, doc: win.document, key: (type, e) => fire(winL, type, e), mouse: (type, e) => fire(type === 'mousedown' || type === 'wheel' ? canL : winL, type, e), blur: () => fire(winL, 'blur', {}) };
}
function livePreview(extra = {}) {
  const G2 = require('../../src/geom/index.js'), F2 = require('../../test/geom_fixtures.js');
  const segs = [{ id: 'a', kind: 'road', length: 60, profile: F2.FLAT }];
  const shell = { getState: () => ({ resolved: { segments: segs, closed: false } }), subscribe: () => () => {} };
  const f = liveFake(), p = P.createPreview({ canvas: f.canvas, shell, win: f.win, ...extra });
  f.win.step(16); f.win.step(16);
  return { ...f, p };
}
test('keys: a key held when the window loses focus is let go, so the camera stops (the drift)', () => {
  const { p, key, blur, win } = livePreview();
  key('keydown', { key: 'w', code: 'KeyW', target: {} }); win.step(); assert.equal(p.rig.mode, 'free');
  blur(); const e0 = p.rig.free.state().eye; win.step(); win.step();
  assert.deepEqual(p.rig.free.state().eye, e0, 'no movement after the blur');
});
// B's V11 (L130 camera read): the camera is ALREADY in free, W is held, the window loses focus, and three frames pass. At HEAD (no blur
// handler) it drifted 4.5 m; the old 'pressed as w, released as W' test could not fail (HEAD lowercased both events).
test('keys: already in free, a key held when the window loses focus is let go, so the camera stops (V11 of B: 4.5 m of drift at HEAD)', () => {
  const { p, key, blur, win } = livePreview();
  p.setMode('free'); assert.equal(p.rig.mode, 'free');
  key('keydown', { key: 'w', code: 'KeyW', target: {} }); win.step();
  const moving = p.rig.free.state().eye; win.step(); assert.ok(len3(p.rig.free.state().eye, moving) > 0, 'it was flying');
  blur(); const e0 = p.rig.free.state().eye; win.step(); win.step(); win.step();
  assert.deepEqual(p.rig.free.state().eye, e0, 'no movement after the blur');
});
test('keys: Shift sprints (×4 the distance per frame)', () => {
  const a = livePreview(), b = livePreview();
  for (const x of [a, b]) { x.key('keydown', { key: 'w', code: 'KeyW', target: {} }); x.win.step(); }
  b.key('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true, target: {} });
  const ea = a.p.rig.free.state().eye, eb = b.p.rig.free.state().eye; a.win.step(); b.win.step();
  const da = len3(a.p.rig.free.state().eye, ea), db = len3(b.p.rig.free.state().eye, eb);
  assert.ok(Math.abs(db / da - 4) < 1e-9, `${db} vs ${da}`);
});
test('mouse: a right drag looks from the build view (taking it over), a drag right turns right, and keys move at the same time', () => {
  const { p, key, mouse, win } = livePreview();
  assert.equal(p.rig.mode, 'build');
  mouse('mousedown', { button: 2, clientX: 100, clientY: 100 }); assert.equal(p.rig.mode, 'free');
  const y0 = p.rig.free.state().yaw;
  key('keydown', { key: 'w', code: 'KeyW', target: {} });
  mouse('mousemove', { clientX: 150, clientY: 100 });
  const e0 = p.rig.free.state().eye; win.step();
  assert.ok(p.rig.free.state().yaw < y0, 'a drag right is a right turn (yaw −)');
  assert.ok(len3(p.rig.free.state().eye, e0) > 0, 'and it flew while looking');
});
test('mouse: the scroll wheel zooms the build view', () => {
  const { p, mouse } = livePreview();
  mouse('wheel', { deltaY: -100 }); assert.ok(p.rig.zoomOf('build') < 1);
  mouse('wheel', { deltaY: 100 }); mouse('wheel', { deltaY: 100 }); assert.ok(p.rig.zoomOf('build') > 1);
});
// ── L130-R (its 03:0x newest-key rule is REPLACED below by D188's per-axis rule). B's probes:
//    P3 (C or B pressed while a move key is held snapped back to free), P5 (Shift+wheel on a device that reports deltaX), P2 (the
//    key's ACTION is fixed at key-down, so a key that flies on the label but sits on another physical key still lets go). ──
const W_DOWN = { key: 'w', code: 'KeyW', target: {} }, D_DOWN = { key: 'd', code: 'KeyD', target: {} };
/** The eye's move over one frame with the given keys held, on a fresh preview, for comparing the movement direction. */
function oneFrame(downs) { const x = livePreview(); for (const d of downs) x.key('keydown', d); x.win.step(); const e0 = x.p.rig.free.state().eye; x.win.step(); return sub(x.p.rig.free.state().eye, e0); }
const close3 = (a, b) => len(sub(a, b)) < 1e-9;
// ── D188, the keeper (13:05): "say I am W forward, then I press D, it should go diagonally". MOVEMENT IS PER AXIS: forward/back (W S),
//    left/right (A D) and down/up (Q E) each resolve on their own; on an axis where both keys are held the NEWER wins, and on its
//    release the other takes over; the axes combine (W+D is a diagonal) and the direction is normalised (a diagonal is 1.0× a straight
//    line, not √2). This REPLACES the 03:0x rule "only the newest movement key moves" and its tests. ──
const K = (k) => ({ key: k, code: 'Key' + k.toUpperCase(), target: {} }), UPK = (k) => ({ key: k, code: 'Key' + k.toUpperCase() });
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k], neg3 = (a) => mul3(a, -1);
/** The eye's move over one frame for a straight line on one key (3 m at 30 m/s and 100 ms). */
const unit = (k) => oneFrame([K(k)]);
/** The eye's move over the next frame on a live preview. */
const nextMove = (x) => { const e0 = x.p.rig.free.state().eye; x.win.step(); return sub(x.p.rig.free.state().eye, e0); };
/** A preview with the keys pressed in order (one frame between, so the takeover and the order are both settled). */
function pressed(keys) { const x = livePreview(); for (const k of keys) { x.key('keydown', K(k)); x.win.step(); } return x; }
test('keys: W then D goes diagonally: both axes at once, the same 3 m a frame as a straight line (1.0×, not √2)', () => {
  const w = unit('w'), d = unit('d'), x = pressed(['w', 'd']), m = nextMove(x);
  assert.ok(len(w) > 0 && len(d) > 0 && !close3(w, d), 'W and D are different directions');
  assert.ok(close3(m, mul3(add3(w, d), Math.SQRT1_2)), 'the diagonal is (W + D) / √2: ' + m + ' vs ' + mul3(add3(w, d), Math.SQRT1_2));
  assert.ok(Math.abs(len(m) - len(w)) < 1e-9, 'a diagonal is as fast as a straight line: ' + len(m) + ' m vs ' + len(w) + ' m');
});
test('keys: D then W is the same diagonal (the order across axes does not matter)', () => {
  assert.ok(close3(nextMove(pressed(['d', 'w'])), nextMove(pressed(['w', 'd']))));
});
test('keys: three axes at once (W, D and E) move along the sum W + D + up at 1.0× in METRES (D189: the world displacement is normalised, not the input)', () => {
  const w = unit('w'), d = unit('d'), u = unit('e'), m = nextMove(pressed(['w', 'd', 'e'])), sum = add3(add3(w, d), u);
  assert.ok(close3(m, mul3(sum, len(w) / len(sum))), 'the direction of the sum, 3 m long: ' + m);
});
test('keys: D and E (right and up are perpendicular) go at 1.0× too: (D + up) / √2, 3 m a frame', () => {
  const d = unit('d'), u = unit('e'), m = nextMove(pressed(['d', 'e']));
  assert.ok(close3(m, mul3(add3(d, u), Math.SQRT1_2))); assert.ok(Math.abs(len(m) - len(d)) < 1e-9);
});
test('keys: releasing one key of a diagonal leaves a straight line on the other, and releasing both stops', () => {
  const x = pressed(['w', 'd']); x.key('keyup', UPK('d')); assert.ok(close3(nextMove(x), unit('w')), 'D released: W alone');
  x.key('keydown', K('d')); x.win.step(); x.key('keyup', UPK('w')); assert.ok(close3(nextMove(x), unit('d')), 'W released: D alone');
  x.key('keyup', UPK('d')); const e0 = x.p.rig.free.state().eye; x.win.step(); assert.deepEqual(x.p.rig.free.state().eye, e0, 'both released: still');
});
for (const [older, newer] of [['w', 's'], ['s', 'w'], ['d', 'a'], ['a', 'd'], ['e', 'q'], ['q', 'e']]) {
  test('keys: on one axis the NEWER key wins (' + older + ' then ' + newer + '), and on its release the ' + older + ' takes over', () => {
    const x = pressed([older, newer]);
    assert.ok(close3(nextMove(x), unit(newer)), newer + ' is newer: it moves, not still, not ' + older);
    x.key('keyup', UPK(newer)); assert.ok(close3(nextMove(x), unit(older)), newer + ' released: ' + older + ' takes over');
    x.key('keyup', UPK(older)); const e0 = x.p.rig.free.state().eye; x.win.step(); assert.deepEqual(x.p.rig.free.state().eye, e0, 'both released: still');
  });
}
test('keys: releasing the OLDER key of an axis leaves the newer moving', () => {
  const x = pressed(['w', 's']); x.key('keyup', UPK('w')); assert.ok(close3(nextMove(x), unit('s')));
});
test('keys: an axis with both keys held still combines with another axis: W, S (newer) and D go along (D − W) / √2, and on S released (W + D) / √2', () => {
  const w = unit('w'), d = unit('d'), x = pressed(['w', 's', 'd']);
  assert.ok(close3(nextMove(x), mul3(add3(neg3(w), d), Math.SQRT1_2)), 'S wins the forward axis, D the other');
  x.key('keyup', UPK('s')); assert.ok(close3(nextMove(x), mul3(add3(w, d), Math.SQRT1_2)), 'S released: W takes over, D stays');
});
test('keys: a held key that repeats (auto-repeat key-down) keeps its place: with W, S (newer) held a repeat of W does not make W the newer', () => {
  const x = pressed(['w', 's']); x.key('keydown', { ...K('w'), repeat: true });
  assert.ok(close3(nextMove(x), unit('s')), 'S is still the newer');
});
test('keys: Shift multiplies the diagonal as it does a straight line: ×4 at the press, so 12 m a frame, not 12·√2', () => {
  const x = pressed(['w', 'd']); x.key('keydown', SHIFT_DOWN); const m = nextMove(x);
  assert.ok(Math.abs(len(m) - 12) < 1e-9, len(m) + ' m');
});
test('keys: a blur lets go of a diagonal (both keys), so the camera stops', () => {
  const x = pressed(['w', 'd']); x.blur(); const e0 = x.p.rig.free.state().eye; x.win.step(); x.win.step(); assert.deepEqual(x.p.rig.free.state().eye, e0);
});
test('keys: the arrow (look) keys are not movement keys: they turn while the movement keys fly', () => {
  const x = livePreview(); x.key('keydown', W_DOWN); x.win.step(); const y0 = x.p.rig.free.state().yaw;
  x.key('keydown', { key: 'ArrowRight', code: 'ArrowRight', target: {} }); const e0 = x.p.rig.free.state().eye; x.win.step();
  assert.ok(x.p.rig.free.state().yaw < y0, 'turned right (yaw −)'); assert.ok(len3(x.p.rig.free.state().eye, e0) > 0, 'and still flew');
});
test('P3: C or B pressed while a movement key is held leaves free mode and stays out of it', () => {
  for (const [k, want] of [['c', 'build'], ['b', 'build']]) {
    const x = livePreview(); x.key('keydown', W_DOWN); x.win.step(); assert.equal(x.p.rig.mode, 'free');
    x.key('keydown', { key: k, code: 'Key' + k.toUpperCase(), target: {} }); x.win.step(); x.win.step(); x.win.step();
    assert.equal(x.p.rig.mode, want, `${k}: the camera key is not undone by the held W`);
  }
});
test('P3: a NEW movement key-down after C takes the view over again', () => {
  const x = livePreview(); x.key('keydown', W_DOWN); x.win.step(); x.key('keydown', { key: 'c', code: 'KeyC', target: {} }); x.win.step();
  x.key('keyup', { key: 'w', code: 'KeyW' }); x.key('keydown', W_DOWN); x.win.step(); assert.equal(x.p.rig.mode, 'free');
});
test('P5: Shift+wheel is ×4 when the device reports the scroll as deltaX (deltaY 0), not only as deltaY', () => {
  const a = livePreview(), b = livePreview(); a.mouse('wheel', { deltaY: -100, shiftKey: true }); b.mouse('wheel', { deltaY: 0, deltaX: -100, shiftKey: true });
  assert.ok(a.p.rig.zoomOf('build') < 1 && Math.abs(a.p.rig.zoomOf('build') - Math.pow(1.15, -4)) < 1e-12);
  assert.equal(b.p.rig.zoomOf('build'), a.p.rig.zoomOf('build'));
});
test('P2: a key that flies by its label but sits on another physical key (another layout) flies, and lets go by its own code', () => {
  const x = livePreview(), lab = { key: 'w', code: 'KeyZ', target: {} };
  x.key('keydown', lab); x.win.step(); const e0 = x.p.rig.free.state().eye; x.win.step(); assert.ok(len3(x.p.rig.free.state().eye, e0) > 0, 'it flies forward');
  x.key('keyup', { key: 'w', code: 'KeyZ' }); const e1 = x.p.rig.free.state().eye; x.win.step(); assert.deepEqual(x.p.rig.free.state().eye, e1);
});
// ── L132, the keeper's first use (06:22–06:23): "the shift speed increase is too slow should go faster the longer you hold it down";
//    "when i was entering into the input bar ... it stopped me from being able to move around"; "there needs to be a distinction from
//    zooming in and traversing in" then "or maybe the zoom is good". Stated first: Shift ramps ×4 → ×20 over 2.5 s held and resets on
//    release and on blur; Enter/Esc and a click on the canvas take focus off a field; a NUMBER field lets the camera keys through and a
//    TEXT field swallows them; the plain wheel is unchanged, Ctrl+wheel is the lens (fov, 10°–100°), middle-click resets it. ──
const SHIFT_DOWN = { key: 'Shift', code: 'ShiftLeft', shiftKey: true, target: {} }, SHIFT_UP = { key: 'Shift', code: 'ShiftLeft', shiftKey: false };
/** Metres flown in the next frame (100 ms; 30 m/s plain, so 3 m at ×1). */
const flown = (x) => { const e0 = x.p.rig.free.state().eye; x.win.step(); return len3(x.p.rig.free.state().eye, e0); };
const S3 = (u) => u * u * (3 - 2 * u);
test('the sprint curve: ×4 at 0 s, ×20 from 2.5 s, smooth and rising between (1 s is 4 + 16·S(0.4))', () => {
  assert.equal(P.boostAt(0), 4); assert.equal(P.boostAt(2.5), 20); assert.equal(P.boostAt(60), 20); assert.equal(P.boostAt(-3), 4); assert.equal(P.boostAt(NaN), 4);
  assert.ok(Math.abs(P.boostAt(1) - (4 + 16 * S3(0.4))) < 1e-12, String(P.boostAt(1)));
  let prev = 4; for (let t = 0; t <= 2.5; t += 0.05) { const v = P.boostAt(t); assert.ok(v >= prev - 1e-12, 'rises at ' + t); prev = v; }
  assert.ok(P.boostAt(0.02) - 4 < 0.05 && 20 - P.boostAt(2.48) < 0.05, 'flat at both ends: no jump');
});
test('keys: Shift held ramps the speed: ×4 at the press, then along the curve, ×20 at 2.5 s (measured per frame)', () => {
  const x = livePreview(); x.key('keydown', W_DOWN); x.win.step(); x.key('keydown', SHIFT_DOWN);
  for (let n = 0; n <= 27; n++) {
    const want = 3 * P.boostAt(n * 0.1), got = flown(x);
    if ([0, 10, 25, 27].includes(n)) assert.ok(Math.abs(got - want) < 1e-9, 'frame ' + n + ' (held ' + (n * 0.1).toFixed(1) + ' s): ' + got + ' m vs ' + want + ' m');
  }
  assert.ok(Math.abs(flown(x) - 60) < 1e-9, '×20 of 3 m');
});
test('keys: releasing Shift returns to ×1, and pressing it again starts at ×4 again', () => {
  const x = livePreview(); x.key('keydown', W_DOWN); x.win.step(); x.key('keydown', SHIFT_DOWN); for (let n = 0; n < 30; n++) x.win.step();
  x.key('keyup', SHIFT_UP); assert.ok(Math.abs(flown(x) - 3) < 1e-9, 'released: ×1');
  x.key('keydown', SHIFT_DOWN); assert.ok(Math.abs(flown(x) - 12) < 1e-9, 'pressed again: ×4, not ×20');
});
test('keys: a blur resets the ramp (the key-up never comes), and the next press starts at ×4', () => {
  const x = livePreview(); x.key('keydown', W_DOWN); x.win.step(); x.key('keydown', SHIFT_DOWN); for (let n = 0; n < 30; n++) x.win.step();
  x.blur(); x.key('keydown', W_DOWN); x.key('keydown', SHIFT_DOWN);   // no frame in between: only the blur's own reset can have zeroed the ramp
  assert.ok(Math.abs(flown(x) - 12) < 1e-9, 'after the blur: ×4');
});
function field(tag, type) {
  const f = { tagName: tag.toUpperCase(), type, blurred: false, blur() { f.blurred = true; },
    matches(sel) { return sel.split(',').map((q) => q.trim()).some((q) => { const m = /^(\w+)(?:\[type="(\w+)"\])?$/.exec(q); return !!m && m[1] === tag && (!m[2] || m[2] === type); }); } };
  return f;
}
const kd = (key, target, extra = {}) => ({ key, code: /^[a-z]$/.test(key) ? 'Key' + key.toUpperCase() : key, target, ...extra });
test('focus: Enter in a text field or a number field lets go of it (and does not touch the camera)', () => {
  for (const f of [field('input', 'text'), field('input', 'number'), field('select')]) {
    const x = livePreview(); x.key('keydown', kd('Enter', f)); assert.equal(f.blurred, true, f.tagName + ' ' + f.type); assert.equal(x.p.rig.mode, 'build');
  }
});
test('focus: Esc in a field lets go of it, in every kind of field', () => {
  for (const f of [field('input', 'text'), field('input', 'number'), field('select'), field('textarea')]) { const x = livePreview(); x.key('keydown', kd('Escape', f)); assert.equal(f.blurred, true, f.tagName); }
});
test('focus: Enter in a text AREA is a new line, and is left alone', () => {
  const f = field('textarea'), x = livePreview(); x.key('keydown', kd('Enter', f)); assert.equal(f.blurred, false);
});
test('focus: Enter or Esc on the page (no field) does nothing to the camera', () => {
  const x = livePreview(); x.key('keydown', kd('Enter', {})); x.key('keydown', kd('Escape', null)); x.win.step(); assert.equal(x.p.rig.mode, 'build');
});
test('focus: a mouse-down on the canvas (either button, or the middle) takes focus off the active field', () => {
  for (const button of [0, 1, 2]) { const x = livePreview(), f = field('input', 'text'); x.doc.activeElement = f; x.mouse('mousedown', { button, clientX: 10, clientY: 10 }); assert.equal(f.blurred, true, 'button ' + button); }
});
test('focus: a mouse-down with nothing focused (the page body, or none) is fine', () => {
  const x = livePreview(); x.doc.activeElement = x.doc.body; x.mouse('mousedown', { button: 0 }); assert.equal(x.p.rig.mode, 'build');
  const y = livePreview(); y.doc.activeElement = null; y.mouse('mousedown', { button: 2, clientX: 1, clientY: 1 });
});
test('focus: a NUMBER field lets the camera keys through: W A S D Q E fly, the arrows turn', () => {
  const num = field('input', 'number');
  for (const k of ['w', 'a', 's', 'd', 'q', 'e']) { const x = livePreview(); x.key('keydown', kd(k, num)); x.win.step(); assert.equal(x.p.rig.mode, 'free', k); assert.ok(flown(x) > 0, k + ' flies'); }
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) { const x = livePreview(); x.p.setMode('free'); const s0 = x.p.rig.free.state(); x.key('keydown', kd(k, num)); x.win.step(); const s1 = x.p.rig.free.state(); assert.ok(s1.yaw !== s0.yaw || s1.pitch !== s0.pitch, k + ' turns'); }
});
test('focus: Shift sprints while a number field has focus', () => {
  const num = field('input', 'number'), a = livePreview(), b = livePreview();
  for (const x of [a, b]) { x.key('keydown', kd('w', num)); x.win.step(); }
  b.key('keydown', { ...SHIFT_DOWN, target: num }); assert.ok(Math.abs(flown(b) / flown(a) - 4) < 1e-9);
});
test('focus: a number field still gets its digits (a digit is not the camera\'s key, and is not stopped)', () => {
  const num = field('input', 'number'), x = livePreview(); let stopped = 0; x.key('keydown', kd('5', num, { preventDefault() { stopped++; } })); assert.equal(stopped, 0);
});
test('focus: a TEXT field swallows every camera key: typing a name never moves the camera', () => {
  for (const f of [field('input', 'text'), field('input', undefined), field('textarea'), field('select')]) {
    const x = livePreview(), pose0 = JSON.stringify(x.p.view().pose);
    for (const k of 'wasdqecbl'.split('')) { x.key('keydown', kd(k, f)); x.win.step(); x.key('keyup', kd(k, f)); }
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) { x.key('keydown', kd(k, f)); x.win.step(); x.key('keyup', kd(k, f)); }
    x.key('keydown', { ...SHIFT_DOWN, target: f }); x.win.step(); x.win.step();
    assert.equal(x.p.rig.mode, 'build', f.tagName + ': still the build view'); assert.equal(x.p.view().look, 'ac', 'L was not pressed');
    assert.equal(JSON.stringify(x.p.view().pose), pose0, f.tagName + ': the camera did not move');
  }
});
test('the plain wheel is unchanged: a follow view changes distance, free mode dollies 4 m a notch, and the lens stays', () => {
  const x = livePreview(), fov0 = x.p.rig.fov; x.mouse('wheel', { deltaY: -100 }); assert.ok(x.p.rig.zoomOf('build') < 1); assert.equal(x.p.rig.fov, fov0);
  x.p.setMode('free'); const e0 = x.p.rig.free.state().eye; x.mouse('wheel', { deltaY: -100 }); assert.ok(Math.abs(len3(x.p.rig.free.state().eye, e0) - 4) < 1e-9); assert.equal(x.p.rig.fov, fov0);
});
test('Ctrl+wheel is the LENS, in every view: the fov changes and the eye does not (in and out, stepwise, clamped to 10°–100°)', () => {
  for (const m of ['build', 'overhead', 'side', 'chase', 'free']) {
    const x = livePreview(), fov0 = x.p.rig.fov; x.p.setMode(m); const z0 = x.p.rig.zoomOf(m), e0 = m === 'free' ? x.p.rig.free.state().eye : null;
    x.mouse('wheel', { deltaY: -100, ctrlKey: true }); x.win.step(); const f1 = x.p.rig.fov;
    assert.ok(Math.abs(f1 - fov0 / 1.15) < 1e-12, m + ': one notch in is ×1/1.15'); assert.equal(x.p.rig.zoomOf(m), z0, m + ': the distance zoom is untouched');
    if (e0) assert.deepEqual(x.p.rig.free.state().eye, e0, 'free: the camera did not move'); assert.equal(x.p.view().pose.fov, f1, m + ': the drawn pose carries it');
    x.mouse('wheel', { deltaY: 100, ctrlKey: true }); assert.ok(Math.abs(x.p.rig.fov - fov0) < 1e-12, m + ': and back out');
  }
  const y = livePreview(); for (let n = 0; n < 40; n++) y.mouse('wheel', { deltaY: -100, ctrlKey: true }); assert.ok(Math.abs(y.p.rig.fov - 10 * Math.PI / 180) < 1e-12, 'in: 10°');
  for (let n = 0; n < 60; n++) y.mouse('wheel', { deltaY: 100, ctrlKey: true }); assert.ok(Math.abs(y.p.rig.fov - 100 * Math.PI / 180) < 1e-12, 'out: 100°');
});
test('Ctrl+wheel: Shift makes it 4 notches, and a device that reports deltaX works too', () => {
  const a = livePreview(), b = livePreview(), c = livePreview(); a.mouse('wheel', { deltaY: -100, ctrlKey: true, shiftKey: true }); b.mouse('wheel', { deltaY: 0, deltaX: -100, ctrlKey: true, shiftKey: true }); c.mouse('wheel', { deltaY: -100, ctrlKey: true });
  assert.ok(Math.abs(a.p.rig.fov - (60 * Math.PI / 180) / Math.pow(1.15, 4)) < 1e-12); assert.equal(b.p.rig.fov, a.p.rig.fov); assert.ok(c.p.rig.fov > a.p.rig.fov);
});
test('a middle click resets the lens to 60° (and does not start a drag or change the view)', () => {
  const x = livePreview(), fov0 = x.p.rig.fov; for (let n = 0; n < 5; n++) x.mouse('wheel', { deltaY: -100, ctrlKey: true }); assert.ok(x.p.rig.fov < fov0);
  let stopped = 0; x.mouse('mousedown', { button: 1, clientX: 5, clientY: 5, preventDefault() { stopped++; } });
  assert.equal(x.p.rig.fov, fov0); assert.equal(x.p.rig.mode, 'build'); assert.ok(stopped >= 1, 'the browser\'s autoscroll is stopped');
});
test('the HUD shows the fov once the lens has moved off 60°, and drops it on the reset', () => {
  const hud = { textContent: '' }, x = livePreview({ hud }); x.win.step(); assert.ok(!/fov/.test(hud.textContent), hud.textContent);
  x.mouse('wheel', { deltaY: -100, ctrlKey: true }); x.win.step(); assert.ok(/fov 52°/.test(hud.textContent), hud.textContent);
  x.mouse('mousedown', { button: 1 }); x.win.step(); assert.ok(!/fov/.test(hud.textContent), hud.textContent);
});
test('the pick still hits the station under the cursor after the lens changes (the pick reads the drawn pose, fov and all)', () => {
  const x = livePreview(); for (let n = 0; n < 3; n++) x.mouse('wheel', { deltaY: -100, ctrlKey: true }); for (let n = 0; n < 60; n++) x.win.step();
  const pose = x.p.view().pose, path = x.p.track().path, VP = M.viewProj(pose, 800 / 500); assert.ok(pose.fov < 60 * Math.PI / 180 - 0.1);
  let tried = 0;
  for (const m of path.samples) {
    const c = M.apply(VP, m.pos); if (!(c[3] > 0) || Math.abs(c[0] / c[3]) > 0.97 || Math.abs(c[1] / c[3]) > 0.97) continue;
    const px = (c[0] / c[3] * 0.5 + 0.5) * 800, py = (1 - (c[1] / c[3] * 0.5 + 0.5)) * 500, hit = x.p.pick(px, py); tried++;
    assert.ok(hit && hit.px < 1.5 && len(sub(hit.pos, m.pos)) < 1e-6, 'station ' + m.s + ': ' + JSON.stringify(hit));
  }
  assert.ok(tried >= 3, 'tried ' + tried);
});
function len3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

// ── D187 (E's L130-R review, W1 and W2; the reproducers, verbatim in intent). A held key REPEATS: a real keyboard sends key-downs with
//    repeat: true about 30 times a second, and a trackpad swiping SIDEWAYS sends wheel events with deltaX only and no Shift. ──
for (const k of ['c', 'b']) {
  test(`W1: W held and REPEATING, ${k.toUpperCase()} pressed: W's next auto-repeats do not take the view back into free`, () => {
    const x = livePreview(); x.key('keydown', W_DOWN); x.win.step(); assert.equal(x.p.rig.mode, 'free');
    x.key('keydown', { key: k, code: 'Key' + k.toUpperCase(), target: {} }); x.win.step(); const after = x.p.rig.mode; assert.notEqual(after, 'free');
    for (let i = 0; i < 3; i++) { x.key('keydown', { ...W_DOWN, repeat: true }); x.win.step(); }
    assert.equal(x.p.rig.mode, after, `after ${k.toUpperCase()}, W's key-repeat snapped the view back into ${x.p.rig.mode}`);
  });
}
test('W2: a trackpad swipe SIDEWAYS (deltaX only, no Shift: 20 events of 2 px) does not zoom', () => {
  const x = livePreview(); for (let i = 0; i < 20; i++) x.mouse('wheel', { deltaY: 0, deltaX: 2 });
  assert.equal(x.p.rig.zoomOf('build'), 1, `a sideways swipe zoomed the build view to ×${x.p.rig.zoomOf('build').toFixed(2)}`);
});
test('W2: the same sideways swipe with Ctrl held does not move the LENS either (the lens shares the wheel line)', () => {
  const x = livePreview(), f0 = x.p.rig.fov; for (let i = 0; i < 20; i++) x.mouse('wheel', { deltaY: 0, deltaX: 2, ctrlKey: true });
  assert.equal(x.p.rig.fov, f0, `a sideways swipe with Ctrl moved the lens from ${(f0 * 180 / Math.PI).toFixed(1)}° to ${(x.p.rig.fov * 180 / Math.PI).toFixed(1)}°`);
});

// ── D195, the keeper (2026-09-30 02:56): "before pressing extend for the first piece, the preview is very laggy and continues to lag
//    until the first piece is put down". Measured in the real window (pane E's hand-back): with NOTHING placed and no ghost, the
//    camera's context was null, so no frame drew (0 draws), the wheel and keys changed nothing on screen, and a key pressed then
//    took the view over only when a ghost later appeared. Stated first: with nothing placed, a frame draws at once, looking at
//    where the first piece will start; the wheel and a movement key show on the NEXT frame; every camera mode works. ──
const START = { pos: [5, 2, -3], theta: 0.7, p: 0.1 };
function emptyPreview(start = START) {
  const shell = { getState: () => ({ resolved: { segments: [], closed: false, ...(start ? { start } : {}) } }), subscribe: () => () => {} };
  const f = liveFake(), p = P.createPreview({ canvas: f.canvas, shell, win: f.win });
  f.win.step(16); f.win.step(16);
  return { ...f, p };
}
test('D195: with nothing placed and no ghost, a frame draws, looking at where the first piece will start', () => {
  const x = emptyPreview(), v = x.p.view();
  assert.ok(v.pose, 'a pose was drawn');
  const d = sub(START.pos, v.pose.eye), T = P.startHead(START).T, dl = len(d);
  assert.ok((d[0] * T[0] + d[1] * T[1] + d[2] * T[2]) / dl > 0.5, 'the build view looks along the start direction, toward the start');
});
test('D195: with nothing placed, the wheel zooms on the next frame (not later, when a ghost appears)', () => {
  const x = emptyPreview(); for (let i = 0; i < 30; i++) x.win.step(100);   // settled
  const e0 = x.p.view().pose.eye; x.mouse('wheel', { deltaY: -100 }); x.win.step(100);
  assert.ok(len(sub(x.p.view().pose.eye, e0)) > 0.1, 'the drawn eye moved on the next frame');
});
test('D195: with nothing placed, W takes the view over and flies on the next frame', () => {
  const x = emptyPreview(); x.key('keydown', W_DOWN); x.win.step(100);
  assert.equal(x.p.rig.mode, 'free');
  const e0 = x.p.view().pose.eye; x.win.step(100);
  assert.ok(Math.abs(len(sub(x.p.view().pose.eye, e0)) - 3) < 1e-9, 'W flies 3 m a frame (30 m/s, 100 ms), as on a placed track');
});
test('D195: with nothing placed, every camera mode draws (chase included, on the start alone)', () => {
  const x = emptyPreview();
  for (const m of ['overhead', 'side', 'chase', 'free', 'build']) { x.p.setMode(m); x.win.step(100); const v = x.p.view(); assert.equal(v.mode, m); assert.ok(v.pose && v.pose.eye.every(Number.isFinite), `${m} drew a finite pose`); }
});
test('D195: with no start in the document (the piece builder), the empty view looks from the origin along +z, level', () => {
  const x = emptyPreview(null), h = P.startHead(null);
  for (const [k, want] of [['pos', [0, 0, 0]], ['T', [0, 0, 1]], ['U', [0, 1, 0]]]) assert.ok(len(sub(h[k], want)) < 1e-15, `${k}: ${h[k]}`);   // a cross product gives −0 here, so not deepEqual
  assert.ok(x.p.view().pose);
});
test('D195: the empty track\'s head is the frame the first piece starts with (src/geom buildPath\'s first sample, no roll)', () => {
  for (const st of [START, { pos: [0, 0, 0], theta: -2.1, p: -0.3 }, null]) {
    const h = P.startHead(st), s0 = G.buildPath([{ id: 'a', kind: 'road', length: 20, profile: F.FLAT }], { step: 2, ...(st ? { start: st } : {}) }).samples[0];
    for (const k of ['pos', 'T', 'L', 'U']) assert.ok(len(sub(h[k], s0[k])) < 1e-12, `${k}: ${h[k]} vs ${s0[k]}`);
  }
});
test('D195: once a ghost shows on the empty track, the camera follows the ghost\'s head, as before', () => {
  const x = emptyPreview(null), segs = [{ id: 'a', kind: 'road', length: 60, profile: F.FLAT }];
  x.p.showGhost({ segments: segs, closed: false }); for (let i = 0; i < 60; i++) x.win.step(100);
  const v = x.p.view(), h = G.buildPath(segs, { step: 2 }).head;
  assert.ok(len(sub(v.pose.target, h.pos)) < len(sub(v.pose.target, [0, 0, 0])), 'framed on the ghost\'s head, not the start');
});

// ── D252, the keeper (11:36): "space bar to go up, lft control to go down?" SPACE flies up and LEFT CTRL flies down, held like E and Q (which stay),
//    by the physical key; Right Ctrl does not fly. Ctrl is the app's too (Ctrl+Z/Y/S/Backspace, Ctrl+wheel the lens, Ctrl snaps a handle drag), so
//    Left Ctrl flies only while it is the ONLY key down and no mouse button is: when another key, the wheel or a button joins it, that press's
//    descent is undone and the camera is where Ctrl found it. Space never reaches a focused button (taken) but types in a text field. ──
const SPACE = (extra = {}) => ({ key: ' ', code: 'Space', target: {}, ...extra }), LCTRL = (extra = {}) => ({ key: 'Control', code: 'ControlLeft', ctrlKey: true, target: {}, ...extra });
const RCTRL = { key: 'Control', code: 'ControlRight', ctrlKey: true, target: {} }, CTRL_Z = { key: 'z', code: 'KeyZ', ctrlKey: true, target: {} };
const eyeOf = (x) => x.p.rig.free.state().eye;
test('D252: Space held flies UP like E (3 m a frame, world up), and its release stops it', () => {
  const x = pressed(['w']); x.key('keyup', UPK('w')); x.key('keydown', SPACE()); x.win.step(); const m = nextMove(x);
  assert.ok(close3(m, unit('e')), `Space moves as E does: ${m} vs ${unit('e')}`); assert.ok(m[1] > 2.9, 'up');
  x.key('keyup', { key: ' ', code: 'Space' }); x.win.step(); assert.ok(close3(nextMove(x), [0, 0, 0]), 'released: still');
});
test('D252: Left Ctrl ALONE flies DOWN like Q; Right Ctrl does not fly', () => {
  const x = pressed(['w']); x.key('keyup', UPK('w')); x.key('keydown', LCTRL()); x.win.step(); const m = nextMove(x);
  assert.ok(close3(m, unit('q')), `Left Ctrl moves as Q does: ${m} vs ${unit('q')}`); assert.ok(m[1] < -2.9, 'down');
  x.key('keyup', { key: 'Control', code: 'ControlLeft' }); x.win.step(); assert.ok(close3(nextMove(x), [0, 0, 0]), 'released: still');
  const y = pressed(['w']); y.key('keyup', UPK('w')); y.key('keydown', RCTRL); y.win.step(); assert.ok(close3(nextMove(y), [0, 0, 0]), 'Right Ctrl: still');
});
test('D252: Ctrl+Z never moves the camera: the descent before Z is undone, in free mode and from the build view (the view is kept too)', () => {
  const x = pressed(['w']); x.key('keyup', UPK('w')); x.win.step(); const e0 = eyeOf(x);
  x.key('keydown', LCTRL()); x.win.step(); x.win.step(); assert.ok(eyeOf(x)[1] < e0[1] - 1, 'control: Ctrl alone was descending');
  x.key('keydown', CTRL_Z); assert.ok(len(sub(eyeOf(x), e0)) < 1e-9, 'Z joined: back where Ctrl found it'); x.win.step(); x.win.step();
  assert.ok(len(sub(eyeOf(x), e0)) < 1e-9, 'and it stays there while both are held'); x.key('keyup', { key: 'z', code: 'KeyZ' }); x.win.step();
  assert.ok(len(sub(eyeOf(x), e0)) < 1e-9, 'Z let go, Ctrl still down: no descent for this press');
  const b = livePreview(); assert.equal(b.p.rig.mode, 'build'); b.key('keydown', LCTRL()); b.win.step(); b.key('keydown', CTRL_Z); b.win.step();
  assert.equal(b.p.rig.mode, 'build', 'from the build view, Ctrl+Z leaves it the build view');
});
test('D252: a key held BEFORE Ctrl (Shift for Ctrl+Shift+Z, or W) means Ctrl never flies on that press', () => {
  const x = pressed(['w']); x.key('keyup', UPK('w')); x.win.step(); const e0 = eyeOf(x);
  x.key('keydown', SHIFT_DOWN); x.key('keydown', LCTRL({ shiftKey: true })); x.win.step(); x.win.step();
  assert.ok(len(sub(eyeOf(x), e0)) < 1e-9, 'Shift then Ctrl: still');
});
test('D252: Ctrl+wheel is still the LENS and the camera does not move; a mouse button down (a handle drag, Ctrl to snap) means no descent', () => {
  const x = pressed(['w']); x.key('keyup', UPK('w')); x.win.step(); const e0 = eyeOf(x), fov0 = x.p.rig.fov;
  x.key('keydown', LCTRL()); x.win.step(); x.mouse('wheel', { deltaY: -100, ctrlKey: true }); x.win.step();
  assert.ok(x.p.rig.fov < fov0, 'the lens narrowed'); assert.ok(len(sub(eyeOf(x), e0)) < 1e-9, 'and the camera is where Ctrl found it');
  const y = pressed(['w']); y.key('keyup', UPK('w')); y.win.step(); const f0 = eyeOf(y);
  y.key('mousedown', { button: 0, clientX: 5, clientY: 5 }); y.key('keydown', LCTRL()); y.win.step(); y.win.step();
  assert.ok(len(sub(eyeOf(y), f0)) < 1e-9, 'a button was down when Ctrl went down: still');
  y.key('mouseup', { button: 0 }); y.key('keyup', { key: 'Control', code: 'ControlLeft' });
  y.key('keydown', LCTRL()); y.win.step(); y.key('mousedown', { button: 0, clientX: 5, clientY: 5 }); y.win.step();
  assert.ok(len(sub(eyeOf(y), f0)) < 1e-9, 'a button went down while Ctrl flew: undone');
});
test('D252: Space is TAKEN (preventDefault, down and up) so a focused button is never clicked; in a text field it types and the camera stays', () => {
  let pd = 0; const spy = () => { pd++; };
  const x = livePreview(), btn = { matches: () => false };
  x.key('keydown', SPACE({ target: btn, preventDefault: spy })); x.key('keyup', { key: ' ', code: 'Space', target: btn, preventDefault: spy });
  assert.equal(pd, 2, 'taken on the way down and on the way up');
  const y = livePreview(), f = field('input', 'text'); let pf = 0;
  y.key('keydown', SPACE({ target: f, preventDefault: () => { pf++; } })); y.key('keyup', { key: ' ', code: 'Space', target: f, preventDefault: () => { pf++; } }); y.win.step(); y.win.step();
  assert.equal(pf, 0, 'a text field types its space'); assert.equal(y.p.rig.mode, 'build', 'and the camera did not take over');
});
// D252 (the chair's ruling on the dip B named: Ctrl then Z dipped 9.3 m and snapped back): Left Ctrl descends only after it has been held ALONE for
// ~200 ms, so a Ctrl shortcut pressed inside that window never moves the camera at all; the undo stays as the backstop for a slower one
test('D252: Ctrl then Z WITHIN 200 ms leaves the camera untouched from the very start (no dip, and the build view never becomes free)', () => {
  const x = pressed(['w']); x.key('keyup', UPK('w')); x.win.step(); const e0 = eyeOf(x);
  x.key('keydown', LCTRL()); x.win.step(100); assert.ok(len(sub(eyeOf(x), e0)) < 1e-9, '100 ms of Ctrl alone: not one millimetre yet');
  x.key('keydown', CTRL_Z); x.win.step(); x.win.step(); assert.ok(len(sub(eyeOf(x), e0)) < 1e-9, 'Z joined: still untouched');
  const b = livePreview(); b.key('keydown', LCTRL()); b.win.step(100); assert.equal(b.p.rig.mode, 'build', 'from the build view: no takeover inside the window');
  b.key('keydown', CTRL_Z); b.win.step(); assert.equal(b.p.rig.mode, 'build');
  const h = pressed(['w']); h.key('keyup', UPK('w')); h.win.step(); const h0 = eyeOf(h); h.key('keydown', LCTRL()); for (let i = 0; i < 5; i++) h.win.step(100);
  assert.ok(eyeOf(h)[1] < h0[1] - 5, 'a deliberate hold (500 ms) still flies down');
});

// C's finding 4 (p-spacefly-C_2026-10-06.md), reproduced in rows: a move key in the OVERHEAD view (W, E, Space or Left Ctrl) took the view over into free
// at pitch exactly -90 degrees, looking straight down along the world up the free view keeps, so EVERY frame threw "lookAt: up is parallel to the view
// direction" (the same on an empty track, reached through chase). The free view now enters within the 89 degrees look() keeps, facing the overhead's up.
test('a move key from the OVERHEAD view enters free with no frame throwing: pitch held at -89 degrees, facing where the overhead view had up the screen', () => {
  for (const k of [K('w'), SPACE(), K('e'), LCTRL()]) {
    const x = livePreview(); x.key('keydown', { key: 'c', code: 'KeyC', target: {} }); x.key('keyup', { key: 'c', code: 'KeyC' }); for (let i = 0; i < 30; i++) x.win.step(); assert.equal(x.p.rig.mode, 'overhead');
    const up = x.p.view().pose.up; x.key('keydown', k); for (let i = 0; i < 6; i++) assert.doesNotThrow(() => x.win.step(), k.code);
    const s = x.p.rig.free.state(); assert.equal(x.p.rig.mode, 'free'); assert.ok(Math.abs(s.pitch * 180 / Math.PI + 89) < 1e-9, `${k.code} pitch ${s.pitch * 180 / Math.PI}`);
    const fwd = [Math.sin(s.yaw), 0, Math.cos(s.yaw)], uh = Math.hypot(up[0], up[2]);
    assert.ok(Math.abs((fwd[0] * up[0] + fwd[2] * up[2]) / uh - 1) < 1e-6, `${k.code}: faces the overhead view's up`);
  }
});

// C's finding 5 (p-spacefly-C_2026-10-06.md): app/core/handles.js calls preventDefault() on pointerdown, which in a browser SUPPRESSES the compatibility mousedown
// the preview watched, so Ctrl held to SNAP a handle drag could fly the camera down once past the 200 ms hold. A press is now read from pointerdown too.
test('a handle drag (pointerdown only, its mousedown suppressed) with Ctrl held past 200 ms to snap: the camera does not move; a press joining Ctrl undoes it', () => {
  const x = pressed(['w']); x.key('keyup', UPK('w')); x.win.step(); const e0 = eyeOf(x);
  x.key('pointerdown', { button: 0, pointerType: 'mouse', clientX: 5, clientY: 5 }); x.key('keydown', LCTRL()); for (let i = 0; i < 5; i++) x.win.step(100);
  assert.ok(len(sub(eyeOf(x), e0)) < 1e-9, 'Ctrl held 500 ms during the drag: unmoved');
  x.key('keyup', { key: 'Control', code: 'ControlLeft' }); x.key('pointerup', { button: 0, pointerType: 'mouse' });
  const y = pressed(['w']); y.key('keyup', UPK('w')); y.win.step(); const f0 = eyeOf(y);
  y.key('keydown', LCTRL()); for (let i = 0; i < 4; i++) y.win.step(100); assert.ok(eyeOf(y)[1] < f0[1] - 1, 'control: Ctrl alone was descending');
  y.key('pointerdown', { button: 0, pointerType: 'mouse', clientX: 5, clientY: 5 }); assert.ok(len(sub(eyeOf(y), f0)) < 1e-9, 'a press joined: back where Ctrl found it');
});
