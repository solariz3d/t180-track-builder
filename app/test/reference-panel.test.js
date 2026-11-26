// reference-panel.test.js (L250): node --test app/test/reference-panel.test.js
// The shadow tracks, finished: View ▸ Reference track…'s panel (app/reference/panel.js) over the real core shell and the headless preview.
// The installed tracks are stood in for by lines built here with the builder's own encodeAiLine (no other author's track is in the repository);
// the native side is a stand-in that only answers list_reference_tracks, read_reference_line and read_reference_road, as src-tauri/src/reference.rs and
// kn5road.rs do (the road's bytes in src/reference/road.js's layout, written by its encodeRoad).
//   P1  every layout is listed; one with no AI line says so and cannot be picked
//   P2  pick draws it with its start on his start; Show off hides it and keeps the pick and the nudge; Show on draws it again; Clear drops both
//   P3  the two kinds of line that do not read on L (a 12-byte stub, a file 8 bytes short) are refused in words, the one shown before is taken
//       down, and the entry is marked "(cannot be read)"; the native side's own refusal too
//   P4  a layout carrying another layout's line is said so (the same line; the same points with widths of its own), and so is a line far off
//       its stated length; a layout with a line of its own says nothing
//   P5  a later pick wins over an earlier one still being read
//   RD1 Road: the kn5's road, placed by the layout's AI line, so Line and Road lie on each other under one nudge; RD2 a road that does not read is
//       refused in words, and the same layout's Line still draws
//   READ ONLY, each through the real core shell and preview, for Line and for Road: R1 the document, R2 a save (the track and its undo file),
//   R3 an undo step, R4 an export
//   D1  the draw: the reference goes down before his road and writes no depth, so his road is drawn over it; D2 its colour is the --reference token
//   THE REPAIR (pane E's read of L250, p-l250-read-E_2026-11-26.md :71-86): P6 (E's V3e) and P7 (E's V3f) a mode change while a road is still reading
//   draws his newest pick, in the mode the panel names; N1 a nudge value that is not a number keeps the nudge it had; L1 the panel's look is a class on
//   the page's own pane tokens, nothing inline, so a look can style it
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { encodeAiLine, EXTRA } = require('../../src/export/ailine.js');
const { encodeRoad } = require('../../src/reference/road.js');
const { createReferencePanel } = require('../reference/panel.js');
const { createCoreShell } = require('../core/coreshell.js');
const P = require('../preview/preview.js');
const R = require('../preview/renderer.js');
const D = require('../../src/core/document.js');

const REPO = path.resolve(__dirname, '..', '..');

/** A circle of radius r (m), n points, as an installed AI line with a grid after it (hasGrid = 1), as every installed line on L carries. */
function aiLine(r, n, { sideLeft = 4, sideRight = 6, open = false } = {}) {
  const points = [], extra = [];
  const m = open ? Math.floor(n * 0.6) : n;
  for (let k = 0; k < m; k++) {
    const ph = (2 * Math.PI * k) / n;
    points.push({ pos: [r * Math.cos(ph), 0, r * Math.sin(ph)], length: 0, id: k });
    const e = {}; for (const f of EXTRA) e[f] = 0; Object.assign(e, { sideLeft, sideRight, ny: 1 }); extra.push(e);
  }
  const b = encodeAiLine({ version: 7, points, extra, open });
  const g = Buffer.concat([b.subarray(0, b.length - 4), Buffer.alloc(4), Buffer.alloc(512, 7)]); g.writeInt32LE(1, b.length - 4);
  return g;
}
const stub = () => { const b = Buffer.alloc(12); b.writeInt32LE(3, 0); return b; };   // version 3, 0 points
const shortOf = (b) => b.subarray(0, b.length - 512 - 4 - 8);   // up to its grid flag, less 8 bytes

