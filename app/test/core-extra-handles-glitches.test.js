// core-extra-handles-glitches.test.js: node --test app/test/core-extra-handles-glitches.test.js
// L140 (pane C): one row per glitch in B's list (exo_memory/handback/p-l140-glitches-B_2026-11-05.md, lighthouse 07881179), the L139 UI as the user drove it on 35feaf9
// ("broken … glitchy and non intuitive", 10:06Z). Each row is B's repro, through the REAL core shell, panel, handles and change layer on a fake #preview stage; the harness is
// B's drive.js (its fake window with frames run by hand, a straight ghost of the typed length from s0 = 1000 seen from above and behind), as B drove it.
// A change "made from its handle" goes through the extra handle where the panel has one (L140), else through the offer the L139 panel had: the same act, the user's way in.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const TB = require('../../src/core/turnby.js');
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
  get isConnected() { return true; }
  setPointerCapture() {}
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
  fire(type, init) { let stopped = false; const ev = { type, ...init, preventDefault() {}, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; } };
    const ls = (this.listeners[type] || []).slice(), order = ls.filter((l) => l.capture).concat(ls.filter((l) => !l.capture));
    let n = 0; for (const l of order) { if (stopped) break; n++; l.f(ev); } return n; }
}
function fakeWindow() {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const frames = [];
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} };
  doc.defaultView = win;
  return { doc, win, tick: () => { for (let i = 0; i < 3; i++) { const fs = frames.splice(0); for (const f of fs) f(0); } } };
}
const ghostOf = (L) => { const s0 = 1000, samples = []; for (let s = s0; s <= s0 + L + 1e-9; s += 2) samples.push({ s, pos: [0, 0, s], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] }); return { s0, samples, segments: [], jump: false }; };
const POSE = (L) => ({ eye: [0, 0.6 * L, 1000 - 0.25 * L], target: [0, 0, 1000 + 0.5 * L], up: [0, 1, 0], fov: Math.PI / 3 });

async function mount() {
  const { doc, win, tick } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 1200; stage.clientHeight = 800;
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  shell.extend({ length: 1000, family: 'bowl' });   // his first piece: a 1,000 m straight
  let L = 1000; doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(ghostOf(L))); doc.addEventListener('t180:view', (e) => e.detail.reply({ pose: POSE(L) }));
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => { const l = label(text); assert.ok(l, `no "${text}" field`); return l.children[1]; };
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); if (text === 'length m') L = Number(v); tick(); };
  const handle = (kind, side) => panel.handles.handles().find((h) => h.kind === kind && h.side === side && h.screen);
  const refusal = () => { try { TB.extendCorner(shell.getState().history.present, panel.options()); return null; } catch (e) { return `${e.code}: ${e.message}`; } };
  const changes = () => panel.options().changes || {};
  // a press at a handle and a drag of dy px (screen), released there
  const drag = (h, dx, dy) => { const s = h.screen; stage.fire('pointerdown', { clientX: s.x, clientY: s.y, pointerId: 1, button: 0 }); for (let i = 1; i <= 4; i++) stage.fire('pointermove', { clientX: s.x + dx * i / 4, clientY: s.y + dy * i / 4, pointerId: 1 }); stage.fire('pointerup', { clientX: s.x + dx, clientY: s.y + dy, pointerId: 1 }); tick(); };
  // a change made from its handle, the user's way in: the extra handle (L140) or the offer (L139)
  const make = (f, v) => {
    if (typeof panel.extraHandles === 'function') { const x = panel.extraHandles().find((e) => e.field === f && e.unused); assert.ok(x, `an extra ${f} handle`); panel.secondExtra(x.id, v); return x.from; }
    const o = panel.offersAt().find((e) => e.field === f); assert.ok(o, `an offer for ${f}`); panel.secondOffer(o, v); return o.from;
  };
  return { doc, win, tick, stage, root, shell, panel, field, type, handle, refusal, changes, drag, make, asRate: () => { const ta = root.all().find((e) => e.tagName === 'SELECT' && e.attrs['aria-label'] === 'turn and climb as'); ta.value = 'rate'; ta.onchange(); tick(); } };
}

test('L140 G1: with the bank set, a drag on the bank handle changes the bank and makes no change', async () => {
  const p = await mount(); p.type('length m', 1000); p.type('bank °', 80);
  p.drag(p.handle('bank', 1), 0, 40);
  assert.notEqual(p.field('bank °').value, '80', 'the bank moved'); assert.deepEqual(p.changes(), {}, `no change made (${JSON.stringify(p.changes())})`);
  p.panel.unmount();
});

test('L140 G2: with the climb set (as a rate), a drag on the climb handle changes the climb and makes no change', async () => {
  const p = await mount(); p.type('length m', 1000); p.asRate(); p.type('climb °/100m', 4);
  p.drag(p.handle('climb', 0), 0, -40);
  assert.notEqual(p.field('climb °/100m').value, '4', 'the climb moved'); assert.deepEqual(p.changes(), {}, `no change made (${JSON.stringify(p.changes())})`);
  p.panel.unmount();
});

