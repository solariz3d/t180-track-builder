// sculpt-subscribers.test.js: node --test app/test/sculpt-subscribers.test.js
// D421 part 5 step 2 (C's profile of a 10 km brush drag, exo_memory/handback/p-d421-freeze-C_2026-10-20.md §5: the page's own subscribers, not the brush, were the cost of a step): the layers
// that read the whole track on every change keep what they show while a sculpt drag is open, and read the track as it is once it is let go, in a frame after the release, not inside it.
// On a small fake DOM with the REAL shell (createCoreShell, E's brush). Rows:
//   1  the readout labels: while the drag is open the head's label reads the track as the drag began (pieceReadouts is not read again, 0 calls); after the release, the next frame
//      reads the track as let go, and the head's label is that track's own readout
//   2  the start-and-grid marks: while the drag is open spawnsInfo is not asked (0 calls) and the marks stay those of the track as the drag began; the release does not ask either
//      (the pointer-up stays cheap); the next frame asks once, and the marks are the let-go track's own, mark for mark
//   3  outside a drag nothing waits: a placement updates both layers in the very next frame, as before
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const LB = require('../core/labels.js');
const SPL = require('../core/spawnslayer.js');
const { toPath } = require('../../src/core/adapter.js');

// ── the smallest fake DOM the two layers mount on: elements with style and children, events on the document, frames run by tick() ──
class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.parent = null; }
  append(...k) { for (const c of k) { if (c == null) continue; c.parent = this; this.children.push(c); } }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth || 0, height: this.clientHeight || 0 }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return !!e.isRoot; }
  get offsetWidth() { return this.isConnected ? 9 * Math.max(...this.textContent.split('\n').map((l) => l.length)) + 16 : 0; }
  get offsetHeight() { return this.isConnected ? 20 * this.textContent.split('\n').length + 8 : 0; }
  // a canvas: a 2D context that only records, enough for the spawns layer to draw its marks
  getContext() { if (this.tagName !== 'CANVAS') return null; const n = () => {}; return { setTransform: n, clearRect: n, beginPath: n, moveTo: n, lineTo: n, closePath: n, stroke: n, fill: n, fillRect: n, fillText: n, measureText: () => ({ width: 10 }), save: n, restore: n }; }
}
function fakePage() {
  const doc = { listeners: {}, createElement: (t) => new El(t, doc) };
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const frames = [];
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {}, devicePixelRatio: 1 };
  doc.defaultView = win;
  const stage = doc.createElement('div'); stage.clientWidth = 900; stage.clientHeight = 600; stage.isRoot = true;
  return { doc, win, stage, tick: () => { const fs = frames.splice(0); for (const f of fs) f(0); } };
}
/** the real shell, counted: how many times each whole-track read is asked */
function counted(real) {
  const n = { pieceReadouts: 0, spawnsInfo: 0 };
  return { n, shell: Object.assign(Object.create(real), { pieceReadouts(...a) { n.pieceReadouts++; return real.pieceReadouts(...a); }, spawnsInfo(...a) { n.spawnsInfo++; return real.spawnsInfo(...a); } }) };
}
/** a track of 12 pieces, the head last; the preview's answers (the path, the view over the head) follow the shell's state */
async function page() {
  const real = await createCoreShell({ autosaveMs: 0 });
  real.extend({ length: 300, family: 'bowl' }); for (let i = 1; i < 12; i++) real.extend({ length: 100, transition: 40, targets: { kh: (i % 2 ? 1 : -1) / 400 } });
  assert.equal(real.getState().history.present.pieces.length, 12, real.getState().message);
  const P = fakePage(), { n, shell } = counted(real);
  const trackOf = () => { const tp = toPath(real.getState().history.present, { step: 2 }); return { path: tp.path, segments: tp.segments }; };
  let track = trackOf();
  P.doc.addEventListener('t180:track-request', (e) => e.detail.reply(track));
  P.doc.addEventListener('t180:view', (e) => { const h = track.path.head; e.detail.reply({ pose: { eye: [h.pos[0], h.pos[1] + 900, h.pos[2] - 1], target: h.pos, up: [0, 0, 1], fov: Math.PI / 3 }, mode: 'overhead', head: { pos: h.pos, T: h.T } }); });
  real.subscribe(() => { track = trackOf(); });
  const labels = LB.mount(P.stage, shell, P.win), marks = SPL.mount(P.stage, shell, P.win);
  P.tick();
  return { ...P, real, shell, n, labels, marks };
}
const headText = (T) => { const d = T.real.getState().history.present, i = d.pieces.length - 1, L = T.labels.labels().find((x) => x.piece === d.pieces[i].id); return L ? L.text : null; };
const readText = (T, d) => LB.labelText(require('../../src/core/readout.js').pieceReadout(d, d.pieces.length - 1)).join('\n');
const marksOf = (T) => T.marks.drawn().map((m) => `${m.kind} ${m.label} ${m.bad}`);

