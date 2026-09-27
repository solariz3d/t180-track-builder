// doc-jump.test.js: node --test test/*.test.js
// A jump carries its LANDING RAMP (the D170 design review, item 3: "After a jump the head floats over nothing … A
// jump word should carry its landing ramp, so the head sits on road and the next piece starts on the landing").
// resolve() emits the flight (kind 'gap') and then a road segment (part 'land') straight at the landing pitch, long
// enough that the flight comes down on it at BOTH measured falls, 3.2 g and 6.3 g (FINDINGS.md:336-337), as
// src/validate/jumps.js checkJump finds them, plus a run-out.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const G = require('../src/geom/index.js');
const V = require('../src/validate/index.js');
const { flightY } = require('../src/validate/jumps.js');

const DEG = Math.PI / 180, kmh = (v) => v / 3.6;
/** A run-up climbing 4°, the jump (12 m gap, 0.7 m down, landing at −2°), and a straight after it. */
function jumpDoc(speedKmh = 300) {
  let d = D.createDoc('j');
  d = D.appendWord(d, 'straight', { handles: { length: 80 }, speed: kmh(speedKmh) });
  d = D.appendWord(d, 'straight', { handles: { length: 40, climb: 4 * DEG }, speed: kmh(speedKmh) });
  d = D.appendWord(d, 'jump', { speed: kmh(speedKmh) });
  return D.appendWord(d, 'straight', { handles: { length: 60 }, speed: kmh(speedKmh) });
}
const jumpSegs = (d) => D.resolve(d).segments.filter((g) => g.word === 'jump');

test('a jump resolves to its flight and then its landing ramp, both under the jump word\'s id', () => {
  const s = jumpSegs(jumpDoc());
  assert.deepEqual(s.map((g) => [g.part, g.kind]), [['gap', 'gap'], ['land', 'road']]);
  assert.equal(s[0].id, s[1].id);
});

test('the ramp is straight at the landing pitch, and carries the take-off road\'s cross-section', () => {
  const d = jumpDoc(), segs = D.resolve(d).segments, ramp = segs.find((g) => g.part === 'land');
  assert.deepEqual([ramp.k0, ramp.k1, ramp.kp0, ramp.kp1], [0, 0, 0, 0]);
  const before = segs[segs.findIndex((g) => g.kind === 'gap') - 1];
  assert.deepEqual(ramp.profile, before.profile);
});

test('the head after a jump sits on road: a jump placed last ends on its ramp, not over the gap', () => {
  let d = D.createDoc('h');
  d = D.appendWord(d, 'straight', { handles: { climb: 4 * DEG } });
  d = D.appendWord(d, 'jump');
  const r = D.resolve(d), last = r.segments[r.segments.length - 1];
  assert.equal(last.kind, 'road');
  assert.equal(last.part, 'land');
  const p = G.buildPath(r.segments, { step: 1 });
  assert.equal(r.segments[p.samples[p.samples.length - 1].seg].kind, 'road', 'the path\'s last station is on road');
});

test('the ramp reaches past the 3.2 g touchdown with a run-out, computed here from the projectile itself', () => {
  const ramp = jumpSegs(jumpDoc())[1], L = ramp.landing;
  const th = 4 * DEG, v = kmh(300), lam = -2 * DEG, gap = 12, drop = 0.7;
  // where the 3.2 g flight meets the ramp line y = −drop + (x − gap)·tan λ, found by bisection on the difference
  const f = (x) => flightY(x, v, th, 3.2) - (-drop + (x - gap) * Math.tan(lam));
  let lo = gap, hi = gap + 2000; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  const along = (lo - gap) / Math.cos(lam);
  // the ramp is validation's (src/validate/jumps.js landingRamp): the far touchdown plus its margin (10 m, horizontal)
  assert.ok(Math.abs(L.marginM - 10) < 1e-9, `margin ${L.marginM}`);
  assert.ok(ramp.length >= along + L.marginM - 1e-9, `ramp ${ramp.length} m, the 3.2 g touchdown is ${along} m along it`);
  assert.equal(L.sizedBy, '3.2g');
  assert.ok(Math.abs(L.touchdownsM[0] - along) < 1e-6, `recorded ${L.touchdownsM[0]} vs ${along}`);
});

