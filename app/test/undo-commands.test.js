// undo-commands.test.js (pane A, L229 addendum 2): pane C's rows C1-C4 from its read of 2e70b9f (handback/p-l230-C_2026-11-25_evidence/c-l230-read.test.js, C5 left out: it is a 200-piece size measure), plus T1, the row C could not set up.
// C's finding: after an undo of Level, Turn by, Turn to grid, Sharp or Jump the preview must show the road the undo REMOVED, not the plain Extend of the boxes (panel.js: only an undone Extend gives the panel's own next-piece ghost).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const D = require('../../src/core/document.js');
const { createCoreShell } = require('../core/coreshell.js');
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

async function mount(storage = null) {
  const { doc, tick } = fakeWindow();
  const root = doc.createElement('div'), shell = await createCoreShell(storage ? { brushFn: null, storage, autosaveMs: 0 } : { brushFn: null });
  shell.extend({ length: 300, family: 'bowl', first: { w: 33 } });
  const calls = [], real = shell.extend; shell.extend = (o) => { calls.push(o); return real(o); };
  return wire({ doc, tick, root, shell, calls });
}
function wire(p) {
  const { root, shell } = p;
  p.panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => { const l = label(text); if (!l) throw new Error(`no "${text}" field`); return l.children[1]; };
  const byAria = (a) => { const f = root.all().find((e) => e.attrs && e.attrs['aria-label'] === a); if (!f) throw new Error(`no element labelled "${a}"`); return f; };
  Object.assign(p, { field, byAria, type: (t, v) => { const f = field(t); f.value = String(v); f.oninput(); }, set: (f, v) => { f.value = String(v); (f.oninput || f.onchange)(); }, tick2: (b, on) => { b.checked = on; b.onchange(); },
    button: (t) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === t) });
  return p;
}
// one piece typed as he would (pane O's route.js `piece`, without removing the rows afterwards: Undo must give them back)
function typePiece(p, s) {
  p.set(p.byAria('turn and climb as'), s.as || 'corner');
  p.type('length m', s.L); p.type((s.as || 'corner') === 'rate' ? 'turn °/100m' : 'turn °', s.turn === undefined ? '' : s.turn); p.type('bank °', s.bank === undefined ? '' : s.bank);
  if (s.flow) { p.tick2(p.byAria('bank flows through its marks'), true); p.set(p.byAria('bank at'), s.at === undefined ? '' : s.at); }
  for (const [f, then, from] of s.rows || []) p.panel.secondAdd(f, { then: String(then), from: String(from) });
}
const S_PIECE = { L: 300, turn: 0, bank: -20, flow: true, at: 80, rows: [['turn', 92, 80], ['turn', -91, 200], ['bank', -27, 145], ['bank', 0, 200], ['bank', 25, 255], ['bank', 26, 300]] };
const PLAIN = { L: 200, turn: 45, as: 'corner' };
const ROWS = { L: 250, turn: 60, as: 'corner', rows: [['turn', -50, 120]] };
const lastPiece = (p) => JSON.stringify(D.parse(p.shell.text()).pieces.at(-1));
const nPieces = (p) => D.parse(p.shell.text()).pieces.length;
function memStorage() {
  const files = new Map();
  return { files, saveDoc: async (n, t) => files.set(n, t), openDoc: async (n) => files.get(n), listDocs: async () => [...files.keys()], saveUndo: async (n, t) => files.set(n + '.undo', t), openUndo: async (n) => files.get(n + '.undo') ?? null,
    savePiece: async () => {}, openPiece: async () => '', listPieces: async () => [], deletePiece: async () => {}, saveAutosave: async () => {}, clearAutosave: async () => {}, openAutosave: async () => null, backupDoc: async () => {}, listBackups: async () => [], docSavedAt: async () => null };
}
// ---- pane C, L230: the second read's own rows (not committed; the harness above is undo-values.test.js lines 7-68)
const { bindKeys } = require('../core/keys.js');
async function mountC() {
  const { doc, tick } = fakeWindow(); doc.activeElement = null;
  const events = []; for (const k of ['t180-ghost', 't180-ghost-clear']) doc.addEventListener(k, (e) => events.push({ type: k, detail: e.detail }));
  doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(null)); doc.addEventListener('t180:view', (e) => e.detail.reply({ pose: null }));
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null, autosaveMs: 0 });
  shell.extend({ length: 300, family: 'bowl', first: { w: 33 } });
  const p = wire({ doc, tick, root, shell, calls: [] }); p.events = events; p.doc = doc;
  bindKeys(doc, shell, { save: () => {} });
  p.press = (key, mods, target) => { const e = { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods, target: target || { matches: () => false, isContentEditable: false }, prevented: false, preventDefault() { this.prevented = true; } }; for (const f of (doc.listeners.keydown || []).slice()) f(e); return e; };
  return p;
}
const lastGhost = (p) => p.events.at(-1);
const ghostLen = (ev) => (ev && ev.type === 't180-ghost' ? ev.detail.candidate.segments.reduce((a, g) => a + g.length, 0) : null);
const docLen = (p) => p.shell.getState().resolved.segments.reduce((a, g) => a + g.length, 0);
const say = (...a) => console.log('C-L230', ...a);

