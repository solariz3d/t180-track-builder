// D171: the pit boxes on a PIT LANE (§5c: "a side road leaving and rejoining the loop"). The lane's geometry is not built
// yet (the D171 hand-back proposes the interface to C and A), so the lane here is a hand-built path beside the road.
// This is the marker half: given the lane's path and segments, the boxes are placed, checked and painted on it.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const X = require('./validate_paths.js');
const M = require('../src/markers/index.js');
const { surfaceAt } = require('../src/markers/place.js');

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
const road = (len, o = {}) => ({ path: X.pathOf(X.straight(len, { step: 2, ...o })), segments: [X.seg({ id: o.id || 'w1', length: len, profile: X.flat(8) })] });
// the main road runs along +z at x = 0; the lane runs beside it, 20 m to the RIGHT (−x, since +u is left)
const MAIN = road(300), LANE = { ...road(120, { start: [-20, 0, 90], id: 'lane' }) };
const layout = () => ({ version: 1, height: 1.5, gateInsetM: 0.5, line: { word: 'w1', along: 280 },
  grid: { pattern: '2-staggered', count: 4, poleBackM: 10, rowGapM: 16, colGapM: 6, edits: {} },
  pits: { at: { word: 'w1', along: 100 }, count: 3, spacingM: 10, u: 0, lane: { along: 80 } }, hotlap: { speedKmh: 200 }, sectors: [] });

test('with a lane, the pit boxes are placed along the LANE from its `along`, on its surface, and pass the checks', () => {
  const r = M.placeAll(layout(), MAIN.path, MAIN.segments, { lane: LANE });
  const pits = r.placed.filter((m) => m.kind === 'pit');
  assert.deepStrictEqual(pits.map((m) => [m.name, m.s]), [['AC_PIT_0', 80], ['AC_PIT_1', 70], ['AC_PIT_2', 60]]);
  for (const m of pits) {
    close(m.pos[0], -20, 1e-9, `${m.name} on the lane (x = −20)`);
    const sf = surfaceAt(LANE.path, LANE.segments, m.s, m.u);
    close(Math.hypot(m.pos[0] - sf.pos[0], m.pos[1] - sf.pos[1], m.pos[2] - sf.pos[2]), 1.5, 1e-9);
  }
  assert.deepStrictEqual(r.check.checks.filter((c) => !c.ok).map((c) => [c.id, c.problems]), []);
});

test('the pit count still matches on a lane, and a lane too short for its boxes is off the road (red)', () => {
  const ok = M.placeAll(layout(), MAIN.path, MAIN.segments, { lane: LANE });
  assert.ok(ok.check.checks.find((c) => c.id === 'pit-count').ok);
  const short = M.placeAll({ ...layout(), pits: { ...layout().pits, count: 12 } }, MAIN.path, MAIN.segments, { lane: LANE });
  assert.ok(!short.check.checks.find((c) => c.id === 'slots').ok, 'boxes run off the lane\'s start');
});

test('the pit box paint is laid on the lane, centred on each box', () => {
  const r = M.placeAll(layout(), MAIN.path, MAIN.segments, { lane: LANE });
  for (const k of [0, 1, 2]) {
    const mesh = r.paint.meshes.find((x) => x.name === `PAINT_PIT_${k}`), m = r.placed.find((x) => x.name === `AC_PIT_${k}`);
    let cx = 0, cz = 0; const n = mesh.positions.length / 3;
    for (let i = 0; i < n; i++) { cx += mesh.positions[i * 3]; cz += mesh.positions[i * 3 + 2]; }
    close(cx / n, m.surface[0], 1e-3); close(cz / n, m.surface[2], 0.06);
  }
});

test('without a lane the boxes stay on the main road at the layout\'s `at`', () => {
  const r = M.placeAll(layout(), MAIN.path, MAIN.segments);
  assert.deepStrictEqual(r.placed.filter((m) => m.kind === 'pit').map((m) => [m.s, m.pos[0]]), [[100, 0], [90, 0], [80, 0]]);
});
