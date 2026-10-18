// core-buildmenu.test.js: node --test app/test/core-buildmenu.test.js   (under the heavy-run lock)
// D355 part 2 (pane C): THE BUILD MENU AND THE SLIM LEFT SIDE. The top-right menus (pane B's bar, app/menubar/) render each menu module's items(ctx) (contract M:
// { label, run }, { label, checked, toggle }, { label, panel: mountFn }, { section }, { separator }); the settings are app/settings.js (contract S: get, set, on). This
// file is the app's side of both for app/core/panel.js (Build: app/core/buildmenu.js) and app/core/piecesui.js (Edit's selection items), on the small fake DOM of
// app/test/core-pieces-ui.test.js. FEEL tier: targeted rows, no mutation harness. Rows:
//   1   Build lists its items in the brief's order, in contract M's shapes
//   2   a command moved to Build still does what its button did: Straight, Level, To floor and Jump each place their piece (one undo step each)
//   3   a "…" item opens a popover holding today's fields and button (the panel's own field style); its button works from there; closing it puts them back
//   4   Brush: the item says whether the brush is on and turns it on and off; the brush strip (mode, what, radius, sharp) shows only while it is on
//   5   Close the loop from Build starts the close as the button did (the line says so); on a closed loop it is disabled and does nothing
//   6   the left side keeps the brief's list, "More shape" folded, and nothing else shows there; the moved controls are still in the panel (held, out of sight)
//   7   the selection box shows only with a selection (and while a delete it started is previewed)
//   8   Edit's selection items (piecesui via M): nothing selected, they are disabled; with a selection they save, set the grip, delete and clear
//   9   the six keys through S: the panel starts from what S holds, follows S.on, and a setting survives a reload (a new store over the same storage)
//  10   a blocked store (every storage access throws) throws nothing: the panel mounts and a setting holds for the session; with no settings module at all the panel still mounts
//  11   D356: the grid step picked in Build ▸ Turn to grid… is saved through S (the real createSettings), and survives a reload
//  12   D356: an Undo that gives back the undone piece's turn-and-climb mode saves it through S, so Settings and the panel agree
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { createSettings } = require('../settings.js');
const BM = require('../core/buildmenu.js');
const PU = require('../core/piecesui.js');

const R = 180, TURN = 1 / R;
function store() {
  const st = { pieces: new Map(), backups: [] };
  return Object.assign(st, {
    listPieces: async () => [...st.pieces.keys()].sort(),
    openPiece: async (n) => { if (!st.pieces.has(n)) throw new Error(`could not read the piece "${n}": not found`); return st.pieces.get(n); },
    savePiece: async (n, t) => { if (st.pieces.has(n)) throw new Error(`a piece named "${n}" already exists`); st.pieces.set(n, t); },
    deletePiece: async (n) => { st.pieces.delete(n); },
    backupDoc: async (name, text) => { st.backups.push({ name, text }); return `${name}.bak`; },
  });
}
async function track(st = store()) {
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 150, transition: 60, targets: { kh: TURN } }); s.extend({ length: 150, transition: 60, targets: { kh: TURN } });
  s.extend({ length: 100, transition: 60, targets: { kh: 0 } }); s.extend({ length: 80 });
  assert.equal(s.getState().history.present.pieces.length, 5);
  return s;
}
const tick = () => new Promise((r) => setImmediate(r));

// ── the fake DOM (as app/test/core-pieces-ui.test.js) ──
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
  const timers = [];
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {} };
  doc.defaultView = win;
  return { doc, win, timers };
}
/** Contract S, as the brief writes it (pane B builds the real one, app/settings.js): get/set/on over `t180.settings.<key>`, every storage access in try/catch. */
function settingsOver(storage) {
  const mem = new Map(), fns = new Map();
  const K = (k) => `t180.settings.${k}`;
  return {
    get(key, fallback) { if (mem.has(key)) return mem.get(key); try { const t = storage.getItem(K(key)); return t === null || t === undefined ? fallback : JSON.parse(t); } catch (e) { return fallback; } },
    set(key, value) { mem.set(key, value); try { storage.setItem(K(key), JSON.stringify(value)); } catch (e) { /* blocked: the session keeps it */ } for (const f of fns.get(key) || []) f(value); },
    on(key, fn) { fns.set(key, [...(fns.get(key) || []), fn]); return () => fns.set(key, (fns.get(key) || []).filter((g) => g !== fn)); },
  };
}
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const blockedStorage = () => ({ getItem() { throw new Error('SecurityError: blocked'); }, setItem() { throw new Error('SecurityError: blocked'); }, removeItem() { throw new Error('SecurityError: blocked'); } });

