// vocab-corpus.test.js: node --test test/vocab-corpus.test.js. The built-in words against the MEASURED library
// (src/doc/corpus.json, E's reads, FINDINGS §7f). The D182 plan's acceptance line: "a built-in piece at default handles
// falls outside the library's 10th–90th percentile for its class" is a FAIL. Measured on the geometry the word builds
// (src/geom/path.js), not only on its handles.
//
// NOT DEFAULTS, so not checked against a band: a straight's bank (it has no inside to lean to; it keeps the head's roll)
// and heading (the builder's straight is straight; the reader's straights turn 0.06–1.6° per fragment); the inversion's
// length, heading and bank (its class is the upside-down fragment, and the builder's word is a whole roll).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../src/doc/index.js');
const G = require('../src/geom/index.js');
const V = require('../src/doc/vocab.js');
const { generate, FONT_OF_SHAPE } = require('../src/doc/vocabgen.js');
const { placePhrase, PHRASES } = require('../src/doc/phrasebook.js');
const { validate } = require('../src/validate/index.js');
const { MACH6 } = require('../src/validate/limits.js');
const CORPUS = require('../src/doc/corpus.json');

const DEG = Math.PI / 180, C = CORPUS.classes;
const ROAD = ['straight', 'sweep', 'turn', 'tight', 'wall-ride', 'inversion'], CURVED = ['sweep', 'turn', 'tight', 'wall-ride'];
const inside = (v, s, what) => assert.ok(v >= s.p10 - 1e-9 && v <= s.p90 + 1e-9, `${what} = ${v} is outside p10–p90 [${s.p10}, ${s.p90}]`);
/** The word alone, placed at its defaults, and the path it builds. */
function built(word, opts = {}) {
  const d = D.appendWord(D.createDoc('v'), word, opts), w = d.words[0], P = G.buildPath(D.resolve(d).segments);
  const k = Math.max(...P.samples.map((s) => Math.hypot(...s.kvec)));
  return { w, P, peakR: k > 1e-9 ? 1 / k : Infinity };
}

test('every built-in road word at default handles sits inside the library\'s p10–p90: its SIZE among the CORNERS (runs for the straight and the wall-ride), its SHAPE among the WORDS', () => {
  const size = (word) => (['sweep', 'turn', 'tight'].includes(word) ? ['corners', CORPUS.corners[word]] : ['runs', CORPUS.runs[word]]);
  for (const word of ROAD) {
    const { w, P, peakR } = built(word), c = C[word];
    inside(w.handles.width, c.width_m, `${word} width`);
    inside(w.handles.climb / DEG, c.climb_deg, `${word} climb (deg)`);
    if (word === 'inversion') continue;
    const [from, S] = size(word);
    inside(P.lengthM, S.length_m, `${word} length (built), among the ${from}`);
    if (word === 'straight') continue;
    inside(Math.abs(w.handles.turn) / DEG, S.heading_deg, `${word} total turn (deg), among the ${from}`);
    inside(peakR, c.radius_m, `${word} peak radius (built)`);
    inside(Math.abs(w.handles.roll1 - w.handles.roll0) / DEG, c.bank_deg, `${word} bank (deg)`);
  }
});

test('the default jump sits inside the library\'s jumps: its gap and its drop', () => {
  const j = D.appendWord(D.createDoc('j'), 'jump').words[0].handles;
  inside(j.gap, C.jump.gap_m, 'jump gap'); inside(j.drop, C.jump.drop_m, 'jump drop');
});

/** A new user's first jump (as app/test/validate-ui-jumpdefault.test.js places it): two straights, then the jump. */
function firstJump(handles) {
  let d = D.appendWord(D.appendWord(D.createDoc('j'), 'straight'), 'straight');
  d = D.appendWord(d, 'jump', handles ? { handles } : {});
  const segs = D.resolve(d).segments;
  return validate(G.buildPath(segs, { step: 2 }), segs, { designSpeed: MACH6.designSpeedKmh / 3.6 });
}

test('the default jump is the p10 gap because the median one misses: at 460 km/h off a level road, 81 m is caught at both falls, 125 m is not', () => {
  const def = firstJump();
  assert.deepEqual(def.red, [], 'the default jump is clean at the default design speed');
  assert.deepEqual(def.jumps[0].landings.map((l) => [l.g, l.caught]), [[3.2, true], [6.3, true]]);
  const median = firstJump({ gap: C.jump.gap_m.p50 });
  // CHANGED D250: the median jump's miss is a WARNING (amber), not a red: the keeper tunes jumps by driving them. The row's claim (the median one misses) stands
  assert.ok(median.amber.some((r) => r.reason === 'landing-misses-zone'), `the median ${C.jump.gap_m.p50} m jump: ${JSON.stringify(median.amber.map((r) => r.reason))}`);
  assert.ok(!median.red.some((r) => r.reason === 'landing-misses-zone'), 'and it is not a red');
});

