// Tests for src/doc/corpus.json, the measured corpus (D182; docs/FINDINGS.md §7f): well-formed, every band ordered
// (p10 ≤ median ≤ p90), and numbers only: no string beyond its method notes and the track names FINDINGS already uses
// (ARCHITECTURE §11.6). Run: node --test --test-concurrency=4 test/corpus.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const C = JSON.parse(fs.readFileSync(path.join(REPO, 'src/doc/corpus.json'), 'utf8'));
const FINDINGS = fs.readFileSync(path.join(REPO, 'docs/FINDINGS.md'), 'utf8');
const ROAD = ['straight', 'sweep', 'turn', 'tight', 'wall-ride', 'inversion'];
const isBand = (b) => b && typeof b === 'object' && ['p10', 'p50', 'p90', 'n'].every((k) => Number.isFinite(b[k]));
/** Every band in a class, named by its path. */
function bands(o, at = '') {
  const out = [];
  if (isBand(o)) return [[at, o]];
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) out.push(...bands(v, at ? `${at}.${k}` : k));
  return out;
}

test('the corpus is well-formed: its schema, the road classes and the jump, each with n > 0 and its tracks counted', () => {
  assert.strictEqual(C.schema, 't180b.corpus/1');
  assert.deepStrictEqual(Object.keys(C.classes).sort(), [...ROAD, 'jump'].sort());
  for (const [k, c] of Object.entries(C.classes)) {
    assert.ok(Number.isInteger(c.n) && c.n > 0, `${k}: n`);
    assert.strictEqual(Object.values(c.byTrack).reduce((a, x) => a + x, 0), c.n, `${k}: the tracks' counts add up to n`);
  }
  for (const k of ROAD) for (const f of ['length_m', 'heading_deg', 'width_m', 'bank_deg', 'climb_deg', 'climb_m']) assert.ok(isBand(C.classes[k][f]), `${k}.${f}`);
  for (const k of ROAD.filter((x) => x !== 'straight')) assert.ok(isBand(C.classes[k].radius_m), `${k}.radius_m`);
  assert.ok(isBand(C.classes.jump.gap_m) && isBand(C.classes.jump.drop_m));
});

test('every band is ordered: p10 ≤ median ≤ p90, in every class and every figure', () => {
  let count = 0;
  for (const [k, c] of Object.entries(C.classes)) for (const [at, b] of bands(c)) {
    assert.ok(b.p10 <= b.p50 && b.p50 <= b.p90, `${k}.${at}: ${b.p10} / ${b.p50} / ${b.p90}`);
    count++;
  }
  assert.ok(count > 60, `${count} bands checked`);
});

test('the shape and slope shares of each road class add up to 1', () => {
  for (const k of ROAD) for (const f of ['shape', 'slope']) {
    const sum = Object.values(C.classes[k][f]).reduce((a, x) => a + x, 0);
    assert.ok(Math.abs(sum - 1) < 0.005, `${k}.${f}: ${sum}`);
  }
});

test('numbers only: every string is a method note or a track name that docs/FINDINGS.md already uses', () => {
  const strings = [], keys = [];
  (function walk(o) { if (typeof o === 'string') strings.push(o); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } })(C);
  const notes = new Set([C.schema, C.what, C.method]);
  const names = new Set([...strings.filter((s) => !notes.has(s)), ...Object.values(C.classes).flatMap((c) => Object.keys(c.byTrack)), ...Object.keys(C.sharedWordsSkipped)]);
  for (const n of names) assert.ok(FINDINGS.includes(n.replace(/ \(short\)$/, '')), `"${n}" is not a name FINDINGS uses`);
  assert.ok(!strings.some((s) => /^(flat|bowl|pipe)-|JUMP\(/.test(s)), 'no word of any track');
});

test('the corpus is what tools/corpus.cjs makes from the reads, when the reads are here (reads/ is not in the repo)', (t) => {
  const reads = path.join(REPO, 'reads');
  if (!fs.existsSync(path.join(reads, 'sakura_speedway.read.json'))) { t.skip('no reads/ on this machine: FINDINGS §7f has the commands that make them'); return; }
  const { build } = require('../tools/corpus.cjs');
  assert.deepStrictEqual(build(reads), C);
});

// ── D182 addition: RUNS of same-class words, whole CORNERS, and the TRANSITIONS between runs ──
test('runs and corners are well-formed: n > 0, ordered bands, and no more runs than words', () => {
  for (const [k, r] of Object.entries(C.runs)) {
    assert.ok(Number.isInteger(r.n) && r.n > 0 && r.n <= C.classes[k].n, `${k}: ${r.n} runs of ${C.classes[k].n} words`);
    for (const [at, b] of bands(r)) assert.ok(b.p10 <= b.p50 && b.p50 <= b.p90, `runs.${k}.${at}`);
    assert.ok(r.words.p10 >= 1, `${k}: a run is at least one word`);
  }
  assert.deepStrictEqual(Object.keys(C.corners), ['sweep', 'turn', 'tight']);
  for (const [k, r] of Object.entries(C.corners)) { assert.ok(r.n > 0, `corners.${k}`); for (const [at, b] of bands(r)) assert.ok(b.p10 <= b.p50 && b.p50 <= b.p90, `corners.${k}.${at}`); }
});
test('each row of the transition probabilities sums to 1, and its counts to its n', () => {
  for (const [k, row] of Object.entries(C.transitions)) {
    const p = Object.values(row.p).reduce((a, v) => a + v, 0), c = Object.values(row.counts).reduce((a, v) => a + v, 0);
    assert.ok(Math.abs(p - 1) < 0.001, `${k}: the probabilities sum to ${p}`);
    assert.strictEqual(c, row.n, `${k}: the counts sum to n`);
    for (const t of Object.keys(row.p)) assert.ok(t in C.classes, `${k} → ${t}: a known class`);
  }
});
