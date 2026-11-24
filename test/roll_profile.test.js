// roll_profile.test.js: node --test test/roll_profile.test.js
// The instrument the smooth-bank rows read with (test/roll_profile.js), held to known answers. The builder's own checker reads the roll over a 20 m chord and
// so averages a stop away (a roll that halts at a mark and starts again); this instrument reads it over 4 m and names each stop. Plan: lighthouse
// exo_memory/loop/plan_t180_smooth_banked_turns_2026-11-24.md, Part 0.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const TB = require('../src/core/turnby.js');
const RP = require('./roll_profile.js');

const DEG = Math.PI / 180;
const straight = (L = 300) => extend(D.createDoc('rp'), { length: L, family: 'bowl' });
/** A profile from a function of s (degrees), every 0.5 m over [0, L]. */
const fromFn = (f, L) => { const out = []; for (let s = 0; s <= L + 1e-9; s += 0.5) out.push({ s, v: f(s) }); return out; };

test('a bank linear in s has no stops, and its rate is the slope on every chord', () => {
  const p = fromFn((s) => 0.2 * s, 200);
  for (const chord of [4, 8, 20]) for (const x of RP.rateOn(p, chord).filter((r) => r.s >= chord && r.s <= 200 - chord)) assert.ok(Math.abs(x.r - 0.2) < 1e-9, `rate ${x.r} at ${x.s} over ${chord} m`);
  assert.deepEqual(RP.stops(p, () => 0.2), []);
});

test('one piece with a rounded bank and a bank change at its end: the document reads exactly one stop, and the change\'s mark is inside it', () => {
  // 0 to 20° over the first 100 m, then a change to 40° from 100 m: both ramps start and end at rest (src/core/extend.js), so the roll halts at 100 m
  const d = extend(straight(), { length: 200, targets: { phi: 20 * DEG }, transition: { phi: 100 }, bankShape: 'rounded', changes: { phi: [{ from: 100, target: 40 * DEG }] }, bankCheck: false });
  const st = RP.stops(RP.docBank(d.pieces[1]), () => 0.2);
  assert.equal(st.length, 1, JSON.stringify(st));
  assert.ok(st[0].s - 2 <= 100 && 100 <= st[0].e + 2, `the stop is the stretch ${st[0].s} to ${st[0].e}`);   // a halt is a stretch: the ramp arrives, holds, and the change starts from rest
});

test('two rounded ramps laid end to end by today\'s extend, the same way: the document reads exactly one stop, and their joint is inside it (the plan\'s row 2 as written)', () => {
  const d = extend(extend(straight(), { length: 100, targets: { phi: 20 * DEG }, bankShape: 'rounded' }), { length: 100, targets: { phi: 40 * DEG }, bankShape: 'rounded' });
  const both = [...RP.docBank(d.pieces[1]), ...RP.docBank(d.pieces[2]).slice(1).map((x) => ({ s: x.s + 100, v: x.v }))];
  const st = RP.stops(both, () => 0.2);
  assert.equal(st.length, 1, JSON.stringify(st));
  assert.ok(st[0].s - 2 <= 100 && 100 <= st[0].e + 2, `the stop is the stretch ${st[0].s} to ${st[0].e}`);
});

test('a road at a constant turn rate of 1/50 per metre reads a radius of 50 ± 0.5 m', () => {
  const d = extend(D.createDoc('c'), { length: 400, first: { kh: 1 / 50 } });
  const t = RP.turnOf(d, 20, 380);
  assert.ok(Math.abs(t.radius - 50) <= 0.5, `radius ${t.radius}`);
  assert.ok(Math.abs(Math.abs(t.deg) - (360 / 50) * (180 / Math.PI)) <= 0.5, `angle ${t.deg}`);
});

test('a 90° corner laid by extendCorner reads 90 ± 0.2°', () => {
  const d = TB.extendCorner(straight(), { length: 150, turnDeg: 90 });
  const t = RP.turnOf(d, 250, 500);
  assert.ok(Math.abs(t.deg - 90) <= 0.2, `angle ${t.deg}`);
  assert.ok(t.span > 0 && t.span < 150, `span ${t.span}`);
});

test('a held bank, with no roll anywhere, has no stops (a hold is not a stop)', () => {
  assert.deepEqual(RP.stops(fromFn(() => 25, 200), () => 0), []);
  // and where the target profile rolls slower than the floor, a halt there is not counted either
  assert.deepEqual(RP.stops(fromFn(() => 25, 200), () => 0.1), []);
});

test('input too short to read is refused by name, never read as no stops', () => {
  assert.throws(() => RP.stops([], () => 1), (e) => e.code === 'TOO_SHORT');
  assert.throws(() => RP.stops(fromFn((s) => s, 3), () => 1), (e) => e.code === 'TOO_SHORT');
  assert.throws(() => RP.rateOn(fromFn((s) => s, 3), 4), (e) => e.code === 'TOO_SHORT');
  assert.throws(() => RP.turnOf(straight(), 100, 104), (e) => e.code === 'TOO_SHORT');
});

test('the built bank is the adapter\'s: a held bank of 20° reads 20° on the built road', () => {
  const d = extend(straight(), { length: 300, targets: { phi: 20 * DEG }, transition: { phi: 100 }, bankShape: 'rounded' });
  const b = RP.builtBank(d).filter((x) => x.s >= 450 && x.s <= 590);
  assert.ok(b.length > 100);
  for (const x of b) assert.ok(Math.abs(x.v - 20) < 1e-4, `${x.v} at ${x.s}`);
});
