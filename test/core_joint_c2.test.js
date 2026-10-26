// core_joint_c2.test.js: node --test test/core_joint_c2.test.js      (T180_TREE=<worktree> runs it from outside the tree)
// D459 (the user, 2026-10-25 15:47 on TEST 10 at local-0.4.19: "there is still a bump its not smooth"; plan_test10_bump_d459). GEOMETRY tier, written RED first.
// The joint between a piece that HOLDS a cross-section channel and a piece that RAMPS it is C1 today and not C2: extend.js blends a target in with the Bloss
// cubic S(u) = 3u² − 2u³ (extend.js `bloss`), whose slope is 0 at both ends but whose second derivative is 6·Δ/L² there. So the roll (bank), the cup and the
// edge angles all arrive with a STEP in their curvature along s at the ramp's start and at its end. Under a wheel 8.4 m from the centre a roll-curvature step
// of Δφ'' is a vertical-curvature step of 8.4·Δφ'': on TEST 10 that is 15 °/100 m at every 30° bank onset (1.8 g at 300 km/h), 20 °/100 m where the 35° right
// edge begins (2.5 g), and 10 °/100 m at the lap seam where the closer's 15° cup comes home over 40 m (1.2 g) — the figures of D436 §7 and D459 (jnt459c2.out,
// kstep419.out), measured again here on public words laid the way his were. Rows:
//   0  the instrument (src/core/continuity.js endDerivatives): its closed forms for a channel's value, slope and curvature at a piece's ends agree with
//      document.js pieceEnd (value, slope) and with the four-point reading of valuesAt below (curvature) on every channel of a document laid from mixed words,
//      and c2Breaks lists exactly the joints the four-point reading finds
//   1  a 30° bank reached over 100 m (his p2): the roll's second derivative is continuous at the ramp's start and at its end. RED before: 0 -> 0.0178 deg/m²
//      at the start and 0.0178 -> 0 at the end (6·30°/100² exactly); 15 °/100 m at the wheel line
//   2  a 15° cup brought home to 0 over 40 m (the closer's fade at his seam): the cup's second derivative is continuous at both ends. RED before: 0.056 deg/m²
//   3  a 30° edge brought to 0 over 50 m (his p10): the edge angle's second derivative is continuous at both ends. RED before: 0.072 deg/m²
//   4  a 35° right edge reached over 50 m (his p11): the right edge's second derivative is continuous at both ends. RED before: 0.084 deg/m²
//   5  (control, green today and must stay green) at the same joints every channel's VALUE and SLOPE are continuous: the fix is a C2 ease, not a looser C1
//   6  through Close (finish.js finishToStart on a lap built here, core_finish_joints' "rolled cup"): the closer brings the cup home C2, at its first joint
//      (where it meets the user's last piece), at every joint of its own and at the seam, to TOL_CLOSE. RED before: cupHome's LINEAR fade is C1 at both ends by
//      its joint slope rule, but the stored spline bends over one span to meet the line, 0.00075 °/m² at the closer's first joint and 0.00092 at the seam on this
//      lap (closeprobe-old.out); the quintic reads 0.00001–0.00002. The bar is tighter than rows 1–4's because the closer's rate cap, 0.021 °/m, bounds the
//      linear fade's end bend to about 2 × 0.021 / 20 m = 0.002 °/m²: small, and under the wheels still a step
//   8  the ramp's SHAPE is the quintic's: a 30° bank over 100 m follows 6u⁵ − 15u⁴ + 10u³ within 1.5% of the change at every half metre, and a 35° right edge
//      over 50 m (three interior knots: a coarser fit) within 3%. The Bloss cubic is 5.2% off the quintic at u = ¼, and a ramp blended by the cubic and merely
//      pinned C2 at its ends by c2Ends reads 2.2% off on the 100 m bank: caught here, not by rows 1–4 (the ends read C2 either way)
//   9  the closure itself (D459 3c, src/core/close.js): a WHOLE-LAP close (the seeded sweep's seeds 10 and 16, whose words are copied here) and a LOCAL close of
//      the last piece on a lap with a bank ramp leave no curvature step at the seam nor at any joint the close moved. RED before 3c: the closure met value and
//      slope only (seed 10's lap stepped at the seam by 0.34 °/m² and at a moved joint; seed 16's at the seam and at p7|p8), GREEN with the curvature rows
//   7  through Close: the roll straight Finish lays is C2 where it meets the user's last piece (it is laid by extend, so it follows row 1). Its exit joint is
//      bankLap's (finish.js bankPlan): the plan's own acceleration bound, BANK_ACCEL 2e-4 rad/m² = 0.0115 °/m², is what steps there, by the D447 ruling, not this lap's
// The second derivative AT the end is read from document.js valuesAt by the one-sided four-point formula (2f₀ − 5f₁ + 4f₂ − f₃)/H², H = 0.5 m, which is exact for
// the cubic each end span of the stored spline is (a plain second difference reads f″ half a metre in, where a short quintic ramp is already curving); a Bloss ramp
// reads its 6·Δ/L² that way and a C2 ease reads 0.000 to the tolerance below.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const T = process.env.T180_TREE ? path.resolve(process.env.T180_TREE) : path.join(__dirname, '..');
const D = require(path.join(T, 'src/core/document.js'));
const { extend } = require(path.join(T, 'src/core/extend.js'));
const { extendTurnBy } = require(path.join(T, 'src/core/turnby.js'));
const F = require(path.join(T, 'src/core/finish.js'));
const Cn = require(path.join(T, 'src/core/continuity.js'));
const { close } = require(path.join(T, 'src/core/close.js'));

