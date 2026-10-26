// core_close_banks_lap.test.js: node --test test/core_close_banks_lap.test.js
// D447 (the user, 2026-10-23 11:59: "closing a loop should bank"; 09:48: "all closed loops after if the turns and curves need to be banked, so its not just
// fixing the one section of the track itself, it is the closed loop generator gaining the nuance and understanding"; plan_d447). Close (the page's one press,
// app/core/closejob.js runCloseBest) banks EVERY upright curve of the closed lap by finish.js bankLap, not only the road Finish adds. GEOMETRY tier.
// The lap (no private file): four corners of a 100 m straight and a 90° left turn at R 300 m, so it nearly meets its start; corner 2 laid as two pieces that turn through their joint (the first eases INTO the curve and ends still turning at R 300 m, the second turns the rest);
// corner 3 banked by hand into its turn (a straight rolling to −20°, the turn held there, a straight rolling back). The lean is core_finish_bank's, against the
// horizontal turn (D443), at every curved station (|κh| > 1/600 m). Rows:
//   1  every curved station of every upright curve leans INTO its turn, by more than MIN_LEAN, and each curve's mean lean is at least MEAN_LEAN (red before:
//      only Finish's road was banked, so these read 0.0°)
//   2  the corner banked by hand comes out with its bank channel byte for byte, and the joints into and out of it meet his bank
//   3  a curve laid as two pieces banks as one: across their joint the lean stays at the curve's (D447 (d): the joint is not pinned)
//   4  the NEAR path (an end already at the start, which today banked nothing): the same lap reopened at its seam closes banked
//   5  the road a pit lane runs beside is not banked
//   6  the bank lands in Close's ONE undo step: one undo gives back the open lap
//   7  a LOOP is not banked, even one that turns (finish.js bankLap, called on a lap closed by close(): this loop is not a lap the press proves at speed): its
//      bank channel comes out byte for byte; a level curve on the same lap is banked. (TEST TRACK 10's copy has a loop whose exit stores a bank of 0 while
//      turning at a pitch of −90° to −15°: before the level rule it was banked by 54°)
//   8  a TUBE is not banked (bankLap on a lap closed by close(): a lap through a tube corner the press does not prove at speed): every tube piece keeps its
//      bank channel byte for byte; a level curve before it is banked
//   9  a straight next to a curve keeps the bank it was laid with (its joints stay pinned, D447 (d)): on the lap of row 1, its two straights byte for byte
//  10  P's review of D447, finding 1 (lighthouse 5596ecd0; plan_d447 "P's D447 review ruled"): a turn that FLIPS faster than the bank can roll. P's lap
//      (probe447c.js): a left turn that ends still turning (extend to kh +1/300), then a Sharp corner turning right (sharp.js, ramps of 4 m): the turn rate goes
//      +1/300 → −1/150 in 4 m. Before, the bank lagged the flip, 43 stations leaned out to −58°, and the backstop landed the WHOLE lap flat with no word. Now:
//      the press proves; no curved station leans out by more than 5°; every curve of HIS (Finish's own closer has its own rows) leans in by at least MEAN_LEAN
//      on average outside FLIP_ZONE of the flip (2 × the distance the bank needs to roll the share at R 300 at BANK_ROLL × the amber; a flip is a change of
//      direction within one turning stretch, not across a straight); and the press's report says where the bank was eased for the flip
//  11  the same on P's s5 (probe447b.js): extend's 20 m transition from kh +1/300 to −1/300 inside one piece
//  12  P's re-read (lighthouse 75fa8491, §6.3; plan_d447 "P's re-read ruled" (a)): the flip as a SWEEP, through the press (probe447f.js's laps): transitions of
//      40, 50, 60, 70, 80 and 100 m, Sharp ramps of 40 and 100 m, and e60 / e80 (Extend's default blend: a short piece turning the other way is a flip over its
//      whole length). On every one, rows 10–11's bars and NO PIECE WITHHELD (before, a flip with one dead-band point between its signs was not seen, and the
//      whole 300 m turn after it was withheld flat)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const AD = require('../src/core/adapter.js');
const { extend } = require('../src/core/extend.js');
const { extendTurnBy } = require('../src/core/turnby.js');
const CJ = require('../app/core/closejob.js');

