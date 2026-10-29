// validate_chassis.test.js: what the CRAZY TEST replay measured (D515, exo_memory/handback/p-d515-crazytest-O_2026-10-28.md §4, §5; bands.txt, peaks.txt),
// carried by the checker (D517). Three rules, each on the plan's anchors:
//   1  the suspension stop is 25 g (the height plateau from 25 g): a 23 g line is off the stops, a 26 g line is on them, information only
//   2  `load-on-the-chassis`: the predicted load on a line at 40 g or more at the design speed is AMBER, never red (the box reaches the mesh at about 47 g,
//      and the line's load ran 6.2-9.2 g low at the peaks): p13's peak, κn 13.3 /km on an 85° bank at 720 km/h, is amber; κn 6 /km is not; the edge is 40 g
//   3  `wall-swerve`: on a surface tilted over 60°, a climb change asks the car sideways (κg = κ⃗·l, about dθ/ds·sin φ) more than 1 g at the design speed while
//      the load into the road is under 1 g: p11's case (85°, 819 km/h, climb −5.05° → 0° over 100 m) is amber; the climb held is not; on a 30° bank it is not;
//      a turn on the wall that presses the car on (p13) is not
//   4  the words read as a limit known to hold, not a fault, and every rule carries its D515 source
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validate } = require('../src/validate/index.js');
const { MACH6, G } = require('../src/validate/limits.js');
const L = require('../app/validate-ui/labels.js');
const X = require('./validate_paths.js');

const DEG = Math.PI / 180, kmh = (k) => k / 3.6;
const has = (list, reason) => list.some((x) => x.reason === reason);

/** A LEFT turn of horizontal radius R through `angle` rad, banked by `phi` (the left side up: the road faces the turn's centre), heading +Z at the start. */
function bankedTurn(R, angle, phi, { step = 1 } = {}) {
  const out = [], n = Math.round(R * angle / step);
  for (let k = 0; k <= n; k++) {
    const th = angle * k / n, T = [Math.sin(th), 0, Math.cos(th)], Lf = X.cross([0, 1, 0], T);   // Lf: flat left, toward the centre
    const U = [Lf[0] * Math.sin(phi), Math.cos(phi), Lf[2] * Math.sin(phi)], Lv = X.cross(U, T);
    out.push({ s: R * th, seg: 0, pos: [R - R * Math.cos(th), 0, R * Math.sin(th)], T, L: Lv, U, kvec: [Lf[0] / R, 0, Lf[2] / R] });
  }
  return out;
}
/** p13's turn: the road's normal curvature κn (per m) on a bank of phi; κn = sin φ / R for a level banked circle. */
const turnAt = (kn, phi = 85 * DEG) => bankedTurn(Math.sin(phi) / kn, 0.6, phi);

/** A straight wall heading +Z, banked by `phi` (left side up), whose climb runs at a0 (rad) to s 100, changes linearly to a1 by s 200, and holds a1 to s 300. */
function wall(phi, a0, a1, { step = 1 } = {}) {
  const th = (s) => (s <= 100 ? a0 : s >= 200 ? a1 : a0 + (a1 - a0) * (s - 100) / 100), dth = (s) => (s > 100 && s < 200 ? (a1 - a0) / 100 : 0);
  const out = []; let pos = [0, 0, 0];
  for (let k = 0; k * step <= 300 + 1e-9; k++) {
    const s = k * step, a = th(s), T = [0, Math.sin(a), Math.cos(a)], U0 = [0, Math.cos(a), -Math.sin(a)], L0 = X.cross(U0, T);
    const U = [U0[0] * Math.cos(phi) - L0[0] * Math.sin(phi), U0[1] * Math.cos(phi) - L0[1] * Math.sin(phi), U0[2] * Math.cos(phi) - L0[2] * Math.sin(phi)];
    if (k) { const am = th(s - step / 2); pos = [pos[0], pos[1] + Math.sin(am) * step, pos[2] + Math.cos(am) * step]; }
    out.push({ s, seg: 0, pos, T, L: X.cross(U, T), U, kvec: [0, dth(s) * U0[1], dth(s) * U0[2]] });
  }
  return out;
}
const run = (samples, v) => validate(X.pathOf(samples), [X.seg({ speed: v })]);

