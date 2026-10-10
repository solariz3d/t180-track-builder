// markers_pitbalance.test.js: node --test test/markers_pitbalance.test.js
// D285 (the keeper, 2026-10-10: "the pit lane spacing starts half way through the pit, it needs to be pushed more to the front of it to be balanced … Pit 1
// starts half way to the back of the pits"). With no hand-set `layout.pits.lane.along`, src/markers/index.js placeAll laid the boxes from the lane's
// MIDPOINT backwards, so the front half of the lane was empty. Now the row is centred on the lane's usable straight (between the entry and exit tapers),
// box 0 first after the entry. Through the app's core shell (spawnsInfo: what the panel, the preview and the export place) on the real pit lane
// (src/geom/pitlane.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../app/core/coreshell.js');
const PANEL = require('../app/core/panel.js');
const { buildPitLane } = require('../src/geom/pitlane.js');
const { buildPath } = require('../src/geom/index.js');
const { SLOT_HALF_LENGTH } = require('../src/markers/layout.js');

const LANE = (boxes, boxSpacingM = 24, o = {}) => ({ side: 'R', leave: { word: 'p1', along: 100 }, rejoin: { word: 'p1', along: 900 }, offsetM: 7.5, width: 10, divergeM: 79, mergeM: 79, speedKmh: 80, boxes, boxSpacingM, ...o });
async function track(lane) {
  const s = await createCoreShell({ storage: null, autosaveMs: 0, brushFn: null });
  s.extend(PANEL.extendOptions({ length: 1200, turn: 0, width: 24, empty: true }));
  s.setPitLane(lane);
  assert.ok(s.getState().history.present.pitLane, s.getState().message);
  return s;
}
/** The boxes in lane s, and the lane's usable straight [a, b] (the end of the entry taper to the start of the exit taper), from the lane the export builds. */
function boxes(s) {
  const st = s.getState(), d = st.history.present, sr = st.resolved;
  const p0 = buildPath(sr.segments, { step: 2, closed: !!d.closed, ...(sr.start ? { start: sr.start } : {}) }), p = sr.lift ? sr.lift(p0) : p0;
  const { boxes: n, boxSpacingM, ...road } = d.pitLane, lane = buildPitLane(p, sr.segments, road);
  const len = (part) => lane.segments.find((g) => g.part === part).length, a = len('in'), b = a + len('body');
  const info = s.spawnsInfo();
  const pits = info.placed.filter((m) => /^AC_PIT_\d+$/.test(m.name)).sort((x, y) => x.n - y.n);
  return { info, pits, a, b, mid: lane.path.lengthM / 2, n, gap: boxSpacingM };
}

test('the row no longer starts at the lane\'s midpoint: pit 1 (AC_PIT_0) is the first box after the entry, and each next box is further on', async () => {
  const { pits, mid, gap } = boxes(await track(LANE(6)));
  assert.ok(Math.abs(pits[0].s - mid) > gap, `AC_PIT_0 at lane s ${pits[0].s.toFixed(2)}, the lane's midpoint is ${mid.toFixed(2)}`);
  for (let k = 1; k < pits.length; k++) assert.ok(Math.abs(pits[k].s - pits[k - 1].s - gap) < 1e-9, `AC_PIT_${k} is ${gap} m after AC_PIT_${k - 1}`);
});

for (const n of [2, 6, 12]) {
  test(`${n} boxes: the gap before the first box equals the gap after the last (within one spacing), and no box stands on a taper`, async () => {
    const { pits, a, b, gap } = boxes(await track(LANE(n)));
    assert.equal(pits.length, n);
    const before = pits[0].s - SLOT_HALF_LENGTH - a, after = b - (pits[n - 1].s + SLOT_HALF_LENGTH);
    assert.ok(Math.abs(before - after) <= gap, `gap before ${before.toFixed(2)} m, after ${after.toFixed(2)} m`);
    for (const m of pits) assert.ok(m.s - SLOT_HALF_LENGTH >= a - 1e-6 && m.s + SLOT_HALF_LENGTH <= b + 1e-6, `${m.name} at lane s ${m.s.toFixed(2)} is outside the straight [${a.toFixed(2)}, ${b.toFixed(2)}]`);
  });
}

test('the boxes stand on the lane, with the count asked for, and the checks pass', async () => {
  for (const n of [2, 6, 12]) {
    const { info, pits } = boxes(await track(LANE(n)));
    for (const m of pits) { assert.equal(m.error, undefined, `${m.name}: ${m.error}`); assert.equal(m.onLane, true); assert.ok(Array.isArray(m.pos)); }
    const bad = info.check.checks.filter((c) => !c.ok);
    assert.deepEqual(bad.map((c) => [c.id, c.problems]), [], `${n} boxes`);
    assert.ok(!(info.check.amber || []).some((x) => x.id === 'pit-boxes-on-taper'));
  }
});

test('a row longer than the lane\'s straight is still centred, and an amber says the end boxes stand on the tapers', async () => {
  const { info, pits, a, b, gap } = boxes(await track(LANE(30, 24)));
  const before = pits[0].s - SLOT_HALF_LENGTH - a, after = b - (pits[pits.length - 1].s + SLOT_HALF_LENGTH);
  assert.ok(before < 0 && after < 0 && Math.abs(before - after) <= gap, `before ${before.toFixed(2)}, after ${after.toFixed(2)}`);
  assert.ok((info.check.amber || []).some((x) => x.id === 'pit-boxes-on-taper'), JSON.stringify(info.check.amber));
});