const DEG = Math.PI / 180, Q = (300 * Math.PI) / 2, MIN_LEAN = 0, MEAN_LEAN = 30;
function lap() {
  let d = D.createDoc('lap');
  d = extend(d, { length: 100, family: 'bowl' }); d = extendTurnBy(d, { length: Q }, 90 * DEG);
  d = extend(d, { length: 100 }); d = extend(d, { length: Q / 2, targets: { kh: 1 / 300 } }); d = extendTurnBy(d, { length: Q / 2 }, 67.5 * DEG);
  d = extend(d, { length: 100, targets: { phi: -20 * DEG } }); d = extendTurnBy(d, { length: Q }, 90 * DEG);
  d = extend(d, { length: 100, targets: { phi: 0 } }); d = extendTurnBy(d, { length: Q }, 90 * DEG);
  return d;
}
const HAND = [5, 6, 7], SPLIT = 4;   // corner 3's three pieces; corner 2's second piece (its joint with the first)
/** Per piece id, every curved station's lean into its turn (degrees, against the horizontal turn), and its s from the piece's start. */
function leans(doc) {
  const { segments, path } = AD.toPath(doc, { step: 2 }), s0 = {}, out = new Map();
  { let a = 0; for (const P of doc.pieces) { s0[P.id] = a; a += P.length; } }
  for (const q of path.samples) {
    const g = segments[q.seg], k = q.kvec, kh = Math.hypot(k[0], k[2]); if (g.kind === 'gap' || kh < 1 / 600) continue;
    if (!out.has(g.id)) out.set(g.id, []);
    out.get(g.id).push({ s: q.s - s0[g.id], lean: Math.asin(Math.max(-1, Math.min(1, (q.U[0] * k[0] + q.U[2] * k[2]) / kh))) / DEG });
  }
  return out;
}
let CLOSED = null;
const closed = () => (CLOSED = CLOSED || CJ.runCloseBest({ doc: lap() }));
const upright = (open) => open.pieces.map((P, i) => i).filter((i) => open.pieces[i].type === 'road' && open.pieces[i].channels.phi.every((x) => Math.abs(x) <= 5 * DEG));
function leansIn(r, open, what) {
  assert.equal(r.converged, true, `${what}: ${r.report}`);
  const L = leans(r.doc);
  for (const i of upright(open)) {
    const P = r.doc.pieces[i], xs = L.get(P.id) || []; if (!xs.length) continue;
    const low = xs.reduce((m, x) => (x.lean < m.lean ? x : m)), mean = xs.reduce((a, x) => a + x.lean, 0) / xs.length;
    assert.ok(low.lean > MIN_LEAN, `${what}: ${P.id} leans into its turn at every curved station (least ${low.lean.toFixed(1)}° at +${low.s.toFixed(0)} m)`);
    assert.ok(mean >= MEAN_LEAN, `${what}: ${P.id}'s mean lean into its turn is ${mean.toFixed(1)}°`);
  }
}

test('row 1: Close banks every upright curve of the closed lap into its turn, not only the road Finish adds', () => leansIn(closed(), lap(), 'the lap'));

test('row 2: a curve he banked himself keeps its bank byte for byte, and the joints into it meet his bank', () => {
  const r = closed(), open = lap();
  assert.equal(r.converged, true, r.report);
  for (const i of HAND) assert.deepEqual(r.doc.pieces[i].channels.phi, open.pieces[i].channels.phi, `${open.pieces[i].id}'s bank channel`);
  const end = (P) => D.valuesAt(P, P.length).phi, start = (P) => D.valuesAt(P, 0).phi;
  assert.equal(end(r.doc.pieces[HAND[0] - 1]), start(open.pieces[HAND[0]]), 'the joint into it meets his bank');
  assert.equal(start(r.doc.pieces[HAND[2] + 1]), end(open.pieces[HAND[2]]), 'the joint out of it meets his bank');
});

test('row 3: a curve laid as two pieces banks as one: the lean holds across their joint', () => {
  const r = closed(); assert.equal(r.converged, true, r.report);
  const L = leans(r.doc), a = L.get(r.doc.pieces[SPLIT - 1].id), b = L.get(r.doc.pieces[SPLIT].id), A = r.doc.pieces[SPLIT - 1];
  const near = [...a.filter((x) => x.s > A.length - 20), ...b.filter((x) => x.s < 20)];
  assert.ok(near.length > 5, 'control: stations either side of the joint');
  const low = Math.min(...near.map((x) => x.lean));
  assert.ok(low >= MEAN_LEAN, `within 20 m of the joint the lean into the turn is at least ${MEAN_LEAN}° (least ${low.toFixed(1)}°)`);
});

test('row 4: the near path (an end already at the start) closes banked', () => {
  const c = closed(); assert.equal(c.converged, true, c.report);
  const open = D.checkDoc({ ...lap(), pieces: c.doc.pieces.map((P, i) => (HAND.includes(i) ? P : { ...P, channels: { ...P.channels, phi: lap().pieces[i].channels.phi } })), closed: false });
  const r = CJ.runCloseBest({ doc: open });
  assert.equal(r.route, 'near', `the near path: ${r.report}`);
  leansIn(r, open, 'the near path');
});

test('row 5: the road a pit lane runs beside is not banked', () => {
  const PL = require('../src/doc/pitlane.js'), open0 = lap(), open = D.setPitLane(open0, { ...PL.DEFAULTS, side: 'R', leave: { word: open0.pieces[0].id, along: 10 }, rejoin: { word: open0.pieces[1].id, along: 300 }, boxes: 2, boxSpacingM: 10 });
  const r = CJ.runCloseBest({ doc: open }); assert.equal(r.converged, true, r.report);
  for (const i of [0, 1]) assert.deepEqual(r.doc.pieces[i].channels.phi, open.pieces[i].channels.phi, `${open.pieces[i].id}, beside the pit lane, keeps its bank`);
  assert.ok(r.doc.pieces[8].channels.phi.some((x, j) => x !== open.pieces[8].channels.phi[j]), 'control: a curve away from the lane is banked');
});