async function mountPanel({ settings, shell: given } = {}) {
  const { doc, win, timers } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 900; stage.clientHeight = 600;
  const root = doc.createElement('div'), shell = given || await track();
  const T = { s: 100 };
  doc.addEventListener('t180-pick', (ev) => ev.detail.reply(T.s === null ? null : { s: T.s, pos: [0, 0, 0], px: 1 }));
  doc.addEventListener('t180:track-request', (ev) => ev.detail.reply({ segments: shell.getState().resolved.segments, path: { samples: [] } }));
  const panel = require('../core/panel.js').mount(root, shell, settings ? { settings } : undefined);
  const all = () => root.all();
  for (const e of all()) if (e.tagName === 'INPUT' && e.value === '' && e.attrs.value) e.value = e.attrs.value;   // a browser's input starts at its value attribute (length 100, turn by 90, …)
  const hiddenEl = (e) => { for (let x = e; x; x = x.parent) if (x.style.display === 'none' || x.attrs.hidden !== undefined || (x.tagName === 'DETAILS' && x !== e && !x.open && !(x.children[0] === e || (x.children[0] && x.children[0].all().includes(e))))) return true; return false; };
  const shown = () => all().filter((e) => !hiddenEl(e));
  const button = (text, list = all()) => list.find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const byLabel = (label, list = all()) => list.find((e) => e.attrs['aria-label'] === label);
  const pointer = (type, x, y, extra = {}) => { for (const f of (stage.listeners[type] || []).slice()) f({ clientX: x, clientY: y, button: 0, preventDefault() {}, ...extra }); };
  const click = (s, extra = {}) => { T.s = s; pointer('pointerdown', 50, 50, extra); pointer('pointerup', 50, 50, extra); };
  const build = () => BM.items({ doc });
  const edit = () => PU.items({ doc });
  const item = (list, label) => list.find((i) => i.label === label);
  /** a popover as the bar opens one: a container, the item's mountFn into it, and what it returns to close it */
  const open = (it) => { const box = doc.createElement('div'); const close = it.panel(box); return { box, close }; };
  return { doc, win, timers, stage, root, shell, panel, all, shown, hiddenEl, button, byLabel, click, build, edit, item, open };
}
const pieces = (P) => P.shell.getState().history.present.pieces.length;

test('row 1: Build lists its items in the brief\'s order, in contract M\'s shapes', async () => {
  const P = await mountPanel(), list = P.build();
  assert.deepEqual(list.filter((i) => i.label).map((i) => i.label), ['Straight', 'Level', 'To floor', 'Turn by…', 'Turn to grid…', 'Sharp corner…', 'Jump', 'Brush', 'Close the loop']);
  for (const i of list) {
    const shape = i.section !== undefined ? 'section' : i.separator ? 'separator' : typeof i.run === 'function' ? 'run' : typeof i.toggle === 'function' ? 'toggle' : typeof i.panel === 'function' ? 'panel' : 'none';
    assert.notEqual(shape, 'none', `an item of no known shape: ${JSON.stringify(i)}`);
    if (shape === 'toggle') assert.equal(typeof i.checked, 'boolean');
  }
  assert.deepEqual(['Turn by…', 'Turn to grid…', 'Sharp corner…'].map((l) => typeof P.item(list, l).panel), ['function', 'function', 'function'], 'each … opens a popover');
  assert.equal(typeof P.item(list, 'Brush').toggle, 'function');
  P.panel.unmount();
  assert.deepEqual(BM.items({ doc: P.doc }), [], 'no panel mounted: Build has nothing to offer (the bar shows it empty, never a dead command)');
});

test('row 2: a command moved to Build still does what its button did: Straight, Level, To floor and Jump each place their piece, one undo step each', async () => {
  const P = await mountPanel();
  for (const label of ['Straight', 'Level', 'To floor']) {
    const n = pieces(P), before = P.shell.getState().history.present;
    P.item(P.build(), label).run();
    assert.equal(pieces(P), n + 1, `${label}: ${P.shell.getState().message}`);
    P.shell.undo(); assert.equal(P.shell.getState().history.present, before, `${label} is one undo step`); P.item(P.build(), label).run();
  }
  const n = pieces(P); P.item(P.build(), 'Jump').run();
  assert.ok(pieces(P) > n, `Jump: ${P.shell.getState().message}`); assert.ok(P.shell.landing(), 'the landing is the head');
  P.panel.unmount();
});

