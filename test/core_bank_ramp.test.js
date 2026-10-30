// core_bank_ramp.test.js: node --test test/core_bank_ramp.test.js
// THE TWO-SHARE BANK RAMP (src/core/extend.js rampShape, asked for by opts.bankShape { rise, fall }): the bank's roll rate rises over the first `rise` share of the
// ramp (a Bloss rise), holds when rise + fall < 1, and falls over the last `fall` share (a Bloss fall). The rounded-linear ramp and the swell are the case of equal
// shares, so they are exactly that and their exports do not move. An asymmetric ramp (a quick rise, a long fade) is C2 at both ends of the ramp, reaches the bank
// at the ramp's end, and turns one way only. The user's piece: 1,000 m flat, then 1,000 m with bank -41.38 at start, cup 15.5, width 31.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend, roundedLinear, rampShape } = require('../src/core/extend.js');

const DEG = Math.PI / 180;
const flat = () => extend(D.createDoc('ramp'), { length: 1000, family: 'bowl' });
const his = (shape, ramp) => extend(flat(), { length: 1000, targets: { phi: -41.38 * DEG, c: 15.5, w: 31 }, transition: { phi: ramp }, bankShape: shape });

test('rampShape with equal shares IS roundedLinear (the rounded ramp and the swell keep their exact values)', () => {
  for (const a of [0.05, 0.1, 0.25, 0.5]) for (let i = -2; i <= 1002; i++) {
    const u = i / 1000;
    assert.equal(rampShape(u, a, a), roundedLinear(u, a), `u ${u}, a ${a}`);
  }
});

test('rampShape 0.1 / 0.9: S runs 0 to 1, its rate and the rate\'s slope are 0 at both ends (C2), and it never turns back', () => {
  const S = (u) => rampShape(u, 0.1, 0.9), h = 1e-4;
  assert.equal(S(0), 0); assert.equal(S(1), 1); assert.equal(S(-0.5), 0); assert.equal(S(1.5), 1);
  // C2 at an end: the rate shrinks like the square of the distance to it (rate 0 AND the rate's slope 0); a ramp that is only C1 there shrinks like the distance
  const d1 = (u) => (S(u + h) - S(u - h)) / (2 * h);
  for (const end of [0, 1]) for (const x of [1e-2, 1e-3]) { const u = end === 0 ? x : 1 - x, r = d1(u); assert.ok(r >= 0 && r < 1000 * x * x, `S' at ${x} from ${end}: ${r} (C1 only would be ~${x})`); }
  const r1 = d1(2e-3), r2 = d1(1e-3); assert.ok(Math.abs(r1 / r2 - 4) < 0.05, `halving the distance quarters the rate: ${r1 / r2}`);
  let prev = 0; for (let i = 1; i <= 10000; i++) { const v = S(i / 10000); assert.ok(v >= prev - 1e-15, `S falls at u ${i / 10000}`); prev = v; }
  // the quick rise: the rate peaks at the end of the rise, then fades; it is not the swell's mid-ramp peak
  let peakU = 0, peak = 0; for (let i = 1; i < 1000; i++) { const r = d1(i / 1000); if (r > peak) { peak = r; peakU = i / 1000; } }
  assert.ok(Math.abs(peakU - 0.1) <= 0.002, `the rate peaks at the end of the rise, u ${peakU}`);
});

test('rampShape refuses shares that are not a ramp: each above 0, at most 1 together', () => {
  for (const [r, f] of [[0, 0.5], [0.5, 0], [0.6, 0.5], [-0.1, 0.5], [NaN, 0.5]]) assert.throws(() => rampShape(0.5, r, f), /BAD_SHAPE/, `${r}/${f}`);
  assert.throws(() => extend(flat(), { length: 100, targets: { phi: 0.3 }, transition: { phi: 50 }, bankShape: { rise: 0.6, fall: 0.6 } }), /BAD_SHAPE/);
  assert.throws(() => extend(flat(), { length: 100, targets: { phi: 0.3 }, transition: { phi: 50 }, bankShape: 'quick' }), /BAD_SHAPE/);
});

test('on his piece, rise 0.1 / fall 0.9 over 500 m: the bank reaches -41.38 at the ramp\'s end and holds, C2 at the joint and at the ramp\'s end, one way only', () => {
  const P = his({ rise: 0.1, fall: 0.9 }, 500).pieces[1], at = (s) => D.channelAt(P, 'phi', s);
  assert.ok(Math.abs(at(500).v / DEG + 41.38) < 0.01, `at 500 m: ${at(500).v / DEG}`);
  for (const s of [600, 800, 1000]) assert.ok(Math.abs(at(s).v / DEG + 41.38) < 0.01, `held at ${s} m: ${at(s).v / DEG}`);
  for (const s of [0, 500]) { assert.ok(Math.abs(at(s).d1 / DEG) < 1e-3, `rate at ${s} m: ${at(s).d1 / DEG} deg/m`); assert.ok(Math.abs(at(s).d2 / DEG) < 2e-4, `rate's slope at ${s} m: ${at(s).d2 / DEG} deg/m²`); }
  let prev = 0; for (let s = 0; s <= 500; s += 0.5) { const v = at(s).v / DEG; assert.ok(v <= prev + 1e-6, `the bank turns back at ${s} m (${v} after ${prev})`); prev = v; }
});

test('on his piece the quick rise leans sooner than the swell over the same 151 m, and the long fade rolls slower than both', () => {
  const b = (shape, L, s) => D.channelAt(his(shape, L).pieces[1], 'phi', s).v / DEG;
  const peak = (shape, L) => { const P = his(shape, L).pieces[1]; let m = 0; for (let s = 0; s <= L; s += 0.5) m = Math.max(m, Math.abs(D.channelAt(P, 'phi', s).d1 / DEG)); return m; };
  assert.ok(Math.abs(b({ rise: 0.1, fall: 0.9 }, 151, 20)) > Math.abs(b('swell', 151, 20)), 'B leans further than A by 20 m');
  assert.ok(peak({ rise: 0.1, fall: 0.9 }, 500) < peak('swell', 151), 'C rolls slower than A');
});