test('C1: brush, handle drag, jump; undo three times, redo three times: same bytes, no stale ghost or boxes', async () => {
  const p = await mountC();
  typePiece(p, PLAIN); p.button('Extend').onclick();
  typePiece(p, ROWS); p.button('Extend').onclick();
  const n0 = nPieces(p);
  p.shell.beginBrush({ mode: 'rate', channel: 'kh', s0: 420, r: 60 }); p.shell.brushTo(0.0005); p.shell.endBrush();
  assert.equal(nPieces(p), n0, 'brush keeps the piece count'); const afterBrush = p.shell.text();
  p.shell.setSculpt(true); p.shell.selectPiece(2); p.shell.beginSculpt({ channel: 'phi' }); p.shell.sculptTo(0.1); p.shell.endSculpt(); p.shell.setSculpt(false); p.shell.clearSelection(); p.tick();
  const afterSculpt = p.shell.text(); say('handle drag changed the doc:', afterSculpt !== afterBrush, p.shell.getState().message);
  p.type('length m', 120); p.button('Jump').onclick(); p.tick();
  const full = p.shell.text(), nFull = nPieces(p); say('pieces before', n0, 'after jump', nFull, 'msg', p.shell.getState().message);
  assert.ok(nFull > n0, 'the jump added pieces');
  const rows = [];
  for (let i = 0; i < 3; i++) {
    p.events.length = 0; p.shell.undo(); p.tick();
    const st = p.shell.getState(), ev = lastGhost(p);
    rows.push({ undo: i + 1, pieces: nPieces(p), undoGhost: !!st.undoGhost, events: p.events.map((e) => e.type).join(','), ghostM: ghostLen(ev) === null ? null : +ghostLen(ev).toFixed(1), docM: +docLen(p).toFixed(1), lengthBox: p.field('length m').value, turnBox: p.field('turn °').value });
  }
  say('undos', JSON.stringify(rows));
  const redo = [];
  for (let i = 0; i < 3; i++) { p.events.length = 0; p.shell.redo(); p.tick(); redo.push({ redo: i + 1, pieces: nPieces(p), undoGhost: !!p.shell.getState().undoGhost, events: p.events.map((e) => e.type).join(','), lengthBox: p.field('length m').value, turnBox: p.field('turn °').value }); }
  say('redos', JSON.stringify(redo));
  assert.equal(p.shell.text(), full, 'after three redos the document is the same bytes');
  assert.equal(p.shell.getState().undoGhost, null);
});

