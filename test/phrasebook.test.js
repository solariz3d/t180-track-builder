// Tests for src/doc/phrasebook.js (D175): the starter phrasebook. Each phrase resolves, builds (with the self-check on)
// and validates with no red at its default tempo; placing it is one undo step; its words are the grammar its sources
// state, and every source it quotes is really on the cited lines.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('../src/doc/index.js');
const G = require('../src/geom/index.js');
const { validate } = require('../src/validate/index.js');
const { MACH6 } = require('../src/validate/limits.js');
const { PHRASES, placePhrase, phrasebookPieces } = require('../src/doc/phrasebook.js');

const REPO = path.resolve(__dirname, '..'), DEG = Math.PI / 180;
const phrase = (name) => PHRASES.find((p) => p.name === name);
/** A straight lead-in, then the phrase; resolved, built with the self-check, and validated. */
function run(name, { designSpeed = MACH6.designSpeedKmh / 3.6, words } = {}) {
  let d = D.appendWord(D.createDoc('p'), 'straight');
  d = words ? D.appendPhrase(d, name, words) : placePhrase(d, name);
  const segs = D.resolve(d).segments, p = G.buildPath(segs, { step: 2 }), mesh = G.buildMesh(p, segs, { selfCheck: true });
  return { d, r: validate(p, segs, { designSpeed, folds: mesh.folds }) };
}

test('the phrasebook holds the four starter phrases ARCHITECTURE §2 and FINDINGS name', () => {
  assert.deepStrictEqual(PHRASES.map((p) => p.name), ['sakura flow', 'bowl hairpin', 'S', 'spiral climb']);
});

for (const { name } of PHRASES) {
  test(`${name}: resolves, builds with the self-check on, and validates with NO red at its default tempo and the design speed`, () => {
    const { r } = run(name);
    assert.deepStrictEqual(r.red.map((x) => `${x.reason} at s ${x.s0}`), []);
  });
  test(`${name}: no red with no speed either (the geometry alone)`, () => {
    assert.deepStrictEqual(run(name, { designSpeed: undefined }).r.red.map((x) => x.reason), []);
  });
  test(`${name}: placing it is ONE undo step, and undo gives back the document before it`, () => {
    const d0 = D.appendWord(D.createDoc('u'), 'straight');
    const h = D.commit(D.createHistory(d0), placePhrase(d0, name));
    assert.strictEqual(h.past.length, 1);
    assert.strictEqual(h.present.words.length, 2, 'one document entry, the phrase');
    assert.deepStrictEqual(h.present.words[1].words.map((w) => w.word), phrase(name).words.map((w) => w.word));
    assert.strictEqual(D.undo(h).present, d0);
  });
  test(`${name}: every source it quotes is on the lines it cites`, () => {
    for (const src of phrase(name).source) {
      const m = /^(FINDINGS|ARCHITECTURE)\.md:(\d+)(?:-(\d+))? "(.*)"/.exec(src);
      assert.ok(m, `a source must be "FILE.md:line[-line] \\"quote\\"": ${src}`);
      const lines = fs.readFileSync(path.join(REPO, 'docs', `${m[1]}.md`), 'utf8').split('\n');
      const text = lines.slice(+m[2] - 1, +(m[3] || m[2])).map((l) => l.trim()).join(' ');
      for (const part of m[4].split(' … ')) assert.ok(text.includes(part.replace(/^… /, '')), `${m[1]}.md:${m[2]} does not say: ${part}\n  it says: ${text}`);
    }
  });
}

test('sakura flow is Sakura\'s grammar word for word (FINDINGS.md:180): sweep → turn → tight → turn → sweep, one way round', () => {
  const p = phrase('sakura flow');
  assert.deepStrictEqual(p.words.map((w) => w.word), ['sweep', 'turn', 'tight', 'turn', 'sweep']);
  assert.ok(p.words.every((w) => w.dir === 'L' && w.font === 'half-pipe'));
  // it opens and closes in steps: the angle rises to the tight and falls again, symmetric
  const deg = p.words.map((w) => Math.round(w.handles.turn / DEG));
  assert.deepStrictEqual(deg, [10, 20, 30, 20, 10]);
});

