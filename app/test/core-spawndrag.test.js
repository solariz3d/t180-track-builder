// core-spawndrag.test.js: node --test app/test/core-spawndrag.test.js
// D285 part 1: DRAG THE START ON THE PREVIEW (the keeper, 06:11: "click the hotlap spawn and move it by mouse … click dragging the start line and then the pack of cars at the start line
// too"). FEEL tier: rows and fake hosts, no real window. The real shell, the real panel (app/core/panel.js mounts app/core/spawndrag.js on the stage) and the real exporter, on a
// closed bowl lap; the stage is a fake that fires pointer events capture-first like a browser, so "the camera never sees the press" is a row and not a hope.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { createCoreShell } = require('../core/coreshell.js');
const { makeExporter } = require('../export/export.js');
const D = require('../../src/core/document.js');
const M = require('../camera/math.js');
const SPD = require('../core/spawndrag.js');
const SPL = require('../core/spawnslayer.js');
const { gridSlots } = require('../../src/markers/layout.js');

const REPO = path.resolve(__dirname, '..', '..');
const R = 180, Q = Math.PI * R / 2, W = 900, H = 600;
let EX = null;

class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.parent = null; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f, cap) { (this.listeners[e] = this.listeners[e] || []).push({ f, cap: !!cap }); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x.f !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth || 0, height: this.clientHeight || 0 }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return !!e.isRoot; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}
function fakeWindow() {
  const frames = [], doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {}, locks: 0 };
  doc.defaultView = win;
  return { doc, win, tick: () => { for (const f of frames.splice(0)) f(0); } };
}

/** The pose that looks straight down at path distance s0 of the first piece from `h` metres up, the road running up the screen. */
function poseOver(P, s0, h) {
  const m = P.path.samples.reduce((a, b) => (Math.abs(b.s - s0) < Math.abs(a.s - s0) ? b : a));
  return { eye: [m.pos[0] - m.T[0] * 0.5, m.pos[1] + h, m.pos[2] - m.T[2] * 0.5], target: m.pos.slice(), up: [m.T[0], 0, m.T[2]], fov: 60 * Math.PI / 180 };
}

