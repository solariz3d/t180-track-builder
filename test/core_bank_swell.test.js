// core_bank_swell.test.js: node --test test/core_bank_swell.test.js
// A BANK AT START IS ONE SWELL (src/core/extend.js bankShape 'swell', sent by app/core/panel.js for a ticked bank): the roll rate rises smoothly from the joint
// to one peak in the middle of the ramp and falls smoothly to 0, with no plateau between two quick bends, so the bank has no shoulder where its ramp ends.
// The user's piece: 1,000 m flat, then 1,000 m with bank -41.38 at start, cup 15.5, width 31 ("it should start where it does but not as sharp gradient").
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const AD = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180, BAR = V.ROLL_AMBER_DEG_M;
const NONE = { turn: false, climb: false, bank: false, width: false, cup: false, edge: false, edgeR: false, start: false, tube: false };
const flat = (name = 'swell') => extend(D.createDoc(name), { length: 1000, family: 'bowl' });
const headOf = (doc) => { const e = D.endState(doc); return { phi: e.phi.v, c: e.c.v, e: e.e ? e.e.v : 0, er: e.er ? e.er.v : 0 }; };
const lay = (doc, fields) => { const o = extendOptions({ atStart: NONE, ...fields, head: headOf(doc) }); return { o, doc: extend(doc, o), P: null }; };
function his() { const base = flat(); const r = lay(base, { length: 1000, bank: '-41.38', cup: '15.5', width: '31', atStart: { ...NONE, bank: true } }); r.P = r.doc.pieces[1]; return r; }
const rateOf = (P) => (s) => D.channelAt(P, 'phi', s).d1 / DEG;   // the bank's own rate along the piece, deg/m
const rollPeak = (doc) => { const { segments, path } = AD.toPath(doc, { step: 2 }), S = path.samples, id = doc.pieces[doc.pieces.length - 1].id;
  return V._internal.rollRates(S, (i) => segments[S[i].seg].kind !== 'gap', false, path.lengthM).reduce((m, q) => (segments[S[q.i].seg].id === id ? Math.max(m, q.rate) : m), 0); };
// on the same piece before this change (the rounded-linear ramp, t180-fresh d534-land 1148c28): the rate's largest change over any 2 m
const KINK_BEFORE = 0.16289;

// Before this change the laid rate rose to 0.896 deg/m by 20 m, sagged to a 0.656 plateau from 32 m to 52 m, and fell to 0 by 84 m: a hump, a flat, a drop.
test('swell: on his piece the bank\'s rate rises to one peak and falls, with no flat stretch and no second rise (no plateau)', () => {
  const { o, P } = his(), R = o.transition.phi, rate = (s) => Math.abs(rateOf(P)(s));
  let peak = 0; for (let s = 0; s <= R; s += 0.25) peak = Math.max(peak, rate(s));
  // the longest stretch where the rate is at least a tenth of its peak and changes by less than 0.005 deg/m over 2 m
  let flat = 0, run = 0; for (let s = 0; s + 2 <= R; s += 0.25) { if (rate(s) > 0.1 * peak && Math.abs(rate(s + 2) - rate(s)) < 0.005) { run += 0.25; flat = Math.max(flat, run); } else run = 0; }
  assert.ok(flat < 5, `the rate holds flat for ${flat} m (peak ${peak.toFixed(3)} deg/m)`);
  // one peak: once the rate starts to fall by more than 0.002 over 2 m it never rises again by more than that
  let falling = false, rises = 0; for (let s = 0; s + 2 <= R + 5; s += 0.25) { const d = rate(s + 2) - rate(s); if (d < -0.002) falling = true; else if (falling && d > 0.002) rises++; }
  assert.equal(rises, 0, 'the rate rises again after it has started to fall');
});

test('swell: the kink (the rate\'s largest change over 2 m) is at most half of what it was', () => {
  const { o, P } = his(), R = o.transition.phi, rate = rateOf(P);
  let kink = 0; for (let s = 0; s + 2 <= R + 5; s += 0.25) kink = Math.max(kink, Math.abs(rate(s + 2) - rate(s)));
  assert.ok(kink <= KINK_BEFORE / 2, `kink ${kink.toFixed(5)} deg/m over 2 m against ${KINK_BEFORE} before`);
});

