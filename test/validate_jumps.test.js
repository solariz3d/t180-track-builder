// Tests for src/validate/jumps.js and the jump part of validate(): the projectile with the two measured falls
// (3.2 g and 6.3 g, FINDINGS.md:336-337), the minimum take-off speed, both landings, and the reach bound
// (FINDINGS.md:312-313). node --test, no dependencies.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const J = require('../src/validate/jumps.js');
const { reachDrop, G } = require('../src/validate/limits.js');
const { validate } = require('../src/validate/index.js');
const X = require('./validate_paths.js');

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
const deg = (d) => d * Math.PI / 180;

test('minSpeed matches the closed form, worked by hand for a 40 m gap, 7° up, landing 1 m up, at 3.2 g', () => {
  // v² = g·D² / (2·cos²θ·(D·tanθ − Δh)) = 3.2·9.81·1600 / (2·cos²7°·(40·tan7° − 1))
  const th = deg(7), expect = Math.sqrt(3.2 * 9.81 * 1600 / (2 * Math.cos(th) ** 2 * (40 * Math.tan(th) - 1)));
  close(J.minSpeed(40, 1, th, 3.2), expect, 1e-9);
});

test('the harder fall needs the higher speed: minSpeed at 6.3 g = minSpeed at 3.2 g × √(6.3/3.2)', () => {
  const th = deg(8);
  close(J.minSpeed(60, 0, th, 6.3), J.minSpeed(60, 0, th, 3.2) * Math.sqrt(6.3 / 3.2), 1e-9);
});

test('no speed makes a jump whose lip points at or below the landing (D·tanθ ≤ Δh): Infinity', () => {
  assert.strictEqual(J.minSpeed(40, 40 * Math.tan(deg(5)), deg(5), 3.2), Infinity, 'exactly at the boundary');
  assert.strictEqual(J.minSpeed(40, 5, deg(5), 3.2), Infinity);
  assert.ok(Number.isFinite(J.minSpeed(40, 40 * Math.tan(deg(5)) - 0.01, deg(5), 3.2)), 'just inside it');
});

test('minSpeed refuses a gap that is not positive', () => {
  assert.throws(() => J.minSpeed(0, 0, 0.1, 3.2), /gap must be positive/);
});

test('flightY: the height at the minimum speed is exactly Δh at D (the flight just reaches the lip)', () => {
  const D = 50, dh = -2, th = deg(6), v = J.minSpeed(D, dh, th, 6.3);
  close(J.flightY(D, v, th, 6.3), dh, 1e-9);
});

function ramp(D, dh, len = 80, slopeDeg = -3) {   // the landing road: from the lip at (D, dh), falling at slopeDeg
  const out = []; for (let x = 0; x <= len; x += 1) out.push({ x: D + x, y: dh + x * Math.tan(deg(slopeDeg)) });
  return out;
}

test('TWO landings, never one: between the two minimum speeds the clean flight lands and the dive falls short', () => {
  const D = 60, dh = 0, th = deg(7);
  const v32 = J.minSpeed(D, dh, th, 3.2), v63 = J.minSpeed(D, dh, th, 6.3), v = (v32 + v63) / 2;
  const r = J.checkJump({ D, dh, thetaRad: th, v, landingRoad: ramp(D, dh) });
  assert.strictEqual(r.landings.length, 2);
  assert.deepStrictEqual(r.landings.map((l) => [l.g, l.clear, l.caught]), [[3.2, true, true], [6.3, false, false]]);
  close(r.minSpeed, v63, 1e-9, 'the harder landing binds');
});

test('boundary at each landing: just below its minimum speed it is not clear, just above it is', () => {
  const D = 60, dh = 0, th = deg(7);
  for (const g of [3.2, 6.3]) {
    const vm = J.minSpeed(D, dh, th, g);
    const below = J.checkJump({ D, dh, thetaRad: th, v: vm * (1 - 1e-6), landingRoad: ramp(D, dh), jumpG: [g] }).landings[0];
    const above = J.checkJump({ D, dh, thetaRad: th, v: vm * (1 + 1e-6), landingRoad: ramp(D, dh), jumpG: [g] }).landings[0];
    assert.deepStrictEqual([below.clear, above.clear, above.caught], [false, true, true], `${g} g`);
  }
});

test('a landing road too short to catch the long flight: clear, but NOT caught', () => {
  const D = 40, dh = 0, th = deg(10), v = 3 * J.minSpeed(D, dh, th, 3.2);
  const r = J.checkJump({ D, dh, thetaRad: th, v, landingRoad: ramp(D, dh, 5) });
  assert.deepStrictEqual(r.landings.map((l) => [l.clear, l.caught]), [[true, false], [true, false]]);
});

