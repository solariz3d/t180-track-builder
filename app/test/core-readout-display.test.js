// core-readout-display.test.js: node --test app/test/core-readout-display.test.js
// THE READOUT DISPLAY (L130, pane C): the strings (app/core/labels.js formatReadout), the label layout (the head's keep-out, no
// overlaps), the anchors, the shell's readouts (A's src/core/readout.js), and the PANEL mounted on a small fake DOM, read back
// as the TEXT it shows. E's sealed check (readout_check_registration_2026-09-29.md) is scored by a non-author seat; these are the
// author's own tests of the same properties, not that score.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const LB = require('../core/labels.js');
const { createCoreShell } = require('../core/coreshell.js');
const RD = require('../../src/core/readout.js');
const { extendOptions } = require('../core/panel.js');

// ── a small fake DOM: enough for the panel and the label layer ──
class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.parent = null; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }   // the removed are out of the page
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth || 0, height: this.clientHeight || 0 }; }
  // as a browser: an element not in the page measures 0 (found in the real window, L130: the preview's mount cleared #preview)
  get isConnected() { let e = this; while (e.parent) e = e.parent; return !!e.isRoot; }
  get offsetWidth() { if (!this.isConnected) return 0; return 9 * Math.max(...this.textContent.split('\n').map((l) => l.length)) + 16; }   // 9 px a character
  get offsetHeight() { if (!this.isConnected) return 0; return 20 * this.textContent.split('\n').length + 8; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}
function fakeWindow() {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const frames = [];
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {}, setTimeout: (f) => 0, clearTimeout: () => {}, frames };
  doc.defaultView = win;
  return { doc, win, tick: () => { const fs = frames.splice(0); for (const f of fs) f(0); } };
}
async function mountPanel() {
  const { doc, win, tick } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 900; stage.clientHeight = 600; stage.isRoot = true;
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  const panel = require('../core/panel.js').mount(root, shell);
  const field = (label) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === label).children[1];
  const cell = (k) => root.all().find((e) => e.attrs['data-readout'] === k).textContent;
  const type = (label, v) => { const f = field(label); f.value = String(v); f.oninput(); };
  const opts = () => extendOptions({ length: field('length m').value, turn: field('turn °/100m').value, climb: field('climb °/100m').value, bank: field('bank °').value, width: field('width m').value });
  return { doc, win, tick, stage, root, shell, panel, field, cell, type, opts };
}

test('the strings: one decimal, the unit written, a sign on angles, 0.0° bare, half away from zero, no wrap', () => {
  assert.equal(LB.fmtDeg(0.04), '0.0°'); assert.equal(LB.fmtDeg(-0.04), '0.0°'); assert.equal(LB.fmtDeg(0), '0.0°');
  assert.equal(LB.fmtDeg(0.06), '+0.1°'); assert.equal(LB.fmtDeg(-3), '−3.0°'); assert.equal(LB.fmtDeg(720), '+720.0°');
  assert.equal(LB.fmtDeg(-33.35), '−33.4°', 'half away from zero'); assert.equal(LB.fmtDeg(2.25), '+2.3°');
  // the guard is for COMPUTED values (A's integrals): a quarter that came out 2e-13 short still rounds as the half it is. (A typed
  // two-decimal half never needs it: 0 of 8,010 such values round differently without it, measured in scratchpad l130/halves.js.)
  assert.equal(LB.fmtDeg(0.25 - 2e-13), '+0.3°'); assert.equal(LB.fmtDeg(-(12.45 - 2e-12)), '−12.5°');
  assert.equal(LB.fmtM(150), '150.0 m'); assert.equal(LB.fmtM(0.04), '0.0 m');
  const f = LB.formatReadout({ lengthM: 60, turnDeg: 45, climbDeg: 8, bankFromDeg: 10, bankToDeg: -5 });
  assert.deepEqual(f, { length: '60.0 m', turn: '+45.0°', climb: '+8.0°', bank: '−15.0°' }, 'bank is the CHANGE: to − from');
});

test('the layout: never over the head\'s keep-out, never two labels overlapping, the priority one placed first, a crowded one culled', () => {
  const view = { width: 400, height: 300, head: { x: 200, y: 150, r: 30 } };
  const at = (piece, x, y, priority) => ({ piece, text: piece, x, y, w: 120, h: 40, priority });
  const r = LB.layout([at('far', 205, 155, 5), at('head', 200, 150, -1), at('b', 210, 160, 3), at('c', 190, 140, 4)], view);
  assert.equal(r.drawn[0].piece, 'head', 'the head\'s own piece is placed first');
  const keep = { x: 170, y: 120, w: 60, h: 60 }, hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const d of r.drawn) { assert.ok(!hits(d.rect, keep), `${d.piece} covers the head`); assert.ok(d.rect.x >= 0 && d.rect.y >= 0 && d.rect.x + d.rect.w <= 400 && d.rect.y + d.rect.h <= 300); }
  for (let i = 0; i < r.drawn.length; i++) for (let j = i + 1; j < r.drawn.length; j++) assert.ok(!hits(r.drawn[i].rect, r.drawn[j].rect), 'no overlap');
  const crowd = LB.layout(Array.from({ length: 40 }, (_, i) => at(`p${i}`, 200, 150, i)), view);
  assert.ok(crowd.culled.length > 0 && crowd.drawn.length + crowd.culled.length === 40, 'what does not fit is culled, and said');
});

