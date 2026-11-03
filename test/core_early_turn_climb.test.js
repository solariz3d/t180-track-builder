// core_early_turn_climb.test.js: node --test test/core_early_turn_climb.test.js
// A TURN OR CLIMB REACHED "EARLY", SIZED TO ITS CHANGE (the user, 2026-11-03, on ELYSIUM NEW's mega drop: "the bump with the climb that is where the new piece
// then starts climbing back up with banking"; his answer to the fix: "I like the idea of 2, but almost wish we could just make the generation system one shot
// this problem on its own"). A ticked turn or climb (read as a rate) was reached within AT_START_M = 20 m whatever its size (app/core/panel.js), and Extend lays
// a ramp in about half its length (src/core/extend.js rampControl), so his p33's pull-out of a −87° dive, a climb of 0 → −2.513e-3 /m, changed the
// curvature 3.18 times faster than the bar (its turn 5.49): the load at 170 m/s changing by more than 3 g over 10 m of road (κ′ ≤ 29.4 / (10 · 170²) /m²). Now the ramp is
// max(20 m, ROUTE_SPREAD · |Δκ| / bar), at most half the piece (never below 20 m or a shorter piece's own length), as the bank, cup, edge and width already are.
// Rows:
//   1  his p33's early climb, laid by the panel's options and the real writer: the curvature changes no faster than the bar (before: 3.18×; his turn there 5.49×)
//   2  his p33's early turn (0 → −4.346e-3 /m on 750 m): the same
//   3  the ramp's length follows the change: a small change keeps 20 m, a large one its length up to half the piece, a short piece its own length
//   4  nothing overshoots: the laid climb stays between where it starts and its target
//   5  nothing else moves: the bank, cup, edge and width "early" ramps are what they were, and a turn read as a CORNER takes no transition
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180, BAR = 29.4 / (10 * 170 * 170);
const NONE = { turn: false, climb: false, bank: false, width: false, cup: false, edge: false, edgeR: false, start: false, tube: false };
const BLANK = { turn: '', climb: '', bank: '', width: '', cup: '', edge: '', start: '', tube: '' };
const per100 = (k) => String((k * 100) / DEG);   // a curvature (rad/m) as the field reads it (degrees per 100 m)
// a piece laid the way the panel lays it, after a held straight: its options, the document, and the laid channel's largest rate and range
function laid(field, ch, k, length) {
  const before = extend(D.createDoc('early'), { length: 300, family: 'bowl' });
  const opts = extendOptions({ length: String(length), ...BLANK, [field]: per100(k), atStart: { ...NONE, [field]: true }, turnAs: 'rate', head: { kh: 0, kv: 0, phi: 0, w: 31, c: 0 } });
  const doc = extend(before, opts), P = doc.pieces[doc.pieces.length - 1];
  let rate = 0, lo = Infinity, hi = -Infinity; for (let s = 0; s <= P.length; s += 0.25) { const c = D.channelAt(P, ch, s); rate = Math.max(rate, Math.abs(c.d1)); lo = Math.min(lo, c.v); hi = Math.max(hi, c.v); }
  return { opts, P, rate, lo, hi };
}

test('row 1: his p33\'s early climb (0 → −2.513e-3 /m on 750 m) changes the curvature no faster than the bar (it was 3.18 times)', () => {
  const r = laid('climb', 'kv', -2.513e-3, 750);
  assert.ok(r.rate <= BAR * 1.0001, `the laid climb's curvature changes at ${(r.rate / BAR).toFixed(2)} times the bar (ramp ${r.opts.transition.kv} m)`);
});

test('row 2: his p33\'s early turn (0 → −4.346e-3 /m on 750 m) changes the curvature no faster than the bar', () => {
  const r = laid('turn', 'kh', -4.346e-3, 750);
  assert.ok(r.rate <= BAR * 1.0001, `the laid turn's curvature changes at ${(r.rate / BAR).toFixed(2)} times the bar (ramp ${r.opts.transition.kh} m)`);
});

test('row 3: the ramp follows the change: a small change keeps 20 m, a large one grows to at most half the piece, a short piece keeps its own length', () => {
  const t = (field, k, length) => extendOptions({ length: String(length), ...BLANK, [field]: per100(k), atStart: { ...NONE, [field]: true }, turnAs: 'rate', head: { kh: 0, kv: 0 } }).transition;
  assert.deepEqual(t('climb', 1e-4, 750), { kv: 20 }, 'a small climb keeps the 20 m floor');
  const big = t('climb', -2.513e-3, 750).kv;
  assert.ok(big > 20 && big < 750 / 2, `a large climb grows: ${big} m`);
  assert.deepEqual(t('turn', -4e-2, 300), { kh: 150 }, 'a very large turn stops at half the piece');
  assert.deepEqual(t('turn', -4e-2, 12), { kh: 12 }, 'a piece shorter than 20 m: its own length');
  // measured from where the track is: the same target from a head already turning that way is a smaller change
  const from = extendOptions({ length: '750', ...BLANK, climb: per100(-2.513e-3), atStart: { ...NONE, climb: true }, turnAs: 'rate', head: { kh: 0, kv: -2.4e-3 } }).transition.kv;
  assert.equal(from, 20, 'from a head climbing at −2.4e-3, reaching −2.513e-3 is a small change: 20 m');
});

test('row 4: nothing overshoots: the laid climb stays between where it starts and its target', () => {
  const r = laid('climb', 'kv', -2.513e-3, 750);
  assert.ok(r.lo >= -2.513e-3 - 1e-9 && r.hi <= 1e-9, `the laid climb runs ${r.lo} to ${r.hi}`);
});

test('row 5: nothing else moves: the cross-section and width ramps are as they were, and a turn read as a corner takes no transition', () => {
  const base = { length: '100', ...BLANK };
  assert.deepEqual(extendOptions({ ...base, width: '45', atStart: { ...NONE, width: true } }).transition, { w: 50 }, 'width at start: F, held to half this 100 m piece');
  assert.deepEqual(extendOptions({ ...base, bank: '30', cup: '90', atStart: { ...NONE, bank: true, cup: true } }).transition, { phi: 100, c: 50 }, 'bank and cup: as before');
  assert.equal(extendOptions({ ...base, turn: '30', atStart: { ...NONE, turn: true }, turnAs: 'corner' }).transition, undefined, 'a corner has no rate target');
});
