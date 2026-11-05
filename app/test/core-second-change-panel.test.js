// core-second-change-panel.test.js: node --test app/test/core-second-change-panel.test.js
// L139 (the user, 2026-11-05: "We could just build the second move feature before. Remember its more than just the banking, its the turns, climb, etc."; 06:43: "each one
// needs to carry the same color of the original move, but it has be like around somewhere on the piece that makes sense"; 06:49: "what if i want the climb to change more
// than once per piece, the same with turns?"; 06:53: "more and more room keeps getting made inbetween, giving room for the next drag icon to show itself to allow the next
// manipulation"). THE PANEL HALF (pane C; the core is B's, branch l139-second-change). Plan: exo_memory/loop/plan_l139_second_change_every_field_2026-11-05.md and its three
// amendments; E's rows O1–O3: exo_memory/loop/l139_registration_2026-11-05.md (29d95192).
//   - each of turn, climb, bank, width, cup, left and right edge has a list of later changes (then, from, remove), right after its row, off while it has no target;
//   - the options carry changes: { <channel>: [{ from, target }, …] } and, as corners, changes.turnDeg / climbDeg: [{ from, deg }, …] (B's names, 06:5x);
//   - a change is made in the 3D view by dragging an OFFER, one fainter handle per field that shows when the stretch after its last change has room (form (ii):
//     R ≥ 2·SECOND_FLOOR_M, at the middle of R); a mark per change, in the field's handle colour, dragged along the piece to move its from;
//   - every number is the core's (secondMinM, SECOND_FLOOR_M in src/core/extend.js), reaching the panel through the shell (shell.secondMinM, shell.secondFloorM:
//     the panel may not require src/core/extend.js, which pulls node's fs); stubbed ON THE SHELL where a row names it, never copied here.
// The REAL core, with its call observed at the shell (a spy on shell.extend).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const ST = require('../core/secondtick.js');
const HD = require('../core/handles.js');
const DEG = Math.PI / 180;

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
  get isConnected() { return false; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
  // a pointer event on this element: capture listeners first, then the rest, until one stops it
  fire(type, init) { let stopped = false; const ev = { type, ...init, preventDefault() {}, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; } };
    const ls = (this.listeners[type] || []).slice(), order = ls.filter((l) => l.capture).concat(ls.filter((l) => !l.capture));
    for (const l of order) { if (stopped) break; l.f(ev); } }
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
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  const calls = [], real = shell.extend; shell.extend = (o) => { calls.push(o); return real(o); };
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => { const l = label(text); assert.ok(l, `the panel has no "${text}" field`); return l.children[1]; };
  const byAria = (a) => { const f = root.all().find((e) => e.attrs && e.attrs['aria-label'] === a); assert.ok(f, `no element labelled "${a}"`); return f; };
  const has = (a) => !!root.all().find((e) => e.attrs && e.attrs['aria-label'] === a);
  const set = (f, v) => { f.value = String(v); f.oninput(); };
  const type = (text, v) => set(field(text), v);
  const thn = (k, i = 1) => byAria(`then ${k} ${i}`), from = (k, i = 1) => byAria(`${k} from ${i}`);
  // (thn, not then: an object with a then is a thenable, and await mountPanel() would call it)
  // a change as the offer's drag makes it (panel.secondAdd is what secondOffer calls on a drag's first movement)
  const add = (k, then = '', from = '', share = null) => panel.secondAdd(KEY[k], { then: String(then), from: String(from), share });
  const turnAs = root.all().find((e) => e.tagName === 'SELECT' && e.attrs['aria-label'] === 'turn and climb as');
  const button = (text) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  type('length m', 100);
  return { doc, win, root, shell, panel, label, field, byAria, has, set, type, thn, from, add, turnAs, calls, extend: () => button('Extend').onclick(), opts: () => panel.options() };
}
const KEY = { turn: 'turn', climb: 'climb', bank: 'bank', width: 'width', cup: 'cup', 'left edge': 'edge', 'right edge': 'edgeR' };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a}, not ${b} (±${tol})`);
const FIELDS = [['turn', 'turn °'], ['climb', 'climb °'], ['bank', 'bank °'], ['width', 'width m'], ['cup', 'cup °'], ['left edge', 'left edge °'], ['right edge', 'right edge °']];
// the core's numbers, stubbed on the SHELL where the panel reads them (shell.secondMinM, shell.secondFloorM: B's exports passed through), and put back after
function withCore(p, { min, floor } = {}, body) {
  const sh = p.shell, keep = { min: [Object.prototype.hasOwnProperty.call(sh, 'secondMinM'), sh.secondMinM], floor: [Object.prototype.hasOwnProperty.call(sh, 'secondFloorM'), sh.secondFloorM] };
  if (min !== undefined) sh.secondMinM = min; else delete sh.secondMinM;
  if (floor !== undefined) sh.secondFloorM = () => floor; else delete sh.secondFloorM;
  try { return body(); } finally {
    if (keep.min[0]) sh.secondMinM = keep.min[1]; else delete sh.secondMinM;
    if (keep.floor[0]) sh.secondFloorM = keep.floor[1]; else delete sh.secondFloorM;
  }
}

test('L139 S1: every field (turn, climb, bank, width, cup, left and right edge) has its list of changes right after its row; each change is a numbered then/from row with a remove', async () => {
  const p = await mountPanel();
  const order = p.root.all().filter((e) => e.attrs && (e.tagName === 'LABEL' || / changes$/.test(e.attrs['aria-label'] || ''))).map((e) => (e.tagName === 'LABEL' ? e.children[0] && e.children[0].textContent : e.attrs['aria-label']));
  for (const [k, lab] of FIELDS) { const i = order.indexOf(lab); assert.ok(i >= 0, lab); assert.equal(order[i + 1], `${k} changes`, `${k}: its list right after its row (${order.slice(i, i + 3).join(' | ')})`); }
  assert.equal(p.has('then bank 1'), false, 'no change until one is made');
  p.type('bank °', 30); p.add('bank', 10); p.add('bank', 20); p.add('bank', 0);
  assert.ok(p.has('then bank 3') && p.has('bank from 3') && p.has('remove bank change 3'), 'three changes, three rows'); assert.equal(p.thn('bank', 2).attrs.type, 'number');
  p.byAria('remove bank change 2').onclick();
  assert.equal(p.has('then bank 3'), false, 'removed one: two left'); assert.equal(p.thn('bank', 2).value, '0', 'renumbered'); assert.equal(p.thn('bank', 1).value, '10');
  p.panel.unmount();
});

test('L139 S2: a field\'s rows are off, and not sent, while it has no target; on again with one', async () => {
  const p = await mountPanel();
  const shownW = p.field('width m').value;
  p.type('width m', 40); p.add('width', 30, 50);
  assert.equal(p.thn('width').disabled, false); assert.deepEqual(p.opts().changes.w, [{ from: 50, target: 30 }]);
  p.type('width m', shownW);
  assert.equal(p.thn('width').disabled, true, 'back to what it shows: off'); assert.equal(p.from('width').disabled, true); assert.equal('changes' in p.opts(), false, 'and not sent');
  p.type('width m', 41); assert.equal(p.thn('width').disabled, false, 'a target again: on');
  p.panel.unmount();
});

test('L139 S3: a dragged change keeps its share of the piece (lengthen: the marks spread apart); a typed from stays metres; a cleared one is laid by the rule', async () => {
  const p = await mountPanel();
  withCore(p, { min: () => 100 }, () => {
    p.type('length m', 1000); p.type('bank °', 30); p.add('bank', 0, 400, 0.4); p.add('bank', 20, 700, 0.7);
    p.type('length m', 2000);
    assert.equal(p.from('bank', 1).value, '800', 'its share: 40% of 2000'); assert.equal(p.from('bank', 2).value, '1400', '70%: the two spread apart');
    p.set(p.from('bank', 1), 500); p.type('length m', 1000);
    assert.equal(p.from('bank', 1).value, '500', 'typed: metres, it stays'); assert.equal(p.from('bank', 2).value, '700', 'the dragged one keeps its share');
    p.set(p.from('bank', 1), '');
    assert.equal(p.from('bank', 1).value, '800', 'cleared: laid by the rule, 1000 − the two segments\' 100 + 100'); assert.equal(p.opts().changes.phi[0].from, 800);
    p.type('length m', 900); assert.equal(p.from('bank', 1).value, '700', 'and it follows the piece');
  });
  p.panel.unmount();
});

test('L139 S4: the options carry each field\'s list in the core\'s units; as corners, his snake (+60 −60 +60) is turnDeg plus changes.turnDeg', async () => {
  const p = await mountPanel();
  p.turnAs.value = 'rate'; p.turnAs.onchange();
  p.type('length m', 1000); p.type('bank °', 30); p.type('turn °/100m', 10); p.type('width m', 30); p.type('cup °', 20); p.type('left edge °', 5); p.type('right edge °', 6);
  withCore(p, {}, () => {
    p.add('bank', 0, 700); p.add('turn', -10, 550); p.add('turn', 10, 800); p.add('width', 40, 600); p.add('cup', 30, 610); p.add('left edge', 0, 620); p.add('right edge', 1, 630);
    const c = p.opts().changes;
    assert.deepEqual(c.phi, [{ from: 700, target: 0 }], 'bank: rad');
    assert.equal(c.kh.length, 2); near(c.kh[0].target, -10 * DEG / 100, 1e-15, 'turn as a rate: rad/m'); assert.equal(c.kh[0].from, 550); near(c.kh[1].target, 10 * DEG / 100, 1e-15); assert.equal(c.kh[1].from, 800);
    assert.deepEqual(c.w, [{ from: 600, target: 40 }], 'width: m'); assert.deepEqual(c.c, [{ from: 610, target: 30 }], 'cup: degrees');
    assert.deepEqual(c.e, [{ from: 620, target: 0 }]); assert.deepEqual(c.er, [{ from: 630, target: 1 }]);
    assert.equal('kv' in c, false, 'no climb target: no climb list'); assert.equal('second' in p.opts(), false, 'the list key, not L135\'s second');
    p.extend(); assert.deepEqual(p.calls.at(-1).changes, c, 'shell.extend is called with all of it');
  });
  p.panel.unmount();
  const q = await mountPanel();   // corners (the default)
  q.type('length m', 900); q.type('turn °', 60); q.add('turn', -60); q.add('turn', 60);
  const o = withCore(q, {}, () => q.opts());
  assert.equal(o.turnDeg, 60, 'the first corner as before'); assert.deepEqual(o.changes.turnDeg, [{ from: 300, deg: -60 }, { from: 600, deg: 60 }], 'two more corners, untyped marks splitting the piece in three');
  assert.equal('kh' in o.changes, false, 'corners are not rates');
  q.panel.unmount();
});

test('L139 S5: every minimum is the core\'s secondMinM, asked per segment with its two targets (no number copied); none exported → 85%; never before an early first ramp ends', () => {
  const base = { length: 400, turn: '', climb: '', width: '', cup: '', turnAs: 'rate' }, seen = [];
  const o = extendOptions({ ...base, bank: '30', turn: '10', changes: { bank: [{ then: '0', from: '' }], turn: [{ then: '-10', from: '' }] }, secondMinM: (ch, a, b) => { seen.push([ch, a, b]); return ch === 'kh' ? 150 : 100; } });
  assert.equal(o.changes.phi[0].from, 300, 'bank: min(340, 400 − 100)'); assert.equal(o.changes.kh[0].from, 250, 'turn: min(340, 400 − 150)');
  const kh = seen.find(([ch]) => ch === 'kh'); near(kh[1], 10 * DEG / 100, 1e-15, 'asked with the first target'); near(kh[2], -10 * DEG / 100, 1e-15, 'and the change\'s, in its own units');
  const two = extendOptions({ ...base, length: 1000, bank: '30', changes: { bank: [{ then: '0', from: '' }, { then: '20', from: '' }] }, secondMinM: () => 100 });
  assert.deepEqual(two.changes.phi.map((x) => x.from), [800, 900], 'two untyped: the first leaves room for both segments, the second right after it');
  const none = extendOptions({ ...base, bank: '30', changes: { bank: [{ then: '0', from: '' }] } });
  assert.equal(none.changes.phi[0].from, 340, 'no secondMinM given (a shell without it): 85%, nothing invented');
  const early = extendOptions({ ...base, length: 300, turn: '10', atStart: { turn: true }, changes: { turn: [{ then: '-10', from: '' }] }, secondMinM: () => 20 });
  assert.ok(early.changes.kh[0].from >= early.transition.kh, `never before the early turn's own ramp ends (${early.changes.kh[0].from} vs ${early.transition.kh})`);
  assert.equal('changes' in extendOptions({ ...base, bank: '30' }), false, 'no change: the options as before');
});