test('E\'s own jump check, on the built geometry, finds the car caught on the ramp at both 3.2 g and 6.3 g', () => {
  // The jump is the LAST word, so no later road can catch the car: only its own ramp does.
  const d = D.removeHead(jumpDoc()), segs = D.resolve(d).segments, path = G.buildPath(segs, { step: 0.5 });
  const res = V.validate(path, segs, {});
  assert.equal(res.jumps.length, 1);
  assert.deepEqual(res.jumps[0].landings.map((l) => [l.g, l.caught]), [[3.2, true], [6.3, true]], JSON.stringify(res.jumps[0].landings));
});

test('the ramp follows the speed: a faster jump flies farther and gets a longer ramp', () => {
  assert.ok(jumpSegs(jumpDoc(350))[1].length > jumpSegs(jumpDoc(250))[1].length);
});

test('with no speed on the jump the ramp is sized for the stated default, 300 km/h, and says so', () => {
  let d = D.createDoc('n');
  d = D.appendWord(d, 'straight', { handles: { climb: 4 * DEG } }); d = D.appendWord(d, 'jump');
  const L = jumpSegs(d)[1].landing;
  assert.equal(L.speedFrom, 'default');
  assert.ok(Math.abs(L.speed - kmh(300)) < 1e-9);
});

test('a jump no fall clears at its speed still gets a ramp, the margin alone, and says why it was not sized', () => {
  // 30 km/h off a flat lip cannot clear a 12 m gap at either fall
  let d = D.createDoc('slow');
  d = D.appendWord(d, 'straight', { speed: kmh(30) }); d = D.appendWord(d, 'jump', { speed: kmh(30) });
  const ramp = jumpSegs(d)[1];
  assert.equal(ramp.landing.sizedBy, null);
  assert.match(ramp.landing.why, /neither/);
  assert.ok(Math.abs(ramp.length - 10 / Math.cos(2 * DEG)) < 1e-9, `${ramp.length}`);   // jumps.js's 10 m margin, along the −2° ramp
});

test('the next word starts on the landing, level with it, and continuous in curvature', () => {
  const segs = D.resolve(jumpDoc()).segments, i = segs.findIndex((g) => g.part === 'land'), next = segs[i + 1];
  assert.equal(next.id, 'w4');
  assert.deepEqual([next.k0, next.kp0], [0, 0]);
  assert.equal(next.roll0, segs[i].roll1);
});

test('fonts never jump across a landing: a flat road after a half-pipe take-off blends from the ramp\'s half-pipe', () => {
  let d = D.createDoc('f');
  d = D.appendWord(d, 'straight', { font: 'half-pipe', handles: { climb: 4 * DEG } });
  d = D.appendWord(d, 'jump');
  d = D.appendWord(d, 'straight');   // flat
  const segs = D.resolve(d).segments, ramp = segs.find((g) => g.part === 'land'), after = segs.filter((g) => g.id === 'w3');
  assert.equal(ramp.profile.font, 'half-pipe', 'the ramp continues the take-off road');
  assert.ok(after[0].blend && after[0].blend.from.font === 'half-pipe', 'the road after the ramp must ramp from it, or the surface steps');
});

test('undo of a jump removes its ramp with it', () => {
  let h = D.createHistory(D.appendWord(D.createDoc('u'), 'straight', { handles: { climb: 4 * DEG } }));
  const before = D.resolve(h.present).segments.length;
  h = D.commit(h, D.appendWord(h.present, 'jump'));
  assert.ok(D.resolve(h.present).segments.some((g) => g.part === 'land'));
  h = D.undo(h);
  const after = D.resolve(h.present).segments;
  assert.equal(after.length, before);
  assert.ok(!after.some((g) => g.part === 'land' || g.kind === 'gap'));
});

test('a document with jumps round-trips byte-exact and resolves to the same ramp', () => {
  const d = jumpDoc(), t = D.serialize(d);
  assert.equal(D.serialize(D.parse(t)), t);
  assert.deepEqual(D.resolve(D.parse(t)), D.resolve(d));
});
