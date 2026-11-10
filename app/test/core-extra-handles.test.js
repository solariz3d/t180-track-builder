// core-extra-handles.test.js: node --test app/test/core-extra-handles.test.js
// L140 Part 2, the UI (pane C). The user, 2026-11-05 10:15Z: "the UI design isnt there and is confusing, that is what is the worst part. when you drag turn, it is in the front of the
// piece, so after the first turn, it adds something called extra turn, and its like the same ui as the first grab turn, just added below it or around it in a way to be intuitive";
// 11:10Z: "the road I drove is better ... but how it got there was lucky from how unfunctional the UI is". Plan: exo_memory/loop/plan_l140_second_change_feels_right_2026-11-05.md,
// its Part 2 reading and "REVISED 2026-11-05 05:2x" (option (a): the extra handle slides along the road, defaulting to where L139 put it).
//   - each field with a value gets an EXTRA handle: its own handle's look, arrows and colour, labelled "extra turn" (handles.js extraKind), where its next change has room;
//   - drag ACROSS the road sets the amount and lands on level (or the field's start value) on approach (handles.js SNAP_PX; B's "THE 4.6°": his second bank ended 4.58° short);
//   - drag ALONG the road slides where the change starts; a press with no movement makes nothing; one Ctrl+Z undoes a drag;
//   - the panel's rows read "extra bank °" in the field rows' style; the faint offer rings are gone, the marks stay.
// The REAL core and panel (fake DOM); the handles' own mount driven with a fake stage and a recording host where a row names it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const HD = require('../core/handles.js');
const M = require('../camera/math.js');
const DEG = Math.PI / 180;

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
async function mountPanel() {
  const { doc, win } = fakeWindow();
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => { const l = label(text); assert.ok(l, `the panel has no "${text}" field`); return l.children[1]; };
  const byAria = (a) => { const f = root.all().find((e) => e.attrs && e.attrs['aria-label'] === a); assert.ok(f, `no element labelled "${a}"`); return f; };
  const has = (a) => !!root.all().find((e) => e.attrs && e.attrs['aria-label'] === a);
  const set = (f, v) => { f.value = String(v); f.oninput(); };
  const type = (text, v) => set(field(text), v);
  const turnAs = root.all().find((e) => e.tagName === 'SELECT' && e.attrs['aria-label'] === 'turn and climb as');
  type('length m', 100);
  return { doc, win, root, shell, panel, label, field, byAria, has, set, type, turnAs, opts: () => panel.options(), extras: () => panel.extraHandles() };
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a}, not ${b} (±${tol})`);
// the core's minimum and floor through the shell, as B's core gives them (no number copied: the real shell passes the core's own)
const guard = (p) => { let handled = false; p.doc.dispatchEvent(new p.win.CustomEvent('t180-undo-guard', { detail: { handled: () => { handled = true; } } })); return handled; };

test('L140 X1: each field with a value gets ONE extra handle, its own handle\'s kind in look and colour, labelled "extra …"; none without a value, none for the edges', async () => {
  const p = await mountPanel();
  assert.deepEqual(p.extras(), [], 'no value: no extra handle');
  p.type('length m', 1000); p.type('bank °', 30); p.type('turn °', 90); p.type('climb °', 4); p.type('width m', 40); p.type('cup °', 20); p.type('left edge °', 5);
  const ex = p.extras(), byField = Object.fromEntries(ex.map((x) => [x.field, x]));
  assert.deepEqual(Object.keys(byField).sort(), ['bank', 'climb', 'cup', 'turn', 'width'], 'bank, turn, climb, width and cup; the edges have no handle of their own');
  assert.equal(ex.length, 5, 'one each');
  for (const x of ex) {
    const K = HD.KINDS[x.id], B = HD.KINDS[K.base];
    assert.equal(K.extra, true); assert.equal(K.colour, B.colour, `${x.id}: its field's colour`); assert.equal(K.lat, B.lat); assert.deepEqual(K.sides, B.sides); assert.equal(K.axis, B.axis, 'the same arrows');
    assert.equal(K.label, `extra ${B.label}`, `labelled "extra ${B.label}"`);
  }
  assert.equal(HD.KINDS[byField.turn.id].base, 'turnDeg', 'the turn as a corner: the corner handle\'s extra');
  assert.equal(HD.KINDS['extra:bank:1'].label, 'extra bank 2', 'the second reads "extra bank 2"');
  p.panel.unmount();
});