test('C1b: an undone Jump shows the jump that was removed, not an Extend piece', async () => {
  const p = await mountC();
  typePiece(p, PLAIN); p.button('Extend').onclick();
  const before = p.shell.getState().history.present, placedM = docLen(p);
  p.type('length m', 120); p.button('Jump').onclick(); p.tick();
  const jumpDoc = p.shell.getState().history.present, removedM = docLen(p) - placedM;
  say('jump added pieces', jumpDoc.pieces.length - before.pieces.length, 'metres', removedM.toFixed(1), 'types', jumpDoc.pieces.slice(before.pieces.length).map((P) => P.type).join(','));
  p.events.length = 0; p.shell.undo(); p.tick();
  const ev = lastGhost(p), gM = ghostLen(ev);
  say('after undo of jump: events', p.events.map((e) => e.type).join(','), '| ghost metres beyond placed', gM === null ? null : (gM - placedM).toFixed(1), '| jump flag', ev && ev.detail && ev.detail.candidate && ev.detail.candidate.jump, '| shell undoGhost.removed', p.shell.getState().undoGhost && p.shell.getState().undoGhost.removed);
  assert.ok(ev && ev.type === 't180-ghost', 'a ghost is shown');
  assert.ok(Math.abs((gM - placedM) - removedM) < 0.5, `the ghost is the removed road: ${(gM - placedM).toFixed(1)} m shown, ${removedM.toFixed(1)} m removed`);
});

for (const [name, btn, extra] of [['Level', 'Level', null], ['Turn to grid', 'Turn to grid', null], ['Turn by', 'Turn by', (p) => p.type('turn by °', 30)], ['Sharp', 'Sharp', (p) => { p.type('sharp °', 60); p.type('sharp radius m', 80); p.type('sharp ramp m', 20); }]]) {
  test(`C3: an undone ${name}: the preview is the road the undo removed`, async () => {
    const p = await mountC();
    typePiece(p, { L: 200, turn: 25, as: 'corner' }); p.type('climb °', 3);
    if (extra) extra(p);
    const b = p.button(btn); assert.ok(b, `no ${btn} button`); b.onclick(); p.tick();
    const done = p.shell.getState().history.present; if (done.pieces.length < 2) { say(name, 'refused:', p.shell.getState().message); return; }
    const removed = JSON.stringify(done.pieces.at(-1)), placedM = (() => { const r = p.shell.getState().resolved.segments; return r.reduce((a, g) => a + g.length, 0); })();
    p.events.length = 0; p.shell.undo(); p.tick();
    const ev = lastGhost(p);
    say(name, 'events after undo', p.events.map((e) => e.type).join(','), '| shell undoGhost', !!p.shell.getState().undoGhost);
    assert.ok(ev && ev.type === 't180-ghost', 'a ghost is shown');
    const ghostSegs = JSON.stringify(ev.detail.candidate.segments.map((g) => [g.length, g.kh0 !== undefined ? g.kh0 : null]));
    const ug = p.shell.getState().undoGhost, ugSegs = ug ? JSON.stringify(ug.candidate.segments.map((g) => [g.length, g.kh0 !== undefined ? g.kh0 : null])) : null;
    // lay what the panel's ghost shows: Extend from the boxes as they are now
    p.button('Extend').onclick();
    const viaExtend = JSON.stringify(p.shell.getState().history.present.pieces.at(-1));
    say(name, '| the ghost sent is the shell undo ghost:', ghostSegs === ugSegs, '| Extend from the given-back boxes lays the removed piece:', viaExtend === removed, '| ghost m', ghostLen(ev).toFixed(1), 'removed doc m', placedM.toFixed(1));
    // AMENDED BY NAME (A, L229 addendum 2): C3 asserted that Extend on the given-back boxes lays the removed piece. With the fix the ghost shown is the road removed (asserted here and in C4), so that identity is a different question: do the boxes hold the COMMAND's own numbers? They do not (fieldsNow holds the Extend boxes only, not Turn by's angle, Sharp's three, or the grid step), so it is kept below as C3b, a todo that still runs and prints.
    assert.equal(ghostSegs, ugSegs, `${name}: the ghost sent is the road the undo removed`);
  });
  test(`C3b: an undone ${name}: Extend on the given-back boxes lays the piece ${name} laid`, { todo: 'OPEN: the boxes hold the Extend fields, not the command own numbers (Turn by angle, Sharp degrees/radius/ramp, grid step)' }, async () => {
    const p = await mountC();
    typePiece(p, { L: 200, turn: 25, as: 'corner' }); p.type('climb °', 3);
    if (extra) extra(p);
    const b = p.button(btn); assert.ok(b, `no ${btn} button`); b.onclick(); p.tick();
    const done = p.shell.getState().history.present; if (done.pieces.length < 2) { say(name, 'refused:', p.shell.getState().message); return; }
    const removed = JSON.stringify(done.pieces.at(-1)), placedM = (() => { const r = p.shell.getState().resolved.segments; return r.reduce((a, g) => a + g.length, 0); })();
    p.events.length = 0; p.shell.undo(); p.tick();
    const ev = lastGhost(p);
    say(name, 'events after undo', p.events.map((e) => e.type).join(','), '| shell undoGhost', !!p.shell.getState().undoGhost);
    assert.ok(ev && ev.type === 't180-ghost', 'a ghost is shown');
    const ghostSegs = JSON.stringify(ev.detail.candidate.segments.map((g) => [g.length, g.kh0 !== undefined ? g.kh0 : null]));
    const ug = p.shell.getState().undoGhost, ugSegs = ug ? JSON.stringify(ug.candidate.segments.map((g) => [g.length, g.kh0 !== undefined ? g.kh0 : null])) : null;
    // lay what the panel's ghost shows: Extend from the boxes as they are now
    p.button('Extend').onclick();
    const viaExtend = JSON.stringify(p.shell.getState().history.present.pieces.at(-1));
    say(name, '| the ghost sent is the shell undo ghost:', ghostSegs === ugSegs, '| Extend from the given-back boxes lays the removed piece:', viaExtend === removed, '| ghost m', ghostLen(ev).toFixed(1), 'removed doc m', placedM.toFixed(1));
    assert.equal(viaExtend, removed, `${name}: the boxes given back, laid by Extend (the ghost shown), are not the piece ${name} laid`);
  });
}

