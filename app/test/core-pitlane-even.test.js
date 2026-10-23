// core-pitlane-even.test.js: node --test app/test/core-pitlane-even.test.js
// D438 (2026-10-22, on the TEST TRACK 10 replay: "look at the pits, the like flip up towards the beginning and end, it should be smooth even"). A pit lane
// beside a LEVEL straight whose edge is steep (his p1: a 35 m bowl, cup 10°, edge 20° from 0.7 of the half-width, so the right edge turns 30°) must lie
// even from leave to rejoin: every vertex of the exported lane at the height of the road's edge it leaves from, the diverge and merge as level as the run.
// Before D438 the lane was tilted to the road's edge angle at both joins (src/geom/pitlane.js φ = ψe at g = 0), so its outer edge rose 4 m at the leave
// and the rejoin and fell back level over the 80 m diverge and merge.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const FW = require('../../src/export/fromwords.js');
const { walkScene } = require('../../src/export/markers.js');

const R = 180, Q = Math.PI * R / 2, XS = { w: 35, c: 10, e: 20, s: 0.7 };
const exporter = { checkTarget: () => ({ ok: true }), runSegments: (segs, meta, opts) => ({ result: FW.buildFromSegments(segs, meta, { markers: opts.markers }) }) };
async function lap() {
  const s = await createCoreShell({ brushFn: null, exporter });
  s.extend({ length: 600, family: 'bowl', first: { ...XS } });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R, ...XS } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0, ...XS } });
  s.close();
  assert.equal(s.getState().history.present.closed, true, s.getState().message);
  return s;
}
const LANE = { side: 'R', leave: { word: 'p1', along: 100 }, rejoin: { word: 'p1', along: 500 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80, boxes: 4, boxSpacingM: 25 };
const vertsOf = (meshes) => { const out = []; for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i], m.positions[i + 1], m.positions[i + 2]]); return out; };

test('row 1 (D438): a pit lane off a level straight\'s steep edge lies EVEN from leave to rejoin: the diverge and the merge at the run\'s height, no lift at the lane\'s ends, and no step from the road\'s edge', async () => {
  const s = await lap();
  s.setPitLane(LANE);
  assert.equal(s.spawnsInfo().laneError, null);
  const b = s.buildExport().result, meshes = walkScene(b.scene).meshes.filter((m) => m.indices && m.indices.length);
  const part = (re) => vertsOf(meshes.filter((m) => re.test(m.name)));
  const body = part(/^1ROAD_PIT_body_/), ends = part(/^1ROAD_PIT_(in|out)_/);
  assert.ok(body.length > 0 && ends.length > 0, 'control: the lane\'s run and its two ends are in the scene');
  const ys = body.map((p) => p[1]).sort((x, y) => x - y), yRun = ys[ys.length >> 1];
  assert.ok(ys[ys.length - 1] - ys[0] < 0.02, `control: the run beside a level straight is level (${ys[0].toFixed(3)} .. ${ys[ys.length - 1].toFixed(3)})`);
  // the road's own edge on the lane's side, at the leave: the road vertex nearest (across the ground) the lane's own vertices there
  const road = vertsOf(meshes.filter((m) => /ROAD/.test(m.name) && !/PIT/.test(m.name)));
  const lift = ends.map((p) => p[1] - yRun), worst = lift.reduce((a, x) => (Math.abs(x) > Math.abs(a) ? x : a), 0);
  assert.ok(Math.abs(worst) < 0.02, `every vertex of the diverge and the merge is at the run's height: the worst is ${worst.toFixed(3)} m off it`);
  const low = ends.reduce((a, p) => (p[1] < a[1] ? p : a)), edge = road.reduce((a, p) => ((p[0] - low[0]) ** 2 + (p[2] - low[2]) ** 2 < (a[0] - low[0]) ** 2 + (a[2] - low[2]) ** 2 ? p : a));
  assert.ok(Math.abs(edge[1] - yRun) < 0.02, `no step at the join: the road's edge beside the lane's end is at ${edge[1].toFixed(3)} m, the lane at ${yRun.toFixed(3)} m`);
});