test('row 3: a "…" item opens a popover with today\'s fields and button in the panel\'s field style; its button works from there; closing it puts them back', async () => {
  const P = await mountPanel();
  const turnByBtn = P.button('Turn by');
  const pop = P.open(P.item(P.build(), 'Turn by…'));
  assert.ok(pop.box.all().includes(turnByBtn), 'the Turn by button is in the popover');
  const fld = pop.box.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === 'turn by °');
  assert.ok(fld, 'the turn by ° field is in the popover'); assert.equal(fld.attrs.class, 'picker', 'in the panel\'s own field style');
  fld.children[1].value = '45'; const n = pieces(P); turnByBtn.onclick();
  assert.equal(pieces(P), n + 1, P.shell.getState().message);
  assert.equal(typeof pop.close, 'function'); pop.close();
  assert.ok(!pop.box.all().includes(turnByBtn), 'closed: the button left the popover'); assert.ok(P.all().includes(turnByBtn), 'and is the panel\'s again');
  for (const [label, want] of [['Turn to grid…', ['Turn to grid', 'grid °', 'end heading']], ['Sharp corner…', ['Sharp', 'sharp °', 'sharp radius m', 'sharp ramp m']]]) {
    const p2 = P.open(P.item(P.build(), label)), txt = p2.box.all().map((e) => (e.tagName === 'BUTTON' || e.tagName === 'SPAN' ? e.textContent : e.attrs['aria-label'] || '')).filter(Boolean);
    for (const w of want) assert.ok(txt.includes(w), `${label} holds ${w} (has ${txt.join(', ')})`);
    p2.close();
  }
  const sharp = P.open(P.item(P.build(), 'Sharp corner…')); const n2 = pieces(P); P.button('Sharp', sharp.box.all()).onclick(); assert.ok(pieces(P) > n2, P.shell.getState().message); sharp.close();   // (a sharp corner is placed as more than one piece)
  P.panel.unmount();
});

test('row 4: Brush says whether the brush is on and turns it on and off; the brush strip (mode, what, radius, sharp) shows only while it is on', async () => {
  const P = await mountPanel(), strip = P.byLabel('brush strip');
  assert.ok(strip, 'there is a brush strip');
  for (const l of ['brush mode', 'brush channel', 'sharp brush']) assert.ok(strip.all().some((e) => e.attrs['aria-label'] === l), `the strip holds ${l}`);
  assert.ok(strip.all().some((e) => e.tagName === 'SPAN' && e.textContent === 'radius m'), 'the strip holds the radius');
  assert.equal(P.item(P.build(), 'Brush').checked, false); assert.ok(P.hiddenEl(strip), 'off: no strip');
  P.item(P.build(), 'Brush').toggle();
  assert.equal(P.byLabel('brush on').checked, true, 'the brush is armed'); assert.equal(P.item(P.build(), 'Brush').checked, true); assert.ok(!P.hiddenEl(strip), 'on: the strip shows');
  P.item(P.build(), 'Brush').toggle();
  assert.equal(P.byLabel('brush on').checked, false); assert.ok(P.hiddenEl(strip), 'off again: the strip goes');
  P.panel.unmount();
});

test('row 5: Close the loop from Build starts the close as the button did; on a closed loop it is disabled and does nothing', async () => {
  const P = await mountPanel(), close = P.item(P.build(), 'Close the loop');
  assert.notEqual(close.disabled, true); close.run();
  assert.match(P.byLabel('close').textContent, /^Closing the loop…/, 'the line under it says so at once'); assert.equal(P.timers.length, 1, 'and the close is started off the press');
  // a closed loop (as app/test/core-close-preview.test.js makes one: four quarter turns and the shell's own close)
  const s = await createCoreShell({ brushFn: null, storage: store(), autosaveMs: 0 });
  s.extend({ length: 300, family: 'bowl' }); for (let i = 0; i < 4; i++) s.extend({ length: (Math.PI * R) / 2, transition: 40, targets: { kh: TURN } }); s.extend({ length: 200, transition: 40, targets: { kh: 0 } }); s.close();
  assert.equal(s.getState().history.present.closed, true, s.getState().message);
  const Q = await mountPanel({ shell: s }), c2 = Q.item(Q.build(), 'Close the loop');
  assert.equal(c2.disabled, true, 'a closed loop: Close is disabled'); const t0 = Q.timers.length, d0 = s.getState().history.present; c2.run();
  assert.equal(Q.timers.length, t0, 'nothing started'); assert.equal(s.getState().history.present, d0);
  Q.panel.unmount(); P.panel.unmount();
});