/** The native side, read only: the layouts, and each one's bytes (or the native side's own refusal, a string, as Tauri rejects with). */
function nativeOf(entries) {
  const calls = [], gate = new Map(), roadGate = new Map();   // gate: a line read held, by layout; roadGate: a road read held, by `${track}\0${layout}`
  const call = async (cmd, args) => {
    calls.push(cmd);
    if (cmd === 'list_reference_tracks') return entries.map(({ track, layout, bytes, uiLength = null }) => ({ track, layout, hasAi: bytes !== null, uiLength }));
    const e = entries.find((x) => x.track === args.track && x.layout === args.layout);
    if (cmd === 'read_reference_road') {
      if (roadGate.has(`${args.track}\u0000${args.layout}`)) await roadGate.get(`${args.track}\u0000${args.layout}`);
      if (!e || e.road === undefined) throw 'no kn5 in that folder';   // eslint-disable-line no-throw-literal
      if (typeof e.road === 'string') throw e.road;   // eslint-disable-line no-throw-literal
      return e.road.buffer.slice(e.road.byteOffset, e.road.byteOffset + e.road.byteLength);
    }
    if (cmd !== 'read_reference_line') throw new Error(`the stand-in has no ${cmd}`);
    if (!e || e.bytes === null) throw 'no AI line there';   // eslint-disable-line no-throw-literal
    if (gate.has(args.layout)) await gate.get(args.layout);
    if (typeof e.bytes === 'string') throw e.bytes;   // eslint-disable-line no-throw-literal
    return e.bytes.buffer.slice(e.bytes.byteOffset, e.bytes.byteOffset + e.bytes.byteLength);   // an ArrayBuffer, as the page gets it
  };
  return { call, calls, gate, roadGate };
}
/** A read held open until its gate is opened: [the promise the stand-in waits on, open]. */
const held = () => { let open; const pr = new Promise((r) => { open = r; }); return [pr, open]; };
/** The length of a circle of radius r drawn through n points, as ribbonOf measures it. */
const lapM = (r, n) => n * 2 * r * Math.sin(Math.PI / n);
const LAP = aiLine(200, 400), WIDE = aiLine(200, 400, { sideLeft: 9 });
/** A ring of road of radius r, w wide, n quads, in road.js's bytes: what read_reference_road sends. */
function ringRoad(r, w, n) {
  const pos = [], idx = [];
  for (let k = 0; k <= n; k++) { const ph = (2 * Math.PI * k) / n; pos.push((r + w / 2) * Math.cos(ph), 0, (r + w / 2) * Math.sin(ph), (r - w / 2) * Math.cos(ph), 0, (r - w / 2) * Math.sin(ph)); }
  for (let k = 0; k < n; k++) { const a = 2 * k; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  return Buffer.from(encodeRoad([{ positions: new Float32Array(pos), indices: new Uint16Array(idx) }]));
}
const RING = ringRoad(200, 12, 300);
const TRACKS = [
  { track: 'reference track 1', layout: '', bytes: LAP, uiLength: '1257', road: RING },
  { track: 'reference track 1', layout: 'one', bytes: LAP, uiLength: '200', road: 'the kn5 is shorter than its header' },   // the same file as the main layout's; its road does not read
  { track: 'reference track 1', layout: 'two', bytes: WIDE, uiLength: '1257m', road: RING },   // the same points, its own widths
  { track: 'reference track 2', layout: '', bytes: aiLine(150, 300), uiLength: '0.95km', road: ringRoad(150, 10, 200) },
  { track: 'reference track 3', layout: '', bytes: stub() },
  { track: 'reference track 4', layout: '', bytes: shortOf(aiLine(100, 80)) },
  { track: 'reference track 5', layout: '', bytes: null },
  { track: 'reference track 6', layout: '', bytes: 'the AI line says it has 0 points' },
];

/** Just enough of a document for the panel: elements with style, children and values, and the document's events. */
function fakeDoc() {
  const listeners = {};
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.style = {}; this.children = []; this.attrs = {}; this.value = ''; this.disabled = false; this.checked = false; this.title = ''; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    append(...xs) { for (const x of xs) this.children.push(x instanceof El ? x : { textContent: String(x) }); }
    replaceChildren(...xs) { this.children = []; this.append(...xs); }
    get firstChild() { return this.children[0] || null; }
    set textContent(v) { this.children = [{ textContent: String(v) }]; }
    get textContent() { return this.children.map((c) => c.textContent).join(''); }
  }
  const doc = {
    createElement: (t) => new El(t),
    defaultView: { CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }, performance: { now: () => 0 } },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    dispatchEvent(e) { for (const fn of listeners[e.type] || []) fn(e); return true; },
  };
  return { doc, root: new El('div') };
}
const optionsOf = (panel, root) => root.children[0].children[1].children.map((o) => ({ text: o.textContent, value: o.value, disabled: o.disabled }));
/** Every element under e (e first), and the first one whose aria-label starts with `label`. */
const elementsOf = (e) => [e, ...e.children.filter((c) => c.tagName).flatMap(elementsOf)];
const labelled = (root, label) => elementsOf(root).find((e) => (e.getAttribute('aria-label') || '').startsWith(label));

