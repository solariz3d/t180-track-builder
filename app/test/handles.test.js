// Headless tests for app/handles: sculpt handles that drag with live physics bounds (src/validate/bounds.js), stop at
// red, pass amber, and make one undo entry per drag. Run: node --test "app/test/*.test.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../../src/doc/index.js');
const H = require('../../src/doc/history.js');
const G = require('../../src/geom/index.js');
const { validate } = require('../../src/validate/index.js');
const { handleBounds, QUANTUM } = require('../../src/validate/bounds.js');
const { UNIT } = require('../../src/doc/serial.js');
const { SCULPT, ALL, handlesOf, startDrag } = require('../handles/handles.js');

const DEG = Math.PI / 180, kmh = (v) => v / 3.6;
function doc(words) { let d = D.createDoc('t'); for (const [w, o, patch] of words) { d = D.appendWord(d, w, { speed: kmh(216), ...o }); if (patch) d = D.editWord(d, d.words[d.words.length - 1].id, { handles: patch }); } return d; }
const handle = (d, id, h) => d.words.find((w) => w.id === id).handles[h];
const redOf = (d, opts = {}) => { const segs = D.resolve(d).segments; return validate(G.buildPath(segs, { step: 2 }), segs, opts).red; };
const HEAD = { validate: { csp: false }, step: 2 };   // roll at the head, for a non-CSP export: red past 50° (ARCHITECTURE.md:87)

test('the sculpt set is the plan\'s list: length, curvature and ramps, pitch, bank, width, wall height, ψ, font transition', () => {
  assert.deepStrictEqual(Object.keys(SCULPT), ['length', 'curvature', 'ramps', 'pitch', 'bank', 'width', 'wall', 'psi', 'transition']);
  const w = D.appendWord(D.createDoc('t'), 'wall-ride').words[0];
  assert.deepStrictEqual(ALL.filter((h) => !(h in w.handles)), [], 'every sculpt handle exists on a road word');
});

test('a handle clamps at its bound: dragged far past 50° of bank, it stops exactly at the bound, and names the limit', () => {
  const h0 = H.createHistory(doc([['straight'], ['straight']]));
  const drag = startDrag(h0, 'w2', 'roll1', HEAD);
  const m = drag.move(2);
  assert.deepStrictEqual([m.value, m.clamped, m.level], [drag.bounds.max, true, 'clean']);
  assert.ok(Math.abs(m.value - 50 * DEG) < 2e-5, `${m.value}`);
  assert.match(m.why, /steep-without-raycast \(ARCHITECTURE\.md:87/);
  assert.deepStrictEqual(redOf(m.history.present, { csp: false }), [], 'the clamped document validates clean');
});

test('inside the bound the drag follows the pointer; one quantum past the bound would be red', () => {
  const h0 = H.createHistory(doc([['straight'], ['straight']]));
  const drag = startDrag(h0, 'w2', 'roll1', HEAD);
  const inside = drag.move(drag.bounds.max - 0.1);
  assert.deepStrictEqual([inside.clamped, inside.value], [false, drag.bounds.max - 0.1]);
  const past = D.editWord(h0.present, 'w2', { handles: { roll1: drag.bounds.max + QUANTUM[UNIT.roll1] } });
  assert.ok(redOf(past, { csp: false }).some((r) => r.reason === 'steep-without-raycast'));
});

test('the bound holds on the low side too', () => {
  const drag = startDrag(H.createHistory(doc([['straight'], ['straight']])), 'w2', 'roll1', HEAD);
  assert.deepStrictEqual(drag.move(-2).value, drag.bounds.min);
});

test('pastRed lets the drag through the bound and shows red, for a user who will fix a neighbour next', () => {
  const drag = startDrag(H.createHistory(doc([['straight'], ['straight']])), 'w2', 'roll1', { ...HEAD, pastRed: true });
  const m = drag.move(1);
  assert.deepStrictEqual([m.value, m.clamped, m.level], [1, false, 'red']);
  assert.ok(Math.abs(handle(m.history.present, 'w2', 'roll1') - 1) < 1e-6, 'the document carries the red value');   // A quantises angles (serial.js)
});

test('amber never blocks: past the amber bound the drag goes on and the handle shows amber', () => {
  const d = doc([['straight'], ['straight', { font: 'half-pipe', speed: kmh(900) }, { length: 60 }], ['straight']]);
  const b = handleBounds(d, 'w2', { handles: ['climb'], step: 1 });
  const hc = b.handles.climb;
  assert.ok(hc.amberMax != null && hc.amberMax < hc.max, JSON.stringify(hc));
  const drag = startDrag(H.createHistory(d), 'w2', 'climb', { bounds: b, step: 1 });
  const m = drag.move((hc.amberMax + hc.max) / 2);
  assert.deepStrictEqual([m.clamped, m.level], [false, 'amber']);
  assert.deepStrictEqual(drag.move(hc.amberMax).level, 'clean');
});

test('a whole drag is ONE undo entry, and undo returns the document from before the drag', () => {
  const h0 = H.createHistory(doc([['straight'], ['straight']]));
  const drag = startDrag(h0, 'w2', 'roll1', HEAD);
  for (const v of [0.1, 0.3, 0.6, 2, 0.4]) drag.move(v);
  const h1 = drag.end();
  assert.strictEqual(h1.past.length, 1);
  assert.ok(Math.abs(handle(h1.present, 'w2', 'roll1') - 0.4) < 1e-6);   // the last move, quantised by A (serial.js)
  assert.strictEqual(H.undo(h1).present, h0.present);
});

test('a cancelled drag adds no entry and leaves the document as it was', () => {
  const h0 = H.createHistory(doc([['straight'], ['straight']]));
  const drag = startDrag(h0, 'w2', 'roll1', HEAD);
  drag.move(0.5);
  const h1 = drag.cancel();
  assert.deepStrictEqual([h1.past.length, h1.present], [0, h0.present]);
});

test('bank on a middle word is refused by the document (ROLL_STEP): the drag cannot move it, and says why', () => {
  const h0 = H.createHistory(doc([['straight'], ['straight'], ['straight']]));
  const drag = startDrag(h0, 'w2', 'roll1', HEAD);
  assert.strictEqual(drag.bounds.above.kind, 'refused');
  const m = drag.move(0.3);
  assert.deepStrictEqual([m.value, m.clamped], [0, true]);
  assert.match(m.why, /refused by the document/);
});

test('a word that is already red has no clean range: the drag moves freely and shows red', () => {
  const h0 = H.createHistory(doc([['straight'], ['straight', { font: 'half-pipe' }], ['straight']]));   // 60° walls, non-CSP
  const drag = startDrag(h0, 'w2', 'width', { validate: { csp: false }, step: 4 });
  const m = drag.move(20);
  assert.deepStrictEqual([m.value, m.clamped, m.level], [20, false, 'red']);
});

test('handlesOf gives each handle A\'s value, unit and range with E\'s bounds', () => {
  const d = doc([['straight'], ['straight']]);
  const hs = handlesOf(d, 'w2', { validate: { csp: false }, step: 4 });
  assert.deepStrictEqual(Object.keys(hs).sort(), ALL.filter((h) => h in d.words[1].handles).sort());
  assert.deepStrictEqual([hs.roll1.value, hs.roll1.unit, Math.abs(hs.roll1.bounds.max - 50 * DEG) < 2e-5], [0, 'rad', true]);
});
