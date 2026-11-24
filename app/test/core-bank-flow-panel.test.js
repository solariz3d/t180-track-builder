// core-bank-flow-panel.test.js: node --test app/test/core-bank-flow-panel.test.js
// THE FLOWING BANK IN THE PANEL (smooth banked turns, LAP 3; the plan's Part 5, lighthouse exo_memory/loop/plan_t180_smooth_banked_turns_2026-11-24.md).
// Driven side by side on one layout (2026-11-24), the flowing bank was the better of the two, so the panel offers it:
// a box on the bank field, "flow". Ticked, the bank PASSES THROUGH its marks (src/core/extend.js bankShape 'flow', through.phi), the bank field's own target at its
// "at" (transition.phi, an object, as LAP 2 found a one-number transition refused at the joint after a rolling road), each extra bank row a mark "bank … ° at … m".
// Rows (each seen red on t180-fresh 57e4b1c before the box was built, except row 2, which guards what must not move and is seen red by a mutant):
//   1  the mapping: the box with three marks gives the contract's call exactly; blank ats are spread evenly between their neighbours
//   2  unticked, everything is today's: sha256 of the serialized document, over a matrix of the fields, as recorded on 57e4b1c (core_bank_ramp UNMOVED's method)
//   3  the box and its marks survive: Undo gives them back (the panel's put-back), and the piece saved, closed and reopened is the same bytes, through its marks
//   4  mirror negates the marks: the piece laid by the panel, saved and inserted mirrored, banks the exact negative, through each mark's negative
//   5  a refusal of the flowing bank reaches the panel in the core's own words, naming the mark and the room it needs; Extend adds nothing
//   6  during a drag the panel asks the core only whether the list lays (roomSearch: false); the release asks whole and names the room (the second reader's finding 5)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../../src/core/document.js');
const PC = require('../../src/core/piece.js');
const TB = require('../../src/core/turnby.js');
const { extend } = require('../../src/core/extend.js');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const DEG = Math.PI / 180;

// ── a small fake DOM, as app/test/core-second-bank-panel.test.js has it ──
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
function memStorage() {
  const files = new Map(), pieces = new Map();
  return { files, pieces, saveDoc: async (n, t) => files.set(n, t), openDoc: async (n) => files.get(n), listDocs: async () => [...files.keys()],
    saveUndo: async (n, t) => files.set(n + '.undo', t), openUndo: async (n) => (files.has(n + '.undo') ? files.get(n + '.undo') : null),
    savePiece: async (n, t) => pieces.set(n, t), openPiece: async (n) => pieces.get(n), listPieces: async () => [...pieces.keys()], deletePiece: async (n) => pieces.delete(n) };
}
const LEAD = 300;
/** A panel on a shell whose track is one straight bowl, 300 m, 33 m wide: the drawn rows' lead (test/core_bank_flow_drawn.test.js). */
async function mountPanel(storage = null) {
  const { doc, win } = fakeWindow();
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null, ...(storage ? { storage, autosaveMs: 0 } : {}) });
  shell.commitDoc(extend(D.createDoc('flow'), { length: LEAD, family: 'bowl', first: { w: 33 } }));
  const calls = [], real = shell.extend; shell.extend = (o) => { calls.push(o); return real(o); };   // THE CORE CALL, observed at the shell
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => { const l = label(text); assert.ok(l, `the panel has no "${text}" field`); return l.children[1]; };
  const byAria = (a) => { const f = root.all().find((e) => e.attrs && e.attrs['aria-label'] === a); assert.ok(f, `no element labelled "${a}"`); return f; };
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); };
  const set = (f, v) => { f.value = String(v); (f.oninput || f.onchange)(); };
  const tick = (box, on) => { box.checked = on; box.onchange(); };
  const flowBox = () => byAria('bank flows through its marks'), bankAt = () => byAria('bank at');
  const addBank = (then, from = '') => panel.secondAdd('bank', { then: String(then), from: String(from) });
  const button = (text) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const msgText = () => root.all().filter((e) => e.attrs && e.attrs.class === 'message').map((e) => e.textContent).join(' | ');
  type('length m', 300);
  return { doc, win, root, shell, panel, field, byAria, type, set, tick, flowBox, bankAt, addBank, msgText, extend: () => button('Extend').onclick(), calls, opts: () => panel.options() };
}
/** The flow layout's S marks (the handback's banked S, rounded): the first target at 80 m, then two marks. */
const S3 = { first: { at: 80, deg: -20 }, marks: [{ at: 150, deg: 27 }, { at: 230, deg: -28 }] };
const contractOf = (L, first, marks) => ({ length: L, targets: { phi: first.deg * DEG }, bankShape: 'flow', transition: { phi: first.at }, through: { phi: marks.map((m) => ({ at: m.at, target: m.deg * DEG })) } });
/** The bank of the piece at `s` m from its start, in degrees. */
const bankAt = (P, s) => D.channelValue(P, 'phi', s) / DEG;
const throughMarks = (P, first, marks, sign = 1, what = '') => { for (const m of [first, ...marks]) assert.ok(Math.abs(bankAt(P, m.at) - sign * m.deg) <= 0.05, `${what} at ${m.at} m: ${bankAt(P, m.at).toFixed(3)}°, not ${sign * m.deg}°`); };

