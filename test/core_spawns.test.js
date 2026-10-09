// core_spawns.test.js: node --test test/core_spawns.test.js
// SPAWNS ON THE DOCUMENT (the keeper, 2026-10-09: "move the start line around the first piece … a numbered grid … a hotlap spawn I plop down").
// A core document may carry `spawns`: the start line's distance into the FIRST piece, the grid pack (count, row and column spacing) and an optional
// hotlap spawn (a piece id and a distance into it). A track that never had one carries NO field, so every track made before saves byte for byte as before.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const SC = require('../src/core/sculpt.js');

const two = () => extend(extend(D.createDoc('s'), { length: 300, family: 'bowl' }), { length: 200 });
const SP = { line: { along: 120 }, grid: { count: 8, rowGapM: 16, colGapM: 6 } };

test('a document without spawns saves exactly as before: no spawns field in memory or in the file', () => {
  const d = two();
  assert.equal(d.spawns, undefined);
  assert.ok(!/spawns/.test(D.serialize(d)));
  assert.equal(D.serialize(D.parse(D.serialize(d))), D.serialize(d));
});

test('setSpawns stores the line, the grid and a hotlap, and they survive save and open', () => {
  const d = D.setSpawns(two(), { ...SP, hotlap: { piece: 'p2', along: 150 } });
  const back = D.parse(D.serialize(d));
  assert.deepEqual(back.spawns, { line: { along: 120 }, grid: { count: 8, rowGapM: 16, colGapM: 6 }, hotlap: { piece: 'p2', along: 150 } });
  assert.equal(D.serialize(back), D.serialize(d), 'canonical: saving the opened file gives the same text');
});

test('setSpawns(doc, null) removes the field, back to the export placing the start itself', () => {
  const d = D.setSpawns(D.setSpawns(two(), SP), null);
  assert.equal(d.spawns, undefined);
  assert.equal(D.serialize(d), D.serialize(two()));
});

test('spawns are quantised to the millimetre like every other distance', () => {
  const d = D.setSpawns(two(), { line: { along: 12.345678 }, grid: { count: 2, rowGapM: 16.00004, colGapM: 6 } });
  assert.equal(d.spawns.line.along, 12.3457);
  assert.equal(d.spawns.grid.rowGapM, 16);
});

test('bad spawns are refused by name: a negative line, a fractional or zero count, a zero gap, an unknown field', () => {
  const bad = (sp, re) => assert.throws(() => D.setSpawns(two(), sp), (e) => e.code === 'BAD_SPAWNS' && re.test(e.message));
  bad({ ...SP, line: { along: -1 } }, /line\.along/);
  bad({ ...SP, grid: { ...SP.grid, count: 2.5 } }, /grid\.count/);
  bad({ ...SP, grid: { ...SP.grid, count: 0 } }, /grid\.count/);
  bad({ ...SP, grid: { ...SP.grid, count: D.SPAWN_COUNT_MAX + 1 } }, /grid\.count/);
  bad({ ...SP, grid: { ...SP.grid, colGapM: 0 } }, /grid\.colGapM/);
  bad({ ...SP, hotlap: { piece: '', along: 3 } }, /hotlap\.piece/);
  bad({ ...SP, pits: {} }, /unknown field "pits"/);
});

test('a file with bad spawns does not open: the error says which field', () => {
  const text = D.serialize(D.setSpawns(two(), SP)).replace('"count":8', '"count":-3');
  assert.throws(() => D.parse(text), (e) => e.code === 'BAD_SPAWNS' && /grid\.count/.test(e.message));
});

test('edits keep the spawns: extend, and a sculpt of the first piece', () => {
  const d = D.setSpawns(two(), SP);
  assert.deepEqual(extend(d, { length: 50 }).spawns, d.spawns);
  for (const opt of [{ mode: 'value', channel: 'phi', s0: 150, r: 60, delta: 0.1 }, { mode: 'hill', s0: 150, r: 60, delta: 3 }]) {
    assert.deepEqual(SC.brush(d, opt).doc.spawns, d.spawns, JSON.stringify(opt));
  }
});

test('a hotlap on a piece that no longer exists does not block an edit (the export reports it instead)', () => {
  const d = D.setSpawns(two(), { ...SP, hotlap: { piece: 'p9', along: 10 } });
  assert.equal(d.spawns.hotlap.piece, 'p9');
  assert.equal(extend(d, { length: 10 }).spawns.hotlap.piece, 'p9');
});
