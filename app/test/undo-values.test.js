// undo-values.test.js: node --test app/test/undo-values.test.js
// The user, 2026-11-25 01:37: "why cant it show the numbers that made it? ... this helps users remember how they got the shape they did".
//   R6  Extend then Undo gives the typed values back (extra rows included), and Extend again lays the very piece that was removed: a plain piece, a piece with extra turn rows, the S as driven
//   R7  the values are kept in the undo file: save, open, undo gives them back; an undo file without them (today's format) opens as before
//   R8  an undo file WITH values is read by the released reader (builder main 3b33b38, the 0.4.40 line) without complaint
//   P7  pane O's change, panel.js extendOptions: in corner mode a turn of 0 with extra turn rows sends turnDeg 0 (the S can be typed)
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

for (const [name, spec] of [['a plain piece', PLAIN], ['a piece with an extra turn row', ROWS], ['the S as driven (turn 0, +92 from 80, -91 from 200, flow through its marks)', S_PIECE]]) {
  test(`R6: ${name}: Extend, Undo gives the typed values back, and Extend again lays the same piece`, async () => {
    const p = await mount(); typePiece(p, spec);
    const n0 = nPieces(p); p.button('Extend').onclick();
    assert.equal(nPieces(p), n0 + 1, p.shell.getState().message);
    const made = lastPiece(p), sent = JSON.stringify(p.calls.at(-1));
    p.shell.undo(); p.tick();
    assert.equal(nPieces(p), n0);
    assert.equal(p.field('length m').value, String(spec.L), 'the length box holds what he typed');
    p.button('Extend').onclick();
    assert.equal(lastPiece(p), made, 'Extend again lays the very piece that was removed');
    assert.equal(JSON.stringify(p.calls.at(-1)), sent, 'from the same options');
  });
}

test('P7: the S is typeable: turn 0 with extra turn rows sends turnDeg 0, and a plain turn 0 still sends none', async () => {
  const p = await mount(); typePiece(p, S_PIECE); p.button('Extend').onclick();
  assert.equal(p.calls.at(-1).turnDeg, 0);
  assert.equal(p.calls.at(-1).changes.turnDeg.length, 2);
  const q = await mount(); typePiece(q, { L: 100, turn: 0, as: 'corner' }); q.button('Extend').onclick();
  assert.equal('turnDeg' in q.calls.at(-1), false, 'turn 0 with no rows: unchanged');
});

function memStorage() {
  const files = new Map();
  return { files, saveDoc: async (n, t) => files.set(n, t), openDoc: async (n) => files.get(n), listDocs: async () => [...files.keys()], saveUndo: async (n, t) => files.set(n + '.undo', t), openUndo: async (n) => files.get(n + '.undo') ?? null,
    savePiece: async () => {}, openPiece: async () => '', listPieces: async () => [], deletePiece: async () => {}, saveAutosave: async () => {}, clearAutosave: async () => {}, openAutosave: async () => null, backupDoc: async () => {}, listBackups: async () => [], docSavedAt: async () => null };
}
async function savedWith(spec) {
  const st = memStorage(), p = await mount(st); typePiece(p, spec); p.button('Extend').onclick(); await p.shell.save('vals');
  return { st, p, made: lastPiece(p) };
}
async function reopen(st) {   // a new shell and panel, as after closing and reopening the app
  const { doc, tick } = fakeWindow(); const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  await shell.open('vals'); return wire({ doc, tick, root, shell, calls: [] });
}
const undoKey = (st) => [...st.files.keys()].find((k) => k.endsWith('.undo'));
test('R7: save, open, undo gives the values back from the undo file; an undo file without them opens as before', async () => {
  const { st, made } = await savedWith(ROWS);
  assert.ok(JSON.parse(st.files.get(undoKey(st))).made, 'the undo file carries the values');
  const q = await reopen(st); const real = q.shell.extend; q.calls = []; q.shell.extend = (o) => { q.calls.push(o); return real(o); };
  q.shell.undo(); q.tick();
  assert.equal(q.field('length m').value, '250');
  q.button('Extend').onclick();
  assert.equal(lastPiece(q), made, 'Extend lays the piece that was undone, from the values read back');
  const o = JSON.parse(st.files.get(undoKey(st))); delete o.made; st.files.set(undoKey(st), JSON.stringify(o));   // today's format: no values
  const r = await reopen(st); assert.equal(nPieces(r), 2); r.shell.undo(); assert.equal(nPieces(r), 1, 'opens and undoes as before');
  assert.ok(r.shell.getState().undoGhost, 'and falls back to the ghost drawn from the shape');
});

test('R8: the released reader (builder main 3b33b38) opens an undo file that carries `made`, history intact', async () => {
  const { st } = await savedWith(ROWS);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-3b33b38-'));
  try {
    const repo = path.join(__dirname, '..', '..');
    const tarFile = path.join(dir, 'rel.tar');
    cp.execFileSync('git', ['-C', repo, 'archive', '--format=tar', '-o', tarFile, '3b33b38', 'app', 'src', 'tools', 'package.json']);
    cp.execFileSync('tar', ['-xf', 'rel.tar'], { cwd: dir });
    const rel = require(path.join(dir, 'app/core/coreshell.js')), s2 = await rel.createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
    await s2.open('vals');
    assert.equal(s2.getState().history.past.length, 2, 'the released build kept the history (the lead, the first piece)');
    assert.equal(s2.getState().message === null || s2.getState().messageKind === 'ok', true, String(s2.getState().message));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('R9b: with no values kept, the undone piece is shown with words saying they are read from the shape, and the boxes are NOT filled', async () => {
  const { st } = await savedWith(ROWS);
  const o = JSON.parse(st.files.get(undoKey(st))); delete o.made; st.files.set(undoKey(st), JSON.stringify(o));
  const r = await reopen(st); r.field('length m').value = '77'; r.shell.undo(); r.tick();
  const text = r.root.all().map((e) => e.textContent || '').join('|');
  assert.match(text, /read from the shape, not the typed values: 250 m/);
  assert.equal(r.field('length m').value, '77', 'read values are shown, not filled');
});