test('L139 S6: Undo gives back every field\'s list (count, values, shares, typed froms); a new document clears them all', async () => {
  const p = await mountPanel();
  withCore(p, {}, () => {
    p.type('length m', 1000); p.type('bank °', 30); p.add('bank', 0, 600, 0.6); p.add('bank', 10, 800, 0.8);
    p.type('width m', 40); p.add('width', 30, 650); p.extend();
    p.type('length m', 500); p.type('bank °', -20); p.add('bank', 10, 400, 0.8); p.extend();
    p.shell.undo();
    assert.equal(p.thn('bank').value, '10'); assert.equal(p.has('then bank 2'), false, 'the undone piece had one bank change'); assert.equal(p.has('then width 1'), false, 'and no width change');
    p.shell.undo();
    assert.equal(p.thn('bank', 1).value, '0'); assert.equal(p.thn('bank', 2).value, '10', 'two bank changes back'); assert.equal(p.from('width').value, '650', 'the typed width from');
    p.type('length m', 2000); assert.equal(p.from('bank', 2).value, '1600', 'its share came back with it'); assert.equal(p.from('width').value, '650', 'and the typed one is still metres');
    p.shell.newDoc();
    for (const [k] of FIELDS) assert.equal(p.has(`then ${k} 1`), false, `${k} cleared`);
  });
  p.panel.unmount();
});

