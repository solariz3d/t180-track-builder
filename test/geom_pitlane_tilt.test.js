// geom_pitlane_tilt.test.js: node --test --test-concurrency=4 test/geom_pitlane_tilt.test.js. A pit lane leaving a MEASURED
// font's tilted edge (D182: src/geom/fonts.js; the bowl's edge turns 15.5° from the centre's normal, the half-pipe's 30.6°).
// Stated before the test: at both joins the lane's inner edge IS the road's edge (≤ 1e-9 m) and runs along it (tangent within
// 1e-5 rad over 1e-4 m), and the lane's up is the road's surface normal at that edge (≤ 1e-9); along the run the lane lies
// level in the road's frame (its up is the road's U, ≤ 1e-9); an edge past 35° is refused by name (PIT_JOIN_NOT_FLAT).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const R = path.join(__dirname, '..');
const G = require(path.join(R, 'src/geom/index.js'));
const { buildPitLane } = require(path.join(R, 'src/geom/pitlane.js'));
const Prof = require(path.join(R, 'src/geom/profile.js'));
const { fontProfile } = require(path.join(R, 'src/geom/fonts.js'));
const { DEFAULTS: LANE } = require(path.join(R, 'src/doc/pitlane.js'));

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b)))));

function straight(profile) {
  const segs = [{ id: 'w1', word: 'straight', kind: 'road', length: 600, k0: 0, k1: 0, profile }];
  return { segs, path: G.buildPath(segs, { step: 0.5 }) };
}
const SPEC = (side) => ({ ...LANE, side, leave: { word: 'w1', along: 100 }, rejoin: { word: 'w1', along: 500 } });

for (const [font, side] of [['bowl', 'R'], ['half-pipe', 'L']]) {
  test(`a lane off the measured ${font}'s ${side === 'L' ? 'left' : 'right'} edge: G1 and no step at both joins, level along the run`, () => {
    const prof = fontProfile(font, { width: 31 }), P = Prof.normalize(prof), { segs, path: p } = straight(prof);
    const lane = buildPitLane(p, segs, SPEC(side)), h = 1e-4, uE = side === 'L' ? P.u[P.u.length - 1] : P.u[0];
    assert.ok(Math.abs(Prof.psiAt(P, uE)) > 10 * Math.PI / 180, 'the edge should be tilted, or this tests nothing');
    for (const [s, dir] of [[lane.joins.leave.s, 1], [lane.joins.rejoin.s, -1]]) {
      const a = lane.at(s), b = lane.at(s + dir * h);
      assert.ok(len(sub(a.inner, a.edge)) <= 1e-9, `inner vs edge at s ${s}`);
      assert.ok(ang(sub(b.inner, a.inner), sub(b.edge, a.edge)) <= 1e-5, `tangent at s ${s}`);
      const [nl, nu] = Prof.normalAt(P, uE), n = [0, 1, 2].map((k) => a.L[k] * nl + a.U[k] * nu);
      assert.ok(len(sub(a.Ul, n)) <= 1e-9, `the lane's up is the road's normal at its edge (s ${s}): ${len(sub(a.Ul, n))}`);
    }
    const mid = lane.at((lane.parts.run[0] + lane.parts.run[1]) / 2);
    assert.ok(len(sub(mid.Ul, mid.U)) <= 1e-9 && Math.abs(mid.phi) <= 1e-12, 'along the run the lane is level in the road frame');
  });
}

test('a lane is refused off an edge steeper than 35° (the reader\'s lip), and taken at 30.6° (the half-pipe)', () => {
  const steep = { font: 'wall', material: 'ROAD', u: [-20, -15, 0, 15, 20], psi: [40, 0, 0, 0, 40].map((d) => (d * Math.PI) / 180) };
  const a = straight(steep);
  assert.throws(() => buildPitLane(a.path, a.segs, SPEC('R')), (e) => e.code === 'PIT_JOIN_NOT_FLAT');
  const b = straight(fontProfile('half-pipe', { width: 31.5 }));
  assert.doesNotThrow(() => buildPitLane(b.path, b.segs, SPEC('R')));
});

