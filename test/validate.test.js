// Tests for src/validate/index.js (ARCHITECTURE.md §4): loads per lateral line, the red and amber lists, and the lap.
// Every red rule fires on a crafted bad path and stays quiet on a good one, with a case at each limit.
// Paths are hand-made (test/validate_paths.js) in C's buildPath shape, so these do not depend on the geometry core.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validate } = require('../src/validate/index.js');
const { MACH6, G } = require('../src/validate/limits.js');
const X = require('./validate_paths.js');
const PR = require('../src/geom/profile.js');

const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
const reasons = (list) => list.map((r) => r.reason);
const line = (r, s, u) => r.lines.find((l) => Math.abs(l.s - s) < 1e-9 && l.u === u);

// ── the load ──
test('calibration: a car at rest-like speed on a flat straight reads fN = 1 g and nothing else (FINDINGS.md:31-32)', () => {
  const r = validate(X.pathOf(X.straight(20)), [X.seg({ speed: 1e-6 })]);
  for (const l of r.lines) { close(l.fN_g, 1, 1e-12); close(l.fLat_g, 0, 1e-12); close(l.fAlong_g, 0, 1e-12); }
  assert.strictEqual(r.speedFrom, 'design');
});

test('a flat left turn: the floor centre reads 1 g into the road and v²/(R·g) across, toward the inside', () => {
  const R = 50, v = 70;
  const r = validate(X.pathOf(X.leftTurn(R, Math.PI / 2)), [X.seg({ speed: v })]);
  const l = line(r, r.lines[10].s, 0);
  close(l.fN_g, 1, 1e-9); close(l.fLat_g, v * v / R / G, 1e-9);
});

test('each lateral line has its own radius: the inside edge of a turn loads harder than the centre, v²κ/(1−κ·o)', () => {
  const R = 50, v = 70, r = validate(X.pathOf(X.leftTurn(R, Math.PI / 2)), [X.seg({ speed: v })]);
  const s = r.lines[10].s, inside = line(r, s, 5), outside = line(r, s, -5);   // u + = left = the inside of a left turn
  close(inside.fLat_g, v * v / (R - 5) / G, 1e-9, 'inside');
  close(outside.fLat_g, v * v / (R + 5) / G, 1e-9, 'outside');
});

test('a wall past vertical on the outside of a turn takes the turn\'s load INTO its surface', () => {
  const R = 50, v = 90;
  const prof = { font: 'wall', u: [-8, -2, 0, 2], psi: [Math.PI / 2, 0, 0, 0], material: 'ROAD' };   // right wall rising to 90°
  const r = validate(X.pathOf(X.leftTurn(R, Math.PI / 2)), [X.seg({ speed: v, profile: prof })]);
  const w = line(r, r.lines[20].s, -8);
  assert.ok(w.fN_g > 10, `a 90 m/s turn at R≈${R} presses the outside wall at ${w.fN_g.toFixed(1)} g`);
});

test('a vertical loop: at the top the load is v²/R − g, so below √(gR) the car leaves the surface', () => {
  const R = 20, v = 30, r = validate(X.pathOf(X.loop(R), true), [X.seg({ speed: v })]);
  const top = r.lines.filter((l) => l.u === 0).reduce((a, b) => (Math.abs(b.s - Math.PI * R) < Math.abs(a.s - Math.PI * R) ? b : a));
  close(top.fN_g, (v * v / R - G) / G, 1e-6);
  const slow = validate(X.pathOf(X.loop(R), true), [X.seg({ speed: Math.sqrt(G * R) * 0.9 })]);
  assert.strictEqual(slow.lap.ok, false);
  assert.ok(slow.lap.where.some((w) => w.reason === 'leaves-surface'));
  const fast = validate(X.pathOf(X.loop(R), true), [X.seg({ speed: Math.sqrt(G * R) * 1.1 })]);
  assert.strictEqual(fast.lap.ok, true, JSON.stringify(fast.lap.where.slice(0, 3)));
});

