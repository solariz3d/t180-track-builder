// Tests for src/markers (D171, ARCHITECTURE §5c): markers in track coordinates, the grid, the hotlap run-up, the gates,
// the red checks, and the paint generated from the markers. Real resolve (src/doc), real paths (src/geom).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/doc/index.js');
const { buildPath } = require('../src/geom/index.js');
const M = require('../src/markers/index.js');
const { surfaceAt } = require('../src/markers/place.js');
const { checkPlaced } = require('../src/markers/checks.js');
const { MACH6 } = require('../src/validate/limits.js');

const DEG = Math.PI / 180;
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function track(words, { font } = {}) {
  let d = D.createDoc('m');
  for (const [w, patch, own] of words) { const f = own || font; d = D.appendWord(d, w, f ? { font: f } : {}); if (patch) d = D.editWord(d, d.words[d.words.length - 1].id, { handles: patch }); }
  return build(d);
}
function build(d) { const segs = D.resolve(d).segments; return { d, segs, path: buildPath(segs, { step: 2 }) }; }
// D182 (the ripple): BASE NAMES what these tests relied on as defaults before the measured vocabulary: 100 m flat straights
// 20 m wide, and a level 60° bowl turn at 300 m with its 8 m wall (15° inside, 60° outside), so the markers are tested on the
// same track whatever the defaults are. HP is the old half-pipe, 16 m walled 8 m to 60° (the measured one has no wall, and the
// half-pipe tests below are about the wall).
const ST = { length: 100, width: 20 }, DEG_ = Math.PI / 180;
const HP = { length: 100, width: 16, wall: 8, psiL: 60 * DEG_, psiR: 60 * DEG_ };
const BASE = [['straight', ST, 'flat'], ['straight', ST, 'flat'],
  ['turn', { turn: 60 * DEG_, length: (60 * DEG_) * 300 / 0.7, width: 16, wall: 8, psiL: 15 * DEG_, psiR: 60 * DEG_, roll0: 0, roll1: 0 }, 'bowl'], ['straight', ST, 'flat']];
const by = (r, n) => r.placed.find((m) => m.name === n);
const failing = (r) => r.check.checks.filter((c) => !c.ok).map((c) => c.id);

// ── track coordinates ──
test('the markers stay on the road after an UPSTREAM word is edited: they move with their words, same (along, u, h)', () => {
  const t = track(BASE), layout = M.defaultLayout(t.path, t.segs), before = M.placeAll(layout, t.path, t.segs);
  const edited = build(D.editWord(t.d, 'w1', { handles: { length: 160 } }));   // w1 was 100 m: everything after moves 60 m on
  const after = M.placeAll(layout, edited.path, edited.segs);
  assert.deepStrictEqual(failing(after), []);
  for (const m of after.placed.filter((x) => x.kind !== 'hotlap')) {
    const was = by(before, m.name);
    close(m.s - was.s, 60, 1e-6, m.name); close(m.u, was.u, 0, m.name); close(m.h, was.h, 0, m.name);
    const sf = surfaceAt(edited.path, edited.segs, m.s, m.u);
    close(Math.hypot(...sub(m.pos, sf.pos)), m.h, 1e-9, `${m.name} stands h above the new surface`);
  }
});

test('editing the anchor word itself keeps the marker at the same distance into it, clamped to the word', () => {
  const t = track(BASE), layout = M.defaultLayout(t.path, t.segs);
  const shorter = build(D.editWord(t.d, layout.line.word, { handles: { length: 50 } }));
  const r = M.placeAll(layout, shorter.path, shorter.segs), starts = [];
  let s = 0; for (const g of shorter.segs) { starts.push(s); s += g.length; }
  const first = shorter.segs.findIndex((g) => g.id === layout.line.word), len = shorter.segs.filter((g) => g.id === layout.line.word).reduce((a, g) => a + g.length, 0);
  close(by(r, 'AC_TIME_0_L').s, starts[first] + Math.min(layout.line.along, len), 1e-9);
});

