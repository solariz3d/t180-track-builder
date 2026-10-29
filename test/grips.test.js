// grips.test.js: node --test test/grips.test.js
// D261: src/doc/grips.json, the grip reference behind the "Grip like…" drop-down. Rows:
//   1  well-formed, in its order (the T-180 surfaces first, then the game's own tracks), every value a whole percent the Grip field takes (50 to 150)
//   2  numbers only: a name made from its figure, a key, the friction, its percent and value, and the basis; no path of any kind
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../src/core/document.js');

const FILE = path.join(__dirname, '..', 'src', 'doc', 'grips.json');
const G = JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('row 1: in its order, and every value is a whole percent the Grip field takes (50 to 150)', () => {
  assert.equal(G.tracks.length, 10);
  assert.deepEqual(G.tracks.slice(0, 4).map((t) => [t.name, t.value]), [['82 % grip', 82], ['100 % grip', 100], ['110 % grip', 110], ['99 % grip', 99]], 'the T-180 surfaces first');
  for (const t of G.tracks) {
    assert.ok(Number.isInteger(t.value) && t.value >= D.GRIP_MIN && t.value <= D.GRIP_MAX, `${t.name}: ${t.value}`);
    assert.equal(t.value, Math.round(t.percent)); assert.ok(Math.abs(t.percent - t.friction * 100) < 0.05, `${t.name}: the percent is the friction × 100`);
    assert.doesNotThrow(() => D.checkGrip(t.value), `${t.name}: the Grip field takes it`);
  }
});

test('row 2: numbers only: each row is named by its own figure and carries no path of any kind', () => {
  const text = fs.readFileSync(FILE, 'utf8');
  assert.deepEqual(Object.keys(G).sort(), ['note', 'tracks']);
  const labels = G.tracks.map((t) => `${t.name}|${t.value}`); assert.equal(new Set(labels).size, labels.length, 'no two entries share a label and a value');
  for (const t of G.tracks) {
    assert.deepEqual(Object.keys(t).sort(), ['basis', 'friction', 'key', 'name', 'percent', 'value']);
    assert.equal(t.name, `${Number.isInteger(t.percent) ? t.percent : Math.round(t.percent * 10) / 10} % grip`);
  }
  assert.ok(!/[A-Za-z]:[\\/]|\/Users\/|\\\\|steamapps|surfaces\.ini|content\/tracks/i.test(text), 'no path of any kind');
});
