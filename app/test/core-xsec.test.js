// core-xsec.test.js: node --test app/test/core-xsec.test.js
// THE CROSS-SECTION in the app (lap D225, pane C): the Extend fields for the edge curve (edge angle, edge start) and the tube (sweep), the
// bank field winding past ±180 (the spiral), their readout cells, the head marker along the road's U and inside a closed tube, a core refusal
// shown by its name, and the validation words for the two new reds. E's seal (cross_section_seal_registration_2026-10-03.md) is scored by
// B, a non-author; these are the author's own tests of the app's half.
//
// THE STUB (written before A's core exists in this tree, b3364df): A's core adds the channels, their readout keys and their guards. Until it
// lands, stubXsec(shell) wraps the REAL shell and does exactly these things, nothing else:
//   1. it removes the cross-section targets (the keys in app/core/xsec.js CHANNEL) and their `transition` entries before the real core sees
//      them (b3364df refuses an unknown channel), and records what each piece asked for;
//   2. it adds the readout keys (xsec.js READOUT) to the real readouts from that record: a piece that asked for nothing reads the defaults
//      (0, 0.64, 0); a piece given a target reads the target PLUS a ring (edge +0.871°, start +0.013, tube −0.871°), as the Extend fit may
//      ring past a target (D190 V5), so a panel that shows the typed value instead of the document's is caught;
//   3. headState() adds the same document values for the head, so the fields read back what was placed;
//   4. it refuses with A's CONTRACT names (p-xsec-A-contract_2026-10-03.md), as CoreErrors: BAD_TUBE for a held sweep in the slot
//      (348.732°, 360°) on a 31 m road (E's T1 iii) or outside [0, 360]; BAD_EDGE for e < 0 or s outside [0.5, 0.95]; BAD_TARGET for c and t
//      together. Only the names and these simple bounds are the stub's: the real guards (the cap on the total, t1m(w)) are A's.
// The real shell's own headState (no stub) is tested separately: on a core without the channels it reads the seal's defaults.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const XS = require('../core/xsec.js');
const { headMarker } = require('../preview/look.js');
const { clearanceAtHead } = require('../preview/preview.js');
const VL = require('../validate-ui/labels.js');
const D = require('../../src/core/document.js');
const DEG = Math.PI / 180, E = XS.CHANNEL.edge, S = XS.CHANNEL.start, T = XS.CHANNEL.tube;

// ── a small fake DOM, as app/test/core-readout-display.test.js has it ──
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
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
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
async function mountPanel(wrap = (s) => s) {
  const { doc } = fakeWindow();
  const root = doc.createElement('div'), shell = wrap(await createCoreShell({ brushFn: null }));   // no #preview: no label layer
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => { const l = label(text); assert.ok(l, `the panel has no "${text}" field`); return l.children[1]; };
  const box = (text) => label(text).children[2].children[0];
  const cell = (k) => { const c = root.all().find((e) => e.attrs['data-readout'] === k); assert.ok(c, `no readout cell "${k}"`); return c.textContent; };
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); };
  const button = (text) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const message = () => root.all().find((e) => e.attrs.role === 'status').textContent;
  return { root, shell, panel, label, field, box, cell, type, button, message, opts: () => panel.options() };
}

