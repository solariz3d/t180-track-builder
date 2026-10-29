// core-trackmenu.test.js: node --test app/test/core-trackmenu.test.js
// D355 part 3: THE TRACK MENU (app/core/trackmenu.js). Start & grid…, Pit lane… and Road surface ▸ are panels opened from the Track menu, holding the
// same controls the left column held (app/core/spawnsui.js, pitui.js, textures.js); "Local example" is File ▸ Developer ▸ Open example…. The menu bar
// (app/menubar/, another pane's) renders what items(ctx) returns (contract M); these tests are that renderer's side: they call a panel's mount function
// with a host element, drive the controls, and unmount. Headless, on the small fake DOM the spawns tests use, with the real shell on a closed bowl lap.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const TM = require('../core/trackmenu.js');
const { PACK } = require('../../src/markers/layout.js');

class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.parent = null; this.events = []; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; if (n.parent) n.remove(); n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  get classList() { return { toggle: () => {} }; }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  dispatchEvent(ev) { this.events.push(ev); this.ownerDocument.events.push(ev); return true; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}
function fakeWindow() {
  const doc = { listeners: {}, events: [], createElement: (t) => new El(t, doc) };
  doc.body = doc.createElement('body');
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const win = { document: doc, CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } } };
  doc.defaultView = win;
  return { doc, win };
}
const R = 180, Q = Math.PI * R / 2;

/** A real shell on a closed bowl lap, the fake page, and the menu's items as the bar will receive them. */
async function menu() {
  const { doc, win } = fakeWindow();
  const prevDoc = global.document, prevCE = global.CustomEvent;
  global.document = doc; global.CustomEvent = win.CustomEvent;   // textures.js builds its own elements and events from the page globals
  const shell = await createCoreShell({ brushFn: null });
  shell.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) shell.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  shell.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  shell.close();
  const ctx = { shell, document: doc, window: win };
  const track = TM.items(ctx);
  const item = (label) => track.find((i) => i.label === label);
  const open = (label) => { const host = doc.createElement('div'), m = item(label).panel(host); return { host, m, by: (aria) => host.all().find((e) => e.attrs['aria-label'] === aria), btn: (t) => host.all().find((e) => e.tagName === 'BUTTON' && e.textContent === t) }; };
  const done = () => { global.document = prevDoc; global.CustomEvent = prevCE; };
  return { shell, doc, win, ctx, track, item, open, done, state: () => shell.getState().history.present };
}

// D465 amended this row by name: it read "and nothing that is a command"; Track ▸ Smooth ramps is the menu's first command (0.4.20), after a separator
// AMENDED (D473): it read "then a separator and Smooth ramps, its one command"; Bank the lap is its second command, enabled on a closed lap only
test('the Track menu lists Start & grid…, Pit lane… and Road surface ▸ as panels, in that order, then a separator and its two commands, Smooth ramps and Bank the lap', async () => {
  const M = await menu();
  try {
    assert.deepEqual(M.track.map((i) => i.label || (i.separator ? '—' : '?')), ['Start & grid…', 'Pit lane…', 'Road surface ▸', '—', 'Smooth ramps', 'Bank the lap']);
    for (const i of M.track.slice(0, 3)) assert.equal(typeof i.panel, 'function', `${i.label} opens a panel`);
    assert.equal(typeof M.item('Smooth ramps').run, 'function', 'Smooth ramps is a command');
    assert.equal(M.item('Smooth ramps').panel, undefined);
    assert.equal(typeof M.item('Bank the lap').run, 'function', 'Bank the lap is a command');
    assert.equal(!!M.item('Bank the lap').disabled, false, 'enabled on this closed lap');
    M.shell.newDoc();
    assert.equal(TM.items(M.ctx).find((i) => i.label === 'Bank the lap').disabled, true, 'disabled on a lap that is not closed');
  } finally { M.done(); }
});

test('Track ▸ Smooth ramps runs the shell\'s smoothRamps: on this lap of turns, which has no ramps, it says so and changes nothing', async () => {
  const M = await menu();
  try {
    const was = M.state();
    M.item('Smooth ramps').run(M.ctx);
    for (let i = 0; i < 20 && !M.shell.getState().message; i++) await new Promise((r) => setImmediate(r));
    assert.equal(M.shell.getState().message, 'no bank, cup or edge ramps to smooth on this track: nothing changed');
    assert.equal(M.state(), was);
  } finally { M.done(); }
});

test('Start & grid…: the panel holds the section\'s controls, and ticking "place by hand" in it puts the start on the track', async () => {
  const M = await menu();
  try {
    const P = M.open('Start & grid…');
    assert.ok(P.host.all().some((e) => e.tagName === 'H3' && e.textContent === 'Start & grid'), 'the section\'s own heading');
    for (const aria of ['place the start by hand', 'start line metres into the first piece', 'grid cars', 'pack length: metres along the road between two cars in a column', 'hotlap piece']) assert.ok(P.by(aria), aria);
    assert.equal(M.state().spawns, undefined, 'control: the start is automatic until it is ticked');
    const tick = P.by('place the start by hand'); tick.checked = true; tick.onchange();
    assert.deepEqual(M.state().spawns, { line: { along: 285 }, grid: { count: PACK.count, rowGapM: PACK.rowGapM, colGapM: PACK.colGapM } });
    const cars = P.by('grid cars'); cars.value = '12'; cars.onchange();
    assert.equal(M.state().spawns.grid.count, 12, 'a moved control still works from its new place');
  } finally { M.done(); }
});

