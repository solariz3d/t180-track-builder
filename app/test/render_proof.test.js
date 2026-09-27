// render_proof.test.js: node --test app/test/render_proof.test.js. D169: the preview's frame loop against a stand-in
// canvas, window and WebGL (no GPU, no DOM), plus the probe the window proof reads. Stated before the code:
//   · DPR: the canvas backing store is round(css size × devicePixelRatio) per side, the renderer draws at that size, and
//     a change of DPR or of the css size resizes it on the next frame. A missing or nonsense DPR counts as 1; a side
//     never exceeds 8192 (then both sides scale down together, keeping the aspect).
//   · Ctrl, Alt and Meta with C or B do NOT switch the camera (B's D168 defect 4: Ctrl+C is copy); plain C and B do.
//   · A preview that cannot mount throws a PreviewMountError naming the reason, and leaves that reason visible in its root.
//   · The probe reports the mode, the head, where the head lands on screen (NDC), and how far the view looks along T.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const P = require(path.join(ADIR, 'preview', 'preview.js'));
const IDX = require(path.join(ADIR, 'preview', 'index.js'));
const PROBE = require(path.join(ADIR, 'testhook', 'probe.js'));
const F = require('../../test/geom_fixtures.js');

function fakeGL() {
  const calls = { viewport: [] };
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7,
    COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13,
    BLEND: 14, LINES: 15, SRC_ALPHA: 17, ONE_MINUS_SRC_ALPHA: 18, depthMask() {}, blendFunc() {}, disableVertexAttribArray() {},
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true, getShaderInfoLog: () => '',
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, getProgramInfoLog: () => '',
    getAttribLocation: () => 0, getUniformLocation: (p, n) => n, useProgram() {}, viewport(x, y, w, h) { calls.viewport.push([w, h]); }, clearColor() {}, clear() {}, enable() {}, disable() {},
    uniformMatrix4fv() {}, uniform3f() {}, uniform1f() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, deleteBuffer() {}, deleteProgram() {}, drawElements() {}, drawArrays() {},
  };
  return { gl, calls };
}
function listeners() { const m = new Map(); return { add: (t, f) => { if (!m.has(t)) m.set(t, new Set()); m.get(t).add(f); }, remove: (t, f) => m.get(t) && m.get(t).delete(f), fire: (t, e) => { for (const f of m.get(t) || []) f(e); } }; }
function fakeWindow(dpr) {
  const L = listeners(); let q = [], t = 0;
  return {
    devicePixelRatio: dpr, addEventListener: L.add, removeEventListener: L.remove, fire: L.fire,
    requestAnimationFrame: (f) => { q.push(f); return q.length; }, cancelAnimationFrame: () => { q = []; },
    step() { const f = q; q = []; t += 16; for (const g of f) g(t); },
  };
}
function fakeCanvas(cssW, cssH, gl) {
  const L = listeners();
  return { clientWidth: cssW, clientHeight: cssH, width: 300, height: 150, getContext: () => gl, addEventListener: L.add, removeEventListener: L.remove };
}
function fakeShell(segments) {
  const st = { resolved: { segments, closed: false }, resolveError: null };
  return { getState: () => st, subscribe: () => () => {} };
}
const SEGS = [{ id: 'a', kind: 'road', length: 60, profile: F.FLAT }, { id: 'b', kind: 'road', length: 50, k0: 0.02, k1: 0.02, profile: F.HALFPIPE }];

