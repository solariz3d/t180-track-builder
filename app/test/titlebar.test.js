// app/test/titlebar.test.js: the page's own title bar (app/titlebar.js). node --test app/test/titlebar.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { wireTitlebar } = require('../titlebar.js');

function fakeDoc() {
  const el = (id) => ({ id, hidden: true, title: '', onclick: null, attrs: {}, cls: new Set(),
    classList: { toggle(c, on) { if (on) this.o.cls.add(c); else this.o.cls.delete(c); } }, setAttribute(k, v) { this.attrs[k] = v; } });
  const els = {}; for (const id of ['winctl', 'win-min', 'win-max', 'win-close']) { els[id] = el(id); els[id].classList.o = els[id]; }
  return { els, getElementById: (id) => els[id] || null };
}
function fakeWin({ maximized = false, fail = null } = {}) {
  const calls = []; let m = maximized; let resized = null;
  const act = (name, fn) => async () => { calls.push(name); if (fail === name) throw new Error(`${name} refused`); if (fn) fn(); };
  return { calls, resize: () => resized && resized(), setMax: (v) => { m = v; },
    minimize: act('minimize'), toggleMaximize: act('toggleMaximize', () => { m = !m; }), close: act('close'), destroy: act('destroy'),
    isMaximized: async () => m, onResized: async (f) => { resized = f; return () => {}; } };
}

test('the X asks the window to close (so the close handler still runs) and never destroys it itself', async () => {
  const d = fakeDoc(), w = fakeWin(); await wireTitlebar(d, w);
  await d.els['win-close'].onclick();
  assert.deepEqual(w.calls, ['close']);
});

test('minimize and maximize reach the window, and maximize turns the glyph into restore and back', async () => {
  const d = fakeDoc(), w = fakeWin(); await wireTitlebar(d, w);
  assert.equal(d.els.winctl.hidden, false, 'the controls show inside the app');
  await d.els['win-min'].onclick(); assert.deepEqual(w.calls, ['minimize']);
  await d.els['win-max'].onclick(); assert.ok(d.els['win-max'].cls.has('restore')); assert.equal(d.els['win-max'].title, 'Restore');
  await d.els['win-max'].onclick(); assert.ok(!d.els['win-max'].cls.has('restore')); assert.equal(d.els['win-max'].title, 'Maximize');
});

test('a window maximized some other way (double-click, Win+Up) shows restore after the resize', async () => {
  const d = fakeDoc(), w = fakeWin(); await wireTitlebar(d, w);
  w.setMax(true); await w.resize();
  await new Promise((r) => setImmediate(r));
  assert.ok(d.els['win-max'].cls.has('restore'));
});

test('a window that opens maximized shows restore from the start', async () => {
  const d = fakeDoc(); await wireTitlebar(d, fakeWin({ maximized: true }));
  assert.ok(d.els['win-max'].cls.has('restore'));
});

test('outside the app (no window) the controls stay hidden and nothing is wired', async () => {
  const d = fakeDoc();
  assert.equal(await wireTitlebar(d, null), null);
  assert.equal(d.els.winctl.hidden, true); assert.equal(d.els['win-close'].onclick, null);
});

test('a refused window call is logged, not thrown, so the bar keeps working', async () => {
  const d = fakeDoc(), w = fakeWin({ fail: 'minimize' }), logs = []; await wireTitlebar(d, w, { log: (m) => logs.push(m) });
  await d.els['win-min'].onclick();
  assert.equal(logs.length, 1); assert.match(logs[0], /minimize refused/);
  await d.els['win-close'].onclick(); assert.deepEqual(w.calls, ['minimize', 'close']);
});

test('a page with no title bar markup is left alone', async () => {
  assert.equal(await wireTitlebar({ getElementById: () => null }, fakeWin()), null);
});

// D508 (the white flash at startup): the window is created hidden (tauri.conf.json "visible": false) and the page shows it itself, once its
// first frame has painted, so the white 1400 x 860 window WebView2 painted before the maximize is never seen. revealWindow(win, o)
const { revealWindow } = require('../titlebar.js');
/** frames and timers run by hand: frame() runs the waiting animation-frame callbacks, fire() the waiting timers */
function clock() {
  let frames = [], timers = [];
  return { raf: (f) => { frames.push(f); }, after: (f, ms) => { timers.push({ f, ms }); },
    frame: () => { const f = frames; frames = []; for (const x of f) x(); },
    fire: (ms) => { const t = timers.filter((x) => ms === undefined || x.ms === ms); timers = timers.filter((x) => !t.includes(x)); for (const x of t) x.f(); }, timers: () => timers };
}
function showWin({ fail = null } = {}) {
  const calls = [];
  const act = (name) => async () => { calls.push(name); if (fail === name) throw new Error(`${name} refused`); };
  return { calls, close: act('close'), maximize: act('maximize'), show: act('show'), setFocus: act('setFocus') };
}
const settle = () => new Promise((r) => setImmediate(r));

