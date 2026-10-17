// export-author.test.js: node --test app/test/export-author.test.js. D365, the app's half: Settings ▸ Author name is the saved key
// `author` (contract S), every export the page makes reads it (the exporter's author provider: Export, Test export and Install all
// build through the same exporter), Export layouts carries it into each layout, and a blocked store gives today's author without throwing.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../settings.js');
const MI = require('../menubar/items.js');
const C = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { close } = require('../../src/core/close.js');
const { makeExporter } = require('../export/export.js');
const { loadCjs } = require('../lib/cjs.js');
const { createShim } = require('../export/node-shim.js');
const { createLayoutsExport } = require('../menubar/layoutsexport.js');

const REPO = path.resolve(__dirname, '..', '..'), get = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const R = 180, Q = (Math.PI * R) / 2, TURN = 1 / R;
function lap(name, straight) {
  let d = extend(D.createDoc(name), { length: straight, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: TURN } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const memStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const blocked = { getItem() { throw new Error('SecurityError: blocked'); }, setItem() { throw new Error('QuotaExceededError'); } };
const LAP = lap('Authored Lap', 300);
const uiOf = (files, rel = 'ui/ui_track.json') => JSON.parse(Buffer.from(files.find((f) => f.path.endsWith(rel)).bytes).toString('utf8'));
async function exportedUi(author) {
  const sh = await C.createCoreShell({ exporter: await makeExporter(get, { author }), autosaveMs: 0 });
  sh.adopt(LAP);
  return uiOf(sh.buildExport({}).folders[0].files);
}

test('Settings keeps the author name under t180.settings.author; authorName trims it and refuses what is not a name', () => {
  assert.ok(S.KEYS.includes('author'));
  const store = memStore(), s = S.createSettings(store);
  assert.equal(MI.authorName(s), '', 'nothing saved: no name');
  s.set('author', 'Jane Doe');
  assert.equal(store.getItem('t180.settings.author'), '"Jane Doe"');
  assert.equal(MI.authorName(S.createSettings(store)), 'Jane Doe', 'kept for the next start');
  for (const [saved, want] of [['  Ann  ', 'Ann'], ['   ', ''], [42, ''], [true, ''], ['x'.repeat(70), 'x'.repeat(64)]]) { s.set('author', saved); assert.equal(MI.authorName(s), want, JSON.stringify(saved)); }
  assert.equal(MI.authorName({ get() { throw new Error('broken'); } }), '', 'a settings object that throws gives no name');
});

test('Settings ▸ Author name: the field shows the saved name, saves what is typed trimmed, and at most 64 characters', () => {
  const s = S.createSettings(memStore()); s.set('author', 'Saved Name');
  const made = [];
  const doc = { createElement: (tag) => { const e = { tag, children: [], attrs: {}, value: '', appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; } }; made.push(e); return e; } };
  const node = MI.authorField(doc, s), input = made.find((e) => e.tag === 'input');
  assert.equal(node.tag, 'label'); assert.equal(input.value, 'Saved Name'); assert.equal(input.maxLength, 64);
  input.value = '  New Name '; input.onchange(); assert.equal(s.get('author', ''), 'New Name');
  input.value = ''; input.onchange(); assert.equal(s.get('author', null), '', 'cleared: blank, so the export writes today\'s author');
});

test('every export the page makes reads the name: set gives that author with the credit tag; blank gives today\'s author', async () => {
  const s = S.createSettings(memStore());
  s.set('author', 'Jane Doe');
  let j = await exportedUi(() => MI.authorName(s));
  assert.equal(j.author, 'Jane Doe'); assert.ok(j.tags.includes('t180-track-builder'), `${j.tags}`);
  assert.equal(j.description, 'Built from equations by t180-track-builder.', 'the app\'s description still credits the builder');
  s.set('author', '');
  j = await exportedUi(() => MI.authorName(s));
  assert.equal(j.author, 't180-track-builder');
  j = await exportedUi(undefined);
  assert.equal(j.author, 't180-track-builder', 'no provider at all: today\'s author');
});

test('a blocked store gives today\'s author and nothing throws, and a provider that throws does not stop the export', async () => {
  const s = S.createSettings(blocked);
  assert.doesNotThrow(() => MI.authorName(s));
  assert.equal((await exportedUi(() => MI.authorName(s))).author, 't180-track-builder');
  assert.equal((await exportedUi(() => { throw new Error('settings gone'); })).author, 't180-track-builder');
});

test('Export layouts carries the name into every layout, with the credit tag', async () => {
  const docs = new Map([['eq-One', D.serialize(lap('One', 300))], ['eq-Two', D.serialize(lap('Two', 200))]]);
  const st = { listDocs: async () => [...docs.keys()], openDoc: async (n) => docs.get(n) };
  const shim = createShim(), layouts = await loadCjs('src/export/layouts.js', get, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
  const lx = createLayoutsExport({ C, layouts, shim, storage: st });
  const out = await lx.build([{ track: 'One', layout: 'one', name: 'Pair One', main: true }, { track: 'Two', layout: 'two', name: 'Pair Two' }], { name: 'Pair', author: 'Jane Doe' });
  for (const Lid of ['one', 'two']) { const j = uiOf(out.files, `ui/${Lid}/ui_track.json`); assert.equal(j.author, 'Jane Doe'); assert.ok(j.tags.includes('t180-track-builder')); }
  const plain = await lx.build([{ track: 'One', layout: 'one', name: 'Pair One', main: true }, { track: 'Two', layout: 'two', name: 'Pair Two' }], { name: 'Pair' });
  assert.equal(uiOf(plain.files, 'ui/one/ui_track.json').author, 't180-track-builder');
});