test('DPR: the backing store is the css size × devicePixelRatio, and the renderer draws at that size', () => {
  const { gl, calls } = fakeGL(), win = fakeWindow(1.5), canvas = fakeCanvas(800, 500, gl);
  P.createPreview({ canvas, shell: fakeShell(SEGS), win });
  win.step();
  assert.deepEqual([canvas.width, canvas.height], [1200, 750]);
  assert.deepEqual(calls.viewport.at(-1), [1200, 750]);
});
test('DPR: a change of devicePixelRatio or of the css size resizes on the next frame', () => {
  const { gl, calls } = fakeGL(), win = fakeWindow(1), canvas = fakeCanvas(800, 500, gl);
  P.createPreview({ canvas, shell: fakeShell(SEGS), win });
  win.step(); assert.deepEqual([canvas.width, canvas.height], [800, 500]);
  win.devicePixelRatio = 2; win.step(); assert.deepEqual([canvas.width, canvas.height], [1600, 1000]);
  canvas.clientWidth = 640; win.step(); assert.deepEqual([canvas.width, canvas.height], [1280, 1000]);
  assert.deepEqual(calls.viewport.at(-1), [1280, 1000]);
});
test('DPR edges: missing or nonsense DPR is 1; a side is capped at 8192 with the aspect kept; zero size draws nothing', () => {
  assert.deepEqual(P.backingSize(800, 500, undefined), { width: 800, height: 500 });
  assert.deepEqual(P.backingSize(800, 500, NaN), { width: 800, height: 500 });
  assert.deepEqual(P.backingSize(800, 500, -2), { width: 800, height: 500 });
  assert.deepEqual(P.backingSize(801, 333, 1.25), { width: 1001, height: 416 });
  assert.deepEqual(P.backingSize(5000, 2500, 4), { width: 8192, height: 4096 });
  assert.deepEqual(P.backingSize(0, 500, 2), { width: 0, height: 1000 });
  const { gl, calls } = fakeGL(), win = fakeWindow(2), canvas = fakeCanvas(0, 0, gl);
  P.createPreview({ canvas, shell: fakeShell(SEGS), win }); win.step();
  assert.equal(calls.viewport.length, 0);
});
test('keys: Ctrl, Alt or Meta with C or B do not switch the camera; plain C and B do', () => {
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
    assert.equal(P.keyAction('c', { [mod]: true }), null, `${mod}+C`);
    assert.equal(P.keyAction('b', { [mod]: true }), null, `${mod}+B`);
  }
  assert.deepEqual(P.keyAction('c', {}), { camera: 'c' });
  assert.deepEqual(P.keyAction('C', { shiftKey: true }), { camera: 'c' }, 'Shift+C is still C');
});
test('keys in the frame loop: Ctrl+C leaves the camera where it was; C then moves it', () => {
  const { gl } = fakeGL(), win = fakeWindow(1), canvas = fakeCanvas(800, 500, gl);
  const p = P.createPreview({ canvas, shell: fakeShell(SEGS), win }); win.step();
  const ev = (key, mods = {}) => ({ key, ...mods, target: null, preventDefault() {} });
  win.fire('keydown', ev('c', { ctrlKey: true })); assert.equal(p.rig.mode, 'build');
  win.fire('keydown', ev('c')); assert.equal(p.rig.mode, 'overhead');
  win.fire('keydown', ev('b', { metaKey: true })); assert.equal(p.rig.mode, 'overhead');
});
test('mount failure: no WebGL throws a PreviewMountError naming the reason, and shows it in the panel', () => {
  const kids = [], root = { ownerDocument: null, append: (...k) => kids.push(...k), replaceChildren: (...k) => { kids.length = 0; kids.push(...k); } };
  const doc = { defaultView: fakeWindow(1), createElement: (t) => (t === 'canvas' ? { style: {}, getContext: () => null, addEventListener() {}, removeEventListener() {} } : { style: {}, textContent: '' }), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  root.ownerDocument = doc;
  assert.throws(() => IDX.mount(root, fakeShell(SEGS)), (e) => e.name === 'PreviewMountError' && /WebGL is not available/.test(e.message));
  assert.ok(kids.some((k) => /preview could not start: .*WebGL is not available/i.test(k.textContent || '')), 'the reason is left on screen');
});
test('probe: the head lands in the middle of the build view, which looks along the growth direction', () => {
  const { gl } = fakeGL(), win = fakeWindow(1), canvas = fakeCanvas(800, 500, gl);
  const p = P.createPreview({ canvas, shell: fakeShell(SEGS), win }); for (let i = 0; i < 3; i++) win.step();
  const r = PROBE.probe(p, canvas, win);
  assert.equal(r.mode, 'build'); assert.equal(r.segments, 2);
  assert.ok(Math.abs(r.headNdc[0]) < 0.05 && r.headNdc[1] > -1 && r.headNdc[1] < 1 && r.headNdc[2] < 1, `head at ${r.headNdc}`);
  assert.ok(r.lookAlongT > 0.9, `view · T = ${r.lookAlongT}`);
  assert.deepEqual(r.canvas, { width: 800, height: 500, cssWidth: 800, cssHeight: 500, dpr: 1 });
});
// D170 changed this requirement (review item 2): the overhead now fits the WHOLE track, so the head is in
// frame but no longer straight below; app/test/look.test.js checks that the fit contains every vertex.
test('probe: in overhead (fit to the whole track) the head is in frame', () => {
  const { gl } = fakeGL(), win = fakeWindow(1), canvas = fakeCanvas(800, 500, gl);
  const p = P.createPreview({ canvas, shell: fakeShell(SEGS), win }); p.setMode('overhead'); for (let i = 0; i < 200; i++) win.step();
  const r = PROBE.probe(p, canvas, win);
  assert.ok(Math.abs(r.headNdc[0]) < 1 && Math.abs(r.headNdc[1]) < 1 && r.headNdc[2] < 1, `head at ${r.headNdc}`);
});