test('L139 S7: one mark per change, in its field\'s handle colour (handles.js) and place across the road', async () => {
  const p = await mountPanel();
  assert.deepEqual(p.panel.marksAt(), [], 'no change: no marks');
  withCore(p, {}, () => {
    p.type('length m', 1000); p.type('width m', 20); p.type('bank °', 30); p.add('bank', 0, 700); p.type('climb °', 4); p.add('climb', 0, 800);
    p.type('turn °', 90); p.add('turn', -90, 550); p.add('turn', 90, 900);
    const m = p.panel.marksAt(), of = (f, i) => m.find((x) => x.field === f && x.index === i);
    assert.equal(m.length, 4, 'bank, climb and two turns');
    assert.equal(of('bank', 0).from, 700); assert.equal(of('turn', 0).from, 550); assert.equal(of('turn', 1).from, 900); assert.equal(of('climb', 0).from, 800);
    assert.equal(of('bank', 0).colour, HD.KINDS.bank.colour); assert.equal(of('turn', 1).colour, HD.KINDS.turn.colour); assert.equal(of('climb', 0).colour, HD.KINDS.climb.colour);
    assert.equal(of('bank', 0).lat, HD.KINDS.bank.lat); assert.equal(of('climb', 0).lat, HD.KINDS.climb.lat); assert.ok(of('bank', 0).half > 0);
  });
  p.panel.unmount();
});