test('row 6: the left side keeps the brief\'s list, "More shape" folded, and nothing else shows there; the moved controls are still in the panel, held out of sight', async () => {
  const P = await mountPanel(), shown = P.shown();
  const shownButtons = shown.filter((e) => e.tagName === 'BUTTON').map((e) => e.textContent);
  for (const b of ['Undo', 'Redo', 'Extend', 'Straight']) assert.ok(shownButtons.includes(b), `${b} is on the left`);
  for (const b of ['Jump', 'Level', 'To floor', 'Turn by', 'Turn to grid', 'Sharp', 'Close the loop', 'Open example']) assert.ok(!shownButtons.includes(b), `${b} is not on the left (it is in a menu)`);
  assert.ok(P.button('Cancel') && P.hiddenEl(P.button('Cancel')), 'Cancel close: there, shown only while closing');
  const shownSpans = shown.filter((e) => e.tagName === 'SPAN').map((e) => e.textContent);
  for (const f of ['length m', 'bank °']) assert.ok(shownSpans.includes(f), `${f} is on the left`);
  assert.ok(shownSpans.some((t) => /^turn °/.test(t)) && shownSpans.some((t) => /^climb °/.test(t)), 'turn and climb are on the left');
  for (const f of ['turn & climb as', 'drag handles', 'colour by grip', 'turn by °', 'grid °', 'sharp °', 'fit', 'read']) assert.ok(!shownSpans.includes(f), `${f} is not on the left`);
  const more = P.all().find((e) => e.tagName === 'DETAILS' && e.children[0] && e.children[0].textContent === 'More shape');
  assert.ok(more, 'there is a "More shape"'); assert.equal(!!more.open, false, 'folded');
  const inMore = more.all().filter((e) => e.tagName === 'SPAN').map((e) => e.textContent);
  // AMENDED D385 (2026-10-18): "edge angle °" is now "left edge °", the same field renamed (app/test/core-carry.test.js)
  for (const f of ['cup °', 'width m', 'grip %', 'left edge °', 'right edge °', 'edge start', 'tube sweep °']) assert.ok(inMore.includes(f), `More shape holds ${f}`);
  assert.equal(more.all().filter((e) => e.tagName === 'INPUT' && /at the start$/.test(e.attrs['aria-label'] || '')).length, 6, 'and the at-start boxes of its six channel fields');
  assert.ok(P.byLabel('the piece Extend would add') && !P.hiddenEl(P.byLabel('the piece Extend would add')), 'the readout is on the left');
  // every control that moved is still the panel's (the menus borrow them), so what it does is unchanged
  for (const l of ['turn and climb as', 'drag handles', 'colour by grip', 'grid step']) assert.ok(P.byLabel(l), `${l} is still in the panel`);
  for (const b of ['Jump', 'Level', 'To floor', 'Turn by', 'Turn to grid', 'Sharp', 'Close the loop']) assert.ok(P.button(b), `${b} is still in the panel`);
  // (Open example…, Start & grid… and Pit lane… are pane A's Track menu's own, app/core/trackmenu.js: the seam ruling, plan_t180_handoff :1421-1424)
  assert.ok(!P.button('Open example') && !P.all().some((e) => e.tagName === 'H3' && /^(Start & grid|Pit lane|Local example)$/.test(e.textContent)), 'the panel makes none of the Track menu\'s controls');
  P.panel.unmount();
});

