// core-second-bank-panel.test.js: node --test app/test/core-second-bank-panel.test.js
// L135 (the user, 2026-11-04: "once you do banking once, there is another mark towards the end you can bank again that can let the end of the piece bank more in
// one direction or back to level in one piece, instead of having to place it, then flatten it with the next piece"). THE PANEL HALF (pane C; the core is B's):
// under the bank field, "then bank °" and "from (m)", off until the bank field has a target; from defaults to 85% of the length and follows it until typed;
// the Extend options carry the contract `second: { phi: { from, target } }` (exo_memory/loop/plan_l135_second_bank_2026-11-04.md); Undo gives both back;
// a small tick stands on the ghost at `from` (app/core/secondtick.js).
// The REAL core throughout. The core call is observed at the shell's boundary (a spy on shell.extend); until B's core lands the core ignores `second`.
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
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); };
  const button = (text) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  type('length m', 100);   // (the fake DOM's input starts with no .value: the panel's 100 is an attribute here)
  return { doc, win, root, shell, panel, label, field, type, extend: () => button('Extend').onclick(), calls, opts: () => panel.options() };
}

test('L135 C1: under the bank field, "then bank °" and "from (m)", in that order, plain labels in the bank row\'s style', async () => {
  const p = await mountPanel();
  const labels = p.root.all().filter((e) => e.tagName === 'LABEL').map((e) => e.children[0] && e.children[0].textContent);
  const at = (t) => labels.indexOf(t);
  assert.ok(at('bank °') >= 0 && at('then bank °') === at('bank °') + 1 && at('from (m)') === at('bank °') + 2, `the order: ${labels.join(' | ')}`);
  assert.equal(p.label('then bank °').attrs.class, p.label('bank °').attrs.class, 'the bank row\'s class');
  assert.equal(p.field('then bank °').attrs.type, 'number'); assert.equal(p.field('from (m)').attrs.type, 'number');
  p.panel.unmount();
});

test('L135 C2: both are off until the bank field has a target, on while it has one, off again when it is put back to what it shows', async () => {
  const p = await mountPanel();
  assert.equal(p.field('then bank °').disabled, true, 'untouched bank: off'); assert.equal(p.field('from (m)').disabled, true);
  const shownBank = p.field('bank °').value;
  p.type('bank °', 30);
  assert.equal(p.field('then bank °').disabled, false, 'a bank target: on'); assert.equal(p.field('from (m)').disabled, false);
  p.type('bank °', shownBank);
  assert.equal(p.field('then bank °').disabled, true, 'back to what it shows: off again');
  p.panel.unmount();
});

test('L135 C3: from defaults to 85% of the length and follows it until a value is typed; cleared, it follows again', async () => {
  const p = await mountPanel();
  assert.equal(p.field('from (m)').value, '85', '85% of 100');
  p.type('length m', 750);
  assert.equal(p.field('from (m)').value, '637.5', 'follows the length: 85% of 750');
  p.type('bank °', 30); p.type('from (m)', 600); p.type('length m', 900);
  assert.equal(p.field('from (m)').value, '600', 'typed: it stays');
  p.type('from (m)', ''); assert.equal(p.field('from (m)').value, '765', 'cleared: follows again, 85% of 900');
  p.panel.unmount();
});

test('L135 C4: the Extend options carry second: { phi: { from, target } } only with a bank target AND a then bank; the core call is made with it', async () => {
  const p = await mountPanel();
  p.type('length m', 750);
  assert.equal('second' in p.opts(), false, 'nothing typed: no second');
  p.type('then bank °', 0);
  assert.equal('second' in p.opts(), false, 'a then bank with no bank target: off, so no second');
  p.type('then bank °', '');   // (a disabled input takes no typing in the app; the fake DOM lets it, so it is cleared here)
  p.type('bank °', 30);
  assert.equal('second' in p.opts(), false, 'a bank target but then bank left blank: no second (the old piece, byte for byte)');
  p.type('then bank °', 0);
  assert.deepEqual(p.opts().second, { phi: { from: 637.5, target: 0 } }, 'his case: 30° then back to level from 637.5 m');
  near(p.opts().targets.phi, 30 * DEG, 1e-12, 'the first bank as before');
  p.type('then bank °', 50); p.type('from (m)', 700);
  assert.deepEqual(p.opts().second, { phi: { from: 700, target: 50 * DEG } }, 'the steeper case, from typed');
  p.extend();
  assert.deepEqual(p.calls[p.calls.length - 1].second, { phi: { from: 700, target: 50 * DEG } }, 'shell.extend is called with the second bank');
  p.panel.unmount();
});