/** A headless preview of the shell (the recording WebGL is a no-op), stepped a frame at a time. */
function headless(s) {
  let q = [], now = 0;
  const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (fn) => { q.push(fn); return q.length; }, cancelAnimationFrame() {}, performance: { now: () => now }, setTimeout, clearTimeout };
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => ({})) });
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  const p = P.createPreview({ canvas, shell: s, win });
  p.step = () => { const d = q; q = []; now += 16; for (const f of d) f(now); };
  return p;
}
/** The page's wiring for 't180:reference', as app/preview/index.js does it: the panel's road to the preview, the preview's answer back. */
function wire(doc, p) {
  doc.addEventListener('t180:reference', (e) => { const d = e.detail || {}; let info = null; try { info = p.setReference(d.ribbon ? { ribbon: d.ribbon, nudge: d.nudge } : null); } catch (err) { if (typeof d.reply === 'function') d.reply({ error: err.message }); return; } if (typeof d.reply === 'function') d.reply(info); });
}
async function setup({ entries = TRACKS, storage = null, exporter = null } = {}) {
  const s = await createCoreShell({ brushFn: null, storage, exporter, autosaveMs: 0 });
  const p = headless(s), { doc, root } = fakeDoc(), native = nativeOf(entries);
  wire(doc, p);
  const panel = createReferencePanel({ doc, root, call: native.call });
  await panel.open();
  return { s, p, panel, root, native };
}

// ── the panel ──

test('P1: every installed layout is listed; one with no AI line says so and cannot be picked', async () => {
  const { panel, root } = await setup(), o = optionsOf(panel, root);
  assert.equal(o.length, TRACKS.length + 1, 'None and every layout');
  assert.deepEqual(o[0], { text: 'None', value: '', disabled: false });
  const none = o.find((x) => x.text.startsWith('reference track 5'));
  assert.equal(none.text, 'reference track 5 (no AI line)'); assert.equal(none.disabled, true);
  assert.equal(o.find((x) => x.text === 'reference track 1 · one').disabled, false);
  assert.match(panel.state().readout, /^7 of 8 layouts have an AI line to show\.$/);
});

test('P2: pick draws it on his start; Show off hides it and keeps the pick and the nudge; Show on draws it again; Clear drops both', async () => {
  const { s, p, panel } = await setup();
  s.extend({ length: 120 }); p.step();
  await panel.pick('reference track 2', '');
  const on = p.reference(), anchor = on.anchor;
  assert.ok(on, 'drawn'); assert.deepEqual(on.start.map((v) => +v.toFixed(9)), anchor.pos.map((v) => +v.toFixed(9)), 'its start on his start, at his start\'s height');
  await panel.setNudge({ dx: 12, yawDeg: 30 });
  const nudged = p.reference().start;
  await panel.show(false);
  assert.equal(p.reference(), null, 'hidden: nothing drawn');
  assert.equal(panel.state().picked, 'reference track 2\u0000'); assert.deepEqual(panel.state().nudge, { dx: 12, dz: 0, dy: 0, yawDeg: 30 }, 'the pick and the nudge stay');
  assert.match(panel.state().readout, /^Hidden \(Show draws it again\)/);
  await panel.show(true);
  assert.deepEqual(p.reference().start, nudged, 'drawn again where it was');
  await panel.clear();
  assert.equal(p.reference(), null); assert.equal(panel.state().picked, null); assert.deepEqual(panel.state().nudge, { dx: 0, dz: 0, dy: 0, yawDeg: 0 });
});

