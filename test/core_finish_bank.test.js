// core_finish_bank.test.js: node --test test/core_finish_bank.test.js
// D434 (the user, 2026-10-22 09:44, TEST TRACK 10: "there needs to be a nuance for banking in large curves like that to support the car better"; 19:48: "did you
// ever do the work for the close loop understanding the nuance for when it should use banking"). Finish to start lays its turns flat: on TEST TRACK 10 the closer
// leaned −0.9° on average with 453 curved stations leaning out, and the side load at the design speed reached 10.68 g. The ruling (plan_d434 "Part 2 ruled"): each
// piece the closer makes is banked by −0.75·atan(v²·k/g), v the validator's design speed, sized from the CLOSED route's curvature, easing in with the curve and
// meeting the laid bank at every joint; roll under the amber; the cup as built. GEOMETRY tier.
// The bars, on the closer's curved stations (|k| > 1/600 m, as the librarian's lean.js): the lean into the curve, asin(U·k̂); the side load at the design speed on the
// centreline, the validator's formula (src/validate/index.js:11) f = v²κ⃗ + g·ŷ across the road, in g. Rows:
//   1  TEST TRACK 10 (its open lap, a private track kept off the repository; skipped by name when absent): the closer leans into its curves (no station leaning out
//      by more than 5°), its peak side load at the design speed is below the flat closer's 10.68 g, the lap closes within 1 mm, its roll stays under the amber,
//      and every piece it did not lay is the same object
//   2  TEST 10 (the same, private): the same, against its flat 10.96 g
//   3  a closer with only gentle curves (one 180° turn at R ≈ 2,000 m) is banked by its share and no more: its steepest bank well under TEST 10's tight closer's
// And in rows 1–3, THE SHARE: on each turn the closer lays upright (the same bank at both ends), at every control point where the rate limit is not binding (both
// steps beside it under 0.8 of the cap), the bank is −0.75·atan(v²·k/g) of the FINAL curvature to 1e-6 rad (measured 1e-9: share-residual.js; a bank sized from
// the laid route misses by up to 0.93 rad on TEST TRACK 10, and an unlimited one that the backstop scales down by 0.65). D438: and where the roll's acceleration
// limit is not binding either (each slope change beside it under 0.8 of BANK_ACCEL); the share check is amended by name at its line, the share unchanged.
//   4  a straight gets none: a lap that ends on its start line behind the start finishes with a straight, and its bank is the laid bank
// D439 (P's review of D438, exo_memory/handback/p-d438-review-P_2026-10-22.md §2 (b), (c); plan_d438 "P's review ruled"), on P's laps built here (cup 10°, a turn
// over 1,500 m, then a tail rolling and cupping to 35°). The bar on each: no curved station of the closer leans out by more than 5°, and its peak side load at the
// design speed is under SIDE_BANKED_G, 6 g: over every banked closer measured (4.02–5.11 g: his two tracks, core_finish_joints rows 5–7, and these laps rolled
// first) and under every unbanked one (9.16–10.89 g, these laps closed roll-last).
// The bar separates only over the laps measured here: P's sweep has a banked closer over it (turn 180, tail 700, roll 54: LSL 1,243 m rolled first, 0 out,
// 6.17 g; its short turns never reach the share between the pinned ends; exo_memory/handback/p-d439-review-P_2026-10-23.md §2.3). No row uses that lap.
//   5  turn 210, tail 300, roll 30: the roll straight laid first is not bent by the close (it was: 41 stations leaning out, to −26.3°, 5.07 g, P §2 (b))
//   6  turn 180, tail 1,200, roll 10: the closer that banks its turns is taken (a roll-last close kept its turns on the end's bank, unbanked: 10.89 g, P §2 (c))
//   7  turn 180, tail 1,200, roll 30: the same (9.16 g)
//   8  the other side of that choice: an end banked 54° the way the closer turns (core_finish row 12's lap) is closed rolled LAST, its turns leaning on the end's own
//      bank (5.55 g, against 8.08 rolled first), and the bank adds nothing on top of it (D434's upright rule): 0 out, under SIDE_BANKED_G
//   9  D440 (O's D439 §5): a lap whose own turn is tight (180° over 400 m, R 127 m, then a 1,200 m tail rolling 10°): never a closer that leans out. At D439 the
//      roll-last closer was taken leaning out at 1,171 of 1,172 curved stations, 9.22 g, against a roll-first one-turn route at R 126 m (~9.5 g). Its side
//      load is not barred here: no ranking of the routes by it was built (exo_memory/handback/p-d440-O_2026-10-23.md §2)
//  10  his two tracks keep D439's routes (the chair's D440 brief: "his two tracks must keep their D439 figures"): TEST TRACK 10 RSL at R 300, 206 m rolled first,
//      3,990 m; TEST 10 LSR at R 300, 2,584 m. (Taking the lowest side load of EVERY route that passes chose R 900 for both, 11,426 and 10,413 m.)
//  11  D443 (plan_d438 "D443 ruled from O's side"): a crest under a bend is not a lean out. P's pitched lap (cup 10°, a 180° turn over 1,500 m, 300 m pitched by
//      kv −0.0006, 100 m back to level, a 600 m tail rolling 10°): its short closer LSL 1,120 m leans INTO its turn at every curved station, but read over the 3-D
//      curvature two stations of its crest read −7.1° and rule 1 took RSR 3,309 m. The lean is read against the HORIZONTAL turn (κ less its world-up part,
//      curved where |κh| > 1/600 m), here and in finish.js closerLoad
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../src/core/document.js');
const AD = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const { MACH6, G } = require('../src/validate/limits.js');
const { extend } = require('../src/core/extend.js');
const { extendTurnBy } = require('../src/core/turnby.js');
const F = require('../src/core/finish.js');

