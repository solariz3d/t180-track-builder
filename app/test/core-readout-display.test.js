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
async function mountPanel(wrap = (s) => s) {
  const { doc, win, tick } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 900; stage.clientHeight = 600; stage.isRoot = true;
  const root = doc.createElement('div'), shell = wrap(await createCoreShell({ brushFn: null }));
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => label(text).children[1];
  const cell = (k) => root.all().find((e) => e.attrs['data-readout'] === k).textContent;
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); };
  const opts = () => extendOptions({ length: field('length m').value, turn: field('turn °/100m').value, climb: field('climb °/100m').value, bank: field('bank °').value, width: field('width m').value, cup: label('cup °') ? field('cup °').value : '' });
  return { doc, win, tick, stage, root, shell, panel, label, field, cell, type, opts };
}

// THE STUB (D190): A's core, which adds the channel c, cupFromDeg / cupToDeg and Extend's target c, does not exist at c964c2d. These
// tests stand in for it with stubCup(shell), which wraps the REAL shell and does exactly three things, nothing else:
//   1. it removes targets.c before the real core sees it (c964c2d refuses an unknown channel), and keeps what c was asked for;
//   2. it adds cupFromDeg / cupToDeg to the real readouts from its own record: a legacy piece reads 11.679 (the rendered edge E's seal
//      row 7 names for F3), and a piece given a cup reads the target PLUS 0.871 (the Extend fit ringing past it, E's V5), so a panel
//      that shows the typed value instead of the document's is caught;
//   3. it refuses a target outside [0, 150] by name, as the core's document guard will (E's row 2); the panel must not clamp first.
// It also records every options object the panel hands the core (sent), so a test can read what went in.
const LEGACY_EDGE = 11.679, RING = 0.871;
function stubCup(real) {
  const cupOf = new Map(), sent = [];
  const strip = (o) => { const { c, ...rest } = (o && o.targets) || {}; return { o: { ...o, targets: rest }, c }; };
  const guard = (c) => { if (c !== undefined && !(c >= 0 && c <= 150)) throw new Error(`cup ${c}° is outside 0–150 (the core refuses it: stub)`); };
  const lastTo = () => { const P = real.getState().history.present.pieces; const id = P.length ? P[P.length - 1].id : null; return id && cupOf.has(id) ? cupOf.get(id)[1] : LEGACY_EDGE; };
  const withCup = (r, from, to) => ({ ...r, cupFromDeg: from, cupToDeg: to });
  return Object.assign(Object.create(real), {
    sent,
    candidateReadout(o) { sent.push(o); const { o: bare, c } = strip(o); guard(c); const from = lastTo(); return withCup(real.candidateReadout(bare), from, c === undefined ? from : c + RING); },
    candidate(o) { return real.candidate(strip(o).o); },
    extend(o) { sent.push(o); const { o: bare, c } = strip(o); guard(c); const from = lastTo(); real.extend(bare); const P = real.getState().history.present.pieces; cupOf.set(P[P.length - 1].id, [from, c === undefined ? from : c + RING]); },
    pieceReadouts() { return real.pieceReadouts().map((r) => withCup(r, ...(cupOf.get(r.id) || [LEGACY_EDGE, LEGACY_EDGE]))); },
  });
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

// B'S SCORE (D187): the head's own label was MISSING in 6 of 15 states (E's M5 (d): "at least the label of the piece ending at the
// head is drawn"). Near the view's edge every ring around its anchor can fail; the head's label is then placed elsewhere in the
// view, never culled, and still clear of the head (E's M4: the head's point and 6 px inside no label).
test('the layout: the head\'s own label is never culled, even where no ring around its anchor fits; it stays clear of the head', () => {
  const view = { width: 320, height: 240, head: { x: 10, y: 10, r: 24 } };
  const r = LB.layout([{ piece: 'head', text: 'head', x: 10, y: 10, w: 290, h: 47, priority: -1, head: true }], view);
  assert.deepEqual(r.culled, [], 'the head\'s label is not culled');
  const d = r.drawn[0].rect;
  assert.ok(d.x >= 0 && d.y >= 0 && d.x + d.w <= 320 && d.y + d.h <= 240, 'inside the view');
  assert.ok(!(10 + 6 > d.x && 10 - 6 < d.x + d.w && 10 + 6 > d.y && 10 - 6 < d.y + d.h), 'clear of the head\'s point and 6 px');
  // and the others make way for it: with the head's label placed first, a label that wants the same place moves or is culled
  const both = LB.layout([{ piece: 'other', text: 'o', x: 150, y: 60, w: 290, h: 47, priority: 1 }, { piece: 'head', text: 'head', x: 10, y: 10, w: 290, h: 47, priority: -1, head: true }], view);
  assert.ok(both.drawn.some((x) => x.piece === 'head'), 'the head\'s label is drawn beside another');
});

// R11's own test since D187: the head's piece now gets a label however little of it is in view, so only a piece that is NOT the
// head's shows whether a label slides along its piece to the part that is on screen
test('a piece whose middle is behind the camera is labelled on the part of it that is in view', async () => {
  const P = await mountPanel(), { toPath } = require('../../src/core/adapter.js');
  let track = null, view = null;
  P.doc.addEventListener('t180:track-request', (e) => e.detail.reply(track));
  P.doc.addEventListener('t180:view', (e) => e.detail.reply(view));
  for (const o of [{ length: 250 }, { length: 400 }, { length: 100 }]) P.shell.extend(o);
  const d = P.shell.getState().history.present, tp = toPath(d, { step: 2 }), h = tp.path.head;
  track = { path: tp.path, segments: tp.segments };
  const at = tp.path.samples.find((m) => m.s >= 520), look = at.pos.map((v, i) => v + at.T[i] * 100);   // inside piece 2 (250–650), past its middle
  view = { pose: { eye: [at.pos[0], at.pos[1] + 6, at.pos[2]], target: look, up: [0, 1, 0], fov: Math.PI / 3 }, mode: 'free', head: { pos: h.pos, T: h.T } };
  P.tick();
  const L = P.panel.labels.labels();
  assert.ok(L.some((x) => x.piece === d.pieces[1].id), `the middle piece is drawn (drawn: ${L.map((x) => x.piece).join(', ') || 'none'})`);
  P.panel.unmount();
});

test('the head\'s own piece is labelled even when none of it is on screen (the camera looks ahead, past the head)', async () => {
  const P = await mountPanel(), { toPath } = require('../../src/core/adapter.js');
  let track = null, view = null;
  P.doc.addEventListener('t180:track-request', (e) => e.detail.reply(track));
  P.doc.addEventListener('t180:view', (e) => e.detail.reply(view));
  for (const o of [{ length: 200 }, { length: 150, targets: { kh: 0.01 } }, { length: 180, targets: { kh: 0 } }]) P.shell.extend(o);
  const d = P.shell.getState().history.present, tp = toPath(d, { step: 2 }), h = tp.path.head;
  track = { path: tp.path, segments: tp.segments };
  const ahead = (k) => h.pos.map((v, i) => v + h.T[i] * k);
  view = { pose: { eye: [ahead(5)[0], h.pos[1] + 2, ahead(5)[2]], target: ahead(500), up: [0, 1, 0], fov: Math.PI / 3 }, mode: 'free', head: { pos: h.pos, T: h.T } };
  P.tick();
  const L = P.panel.labels.labels(), headPiece = d.pieces[d.pieces.length - 1].id, got = L.find((x) => x.piece === headPiece);
  assert.ok(got, `the head's piece is drawn (drawn: ${L.map((x) => x.piece).join(', ') || 'none'})`);
  assert.ok(got.rect.x >= 0 && got.rect.y >= 0 && got.rect.x + got.rect.w <= 900 && got.rect.y + got.rect.h <= 600, 'inside the view');
  assert.equal(got.text, LB.labelText(RD.pieceReadout(d, d.pieces.length - 1)).join('\n'), 'with A\'s numbers');
  P.panel.unmount();
});

// B'S SCORE (D187): contrast under 4.5 : 1 on labels over bright road. E's M5 (b) is measured in pixels: every pixel in the label's
// rectangle that differs from its median background counts as INK, and the median ink pixel is held against the background. So the
// box must hold only its background and its text: an opaque background (no road bleeding in), no border and no rounded corners (the
// road showed through them), and text far from the background.
test('the label box holds only an opaque background and its text: no border, square corners, contrast ≥ 4.5 : 1', async () => {
  const P = await mountPanel(), { toPath } = require('../../src/core/adapter.js');
  let track = null, view = null;
  P.doc.addEventListener('t180:track-request', (e) => e.detail.reply(track));
  P.doc.addEventListener('t180:view', (e) => e.detail.reply(view));
  P.shell.extend({ length: 200 });
  const d = P.shell.getState().history.present, tp = toPath(d, { step: 2 }), h = tp.path.head;
  track = { path: tp.path, segments: tp.segments };
  view = { pose: { eye: [h.pos[0], h.pos[1] + 900, h.pos[2] - 1], target: h.pos, up: [0, 0, 1], fov: Math.PI / 3 }, mode: 'overhead', head: { pos: h.pos, T: h.T } };
  P.tick();
  // the label's own box: the element holding the text itself (the layer around it has the same textContent, through its child)
  const box = P.stage.all().find((e) => e.children.length === 0 && e.textContent === P.panel.labels.labels()[0].text && e.style.cssText), css = box.style.cssText;
  const prop = (k) => { const m = new RegExp(`(?:^|;)${k}:([^;]+)`).exec(css); return m ? m[1].trim() : null; };
  const bg = prop('background'), fg = prop('color');
  assert.match(bg, /^#[0-9a-f]{6}$/i, `the background is an opaque colour (got ${bg})`);
  assert.ok(prop('border') === '0' || prop('border') === 'none', `no border (got ${prop('border')})`);
  assert.equal(prop('border-radius'), '0', 'square corners');
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)), lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (c) => { const [r, g, b] = rgb(c).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }, a = L(fg), b = L(bg);
  assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, 'text against background ≥ 4.5 : 1');
  P.panel.unmount();
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

// ── D190, THE CUP (E's seal row 7, the UI half). A's core is stubbed: see stubCup above for exactly what it stands in for ──

test('extendOptions: the cup field is the target c, in DEGREES, typed as it is (0 is a target; empty continues; never clamped here)', () => {
  const base = { length: 100, turn: '', climb: '', bank: '', width: '' };
  assert.deepEqual(extendOptions({ ...base, cup: '' }).targets, {}, 'empty: no target, the channel continues');
  assert.deepEqual(extendOptions({ ...base, cup: '90' }).targets, { c: 90 }, '90 degrees is c = 90, not radians');
  assert.deepEqual(extendOptions({ ...base, cup: '0' }).targets, { c: 0 }, 'a flat road is a target, not an empty field');
  assert.deepEqual(extendOptions({ ...base, cup: '200' }).targets, { c: 200 }, 'out of range goes to the core as typed: its guard refuses it by name');
  assert.deepEqual(extendOptions({ ...base, bank: '30', cup: '60' }).targets, { phi: 30 * Math.PI / 180, c: 60 }, 'bank and cup are separate targets');
});

test('the Extend panel has a "cup °" field beside bank, 0 to 150, and Extend hands its value to the core as c', async () => {
  const S = { stub: null }, P = await mountPanel((s) => (S.stub = stubCup(s)));
  const pickers = P.label('bank °').parent.children.map((e) => e.children[0] && e.children[0].textContent);
  assert.equal(pickers[pickers.indexOf('bank °') + 1], 'cup °', `cup sits right after bank (fields: ${pickers.join(', ')})`);
  const f = P.field('cup °'); assert.equal(f.attrs.min, '0'); assert.equal(f.attrs.max, '150');
  P.type('length m', 100); P.type('cup °', 90);   // (the fake DOM keeps a field's initial value as an attribute: type the length)
  const btn = P.root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === 'Extend'); btn.onclick();
  assert.equal(S.stub.sent.at(-1).targets.c, 90, 'the click extends with c = 90');
  P.panel.unmount();
});