const DEG = Math.PI / 180, H = 0.5;
const TOL_D2 = 1e-3;     // deg/m² (phi read in degrees): a Bloss ramp reads 18 to 84 times this on his words; a C2 ease reads 0 to rounding
const TOL_CLOSE = 2e-4;  // deg/m², the Close rows: the linear fade read 0.00075–0.00092 on row 6's lap, the quintic 0.00001–0.00002 (10× under)
const TOL_V = 1e-6, TOL_M = 1e-4, H1 = 1e-3;   // the C1 that holds today: value (deg) exact to 1e-6; the slope over H1 = 1 mm (a Bloss end slope reads f''·H1/2 ~ 1e-5 deg/m that way, under the 1e-4 bar)

const inDeg = (ch, x) => (ch === 'phi' ? x / DEG : x);
const at = (P, ch, s) => inDeg(ch, D.valuesAt(P, Math.max(0, Math.min(P.length, s)))[ch]);
/** value, slope and second derivative of a channel at a piece's END (one-sided, over H) */
const endOf = (P, ch) => { const L = P.length, g = (s) => at(P, ch, s); return { v: g(L), m: (g(L) - g(L - H)) / H, d2: (2 * g(L) - 5 * g(L - H) + 4 * g(L - 2 * H) - g(L - 3 * H)) / (H * H) }; };
/** the same at a piece's START */
const startOf = (P, ch) => { const g = (s) => at(P, ch, s); return { v: g(0), m: (g(H) - g(0)) / H, d2: (2 * g(0) - 5 * g(H) + 4 * g(2 * H) - g(3 * H)) / (H * H) }; };
const joint = (doc, k) => [doc.pieces[k], doc.pieces[k + 1]];