test('every word keeps its own radius: Sakura\'s angles change the length, not the curvature', () => {
  const { d } = run('sakura flow'), words = d.words[1].words;
  for (const w of words) {
    const R = w.handles.length * (1 - w.handles.easeIn) / Math.abs(w.handles.turn);
    const own = { sweep: 1000, turn: 300, tight: 120 }[w.word];
    assert.ok(Math.abs(R - own) < 0.01, `${w.word}: peak radius ${R}, its own ${own}`);
  }
});

test('the grammar holds in every phrase: never straight into tight, in or out', () => {
  for (const p of PHRASES) {
    const w = ['straight', ...p.words.map((x) => x.word)];   // placed after a straight, as a user would
    for (let k = 1; k < w.length; k++) assert.ok(!(w[k] === 'tight' && w[k - 1] === 'straight') && !(w[k] === 'straight' && w[k - 1] === 'tight'), `${p.name}: ${w.join(' → ')}`);
  }
});

test('the spiral\'s climb is what keeps it clear: without it the lap stacks on its own start (red)', () => {
  const flat = phrase('spiral climb').words.map((w) => ({ word: w.word, opts: { dir: w.dir, tempo: w.tempo, font: w.font } }));
  const red = run('spiral climb', { words: flat }).r.red.map((x) => x.reason);
  assert.ok(red.includes('stacked-within-2m') || red.includes('self-intersection'), JSON.stringify(red));
});

test('S turns left then right, at the serpents tempo, and ends heading the way it started', () => {
  const p = phrase('S');
  assert.deepStrictEqual(p.words.map((w) => [w.word, w.dir, w.tempo]), [['turn', 'L', 'serpents'], ['turn', 'R', 'serpents']]);
  const segs = D.resolve(placePhrase(D.createDoc('s'), 'S')).segments;
  assert.ok(Math.abs(segs.reduce((a, g) => a + ((g.k0 + g.k1) / 2) * g.length, 0)) < 1e-9, 'net heading change 0');
});

test('as library pieces the phrases are built-in, kind phrase, with the words and handles placePhrase uses', () => {
  const pieces = phrasebookPieces();
  assert.deepStrictEqual(pieces.map((p) => [p.name, p.builtin, p.kind]), PHRASES.map((p) => [p.name, true, 'phrase']));
  const placed = placePhrase(D.createDoc('x'), 'spiral climb').words[0].words;
  pieces.find((p) => p.name === 'spiral climb').words.forEach((w, k) => {
    assert.strictEqual(w.word, placed[k].word);
    assert.ok(Math.abs(w.handles.climb - placed[k].handles.climb) < 1e-6);
  });
  assert.ok(new Set(pieces.map((p) => p.id)).size === pieces.length);
});

test('an unknown phrase is refused by name', () => {
  assert.throws(() => placePhrase(D.createDoc('x'), 'loop de loop'), /NO_SUCH_PHRASE.*known: sakura flow, bowl hairpin, S, spiral climb/);
});

test('bowl hairpin is turn → tight → turn, all in the bowl, one way round (FINDINGS.md:14, :180)', () => {
  assert.deepStrictEqual(phrase('bowl hairpin').words.map((w) => [w.word, w.font, w.dir]), [['turn', 'bowl', 'L'], ['tight', 'bowl', 'L'], ['turn', 'bowl', 'L']]);
});

test('the spiral climbs 6° and comes back to level, so the next word starts flat', () => {
  const segs = D.resolve(placePhrase(D.createDoc('s'), 'spiral climb')).segments;
  const pitchEnd = segs.reduce((a, g) => a + ((g.kp0 + g.kp1) / 2) * g.length, 0);
  assert.ok(Math.abs(pitchEnd) < 1e-9, `pitch at the end ${pitchEnd}`);
  assert.deepStrictEqual(phrase('spiral climb').words.map((w) => w.word), ['turn', 'tight', 'tight', 'tight', 'turn']);
  assert.ok(Math.abs(phrase('spiral climb').words[0].handles.climb - 6 * DEG) < 1e-12);
});