// FOUND IN THE REAL WINDOW (L130, fourth capture): at the nearest zoom the head's keep-out is ~105 px and the head's own label is
// anchored ON the head, so every near place lay inside the keep-out and the label was culled
test('the layout: a label anchored on a large head keep-out is placed clear of it, not culled', () => {
  const view = { width: 655, height: 525, head: { x: 330, y: 400, r: 100 } };
  const r = LB.layout([{ piece: 'head', text: 'head', x: 332, y: 404, w: 290, h: 47, priority: -1 }], view);
  assert.deepEqual(r.culled, [], 'the head\'s label is drawn');
  const d = r.drawn[0].rect, keep = { x: 230, y: 300, w: 200, h: 200 };
  assert.ok(!(d.x < keep.x + keep.w && keep.x < d.x + d.w && d.y < keep.y + keep.h && keep.y < d.y + d.h), 'and clear of the keep-out');
});

test('the shell\'s readouts are A\'s, once per document; the ghost\'s strings are the placed piece\'s strings', async () => {
  const s = await createCoreShell({ brushFn: null });
  for (const o of [{ length: 100 }, { length: 150, targets: { kh: Math.PI / 2 / 150 } }, { length: 60, targets: { kh: 0.01, kv: 0.002, phi: -0.2 } }]) {
    const ghost = LB.formatReadout(s.candidateReadout(o)); s.extend(o);
    const d = s.getState().history.present, placed = LB.formatReadout(s.pieceReadouts().at(-1));
    assert.deepEqual(placed, ghost, 'ghost = placed, string for string');
    assert.deepEqual(s.pieceReadouts().at(-1), RD.pieceReadout(d, d.pieces.length - 1), 'the numbers are A\'s');
  }
  assert.equal(s.pieceReadouts(), s.pieceReadouts(), 'computed once per document');
});

test('the panel shows the ghost\'s four numbers, and they follow every field inside its input handler (no timer, no frame)', async () => {
  const P = await mountPanel();
  P.shell.extend({ length: 200 });
  const script = [['length m', 150], ['turn °/100m', 60], ['bank °', 30], ['climb °/100m', -8], ['turn °/100m', -45], ['length m', 20], ['bank °', ''], ['turn °/100m', 0.04]];
  for (const [label, v] of script) {
    P.type(label, v);
    const want = LB.formatReadout(RD.candidateReadout(P.shell.getState().history.present, P.opts()));
    for (const k of ['length', 'turn', 'climb', 'bank']) assert.equal(P.cell(k), want[k], `${label} = ${v}: ${k}`);
  }
  P.panel.unmount();
});

test('the panel: a field set extend refuses shows — (and says why in the title); a closed loop shows —; after Extend the ghost is the NEXT piece', async () => {
  const P = await mountPanel();
  P.shell.extend({ length: 200 });
  P.type('length m', -5); assert.equal(P.cell('length'), '—');
  P.type('length m', 120); assert.equal(P.cell('length'), '120.0 m');
  const before = P.cell('turn'); P.shell.extend(P.opts());
  assert.equal(LB.formatReadout(P.shell.pieceReadouts().at(-1)).turn, before, 'what the panel promised is what was placed');
  P.panel.unmount();
});

test('the labels on the track: one per road piece, the text A\'s numbers, clear of the head; a flight and an empty track draw none and throw nothing', async () => {
  const P = await mountPanel();
  const { buildPath } = require('../../src/geom/index.js'), { toPath } = require('../../src/core/adapter.js');
  let track = null, view = null;
  P.doc.addEventListener('t180:track-request', (e) => e.detail.reply(track));
  P.doc.addEventListener('t180:view', (e) => e.detail.reply(view));
  P.tick(); assert.deepEqual(P.panel.labels.labels(), [], 'nothing placed: no label');
  for (const o of [{ length: 200 }, { length: 150, targets: { kh: 0.01 } }, { length: 180, targets: { kh: 0 } }]) P.shell.extend(o);
  const d = P.shell.getState().history.present, tp = toPath(d, { step: 2 });
  track = { path: tp.path, segments: tp.segments };
  const h = tp.path.head, eye = [h.pos[0], h.pos[1] + 900, h.pos[2] - 1], pose = { eye, target: h.pos, up: [0, 0, 1], fov: Math.PI / 3 };
  view = { pose, mode: 'overhead', head: { pos: h.pos, T: h.T } };
  P.tick();
  const L = P.panel.labels.labels();
  assert.equal(L.length + P.panel.labels.culled().length, 3, 'every road piece is labelled or culled');
  assert.ok(L.some((x) => x.piece === d.pieces[2].id), 'the head\'s own piece is drawn');
  for (const x of L) {
    const i = d.pieces.findIndex((p) => p.id === x.piece), want = LB.labelText(RD.pieceReadout(d, i)).join('\n');
    assert.equal(x.text, want);
  }
  const M = require('../camera/math.js'), c = M.apply(M.viewProj(pose, 900 / 600), h.pos), hx = (c[0] / c[3] * 0.5 + 0.5) * 900, hy = (1 - (c[1] / c[3] * 0.5 + 0.5)) * 600;
  for (const x of L) assert.ok(!(hx + 6 > x.rect.x && hx - 6 < x.rect.x + x.rect.w && hy + 6 > x.rect.y && hy - 6 < x.rect.y + x.rect.h), `${x.piece} covers the head`);
  // a flight: no label on it, and nothing throws
  const Dm = require('../../src/core/document.js'), { extend } = require('../../src/core/extend.js');
  const withJump = extend(Dm.appendPiece(d, Dm.flightPiece({ gap: 30, drop: 2, land: 0 })), { length: 120 });
  P.shell.adopt(withJump); const tj = toPath(withJump, { step: 2 }); track = { path: tj.path, segments: tj.segments };
  assert.doesNotThrow(() => P.tick());
  const flightId = withJump.pieces.find((p) => p.type === 'flight').id;
  assert.ok(!P.panel.labels.labels().some((x) => x.piece === flightId), 'a flight has no label');
  P.panel.unmount();
});