test('Pit lane…: the panel holds the section\'s controls, and ticking "pit lane" in it builds the lane', async () => {
  const M = await menu();
  try {
    const P = M.open('Pit lane…');
    assert.ok(P.host.all().some((e) => e.tagName === 'H3' && e.textContent === 'Pit lane'));
    for (const aria of ['pit lane', 'pit lane side', 'pit lane leaves on piece', 'pit boxes', 'pit lane status']) assert.ok(P.by(aria), aria);
    assert.equal(M.state().pitLane, undefined);
    const on = P.by('pit lane'); on.checked = true; on.onchange();
    assert.ok(M.state().pitLane && M.state().pitLane.boxes === 4, 'the lane is in the document');
    const boxes = P.by('pit boxes'); boxes.value = '6'; boxes.onchange();
    assert.equal(M.state().pitLane.boxes, 6);
  } finally { M.done(); }
});

test('a panel that is closed leaves nothing in its host, and the shell no longer drives it; opening it again shows the track as it is now', async () => {
  const M = await menu();
  try {
    const P = M.open('Start & grid…');
    const tick = P.by('place the start by hand'); tick.checked = true; tick.onchange();
    P.m.unmount();
    assert.equal(P.host.children.length, 0, 'its nodes are taken out of the host');
    M.shell.setSpawns(null);   // the track changes while it is closed: nothing throws, nothing is drawn into the old nodes
    assert.equal(tick.checked, true, 'the closed panel\'s own box was not redrawn: the shell no longer drives it');
    const again = M.open('Start & grid…');
    assert.equal(again.by('place the start by hand').checked, false, 'reopened, it shows the start is automatic again');
  } finally { M.done(); }
});

test('Road surface ▸: the asphalt is announced to the page at once, before the panel is ever opened (the preview and the export need it)', async () => {
  const M = await menu();
  try {
    const announced = M.doc.events.filter((e) => e.type === 't180:textures');
    assert.ok(announced.length >= 1 && announced.every((e) => e.detail.set), 'the controller is alive from the first items() call and the event leaves from an element inside the page');
    assert.equal(announced[0].detail.kind, 'asphalt');
  } finally { M.done(); }
});

test('Road surface ▸: opening it shows the same picker, choosing solid colour announces no set, and closing it keeps the choice alive', async () => {
  const M = await menu();
  try {
    const P = M.open('Road surface ▸');
    // amended: the picker was a native select, found by its tag; it sits in a menu, so it is a choice the page draws now (app/core/menupick.js), found by its label
    const pick = P.host.all().find((e) => e.attrs && e.attrs['aria-label'] === 'road surface');
    assert.ok(pick, 'the surface picker is in the panel'); assert.equal(pick.value, 'asphalt');
    assert.ok(P.host.all().some((e) => e.tagName === 'INPUT' && e.type === 'file'), 'and the picture box');
    const events = () => M.doc.events.filter((e) => e.type === 't180:textures');
    pick.value = 'solid'; pick.onchange();
    assert.equal(events().pop().detail.set, null, 'solid colour: no texture set');
    P.m.unmount();
    assert.equal(P.host.children.length, 0, 'the picker leaves the host when the panel closes');
    const second = M.open('Road surface ▸');
    assert.equal(second.host.all().find((e) => e.attrs && e.attrs['aria-label'] === 'road surface').value, 'solid', 'reopened, it still says what was chosen');
    M.shell.extend({ length: 50 });
    assert.ok(events().length >= 3, 'a new piece after the panel closed is still announced: the controller outlives the panel');
  } finally { M.done(); }
});

test('items() called again for the same shell does not start a second road-surface controller', async () => {
  const M = await menu();
  try {
    const before = M.doc.events.filter((e) => e.type === 't180:textures').length;
    TM.items(M.ctx); TM.items(M.ctx);
    const after = M.doc.events.filter((e) => e.type === 't180:textures').length;
    assert.equal(after, before, 'no new announcement: the same controller');
  } finally { M.done(); }
});

test('File ▸ Developer ▸ Open example…: developerItems has the one panel, and it refuses to open an example until both files are picked', async () => {
  const M = await menu();
  try {
    const dev = TM.developerItems(M.ctx);
    assert.deepEqual(dev.map((i) => i.label), ['Open example…']);
    const host = M.doc.createElement('div'); dev[0].panel(host);
    const all = host.all(), open = all.find((e) => e.tagName === 'BUTTON' && e.textContent === 'Open example'), msg = all.find((e) => e.attrs.role === 'status');
    assert.ok(all.some((e) => e.attrs['aria-label'] === 'the fit, *.pieces.json') && all.some((e) => e.attrs['aria-label'] === 'the read, *.read.json'), 'the two file boxes');
    await open.onclick();
    assert.match(msg.textContent, /pick both files/);
  } finally { M.done(); }
});

test('Open example…: with both files picked the shell opens the example under the file\'s name, as the left column\'s button did', async () => {
  const M = await menu();
  try {
    let got = null; M.shell.openExample = (f, r, name) => { got = { f, r, name }; };
    const host = M.doc.createElement('div'); TM.developerItems(M.ctx)[0].panel(host);
    const all = host.all(), fit = all.find((e) => e.attrs['aria-label'] === 'the fit, *.pieces.json'), read = all.find((e) => e.attrs['aria-label'] === 'the read, *.read.json');
    fit.files = [{ name: 'abc.pieces.json', text: async () => 'FIT' }]; read.files = [{ name: 'abc.read.json', text: async () => 'READ' }];
    await all.find((e) => e.tagName === 'BUTTON' && e.textContent === 'Open example').onclick();
    assert.deepEqual(got, { f: 'FIT', r: 'READ', name: 'abc (local)' });
  } finally { M.done(); }
});

test('items() with no shell or no page fails loudly and names what is missing', async () => {
  assert.throws(() => TM.items({}), /shell/);
  assert.throws(() => TM.items({ shell: {} }), /document|page/);
  assert.throws(() => TM.developerItems({}), /shell/);
});
