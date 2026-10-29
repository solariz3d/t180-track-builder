// preview-open.test.js: node --test app/test/preview-open.test.js
// Opening a long track froze the window: the preview meshed the whole road inside the state change that opened it (the user's CRAZY TEST, 19.7 km, about 1.7 s in one
// task). A full rebuild with no drag open is now built a slice a frame, and the stage keeps what it showed until it lands; a build that is whole in one step (a placement)
// is still shown at once. The preview's own rig, with the page's clock (performance.now) so the slices are timed for real. Rows:
//   1  opening a document publishes no track from the state change itself; the HUD says the road is being built; the track arrives some frames later, and it is the full build
//   2  a placement on the opened track is on show from its own state change, with no frame run
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const P = require('../preview/preview.js');

const R = 180, Q = (Math.PI * R) / 2;
const verts = (batches) => batches.reduce((a, b) => a + b.positions.length / 3, 0);
/** The saved text of an open track of tube pieces, long enough that its full build takes many slices. */
async function savedTrack(pieces) {
  let text = null;
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, storage: { saveDoc: async (n, t) => { text = t; }, saveUndo: async () => {}, listDocs: async () => [] } });
  s.extend({ length: 400, first: { w: 31, t: 360 } });
  for (let i = 1; i < pieces; i++) s.extend({ length: Q, transition: 40, targets: { kh: (i % 2 ? 1 : -1) / R } });
  assert.equal(s.getState().message, null, s.getState().message);
  await s.save('long'); assert.ok(text, 'saved'); return text;
}
function rig(shell) {
  let rafs = [];
  const win = { devicePixelRatio: 1, performance, document: { hidden: false, activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; }, cancelAnimationFrame() {}, setTimeout: () => 0, clearTimeout() {} };
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  const hud = { textContent: '' }, p = P.createPreview({ canvas, shell, win, hud });
  let t = 16; const frame = () => { const run = rafs; rafs = []; for (const f of run) f(t += 16); };
  return { p, hud, frame };
}

test('row 1: opening a long track shows nothing new from the state change; the HUD says the road is being built; the full build arrives some frames later', async () => {
  const text = await savedTrack(10);
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, storage: { openDoc: async () => text, openUndo: async () => null, listDocs: async () => [] } });
  const { p, hud, frame } = rig(s), v = () => p.view();
  const before = v().track;
  await s.open('long');
  assert.ok(v().track === before, 'the open itself published no track: the stage keeps what it showed');
  frame(); assert.match(hud.textContent, /building the road/, `the HUD says so: ${hud.textContent}`);
  let n = 1; while (v().track === before && n < 5000) { frame(); n++; }
  assert.ok(v().track !== before, 'the track arrived'); assert.ok(n > 1, `over more than one frame (${n})`);
  assert.equal(verts(v().track.batches), verts(createTrackModel().update(s.getState().resolved).batches), 'and it is the full build of the opened track');
  frame(); assert.doesNotMatch(hud.textContent, /building the road/, 'the HUD clears when it lands');
  p.dispose();
});

test('row 2: a placement on the opened track is on show from its own state change, with no frame run', async () => {
  const text = await savedTrack(4);
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, storage: { openDoc: async () => text, openUndo: async () => null, listDocs: async () => [] } });
  const { p, frame } = rig(s), v = () => p.view();
  await s.open('long'); for (let k = 0; k < 5000 && !(v().track && v().track.path); k++) frame();
  const placed = v().track; assert.ok(placed.path, 'opened');
  s.extend({ length: 120 }); assert.equal(s.getState().message, null, s.getState().message);
  assert.ok(v().track !== placed, 'the placement is on show at once'); assert.equal(v().track.how, 'extend');
  p.dispose();
});
