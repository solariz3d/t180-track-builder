// core_pitlane.test.js: node --test test/core_pitlane.test.js
// THE PIT LANE ON A CORE DOCUMENT (the keeper, 2026-10-09): the word builder's side road (src/doc/pitlane.js) anchored to PIECE ids, plus the pit boxes on it.
// Absent unless added, so every track without one saves byte for byte as before.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');

const two = () => extend(extend(D.createDoc('s'), { length: 600, family: 'bowl' }), { length: 200 });
const LANE = { ...D.PIT_DEFAULT, leave: { word: 'p1', along: 50 }, rejoin: { word: 'p1', along: 550 } };

test('a document without a pit lane saves exactly as before', () => {
  assert.ok(!/pitLane/.test(D.serialize(two())));
});

test('setPitLane stores the lane and its boxes, and they survive save and open byte for byte', () => {
  const d = D.setPitLane(two(), LANE);
  const back = D.parse(D.serialize(d));
  assert.deepEqual(back.pitLane, { side: 'R', leave: { word: 'p1', along: 50 }, rejoin: { word: 'p1', along: 550 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80, boxes: 4, boxSpacingM: 10 });
  assert.equal(D.serialize(back), D.serialize(d));
});

test('setPitLane(doc, null) removes it', () => {
  assert.equal(D.serialize(D.setPitLane(D.setPitLane(two(), LANE), null)), D.serialize(two()));
});

test('a bad lane is refused by name: the side, a width out of range, a box count, an unknown key', () => {
  const bad = (lane, re) => assert.throws(() => D.setPitLane(two(), lane), (e) => e.code === 'BAD_PIT_LANE' && re.test(e.message));
  bad({ ...LANE, side: 'X' }, /side/);
  bad({ ...LANE, width: 1 }, /width/);
  bad({ ...LANE, boxes: 0 }, /boxes/);
  bad({ ...LANE, boxSpacingM: 2 }, /boxSpacingM/);
  bad({ ...LANE, colour: 'red' }, /colour/);
});

test('the pit lane and the spawns live side by side and edits keep both', () => {
  const d = D.setPitLane(D.setSpawns(two(), { line: { along: 300 }, grid: { count: 4, rowGapM: 16, colGapM: 6 } }), LANE);
  const e = extend(d, { length: 40 });
  assert.deepEqual([e.spawns, e.pitLane], [d.spawns, d.pitLane]);
  assert.deepEqual(D.parse(D.serialize(e)).pitLane, d.pitLane);
});