test('markers on a BANKED floor stand h along the rolled normal, not world up, and pass the checks', () => {
  const t = track(BASE), bank = 20 * DEG;
  const segs = t.segs.map((g) => (g.kind === 'road' ? { ...g, roll0: bank, roll1: bank } : g)), path = buildPath(segs, { step: 2 });
  const r = M.placeAll(M.defaultLayout(t.path, t.segs), path, segs);
  assert.deepStrictEqual(failing(r), []);
  const pole = by(r, 'AC_START_0'), sf = surfaceAt(path, segs, pole.s, pole.u);
  // D182: the marker's up IS the surface normal where it stands (the rolled normal), tilted from world up by at least the bank;
  // exactly the bank only on a dead-level floor, and the measured flat font rises about 0.6° under the pole slot
  close(Math.acos(pole.up[1]), Math.acos(sf.n[1]), 1e-6, 'the marker\'s up is the surface normal');
  assert.ok(Math.acos(pole.up[1]) >= bank - 1e-9, 'tilted by at least the bank');
  const off = sub(pole.pos, sf.pos);
  close(dot(off, sf.n), 1.5, 1e-9); close(Math.hypot(...off), 1.5, 1e-9, 'straight off the surface');
  close(dot(pole.fwd, sf.n), 0, 1e-9, 'forward lies in the banked surface');
});

test('on a half-pipe the start gates sit on the walls\' edges, standing off the WALL along its normal', () => {
  const t = track([['straight', HP], ['straight', HP], ['straight', HP]], { font: 'half-pipe' });   // D182: the walled half-pipe named (HP)
  const r = M.placeAll(M.defaultLayout(t.path, t.segs), t.path, t.segs), l = by(r, 'AC_TIME_0_L');
  const sf = surfaceAt(t.path, t.segs, l.s, l.u);
  assert.ok(sf.n[1] < Math.cos(30 * DEG), 'the wall is steep there');
  close(dot(sub(l.pos, sf.pos), sf.n), 1.5, 1e-9);
  close(l.u, sf.span[1] - 0.5, 1e-12, 'inset 0.5 m from the left edge of the cross-section');
});

// ── the grid ──
test('the grid is numbered from pole: AC_START_0 nearest the line, each slot at or behind the one before', () => {
  const t = track(BASE), r = M.placeAll(M.defaultLayout(t.path, t.segs), t.path, t.segs), line = by(r, 'AC_TIME_0_L').s;
  const grid = r.placed.filter((m) => m.kind === 'grid').sort((a, b) => a.n - b.n);
  assert.deepStrictEqual(grid.map((m) => m.name), ['AC_START_0', 'AC_START_1', 'AC_START_2', 'AC_START_3']);
  for (let k = 0; k < grid.length; k++) assert.ok(line - grid[k].s >= (k ? line - grid[k - 1].s : 0));
});

test('the grid order records the race direction: back slot to pole runs along +s, and every marker faces it', () => {
  const t = track(BASE), r = M.placeAll(M.defaultLayout(t.path, t.segs), t.path, t.segs);
  const grid = r.placed.filter((m) => m.kind === 'grid'), pole = grid[0], last = grid[grid.length - 1];
  const dir = sub(pole.pos, last.pos), n = Math.hypot(...dir), T = surfaceAt(t.path, t.segs, pole.s, 0).T;
  // a staggered grid's back → pole also crosses the road (6 m over 24 m here), so the test is T1's reader rule
  // (src/export/markers.js raceCos): within 30° of the track's direction, and forward
  assert.ok(dot(dir, T) / n > Math.cos(30 * Math.PI / 180), `back → pole is the direction the track is built in (${dot(dir, T) / n})`);
  for (const m of r.placed) assert.ok(dot(m.fwd, m.T) > 0.999, `${m.name} faces the race direction`);
});

test('the patterns: 2 staggered, 2 abreast, 3 abreast (Aurora), with their spacing', () => {
  const g = (pattern) => M.gridSlots({ pattern, count: 6, poleBackM: 10, rowGapM: 12, colGapM: 6 });
  assert.deepStrictEqual(g('2-staggered').map((x) => [x.backM, x.u]), [[10, 3], [16, -3], [22, 3], [28, -3], [34, 3], [40, -3]]);
  assert.deepStrictEqual(g('2-abreast').map((x) => [x.backM, x.u]), [[10, 3], [10, -3], [22, 3], [22, -3], [34, 3], [34, -3]]);
  assert.deepStrictEqual(g('3-abreast').map((x) => [x.backM, x.u]), [[10, 6], [10, 0], [10, -6], [22, 6], [22, 0], [22, -6]]);
  assert.throws(() => M.gridSlots({ pattern: '4-wide', count: 2, poleBackM: 0, rowGapM: 1, colGapM: 1 }), /not one of/);
});

