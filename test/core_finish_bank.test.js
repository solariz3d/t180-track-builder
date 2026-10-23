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
/** Over the pieces from index `from` of a closed document: curved stations, those leaning out by more than 5°, the mean lean, the peak side load at the design speed. */
function lean(doc, from) {
  const { segments, path: p } = AD.toPath(doc, { step: 2 }), ids = new Set(doc.pieces.slice(from).map((P) => P.id));
  let n = 0, out = 0, sum = 0, lat = 0;
  for (const q of p.samples) {
    if (!ids.has(segments[q.seg].id)) continue;
    const k = q.kvec, km = Math.hypot(...k); if (km < 1 / 600) continue;
    const l = Math.asin(Math.max(-1, Math.min(1, (q.U[0] * k[0] + q.U[1] * k[1] + q.U[2] * k[2]) / km))) / DEG;
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

test('row 4: a straight gets none: a finish that is only a straight keeps the laid bank', () => {
  let d = D.createDoc('straight');
  d = extend(d, { length: 400, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extendTurnBy(d, { length: 300, targets: { kv: 0 } }, Math.PI / 2);
  d = D.checkDoc({ ...d, pieces: d.pieces.slice(0, -1) });
  d = extendTurnBy(d, { length: 300, targets: { kv: 0 } }, Math.PI / 2);
  const r = F.finishToStart(d), n0 = d.pieces.length;
  for (const P of r.doc.pieces.slice(n0)) if (Math.max(...P.channels.kh.map(Math.abs)) < 1e-9) assert.ok(P.channels.phi.every((x) => Math.abs(x - P.channels.phi[0]) < 1e-9), `${P.id}, a straight, keeps its laid bank`);
});