const RING = Object.freeze({ [E]: 0.871, [S]: 0.013, [T]: -0.871 });
const DEF = Object.freeze({ [E]: XS.DEFAULTS.edge, [S]: XS.DEFAULTS.start, [T]: XS.DEFAULTS.tube });
function stubXsec(real) {
  const asked = new Map(), sent = [];   // asked: piece id → { channel: document value at the piece's end }
  const KEYS = Object.values(XS.CHANNEL);
  const strip = (o) => {
    const t = { ...((o && o.targets) || {}) }, got = {}; for (const k of KEYS) if (k in t) { got[k] = t[k]; delete t[k]; }
    const out = { ...o, targets: t };
    if (o && o.transition && typeof o.transition === 'object') { const tr = { ...o.transition }; for (const k of KEYS) delete tr[k]; out.transition = tr; if (!Object.keys(tr).length) delete out.transition; }
    if (o && o.first) { const f = { ...o.first }; for (const k of KEYS) delete f[k]; out.first = f; }
    return { o: out, got };
  };
  const guard = (got, w, targets = {}) => {
    const t = got[T], e = got[E], sl = got[S];
    if (t !== undefined && 'c' in targets) throw new D.CoreError('BAD_TARGET', 'a piece is a cup or a tube, not both (stub)');
    if (t !== undefined && (t < 0 || t > 360)) throw new D.CoreError('BAD_TUBE', `the sweep must be 0 to 360°, got ${t} (stub)`);
    if (t !== undefined && t > 348.732 && t < 360 && Math.abs(w - 31) < 0.5) throw new D.CoreError('BAD_TUBE', `a sweep of ${t}° on a ${w} m road leaves a slot narrower than the downforce ray (stub)`);
    if (e !== undefined && e < 0) throw new D.CoreError('BAD_EDGE', `the edge angle must be ≥ 0, got ${e} (stub)`);
    if (sl !== undefined && !(sl >= 0.5 && sl <= 0.95)) throw new D.CoreError('BAD_EDGE', `the edge start must be 0.5 to 0.95, got ${sl} (stub)`);
  };
  // (the real extend redraws the panel before it returns, so the piece's record is taken from `pending` the first time its id is seen)
  let pending = null;
  const lastEnd = () => { const P = real.getState().history.present.pieces; const id = P.length ? P[P.length - 1].id : null;
    if (id && !asked.has(id) && pending) { asked.set(id, pending); pending = null; }
    return id && asked.has(id) ? asked.get(id) : DEF; };
  const endOf = (from, got) => Object.fromEntries(KEYS.map((k) => [k, got[k] === undefined ? from[k] : got[k] + RING[k]]));
  const withXs = (r, from, to) => { const o = { ...r }; for (const [f, k] of Object.entries(XS.CHANNEL)) { const [a, b] = XS.READOUT[f]; o[a] = from[k]; o[b] = to[k]; } return o; };
  return Object.assign(Object.create(real), {
    sent,
    candidateReadout(o) { sent.push(o); const { o: bare, got } = strip(o); guard(got, real.headState().w, (o && o.targets) || {}); const from = lastEnd(); return withXs(real.candidateReadout(bare), from, endOf(from, got)); },
    candidate(o) { return real.candidate(strip(o).o); },
    extend(o) {
      sent.push(o); const { o: bare, got } = strip(o), from = lastEnd();
      guard(got, real.headState().w, (o && o.targets) || {});   // (the stub throws; A's core throws inside the shell's attempt, which shows it: the real-core test below)
      pending = endOf(from, got); real.extend(bare); lastEnd(); pending = null;
    },
    headState() { return { ...real.headState(), ...lastEnd() }; },
  });
}

// ── extendOptions (pure) ──
test('xsec extendOptions: each field is its channel target, in the seal\'s units', () => {
  const o = extendOptions({ length: 200, edge: '15', start: '0.7', tube: '360' });
  assert.equal(o.targets[E], 15, 'the edge angle goes in as DEGREES (as the cup does)');
  assert.equal(o.targets[S], 0.7, 'the edge start goes in as a share');
  assert.equal(o.targets[T], 360, 'the tube sweep goes in as DEGREES');
  const none = extendOptions({ length: 200, edge: '', start: '', tube: '' });
  for (const k of [E, S, T]) assert.ok(!(k in none.targets), `an empty field sends no ${k} target (it continues)`);
});
test('xsec extendOptions: nothing is clamped; the core\'s guards refuse by name (E2 KE2-2)', () => {
  const o = extendOptions({ length: 100, edge: '-5', start: '0.2', tube: '400' });
  assert.deepEqual([o.targets[E], o.targets[S], o.targets[T]], [-5, 0.2, 400]);
  assert.equal(extendOptions({ length: 100, edge: '170' }).targets[E], 170);
});
test('xsec extendOptions: bank winds past ±180 (the spiral, S1 iv)', () => {
  assert.equal(extendOptions({ length: 300, bank: '360' }).targets.phi, 360 * DEG);
  assert.equal(extendOptions({ length: 300, bank: '-540' }).targets.phi, -540 * DEG);
});
test('xsec extendOptions: the new fields take the "at start" box like the others', () => {
  const o = extendOptions({ length: 100, edge: '15', start: '0.8', tube: '90', atStart: { edge: true, start: true, tube: true } });
  assert.deepEqual(o.transition, { [E]: 20, [S]: 20, [T]: 20 });
  const short = extendOptions({ length: 12, edge: '15', atStart: { edge: true } });
  assert.deepEqual(short.transition, { [E]: 12 }, 'held to the piece when it is shorter than 20 m');
  assert.ok(!('transition' in extendOptions({ length: 100, edge: '', atStart: { edge: true } })), 'a ticked field with no target sends nothing');
  const first = extendOptions({ length: 100, edge: '15', empty: true });
  assert.equal(first.first[E], 15, 'on an empty track the typed edge is the first piece\'s start too (D194a)');
});

