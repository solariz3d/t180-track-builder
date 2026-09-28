// geom-pitlane.test.js: node --test test/geom-pitlane.test.js. The pit lane's road (src/geom/pitlane.js). Bounds, STATED
// BEFORE THE FIRST RUN:
//   · G1 at both joins: the lane's inner edge IS the road's edge (≤ 1e-9 m, f64), and its tangent, taken over 1e-4 m of
//     main road, is the road edge's within 1e-5 rad (the ease's own slope over that step is 3·offset·h/diverge² ≈ 6e-7);
//     on a straight, and where the lane leaves or rejoins in a TURN;
//   · no step: the lane mesh's join row (float32, world) lies on the road's surface plane within 1e-4 m, its inner vertex
//     on the road's edge within 1e-4 m, and its normal is the road's within 1e-5 rad;
//   · E's pit boxes (src/markers placeAll { lane }) stand on the lane's surface (≤ 1e-9 m) and beyond the road's edge;
//   · the self-check stays ON: with the lane only 0.3 m from the road's edge, through a turn, lane-against-road tests run
//     (> 0) and find nothing, the road's own selfCheck finds nothing, and switching the join exemption off finds the
//     designed contact AT the joins and nowhere else (so the check can fail).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const G = require('../src/geom/index.js');
const { buildPitLane, laneCheck } = require('../src/geom/pitlane.js');
const M = require('../src/markers/index.js');
const { surfaceAt } = require('../src/markers/place.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b)))));

// D182 (the ripple): the words below NAME the inputs these tests relied on as defaults before the measured vocabulary (a flat
// straight, a 90° tight at 120 m: (π/2)·120/(1 − 0.3) m long), so they test the same behaviour whatever the defaults are.
const TIGHT90 = { turn: Math.PI / 2, length: (Math.PI / 2) * 120 / 0.7 };
/** Straight 600, two flat tights (a 180° left turn), straight 600: open, so the geometry needs no closing. */
function track(lane) {
  let d = D.createDoc('lane');
  for (const [w, o] of [['straight', { font: 'flat', handles: { length: 600 } }], ['tight', { font: 'flat', handles: TIGHT90 }], ['tight', { font: 'flat', handles: TIGHT90 }], ['straight', { font: 'flat', handles: { length: 600 } }]]) d = D.appendWord(d, w, o);
  d = D.setPitLane(d, lane);
  const r = D.resolve(d), path = G.buildPath(r.segments, { step: 0.5 });
  return { d, segs: r.segments, path, lane: buildPitLane(path, r.segments, d.pitLane) };
}
const ON_STRAIGHT = { side: 'R', leave: { word: 'w1', along: 100 }, rejoin: { word: 'w1', along: 500 } };
const THROUGH_TURN = { side: 'L', leave: { word: 'w1', along: 450 }, rejoin: { word: 'w3', along: 150 }, offsetM: 0.3, divergeM: 60, mergeM: 60 };

for (const [name, spec] of [['on a straight', ON_STRAIGHT], ['leaving on a straight and rejoining in a turn', THROUGH_TURN]]) {
  test(`G1 at both joins, ${name}: the inner edge is the road's edge, and runs along it`, () => {
    const { lane } = track(spec), h = 1e-4;
    for (const [s, dir] of [[lane.joins.leave.s, 1], [lane.joins.rejoin.s, -1]]) {
      const a = lane.at(s), b = lane.at(s + dir * h);
      assert.ok(len(sub(a.inner, a.edge)) <= 1e-9, `inner vs edge at s ${s}: ${len(sub(a.inner, a.edge))}`);
      const t = ang(sub(b.inner, a.inner), sub(b.edge, a.edge));
      assert.ok(t <= 1e-5, `tangent angle at s ${s}: ${t}`);
    }
  });
  test(`no step at the joins, ${name}: the lane mesh's join rows lie on the road, in its plane, facing its way`, () => {
    const { lane } = track(spec), mesh = G.buildMesh(lane.path, lane.segments);
    const pieces = mesh._state.pieces;
    for (const [pc, row, s] of [[pieces[0], 0, lane.joins.leave.s], [pieces[2], 'last', lane.joins.rejoin.s]]) {
      const cell = row === 0 ? pc.cells[0] : pc.cells[pc.cells.length - 1], K = pc.K, R = cell.vertices / K, r = row === 0 ? 0 : R - 1, M = pc.F;
      const world = (k) => { const i = (r * K + k) * 3, x = [cell.positions[i], cell.positions[i + 1], cell.positions[i + 2]]; return [0, 1, 2].map((d) => M.o[d] + M.L[d] * x[0] + M.U[d] * x[1] + M.T[d] * x[2]); };
      const nrm = (k) => { const i = (r * K + k) * 3, x = [cell.normals[i], cell.normals[i + 1], cell.normals[i + 2]]; return [0, 1, 2].map((d) => M.L[d] * x[0] + M.U[d] * x[1] + M.T[d] * x[2]); };
      const j = lane.at(s), innerK = spec.side === 'L' ? 0 : K - 1;     // u ascends right → left: the inner edge is on the road's side
      assert.ok(len(sub(world(innerK), j.edge)) <= 1e-4, `inner vertex off the road's edge by ${len(sub(world(innerK), j.edge))} m at s ${s}`);
      // the road's plane AT THE SHARED EDGE: its surface normal there, j.Ul (src/geom/pitlane.js). D182: that is the centre's
      // U only on a dead-level edge; the measured flat font rises 3° at its edge, and the check is about the edge's plane.
      for (let k = 0; k < K; k++) {
        assert.ok(Math.abs(dot(sub(world(k), j.edge), j.Ul)) <= 1e-4, `vertex ${k} ${dot(sub(world(k), j.edge), j.Ul)} m off the road's plane at s ${s}`);
        assert.ok(ang(nrm(k), j.Ul) <= 1e-5, `normal ${k} turned ${ang(nrm(k), j.Ul)} rad from the road's at s ${s}`);
      }
    }
  });
}

test('the lane runs offsetM beyond the road\'s edge between its eases, and its s is its own arc length', () => {
  const { lane } = track({ ...ON_STRAIGHT, offsetM: 12, width: 8 });
  const mid = lane.at((lane.parts.run[0] + lane.parts.run[1]) / 2);
  assert.ok(Math.abs(len(sub(mid.inner, mid.edge)) - 12) <= 1e-9);
  const S = lane.path.samples; let arc = 0;
  for (let i = 1; i < S.length; i++) arc += len(sub(S[i].pos, S[i - 1].pos));
  assert.ok(Math.abs(arc - lane.path.lengthM) <= 1e-9);
  assert.ok(Math.abs(lane.segments.reduce((a, g) => a + g.length, 0) - lane.path.lengthM) <= 1e-9);
  assert.deepEqual(lane.segments.map((g) => `${g.id}_${g.part}`), ['PIT_in', 'PIT_body', 'PIT_out']);
});

test('E\'s pit boxes sit on the lane: on its surface, beyond the road\'s edge, and pass §5c\'s checks', () => {
  const { path, segs, lane } = track({ ...ON_STRAIGHT, offsetM: 12, width: 8 });
  const layout = M.defaultLayout(path, segs);
  layout.pits = { ...layout.pits, count: 4, spacingM: 10, lane: { along: lane.path.lengthM / 2 } };
  const r = M.placeAll(layout, path, segs, { lane: { path: lane.path, segments: lane.segments } });
  const pits = r.placed.filter((m) => m.kind === 'pit');
  assert.equal(pits.length, 4);
  for (const m of pits) {
    const sf = surfaceAt(lane.path, lane.segments, m.s, m.u);
    assert.ok(Math.abs(len(sub(m.pos, sf.pos)) - m.h) <= 1e-9, `${m.name} stands ${m.h} m over the lane`);
    const j = lane.at(lane.path.samples.find((x) => x.s >= m.s).sMain);
    assert.ok(Math.abs(dot(sub(sf.pos, j.edge), j.L)) > 12, `${m.name} is beyond the road's edge and the gap`);
  }
  assert.deepEqual(r.check.checks.filter((c) => !c.ok).map((c) => [c.id, c.problems]), []);
});

test('the self-check stays ON beside the road: a lane 0.3 m off a turn is tested, and clear; without the join exemption the joins show', () => {
  const { path, segs, lane } = track(THROUGH_TURN);
  const main = G.buildMesh(path, segs, { selfCheck: true }), lm = G.buildMesh(lane.path, lane.segments, { selfCheck: true });
  assert.deepEqual([main.selfCheck.intersections.length, main.selfCheck.stacked.length, lm.selfCheck.intersections.length], [0, 0, 0]);
  const c = laneCheck(main, lm, lane);
  assert.ok(c.stats.triTests > 0 && c.stats.rayTests > 0, `tests ran: ${JSON.stringify(c.stats)}`);
  assert.deepEqual([c.intersections.length, c.stacked.length], [0, 0]);
  const raw = laneCheck(main, lm, lane, { exemptM: -1e9 });
  assert.ok(raw.intersections.length > 0 && raw.stacked.length > 0, 'the joins touch the road by design, as crossings and as stacked');
  const nearJoin = (x) => x.sLane <= lane.path.segEnd[0].s || x.sLane >= lane.path.segEnd[1].s;
  assert.ok([...raw.intersections, ...raw.stacked].every(nearJoin), 'and only in the join zones');
});

test('a lane is refused by name: a missing anchor, backwards, too short for its eases, a walled edge', () => {
  const code = (spec, c) => assert.throws(() => track(spec), (e) => e.code === c, c);
  code({ ...ON_STRAIGHT, rejoin: { word: 'w9', along: 0 } }, 'PIT_ANCHOR_MISSING');
  code({ ...ON_STRAIGHT, leave: { word: 'w1', along: 500 }, rejoin: { word: 'w1', along: 100 } }, 'PIT_BACKWARDS');
  code({ ...ON_STRAIGHT, divergeM: 300, mergeM: 300 }, 'PIT_TOO_SHORT');
  // a walled edge, NAMED (D182: the default bowl is measured and has no wall): an 8 m wall to 60° on both sides
  let d = D.appendWord(D.appendWord(D.createDoc(), 'straight', { font: 'flat', handles: { length: 300 } }), 'tight', { font: 'bowl', handles: { ...TIGHT90, wall: 8, psiL: Math.PI / 3, psiR: Math.PI / 3 } });
  d = D.setPitLane(d, { side: 'R', leave: { word: 'w1', along: 50 }, rejoin: { word: 'w2', along: 100 }, divergeM: 40, mergeM: 40 });
  const r = D.resolve(d), p = G.buildPath(r.segments, { step: 0.5 });
  assert.throws(() => buildPitLane(p, r.segments, d.pitLane), (e) => e.code === 'PIT_JOIN_NOT_FLAT');
});