// the ghost: a straight 750 m piece from s0 = 100, along +z, L = +x
function ghostOf(s0 = 100, len = 750) { const samples = []; for (let s = s0; s <= s0 + len + 1e-9; s += 2) samples.push({ s, pos: [0, 0, s], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] }); return { s0, samples, segments: [], jump: false }; }
const POSE = { eye: [0, 120, 600], target: [0, 0, 760], up: [0, 1, 0], fov: Math.PI / 3 };
const M = require('../camera/math.js');
const onScreen = (p) => { const c = M.apply(M.viewProj(POSE, 900 / 600), p); return { x: (c[0] / c[3] * 0.5 + 0.5) * 900, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * 600 }; };

test('L139 S8: a mark is short strokes across the road at its field\'s place: bank on both edges, climb at the centre, cup at ±0.3, turn outside and width inside the edge', () => {
  const g = ghostOf(), W = 900, H = 600, mk = (field, from = 600) => ST.markStroke(g, { field, index: 0, from, half: 10, ...ST.styleOf(field) }, POSE, W, H);
  const bank = mk('bank'), climb = mk('climb'), cup = mk('cup'), turn = mk('turn'), width = mk('width'), le = mk('edge'), re = mk('edgeR');
  assert.equal(bank.strokes.length, 2, 'bank: both edges'); assert.equal(climb.strokes.length, 1, 'climb: the centre'); assert.equal(cup.strokes.length, 2);
  assert.equal(le.strokes.length, 1, 'left edge: its own side'); assert.equal(re.strokes.length, 1);
  const mid = (st) => ({ x: (st.a.x + st.b.x) / 2, y: (st.a.y + st.b.y) / 2 }), sx = (m) => m.strokes.map((st) => mid(st).x).sort((a, b) => a - b);
  const [bl, br] = sx(bank), [tl, tr] = sx(turn), [wl, wr] = sx(width), [cl, cr] = sx(cup), [c0] = sx(climb);
  assert.ok(tl < bl - 4 && tr > br + 4, `turn stands outside the edge (${tl} ${bl} / ${tr} ${br})`); assert.ok(wl > bl + 4 && wr < br - 4, `width inside (${wl} ${bl} / ${wr} ${br})`);
  assert.ok(cl > wl && cr < wr && Math.abs(c0 - (bl + br) / 2) < 1, `cup between, climb in the middle (${cl} ${c0} ${cr})`);
  for (const st of bank.strokes) { const len = Math.hypot(st.b.x - st.a.x, st.b.y - st.a.y); assert.ok(len > 8 && len < 30, `a short stroke (${len} px)`); }
  assert.equal(ST.styleOf('bank').colour, HD.KINDS.bank.colour); assert.equal(ST.styleOf('width').colour, HD.KINDS.width.colour);
  assert.equal(ST.markStroke(g, { field: 'bank', index: 0, from: 900, half: 10, ...ST.styleOf('bank') }, POSE, W, H), null, 'a from past the piece: no mark');
  assert.equal(ST.markStroke({ ...g, jump: true }, { field: 'bank', index: 0, from: 600, half: 10, ...ST.styleOf('bank') }, POSE, W, H), null, 'a jump\'s ghost: no mark');
});