test('row 7: a loop is not banked, even one that turns; a level curve on the same lap is', () => {
  const F = require('../src/core/finish.js'), { close } = require('../src/core/close.js'), { extendTurnBy: turn } = require('../src/core/turnby.js');
  let d = D.createDoc('looped'); d = extend(d, { length: 100, family: 'bowl' }); d = turn(d, { length: Q }, 90 * DEG); d = extend(d, { length: 100 });
  d = turn(d, { length: 700, climbDeg: 360 }, 30 * DEG); d = extend(d, { length: 100 }); d = turn(d, { length: Q }, 60 * DEG); d = extend(d, { length: 200 });
  d = turn(d, { length: Q }, 90 * DEG); d = extend(d, { length: 100 }); d = turn(d, { length: Q }, 90 * DEG);
  const c = close(d, { edited: [d.pieces.length - 1] }); assert.equal(c.converged, true, c.report);
  const LOOP = 3; assert.ok(c.doc.pieces[LOOP].channels.kh.some((k) => Math.abs(k) > 1 / 600), 'control: the loop turns');
  const w = F.bankLapWith(c.doc), b = w.doc;
  assert.deepEqual(b.pieces[LOOP].channels.phi, c.doc.pieces[LOOP].channels.phi, 'the loop keeps its bank channel byte for byte');
  // the LEVEL rule keeps it out, not the per-piece withhold (finding 1): a loop banked and then withheld for leaning out would also come out byte-equal
  assert.ok(!w.withheld.includes(c.doc.pieces[LOOP].id), `the loop was never banked (withheld: ${w.withheld.join(', ') || 'none'})`);
  assert.ok(b.pieces[1].channels.phi.some((x, j) => Math.abs(x - c.doc.pieces[1].channels.phi[j]) > 30 * DEG), 'control: the level curve before it is banked');
});

test('row 8: a tube is not banked; a level curve on the same lap is', () => {
  const F = require('../src/core/finish.js'), { close } = require('../src/core/close.js');
  let d = D.createDoc('tubed'); d = extend(d, { length: 100, family: 'bowl' }); d = extendTurnBy(d, { length: Q }, 90 * DEG); d = extend(d, { length: 100 });
  d = extend(d, { length: Q / 2, targets: { kh: 1 / 300 } }); d = extendTurnBy(d, { length: Q / 2 }, 67.5 * DEG);
  d = extend(d, { length: 100, targets: { t: 240 } }); d = extendTurnBy(d, { length: Q }, 90 * DEG); d = extend(d, { length: 200, targets: { c: 10 } }); d = extendTurnBy(d, { length: Q }, 90 * DEG);
  const c = close(d, { edited: [d.pieces.length - 1] }); assert.equal(c.converged, true, c.report);
  const tubes = c.doc.pieces.map((P, i) => i).filter((i) => c.doc.pieces[i].tube); assert.ok(tubes.some((i) => c.doc.pieces[i].channels.kh.some((k) => Math.abs(k) > 1 / 600)), 'control: a tube that turns');
  const b = F.bankLap(c.doc);
  for (const i of tubes) assert.deepEqual(b.pieces[i].channels.phi, c.doc.pieces[i].channels.phi, `${c.doc.pieces[i].id}, a tube, keeps its bank channel`);
  assert.ok(b.pieces[1].channels.phi.some((x, j) => Math.abs(x - c.doc.pieces[1].channels.phi[j]) > 30 * DEG), 'control: the level curve before it is banked');
});

// AMENDED by D468 (P; the bank plan is C2, finish.js bankPlan's curvature rows): a straight next to a curve keeps the bank it was laid with but for the TAIL of the
// curve's roll-off on its third control point from the joint (about 1.5°, the bank's smooth end over the straight's first span: a turn's bank ramps from its third
// point, and the joint is C2 only if the straight's third point carries that curvature or the turn's is 0 too, which reached every corner's exit a knot later,
// 24.4° against D447 §10's 32.5°). The joint itself (the first two points) and every other point are byte for byte as laid.
const TAIL_DEG = 2;
test('row 9: a straight next to a curve keeps the bank it was laid with, but for the tail of the roll-off on its third point from the joint (D468)', () => {
  const r = closed(), open = lap(); assert.equal(r.converged, true, r.report);
  for (const i of [0, 2]) {
    const got = r.doc.pieces[i].channels.phi, was = open.pieces[i].channels.phi, n = got.length;
    got.forEach((x, k) => { if (k === 2 || k === n - 3) assert.ok(Math.abs(x - was[k]) < TAIL_DEG * DEG, `${open.pieces[i].id} point ${k}: the roll-off's tail, ${((x - was[k]) / DEG).toFixed(2)}°, within ${TAIL_DEG}°`); else assert.equal(x, was[k], `${open.pieces[i].id} point ${k}, a straight between curves, as laid`); });
  }
});