test('L140 G3: with the turn set, a drag on the bank handle changes the bank, not the turn', async () => {
  const p = await mount(); p.type('length m', 1000); p.type('turn °', -60); p.type('bank °', 80);
  p.drag(p.handle('bank', 1), 0, -40);
  assert.notEqual(p.field('bank °').value, '80', 'the bank moved'); assert.equal('turnDeg' in p.changes(), false, `no turn change (${JSON.stringify(p.changes())})`);
  p.panel.unmount();
});

test('L140 G4: a drag on the bank handle never moves another field\'s mark (a turn change starting at the bank handle\'s station)', async () => {
  const p = await mount(); p.type('length m', 1000); p.type('turn °', -60); p.type('bank °', 80);
  p.panel.secondAdd('turn', { then: '-30', from: '500' }); p.tick();
  const from0 = p.changes().turnDeg[0].from;
  p.drag(p.handle('bank', 1), 0, -40); assert.notEqual(p.field('bank °').value, '80', 'the bank moved');
  p.drag(p.handle('bank', -1), 0, -40);   // (the other side, up: the bank back the other way)
  assert.equal(p.changes().turnDeg[0].from, from0, 'the turn change\'s mark stays');
  p.panel.unmount();
});

test('L140 G5: a new extra change starts where its handle stands, just ahead of the field\'s own (the user\'s drawing: bank at 0.60 of the piece), not at the middle', async () => {
  const p = await mount(); p.type('length m', 1000); p.type('bank °', 30);
  const at = p.make('bank', 10);
  assert.equal(at, 600, 'its handle stood at 600 m'); assert.equal(p.changes().phi[0].from, 600, 'and its change starts there');
  p.panel.unmount();
});

test('L140 G6: an extra change dragged toward level and let go 10 px short of it ends level', async () => {
  const p = await mount(); p.type('length m', 1000); p.type('bank °', 80);
  assert.equal(typeof p.panel.extraHandles, 'function', 'an extra handle to drag');
  const HD = require('../core/handles.js'), x = p.panel.extraHandles().find((e) => e.field === 'bank'), K = HD.KINDS[x.id];
  const v = HD.targetFor(x.id, x.value, (0 - x.value) / K.perPx + 10, { snapTo: x.snapTo, hold: false });
  p.panel.secondExtra(x.id, v);
  assert.equal(p.changes().phi[0].target, 0, `level, not ${v}°`);
  p.panel.unmount();
});

test('L140 G7: on a 300 m piece, a bank change dragged to level is laid (held where it fits), not refused', async () => {
  const p = await mount(); p.type('length m', 300); p.type('bank °', 30);
  p.make('bank', 0);
  assert.equal(p.refusal(), null, 'the core lays it');
  assert.ok(p.changes().phi[0].target / DEG < 30, `and the bank still changes toward level (${p.changes().phi[0].target / DEG}°)`);
  p.panel.unmount();
});

test('L140 G8: shortening a piece never leaves a change short of its minimum: it is moved earlier and still laid', async () => {
  const p = await mount(); p.type('length m', 1000); p.type('bank °', 80);
  p.panel.secondAdd('bank', { then: '0', from: '500' }); p.panel.secondDrag({ field: 'bank', index: 0 }, 500);   // a dragged change: it keeps its share
  for (const L of [800, 600, 560, 500]) { p.type('length m', L); assert.equal(p.refusal(), null, `laid at ${L} m (from ${p.changes().phi[0].from})`); }
  p.type('length m', 1000); assert.equal(p.changes().phi[0].from, 500, 'lengthened again, back at its share');
  p.panel.unmount();
});

test('L140 G9: a mark dragged toward its neighbour stops at the neighbour plus the minimum, and the piece is laid', async () => {
  const p = await mount(); p.type('length m', 1000); p.type('bank °', 30);
  p.panel.secondAdd('bank', { then: '10', from: '400' }); p.panel.secondAdd('bank', { then: '0', from: '800' });
  p.panel.secondDrag({ field: 'bank', index: 1 }, 300);
  const ch = p.changes().phi; assert.ok(ch[1].from > ch[0].from, `still after its neighbour (${ch[0].from}, ${ch[1].from})`); assert.equal(p.refusal(), null, 'laid');
  p.panel.unmount();
});

test('L140 G10: a press with no movement on a mark that sits on a handle reaches the handle beneath', async () => {
  // how far a press on the bank handle goes with nothing else there (no bank yet: no change, no offer, no mark)
  const p = await mount(); p.type('length m', 1000);
  const h = p.handle('bank', 1), s = h.screen, reached0 = p.stage.fire('pointerdown', { clientX: s.x, clientY: s.y, pointerId: 1, button: 0 }); p.stage.fire('pointerup', { clientX: s.x, clientY: s.y, pointerId: 1 }); p.tick();
  p.type('bank °', 80); p.panel.secondAdd('bank', { then: '0', from: '500' }); p.tick();   // a bank change whose mark is at the bank handle's own station
  const h2 = p.handle('bank', 1), s2 = h2.screen, reached = p.stage.fire('pointerdown', { clientX: s2.x, clientY: s2.y, pointerId: 2, button: 0 }); p.stage.fire('pointerup', { clientX: s2.x, clientY: s2.y, pointerId: 2 });
  assert.equal(reached, reached0, 'the press goes on as far as with no mark there');
  p.panel.unmount();
});