async function mounted({ build = null, pose = null, hAbove = 60, at = 250 } = {}) {
  EX = EX || await makeExporter(async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));
  const { doc, win, tick } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = W; stage.clientHeight = H; stage.isRoot = true;
  stage.setPointerCapture = () => { win.captured = (win.captured || 0) + 1; };
  const root = doc.createElement('div'), s = await createCoreShell({ brushFn: null, exporter: EX });
  if (build) build(s); else {
    s.extend({ length: 300, family: 'bowl' });
    for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
    s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
    s.close();
  }
  const P0 = s.spawnsPath(), view = { pose: pose || poseOver(P0, at, hAbove) };
  doc.addEventListener('t180:view', (ev) => ev.detail.reply(view));
  const bubbled = [];
  stage.addEventListener('pointerdown', (e) => bubbled.push(e), false);   // what the camera and the piece picking would see
  const panel = require('../core/panel.js').mount(root, s);
  tick();
  const VP = () => M.viewProj(view.pose, W / H);
  const px = (p) => { const c = M.apply(VP(), p); return { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H }; };
  const fire = (type, x, y, extra = {}) => {
    const ev = { type, button: 0, pointerId: 1, clientX: x, clientY: y, stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    const L = (stage.listeners[type] || []).slice(); for (const phase of [true, false]) for (const l of L) { if (ev.stopped) break; if (l.cap === phase) l.f(ev); }
    return ev;
  };
  const by = (aria) => root.all().find((e) => e.attrs['aria-label'] === aria);
  const info = () => s.spawnsInfo({ auto: true }), mk = (name) => info().placed.find((m) => m.name === name);
  const spawns = () => s.getState().history.present.spawns, past = () => s.getState().history.past.length;
  const drag = (from, to, { steps = 4 } = {}) => {
    const d = fire('pointerdown', from.x, from.y);
    for (let i = 1; i <= steps; i++) { fire('pointermove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); tick(); }
    fire('pointerup', to.x, to.y); tick();
    return d;
  };
  return { s, root, panel, doc, win, stage, tick, view, px, fire, by, info, mk, spawns, past, drag, bubbled, P: () => s.spawnsPath(), EX };
}
/** The screen point of a world point on the road at path distance s. */
const atS = (T, s) => { const m = T.P().path.samples.reduce((a, b) => (Math.abs(b.s - s) < Math.abs(a.s - s) ? b : a)); return T.px(m.pos.map((v, k) => v + m.T[k] * (s - m.s))); };
/** The screen point of world point `p` slid `N` metres along the road (where a hand that holds p and follows the road to N metres on puts the pointer). */
const slide = (T, p, N) => { const m = T.P().path.samples.reduce((a, b) => (Math.hypot(b.pos[0] - p[0], b.pos[2] - p[2]) < Math.hypot(a.pos[0] - p[0], a.pos[2] - p[2]) ? b : a)); return T.px(p.map((v, k) => v + m.T[k] * N)); };
const gateWorld = (T) => { const L = onRoad(T.mk('AC_TIME_0_L')), Rr = onRoad(T.mk('AC_TIME_0_R')); return L.map((v, k) => (v + Rr[k]) / 2); };
const onRoad = (m) => m.surface || m.pos;   // the marks are drawn where the road is, the marker itself sits above it
const gate = (T) => { const L = onRoad(T.mk('AC_TIME_0_L')), Rr = onRoad(T.mk('AC_TIME_0_R')); return T.px(L.map((v, k) => (v + Rr[k]) / 2)); };

// ── the document: the pole gap ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('row 1: the pole gap is an optional spawns field: absent = the old 10 m and the same text as before; a number round-trips; nonsense is refused', async () => {
  const s = await createCoreShell({ brushFn: null });
  s.extend({ length: 300, family: 'bowl' });
  const base = s.getState().history.present, G = { count: 4, rowGapM: 16, colGapM: 6 };
  const plain = D.setSpawns(base, { line: { along: 100 }, grid: G });
  assert.equal(plain.spawns.grid.poleBackM, undefined, 'a block without it stays without it');
  assert.ok(!D.serialize(plain).includes('poleBackM'), 'and the file text has no new key: every track made before is the same text');
  const withPole = D.setSpawns(base, { line: { along: 100 }, grid: { ...G, poleBackM: 12.34 } });
  assert.equal(withPole.spawns.grid.poleBackM, 12.34, 'quantised to the centimetre the file keeps for the other metres');
  assert.equal(D.parse(D.serialize(withPole)).spawns.grid.poleBackM, 12.34, 'and read back');
  for (const bad of [0, -3, 250, '10', NaN]) assert.throws(() => D.setSpawns(base, { line: { along: 100 }, grid: { ...G, poleBackM: bad } }), /poleBackM/, `refused: ${String(bad)}`);
});

test('row 2: the pole gap is where the export puts the pole slot (and 10 m when the block has none)', async () => {
  const T = await mounted();
  T.s.setSpawns({ line: { along: 200 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } });
  assert.ok(Math.abs(T.mk('AC_TIME_0_L').s - T.mk('AC_START_0').s - 10) < 1e-6, 'no field: 10 m');
  T.s.setSpawns({ line: { along: 200 }, grid: { count: 4, rowGapM: 16, colGapM: 6, poleBackM: 25 } });
  assert.ok(Math.abs(T.mk('AC_TIME_0_L').s - T.mk('AC_START_0').s - 25) < 1e-6, 'with the field: that');
  const ex = T.s.buildExport().result.markers, at = (n) => ex.find((m) => m.name === n);
  assert.ok(Math.abs(at('AC_TIME_0_L').s - at('AC_START_0').s - 25) < 1e-6, 'the export writes it');
});