test('L140 X2: the faint offer rings are gone: the marks\' layer draws no offer; the extra handles are in the handles\' own model', async () => {
  const { doc, win } = fakeWindow(); const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 900; stage.clientHeight = 600;
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  let seen = null; const ST = require('../core/secondtick.js'), mount0 = ST.mount;
  ST.mount = (st, w, itemsNow, hooks) => { const L = mount0(st, w, itemsNow, hooks); seen = itemsNow; return L; };
  let panel; try { panel = require('../core/panel.js').mount(root, shell); } finally { ST.mount = mount0; }
  const f = (t) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === t).children[1];
  for (const [t, v] of [['length m', 1000], ['bank °', 30]]) { const x = f(t); x.value = String(v); x.oninput(); }
  assert.ok(seen, 'the marks\' layer is mounted'); assert.deepEqual(seen().offers, [], 'no faint rings');
  assert.ok(panel.extraHandles().some((x) => x.field === 'bank'), 'the bank\'s extra handle instead');
  panel.unmount();
});

test('L140 X3: dragged toward level, an extra handle LANDS on level within SNAP_PX (his 4.58°, about 10 px short); further away it stays; Shift and Ctrl keep their own rules', () => {
  const K = HD.KINDS['extra:bank:0'], px = (deg) => (deg - 80) / K.perPx, ctx = { snapTo: [0], hold: false };
  assert.equal(HD.targetFor('extra:bank:0', 80, px(4.58), ctx), 0, 'his 4.58°: on level');
  assert.equal(HD.targetFor('extra:bank:0', 80, px(-3), ctx), 0, 'just past level: on level');
  assert.equal(HD.targetFor('extra:bank:0', 80, px(10), ctx), 10, '10° away (22 px): stays');
  assert.equal(HD.targetFor('extra:bank:0', 80, px(4.58), ctx, { shift: true }), 78.32, 'Shift is one pixel one step (167.6 px, 1.68°), no snap');
  assert.equal(HD.targetFor('extra:bank:0', 80, px(4.58), ctx, { ctrl: true }), 5, 'Ctrl rounds to 5');
  assert.equal(HD.targetFor('extra:width:0', 40, (30.6 - 40) / HD.KINDS['extra:width:0'].perPx, { snapTo: [30], hold: false }), 30, 'width lands on its start value (0.6 m off: within 12 px at 0.068 m a pixel)');
  assert.equal(HD.targetFor('bank', 80, px(4.58), { hold: false }), 4.58, 'the field\'s own handle is as before (no snapTo)');
});

// THE HANDLES' OWN MOUNT, with a fake stage and a recording host: an extra handle on a straight road along +z (L = +x, U = +y), seen from above and behind
function handlesOn(kind, { base = 30, from = 600 } = {}) {
  const { doc, win } = fakeWindow(); const stage = doc.createElement('div'); stage.clientWidth = 900; stage.clientHeight = 600; stage.style = {};
  const samples = []; for (let s = 0; s <= 1000; s += 2) samples.push({ s, pos: [0, 0, s], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] });
  const pose = { eye: [0, 260, from - 260], target: [0, 0, from], up: [0, 1, 0], fov: Math.PI / 3 };
  const calls = []; let rafCb = null; win.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  const host = { model: () => ({ mode: 'extend', samples, s0: 0, s1: 1000, half: () => 10, kinds: [kind], at: { [kind]: from / 1000 }, base: () => base, ctx: () => ({ half: 10, snapTo: [0] }), slideBase: () => from }),
    pose: () => pose, begin: (h) => calls.push(['begin', h.kind]), apply: (h, v) => calls.push(['apply', h.kind, v]), slide: (h, f) => calls.push(['slide', h.kind, f]), end: (h) => calls.push(['end', h.kind]) };
  const H = HD.mount(stage, win, host); if (rafCb) rafCb(0);
  const h = H.handles().find((x) => x.kind === kind && x.side === 1 && x.screen); assert.ok(h, `the ${kind} handle (the road's left side) is on screen`);
  const VP = M.viewProj(pose, 900 / 600), scr = (p) => { const c = M.apply(VP, p); return { x: (c[0] / c[3] * 0.5 + 0.5) * 900, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * 600 }; };
  return { stage, H, h, calls, scr, tick: () => { if (rafCb) rafCb(0); } };
}

