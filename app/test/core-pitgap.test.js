// core-pitgap.test.js: node --test app/test/core-pitgap.test.js
// THE PIT LANE'S SMALLEST GAP FROM THE ROAD (D677, pane A's A0 hand-back): the shell took a gap of 0, and the export then refused the lane on any road
// (on a flat 300 m straight: the lane's run meets the road along the shared edge line, and the downforce ray falls between them). Measured on synthetic
// roads (flat, a 15° cup, the default font, turning 90°, a 30° cup, a 25° edge; both sides): red at 0, 0.005 and 0.01 m, clean from 0.02 m. The panel
// now refuses a gap under PIT_GAP_MIN_M (src/doc/pitlane.js), by name, and every gap it accepts exports. Stored documents are untouched (a file with a gap
// of 0 still loads, as before).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const D = require('../../src/core/document.js');
const PL = require('../../src/doc/pitlane.js');
const AD = require('../../src/core/adapter.js');
const MESH = require('../../src/geom/mesh.js');
const PLX = require('../../src/export/pitlane.js');

// the synthetic control: a flat straight 300 m long, 30 m wide, cup 0, laid as the panel sends it
async function flatStraight() {
  const s = await createCoreShell({ brushFn: null });
  const o = extendOptions({ length: '300', turn: '0', climb: '0', bank: '0', width: '30', cup: '0', edge: '', edgeR: '', start: '', tube: '', grip: '', atStart: {}, empty: true, turnAs: 'rate', head: s.headState() });
  s.extend(o);
  assert.equal(s.getState().history.present.pieces.length, 1, s.getState().message);
  return s;
}
const lane = (s, offsetM) => ({ side: 'R', leave: { word: s.getState().history.present.pieces[0].id, along: 40 }, rejoin: { word: s.getState().history.present.pieces[0].id, along: 260 },
  offsetM, width: 8, divergeM: 60, mergeM: 56, speedKmh: 80, boxes: 1, boxSpacingM: 10 });
// the export's own check of the lane (src/export/pitlane.js laneForExport, self-check on): its red rows
function laneRed(doc) {
  const { segments, path } = AD.toPath(doc, { step: 1 }), mm = MESH.buildMesh(path, segments, {});
  const { boxes, boxSpacingM, ...road } = doc.pitLane;
  return PLX.laneForExport(path, segments, mm, road, { selfCheck: true }).red;
}

test('every pit-lane gap the panel accepts on the flat control exports with no red', async () => {
  for (const g of [0, 0.005, 0.01, 0.05, 0.1, 0.5, 2]) {
    const s = await flatStraight();
    s.setPitLane(lane(s, g));
    const doc = s.getState().history.present;
    if (!doc.pitLane) continue;   // refused: nothing to export
    const red = laneRed(doc);
    assert.equal(red.length, 0, `gap ${g} m was accepted and the export finds ${red.length} red (${red.slice(0, 2).map((r) => r.reason).join(', ')})`);
  }
});

test('a gap of 0 is refused by name: the message gives the smallest gap, and the document is unchanged', async () => {
  const s = await flatStraight(), before = s.getState().history.present;
  s.setPitLane(lane(s, 0));
  const st = s.getState();
  assert.equal(st.history.present, before, 'the document changed');
  assert.equal(st.history.present.pitLane, undefined);
  assert.match(String(st.message), /gap from the road/);
  assert.match(String(st.message), new RegExp(`${PL.PIT_GAP_MIN_M} m`));
});

test('a gap just under the smallest is refused; the smallest itself is laid', async () => {
  assert.ok(Number.isFinite(PL.PIT_GAP_MIN_M) && PL.PIT_GAP_MIN_M > 0, `PIT_GAP_MIN_M ${PL.PIT_GAP_MIN_M}`);
  const s = await flatStraight();
  s.setPitLane(lane(s, PL.PIT_GAP_MIN_M - 0.01));
  assert.equal(s.getState().history.present.pitLane, undefined, 'a gap under the smallest was laid');
  s.setPitLane(lane(s, PL.PIT_GAP_MIN_M));
  assert.equal(s.getState().history.present.pitLane.offsetM, PL.PIT_GAP_MIN_M, s.getState().message);
});

test('an existing lane whose gap is set to 0 keeps its old gap, and is still removed by unticking', async () => {
  const s = await flatStraight();
  s.setPitLane(lane(s, 12));
  const kept = s.getState().history.present;
  s.setPitLane({ ...kept.pitLane, offsetM: 0 });
  assert.equal(s.getState().history.present, kept);
  s.setPitLane(null);
  assert.equal(s.getState().history.present.pitLane, undefined);
});

test('a stored document whose lane has a gap of 0 still loads, gap and all (stored data is not re-judged)', async () => {
  const s = await flatStraight(), d = s.getState().history.present;
  const stored = { ...d, pitLane: lane(s, 0) };
  const back = D.checkDoc(stored);
  assert.equal(back.pitLane.offsetM, 0);
  s.adopt(back);
  assert.equal(s.getState().history.present.pitLane.offsetM, 0);
});
