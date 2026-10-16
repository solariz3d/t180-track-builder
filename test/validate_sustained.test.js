// validate_sustained.test.js: the duration-aware amber (D341, plan :876-884). `load-sustained`: a load above MACH6.sustainedG held for more than
// MACH6.sustainedS seconds. The 90 g spike line (`load-above-proven`) rests on episodes under 0.25 s (FINDINGS.md:105, the track B's 12-15 frames);
// the 2026-10-16 ELYSIUM replay is the first measurement of a SUSTAINED load: seven passes held 56-62 g for about 2 s with 4-8 cm of box clearance and
// the eighth, at 62 g, went through the road. Rows:
//   1  a load past the line held longer than the time is AMBER (never red) with its source, on the line that carries it, over the stretch that holds it
//   2  the load edge: just over 55 g held is amber, just under is not
//   3  the time edge: held 0.55 s is amber, held 0.45 s is not
//   4  the spike line is untouched: 95 g held is BOTH `load-above-proven` and `load-sustained`; 70 g for a short stretch is neither (the withdrawn 60 g red line stays withdrawn)
//   5  the limits carry both numbers, each beside its source
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validate } = require('../src/validate/index.js');
const { MACH6, G } = require('../src/validate/limits.js');
const X = require('./validate_paths.js');
const PR = require('../src/geom/profile.js');

// the same wall-on-the-outside turn validate.test.js uses: the wall's top line (u = -6) carries v squared over (R plus its offset) times g into its surface exactly
const R = 40, prof = { font: 'wall', u: [-6, -1, 0, 5], psi: [Math.PI / 2, 0, 0, 0], material: 'ROAD' };
const k = 1 / (R + Math.abs(PR.offsetAt(PR.normalize(prof), -6)[0]));
const vFor = (g) => Math.sqrt(g * G / k);
/** A left turn held at `g` on the wall line for `seconds` (arc = v t; the centre line's arc is R times the angle). */
const held = (g, seconds) => { const v = vFor(g); return validate(X.pathOf(X.leftTurn(R, (v * seconds) / R)), [X.seg({ speed: v, profile: prof })]); };
const sustained = (r) => r.amber.filter((a) => a.reason === 'load-sustained');

test('row 1: a load past the line held longer than the time is AMBER, never red, with its source, on the line that carries it', () => {
  const r = held(70, 1.2), a = sustained(r);
  assert.strictEqual(a.length, 1, JSON.stringify(r.amber.map((x) => x.reason)));
  assert.match(a[0].source, /D341|FINDINGS/);
  assert.strictEqual(a[0].u, -6, 'the wall line carries it');
  assert.ok(Math.abs(a[0].worst - 70) < 0.5, `worst ${a[0].worst}`);
  assert.deepStrictEqual(r.red.map((x) => x.reason), [], 'advisory: never red');
  // it spans the stretch that holds the load, not a spot: most of the turn's 1.2 s at about 160 m/s
  assert.ok(a[0].s1 - a[0].s0 > 100, `range ${a[0].s0}..${a[0].s1}`);   // 1.2 s at about 160 m/s is about 190 m of road
});

test('row 2: the load edge: just over the sustained line, held, is amber; just under is not', () => {
  assert.strictEqual(sustained(held(MACH6.sustainedG + 0.5, 1.2)).length, 1, 'over');
  assert.strictEqual(sustained(held(MACH6.sustainedG - 0.5, 1.2)).length, 0, 'under');
});

test('row 3: the time edge: held 0.55 s is amber, held 0.45 s is not', () => {
  assert.strictEqual(MACH6.sustainedS, 0.5);
  assert.strictEqual(sustained(held(70, 0.55 + 0.1)).length, 1, 'long enough (the turn\'s own ends take a little off the held part)');
  assert.strictEqual(sustained(held(70, 0.45)).length, 0, 'too short');
});

test('row 4: the spike line is untouched: 95 g held is both ambers; 70 g held only a moment is neither', () => {
  const hot = held(95, 1.2); assert.ok(hot.amber.some((a) => a.reason === 'load-above-proven'), 'the spike line still fires'); assert.strictEqual(sustained(hot).length, 1);
  const brief = held(70, 0.2); assert.ok(!brief.amber.some((a) => a.reason === 'load-above-proven' || a.reason === 'load-sustained'));
  assert.deepStrictEqual(brief.red.map((x) => x.reason), [], 'the withdrawn 60 g red line stays withdrawn');
});

test('row 3b: a run is ONE stretch: two loaded stretches under the time with a quiet station between them are not one that is long enough', () => {
  const { sustainedLoad } = require('../src/validate/index.js')._internal;
  const S = Array.from({ length: 40 }, (_, i) => ({ s: i * 10 })), v = S.map(() => 100);   // 10 m a station at 100 m/s: 0.1 s a step
  const line = (g) => ({ s: 0, u: 0, fN_g: g }), raw = (gs) => gs.map((g, i) => ({ i, line: line(g) }));
  const hot = 70, quiet = 10, isRoad = () => true, car = MACH6;
  const two = [...Array(4).fill(hot), quiet, ...Array(4).fill(hot), ...Array(30).fill(quiet)];   // 0.3 s, a gap, 0.3 s
  assert.deepStrictEqual(sustainedLoad(raw(two), S, v, isRoad, car, 40), [], 'two 0.3 s stretches are not a 0.7 s one');
  const one = [...Array(8).fill(hot), ...Array(32).fill(quiet)];   // 0.7 s
  assert.strictEqual(sustainedLoad(raw(one), S, v, isRoad, car, 40).length, 8, 'one 0.7 s stretch: every station of it');
  const brokenByRoad = [...Array(8).fill(hot), ...Array(32).fill(quiet)];
  assert.deepStrictEqual(sustainedLoad(raw(brokenByRoad), S, v, (i) => i !== 4, car, 40), [], 'a station that is not road ends a run');
});

test('row 3c: on a closed lap a held load across the seam is one run', () => {
  const { sustainedLoad } = require('../src/validate/index.js')._internal;
  const S = Array.from({ length: 40 }, (_, i) => ({ s: i * 10 })), v = S.map(() => 100);
  const raw = (gs) => gs.map((g, i) => ({ i, line: { s: i * 10, u: 0, fN_g: g } }));
  const wrapped = [...Array(4).fill(70), ...Array(32).fill(10), ...Array(4).fill(70)];   // 0.3 s at the start, 0.3 s at the end
  assert.deepStrictEqual(sustainedLoad(raw(wrapped), S, v, () => true, MACH6, 40), [], 'open: two short runs');
  assert.strictEqual(sustainedLoad(raw(wrapped), S, v, () => true, MACH6, 40, 400).length, 8, 'closed, a 400 m lap: one 0.7 s run');
});

test('row 5: the limits carry both numbers: 55 g for more than 0.5 s, from the ELYSIUM replay of 2026-10-16', () => {
  assert.strictEqual(MACH6.sustainedG, 55); assert.strictEqual(MACH6.sustainedS, 0.5);
});