// ── the shell's head state ──
test('xsec headState (A\'s core): a non-tube head shows tube sweep 0 ("none"); an edge head and a tube head show the document\'s values', async () => {
  const sh = await createCoreShell({ brushFn: null });
  const h0 = sh.headState();
  assert.deepEqual([h0[E], h0[S], h0[T]], [0, 0.64, 0], 'an empty track');
  sh.extend(extendOptions({ length: 100 }));
  const h1 = sh.headState();
  assert.deepEqual([h1[E], h1[S], h1[T]], [0, 0.64, 0], 'after a plain piece: no edge, the default start, and NO tube (RULING 2), whatever the core keeps to start a later tube');
  sh.extend(extendOptions({ length: 100, edge: '15', start: '0.7' }));
  const end2 = D.endState(sh.getState().history.present), h2 = sh.headState();
  assert.equal(h2[E], end2[E].v, 'an edge head shows the document\'s e'); assert.equal(h2[S], end2[S].v, 'and its s');
  assert.equal(h2[T], 0, 'still no tube');
  sh.extend(extendOptions({ length: 100, tube: '180' }));
  const end3 = D.endState(sh.getState().history.present), h3 = sh.headState();
  assert.ok(sh.getState().history.present.pieces.slice(-1)[0].tube, 'the piece is a tube');
  assert.equal(h3[T], end3[T].v, 'a tube head shows its sweep');
  assert.ok(Math.abs(h3[T] - 180) < 1, `about the 180 asked for (${h3[T]})`);
  assert.deepEqual(XS.headOf({ [E]: { v: 12 }, [S]: { v: 0.8 }, [T]: { v: 90 } }, true), { [E]: 12, [S]: 0.8, [T]: 90 }, 'a tube head: every channel the core has is read');
  assert.equal(XS.headOf({ [T]: { v: 31 } })[T], 0, 'a non-tube head: the sweep the core keeps internally is not shown');
});

