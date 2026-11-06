// core-extra-bank-drag-cost.test.js: node --test app/test/core-extra-bank-drag-cost.test.js
// D642 (pane C), the panel half of the drag-cost fix. E's review of d87ba99 (lighthouse exo_memory/handback/p-d642-b3-review-E_2026-11-05.md §2): dragging his EXTRA BANK back
// toward level on a whole-piece bank cost the panel p95 106 ms a move, 17 × the same drag with no moving first ramp ("early"), because the panel asked the core's full shortest
// (a search of 12-18 probe roads) on every move. His interim bar: that drag within 2 × the flat drag's p95. The drag is E's bench (dragbench-full.js): his p2's piece (1,000 m,
// −90 corner, bank 88.45, cup 15.5, width 31), a real pointer drag on the unused extra bank, 60 moves of 8 px at 16 ms, a frame after each, every move timed; "early" is the
// same piece with the bank's "early" box ticked. The ROLLING drag is the FIRST one over these values in the process: the core keeps its probes (9050da5: a 1° grid), so a
// second drag over the same bank reads them back, and that is not the drag he feels (measured on 9050da5 with d87ba99's panel: 118 ms then 9.9 ms). An early drag runs
// first, unmeasured, so the panel's code is warm and the probe memo is not; the early drag's p95 is the better of two (noise). The bar is a ratio of two read in one process.
// The fold needs the core's one-probe answer (extend.js spanHolds, through shell.spanHolds); a core without it is a todo here, not a pass.
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

async function mount({ pose = POSE } = {}) {
  const { doc, win, tick } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 1200; stage.clientHeight = 800;
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  shell.extend({ length: 1000, family: 'bowl' });   // his first piece: a 1,000 m straight
  let L = 1000; doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(ghostOf(L))); doc.addEventListener('t180:view', (e) => e.detail.reply({ pose: pose(L) }));
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