test('L140 X4: an extra handle: a press and release sends nothing; a drag ACROSS sends amounts; a drag ALONG the road slides where its change starts, in metres', () => {
  const A = handlesOn('extra:bank:0'), at = A.h.screen;
  A.stage.fire('pointerdown', { clientX: at.x, clientY: at.y, pointerId: 1, timeStamp: 1 }); A.stage.fire('pointerup', { clientX: at.x, clientY: at.y, pointerId: 1, timeStamp: 2 });
  assert.deepEqual(A.calls.map((c) => c[0]), ['begin', 'end'], 'a press and release: no amount, no slide');
  A.H.unmount();
  const B = handlesOn('extra:bank:0'), b = B.h.screen, n = Math.hypot(b.dx, b.dy) || 1, up = { x: b.x + b.dx / n * 40, y: b.y + b.dy / n * 40 };   // 40 px up its own axis: across
  B.stage.fire('pointerdown', { clientX: b.x, clientY: b.y, pointerId: 1, timeStamp: 1 });
  for (let i = 1; i <= 10; i++) B.stage.fire('pointermove', { clientX: b.x + (up.x - b.x) * i / 10, clientY: b.y + (up.y - b.y) * i / 10, pointerId: 1, timeStamp: 1 + i * 20 });
  B.stage.fire('pointerup', { clientX: up.x, clientY: up.y, pointerId: 1, timeStamp: 400 });
  assert.ok(B.calls.some((c) => c[0] === 'apply'), `across: amounts (${JSON.stringify(B.calls)})`); assert.ok(!B.calls.some((c) => c[0] === 'slide'), 'and no slide');
  B.H.unmount();
  const C = handlesOn('extra:bank:0'), c0 = C.h.screen, ahead = C.scr([10, 0, 650]);   // 50 m further along the road, at the handle's own side
  C.stage.fire('pointerdown', { clientX: c0.x, clientY: c0.y, pointerId: 1, timeStamp: 1 });
  for (let i = 1; i <= 10; i++) C.stage.fire('pointermove', { clientX: c0.x + (ahead.x - c0.x) * i / 10, clientY: c0.y + (ahead.y - c0.y) * i / 10, pointerId: 1, timeStamp: 1 + i * 20 });
  C.stage.fire('pointerup', { clientX: ahead.x, clientY: ahead.y, pointerId: 1, timeStamp: 400 });
  const slides = C.calls.filter((c) => c[0] === 'slide');
  assert.ok(slides.length && !C.calls.some((c) => c[0] === 'apply'), `along: slides only (${JSON.stringify(C.calls)})`);
  near(slides.at(-1)[2], 650, 5, 'its start slid to about 650 m (the slide is measured along the road as it is on screen where the drag began: in perspective, a few metres short over 50)');
  C.H.unmount();
});

test('L140 X5: in the panel, dragging an unused extra handle makes EXACTLY one change at its place with the amount reached; the document is untouched; one Ctrl+Z removes it', async () => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('bank °', 30);
  const x = p.extras().find((e) => e.field === 'bank'), doc0 = p.shell.getState().history.present;
  assert.equal(x.unused, true); assert.equal(x.value, 30, 'it starts at the bank it would change from');
  p.panel.secondExtra(x.id, 10); p.panel.secondExtra(x.id, 0);   // one drag, two moves
  assert.equal(p.opts().changes.phi.length, 1, 'one change'); assert.equal(p.opts().changes.phi[0].from, x.from, 'at the handle\'s place'); near(p.opts().changes.phi[0].target, 0, 1e-12, 'with the amount the drag reached');
  assert.equal(p.shell.getState().history.present, doc0, 'the document untouched until Extend');
  assert.equal(guard(p), true); assert.equal('changes' in p.opts(), false, 'one Ctrl+Z: the change is gone');
  p.panel.unmount();
});