test('L135 C5: Undo gives back both fields as they were for the undone piece (and whether from was typed); a new document clears them', async () => {
  const p = await mountPanel();
  p.type('length m', 750); p.type('bank °', 30); p.type('then bank °', 0); p.extend();
  p.type('length m', 400); p.type('bank °', -20); p.type('then bank °', -45); p.type('from (m)', 300); p.extend();
  p.shell.undo();
  assert.equal(p.field('then bank °').value, '-45', 'Undo: the undone piece\'s then bank'); assert.equal(p.field('from (m)').value, '300', 'and its typed from');
  assert.equal(p.field('then bank °').disabled, false, 'on, with the bank put back');
  assert.deepEqual(p.opts().second, { phi: { from: 300, target: -45 * DEG } }, 'so Extend again rebuilds the same piece');
  p.shell.undo();
  assert.equal(p.field('then bank °').value, '0', 'one more Undo: the first piece\'s'); assert.equal(p.field('from (m)').value, '637.5', 'its default from');
  p.type('length m', 1000); assert.equal(p.field('from (m)').value, '850', 'an untyped from still follows the length after Undo');
  p.shell.newDoc();
  assert.equal(p.field('then bank °').value, '', 'a new document clears the then bank'); assert.equal(p.field('then bank °').disabled, true);
  p.panel.unmount();
});

test('L135 C6: extendOptions is pure: no second without a bank; from left blank is 85% of the length; values are sent as typed (the core refuses by name)', () => {
  const base = { length: 200, turn: '', climb: '', width: '', cup: '' };
  assert.equal('second' in extendOptions({ ...base, bank: '', thenBank: '10', bankFrom: '' }), false, 'no bank target: no second');
  assert.deepEqual(extendOptions({ ...base, bank: '30', thenBank: '-10', bankFrom: '' }).second, { phi: { from: 170, target: -10 * DEG } }, 'blank from: 85% of 200');
  assert.deepEqual(extendOptions({ ...base, bank: '30', thenBank: '0', bankFrom: '250' }).second, { phi: { from: 250, target: 0 } }, 'a from past the length is sent: the core refuses it (BAD_SECOND), not the panel');
  assert.equal('second' in extendOptions({ ...base, bank: '30' }), false, 'no then bank: the options are as before');
});

test('L135 C7: the panel says where the tick stands: from, and the road\'s half width there; nothing without a second bank', async () => {
  const p = await mountPanel();
  assert.equal(p.panel.secondAt(), null, 'no second bank: no tick');
  p.type('length m', 750); p.type('width m', 20); p.type('bank °', 30); p.type('then bank °', 0);
  const t = p.panel.secondAt();
  assert.equal(t.from, 637.5); assert.ok(t.half > 0, `a half width: ${t.half}`);
  p.panel.unmount();
});

