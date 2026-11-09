// core-mark-labels.test.js: node --test app/test/core-mark-labels.test.js
// The user, 2026-11-07 11:35Z, driving a test build: "it works, and is good, the
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
const M = require('../camera/math.js');

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
// his good piece (the confirmed inputs): 1,000 m, corner −90, bank +50, the extra bank to 0 (at 500 m: no extra turn)
const good = async (o) => { const p = await mountPanel(o); p.type('length m', 1000); p.type('turn °', -90); p.type('bank °', 50); p.panel.secondExtra(p.extras().find((e) => e.field === 'bank').id, 0); return p; };

test('C1: the extra bank\'s tick is labelled with where it starts, where it ends and how long it rolls: "Extra bank · 500.00 m → end · rolls over 500.00 m · drag to start earlier or later"', async () => {
  const p = await good();
  const m = p.mark('bank');
  assert.equal(m.from, 500);
  assert.equal(m.label, 'Extra bank · 500.00 m → end · rolls over 500.00 m · drag to start earlier or later');
  p.panel.unmount();
});

test('C2: the label follows the from: slid by its handle to 420 m, and dragged by its tick to 640.5 m', async () => {
  const p = await good();
  p.panel.secondSlide('extra:bank:0', 420);
  assert.equal(p.mark('bank').label, 'Extra bank · 420.00 m → end · rolls over 580.00 m · drag to start earlier or later', 'slid sideways by the handle');
  p.panel.secondDrag({ field: 'bank', index: 0 }, 640.5);
  assert.equal(p.mark('bank').label, 'Extra bank · 640.50 m → end · rolls over 359.50 m · drag to start earlier or later', 'dragged along by the tick');
  p.panel.unmount();
});