// ── the panel ──
test('xsec panel: the three fields are on the panel and show the head; left as shown they send nothing', async () => {
  const p = await mountPanel(stubXsec);
  assert.equal(p.field('edge angle °').value, '0');
  assert.equal(p.field('edge start').value, '0.64');
  assert.equal(p.field('tube sweep °').value, '0');
  const t = p.opts().targets;
  for (const k of [E, S, T]) assert.ok(!(k in t), `untouched, ${k} is not a target`);
  for (const f of ['edge angle °', 'edge start', 'tube sweep °']) assert.ok(p.box(f) && p.box(f).tagName === 'INPUT', `"${f}" has its at-start box`);
});
test('xsec panel: a changed field is a target, and its cell shows the DOCUMENT, not the typed value', async () => {
  const p = await mountPanel(stubXsec);
  p.type('length m', 100); p.type('edge angle °', 15); p.type('edge start', 0.7); p.type('tube sweep °', 180);
  const t = p.opts().targets;
  assert.deepEqual([t[E], t[S], t[T]], [15, 0.7, 180]);
  assert.equal(p.cell('edge'), '0.0° → 15.9°', 'edge from → to: the document rings past the typed 15');
  assert.equal(p.cell('start'), '0.64 → 0.71', 'edge start from → to, two decimals');
  assert.equal(p.cell('tube'), '0.0° → 179.1°', 'tube from → to');
  p.box('edge angle °').checked = true; p.box('edge angle °').oninput();
  assert.deepEqual(p.opts().transition, { [E]: 20 }, 'the edge\'s at-start box');
});
// Each field redraws on its OWN (X11): the row above types the tube last, and the tube's handler redraws every cell, so it could not see an edge or
// edge-start field that redraws nothing. Since the undo guard (8926789) wraps every field's handler, such a field no longer throws either.
test('xsec panel: the edge angle and the edge start each redraw the readout on their own, with no other field typed after them', async () => {
  const p = await mountPanel(stubXsec);
  p.type('length m', 100); p.type('edge angle °', 15);
  assert.equal(p.cell('edge'), '0.0° → 15.9°', 'the edge angle alone redraws its cell');
  p.type('edge start', 0.7);
  assert.equal(p.cell('start'), '0.64 → 0.71', 'the edge start alone redraws its cell');
});
test('xsec panel: after Extend the fields read back what the document holds', async () => {
  const p = await mountPanel(stubXsec);
  p.type('length m', 100); p.type('edge angle °', 15); p.type('tube sweep °', 90);
  p.button('Extend').onclick();
  assert.equal(p.field('edge angle °').value, '15.87');
  assert.equal(p.field('tube sweep °').value, '89.13');
  assert.equal(p.field('edge start').value, '0.64', 'an untouched start keeps the default');
});
// A's core reports the readout keys for every piece; each cell must be the core's own value, rounded as the cup cell is (E's seal E7)
const fmtDegCell = (x) => require('../core/labels.js').fmtDeg(x).replace(/^\+/, ''), fmtShareCell = (x) => (Math.round(Math.abs(x) * 100 + 1e-7) / 100 * Math.sign(x) || 0).toFixed(2);
test('xsec panel (A\'s core): each cross-section cell is the core\'s own readout of the candidate', async () => {
  for (const typed of [{}, { 'edge angle °': 15, 'edge start': 0.7 }, { 'tube sweep °': 180 }, { 'tube sweep °': 300, 'edge angle °': 20 }]) {
    const p = await mountPanel();   // the REAL core (A's, in this tree): no stub
    p.type('length m', 100); for (const [f, v] of Object.entries(typed)) p.type(f, v);
    const ro = p.root.all().find((e) => e.attrs.class === 'readout');
    assert.equal(ro.title, '', `the core accepted ${JSON.stringify(typed)}: "${ro.title}"`);
    const r = p.shell.candidateReadout(p.opts());
    assert.equal(p.cell('edge'), `${fmtDegCell(r.edgeFromDeg)} → ${fmtDegCell(r.edgeToDeg)}`, `${JSON.stringify(typed)}: edge`);
    assert.equal(p.cell('start'), `${fmtShareCell(r.sliceFrom)} → ${fmtShareCell(r.sliceTo)}`, `${JSON.stringify(typed)}: edge start`);
    assert.equal(p.cell('tube'), `${fmtDegCell(r.tubeFromDeg)} → ${fmtDegCell(r.tubeToDeg)}`, `${JSON.stringify(typed)}: tube`);
    if (!typed['tube sweep °']) assert.equal(p.cell('tube'), '0.0° → 0.0°', 'a piece that is not a tube reads a sweep of 0 ("none")');
  }
});
test('xsec panel: a core that reports no cross-section readout shows — in those cells', async () => {
  const p = await mountPanel((real) => Object.assign(Object.create(real), { candidateReadout(o) { const r = { ...real.candidateReadout(o) }; for (const pair of Object.values(XS.READOUT)) for (const k of pair) delete r[k]; return r; } }));
  p.type('length m', 100);
  for (const k of ['edge', 'start', 'tube']) assert.equal(p.cell(k), '—');
  assert.match(p.cell('length'), /m/, 'the other cells still read');
});
test('xsec panel: a core refusal is shown by its name (BAD_TUBE, BAD_EDGE: A\'s contract)', async () => {
  const cases = [
    ['BAD_TUBE', (p) => { p.type('width m', 31); p.type('tube sweep °', 352); }],   // held in the slot (T1 iii)
    ['BAD_TUBE', (p) => { p.type('tube sweep °', 400); }],                          // outside [0, 360]
    ['BAD_EDGE', (p) => { p.type('edge angle °', -5); }],                           // e < 0
    ['BAD_EDGE', (p) => { p.type('edge start', 0.3); }],                            // s below 0.5
  ];
  for (const [name, set] of cases) {
    const p = await mountPanel(stubXsec);
    p.type('length m', 100); set(p);
    const ro = p.root.all().find((e) => e.attrs.class === 'readout');
    assert.match(ro.title, new RegExp(`^${name}: `), `the readout box names the guard: "${ro.title}"`);
    assert.equal(p.cell('length'), '—', 'and no number is shown for a refused piece');
    assert.throws(() => p.shell.extend(p.opts()), new RegExp(name), 'Extend is refused with the guard\'s name');
  }
});
test('xsec panel: a piece is a cup OR a tube — changing one puts the other back and disables it', async () => {
  const p = await mountPanel(stubXsec), cup = p.field('cup °'), tube = p.field('tube sweep °');
  const cup0 = cup.value;
  p.type('length m', 100); p.type('tube sweep °', 180);
  assert.equal(cup.disabled, true, 'a typed sweep disables the cup');
  assert.equal(cup.value, cup0, 'and puts the cup back to what it shows');
  assert.match(cup.getAttribute('title'), /cup or a tube/, 'the disabled field says why');
  let t = p.opts().targets; assert.ok(T in t && !('c' in t), 'only the tube is a target, so BAD_TARGET is never sent');
  p.type('tube sweep °', 0);   // back to the shown 0
  assert.equal(cup.disabled, false, 'putting the sweep back frees the cup');
  p.type('cup °', 45);
  assert.equal(tube.disabled, true, 'a typed cup disables the tube'); assert.equal(tube.value, '0');
  t = p.opts().targets; assert.ok('c' in t && !(T in t));
  p.button('Extend').onclick();
  assert.equal(tube.disabled, false, 'a new document frees both');
  assert.equal(cup.disabled, false);
  assert.ok(!/cup or a tube/.test(tube.getAttribute('title')), 'and gives back the field\'s own tooltip');
});
test('xsec panel: a cup and a tube sent together anyway are refused by name (BAD_TARGET)', async () => {
  const p = await mountPanel(stubXsec);
  assert.throws(() => p.shell.extend({ length: 100, targets: { c: 45, [T]: 180 } }), /BAD_TARGET/);
});
test('xsec panel: a refusal the REAL core makes on Extend is shown in the panel with its name', async () => {
  const p = await mountPanel();   // the real core: a negative width is refused by name
  p.type('length m', 100); p.type('width m', -5); p.button('Extend').onclick();
  assert.match(p.message(), /^[A-Z][A-Z_]+: /, `the message carries the core's refusal name: "${p.message()}"`);
  assert.equal(p.shell.getState().history.present.pieces.length, 0, 'and nothing was placed');
});
test('xsec panel: the bank field takes 360 and −540 and reads them back (S1 iv)', async () => {
  const p = await mountPanel();   // the real core: it winds the bank already (E's V5)
  const bank = p.field('bank °');
  assert.ok(!('max' in bank.attrs) && !('min' in bank.attrs), 'the bank input has no min or max');
  p.type('length m', 300); p.type('bank °', 360); p.button('Extend').onclick();
  assert.equal(p.field('bank °').value, '360');
  p.type('length m', 300); p.type('bank °', -540); p.button('Extend').onclick();
  assert.equal(p.field('bank °').value, '-540');
});