const v = MACH6.designSpeedKmh / 3.6, DEG = Math.PI / 180, ACCEL = 2e-4;   // ACCEL: finish.js BANK_ACCEL (D438)
/** Over the pieces from index `from` of a closed document: curved stations, those leaning out by more than 5°, the mean lean, the peak side load at the design speed.
 *  D443: the lean is read against the HORIZONTAL turn (κ less its world-up part; curved where |κh| > 1/600 m), as finish.js closerLoad reads it (row 11). */
function lean(doc, from) {
  const { segments, path: p } = AD.toPath(doc, { step: 2 }), ids = new Set(doc.pieces.slice(from).map((P) => P.id));
  let n = 0, out = 0, sum = 0, lat = 0;
  for (const q of p.samples) {
    if (!ids.has(segments[q.seg].id)) continue;
    const k = q.kvec, kh = Math.hypot(k[0], k[2]); if (kh < 1 / 600) continue;
    const l = Math.asin(Math.max(-1, Math.min(1, (q.U[0] * k[0] + q.U[2] * k[2]) / kh))) / DEG;
    const f = [v * v * k[0], v * v * k[1] + G, v * v * k[2]];
    n++; sum += l; if (l < -5) out++; lat = Math.max(lat, Math.abs((f[0] * q.L[0] + f[1] * q.L[1] + f[2] * q.L[2]) / G));
  }
  return { n, out, mean: sum / n, lat };
}
function rollPeak(doc, from) {
  const { segments, path: p } = AD.toPath(doc, { step: 2 }), ids = new Set(doc.pieces.slice(from).map((P) => P.id));
  return V._internal.rollRates(p.samples, (i) => segments[p.samples[i].seg].kind !== 'gap', true, p.lengthM).filter((r) => ids.has(segments[p.samples[r.i].seg].id)).reduce((m, r) => Math.max(m, r.rate), 0);
}
function banked(open, what, flatLatG) {
  const r = F.finishToStart(open), n0 = open.pieces.length;
  assert.equal(r.doc.closed, true, `${what}: ${r.plan.report}`);
  open.pieces.forEach((P, i) => assert.equal(r.doc.pieces[i], P, `${what}: piece ${i} is the user's own, untouched`));
  const { residual } = require('../src/core/close.js'), rs = residual(r.doc);
  assert.ok(rs.gapM < 1e-3, `${what}: closes within 1 mm (${(rs.gapM * 1000).toFixed(3)} mm)`);
  const L = lean(r.doc, n0);
  assert.equal(L.out, 0, `${what}: no curved station leans out (mean lean ${L.mean.toFixed(1)}°, ${L.out} of ${L.n} out)`);
  assert.ok(L.lat < flatLatG, `${what}: the peak side load at the design speed, ${L.lat.toFixed(2)} g, is below the flat closer's ${flatLatG} g`);
  const roll = rollPeak(r.doc, n0);
  assert.ok(roll < V.ROLL_AMBER_DEG_M, `${what}: the roll stays under the amber (${roll.toFixed(3)} against ${V.ROLL_AMBER_DEG_M}°/m)`);
  const cap = (0.8 * 0.9 * V.ROLL_AMBER_DEG_M * Math.PI) / 180; let read = 0;
  for (const P of r.doc.pieces.slice(n0)) {
    const ph = P.channels.phi, kh = P.channels.kh, U = D.knotVector(P), g = (i) => (U[i + 1] + U[i + 2] + U[i + 3]) / 3;
    if (Math.abs(ph[0] - ph[ph.length - 1]) > 1e-4 || !kh.some((k) => Math.abs(k) > 1e-6)) continue;
    for (let i = 2; i < ph.length - 2; i++) {
      const t = (j) => ph[j] - ph[0];
      if (Math.abs(t(i) - t(i - 1)) > cap * (g(i) - g(i - 1)) || Math.abs(t(i + 1) - t(i)) > cap * (g(i + 1) - g(i))) continue;
      // AMENDED by D438 (plan_d438 "Part 2 ruled": a second limiter, on the roll's acceleration, finish.js BANK_ACCEL): a point the acceleration limit holds back
      // from its share is not read either: the slope change at i − 1, i and i + 1 all under 0.8 of BANK_ACCEL·(d₀ + d₁)/2. The share itself is unchanged.
      const acc = (j) => j < 1 || j > ph.length - 2 ? 0 : Math.abs((ph[j + 1] - ph[j]) / (g(j + 1) - g(j)) - (ph[j] - ph[j - 1]) / (g(j) - g(j - 1))) / ((ACCEL * (g(j + 1) - g(j - 1))) / 2);
      if (acc(i - 1) > 0.8 || acc(i) > 0.8 || acc(i + 1) > 0.8) continue;
      const want = -0.75 * Math.atan((v * v * kh[i]) / G); read++;
      assert.ok(Math.abs(t(i) - want) < 1e-6, `${what}: ${P.id} point ${i}: bank ${(t(i) / DEG).toFixed(3)}° is the share of its final curvature, ${(want / DEG).toFixed(3)}°`);
    }
  }
  assert.ok(read > 0, `${what}: control: some bank control points were read for the share`);
  return { r, L, n0 };
}
const privateRow = (file, name) => (fs.existsSync(path.join(__dirname, '..', 'fixtures-d431', file)) ? false : `fixtures-d431/${file} is not here (${name}: a private track, kept off the repository)`);
const openOf = (file) => D.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures-d431', file), 'utf8'));
const maxBankDeg = (doc, n0) => Math.max(...doc.pieces.slice(n0).map((P) => Math.max(...P.channels.phi.map((x, i) => Math.abs(x - P.channels.phi[0])))) ) / DEG;