test('the window is shown after the page\'s second animation frame, not before, and then focused', async () => {
  const c = clock(), w = showWin(), done = revealWindow(w, c);
  await settle(); assert.deepEqual(w.calls, [], 'nothing before a frame');
  c.frame(); await settle(); assert.deepEqual(w.calls, [], 'nothing after one frame: it may not have painted yet');
  c.frame(); assert.equal(await done, 'frame');
  assert.deepEqual(w.calls, ['maximize', 'show', 'setFocus']);
});

test('the window is maximized BEFORE it is shown, so it appears at full size and never at its 1400 x 860 size', async () => {
  const c = clock(), w = showWin(); const done = revealWindow(w, c); c.frame(); c.frame(); await done;
  assert.ok(w.calls.indexOf('maximize') >= 0 && w.calls.indexOf('maximize') < w.calls.indexOf('show'), w.calls.join(', '));
});

test('a hidden page that gets no animation frames is shown after two 100 ms ticks, long before the fallback', async () => {
  const c = clock(), w = showWin(), done = revealWindow(w, c);
  c.fire(100); await settle(); assert.deepEqual(w.calls, [], 'one tick is one frame: not yet');
  c.fire(100); await settle();
  assert.deepEqual(w.calls, ['maximize', 'show', 'setFocus'], 'shown on the second tick (checked before awaiting, so a broken tick fails and never hangs)');
  assert.equal(await done, 'frame');
});

test('a reveal whose frames never come at all is shown anyway by the fallback timer, and only once', async () => {
  const c = clock(), w = showWin(), done = revealWindow(w, { ...c, fallbackMs: 3000 });
  assert.ok(c.timers().some((t) => t.ms === 3000), 'the fallback is set at once, before any frame');
  c.fire(3000); assert.equal(await done, 'fallback');
  assert.deepEqual(w.calls, ['maximize', 'show', 'setFocus']);
  c.frame(); c.frame(); c.fire(); await settle();
  assert.deepEqual(w.calls, ['maximize', 'show', 'setFocus'], 'frames and ticks that come late show nothing again');
});

test('a refused maximize still shows the window, and a refused show is logged, not thrown', async () => {
  const c = clock(), w = showWin({ fail: 'maximize' }), logs = []; const done = revealWindow(w, { ...c, log: (m) => logs.push(m) }); c.fire(); await done;
  assert.deepEqual(w.calls, ['maximize', 'show', 'setFocus']); assert.match(logs[0], /maximize refused/);
  const c2 = clock(), w2 = showWin({ fail: 'show' }), logs2 = []; const done2 = revealWindow(w2, { ...c2, log: (m) => logs2.push(m) }); c2.fire(); await done2;
  assert.match(logs2.join(' '), /show refused/);
});

test('outside the app (no window, or one that cannot be shown) nothing is scheduled', async () => {
  const c = clock();
  assert.equal(await revealWindow(null, c), null);
  assert.equal(await revealWindow({ close() {} }, c), null);
  assert.deepEqual(c.timers(), []);
});

test('the window is created hidden, maximized and dark, and its capability lets the page show, focus and maximize it', () => {
  const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..', '..', 'src-tauri');
  const w = JSON.parse(fs.readFileSync(path.join(root, 'tauri.conf.json'), 'utf8')).app.windows[0];
  assert.equal(w.visible, false, 'created hidden: no white window before the page paints');
  assert.equal(w.maximized, true, 'still maximized (0.4.25): applied when the page shows it');
  assert.match(String(w.backgroundColor), /^#0[0-9a-f]0[0-9a-f]0[0-9a-f]$/i, `a near-black background behind the page, not white: ${w.backgroundColor}`);
  const perms = fs.readdirSync(path.join(root, 'capabilities')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(root, 'capabilities', f), 'utf8')).permissions || []);
  for (const p of ['core:window:allow-show', 'core:window:allow-set-focus', 'core:window:allow-maximize']) assert.ok(perms.includes(p), `${p} is granted (without it the page's show is refused)`);
});
