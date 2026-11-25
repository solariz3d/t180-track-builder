// piece-ghost.test.js (pane A, L238): a click on a saved piece shows it as a ghost and lays nothing; Place lays it; a saved piece keeps the numbers that made it in a sidecar.
// The user, 2026-11-25 07:02: "in saved pieces, it should add the ghost of the piece before placing it ... So click a saved piece, it doesnt auto place it, it places the ghost that you
// then have to press place, it allows you to tweak the piece if you want before placing it." Rows P1-P11 are the shell (no DOM); Q1-Q4 the panel on a fake DOM (the harness is
// undo-commands.test.js lines 9-57, copied: that file is a test file and exports nothing).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const PC = require('../../src/core/piece.js');
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

// ---- a storage in memory with the recipe sidecar (the native side's three commands)
function store({ recipes = true } = {}) {
  const st = { pieces: new Map(), recipes: new Map() };
  Object.assign(st, {
    listPieces: async () => [...st.pieces.keys()].sort(),
    openPiece: async (n) => { if (!st.pieces.has(n)) throw new Error(`could not read the piece "${n}": not found`); return st.pieces.get(n); },
    savePiece: async (n, t) => { if (st.pieces.has(n)) throw new Error(`a piece named "${n}" already exists`); st.pieces.set(n, t); },
    deletePiece: async (n) => { if (!st.pieces.has(n)) throw new Error('not found'); st.pieces.delete(n); },
    backupDoc: async () => 'b', saveUndo: async () => {}, openUndo: async () => null, saveAutosave: async () => {}, clearAutosave: async () => {}, openAutosave: async () => null,
  });
  if (recipes) Object.assign(st, {
    saveRecipe: async (n, t) => { st.recipes.set(n, t); },
    openRecipe: async (n) => (st.recipes.has(n) ? st.recipes.get(n) : null),
    deleteRecipe: async (n) => { st.recipes.delete(n); },
  });
  return st;
}
const MADE = (len, turn) => ({ op: 'extend', len: String(len), values: { turn: String(turn) }, ticks: {}, turnAs: 'corner', second: {}, flow: false, bankAt: '' });
// an Extend as the panel does it: the shell lays it, the panel notes what was typed
function laid(s, opts, made) { const before = s.getState().history.present; s.extend(opts); const after = s.getState().history.present; assert.notEqual(after, before, s.getState().message); if (made) s.noteMade(after, { before, made }); return after; }
async function trackWith(st) {
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  laid(s, { length: 300, family: 'bowl' });                                                              // the lead piece (no values kept for it)
  laid(s, { length: 150, transition: 60, targets: { kh: 1 / 180 } }, MADE(150, 45));                       // one Extend, its values noted
  return s;
}
const pieceText = (s, from, to, name) => PC.serialize(PC.saveRun(s.getState().history.present, from, to, { name }));
async function emptyTrack(st) { const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); laid(s, { length: 300, family: 'bowl' }); return s; }
async function saved(name = 'bend', opts) { const st = store(opts), s = await trackWith(st); s.selectPiece(1); await s.savePiece(name); return st; }

