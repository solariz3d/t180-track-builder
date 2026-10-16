// inputlog.test.js: node --test app/test/inputlog.test.js
// D340, the late-input log on disk (plan :904-909): the camera's ~3 s coast happens mid-drive, so the late key events checkLate finds (app/preview/preview.js)
// also go to a file, to be read afterwards rather than off the HUD. The preview hands each record to its mount (onInputLate); the page buffers them
// (app/core/inputlog.js) and appends them, asynchronously and never on the key's own path, through the native append_input_log (src-tauri/src/lib.rs), into
// input-late.log in the app's data folder beside tracks\, capped in size there. A failed write is reported, never thrown. Rows:
//   1  through the real preview: a late key-up gives exactly one log line with its fields (time, type, key, lateMs, cause, frameGapMs); an on-time one gives none
//   2  nothing is written on the key's path: add() only schedules; the write happens when the scheduled flush runs
//   3  lines that arrive while a write is in flight go in the next write, in order; past maxPending the oldest are dropped, and the next write says how many
//   4  a write that fails (rejects or throws) is reported to onError and the log goes on; nothing throws out of add()
//   5  the wiring: the preview mount raises 't180:input-late', the page appends it through append_input_log, and the native command is registered and runs off
//      the main thread (#[tauri::command(async)])
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const P = require(path.join(ADIR, 'preview', 'preview.js'));
const IL = require(path.join(ADIR, 'core', 'inputlog.js'));

