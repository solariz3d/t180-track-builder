// vocabgen.test.js: node --test test/vocabgen.test.js. The generator's mechanics, on a FIXTURE in corpus.json's shape
// (test/fixtures/corpus.fixture.json: round numbers, not measurements). Whether the generated words fit the REAL library
// is test/vocab-corpus.test.js, on src/doc/corpus.json.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generate, CorpusError } = require('../src/doc/vocabgen.js');
const FIX = require('./fixtures/corpus.fixture.json');

const DEG = Math.PI / 180;
const copy = (o) => JSON.parse(JSON.stringify(o));
/** The same corpus with every object's keys in reverse order. */
const reversed = (o) => (Array.isArray(o) ? o.map(reversed) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, reversed(v)])) : o);

test('the generator is deterministic: the same corpus gives the same vocabulary, whatever its key order', () => {
  assert.deepEqual(generate(FIX), generate(copy(FIX)));
  assert.deepEqual(generate(reversed(FIX)), generate(FIX));
});

test('every default is a median: a curved piece\'s size from the median CORNER, the straight\'s and the wall-ride\'s from the median RUN, the shape from the median WORD', () => {
  const v = generate(FIX), C = FIX.classes, RU = FIX.runs, CO = FIX.corners;
  assert.deepEqual([v.words.tight.turn, v.words.turn.turn, v.words.sweep.turn], [CO.tight.heading_deg.p50 * DEG, CO.turn.heading_deg.p50 * DEG, CO.sweep.heading_deg.p50 * DEG], 'size: the corners');
  assert.deepEqual([v.words.straight.length, v.words['wall-ride'].turn], [RU.straight.length_m.p50, RU['wall-ride'].heading_deg.p50 * DEG], 'size: the runs');
  assert.deepEqual([v.words.turn.R, v.words.turn.width, v.words.turn.bank], [C.turn.radius_m.p50, C.turn.width_m.p50, C.turn.bank_deg.p50 * DEG], 'shape: the words');
  assert.deepEqual([v.words['wall-ride'].R, v.words.inversion.width, v.words.jump.gap, v.words.jump.drop],
    [C['wall-ride'].radius_m.p50, C.inversion.width_m.p50, C.jump.gap_m.p50, C.jump.drop_m.p50]);
});

test('the bands are the p10, p50, p90 of a piece\'s size: a corner\'s total turn, the straight\'s run length, and the jump\'s gap', () => {
  const v = generate(FIX);
  assert.deepEqual(Object.values(v.bands.tight).map((b) => Math.round(b.turn / DEG)), [32, 88, 256]);
  assert.deepEqual(Object.values(v.bands.straight).map((b) => b.length), [16, 48, 224]);
  assert.deepEqual(Object.keys(v.bands).sort(), ['jump', 'straight', 'sweep', 'tight', 'turn', 'wall-ride']);
  assert.deepEqual(Object.values(v.bands.jump).map((b) => b.gap), [81, 125, 206]);
});

test('the default font is the family the class uses most: bowl and bowl+ count as the bowl, pipe and pipe+ as the half-pipe', () => {
  const f = copy(FIX);
  f.classes.straight.shape = { flat: 0.3, bowl: 0.15, 'bowl+': 0.1, pipe: 0.2, 'pipe+': 0.25 };   // half-pipe .45 > flat .3 > bowl .25
  assert.equal(generate(f).words.straight.font, 'half-pipe');
  assert.equal(generate(FIX).words.straight.font, 'bowl', 'the fixture\'s straights are mostly bowl, so not flat');
  f.classes.straight.shape = { flat: 0.4, bowl: 0.25, 'bowl+': 0.35 };   // only bowl+ makes the bowl (.6) beat flat (.4)
  assert.equal(generate(f).words.straight.font, 'bowl');
});

test('each class carries its font families\' measured shares, normalised: bowl and bowl+, pipe and pipe+ pooled', () => {
  const s = generate(FIX).words.tight.fontShares, sh = FIX.classes.tight.shape, t = Object.values(sh).reduce((a, x) => a + x, 0);
  assert.deepEqual(Object.keys(s), ['bowl', 'half-pipe', 'flat']);
  assert.ok(Math.abs(s['half-pipe'] - ((sh.pipe || 0) + (sh['pipe+'] || 0)) / t) < 1e-12 && Math.abs(s.bowl + s['half-pipe'] + s.flat - 1) < 1e-12);
});

test('a tie between fonts goes to the fixed order (bowl, half-pipe, flat), never to key order', () => {
  const f = copy(FIX); f.classes.sweep.shape = { flat: 0.5, pipe: 0.5 };
  const g = copy(f); g.classes.sweep.shape = { pipe: 0.5, flat: 0.5 };
  assert.deepEqual([generate(f).words.sweep.font, generate(g).words.sweep.font], ['half-pipe', 'half-pipe']);
});

test('grammar suggestions come from the observed transitions, most seen first, with their shares', () => {
  const g = generate(FIX).grammar;
  assert.deepEqual(g.turn.map((s) => s.to), ['sweep', 'tight', 'straight', 'turn', 'wall-ride', 'jump', 'inversion']);
  assert.equal(g.turn[0].n, 360);
  assert.ok(Math.abs(g.turn.reduce((a, s) => a + s.share, 0) - 1) < 1e-12);
  assert.ok(!g.straight.some((s) => s.to === 'straight'), 'a transition never observed is never suggested');
});

test('a corpus with no transitions gives no grammar (null), not a guessed one', () => {
  const f = copy(FIX); delete f.transitions;
  assert.equal(generate(f).grammar, null);
});

test('a malformed corpus is refused by name: a missing quantity, bands out of order, an unknown shape or class', () => {
  const miss = copy(FIX); delete miss.classes.tight.radius_m;
  assert.throws(() => generate(miss), (e) => e instanceof CorpusError && /tight\.radius_m is missing/.test(e.message));
  const corner = copy(FIX); delete corner.corners.turn.heading_deg;
  assert.throws(() => generate(corner), /corners\.turn\.heading_deg is missing/);
  const run = copy(FIX); delete run.runs.straight.length_m;
  assert.throws(() => generate(run), /runs\.straight\.length_m is missing/);
  const order = copy(FIX); order.classes.turn.width_m.p10 = 99;
  assert.throws(() => generate(order), /turn\.width_m: p10 99 > p50 33/);
  const shape = copy(FIX); shape.classes.turn.shape.tube = 0.1;
  assert.throws(() => generate(shape), /"tube" is not a reader shape/);
  const cls = copy(FIX); cls.transitions.turn.counts.wall = 3;
  assert.throws(() => generate(cls), /"wall" is not a class/);
  assert.throws(() => generate({}), /not a corpus/);
});
