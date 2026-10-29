// widths.test.js: node --test test/widths.test.js
// D232: src/doc/widths.json, the width reference behind Extend's "width like…" drop-down. Rows:
//   1  well-formed: its schema, every figure a finite number, every band ordered (p10 ≤ median ≤ p90), narrowest first
//   2  NUMBERS ONLY: a name and three figures (and a count and a flag) per entry, no path, no station, no shape, nothing else
//   3  pinned: the measured table, median and the 10th to 90th percentile in whole metres, entry by entry
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..'), FILE = path.join(REPO, 'src/doc/widths.json');
const W = JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('row 1: the width reference is well-formed: finite numbers, ordered bands, narrowest first', () => {
  assert.equal(W.schema, 't180b.widths/1'); assert.ok(W.tracks.length > 0);
  for (const t of W.tracks) {
    for (const k of ['median_m', 'p10_m', 'p90_m', 'stations']) assert.ok(Number.isFinite(t[k]) && t[k] > 0, `${t.name}.${k}`);
    assert.ok(t.p10_m <= t.median_m && t.median_m <= t.p90_m, `${t.name}: ${t.p10_m} / ${t.median_m} / ${t.p90_m}`); assert.equal(typeof t.read_closes, 'boolean');
  }
  const med = W.tracks.map((t) => t.median_m); assert.deepEqual(med, med.slice().sort((a, b) => a - b), 'narrowest first');
});

test('row 2: NUMBERS ONLY: a name, three widths, a station count and a flag per entry; no path, no coordinates, nothing from a read', () => {
  assert.deepEqual(Object.keys(W).sort(), ['method', 'schema', 'tracks']);
  for (const t of W.tracks) assert.deepEqual(Object.keys(t).sort(), ['median_m', 'name', 'p10_m', 'p90_m', 'read_closes', 'stations'], t.name);
  const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(!/[\\]|[A-Za-z]:\/|\bUsers\b|reads\/|\.read\.json|\[\s*-?\d/.test(text.replace(/"method":[^\n]*\n/, '')), 'no path, no read file name, no array of numbers (a station or a shape)');
  for (const t of W.tracks) assert.ok(/^[A-Za-z0-9][A-Za-z0-9 ()\-]*$/.test(t.name), `a plain name: ${t.name}`);
  const shown = W.tracks.filter((t) => t.read_closes).map((t) => `${t.median_m}|${t.p10_m}|${t.p90_m}`); assert.equal(new Set(shown).size, shown.length, 'no two entries the drop-down shows share a label');
});

test('row 3: the measured table, pinned entry by entry: name, median and the 10th to 90th percentile in whole metres, and whether its read closed', () => {
  const want = [['21 m road', 21, 18, 25, false], ['22 m road', 22, 21, 25, true], ['24 m road', 24, 21, 28, true], ['29 m road', 29, 28, 32, true], ['29 m road', 29, 28, 31, true],
    ['30 m road', 30, 29, 34, true], ['30 m road', 30, 30, 33, true], ['31 m road', 31, 29, 36, true], ['32 m road', 32, 31, 35, true], ['33 m road', 33, 32, 38, true],
    ['34 m road', 34, 32, 53, false], ['34 m road', 34, 32, 56, true], ['34 m road', 34, 32, 38, true], ['38 m road', 38, 29, 53, true], ['39 m road', 39, 36, 45, true],
    ['39 m road', 39, 36, 46, true], ['41 m road', 41, 36, 48, true], ['45 m road', 45, 35, 90, true]];
  assert.deepEqual(W.tracks.map((t) => [t.name, t.median_m, t.p10_m, t.p90_m, t.read_closes]), want);
  assert.equal(W.tracks.filter((t) => !t.read_closes).length, 2, 'the two reads that stopped at their limit are KEPT in the file, flagged read_closes: false (the drop-down is what filters them)');
});