test('L140 X6: sliding an extra handle moves where its change starts: a used one\'s mark (kept as its share), an unused one\'s place, and its amount then lands there', async () => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('bank °', 30);
  let x = p.extras().find((e) => e.field === 'bank');
  p.panel.secondSlide(x.id, 700);
  x = p.extras().find((e) => e.field === 'bank'); assert.equal(x.from, 700, 'the unused one stands where it was slid');
  p.panel.secondExtra(x.id, 0);
  assert.equal(p.opts().changes.phi[0].from, 700, 'and its change starts there');
  p.panel.secondSlide('extra:bank:0', 650);
  assert.equal(p.opts().changes.phi[0].from, 650, 'a used one slides its mark');
  p.type('length m', 2000); assert.equal(p.opts().changes.phi[0].from, 1300, 'kept as its share of the piece (65%)');
  p.panel.unmount();
});

test('L140 X7: the panel\'s rows read "extra bank °" (and "extra bank 2 °"), in the field rows\' own style, each with its from and a remove', async () => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('bank °', 30);
  const x = p.extras().find((e) => e.field === 'bank'); p.panel.secondExtra(x.id, 0);
  const row = p.byAria('extra bank').parent;
  assert.equal(row.tagName, p.label('bank °').tagName, 'a label row, as the bank\'s own'); assert.equal(row.attrs.class.split(' ').slice(0, 2).join(' '), p.label('bank °').attrs.class);
  assert.equal(row.children[0].textContent, 'extra bank °', 'it reads "extra bank °"');
  assert.ok(p.has('extra bank from') && p.has('remove extra bank'));
  p.panel.secondAdd('bank', { then: '20', from: '900' });
  assert.equal(p.byAria('extra bank 2').parent.children[0].textContent, 'extra bank 2 °');
  p.panel.unmount();
});

test('L140 X8: his TEST BANKING bank, by the extra handle: 80° then dragged toward level and let go 10 px short ends at 0, laid by the core', async () => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('bank °', 80);
  const x = p.extras().find((e) => e.field === 'bank'), K = HD.KINDS[x.id];
  const v = HD.targetFor(x.id, x.value, (0 - x.value) / K.perPx + 10, { snapTo: x.snapTo, hold: false });   // the drag ends 10 px short of level
  assert.equal(v, 0, `10 px short of level lands on it (${v})`);
  p.panel.secondExtra(x.id, v);
  const n = p.shell.getState().history.present.pieces.length; p.root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === 'Extend').onclick();
  assert.equal(p.shell.getState().history.present.pieces.length, n + 1, 'laid');
  const P = p.shell.getState().history.present.pieces.at(-1); near(require('../../src/core/document.js').channelAt(P, 'phi', P.length).v / DEG, 0, 1e-6, 'the bank ends at 0, not 4.58');
  p.panel.unmount();
});