// ── the head marker ──
const v3 = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
test('xsec head marker: the mast follows the road\'s U, right side up when inverted', () => {
  const head = { pos: [5, 2, 1], T: [0, 0, 1], L: [-1, 0, 0], U: [0, -1, 0] };   // upside down
  const P = headMarker(head, 3).positions, top = v3(P, 1);
  assert.ok(dist(top, [5, -8, 1]) < 1e-5, `the mast points along U: ${top}`);
  const old = headMarker({ pos: [0, 0, 0], T: [0, 0, 1], L: [1, 0, 0] }, 3).positions;
  assert.ok(dist(v3(old, 1), [0, 10, 0]) < 1e-5, 'with no U it stands on world y, as before');
});
test('xsec head marker: inside a closed tube the marker keeps to the room it has', () => {
  const head = { pos: [0, 0, 0], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] }, P = headMarker(head, 6, { up: 2.7, lat: 1.35 }).positions;
  assert.ok(dist(v3(P, 0), v3(P, 1)) <= 2.7 + 1e-6, 'the mast is held below the roof');
  for (let i = 2; i < P.length / 3; i++) assert.ok(Math.abs(v3(P, i)[0]) <= 1.35 + 1e-6, `vertex ${i} reaches ${v3(P, i)[0]} m sideways`);
});
const tube = (w, sweepDeg, n = 40) => { const h = w / 2, u = [], psi = []; for (let k = -n; k <= n; k++) { u.push(h * k / n); psi.push(sweepDeg / 2 * DEG * Math.abs(k) / n); } return { u, psi }; };
test('xsec head marker: the clearance of a closed tube is 0.9 of its roof and of its reach', () => {
  const w = 31, R = w / (2 * Math.PI), c = clearanceAtHead([{ profile: tube(w, 360), length: 10 }]);
  assert.ok(c, 'a 360° tube closes');
  assert.ok(Math.abs(c.up - 0.9 * 2 * R) < 0.01, `roof ${c.up} vs ${0.9 * 2 * R}`);
  assert.ok(Math.abs(c.lat - 0.9 * R) < 0.02, `reach ${c.lat} vs ${0.9 * R}`);
  assert.equal(clearanceAtHead([{ profile: tube(w, 340), length: 10 }]), null, 'an open tube does not close');
  assert.equal(clearanceAtHead([{ profile: { u: [-15, 0, 15], psi: [0.27, 0, 0.27] }, length: 10 }]), null, 'a bowl does not close');
  assert.equal(clearanceAtHead([]), null);
});