test('the readout shows cup from → to: the DOCUMENT\'s values with the bank cell\'s rounding, never the typed target, never bank\'s', async () => {
  const P = await mountPanel(stubCup);
  P.shell.extend({ length: 200 }); P.type('length m', 100);
  assert.equal(P.cell('cup'), '11.7° → 11.7°', 'a legacy piece reads its rendered edge (the core\'s number), rounded as bank is');
  P.type('cup °', 90);
  assert.equal(P.cell('cup'), '11.7° → 90.9°', 'the document rings to 90.871: the readout shows that, not the typed 90.0');
  P.type('bank °', 30);
  assert.equal(P.cell('bank'), '+30.0°'); assert.equal(P.cell('cup'), '11.7° → 90.9°', 'bank moves the bank cell only');
  const r = P.shell.candidateReadout(P.opts());
  assert.equal(P.cell('cup'), `${LB.fmtDeg(r.cupFromDeg).replace('+', '')} → ${LB.fmtDeg(r.cupToDeg).replace('+', '')}`, 'each number is the core\'s, rounded as the bank cell rounds');
  // the on-track labels stay as they are (the seal): a readout carrying cup fields labels exactly as one without
  const { cupFromDeg, cupToDeg, ...plain } = r;
  assert.deepEqual(LB.labelText(r), LB.labelText(plain));
  P.panel.unmount();
});