test('row 1: the labels hold the head\'s readout while a sculpt drag is open, and read the let-go track in the next frame', async () => {
  const T = await page(), d0 = T.real.getState().history.present, s0 = d0.pieces.slice(0, -1).reduce((a, p) => a + p.length, 0) + 50;
  const before = headText(T); assert.equal(before, readText(T, d0), 'before the drag the head\'s label is its readout');
  T.real.beginBrush({ mode: 'rate', channel: 'phi', s0, r: 50 }); assert.ok(T.real.getState().brush, T.real.getState().message);
  const asked = T.n.pieceReadouts;
  for (let k = 1; k <= 6; k++) { T.real.brushTo(0.05 * k); assert.equal(T.real.getState().messageKind === 'error', false, T.real.getState().message); T.tick(); }
  assert.equal(T.n.pieceReadouts - asked, 0, 'pieceReadouts was read during the drag');
  assert.equal(headText(T), before, 'during the drag the head\'s label is the readout of the track as the drag began');
  T.real.endBrush(); const d1 = T.real.getState().history.present;
  assert.notEqual(readText(T, d1), before, 'the drag changed the head\'s bank (so the row can tell the two apart)');
  T.tick();
  assert.equal(T.n.pieceReadouts - asked, 1, 'the frame after the release reads the track once');
  assert.equal(headText(T), readText(T, d1), 'after the release the head\'s label is the let-go track\'s own readout');
});

test('row 2: the start-and-grid marks are not asked for during a sculpt drag nor in its release, and are the let-go track\'s own in the next frame', async () => {
  const T = await page(), before = marksOf(T);
  assert.ok(before.some((m) => /^line START/.test(m)), `the automatic start line is drawn: ${JSON.stringify(before)}`);
  T.real.beginBrush({ mode: 'local', channel: 'height', s0: 150, r: 120 }); assert.ok(T.real.getState().brush, T.real.getState().message);   // a hill on the first piece, where the start is
  const asked = T.n.spawnsInfo;
  for (let k = 1; k <= 6; k++) { T.real.brushTo(0.5 * k); T.tick(); }
  assert.equal(T.n.spawnsInfo - asked, 0, 'spawnsInfo was asked during the drag');
  assert.deepEqual(marksOf(T), before, 'during the drag the marks are those of the track as the drag began');
  T.real.endBrush();
  assert.equal(T.n.spawnsInfo - asked, 0, 'the release itself asked for spawnsInfo (it belongs in a later frame, not the pointer-up)');
  T.tick();
  assert.equal(T.n.spawnsInfo - asked, 1, 'the frame after the release asks once');
  const fresh = fakePage(); fresh.doc.listeners = T.doc.listeners; const again = SPL.mount(fresh.stage, T.real, fresh.win); fresh.tick();
  assert.deepEqual(T.marks.drawn(), again.drawn(), 'the marks after the release are, mark for mark, those a layer mounted on the let-go track draws');
});

test('row 2b: the start\'s hover (app/core/spawndrag.js) does not ask for spawnsInfo while a sculpt drag owns the pointer, and does again once it is let go', async () => {
  const T = await page(), SPD = require('../core/spawndrag.js');
  const pose = () => { const h = T.real.getState().resolved ? toPath(T.real.getState().history.present, { step: 2 }).path.head : null; return h ? { eye: [h.pos[0], h.pos[1] + 900, h.pos[2] - 1], target: h.pos, up: [0, 0, 1], fov: Math.PI / 3 } : null; };
  const hov = SPD.mount(T.stage, T.win, T.shell, { pose }); hov.late();
  const move = (x, y) => { for (const f of (T.stage.listeners.pointermove || []).slice()) f({ clientX: x, clientY: y, button: 0, preventDefault() {} }); };
  T.real.beginBrush({ mode: 'local', channel: 'height', s0: 150, r: 120 }); assert.ok(T.real.getState().brush, T.real.getState().message);
  const asked = T.n.spawnsInfo;
  for (let k = 1; k <= 6; k++) { T.real.brushTo(0.5 * k); move(400 + k, 300); }
  assert.equal(T.n.spawnsInfo - asked, 0, 'the hover asked for spawnsInfo while the brush held the pointer');
  T.real.endBrush(); move(420, 300);
  assert.equal(T.n.spawnsInfo - asked, 1, 'after the release the hover looks for a mark again (once, for the let-go track)');
  hov.unmount();
});

test('row 3: outside a drag nothing waits: a placement shows in both layers in the very next frame', async () => {
  const T = await page(), a = { r: T.n.pieceReadouts, s: T.n.spawnsInfo };
  T.real.extend({ length: 150, transition: 40, targets: { kh: 1 / 300 } }); T.tick();
  assert.equal(T.n.pieceReadouts - a.r, 1, 'the labels read the new track in the next frame');
  assert.equal(T.n.spawnsInfo - a.s, 1, 'the marks asked for the new track in the next frame');
  assert.equal(headText(T), readText(T, T.real.getState().history.present), 'the new head is labelled with its own readout');
});