test('the default is the MEDIAN: each curved word\'s built peak radius is its class p50, within 0.5%', () => {
  for (const word of CURVED) {
    const { peakR } = built(word);
    assert.ok(Math.abs(peakR / C[word].radius_m.p50 - 1) < 0.005, `${word}: ${peakR} vs p50 ${C[word].radius_m.p50}`);
  }
});

test('a curved word banks INTO its turn: a left turn tilts its left edge down, a right turn its right', () => {
  for (const dir of ['L', 'R']) {
    const { P } = built('turn', { dir }), end = P.samples[P.samples.length - 1];
    assert.equal(Math.sign(end.bankG), dir === 'L' ? -1 : 1, `${dir}: bankG ${end.bankG}`);
  }
});

test('a turn placed after an inversion banks by its own bank in the head\'s revolution, never unwinding a whole roll', () => {
  const d = D.appendWord(D.appendWord(D.createDoc('i'), 'inversion'), 'turn', { dir: 'L' }), h = d.words[1].handles;
  assert.ok(Math.abs(h.roll0 - 2 * Math.PI) < 1e-9, `the turn starts at the inversion's 2π, got ${h.roll0}`);
  assert.ok(Math.abs(h.roll1 - h.roll0 + V.WORDS.turn.bank) < 1e-6, `roll ${h.roll0} → ${h.roll1}: it should lean by -${V.WORDS.turn.bank} only`);
});

// THE BANK RAMPS (vocab.js BANK_RATE). A word's roll is one smoothstep over its length (resolve.js), steepest at
// 1.5 × |Δroll| / length. The inversion's whole roll is the word, not a join.
const steepestBank = (w) => (1.5 * Math.abs(w.handles.roll1 - w.handles.roll0)) / DEG / w.handles.length;
const JOINED = ['straight', 'sweep', 'turn', 'tight', 'wall-ride'];

test('THE BANK RAMPS: no default join banks faster than the measured rate — every ordered pair of road words, both turn directions, every tempo', () => {
  const worst = [];
  for (const tempo of Object.keys(V.TEMPOS)) for (const a of ['inversion', ...JOINED]) for (const b of JOINED) for (const da of ['L', 'R']) for (const db of ['L', 'R']) {
    const d = D.appendWord(D.appendWord(D.createDoc('j'), a, { dir: da, tempo }), b, { dir: db, tempo });
    for (const w of d.words) if (w.word !== 'inversion' && steepestBank(w) > V.BANK_RATE + 1e-3) worst.push(`${tempo} ${a}${da}→${b}${db}: ${w.word} ${steepestBank(w).toFixed(3)}°/m`);
  }
  assert.deepEqual(worst, []);
});

test('THE BANK RAMPS: every starter phrase, placed after a default turn, banks no faster than the measured rate', () => {
  const worst = [];
  for (const p of PHRASES) {
    const d = placePhrase(D.appendWord(D.createDoc('p'), 'turn', { dir: 'L' }), p.name);
    for (const e of d.words) for (const w of e.phrase !== undefined ? e.words : [e]) if (w.word !== 'jump' && w.word !== 'inversion' && steepestBank(w) > V.BANK_RATE + 1e-3) worst.push(`${p.name}: ${w.word} ${steepestBank(w).toFixed(3)}°/m`);
  }
  assert.deepEqual(worst, []);
});

test('THE BANK RAMPS: a wall-ride after a turn still reaches its class bank, over a longer word that turns further at the same radius', () => {
  const alone = V.pieceOf('wall-ride', 'standard'), d = D.appendWord(D.appendWord(D.createDoc('w'), 'turn', { dir: 'L' }), 'wall-ride', { dir: 'L' }), h = d.words[1].handles;
  assert.ok(Math.abs(h.roll1 + V.WORDS['wall-ride'].bank) < 1e-6, `it banks to the class's ${V.WORDS['wall-ride'].bank / DEG}°, got ${-h.roll1 / DEG}°`);
  assert.ok(h.length > alone.length + 1, `lengthened from ${alone.length} m, got ${h.length} m`);
  assert.ok(Math.abs(h.turn) > alone.turn, `it turns further: ${Math.abs(h.turn) / DEG}° against the piece's ${alone.turn / DEG}°`);
  const R = (h.length * (1 - V.TEMPOS.standard.ease)) / Math.abs(h.turn);
  assert.ok(Math.abs(R - alone.R) < 1e-3 * alone.R, `at the class radius ${alone.R} m, got ${R} m`);
});