// ── WAY 1 (the user, 2026-11-07 08:34Z: "from the artifact we could try 1 first").
// Measured on his S (an extra turn and an extra bank, both marked at 500 m): the extra bank's ramp made half its change 125 m after the extra turn's curvature did
// (on the S he drew). Way 1: when the piece ALREADY has an extra turn, the extra bank's default from is that turn's mark less 0.12 of the piece
// (380 m on his 1,000 m piece), clamped as before (no earlier than the first ramp's end, no later than the room it needs); a mark he slid wins; no extra turn, nothing moves.
const hisS = async (bank = 17.39) => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('turn °', -90); p.type('bank °', bank);
  const t = p.extras().find((e) => e.field === 'turn'); p.panel.secondExtra(t.id, 180);
  assert.equal(p.opts().changes.turnDeg[0].from, 500, 'his extra turn stands at its own default, 500 m');
  return p;
};
test('W1: his S: with an extra turn at 500 m, the extra bank\'s handle stands at 380 m (500 − 0.12 × 1,000), and its change starts there', async () => {
  const p = await hisS();
  const b = p.extras().find((e) => e.field === 'bank');
  assert.equal(b.unused, true); assert.equal(b.from, 380, 'the unused extra bank stands 120 m before the extra turn\'s mark');
  p.panel.secondExtra(b.id, -34.78);
  assert.equal(p.opts().changes.phi[0].from, 380, 'and its change starts there');
  p.panel.unmount();
});
test('W2: no extra turn: the extra bank stands at 500 m as before (his good piece: corner −90, bank 50, extra bank to 0)', async () => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('turn °', -90); p.type('bank °', 50);
  const b = p.extras().find((e) => e.field === 'bank');
  assert.equal(b.from, 500, 'halfway, as EXTRA_FROM_SHARE');
  p.panel.secondExtra(b.id, 0);
  assert.equal(p.opts().changes.phi[0].from, 500);
  p.panel.unmount();
});
test('W3: a mark he slid wins over the lead: the unused extra bank slid to 450 m stays at 450 m with an extra turn on the piece', async () => {
  const p = await hisS();
  const b = p.extras().find((e) => e.field === 'bank');
  p.panel.secondSlide(b.id, 450);
  assert.equal(p.extras().find((e) => e.field === 'bank').from, 450, 'where he slid it');
  p.panel.secondExtra(b.id, -34.78);
  assert.equal(p.opts().changes.phi[0].from, 450, 'and its change starts there');
  p.panel.unmount();
});
test('W4: the clamp: on a short piece whose first bank is laid early, the lead never puts the extra bank before the first ramp\'s end', async () => {
  const p = await mountPanel();
  p.type('length m', 300); p.type('turn °', -10); p.type('bank °', 17.39);
  const box = p.root.all().find((e) => e.tagName === 'INPUT' && e.attrs.type === 'checkbox' && e.attrs['aria-label'] === 'bank at the start'); box.checked = true; (box.onchange || box.onclick)();
  const end = p.opts().transition.phi;
  const t = p.extras().find((e) => e.field === 'turn'); p.panel.secondExtra(t.id, 20);
  const mark = p.opts().changes.turnDeg[0].from, lead = mark - 0.12 * 300;
  assert.ok(lead < end, `the case clamps: the lead ${lead} m is before the first ramp's end ${end} m`);
  const b = p.extras().find((e) => e.field === 'bank');
  assert.ok(b.from >= end - 1e-9 && b.from <= mark, `the extra bank at ${b.from} m: no earlier than the first ramp's end (${end} m), no later than the turn's mark (${mark} m)`);
  near(b.from, Math.ceil(end * 100) / 100, 0.01, 'at the first ramp\'s end');
  p.panel.unmount();
});
test('W5: a typed extra bank row with no from, with an extra turn: extendOptions lays it 0.12 of the piece before the extra turn\'s mark (380 m), not at 85%', () => {
  const { extendOptions } = require('../core/panel.js');
  const base = { length: '1000', turn: '-90', bank: '17.39', turnAs: 'corner', head: { kh: 0, kv: 0, phi: 0, w: 31, c: 15.5 } };
  const o = extendOptions({ ...base, changes: { turn: [{ then: '180', from: '500' }], bank: [{ then: '-34.78', from: '' }] } });
  assert.equal(o.changes.phi[0].from, 380, 'the lead from the extra turn');
  const o2 = extendOptions({ ...base, changes: { bank: [{ then: '-34.78', from: '' }] } });
  assert.equal(o2.changes.phi[0].from, 850, 'no extra turn: SECOND_FROM_SHARE, as before');
});
test('W6: the clamp\'s low end is the change floor, never the piece\'s start: an extra turn slid to 100 m (the lead would be −20 m) puts the extra bank at the floor, and Extend lays it', async () => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('turn °', -90); p.type('bank °', 17.39);
  const t = p.extras().find((e) => e.field === 'turn'); p.panel.secondSlide(t.id, 100); p.panel.secondExtra(t.id, 180);
  assert.equal(p.opts().changes.turnDeg[0].from, 100, 'the extra turn where he slid it');
  const b = p.extras().find((e) => e.field === 'bank'), floor = require('../../src/core/extend.js').SECOND_FLOOR_M;
  assert.equal(b.from, floor, `the extra bank at the floor (${floor} m), not at ${100 - 120} m and not at 0`);
  p.panel.secondExtra(b.id, -34.78);
  const n = p.shell.getState().history.present.pieces.length; p.root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === 'Extend').onclick();
  assert.equal(p.shell.getState().history.present.pieces.length, n + 1, 'laid, not refused');
  p.panel.unmount();
});
test('W7: a typed extra bank row with no from, behind an extra turn at 100 m: extendOptions lays it at the floor, not at 0 or before', () => {
  const { extendOptions } = require('../core/panel.js'), floor = require('../../src/core/extend.js').SECOND_FLOOR_M;
  const o = extendOptions({ length: '1000', turn: '-90', bank: '17.39', turnAs: 'corner', head: { kh: 0, kv: 0, phi: 0, w: 31, c: 15.5 }, changes: { turn: [{ then: '180', from: '100' }], bank: [{ then: '-34.78', from: '' }] } });
  assert.equal(o.changes.phi[0].from, floor);
});