test('row 1: TEST TRACK 10\'s closer leans into its curves, carries less side load, closes, and rolls under the amber', { skip: privateRow('testtrack10-open.t180track', 'TEST TRACK 10') }, () => {
  banked(openOf('testtrack10-open.t180track'), 'TEST TRACK 10', 10.68);
});

let test10Peak = null;
test('row 2: TEST 10\'s closer leans into its curves, carries less side load, closes, and rolls under the amber', { skip: privateRow('test10-open.t180track', 'TEST 10') }, () => {
  const { r, n0 } = banked(openOf('test10-open.t180track'), 'TEST 10', 10.96);
  test10Peak = maxBankDeg(r.doc, n0);
});

test('row 3: a closer with only gentle curves is banked by its share and no more', () => {
  let d = D.createDoc('gentle');
  d = extend(d, { length: 1000, family: 'bowl' });
  d = extendTurnBy(d, { length: Math.round(Math.PI * 2000), targets: { kv: 0 } }, Math.PI);
  const { r, n0 } = banked(d, 'the gentle closer', 10.96);
  const peak = maxBankDeg(r.doc, n0);
  if (test10Peak !== null) assert.ok(peak < 0.85 * test10Peak, `its steepest bank, ${peak.toFixed(1)}°, is well under TEST 10's tight closer's ${test10Peak.toFixed(1)}°`);
  assert.ok(peak < 50, `its steepest bank is ${peak.toFixed(1)}°`);
});