// ── the shell: a drag is one undo step ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('row 3: a start drag is ONE undo step; on an automatic track it first writes the automatic spawns ("start placed by hand"), inside the same step, and undo puts the track back to automatic', async () => {
  const T = await mounted(), n0 = T.past();
  assert.equal(T.spawns(), undefined, 'the track starts automatic');
  const was = T.mk('AC_TIME_0_L').s;
  T.s.beginSpawnsDrag();
  assert.match(T.s.getState().message, /start placed by hand/);
  assert.ok(T.spawns() && Math.abs(T.spawns().line.along - was) < 0.5, 'the automatic layout is what was written');
  for (const a of [210, 205, 190]) T.s.spawnsDragTo({ ...T.spawns(), line: { along: a } });
  assert.equal(T.past(), n0, 'nothing reached Undo while the drag is open');
  T.s.endSpawnsDrag();
  assert.equal(T.past(), n0 + 1, 'one step for the whole drag');
  assert.equal(T.spawns().line.along, 190);
  T.s.undo();
  assert.equal(T.spawns(), undefined, 'one Undo restores the automatic track (the conversion went with the drag)');
});

test('row 4: a drag that moved nothing leaves no undo step; a second drag cannot open inside the first; ending with none open is harmless', async () => {
  const T = await mounted(); T.s.setSpawns({ line: { along: 100 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } });
  const n0 = T.past();
  T.s.beginSpawnsDrag(); T.s.beginSpawnsDrag(); assert.match(T.s.getState().message, /already open/);
  T.s.endSpawnsDrag(); assert.equal(T.past(), n0, 'no movement: no step');
  assert.doesNotThrow(() => T.s.endSpawnsDrag());
  assert.match((T.s.spawnsDragTo({ line: { along: 5 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } }), T.s.getState().message), /no start drag is open/);
});

test('row 5: the automatic start on a LATER piece cannot be grabbed (a hand-placed line goes on the first piece): the press is taken, says why in words, and nothing changes', async () => {
  const T = await mounted({ at: 300, build: (s) => { s.extend({ length: 30, family: 'bowl' }); s.extend({ length: 300 }); for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 60, transition: 40, targets: { kh: 0 } }); s.close(); } });
  const P = T.P(); assert.match(P.error || '', /automatic start is on piece p2/, 'this track has its automatic start on the second piece: ' + JSON.stringify(P.error));
  assert.equal(T.spawns(), undefined); const n0 = T.past(); T.bubbled.length = 0;
  const down = T.fire('pointerdown', gate(T).x, gate(T).y);
  assert.ok(down.stopped && down.prevented && T.bubbled.length === 0, 'a press ON the line is still the line, not the camera: the camera does not take it');
  assert.match(T.s.getState().message, /first piece \(p1\)/); assert.equal(T.s.getState().spawnsDrag, null, 'no drag opened');
  T.fire('pointerup', gate(T).x, gate(T).y); assert.equal(T.past(), n0); assert.equal(T.spawns(), undefined, 'nothing was written');
});

// ── the pure parts ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('row 6: pickStation: the road under the pointer to a fraction of a metre (continuous, not stepped to the 2 m stations), limited to a stretch and to where the road is', async () => {
  const T = await mounted(), P = T.P(), VP = M.viewProj(T.view.pose, W / H);
  for (const s of [231.3, 250, 262.77, 281.01]) {
    const p = atS(T, s), got = SPD.pickStation(P.path, VP, W, H, p.x, p.y);
    assert.ok(Math.abs(got.s - s) < 0.2, `s ${s}: ${got.s}`);
  }
  const p = atS(T, 262.77), off = { x: p.x + 40, y: p.y };   // beside the road: the nearest point of it
  assert.ok(Math.abs(SPD.pickStation(P.path, VP, W, H, off.x, off.y).s - 262.77) < 3);
  const lim = SPD.pickStation(P.path, VP, W, H, atS(T, 290).x, atS(T, 290).y, { lo: 0, hi: 270 });
  assert.equal(lim.s, 270, 'clamped to the stretch');
  const gap = SPD.pickStation(P.path, VP, W, H, atS(T, 250).x, atS(T, 250).y, { inside: (s) => s > 260 });
  assert.ok(gap.s > 260, 'only where the filter holds');
  assert.equal(SPD.pickStation(P.path, M.viewProj({ eye: [0, 50, 9000], target: [0, 50, 9100], up: [0, 1, 0], fov: 1 }, 1.5), 900, 600, 450, 300), null, 'a view with none of it in front: null');
});

