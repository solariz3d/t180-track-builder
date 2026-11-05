// core-second-bank-panel.test.js: node --test app/test/core-second-bank-panel.test.js
// L135 (the user, 2026-11-04: "once you do banking once, there is another mark towards the end you can bank again that can let the end of the piece bank more in
// one direction or back to level in one piece, instead of having to place it, then flatten it with the next piece"). THE PANEL HALF (pane C; the core is B's).
// AMENDED (L139, pane C, 2026-11-05; the rule changed, by the plan's amendments at the user's words, exo_memory/loop/plan_l139_second_change_every_field_2026-11-05.md):
//   - the two fixed fields "then bank °" and "from (m)" became the bank's LIST of later changes, one row per change (then, from, remove) right after the bank row,
//     made by dragging an offer on the ghost (the panel's secondAdd is what that drag calls), as every other field now has;
//   - the options carry `changes: { phi: [{ from, target }] }` (B's L139 name) in place of `second: { phi: { from, target } }` (B's core reads both);
//   - the default from's minimum is the CORE's secondMinM, read through the shell (shell.secondMinM), not L135's copy of the 15 (the L139 packet: "Do NOT copy the numbers");
//   - the tick became the marks (app/core/secondtick.js markStroke, one per change in its field's colour); tickLine is gone.
// Each row keeps its L135 number and what it checked; the L139 rows are app/test/core-second-change-panel.test.js. C11–C13 run B's REAL core and are red until
// the branch carries B's L139 commits (they send `changes` and read secondMinM).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const ST = require('../core/secondtick.js');
const DEG = Math.PI / 180;