const EXT = require('../../src/core/extend.js'), HD = require('../core/handles.js');
const HAS = typeof EXT.spanHolds === 'function' ? false : 'the core does not export spanHolds yet (pane B, D642): the panel falls back to the full search';
const q95 = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))]; };
async function his(early) {
  const p = await mount(); p.type('length m', 1000); p.type('turn °', -90); p.type('bank °', 88.45); p.type('cup °', 15.5); p.type('width m', 31);
  if (early) { const box = p.root.all().find((e) => e.tagName === 'INPUT' && e.attrs.type === 'checkbox' && e.attrs['aria-label'] === 'bank at the start'); assert.ok(box, 'the bank\'s "early" box'); box.checked = true; (box.onchange || box.onclick)(); p.tick(); }
  return p;
}
// E's drag toward level on the extra bank: ms a move, and what it ended at
function dragBack(p, step = 8) {
  const ids = p.panel.extraHandles().filter((e) => e.field === 'bank').map((e) => e.id), h = p.panel.handles.handles().find((x) => x.screen && ids.includes(x.kind));
  assert.ok(h, 'the extra bank handle is on screen');
  const s = h.screen, n = Math.hypot(s.dx, s.dy) || 1, ux = s.dx / n, uy = s.dy / n, ts = [];
  p.stage.fire('pointerdown', { clientX: s.x, clientY: s.y, pointerId: 1, button: 0 });
  for (let i = 1; i <= 60; i++) { const t0 = process.hrtime.bigint(); p.stage.fire('pointermove', { clientX: s.x - ux * step * i, clientY: s.y - uy * step * i, pointerId: 1, timeStamp: i * 16 }); p.tick(); ts.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  p.stage.fire('pointerup', { clientX: s.x - ux * step * 60, clientY: s.y - uy * step * 60, pointerId: 1 }); p.tick();
  const c = (p.panel.options().changes || {}).phi;
  return { p95: q95(ts), ended: c ? +(c[0].target / DEG).toFixed(2) : null };
}

test('D642: dragging the extra bank back toward level on his p2 (a moving first ramp), the first time, costs a move within 2 × the same drag with the bank early (p95)', { todo: HAS }, async (t) => {
  const drag = async (early) => { const p = await his(early), r = dragBack(p); p.panel.unmount(); return r; };
  await drag(true);   // warm the panel's code, not the probe memo (an early drag builds no probe)
  const rolling = await drag(false), early = [await drag(true), await drag(true)];
  const e = Math.min(...early.map((x) => x.p95));
  t.diagnostic(`rolling (first drag) p95 ${rolling.p95.toFixed(1)} ms a move, early p95 ${e.toFixed(1)} ms: ${(rolling.p95 / e).toFixed(2)} ×; both ended at ${rolling.ended}°`);
  assert.equal(rolling.ended, early[0].ended, 'both drags end at the same bank (like for like)');
  assert.ok(rolling.p95 <= 2 * e, `the rolling drag's p95 is ${rolling.p95.toFixed(1)} ms a move, the early drag's ${e.toFixed(1)} ms: ${(rolling.p95 / e).toFixed(2)} ×, over 2 ×`);
});

// D642, E's review of 212e78d §2 (lighthouse exo_memory/handback/p-d642-c4-review-E_2026-11-05.md): the row above stops at −12.63°, before the hold, so it never reads the
// probe. A drag carried on PAST what fits (60 moves of 24 px: E held it at −129.55) ran a step of the hold's search every move, 2.5-3 × the early drag. The same bar, the
// same order (the code warm, the memo cold). The early piece has no moving first ramp, so its drag ends elsewhere: no like-for-like end, but the rolling one must be HELD.
// MEASURED (pane C, per move, scratch permove.js): the hold itself is cheap since the edge is kept (moves after it 0.3 ms median, 3.8 ms on 212e78d), and its p95 is set by
// the APPROACH: each of the ~9 moves from about −41° to −127° lands in a new 1° cell between the ceiling and the edge and builds ONE probe road (about 11 ms a move), the
// panel's floor (one question a move; the ghost's own extend reads the same cell from the memo). Holding it to 2 × needs a cheaper probe in the core, not the panel
const INTO_HOLD = HAS || 'the approach to the hold builds one probe road a move (the core\'s probe cost, pane B): 2.8-3.1 × measured, the panel already at one question a move';
test('D642: dragging the extra bank on past what fits, into the hold, the first time, costs a move within 2 × the same drag with the bank early (p95)', { todo: INTO_HOLD }, async (t) => {
  const drag = async (early) => { const p = await his(early), r = dragBack(p, 24); p.panel.unmount(); return r; };
  await drag(true);
  const rolling = await drag(false), early = [await drag(true), await drag(true)];
  const e = Math.min(...early.map((x) => x.p95));
  t.diagnostic(`rolling (first drag, into the hold) p95 ${rolling.p95.toFixed(1)} ms a move, early p95 ${e.toFixed(1)} ms: ${(rolling.p95 / e).toFixed(2)} ×; rolling held at ${rolling.ended}°, early ended at ${early[0].ended}°`);
  assert.ok(rolling.ended > -360 && rolling.ended < -88.45, `the rolling drag went past −88.45 and is held short of where the pointer went (${rolling.ended}°)`);
  assert.ok(rolling.p95 <= 2 * e, `the rolling drag's p95 is ${rolling.p95.toFixed(1)} ms a move, the early drag's ${e.toFixed(1)} ms: ${(rolling.p95 / e).toFixed(2)} ×, over 2 ×`);
});

test('D642: his p2\'s extra bank still reaches −88.45° from 500 (the bank-back he asked for), laid by the core', { todo: HAS }, async () => {
  const p = await his(false), x = p.panel.extraHandles().find((e) => e.field === 'bank' && e.unused); assert.ok(x, 'the unused extra bank');
  p.panel.secondExtra(x.id, -88.45); p.tick();
  assert.deepEqual(p.changes().phi.map((c) => ({ from: c.from, deg: +(c.target / DEG).toFixed(2) })), [{ from: 500, deg: -88.45 }], 'from 500, all the way to −88.45');
  assert.equal(p.refusal(), null, 'the core lays it');
  p.panel.unmount();
});

// D642 3j THROUGH THE PANEL (pane E's review a99775ef §1; the librarian's ruling on B's §9: a monotone shortest cannot work, the built roll spikes at single spans). His p2's
// extra bank made at −88.45 from 500, then its MARK dragged (panel.secondDrag, the mark-drag path) to every from 420…540: wherever the panel keeps it, the core lays it. On
// 31bbc64 15 of 121 kept positions are refused (441, 442, 445, 462, 482-485, 501, 503, 504, 521-523, 525): the clamp kept any span at or past the shortest, and some of those
// fail on the built road; the piece vanished on screen a metre off 500
test('D642 3j: his p2\'s extra bank mark, dragged across 420-540 through the panel, lays at every from the panel keeps', { todo: HAS }, async (t) => {
  const p = await his(false), x = p.panel.extraHandles().find((e) => e.field === 'bank' && e.unused); assert.ok(x, 'the unused extra bank');
  p.panel.secondExtra(x.id, -88.45); p.tick(); assert.equal(p.refusal(), null, 'made at −88.45 from 500 and laid');
  const refused = [], kept = new Set();
  for (let F = 420; F <= 540; F++) { p.panel.secondDrag({ field: 'bank', index: 0 }, F); p.tick(); const c = p.changes().phi; kept.add(c[0].from); if (p.refusal() !== null) refused.push(`${F}→${c[0].from}`); }
  t.diagnostic(`kept ${kept.size} distinct froms; refused ${refused.length}`);
  assert.deepEqual(refused, [], `asked → kept, refused by the core: ${refused.join(', ')}`);
  p.panel.unmount();
});