test('BANK_RATE is what tools/bankrate.cjs measures from reads/ (the p90 of the steps where the bank is changing)', (t) => {
  const reads = path.join(__dirname, '..', 'reads');
  if (!fs.existsSync(reads)) { t.skip('reads/ is not in this checkout (the layouts are other authors\' tracks and stay local)'); return; }
  const { build } = require('../tools/bankrate.cjs');
  assert.equal(Number(build(reads).changing.p90.toFixed(3)), V.BANK_RATE);
});

test('THE BANK RAMPS: the inversion is not ramped — its whole roll is the word, so it keeps its length after any bank', () => {
  for (const a of ['turn', 'tight', 'wall-ride']) {
    const d = D.appendWord(D.appendWord(D.createDoc('i'), a, { dir: 'L' }), 'inversion');
    assert.equal(d.words[1].handles.length, V.WORDS.inversion.length, `after a ${a}`);
  }
});

test('bankrate.cjs unwraps the roll: a road rolling through ±180° reads its real rate, not the jump across the seam', () => {
  const { ratesOf } = require('../tools/bankrate.cjs');
  // four stations 4 m apart, forward +z, the normal rolling 170°, 175°, −180°, −175° (5° per step, across the ±180° seam) about the forward axis
  // and back the other way (−170°, −175°, 180°, 175°): the seam crossed in both directions
  const st = (degs) => degs.map((deg, i) => { const r = deg * DEG; return { d: 4 * i, f: [0, 0, 1], n: [Math.sin(r), Math.cos(r), 0] }; });
  const rates = (degs) => ratesOf({ stations: st(degs) }).map((x) => Number(x.toFixed(6)));
  assert.deepEqual([rates([170, 175, -180, -175]), rates([-170, -175, 180, 175])], [[1.25, 1.25, 1.25], [1.25, 1.25, 1.25]]);
});

test('a measured font resolves through its measured floor (src/geom/fonts.js fontProfile), not the old flat-floor-and-wall', () => {
  const { fontProfile } = require('../src/geom/fonts.js');
  for (const font of ['bowl', 'half-pipe', 'flat']) {
    const d = D.appendWord(D.createDoc('m'), 'turn', { font }), seg = D.resolve(d).segments.find((g) => g.id === 'w1' && g.profile);
    assert.deepEqual(seg.profile, fontProfile(font, d.words[0].handles), font);
  }
});

test('NO WALL BY DEFAULT: every road word placed at its defaults, in each measured font, has no wall — a wall is only ever sculpted', () => {
  for (const font of ['bowl', 'half-pipe', 'flat']) for (const word of ROAD) assert.equal(D.appendWord(D.createDoc('n'), word, { font }).words[0].handles.wall, 0, `${word} in ${font}`);
  for (const word of ROAD) assert.equal(D.appendWord(D.createDoc('n'), word).words[0].handles.wall, 0, `${word} in its own font`);
});

const sharesOf = (cls) => { const t = {}; for (const [s, n] of Object.entries(C[cls].shape)) t[FONT_OF_SHAPE[s]] = (t[FONT_OF_SHAPE[s]] || 0) + n; const sum = Object.values(t).reduce((a, x) => a + x, 0); for (const k of Object.keys(t)) t[k] /= sum; return t; };

test('the first word of a class placed with no font takes the class\'s most-used font (straights and sweeps are not flat unless the library says so)', () => {
  for (const word of ROAD) { const sh = sharesOf(word), most = Object.entries(sh).sort((a, b) => b[1] - a[1])[0][0]; assert.equal(D.appendWord(D.createDoc('f'), word).words[0].font, most, word); }
});

test('FONT CONTINUITY: ten words placed with no font chosen share one font, the first word\'s, which is its class\'s most-used (the bowl)', () => {
  let d = D.createDoc('cont');
  for (const [i, w] of ['straight', 'sweep', 'turn', 'tight', 'turn', 'sweep', 'straight', 'turn', 'tight', 'turn'].entries()) d = D.appendWord(d, w, { dir: i % 2 ? 'L' : 'R' });
  assert.deepEqual([...new Set(d.words.map((w) => w.font))], ['bowl']);
});

test('FONT CONTINUITY: an explicit change carries forward, and a jump carries the font through', () => {
  let d = D.appendWord(D.appendWord(D.createDoc('chg'), 'turn'), 'turn', { font: 'half-pipe' });
  d = D.appendWord(D.appendWord(D.appendWord(d, 'straight'), 'jump'), 'sweep');
  assert.deepEqual(d.words.filter((w) => w.word !== 'jump').map((w) => w.font), ['bowl', 'half-pipe', 'half-pipe', 'half-pipe']);
});

