// core-pitlane.test.js: node --test app/test/core-pitlane.test.js
// THE PIT LANE ON A CORE TRACK (the keeper, 2026-10-09): the shell (app/core/coreshell.js setPitLane, spawnsInfo), the export (its road built beside the
// track and its pit boxes ON it), the panel section (app/core/pitui.js) and the preview's lane outline (app/core/spawnslayer.js), on a closed bowl lap
// whose first piece is a 600 m straight. The lane geometry itself is the word builder's, tested in test/pitlane*.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const FW = require('../../src/export/fromwords.js');
const D = require('../../src/core/document.js');
const SPL = require('../core/spawnslayer.js');
const PIT = require('../core/pitui.js');

const R = 180, Q = Math.PI * R / 2;
// the exporter's build step, writing nothing: the scene, the markers and the validation the Export button would write
const exporter = { checkTarget: () => ({ ok: true }), runSegments: (segs, meta, opts) => ({ result: FW.buildFromSegments(segs, meta, { markers: opts.markers }) }) };
async function lap(cup = false) {
  const s = await createCoreShell({ brushFn: null, exporter });
  // a CUP lap is cupped all the way round, the start straight too (core_cup_export's cupStart lap, at 90°)
  s.extend({ length: 600, family: 'bowl', ...(cup ? { first: { c: 90 } } : {}) });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R, ...(cup ? { c: 90 } : {}) } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0, ...(cup ? { c: 90 } : {}) } });
  s.close();
  assert.equal(s.getState().history.present.closed, true, s.getState().message);
  return s;
}
const LANE = (side = 'R') => ({ ...D.PIT_DEFAULT, side, leave: { word: 'p1', along: 60 }, rejoin: { word: 'p1', along: 540 } });
const meshNames = (b) => { const n = []; (function w(x) { if (x.name) n.push(x.name); (x.children || []).forEach(w); })(b.scene.root); return n; };

for (const side of ['R', 'L']) {
  test(`a pit lane on the ${side === 'R' ? 'right' : 'left'} is built beside the start straight, and the export carries its road and its pit boxes on it`, async () => {
    const s = await lap();
    s.setPitLane(LANE(side));
    const info = s.spawnsInfo();
    assert.equal(info.laneError, null);
    assert.ok(info.lane.lengthM > 400 && info.lane.lengthM < 520, `lane ${info.lane.lengthM} m`);
    const b = s.buildExport().result;
    assert.ok(meshNames(b).some((n) => /^1ROAD_PIT_/.test(n)), 'the lane\'s drivable road (1ROAD_PIT_…) is in the scene');
    const pits = b.markers.placed.filter((m) => /^AC_PIT_/.test(m.name));
    assert.deepEqual(pits.map((m) => m.name), ['AC_PIT_0', 'AC_PIT_1', 'AC_PIT_2', 'AC_PIT_3']);
    assert.ok(pits.every((m) => m.onLane && !m.error), 'every pit box stands on the lane');
    assert.equal(b.validation.red.length, 0);
  });
}

test('the pit boxes follow the lane\'s count and spacing', async () => {
  const s = await lap();
  s.setPitLane({ ...LANE(), boxes: 6, boxSpacingM: 14 });
  const pits = s.spawnsInfo().placed.filter((m) => /^AC_PIT_/.test(m.name));
  assert.equal(pits.length, 6);
  // amended D285 (the rule changed): the row was laid from the lane's midpoint BACKWARDS; now box 0 is the first after the entry and each next box is
  // the spacing FURTHER ON (src/markers/index.js), so the gap is measured forwards. Count and spacing are checked exactly as before.
  const gaps = pits.slice(1).map((m, k) => m.s - pits[k].s);
  assert.ok(gaps.every((g) => Math.abs(g - 14) < 1e-6), JSON.stringify(gaps));
});

test('a lane joining a cup wall cannot be built: it is KEPT, and the panel says why in plain words', async () => {
  const s = await lap(true);
  s.setPitLane(LANE());
  assert.ok(s.getState().history.present.pitLane, 'the lane stays in the document');
  const info = s.spawnsInfo();
  assert.match(info.laneError, /^PIT_JOIN_NOT_FLAT/);
  assert.match(PIT.say(info.laneError), /too steep \(a cup wall or a tube\)/);
});

test('the pit lane and the hand-placed start work together', async () => {
  const s = await lap();
  s.setSpawns({ line: { along: 500 }, grid: { count: 6, rowGapM: 16, colGapM: 6 } });
  s.setPitLane(LANE());
  const b = s.buildExport().result, at = (n) => b.markers.placed.find((m) => m.name === n);
  assert.ok(Math.abs(at('AC_TIME_0_L').s - 500) < 1e-6);
  assert.ok(at('AC_PIT_0').onLane);
});

test('removing the pit lane puts the pit boxes back on the track and takes the lane\'s road out', async () => {
  const s = await lap();
  s.setPitLane(LANE()); s.setPitLane(null);
  assert.equal(s.getState().history.present.pitLane, undefined);
  const b = s.buildExport().result;
  assert.ok(!meshNames(b).some((n) => /^1ROAD_PIT_/.test(n)));
  assert.ok(b.markers.placed.filter((m) => /^AC_PIT_/.test(m.name)).every((m) => !m.onLane));
});

test('the preview draws the lane\'s two edges, labelled, with the automatic start', async () => {
  const s = await lap();
  s.setPitLane(LANE());
  const lanes = SPL.marks(s.spawnsInfo()).filter((i) => i.kind === 'lane');
  assert.equal(lanes.length, 2);
  assert.ok(lanes.some((i) => i.label === 'PIT LANE'));
  assert.ok(lanes.every((i) => i.path.length > 50));
});

test('every refusal of the lane geometry has words for the panel', () => {
  for (const code of ['PIT_JOIN_NOT_FLAT', 'PIT_TOO_SHORT', 'PIT_BACKWARDS', 'PIT_ANCHOR_MISSING', 'PIT_OVER_GAP']) assert.ok(PIT.WHY[code], code);
  assert.equal(PIT.say('SOMETHING_ELSE: x'), 'SOMETHING_ELSE: x', 'an unknown refusal is shown as it is, not hidden');
});

test('"Flatten road for pit" on a cup lap: the refused lane builds, one undo step puts the walls back', async () => {
  const s = await lap(true);
  s.setPitLane(LANE());
  assert.match(s.spawnsInfo().laneError, /^PIT_JOIN_NOT_FLAT/);
  s.flattenForPit();
  assert.equal(s.spawnsInfo().laneError, null, s.getState().message);
  assert.ok(s.buildExport().result.markers.placed.filter((m) => /^AC_PIT_/.test(m.name)).every((m) => m.onLane && !m.error));
  s.undo();
  assert.match(s.spawnsInfo().laneError, /^PIT_JOIN_NOT_FLAT/);
});

test('flattening a TUBE says up front that opening a tube under the racing line usually fails the export', async () => {
  const s = await createCoreShell({ brushFn: null, exporter });
  s.extend({ length: 600, family: 'bowl', first: { t: 360 } });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R, t: 360 } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0, t: 360 } });
  s.close();
  s.setPitLane(LANE());
  s.flattenForPit();
  assert.match(s.getState().message, /tube beside the pit lane is opened.*start the tube after the pit straight/);
});