const ROLL_DEG_M = 0.9 * require('../src/validate/index.js').ROLL_AMBER_DEG_M, SHARE_R300 = 0.75 * Math.atan(((460 / 3.6) ** 2 / 300) / 9.80665) / DEG;
const FLIP_ZONE = 2 * (SHARE_R300 / ROLL_DEG_M);
/** The lap's flips, as stretches [s0, s1] (m): finish.js flipsOf, the same function bankPlan pins by, so the rows and the plan cannot disagree (P's re-read). */
const flips = (doc) => require('../src/core/finish.js').flipsOf(doc);
const nearFlip = (s, fl) => fl.some(([a, b]) => s > a - FLIP_ZONE && s < b + FLIP_ZONE);
function flipLap(open, what, { flip = true } = {}) {
  const r = CJ.runCloseBest({ doc: open });
  assert.equal(r.converged, true, `${what}: the press proves (${r.report})`);
  const fl = flips(r.doc); if (flip) assert.ok(fl.length > 0, `control, ${what}: the closed lap has a flip`);
  const { segments, path } = AD.toPath(r.doc, { step: 2 }), his = new Set(open.pieces.map((P) => P.id)), runs = []; let out = 0, worst = 90, run = null;
  for (const q of path.samples) {
    const g = segments[q.seg], k = q.kvec, kh = Math.hypot(k[0], k[2]);
    if (g.kind === 'gap' || kh < 1 / 600) { run = null; continue; }
    const l = Math.asin(Math.max(-1, Math.min(1, (q.U[0] * k[0] + q.U[2] * k[2]) / kh))) / DEG; if (l < -5) out++; worst = Math.min(worst, l);
    // THE CURVED RUN (P's second re-read, ruled item 4): consecutive curved stations turning one way, whatever pieces they are laid in; the bar is on the run
    const side = Math.sign(q.T[2] * k[0] - q.T[0] * k[2]);
    if (!run || run.side !== side || q.s - run.last > 4) { run = { side, first: q.s, last: q.s, xs: [], all: [] }; runs.push(run); }
    run.last = q.s; run.lastId = g.id; run.all.push(l);
    // on HIS pieces: Finish's own closer is banked by D434's rule (core_finish_bank), pinned at its joints and the seam
    if (his.has(g.id) && !nearFlip(q.s, fl)) run.xs.push(l);
  }
  // D447 §10 (P's third re-read, ruled item 3): A MISSING BANK. Each curved run's EXIT, its last curved station, no more than 5° under the table taken at
  // 2c13316, where the exits were right ("none leans out" and the mean bar away from a flip cannot see a corner rolled to none at its exit: 05cdb9d read −0.4° on
  // every short transition's exit, where 2c13316 read 50–54°). Two kinds of entry are not 2c13316's: null, a run 2c13316 withheld flat (x58, x60, the R 1,200 and
  // 3,000 links), held to EXIT_BANKED; 'eased', the first corner of x58–x72, whose flip the ruled bound (about 67 m) now pins where 2c13316's 60 m did not (its
  // second corner came within 0.3° of leaning out there), so its exit eases to none by design and carries no exit bar. One-sided: a run banked MORE than at
  // 2c13316 is not a missing bank (the links' first corner, 49° against 39–41°, where 2c13316 withheld the next corner)
  const want = EXITS[what];
  if (want) { const got = runs.map((x) => x.all[x.all.length - 1]); assert.equal(got.length, want.length, `${what}: ${want.length} curved runs as at 2c13316, not ${got.length}`);
    got.forEach((e, i) => { if (want[i] === 'eased') return; if (want[i] === null) assert.ok(e >= EXIT_BANKED, `${what}: run ${i} (${runs[i].first.toFixed(0)}–${runs[i].last.toFixed(0)} m) leaves its turn banked: exit ${e.toFixed(1)}°, want ≥ ${EXIT_BANKED}°`);
      else assert.ok(e >= want[i] - 5, `${what}: run ${i} (${runs[i].first.toFixed(0)}–${runs[i].last.toFixed(0)} m) exits at ${e.toFixed(1)}°, 2c13316 ${want[i]}°`); }); }
  assert.equal(out, 0, `${what}: no curved station leans out (worst ${worst.toFixed(1)}°)`);
  // the mean bar is on curved runs with at least FLIP_ZONE of curve OUTSIDE the flip zones: the bank needs about half of it to roll up and half to roll down
  // (to a straight's pin, which D447 (d) keeps), so a shorter stretch (a Sharp's arc and 40 m exit ramp, 30 m outside its flip zone) is held to "none leans out"
  // like every station; a curve withheld flat reads 0° on any run long enough to be judged
  for (const x of runs) if (2 * x.xs.length >= FLIP_ZONE) { const m = x.xs.reduce((a, b) => a + b, 0) / x.xs.length; assert.ok(m >= MEAN_LEAN, `${what}: the curve from ${x.first.toFixed(0)} to ${x.last.toFixed(0)} m leans in by ${m.toFixed(1)}° on average away from a flip`); }
  if (flip) assert.match(r.report, /bank/i, `${what}: the report says where the bank was eased or withheld: ${r.report}`);
  assert.doesNotMatch(r.report, /no bank on|no curve on the lap was banked/, `${what}: no piece is withheld: ${r.report}`);
  return { ...r, runs };
}
/** Each curved run's exit lean (°) on the press's lap of rows 10–14 at 2c13316, by the label each row passes (exits.js, D447 §10). */
const EXITS = {
  'the sharp after a turn': [32.5, 32.5, 0, 0.1, 32.5, 32.5, 1, 10.7],
  'the 20 m flip': [32.5, 32.5, -0.6, 50.9, 29.5, 36.9],
  'Sharp ramp 40 m': [32.1, 32.1, 0, 8.8, 32.1, 32.1, 1.9, 9.9],
  'Sharp ramp 100 m': [32.5, 32.5, 0, 26.8, 32.5, 32.5, 1.3, 7.1],
  'a 40 m transition': [32.5, 32.5, -0.6, 50.9, 31, 34],
  'a 50 m transition': [32.5, 32.5, -0.4, 50.9, 34, 32.5],
  'a 60 m transition': [32.5, 32.5, -0.3, 50.9, 34, 18.2],
  'a 70 m transition': [32.5, 32.5, 0.4, 50.9, 34, 9.5],
  'a 80 m transition': [32.5, 32.5, 0.2, 50.9, 33.9, 26.5],
  'a 100 m transition': [32.5, 32.5, 0, 50.9, 36.9, 23.6],
  'e60 (Extend\'s default blend over a 60 m piece)': [32.5, 32.5, -0.3, 50.9, 34, 18.2],
  'e80 (over an 80 m piece)': [32.5, 32.5, 0.2, 50.9, 33.9, 26.5],
  'a 40 m straight': [32.5, 32.5, -0.6, 50.9, 26.5, 38.4],
  'a 42 m straight': [32.5, 32.5, -0.3, 50.9, 26.5, 36.9],
  'a 44 m straight': [32.5, 32.5, -0.3, 50.9, 26.5, 36.9],
  'a 46 m straight': [32.5, 32.5, -0.4, 50.9, 26.5, 36.9],
  'a 48 m straight': [32.5, 32.5, -0.4, 50.9, 26.5, 36.9],
  'a 50 m straight': [32.5, 32.5, -0.4, 50.9, 26.5, 36.9],
  'a 52 m straight': [32.5, 32.5, -0.5, 50.9, 26.5, 36.9],
  'a 54 m straight': [32.5, 32.5, -0.5, 50.9, 26.5, 36.9],
  'a 56 m straight': [32.5, 32.5, -0.5, 50.9, 26.5, 36.9],
  'a 58 m straight': [32.5, 32.5, 'eased', null, 26.5, 36.9],
  'a 60 m straight': [32.5, 32.5, 'eased', null, 26.5, 36.9],
  'a 62 m straight': [32.5, 32.5, 'eased', 50.9, 26.5, 36.9],
  'a 64 m straight': [32.5, 32.5, 'eased', 50.9, 26.5, 36.9],
  'a 66 m straight': [32.5, 32.5, 'eased', 50.9, 26.5, 36.9],
  'a 68 m straight': [32.5, 32.5, 'eased', 50.9, 26.5, 38.4],
  'a 70 m straight': [32.5, 32.5, 'eased', 50.9, 26.5, 38.4],
  'a 72 m straight': [32.5, 32.5, 'eased', 50.9, 26.5, 38.4],
  'a 74 m straight': [32.5, 32.5, 51.6, 50.9, 25.1, 38.4],
  'a 76 m straight': [32.5, 32.5, 52.2, 50.9, 25.1, 38.4],
  'a 78 m straight': [32.5, 32.5, 52.4, 50.9, 25.1, 38.4],
  'a 80 m straight': [32.5, 32.5, 52.6, 50.9, 25.1, 38.4],
  'a 82 m straight': [32.5, 32.5, 49.8, 50.9, 25.1, 38.4],
  'a 84 m straight': [32.5, 32.5, 49.8, 50.9, 25.1, 38.4],
  'a 86 m straight': [32.5, 32.5, 49.7, 50.9, 25.1, 38.4],
  'a 88 m straight': [32.5, 32.5, 49.6, 50.9, 25.1, 38.4],
  'a 90 m straight': [32.5, 32.5, 50, 50.9, 25.1, 38.4],
  'a 92 m straight': [32.5, 32.5, 50.7, 50.9, 25.1, 38.4],
  'a 94 m straight': [32.5, 32.5, 51.1, 50.9, 25.1, 38.4],
  'a 96 m straight': [32.5, 32.5, 51.6, 50.9, 25.1, 38.4],
  'a 98 m straight': [32.5, 32.5, 52, 50.9, 25.1, 38.4],
  'a 100 m straight': [32.5, 32.5, 52.2, 50.9, 25.1, 38.4],
  'a 102 m straight': [32.5, 32.5, 49.3, 50.9, 25.1, 38.3],
  'a 104 m straight': [32.5, 32.5, 49.3, 50.9, 25.1, 38.3],
  'a 106 m straight': [32.5, 32.5, 49.3, 50.9, 25.1, 38.3],
  'a 108 m straight': [32.5, 32.5, 49.5, 50.9, 23.6, 38.3],
  'a 110 m straight': [32.5, 32.5, 50.1, 50.9, 23.6, 38.3],
  'a 112 m straight': [32.5, 32.5, 50.7, 50.9, 23.6, 38.3],
  'a 114 m straight': [32.5, 32.5, 51.2, 50.9, 23.6, 38.3],
  'a 116 m straight': [32.5, 32.5, 51.7, 50.9, 23.6, 38.3],
  'a 118 m straight': [32.5, 32.5, 52, 50.9, 23.6, 38.3],
  'a 120 m straight': [32.5, 32.5, 52.2, 50.9, 23.6, 38.3],
  'a link at R 1200': [32.5, 32.5, 39.2, null, 28, 35.5],
  'a link at R 3000': [32.5, 32.5, 40.8, null, 28, 38.3],
  'a link at R 10000': [32.5, 32.5, 52.5, 50.9, 26.5, 39.7],
};
const EXIT_BANKED = 45;
const T90 = (d) => extendTurnBy(d, { length: Q }, 90 * DEG), S = (d, L) => extend(d, { length: L });
test('row 10: a Sharp corner right after a turn that ends still turning: the curves stay banked, none leans out, and the report says where the bank eased', () => {
  const { extendSharp } = require('../src/core/sharp.js');
  let d = D.createDoc('probe'); d = extend(d, { length: 100, family: 'bowl' }); d = T90(d); d = S(d, 700); d = T90(d); d = S(d, 100);
  d = extend(d, { length: 300, targets: { kh: 1 / 300 } }); d = extendSharp(d, {}, { angle: -60 * DEG, R: 150, ramp: 4 }); d = extend(d, { length: 150 });
  d = S(d, 100); d = T90(d); d = S(d, 100); d = T90(d); d = S(d, 400);
  flipLap(d, 'the sharp after a turn');
});
test('row 11: a turn that flips over extend\'s 20 m transition: the same', () => {
  const lat = 240, adv = 560, b = 100, c = 100, e = 100, a = e + lat, f = b + c + adv - 100;
  let d = D.createDoc('probe'); d = extend(d, { length: 100, family: 'bowl' }); d = T90(d); d = S(d, a); d = T90(d); d = S(d, b);
  d = extend(d, { length: 300, targets: { kh: 1 / 300 }, transition: 20 }); d = extend(d, { length: 300, targets: { kh: -1 / 300 }, transition: 20 }); d = extend(d, { length: 150, targets: { kh: 0 }, transition: 20 });
  d = S(d, c); d = T90(d); d = S(d, e); d = T90(d); d = S(d, f);
  // D447 §10 (P's third re-read, item 3; P's s5): the second corner LEAVES its turn banked: its run's last curved station, on the exit piece, ≥ EXIT_BANKED
  // (2c13316 53.3° on the exit piece's mean; 05cdb9d −0.4°: the exit's ringing read as flips and pinned to none)
  const exit = d.pieces[7].id, run = flipLap(d, 'the 20 m flip').runs.find((x) => x.lastId === exit);
  assert.ok(run, `control: a curved run ends on the exit piece ${exit}`);
  assert.ok(run.all[run.all.length - 1] >= EXIT_BANKED, `the second corner leaves its turn at ${run.all[run.all.length - 1].toFixed(1)}°, want ≥ ${EXIT_BANKED}°`);
});

