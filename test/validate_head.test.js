// Tests for D170 (pane E, the librarian's item 3, 2026-09-27): an open end must sit on road, and a jump's landing ramp
// must catch both landings. The landing ramp is appended here exactly as the model change proposed to A would emit it
// (exo_memory/handback/p-d170-jumps-graph-E_2026-09-27.md §3), so the rule is tested on the shape the model will give.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/doc/index.js');
const { buildPath } = require('../src/geom/index.js');
const { validate } = require('../src/validate/index.js');
const { landingRamp, flightY } = require('../src/validate/jumps.js');
const { MACH6 } = require('../src/validate/limits.js');

const kmh = (v) => v / 3.6, DESIGN = kmh(MACH6.designSpeedKmh);
const reasons = (r) => r.red.map((x) => x.reason);
/**
 * A's real resolve of [straight, jump], with the landing ramp as this test needs it. A's in-flight model change (D170,
 * src/doc/resolve.js) already emits a `land` part; before it lands, resolve does not, and the proposed ramp is appended
 * instead. So the test holds on either side of that change:
 *   ramp: false   no landing ramp (any `land` part removed): the head is the flight
 *   ramp: true    the ramp sized by landingRamp() below, at the take-off speed, scaled by rampScale
 */
function jumpTrack({ ramp = true, rampScale = 1, speed = null } = {}) {
  let d = D.createDoc('j');
  d = D.appendWord(d, 'straight', { speed }); d = D.appendWord(d, 'jump', { speed });
  const segs = D.resolve(d).segments.filter((g) => !(g.word === 'jump' && g.part === 'land')), gap = segs[segs.length - 1], h = d.words[1].handles;
  let R = null;
  if (ramp) {
    R = landingRamp({ D: h.gap, dh: -h.drop, thetaRad: 0, landRad: h.land, v: speed || DESIGN });
    const take = segs[segs.length - 2];
    segs.push({ ...take, id: gap.id, word: 'jump', part: 'land', kind: 'road', length: R.length * rampScale, k0: 0, k1: 0, kp0: 0, kp1: 0, blend: null, speed });
  }
  return { segs, path: buildPath(segs, { step: 1 }), R, h };
}

test('an open track whose head is the flight of a jump is RED, head-in-the-air, with its ARCHITECTURE source', () => {
  const { segs, path } = jumpTrack({ ramp: false });
  const r = validate(path, segs, { designSpeed: DESIGN });
  assert.deepStrictEqual(reasons(r), ['head-in-the-air']);
  assert.match(r.red[0].source, /ARCHITECTURE\.md:82/);
  assert.strictEqual(r.jumps[0].pending, true);
});

test('with the landing ramp the jump word will carry, the same track is clean: the head sits on road', () => {
  const { segs, path } = jumpTrack();
  const r = validate(path, segs, { designSpeed: DESIGN });
  assert.deepStrictEqual(reasons(r), []);
  assert.strictEqual(segs[segs.length - 1].kind, 'road');
});

test('the ramp\'s size puts BOTH landings in the zone: each touchdown lies on the ramp, as validation (jumps.js) finds it', () => {
  const { segs, path, R, h } = jumpTrack();
  const [jp] = validate(path, segs, { designSpeed: DESIGN }).jumps;
  assert.deepStrictEqual(jp.landings.map((L) => [L.g, L.caught]), [[3.2, true], [6.3, true]]);
  for (const L of jp.landings) assert.ok(L.x >= jp.gap - 1e-9 && L.x <= jp.gap + R.length * 1.001, `${L.g} g lands at ${L.x}, ramp ${jp.gap}–${jp.gap + R.length}`);
  // and landingRamp's own touchdowns sit exactly on the ramp: the flight meets the ramp line
  for (const t of R.touchdowns) {
    const y = flightY(t.x, R.v, 0, t.g), ramp = -h.drop + (t.x - h.gap) * Math.tan(h.land);
    assert.ok(Math.abs(y - ramp) < 1e-9, `${t.g} g: flight ${y} vs ramp ${ramp}`);
  }
  // the lighter fall carries farther, and sets the length
  assert.ok(R.touchdowns[0].x > R.touchdowns[1].x);
});

test('a ramp too short for the clean-flight landing is RED: landing-misses-zone, the heaviest missed fall named', () => {
  const { segs, path } = jumpTrack({ rampScale: 0.4 });
  const r = validate(path, segs, { designSpeed: DESIGN, landingSearchM: 1000 });
  assert.ok(reasons(r).includes('landing-misses-zone'), JSON.stringify(reasons(r)));
  const red = r.red.find((x) => x.reason === 'landing-misses-zone');
  assert.strictEqual(red.worst, 3.2);
  assert.match(red.source, /ARCHITECTURE\.md:75-78/);
});

test('too slow for the override-dive landing (6.3 g needs more speed than it has): red, 6.3 g named', () => {
  const { segs, path, R } = jumpTrack({ speed: kmh(200) });
  const r = validate(path, segs, {});
  assert.strictEqual(R.touchdowns[1].x, null, '6.3 g cannot clear at 200 km/h');
  const red = r.red.find((x) => x.reason === 'landing-misses-zone');
  assert.ok(red, JSON.stringify(reasons(r)));
  assert.strictEqual(red.worst, 6.3);
});

test('with no speed at all nothing about a landing is claimed (no landing red), while the floating head is still red', () => {
  const clean = jumpTrack();
  assert.ok(!reasons(validate(clean.path, clean.segs, {})).includes('landing-misses-zone'));
  const floating = jumpTrack({ ramp: false });
  assert.deepStrictEqual(reasons(validate(floating.path, floating.segs, {})), ['head-in-the-air']);
});

test('a CLOSED loop has no head: a loop that closes through a flight is not head-in-the-air', () => {
  const X = require('./validate_paths.js');
  const all = X.loop(40), half = Math.round(all.length / 2);
  const pts = all.map((p, i) => ({ ...p, seg: i < half ? 0 : 1 }));
  const r = validate(X.pathOf(pts, true), [X.seg({ speed: 60 }), X.seg({ id: 'j', kind: 'gap', word: 'jump', speed: 60 })]);
  assert.ok(!reasons(r).includes('head-in-the-air'), JSON.stringify(reasons(r)));
});

test('landingRamp refuses what it cannot size: no gap, no speed', () => {
  assert.throws(() => landingRamp({ D: 0, dh: 0, thetaRad: 0, landRad: 0, v: 50 }), /gap must be positive/);
  assert.throws(() => landingRamp({ D: 10, dh: 0, thetaRad: 0, landRad: 0, v: 0 }), /take-off speed is needed/);
});

test('validation measures a jump from its LIP: the gap it checks is the jump\'s own gap, at any station step', () => {
  // D170 found validation one station long: it measured from the station BEFORE the lip, so a 12 m gap read 13 m at a
  // 1 m step (and 14 m at 2 m), and a jump sized exactly (A's landing ramp) read as missing its 6.3 g landing.
  for (const step of [1, 2]) {
    let d = D.createDoc('j'); d = D.appendWord(d, 'straight', { speed: kmh(300) }); d = D.appendWord(d, 'jump', { speed: kmh(300) }); d = D.appendWord(d, 'straight', { speed: kmh(300) });
    const segs = D.resolve(d).segments, path = buildPath(segs, { step });
    const [jp] = validate(path, segs, {}).jumps;
    assert.ok(Math.abs(jp.gap - d.words[1].handles.gap) < 1e-6, `step ${step}: gap ${jp.gap}`);
  }
});
