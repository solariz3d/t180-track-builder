// core_extend_at_start.test.js: node --test test/core_extend_at_start.test.js
// "AT START" FOR THE CROSS-SECTION (app/core/panel.js extendOptions): a ticked bank, cup or edge reaches its value as early as the road can roll to it, at least
// 20 m and never faster than the checker's roll amber, then holds it. Turn, climb and width keep their 20 m. The user's piece: a 1,000 m piece after a straight,
// bank 20° at start, which twisted over its first 20 m.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const AD = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180, BAR = V.ROLL_AMBER_DEG_M;
const straight = () => extend(D.createDoc('at start'), { length: 1000, family: 'bowl' });
/** The head as the panel reads it (coreshell headState's channels): phi in rad, c, e and er in degrees. */
const headOf = (doc) => { const e = D.endState(doc); return { phi: e.phi.v, c: e.c.v, e: e.e ? e.e.v : 0, er: e.er ? e.er.v : 0 }; };
const NONE = { turn: false, climb: false, bank: false, width: false, cup: false, edge: false, edgeR: false, start: false, tube: false };
function piece(doc, fields, ticks) { const o = extendOptions({ ...fields, atStart: { ...NONE, ...ticks }, head: headOf(doc) }); return { o, doc: extend(doc, o) }; }
/** The largest roll rate (°/m, the checker's 20 m chord) on the last piece. */
function rollPeak(doc) {
  const { segments, path } = AD.toPath(doc, { step: 2 }), S = path.samples, id = doc.pieces[doc.pieces.length - 1].id;
  return V._internal.rollRates(S, (i) => segments[S[i].seg].kind !== 'gap', false, path.lengthM).reduce((m, q) => (segments[S[q.i].seg].id === id ? Math.max(m, q.rate) : m), 0);
}
const bankAt = (doc, s) => { const P = doc.pieces[doc.pieces.length - 1]; return D.channelAt(P, 'phi', s).v / DEG; };

test('at start: bank 20° on a 1,000 m piece after a straight rolls under the checker\'s amber, reaches 20° within its ramp, and holds it', () => {
  const { o, doc } = piece(straight(), { length: 1000, bank: '20' }, { bank: true }), R = o.transition.phi;
  const peak = rollPeak(doc);
  assert.ok(peak < BAR, `the roll peaks at ${peak.toFixed(4)} °/m, the amber is ${BAR}`);
  for (const s of [R, R + 1, 500, 1000]) assert.ok(Math.abs(bankAt(doc, s) - 20) < 0.01, `bank at ${s} m: ${bankAt(doc, s)}°`);
  // AMENDED (the rule changed: a bank at start is one swell, laid over 3.4 × |change| / the amber, was 2.6 and before that 2.2; 20° is 72.9 m, was 55.7 and 47.2)
  // AMENDED (the rule changed, 2026-10-30, the user's "F looks good we can try it": a bank, cup or edge at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, or the roll bar's length where that is longer, app/core/panel.js crossStartM / startShapeOf): 20° takes F's 300 m (was 72.9)
  assert.equal(R, 300, `F's ramp: ${R} m`);
});

test('at start: 54° of bank comes in over about 197 m, under the amber; 5° keeps the 20 m floor', () => {
  const big = piece(straight(), { length: 1000, bank: '54' }, { bank: true });
  // AMENDED (the rule changed: the bank's swell is laid over 3.4 × |change| / the amber; 54° is 196.7 m, was 150.4 and 127.3)
  // AMENDED (the rule changed, 2026-10-30, the user's "F looks good we can try it": a bank, cup or edge at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, or the roll bar's length where that is longer, app/core/panel.js crossStartM / startShapeOf): 54° wants 196.7 m of the roll bar, under F's 300, so it takes 300
  assert.equal(big.o.transition.phi, 300, `54°: ramp ${big.o.transition.phi} m`);
  assert.ok(rollPeak(big.doc) < BAR, `54°: the roll peaks at ${rollPeak(big.doc)} °/m`);
  assert.ok(Math.abs(bankAt(big.doc, big.o.transition.phi) - 54) < 0.01);
  const small = piece(straight(), { length: 1000, bank: '5' }, { bank: true });
  // AMENDED (the rule changed, 2026-10-30, the user's "F looks good we can try it": a bank, cup or edge at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, or the roll bar's length where that is longer, app/core/panel.js crossStartM / startShapeOf): 5° takes F's 300 m, not the 20 m floor
  assert.equal(small.o.transition.phi, 300, '5°: F\'s 300 m');
});