// lat: the 50 m transition's lap is laid 20 m wider (260): at P's 240 its Finish route crosses itself and the press proves no route, on e8e34d0 (no bankLap) too
const sweepRect = (mid, lat = 240) => { const adv = 560, b = 100, c = 100, e = 100, a = e + lat, f = b + c + adv - 100;
  let d = D.createDoc('probe'); d = extend(d, { length: 100, family: 'bowl' }); d = T90(d); d = S(d, a); d = T90(d); d = S(d, b); d = mid(d); d = S(d, c); d = T90(d); d = S(d, e); d = T90(d); return S(d, f); };
const sweepFlip = (tr) => (d) => { d = extend(d, { length: 300, targets: { kh: 1 / 300 }, transition: 20 }); d = extend(d, { length: 300, targets: { kh: -1 / 300 }, transition: tr }); return extend(d, { length: 150, targets: { kh: 0 }, transition: 20 }); };
const sweepE = (L) => (d) => { d = extend(d, { length: 300, targets: { kh: 1 / 300 }, transition: 20 }); d = extend(d, { length: L, targets: { kh: -1 / 300 } }); d = extend(d, { length: 300 - L, targets: { kh: -1 / 300 } }); return extend(d, { length: 150, targets: { kh: 0 }, transition: 20 }); };
const sweepSharp = (ramp) => { const { extendSharp } = require('../src/core/sharp.js');
  let d = D.createDoc('probe'); d = extend(d, { length: 100, family: 'bowl' }); d = T90(d); d = S(d, 700); d = T90(d); d = S(d, 100);
  d = extend(d, { length: 300, targets: { kh: 1 / 300 } }); d = extendSharp(d, {}, { angle: -60 * DEG, R: 150, ramp }); d = extend(d, { length: 150 });
  d = S(d, 100); d = T90(d); d = S(d, 100); d = T90(d); return S(d, 400); };
