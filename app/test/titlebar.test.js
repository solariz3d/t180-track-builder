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
