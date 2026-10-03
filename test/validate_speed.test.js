// Tests for the speed model (src/validate/index.js speedProfile, src/validate/limits.js accelAt): the design speed from
// the picker, the measured acceleration (FINDINGS.md §3d), and when a load may be claimed at all. D169.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const X = require('./validate_paths.js');
const { validate, revalidate } = require('../src/validate/index.js');
const { G, MACH6, accelAt, kmh } = require('../src/validate/limits.js');

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
const R = 20;
/** The design speed that puts the load at the bottom of a vertical loop of radius R at exactly `g` (1 + v²/(gR)). */
const vFor = (g) => Math.sqrt((g - 1) * G * R);
/** The load at the bottom of the loop (station 0, the centre line) with a design speed from the picker. */
function bottom(designSpeed) {
  const r = validate(X.pathOf(X.loop(R)), [X.seg()], { designSpeed });   // an OPEN path, a word with NO speed of its own
  return { r, l: r.lines.find((x) => x.s === 0 && x.u === 0) };
}
const hasAmber = (r) => r.amber.some((a) => a.reason === 'load-above-proven');
const hasInfo = (r) => r.info.some((a) => a.reason === 'on-the-stops');

// ── the design speed turns loads on ──
test('with a design speed from the picker, a word with no speed of its own gets loads: 1 + v²/(gR) at the loop\'s bottom', () => {
  const { r, l } = bottom(30);
  assert.strictEqual(r.speedFrom, 'design');
  close(l.fN_g, 1 + 30 * 30 / (G * R), 1e-9);
});

test('boundary, the suspension stop (FINDINGS.md:103-104): just under 20 g is not flagged, just over is information', () => {
  assert.strictEqual(MACH6.suspensionStopG, 20);
  const under = bottom(vFor(20 - 1e-6)), over = bottom(vFor(20 + 1e-6));
  assert.ok(under.l.fN_g < 20 && over.l.fN_g > 20, `${under.l.fN_g} ${over.l.fN_g}`);
  const atBottom = (r) => r.info.some((a) => a.reason === 'on-the-stops' && a.s0 === 0);
  assert.deepStrictEqual([atBottom(under.r), atBottom(over.r)], [false, true]);
});

test('boundary, the proven load (FINDINGS.md:105): just under 90 g is not amber, just over 90 g is amber', () => {
  assert.strictEqual(MACH6.provenG, 90);
  const under = bottom(vFor(90 - 1e-6)), over = bottom(vFor(90 + 1e-6));
  assert.ok(under.l.fN_g < 90 && over.l.fN_g > 90, `${under.l.fN_g} ${over.l.fN_g}`);
  assert.deepStrictEqual([hasAmber(under.r), hasAmber(over.r)], [false, true]);
});

test('a load is never red, however high: the 60 g red was withdrawn (FINDINGS.md:116-118)', () => {
  const { r, l } = bottom(vFor(500));
  assert.ok(l.fN_g > 499 && hasAmber(r));
  assert.ok(!r.red.some((x) => /load/.test(x.reason)), JSON.stringify(r.red));
});

test('a word\'s own speed wins over the picker\'s; the picker fills only the words without one', () => {
  const segs = [X.seg({ speed: 40 })];
  assert.strictEqual(validate(X.pathOf(X.loop(R)), segs, { designSpeed: 10 }).speed[0].v, 40);
  const mixed = validate(X.pathOf([...X.straight(10), ...X.straight(10, { seg: 1, s0: 10, start: [0, 0, 10] }).slice(1)]), [X.seg({ speed: 40 }), X.seg({ id: 'b' })], { designSpeed: 25 });
  assert.deepStrictEqual([mixed.speedFrom, mixed.speed[0].v, mixed.speed[mixed.speed.length - 1].v], ['design', 40, 25]);
});