test('P3: a line that does not read is refused in words, the one shown before is taken down, and its entry is marked', async () => {
  const { p, panel, root } = await setup();
  for (const [track, why] of [['reference track 3', /cut short \(12 bytes is shorter than the 16-byte header\)/], ['reference track 4', /cut short \(80 points need \d+ bytes before any grid, the file has \d+\)/], ['reference track 6', /the AI line says it has 0 points/]]) {
    await panel.pick('reference track 2', '');
    assert.ok(p.reference(), 'a reference is shown first');
    await panel.pick(track, '');
    assert.equal(p.reference(), null, `${track}: what was shown before is taken down, nothing is drawn in its place`);
    const st = panel.state();
    assert.match(st.readout, new RegExp(`^${track}: Not drawn: `)); assert.match(st.readout, why); assert.match(st.readout, /never drawn in part\.$/);
    assert.equal(st.picked, null);
    const o = optionsOf(panel, root).find((x) => x.text.startsWith(track));
    assert.equal(o.text, `${track} (cannot be read)`); assert.equal(o.disabled, true);
  }
});

test('P4: a layout carrying another layout\'s line is said so, and so is a line far off its stated length; a line of its own says nothing', async () => {
  const { panel, root } = await setup();
  await panel.pick('reference track 1', 'one');
  const n = panel.state().notes;
  assert.match(n[0], /^This layout carries the same AI line as the main layout: what is drawn is that line/);
  assert.match(n[1], /^Its AI line drives the same points as “two”, with widths of its own\./);
  assert.match(n[2], /the layout says 200 m/);
  assert.equal(optionsOf(panel, root).find((x) => x.text.startsWith('reference track 1 · one')).text, 'reference track 1 · one (another layout\'s line)');
  await panel.pick('reference track 2', '');
  assert.deepEqual(panel.state().notes, [], 'its own line, within 5 % of its stated 950 m: nothing to say');
});

test('P5: a later pick wins over an earlier one still being read', async () => {
  const entries = TRACKS.map((e) => ({ ...e })), { p, panel, native } = await setup({ entries });
  let open; native.gate.set('one', new Promise((r) => { open = r; }));
  const slow = panel.pick('reference track 1', 'one');
  await panel.pick('reference track 2', '');
  open(); await slow;
  assert.equal(panel.state().picked, 'reference track 2\u0000'); assert.ok(Math.abs(p.reference().lengthM - 300 * 2 * 150 * Math.sin(Math.PI / 300)) < 0.01, 'reference track 2 is the one drawn');
});

test('RD1: Road draws the kn5\'s road placed by the layout\'s AI line: Line and Road lie on each other under one nudge', async () => {
  const { s, p, panel } = await setup();
  s.extend({ length: 120 }); p.step();
  await panel.pick('reference track 2', ''); await panel.setNudge({ dx: 7, dz: -3, yawDeg: 40 });
  const line = p.reference();
  await panel.setMode('road');
  const road = p.reference(), st = panel.state();
  assert.equal(st.mode, 'road'); assert.equal(st.kind, 'road'); assert.equal(st.triangles, 400); assert.equal(st.picked, 'reference track 2\u0000', 'the same layout, read again');
  assert.deepEqual(road.start, line.start, 'the same start'); assert.deepEqual(road.forward, line.forward, 'the same way');
  assert.deepEqual(st.nudge, { dx: 7, dz: -3, dy: 0, yawDeg: 40 }, 'the same nudge');
  assert.match(st.readout, /^400 triangles of road from its kn5, placed by its 942 m AI line · read \d+ ms, built \d+ ms$/);
  await panel.setMode('line'); assert.equal(panel.state().kind, 'line'); assert.deepEqual(p.reference().start, line.start);
  await assert.rejects(panel.setMode('mesh'), /the mode is line or road/);
});