// the loop's bottom (validate_speed.test.js): the centre line there reads exactly 1 + v²/(gR)
const LOOP_R = 20, loopFor = (g) => Math.sqrt((g - 1) * G * LOOP_R);
const bottom = (v) => { const r = validate(X.pathOf(X.loop(LOOP_R)), [X.seg()], { designSpeed: v }); return { r, l: r.lines.find((x) => x.s === 0 && x.u === 0) }; };
const atBottom = (list, reason) => list.some((a) => a.reason === reason && a.s0 === 0);

test('row 1: the suspension stop is 25 g: a 23 g line is off the stops, a 26 g line is on them, as information', () => {
  assert.strictEqual(MACH6.suspensionStopG, 25);
  const off = bottom(loopFor(23)), on = bottom(loopFor(26));
  assert.ok(Math.abs(off.l.fN_g - 23) < 1e-9 && Math.abs(on.l.fN_g - 26) < 1e-9, `${off.l.fN_g} ${on.l.fN_g}`);
  assert.deepStrictEqual([atBottom(off.r.info, 'on-the-stops'), atBottom(on.r.info, 'on-the-stops')], [false, true]);
  assert.ok(!has(on.r.amber, 'on-the-stops') && !has(on.r.red, 'on-the-stops'), 'information, never amber or red');
});

test('row 2: p13\'s peak (κn 13.3 /km, bank 85°, 720 km/h) is AMBER load-on-the-chassis, never red; κn 6 /km is not', () => {
  const hot = run(turnAt(13.3e-3), kmh(720)), cold = run(turnAt(6e-3), kmh(720));
  const peak = Math.max(...hot.lines.map((l) => l.fN_g));
  assert.ok(peak > 54 && peak < 55, `the line asks about 54 g, as peaks.txt's 54.1: ${peak}`);
  const a = hot.amber.find((x) => x.reason === 'load-on-the-chassis');
  assert.ok(a, JSON.stringify(hot.amber.map((x) => x.reason)));
  assert.ok(Math.abs(a.worst - peak) < 1e-9, `worst is the hardest line's load: ${a.worst}`);
  assert.ok(!hot.red.some((x) => /load|chassis/.test(x.reason)), 'a load is never red');
  assert.ok(!has(hot.amber, 'load-sustained'), '54 g is under the 55 g sustained line, which this lap leaves as it was');
  assert.ok(Math.max(...cold.lines.map((l) => l.fN_g)) < 40);
  assert.ok(!has(cold.amber, 'load-on-the-chassis'));
});

test('row 2b: the chassis edge is 40 g on the line: at 40 g it is amber, just under it is not', () => {
  assert.strictEqual(MACH6.chassisG, 40);
  const under = bottom(loopFor(40 - 1e-6)), over = bottom(loopFor(40 + 1e-6));
  assert.ok(under.l.fN_g < 40 && over.l.fN_g > 40, `${under.l.fN_g} ${over.l.fN_g}`);
  assert.deepStrictEqual([atBottom(under.r.amber, 'load-on-the-chassis'), atBottom(over.r.amber, 'load-on-the-chassis')], [false, true]);
});

test('row 2c: past the proven 90 g the spike line speaks, not the chassis line', () => {
  const r = bottom(loopFor(95)).r;
  assert.ok(atBottom(r.amber, 'load-above-proven'));
  assert.ok(!atBottom(r.amber, 'load-on-the-chassis'));
});

test('row 3: p11\'s climb change on an 85° wall at 819 km/h is AMBER wall-swerve, never red; the climb held is not', () => {
  const v = kmh(819), phi = 85 * DEG;
  const sw = run(wall(phi, -5.05 * DEG, 0), v), held = run(wall(phi, -5.05 * DEG, -5.05 * DEG), v);
  const a = sw.amber.find((x) => x.reason === 'wall-swerve');
  assert.ok(a, JSON.stringify(sw.amber.map((x) => x.reason)));
  const side = v * v * (5.05 * DEG / 100) * Math.sin(phi) / G;   // κg ≈ dθ/ds·sin φ (D515 §5)
  assert.ok(Math.abs(a.worst - side) < 0.05, `worst is the sideways ask, ${side.toFixed(2)} g: ${a.worst}`);
  assert.ok(a.s0 > 99 && a.s1 < 201, `over the climb change only: ${a.s0}..${a.s1}`);
  assert.ok(!sw.red.some((x) => x.reason === 'wall-swerve'));
  assert.ok(!has(held.amber, 'wall-swerve'), 'a held climb asks nothing sideways');
});