test('row 7: hitMarks: the line, a grid box, the hotlap and nothing; the hotlap beats a box and a box beats the line when the pointer is as near to both; pit boxes are not grabbed', async () => {
  const T = await mounted({ at: 270 }); T.s.setSpawns({ line: { along: 250 }, grid: { count: 4, rowGapM: 16, colGapM: 6 }, hotlap: { piece: 'p1', along: 60 } });
  const items = SPL.marks(T.info()), VP = M.viewProj(T.view.pose, W / H), hit = (p) => SPD.hitMarks(items, VP, W, H, p.x, p.y);
  assert.equal(hit(gate(T)).kind, 'line');
  const slot = items.find((i) => i.kind === 'grid' && i.label === '2'), c = slot.corners.map((q) => T.px(q)), mid = { x: c.reduce((a, q) => a + q.x, 0) / 4, y: c.reduce((a, q) => a + q.y, 0) / 4 };
  assert.deepEqual([hit(mid).kind, hit(mid).n], ['grid', 1]);
  assert.equal(hit({ x: 5, y: 5 }), null, 'empty sky');
  const pit = items.find((i) => i.kind === 'pit'), pc = pit && pit.corners.map((q) => T.px(q));
  if (pc) assert.notEqual((hit({ x: pc.reduce((a, q) => a + q.x, 0) / 4, y: pc.reduce((a, q) => a + q.y, 0) / 4 }) || {}).kind, 'pit');
  const hot = [{ kind: 'hotlap', label: 'HOTLAP', corners: slot.corners }, { kind: 'grid', label: '9', corners: slot.corners }, { kind: 'line', label: 'START', line: [slot.corners[0], slot.corners[1]] }];
  assert.equal(SPD.hitMarks(hot, VP, W, H, mid.x, mid.y).kind, 'hotlap');
  assert.equal(SPD.hitMarks(hot.slice(1), VP, W, H, mid.x, mid.y).kind, 'grid');
});

test('row 8: the maths: the line moves by the pointer\'s travel and is clamped to the first piece; the pack changes only the pole gap, clamped; the hotlap lands on the piece under the pointer', () => {
  const sp = { line: { along: 100 }, grid: { count: 6, rowGapM: 16, colGapM: 6 }, hotlap: { piece: 'a', along: 5 } };
  assert.equal(SPD.moveLine(sp, { along: 100, s: 100 }, 112.34, 300).line.along, 112.3);
  assert.equal(SPD.moveLine(sp, { along: 100, s: 100 }, 900, 300).line.along, 300, 'not past the end of the first piece');
  assert.equal(SPD.moveLine(sp, { along: 100, s: 100 }, -50, 300).line.along, 0, 'nor before its start');
  assert.deepEqual(SPD.moveLine(sp, { along: 100, s: 100 }, 130, 300).grid, sp.grid, 'the pack is not touched by moving the line: it is measured back from it');
  const back = SPD.movePack(sp, { pole: 10, back: 14 }, 80, 100, 1000, false);   // the pointer is 20 m behind the line, it was 14: the pole is 6 m further back
  assert.equal(back.grid.poleBackM, 16); assert.equal(back.grid.rowGapM, 16); assert.equal(back.grid.colGapM, 6); assert.equal(back.grid.count, 6); assert.deepEqual(back.line, sp.line);
  assert.equal(SPD.movePack(sp, { pole: 10, back: 14 }, 99, 100, 1000, false).grid.poleBackM, SPD.POLE_MIN_M, 'never closer than the pole car\'s nose a metre behind the line');
  assert.equal(SPD.movePack(sp, { pole: 10, back: 14 }, -500, 100, 1000, false).grid.poleBackM, SPD.POLE_MAX_M);
  assert.equal(SPD.backOf(10, 990, 1000, true), 20, 'on a closed lap the pointer just behind the seam is 20 m behind a line 10 m past it');
  assert.equal(SPD.backOf(10, 990, 1000, false), -980, 'on an open track it is not');
  const roads = [{ id: 'a', s0: 0, s1: 300 }, { id: 'b', s0: 300, s1: 580 }];
  assert.deepEqual(SPD.moveHotlap(sp, { delta: 0 }, 421.26, roads).hotlap, { piece: 'b', along: 121.3 });
  assert.deepEqual(SPD.moveHotlap(sp, { delta: 2 }, 100, roads).hotlap, { piece: 'a', along: 102 }, 'the grab offset is kept');
  assert.deepEqual(SPD.moveHotlap(sp, { delta: 0 }, 9999, roads).hotlap, { piece: 'b', along: 280 }, 'past the last road: its end');
});