test('RD2: a road that does not read is refused in words and the one shown before is taken down; the same layout\'s Line still draws', async () => {
  const { p, panel, root } = await setup();
  await panel.setMode('road');
  await panel.pick('reference track 1', ''); assert.ok(p.reference(), 'a road is shown first');
  await panel.pick('reference track 1', 'one');
  assert.equal(p.reference(), null, 'taken down: nothing drawn in its place');
  assert.match(panel.state().readout, /^reference track 1 · one: Not drawn: the kn5 is shorter than its header\. What does not read whole is never drawn in part\.$/);
  assert.equal(optionsOf(panel, root).find((x) => x.text.startsWith('reference track 1 · one')).text, 'reference track 1 · one (cannot be read)');
  await panel.setMode('line');
  assert.equal(optionsOf(panel, root).find((x) => x.text.startsWith('reference track 1 · one')).disabled, false, 'its line is still there to pick');
  await panel.pick('reference track 1', 'one'); assert.ok(p.reference(), 'and it draws');
});

// ── the repair (pane E's read): a mode change while a road is still reading; a nudge that is not a number; the look ──

test('P6 (E\'s V3e): Road shows one layout; he picks another, its road still reading, and changes to Line: his newest pick is drawn, as Line', async () => {
  const { p, panel, native, root } = await setup();
  await panel.setMode('road'); await panel.pick('reference track 2', '');
  const [pr, open] = held(); native.roadGate.set('reference track 1\u0000', pr);
  const slow = panel.pick('reference track 1', '');
  const mode = panel.setMode('line');
  open(); await slow; await mode;
  const st = panel.state();
  assert.equal(st.picked, 'reference track 1\u0000', 'his newest pick, not the one shown before it');
  assert.equal(st.mode, 'line'); assert.equal(st.kind, 'line', 'in the mode he changed to');
  assert.ok(Math.abs(p.reference().lengthM - lapM(200, 400)) < 0.01, 'reference track 1 is what is drawn');
  assert.equal(root.children[0].children[1].value, 'reference track 1\u0000', 'and the select names it');
});

test('P7 (E\'s V3f): nothing shown, Road; a road still reading when he changes to Line: it is drawn in the mode the panel names', async () => {
  const { p, panel, native } = await setup();
  await panel.setMode('road');
  const [pr, open] = held(); native.roadGate.set('reference track 2\u0000', pr);
  const slow = panel.pick('reference track 2', '');
  const mode = panel.setMode('line');
  open(); await slow; await mode;
  const st = panel.state();
  assert.equal(st.mode, 'line'); assert.equal(st.kind, 'line', 'drawn as the panel says'); assert.equal(st.picked, 'reference track 2\u0000');
  assert.ok(Math.abs(p.reference().lengthM - lapM(150, 300)) < 0.01, 'reference track 2 is what is drawn');
  assert.match(st.readout, /^942 m along its line/);
});

test('P8: a pick that ended, cleared while it read or refused, is not drawn by a later mode change', async () => {
  const { p, panel, native } = await setup();
  await panel.setMode('road');
  const [pr, open] = held(); native.roadGate.set('reference track 2\u0000', pr);
  const slow = panel.pick('reference track 2', '');
  await panel.clear(); open(); await slow;
  await panel.setMode('line');
  assert.equal(p.reference(), null, 'cleared while it read: nothing drawn after the mode change'); assert.equal(panel.state().picked, null);
  await panel.setMode('road');
  await panel.pick('reference track 1', 'one');   // its road does not read (RD2)
  assert.equal(p.reference(), null);
  await panel.setMode('line');
  assert.equal(p.reference(), null, 'refused: nothing drawn until he picks it again'); assert.equal(panel.state().picked, null);
});

