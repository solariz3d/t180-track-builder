// preview-late.test.js: node --test app/test/preview-late.test.js
// D340: the camera "coasts in that direction for like 3 seconds till it stops" (plan :782-783) after W, A, Shift and a right-button look are let go. Measured
// headless on the 27 km track (hand-back §1): every key-up reached the page within 3 ms under every load tried, the longest page task 244 ms; so the 3 s is not
// reproduced there, and what remains is the host, which a headless page cannot see. THE INSTRUMENT, for the real window: every key event is checked as it is
// handled against the time the OS stamped it (e.timeStamp, on the page's own clock). One handled more than 250 ms late is kept (preview.view().inputLate, the
// last 20) and said in the HUD for 8 s, with what the page did meanwhile, from its own frame times:
//   'page busy'   the frames stopped for most of the delay: the page itself was late (its main thread)
//   'host late'   the frames kept coming: the page was free, and the event arrived late (the host, WebView2 or the OS)
// Rows:
//   1  a key-up handled 2900 ms after its stamp, while frames ran every 16 ms, is kept as 'host late' and the HUD says so
//   2  a key-up handled 2900 ms late after a 2900 ms frame gap is kept as 'page busy'
//   3  an event on time (under 250 ms) is not kept and the HUD says nothing; one with no usable stamp (0, or no performance clock) is not kept either
//   4  the HUD line goes after 8 s; the log keeps the last 20
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const P = require(path.join(ADIR, 'preview', 'preview.js'));

function world({ clock = true } = {}) {
  const on = (t) => (k, f) => { (t[k] = t[k] || []).push(f); }, off = () => {};
  const winL = {}, canL = {}, docL = {};
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  let q = [], now = 1000;
  const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, addEventListener: on(docL), removeEventListener: off }, addEventListener: on(winL), removeEventListener: off,
    requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {}, ...(clock ? { performance: { now: () => now } } : {}) };
  const frame = (ms) => { now += ms; const f = q; q = []; for (const g of f) g(now); };
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener: on(canL), removeEventListener: off };
  const hud = { textContent: '' };
  const segs = [{ id: 'a', kind: 'road', length: 60, profile: require('../../test/geom_fixtures.js').FLAT }];
  const shell = { getState: () => ({ resolved: { segments: segs, closed: false } }), subscribe: () => () => {} };
  const p = P.createPreview({ canvas, shell, win, hud });
  frame(16); frame(16);
  const key = (type, e) => (winL[type] || []).forEach((f) => f({ preventDefault() {}, target: {}, ...e }));
  return { p, hud, key, frame, now: () => now, advance: (ms) => { now += ms; } };
}

test('row 1: a key-up handled 2.9 s after its stamp while the frames kept coming is kept as "host late", and the HUD says so', () => {
  const W = world(); W.key('keydown', { key: 'w', code: 'KeyW', timeStamp: W.now() }); W.frame(16);
  const stamped = W.now(); for (let i = 0; i < 181; i++) W.frame(16);   // 2.9 s of frames, every 16 ms
  W.key('keyup', { key: 'w', code: 'KeyW', timeStamp: stamped }); W.frame(16);
  const log = W.p.view().inputLate;
  assert.equal(log.length, 1, JSON.stringify(log)); assert.equal(log[0].type, 'keyup'); assert.equal(log[0].code, 'KeyW');
  assert.ok(Math.abs(log[0].lateMs - 2896) < 1, `late ${log[0].lateMs}`); assert.equal(log[0].cause, 'host late');
  assert.match(W.hud.textContent, /key-up KeyW came 2\.9 s late \(host late\)/);
});
test('row 2: a key-up handled 2.9 s late after a 2.9 s frame gap is kept as "page busy"', () => {
  const W = world(); W.key('keydown', { key: 'w', code: 'KeyW', timeStamp: W.now() }); W.frame(16);
  const stamped = W.now(); W.advance(2900);   // the main thread blocked: no frame
  W.key('keyup', { key: 'w', code: 'KeyW', timeStamp: stamped }); W.frame(16);
  const log = W.p.view().inputLate; assert.equal(log.length, 1); assert.equal(log[0].cause, 'page busy');
  assert.match(W.hud.textContent, /came 2\.9 s late \(page busy\)/);
});
test('row 3: an event on time is not kept and the HUD says nothing; one with no usable stamp is not kept', () => {
  const W = world(); W.key('keydown', { key: 'w', code: 'KeyW', timeStamp: W.now() - 100 }); W.frame(16); W.key('keyup', { key: 'w', code: 'KeyW', timeStamp: W.now() - 249 }); W.frame(16);
  W.key('keydown', { key: 'a', code: 'KeyA', timeStamp: 0 }); W.key('keyup', { key: 'a', code: 'KeyA' }); W.frame(16);
  assert.deepEqual(W.p.view().inputLate, []); assert.doesNotMatch(W.hud.textContent, /late/);
  const N = world({ clock: false }); N.key('keyup', { key: 'w', code: 'KeyW', timeStamp: 5 }); N.frame(16); assert.deepEqual(N.p.view().inputLate, []);
});
test('row 4: the HUD line goes after 8 s; the log keeps the last 20', () => {
  const W = world(); W.frame(16);
  for (let i = 0; i < 25; i++) { const s = W.now(); W.advance(400); W.key('keyup', { key: 'w', code: 'KeyW', timeStamp: s }); W.frame(16); }
  assert.equal(W.p.view().inputLate.length, 20); assert.match(W.hud.textContent, /late/);
  for (let i = 0; i < 520; i++) W.frame(16);   // 8.3 s
  assert.doesNotMatch(W.hud.textContent, /late/);
});
