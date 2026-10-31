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

// A ramp at start is laid compressed into R − 2R/8 (extend.js rampControl, RAMP_KNOTS_C2), so the change completes at three quarters of the ramp it is asked for
test('on his piece the laid bank follows the asked shares (0.1 / 0.9 over 500 m, compressed to 375 m): within 1.2° of that curve, and far from equal shares', () => {
  const P = his({ rise: 0.1, fall: 0.9 }, 500).pieces[1], Lc = 500 * 0.75;
  let own = 0, sym = 0;
  for (let s = 0; s <= 500; s += 0.5) { const v = D.channelAt(P, 'phi', s).v / DEG; own = Math.max(own, Math.abs(v + 41.38 * rampShape(s / Lc, 0.1, 0.9))); sym = Math.max(sym, Math.abs(v + 41.38 * rampShape(s / Lc, 0.1, 0.1))); }
  assert.ok(own < 1.2, `off its own shape by ${own.toFixed(3)}°`);
  assert.ok(sym > 3, `as near equal shares as its own: ${sym.toFixed(2)}°`);
});

// THE FIT OF A SHAPED BANK AT START (src/core/extend.js shapeKnots): knots across the rise and the fall, so the laid bank is the curve asked for
const { candidates, lay, laidOf } = require('../tools/bank-ramp-candidates.cjs');
test('every candidate, A to F, at 41.38, 20 and 54 degrees: the laid bank stays within 0.25° of its asked curve on the laid length (the order asks 0.5°; it lays 0.17°, and knots spread over the length asked lay 0.37°)', () => {
  for (const bank of [-41.38, -20, -54]) for (const c of candidates(bank)) {
    const P = lay(c, bank).pieces[1], Lc = laidOf(c.ramp), S = (u) => (c.shape === 'swell' ? roundedLinear(u, 0.5) : rampShape(u, c.shape.rise, c.shape.fall));
    let off = 0, at = 0; for (let s = 0; s <= c.ramp; s += 0.5) { const d = Math.abs(D.channelAt(P, 'phi', s).v / DEG - bank * S(s / Lc)); if (d > off) { off = d; at = s; } }
    assert.ok(off < 0.25, `${c.id} at ${bank}°: ${off.toFixed(3)}° off at ${at} m`);
  }
});

// recorded on t180-fresh 98e3d81 (before the shaped fit): sha256 of the serialized document, each laid by the panel (app/core/panel.js extendOptions) or by extend
const NONE = { turn: false, climb: false, bank: false, width: false, cup: false, edge: false, edgeR: false, start: false, tube: false };
const crypto = require('crypto'), { extendOptions } = require('../app/core/panel.js');
const headOf = (d) => { const e = D.endState(d); return { phi: e.phi.v, c: e.c.v, e: e.e ? e.e.v : 0, er: e.er ? e.er.v : 0 }; };
const panel = (f, at, length = 1000) => { const b = extend(D.createDoc('id'), { length: 1000, family: 'bowl' }); return extend(b, extendOptions({ length, ...f, atStart: { ...NONE, ...at }, head: headOf(b) })); };
const base = () => extend(D.createDoc('id'), { length: 1000, family: 'bowl' });
const UNMOVED = [
  ['bank box-off (rounded, whole piece)', () => panel({ bank: '-41.38', cup: '15.5', width: '31' }, {}), '4baca63faf7640e94ef7839d71c3c2b628af9a8ef917a3b2e3d25b373fe07823'],
  ['bank box-off, 100 m', () => panel({ bank: '54' }, {}, 100), 'e22a3fb5423cd583442f9f8703fd7da5061d9b35ba4bd0b83d7feaa501e5961c'],
  // AMENDED (the rule changed, 2026-10-30, the user's "F looks good we can try it": a bank, cup or edge at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, or the roll bar's length where that is longer, app/core/panel.js crossStartM / startShapeOf): the cup and the edge at start move (they were the quintic over 2.2 × |change| / the amber); every case laid by extend alone is as before
  ['cup at start, bank box-off', () => panel({ bank: '-20', cup: '15.5' }, { cup: true }), 'b5aa4467014c819f0047e2e0a843f3b3f4ede50cdc55f4bcddd581c51e34b5f3'],
  ['edge at start', () => panel({ edge: '30' }, { edge: true }), '364c924828beebeb08e37066a701185eb97c9878263abbca20f5c62fdb7c0cfc'],
  // AMENDED (the rule changed, 2026-10-30 22:23, the user: "the start should work the same for the width as well": a width at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, capped at half the piece, app/core/panel.js): the width and turn at start move; the turn keeps its 20 m
  ['width and turn at start', () => panel({ width: '20', turn: '20' }, { width: true, turn: true }), '86306014d634df0a0cdf9e56545c47efb54777ab60b067c8bd7fef33c883deb7'],
  ['a bank at start with no shape', () => extend(base(), { length: 1000, targets: { phi: -0.5 }, transition: { phi: 150 } }), '4e1eb450b81b66f9383a79baa34810b73dcd7ed2648c42087e65b35b94959076'],
  ['the swell over the whole piece', () => extend(base(), { length: 300, targets: { phi: 0.6 }, bankShape: 'swell' }), '0bde7db3c1cdf0d8fa6b81590acd73fb4796fa80cceb8877266b4fce7794f27c'],
  ['the quintic bank, no shape', () => extend(base(), { length: 300, targets: { phi: 0.6 } }), 'cf8e2094802f8b4f1ac66cbdd647f3c429a4f302e4aed810dcf084236a773716'],
];
test('the shaped fit moves nothing else: box-off, whole-piece, cup, edge, width and turn at start, and an unshaped bank at start are byte for byte as before', () => {
  for (const [what, make, want] of UNMOVED) assert.equal(crypto.createHash('sha256').update(D.serialize(make())).digest('hex'), want, what);
});
