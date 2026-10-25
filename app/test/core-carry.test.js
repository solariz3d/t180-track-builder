// core-carry.test.js: node --test app/test/core-carry.test.js
// D385 (pane C; the user, 2026-10-18: a piece after a turn goes straight "because the pieces dont retain the same values as the next piece after, which is
// what I want. So right now only the cup and width and banking and length is retained but not the climb and turn, also there is the right edge but not the
// left edge tweak"; plan_t180_handoff_2026-10-15.md :2496-2522).
//   PART 1, THE CARRY: in corner mode, after an Extend the turn and climb fields keep the degrees typed for the piece just placed, so Extend again places the
//          same corner (a corner still ends straight). A cleared field or a typed 0 is as before (the track goes on as it goes). Undo gives back the undone
//          piece's own values; a new document clears them; a selected piece lends its own corner. Rate mode is unchanged.
//   PART 2, THE LEFT EDGE: `left edge °` and `right edge °`, each showing its own side at the head; typing one side changes only that side.
// The REAL core throughout (no stub): these rows are about what the placed pieces are.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const RD = require('../../src/core/readout.js');
const D = require('../../src/core/document.js');

// ── a small fake DOM, as app/test/core-xsec.test.js has it ──
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
  const { doc } = fakeWindow();
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });   // no #preview: no label layer
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => { const l = label(text); assert.ok(l, `the panel has no "${text}" field`); return l.children[1]; };
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); };
  const button = (text) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const extend = () => button('Extend').onclick();
  const turnAs = root.all().find((e) => e.tagName === 'SELECT' && e.attrs['aria-label'] === 'turn and climb as');
  const doc_ = () => shell.getState().history.present;
  const last = () => { const d = doc_(), i = d.pieces.length - 1; return { P: d.pieces[i], r: RD.pieceReadout(d, i), end: D.pieceEnd(d.pieces[i]) }; };
  type('length m', 100);   // (the fake DOM's input starts with no .value: the panel's 100 is an attribute here)
  return { root, shell, panel, label, field, type, button, extend, turnAs, doc: doc_, last, opts: () => panel.options() };
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a}, not ${b} (±${tol})`);

// ── PART 1, THE CARRY ──
test('D385 carry: a corner of 30 placed, then Extend with the fields untouched, places a second 30 corner, ending straight', async () => {
  const p = await mountPanel();
  assert.equal(p.turnAs.value, 'corner', 'the default');
  p.extend();   // a first straight piece, so the corner below starts from a straight road
  p.type('turn °', 30); p.extend();
  near(p.last().r.turnDeg, 30, 0.01, 'the first corner');
  assert.equal(p.field('turn °').value, '30', 'the turn field keeps the 30 typed for the piece just placed');
  assert.equal(p.opts().turnDeg, 30, 'so Extend is asked for the same corner');
  p.extend();
  near(p.last().r.turnDeg, 30, 0.01, 'the second corner turns 30 too');
  assert.equal(p.last().end.kh.v, 0, 'and still ends straight');
  assert.equal(p.field('turn °').value, '30', 'and the field still holds it');
  p.panel.unmount();
});
test('D385 carry: the climb the same way: a climb corner of 10 placed, then Extend untouched, places a second 10', async () => {
  const p = await mountPanel();
  p.extend(); p.type('climb °', 10); p.extend();
  near(p.last().r.climbDeg, 10, 0.01, 'the first climb corner');
  assert.equal(p.field('climb °').value, '10', 'the climb field keeps the 10');
  p.extend();
  near(p.last().r.climbDeg, 10, 0.01, 'the second climb corner climbs 10 too');
  near(p.last().end.kv.v, 0, 1e-12, 'ending at a climb rate of 0');
  p.panel.unmount();
});
test('D385 carry: clear the field after a carried corner and the next piece goes straight; a typed 0 is not carried', async () => {
  const p = await mountPanel();
  p.extend(); p.type('turn °', 30); p.extend();
  p.type('turn °', ''); p.extend();
  near(p.last().r.turnDeg, 0, 1e-9, 'cleared: the track goes on as it goes, straight after a corner');
  assert.equal(p.field('turn °').value, '', 'and the field stays blank');
  p.type('turn °', 30); p.extend(); p.type('turn °', 0); p.extend();
  assert.equal(p.field('turn °').value, '', 'a typed 0 is as today: after the Extend the field is blank, not a carried 0');
  assert.equal(p.opts().turnDeg, undefined, 'and no corner is asked for');
  p.panel.unmount();
});
test('D385 carry: Undo gives back the undone piece\'s own corner; Redo and a new document clear it', async () => {
  const p = await mountPanel();
  p.extend(); p.type('turn °', 30); p.extend(); p.type('turn °', 45); p.extend();
  assert.equal(p.field('turn °').value, '45', 'the 45 is carried');
  p.shell.undo();
  assert.equal(p.field('turn °').value, '45', 'Undo puts back the undone piece\'s own 45 (putBack), so Extend again rebuilds it');
  p.shell.undo();
  assert.equal(p.field('turn °').value, '30', 'and one more Undo, the 30 of the piece before');
  p.shell.redo();
  assert.equal(p.field('turn °').value, '', 'Redo shows the head, as before');
  p.type('turn °', 30); p.extend(); p.shell.newDoc();
  assert.equal(p.field('turn °').value, '', 'a new document clears the carried corner');
  assert.equal(p.field('climb °').value, '', 'and the climb');
  p.panel.unmount();
});
test('D385 carry: a selected piece lends its own corner, and Extend from it carries that corner', async () => {
  const p = await mountPanel();
  p.extend(); p.type('turn °', 30); p.extend(); p.type('turn °', ''); p.extend();
  p.shell.selectPiece(1);
  assert.equal(p.field('turn °').value, '30', 'the selected corner piece lends its 30');
  p.shell.clearSelection();
  assert.equal(p.field('turn °').value, '', 'clearing the selection shows the head again');
  p.panel.unmount();
});
test('D385 carry: rate mode is unchanged: after an Extend the turn field shows the head\'s rate', async () => {
  const p = await mountPanel();
  p.turnAs.value = 'rate'; p.turnAs.onchange();
  p.extend(); p.type('turn °/100m', 30); p.extend();
  assert.equal(p.field('turn °/100m').value, '30', 'the head\'s rate, which the piece eased to');
  assert.equal(p.opts().targets.kh, undefined, 'shown, so no target: the track keeps turning as now');
  p.type('turn °/100m', 20.123); p.extend();   // (a typed rate the head shows rounded: a carry in rate mode would keep the typed text, which differs, and send it again)
  assert.equal(p.field('turn °/100m').value, '20.12', 'the head\'s rate as shown, not the 20.123 typed: rate mode shows the head, never a carry');
  p.panel.unmount();
});

// ── PART 2, THE LEFT EDGE ──
test('D385 edges: the fields are "left edge °" and "right edge °"; there is no "edge angle °"', async () => {
  const p = await mountPanel();
  assert.ok(p.label('left edge °') && p.label('right edge °'), 'both sides are named');
  assert.equal(p.label('edge angle °'), undefined, 'the old name is gone');
  p.panel.unmount();
});
test('D385 edges: each field shows its own side at the head', async () => {
  const p = await mountPanel();
  assert.equal(p.field('right edge °').value, '0', 'an empty track: the right side reads 0, not a blank');
  p.type('cup °', 20); p.type('left edge °', 30); p.type('right edge °', 10); p.extend();
  near(p.last().end.e.v, 30, 0.5, 'placed: left'); near(p.last().end.er.v, 10, 0.5, 'placed: right');
  assert.equal(Number(p.field('left edge °').value), Math.round(p.last().end.e.v * 100) / 100, 'the left field shows the head\'s left side');
  assert.equal(Number(p.field('right edge °').value), Math.round(p.last().end.er.v * 100) / 100, 'the right field shows the head\'s RIGHT side');
  assert.deepEqual(['e', 'er'].filter((k) => k in p.opts().targets), [], 'left as shown, neither is a target');
  p.panel.unmount();
});
test('D385 edges: the shell\'s headState and pieceState carry the right edge er (the panel cannot read the document in the webview)', async () => {
  const p = await mountPanel();
  assert.equal(p.shell.headState().er, 0, 'an empty track: the first piece starts with the right edge at the left\'s 0');
  p.type('cup °', 20); p.type('left edge °', 30); p.type('right edge °', 10); p.extend();
  const end = p.last().end;
  assert.equal(p.shell.headState().er, end.er.v, 'the head: the document\'s er');
  assert.equal(p.shell.pieceState(p.last().P.id).er, end.er.v, 'a placed piece: its er');
  assert.notEqual(end.er.v, end.e.v, 'and the two sides differ, so this is not the left read twice');
  p.panel.unmount();
});
test('D385 edges: typing the left edge alone leaves the right as it was', async () => {
  const p = await mountPanel();
  p.type('cup °', 20); p.type('left edge °', 30); p.type('right edge °', 10); p.extend();
  const right = p.last().end.er.v;
  p.type('left edge °', 40); p.extend();
  near(p.last().end.e.v, 40, 0.5, 'the left side moved');
  near(p.last().end.er.v, right, 1e-6, 'the right side is as it was');
  p.panel.unmount();
});
test('D385 edges: typing the right edge alone leaves the left as it was', async () => {
  const p = await mountPanel();
  p.type('cup °', 20); p.type('left edge °', 30); p.type('right edge °', 10); p.extend();
  const left = p.last().end.e.v;
  p.type('right edge °', 5); p.extend();
  near(p.last().end.er.v, 5, 0.5, 'the right side moved');
  near(p.last().end.e.v, left, 1e-6, 'the left side is as it was');
  p.panel.unmount();
});
test('D385 edges: on an empty track, the left edge typed alone is the left side only (the right starts at 0)', async () => {
  const p = await mountPanel();
  p.type('cup °', 20); p.type('left edge °', 20); p.extend();
  near(p.last().end.e.v, 20, 0.5, 'left');
  near(p.last().end.er.v, 0, 0.5, 'right: not moved with it');
  p.panel.unmount();
});