function layerOn(items, hooks) {
  const { doc, win } = fakeWindow(); const stage = doc.createElement('div'); stage.clientWidth = 900; stage.clientHeight = 600;
  const g = ghostOf(); doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(g)); doc.addEventListener('t180:view', (e) => e.detail.reply({ pose: POSE }));
  let under = 0; stage.addEventListener('pointerdown', () => { under++; });   // the panel's own handler (handles, picking), registered first
  const layer = ST.mount(stage, win, () => items, hooks); layer.drawNow();
  return { stage, layer, under: () => under };
}

test('L139 S9: a mark is dragged along the piece: the press on it is taken from the handles beneath, each move gives that change the nearest station, the release ends it', () => {
  const got = []; let ended = 0;
  const L = layerOn({ marks: [{ field: 'bank', index: 1, from: 600, half: 10, ...ST.styleOf('bank') }], offers: [] }, { onMarkDrag: (m, from) => got.push([m.field, m.index, from]), onDragEnd: () => { ended++; } });
  const st = L.layer.marks()[0].strokes[0], at = { x: (st.a.x + st.b.x) / 2, y: (st.a.y + st.b.y) / 2 };
  L.stage.fire('pointerdown', { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });
  assert.equal(L.under(), 0, 'the press on a mark does not reach the handles beneath');
  const to = onScreen([10, 0, 800]); L.stage.fire('pointermove', { clientX: to.x, clientY: to.y, pointerId: 1 });
  assert.equal(got.length, 1); assert.deepEqual(got[0].slice(0, 2), ['bank', 1]); near(got[0][2], 700, 1.01, 'the nearest station, as metres from the piece start (z 800, in front of the camera)');
  L.stage.fire('pointerup', { clientX: to.x, clientY: to.y, pointerId: 1 }); assert.equal(ended, 1);
  L.stage.fire('pointerdown', { clientX: 5, clientY: 5, pointerId: 2, button: 0 }); assert.equal(L.under(), 1, 'a press off every mark goes on to the handles');
  L.layer.unmount();
});