// AMENDED (the rule changed, 2026-10-30, the user's "F looks good we can try it": a bank, cup or edge at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, or the roll bar's length where that is longer, app/core/panel.js crossStartM / startShapeOf): a small change now takes F's 300 m from any head, so the head's part shows where the roll bar is longer than F: 180° on a 2,000 m piece
test('at start: the change is measured from the head, so a road already banked 15° going to 180° takes the roll bar\'s 600.8 m, where from flat it is 655.4', () => {
  const d0 = extend(straight(), { length: 300, targets: { phi: 15 * DEG }, bankShape: 'rounded' });
  assert.equal(piece(d0, { length: 2000, bank: '180' }, { bank: true }).o.transition.phi, 600.8);
  assert.equal(piece(straight(), { length: 2000, bank: '180' }, { bank: true }).o.transition.phi, 655.4);
  assert.equal(piece(d0, { length: 1000, bank: '20' }, { bank: true }).o.transition.phi, 300, '15° to 20°: F\'s 300 m');
});

test('at start: the cup and the edges come in no faster than the roll amber either; a short piece is never laid faster than before', () => {
  const d = straight(), h = headOf(d), { o } = piece(d, { length: 1000, cup: '40', edge: '30' }, { cup: true, edge: true });
  // measured from the head: a plain road's cup is the edge it renders (h.c), its edge angle 0
  // AMENDED (the rule changed, 2026-10-30, the user's "F looks good we can try it": a bank, cup or edge at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, or the roll bar's length where that is longer, app/core/panel.js crossStartM / startShapeOf): the cup and the edge take F's 300 m, or the roll bar's 3.4 × |change| / the amber where that is longer (they were 2.2 ×)
  assert.deepEqual({ c: o.transition.c, e: o.transition.e }, { c: Math.max(300, Math.ceil(3.4 * (40 - h.c) / BAR * 10 - 1e-9) / 10), e: Math.max(300, Math.ceil(3.4 * (30 - h.e) / BAR * 10 - 1e-9) / 10) }, `${JSON.stringify(o.transition)} from cup ${h.c}`);
  // a piece under 40 m: the ramp is what "at start" laid before (20 m, or the piece if shorter), not half the piece, which would roll faster
  const short = piece(straight(), { length: 30, bank: '20' }, { bank: true });
  // AMENDED (the rule changed, 2026-10-30: the bank's half-piece cap bends to the roll bar's length where holding it would lay the swell faster than the amber, app/core/panel.js swellPeak): a 20° bank in a 30 m piece's 20 m would pass the amber, so it takes the whole piece; never shorter than before
  assert.equal(short.o.transition.phi, 30, '30 m piece: the whole piece, no faster than before');
  assert.equal(piece(straight(), { length: 12, bank: '20' }, { bank: true }).o.transition.phi, 12, '12 m piece: its length, as before');
  // AMENDED (the rule changed, 2026-10-30: the bank's half-piece cap bends to the roll bar's length where holding it would lay the swell faster than the amber, app/core/panel.js swellPeak): 54° on a 100 m piece within 50 m would roll 2.9 °/m, so it takes the whole piece (it was 50 m)
  assert.equal(piece(straight(), { length: 100, bank: '54' }, { bank: true }).o.transition.phi, 100);
});

// AMENDED (the rule changed, 2026-10-30 22:23, the user: "the start should work the same for the width as well": a width at start is candidate F, a 20 m rise as laid then a fade over a 300 m ramp, capped at half the piece, app/core/panel.js): the width leaves this row (test/core_width_at_start_f.test.js has it); turn and climb keep 20 m
test('at start: turn and climb keep exactly 20 m, the width takes F (half this 400 m piece, 200 m); nothing ticked sends no transition, and the bytes Extend lays are as before', () => {
  const d = straight(), h = headOf(d);
  const o = extendOptions({ length: 400, turn: '10', climb: '2', width: '30', atStart: { ...NONE, turn: true, climb: true, width: true }, head: h });
  assert.deepEqual(o.transition, { kh: 20, kv: 20, w: 200 });
  assert.equal(D.serialize(extend(d, o)), D.serialize(extend(d, { length: 400, targets: o.targets, transition: { kh: 20, kv: 20, w: 200 }, startShapes: o.startShapes })));
  const plain = extendOptions({ length: 400, bank: '20', width: '30', atStart: NONE, head: h });
  assert.equal(plain.transition, undefined, 'no box ticked: no transition');
  assert.equal(D.serialize(extend(d, plain)), D.serialize(extend(d, { length: 400, targets: plain.targets, bankShape: 'rounded' })));
});