/** a straight, then a piece ramping `ch` to `target` over `L` m, then a straight that holds it: the two joints a ramp has */
const ramp = (ch, target, L, first) => {
  let d = extend(D.createDoc('c2'), { length: 100, ...(first ? { first } : {}) });
  d = extend(d, { length: L, targets: { [ch]: target } });
  d = extend(d, { length: 100 });
  return d;
};
const c2Step = (doc, k, ch) => { const [A, B] = joint(doc, k); return Math.abs(startOf(B, ch).d2 - endOf(A, ch).d2); };
const c1Step = (doc, k, ch, A0, B0) => { const [A, B] = A0 ? [A0, B0] : joint(doc, k); const L = A.length; const va = at(A, ch, L), ma = (va - at(A, ch, L - H1)) / H1, vb = at(B, ch, 0), mb = (at(B, ch, H1) - vb) / H1; return { dv: Math.abs(vb - va), dm: Math.abs(mb - ma) }; };

test("row 0: the instrument's closed forms agree with pieceEnd and with the four-point reading, channel by channel; c2Breaks finds the same joints", () => {
  let d = extend(D.createDoc('i'), { length: 100, first: { e: 10 } });
  d = extend(d, { length: 100, targets: { phi: 25 * DEG, w: 14, kh: 1 / 400 } }); d = extend(d, { length: 50, targets: { er: 30 } });
  d = extend(d, { length: 100, transition: { w: 'start' }, targets: { w: 20, e: 0 } }); d = extend(d, { length: 80, targets: { kv: 1 / 3000, phi: 0 } });
  let worst = 0, where = '';
  for (const P of d.pieces) for (const ch of D.CHANNELS) {
    const e = Cn.endDerivatives(P, ch), g = (s) => D.valuesAt(P, Math.max(0, Math.min(P.length, s)))[ch], L = P.length;
    const ks = (2 * g(0) - 5 * g(H) + 4 * g(2 * H) - g(3 * H)) / (H * H), ke = (2 * g(L) - 5 * g(L - H) + 4 * g(L - 2 * H) - g(L - 3 * H)) / (H * H);
    for (const [a, b, what] of [[e.start.k, ks, 'k(0)'], [e.end.k, ke, 'k(L)']]) if (Math.abs(a - b) > worst) { worst = Math.abs(a - b); where = `${P.id} ${ch} ${what}: ${a} vs ${b}`; }
    const pe = D.pieceEnd(P)[ch]; if (pe && ch !== 'c' && ch !== 't') { assert.ok(Math.abs(e.end.v - pe.v) < 1e-12 && Math.abs(e.end.m - pe.m) < 1e-12, `${P.id} ${ch}: end value/slope ${e.end.v}, ${e.end.m} against pieceEnd's ${pe.v}, ${pe.m}`); }   // pieceEnd rewrites c and t for a legacy or tube piece (the rendered edge), by design
  }
  assert.ok(worst < 1e-9, `the closed-form curvature and the four-point reading differ by ${worst} at ${where}`);
  // the same verdict two ways: the joints where a C2 channel's curvature steps, by the instrument and by the four-point reading (none here: this tree's ramps are C2)
  const byFour = []; for (let k = 0; k + 1 < d.pieces.length; k++) for (const ch of Cn.C2_CHANNELS) { const s = Math.abs(startOf(d.pieces[k + 1], ch).d2 - endOf(d.pieces[k], ch).d2); if (s > Cn.TOL_K) byFour.push(`${d.pieces[k].id}|${d.pieces[k + 1].id} ${ch}`); }
  assert.deepEqual(Cn.c2Breaks(d).map((e) => `${e.joint} ${e.ch}`), byFour);
  assert.deepEqual(byFour, [], 'control: a lap laid from these words on this tree has no C2 break');
});

test('row 1: a bank reached over 100 m is C2 at the ramp\'s start and end (the roll\'s curvature along s does not step)', () => {
  const d = ramp('phi', 30 * DEG, 100);
  const s0 = c2Step(d, 0, 'phi'), s1 = c2Step(d, 1, 'phi');
  const wheel = (x) => (8.4 * x * DEG * 100 / DEG).toFixed(2);   // 8.4 m × Δφ'' as a vertical curvature, deg/100 m
  assert.ok(s0 <= TOL_D2, `at the ramp's start the roll's second derivative steps by ${s0.toFixed(4)} deg/m² (${wheel(s0)} deg/100 m under a wheel 8.4 m out); the bar is ${TOL_D2}`);
  assert.ok(s1 <= TOL_D2, `at the ramp's end the roll's second derivative steps by ${s1.toFixed(4)} deg/m² (${wheel(s1)} deg/100 m under a wheel 8.4 m out); the bar is ${TOL_D2}`);
});