test('C3: the stretch the tick tints runs from its from to the piece\'s end (the next change\'s mark when there is one), and follows the from', async () => {
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

test('C4: the stretch on the ghost: its first station is the tick\'s, its last the stretch\'s end, the road\'s full width across', () => {
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

test('C5: turn and climb share the path: their ticks read "Extra turn · … · turns over …" and "Extra climb · … · climbs over …"', async () => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('turn °', -90); p.type('climb °', 4);
  p.panel.secondExtra(p.extras().find((e) => e.field === 'turn').id, 180);
  p.panel.secondExtra(p.extras().find((e) => e.field === 'climb').id, 0);
  assert.equal(p.mark('turn').label, 'Extra turn · 500.00 m → end · turns over 500.00 m · drag to start earlier or later');
  assert.equal(p.mark('climb').label, `Extra climb · ${p.mark('climb').from.toFixed(2)} m → end · climbs over ${(1000 - p.mark('climb').from).toFixed(2)} m · drag to start earlier or later`);
  p.panel.unmount();
});

test('C6: the extra handle\'s hover names its sideways drag and where it starts now, and follows the from; a field\'s own handle has no such line', () => {
  const across = { dx: 1, dy: 0.2, len: 3 }, upright = { dx: 0.1, dy: -1, len: 3 };
  assert.equal(HD.slideWords('extra:bank:0', 500, across), 'drag ← → along the road: move where the extra bank starts · now 500.00 m');
  assert.equal(HD.slideWords('extra:bank:0', 420, across), 'drag ← → along the road: move where the extra bank starts · now 420.00 m', 'follows the from');
  assert.equal(HD.slideWords('extra:bank:0', 500, upright), 'drag ↑ ↓ along the road: move where the extra bank starts · now 500.00 m', 'the road running up the screen');
  assert.equal(HD.slideWords('extra:turnDeg:0', 500, across), 'drag ← → along the road: move where the extra turn starts · now 500.00 m');
  assert.equal(HD.slideWords('bank', 500, across), '', 'the bank\'s own handle has no slide');
});

test('C7: the handles tell which handle is hovered or dragged (active), so the panel can light its tick', () => {
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

test('C8: in the panel, the extra bank\'s tick is lit while its handle is hovered or dragged, and only then', async () => {
  const p = await good({ withStage: true });
  assert.ok(p.panel.handles, 'the handles are mounted');
  assert.equal(p.mark('bank').lit, false, 'not lit');
  p.panel.handles.active = () => ({ kind: 'extra:bank:0' });
  assert.equal(p.mark('bank').lit, true, 'lit while its handle is active');
  p.panel.handles.active = () => ({ kind: 'bank' });
  assert.equal(p.mark('bank').lit, false, 'the bank\'s own handle does not light it');
  p.panel.unmount();
});

// ── R1/R2 (found in review). The marks' layer's own mount, a fake stage and a
// stub 2D context that records what one draw puts on the canvas: the label's box (its veil, a fillRect 42 px high: two lines) and its text.
//   R1: while the tick itself is dragged, the label, tint and arrows follow the drag (they stayed at the old mark until release, and the label read the old number).
//   R2: a label is nudged off any handle's screen box, and kept below the HUD's bottom edge (the top readout, [aria-label="piece values"]).
function stubCtx() {
  const rec = { rects: [], texts: [] };
  const ctx = new Proxy({ rec }, { get: (t, k) => {
    if (k in t) return t[k];
    if (k === 'measureText') return (s) => ({ width: String(s).length * 7 });
    if (k === 'clearRect') return () => { rec.rects = []; rec.texts = []; };
    if (k === 'fillRect') return (x, y, w, h) => rec.rects.push({ x, y, w, h });
    if (k === 'fillText') return (s, x, y) => rec.texts.push({ s: String(s), x, y });
    return () => {};
  }, set: (t, k, v) => { t[k] = v; return true; } });
  return ctx;
}
// a straight 1,000 m ghost along +z (L = +x), seen from straight above, the road running up the screen; the stage 900 × 600
function marksLayer({ from = 380, avoid = null, hudBottom = null } = {}) {
  const { doc, win } = fakeWindow(); const stage = doc.createElement('div'); stage.clientWidth = 900; stage.clientHeight = 600; stage.style = {};
  const ctx = stubCtx(); const create = doc.createElement; doc.createElement = (t) => { const e = create(t); if (t === 'canvas') e.getContext = () => ctx; return e; };
  if (hudBottom !== null) doc.querySelectorAll = (sel) => (sel === '[aria-label="piece values"]' ? [{ getBoundingClientRect: () => ({ left: 300, top: 0, width: 300, height: hudBottom, bottom: hudBottom }) }] : []);
  const samples = []; for (let s = 0; s <= 1000; s += 2) samples.push({ s, pos: [0, 0, s], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] });
  const ghost = { samples, s0: 0, jump: false }, pose = { eye: [0, 700, 500], target: [0, 0, 500], up: [0, 0, 1], fov: Math.PI / 3 };
  doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(ghost)); doc.addEventListener('t180:view', (e) => e.detail.reply({ pose }));
  const state = { from };
  const item = () => ({ field: 'bank', index: 0, from: state.from, to: 1000, half: 15, halfTo: 15, label: ST.markText('bank', 0, state.from, 1000, 1000), lit: false, ...ST.styleOf('bank') });
  const layer = ST.mount(stage, win, () => ({ marks: [item()], offers: [] }), { onMarkDrag: (m, f) => { state.from = f; }, ...(avoid ? { avoid } : {}) });
  layer.drawNow();
  const VP = M.viewProj(pose, 900 / 600), scr = (p) => { const c = M.apply(VP, p); return { x: (c[0] / c[3] * 0.5 + 0.5) * 900, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * 600 }; };
  const box = () => ctx.rec.rects.filter((r) => r.h === 42).at(-1) || null;
  const text = () => (ctx.rec.texts.find((t) => t.s.startsWith('Extra bank')) || { s: '' }).s;
  return { stage, layer, state, ctx, scr, box, text };
}
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('R1: dragging the tick itself, the label\'s number and the stretch\'s start follow the drag before release', () => {
  const A = marksLayer({ from: 380 });
  assert.match(A.text(), /^Extra bank · 380\.00 m/, 'drawn at 380 first');
  const st = A.layer.marks()[0].strokes[0], p0 = { x: (st.a.x + st.b.x) / 2, y: (st.a.y + st.b.y) / 2 }, to = A.scr([15 * HD.KINDS.bank.lat, 0, 478]);
  A.stage.fire('pointerdown', { clientX: p0.x, clientY: p0.y, pointerId: 1 });
  A.stage.fire('pointermove', { clientX: to.x, clientY: to.y, pointerId: 1 });
  assert.equal(A.state.from, 478, 'the drag moved the change to 478 m');
  assert.match(A.text(), /^Extra bank · 478\.00 m → end · rolls over 522\.00 m/, 'mid-drag, the label reads the drag\'s from');
  assert.equal(A.layer.marks()[0].s, 478, 'and the tick (where the stretch starts) is at it');
  A.stage.fire('pointerup', { clientX: to.x, clientY: to.y, pointerId: 1 });
  A.layer.unmount();
});

test('R2a: a label whose place falls on a handle\'s screen box is nudged off it', () => {
  const free = marksLayer({ from: 380 }), at = free.box(); free.layer.unmount();
  assert.ok(at, 'the label is drawn');
  const handle = { x: at.x + at.w / 2 - 12, y: at.y + at.h / 2 - 12, w: 24, h: 24 };   // a handle's box right on the label's middle
  const A = marksLayer({ from: 380, avoid: () => [handle] }), b = A.box();
  assert.ok(b && !overlaps(b, handle), `the label (${JSON.stringify(b)}) clears the handle (${JSON.stringify(handle)})`);
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 900 && b.y + b.h <= 600, 'and stays on the stage');
  A.layer.unmount();
});

test('R2b: a label is kept below the HUD\'s bottom edge', () => {
  const free = marksLayer({ from: 380 }), at = free.box(); free.layer.unmount();
  const hud = Math.round(at.y + at.h / 2);   // the readout reaching half way down where the label would be
  const A = marksLayer({ from: 380, hudBottom: hud }), b = A.box();
  assert.ok(b && b.y >= hud, `the label's top (${b && b.y}) is at or below the HUD's bottom (${hud})`);
  A.layer.unmount();
});

test('R2c: the panel hands the marks\' layer each handle\'s screen box (and its tip) to keep a label off', async () => {
  let hooks = null; const mount0 = ST.mount;
  ST.mount = (st, w, itemsNow, h) => { hooks = h; return mount0(st, w, itemsNow, h); };
  let p; try { p = await good({ withStage: true }); } finally { ST.mount = mount0; }
  assert.equal(typeof (hooks && hooks.avoid), 'function', 'an avoid hook');
  p.panel.handles.handles = () => [{ kind: 'extra:bank:0', screen: { x: 300, y: 200 } }, { kind: 'bank', screen: null }];
  p.panel.handles.tips = () => [{ x: 10, y: 20, w: 100, h: 22 }];
  assert.deepEqual(hooks.avoid(), [{ x: 276, y: 176, w: 48, h: 48 }, { x: 10, y: 20, w: 100, h: 22 }], 'the drawn handle\'s box, 24 px every way, and the tip; a handle off screen gives none');
  p.panel.unmount();
});