// ── THE ORDER FOLD-IN (with way 1 alone, an extra bank made BEFORE the extra turn kept its 500 m
// mark). When an extra turn is added and the extra bank's mark is still its DEFAULT (made where its handle stood, never slid, typed or dragged), the mark moves to the lead;
// a slid or typed mark stays, in either order. Removing the extra turn gives the default mark back.
const sMade = async (order, { slide = null, type = null } = {}) => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('turn °', -90); p.type('bank °', 17.39);
  const bank = () => { const b = p.extras().find((e) => e.field === 'bank'); if (slide !== null) p.panel.secondSlide(b.id, slide); p.panel.secondExtra(b.id, -34.78); if (type !== null) { const f = p.byAria('extra bank from'); f.value = String(type); f.oninput(); } };
  const turn = () => { const t = p.extras().find((e) => e.field === 'turn'); p.panel.secondExtra(t.id, 180); };
  if (order === 'bank-then-turn') { bank(); turn(); } else { turn(); bank(); }
  assert.equal(p.opts().changes.turnDeg[0].from, 500, 'the extra turn at its own default, 500 m');
  return p;
};
for (const order of ['bank-then-turn', 'turn-then-bank']) {
  test(`F1 (${order}): the extra bank lands at the lead, 380 m (the extra turn's 500 − 0.12 × 1,000), and its handle stands there`, async () => {
    const p = await sMade(order);
    assert.equal(p.opts().changes.phi[0].from, 380, 'the change starts at the lead');
    assert.equal(p.extras().find((e) => e.field === 'bank').from, 380, 'its handle stands there');
    p.panel.unmount();
  });
  test(`F2 (${order}): an extra bank slid to 450 m before it was made stays at 450 m`, async () => {
    const p = await sMade(order, { slide: 450 });
    assert.equal(p.opts().changes.phi[0].from, 450);
    p.panel.unmount();
  });
  test(`F3 (${order}): an extra bank whose from was typed (600 m) stays at 600 m`, async () => {
    const p = await sMade(order, { type: 600 });
    assert.equal(p.opts().changes.phi[0].from, 600);
    p.panel.unmount();
  });
}
test('F4: an extra bank made before the extra turn and left at its default goes back to 500 m when the extra turn is removed', async () => {
  const p = await sMade('bank-then-turn');
  assert.equal(p.opts().changes.phi[0].from, 380);
  p.byAria('remove extra turn').onclick();
  assert.equal(p.opts().changes.turnDeg, undefined, 'no extra turn');
  assert.equal(p.opts().changes.phi[0].from, 500, 'the default mark again, halfway');
  p.panel.unmount();
});
test('F5: a default extra bank\'s mark dragged along the road (to 700 m) is his: adding the extra turn after it does not move it', async () => {
  const p = await mountPanel();
  p.type('length m', 1000); p.type('turn °', -90); p.type('bank °', 17.39);
  const b = p.extras().find((e) => e.field === 'bank'); p.panel.secondExtra(b.id, -34.78);
  p.panel.secondSlide('extra:bank:0', 700);
  const t = p.extras().find((e) => e.field === 'turn'); p.panel.secondExtra(t.id, 180);
  assert.equal(p.opts().changes.phi[0].from, 700);
  p.panel.unmount();
});