test('row 2: a 15° cup brought home to 0 over 40 m is C2 at both ends of the fade', () => {
  let d = extend(D.createDoc('c2'), { length: 100, first: { c: 15 } });
  d = extend(d, { length: 40, targets: { c: 0 } });
  d = extend(d, { length: 100 });
  const s0 = c2Step(d, 0, 'c'), s1 = c2Step(d, 1, 'c');
  assert.ok(s0 <= TOL_D2, `at the fade's start the cup's second derivative steps by ${s0.toFixed(4)} deg/m²; the bar is ${TOL_D2}`);
  assert.ok(s1 <= TOL_D2, `at the fade's end the cup's second derivative steps by ${s1.toFixed(4)} deg/m²; the bar is ${TOL_D2}`);
});

test('row 3: a 30° edge brought to 0 over 50 m is C2 at both ends', () => {
  let d = extend(D.createDoc('c2'), { length: 100, first: { e: 30 } });
  d = extend(d, { length: 50, targets: { e: 0 } });
  d = extend(d, { length: 100 });
  const s0 = c2Step(d, 0, 'e'), s1 = c2Step(d, 1, 'e');
  assert.ok(s0 <= TOL_D2, `at the ramp's start the edge angle's second derivative steps by ${s0.toFixed(4)} deg/m²; the bar is ${TOL_D2}`);
  assert.ok(s1 <= TOL_D2, `at the ramp's end the edge angle's second derivative steps by ${s1.toFixed(4)} deg/m²; the bar is ${TOL_D2}`);
});

test('row 4: a 35° right edge reached over 50 m is C2 at both ends', () => {
  const d = ramp('er', 35, 50);
  const s0 = c2Step(d, 0, 'er'), s1 = c2Step(d, 1, 'er');
  assert.ok(s0 <= TOL_D2, `at the ramp's start the right edge's second derivative steps by ${s0.toFixed(4)} deg/m²; the bar is ${TOL_D2}`);
  assert.ok(s1 <= TOL_D2, `at the ramp's end the right edge's second derivative steps by ${s1.toFixed(4)} deg/m²; the bar is ${TOL_D2}`);
});

test('row 5 (control): at every one of those joints the channel\'s value and slope are continuous (the C1 that holds today stays)', () => {
  const cases = [['phi', ramp('phi', 30 * DEG, 100)], ['er', ramp('er', 35, 50)]];
  { let d = extend(D.createDoc('c2'), { length: 100, first: { c: 15 } }); d = extend(d, { length: 40, targets: { c: 0 } }); d = extend(d, { length: 100 }); cases.push(['c', d]); }
  { let d = extend(D.createDoc('c2'), { length: 100, first: { e: 30 } }); d = extend(d, { length: 50, targets: { e: 0 } }); d = extend(d, { length: 100 }); cases.push(['e', d]); }
  for (const [ch, d] of cases) for (const k of [0, 1]) {
    const { dv, dm } = c1Step(d, k, ch);
    assert.ok(dv <= TOL_V, `${ch} value steps by ${dv} at joint ${k}`);
    assert.ok(dm <= TOL_M, `${ch} slope steps by ${dm} per m at joint ${k}`);
  }
});

