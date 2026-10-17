// core-cut.test.js: node --test app/test/core-cut.test.js   (under the heavy-run lock)
// D361 part 1 (pane C): CUT in the app. The core is src/core/piece.js cutRun (test/core_cut.test.js); this is the shell's preview, Apply and Cancel (app/core/coreshell.js) and
// Edit ▸ Selection's "Cut here" with the selection box's Apply cut / Cancel cut (app/core/piecesui.js), on the small fake DOM of app/test/core-buildmenu.test.js. Rows:
//   1  Cut here on a closed lap's middle run shows a PREVIEW (the track unchanged); Apply copies the track to its backups first, then cuts as ONE undo step: open, the kept pieces
//      rotated; Undo gives the closed lap back
//   2  a copy that cannot be written refuses the cut by name, with nothing changed
//   3  Cancel drops the preview; so does any change of the track (an undo); a new selection drops it
//   4  what a cut does to the start line, the hotlap and the pit lane is SAID (the preview's line, then the message)
//   5  a cut the core refuses (the middle of an open track) says why and previews nothing
//   6  Edit ▸ Selection lists Cut here after Delete selected: disabled with nothing selected; with a selection it starts the preview; the selection box shows Apply cut and
//      Cancel cut only while a cut is previewed, and Apply cut there applies it
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const PU = require('../core/piecesui.js');
const { PACK } = require('../../src/markers/layout.js');

const R = 180, Q = (Math.PI * R) / 2;
function store({ backupFails = false } = {}) {
  const st = { pieces: new Map(), backups: [] };
  return Object.assign(st, {
    listPieces: async () => [...st.pieces.keys()].sort(),
    openPiece: async (n) => { if (!st.pieces.has(n)) throw new Error(`could not read the piece "${n}": not found`); return st.pieces.get(n); },
    savePiece: async (n, t) => { st.pieces.set(n, t); },
    deletePiece: async (n) => { st.pieces.delete(n); },
    backupDoc: async (name, text) => { if (backupFails) throw new Error('the disk is full'); st.backups.push({ name, text }); return `${name}.bak`; },
  });
}
/** A closed lap, closed by the shell's own one-click close: p1 straight, p2-p5 quarter turns, p6 a short straight. */
async function lap(st = store()) {
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  s.close();
  assert.equal(s.getState().history.present.closed, true, s.getState().message);
  return s;
}
const ids = (s) => s.getState().history.present.pieces.map((P) => P.id);
const present = (s) => s.getState().history.present;
const select = (s, a, b) => { s.selectPiece(a); if (b !== undefined) s.selectPiece(b, { extend: true }); };

// ── the fake DOM (as app/test/core-buildmenu.test.js) ──
class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.disabled = false; this.clientWidth = 0; this.clientHeight = 0; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n); n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
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
async function mountPanel(shell) {
  const { doc } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 900; stage.clientHeight = 600;
  const root = doc.createElement('div');
  doc.addEventListener('t180-pick', (ev) => ev.detail.reply(null));
  doc.addEventListener('t180:track-request', (ev) => ev.detail.reply({ segments: shell.getState().resolved.segments, path: { samples: [] } }));
  const panel = require('../core/panel.js').mount(root, shell);
  const all = () => root.all();
  const hiddenEl = (e) => { for (let x = e; x; x = x.parent) if (x.style.display === 'none') return true; return false; };
  const button = (text) => all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const edit = () => PU.items({ doc });
  return { doc, root, panel, all, hiddenEl, button, edit, item: (label) => edit().find((i) => i.label === label) };
}

test('row 1: Cut here on a closed lap\'s middle run previews first; Apply copies the track to its backups, then cuts as one undo step (open, rotated); Undo gives the lap back', async () => {
  const st = store(), s = await lap(st), before = present(s);
  select(s, 2, 3);
  s.cutSelection();
  const p = s.getState().cutProposal;
  assert.ok(p, s.getState().message); assert.equal(present(s), before, 'a preview changes nothing');
  assert.deepEqual(p.removed, ['p3', 'p4']); assert.deepEqual(p.kept, ['p5', 'p6', 'p1', 'p2']);
  assert.match(s.getState().message, /cut preview: 2 pieces go \(p3 to p4\)/); assert.match(s.getState().message, /starts where p5 began and ends at the end of p2/);
  assert.equal(s.getState().messageKind, 'ok');
  const n = s.getState().history.past.length;
  await s.applyCut();
  assert.equal(st.backups.length, 1, 'the track as it was is copied first'); assert.equal(D.parse(st.backups[0].text).closed, true, 'and the copy is the closed lap');
  assert.equal(present(s).closed, false); assert.deepEqual(ids(s), ['p5', 'p6', 'p1', 'p2']);
  assert.equal(s.getState().history.past.length, n + 1, 'one undo step'); assert.equal(s.getState().cutProposal, null);
  assert.match(s.getState().message, /^cut: 2 pieces go \(p3 to p4\)/); assert.match(s.getState().message, /Extend/);
  s.undo();
  assert.equal(present(s), before, 'Undo gives the very same closed lap back');
});