test('the cup cell follows the cup field inside its input handler, and a cup the core refuses shows — and says why', async () => {
  const S = { stub: null }, P = await mountPanel((s) => (S.stub = stubCup(s)));
  P.shell.extend({ length: 200 }); P.type('length m', 100);
  P.type('cup °', 45); assert.equal(P.cell('cup'), '11.7° → 45.9°', 'no tick, no frame: the cell changed inside the handler');
  P.type('cup °', 200);
  const box = P.root.all().find((e) => e.attrs.class === 'readout');
  assert.equal(P.cell('cup'), '—'); assert.match(box.title, /outside 0–150/, 'the core\'s reason is shown (the box\'s title)');
  assert.equal(S.stub.sent.at(-1).targets.c, 200, 'the panel handed the core the typed 200: it did not clamp');
  P.panel.unmount();
});

test('the brush\'s channel list gains cup (channel c), with a drag rate in degrees', async () => {
  const P = await mountPanel();
  const sel = P.root.all().find((e) => e.attrs['aria-label'] === 'brush channel'), mode = P.root.all().find((e) => e.attrs['aria-label'] === 'brush mode');
  mode.value = 'rate'; mode.onchange();
  const opt = sel.children.find((o) => o.value === 'c');
  assert.ok(opt, `a cup channel in the rate brush's list (got ${sel.children.map((o) => o.value).join(', ')})`);
  assert.equal(opt.textContent, 'cup');
  const { PER_PX } = require('../core/panel.js'); assert.ok(PER_PX.c > 0 && PER_PX.c < 1, 'degrees per pixel of drag');
  P.panel.unmount();
});