// ── no speed, no load ──
test('without a speed (no word speed, no picker speed) an OPEN track claims no load, even though the car can accelerate', () => {
  assert.ok(Number.isFinite(accelAt(MACH6, 0)));
  const r = validate(X.pathOf(X.loop(R)), [X.seg()]);
  assert.deepStrictEqual([r.speedFrom, r.lines.length, r.speed.length, hasAmber(r), hasInfo(r)], ['none', 0, 0, false, false]);
  assert.deepStrictEqual(r.lap, { ok: null, reason: 'open' });
});

test('a speed of 0 or less from the picker is no speed', () => {
  for (const s of [0, -5, NaN]) assert.strictEqual(validate(X.pathOf(X.loop(R)), [X.seg()], { designSpeed: s }).speedFrom, 'none');
});

// ── the lap proof, with the measured acceleration ──
test('on a CLOSED track with no speed anywhere, the lap proof now runs, on the ghost lap at the measured acceleration', () => {
  const r = validate(X.pathOf(X.loop(200, { step: 4 }), true), [X.seg()]);
  assert.strictEqual(r.speedFrom, 'lapsim');
  assert.notStrictEqual(r.lap.ok, null);
  assert.ok(Number.isFinite(r.lap.timeS) && r.lap.timeS > 0, JSON.stringify(r.lap));
  assert.ok(r.lines.length > 0);
});

test('the ghost lap speeds up by the measured table (FINDINGS.md:494) and holds the 970 km/h cap (FINDINGS.md §3e)', () => {
  const r = validate(X.pathOf(X.straight(20000, { step: 20 }), true), [X.seg()], {});
  // a closed "loop" of one long straight: after three laps it is at the cap
  close(Math.max(...r.speed.map((x) => x.v)), kmh(970), 1e-9);
  const v0 = validate(X.pathOf(X.straight(2000, { step: 1 })), [X.seg()], { car: { accel: MACH6.accel } });   // asked for, open
  close(v0.speed[10].v, Math.sqrt(2 * 24.71 * 10), 0.05, 'from standing: the table\'s first value holds below 100 km/h');
});

test('the ghost lap reads the table at its CURRENT speed: at racing speed it pushes less than from a standstill', () => {
  const r = validate(X.pathOf(X.straight(20000, { step: 1 })), [X.seg()], { car: { accel: MACH6.accel } });
  const S = r.speed, i = S.findIndex((x) => x.v * 3.6 >= 540);   // 540 km/h: the table gives about 18 m/s², not 24.71
  assert.ok(i > 0);
  const a = (S[i + 1].v ** 2 - S[i].v ** 2) / (2 * (S[i + 1].s - S[i].s));
  close(a, accelAt(MACH6, S[i].v), 0.05, 'v² grows by 2·a(v)·ds');
  assert.ok(a < 20, `${a}`);
});

test('accelAt reads the table: its points exactly, linear between them, the ends held beyond, a number as itself', () => {
  const at = (k) => accelAt(MACH6, kmh(k));
  assert.deepStrictEqual([at(100), at(450), at(750)], [24.71, 20.07, 11.50]);
  close(at(175), (24.71 + 25.52) / 2, 1e-12);
  assert.deepStrictEqual([at(0), at(2000)], [24.71, 11.50]);
  assert.deepStrictEqual([accelAt({ accel: 7 }, 99), Number.isNaN(accelAt({ accel: null }, 1))], [7, true]);
});

test('a ghost lap asked for by the caller (its own car.accel) runs on an open path too, as it did before', () => {
  assert.strictEqual(validate(X.pathOf(X.straight(100)), [X.seg()], { car: { accel: 20 } }).speedFrom, 'lapsim');
});

// ── the picker changes, incrementally ──
test('changing the picker\'s speed re-validates everything, never carrying loads computed at the old speed', () => {
  const p = X.pathOf(X.loop(R)), segs = [X.seg()];
  const a = validate(p, segs, { designSpeed: 30 }), b = revalidate(a, p, segs, p.lengthM, { designSpeed: 60 });
  assert.deepStrictEqual(b, validate(p, segs, { designSpeed: 60 }));
});