test('L139 S10: in the panel a mark drag sets that change\'s from (as its share) and nothing else; one Ctrl+Z (the undo guard) puts it back', async () => {
  const p = await mountPanel();
  withCore(p, {}, () => {
    p.type('length m', 1000); p.type('bank °', 30); p.add('bank', 0, 850, 0.85); p.type('width m', 40); p.add('width', 30, 850, 0.85);
    p.panel.secondDrag({ field: 'bank', index: 0 }, 640.4);
    assert.equal(p.from('bank').value, '640.4'); assert.equal(p.from('width').value, '850', 'width untouched'); assert.equal(p.opts().changes.phi[0].from, 640.4);
    p.panel.secondDrag({ field: 'bank', index: 0 }, 600);   // the same drag, moved on
    let handled = false; p.doc.dispatchEvent(new p.win.CustomEvent('t180-undo-guard', { detail: { handled: () => { handled = true; } } }));
    assert.equal(handled, true, 'the guard took the key'); assert.equal(p.from('bank').value, '850', 'the whole drag undone, back where it started');
  });
  p.panel.unmount();
});

// E's rows (l139_registration addendum "offers appear by room", 29d95192), form (ii): an offer shows once the free stretch R ≥ 2·floor and stands at its middle
const offersOf = (p, f) => p.panel.offersAt().filter((o) => o.field === f);
test('L139 O1: a field\'s offer shows exactly when its free stretch reaches 2·SECOND_FLOOR_M, at the stretch\'s middle; again after each change; never without a target; one per field', async () => {
  const p = await mountPanel();
  withCore(p, { floor: 20, min: () => 30 }, () => {
    p.type('bank °', 30);
    p.type('length m', 39.9); assert.equal(offersOf(p, 'bank').length, 0, 'below 2·floor: no offer');
    p.type('length m', 40); assert.equal(offersOf(p, 'bank').length, 1, 'at 2·floor: it shows'); assert.equal(offersOf(p, 'bank')[0].from, 20, 'at the middle of the stretch');
    const o = offersOf(p, 'bank')[0]; assert.equal(o.offer, true); assert.equal(o.colour, HD.KINDS.bank.colour, 'in its field\'s colour'); assert.equal(o.lat, HD.KINDS.bank.lat, 'at its place across');
    p.type('length m', 200); p.add('bank', 0, 100);
    p.type('length m', 169.9); assert.equal(offersOf(p, 'bank').length, 0, 'after a change at 100 with a 30 m segment: the stretch is L − 130, under 40');
    p.type('length m', 170); assert.equal(offersOf(p, 'bank').length, 1, 'at 170 it shows again'); assert.equal(offersOf(p, 'bank')[0].from, 150, 'at 130 + 40/2'); assert.equal(offersOf(p, 'bank')[0].index, 1, 'the second change');
    assert.equal(offersOf(p, 'width').length, 0, 'no width target: no offer');
    assert.ok(p.panel.offersAt().every((x, i, a) => a.findIndex((y) => y.field === x.field) === i), 'at most one offer per field');
  });
  const none = withCore(p, { min: () => 30 }, () => p.panel.offersAt());
  assert.deepEqual(none, [], 'a shell with no secondFloorM: no offers (the panel invents no floor)');
  p.panel.unmount();
});