test('a slot edit moves that slot only (editable slot by slot)', () => {
  const base = { pattern: '2-staggered', count: 4, poleBackM: 10, rowGapM: 16, colGapM: 6 };
  const a = M.gridSlots(base), b = M.gridSlots({ ...base, edits: { 2: { backM: 30, u: 2 } } });
  assert.deepStrictEqual(b.map((x, i) => (i === 2 ? null : x)), a.map((x, i) => (i === 2 ? null : x)));
  assert.deepStrictEqual([b[2].backM, b[2].u], [30, 2]);
});

// ── the hotlap and the gates ──
test('the hotlap starts the run-up that reaches the design speed at the line (measured thrust, FINDINGS.md:494)', () => {
  const t = track([['straight', { length: 500 }], ['straight']]), layout = M.defaultLayout(t.path, t.segs);
  const r = M.placeAll(layout, t.path, t.segs);
  close(by(r, 'AC_TIME_0_L').s - by(r, 'AC_HOTLAP_START_0').s, M.runUpM(MACH6.designSpeedKmh / 3.6), 1e-6);
  close(M.speedAfterM(M.runUpM(460 / 3.6)) * 3.6, 460, 1e-3, 'the run-up and the speed it gives are inverses (to the 0.05 m/s integration step)');
  const slow = M.placeAll({ ...layout, hotlap: { speedKmh: 200 } }, t.path, t.segs);
  assert.ok(by(slow, 'AC_HOTLAP_START_0').s > by(r, 'AC_HOTLAP_START_0').s, 'a slower target, a shorter run-up');
});

test('on an open track too short for the run-up, the hotlap is at the start, and says the speed it will reach (amber)', () => {
  const t = track(BASE), r = M.placeAll(M.defaultLayout(t.path, t.segs), t.path, t.segs);
  assert.strictEqual(by(r, 'AC_HOTLAP_START_0').s, 0);
  assert.match(r.check.amber.find((a) => a.id === 'hotlap-short').text, /arrives at \d+ km\/h/);
  assert.ok(r.check.ok, 'amber, not red');
});

test('sectors 1 and 2 are gates across the road like the start, L left of R', () => {
  const t = track(BASE), layout = { ...M.defaultLayout(t.path, t.segs), sectors: [{ word: 'w3', along: 50 }, { word: 'w4', along: 20 }] };
  const r = M.placeAll(layout, t.path, t.segs);
  for (const k of [1, 2]) assert.ok(by(r, `AC_TIME_${k}_L`).u > by(r, `AC_TIME_${k}_R`).u);
  assert.deepStrictEqual(failing(r), []);
});

// ── each red check fires and clears ──
const T0 = () => { const t = track(BASE); return { t, layout: M.defaultLayout(t.path, t.segs) }; };
const run = (t, layout) => M.placeAll(layout, t.path, t.segs);
test('red check: the start line ahead of the grid (a slot past the line, then a slot numbered out of order)', () => {
  const { t, layout } = T0();
  assert.ok(!failing(run(t, layout)).includes('start-ahead-of-grid'));
  assert.ok(failing(run(t, { ...layout, grid: { ...layout.grid, edits: { 0: { backM: -5 } } } })).includes('start-ahead-of-grid'));
  assert.ok(failing(run(t, { ...layout, grid: { ...layout.grid, edits: { 1: { backM: 5 } } } })).includes('start-ahead-of-grid'));
});
test('red check: L and R gates the right way round (swapped: fires; as placed: clear)', () => {
  const { t, layout } = T0(), r = run(t, layout);
  assert.ok(checkPlaced(r.placed, layout, t.path).checks.find((c) => c.id === 'gate-orientation').ok);
  const swapped = r.placed.map((m) => (m.name === 'AC_TIME_0_L' ? { ...m, name: 'AC_TIME_0_R' } : m.name === 'AC_TIME_0_R' ? { ...m, name: 'AC_TIME_0_L' } : m));
  assert.ok(!checkPlaced(swapped, layout, t.path).checks.find((c) => c.id === 'gate-orientation').ok);
});
test('red check: 1–2 m above the surface (3 m and 0.5 m fire, 1 m and 2 m clear) and along the road', () => {
  const { t, layout } = T0();
  for (const [h, bad] of [[0.5, true], [1, false], [2, false], [3, true]]) assert.strictEqual(failing(run(t, { ...layout, height: h })).includes('height-and-heading'), bad, `h ${h}`);
  const r = run(t, layout), turned = r.placed.map((m) => (m.name === 'AC_PIT_0' ? { ...m, fwd: m.left } : m));
  assert.ok(!checkPlaced(turned, layout, t.path).checks.find((c) => c.id === 'height-and-heading').ok, 'a marker facing across the road');
});
test('red check: no marker inside another\'s slot, and none off the road', () => {
  const { t, layout } = T0();
  assert.ok(!failing(run(t, layout)).includes('slots'));
  assert.ok(failing(run(t, { ...layout, grid: { ...layout.grid, edits: { 1: { backM: 11, u: 2.5 } } } })).includes('slots'), 'overlapping slot 0');
  assert.ok(failing(run(t, { ...layout, grid: { ...layout.grid, edits: { 3: { u: 12 } } } })).includes('slots'), 'off the road');
  assert.ok(failing(run(t, { ...layout, pits: { ...layout.pits, at: { word: 'w1', along: 1 }, count: 3 } })).includes('slots'), 'a pit box run off the start of the track');
});
test('red check: the pit count (none: fires; placed ≠ asked: fires; as laid out: clear)', () => {
  const { t, layout } = T0(), r = run(t, layout);
  assert.ok(!failing(r).includes('pit-count'));
  assert.ok(failing(run(t, { ...layout, pits: { ...layout.pits, count: 0 } })).includes('pit-count'));
  const lost = r.placed.filter((m) => m.name !== 'AC_PIT_1');
  assert.ok(!checkPlaced(lost, layout, t.path).checks.find((c) => c.id === 'pit-count').ok);
});
test('red check: a marker whose word is gone', () => {
  const { t, layout } = T0();
  assert.ok(failing(run(t, { ...layout, line: { word: 'w99', along: 0 } })).includes('anchors'));
});