const SWEEP = [['Sharp ramp 40 m', () => sweepSharp(40)], ['Sharp ramp 100 m', () => sweepSharp(100)], ...[40, 50, 60, 70, 80, 100].map((tr) => [`a ${tr} m transition`, () => sweepRect(sweepFlip(tr), tr === 50 ? 260 : 240)]),
  ['e60 (Extend\'s default blend over a 60 m piece)', () => sweepRect(sweepE(60))], ['e80 (over an 80 m piece)', () => sweepRect(sweepE(80))]];
for (const [what, mk] of SWEEP) test(`row 12: a flip swept: ${what}: the curves stay banked, none leans out, no piece withheld`, () => {
  const r = flipLap(mk(), what);
  assert.doesNotMatch(r.report, /no bank on/, `${what}: no piece is withheld: ${r.report}`);
});

// P's second re-read (lighthouse 8a06de5c §7.5; plan_d447 "P's second re-read ruled"): a TRUE STRAIGHT between two opposite R 300 corners, swept 40–120 m every
// 2 m (at 2c13316, 58 and 60 m left the second corner withheld flat: the finder's fixed 60 m was not the bank's own roll-off distance); and a GENTLE LINK of
// 100 m at R 1,200, 3,000 and 10,000 between them (the finder called a link under 1/600 straight while the plan banked it, R 1,200 by 40°). Laps of P's probe447g.js.
// W1 (bankLap's per-piece withhold) is NOT reached by rows 13–15 at a838803: with the finder reading the bank's own roll-off distance, no lap of them leans out
// without it (d447-mutants.js W1 survives every row; at 2c13316 it rescued the 58 and 60 m straights and the R 1,200 and 3,000 links by withholding a corner)
const between = (mid) => (d) => { d = extend(d, { length: 300, targets: { kh: 1 / 300 }, transition: 20 }); d = mid(d); d = extend(d, { length: 300, targets: { kh: -1 / 300 }, transition: 20 }); return extend(d, { length: 150, targets: { kh: 0 }, transition: 20 }); };
for (let Sm = 40; Sm <= 120; Sm += 2) test(`row 13: a straight of ${Sm} m between opposite corners: none leans out, no corner withheld`, () => {
  flipLap(sweepRect(between((d) => extend(d, { length: Sm, targets: { kh: 0 }, transition: 20 }))), `a ${Sm} m straight`, { flip: false });
});
for (const R of [1200, 3000, 10000]) test(`row 14: a 100 m link at R ${R} between opposite corners: none leans out, no corner withheld`, () => {
  flipLap(sweepRect(between((d) => extend(d, { length: 100, targets: { kh: 1 / R }, transition: 20 })), 300), `a link at R ${R}`, { flip: false });
});
// ruled item 4: a long curve laid as SHORT pieces is held to the mean bar as one curve (the bar is on the run): corner 2 of row 1's lap as four pieces of 118 m
test('row 15: a 90° curve laid as four short pieces is banked as one curve, by the run', () => {
  let d = D.createDoc('lap'); d = extend(d, { length: 100, family: 'bowl' }); d = extendTurnBy(d, { length: Q }, 90 * DEG); d = extend(d, { length: 100 });
  for (let i = 0; i < 3; i++) d = extend(d, { length: Q / 4, targets: { kh: 1 / 300 }, transition: 20 });
  d = extendTurnBy(d, { length: Q / 4 }, 22.5 * DEG); d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: Q }, 90 * DEG); d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: Q }, 90 * DEG);
  assert.ok(d.pieces.slice(3, 7).every((P) => P.length < FLIP_ZONE), 'control: every piece of the curve is shorter than FLIP_ZONE');
  flipLap(d, 'the curve in four pieces', { flip: false });
});
// D447 §9 (O): HIS TEST 10's p21|p22 (his saved lap reopened): a curve that unwinds over a long run-out into a gentle opposite curve. The bank follows the share
// down the run-out, so it is not pinned to none there (at f2459fe the finder bounded the gap by the stretch's PEAK share and pinned it, changing his lap by 23°)
test('row 16: a curve unwinding over 250 m into a gentle opposite curve keeps its bank: no flip pin, none leans out', () => {
  const open = sweepRect((d) => { d = extend(d, { length: 200, targets: { kh: 1 / 1000 }, transition: 20 }); d = extend(d, { length: 300, targets: { kh: -1 / 5000 }, transition: 250 }); return extend(d, { length: 150, targets: { kh: 0 }, transition: 20 }); }, 300);
  const runOut = open.pieces[6].id, r = flipLap(open, 'a long run-out', { flip: false });
  assert.doesNotMatch(r.report, new RegExp(`eases to none[^;]*\\b${runOut}\\b`), `the run-out ${runOut} is not eased to none: ${r.report}`);
});
// D447 §10 (P's third re-read, item 3; P's short140): ONE R 300 curve of 140 m laid with a 20 m transition between two straights, no opposite corner anywhere.
// Its run banks ≥ 25° on average and leaves its turn ≥ EXIT_BANKED (2c13316 29.0° on the curve piece, 52.2° at its exit; 05cdb9d 8.4° and −0.4°)
test('row 17: a short curve between two straights is banked, and leaves its turn banked', () => {
  const open = sweepRect((d) => { d = extend(d, { length: 200, targets: { kh: 0 } }); d = extend(d, { length: 140, targets: { kh: 1 / 300 }, transition: 20 }); return extend(d, { length: 510, targets: { kh: 0 }, transition: 20 }); });
  const curve = open.pieces[6].id, exit = open.pieces[7].id, { runs } = flipLap(open, 'a short curve', { flip: false });
  const run = runs.find((x) => x.lastId === exit || x.lastId === curve); assert.ok(run, `control: a curved run ends on ${curve} or ${exit}`);
  const mean = run.all.reduce((a, b) => a + b, 0) / run.all.length, last = run.all[run.all.length - 1];
  assert.ok(mean >= 25, `the curve leans in by ${mean.toFixed(1)}° on average, want ≥ 25°`);
  assert.ok(last >= EXIT_BANKED, `the curve leaves its turn at ${last.toFixed(1)}°, want ≥ ${EXIT_BANKED}°`);
});
// D447 §10 (P's third re-read, item 2): THE BOUND'S EDGE, on close()'s lap (close() on the last piece, then bankLapWith, as P's probe): an 80 m straight and a
// 100 m link at R 10,000 between opposite R 300 corners, gaps just past the fall model's bound. Across a straight whose control points ring, the plan descends
// at about 0.5 °/m, not the cap's 0.84, so with the withhold removed the second corner leaned out 5.1° and 6.1° (P §8.7). bankLap reads its own descent there
// and pins the gap: nothing withheld, nothing leans out
for (const [what, mid, lat] of [['an 80 m straight', (d) => extend(d, { length: 80, targets: { kh: 0 }, transition: 20 }), 240], ['a link at R 10000', (d) => extend(d, { length: 100, targets: { kh: 1 / 10000 }, transition: 20 }), 300]])
  test(`row 18: ${what} between opposite corners, closed by close() and banked: nothing withheld, nothing leans out`, () => {
    const F = require('../src/core/finish.js'), { close } = require('../src/core/close.js'), open = sweepRect(between(mid), lat);
    const c = close(open, { edited: [open.pieces.length - 1] }); assert.equal(c.converged, true, c.report);
    const w = F.bankLapWith(c.doc); assert.deepEqual(w.withheld, [], `${what}: no piece withheld`); assert.equal(w.none, null, `${what}: ${w.none}`);
    const { segments, path } = AD.toPath(w.doc, { step: 2 }); let worst = 90;
    for (const q of path.samples) { const k = q.kvec, kh = Math.hypot(k[0], k[2]); if (segments[q.seg].kind === 'gap' || kh < 1 / 600) continue; worst = Math.min(worst, Math.asin(Math.max(-1, Math.min(1, (q.U[0] * k[0] + q.U[2] * k[2]) / kh))) / DEG); }
    assert.ok(worst >= -5, `${what}: no curved station leans out (worst ${worst.toFixed(1)}°)`);
  });
