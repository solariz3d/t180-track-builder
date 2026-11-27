// core-pitgap.test.js: node --test app/test/core-pitgap.test.js
// THE PIT LANE'S SMALLEST GAP FROM THE ROAD (D677, pane A's A0 hand-back): the shell took a gap of 0, and the export then refused the lane on any road
// (on a flat 300 m straight: the lane's run meets the road along the shared edge line, and the downforce ray falls between them). Measured on synthetic
// roads (flat, a 15° cup, the default font, turning 90°, a 30° cup, a 25° edge; both sides): red at 0, 0.005 and 0.01 m, clean from 0.02 m. The panel
// now refuses a gap under PIT_GAP_MIN_M (src/doc/pitlane.js), by name, and every gap it accepts exports. Stored documents are untouched (a file with a gap
// of 0 still loads, as before).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const D = require('../../src/core/document.js');
const PL = require('../../src/doc/pitlane.js');
const AD = require('../../src/core/adapter.js');
const MESH = require('../../src/geom/mesh.js');
const PLX = require('../../src/export/pitlane.js');

// the synthetic control: a flat straight 300 m long, 30 m wide, cup 0, laid as the panel sends it
async function flatStraight() {
  const s = await createCoreShell({ brushFn: null });
  const o = extendOptions({ length: '300', turn: '0', climb: '0', bank: '0', width: '30', cup: '0', edge: '', edgeR: '', start: '', tube: '', grip: '', atStart: {}, empty: true, turnAs: 'rate', head: s.headState() });
  s.extend(o);
  assert.equal(s.getState().history.present.pieces.length, 1, s.getState().message);
  return s;
}
const lane = (s, offsetM) => ({ side: 'R', leave: { word: s.getState().history.present.pieces[0].id, along: 40 }, rejoin: { word: s.getState().history.present.pieces[0].id, along: 260 },
  offsetM, width: 8, divergeM: 60, mergeM: 56, speedKmh: 80, boxes: 1, boxSpacingM: 10 });
// the export's own check of the lane (src/export/pitlane.js laneForExport, self-check on): its red rows
function laneRed(doc) {
  const { segments, path } = AD.toPath(doc, { step: 1 }), mm = MESH.buildMesh(path, segments, {});
  const { boxes, boxSpacingM, ...road } = doc.pitLane;
  return PLX.laneForExport(path, segments, mm, road, { selfCheck: true }).red;
}

test('every pit-lane gap the panel accepts on the flat control exports with no red', async () => {
  for (const g of [0, 0.005, 0.01, 0.05, 0.1, 0.5, 2]) {
    const s = await flatStraight();
    s.setPitLane(lane(s, g));
    const doc = s.getState().history.present;
    if (!doc.pitLane) continue;   // refused: nothing to export
    const red = laneRed(doc);
    assert.equal(red.length, 0, `gap ${g} m was accepted and the export finds ${red.length} red (${red.slice(0, 2).map((r) => r.reason).join(', ')})`);
  }
});

test('a gap of 0 is refused by name: the message gives the smallest gap, and the document is unchanged', async () => {
  const s = await flatStraight(), before = s.getState().history.present;
  s.setPitLane(lane(s, 0));
  const st = s.getState();
  assert.equal(st.history.present, before, 'the document changed');
  assert.equal(st.history.present.pitLane, undefined);
  assert.match(String(st.message), /gap from the road/);
  assert.match(String(st.message), new RegExp(`${PL.PIT_GAP_MIN_M} m`));
});

test('a gap just under the smallest is refused; the smallest itself is laid', async () => {
  assert.ok(Number.isFinite(PL.PIT_GAP_MIN_M) && PL.PIT_GAP_MIN_M > 0, `PIT_GAP_MIN_M ${PL.PIT_GAP_MIN_M}`);
  const s = await flatStraight();
  s.setPitLane(lane(s, PL.PIT_GAP_MIN_M - 0.01));
  assert.equal(s.getState().history.present.pitLane, undefined, 'a gap under the smallest was laid');
  s.setPitLane(lane(s, PL.PIT_GAP_MIN_M));
  assert.equal(s.getState().history.present.pitLane.offsetM, PL.PIT_GAP_MIN_M, s.getState().message);
});

