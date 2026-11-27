// core-bank-carry.test.js: node --test app/test/core-bank-carry.test.js
// THE BANK PAST A FULL TURN, TYPED (D677; plan lighthouse exo_memory/loop/plan_t180_floors_and_wrap_2026-11-26.md (b), rows W1, W2, G6, G7).
// The user, 2026-11-26 23:00 (lighthouse exo_memory/briefs/t180_unmakeable_shapes.md:49-50): past a full turn the bank shown resets to 0 while the road carries
// the extra degrees into the next turn. The SHOWN bank keeps within one turn (D259); a TYPED bank is laid as typed, in the head's own turn, so the road
// rolls on into the next turn instead of unwinding. The drags (the ghost's bank handle, Sculpt's bank handle, the bank brush) keep his 2026-10-06 rule, unchanged.
// Rows (W1 to W4 seen red on t180-fresh landing-1126-batch f3cd425 before the change; G6 G7 guard what must not move, green before and after):
//   W1  from a head at −340 a typed −392 lays −340 → −392 one way, its steepest roll within 10% of the core's own for that target; the field then shows −32. And the mirror
//   W2  an extra bank row past −360 (−392 after −360) is laid, not refused, and the road ends at −392
//   W3  from a head past one turn (−392, shown −32) a typed −60 lays −392 → −420: the head's whole turns are carried, never unwound
//   W4  from a head past one turn the unused extra bank handle offers the field value (−60, not −420), and a drag on it lays in the head's turn (on f3cd425 the
//       change came out at −60, absolute); it is also the row that catches the offer read in the wrong turn (core-bank-carry-mutation.test.js B5)
//   G6  Close on a wound lap (the bank −392 at the head) gives the seam it gave on f3cd425: the same document bytes
//   G7  a document wound to −4π (TEST 1's −720°), saved and opened, is the same bytes; and every test track in test/fixtures round-trips byte-identical
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { createCoreShell } = require('../core/coreshell.js');
const DEG = Math.PI / 180;

// ── a small fake DOM, as app/test/core-bank-flow-panel.test.js has it ──
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
/** A panel on a shell whose track is one straight bowl, 300 m, 33 m wide (core-bank-flow-panel's lead). */
async function mountPanel() {
  const { doc } = fakeWindow();
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  shell.commitDoc(extend(D.createDoc('carry'), { length: 300, family: 'bowl', first: { w: 33 } }));
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => { const l = label(text); assert.ok(l, `the panel has no "${text}" field`); return l.children[1]; };
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); };
  const button = (text) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const msgText = () => root.all().filter((e) => e.attrs && e.attrs.class === 'message').map((e) => e.textContent).join(' | ');
  const pieces = () => shell.getState().history.present.pieces.length;
  /** Extend by the panel with the bank typed: the message when nothing was laid, else null */
  const lay = (bank, length = 150) => { const n = pieces(); type('length m', length); type('bank °', bank); button('Extend').onclick(); return pieces() > n ? null : msgText() || 'nothing laid, no message'; };
  return { shell, panel, field, type, lay, msgText, pieces, head: () => shell.headState().phi / DEG };
}
/** the last piece's bank in degrees, every metre */
const bankAlong = (shell) => { const d = shell.getState().history.present, P = d.pieces[d.pieces.length - 1], out = []; for (let s = 0; s <= P.length + 1e-9; s += 1) out.push(D.channelAt(P, 'phi', Math.min(s, P.length)).v / DEG); return out; };
const oneWay = (b, dir) => b.every((v, i) => !i || dir * (v - b[i - 1]) >= -1e-9);
const steepest = (b) => b.reduce((m, v, i) => (i ? Math.max(m, Math.abs(v - b[i - 1])) : m), 0);
/** the core's own steepest roll for this target on this head (the same options, the target as given): what the panel should lay */
const coreSteepest = (shell, opts, deg) => { const d = extend(shell.getState().history.present, { ...opts, targets: { ...opts.targets, phi: deg * DEG } }), P = d.pieces[d.pieces.length - 1], b = []; for (let s = 0; s <= P.length + 1e-9; s += 1) b.push(D.channelAt(P, 'phi', Math.min(s, P.length)).v / DEG); return steepest(b); };