// ── the paint ──
test('the paint and the markers agree: every mark comes from a marker, at its (s, u), on the surface', () => {
  const t = track(BASE), r = M.placeAll(M.defaultLayout(t.path, t.segs), t.path, t.segs);
  const names = r.paint.items.map((i) => i.name).sort();
  assert.deepStrictEqual(names, ['PAINT_GRID_0', 'PAINT_GRID_1', 'PAINT_GRID_2', 'PAINT_GRID_3', 'PAINT_PIT_0', 'PAINT_PIT_1', 'PAINT_START_LINE']);
  for (const it of r.paint.items) {
    const m = it.from === 'AC_TIME_0' ? by(r, 'AC_TIME_0_L') : by(r, it.from);
    close(it.s, m.s, 0, it.name);
    if (it.kind !== 'line') close(it.u, m.u, 0, it.name);
  }
  // each box is centred on its marker's surface point, and every vertex lies 2 cm off the surface
  for (const mesh of r.paint.meshes.filter((x) => x.name !== 'PAINT_START_LINE')) {
    const m = by(r, r.paint.items.find((i) => i.name === mesh.name).from), P = mesh.positions, n = P.length / 3;
    const c = [0, 1, 2].map((k) => { let a = 0; for (let i = 0; i < n; i++) a += P[i * 3 + k]; return a / n; });
    assert.ok(Math.hypot(...sub(c, m.surface)) < 0.06, `${mesh.name} centred on ${m.name}: ${Math.hypot(...sub(c, m.surface))}`);
  }
});

test('the start/finish line wraps the whole cross-section, up a half-pipe\'s walls', () => {
  const t = track([['straight', HP], ['straight', HP], ['straight', HP]], { font: 'half-pipe' });   // D182: the walled half-pipe named (HP)
  const r = M.placeAll(M.defaultLayout(t.path, t.segs), t.path, t.segs), line = r.paint.meshes.find((x) => x.name === 'PAINT_START_LINE');
  const l = by(r, 'AC_TIME_0_L'), P = line.positions, n = P.length / 3;
  const floorY = surfaceAt(t.path, t.segs, l.s, 0).pos[1];
  let top = -Infinity; for (let i = 0; i < n; i++) top = Math.max(top, P[i * 3 + 1] - floorY);
  const wallTop = surfaceAt(t.path, t.segs, l.s, l.span[1]).pos[1] - floorY;
  assert.ok(wallTop > 3 && Math.abs(top - (wallTop + 0.02 * surfaceAt(t.path, t.segs, l.s, l.span[1]).n[1])) < 1e-3, `line top ${top}, wall top ${wallTop}`);
});

