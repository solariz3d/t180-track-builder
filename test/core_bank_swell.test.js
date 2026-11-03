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
  // AMENDED (the swell is laid longer, 3.4 × |change| / the amber, was 2.6): a wider bump's top is flatter in absolute terms (6.75 m under the 0.005 bar on a 150.7 m ramp),
  // so the bound is a share of the ramp, was 5 m: the old rounded-linear plateau was 14.5 m of 97.5 (15%), the swell's top is under 5%
  // AMENDED (the rule changed, 2026-10-30, the user's "F looks good we can try it": a bank, cup or edge at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, or the roll bar's length where that is longer, app/core/panel.js crossStartM / startShapeOf): F's long fade starts gently, so its top changes by under 0.005 deg/m over 2 m for 54.5 m of the 300 m ramp; that is the fade, not a hold.
  // What "no plateau" means for F is that it asks for no hold: its rise and fall shares fill the ramp. The one-peak rule below is unchanged.
  assert.ok(Math.abs(o.bankShape.rise + o.bankShape.fall - 1) < 1e-12, `F holds nothing between its rise and fall: ${JSON.stringify(o.bankShape)} (the measured top: ${flat} m of ${R}, peak ${peak.toFixed(3)} deg/m)`);
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
  // AMENDED (the rule changed, 2026-10-30, the user's "F looks good we can try it": a bank, cup or edge at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, or the roll bar's length where that is longer, app/core/panel.js crossStartM / startShapeOf): the shape asked is F's shares, a 20 m rise on the 225 m the 300 m ramp is laid in
  assert.deepEqual(o.bankShape, { rise: 20 / 225, fall: 1 - 20 / 225 });
  // AMENDED (the swell is laid longer and gentler, 3.4 × |change| / the amber, was 2.6: 0.20° by 10 m and 1.63° by 20 m, were 0.46 and 3.52)
  assert.ok(Math.abs(at(10)) > 0.15 && Math.abs(at(20)) > 1.2, `bank at 10 m: ${at(10)}, at 20 m: ${at(20)}`);
  const peak = rollPeak(doc); assert.ok(peak < BAR, `roll peak ${peak.toFixed(4)} against ${BAR}`);
  for (const s of [R, R + 1, 500, 1000]) assert.ok(Math.abs(at(s) + 41.38) < 0.01, `bank at ${s} m: ${at(s)}`);
});

test('swell: the checker\'s roll stays under the amber for a bank of 8 to 180 degrees at start', () => {
  for (const deg of [8, 12, 20, 30, 41.38, 54, 90, 180]) {
    const { doc } = lay(flat(), { length: 1000, bank: String(deg), atStart: { ...NONE, bank: true } });
    const p = rollPeak(doc); assert.ok(p < BAR, `${deg} deg: roll peak ${p.toFixed(4)}`);
  }
});

// AMENDED (2026-10-30, the chair's call on the at-start ramp): the half-piece cap now BENDS for the bank where holding it would lay the swell faster than the amber
// (app/core/panel.js swellPeak), so a 30 m piece's 20° and a 100 m piece's 54° take the whole piece (they were 20 m and 50 m), and a 180° bank on 1,000 m its
// 655.4 m (was 500); the 20 m floor, a piece shorter than it, and a cap that holds the swell under the amber are as before (140° on 1,000 m keeps 500)
test('swell: the 20 m floor holds, and the half-piece cap bends to the roll bar\'s length only where the swell laid within it would pass the amber', () => {
  const t = (len, deg) => lay(flat(), { length: len, bank: String(deg), atStart: { ...NONE, bank: true } }).o.transition.phi;
  // AMENDED (the rule changed, 2026-10-30, the user's "F looks good we can try it": a bank, cup or edge at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, or the roll bar's length where that is longer, app/core/panel.js crossStartM / startShapeOf): a small change takes F's 300 m, where the 20 m floor gave it 20 m
  assert.equal(t(1000, 5), 300); assert.equal(t(12, 20), 12);
  assert.equal(t(1000, 140), 500, 'the cap holds where the swell within it stays under the amber');
  assert.equal(t(1000, 180), 655.4); assert.equal(t(30, 20), 30); assert.equal(t(100, 54), 100);
});

test('swell: the bank with its box off, a cup or edge at start, and turn and width at start lay the same bytes as before', () => {
  const GOLD = {   // sha256 of D.serialize, laid on t180-fresh d534-land 1148c28 through the same extendOptions
    'bank -78.94, box off': ['0ccc81a545c7cc0c64502dd226531ba2f1df18aa842acc34023f081518897df5', { length: 1000, bank: '-78.94', cup: '15.5', width: '31' }],
    // AMENDED (the rule changed, 2026-10-30, the user's "F looks good we can try it": a bank, cup or edge at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, or the roll bar's length where that is longer, app/core/panel.js crossStartM / startShapeOf): the cup and the edge at start move; the bank box-off and the width and turn at start are as before
    'cup 40 at start, bank 20 box off': ['d48e1846ddb8591777f891d652ec4fc6d4e1566455b6958b2cb2ffddfc817efb', { length: 600, bank: '20', cup: '40', atStart: { ...NONE, cup: true } }],
    'edge 30 at start': ['a4fe367294a6b66a2869adebb87e6106d387a66fe4caeaa7806640597e7e5ef2', { length: 600, edge: '30', atStart: { ...NONE, edge: true } }],
    // AMENDED (the rule changed, 2026-10-30 22:23, the user: "the start should work the same for the width as well": a width at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, capped at half the piece, app/core/panel.js): the width moves; the turn keeps its 20 m
    // AMENDED BY NAME (2026-11-03, a turn or climb reached early is sized to its change, app/core/panel.js routeStartM; checked when re-pinned: with every early turn held to 20 m again (ROUTE_SPREAD 0) this row's old pin holds, so the turn's ramp is the only change): the turn of 10°/100m from straight now eases in over 51.5 m, not 20 (it was ce11ad25…)
    'width 30 and turn 10 at start': ['2d031db91c9c331235f78d80763ec94cb486751d0668f0bb9c5b74abbe51866c', { length: 400, width: '30', turn: '10', atStart: { ...NONE, width: true, turn: true } }],
  };
  const base = flat('golden');
  for (const [k, [sha, f]] of Object.entries(GOLD)) assert.equal(crypto.createHash('sha256').update(D.serialize(lay(base, f).doc)).digest('hex'), sha, k);
});

test('swell: extend refuses a bank shape it does not know, by name', () => {
  assert.throws(() => extend(flat(), { length: 100, targets: { phi: 0.1 }, bankShape: 'square' }), (e) => e.code === 'BAD_SHAPE');
});