test('L139 O2: shortening hides the offer at the same length lengthening showed it, with no lingering step', async () => {
  const p = await mountPanel();
  withCore(p, { floor: 20, min: () => 30 }, () => {
    p.type('bank °', 30);
    const seen = []; for (const L of [41, 40.1, 40, 39.9, 39.8, 39.9, 40, 40.1]) { p.type('length m', L); seen.push([L, offersOf(p, 'bank').length]); }
    assert.deepEqual(seen.map(([, n]) => n), [1, 1, 1, 0, 0, 0, 1, 1], `shown from 40 up, both ways: ${JSON.stringify(seen)}`);
  });
  p.panel.unmount();
});

test('L139 O3: dragging an offer makes exactly one change, from the offer\'s place, its then where the drag reached; a press with no movement makes none; one Ctrl+Z removes it; the document is untouched', async () => {
  // the layer: the offer's drag is the field's handle maths
  const got = []; let moved = null;
  const offer = { field: 'bank', index: 0, from: 700, half: 10, offer: true, base: 30, ...ST.styleOf('bank') };
  const L = layerOn({ marks: [], offers: [offer] }, { onOfferDrag: (o, v) => got.push([o.field, v]), onDragEnd: (o, m) => { moved = m; } });
  const at = L.layer.offers()[0].at;
  L.stage.fire('pointerdown', { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 }); L.stage.fire('pointerup', { clientX: at.x, clientY: at.y, pointerId: 1 });
  assert.equal(got.length, 0, 'a press and release with no movement: nothing'); assert.equal(moved, false); assert.equal(L.under(), 0, 'and the press was the offer\'s');
  L.stage.fire('pointerdown', { clientX: at.x, clientY: at.y, pointerId: 2, button: 0 }); L.stage.fire('pointermove', { clientX: at.x, clientY: at.y - 40, pointerId: 2 });
  assert.equal(got.length, 1); assert.equal(got[0][0], 'bank'); assert.ok(got[0][1] > 30, `dragged up, the bank grows from its base of 30 (${got[0][1]})`);
  L.layer.unmount();
  // the panel: one drag = one new change, the rest untouched, the document the same object until Extend
  const p = await mountPanel();
  withCore(p, { floor: 20, min: () => 30 }, () => {
    p.type('length m', 1000); p.type('bank °', 30); p.type('width m', 40); p.add('width', 30, 700, 0.7);
    const doc0 = p.shell.getState().history.present, w0 = JSON.stringify(p.opts().changes.w);
    const o = offersOf(p, 'bank')[0]; assert.equal(o.from, 500, 'the bank\'s offer: the middle of its 1000 m stretch');
    p.panel.secondOffer(o, 40); p.panel.secondOffer(o, 45);   // one drag, two moves
    assert.deepEqual(p.opts().changes.phi, [{ from: 500, target: 45 * DEG }], 'exactly one change, at the offer, with the value the drag reached');
    assert.equal(JSON.stringify(p.opts().changes.w), w0, 'width\'s list unchanged'); assert.equal(p.shell.getState().history.present, doc0, 'the document untouched until Extend');
    let handled = false; p.doc.dispatchEvent(new p.win.CustomEvent('t180-undo-guard', { detail: { handled: () => { handled = true; } } }));
    assert.equal(handled, true); assert.equal(p.has('then bank 1'), false, 'one Ctrl+Z: the change is gone'); assert.equal('phi' in (p.opts().changes || {}), false);
  });
  p.panel.unmount();
});