const SIDE_BANKED_G = 6;
function pLap(turnDeg, tailM, rollDeg, turnM = 1500) {
  let d = D.createDoc(`P ${turnDeg}/${tailM}/${rollDeg}`);
  d = extend(d, { length: 1000, family: 'bowl', first: { c: 10 } });
  d = extendTurnBy(d, { length: turnM, targets: { kv: 0 } }, (turnDeg * Math.PI) / 180);
  return extend(d, { length: tailM, targets: { c: 35, phi: (rollDeg * Math.PI) / 180 } });
}
function leansIn(turnDeg, tailM, rollDeg, turnM) {
  const open = pLap(turnDeg, tailM, rollDeg, turnM), r = F.finishToStart(open), n0 = open.pieces.length, what = `turn ${turnDeg}, tail ${tailM}, roll ${rollDeg}`;
  assert.equal(r.doc.closed, true, `${what}: ${r.plan.report}`);
  open.pieces.forEach((P, i) => assert.equal(r.doc.pieces[i], P, `${what}: piece ${i} is the user's own, untouched`));
  const L = lean(r.doc, n0);
  assert.equal(L.out, 0, `${what}: no curved station of the closer leans out (${L.out} of ${L.n} out; ${r.plan.report})`);
  assert.ok(L.lat < SIDE_BANKED_G, `${what}: the peak side load at the design speed, ${L.lat.toFixed(2)} g, is a banked closer's, under ${SIDE_BANKED_G} g (${r.plan.report})`);
}
test('row 5: P\'s turn 210, tail 300, roll 30: the roll straight laid first is not bent into a lean the wrong way', () => leansIn(210, 300, 30));
test('row 6: P\'s turn 180, tail 1,200, roll 10: the closer that banks its turns is the one taken', () => leansIn(180, 1200, 10));
test('row 7: P\'s turn 180, tail 1,200, roll 30: the closer that banks its turns is the one taken', () => leansIn(180, 1200, 30));
test('row 9: a lap whose own turn is tight (180° over 400 m): never a closer that leans out', () => {
  const open = pLap(180, 1200, 10, 400), r = F.finishToStart(open), L = lean(r.doc, open.pieces.length);
  assert.equal(r.doc.closed, true, r.plan.report);
  assert.equal(L.out, 0, `no curved station of the closer leans out (${L.out} of ${L.n} out; ${r.plan.report})`);
});
test('row 10: his two tracks keep the routes D439 gave them', { skip: privateRow('testtrack10-open.t180track', 'TEST TRACK 10') || privateRow('test10-open.t180track', 'TEST 10') }, () => {
  for (const [file, word, len, rollFirst] of [['testtrack10-open.t180track', 'RSL', 3990, true], ['test10-open.t180track', 'LSR', 2584, false]]) {
    const { plan } = F.finishToStart(openOf(file));
    assert.deepEqual([plan.word, Math.round(plan.radiusM), plan.lengthM, plan.rollFirst], [word, 300, len, rollFirst], `${file}: ${plan.report}`);
  }
});
test('row 11: a crest under a bend is not a lean out: P\'s pitched lap takes its short closer, leaning into its turn', () => {
  let d = D.createDoc('pitched'); d = extend(d, { length: 1000, family: 'bowl', first: { c: 10 } }); d = extendTurnBy(d, { length: 1500, targets: { kv: 0 } }, Math.PI);
  d = extend(d, { length: 300, targets: { kv: -0.0006 } }); d = extend(d, { length: 100, targets: { kv: 0 } });
  const open = extend(d, { length: 600, targets: { c: 35, phi: 10 * DEG } }), r = F.finishToStart(open), L = lean(r.doc, open.pieces.length);
  assert.deepEqual([r.plan.word, r.plan.lengthM], ['LSL', 1120], `the short closer: ${r.plan.report}`);
  assert.equal(L.out, 0, `no curved station of the closer leans out of its turn (${L.out} of ${L.n})`);
});
test('row 8: an end banked the way the closer turns is closed rolled last, on its own bank and with nothing banked on top', () => {
  let d = D.createDoc('banked'); d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: 500 }, -150 * DEG); d = extend(d, { length: 200 });
  d = extend(d, { length: 200, transition: 100, targets: { phi: 54 * DEG } }); d = extend(d, { length: 100, targets: { kv: 0 } });
  const r = F.finishToStart(d), L = lean(r.doc, d.pieces.length);
  assert.equal(r.plan.rollFirst, false, `rolled last: ${r.plan.report}`);
  assert.equal(L.out, 0, `no curved station of the closer leans out (${L.out} of ${L.n})`);
  assert.ok(L.lat < SIDE_BANKED_G, `the peak side load at the design speed, ${L.lat.toFixed(2)} g, is under ${SIDE_BANKED_G} g`);
});

test('row 4: a straight gets none: a finish that is only a straight keeps the laid bank', () => {
  let d = D.createDoc('straight');
  d = extend(d, { length: 400, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extendTurnBy(d, { length: 300, targets: { kv: 0 } }, Math.PI / 2);
  d = D.checkDoc({ ...d, pieces: d.pieces.slice(0, -1) });
  d = extendTurnBy(d, { length: 300, targets: { kv: 0 } }, Math.PI / 2);
  const r = F.finishToStart(d), n0 = d.pieces.length;
  for (const P of r.doc.pieces.slice(n0)) if (Math.max(...P.channels.kh.map(Math.abs)) < 1e-9) assert.ok(P.channels.phi.every((x) => Math.abs(x - P.channels.phi[0]) < 1e-9), `${P.id}, a straight, keeps its laid bank`);
});