/** core_finish_joints.test.js's lap: a cup laid at 10°, a half turn, then 300 m rolling 40° and cupping to 35°; Close rolls upright, banks and brings the cup home */
function rolledCup() {
  let d = D.createDoc('rolled cup');
  d = extend(d, { length: 1000, family: 'bowl', first: { c: 10 } });
  d = extendTurnBy(d, { length: 1500, targets: { kv: 0 } }, Math.PI);
  return extend(d, { length: 300, targets: { c: 35, phi: 40 * DEG } });
}
test("row 6: through Close, the closer brings the cup home C2: at its first joint, its own joints and the seam the cup's second derivative does not step", () => {
  const open = rolledCup(), n0 = open.pieces.length, r = F.finishToStart(open), doc = r.doc;
  assert.equal(doc.closed, true, `control: the lap closes (${r.plan.report})`);
  assert.ok(doc.pieces.slice(n0).every((P) => P.cup) && doc.pieces[0].cup, 'control: the closer and p1 are cup pieces');
  assert.doesNotMatch(r.plan.report, /the cup comes home at/, `control: the closer is long enough for the rate (${r.plan.report})`);
  const bad = [];
  for (let k = n0 - 1; k < doc.pieces.length; k++) {   // n0 − 1 | n0 is the first joint; the last joint is the seam, pieces.length − 1 | 0
    const A = doc.pieces[k], B = doc.pieces[(k + 1) % doc.pieces.length], s = Math.abs(startOf(B, 'c').d2 - endOf(A, 'c').d2), c1 = c1Step(doc, k === doc.pieces.length - 1 ? -1 : k, 'c', A, B);
    if (s > TOL_CLOSE || c1.dm > TOL_M) bad.push(`${A.id}|${B.id}: c'' steps by ${s.toFixed(5)} deg/m² (bar ${TOL_CLOSE}), slope by ${c1.dm.toFixed(5)} deg/m`);
  }
  assert.deepEqual(bad, [], 'every closer joint and the seam: the cup is C2 (and C1)');
});
test("row 7: through Close, Finish's roll straight is C2 where it meets the user's last piece", () => {
  const open = rolledCup(), n0 = open.pieces.length, r = F.finishToStart(open), doc = r.doc;
  assert.equal(doc.closed, true, `control: the lap closes (${r.plan.report})`);
  const roll = doc.pieces.findIndex((P, k) => k >= n0 && P.channels.kh.every((v) => Math.abs(v) < 1e-9) && Math.abs(P.channels.phi[P.channels.phi.length - 1] - P.channels.phi[0]) > 0.1);
  assert.ok(roll >= n0, `control: the closer has a roll straight (${r.plan.report})`);
  const A = doc.pieces[roll - 1], B = doc.pieces[roll], s = Math.abs(startOf(B, 'phi').d2 - endOf(A, 'phi').d2);
  assert.ok(s <= TOL_D2, `${A.id}|${B.id}: the roll's second derivative steps by ${s.toFixed(4)} deg/m²; the bar is ${TOL_D2}`);
});

test("row 8: a ramp's shape is the C2 quintic's: a bank over 100 m within 1.5% of its change at every half metre, a right edge over 50 m within 3%", () => {
  const { smoother } = require(path.join(T, 'src/core/extend.js'));
  for (const [ch, target, L, bar] of [['phi', 30, 100, 0.015], ['er', 35, 50, 0.03]]) {
    const d = ramp(ch, ch === 'phi' ? target * DEG : target, L), P = d.pieces[1];
    let worst = 0, ws = 0; for (let s = 0; s <= L; s += 0.5) { const want = target * smoother(s / L), got = at(P, ch, s), e = Math.abs(got - want) / target; if (e > worst) { worst = e; ws = s; } }
    assert.ok(worst <= bar, `${ch} ${target}° over ${L} m: ${(100 * worst).toFixed(2)}% off the quintic at s ${ws} (the bar is ${100 * bar}%)`);
  }
});