function world(onInputLate) {
  const on = (t) => (k, f) => { (t[k] = t[k] || []).push(f); }, off = () => {};
  const winL = {}, docL = {}, canL = {};
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  let q = [], now = 1000;
  const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, addEventListener: on(docL), removeEventListener: off }, addEventListener: on(winL), removeEventListener: off,
    requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {}, performance: { now: () => now } };
  const frame = (ms) => { now += ms; const f = q; q = []; for (const g of f) g(now); };
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener: on(canL), removeEventListener: off };
  const segs = [{ id: 'a', kind: 'road', length: 60, profile: require('../../test/geom_fixtures.js').FLAT }];
  const shell = { getState: () => ({ resolved: { segments: segs, closed: false } }), subscribe: () => () => {} };
  const p = P.createPreview({ canvas, shell, win, onInputLate });
  frame(16); frame(16);
  const key = (type, e) => (winL[type] || []).forEach((f) => f({ preventDefault() {}, target: {}, ...e }));
  return { p, key, frame, now: () => now };
}
/** A log whose scheduled flushes run when the test says (run()), with a recording write. */
function rig(opts = {}) {
  const tasks = [], writes = [], errors = [];
  const log = IL.createInputLog({ write: opts.write || ((text) => { writes.push(text); return Promise.resolve(); }), schedule: (f) => tasks.push(f), now: () => new Date(Date.UTC(2026, 9, 16, 15, 30, 0, 123)), onError: (e) => errors.push(String(e && e.message || e)), ...opts.more });
  const run = async () => { while (tasks.length) { tasks.shift()(); await new Promise((r) => setImmediate(r)); } };
  return { log, tasks, writes, errors, run };
}
const lines = (writes) => writes.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('row 1: through the real preview, a late key-up gives exactly one log line with its fields, and an on-time one gives none', async () => {
  const R = rig(), W = world((rec) => R.log.add(rec));
  W.key('keydown', { key: 'w', code: 'KeyW', timeStamp: W.now() }); W.frame(16);
  W.key('keyup', { key: 'w', code: 'KeyW', timeStamp: W.now() - 40 }); W.frame(16);   // on time: none
  W.key('keydown', { key: 'a', code: 'KeyA', timeStamp: W.now() }); W.frame(16);
  const stamped = W.now(); for (let i = 0; i < 181; i++) W.frame(16);
  W.key('keyup', { key: 'a', code: 'KeyA', timeStamp: stamped }); W.frame(16);   // 2.9 s late while the frames ran: host late
  await R.run();
  const L = lines(R.writes);
  assert.equal(L.length, 1, JSON.stringify(L));
  assert.deepEqual(Object.keys(L[0]), ['time', 'type', 'key', 'lateMs', 'cause', 'frameGapMs']);
  assert.deepEqual(L[0], { time: '2026-10-16T15:30:00.123Z', type: 'keyup', key: 'KeyA', lateMs: 2896, cause: 'host late', frameGapMs: 16 });
});
test('row 2: nothing is written on the key\'s path: add() only schedules, and the write happens when the flush runs', async () => {
  const R = rig(); R.log.add({ type: 'keyup', code: 'KeyW', lateMs: 900, cause: 'host late', longestFrameGapMs: 16 });
  assert.equal(R.writes.length, 0, 'not written inside add()'); assert.equal(R.tasks.length, 1, 'one flush scheduled');
  R.log.add({ type: 'keyup', code: 'KeyA', lateMs: 901, cause: 'host late', longestFrameGapMs: 16 }); assert.equal(R.tasks.length, 1, 'still one flush for both');
  await R.run(); assert.equal(R.writes.length, 1, 'one write'); assert.deepEqual(lines(R.writes).map((l) => l.key), ['KeyW', 'KeyA']);
});
test('row 3: lines arriving during a write go in the next one, in order; past maxPending the oldest are dropped and the next write says how many', async () => {
  let release; const writes = [];
  const R = rig({ write: (t) => { writes.push(t); return new Promise((r) => { release = r; }); }, more: { maxPending: 3 } });
  R.log.add({ type: 'keyup', code: 'K1', lateMs: 300, cause: 'host late', longestFrameGapMs: 1 }); await R.run();
  for (const k of ['K2', 'K3', 'K4', 'K5', 'K6']) R.log.add({ type: 'keyup', code: k, lateMs: 300, cause: 'host late', longestFrameGapMs: 1 });   // while K1's write is in flight
  await R.run(); assert.equal(writes.length, 1, 'one write in flight at a time, even when a scheduled flush runs meanwhile');
  release(); await new Promise((r) => setImmediate(r)); await R.run(); release && release(); await new Promise((r) => setImmediate(r));
  assert.equal(writes.length, 2); const second = writes[1].split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(second[0], { dropped: 2 }, 'the two oldest of the five were dropped, and said'); assert.deepEqual(second.slice(1).map((l) => l.key), ['K4', 'K5', 'K6']);
});
test('row 4: a write that rejects or throws is reported to onError, and the log goes on; nothing throws out of add()', async () => {
  let n = 0; const R = rig({ write: () => { n++; if (n === 1) return Promise.reject(new Error('disk full')); if (n === 2) throw new Error('no native side'); return Promise.resolve(); } });
  assert.doesNotThrow(() => R.log.add({ type: 'keyup', code: 'K1', lateMs: 300, cause: 'host late', longestFrameGapMs: 1 })); await R.run();
  R.log.add({ type: 'keyup', code: 'K2', lateMs: 300, cause: 'host late', longestFrameGapMs: 1 }); await R.run();
  R.log.add({ type: 'keyup', code: 'K3', lateMs: 300, cause: 'host late', longestFrameGapMs: 1 }); await R.run();
  assert.deepEqual(R.errors, ['disk full', 'no native side']); assert.equal(n, 3, 'the third write went ahead');
});
test('row 5: the wiring: the mount raises t180:input-late, the page appends it through append_input_log, and the native command is registered and async', () => {
  const idx = fs.readFileSync(path.join(ADIR, 'preview', 'index.js'), 'utf8'), html = fs.readFileSync(path.join(ADIR, 'index.html'), 'utf8');
  const rs = fs.readFileSync(path.join(ADIR, '..', 'src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.match(idx, /onInputLate: \(r\) => doc\.dispatchEvent\(new win\.CustomEvent\('t180:input-late'/);
  assert.match(html, /addEventListener\('t180:input-late'/); assert.match(html, /call\('append_input_log', \{ text \}\)/);
  assert.match(rs, /#\[tauri::command\(async\)\]\s*\nfn append_input_log\(/, 'off the main thread (Tauri v2: a plain command runs on the main thread)');
  assert.match(rs, /generate_handler!\[[^\]]*\bappend_input_log\b/);
});
