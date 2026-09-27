// Tests for src/validate/bounds.js: live physics bounds on the sculpt handles (the keeper, 12:22). For each handle the
// packet names (length; curvature and ramps; pitch; bank; width; wall height; ψ), a document is built where that handle
// meets a RED limit, and: the value AT the bound validates clean, and one quantum outside it turns red, through the same
// validation, A's resolve and C's buildPath. node --test, no dependencies.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/doc/index.js');
const { UNIT } = require('../src/doc/serial.js');
const { handleBounds, probe, QUANTUM } = require('../src/validate/bounds.js');

const DEG = Math.PI / 180;
function doc(words) { let d = D.createDoc('t'); for (const [w, o, patch] of words) { d = D.appendWord(d, w, { speed: 60, ...o }); if (patch) d = D.editWord(d, d.words[d.words.length - 1].id, { handles: patch }); } return d; }

/** The packet's test: at the bound it is clean, one quantum outside it is red, and the red names its source. */
function edgeHolds(d, id, h, bounds, side, opts = {}) {
  const b = bounds.handles[h], stop = side === 'max' ? b.above : b.below;
  assert.strictEqual(stop.kind, 'red', `${h} ${side}: expected a red limit, got ${JSON.stringify(stop)}`);
  assert.ok(stop.sources.every((s) => /(FINDINGS|ARCHITECTURE)\.md:\d/.test(s)), JSON.stringify(stop.sources));
  const q = QUANTUM[UNIT[h]], at = b[side], out = at + (side === 'max' ? q : -q);
  const o = { ...opts, scope: bounds.scope };
  assert.strictEqual(probe(d, id, h, at, o).ok, true, `${h} = ${at} (the bound) must validate clean`);
  const past = probe(d, id, h, out, o);
  assert.strictEqual(past.ok, false, `${h} = ${out} (one quantum outside) must be red`);
  return stop;
}

test('length (a tight word): the shortest clean length, and one millimetre shorter is red (a fold or seam)', () => {
  const d = doc([['straight'], ['tight'], ['straight']]);
  const b = handleBounds(d, 'w2', { handles: ['length'], step: 2 });
  const stop = edgeHolds(d, 'w2', 'length', b, 'min', { step: 2 });
  assert.ok(stop.reasons.includes('fold'), stop.reasons.join());
  assert.ok(b.handles.length.min < b.handles.length.value);
});

test('curvature (turn): swinging a tight word past its bound lays the track over itself (stacked), one quantum on', () => {
  const d = doc([['straight'], ['tight'], ['straight']]);
  const b = handleBounds(d, 'w2', { handles: ['turn'], step: 2 });
  assert.deepStrictEqual(edgeHolds(d, 'w2', 'turn', b, 'max', { step: 2 }).reasons, ['stacked-within-2m']);
  edgeHolds(d, 'w2', 'turn', b, 'min', { step: 2 });
});

test('ramps (easeIn): a longer ramp tightens the body of a short tight word until it folds', () => {
  const d = doc([['straight'], ['tight', {}, { length: 45 }], ['straight']]);
  const b = handleBounds(d, 'w2', { handles: ['easeIn'], step: 1 });
  assert.ok(edgeHolds(d, 'w2', 'easeIn', b, 'max', { step: 1 }).reasons.some((r) => r === 'fold' || r === 'seam-past-envelope'));
});

test('pitch (climb): a short climbing half-pipe folds its walls when their height passes the vertical radius', () => {
  const d = doc([['straight'], ['straight', { font: 'half-pipe' }, { length: 10, wall: 12 }], ['straight']]);
  const b = handleBounds(d, 'w2', { handles: ['climb'], step: 0.5 });
  assert.ok(edgeHolds(d, 'w2', 'climb', b, 'max', { step: 0.5 }).reasons.includes('fold'));
});

test('bank (roll at the head) for a non-CSP export: exactly 50° either way (ARCHITECTURE.md:87)', () => {
  const d = doc([['straight'], ['straight']]);
  const opts = { handles: ['roll1'], step: 2, validate: { csp: false } };
  const b = handleBounds(d, 'w2', opts);
  for (const side of ['max', 'min']) assert.deepStrictEqual(edgeHolds(d, 'w2', 'roll1', b, side, opts).reasons, ['steep-without-raycast']);
  assert.ok(Math.abs(b.handles.roll1.max - 50 * DEG) < 2e-5 && Math.abs(b.handles.roll1.min + 50 * DEG) < 2e-5, `${b.handles.roll1.min} ${b.handles.roll1.max}`);
  // no amber comes before the red here, so the amber-free range IS the red-free range: never wider than it
  assert.deepStrictEqual([b.handles.roll1.amberMin, b.handles.roll1.amberMax], [b.handles.roll1.min, b.handles.roll1.max]);
});