// ── amber: load above proven, and the absent 60 g line ──
// A left turn with a right wall rising to 90°. The wall's top line (u = −6) runs at radius R + |X(−6)| (its offset from
// profile.js), and its surface normal there faces the turn's centre, so the load into it is v²/((R + |X|)·g) exactly.
function turnAtLoad() {
  const R = 40, prof = { font: 'wall', u: [-6, -1, 0, 5], psi: [Math.PI / 2, 0, 0, 0], material: 'ROAD' };
  const k = 1 / (R + Math.abs(PR.offsetAt(PR.normalize(prof), -6)[0]));
  return { R, prof, k, vFor: (g) => Math.sqrt(g * G / k) };
}
test('load above the proven 90 g is AMBER, with its FINDINGS source; at or below it is not (FINDINGS.md:105, :112-113)', () => {
  // a banked floor carrying the whole turn load: roll the floor so its normal faces the turn's centre. Simplest exact
  // case: the outside wall at 90° reads fN = v²κ_line/g, so choose v for 90 g ± 0.5 on that line.
  const { R, prof, vFor } = turnAtLoad();
  const hot = validate(X.pathOf(X.leftTurn(R, Math.PI / 2)), [X.seg({ speed: vFor(90.5), profile: prof })]);
  const cold = validate(X.pathOf(X.leftTurn(R, Math.PI / 2)), [X.seg({ speed: vFor(89.5), profile: prof })]);
  const a = hot.amber.find((x) => x.reason === 'load-above-proven');
  assert.ok(a, 'amber fires above 90 g');
  assert.match(a.source, /FINDINGS\.md:105/);
  assert.strictEqual(a.u, -6);
  assert.ok(!cold.amber.some((x) => x.reason === 'load-above-proven'), 'no amber at 89.5 g');
  assert.deepStrictEqual(reasons(hot.red), [], 'load is never red');
});

test('the withdrawn 60 g red line does not come back: 70 g is neither red nor amber (FINDINGS.md:116-118)', () => {
  const { R, prof, vFor } = turnAtLoad();
  const r = validate(X.pathOf(X.leftTurn(R, Math.PI / 2)), [X.seg({ speed: vFor(70), profile: prof })]);
  assert.deepStrictEqual(reasons(r.red), []);
  assert.ok(!r.amber.some((x) => x.reason === 'load-above-proven'));
  assert.ok(r.info.some((x) => x.reason === 'on-the-stops'), '70 g is past the 20 g suspension stop: informational only');
});

test('the 20 g suspension stop is INFORMATION, from 20 g on, never red or amber (FINDINGS.md:103-104)', () => {
  const { R, prof, vFor } = turnAtLoad();
  const at = validate(X.pathOf(X.leftTurn(R, Math.PI / 2)), [X.seg({ speed: vFor(20.01), profile: prof })]);
  const below = validate(X.pathOf(X.leftTurn(R, Math.PI / 2)), [X.seg({ speed: vFor(19.9), profile: prof })]);
  assert.ok(at.info.some((x) => x.reason === 'on-the-stops' && /FINDINGS\.md:103/.test(x.source)));
  assert.ok(!below.info.some((x) => x.reason === 'on-the-stops'));
});

// ── red: each rule fires on a bad path, stays quiet on a good one ──
test('the good paths carry NO red at all', () => {
  for (const [name, p, g] of [['straight', X.pathOf(X.straight(100)), [X.seg({ speed: 50 })]], ['turn', X.pathOf(X.leftTurn(60, Math.PI)), [X.seg({ speed: 50 })]]]) {
    assert.deepStrictEqual(validate(p, g).red, [], name);
  }
});