test('row 1: the flow box with three marks gives the contract\'s call exactly; blank ats are spread evenly between the marks either side of them', async () => {
  // the pure mapping: the bank field and its at are the first mark, each extra bank row a mark passed through
  const pure = extendOptions({ length: '300', bank: '-20', bankFlow: true, bankAt: '80', changes: { bank: S3.marks.map((m) => ({ then: String(m.deg), from: String(m.at) })) } });
  assert.deepEqual(pure, contractOf(300, S3.first, S3.marks), 'the contract\'s call, and nothing else');
  // a blank at is laid evenly between the typed marks either side of it (the piece's start before the first, its end after the last)
  const blank = extendOptions({ length: '300', bank: '10', bankFlow: true, bankAt: '', changes: { bank: [{ then: '0', from: '' }, { then: '-10', from: '' }] } });
  assert.deepEqual(blank, contractOf(300, { at: 100, deg: 10 }, [{ at: 200, deg: 0 }, { at: 300, deg: -10 }]), 'three blank ats: 100, 200 and the end');
  const between = extendOptions({ length: '300', bank: '10', bankFlow: true, bankAt: '60', changes: { bank: [{ then: '0', from: '' }, { then: '-10', from: '240' }] } });
  assert.deepEqual(between.through.phi.map((m) => m.at), [150, 240], 'one blank between 60 and 240: 150');
  // no marks and no at: the first target is at the piece's end (the core's own rule), so no transition is sent
  assert.deepEqual(extendOptions({ length: '300', bank: '10', bankFlow: true, bankAt: '' }), { length: 300, targets: { phi: 10 * DEG }, bankShape: 'flow' }, 'the first target alone, at the end');
  // the panel's own Extend sends that call
  const p = await mountPanel();
  p.type('bank °', S3.first.deg); p.tick(p.flowBox(), true); p.set(p.bankAt(), S3.first.at);
  for (const m of S3.marks) p.addBank(m.deg, m.at);
  p.extend();
  assert.deepEqual(p.calls.at(-1), contractOf(300, S3.first, S3.marks), `the core call (${p.msgText()})`);
  assert.equal(p.shell.getState().history.present.pieces.length, 2, `the piece is laid (${p.msgText()})`);
  p.panel.unmount();
});

