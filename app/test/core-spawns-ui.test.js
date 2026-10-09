// core-spawns-ui.test.js: node --test app/test/core-spawns-ui.test.js
// THE "START & GRID" SECTION (app/core/spawnsui.js) and its preview layer (app/core/spawnslayer.js), on the small fake DOM the readout tests use
// (app/test/core-readout-display.test.js), driving the real shell on a closed bowl lap. The placement itself is tested in core-spawns.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { createCoreShell } = require('../core/coreshell.js');
const SPL = require('../core/spawnslayer.js');
const { PACK, T180 } = require('../../src/markers/layout.js');

const REPO = path.resolve(__dirname, '..', '..');
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
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth || 0, height: this.clientHeight || 0 }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return !!e.isRoot; }
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
const R = 180, Q = Math.PI * R / 2;
async function mounted() {
  const { doc } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 900; stage.clientHeight = 600; stage.isRoot = true;
  const root = doc.createElement('div'), s = await createCoreShell({ brushFn: null });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  s.close();
  const panel = require('../core/panel.js').mount(root, s);
  const by = (aria) => root.all().find((e) => e.attrs['aria-label'] === aria);
  const btn = (text) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const set = (aria, v) => { const f = by(aria); f.value = String(v); f.onchange(); };
  const tick = (on) => { const f = by('place the start by hand'); f.checked = on; f.onchange(); };
  return { s, root, panel, by, btn, set, tick, spawns: () => s.getState().history.present.spawns };
}

test('the section is there, unticked: the start is automatic and the hand controls are hidden', async () => {
  const P = await mounted();
  assert.ok(P.root.all().some((e) => e.tagName === 'H3' && e.textContent === 'Start & grid'));
  assert.equal(P.by('place the start by hand').checked, false);
  assert.match(P.by('how the start is placed').textContent, /Automatic/);
  assert.equal(P.spawns(), undefined);
});

test('ticking "place by hand" puts the line near the end of the first piece and the measured pack behind it, all on the road', async () => {
  const P = await mounted();
  P.tick(true);
  assert.deepEqual(P.spawns(), { line: { along: 285 }, grid: { count: PACK.count, rowGapM: PACK.rowGapM, colGapM: PACK.colGapM } });
  assert.match(P.by('how the start is placed').textContent, /Placed by hand/);
  assert.match(P.by('start and grid checks').textContent, /all on the road/);
});

test('the line box, the car count and the pack fields change the spawns, one undo step each', async () => {
  const P = await mounted();
  P.tick(true);
  P.set('start line metres into the first piece', 200);
  assert.equal(P.spawns().line.along, 200);
  P.set('grid cars', 12);
  assert.equal(P.spawns().grid.count, 12);
  P.set('pack width: metres between the two columns', 9);
  assert.equal(P.spawns().grid.colGapM, 9);
  P.s.undo();
  assert.equal(P.spawns().grid.colGapM, PACK.colGapM);
});

test('the pack cannot be condensed past a T-180: below the minimum the field takes the minimum', async () => {
  const P = await mounted();
  P.tick(true);
  P.set('pack length: metres along the road between two cars in a column', 2);
  assert.equal(P.spawns().grid.rowGapM, Math.round(PACK.rowGapMinM * 1e4) / 1e4);
  P.set('pack width: metres between the two columns', 1);
  assert.equal(P.spawns().grid.colGapM, Math.round(PACK.colGapMinM * 1e4) / 1e4);
  P.btn('Measured spacing').onclick();
  assert.deepEqual([P.spawns().grid.rowGapM, P.spawns().grid.colGapM], [PACK.rowGapM, PACK.colGapM]);
});

test('the hotlap goes on the selected piece, slides along it, says its speed at the line, and comes off again', async () => {
  const P = await mounted();
  P.tick(true);
  P.btn('Hotlap on selected piece').onclick();
  assert.equal(P.spawns().hotlap, undefined, 'nothing selected: nothing placed');
  assert.match(P.by('hotlap speed').textContent, /Select a piece first/);
  P.s.selectPiece(0);
  P.btn('Hotlap on selected piece').onclick();
  assert.deepEqual(P.spawns().hotlap, { piece: 'p1', along: 0 });
  P.set('hotlap metres into its piece', 40);
  assert.equal(P.spawns().hotlap.along, 40);
  assert.match(P.by('hotlap speed').textContent, /245 m to the line, reaching about \d+ km\/h/);
  P.btn('Remove hotlap').onclick();
  assert.equal(P.spawns().hotlap, undefined);
});

test('unticking goes back to automatic: the spawns field is removed', async () => {
  const P = await mounted();
  P.tick(true); P.tick(false);
  assert.equal(P.spawns(), undefined);
  assert.match(P.by('how the start is placed').textContent, /Automatic/);
});

test('the preview layer: a START line, one numbered box per grid slot from pole, the pits and the hotlap', async () => {
  const P = await mounted();
  P.tick(true); P.set('grid cars', 5); P.s.selectPiece(0); P.btn('Hotlap on selected piece').onclick();
  const items = SPL.marks(P.s.spawnsInfo());
  assert.equal(items.filter((i) => i.kind === 'line').length, 1);
  assert.deepEqual(items.filter((i) => i.kind === 'grid').map((i) => i.label), ['1', '2', '3', '4', '5']);
  assert.equal(items.filter((i) => i.kind === 'pit').length, 2);
  assert.match(items.find((i) => i.kind === 'hotlap').label, /HOTLAP · \d+ km\/h at the line/);
  assert.ok(items.every((i) => !i.bad));
});

test('a grid box is the measured T-180 on the road: 6.67 m along, 2.67 m across', () => {
  const m = { surface: [0, 0, 0], fwd: [0, 0, 1], left: [1, 0, 0] };
  const [a, b, , d] = SPL.slotCorners(m), dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  assert.ok(Math.abs(dist(a, b) - T180.widthM) < 1e-9);
  assert.ok(Math.abs(dist(a, d) - T180.lengthM) < 1e-9);
});

test('the panel still loads through the webview\'s loader, with no node built-in', async () => {
  const { loadCjs } = require('../lib/cjs.js');
  const P = await loadCjs('app/core/panel.js', async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));
  assert.equal(typeof P.mount, 'function');
});