test('the WIDTH follows the FONT (C\'s measured widths: bowl 31, half-pipe 31.5, flat 45); a font C has not measured takes the class median', () => {
  const { WIDTHS } = require('../src/geom/fonts.js');
  for (const font of ['bowl', 'half-pipe', 'flat']) assert.equal(D.appendWord(D.createDoc('w'), 'turn', { font }).words[0].handles.width, WIDTHS[font], font);
  assert.equal(D.appendWord(D.createDoc('w'), 'turn', { font: 'wall-ride' }).words[0].handles.width, C.turn.width_m.p50, 'no measured width: the class median');
});

test('the measured font SHARES stay in the vocabulary as data, the generator\'s own', () => {
  const g = generate(CORPUS);
  for (const w of ROAD) assert.deepEqual(V.WORDS[w].fontShares, g.words[w].fontShares, w);
});

test('a band tempo gives its class\'s corner size (compact p10, standard p50, grand p90) at the median radius; a straight its run\'s', () => {
  const RU = CORPUS.runs, CO = CORPUS.corners;
  for (const [tempo, b] of Object.entries({ compact: 'p10', standard: 'p50', grand: 'p90' })) {
    const { w, peakR } = built('tight', { tempo }), s = built('straight', { tempo });
    assert.ok(Math.abs(Math.abs(w.handles.turn) / DEG - CO.tight.heading_deg[b]) < 1e-3, `${tempo}: a tight turns ${w.handles.turn / DEG}°, the ${b} corner ${CO.tight.heading_deg[b]}°`);
    assert.ok(Math.abs(peakR / C.tight.radius_m.p50 - 1) < 0.005, `${tempo}: radius ${peakR}, the median ${C.tight.radius_m.p50}`);
    assert.ok(Math.abs(s.P.lengthM - RU.straight.length_m[b]) < 1e-3, `${tempo}: a straight is ${s.P.lengthM} m, the ${b} run ${RU.straight.length_m[b]} m`);
  }
});

test('the vocabulary IS the generator\'s output on this corpus (nothing hand-set beside it)', () => {
  const g = generate(CORPUS);
  for (const w of CURVED) assert.deepEqual([V.WORDS[w].R, V.WORDS[w].turn, V.WORDS[w].bank, V.WORDS[w].width, V.WORDS[w].font], [g.words[w].R, g.words[w].turn, g.words[w].bank, g.words[w].width, g.words[w].font], w);
  assert.deepEqual([V.WORDS.straight.length, V.WORDS.straight.font, V.WORDS.inversion.width, V.WORDS.jump.gap, V.WORDS.jump.drop], [g.words.straight.length, g.words.straight.font, g.words.inversion.width, g.bands.jump.p10.gap, g.words.jump.drop]);
  assert.deepEqual(V.GRAMMAR, g.grammar);
});

test('the starter phrases chain clean: all of them placed one after another, in the palette\'s order, have no red', () => {
  // as test/phrasebook.test.js checks one phrase: a straight lead-in, the mesh's self-check on, the design speed
  let d = D.appendWord(D.createDoc('chain'), 'straight');
  for (const p of PHRASES) d = placePhrase(d, p.name);
  const segs = D.resolve(d).segments, p = G.buildPath(segs, { step: 2 }), mesh = G.buildMesh(p, segs, { selfCheck: true });
  const v = validate(p, segs, { designSpeed: MACH6.designSpeedKmh / 3.6, folds: mesh.folds });
  assert.deepEqual(v.red.map((r) => `${r.reason} at s ${Math.round(r.s0)}`), []);
});

test('every step inside every starter phrase is a transition the library shows (a grammar pattern, not a copied layout)', (t) => {
  if (!CORPUS.transitions) return t.skip('src/doc/corpus.json has no transitions yet (E, D182): nothing to check the steps against');
  for (const p of PHRASES) for (let i = 1; i < p.words.length; i++) {
    const from = p.words[i - 1].word, to = p.words[i].word;
    assert.ok((((CORPUS.transitions[from] || {}).counts || {})[to] || 0) > 0, `${p.name}: ${from} → ${to} is never seen in the library`);
  }
});

test('a document made with the old vocabulary opens, and resolves to the same track it did before D182', () => {
  const dir = path.join(__dirname, 'fixtures');
  const d = D.parse(fs.readFileSync(path.join(dir, 'doc-before-d182.json'), 'utf8')), want = JSON.parse(fs.readFileSync(path.join(dir, 'doc-before-d182.resolved.json'), 'utf8'));
  const r = D.resolve(d), P = G.buildPath(r.segments), e = P.samples[P.samples.length - 1];
  assert.deepEqual({ segments: r.segments.length, lengthM: +P.lengthM.toFixed(6), end: e.pos.map((v) => +v.toFixed(6)) }, want);
  assert.deepEqual(new Set(d.words.flatMap((w) => (w.phrase !== undefined ? w.words : [w])).map((w) => w.tempo)), new Set(['standard', 'aurora', 'serpents']), 'the old tempo names load');
});