test('P1: Save as piece beside a recipe sidecar: the piece file is byte for byte what the core writes, and the sidecar holds the numbers', async () => {
  const st = store(), s = await trackWith(st); s.selectPiece(1); await s.savePiece('bend');
  assert.equal(st.pieces.get('bend'), pieceText(s, 1, 1, 'bend'), 'the piece file is unchanged');
  const r = JSON.parse(st.recipes.get('bend'));
  assert.deepEqual(r.made, MADE(150, 45)); assert.equal(r.kind, 'piece-recipe');
});
test('P1b: a storage with no recipe commands saves the same piece file and says it saved', async () => {
  const a = store({ recipes: false }), b = store(); const sa = await trackWith(a), sb = await trackWith(b);
  sa.selectPiece(1); await sa.savePiece('bend'); sb.selectPiece(1); await sb.savePiece('bend');
  assert.equal(a.pieces.get('bend'), b.pieces.get('bend')); assert.match(sa.getState().message, /saved the piece/);
});
test('P2: a run laid by two Extends, and a piece changed after it was laid, keep no recipe', async () => {
  const st = store(), s = await trackWith(st); laid(s, { length: 100, transition: 40, targets: { kh: 0 } }, MADE(100, 0));
  s.selectPiece(1); s.selectPiece(2, { extend: true }); await s.savePiece('two'); assert.equal(st.recipes.has('two'), false, 'two steps, no single set of numbers');
  s.selectPiece(1); s.setGrip(90); s.selectPiece(1); await s.savePiece('grippy'); assert.equal(st.recipes.has('grippy'), false, 'a changed piece is not what the numbers made');
});
test('P3: Rename carries the recipe, Delete takes it with the piece', async () => {
  const st = await saved();
  const s = await emptyTrack(st); await s.renamePiece('bend', 'curve'); assert.equal(st.recipes.has('bend'), false); assert.equal(JSON.parse(st.recipes.get('curve')).made.len, '150');
  await s.deletePieceFile('curve'); assert.equal(st.recipes.size, 0);
});
test('P4: a click shows the piece as a ghost with its numbers and lays nothing', async () => {
  const st = await saved();
  const t = await emptyTrack(st), was = t.getState().history.present; await t.showPiece('bend');
  const g = t.getState().pieceGhost; assert.equal(t.getState().history.present, was, 'nothing laid'); assert.ok(g && g.candidate.segments.length > 0);
  assert.deepEqual(g.numbers, MADE(150, 45)); assert.equal(t.getState().message, null);
});
test('P5: Place lays it as one undo step, the same document Add at head makes, and the ghost is gone', async () => {
  const st = await saved();
  const a = await emptyTrack(st), b = await emptyTrack(st); await b.insertPiece('bend');
  await a.showPiece('bend'); const was = a.getState().history.present; await a.placePiece();
  assert.equal(a.text(), b.text(), 'the same bytes as Add at head'); assert.equal(a.getState().history.past.at(-1), was, 'one undo step'); assert.equal(a.getState().pieceGhost, null);
});
test('P6: a piece saved before this build (no sidecar) shows its shape read off, fills no numbers, and Place is its own bytes', async () => {
  const st = await saved('old', { recipes: false });
  const a = await emptyTrack(st), b = await emptyTrack(st); await b.insertPiece('old'); await a.showPiece('old');
  const g = a.getState().pieceGhost; assert.equal(g.numbers, null); assert.equal(g.readOff, true); assert.ok(g.words().length > 0);
  await a.placePiece(); assert.equal(a.text(), b.text());
});
test('P7: a sidecar that belongs to another piece file is not used', async () => {
  const st = await saved();
  st.pieces.set('bend', st.pieces.get('bend').replace('"bend"', '"bend2"'));   // the file was replaced by another with the same name
  const a = await emptyTrack(st); await a.showPiece('bend'); assert.equal(a.getState().pieceGhost.numbers, null);
});
test('P8: mirrored: the ghost is the mirror image, no numbers (they are the unmirrored ones), and Place equals Add mirrored', async () => {
  const st = await saved();
  const a = await emptyTrack(st), b = await emptyTrack(st); await b.insertPiece('bend', { mirror: true });
  await a.showPiece('bend', { mirror: true }); assert.equal(a.getState().pieceGhost.numbers, null); await a.placePiece(); assert.equal(a.text(), b.text());
});
test('P9: Drop clears the ghost; any change of the document clears it', async () => {
  const st = await saved();
  const a = await emptyTrack(st); await a.showPiece('bend'); a.dropPieceGhost(); assert.equal(a.getState().pieceGhost, null);
  await a.showPiece('bend'); a.extend({ length: 50 }); assert.equal(a.getState().pieceGhost, null);
});
test('P10: a refusal shows no ghost, says why, and changes nothing', async () => {
  const st = store(), a = await emptyTrack(st), was = a.getState().history.present; await a.showPiece('nothing-here');
  assert.equal(a.getState().pieceGhost, null); assert.match(a.getState().message, /could not open the piece/); assert.equal(a.getState().history.present, was);
});
test('P11: the piece reader (piece.js, unchanged) still opens a piece file saved with a sidecar', async () => {
  const st = await saved(); assert.doesNotThrow(() => PC.parse(st.pieces.get('bend')));
});

