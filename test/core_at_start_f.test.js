// core_at_start_f.test.js: node --test test/core_at_start_f.test.js
// CANDIDATE F IS THE AT-START DEFAULT (the user, 2026-10-30 20:31: "F looks good we can try it"). A bank, cup or edge ticked "at start" in the panel
// (app/core/panel.js extendOptions) leans in over a 20 m rise as laid, then fades over the rest of a 300 m ramp (src/core/extend.js rampShape; the cup's and
// edge's through opts.startShapes). The user's piece: 1,000 m flat, then 1,000 m with bank -41.38 at start, cup 15.5, width 31. Its figures are the ones he saw for F
// on the page of six candidates (the bank at 10 / 20 / 50 / 100 / 200 m, where it is done, the peak roll and where, the kink), read the way the candidates tool reads them.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend, rampShape } = require('../src/core/extend.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180;
const NONE = { turn: false, climb: false, bank: false, width: false, cup: false, edge: false, edgeR: false, start: false, tube: false };
const flat = () => extend(D.createDoc('f'), { length: 1000, family: 'bowl' });
const headOf = (doc) => { const e = D.endState(doc); return { phi: e.phi.v, c: e.c.v, e: e.e ? e.e.v : 0, er: e.er ? e.er.v : 0 }; };
/** A piece laid as the panel lays it: the fields typed, the ticked ones at start. */
const viaPanel = (doc, fields, ticked) => { const o = extendOptions({ length: 1000, ...fields, atStart: { ...NONE, ...ticked }, head: headOf(doc) }); return { o, doc: extend(doc, o) }; };
const laidOf = (R) => Math.max(R - (2 * R) / 8, R / 8);

test('his piece, bank -41.38 at start: the panel asks F (a 300 m ramp, a 20 m rise as laid), and the bank is laid within 0.1° of the figures he saw', () => {
  const { o, doc } = viaPanel(flat(), { bank: '-41.38', cup: '15.5', width: '31' }, { bank: true });
  assert.equal(o.transition.phi, 300);
  assert.ok(Math.abs(o.bankShape.rise - 20 / 225) < 1e-12 && Math.abs(o.bankShape.rise + o.bankShape.fall - 1) < 1e-12, JSON.stringify(o.bankShape));
  const P = doc.pieces[1], at = (s) => D.channelAt(P, 'phi', s), rate = (s) => at(s).d1 / DEG, target = at(1000).v;
  const want = { 10: -0.72, 20: -3.69, 50: -14.44, 100: -29.38, 200: -41.19 };
  for (const [s, deg] of Object.entries(want)) assert.ok(Math.abs(at(Number(s)).v / DEG - deg) <= 0.1, `at ${s} m: ${(at(Number(s)).v / DEG).toFixed(3)}°, F's ${deg}°`);
  let done = null; for (let s = 0; s <= 300; s += 0.5) if (done === null && Math.abs(at(s).v - target) / DEG < 0.01) done = s;
  assert.ok(Math.abs(done - 234.5) <= 0.5, `done at ${done} m, F's 234.5`);
  let peak = 0, peakAt = 0, kink = 0;
  for (let s = 0; s <= 305; s += 0.25) { const r = Math.abs(rate(s)); if (r > peak) { peak = r; peakAt = s; } if (s + 2 <= 305) kink = Math.max(kink, Math.abs(rate(s + 2) - rate(s))); }
  assert.ok(Math.abs(peak - 0.366) <= 0.001 && Math.abs(peakAt - 20) <= 0.5, `peak ${peak.toFixed(4)} °/m at ${peakAt} m, F's 0.366 at 20`);
  assert.ok(Math.abs(kink - 0.054) <= 0.001, `kink ${kink.toFixed(5)} °/m over 2 m, F's 0.054`);
});

test('a cup and an edge at start are laid as F too: a 300 m ramp, the curve within 0.25° of the 20 m rise and its fade', () => {
  // the edge typed alone sets both sides (extend.js), so its right side er is laid as F too, on the edge's shape
  for (const [field, ch, value] of [['cup', 'c', 60], ['edge', 'e', 30], ['edge', 'er', 30]]) {
    const { o, doc } = viaPanel(flat(), { [field]: String(value), width: '31' }, { [field]: true });
    const asked = ch === 'er' ? 'e' : ch;   // the panel asks the edge's ramp and shape; extend gives the right side the same
    assert.equal(o.transition[asked], 300, `${field}'s ramp`);
    assert.ok(Math.abs(o.startShapes[asked].rise - 20 / 225) < 1e-12, `${field}'s shape ${JSON.stringify(o.startShapes)}`);
    const P = doc.pieces[1], from = D.channelAt(P, ch, 0).v, Lc = laidOf(300);
    let off = 0, offAt = 0;
    for (let s = 0; s <= 300; s += 0.5) { const ideal = from + (value - from) * rampShape(s / Lc, 20 / 225, 1 - 20 / 225), d = Math.abs(D.channelAt(P, ch, s).v - ideal); if (d > off) { off = d; offAt = s; } }
    assert.ok(off <= 0.25, `${field} (${ch}): ${off.toFixed(3)}° off F's curve at ${offAt} m`);
    assert.ok(Math.abs(D.channelAt(P, ch, 1000).v - value) < 1e-6, `${field} reaches ${value}`);
  }
});

test('the amber still rules a large change: a 180° bank at start on 1,000 m takes the roll bar\'s 655.4 m, with a 20 m rise on that ramp', () => {
  const { o } = viaPanel(flat(), { bank: '180' }, { bank: true });
  assert.equal(o.transition.phi, 655.4);
  assert.ok(Math.abs(o.bankShape.rise - 20 / laidOf(655.4)) < 1e-12);
});

test('a ramp laid in 40 m or less cannot hold a 20 m rise: a cup at start on a 60 m piece takes half of it, 30 m, as the swell\'s halves', () => {
  const o = extendOptions({ length: 60, cup: '30', atStart: { ...NONE, cup: true } });
  assert.equal(o.transition.c, 30);
  assert.deepEqual(o.startShapes, { c: { rise: 0.5, fall: 0.5 } });
  extend(flat(), o);   // and it lays
});

test('nothing ticked: no start shape is asked, and extend without startShapes lays a cup at start as before (the quintic)', () => {
  const o = extendOptions({ length: 1000, bank: '-41.38', cup: '30', atStart: NONE });
  assert.equal(o.startShapes, undefined); assert.equal(o.bankShape, 'rounded'); assert.equal(o.transition, undefined);
  const a = extend(flat(), { length: 1000, targets: { c: 60 }, transition: { c: 300 } }), b = extend(flat(), { length: 1000, targets: { c: 60 }, transition: { c: 300 }, startShapes: null });
  assert.equal(D.serialize(a), D.serialize(b));
});

test('startShapes refuses what is not a start shape: a channel other than c, e, er, or shares that are not a ramp', () => {
  const lay = (startShapes) => extend(flat(), { length: 1000, targets: { c: 60 }, transition: { c: 300 }, startShapes });
  assert.throws(() => lay({ phi: { rise: 0.1, fall: 0.9 } }), /BAD_SHAPE/);
  assert.throws(() => lay({ c: 'swell' }), /BAD_SHAPE/);
  assert.throws(() => lay({ c: { rise: 0.6, fall: 0.6 } }), /BAD_SHAPE/);
  assert.throws(() => lay([]), /BAD_SHAPE/);
});