// AN EXTRA CORNER IS AS FREE AS THE FIRST (the user, 2026-11-10, on 0.4.40: "making a short turn, say a 90 degree, you cannot then add the extra turn to bend it 45 degrees
// ahead to then make a straight, it doesnt let you go past 2.64ish degrees"). His track (test/fixtures/extra-turn-short-2026-11-10.t180track) up to his 125 m piece, the
// piece typed as he had it (length 125, turn −90 as a corner); the core's rule is test/core_extra_corner.test.js
const HIS_STRAIGHT = (() => { const D = require('../../src/core/document.js'), d = D.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'test', 'fixtures', 'extra-turn-short-2026-11-10.t180track'), 'utf8')); return Object.freeze(D.checkDoc({ ...d, pieces: d.pieces.slice(0, 1) })); })();
const hisPiece = async () => { const p = await mountPanel(); p.shell.adopt(HIS_STRAIGHT); p.type('length m', 125); p.type('turn °', -90); return p; };
test('his extra turn 1: on his 125 m −90° piece the extra turn\'s handle drags to −45° and to +45° from 62.5 m, and the core lays both', async () => {
  const p = await hisPiece(), TB = require('../../src/core/turnby.js');
  const t = p.extras().find((e) => e.field === 'turn'); assert.ok(t, 'the extra turn has its handle');
  for (const v of [1.96, 2.64, 45, -45]) {
    p.panel.secondExtra(t.id, v);
    assert.deepEqual(p.opts().changes.turnDeg, [{ from: 62.5, deg: v }], `dragged to ${v}°: the change is ${JSON.stringify(p.opts().changes.turnDeg)}`);
    assert.doesNotThrow(() => TB.extendCorner(p.shell.getState().history.present, p.opts()), `${v}°: laid`);
  }
  p.panel.unmount();
});
test('his extra turn 2: an extra handle held at the edge of what fits says so, why, and the length it needs; back inside, it says nothing', async () => {
  // 300 m and a bank of 30°: on his 125 m piece no extra bank fits at all, and a bank field with nothing typed has no extra, so neither has the handle
  const p = await hisPiece(); p.type('length m', 300); p.type('bank °', 30);
  const b = p.extras().find((e) => e.field === 'bank'), from = b.from;
  assert.equal(p.panel.heldWhy(b.id), '', 'not dragged: nothing');
  p.panel.secondExtra(b.id, 35); assert.equal(p.panel.heldWhy(b.id), '', 'to 35°, it fits: nothing');
  p.panel.secondExtra(b.id, 90);
  const held = p.opts().changes.phi[0].target / DEG, why = p.panel.heldWhy(b.id);
  assert.ok(held > 35 && held < 90, `held between: ${held}°`);
  // AMENDED 2026-11-10 (rule changed: a bank change is held only where the road as built rounds it back over the bank it held, not where it rolls faster than the bar; the
  // user, 2026-11-10, on the extra bank: "now the same thing happens when I want to bank the turn that u fixed"). Was: "90° needs N m from its mark, it has M m (shorter, it
  // rolls faster than it can be ridden smoothly)". Here the road straightens where the change is, so it is still held, and the words are the built road's
  const m = why.match(/^held at (-?[\d.]+)°: the road as built rounds 90° back over the bank it held in the ([\d.]+) m from its mark; ([\d.]+) m holds$/);
  assert.ok(m, `the reason: "${why}"`);
  near(Number(m[1]), held, 0.005, 'held at what is set'); near(Number(m[2]), 300 - from, 0.05, 'the stretch it has: from its mark to the end');
  assert.ok(Number(m[3]) > Number(m[2]), `what holds is more than it has: ${m[3]} against ${m[2]}`);
  assert.equal(p.panel.heldWhy('extra:turnDeg:0'), '', 'only the handle being dragged says it');
  p.panel.secondExtra(b.id, 35); assert.equal(p.panel.heldWhy(b.id), '', 'back inside: nothing');
  p.panel.unmount();
});