// ---- the panel
async function mountQ(st) {
  const { doc, tick } = fakeWindow(); doc.activeElement = null;
  const events = []; for (const k of ['t180-ghost', 't180-ghost-clear']) doc.addEventListener(k, (e) => events.push({ type: k, detail: e.detail }));
  doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(null)); doc.addEventListener('t180:view', (e) => e.detail.reply({ pose: null }));
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  shell.extend({ length: 300, family: 'bowl', first: { w: 33 } });
  const p = wire({ doc, tick, root, shell, calls: [] }); p.events = events; p.doc = doc; return p;
}
const shown = (b) => b.style.display !== 'none';
test('Q1: a click shows the ghost, fills the boxes with the numbers that made the piece, and offers Place; nothing is laid', async () => {
  const st = await saved(), p = await mountQ(st), was = p.shell.getState().history.present;
  await p.shell.showPiece('bend'); p.tick();
  assert.equal(p.shell.getState().history.present, was, 'nothing laid');
  assert.equal(p.field('length m').value, '150'); assert.equal(p.field('turn °').value, '45');
  assert.ok(shown(p.button('Place piece')), 'Place is offered'); assert.ok(p.events.some((e) => e.type === 't180-ghost' && e.detail.candidate.segments.length > 1), 'the piece is the ghost');
});
test('Q2: Place lays the piece the ghost showed, as one undo step', async () => {
  const st = await saved(), p = await mountQ(st), b = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); b.extend({ length: 300, family: 'bowl', first: { w: 33 } }); await b.insertPiece('bend');
  await p.shell.showPiece('bend'); p.tick(); const was = p.shell.getState().history.present; p.button('Place piece').onclick(); await new Promise((r) => setImmediate(r)); p.tick();   // Place reads the piece file again, so it settles a turn later
  assert.equal(p.shell.text(), b.text(), 'the same bytes as Add at head'); assert.equal(p.shell.getState().history.present.pieces.length, was.pieces.length + 1);
  assert.equal(p.shell.getState().history.past.at(-1), was); assert.equal(p.shell.getState().pieceGhost, null); assert.equal(shown(p.button('Place piece')), false);
});
test('Q3: tweak one box: the ghost becomes the panel own piece from the boxes, and Place lays what that ghost shows', async () => {
  const st = await saved(), p = await mountQ(st); await p.shell.showPiece('bend'); p.tick();
  p.events.length = 0; p.type('length m', 200);
  const g = p.events.filter((e) => e.type === 't180-ghost').at(-1); assert.ok(g, 'the panel drew its own ghost');
  const ghostM = g.detail.candidate.segments.reduce((a, s) => a + s.length, 0), base = p.shell.getState().resolved.segments.reduce((a, s) => a + s.length, 0);
  p.button('Place piece').onclick(); p.tick();
  const now = p.shell.getState().resolved.segments.reduce((a, s) => a + s.length, 0);
  assert.ok(Math.abs(now - ghostM) < 1e-6, `placed ${now} m, the ghost showed ${ghostM} m (base ${base})`); assert.ok(Math.abs(now - base - 200) < 1e-6, 'the tweaked 200 m');
});
test('Q4: Esc drops the ghost and the boxes stay as they are', async () => {
  const st = await saved(), p = await mountQ(st); await p.shell.showPiece('bend'); p.tick();
  p.doc.dispatchEvent({ type: 'keydown', key: 'Escape', target: { matches: () => false }, preventDefault() {} }); p.tick();
  assert.equal(p.shell.getState().pieceGhost, null); assert.equal(shown(p.button('Place piece')), false);
});

// L238, pane C's read: Rename moved the recipe as it was, but the renamed piece's text differs (its name field), so its hash no longer matched and the click showed no numbers; a case-only rename
// (one file on Windows) saved then deleted the same recipe.
test('R1: Rename rewrites the recipe for the renamed text: a click on the new name still shows the numbers', async () => {
  const st = await saved(), s = await emptyTrack(st);
  await s.renamePiece('bend', 'bend two'); assert.equal(st.recipes.has('bend'), false); 
  await s.showPiece('bend two'); const g = s.getState().pieceGhost; assert.ok(g && g.numbers, `no numbers after the rename: ${g && g.note}`);
});
test('R2: a case-only Rename on a case-blind store keeps the recipe, rewritten, and the click still shows the numbers', async () => {
  const st = await saved(); const k = (n) => n.toLowerCase();
  const pieces = new Map([...st.pieces].map(([n, t]) => [k(n), [n, t]])), recipes = new Map([...st.recipes].map(([n, t]) => [k(n), t]));
  const blind = { ...st,
    openPiece: async (n) => { if (!pieces.has(k(n))) throw new Error('not found'); return pieces.get(k(n))[1]; },
    savePiece: async (n, t) => { if (pieces.has(k(n))) throw new Error(`a piece named "${n}" already exists`); pieces.set(k(n), [n, t]); },
    deletePiece: async (n) => { if (!pieces.has(k(n))) throw new Error('not found'); pieces.delete(k(n)); },
    listPieces: async () => [...pieces.values()].map((x) => x[0]),
    saveRecipe: async (n, t) => { recipes.set(k(n), t); }, openRecipe: async (n) => (recipes.has(k(n)) ? recipes.get(k(n)) : null), deleteRecipe: async (n) => { recipes.delete(k(n)); } };
  const s = await emptyTrack(blind); await s.renamePiece('bend', 'Bend');
  assert.ok(pieces.has('bend'), `the piece survives: ${s.getState().message}`); assert.ok(recipes.has('bend'), 'the recipe survives a case-only rename');
  await s.showPiece('Bend'); const g = s.getState().pieceGhost; assert.ok(g && g.numbers, `no numbers after the case-only rename: ${g && g.note}`);
});
