// core_width_at_start_f.test.js: node --test test/core_width_at_start_f.test.js
// THE WIDTH AT START TAKES F TOO (the user, 2026-10-30 22:23, a 1,000 m piece after a 32 m road with width 55 ticked "start": the road flared out in a short wedge
// at the joint; "the start should work the same for the width as well, so it gradually comes in"). A ticked width now lays F's shape as bank, cup and edge do
// (app/core/panel.js startShapeOf, src/core/extend.js startShapes): a 20 m rise as laid, then the fade, over a 300 m ramp, capped at half the piece. Width has no
// roll bar, so its ramp is 300 m unless the piece is shorter.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend, rampShape } = require('../src/core/extend.js');
const { extendOptions } = require('../app/core/panel.js');

const NONE = { turn: false, climb: false, bank: false, width: false, cup: false, edge: false, edgeR: false, start: false, tube: false };
const road = (w) => extend(D.createDoc('w'), { length: 1000, family: 'bowl', first: { w } });
const headOf = (doc) => { const e = D.endState(doc); return { phi: e.phi.v, c: e.c.v, e: e.e ? e.e.v : 0, er: e.er ? e.er.v : 0 }; };
const atStart = (doc, width, length = 1000) => { const o = extendOptions({ length, width: String(width), atStart: { ...NONE, width: true }, head: headOf(doc) }); return { o, doc: extend(doc, o) }; };
const laidOf = (R) => Math.max(R - (2 * R) / 8, R / 8);
const RISE = 20 / laidOf(300);

/** The new piece's width along s, its rate, and the figures: where the rate peaks, where the width is done (within 1 cm), and the worst miss of F's curve. */
function read(doc, from, to) {
  const P = doc.pieces[doc.pieces.length - 1], w = (s) => D.channelAt(P, 'w', s);
  let peak = 0, peakAt = 0, done = null, off = 0, offRise = 0;
  for (let s = 0; s <= 400; s += 0.25) {
    const r = Math.abs(w(s).d1); if (r > peak) { peak = r; peakAt = s; }
    if (done === null && Math.abs(w(s).v - to) < 0.01) done = s;
    const ideal = from + (to - from) * rampShape(s / laidOf(300), RISE, 1 - RISE);
    off = Math.max(off, Math.abs(w(s).v - ideal) / 2);   // a half-width: each side of the road moves half the change
    if (s <= 20) offRise = Math.max(offRise, Math.abs(w(s).v - ideal) / 2);
  }
  return { P, w, peak, peakAt, done, off, offRise };
}

test('his case, 32 → 55 m at start on a 1,000 m piece: F over 300 m, the rate peaking at 20 m, done by about 235 m, each side within 1 cm of F over the rise and 4 cm in the fade', () => {
  const { o, doc } = atStart(road(32), 55);
  assert.equal(o.transition.w, 300);
  assert.ok(Math.abs(o.startShapes.w.rise - RISE) < 1e-12 && Math.abs(o.startShapes.w.rise + o.startShapes.w.fall - 1) < 1e-12, JSON.stringify(o.startShapes));
  const r = read(doc, 32, 55);
  assert.ok(Math.abs(r.peakAt - 20) <= 0.5, `the rate peaks at ${r.peakAt} m`);
  // done (within 1 cm of 55) by about 235 m, as the bank is by 234.5; F's own curve is within 1 cm by 212.25 m, and the laid width settles a little after it (228 m)
  assert.ok(r.done >= 212 && r.done <= 235, `done at ${r.done} m`);
  // where the wedge was, the 20 m rise, each side follows F within 1 cm; in the long fade the knots are 26 m apart and a side strays up to 3.5 cm (at 128 m),
  // 0.30% of its 11.5 m change: the same fit the bank has (0.13° of 41.38°, 0.31%)
  assert.ok(r.offRise <= 0.01, `over the 20 m rise a side is ${(r.offRise * 100).toFixed(2)} cm off F's curve`);
  assert.ok(r.off <= 0.04, `a side is ${(r.off * 100).toFixed(2)} cm off F's curve`);
  assert.ok(Math.abs(r.w(1000).v - 55) < 1e-6);
});

test('no step at the joint: the width and its rate carry on from the 32 m road (C1), and the first 5 m barely widen', () => {
  const base = road(32), end = D.endState(base), { doc } = atStart(base, 55), r = read(doc, 32, 55);
  assert.ok(Math.abs(r.w(0).v - end.w.v) < 1e-9, `width at the joint ${r.w(0).v} against ${end.w.v}`);
  assert.ok(Math.abs(r.w(0).d1 - end.w.m) < 1e-9, `rate at the joint ${r.w(0).d1} against ${end.w.m}`);
  assert.ok(r.w(5).v - 32 < 0.1, `by 5 m the road has widened ${(r.w(5).v - 32).toFixed(3)} m`);
});

test('a narrowing, 55 → 32, is the same ramp mirrored', () => {
  const wide = read(atStart(road(55), 32).doc, 55, 32), narrow = read(atStart(road(32), 55).doc, 32, 55);
  for (let s = 0; s <= 400; s += 5) assert.ok(Math.abs((wide.w(s).v - 55) + (narrow.w(s).v - 32)) <= 0.02, `at ${s} m: ${wide.w(s).v} against ${narrow.w(s).v}`);
  assert.ok(Math.abs(wide.peakAt - 20) <= 0.5 && Math.abs(wide.done - narrow.done) <= 0.5);
});

test('a short piece takes half of it, and a 60 m piece the swell\'s halves (its 30 m ramp is laid in 22.5 m, too short for a 20 m rise)', () => {
  const o = extendOptions({ length: 60, width: '40', atStart: { ...NONE, width: true } });
  assert.equal(o.transition.w, 30); assert.deepEqual(o.startShapes, { w: { rise: 0.5, fall: 0.5 } });
  extend(road(32), o);
  assert.equal(extendOptions({ length: 400, width: '40', atStart: { ...NONE, width: true } }).transition.w, 200);
  assert.equal(extendOptions({ length: 12, width: '40', atStart: { ...NONE, width: true } }).transition.w, 12);
});

test('nothing ticked: no start shape and no transition; extend without a width start shape lays its ramp as before', () => {
  const o = extendOptions({ length: 1000, width: '55', atStart: NONE });
  assert.equal(o.startShapes, undefined); assert.equal(o.transition, undefined);
  const a = extend(road(32), { length: 1000, targets: { w: 55 }, transition: { w: 20 } }), b = extend(road(32), { length: 1000, targets: { w: 55 }, transition: { w: 20 }, startShapes: {} });
  assert.equal(D.serialize(a), D.serialize(b));
});