// ── a small fake DOM, as app/test/core-carry.test.js has it ──
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
  const { doc, win } = fakeWindow();
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });   // no #preview: no layers
  const calls = [], real = shell.extend; shell.extend = (o) => { calls.push(o); return real(o); };   // THE CORE CALL, observed at the shell
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => { const l = label(text); assert.ok(l, `the panel has no "${text}" field`); return l.children[1]; };
  const byAria = (a) => { const f = root.all().find((e) => e.attrs && e.attrs['aria-label'] === a); assert.ok(f, `no element labelled "${a}"`); return f; };
  const has = (a) => !!root.all().find((e) => e.attrs && e.attrs['aria-label'] === a);
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); };
  const set = (f, v) => { f.value = String(v); f.oninput(); };
  const thenBank = () => byAria('then bank 1'), fromBank = () => byAria('bank from 1');
  const addBank = (then, from = '') => panel.secondAdd('bank', { then: String(then), from: String(from) });   // what an offer's drag does on its first movement
  const button = (text) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  type('length m', 100);   // (the fake DOM's input starts with no .value: the panel's 100 is an attribute here)
  current = { doc, win, root, shell, panel, label, field, byAria, has, type, set, thenBank, fromBank, addBank, extend: () => button('Extend').onclick(), calls, opts: () => panel.options() };
  return current;
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a}, not ${b} (±${tol})`);
// a shell with no secondMinM (a core before L139): the panel's default is 85%, as L135's was before its clamp
let current = null;
function withoutMin(body) { const sh = current && current.shell, had = !!sh && Object.prototype.hasOwnProperty.call(sh, 'secondMinM'), was = sh && sh.secondMinM; if (sh) delete sh.secondMinM; try { return body(); } finally { if (had) sh.secondMinM = was; } }

test('L135 C1: the bank\'s changes sit right after the bank row; a change is a row in the bank row\'s style (AMENDED L139: a list, not two fixed fields)', async () => {
  const p = await mountPanel();
  const order = p.root.all().filter((e) => e.attrs && (e.tagName === 'LABEL' || e.attrs['aria-label'] === 'bank changes')).map((e) => (e.tagName === 'LABEL' ? e.children[0] && e.children[0].textContent : e.attrs['aria-label']));
  assert.equal(order[order.indexOf('bank °') + 1], 'bank changes', `the order: ${order.join(' | ')}`);
  p.type('bank °', 30); p.addBank(0);
  const row = p.thenBank().parent;
  assert.equal(row.attrs.class.split(' ').slice(0, 2).join(' '), p.label('bank °').attrs.class, 'the bank row\'s class (picker inline)');
  assert.equal(p.thenBank().attrs.type, 'number'); assert.equal(p.fromBank().attrs.type, 'number');
  p.panel.unmount();
});

test('L135 C2: the bank\'s change rows are off until the bank field has a target, on while it has one, off again when it is put back (AMENDED L139: rows of a list)', async () => {
  const p = await mountPanel();
  const shownBank = p.field('bank °').value;
  p.type('bank °', 30); p.addBank(0);
  assert.equal(p.thenBank().disabled, false, 'a bank target: on'); assert.equal(p.fromBank().disabled, false);
  p.type('bank °', shownBank);
  assert.equal(p.thenBank().disabled, true, 'back to what it shows: off again'); assert.equal('changes' in p.opts(), false, 'and not sent');
  p.panel.unmount();
});

test('L135 C3: a change with no from is laid at 85% of the length and follows it until a value is typed; cleared, it follows again (AMENDED L139: a core without secondMinM)', async () => {
  const p = await mountPanel();
  withoutMin(() => {
    p.type('bank °', 30); p.addBank(0);
    assert.equal(p.fromBank().value, '85', '85% of 100');
    p.type('length m', 750); assert.equal(p.fromBank().value, '637.5', 'follows the length: 85% of 750');
    p.set(p.fromBank(), 600); p.type('length m', 900); assert.equal(p.fromBank().value, '600', 'typed: it stays');
    p.set(p.fromBank(), ''); assert.equal(p.fromBank().value, '765', 'cleared: follows again, 85% of 900');
  });
  p.panel.unmount();
});

test('L135 C4: the Extend options carry the bank\'s change only with a bank target AND a then; the core call is made with it (AMENDED L139: changes.phi, a list)', async () => {
  const p = await mountPanel();
  withoutMin(() => {
    p.type('length m', 750);
    assert.equal('changes' in p.opts(), false, 'nothing made: no changes');
    p.type('bank °', 30); p.addBank('');
    assert.equal('changes' in p.opts(), false, 'a change with its then left blank: none sent (the old piece, byte for byte)');
    p.set(p.thenBank(), 0);
    assert.deepEqual(p.opts().changes, { phi: [{ from: 637.5, target: 0 }] }, 'his case: 30° then back to level from 637.5 m');
    near(p.opts().targets.phi, 30 * DEG, 1e-12, 'the first bank as before');
    p.set(p.thenBank(), 50); p.set(p.fromBank(), 700);
    assert.deepEqual(p.opts().changes.phi, [{ from: 700, target: 50 * DEG }], 'the steeper case, from typed');
    p.extend();
    assert.deepEqual(p.calls[p.calls.length - 1].changes, { phi: [{ from: 700, target: 50 * DEG }] }, 'shell.extend is called with the second bank');
  });
  p.panel.unmount();
});

test('L135 C5: Undo gives back the bank\'s change as it was for the undone piece (and whether from was typed); a new document clears it (AMENDED L139: a list)', async () => {
  const p = await mountPanel();
  withoutMin(() => {
    p.type('length m', 750); p.type('bank °', 30); p.addBank(0); p.extend();
    p.type('length m', 400); p.type('bank °', -20); p.addBank(-45, 300); p.extend();
    p.shell.undo();
    assert.equal(p.thenBank().value, '-45', 'Undo: the undone piece\'s then bank'); assert.equal(p.fromBank().value, '300', 'and its typed from');
    assert.equal(p.thenBank().disabled, false, 'on, with the bank put back');
    assert.deepEqual(p.opts().changes.phi, [{ from: 300, target: -45 * DEG }], 'so Extend again rebuilds the same piece');
    p.shell.undo();
    assert.equal(p.thenBank().value, '0', 'one more Undo: the first piece\'s'); assert.equal(p.fromBank().value, '637.5', 'its laid from');
    p.type('length m', 1000); assert.equal(p.fromBank().value, '850', 'an untyped from still follows the length after Undo');
    p.shell.newDoc();
    assert.equal(p.has('then bank 1'), false, 'a new document clears the bank\'s changes');
  });
  p.panel.unmount();
});

test('L135 C6: extendOptions is pure: no change without a bank; from left blank is 85% of the length (no secondMinM); values are sent as typed (AMENDED L139: changes)', () => {
  const base = { length: 200, turn: '', climb: '', width: '', cup: '' };
  withoutMin(() => {
    assert.equal('changes' in extendOptions({ ...base, bank: '', changes: { bank: [{ then: '10', from: '' }] } }), false, 'no bank target: no change');
    assert.deepEqual(extendOptions({ ...base, bank: '30', changes: { bank: [{ then: '-10', from: '' }] } }).changes, { phi: [{ from: 170, target: -10 * DEG }] }, 'blank from: 85% of 200');
    assert.deepEqual(extendOptions({ ...base, bank: '30', changes: { bank: [{ then: '0', from: '250' }] } }).changes, { phi: [{ from: 250, target: 0 }] }, 'a from past the length is sent: the core refuses it (BAD_SECOND), not the panel');
    assert.equal('changes' in extendOptions({ ...base, bank: '30' }), false, 'no change: the options are as before');
  });
});

test('L135 C7: the panel says where the bank\'s mark stands: from, and the road\'s half width there; nothing without a change (AMENDED L139: marksAt)', async () => {
  const p = await mountPanel();
  assert.deepEqual(p.panel.marksAt(), [], 'no change: no mark');
  withoutMin(() => { p.type('length m', 750); p.type('width m', 20); p.type('bank °', 30); p.addBank(0); });
  const t = withoutMin(() => p.panel.marksAt()[0]);
  assert.equal(t.field, 'bank'); assert.equal(t.from, 637.5); assert.ok(t.half > 0, `a half width: ${t.half}`);
  p.panel.unmount();
});

// THE TICK, pure: on a ghost of the candidate (its samples from s0), the station s0 + from
function ghostOf(s0 = 100, len = 750) { const samples = []; for (let s = s0; s <= s0 + len + 1e-9; s += 2) samples.push({ s, pos: [0, 0, s], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] }); return { s0, samples, segments: [], jump: false }; }

test('L135 C8: tickAt: the ghost\'s station s0 + from, from -half to +half across; null for a jump\'s ghost, no ghost, or a from off the piece', () => {
  const t = ST.tickAt(ghostOf(), { from: 637.5, half: 10 });
  near(t.s, 737.5, 1.0001, 'the nearest station to s0 + from');
  assert.deepEqual(t.a.map((x) => +x.toFixed(6)), [-10, 0, t.s]); assert.deepEqual(t.b.map((x) => +x.toFixed(6)), [10, 0, t.s]);
  assert.equal(ST.tickAt({ ...ghostOf(), jump: true }, { from: 637.5, half: 10 }), null, 'a jump\'s ghost');
  assert.equal(ST.tickAt(null, { from: 637.5, half: 10 }), null, 'no ghost');
  assert.equal(ST.tickAt(ghostOf(), null), null, 'no second bank');
  assert.equal(ST.tickAt(ghostOf(100, 750), { from: 900, half: 10 }), null, 'from past the piece');
});

test('L135 C9: the bank\'s mark is drawn into the view in css px; behind the camera it is not drawn (AMENDED L139: markStroke for tickLine)', () => {
  const mark = { field: 'bank', index: 0, from: 637.5, half: 10, ...ST.styleOf('bank') }, s = 737.5;
  const pose = { eye: [0, 80, s - 120], target: [0, 0, s], up: [0, 1, 0], fov: Math.PI / 3 };
  const l = ST.markStroke(ghostOf(), mark, pose, 900, 600);
  assert.ok(l && l.strokes.length === 2 && l.strokes.every((st) => st.a.x >= 0 && st.a.x <= 900 && st.b.x >= 0 && st.b.x <= 900), `on screen at both edges: ${JSON.stringify(l)}`);
  const [x0, x1] = l.strokes.map((st) => (st.a.x + st.b.x) / 2).sort((a, b) => a - b); assert.ok(x1 - x0 > 5, 'across the road');
  assert.equal(ST.markStroke(ghostOf(), mark, { ...pose, eye: [0, 5, s + 50], target: [0, 5, s + 200] }, 900, 600), null, 'behind the camera');
});

test('L135 C10: the layer draws the marks from the preview\'s own answers (ghost, view) and the panel\'s; nothing without them (AMENDED L139: marks, not one tick)', () => {
  const { doc, win } = fakeWindow(); const stage = doc.createElement('div'); stage.clientWidth = 900; stage.clientHeight = 600;
  const g = ghostOf(), pose = { eye: [0, 80, 617.5], target: [0, 0, 737.5], up: [0, 1, 0], fov: Math.PI / 3 };
  let marks = [{ field: 'bank', index: 0, from: 637.5, half: 10, ...ST.styleOf('bank') }];
  doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(g)); doc.addEventListener('t180:view', (e) => e.detail.reply({ pose }));
  const layer = ST.mount(stage, win, () => ({ marks, offers: [] }));
  const d = layer.drawNow().marks; assert.ok(d.length === 1 && d[0].s > 736 && d[0].s < 739, `drawn at the station: ${JSON.stringify(d.map((x) => x.s))}`);
  marks = []; assert.equal(layer.drawNow().marks.length, 0, 'no change: nothing drawn');
  layer.unmount();
});

// AFTER THE REBASE ONTO B's CORE: the panel's options drive the real later change, end to end (red until the branch carries B's L139 commits)
const D = require('../../src/core/document.js');
const msgText = (p) => p.root.all().filter((e) => e.attrs && e.attrs.class === 'message').map((e) => e.textContent).join(' | ');

test('L135 C11: with B\'s core, his case is built: 750 m, bank 30 then 0 from 637.5, the piece holds about 30° at from and ends level', async () => {
  const p = await mountPanel();
  p.type('length m', 750); p.type('bank °', 30); p.addBank(0, 637.5);
  const n = p.shell.getState().history.present.pieces.length; p.extend();
  const d = p.shell.getState().history.present; assert.equal(d.pieces.length, n + 1, `one piece placed (${msgText(p)})`);
  const P = d.pieces[d.pieces.length - 1], at = (s) => D.channelAt(P, 'phi', s).v / DEG;
  near(at(637.5), 30, 0.1, 'the bank at from'); near(at(750), 0, 1e-6, 'level at the end'); near(D.channelAt(P, 'phi', 750).d1, 0, 1e-9, 'ending with slope 0');
  p.panel.unmount();
});

test('L135 C12: with B\'s core, a from past the piece is the core\'s refusal by name, shown in the panel; Extend adds nothing', async () => {
  const p = await mountPanel();
  p.type('length m', 750); p.type('bank °', 30); p.addBank(0, 800);
  assert.match(msgText(p), /no preview of this piece: .*(second|change)/i, `the ghost says why (${msgText(p)})`);
  const n = p.shell.getState().history.present.pieces.length; p.extend();
  assert.equal(p.shell.getState().history.present.pieces.length, n, 'nothing placed');
  p.panel.unmount();
});

// THE DEFAULT-FROM CLAMP (B's row-6 fix: a second ramp shorter than 15·√Δ° is BAD_SECOND). AMENDED L139: the panel reads the minimum from the core's secondMinM
// (no copy of the 15), and the row pins the panel to the core: the laid default is laid, and 1 cm past it the core refuses, naming its minimum
test('L135 C13: on a 300 m piece, 30° then 0, the default from is clamped to 300 − 15·√30 = 217.84 by the core\'s own minimum; typed, it stays', async () => {
  const p = await mountPanel();
  p.type('length m', 300); p.type('bank °', 30); p.addBank(0);
  assert.equal(p.fromBank().value, '217.84', 'the default, clamped (85% = 255 leaves 45 m, under the 82.16 m minimum)');
  assert.deepEqual(p.opts().changes, { phi: [{ from: 217.84, target: 0 }] }, 'and sent as shown');
  assert.equal(extendOptions({ length: 300, turn: '', climb: '', width: '', cup: '', bank: '30', changes: { bank: [{ then: '0', from: '' }] }, secondMinM: p.shell.secondMinM }).changes.phi[0].from, 217.84, 'a blank from in the pure options, with the shell\'s minimum: the same clamp');
  assert.equal(extendOptions({ length: 750, turn: '', climb: '', width: '', cup: '', bank: '30', changes: { bank: [{ then: '0', from: '' }] }, secondMinM: p.shell.secondMinM }).changes.phi[0].from, 637.5, 'where 85% is allowed it is still 85%');
  const n = p.shell.getState().history.present.pieces.length; p.extend();
  assert.equal(p.shell.getState().history.present.pieces.length, n + 1, `the clamped default is laid by the core (${msgText(p)})`);
  p.shell.undo();
  p.set(p.fromBank(), 217.85);   // 1 cm past the clamp: the core's own minimum refuses it
  assert.match(msgText(p), /no preview of this piece: .*82\.2/, `1 cm past the clamp the core refuses, naming its minimum (${msgText(p)})`);
  p.set(p.fromBank(), 255);
  assert.equal(p.fromBank().value, '255', 'a typed from stays as typed'); assert.equal(p.opts().changes.phi[0].from, 255, 'and is sent as typed (the core refuses it by name)');
  p.panel.unmount();
});