test('xsec head marker: the preview hands the closed tube\'s room to the marker it draws', () => {
  const P = require('../preview/preview.js'), arrays = [];
  const gl = new Proxy({ VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, DYNAMIC_DRAW: 17, STREAM_DRAW: 18,
    COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13, BLEND: 14, LINES: 15,
    getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    getUniformLocation: (p, n) => n, getAttribLocation: () => 0, bufferData: (t, data) => { if (data instanceof Float32Array) arrays.push(data); } },
  { get: (t, k) => (k in t ? t[k] : () => {}) });
  let q = [];
  const win = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {}, step() { const f = q; q = []; for (const g of f) g(16); } };
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  const mastOf = (segments) => {
    arrays.length = 0;
    const shell = { getState: () => ({ resolved: { segments, closed: false } }), subscribe: () => () => {} };
    const p = P.createPreview({ canvas, shell, win }); win.step();
    const mk = arrays.filter((a) => a.length === 42);   // the marker: mast (2) + cross (4) + ring (8) points
    assert.ok(mk.length, 'the marker was drawn');
    const a = mk[mk.length - 1]; return Math.hypot(a[3] - a[0], a[4] - a[1], a[5] - a[2]);
  };
  const w = 31, R = w / (2 * Math.PI), seg = (id, profile) => ({ id, kind: 'road', length: 40, profile });
  const closed = mastOf([seg('a', tube(w, 360)), seg('b', tube(w, 360))]);
  assert.ok(closed <= 0.9 * 2 * R + 1e-3, `in a closed ${w} m tube the mast is ${closed} m (the roof is ${2 * R} m)`);
  const open = mastOf([seg('a', { u: [-15, 0, 15], psi: [0.27, 0, 0.27] }), seg('b', { u: [-15, 0, 15], psi: [0.27, 0, 0.27] })]);
  assert.ok(open >= 10 - 1e-3, `on an open road the mast keeps its full height (${open} m)`);
});

// ── the validation words ──
test('xsec validation words: the tube-too-narrow and roll-rate reds read in plain words, the id in the tooltip', () => {
  for (const id of ['tube-too-narrow', 'roll-rate']) {
    const f = VL.findingLine('red', { reason: id, s0: 10, s1: 40 });
    assert.ok(!/no description yet/.test(f.text), `${id} has no words`);
    assert.ok(!f.text.includes(id), `${id}: the shown line carries the id`);
    assert.ok(f.title.includes(id), `${id}: the tooltip keeps the id`);
  }
  // the corrected minimum (the librarian's RULING 1 corrected, A's TUBE_MIN_W at 9f92a324): the words say 9.74 m, not the first 9.43
  assert.match(VL.reasonText('tube-too-narrow'), /narrower than 9\.74 m/);
});

// ── the webview ──
test('xsec the panel loads in the webview loader with no node built-in (D186)', async () => {
  const { loadCjs } = require('../lib/cjs.js'), REPO = path.join(__dirname, '..', '..');
  const P = await loadCjs('app/core/panel.js', async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));
  assert.equal(typeof P.extendOptions, 'function');
  assert.equal(P.extendOptions({ length: 10, edge: '5' }).targets[E], 5);
});