// recorded on t180-fresh 57e4b1c (before the box): sha256 of the serialized document each call lays on the 300 m lead (as the shell lays it, turnby extendCorner),
// or of the refusal's code and words (11 of the 52 are today's refusals by name, pinned as they are). Each call is made with the core's minimums through a shell,
// as the panel's opts() passes them. Every row is laid twice: with the box's option left out, and with it false. The pins were recorded by the lap's
// flow_panel_pins.js (the hand-back's evidence), which copies this matrix; one pin per row, by its id, is checked below.
const LEAD_DOC = extend(D.createDoc('unmoved'), { length: LEAD, family: 'bowl', first: { w: 33 } });
const HEAD = { phi: 0, c: D.endState(LEAD_DOC).c.v, e: 0, er: 0 };
const matrix = (MINS) => {
  const out = [];
  for (const L of ['300', '1000']) for (const bank of ['', '30', '-41.38']) for (const early of [false, true]) for (const rows of [[], [{ then: '0', from: '' }], [{ then: '10', from: '' }, { then: '-5', from: '' }]]) for (const turn of ['', '90']) {
    if (bank === '' && (early || rows.length)) continue;   // a bank row or tick with no bank target sends nothing of the bank: one row covers it
    out.push({ id: `L ${L} · bank ${bank || 'shown'}${early ? ' early' : ''} · ${rows.length} row(s)${turn ? ` · turn ${turn}° as a corner` : ''}`, f: { length: L, bank, turn, turnAs: turn ? 'corner' : 'rate', atStart: { bank: early }, head: HEAD, changes: rows.length ? { bank: rows } : null, ...MINS } });
  }
  return out;
};
const layHash = (o) => { let text; try { text = D.serialize(TB.extendCorner(LEAD_DOC, o)); } catch (e) { if (e.name !== 'CoreError') throw e; text = `refused ${e.code}: ${e.message}`; } return crypto.createHash('sha256').update(text).digest('hex'); };
const PINS = require('./core-bank-flow-panel.pins.json');
test('row 2: unticked, every call lays today\'s document to the byte, over a matrix of length, bank, early, extra rows and a corner (pinned on 57e4b1c)', async () => {
  const sh = await createCoreShell({ brushFn: null }); sh.commitDoc(LEAD_DOC);
  const MATRIX = matrix({ secondMinM: sh.secondMinM, cornerChangeMinM: (deg, baseDeg, L) => sh.cornerChangeMinM(LEAD_DOC, { length: L }, deg, baseDeg), secondFloorM: sh.secondFloorM(), bankFloorM: sh.bankFitFloorM(), bankRefusal: (o) => !!sh.changeRefusal(o, 'phi', null) });
  assert.equal(Object.keys(PINS).length, MATRIX.length, 'one pin per row of the matrix');
  for (const { id, f } of MATRIX) {
    assert.ok(PINS[id], `no pin for ${id}`);
    assert.equal(layHash(extendOptions(f)), PINS[id], `${id}: the box's option left out`);
    assert.equal(layHash(extendOptions({ ...f, bankFlow: false, bankAt: '75' })), PINS[id], `${id}: the box unticked (an at typed and left behind)`);
  }
});

test('row 3: the flow box and its marks survive: Undo gives them back, and the piece saved, closed and reopened is the same bytes and passes through each mark', async () => {
  const st = memStorage(), p = await mountPanel(st);
  p.type('bank °', S3.first.deg); p.tick(p.flowBox(), true); p.set(p.bankAt(), S3.first.at);
  for (const m of S3.marks) p.addBank(m.deg, m.at);
  p.extend();
  const laid = p.shell.getState().history.present; assert.equal(laid.pieces.length, 2, p.msgText());
  // Undo: the panel's put-back gives the box, the first mark's at and each row's at back, so Extend again rebuilds the same piece
  p.tick(p.flowBox(), false); p.shell.undo();
  assert.equal(p.flowBox().checked, true, 'Undo: the box ticked again'); assert.equal(p.bankAt().value, '80', 'and the first mark\'s at');
  assert.deepEqual(p.opts(), contractOf(300, S3.first, S3.marks), 'so the options are the same call');
  p.extend(); assert.equal(D.serialize(p.shell.getState().history.present), D.serialize(laid), 'Extend again lays the same bytes');
  // save, close, reopen in a fresh shell: the same bytes, through the marks
  await p.shell.save('flow test'); p.panel.unmount();
  const q = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); await q.open('flow test');
  const again = q.getState().history.present;
  assert.equal(D.serialize(again), D.serialize(laid), 'reopened: the same bytes');
  throughMarks(again.pieces[1], S3.first, S3.marks, 1, 'reopened');
});

test('row 4: mirror negates the marks: the piece the panel laid, saved and inserted mirrored, banks the exact negative and passes through each mark\'s negative', async () => {
  const p = await mountPanel();
  p.type('bank °', S3.first.deg); p.tick(p.flowBox(), true); p.set(p.bankAt(), S3.first.at);
  for (const m of S3.marks) p.addBank(m.deg, m.at);
  p.extend();
  const d = p.shell.getState().history.present; assert.equal(d.pieces.length, 2, p.msgText());
  const piece = PC.parse(PC.serialize(PC.saveRun(d, 1, 1, { name: 'flow' })));
  const P = d.pieces[1], M = PC.insert(LEAD_DOC, piece, { mirror: true }).pieces[1];
  throughMarks(P, S3.first, S3.marks, 1, 'as laid');
  throughMarks(M, S3.first, S3.marks, -1, 'mirrored');
  for (let s = 0; s <= 300; s += 0.5) assert.equal(D.channelValue(M, 'phi', s) + 0, -D.channelValue(P, 'phi', s) + 0, `the exact negative at ${s} m`);   // (+ 0: a level bank's 0 and -0 are one bank)
  p.panel.unmount();
});