for (const dir of [-1, 1]) {
  const way = dir < 0 ? 'banking right (−)' : 'banking left (+)';
  test(`W1 (${way}): from a head at ${340 * dir} a typed ${392 * dir} lays the road ${340 * dir} → ${392 * dir} one way, its steepest roll within 10% of the core's own; the field then shows ${32 * dir}`, async () => {
    const p = await mountPanel();
    assert.equal(p.lay(170 * dir), null, 'control: half way'); assert.equal(p.lay(340 * dir), null, 'control: the head at ±340');
    assert.ok(Math.abs(p.head() - 340 * dir) < 1e-6, `the head is at ${340 * dir}: ${p.head()}`);
    p.type('length m', 150); p.type('bank °', 392 * dir);
    const o = p.panel.options(), core = coreSteepest(p.shell, o, 392 * dir);
    assert.equal(p.lay(392 * dir), null, `laid: ${p.msgText()}`);
    const b = bankAlong(p.shell);
    assert.ok(Math.abs(b[b.length - 1] - 392 * dir) < 1e-6, `the road ends at ${392 * dir}: ${b[b.length - 1]}`);
    assert.ok(oneWay(b, dir), `one way, never unwinding: ${[0, 50, 100, 150].map((s) => b[s].toFixed(1)).join(' -> ')}`);
    assert.ok(steepest(b) <= 1.1 * core + 1e-9, `the steepest roll ${steepest(b).toFixed(2)} °/m is within 10% of the core's own ${core.toFixed(2)} °/m`);
    assert.equal(p.field('bank °').value, String(32 * dir), 'the field shows the bank within one turn');
  });
}

test('W2: an extra bank row past −360 (−392 after −360) is laid, not refused, and the road ends at −392', async () => {
  const p = await mountPanel();
  assert.equal(p.lay(-170), null); assert.equal(p.lay(-340), null);
  p.type('length m', 300); p.type('bank °', -360); p.panel.secondAdd('bank', { then: '-392', from: '75' });
  const n = p.pieces();
  // 300 m: the 32° change needs about 178 m after its mark on this road (BAD_SECOND names it when it has less)
  const ext = p.lay(-360, 300); assert.equal(ext, null, `laid, not refused: ${ext}`); assert.equal(p.pieces(), n + 1);
  const b = bankAlong(p.shell);
  assert.ok(Math.abs(b[b.length - 1] + 392) < 1e-6, `the road ends at −392: ${b[b.length - 1]}`);
  assert.ok(oneWay(b, -1), `one way: ${[0, 75, 150, 225, 300].map((s) => b[s].toFixed(1)).join(' -> ')}`);
});

test('W3: from a head past one turn (−392, shown −32) a typed −60 lays −392 → −420: the head\'s whole turns are carried, never unwound', async () => {
  const p = await mountPanel();
  const d = extend(p.shell.getState().history.present, { length: 400, targets: { phi: -392 * DEG } }); p.shell.commitDoc(d);
  assert.ok(Math.abs(p.head() + 392) < 1e-6, `control: the head at −392 (laid by the core): ${p.head()}`);
  assert.equal(p.lay(-60), null, `laid: ${p.msgText()}`);
  const b = bankAlong(p.shell);
  assert.ok(Math.abs(b[b.length - 1] + 420) < 1e-6, `the road ends at −420, not −60: ${b[b.length - 1]}`);
  assert.ok(oneWay(b, -1), `one way: ${[0, 50, 100, 150].map((s) => b[s].toFixed(1)).join(' -> ')}`);
  assert.equal(p.field('bank °').value, '-60', 'the field shows −60, within one turn');
});