// (his screenshot, 2026-11-10: "no preview of this piece: BAD_LENGTH: extend needs a positive length, got 0" under a length field reading 125): the ghost writes its
// refusal into the message line, and the next ghost that is built did not take it away, so an emptied length field's refusal stayed under the 125 typed after it
const previewMsg = (p) => p.root.all().filter((e) => e.attrs && e.attrs.class === 'message' && /no preview/.test(e.textContent)).map((e) => e.textContent).join(' | ');
test('his extra turn 3: a ghost refusal is taken away by the next ghost that is built: the length field emptied, then 125 typed', async () => {
  const p = await hisPiece();
  p.type('length m', ''); assert.match(previewMsg(p), /BAD_LENGTH/, 'an empty length: the ghost says why');
  p.type('length m', '12'); assert.match(previewMsg(p), /TURN_TOO_SHORT/, '12 m: too short for −90°, it says why');
  p.type('length m', '125'); assert.equal(previewMsg(p), '', 'the 125 m ghost is built: no refusal left in the message line');
  p.shell.selectPiece(0); assert.equal(previewMsg(p), '', 'and a refusal of the shell (none here) is what the line shows');
  p.panel.unmount();
});

// THE EXTRA BANK, AS FREE AS THE ROAD AS BUILT ALLOWS (the user, 2026-11-10: "now the same thing happens when I want to bank the turn that u fixed, it jumps to -5 degrees and
// then stops"; "its the extra banking btw"). His track (test/fixtures/extra-bank-short-2026-11-10.t180track) up to his 125 m piece, typed as he had it: turn −90, its extra
// turn +90 from 62.5 m, bank 0.13 and the extra bank's handle, which stands at 47.5 m (the extra turn's mark less 0.12 of the piece). The core's rule is
// test/core_extra_change.test.js
const BANK_STRAIGHT = (() => { const D = require('../../src/core/document.js'), d = D.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'test', 'fixtures', 'extra-bank-short-2026-11-10.t180track'), 'utf8')); return Object.freeze(D.checkDoc({ ...d, pieces: d.pieces.slice(0, 1) })); })();
test('his extra bank 1: on his piece the extra bank\'s first move goes where it is dragged (to −20°, not to the edge at −5.49), and on to −45° and −90°, each laid', async () => {
  const p = await mountPanel(), TB = require('../../src/core/turnby.js');
  p.shell.adopt(BANK_STRAIGHT); p.type('length m', 125); p.type('turn °', -90); p.type('bank °', 0.13);
  p.panel.secondExtra(p.extras().find((e) => e.field === 'turn').id, 90);
  assert.deepEqual(p.opts().changes.turnDeg, [{ from: 62.5, deg: 90 }], 'his extra turn');
  const b = p.extras().find((e) => e.field === 'bank'); assert.equal(b.from, 47.5, 'the extra bank stands at his 47.5 m');
  for (const v of [-20, -45, -90]) {
    p.panel.secondExtra(b.id, v);
    const got = p.opts().changes.phi[0];
    assert.ok(got.from === 47.5 && Math.abs(got.target / DEG - v) < 1e-9, `dragged to ${v}°: the change is ${(got.target / DEG).toFixed(2)}° from ${got.from}`);
    assert.equal(p.panel.heldWhy(b.id), '', `${v}°: not held`);
    assert.doesNotThrow(() => TB.extendCorner(p.shell.getState().history.present, p.opts()), `${v}°: laid`);
  }
  p.panel.unmount();
});