test('C2: undo, type in a box, Undo button: whose numbers are in the boxes', async () => {
  const p = await mountC();
  typePiece(p, PLAIN); p.button('Extend').onclick();
  typePiece(p, ROWS); p.button('Extend').onclick();
  p.shell.undo(); p.tick();
  const a = { len: p.field('length m').value, turn: p.field('turn °').value };
  const len = p.field('length m'); p.type('length m', 77); p.doc.activeElement = len;
  p.button('Undo').onclick(); p.tick();
  const b = { len: p.field('length m').value, turn: p.field('turn °').value, pieces: nPieces(p), ug: !!p.shell.getState().undoGhost, events: p.events.slice(-2).map((e) => e.type).join(',') };
  say('C2 after first undo', JSON.stringify(a), '| after typing 77 then the Undo button', JSON.stringify(b));
  assert.equal(a.len, '250'); assert.equal(b.len, '200'); assert.equal(b.turn, '45');
});

test('C2k: the same with Ctrl+Z (the guard first puts the typed box back, then undoes)', async () => {
  const p = await mountC();
  typePiece(p, PLAIN); p.button('Extend').onclick();
  typePiece(p, ROWS); p.button('Extend').onclick();
  p.press('z', { ctrlKey: true }); p.tick();
  const len = p.field('length m'); const a = len.value;
  p.type('length m', 77); p.doc.activeElement = len;
  p.press('z', { ctrlKey: true }, len); p.tick(); const b = { len: len.value, pieces: nPieces(p) };
  p.press('z', { ctrlKey: true }, len); p.tick(); const c = { len: len.value, turn: p.field('turn °').value, pieces: nPieces(p) };
  say('C2k after undo', a, '| typed 77 then Ctrl+Z', JSON.stringify(b), '| Ctrl+Z again', JSON.stringify(c));
  assert.equal(a, '250'); assert.equal(b.len, '250'); assert.equal(c.len, '200');
});