// FOUND IN THE REAL WINDOW (L130, second capture): the build view looks ahead from 15 m behind the head, so the head's own piece's
// MIDDLE is behind the camera and it drew no label at all (E's M5 (d): the head's piece is labelled at every zoom). A label now
// slides along its piece to the part that is on screen.
test('the head\'s own piece is labelled in the build view, where its middle is behind the camera', async () => {
  const P = await mountPanel(), { toPath } = require('../../src/core/adapter.js'), { headCamera } = require('../../src/geom/index.js');
  let track = null, view = null;
  P.doc.addEventListener('t180:track-request', (e) => e.detail.reply(track));
  P.doc.addEventListener('t180:view', (e) => e.detail.reply(view));
  for (const o of [{ length: 250 }, { length: 220, targets: { kh: 0.005 } }, { length: 180, targets: { kh: 0 } }]) P.shell.extend(o);
  const d = P.shell.getState().history.present, tp = toPath(d, { step: 2 }), h = tp.path.head;
  track = { path: tp.path, segments: tp.segments };
  view = { pose: { ...headCamera(h, { back: 15, up: 6 }), fov: Math.PI / 3 }, mode: 'build', head: { pos: h.pos, T: h.T } };
  P.tick();
  const L = P.panel.labels.labels(), headPiece = d.pieces[d.pieces.length - 1].id;
  assert.ok(L.some((x) => x.piece === headPiece), `the head's piece is drawn (drawn: ${L.map((x) => x.piece).join(', ') || 'none'})`);
  P.panel.unmount();
});

// FOUND IN THE REAL WINDOW (L130): (1) the preview extends its path IN PLACE, so labels cached by the path object kept the first
// piece's anchors forever (1 label for 5 pieces); (2) the preview's mount clears #preview after the panel mounted, which detached
// the label layer (every label measured 0 x 0 and none was painted). Both reproduced here with the preview's own track model.
test('the labels follow a path the preview extends IN PLACE, and survive the preview clearing #preview after they mounted', async () => {
  const P = await mountPanel(), { createTrackModel } = require('../preview/trackmodel.js'), tm = createTrackModel();
  let track = null, view = null;
  P.doc.addEventListener('t180:track-request', (e) => e.detail.reply(track));
  P.doc.addEventListener('t180:view', (e) => e.detail.reply(view));
  P.stage.replaceChildren();   // what the preview's mount does to #preview after the panel has mounted the layer
  const place = (o) => { P.shell.extend(o); const r = tm.update(P.shell.getState().resolved); track = { path: r.path, segments: r.segments }; };
  place({ length: 250 });
  const pathObj = track.path;
  const look = () => { const h = track.path.head; view = { pose: { eye: [h.pos[0] - 150, h.pos[1] + 2500, h.pos[2] - 150], target: [h.pos[0] - 150, 0, h.pos[2] - 150], up: [0, 0, 1], fov: Math.PI / 3 }, mode: 'overhead', head: { pos: h.pos, T: h.T } }; };
  look(); P.tick();
  for (const o of [{ length: 220, targets: { kh: 0.005 } }, { length: 220 }, { length: 300, targets: { kh: -0.004 } }, { length: 180, targets: { kh: 0 } }]) place(o);
  assert.equal(track.path, pathObj, 'the same path object, extended in place (the preview\'s own behaviour)');
  look(); P.tick();
  const L = P.panel.labels.labels(), C = P.panel.labels.culled();
  assert.equal(L.length + C.length, 5, `every piece is labelled or culled (drawn ${L.length}, culled ${C.length})`);
  assert.ok(L.length >= 2, 'more than the first piece is drawn');
  for (const x of L) assert.ok(x.rect.w > 0 && x.rect.h > 0, `${x.piece} has a size: the layer is in the page`);
  P.panel.unmount();
});