// THE CHAIR'S EXAMPLE of real geometry at the new scale (D182 ripple): a lane off a 33 m measured bowl that REJOINS inside a
// tight banked to -30°. Stated before the run: G1 and the edge's normal at both joins, and the lane mesh's join rows lie in
// the road's tangent plane AT THE EDGE (≤ 1e-4 m, float32) with their normals the edge's (≤ 1e-5 rad), as geom-pitlane's
// no-step test asks of a flat edge.
test('a lane off a 33 m bowl, rejoining in a tight banked -30°: G1, and the mesh join rows in the edge\'s own plane', () => {
  const bowl = fontProfile('bowl', { width: 33 }), P = Prof.normalize(bowl), R = 102, turn = 88 * Math.PI / 180;
  const segs = [{ id: 'w1', word: 'straight', kind: 'road', length: 300, k0: 0, k1: 0, roll0: 0, roll1: 0, profile: bowl },
    { id: 'w2', word: 'tight', kind: 'road', length: R * turn, k0: 1 / R, k1: 1 / R, roll0: 0, roll1: -30 * Math.PI / 180, profile: bowl }];
  const p = G.buildPath(segs, { step: 0.5 }), lane = buildPitLane(p, segs, { ...LANE, side: 'R', leave: { word: 'w1', along: 60 }, rejoin: { word: 'w2', along: 120 } });
  const uE = P.u[0], h = 1e-4;
  for (const [s, dir] of [[lane.joins.leave.s, 1], [lane.joins.rejoin.s, -1]]) {
    const a = lane.at(s), b = lane.at(s + dir * h), [nl, nu] = Prof.normalAt(P, uE), n = [0, 1, 2].map((k) => a.L[k] * nl + a.U[k] * nu);
    assert.ok(len(sub(a.inner, a.edge)) <= 1e-9 && ang(sub(b.inner, a.inner), sub(b.edge, a.edge)) <= 1e-5, `G1 at s ${s}`);
    assert.ok(len(sub(a.Ul, n)) <= 1e-9, `the lane's up is the road's normal at its edge (s ${s})`);
  }
  const mesh = G.buildMesh(lane.path, lane.segments), pieces = mesh._state.pieces;
  for (const [pc, row, s] of [[pieces[0], 0, lane.joins.leave.s], [pieces[2], 'last', lane.joins.rejoin.s]]) {
    const cell = row === 0 ? pc.cells[0] : pc.cells[pc.cells.length - 1], K = pc.K, rr = row === 0 ? 0 : cell.vertices / K - 1, M = pc.F;
    const world = (k) => { const i = (rr * K + k) * 3, x = [cell.positions[i], cell.positions[i + 1], cell.positions[i + 2]]; return [0, 1, 2].map((d) => M.o[d] + M.L[d] * x[0] + M.U[d] * x[1] + M.T[d] * x[2]); };
    const nrm = (k) => { const i = (rr * K + k) * 3, x = [cell.normals[i], cell.normals[i + 1], cell.normals[i + 2]]; return [0, 1, 2].map((d) => M.L[d] * x[0] + M.U[d] * x[1] + M.T[d] * x[2]); };
    const j = lane.at(s);
    for (let k = 0; k < K; k++) {
      assert.ok(Math.abs(dot(sub(world(k), j.edge), j.Ul)) <= 1e-4, `vertex ${k} ${dot(sub(world(k), j.edge), j.Ul)} m off the edge's plane at s ${s}`);
      assert.ok(ang(nrm(k), j.Ul) <= 1e-5, `normal ${k} turned ${ang(nrm(k), j.Ul)} rad from the edge's at s ${s}`);
    }
  }
});