// W4: the extra bank's handle stands in the field's turn too, so a drag on it is read as the rows are (offersAt's base, less the head's whole turns)
test('W4: from a head past one turn, the unused extra bank handle offers the field value −60, not −420, and a drag on it to −80 lays the change at −440', async () => {
  const p = await mountPanel();
  const d = extend(p.shell.getState().history.present, { length: 400, targets: { phi: -392 * DEG } }); p.shell.commitDoc(d);
  p.type('length m', 300); p.type('bank °', -60);
  const x = p.panel.extraHandles().find((e) => e.field === 'bank' && e.unused); assert.ok(x, 'control: the unused extra bank handle is offered');
  assert.ok(Math.abs(x.value + 60) < 1e-9, `it offers the field's value, −60: ${x.value}`);
  p.panel.secondExtra(x.id, -80);
  const o = p.panel.options(), c = o.changes && o.changes.phi;
  assert.ok(c && c.length === 1 && Math.abs(c[0].target / DEG + 440) < 1e-6, `the change is laid at −440, in the head's turn: ${JSON.stringify(c)}`);
});

// G6: the wound lap of core_close_banks_lap's lap() shape, its bank rolled to −360 on one straight and on to −392 on another, laid by the core; Close (closejob
// runCloseBest, as the press runs it) joins the seam modulo whole turns. The digest is the closed document's as f3cd425 gave it, before this change
const G6_SHA = '031cf9ad781e8b170b4e021b30f4a0f50726b066cf45dde419ac1f5b5081a249';
test('G6 (guard): Close on a wound lap gives the seam it gave before: the same closed document, its seam −360 ≡ 0', () => {
  const { extendTurnBy } = require('../../src/core/turnby.js'), CJ = require('../core/closejob.js'), Q = 300 * Math.PI / 2;
  let d = D.createDoc('lap'); d = extend(d, { length: 100, family: 'bowl' }); d = extendTurnBy(d, { length: Q }, 90 * DEG);
  d = extend(d, { length: 300, targets: { phi: -360 * DEG } }); d = extend(d, { length: Q / 2, targets: { kh: 1 / 300 } }); d = extendTurnBy(d, { length: Q / 2 }, 67.5 * DEG);
  d = extend(d, { length: 200, targets: { phi: -392 * DEG } }); d = extendTurnBy(d, { length: Q }, 90 * DEG);
  d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: Q }, 90 * DEG);
  const r = CJ.runCloseBest({ doc: d }); assert.ok(r.converged && r.doc && r.doc.closed, `closed: ${r.report}`);
  const P0 = r.doc.pieces[0], PL = r.doc.pieces[r.doc.pieces.length - 1];
  assert.ok(Math.abs(D.channelAt(PL, 'phi', PL.length).v / DEG - D.channelAt(P0, 'phi', 0).v / DEG + 360) < 1e-6, 'the seam joins a whole turn apart');
  assert.equal(crypto.createHash('sha256').update(D.serialize(r.doc)).digest('hex'), G6_SHA);
});

test('G7 (guard): a document wound to −4π (−720°), saved and opened, is the same bytes; every test track in test/fixtures round-trips byte-identical', () => {
  let d = D.createDoc('wound'); d = extend(d, { length: 100, family: 'bowl' }); d = extend(d, { length: 600, targets: { phi: -360 * DEG } }); d = extend(d, { length: 600, targets: { phi: -720 * DEG } });
  const P = d.pieces[d.pieces.length - 1]; assert.ok(Math.abs(D.channelAt(P, 'phi', P.length).v + 4 * Math.PI) < 1e-6, 'control: the head at −4π');
  const t = D.serialize(d); assert.equal(D.serialize(D.parse(t)), t, 'the wound document round-trips byte-identical');
  const dir = path.join(__dirname, '../../test/fixtures'), files = fs.readdirSync(dir).filter((f) => /\.(core2\.json|t180track)$/.test(f));
  assert.ok(files.length >= 10, `the test tracks are there (${files.length})`);
  for (const f of files) { const s = D.serialize(D.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); assert.equal(D.serialize(D.parse(s)), s, `${f} round-trips byte-identical`); }
});