// ── the drag on the preview ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('row 9: DRAG THE LINE +N m along the road: along moves by N (within 0.5 m), the world line follows, the panel\'s number follows while the drag is open, one Undo restores', async () => {
  const T = await mounted(); T.s.setSpawns({ line: { along: 200 }, grid: { count: 6, rowGapM: 16, colGapM: 6 } });
  const n0 = T.past(), from = gate(T);
  for (const N of [12, -30, 7.5]) {
    const a0 = T.spawns().line.along, down = T.fire('pointerdown', from.x, from.y); assert.ok(down.stopped && down.prevented, 'the press on the line is taken');
    const to = slide(T, gateWorld(T), N); T.fire('pointermove', to.x, to.y); T.tick();
    assert.ok(Math.abs(T.spawns().line.along - (a0 + N)) <= 0.5, `${N} m: along ${a0} -> ${T.spawns().line.along}`);
    assert.equal(T.by('start line metres into the first piece').value, String(T.spawns().line.along), 'the panel box follows while the button is still down');
    T.fire('pointerup', to.x, to.y); T.tick();
    assert.ok(Math.abs(T.mk('AC_TIME_0_L').s - T.P().first.s0 - T.spawns().line.along) < 1e-6, 'the world line is where the number says');
    T.s.setSpawns({ line: { along: 200 }, grid: { count: 6, rowGapM: 16, colGapM: 6 } });
  }
  const n1 = T.past(); T.drag(gate(T), slide(T, gateWorld(T), 35)); assert.equal(T.past(), n1 + 1, 'one drag, one step');
  const dragged = T.spawns().line.along; T.s.undo(); assert.equal(T.spawns().line.along, 200); assert.notEqual(dragged, 200);
  assert.ok(n0 >= 0);
});

test('row 10: the line cannot leave the first piece: dragged far past either end it stops at 0 and at the piece\'s length', async () => {
  const T = await mounted({ hAbove: 140, at: 150 }); T.s.setSpawns({ line: { along: 150 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } });
  const len = T.P().first.len;
  T.drag(gate(T), { x: gate(T).x, y: -5000 }); assert.equal(T.spawns().line.along, len, 'far ahead: the end of the piece');
  T.s.setSpawns({ line: { along: 150 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } });
  T.drag(gate(T), { x: gate(T).x, y: 9000 }); assert.equal(T.spawns().line.along, 0, 'far behind: the start of it');
});

test('row 11: DRAG THE PACK: any slot moves the whole pack along the road (only the pole gap changes), the two staggered columns and the spacing are kept, and the line stays', async () => {
  const T = await mounted({ at: 230 }); T.s.setSpawns({ line: { along: 280 }, grid: { count: 6, rowGapM: 16, colGapM: 6 } });
  const backs = () => { const L = T.mk('AC_TIME_0_L').s; return Array.from({ length: 6 }, (_, i) => L - T.mk(`AC_START_${i}`).s); };
  const before = backs(), line0 = T.spawns().line.along;
  const slot = T.mk('AC_START_3'), from = T.px(onRoad(slot)), N = 9;
  T.drag(from, slide(T, onRoad(slot), -N), { steps: 3 });
  const after = backs();
  assert.ok(Math.abs(T.spawns().grid.poleBackM - (10 + N)) <= 0.5, `the pole gap 10 -> ${T.spawns().grid.poleBackM}`);
  after.forEach((b, i) => assert.ok(Math.abs(b - before[i] - (T.spawns().grid.poleBackM - 10)) < 1e-6, `slot ${i} moved with the pack`));
  assert.deepEqual(after.map((b, i) => +(b - after[0]).toFixed(6)), before.map((b) => +(b - before[0]).toFixed(6)), 'the pack keeps its shape: every slot the same distance from pole');
  assert.equal(T.spawns().grid.rowGapM, 16); assert.equal(T.spawns().grid.colGapM, 6); assert.equal(T.spawns().line.along, line0, 'the line did not move');
  const cols = [0, 1, 2, 3].map((i) => T.mk(`AC_START_${i}`)), lat = (m) => m.pos.map((v, k) => v - T.mk('AC_START_0').pos[k]);
  assert.ok(cols.length === 4 && lat(cols[1]).some((v) => Math.abs(v) > 1), 'still two columns');
  T.s.undo(); assert.equal(T.spawns().grid.poleBackM, undefined, 'one Undo: back to the default gap');
});

