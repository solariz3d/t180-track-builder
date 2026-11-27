// core-right-width-panel.test.js: node --test app/test/core-right-width-panel.test.js
// D677 (b), THE RIGHT WIDTH, the panel's half (the core's rows: test/core_right_width.test.js). "right width m" is typed as the right side's own width; the panel
// sends it as wd, its difference from the width in force (the typed width, else the head's; at a change's mark, the width's own change there), so blank follows the
// width and the width typed alone moves both sides. The plan: lighthouse exo_memory/loop/plan_t180_cross_section_2026-11-26.md (b), consumers panel.js :71-72, :173, :205, :366.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
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

const BLANK = { length: 100, turn: '', climb: '', bank: '', width: '', cup: '', edge: '', edgeR: '', widthR: '', start: '', tube: '' };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} against ${b}`);

test('a right width typed alone is sent as its difference from the head\'s width; with the width typed, from the typed one; blank sends none', () => {
  const a = extendOptions({ ...BLANK, widthR: '22.6', head: { w: 19.1 } });
  near(a.targets.wd, 3.5, 'from the head'); assert.equal(a.targets.w, undefined, 'the width is not sent');
  near(extendOptions({ ...BLANK, width: '25', widthR: '28', head: { w: 19.1 } }).targets.wd, 3, 'from the typed width');
  assert.equal(extendOptions({ ...BLANK, width: '25', head: { w: 19.1 } }).targets.wd, undefined, 'blank: the right side follows the width');
});

test('a right width with no width to measure it from is refused by name', () => {
  assert.throws(() => extendOptions({ ...BLANK, widthR: '22.6' }), /BAD_RIGHT_WIDTH/);
});

test('a right width\'s change is sent against the width in force at its mark: the width\'s own change there, else its target', () => {
  const o = extendOptions({ ...BLANK, length: 300, width: '19.1', widthR: '22.6', head: { w: 19.1 }, changes: { width: [{ then: '30', from: '150' }], widthR: [{ then: '30', from: '200' }] } });
  assert.deepEqual(o.changes.w, [{ from: 150, target: 30 }]);
  assert.equal(o.changes.wd.length, 1); assert.equal(o.changes.wd[0].from, 200); near(o.changes.wd[0].target, 0, 'at 200 m the width is 30, so a right width of 30 is wd 0');
  const p = extendOptions({ ...BLANK, length: 300, width: '19.1', widthR: '22.6', head: { w: 19.1 }, changes: { widthR: [{ then: '24', from: '200' }] } });
  near(p.changes.wd[0].target, 24 - 19.1, 'no width change: against the width\'s target');
});

test('the right width at the start: its ramp is the width\'s own early ramp', () => {
  const o = extendOptions({ ...BLANK, length: 300, width: '19.1', widthR: '22.6', head: { w: 19.1 }, atStart: { width: true, widthR: true } });
  assert.equal(o.transition.wd, o.transition.w);
  assert.deepEqual(o.startShapes.wd, o.startShapes.w);
});

test('the mounted panel: "right width m" shows the head\'s right width, and typed it lays a piece whose right side has its own width; the width typed alone keeps the step', async () => {
  const { doc } = fakeWindow();
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  shell.commitDoc(extend(D.createDoc('right width'), { length: 200, family: 'bowl', first: { w: 19.1 } }));
  require('../core/panel.js').mount(root, shell);
  const field = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text).children[1];
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); };
  const press = () => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === 'Extend').onclick();
  assert.equal(Number(field('right width m').value), 19.1, 'the head: both sides one width');
  type('length m', 100); type('right width m', 22.6); press();
  let ps = shell.getState().history.present.pieces, L = ps[ps.length - 1];
  assert.equal(L.split, true, 'split'); near(D.pieceEnd(L).wd.v, 3.5, 'wd at the end'); near(D.pieceEnd(L).w.v, 19.1, 'the width kept');
  assert.equal(Number(field('right width m').value), 22.6, 'the field shows the head\'s right width');
  type('length m', 100); type('width m', 25); press();
  ps = shell.getState().history.present.pieces; L = ps[ps.length - 1];
  near(D.pieceEnd(L).w.v, 25, 'the width'); near(D.pieceEnd(L).wd.v, 3.5, 'the step kept: the right side follows the width');
});