test('fold: a profile wider than the turn radius folds on the inside (1 − κ·q ≤ 0), and is red', () => {
  const wide = { font: 'flat', u: [-5, 0, 12], psi: [0, 0, 0], material: 'ROAD' };
  const r = validate(X.pathOf(X.leftTurn(10, Math.PI / 2)), [X.seg({ speed: 30, profile: wide })]);
  const f = r.red.find((x) => x.reason === 'fold');
  assert.ok(f, 'fold fires'); assert.strictEqual(f.u, 12); assert.match(f.source, /ARCHITECTURE\.md:57/);
  // boundary: an inside edge at 9.9 m on a 10 m radius does not fold
  const ok = validate(X.pathOf(X.leftTurn(10, Math.PI / 2)), [X.seg({ speed: 30, profile: { font: 'flat', u: [-5, 0, 9.9], psi: [0, 0, 0] } })]);
  assert.ok(!ok.red.some((x) => x.reason === 'fold'));
});

test('folds and self-intersections handed over by buildMesh become red; without them self-intersection is NOT CHECKED', () => {
  const p = X.pathOf(X.straight(20)), g = [X.seg({ speed: 30 })];
  const r = validate(p, g, { folds: [{ s: 5, u: 1, margin: -0.1 }, { s: 9, u: 0, margin: null, other: '1ROAD_3' }] });
  assert.deepStrictEqual(reasons(r.red).sort(), ['fold', 'self-intersection']);
  assert.match(validate(p, g).notChecked.join('\n'), /self-intersection/);
});

test('gap-in-road: a gap that is not a jump is red; a jump gap is not; the open head is exempt', () => {
  const road = X.straight(20, { seg: 0 }), gap = X.straight(10, { seg: 1, start: [0, 0, 20], s0: 20 }).slice(1), after = X.straight(20, { seg: 2, start: [0, 0, 30], s0: 30 }).slice(1);
  const segs = (word) => [X.seg({ speed: 50 }), X.seg({ id: 'g', kind: 'gap', word, speed: 50 }), X.seg({ id: 'r2', speed: 50 })];
  assert.ok(validate(X.pathOf([...road, ...gap, ...after]), segs('straight')).red.some((x) => x.reason === 'gap-in-road'));
  assert.ok(!validate(X.pathOf([...road, ...gap, ...after]), segs('jump')).red.some((x) => x.reason === 'gap-in-road'));
  assert.ok(!validate(X.pathOf([...road, ...gap]), segs('straight').slice(0, 2)).red.some((x) => x.reason === 'gap-in-road'), 'open head');
});

test('gap-in-road: two road stations further apart than their s says (a hole in a road word) are red', () => {
  const a = X.straight(10), b = X.straight(10, { start: [0, 0, 14], s0: 11 });   // 3 m of road missing between s 10 and 11
  const r = validate(X.pathOf([...a, ...b.map((p) => ({ ...p }))]), [X.seg({ speed: 50 })]);
  assert.ok(r.red.some((x) => x.reason === 'gap-in-road'));
});

test('missing-soft-collision is red only when the export turns the block off (FINDINGS.md:89)', () => {
  const p = X.pathOf(X.straight(10)), g = [X.seg({ speed: 30 })];
  assert.ok(validate(p, g, { softCollision: false }).red.some((x) => x.reason === 'missing-soft-collision' && /FINDINGS\.md:89/.test(x.source)));
  assert.ok(!validate(p, g).red.some((x) => x.reason === 'missing-soft-collision'));
});

test('wall-ride-from-wall-object: a wall-ride whose surface is WALL is red; the same wall-ride as ROAD is not', () => {
  const prof = (m) => ({ font: 'wall-ride', u: [-5, 0, 5, 10], psi: [0, 0, 0, 1.9], material: m });
  const p = X.pathOf(X.straight(10));
  assert.ok(validate(p, [X.seg({ word: 'wall-ride', speed: 30, profile: prof('WALL') })]).red.some((x) => x.reason === 'wall-ride-from-wall-object'));
  assert.ok(!validate(p, [X.seg({ word: 'wall-ride', speed: 30, profile: prof('ROAD') })]).red.some((x) => x.reason === 'wall-ride-from-wall-object'));
});

