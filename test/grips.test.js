// grips.test.js: node --test test/grips.test.js
// D261: src/doc/grips.json, the grip reference behind the "Grip like…" drop-down (tools/grips.cjs makes it from an AC folder's surfaces.ini files, read only).
// Rows:
//   1  well-formed, in the keeper's order (the T-180 tracks first, then Kunos's), every value a whole percent the Grip field takes (50 to 150)
//   2  numbers only: a name, a key, the friction, its percent and value, the source file (relative to the AC folder) and the basis; no private track
//   3  the committed file is what tools/grips.cjs makes from the AC folder, byte for byte, when one is given (T180_AC_ROOT; skipped, never failed, without one)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROWS, build } = require('../tools/grips.cjs');
const D = require('../src/core/document.js');

const FILE = path.join(__dirname, '..', 'src', 'doc', 'grips.json');
const G = JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('row 1: one entry per row the tool lists, in the keeper\'s order, and every value is a whole percent the Grip field takes (50 to 150)', () => {
  assert.deepEqual(G.tracks.map((t) => t.name), ROWS.map((r) => r[1]));
  assert.deepEqual(G.tracks.slice(0, 3).map((t) => t.name), ['Thunderhead', 'Aurora Cryopticon', 'Nordic'], 'Thunderhead, Aurora, Nordic first');
  for (const t of G.tracks) {
    assert.ok(Number.isInteger(t.value) && t.value >= D.GRIP_MIN && t.value <= D.GRIP_MAX, `${t.name}: ${t.value}`);
    assert.equal(t.value, Math.round(t.percent)); assert.ok(Math.abs(t.percent - t.friction * 100) < 0.05, `${t.name}: the percent is the friction × 100`);
    assert.doesNotThrow(() => D.checkGrip(t.value), `${t.name}: the Grip field takes it`);
  }
});

test('row 2: numbers only, sourced: each row names its key and its file relative to the AC folder; no private track and no absolute path', () => {
  const text = fs.readFileSync(FILE, 'utf8');
  for (const t of G.tracks) {
    assert.deepEqual(Object.keys(t).sort(), ['basis', 'friction', 'key', 'name', 'percent', 'source', 'value']);
    assert.match(t.source, /^(content\/tracks\/[^:]+\/data\/surfaces\.ini \(KEY=[^)]+\)|system\/data\/surfaces\.ini \(KEY=ROAD: .+ does not redefine ROAD\))$/, t.source);
  }
  // a private project's track is never listed: the file holds exactly the tool's closed list of rows (row 1 pins the names), and nothing else
  assert.deepEqual(G.tracks.map((t) => t.source.replace(/ \(KEY=.*$/, '')).filter((s) => s.startsWith('content/')).map((s) => s.split('/')[2]), ROWS.filter((r) => G.tracks.find((t) => t.name === r[1]).source.startsWith('content/')).map((r) => r[0].split('/')[0]), 'every content file is one of the listed tracks');
  assert.ok(!/[A-Za-z]:[\\/]|\/Users\/|\\\\|steamapps/i.test(text), 'no absolute or personal path');
});

test('row 3: the committed file is what tools/grips.cjs makes from the AC folder, byte for byte (skipped without T180_AC_ROOT)', (t) => {
  const root = process.env.T180_AC_ROOT;
  if (!root || !fs.existsSync(path.join(root, 'system', 'data', 'surfaces.ini'))) { t.skip('no AC folder given (T180_AC_ROOT): the committed numbers are pinned by rows 1 and 2'); return; }
  assert.equal(fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'), JSON.stringify(build(root), null, 1) + '\n');
});