// "moving by 5 m" (|bank| > 0.1° at 5 m) cannot hold for a swell under the bar: its rate starts at zero slope, so the bank grows like 8u³ at first (the quintic's 10u³),
// and the ramp the bar needs is long. Measured on his piece: 0.094° at 5 m with a ramp of 97.5 m (whose roll is over the amber), 0.057° at the 115.3 m the bar needs.
// What holds, and what his eye reads, is moving by 10 m and well banked by 20 m.
test('swell: the bank is moving by 10 m and well under way by 20 m, peaks under the checker\'s roll amber, reaches -41.38 at the ramp\'s end and holds it', () => {
  const { o, doc, P } = his(), R = o.transition.phi, at = (s) => D.channelAt(P, 'phi', s).v / DEG;
  assert.equal(o.bankShape, 'swell');
  assert.ok(Math.abs(at(10)) > 0.3 && Math.abs(at(20)) > 2, `bank at 10 m: ${at(10)}, at 20 m: ${at(20)}`);
  const peak = rollPeak(doc); assert.ok(peak < BAR, `roll peak ${peak.toFixed(4)} against ${BAR}`);
  for (const s of [R, R + 1, 500, 1000]) assert.ok(Math.abs(at(s) + 41.38) < 0.01, `bank at ${s} m: ${at(s)}`);
});

test('swell: the checker\'s roll stays under the amber for a bank of 8 to 180 degrees at start', () => {
  for (const deg of [8, 12, 20, 30, 41.38, 54, 90, 180]) {
    const { doc } = lay(flat(), { length: 1000, bank: String(deg), atStart: { ...NONE, bank: true } });
    const p = rollPeak(doc); assert.ok(p < BAR, `${deg} deg: roll peak ${p.toFixed(4)}`);
  }
});

test('swell: the 20 m floor and the cap are as before (5 deg -> 20 m; a 30 m piece -> 20 m; 54 deg on 100 m -> 50 m)', () => {
  const t = (len, deg) => lay(flat(), { length: len, bank: String(deg), atStart: { ...NONE, bank: true } }).o.transition.phi;
  assert.equal(t(1000, 5), 20); assert.equal(t(30, 20), 20); assert.equal(t(12, 20), 12); assert.equal(t(100, 54), 50);
});

test('swell: the bank with its box off, a cup or edge at start, and turn and width at start lay the same bytes as before', () => {
  const GOLD = {   // sha256 of D.serialize, laid on t180-fresh d534-land 1148c28 through the same extendOptions
    'bank -78.94, box off': ['0ccc81a545c7cc0c64502dd226531ba2f1df18aa842acc34023f081518897df5', { length: 1000, bank: '-78.94', cup: '15.5', width: '31' }],
    'cup 40 at start, bank 20 box off': ['fab9e91cc780d2156911c4107a4f2a83492e99cbf656a97adc4840202ca96d27', { length: 600, bank: '20', cup: '40', atStart: { ...NONE, cup: true } }],
    'edge 30 at start': ['5d28f3b0fd135e44988da151c1f8cb8e8a31f5d33159added1e8ea529228d26f', { length: 600, edge: '30', atStart: { ...NONE, edge: true } }],
    'width 30 and turn 10 at start': ['cbf84a1c224d63a0fec5f544bfa76f45ee046b3916b41d951781be00ce8b93ab', { length: 400, width: '30', turn: '10', atStart: { ...NONE, width: true, turn: true } }],
  };
  const base = flat('golden');
  for (const [k, [sha, f]] of Object.entries(GOLD)) assert.equal(crypto.createHash('sha256').update(D.serialize(lay(base, f).doc)).digest('hex'), sha, k);
});

test('swell: extend refuses a bank shape it does not know, by name', () => {
  assert.throws(() => extend(flat(), { length: 100, targets: { phi: 0.1 }, bankShape: 'square' }), (e) => e.code === 'BAD_SHAPE');
});