// D451 (P's pre-landing review §9.4, Q8): THE ROLL AMBER on a banked lap. Sharp ramp 40's first try rolls past the amber (0.966 °/m against 0.934) and the
// press keeps the second; no row read the roll, so a press that kept the first try (Q8) went unseen. The press's lap rolls, over his pieces, no faster than
// the amber or the open lap's own roll there, whichever is more (bankLap's `allowed`)
test('row 19: a banked lap rolls no faster than the amber over his pieces (Sharp ramp 40, whose first try does)', () => {
  const V = require('../src/validate/index.js'), open = sweepSharp(40), ids = new Set(open.pieces.map((P) => P.id));
  const rollPeak = (doc) => { const { segments, path } = AD.toPath(doc, { step: 2 }), S = path.samples;
    return V._internal.rollRates(S, (i) => segments[S[i].seg].kind !== 'gap', !!doc.closed, path.lengthM).reduce((m, q) => (ids.has(segments[S[q.i].seg].id) ? Math.max(m, q.rate) : m), 0); };
  const r = CJ.runCloseBest({ doc: open }); assert.equal(r.converged, true, r.report);
  assert.doesNotMatch(r.report, /no curve on the lap was banked/, `control: the lap is banked: ${r.report}`);
  const allowed = Math.max(V.ROLL_AMBER_DEG_M, rollPeak(open)), peak = rollPeak(r.doc);
  assert.ok(peak <= allowed + 1e-9, `the banked lap rolls at ${peak.toFixed(4)} °/m over his pieces, past ${allowed.toFixed(4)}`);
});