test('N1: a nudge value that is not a number, typed or given, keeps the nudge it had (the box shows it again), and nothing moves', async () => {
  const { s, p, panel, root } = await setup();
  s.extend({ length: 120 }); p.step();
  await panel.pick('reference track 2', '');
  const x = labelled(root, 'move the reference: x ');
  x.value = '12'; await x.onchange();
  assert.equal(panel.state().nudge.dx, 12, 'a number is taken');
  const moved = p.reference().start.slice();
  // '' is what a browser's number box gives for a value it cannot hold ("1e400", "abc") and for a box emptied
  for (const bad of ['', 'abc', '1e400', 'Infinity']) {
    x.value = bad; await x.onchange();
    assert.equal(panel.state().nudge.dx, 12, `typed ${JSON.stringify(bad)}: the nudge it had`);
    assert.equal(x.value, '12', `typed ${JSON.stringify(bad)}: the box shows it again`);
    assert.deepEqual(p.reference().start, moved, `typed ${JSON.stringify(bad)}: drawn where it was`);
  }
  for (const bad of [Number.NaN, Infinity, 'abc', null]) {
    await panel.setNudge({ dx: bad, yawDeg: 15 });
    assert.equal(panel.state().nudge.dx, 12, `given ${String(bad)}: the nudge it had`); assert.equal(panel.state().nudge.yawDeg, 15, 'the good value beside it is taken');
  }
  x.value = '0'; await x.onchange(); assert.equal(panel.state().nudge.dx, 0, 'a typed 0 is 0');
});

