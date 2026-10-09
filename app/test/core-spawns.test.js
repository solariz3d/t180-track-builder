// core-spawns.test.js: node --test app/test/core-spawns.test.js
// THE HAND-PLACED START (the keeper, 2026-10-09): the start line moved along the FIRST piece, a numbered grid pack with its spacing, and a hotlap spawn put
// down by hand. The shell (app/core/coreshell.js setSpawns, spawnsInfo, spawnsLayout) and the real exporter, headless, on a closed bowl lap.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { createCoreShell } = require('../core/coreshell.js');
const { makeExporter } = require('../export/export.js');
const { speedAfterM } = require('../../src/markers/layout.js');

const REPO = path.resolve(__dirname, '..', '..');
const R = 180, Q = Math.PI * R / 2;
let EX = null;
async function closedLap() {
  EX = EX || await makeExporter(async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));
  const s = await createCoreShell({ brushFn: null, exporter: EX });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  s.close();
  assert.equal(s.getState().history.present.closed, true);
  return s;
}
const GRID = { count: 6, rowGapM: 16, colGapM: 6 };
const at = (placed, name) => placed.find((m) => m.name === name);
const exported = (s) => s.buildExport().result.markers;   // the export's placed markers (an array)

test('the start line sits where it is put on the first piece, and the export writes it there', async () => {
  const s = await closedLap();
  s.setSpawns({ line: { along: 120 }, grid: GRID });
  const info = s.spawnsInfo();
  assert.equal(info.check.ok, true, JSON.stringify(info.check.checks.filter((c) => c.problems.length)));
  assert.ok(Math.abs(at(info.placed, 'AC_TIME_0_L').s - 120) < 1e-6);
  assert.ok(Math.abs(at(exported(s), 'AC_TIME_0_L').s - 120) < 1e-6, 'the export uses the hand-placed line');
});

test('the grid is numbered from pole, two staggered columns with the pack\'s spacing behind the line', async () => {
  const s = await closedLap();
  s.setSpawns({ line: { along: 150 }, grid: GRID });
  const slots = s.spawnsInfo().placed.filter((m) => m.name.startsWith('AC_START_'));
  assert.deepEqual(slots.map((m) => m.name), ['AC_START_0', 'AC_START_1', 'AC_START_2', 'AC_START_3', 'AC_START_4', 'AC_START_5']);
  assert.deepEqual(slots.map((m) => Math.round(m.s)), [140, 132, 124, 116, 108, 100], 'pole 10 m back, a slot every rowGap/2 along');
  assert.deepEqual(slots.map((m) => m.u), [3, -3, 3, -3, 3, -3], 'columns colGap apart, pole on the left');
});

test('stretching the pack spreads the slots: rowGap and colGap are the pack\'s length and width', async () => {
  const s = await closedLap();
  s.setSpawns({ line: { along: 200 }, grid: { count: 4, rowGapM: 30, colGapM: 10 } });
  const slots = s.spawnsInfo().placed.filter((m) => m.name.startsWith('AC_START_'));
  assert.deepEqual(slots.map((m) => Math.round(m.s)), [190, 175, 160, 145]);
  assert.deepEqual(slots.map((m) => m.u), [5, -5, 5, -5]);
});

test('the line is clamped to the first piece: a distance past its end puts the line at its end', async () => {
  const s = await closedLap();
  s.setSpawns({ line: { along: 9999 }, grid: GRID });
  const info = s.spawnsInfo();
  assert.ok(Math.abs(at(info.placed, 'AC_TIME_0_L').s - info.firstLength) < 1e-6, `line at ${at(info.placed, 'AC_TIME_0_L').s}, first piece ${info.firstLength}`);
});

test('a hotlap put down by hand stands there and reports the speed it reaches by the line', async () => {
  const s = await closedLap();
  s.setSpawns({ line: { along: 120 }, grid: GRID, hotlap: { piece: 'p1', along: 20 } });
  const h = at(s.spawnsInfo().placed, 'AC_HOTLAP_START_0');
  assert.ok(Math.abs(h.s - 20) < 1e-6);
  assert.equal(h.speedKmh, Math.round(speedAfterM(100) * 3.6));
  assert.ok(Math.abs(at(exported(s), 'AC_HOTLAP_START_0').s - 20) < 1e-6);
});

test('a hotlap AFTER the line on a closed lap gets the run all the way round to it', async () => {
  const s = await closedLap();
  s.setSpawns({ line: { along: 50 }, grid: { count: 2, rowGapM: 16, colGapM: 6 }, hotlap: { piece: 'p1', along: 250 } });
  const h = at(s.spawnsInfo().placed, 'AC_HOTLAP_START_0');
  assert.ok(h.runUpM > 1000, `run ${h.runUpM} m: round the lap to the line`);
});

test('a hotlap on a piece that no longer exists is reported as missing, not placed somewhere else', async () => {
  const s = await closedLap();
  s.setSpawns({ line: { along: 120 }, grid: GRID, hotlap: { piece: 'p99', along: 5 } });
  const info = s.spawnsInfo();
  assert.equal(at(info.placed, 'AC_HOTLAP_START_0'), undefined);
  assert.ok(info.missing.some((m) => /hotlap/.test(m.what)));
});

test('back to automatic: setSpawns(null) removes the field, and the export places the start itself again', async () => {
  const s = await closedLap(), auto = at(exported(s), 'AC_TIME_0_L').s;
  s.setSpawns({ line: { along: 33 }, grid: GRID });
  assert.ok(Math.abs(at(exported(s), 'AC_TIME_0_L').s - 33) < 1e-6);
  s.setSpawns(null);
  assert.equal(s.getState().history.present.spawns, undefined);
  assert.equal(s.spawnsInfo(), null);
  assert.ok(Math.abs(at(exported(s), 'AC_TIME_0_L').s - auto) < 1e-6);
});

test('placing the start is one undo step', async () => {
  const s = await closedLap();
  s.setSpawns({ line: { along: 120 }, grid: GRID });
  s.undo();
  assert.equal(s.getState().history.present.spawns, undefined);
});

test('a bad pack is refused in plain words and nothing changes', async () => {
  const s = await closedLap();
  s.setSpawns({ line: { along: 120 }, grid: { ...GRID, count: 0 } });
  assert.match(s.getState().message, /grid\.count/);
  assert.equal(s.getState().history.present.spawns, undefined);
});

test('the "grid on a straight" amber judges an equation piece by its curvature: quiet on the straight, still there on a curve', async () => {
  const s = await closedLap();
  s.setSpawns({ line: { along: 200 }, grid: GRID });   // the whole pack on the 300 m straight
  assert.deepEqual(s.spawnsInfo().check.amber.filter((a) => a.id === 'grid-on-straight'), [], 'a grid on a dead-straight core piece does not warn');
  s.setSpawns({ line: { along: 5 }, grid: GRID });     // pole 10 m back: the pack spills back round the lap into the last, curving piece
  const curved = s.spawnsInfo().check.amber.filter((a) => a.id === 'grid-on-straight');
  assert.ok(curved.length > 0, 'slots on the curve still warn');
  assert.ok(curved.every((a) => /is on a core, not a straight/.test(a.text)));
});