test('row 7: the selection box shows only with a selection, and while a delete it started is previewed', async () => {
  const P = await mountPanel(), box = P.byLabel('selected pieces');
  assert.ok(box, 'there is a selection box'); assert.ok(P.hiddenEl(box), 'nothing selected: not shown');
  P.click(400); assert.ok(!P.hiddenEl(box), 'a selection: shown');
  P.button('Delete selected').onclick(); assert.ok(P.shell.getState().deleteProposal, P.shell.getState().message);
  assert.ok(!P.hiddenEl(box), 'the delete preview is shown (Apply and Cancel are in the box)');
  P.button('Cancel delete').onclick(); P.click(null); assert.equal(P.shell.getState().selection, null); assert.ok(P.hiddenEl(box), 'cleared: not shown');
  P.panel.unmount();
});

test('row 8: Edit\'s selection items (piecesui via M): disabled with nothing selected; with a selection they save, set the grip, delete and clear', async () => {
  const P = await mountPanel();
  // AMENDED D361 part 1 (the list's rule changed: the packet adds Edit ▸ Selection ▸ Cut here after Delete selected); the row's checks now cover Cut here too
  const labels = ['Save as piece…', 'Set grip…', 'Delete selected', 'Cut here', 'Clear selection'];
  assert.deepEqual(P.edit().filter((i) => i.label).map((i) => i.label), labels);
  for (const l of labels) assert.equal(P.item(P.edit(), l).disabled, true, `${l}: nothing selected, disabled`);
  P.click(400); P.click(550, { shiftKey: true });
  for (const l of labels) assert.notEqual(P.item(P.edit(), l).disabled, true, `${l}: a selection, enabled`);
  const save = P.open(P.item(P.edit(), 'Save as piece…')); const name = save.box.all().find((e) => e.attrs['aria-label'] === 'piece name');
  assert.ok(name, 'the name box is in the popover'); name.value = 'two turns'; P.button('Save as piece', save.box.all()).onclick(); await tick(); await tick();
  assert.equal(P.shell.getState().message && /saved the piece/.test(P.shell.getState().message), true, P.shell.getState().message); save.close();
  assert.ok(P.byLabel('selected pieces').all().includes(name), 'closed: the name box is back in the selection box');
  P.click(400); const grip = P.open(P.item(P.edit(), 'Set grip…')); const g = grip.box.all().find((e) => e.attrs['aria-label'] === 'selection grip'); g.value = '120'; P.button('Set grip', grip.box.all()).onclick(); grip.close();
  assert.match(P.shell.getState().message || '', /grip/i);
  P.item(P.edit(), 'Clear selection').run(); assert.equal(P.shell.getState().selection, null, 'Clear clears');
  P.click(P.shell.getState().resolved.segments.reduce((a, s) => a + s.length, 0) - 20); const n = pieces(P); P.item(P.edit(), 'Delete selected').run();
  assert.equal(pieces(P), n - 1, `the last piece goes at once: ${P.shell.getState().message}`);
  P.panel.unmount(); assert.deepEqual(PU.items({ doc: P.doc }), [], 'no panel: Edit has no selection items');
});

test('row 9: the six keys through S: the panel starts from what S holds, follows S.on, and a setting survives a reload', async () => {
  const storage = memStorage();
  let S = settingsOver(storage);
  S.set('turnClimbAs', 'rate'); S.set('dragHandles', false); S.set('colourByGrip', true); S.set('gridStep', '45'); S.set('mirrorOnInsert', true);
  // a reload: a new store over the same storage, a new panel
  S = settingsOver(storage);
  let P = await mountPanel({ settings: S });
  assert.equal(P.byLabel('turn and climb as').value, 'rate'); assert.equal(P.byLabel('drag handles').checked, false); assert.equal(P.byLabel('colour by grip').checked, true);
  assert.equal(P.byLabel('grid step').value, '45'); assert.equal(P.byLabel('mirror on insert').checked, true);
  assert.equal(P.panel.gripLayer.visible(), true, 'colour by grip is on: the layer shows');
  // S.on: the Settings menu changes a key, the panel follows (and what each switch does follows with it)
  S.set('turnClimbAs', 'corner'); assert.equal(P.byLabel('turn and climb as').value, 'corner'); assert.match(P.all().find((e) => e.tagName === 'SPAN' && /^turn °/.test(e.textContent)).textContent, /^turn °$/, 'the turn field reads as a corner');
  S.set('colourByGrip', false); assert.equal(P.panel.gripLayer.visible(), false);
  S.set('dragHandles', true); assert.equal(P.byLabel('drag handles').checked, true);
  S.set('gridStep', '15'); assert.equal(P.byLabel('grid step').value, '15'); assert.match(P.byLabel('end heading').textContent, /15° grid/);
  S.set('mirrorOnInsert', false); assert.equal(P.byLabel('mirror on insert').checked, false);
  // the Pieces menu's own mirror box is a visible control: ticking it is a setting, kept for the next start
  const m = P.byLabel('mirror on insert'); m.checked = true; m.onchange(); assert.equal(settingsOver(storage).get('mirrorOnInsert', false), true);
  P.panel.unmount();
  // the keys not set fall back to today's defaults
  P = await mountPanel({ settings: settingsOver(memStorage()) });
  assert.deepEqual([P.byLabel('turn and climb as').value, P.byLabel('drag handles').checked, P.byLabel('colour by grip').checked, P.byLabel('grid step').value, P.byLabel('mirror on insert').checked], ['corner', true, false, '90', false]);
  P.panel.unmount();
});