test('row 5: a refusal of the flowing bank reaches the panel in the core\'s own words, naming the mark and the room it needs; Extend adds nothing', async () => {
  // a list whose refusal names the bank's own first mark, and one whose refusal names a row's mark (the second reader's drawn list 64). LAP 4: the lists this row held
  // before (READER_2, -20° at 80 then 20° at 100; and 10° at 60, -10° at 70, 10° at 90) lay since knots are added before refusing (finding 3), so these are lists
  // still refused, and the room is the least whole metre (finding 2)
  const CASES = [
    { first: { at: 10, deg: -20 }, marks: [{ at: 15, deg: -30 }], named: /^BAD_SECOND: the first target at 10 m needs [\d.]+ m after the joint \(it has 10 m\)/ },
    { first: { at: 74.4, deg: 4.1 }, marks: [{ at: 83.1, deg: 23.7 }], named: /^BAD_SECOND: the bank's mark 1 at 83.1 m needs [\d.]+ m after the mark before it \(it has 8.7 m\)/ },
  ];
  for (const C of CASES) {
    const p = await mountPanel();
    p.type('bank °', C.first.deg); p.tick(p.flowBox(), true); p.set(p.bankAt(), C.first.at);
    for (const m of C.marks) p.addBank(m.deg, m.at);
    let core = null; try { TB.extendCorner(p.shell.getState().history.present, contractOf(300, C.first, C.marks)); } catch (e) { core = e; }
    assert.ok(core && core.code === 'BAD_SECOND', 'the core refuses the list');
    assert.match(core.message, C.named, 'by name, with its room');
    assert.ok(p.msgText().includes(`no preview of this piece: ${core.message}`), `the ghost says it in the core's words (${p.msgText()})`);
    p.extend();
    assert.equal(p.shell.getState().history.present.pieces.length, 1, 'nothing placed');
    assert.ok(p.msgText().includes(core.message), `Extend says it too (${p.msgText()})`);
    p.panel.unmount();
  }
});

// ── row 6 (the second reader's finding 5, lighthouse exo_memory/handback/p-smooth-bank-read2-C_2026-11-24.md): a refused flowing bank costs the room search, 30-61 ms
// a list and up to 549 ms, so a drag across a refused region stalled every frame. During a DRAG the panel asks only whether the list lays (roomSearch: false); the
// release asks once whole, and its refusal names the room. A stage as app/test/core-extra-bank-drag-cost.test.js has one, so the handles take a real press and drag ──
class StageEl extends El {
  addEventListener(e, f, o) { (this.listeners[e] = this.listeners[e] || []).push({ f, capture: !!(o === true || (o && o.capture)) }); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x.f !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth || 0, height: this.clientHeight || 0 }; }
  get isConnected() { return true; }
  setPointerCapture() {}
  fire(type, init) { let stopped = false; const ev = { type, ...init, preventDefault() {}, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; } };
    const ls = (this.listeners[type] || []).slice(), order = ls.filter((l) => l.capture).concat(ls.filter((l) => !l.capture));
    for (const l of order) { if (stopped) break; l.f(ev); } }
}
async function mountStage() {
  const frames = [], doc = { ids: {}, listeners: {}, createElement: (t) => new StageEl(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  doc.defaultView = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} };
  const tick = () => { for (let i = 0; i < 3; i++) { const fs = frames.splice(0); for (const f of fs) f(0); } };
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 1200; stage.clientHeight = 800;
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  shell.extend({ length: 1000, family: 'bowl' });
  const L = 300;
  const ghostOf = () => { const s0 = 1000, samples = []; for (let s = s0; s <= s0 + L + 1e-9; s += 2) samples.push({ s, pos: [0, 0, s], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] }); return { s0, samples, segments: [], jump: false }; };
  doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(ghostOf()));
  doc.addEventListener('t180:view', (e) => e.detail.reply({ pose: { eye: [0, 0.6 * L, 1000 - 0.25 * L], target: [0, 0, 1000 + 0.5 * L], up: [0, 1, 0], fov: Math.PI / 3 } }));
  // every question the panel asks the shell about a flowing bank, with the phase of the gesture it was asked in
  const asked = []; let phase = 'still';
  for (const [k, v] of Object.entries(shell)) if (typeof v === 'function') shell[k] = (...a) => { if (a[0] && a[0].bankShape === 'flow') asked.push({ k, phase, roomSearch: a[0].roomSearch }); return v(...a); };
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const byAria = (a) => root.all().find((e) => e.attrs && e.attrs['aria-label'] === a);
  const type = (text, v) => { const f = label(text).children[1]; f.value = String(v); f.oninput(); tick(); };
  const msgText = () => root.all().filter((e) => e.attrs && e.attrs.class === 'message').map((e) => e.textContent).join(' | ');
  const handle = (kind, side) => panel.handles.handles().find((h) => h.kind === kind && h.side === side && h.screen);
  const drag = (h, dx, dy, during = () => {}) => {
    const s = h.screen; phase = 'drag'; stage.fire('pointerdown', { clientX: s.x, clientY: s.y, pointerId: 1, button: 0 });
    for (let i = 1; i <= 4; i++) { stage.fire('pointermove', { clientX: s.x + (dx * i) / 4, clientY: s.y + (dy * i) / 4, pointerId: 1, timeStamp: i * 16 }); tick(); during(); }
    phase = 'release'; stage.fire('pointerup', { clientX: s.x + dx, clientY: s.y + dy, pointerId: 1 }); tick(); phase = 'still';
  };
  return { shell, panel, type, byAria, msgText, handle, drag, asked, tick };
}