test('the touchdown x is where the flight meets the landing road, interpolated', () => {
  const D = 40, dh = 0, th = deg(7), v = 1.3 * J.minSpeed(D, dh, th, 3.2);
  const L = J.checkJump({ D, dh, thetaRad: th, v, landingRoad: ramp(D, dh, 200, 0), jumpG: [3.2] }).landings[0];
  // on a flat landing at the take-off height, the flight comes down where y = 0: x = 2·v²·sinθ·cosθ / g_eff
  // the touchdown is linearly interpolated between road points 1 m apart, so it is exact to the parabola's sag over 1 m
  close(L.x, 2 * v * v * Math.sin(th) * Math.cos(th) / (3.2 * G), 0.01);
});

test('reach: a drop deeper than dist·tan10° + ½·6.5 g·(dist / 375 km/h)² is unreachable (FINDINGS.md:312-313)', () => {
  // the formula as FINDINGS.md:313 states it and tools/read_track.cjs:151 implements it, worked by hand:
  // 65·tan10° + ½·6.5·9.81·(65/104.1667)² = 11.461 + 12.414 = 23.876 m;  226 m: 39.850 + 150.076 = 189.926 m.
  // FINDINGS.md:313's prose says 'about 21 m' and 'about 100 m'; those do not re-derive from the formula (hand-back).
  close(reachDrop(65), 23.876, 0.001, '65 m'); close(reachDrop(226), 189.926, 0.001, '226 m');
  const D = 65, th = deg(2), b = reachDrop(D);
  assert.strictEqual(J.checkJump({ D, dh: -(b - 0.01), thetaRad: th, v: 200, landingRoad: ramp(D, -(b - 0.01)) }).reachable, true);
  assert.strictEqual(J.checkJump({ D, dh: -(b + 0.01), thetaRad: th, v: 200, landingRoad: ramp(D, -(b + 0.01)) }).reachable, false);
});

// ── inside validate(): a jump word on a whole path ──
function jumpPath(takeoffV, { gapLen = 40, drop = 0 } = {}) {
  const run = X.straight(100, { seg: 0 });
  const gap = X.straight(gapLen, { seg: 1, start: [0, 0, 100], s0: 100 }).slice(1, -1);
  const land = X.straight(120, { seg: 2, start: [0, -drop, 100 + gapLen], s0: 100 + gapLen });
  const segs = [X.seg({ id: 'run', speed: takeoffV }), X.seg({ id: 'j', kind: 'gap', word: 'jump', speed: takeoffV }), X.seg({ id: 'land', speed: takeoffV })];
  return { path: X.pathOf([...run, ...gap, ...land]), segs };
}

test('validate: a flat 40 m jump reports both landings, the gap and the climb, from the path itself', () => {
  // 200 m/s off a flat lip over 40 m falling 3 m: the 6.3 g dive needs 40/√(2·3/(6.3·9.81)) ≈ 129 m/s, so both land
  const { path, segs } = jumpPath(200, { drop: 3 });
  const j = validate(path, segs).jumps[0];
  close(j.gap, 40, 1e-9); close(j.climb, -3, 1e-9); close(j.rampDeg, 0, 1e-9);
  assert.deepStrictEqual(j.landings.map((l) => l.g), [3.2, 6.3]);
  assert.ok(j.landings.every((l) => l.caught), JSON.stringify(j.landings));
  assert.strictEqual(j.reachable, true);
});

// CHANGED D250 (the keeper: jumps are tuned by driving them): a jump the car is not caught on WARNS in the lap proof (lap.warn) and no longer fails the
// lap (lap.where). The row's subject, the uncaught jump named with its fall, stands.
test('validate: a jump taken too slowly is not caught, and a closed lap over it WARNS with the reason (D250), without failing on it', () => {
  const { path, segs } = jumpPath(20, { drop: 1 });   // 20 m/s over 40 m falling 1 m: short at either fall
  const r = validate({ ...path, closed: true }, segs);
  assert.ok(r.jumps[0].landings.every((l) => !l.clear));
  assert.ok(r.lap.warn.some((w) => w.reason === 'jump-not-caught-6.3g'), JSON.stringify(r.lap));
  assert.ok(!r.lap.where.some((w) => /^jump-not-caught/.test(w.reason)), 'not a reason the lap fails');
});

