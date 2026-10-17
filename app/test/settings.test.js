// settings.test.js: node --test app/test/settings.test.js
// D355 contract S, app/settings.js: the six settings that used to reset at every start are saved. Rows:
//   1  a setting survives a reload (a fresh settings object over the same store), saved as t180.settings.<key> in JSON, and nothing else is written
//   2  nothing saved, or saved text that is not JSON: the fallback
//   3  a store that throws on every read and write (a blocked localStorage), or none at all: nothing throws, and the value lasts the session
//   4  on(key) hears each change of that key once, not a set to the same value, not another key; the function it returns stops it
//   5  an unknown key, or a value that is not a boolean, a finite number or a string, is refused by name
//   6  two copies of the module (app/lib/cjs.js loads a fresh copy per call) share one instance: a set through one is read, and heard, through the other
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const S = require('../settings.js');

/** a localStorage stand-in: a Map behind getItem / setItem */
const memStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };

test('row 1: a setting survives a reload, saved as t180.settings.<key> in JSON, and nothing else is written', () => {
  const store = memStore();
  store.setItem('t180.sound.muted', '1'); store.setItem('t180.coreLook', 'solid');   // the keys saved before D355
  const a = S.createSettings(store);
  a.set('turnClimbAs', 'rate'); a.set('gridStep', 45); a.set('mirrorOnInsert', true); a.set('csp', false);
  const b = S.createSettings(store);   // the next start
  assert.equal(b.get('turnClimbAs', 'corner'), 'rate'); assert.equal(b.get('gridStep', 90), 45); assert.equal(b.get('mirrorOnInsert', false), true); assert.equal(b.get('csp', true), false);
  assert.equal(store.getItem('t180.settings.gridStep'), '45'); assert.equal(store.getItem('t180.settings.turnClimbAs'), '"rate"');
  assert.deepEqual([...store.m.keys()].sort(), ['t180.coreLook', 't180.settings.csp', 't180.settings.gridStep', 't180.settings.mirrorOnInsert', 't180.settings.turnClimbAs', 't180.sound.muted']);
  assert.equal(store.getItem('t180.sound.muted'), '1'); assert.equal(store.getItem('t180.coreLook'), 'solid');
  // AMENDED (D365): the rule changed by name: a seventh setting, author (Settings ▸ Author name), joins the six
  assert.deepEqual([...S.KEYS].sort(), ['author', 'colourByGrip', 'csp', 'dragHandles', 'gridStep', 'mirrorOnInsert', 'turnClimbAs']);
});

test('row 2: nothing saved, or saved text that is not JSON, gives the fallback', () => {
  const store = memStore(), s = S.createSettings(store);
  assert.equal(s.get('dragHandles', true), true); assert.equal(s.get('colourByGrip', false), false);
  store.setItem('t180.settings.gridStep', 'ninety');
  assert.equal(S.createSettings(store).get('gridStep', 90), 90);
});

test('row 3: a store that throws on every read and write, or none at all, throws nothing, and the value lasts the session', () => {
  const blocked = { getItem() { throw new Error('SecurityError: blocked'); }, setItem() { throw new Error('QuotaExceededError'); } };
  for (const store of [blocked, null]) {
    const s = S.createSettings(store);
    assert.equal(s.get('csp', true), true);
    assert.doesNotThrow(() => s.set('csp', false));
    assert.equal(s.get('csp', true), false, 'kept for the session');
  }
  // the shared instance where READING localStorage itself throws (a sandboxed frame)
  const ctx = { module: { exports: {} } }; Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('SecurityError: no storage'); } });
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8')}\n;module.exports`, ctx);
  const M = ctx.module.exports;
  assert.doesNotThrow(() => M.set('gridStep', 15)); assert.equal(M.get('gridStep', 90), 15);
});

test('row 4: on(key) hears each change of that key once, not a set to the same value, not another key; its return stops it', () => {
  const s = S.createSettings(memStore()), heard = [];
  const off = s.on('dragHandles', (v, k) => heard.push([k, v]));
  s.set('dragHandles', false); s.set('dragHandles', false); s.set('colourByGrip', true); s.set('dragHandles', true);
  assert.deepEqual(heard, [['dragHandles', false], ['dragHandles', true]]);
  off(); s.set('dragHandles', false);
  assert.equal(heard.length, 2);
});

test('row 5: an unknown key, or a value that is not a boolean, a finite number or a string, is refused by name', () => {
  const s = S.createSettings(memStore());
  assert.throws(() => s.get('gridstep', 90), /SETTINGS_KEY: "gridstep"/);
  assert.throws(() => s.set('volume', 1), /SETTINGS_KEY/);
  assert.throws(() => s.on('nope', () => {}), /SETTINGS_KEY/);
  for (const bad of [undefined, null, NaN, Infinity, {}, [], () => {}]) assert.throws(() => s.set('gridStep', bad), /SETTINGS_VALUE/, String(bad));
  assert.throws(() => s.on('csp', 'not a function'), /SETTINGS_LISTENER/);
});

test('row 6: two copies of the module share one instance: a set through one is read, and heard, through the other', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8'), store = memStore();
  const page = vm.createContext({ localStorage: store });   // one window, as the webview's: each copy is a fresh module function run in it, as cjs.js runs one
  const copy = () => vm.runInContext(`(function () { const module = { exports: {} }; ${src}\n; return module.exports; })()`, page);
  const one = copy(), two = copy(), heard = [];
  two.on('colourByGrip', (v) => heard.push(v));
  one.set('colourByGrip', true);
  assert.equal(two.get('colourByGrip', false), true); assert.deepEqual(heard, [true]);
  assert.equal(store.getItem('t180.settings.colourByGrip'), 'true');
});