test('steep-without-raycast: above 50° is red only for a non-CSP export; 49° is quiet; CSP (the default) is quiet', () => {
  const prof = (deg) => ({ font: 'bowl', u: [-5, 0, 5, 8], psi: [0, 0, 0, deg * Math.PI / 180], material: 'ROAD' });
  const p = X.pathOf(X.straight(10));
  assert.ok(validate(p, [X.seg({ speed: 30, profile: prof(51) })], { csp: false }).red.some((x) => x.reason === 'steep-without-raycast'));
  assert.ok(!validate(p, [X.seg({ speed: 30, profile: prof(49) })], { csp: false }).red.some((x) => x.reason === 'steep-without-raycast'));
  assert.ok(!validate(p, [X.seg({ speed: 30, profile: prof(89) })]).red.some((x) => x.reason === 'steep-without-raycast'));
});

test('stacked-within-2m: a second pass 1.5 m above the first is red; 2.5 m above is not; one pass is never stacked', () => {
  const two = (h) => { const a = X.straight(40, { seg: 0 }), b = X.straight(40, { seg: 1, start: [0, h, 0], s0: 100 }); return X.pathOf([...a, ...b]); };
  const g = [X.seg({ speed: 30 }), X.seg({ id: 'b', speed: 30 })];
  assert.ok(validate(two(1.5), g).red.some((x) => x.reason === 'stacked-within-2m'));
  assert.ok(!validate(two(2.5), g).red.some((x) => x.reason === 'stacked-within-2m'));
  assert.ok(!validate(X.pathOf(X.leftTurn(35, Math.PI)), [X.seg({ speed: 30 })]).red.some((x) => x.reason === 'stacked-within-2m'), 'a tight turn is one pass');
});

test('seam-past-envelope is AMBER past 5.9° between neighbouring stations (FINDINGS.md:24), quiet at 5°', () => {
  const turnEvery = (deg) => X.pathOf(X.loop(10, { step: 10 * deg * Math.PI / 180 }), false);
  const sharp = validate(turnEvery(6), [X.seg({ speed: 40 })]), fine = validate(turnEvery(5), [X.seg({ speed: 40 })]);
  assert.ok(sharp.amber.some((x) => x.reason === 'seam-past-envelope' && /FINDINGS\.md:24/.test(x.source)));
  assert.ok(!fine.amber.some((x) => x.reason === 'seam-past-envelope'));
});

test('every red and amber carries a source (INTERFACES §3: "A red or amber with no source is a bug")', () => {
  // the inside edge folds (red), the outside wall past 90 g is amber, the block is off and the export is not CSP (red)
  const r = validate(X.pathOf(X.leftTurn(10, Math.PI / 2)), [X.seg({ speed: 400, profile: { font: 'wall', u: [-6, -1, 0, 12], psi: [Math.PI / 2, 0, 0, 0] } })], { softCollision: false, csp: false });
  assert.ok(r.red.length && r.amber.length);
  for (const x of [...r.red, ...r.amber]) assert.ok(typeof x.source === 'string' && /(FINDINGS|ARCHITECTURE)\.md:\d/.test(x.source), JSON.stringify(x));
});

// ── the lap ──
// CHANGED 2026-09-27 (D169): the second assertion used the DEFAULT car, which then had no acceleration. The car now has
// the measured one (FINDINGS.md:494), and a closed loop's lap proof runs with it (tested below); "no speed model" is
// still said, for a car that truly has none.
test('lap: an open path has no lap proof yet; a closed one without a speed model says so instead of inventing one', () => {
  assert.deepStrictEqual(validate(X.pathOf(X.straight(10)), [X.seg({ speed: 30 })]).lap, { ok: null, reason: 'open' });
  assert.deepStrictEqual(validate(X.pathOf(X.loop(20), true), [X.seg()], { car: { accel: null } }).lap, { ok: null, reason: 'no-speed-model' });
});

