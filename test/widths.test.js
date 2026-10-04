// widths.test.js: node --test test/widths.test.js
// D232: src/doc/widths.json, the width reference behind Extend's "width like…" drop-down (tools/widths.cjs makes it from reads/*.read.json). Rows:
//   1  well-formed: its schema, one entry per layout the script lists, every figure a finite number, every band ordered (p10 ≤ median ≤ p90), narrowest first
//   2  NUMBERS ONLY: a track's name and three figures (and a count and a flag), no path, no station, no shape, nothing else
//   3  pinned anchors: the measured table the plan gave (Thunderhead 24 m (21–28), Nordic 38 (29–53), Aurora Medium 34 (32–56) …)
//   4  the corpus.json pattern: rebuilt from the reads it is byte-equal to the committed file WHEN every read is here; SKIPPED, not failed, when reads/ is
//      absent or partial (the BANK_RATE lesson: a clone with 13 of 53 reads reported a red that was the clone's, not the code's)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { LAYOUTS, build, missing } = require('../tools/widths.cjs');

const REPO = path.resolve(__dirname, '..'), FILE = path.join(REPO, 'src/doc/widths.json');
const W = JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('row 1: the width reference is well-formed: one entry per layout the script lists, finite numbers, ordered bands, narrowest first', () => {
  assert.equal(W.schema, 't180b.widths/1'); assert.equal(W.tracks.length, LAYOUTS.length);
  assert.deepEqual(W.tracks.map((t) => t.name).sort(), LAYOUTS.map(([, n]) => n).sort(), 'the names are the script\'s, each once');
  for (const t of W.tracks) {
    for (const k of ['median_m', 'p10_m', 'p90_m', 'stations']) assert.ok(Number.isFinite(t[k]) && t[k] > 0, `${t.name}.${k}`);
    assert.ok(t.p10_m <= t.median_m && t.median_m <= t.p90_m, `${t.name}: ${t.p10_m} / ${t.median_m} / ${t.p90_m}`); assert.equal(typeof t.read_closes, 'boolean');
  }
  const med = W.tracks.map((t) => t.median_m); assert.deepEqual(med, med.slice().sort((a, b) => a - b), 'narrowest first');
});

test('row 2: NUMBERS ONLY: a name, three widths, a station count and a flag per track; no path, no coordinates, nothing from a read', () => {
  assert.deepEqual(Object.keys(W).sort(), ['method', 'schema', 'tracks']);
  for (const t of W.tracks) assert.deepEqual(Object.keys(t).sort(), ['median_m', 'name', 'p10_m', 'p90_m', 'read_closes', 'stations'], t.name);
  const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(!/[\\]|[A-Za-z]:\/|\bUsers\b|reads\/|\.read\.json|\[\s*-?\d/.test(text.replace(/"method":[^\n]*\n/, '')), 'no path, no read file name, no array of numbers (a station or a shape)');
  for (const t of W.tracks) assert.ok(/^[A-Za-z0-9][A-Za-z0-9 ()\-]*$/.test(t.name), `a plain name: ${t.name}`);
  const FINDINGS = fs.readFileSync(path.join(REPO, 'docs/FINDINGS.md'), 'utf8');
  for (const t of W.tracks) assert.ok(FINDINGS.includes(t.name.replace(/ \(short\)$/, '').replace(/^(T-180 Test Track|The Bowltrack)$/, (m) => (m === 'The Bowltrack' ? 'Bowltrack' : 'Test Track'))), `${t.name}: FINDINGS uses the name`);
});

test('row 3: the measured table the plan gave, pinned: median and the 10th to 90th percentile in whole metres', () => {
  const want = { Thunderhead: [24, 21, 28], 'T-180 Bowl Track': [22, 21, 25], 'T-180 Test Track': [29, 28, 31], 'Hazen Loop': [29, 28, 32], Eagleton: [30, 29, 34], 'Eagleton (short)': [31, 29, 36], 'The Bowltrack': [30, 30, 33], Centrifuge: [31, 29, 36],
    'Sakura Speedway': [32, 31, 35], Coast: [33, 32, 38], 'Serpents Spiral': [34, 32, 38], Nordic: [38, 29, 53], 'Onuris Long': [39, 36, 45], 'Onuris Medium': [39, 36, 46], 'Onuris Short': [41, 36, 48], 'Rainbow Road': [45, 35, 90], Miandros: [21, 18, 25],
    'Aurora Medium': [34, 32, 56], 'Aurora Long': [34, 32, 53] };
  for (const [name, [m, a, b]] of Object.entries(want)) { const t = W.tracks.find((x) => x.name === name); assert.ok(t, name); assert.deepEqual([t.median_m, t.p10_m, t.p90_m], [m, a, b], name); }
  assert.deepEqual(W.tracks.filter((t) => !t.read_closes).map((t) => t.name).sort(), ['Aurora Long', 'Miandros'], 'the two reads that stopped at their limit are flagged');
});

test('row 4: the committed file is what tools/widths.cjs makes from the reads, byte for byte, when every read is here (skipped, never failed, when reads/ is absent or partial)', (t) => {
  const reads = path.join(REPO, 'reads');
  if (!fs.existsSync(reads)) { t.skip('no reads/ on this machine: FINDINGS §7f has the commands that make them'); return; }
  const gone = missing(reads);
  if (gone.length) { t.skip(`reads/ is partial here (${gone.length} of ${LAYOUTS.length} missing, e.g. ${gone[0]}): a partial set rebuilds a different file, which is the clone's gap and not the code's`); return; }
  const made = JSON.stringify(build(reads), null, 1) + '\n';
  assert.equal(fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'), made, 'src/doc/widths.json is not what `node tools/widths.cjs reads > src/doc/widths.json` makes');
  assert.deepStrictEqual(build(reads), W);
});

test('row 4 control: the skip is for MISSING reads only: an empty or partial directory names what is missing, and a full one names nothing', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 't180b-widths-'));
  try {
    assert.equal(missing(tmp).length, LAYOUTS.length, 'an empty directory misses them all'); assert.throws(() => build(tmp), /ENOENT|no such file/i, 'build refuses an empty directory');
    fs.writeFileSync(path.join(tmp, `${LAYOUTS[0][0]}.read.json`), '{}'); assert.equal(missing(tmp).length, LAYOUTS.length - 1, 'one present, the rest missing');
    assert.throws(() => build(tmp), 'build refuses a partial set rather than writing a different file');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