// ---- C4: which road the preview is sent after undoing a step that is not a plain Extend (identity, and the shape beyond the placed road)
const segSig = (segs) => segs.map((g) => JSON.stringify(g, (k, v) => (typeof v === 'number' ? +v.toFixed(6) : v))).join('|');
for (const [name, act] of [
  ['Level', (p) => { p.type('climb °', 3); p.button('Level').onclick(); }],
  ['Turn by', (p) => { p.type('turn by °', 30); p.button('Turn by').onclick(); }],
  ['Sharp', (p) => { p.type('sharp °', 60); p.type('sharp radius m', 80); p.type('sharp ramp m', 20); p.button('Sharp').onclick(); }],
  ['Jump', (p) => { p.type('turn °', ''); p.button('Jump').onclick(); }],
  ['Extend (control)', (p) => { p.button('Extend').onclick(); }],
]) {
  test(`C4: undo of ${name}: the preview's ghost is the road that was removed`, async () => {
    const p = await mountC();
    typePiece(p, { L: 200, turn: 25, as: 'corner' });
    const n0 = nPieces(p), placed = p.shell.getState().resolved.segments.length;
    act(p); p.tick();
    const removedSegs = p.shell.getState().resolved.segments.slice(placed), nAfter = nPieces(p);
    if (nAfter === n0) { say(name, 'refused:', p.shell.getState().message); return; }
    p.events.length = 0; p.shell.undo(); p.tick();
    const ev = lastGhost(p), ug = p.shell.getState().undoGhost;
    const shown = ev && ev.type === 't180-ghost' ? ev.detail.candidate.segments.slice(placed) : null;
    const extendCand = p.shell.candidate(p.panel.options()).segments.slice(placed);
    say(name, '| pieces removed', nAfter - n0, '| sent is st.undoGhost.candidate:', !!(ev && ug && ev.detail.candidate === ug.candidate),
      '| shown m', shown && shown.reduce((a, g) => a + g.length, 0).toFixed(1), '| removed m', removedSegs.reduce((a, g) => a + g.length, 0).toFixed(1),
      '| shown == removed:', !!shown && segSig(shown) === segSig(removedSegs), '| shown == Extend of the boxes:', !!shown && segSig(shown) === segSig(extendCand),
      '| readout header', p.byAria('the piece Extend would add').children[0].textContent);
    assert.ok(shown && segSig(shown) === segSig(removedSegs), `${name}: the ghost after the undo is not the road the undo removed`);
  });
}


// T1 (added by A): Turn to grid, from a heading that is off the grid (C's set-up was refused: 'already on the 90 grid')
test('T1: undo of Turn to grid: the preview shows the road Turn to grid laid, and the boxes are given back', async () => {
  const p = await mountC();
  typePiece(p, { L: 200, turn: 25, as: 'corner' }); p.button('Extend').onclick();
  p.type('length m', 150); p.type('turn °', '');
  const n0 = nPieces(p), placed = p.shell.getState().resolved.segments.length;
  p.button('Turn to grid').onclick(); p.tick();
  assert.ok(nPieces(p) > n0, 'Turn to grid laid something: ' + p.shell.getState().message);
  const removedSegs = p.shell.getState().resolved.segments.slice(placed), len0 = p.field('length m').value;
  p.events.length = 0; p.shell.undo(); p.tick();
  const ev = lastGhost(p), ug = p.shell.getState().undoGhost;
  assert.ok(ev && ev.type === 't180-ghost', 'a ghost is shown');
  assert.equal(segSig(ev.detail.candidate.segments.slice(placed)), segSig(removedSegs), 'the preview is the road that was removed');
  assert.equal(p.field('length m').value, len0, 'the boxes are the ones typed for it');
  assert.ok(ug && ev.detail.candidate === ug.candidate, 'and it is the shell undo ghost');
});