/** the seeded sweep's laps (test/sweep_c2.test.js trackOf, seeds 10 and 16: the two whose whole-lap close moved an interior joint before 3c), their words copied */
const SWEEP10 = [{ length: 300, first: { e: 28 } }, { length: 243, transition: 40, targets: { kh: 0, phi: -0.011913 } }, { length: 75, transition: 40, targets: { kh: -0.001991, er: 33 } }, { length: 48, transition: 40, targets: { kh: 0.0017, phi: -0.134038, e: 11 } }, { length: 75, transition: 40, targets: { kh: -0.002896, kv: -0.000197, er: 28 } }, { length: 171, transition: 40, targets: { kh: 0.002472, er: 31 } }, { length: 206, transition: 40, targets: { kh: 0.001394, e: 3 } }, { length: 231, transition: 40, targets: { kh: -0.002542, kv: 0.000266, er: 15 } }];
const SWEEP16 = [{ length: 300, first: { e: 9 } }, { length: 41, transition: 40, targets: { kh: -0.003805, er: 16 } }, { length: 183, transition: 40, targets: { kh: -0.001596, phi: -0.29617, er: 11 } }, { length: 76, transition: 40, targets: { kh: 0 } }, { length: 146, transition: 40, targets: { kh: 0.002912 } }, { length: 197, transition: 40, targets: { kh: 0.001311 } }, { length: 112, transition: 40, targets: { kh: -0.002572, e: 0 } }, { length: 86, transition: 40, targets: { kh: 0, phi: -0.17314, er: 34 } }, { length: 79, transition: 40, targets: { kh: -0.002852, er: 20 } }];
const lay = (words) => words.reduce((d, w) => extend(d, w), D.createDoc('closure'));
test('row 9: the closure is C2: a whole-lap close and a local close leave no curvature step at the seam nor at any joint they moved', () => {
  const moved = (open, doc) => { const same = (A, B) => JSON.stringify(A) === JSON.stringify(B), n = doc.pieces.length; return Cn.c2Breaks(doc).filter((e) => e.k === n - 1 || !same(doc.pieces[e.k], open.pieces[e.k]) || !same(doc.pieces[e.k + 1], open.pieces[e.k + 1])); };
  for (const [name, words] of [['sweep seed 10', SWEEP10], ['sweep seed 16', SWEEP16]]) {
    const open = lay(words), c = close(open, { edited: [0] });
    assert.equal(c.converged, true, `control: ${name} closes whole-lap (${c.report})`);
    assert.deepEqual(moved(open, c.doc).map((e) => `${e.joint} ${e.ch} ${e.dkDeg.toFixed(4)} °/m²`), [], `${name}, closed whole-lap: the seam and every moved joint are C2`);
  }
  // a LOCAL close of the last two pieces: core_close_banks_lap's square (four 100 m straights and 90° turns at R 300 m, so it nearly meets its start), a 12° bank
  // ramped on the third straight and back on the fourth
  const Q = (Math.PI * 300) / 2; let d = extend(D.createDoc('local'), { length: 100, family: 'bowl' }); d = extendTurnBy(d, { length: Q }, 90 * DEG); d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: Q }, 90 * DEG);
  d = extend(d, { length: 100, targets: { phi: 12 * DEG } }); d = extendTurnBy(d, { length: Q }, 90 * DEG); d = extend(d, { length: 100, targets: { phi: 0 } }); d = extendTurnBy(d, { length: Q }, 90 * DEG);
  const c = close(d, { window: [d.pieces.length - 1, d.pieces.length - 2] });
  assert.equal(c.converged, true, `control: the local close closes (${c.report})`);
  assert.deepEqual(moved(d, c.doc).map((e) => `${e.joint} ${e.ch} ${e.dkDeg.toFixed(4)} °/m²`), [], "closed locally: the seam and the window's joints are C2");
});