test('row 12: dragging the pack toward the line stops a metre behind it, and the pack drags BOTH ways', async () => {
  const T = await mounted({ at: 240 }); T.s.setSpawns({ line: { along: 280 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } });
  const slot = T.mk('AC_START_0'), from = T.px(onRoad(slot));
  T.drag(from, atS(T, slot.s + 400), { steps: 2 });
  assert.equal(T.spawns().grid.poleBackM, SPD.POLE_MIN_M, 'past the line it holds at the closest the pole car may sit');
  const slot2 = T.mk('AC_START_0'); T.drag(T.px(onRoad(slot2)), slide(T, onRoad(slot2), -20), { steps: 2 });
  assert.ok(Math.abs(T.spawns().grid.poleBackM - (SPD.POLE_MIN_M + 20)) <= 1.5, `back again: ${T.spawns().grid.poleBackM}`);
});

test('row 13: dragging the LINE carries the pack with it: every slot keeps its distance behind the line', async () => {
  const T = await mounted({ at: 230 }); T.s.setSpawns({ line: { along: 250 }, grid: { count: 6, rowGapM: 16, colGapM: 6, poleBackM: 14 } });
  const rel = () => { const L = T.mk('AC_TIME_0_L').s; return Array.from({ length: 6 }, (_, i) => +(L - T.mk(`AC_START_${i}`).s).toFixed(6)); };
  const before = rel(), L0 = T.mk('AC_TIME_0_L').s;
  T.drag(gate(T), slide(T, gateWorld(T), 25), { steps: 3 });
  assert.ok(T.mk('AC_TIME_0_L').s > L0 + 20, 'the line moved'); assert.deepEqual(rel(), before, 'and the pack with it');
  assert.equal(T.spawns().grid.poleBackM, 14);
});

test('row 14: DRAG THE HOTLAP anywhere on the track: onto a later piece it sets that piece and the distance into it (and the world marker follows)', async () => {
  const T = await mounted({ hAbove: 900, at: 750 }); T.s.setSpawns({ line: { along: 250 }, grid: { count: 4, rowGapM: 16, colGapM: 6 }, hotlap: { piece: 'p1', along: 40 } });
  const hot = T.mk('AC_HOTLAP_START_0'), from = T.px(onRoad(hot)), P = T.P(), p3 = P.roads.find((r) => r.id === 'p3');
  const target = atS(T, p3.s0 + 100);
  T.drag(from, target, { steps: 5 });
  assert.equal(T.spawns().hotlap.piece, 'p3', JSON.stringify(T.spawns().hotlap));
  assert.ok(Math.abs(T.spawns().hotlap.along - 100) <= 4, `along ${T.spawns().hotlap.along} (a metre is ~1 px at this height)`);
  assert.ok(Math.abs(T.mk('AC_HOTLAP_START_0').s - (p3.s0 + T.spawns().hotlap.along)) < 1.5, 'the world marker is on the piece at that distance');
  T.s.undo(); assert.deepEqual(T.spawns().hotlap, { piece: 'p1', along: 40 }, 'one Undo puts it back');
});