// ── closing the D171 mutation survivors: each a real property, tested where it was not ──
function fonts() {   // a flat straight, then a half-pipe straight (a 20 m font transition at its start), then a jump
  let d = D.createDoc('f');
  // D182: every font and width NAMED (a flat 20 m straight into 16 m half-pipes walled to 60°), as the defaults were before
  const hp = { font: 'half-pipe', handles: { length: 100, width: 16, wall: 8, psiL: 60 * DEG_, psiR: 60 * DEG_ } };
  d = D.appendWord(d, 'straight', { font: 'flat', handles: { length: 100, width: 20 } }); d = D.appendWord(d, 'straight', hp); d = D.appendWord(d, 'straight', hp);
  d = D.appendWord(d, 'jump'); d = D.appendWord(d, 'straight', hp);
  return build(d);
}
test('inside a font transition a marker sits on the BLENDED surface the mesh builds, not the new font\'s', () => {
  const t = fonts(), w2 = t.segs.findIndex((g) => g.id === 'w2');
  assert.ok(t.segs[w2].blend, 'resolve emits the blend');
  const start = t.segs.slice(0, w2).reduce((a, g) => a + g.length, 0);
  const own = surfaceAt(t.path, t.segs, start + 30, 0).span, flat = surfaceAt(t.path, t.segs, start - 1, 0).span;
  const at = surfaceAt(t.path, t.segs, start + 0.001, 0).span;
  assert.ok(Math.abs(at[1] - flat[1]) < 0.01 && Math.abs(own[1] - flat[1]) > 1, `span at the transition's start ${at[1]}, flat ${flat[1]}, half-pipe ${own[1]}`);
});
// On a flat turn, interpolating the frame keeps T exactly in the surface; with the bank CHANGING through the turn it
// does not (up to |T·n| 0.0022 between stations, measured with a node -e probe on this track). The marker still gets an
// orthonormal frame, because its forward is the tangent laid into the surface.
test('between stations on a banking turn the marker\'s axes are still an orthonormal frame (a valid kn5 matrix)', () => {
  // D182: the lengths and the tight's turn NAMED (100 m, then 90° at 120 m), so s 101-300 stays on this track
  const t = track([['straight', ST, 'flat'], ['tight', { turn: 90 * DEG_, length: (90 * DEG_) * 120 / 0.7, width: 16 }, 'flat']]);
  const segs = t.segs.map((g) => (g.word === 'tight' ? { ...g, roll0: 0.1, roll1: 0.9 } : g)), path = buildPath(segs, { step: 2 });
  const { placeMarker } = require('../src/markers/place.js');
  let worst = 0;
  for (let s = 101.3; s < 300; s += 2) for (const u of [0, 6, 7.9]) {
    const m = placeMarker(path, segs, { name: 'X', s, u, h: 1.5 });
    worst = Math.max(worst, Math.abs(dot(m.fwd, m.up)), Math.abs(Math.hypot(...m.left) - 1));
  }
  assert.ok(worst < 1e-12, `${worst}`);
});
test('a marker between stations is interpolated along the road, not snapped to the station before', () => {
  const t = track([['straight', ST, 'flat']]);   // along +z from the origin (D182: its 100 m named)
  close(surfaceAt(t.path, t.segs, 51, 0).pos[2], 51, 1e-9);
});
test('a marker over a jump\'s flight is red, off the road (no surface under it)', () => {
  const t = fonts(), layout = { ...M.defaultLayout(t.path, t.segs), pits: { at: { word: 'w4', along: 5 }, count: 1, spacingM: 8, u: 0, lane: null } };
  const r = M.placeAll(layout, t.path, t.segs);
  assert.match(r.check.checks.find((c) => c.id === 'slots').problems.join(' | '), /AC_PIT_0 is off the road: .*over a jump's flight/);
});
test('the default layout refuses a grid longer than the longest straight (NO_START_STRAIGHT), with the lengths', () => {
  const t = track(BASE);
  assert.throws(() => M.defaultLayout(t.path, t.segs, { count: 30 }), (e) => e.code === 'NO_START_STRAIGHT' && /the longest straight is \d+\.\d m; a grid of 30/.test(e.message));
});
test('a pit box that cannot be placed (off the track\'s start) is red on its own, nothing else overlapping', () => {
  const { t, layout } = T0();
  const r = run(t, { ...layout, hotlap: { speedKmh: 60 }, pits: { ...layout.pits, at: { word: 'w1', along: 1 }, count: 2, spacingM: 10 } });
  const slots = r.check.checks.find((c) => c.id === 'slots').problems;
  assert.deepStrictEqual(slots.length, 1, slots.join(' | '));
  assert.match(slots[0], /AC_PIT_1 is off the road: markers: s = -9 m is off the track/);
});