test('row 10: a blocked store throws nothing: the panel mounts and a setting holds for the session; with no settings module at all the panel still mounts', async () => {
  const S = settingsOver(blockedStorage());
  const P = await mountPanel({ settings: S });
  assert.equal(P.byLabel('turn and climb as').value, 'corner');
  S.set('turnClimbAs', 'rate'); assert.equal(P.byLabel('turn and climb as').value, 'rate', 'set on a blocked store: it holds for the session');
  const m = P.byLabel('mirror on insert'); m.checked = true; assert.doesNotThrow(() => m.onchange());
  P.panel.unmount();
  const Q = await mountPanel();   // no settings passed: the panel finds app/settings.js, or keeps the settings for this session only when it is not there yet
  assert.equal(Q.byLabel('turn and climb as').value, 'corner'); Q.panel.unmount();
});

// D356 part 1 (Ponytail review 5 on D355, E's rows 1-2): the panel's own writes, on the REAL settings (app/settings.js createSettings). The stand-in above,
// settingsOver, tells its listeners on every set; the real one only on a change, and that is the difference the rows above could not see
test('row 11: the grid step picked in Build ▸ Turn to grid… is saved: S holds it, the Settings menu hears it, and it is the step after a reload', async () => {
  const storage = memStorage(), S = createSettings(storage), heard = [];
  S.on('gridStep', (v) => heard.push(v));
  const P = await mountPanel({ settings: S });
  const pop = P.open(P.item(P.build(), 'Turn to grid…')), step = P.byLabel('grid step', pop.box.all());
  step.value = '45'; step.onchange();
  assert.equal(S.get('gridStep', 90), 45, 'S holds the step picked'); assert.deepEqual(heard, [45], 'and the Settings menu was told, once');
  assert.match(P.byLabel('end heading', pop.box.all()).textContent, /45° grid/, 'the note follows, as before');
  step.value = '90'; step.onchange();
  assert.equal(S.get('gridStep', 45), 90, 'picking the default back is saved too'); assert.deepEqual(heard, [45, 90]);
  step.value = '15'; step.onchange(); pop.close(); P.panel.unmount();
  const R2 = await mountPanel({ settings: createSettings(storage) });   // a reload: a new store over the same storage, a new panel
  assert.equal(R2.byLabel('grid step').value, '15'); R2.panel.unmount();
});

test('row 12: Undo that gives the undone piece its turn-and-climb mode back saves the mode, so Settings and the panel agree', async () => {
  const S = createSettings(memStorage());
  const P = await mountPanel({ settings: S });
  assert.equal(P.byLabel('turn and climb as').value, 'corner');
  const n = pieces(P); P.button('Extend').onclick(); assert.equal(pieces(P), n + 1, P.shell.getState().message);   // made as a corner
  S.set('turnClimbAs', 'rate');   // the Settings menu switches to rate
  assert.equal(P.byLabel('turn and climb as').value, 'rate', 'the panel follows S');
  P.shell.undo();
  assert.equal(P.byLabel('turn and climb as').value, 'corner', 'Undo gives the piece back the way it was read (D242 item 7), unchanged');
  assert.equal(S.get('turnClimbAs', 'rate'), 'corner', 'and S says so, so the Settings menu ticks corner');
  // an Undo whose piece was made in the mode S already holds writes nothing new
  const heard = []; S.on('turnClimbAs', (v) => heard.push(v));
  P.button('Extend').onclick(); P.shell.undo(); assert.deepEqual(heard, [], 'same mode: no change to tell');
  P.panel.unmount();
});