test('row 15: the FIRST drag on an automatic track writes the spawns first ("start placed by hand") and the panel numbers show it; the TEST export and the panel read the dragged positions', async () => {
  const T = await mounted();
  assert.equal(T.spawns(), undefined); assert.equal(T.by('place the start by hand').checked, false);
  const L0 = T.mk('AC_TIME_0_L').s, n0 = T.past();
  T.fire('pointerdown', gate(T).x, gate(T).y);
  assert.ok(T.spawns(), 'the spawns exist as soon as the grab opens'); assert.equal(T.by('place the start by hand').checked, true, 'the panel shows it placed by hand');
  const to = slide(T, gateWorld(T), -14); T.fire('pointermove', to.x, to.y); T.tick(); T.fire('pointerup', to.x, to.y); T.tick();
  assert.equal(T.past(), n0 + 1, 'the conversion and the drag are one step');
  assert.ok(Math.abs(T.spawns().line.along - (L0 - 14)) <= 0.5);
  assert.equal(T.by('start line metres into the first piece').value, String(T.spawns().line.along), 'the panel box');
  assert.ok(Math.abs(T.mk('AC_TIME_0_L').s - (L0 - 14)) <= 0.5);
  const ex = T.s.buildExport().result.markers;
  assert.ok(Math.abs(ex.find((m) => m.name === 'AC_TIME_0_L').s - T.mk('AC_TIME_0_L').s) < 1e-6, 'the export writes the dragged line');
  T.s.undo(); assert.equal(T.spawns(), undefined, 'one Undo: automatic again');
});

test('row 16: the panel has the pole gap box: it shows 10 by default, takes a typed number (clamped), and follows a pack drag', async () => {
  const T = await mounted({ at: 230 }); T.s.setSpawns({ line: { along: 280 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } });
  assert.equal(T.by('pole gap: metres from the start line to the pole car').value, '10');
  const f = T.by('pole gap: metres from the start line to the pole car'); f.value = '22'; f.onchange();
  assert.equal(T.spawns().grid.poleBackM, 22);
  f.value = '1'; f.onchange(); assert.equal(T.spawns().grid.poleBackM, SPD.POLE_MIN_M, 'a typed gap is held to the closest the pole car may sit');
  const slot = T.mk('AC_START_0'); T.fire('pointerdown', T.px(onRoad(slot)).x, T.px(onRoad(slot)).y);
  const to = slide(T, onRoad(slot), -11); T.fire('pointermove', to.x, to.y); T.tick();
  assert.equal(f.value, String(T.spawns().grid.poleBackM), 'live while the button is down'); T.fire('pointerup', to.x, to.y);
});

test('row 17: NO POINTER LOCK, the camera never sees a press on a mark, and a press anywhere else is left alone', async () => {
  const T = await mounted({ at: 230 }); T.s.setSpawns({ line: { along: 280 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } });
  T.win.requestPointerLock = () => { T.win.locks++; }; T.stage.requestPointerLock = () => { T.win.locks++; };
  T.bubbled.length = 0;
  const on = T.fire('pointerdown', gate(T).x, gate(T).y);
  assert.ok(on.stopped && on.prevented); assert.equal(T.bubbled.length, 0, 'the camera/brush listener on the stage never saw it'); assert.equal(T.win.captured, 1, 'the pointer is captured, not locked');
  assert.equal(T.stage.style.cursor, 'grabbing', 'the cursor stays, as the grab cursor');
  T.fire('pointerup', gate(T).x, gate(T).y); assert.equal(T.stage.style.cursor, '');
  const off = T.fire('pointerdown', 20, 20);
  assert.ok(!off.stopped && !off.prevented && T.bubbled.length === 1, 'a press on empty sky goes to the camera');
  assert.equal(T.win.locks, 0, 'no pointer lock was asked for'); assert.equal(T.s.getState().spawnsDrag, null);
  const hover = T.fire('pointermove', gate(T).x, gate(T).y); assert.equal(T.stage.style.cursor, 'grab', 'hovering over the line says so'); T.fire('pointermove', 20, 20); assert.equal(T.stage.style.cursor, '');
  const right = T.fire('pointerdown', gate(T).x, gate(T).y, { button: 2 }); assert.ok(!right.stopped, 'only the primary button grabs'); assert.ok(hover);
});