// THE TICK, pure: on a ghost of the candidate (its samples from s0), the station s0 + from, a short line across the road there
function ghostOf(s0 = 100, len = 750) { const samples = []; for (let s = s0; s <= s0 + len + 1e-9; s += 2) samples.push({ s, pos: [0, 0, s], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] }); return { s0, samples, segments: [], jump: false }; }
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a}, not ${b} (±${tol})`);

test('L135 C8: tickAt: the ghost\'s station s0 + from, from -half to +half across; null for a jump\'s ghost, no ghost, or a from off the piece', () => {
  const t = ST.tickAt(ghostOf(), { from: 637.5, half: 10 });
  near(t.s, 737.5, 1.0001, 'the nearest station to s0 + from');
  assert.deepEqual(t.a.map((x) => +x.toFixed(6)), [-10, 0, t.s]); assert.deepEqual(t.b.map((x) => +x.toFixed(6)), [10, 0, t.s]);
  assert.equal(ST.tickAt({ ...ghostOf(), jump: true }, { from: 637.5, half: 10 }), null, 'a jump\'s ghost');
  assert.equal(ST.tickAt(null, { from: 637.5, half: 10 }), null, 'no ghost');
  assert.equal(ST.tickAt(ghostOf(), null), null, 'no second bank');
  assert.equal(ST.tickAt(ghostOf(100, 750), { from: 900, half: 10 }), null, 'from past the piece');
});

test('L135 C9: tickLine projects the tick into the view in css px; behind the camera it is not drawn', () => {
  const t = ST.tickAt(ghostOf(), { from: 637.5, half: 10 });
  const pose = { eye: [0, 80, t.s - 120], target: [0, 0, t.s], up: [0, 1, 0], fov: Math.PI / 3 };
  const l = ST.tickLine(t, pose, 900, 600);
  assert.ok(l && l.a.x >= 0 && l.a.x <= 900 && l.b.x >= 0 && l.b.x <= 900 && Math.abs(l.a.x - l.b.x) > 5, `on screen and across: ${JSON.stringify(l)}`);
  near(l.a.y, l.b.y, 1e-6, 'level across a level road seen square on');
  assert.equal(ST.tickLine(t, { ...pose, eye: [0, 5, t.s + 50], target: [0, 5, t.s + 200] }, 900, 600), null, 'behind the camera');
});

test('L135 C10: the layer draws the tick from the preview\'s own answers (ghost, view) and the panel\'s from; nothing without them', () => {
  const { doc, win } = fakeWindow(); const stage = doc.createElement('div'); stage.clientWidth = 900; stage.clientHeight = 600;
  const g = ghostOf(), pose = { eye: [0, 80, 617.5], target: [0, 0, 737.5], up: [0, 1, 0], fov: Math.PI / 3 };
  let at = { from: 637.5, half: 10 };
  doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(g)); doc.addEventListener('t180:view', (e) => e.detail.reply({ pose }));
  const layer = ST.mount(stage, win, () => at);
  const d = layer.drawNow(); assert.ok(d && d.s > 736 && d.s < 739, `drawn at the station: ${JSON.stringify(d)}`);
  at = null; assert.equal(layer.drawNow(), null, 'no second bank: nothing drawn');
  layer.unmount();
});

// AFTER THE REBASE ONTO B's CORE (l135-second-bank 0085910): the panel's options drive the real second bank, end to end
const D = require('../../src/core/document.js');
const msgText = (p) => p.root.all().filter((e) => e.attrs && e.attrs.class === 'message').map((e) => e.textContent).join(' | ');

test('L135 C11: with B\'s core, his case is built: 750 m, bank 30 then 0 from 637.5, the piece holds about 30° at from and ends level', async () => {
  const p = await mountPanel();
  p.type('length m', 750); p.type('bank °', 30); p.type('then bank °', 0);
  const n = p.shell.getState().history.present.pieces.length; p.extend();
  const d = p.shell.getState().history.present; assert.equal(d.pieces.length, n + 1, `one piece placed (${msgText(p)})`);
  const P = d.pieces[d.pieces.length - 1], at = (s) => D.channelAt(P, 'phi', s).v / DEG;
  near(at(637.5), 30, 0.1, 'the bank at from'); near(at(750), 0, 1e-6, 'level at the end'); near(D.channelAt(P, 'phi', 750).d1, 0, 1e-9, 'ending with slope 0');
  p.panel.unmount();
});

test('L135 C12: with B\'s core, a from past the piece is the core\'s refusal by name, shown in the panel; Extend adds nothing', async () => {
  const p = await mountPanel();
  p.type('length m', 750); p.type('bank °', 30); p.type('then bank °', 0); p.type('from (m)', 800);
  assert.match(msgText(p), /no preview of this piece: .*second bank/i, `the ghost says why (${msgText(p)})`);
  const n = p.shell.getState().history.present.pieces.length; p.extend();
  assert.equal(p.shell.getState().history.present.pieces.length, n, 'nothing placed');
  p.panel.unmount();
});
