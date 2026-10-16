// overlap-lap.test.js: node --test app/test/overlap-lap.test.js
// D331 (ELYSIUM's newest save): Close's preview said "No overlap and no red on the closed track" and the checker then said "lap FAILS", because the preview's check (overlapjob.js) ran the
// validator, which proves the lap, and threw the lap away. The check now hands the lap proof's verdict on, in one piece and through the two-part workers. Rows:
//   1  a closed track whose lap fails (the road the old Finish laid at a banked end, a synthetic fixture): the check says so, and where; one whose lap holds says so; an open track has no lap
//   2  the two parts put together (mergeParts) are exactly the one-piece check, the lap verdict included
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../../src/core/document.js');
const F = require('../../src/core/finish.js');
const { extend } = require('../../src/core/extend.js');
const { extendTurnBy } = require('../../src/core/turnby.js');
const OJ = require('../core/overlapjob.js');

const DEG = Math.PI / 180;
const BAD = D.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', 'finish-banked-end-leaves-road.core2.json'), 'utf8'));   // closed; the car leaves the road at 1.5 km
const bankedEnd = (turnDeg, straightM, bankDeg) => {
  let d = D.createDoc('banked'); d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: 500 }, turnDeg * DEG); d = extend(d, { length: straightM });
  d = extend(d, { length: 200, transition: 100, targets: { phi: bankDeg * DEG } }); return extend(d, { length: 100, targets: { kv: 0 } });
};

test('row 1: the overlap check carries the lap proof: a lap that fails says where the car leaves the road, a lap that holds says so, an open track has none', () => {
  const bad = OJ.overlapCheck(OJ.resolveDoc(BAD), undefined, { closed: true });
  assert.ok(bad.lap, 'the answer has a lap verdict'); assert.equal(bad.lap.ok, false, 'the lap fails');
  assert.equal(bad.lap.first.reason, 'leaves-surface'); assert.ok(bad.lap.first.s > 1400 && bad.lap.first.s < 1600, `the car leaves the road at ${bad.lap.first.s} m (the checker: 1.5 km)`); assert.ok(bad.lap.count > 0);
  const good = OJ.overlapCheck(OJ.resolveDoc(F.finishToStart(bankedEnd(120, 200, 54)).doc), undefined, { closed: true });
  assert.equal(good.lap.ok, true, 'the road the new Finish lays at the same end holds'); assert.equal(good.lap.first, null); assert.equal(good.lap.count, 0);
  const open = OJ.overlapCheck(OJ.resolveDoc({ ...BAD, closed: false }), undefined, { closed: false });
  assert.equal(open.lap.ok, null, 'an open track has no lap to prove');
});

test('row 2: the two parts put together are exactly the one-piece check, the lap verdict included', () => {
  const r = OJ.resolveDoc(BAD), whole = OJ.overlapCheck(r, undefined, { closed: true });
  const merged = OJ.mergeParts(OJ.overlapPart('rest', r, undefined, { closed: true }), OJ.overlapPart('rays', r, undefined, { closed: true }));
  assert.deepStrictEqual(merged, whole);
  assert.equal(merged.lap.ok, false);
});