// D517 part 2 (the librarian's ruling, e9b793bb): the edge is 3 g, the one measured swerve (3.16 g, which recovered); 1 g fired on a 1.2° change, an amber nobody reads
test('row 3b: the sideways edge is 3 g: a 3.2° climb change (2.94 g sideways) on the wall is not amber, 3.4° (3.12 g) is', () => {
  const v = kmh(819), phi = 85 * DEG;
  assert.deepStrictEqual(MACH6.wallSwerve, { tiltDeg: 60, sideG: 3, holdG: 1 });
  const under = run(wall(phi, -3.2 * DEG, 0), v), over = run(wall(phi, -3.4 * DEG, 0), v);
  assert.ok(!has(under.amber, 'wall-swerve'), 'under 3 g');
  const a = over.amber.find((x) => x.reason === 'wall-swerve');
  assert.ok(a && a.worst > 3 && a.worst < 3.2, `over 3 g: ${a && a.worst}`);
  assert.ok(!has(run(wall(phi, -1.2 * DEG, 0), v).amber, 'wall-swerve'), 'the 1.2° change the 1 g edge flagged is quiet now');
});

test('row 3c: the rule is wall-only: the same climb change on a 30° bank is not amber, and neither is a crest there that unloads the road', () => {
  const v = kmh(819), phi = 30 * DEG;
  assert.ok(!has(run(wall(phi, -5.05 * DEG, 0), v).amber, 'wall-swerve'));
  // D517 part 2: a 10° crest, so it asks over the 3 g edge sideways too (about 4.6 g) and only the bank keeps it out (5.05° asks 2.3 g, under the edge)
  const crest = run(wall(phi, 0, -10 * DEG), v);
  assert.ok(crest.lines.some((l) => l.u === 0 && Math.abs(l.fLat_g) > 3), 'the crest asks over 3 g sideways');
  assert.ok(crest.lines.some((l) => l.u === 0 && l.s > 120 && l.s < 180 && l.fN_g < 1), 'the crest does unload the road: only the bank keeps it out');
  assert.ok(!has(crest.amber, 'wall-swerve'));
});

test('row 3d: a turn on the wall that presses the car into it is not a swerve (p13: 4.7 g sideways, 54 g into the road)', () => {
  const r = run(turnAt(13.3e-3), kmh(720));
  assert.ok(r.lines.some((l) => l.u === 0 && Math.abs(l.fLat_g) > 1), 'the turn does ask the car sideways on its wall');
  assert.ok(!has(r.amber, 'wall-swerve'));
});

test('row 4: the words read as a limit known to hold, not a fault, and each rule names D515', () => {
  const chassis = L.reasonText('load-on-the-chassis'), swerve = L.reasonText('wall-swerve'), stops = L.reasonText('on-the-stops');
  assert.match(chassis, /40 g/); assert.match(chassis, /63 g/); assert.match(chassis, /held/); assert.match(chassis, /continuous/);
  assert.doesNotMatch(chassis, /fault|fails|too much/i);
  assert.match(swerve, /60°/); assert.match(swerve, /as hard as the hardest one driven \(3\.2 g, which recovered\)/); assert.match(swerve, /1 g/); assert.match(swerve, /estimate/);
  assert.match(stops, /25 g/); assert.match(stops, /step or a gap/);
  const hot = run(turnAt(13.3e-3), kmh(720)), sw = run(wall(85 * DEG, -5.05 * DEG, 0), kmh(819));
  assert.match(hot.amber.find((x) => x.reason === 'load-on-the-chassis').source, /D515/);
  assert.match(sw.amber.find((x) => x.reason === 'wall-swerve').source, /D515/);
  assert.match(hot.info.find((x) => x.reason === 'on-the-stops').source, /D515.*FINDINGS\.md:103/);
});