// D468 (P): THE BANK PLAN IS C2. 3c accepted Finish's edges-only exemption for 0.4.20, so Finish's added bank still stepped in curvature at its joints: by exactly
// BANK_ACCEL (0.0115 °/m²) at the closer's first joint and the seam of every Finish measured (seven laps, his two among them) and at every relaxed joint of a lap
// bankLap banks. finish.js bankPlan now projects onto a curvature-equality row per joint in its own sweeps (0 curvature where the plan meets road outside it).
/** core_finish_bank.test.js's pLap: a cup laid at 10°, a turn of turnDeg over 1,500 m, then a tail rolling rollDeg and cupping to 35° */
function pLap(turnDeg, tailM, rollDeg) {
  let d = D.createDoc(`P ${turnDeg}/${tailM}/${rollDeg}`); d = extend(d, { length: 1000, family: 'bowl', first: { c: 10 } }); d = extendTurnBy(d, { length: 1500, targets: { kv: 0 } }, (turnDeg * Math.PI) / 180);
  return extend(d, { length: tailM, targets: { c: 35, phi: (rollDeg * Math.PI) / 180 } });
}
test("row 10: through Finish and through bankLap, the added bank is C2: the bank's second derivative steps at no joint from the closer's first to the seam, and at no joint of a banked lap", () => {
  const bad = [];
  for (const [what, open] of [['rolled cup', rolledCup()], ['P 210/300/30', pLap(210, 300, 30)]]) {
    const n0 = open.pieces.length, r = F.finishToStart(open), doc = r.doc;
    assert.equal(doc.closed, true, `control: ${what} closes (${r.plan.report})`);
    const steps = Cn.jointSteps(doc, { channels: ['phi'] }).filter((e) => e.k >= n0 - 1), ids = steps.map((e) => e.joint);
    assert.ok(steps.length >= 3 && ids[ids.length - 1].endsWith('|' + doc.pieces[0].id), `control: ${what}: the closer's joints and the seam are read (${ids.join(' ')})`);
    for (const e of steps) if (Math.abs(e.dkDeg) > Cn.TOL_K) bad.push(`${what} ${e.joint}: phi'' steps by ${e.dkDeg.toFixed(4)} °/m²`);
  }
  // a closed lap of upright curves banked whole (core_close_banks_lap's lap, closed by Close, which banks it; bankLapWith again on top adds nothing)
  const Q = (Math.PI * 300) / 2; let l = D.createDoc('lap');
  l = extend(l, { length: 100, family: 'bowl' }); l = extendTurnBy(l, { length: Q }, 90 * DEG); l = extend(l, { length: 100 }); l = extend(l, { length: Q / 2, targets: { kh: 1 / 300 } }); l = extendTurnBy(l, { length: Q / 2 }, 67.5 * DEG);
  l = extend(l, { length: 100, targets: { phi: -20 * DEG } }); l = extendTurnBy(l, { length: Q }, 90 * DEG); l = extend(l, { length: 100, targets: { phi: 0 } }); l = extendTurnBy(l, { length: Q }, 90 * DEG);
  // closed as the press's "last" route does (a local close of the last piece; app/core/closejob.js is not here: the ramp harness copies src/ and tools/ only), then banked as Close banks it
  const c = close(l, { window: [l.pieces.length - 1] }); assert.equal(c.converged, true, `control: the lap closes (${c.report})`);
  const b = F.bankLapWith(c.doc), steps = Cn.jointSteps(b.doc, { channels: ['phi'] });
  assert.ok(steps.length === 9 && b.doc.pieces.some((P, k) => k > 0 && P.channels.phi.some((x) => Math.abs(x) > 1 * DEG) && !l.pieces[k].channels.phi.some((x) => Math.abs(x) > 1 * DEG)), 'control: nine joints read, and a curve laid flat carries a bank');
  for (const e of steps) if (Math.abs(e.dkDeg) > Cn.TOL_K) bad.push(`the banked lap ${e.joint}: phi'' steps by ${e.dkDeg.toFixed(4)} °/m²`);
  assert.deepEqual(bad, [], `the added bank is C2 at every joint (bar ${Cn.TOL_K} °/m²)`);
});