test('row 18: Escape ends the drag where it is (one step); unmounting in the middle of a drag closes it; the camera does not move: the press is the whole of the drag\'s input', async () => {
  const T = await mounted({ at: 230 }); T.s.setSpawns({ line: { along: 250 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } });
  const n0 = T.past(); T.fire('pointerdown', gate(T).x, gate(T).y);
  const to = slide(T, gateWorld(T), 8); T.fire('pointermove', to.x, to.y); T.tick();
  (T.doc.listeners.keydown || []).forEach((f) => f({ key: 'Escape' }));
  assert.equal(T.s.getState().spawnsDrag, null); assert.equal(T.past(), n0 + 1);
  T.fire('pointerdown', gate(T).x, gate(T).y); T.panel.unmount(); assert.equal(T.s.getState().spawnsDrag, null, 'unmount closes an open drag');
});

test('row 19: the pick follows the grabbed mark\'s own height: on a cupped road the line hangs 2 m above the path, and a metre of hand travel is still a metre (without the lift it is out by a few per cent)', async () => {
  const T = await mounted(); T.s.setSpawns({ line: { along: 200 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } });
  const P = T.P(), VP = M.viewProj(T.view.pose, W / H), g = gateWorld(T), lift = SPD.liftOf(P.path, T.mk('AC_TIME_0_L').s, g);
  assert.ok(Math.abs(lift.u - 2.18) < 0.05 && Math.abs(lift.l) < 0.5, `the line's centre is ${lift.u} m up: ${JSON.stringify(lift)}`);
  const here = T.px(g), there = slide(T, g, 30);
  const a = SPD.pickStation(P.path, VP, W, H, here.x, here.y, { lift }), b = SPD.pickStation(P.path, VP, W, H, there.x, there.y, { lift });
  assert.ok(Math.abs((b.s - a.s) - 30) < 0.3, `with the lift: ${(b.s - a.s).toFixed(2)} for 30`);
  const a0 = SPD.pickStation(P.path, VP, W, H, here.x, here.y), b0 = SPD.pickStation(P.path, VP, W, H, there.x, there.y);
  assert.ok(Math.abs((b0.s - a0.s) - 30) > 0.5, `without it the same hand travel reads ${(b0.s - a0.s).toFixed(2)}: the lift is what the rows above rest on`);
});

test('row 20: the preview draws the AUTOMATIC start too (a line, a pack and a hotlap to grab), and a track with no road yet draws nothing', async () => {
  const T = await mounted();
  assert.equal(T.spawns(), undefined);
  const kinds = new Set(T.panel.spawnsLayer.items().map((i) => i.kind));
  assert.ok(kinds.has('line') && kinds.has('grid') && kinds.has('hotlap'), [...kinds].join());
  const E = await mounted({ build: () => {}, pose: { eye: [0, 80, -60], target: [0, 0, 0], up: [0, 1, 0], fov: 1 } });
  assert.deepEqual(E.panel.spawnsLayer.items(), [], 'nothing on an empty track');
});

test('row 21: a handle under the pointer is the handle\'s: the press, and the hover cursor, are left alone when the host says one is there, whatever order the listeners run in', async () => {
  const T = await mounted({ at: 230 }); T.s.setSpawns({ line: { along: 250 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } });
  T.panel.spawnDrag.unmount();
  let handle = true; const mine = SPD.mount(T.stage, T.win, T.s, { pose: () => T.view.pose, yieldTo: () => handle }); mine.late();
  const on = T.fire('pointerdown', gate(T).x, gate(T).y);
  assert.ok(!on.stopped && !on.prevented && T.s.getState().spawnsDrag === null, 'a handle there: not grabbed');
  T.fire('pointermove', gate(T).x, gate(T).y); assert.equal(T.stage.style.cursor, '', 'and no grab cursor');
  handle = false;
  const off = T.fire('pointerdown', gate(T).x, gate(T).y); assert.ok(off.stopped && T.s.getState().spawnsDrag, 'no handle: the line is grabbed');
  T.fire('pointerup', gate(T).x, gate(T).y); mine.unmount();
});
