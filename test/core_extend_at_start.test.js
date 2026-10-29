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
  assert.ok(R < 50, `still early in a 1,000 m piece: ramp ${R} m`);
});

test('at start: 54° of bank comes in over about 127 m, under the amber; 5° keeps the 20 m floor', () => {
  const big = piece(straight(), { length: 1000, bank: '54' }, { bank: true });
  assert.ok(big.o.transition.phi > 126 && big.o.transition.phi < 128.5, `54°: ramp ${big.o.transition.phi} m`);
  assert.ok(rollPeak(big.doc) < BAR, `54°: the roll peaks at ${rollPeak(big.doc)} °/m`);
  assert.ok(Math.abs(bankAt(big.doc, big.o.transition.phi) - 54) < 0.01);
  const small = piece(straight(), { length: 1000, bank: '5' }, { bank: true });
  assert.equal(small.o.transition.phi, 20, '5°: the 20 m floor');
});

test('at start: the change is measured from the head, so a road already banked 15° going to 20° keeps the 20 m floor', () => {
  const d0 = extend(straight(), { length: 300, targets: { phi: 15 * DEG }, bankShape: 'rounded' });
  const { o } = piece(d0, { length: 1000, bank: '20' }, { bank: true });
  assert.equal(o.transition.phi, 20);
});

test('at start: the cup and the edges come in no faster than the roll amber either; a short piece is never laid faster than before', () => {
  const d = straight(), h = headOf(d), { o } = piece(d, { length: 1000, cup: '40', edge: '30' }, { cup: true, edge: true });
  // measured from the head: a plain road's cup is the edge it renders (h.c), its edge angle 0
  assert.ok(Math.abs(o.transition.c - 2.2 * (40 - h.c) / BAR) < 0.11 && Math.abs(o.transition.e - 2.2 * (30 - h.e) / BAR) < 0.11, `${JSON.stringify(o.transition)} from cup ${h.c}`);
  // a piece under 40 m: the ramp is what "at start" laid before (20 m, or the piece if shorter), not half the piece, which would roll faster
  const short = piece(straight(), { length: 30, bank: '20' }, { bank: true });
  assert.equal(short.o.transition.phi, 20, '30 m piece: 20 m, as before');
  assert.equal(piece(straight(), { length: 12, bank: '20' }, { bank: true }).o.transition.phi, 12, '12 m piece: its length, as before');
  // and a long one keeps half the piece held: 54° on a 100 m piece ramps over 50 m
  assert.equal(piece(straight(), { length: 100, bank: '54' }, { bank: true }).o.transition.phi, 50);
});

test('at start: turn, climb and width keep exactly 20 m; nothing ticked sends no transition, and the bytes Extend lays are as before', () => {
  const d = straight(), h = headOf(d);
  const o = extendOptions({ length: 400, turn: '10', climb: '2', width: '30', atStart: { ...NONE, turn: true, climb: true, width: true }, head: h });
  assert.deepEqual(o.transition, { kh: 20, kv: 20, w: 20 });
  assert.equal(D.serialize(extend(d, o)), D.serialize(extend(d, { length: 400, targets: o.targets, transition: { kh: 20, kv: 20, w: 20 } })));
  const plain = extendOptions({ length: 400, bank: '20', width: '30', atStart: NONE, head: h });
  assert.equal(plain.transition, undefined, 'no box ticked: no transition');
  assert.equal(D.serialize(extend(d, plain)), D.serialize(extend(d, { length: 400, targets: plain.targets, bankShape: 'rounded' })));
});