// CHANGED 2026-09-27 (D170): "not a failure" was the rule until the librarian's item 3 ("an open end must sit on
// road"). The jump itself is still pending, not failed; the HEAD, in the air, is now red.
test('validate: an open head that ends in the air is a pending jump, and the head in the air is red', () => {
  const run = X.straight(50, { seg: 0 }), gap = X.straight(20, { seg: 1, start: [0, 0, 50], s0: 50 }).slice(1);
  const r = validate(X.pathOf([...run, ...gap]), [X.seg({ speed: 100 }), X.seg({ id: 'j', kind: 'gap', word: 'jump', speed: 100 })]);
  assert.strictEqual(r.jumps[0].pending, true);
  assert.deepStrictEqual(r.red.map((x) => x.reason), ['head-in-the-air']);
});

// ── D179 addendum: validation REPORTS a jump with no forward gap, it never throws (A's soak finding, captured-17) ──
/** A jump whose landing road starts `gapM` m along the take-off direction from the lip: 0 = straight below, < 0 = behind. */
function backwardJump(gapM, closed = false) {
  const run = X.straight(100, { seg: 0 });
  const flight = X.straight(20, { seg: 1, start: [0, 0, 100], s0: 100 }).slice(1, -1);   // the flight's own stations
  const land = X.straight(120, { seg: 2, start: [0, -1, 100 + gapM], s0: 120 });
  const segs = [X.seg({ id: 'run', speed: 120 }), X.seg({ id: 'j', kind: 'gap', word: 'jump', speed: 120 }), X.seg({ id: 'land', speed: 120 })];
  return { path: X.pathOf([...run, ...flight, ...land], closed), segs };
}
for (const [what, gapM] of [['a gap of 0 (landing lip straight below the take-off lip)', 0], ['a NEGATIVE gap (landing lip 5 m behind the take-off lip)', -5]]) {
  test(`validate: ${what} is a named RED with its reason and source, and nothing throws`, () => {
    const { path, segs } = backwardJump(gapM);
    let r;
    assert.doesNotThrow(() => { r = validate(path, segs); });
    const bad = r.red.filter((x) => x.reason === 'jump-gap-not-forward');
    assert.strictEqual(bad.length, 1, JSON.stringify(r.red));
    assert.match(bad[0].source, /ARCHITECTURE\.md:72/);
    close(bad[0].worst, -gapM, 1e-9, 'worst is how far the landing lip is behind the take-off lip');
    assert.deepStrictEqual([r.jumps[0].badGap, r.jumps[0].landings], [true, []]);
  });
}
test('validate: a closed lap over a jump with no forward gap FAILS with that reason, and is not thrown either', () => {
  const { path, segs } = backwardJump(-5, true);
  const r = validate(path, segs);
  assert.strictEqual(r.lap.ok, false);
  assert.ok(r.lap.where.some((w) => w.reason === 'jump-gap-not-forward'), JSON.stringify(r.lap.where));
});

// ── the landing search covers the jump's own landing ramp (the ripple, p-d182-ripple-E) ──
// The measured jump (81 m gap, 14 m drop: A's D182 vocabulary) at 755 km/h: the 3.2 g flight comes down about 152 m past
// the landing lip, and resolve sizes the jump's landing ramp (about 162 m) to catch it. Validation searched only 150 m of
// landing road, so a touchdown ON the ramp read as a miss. Named inputs, so it holds under either vocabulary.
test('validate: a landing on the jump\'s own ramp more than 150 m past the lip is found (the search covers the ramp)', () => {
  const D = require('../src/doc/index.js'), G = require('../src/geom/index.js');
  let d = D.createDoc('t');
  for (const w of ['straight', 'straight']) d = D.appendWord(d, w, { font: 'flat', handles: { length: 100, roll1: 0 } });
  d = D.appendWord(d, 'jump', { handles: { gap: 81, drop: 14, land: -2 * Math.PI / 180 } });
  const segs = D.resolve(d, { designSpeedKmh: 755 }).segments, ramp = segs.find((g) => g.part === 'land');
  const v = validate(G.buildPath(segs, { step: 2 }), segs, { designSpeed: 755 / 3.6 }), j = v.jumps[0];
  const L32 = j.landings.find((L) => L.g === 3.2);
  assert.ok(ramp.length > 150, `the ramp is ${ramp.length} m`);
  assert.ok(L32.caught && L32.x - j.gap > 150, JSON.stringify(j.landings));
  assert.deepStrictEqual(v.red.map((r) => r.reason), []);
});