test('row 2: a copy that cannot be written refuses the cut by name, and nothing changes', async () => {
  const s = await lap(store({ backupFails: true })), before = present(s);
  select(s, 2); s.cutSelection(); await s.applyCut();
  assert.equal(present(s), before); assert.match(s.getState().message, /^not cut: the copy from before the cut could not be written \(the disk is full\); nothing changed/);
});

test('row 3: Cancel drops the preview; so does any change of the track, and a new selection', async () => {
  const s = await lap(), before = present(s);
  select(s, 2); s.cutSelection(); assert.ok(s.getState().cutProposal);
  s.cancelCut(); assert.equal(s.getState().cutProposal, null); assert.equal(present(s), before);
  await s.applyCut(); assert.equal(present(s), before, 'nothing to apply'); assert.match(s.getState().message, /nothing to apply/);
  select(s, 2); s.cutSelection(); s.selectPiece(4); assert.equal(s.getState().cutProposal, null, 'a new selection drops it');
  select(s, 2); s.cutSelection(); s.undo(); assert.equal(s.getState().cutProposal, null, 'an undo drops it');
});

test('row 4: what the cut does to the start line, the hotlap and the pit lane is said in the preview and in the message after', async () => {
  const s = await lap(), d0 = present(s);
  const lane = { ...D.PIT_DEFAULT, side: 'R', leave: { word: 'p1', along: 20 }, rejoin: { word: 'p1', along: 280 } };
  s.adopt(D.setPitLane(D.setSpawns(d0, { line: { along: 120 }, grid: { count: 8, rowGapM: PACK.rowGapM, colGapM: PACK.colGapM }, hotlap: { piece: 'p3', along: 10 } }), lane));
  select(s, 2, 3); s.cutSelection();
  const m = s.getState().message;
  assert.match(m, /The start line was on p1, which is no longer the first piece, so it is at the start of p5 now/);
  assert.match(m, /The hotlap spawn was on a cut piece and is removed/);
  assert.doesNotMatch(m, /pit lane/i, 'the lane on p1 is kept, so nothing is said of it');
  await s.applyCut();
  assert.match(s.getState().message, /start of p5 now/); assert.deepEqual(present(s).spawns.line, { along: 0 }); assert.equal(present(s).spawns.hotlap, undefined);
  s.undo(); select(s, 0); s.cutSelection();
  assert.match(s.getState().message, /The pit lane ran over a cut piece and is removed/);
});

test('row 5: a cut the core refuses says why and previews nothing', async () => {
  const s = await createCoreShell({ brushFn: null, storage: store(), autosaveMs: 0 });
  s.extend({ length: 200, family: 'bowl' }); s.extend({ length: 100 }); s.extend({ length: 100 });
  select(s, 1); s.cutSelection();
  assert.equal(s.getState().cutProposal, null); assert.match(s.getState().message, /^CUT_OPEN_MIDDLE: /);
  s.clearSelection(); s.cutSelection(); assert.match(s.getState().message, /select the pieces to cut first/);
});

test('row 6: Edit ▸ Selection lists Cut here after Delete selected; disabled with nothing selected; it starts the preview; Apply cut and Cancel cut show only while a cut is previewed', async () => {
  const s = await lap(), P = await mountPanel(s);
  const labels = P.edit().filter((i) => i.label).map((i) => i.label);
  assert.equal(labels.indexOf('Cut here'), labels.indexOf('Delete selected') + 1, `Cut here follows Delete selected (${labels.join(', ')})`);
  assert.equal(P.item('Cut here').disabled, true, 'nothing selected');
  P.item('Cut here').run(); assert.equal(s.getState().cutProposal, null, 'and its run does nothing');
  assert.ok(P.hiddenEl(P.button('Apply cut')) && P.hiddenEl(P.button('Cancel cut')), 'no preview: hidden');
  select(s, 2);
  assert.equal(P.item('Cut here').disabled, false);
  P.item('Cut here').run(); assert.ok(s.getState().cutProposal, s.getState().message);
  assert.ok(!P.hiddenEl(P.button('Apply cut')) && !P.hiddenEl(P.button('Cancel cut')), 'previewed: shown');
  assert.ok(P.all().some((e) => e.attrs['aria-label'] === 'cut preview' && /p3/.test(e.textContent)), 'the preview line names the piece cut');
  P.button('Cancel cut').onclick(); assert.equal(s.getState().cutProposal, null);
  P.item('Cut here').run(); P.button('Apply cut').onclick(); await new Promise((r) => setImmediate(r));
  assert.equal(present(s).closed, false); assert.deepEqual(ids(s), ['p4', 'p5', 'p6', 'p1', 'p2']);
  P.panel.unmount();
});