// CHANGED 2026-09-27 (D169): the cap was 745 km/h, read off FINDINGS.md:37, which is the speed at Centrifuge's hardest
// moment, not a top speed (FINDINGS.md:478-481). The cap was the measured 764 km/h of FINDINGS.md:484, and is now the 970 km/h of FINDINGS.md §3e.
test('lap sim: full throttle at car.accel, gravity along T, capped at the 970 km/h of FINDINGS.md §3e', () => {
  const flatRun = validate(X.pathOf(X.straight(5000, { step: 10 })), [X.seg()], { car: { accel: 20 } });
  assert.strictEqual(flatRun.speedFrom, 'lapsim');
  close(flatRun.speed[10].v, Math.sqrt(2 * 20 * 100), 1e-9, 'v² = 2·a·s on the flat');
  close(Math.max(...flatRun.speed.map((x) => x.v)), 970 / 3.6, 1e-9, 'capped');
  const up = validate(X.pathOf(X.straight(100, { grade: 0.1 })), [X.seg()], { car: { accel: 20 } });
  const T1 = 0.1 / Math.hypot(1, 0.1);
  close(up.speed[100].v, Math.sqrt(2 * (20 - G * T1) * 100), 1e-6, 'uphill: gravity along T subtracts');
});

test('lap: a closed loop driven fast enough proves out, with a lap time', () => {
  const R = 20, v = 40, r = validate(X.pathOf(X.loop(R), true), [X.seg({ speed: v })]);
  assert.strictEqual(r.lap.ok, true);
  close(r.lap.timeS, 2 * Math.PI * R / v, 1e-6);
  close(r.lap.minV, v, 1e-12);
});

// CHANGED 2026-10-03, as this test exists to make happen: vmax 764 → 970 (FINDINGS.md §3e, the first lap whose straights
// let the car reach top speed). CHANGED 2026-09-27 (D169): vmax 745 → 764 (FINDINGS.md:484), accel null → the
// measured table (FINDINGS.md:494), and the new design-speed default 460 km/h (FINDINGS.md:476).
test('MACH6 defaults are the FINDINGS numbers (a changed number must fail here, beside its citation)', () => {
  assert.deepStrictEqual([MACH6.suspensionStopG, MACH6.provenG, [...MACH6.jumpG], MACH6.reach.downDeg, MACH6.reach.fallG, MACH6.reach.minTakeoffKmh, MACH6.seamP90Deg, MACH6.stackedM, MACH6.steepDeg, MACH6.vmaxKmh, MACH6.designSpeedKmh],
    [20, 90, [3.2, 6.3], 10, 6.5, 375, 5.9, 2, 50, 970, 460]);
  assert.deepStrictEqual(MACH6.accel.map((r) => [...r]), [[100, 24.71], [250, 25.52], [350, 23.20], [450, 20.07], [550, 17.73], [650, 14.75], [750, 11.50]]);
});

test('the along-track term: accelerating at a on the flat reads fAlong = a/g (the dv/dt·T of the specific force)', () => {
  const r = validate(X.pathOf(X.straight(400, { step: 1 })), [X.seg()], { car: { accel: 20 } });
  const l = r.lines.find((x) => x.s === 100 && x.u === 0);
  close(l.fAlong_g, 20 / G, 1e-9); close(l.fN_g, 1, 1e-12);
});

test('fold boundary: an inside edge exactly AT the turn radius (1 − κ·q = 0) is a fold, as ARCHITECTURE.md:57 says "≤ 0"', () => {
  // the first station (θ = 0) has L = (1,0,0) and κ⃗ = (0.1,0,0) exactly, so 1 − κ⃗·(10·L) is exactly 0 there
  const r = validate(X.pathOf(X.leftTurn(10, Math.PI / 2)), [X.seg({ speed: 30, profile: { font: 'flat', u: [-5, 0, 10], psi: [0, 0, 0] } })]);
  assert.ok(r.red.some((x) => x.reason === 'fold' && x.s0 === 0 && x.u === 10), JSON.stringify(r.red));
});