test('row 6: during a drag the panel asks only whether the flowing bank lays (roomSearch: false on every question); the release asks whole, and its refusal names the room', async () => {
  // a: the mapping. Dragging adds roomSearch: false to a flowing bank's call and to nothing else; unticked, a drag's call is the still one
  const base = { length: '300', turn: '', climb: '', bank: '-20', width: '', cup: '', edge: '', edgeR: '', start: '', tube: '', grip: 100, changes: { bank: [{ then: '20', from: '100' }] } };
  assert.deepEqual(extendOptions({ ...base, bankFlow: true, bankAt: '80', dragging: true }), { ...extendOptions({ ...base, bankFlow: true, bankAt: '80' }), roomSearch: false }, 'flowing, dragged');
  assert.deepEqual(extendOptions({ ...base, dragging: true }), extendOptions(base), 'unticked, a drag changes nothing');
  assert.equal('roomSearch' in extendOptions({ ...base, bankFlow: true, bankAt: '80' }), false, 'still: the whole question');
  // b: a real drag of the bank's handle on the stage, across a refused region: the second reader's drawn list 6 (0.3° at 40.9 m, then 13° at 46.6 m: it needs 60.7 m
  // where it has 5.7, so every frame of the drag stays refused). LAP 4: the reader's READER_2 this row held lays now (knots added before refusing)
  const p = await mountStage();
  p.type('length m', 300); p.type('bank °', 0.3);
  const box = p.byAria('bank flows through its marks'); box.checked = true; box.onchange();
  const at = p.byAria('bank at'); at.value = '40.9'; at.oninput();
  p.panel.secondAdd('bank', { then: '13', from: '46.6' }); p.tick();
  assert.match(p.msgText(), /needs [\d.]+ m after the mark before it/, `still, the refusal names the room (${p.msgText()})`);
  const h = p.handle('bank', 1); assert.ok(h, 'the bank handle is on the stage');
  const during = [];
  p.drag(h, 0, -12, () => during.push(p.msgText()));   // the handle moves the first mark's degrees: away from the next mark's 13°, so it stays refused
  const inDrag = p.asked.filter((a) => a.phase === 'drag'), onRelease = p.asked.filter((a) => a.phase === 'release');
  assert.ok(inDrag.length > 0, 'the drag asked the shell about the flowing bank');
  assert.deepEqual(inDrag.filter((a) => a.roomSearch !== false).map((a) => a.k), [], 'every question during the drag is asked without the room search');
  assert.ok(during.length > 0 && during.every((m) => /a flowing bank .+ \(mark 1\)/.test(m) && !/needs/.test(m)), `every frame of the drag is refused by its mark, with no room (${during.join(' / ')})`);
  assert.ok(onRelease.some((a) => a.roomSearch === undefined), 'the release asks whole');
  assert.match(p.msgText(), /needs [\d.]+ m after the mark before it/, `after the release the refusal names the room again (${p.msgText()})`);
  p.panel.unmount();
});
