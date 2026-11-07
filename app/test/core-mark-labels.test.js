// core-mark-labels.test.js: node --test app/test/core-mark-labels.test.js
// L154 (pane C), option C of exo_memory/loop/plan_l154_extra_bank_mark_explains_itself_2026-11-07.md. The user, 2026-11-07 11:35Z, driving l153-test: "it works, and is good, the
// only problem is UI"; his file name: "THE extra banking length drag needs to be more understood wtf it is doing i figured it out but i bet new users will hate it"; 11:37Z: "when you
// move the mouse right and left when clicking the point i marked, it drags the other point up and down the track, defintelly needs labels".
//   - an extra change's tick carries a LABEL: "Extra bank · <from> m → end · rolls over <L − from> m · drag to start earlier or later" (turn: turns, climb: climbs);
//   - the STRETCH from the tick to where that change ends (the next mark, or the piece's end) is tinted in the field's colour;
//   - the extra handle's hover names its sideways drag ("drag ← → along the road: move where the extra bank starts · now <from> m");
//   - while that handle is hovered or dragged, its tick and stretch are LIT.
// Each follows the from. The REAL core and panel (fake DOM), the handles' and the marks' own pure functions.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const HD = require('../core/handles.js');
const ST = require('../core/secondtick.js');

class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.parent = null; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f, o) { (this.listeners[e] = this.listeners[e] || []).push({ f, capture: !!(o === true || (o && o.capture)) }); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x.f !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth || 0, height: this.clientHeight || 0 }; }
  get isConnected() { return false; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
  fire(type, init) { let stopped = false; const ev = { type, button: 0, ...init, preventDefault() {}, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; } };
    const ls = (this.listeners[type] || []).slice(), order = ls.filter((l) => l.capture).concat(ls.filter((l) => !l.capture));
    for (const l of order) { if (stopped) break; l.f(ev); } }
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
// withStage: a #preview, so the panel mounts its handles (their hover is read for the lit tick)
async function mountPanel({ withStage = false } = {}) {
  const { doc, win } = fakeWindow();
  if (withStage) { const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 900; stage.clientHeight = 600; }
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  const panel = require('../core/panel.js').mount(root, shell);
  const field = (text) => { const l = root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text); assert.ok(l, `the panel has no "${text}" field`); return l.children[1]; };
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); };
  type('length m', 100);
  return { doc, win, root, shell, panel, type, extras: () => panel.extraHandles(), mark: (f) => panel.marksAt().find((m) => m.field === f) };
}
// his good piece (B's confirmed inputs): 1,000 m, corner −90, bank +50, the extra bank to 0 (at 500 m: no extra turn)
const good = async (o) => { const p = await mountPanel(o); p.type('length m', 1000); p.type('turn °', -90); p.type('bank °', 50); p.panel.secondExtra(p.extras().find((e) => e.field === 'bank').id, 0); return p; };

test('L154 C1: the extra bank\'s tick is labelled with where it starts, where it ends and how long it rolls: "Extra bank · 500.00 m → end · rolls over 500.00 m · drag to start earlier or later"', async () => {
  const p = await good();
  const m = p.mark('bank');
  assert.equal(m.from, 500);
  assert.equal(m.label, 'Extra bank · 500.00 m → end · rolls over 500.00 m · drag to start earlier or later');
  p.panel.unmount();
});

test('L154 C2: the label follows the from: slid by its handle to 420 m, and dragged by its tick to 640.5 m', async () => {
  const p = await good();
  p.panel.secondSlide('extra:bank:0', 420);
  assert.equal(p.mark('bank').label, 'Extra bank · 420.00 m → end · rolls over 580.00 m · drag to start earlier or later', 'slid sideways by the handle');
  p.panel.secondDrag({ field: 'bank', index: 0 }, 640.5);
  assert.equal(p.mark('bank').label, 'Extra bank · 640.50 m → end · rolls over 359.50 m · drag to start earlier or later', 'dragged along by the tick');
  p.panel.unmount();
});

test('L154 C3: the stretch the tick tints runs from its from to the piece\'s end (the next change\'s mark when there is one), and follows the from', async () => {
  const p = await good();
  let m = p.mark('bank'); assert.equal(m.from, 500); assert.equal(m.to, 1000, 'to the piece\'s end');
  p.panel.secondSlide('extra:bank:0', 420);
  m = p.mark('bank'); assert.equal(m.from, 420); assert.equal(m.to, 1000);
  p.type('length m', 2000);
  m = p.mark('bank'); assert.equal(m.from, 840, 'kept as its share'); assert.equal(m.to, 2000, 'the new end');
  // a second change of the same field: the first's stretch ends at the second's mark
  p.panel.secondAdd('bank', { then: '20', from: '1500' });
  const ms = p.panel.marksAt().filter((x) => x.field === 'bank');
  assert.equal(ms.length, 2); assert.equal(ms[0].to, 1500, 'the first ends where the second starts'); assert.equal(ms[1].to, 2000);
  assert.equal(ms[0].label, 'Extra bank · 840.00 m → 1500.00 m · rolls over 660.00 m · drag to start earlier or later');
  assert.equal(ms[1].label, 'Extra bank 2 · 1500.00 m → end · rolls over 500.00 m · drag to start earlier or later');
  p.panel.unmount();
});