test('an existing lane whose gap is set to 0 keeps its old gap, and is still removed by unticking', async () => {
  const s = await flatStraight();
  s.setPitLane(lane(s, 12));
  const kept = s.getState().history.present;
  s.setPitLane({ ...kept.pitLane, offsetM: 0 });
  assert.equal(s.getState().history.present, kept);
  s.setPitLane(null);
  assert.equal(s.getState().history.present.pitLane, undefined);
});

test('a stored document whose lane has a gap of 0 still loads, gap and all (stored data is not re-judged)', async () => {
  const s = await flatStraight(), d = s.getState().history.present;
  const stored = { ...d, pitLane: lane(s, 0) };
  const back = D.checkDoc(stored);
  assert.equal(back.pitLane.offsetM, 0);
  s.adopt(back);
  assert.equal(s.getState().history.present.pitLane.offsetM, 0);
});

// ── the pit lane section mounted on a small fake DOM, as app/test/core-spawns-ui.test.js mounts it (pane O's read: pitui.js put sends the WHOLE stored lane) ──
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
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  get isConnected() { return false; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}
function pitPanel(s) {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} };
  doc.defaultView = win;
  const el = (tag, attrs = {}, ...kids) => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); } e.append(...kids); return e; };
  const root = doc.createElement('div');
  root.append(...require('../core/pitui.js').mount({ shell: s, el, win }).nodes);
  const by = (aria) => root.all().find((e) => e.attrs['aria-label'] === aria);
  return { by, type: (aria, v) => { const f = by(aria); f.value = String(v); f.onchange(); } };
}
// a lane saved with a gap under the smallest (a file from before the floor): the core lays it, as a file's load does
async function savedUnderFloor(g) {
  const s = await flatStraight();
  s.adopt(D.checkDoc({ ...s.getState().history.present, pitLane: lane(s, g) }));
  assert.equal(s.getState().history.present.pitLane.offsetM, g);
  return s;
}

test('a saved lane whose gap is under the smallest still takes a width edit in the panel, and keeps its gap', async () => {
  const s = await savedUnderFloor(0.05), P = pitPanel(s);
  P.type('pit lane width', 10);
  const L = s.getState().history.present.pitLane;
  assert.equal(L.width, 10, `the width edit was refused: ${s.getState().message}`);
  assert.equal(L.offsetM, 0.05, 'its gap is kept');
});

test('a saved lane whose gap is under the smallest: a gap changed to another value under it is refused, and raised to the smallest it is laid', async () => {
  const s = await savedUnderFloor(0.05), kept = s.getState().history.present;
  s.setPitLane({ ...kept.pitLane, offsetM: 0.06 });
  assert.equal(s.getState().history.present, kept, 'a changed gap under the smallest was laid');
  assert.match(String(s.getState().message), /PIT_GAP_TOO_SMALL/);
  s.setPitLane({ ...kept.pitLane, offsetM: PL.PIT_GAP_MIN_M });
  assert.equal(s.getState().history.present.pitLane.offsetM, PL.PIT_GAP_MIN_M, s.getState().message);
});

test('the panel: a refused gap puts the gap box back to the lane\'s stored gap', async () => {
  const s = await flatStraight();
  s.setPitLane(lane(s, 12));
  const P = pitPanel(s);
  assert.equal(P.by('pit lane gap from the road').value, '12', 'control: the box shows the stored gap');
  P.type('pit lane gap from the road', 0);
  assert.equal(s.getState().history.present.pitLane.offsetM, 12, 'control: the gap of 0 was refused');
  assert.equal(P.by('pit lane gap from the road').value, '12', 'the box still shows the refused gap');
});
