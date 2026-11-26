// core-landing-xsec-panel.test.js: node --test app/test/core-landing-xsec-panel.test.js
// D677 C1, THE LANDING'S CROSS-SECTION, the panel's half (the core's rows: test/core_landing_xsec.test.js, C-1 to C-6). After a bare flight the panel sends the
// typed width, cup, edges and edge start as `first` (as it does on an empty track, out.first), so Extend lays the landing AT them; the turn, climb and bank are not
// sent there (the landing starts level at its flight's bank). The plan: lighthouse exo_memory/loop/plan_t180_cross_section_2026-11-26.md (c), consumers panel.js :266, :295, :545.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const J = require('../../src/core/jump.js');
const { extend } = require('../../src/core/extend.js');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');

// ── a small fake DOM, as app/test/core-second-bank-panel.test.js has it ──
class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.parent = null; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  get isConnected() { return false; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}
function fakeWindow() {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} };
  doc.defaultView = win;
  return { doc, win };
}

const BLANK = { length: 60, turn: '', climb: '', bank: '', width: '', cup: '', edge: '', edgeR: '', start: '', tube: '' };

test('C-2 (panel): after a bare flight, the typed width, cup, edges and edge start go in as `first`; nothing typed sends no first', () => {
  assert.deepEqual(extendOptions({ ...BLANK, width: '18', cup: '70', edge: '3', edgeR: '9', start: '0.85', afterFlight: true }).first, { w: 18, c: 70, e: 3, er: 9, s: 0.85 });
  assert.deepEqual(extendOptions({ ...BLANK, width: '18', afterFlight: true }).first, { w: 18 }, 'the width alone');
  assert.equal(extendOptions({ ...BLANK, afterFlight: true }).first, undefined, 'nothing typed: the take-off\'s carries, as before');
});

test('C-4 (panel): after a flight the turn, climb and bank typed are targets only, never the landing\'s start (it starts level at the flight\'s bank)', () => {
  const o = extendOptions({ ...BLANK, turn: '10', climb: '2', bank: '5', width: '18', afterFlight: true });
  assert.deepEqual(o.first, { w: 18 });
  assert.ok(o.targets.kh !== undefined && o.targets.kv !== undefined && o.targets.phi !== undefined, 'control: they are still the piece\'s targets');
});

test('C-2 (panel): on a track that does not end in a flight, nothing changes: no first after road; an empty track sends every typed target, as before', () => {
  assert.equal(extendOptions({ ...BLANK, width: '18' }).first, undefined);
  assert.deepEqual(extendOptions({ ...BLANK, width: '18', bank: '5', empty: true }).first, { w: 18, phi: 5 * Math.PI / 180 });
});

test('C-2 (panel): the mounted panel, after a bare flight, lays the landing AT the typed width (the shell\'s Extend), not a ramp from the take-off\'s 26 m', async () => {
  const { doc } = fakeWindow();
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  shell.commitDoc(J.jump(extend(D.createDoc('landing'), { length: 200, family: 'bowl', first: { w: 26 } }), { forward: 40, bank: 0.05 }));
  require('../core/panel.js').mount(root, shell);
  const field = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text).children[1];
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); };
  type('length m', 60); type('width m', 18);
  root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === 'Extend').onclick();
  const pieces = shell.getState().history.present.pieces, L = pieces[pieces.length - 1];
  assert.equal(pieces.length, 3, 'the landing was laid');
  assert.equal(L.channels.w[0], 18, 'the landing starts at the width typed');
  assert.equal(L.channels.phi[0], 0.05, 'at the flight\'s bank');
});

test('C-2 (panel): after a bare flight, a later width change is asked of the core with the landing\'s TYPED start, exactly as on an empty track (no first ramp moving under it)', () => {
  const asked = (more) => { const seen = []; extendOptions({ ...BLANK, length: 300, width: '18', head: { w: 26 }, changes: { width: [{ then: '30', from: '' }] }, secondMinM: (c, a, b, base) => { seen.push(base || null); return 40; }, ...more }); return seen; };
  const empty = asked({ empty: true }), after = asked({ afterFlight: true });
  assert.ok(empty.length > 0, 'control: the core was asked');
  assert.deepEqual(after, empty);
  assert.notDeepEqual(asked({}), empty, 'control: after road the head\'s 26 m is the ramp\'s start');
});