test('bank on a CSP export has no red limit: the bound is the document range, and it says so', () => {
  const d = doc([['straight'], ['straight']]);
  const b = handleBounds(d, 'w2', { handles: ['roll1'], step: 4 });
  assert.strictEqual(b.handles.roll1.above.kind, 'range');
});

test('width (a wall-ride): widened past its bound, the two sides of the U-turn stack; at the bound it is clean', () => {
  const d = doc([['straight'], ['wall-ride'], ['straight']]);
  const b = handleBounds(d, 'w2', { handles: ['width'], step: 2 });
  assert.deepStrictEqual(edgeHolds(d, 'w2', 'width', b, 'max', { step: 2 }).reasons, ['stacked-within-2m']);
});

test('wall height (a wall-ride): raised past its bound it turns red; at the bound it is clean', () => {
  const d = doc([['straight'], ['wall-ride'], ['straight']]);
  const b = handleBounds(d, 'w2', { handles: ['wall'], step: 2 });
  edgeHolds(d, 'w2', 'wall', b, 'max', { step: 2 });
});

test('ψ for a non-CSP export: a half-pipe wall is clean at 50° and red one thousandth of a degree past it', () => {
  const d = doc([['straight'], ['straight', { font: 'half-pipe' }, { psiL: 40 * DEG, psiR: 40 * DEG }], ['straight']]);
  const opts = { handles: ['psiL'], step: 2, validate: { csp: false } };
  const b = handleBounds(d, 'w2', opts);
  assert.deepStrictEqual(edgeHolds(d, 'w2', 'psiL', b, 'max', opts).reasons, ['steep-without-raycast']);
  assert.ok(Math.abs(b.handles.psiL.max - 50 * DEG) < 2e-5);
});

test('where no limit binds, the bound is the document range; where the document refuses a value, it says why', () => {
  const d = doc([['straight'], ['tight'], ['straight']]);
  const b = handleBounds(d, 'w2', { handles: ['climb', 'easeIn'], step: 4 });
  assert.deepStrictEqual([b.handles.climb.below.kind, b.handles.climb.above.kind], ['range', 'range']);
  assert.strictEqual(b.handles.easeIn.above.kind, 'refused');
  assert.match(b.handles.easeIn.above.message, /easeIn \+ easeOut/);
});

test('a word that is already red has no clean range to report (null bounds, "red-now")', () => {
  const d = doc([['straight'], ['straight', { font: 'half-pipe' }], ['straight']]);   // 60° walls: red without CSP
  const b = handleBounds(d, 'w2', { handles: ['width'], step: 4, validate: { csp: false } });
  assert.strictEqual(b.redNow, true);
  assert.deepStrictEqual([b.handles.width.min, b.handles.width.max, b.handles.width.below.kind], [null, null, 'red-now']);
});

test('amber is reported inside the red bounds: amberMax ≤ max, and a faster word meets amber before red', () => {
  const d = doc([['straight'], ['straight', { font: 'half-pipe', speed: 250 }, { length: 60 }], ['straight']]);
  const b = handleBounds(d, 'w2', { handles: ['climb'], step: 1 });
  const h = b.handles.climb;
  assert.ok(h.amberMax != null && h.amberMax < h.max, JSON.stringify(h));
  // one quantum past amberMax the word is amber (load above the proven 90 g) but still not red
  const past = probe(d, 'w2', 'climb', h.amberMax + QUANTUM[UNIT.climb], { step: 1, scope: b.scope });
  assert.strictEqual(past.ok, true); assert.ok(past.amberList.some((x) => x.reason === 'load-above-proven'), JSON.stringify(past.amberList.map((x) => x.reason)));
});

test('A\'s handleInfo hook takes these bounds as its physics (src/doc/library.js handleInfo(doc, id, boundsFn))', () => {
  const { handleInfo } = require('../src/doc/library.js');
  const d = doc([['straight'], ['straight']]);
  const info = handleInfo(d, 'w2', (dd, id) => handleBounds(dd, id, { handles: ['roll1'], step: 4, validate: { csp: false } }).handles);
  assert.ok(info.physics && info.physics.roll1 && Math.abs(info.physics.roll1.max - 50 * DEG) < 2e-5);
});

test('scope: on a track already red elsewhere, a clean word is still bounded by ITS OWN stretch, not pinned by the other red', () => {
  // w3 has 60° half-pipe walls, red for a non-CSP export. w2, a flat straight, is clean, and its width is free on a
  // straight, so its bound must reach the document range instead of being pinned red by w3.
  const d = doc([['straight'], ['straight'], ['straight', { font: 'half-pipe' }]]);
  const b = handleBounds(d, 'w2', { handles: ['width'], step: 4, validate: { csp: false } });
  assert.strictEqual(b.scope, 'word');
  assert.strictEqual(b.redNow, false);
  assert.strictEqual(b.handles.width.above.kind, 'range');
});