test('L1: the panel\'s look is one class on the page\'s own pane tokens, with nothing inline, so a look can style it', async () => {
  const { panel, root } = await setup();
  const box = root.children[0], style = root.children.find((e) => e.tagName === 'STYLE');
  assert.equal(box.className, 'reference-panel');
  for (const e of elementsOf(box)) assert.equal(e.style.cssText || '', '', `${e.tagName}.${e.className || ''} carries no inline style`);
  assert.deepEqual(Object.keys(box.style).filter((k) => box.style[k] !== undefined && k !== 'display'), [], 'the panel itself only says whether it is open');
  assert.ok(style, 'the panel brings its class rule');
  const rule = (style.textContent.match(/\.reference-panel\s*\{([^}]*)\}/) || [])[1] || '';
  assert.match(rule, /background:\s*var\(--panel\b/, 'its ground is the page\'s panel');
  assert.match(rule, /(^|;)\s*color:\s*var\(--text\b/, 'its words the page\'s text on that panel');
  assert.match(rule, /border:\s*1px solid var\(--line\b/, 'its edge the page\'s line');
  assert.match(rule, /border-radius:\s*var\(--r3\b/, 'its corner a step of the page\'s radius scale (a popover\'s, r3)');
  const literals = style.textContent.replace(/var\(--[\w-]+(,[^()]*(\([^()]*\))?[^()]*)?\)/g, '');
  assert.doesNotMatch(literals, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|color-mix\(/i, 'no colour of its own outside a token\'s fallback');
  assert.equal(panel.isOpen(), true);
});

// ── read only: the document, a save, an undo step and an export ──

/** Every reference action the panel has, in a row: pick, nudge, hide, show, a refused pick, pick again, clear and pick once more (left shown). */
async function everything(panel, p, mode) {
  await panel.setMode(mode);
  await panel.pick('reference track 2', ''); p.step();
  await panel.setNudge({ dx: 30, dz: -4, dy: 2, yawDeg: -45 }); p.step();
  await panel.show(false); p.step(); await panel.show(true); p.step();
  await panel.pick('reference track 3', ''); p.step();
  await panel.pick('reference track 1', 'two'); p.step();
  await panel.clear(); p.step();
  await panel.pick('reference track 1', ''); p.step();
  assert.ok(p.reference(), 'a reference is left shown');
}
function memStorage() {
  const st = { docs: new Map(), undo: new Map(), calls: [] };
  return Object.assign(st, {
    saveDoc: async (n, t) => { st.calls.push('saveDoc'); st.docs.set(n, t); }, openDoc: async (n) => st.docs.get(n), listDocs: async () => [...st.docs.keys()],
    saveUndo: async (n, t) => { st.calls.push('saveUndo'); st.undo.set(n, t); }, openUndo: async (n) => st.undo.get(n) || null,
    saveAutosave: async () => { st.calls.push('saveAutosave'); }, openAutosave: async () => null, clearAutosave: async () => { st.calls.push('clearAutosave'); },
  });
}

for (const mode of ['line', 'road']) test(`R1 (${mode}): the document: nothing of the reference enters it, and the shell is not told of any of it`, async () => {
  const { s, p, panel, native } = await setup();
  s.extend({ length: 150 }); s.extend({ length: 80, targets: { kh: 1 / 200 } }); p.step();
  const before = s.getState().history.present, text = D.serialize(before);
  let told = 0; const off = s.subscribe(() => { told++; });
  await everything(panel, p, mode);
  if (typeof off === 'function') off();
  assert.equal(s.getState().history.present, before, 'the very same document object');
  assert.equal(D.serialize(s.getState().history.present), text);
  assert.doesNotMatch(text, /reference/i);
  assert.equal(told, 0, 'the shell emitted no change');
  assert.deepEqual([...new Set(native.calls)].sort(), ['list_reference_tracks', 'read_reference_line', ...(mode === 'road' ? ['read_reference_road'] : [])], 'the panel only lists and reads');
});

for (const mode of ['line', 'road']) test(`R2 (${mode}): a save: the track file and its undo file are byte for byte the same with a reference shown`, async () => {
  const storage = memStorage(), { s, p, panel } = await setup({ storage });
  s.extend({ length: 150 }); s.extend({ length: 80, targets: { kh: 1 / 200 } }); p.step();
  await s.save('Plain'); assert.equal(s.getState().message, null); assert.equal(s.getState().name, 'Plain');
  const calls = storage.calls.length;
  await everything(panel, p, mode);
  assert.equal(storage.calls.length, calls, 'the reference wrote nothing');
  await s.save('Shown'); assert.equal(s.getState().message, null); assert.equal(s.getState().name, 'Shown');
  const [a, b] = ['Plain', 'Shown'].map((n) => [...storage.docs.keys()].find((k) => k.endsWith(n)));
  assert.equal(storage.docs.get(b), storage.docs.get(a), 'the track file');
  assert.ok(storage.undo.get(a), 'an undo file was written'); assert.equal(storage.undo.get(b), storage.undo.get(a), 'the undo file');
});

for (const mode of ['line', 'road']) test(`R3 (${mode}): an undo step: the reference is none; Ctrl+Z undoes his last edit, and the reference stays shown through it`, async () => {
  const { s, p, panel } = await setup();
  s.extend({ length: 150 }); const mid = s.getState().history.present;
  s.extend({ length: 80, targets: { kh: 1 / 200 } }); p.step();
  const h = s.getState().history, past = h.past.length, future = h.future.length;
  await everything(panel, p, mode);
  assert.equal(s.getState().history.past.length, past); assert.equal(s.getState().history.future.length, future);
  s.undo(); p.step();
  assert.equal(s.getState().history.present, mid, 'the undo took back his last extend');
  assert.ok(p.reference(), 'the reference is still shown: it was never in the history');
  s.redo(); p.step(); assert.equal(s.getState().history.past.length, past);
});

for (const mode of ['line', 'road']) test(`R4 (${mode}): an export: every file is byte for byte the same with a reference shown`, async () => {
  const { makeExporter } = require('../export/export.js');
  const get = async (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
  const { s, p, panel } = await setup({ exporter: await makeExporter(get) });
  const TB = require('../../src/core/turnby.js'), Rr = 180, Q = Math.PI * Rr / 2;   // a closed lap, as core-eqonly.test.js lays it
  let d = TB.extendCorner(s.getState().history.present, { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = TB.extendCorner(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  s.commitDoc(TB.extendCorner(d, { length: 60, transition: 40, targets: { kh: 0 } })); s.close(); p.step();
  const files = (out) => out.folders.flatMap((f) => f.files.filter((x) => x.path !== '.t180b-builder.json').map((x) => [`${f.folder}/${x.path}`, Buffer.from(x.bytes)]));   // the stamp carries the time it was made
  const plain = files(s.buildExport());
  await everything(panel, p, mode);
  const shown = files(s.buildExport());
  assert.ok(plain.length >= 5, `files: ${plain.length}`);
  assert.deepEqual(shown.map(([n]) => n), plain.map(([n]) => n), 'the same files');
  for (let i = 0; i < plain.length; i++) assert.ok(shown[i][1].equals(plain[i][1]), `${plain[i][0]} is the same bytes`);
});

// ── the draw ──

/** A recording WebGL: the depth mask, the colour and each draw, in order. */
function recordingGL() {
  const log = []; let mask = true, colour = null;
  const gl = new Proxy({
    getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    depthMask: (m) => { mask = m; }, uniform3f: (u, r, g, b) => { if (u === 'uColour') colour = [r, g, b]; },
    drawElements: (mode, n) => { log.push({ what: 'triangles', n, mask, colour }); }, drawArrays: (mode, first, n) => { log.push({ what: 'lines', n, mask, colour }); },
  }, { get: (t, k) => (k in t ? t[k] : () => ({})) });
  return { gl, log };
}
const near3 = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test('D1: the reference goes down before his road and writes no depth, so his road is drawn over it wherever they overlap', async () => {
  const { gl, log } = recordingGL(), r = R.createRenderer(gl), { ribbonOf, readAiShape, placeAt } = require('../../src/reference/ribbon.js');
  const ribbon = ribbonOf(readAiShape(LAP)), road = { key: 'road', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), indices: new Uint16Array([0, 1, 2]), model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], colour: [0.5, 0.5, 0.5] };
  r.draw([road], { eye: [0, 50, -50], target: [0, 0, 0], up: [0, 1, 0], fov: 1 }, { width: 800, height: 600 }, { look: 'words', reference: { batches: ribbon.batches, edges: ribbon.edges, model: placeAt(ribbon, null) } });
  const refAt = log.findIndex((x) => near3(x.colour, R.REFERENCE.colour)), roadAt = log.findIndex((x) => near3(x.colour, road.colour) && x.what === 'triangles');
  assert.ok(refAt >= 0 && roadAt >= 0, JSON.stringify(log.map((x) => x.colour)));
  assert.ok(refAt < roadAt, `the reference (draw ${refAt}) goes down before his road (draw ${roadAt})`);
  for (const x of log.filter((y) => near3(y.colour, R.REFERENCE.colour))) assert.equal(x.mask, false, 'the reference writes no depth');
  assert.equal(log[roadAt].mask, true, 'his road writes depth as ever');
});

test('D2: the shadow\'s colour is the skin\'s --reference token, REFERENCE.colour when it sets none', async () => {
  const tokens = (o) => ({ floats: (n, f) => (n in o ? o[n] : [...f]), word: (n, f) => f });
  assert.deepEqual(R.themeFrom(tokens({})).reference, [...R.REFERENCE.colour]);
  assert.deepEqual(R.themeFrom(tokens({ '--reference': [0.9, 0.2, 0.4] })).reference, [0.9, 0.2, 0.4]);
  const { gl, log } = recordingGL(), r = R.createRenderer(gl), { ribbonOf, readAiShape, placeAt } = require('../../src/reference/ribbon.js'), ribbon = ribbonOf(readAiShape(LAP));
  r.setTheme(R.themeFrom(tokens({ '--reference': [0.9, 0.2, 0.4] })));
  r.draw([], { eye: [0, 50, -50], target: [0, 0, 0], up: [0, 1, 0], fov: 1 }, { width: 800, height: 600 }, { look: 'words', reference: { batches: ribbon.batches, edges: ribbon.edges, model: placeAt(ribbon, null) } });
  assert.ok(log.some((x) => x.what === 'triangles' && near3(x.colour, [0.9, 0.2, 0.4])), 'drawn in the skin\'s colour');
  assert.throws(() => r.setTheme({ reference: [2, 0, 0] }), /reference colour is three numbers from 0 to 1/);
});