test('row 6: the bank lands in Close\'s one undo step', async () => {
  const { createCoreShell } = require('../app/core/coreshell.js');
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }), open = lap();
  s.adopt(open); const base = s.getState().history.present;
  await s.closeBest();
  const st = s.getState(); assert.equal(st.history.present.closed, true, st.message);
  leansIn({ converged: true, doc: st.history.present, report: st.message }, open, 'the shell');
  s.undo(); assert.equal(s.getState().history.present, base, 'one undo gives back the open lap');
});

// D468 follow-up (A's review §2b; the chair, 2026-10-26T05:02Z): WHEN THE PLAN REACHES ITS SWEEP BUDGET IT SAYS SO. On this lap at R 200 (tighter than any row above)
// the alternating projections stop at BANK_SWEEPS with the acceleration about 5% past BANK_ACCEL at one triple; at R 300 every plan converges. Reaching the budget
// used to be silent: the plan now carries it (plan.budget), bankLapWith hands it on, and the press's report (and Finish's) names it in user words.
function lapAt(R) {
  const QR = (Math.PI * R) / 2; let d = D.createDoc(`lap R ${R}`);
  d = extend(d, { length: 100, family: 'bowl' }); d = extendTurnBy(d, { length: QR }, 90 * DEG);
  d = extend(d, { length: 100 }); d = extend(d, { length: QR / 2, targets: { kh: 1 / R } }); d = extendTurnBy(d, { length: QR / 2 }, 67.5 * DEG);
  d = extend(d, { length: 100, targets: { phi: -20 * DEG } }); d = extendTurnBy(d, { length: QR }, 90 * DEG);
  d = extend(d, { length: 100, targets: { phi: 0 } }); d = extendTurnBy(d, { length: QR }, 90 * DEG);
  return d;
}
test('row 20: where the bank plan reaches its sweep budget the press says so in user words (this lap at R 200), and where every plan converges it says nothing (R 300)', () => {
  const { close } = require('../src/core/close.js'), F = require('../src/core/finish.js');
  for (const [R, expect] of [[200, true], [300, false]]) {
    const open = lapAt(R), r = CJ.runCloseBest({ doc: open }); assert.equal(r.converged, true, `R ${R}: ${r.report}`);
    const said = /smoothness limit/.test(r.report);
    assert.equal(said, expect, `R ${R}: the press's report ${expect ? 'names' : 'does not name'} the budget: ${r.report}`);
    if (expect) assert.match(r.report, /the bank on the lap stopped about \d+% past its smoothness limit at one point \(p\d+\)/, `R ${R}: the words: ${r.report}`);
    // and the plan itself, on the lap closed without the press (close() on its last piece), says the same through bankLapWith
    const c = close(open, { window: [open.pieces.length - 1] }); assert.equal(c.converged, true, `R ${R}: ${c.report}`);
    const b = F.bankLapWith(c.doc);
    assert.equal(!!b.budget, expect, `R ${R}: bankLapWith ${expect ? 'carries' : 'carries no'} budget: ${JSON.stringify(b.budget)}`);
    if (expect) assert.ok(b.budget.sweeps > 0 && b.budget.overPct > 0 && b.budget.overPct < 50 && typeof b.budget.at === 'string', `R ${R}: the budget names its sweeps, how far past the limit and where: ${JSON.stringify(b.budget)}`);
  }
});