test('L154 C4: the stretch on the ghost: its first station is the tick\'s, its last the stretch\'s end, the road\'s full width across', () => {
  const samples = []; for (let s = 200; s <= 1200; s += 2) samples.push({ s, pos: [0, 0, s - 200], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] });
  const ghost = { samples, s0: 200 };
  const strip = ST.stretchStrip(ghost, { from: 500, to: 1000, half: 10, halfTo: 15 });
  assert.equal(strip[0].s, 700); assert.equal(strip.at(-1).s, 1200);
  assert.deepEqual(strip[0].a, [-10, 0, 500]); assert.deepEqual(strip[0].b, [10, 0, 500], 'the half width at the tick');
  assert.deepEqual(strip.at(-1).b, [15, 0, 1000], 'and at the end');
  const moved = ST.stretchStrip(ghost, { from: 420, to: 1000, half: 10, halfTo: 10 });
  assert.equal(moved[0].s, 620, 'follows the from');
  assert.equal(ST.stretchStrip(ghost, { from: 500, half: 10 }), null, 'no end: nothing tinted');
});

test('L154 C5: turn and climb share the path: their ticks read "Extra turn · … · turns over …" and "Extra climb · … · climbs over …"', async () => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('turn °', -90); p.type('climb °', 4);
  p.panel.secondExtra(p.extras().find((e) => e.field === 'turn').id, 180);
  p.panel.secondExtra(p.extras().find((e) => e.field === 'climb').id, 0);
  assert.equal(p.mark('turn').label, 'Extra turn · 500.00 m → end · turns over 500.00 m · drag to start earlier or later');
  assert.equal(p.mark('climb').label, `Extra climb · ${p.mark('climb').from.toFixed(2)} m → end · climbs over ${(1000 - p.mark('climb').from).toFixed(2)} m · drag to start earlier or later`);
  p.panel.unmount();
});

test('L154 C6: the extra handle\'s hover names its sideways drag and where it starts now, and follows the from; a field\'s own handle has no such line', () => {
  const across = { dx: 1, dy: 0.2, len: 3 }, upright = { dx: 0.1, dy: -1, len: 3 };
  assert.equal(HD.slideWords('extra:bank:0', 500, across), 'drag ← → along the road: move where the extra bank starts · now 500.00 m');
  assert.equal(HD.slideWords('extra:bank:0', 420, across), 'drag ← → along the road: move where the extra bank starts · now 420.00 m', 'follows the from');
  assert.equal(HD.slideWords('extra:bank:0', 500, upright), 'drag ↑ ↓ along the road: move where the extra bank starts · now 500.00 m', 'the road running up the screen');
  assert.equal(HD.slideWords('extra:turnDeg:0', 500, across), 'drag ← → along the road: move where the extra turn starts · now 500.00 m');
  assert.equal(HD.slideWords('bank', 500, across), '', 'the bank\'s own handle has no slide');
});

test('L154 C7: the handles tell which handle is hovered or dragged (active), so the panel can light its tick', () => {
  const { doc, win } = fakeWindow(); const stage = doc.createElement('div'); stage.clientWidth = 900; stage.clientHeight = 600; stage.style = {};
  const samples = []; for (let s = 0; s <= 1000; s += 2) samples.push({ s, pos: [0, 0, s], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] });
  const pose = { eye: [0, 260, 340], target: [0, 0, 600], up: [0, 1, 0], fov: Math.PI / 3 }, kind = 'extra:bank:0';
  let rafCb = null; win.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  const host = { model: () => ({ mode: 'extend', samples, s0: 0, s1: 1000, half: () => 10, kinds: [kind], at: { [kind]: 0.6 }, base: () => 30, ctx: () => ({ half: 10, snapTo: [0] }), slideBase: () => 600 }),
    pose: () => pose, begin() {}, apply() {}, slide() {}, end() {} };
  const H = HD.mount(stage, win, host); if (rafCb) rafCb(0);
  const h = H.handles().find((x) => x.kind === kind && x.side === 1 && x.screen); assert.ok(h);
  assert.equal(H.active(), null, 'nothing hovered');
  stage.fire('pointermove', { clientX: h.screen.x, clientY: h.screen.y, pointerId: 1, timeStamp: 1 });
  assert.equal(H.active() && H.active().kind, kind, 'hovered');
  stage.fire('pointerdown', { clientX: h.screen.x, clientY: h.screen.y, pointerId: 1, timeStamp: 2 });
  stage.fire('pointermove', { clientX: h.screen.x + 30, clientY: h.screen.y, pointerId: 1, timeStamp: 40 });
  assert.equal(H.active() && H.active().kind, kind, 'dragged');
  stage.fire('pointerup', { clientX: h.screen.x + 30, clientY: h.screen.y, pointerId: 1, timeStamp: 80 });
  H.unmount();
});

test('L154 C8: in the panel, the extra bank\'s tick is lit while its handle is hovered or dragged, and only then', async () => {
  const p = await good({ withStage: true });
  assert.ok(p.panel.handles, 'the handles are mounted');
  assert.equal(p.mark('bank').lit, false, 'not lit');
  p.panel.handles.active = () => ({ kind: 'extra:bank:0' });
  assert.equal(p.mark('bank').lit, true, 'lit while its handle is active');
  p.panel.handles.active = () => ({ kind: 'bank' });
  assert.equal(p.mark('bank').lit, false, 'the bank\'s own handle does not light it');
  p.panel.unmount();
});
