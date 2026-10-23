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
  const b = F.bankLap(c.doc);
  assert.deepEqual(b.pieces[LOOP].channels.phi, c.doc.pieces[LOOP].channels.phi, 'the loop keeps its bank channel byte for byte');
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

test('row 9: a straight next to a curve keeps the bank it was laid with', () => {
  const r = closed(), open = lap(); assert.equal(r.converged, true, r.report);
  for (const i of [0, 2]) assert.deepEqual(r.doc.pieces[i].channels.phi, open.pieces[i].channels.phi, `${open.pieces[i].id}, a straight between curves`);
});

const ROLL_DEG_M = 0.9 * require('../src/validate/index.js').ROLL_AMBER_DEG_M, SHARE_R300 = 0.75 * Math.atan(((460 / 3.6) ** 2 / 300) / 9.80665) / DEG;
const FLIP_ZONE = 2 * (SHARE_R300 / ROLL_DEG_M);
/** The lap's s (m) wherever the stored turn rate kh changes sign between two turning stations (|kh| > 1/600 m) no more than 30 m apart (not across a straight). */
function flips(doc) {
  const out = []; let s0 = 0, last = 0, lastS = -Infinity;
  for (const P of doc.pieces) { if (P.type === 'road') for (let s = 0; s <= P.length; s += 2) { const k = D.valuesAt(P, Math.min(s, P.length)).kh; if (Math.abs(k) > 1 / 600) { const sg = Math.sign(k); if (last && sg !== last && s0 + s - lastS <= 30) out.push(s0 + s); last = sg; lastS = s0 + s; } } s0 += P.length || 0; }
  return out;
}
function flipLap(open, what) {
  const r = CJ.runCloseBest({ doc: open });
  assert.equal(r.converged, true, `${what}: the press proves (${r.report})`);
  const fl = flips(r.doc); assert.ok(fl.length > 0, `control, ${what}: the closed lap has a flip`);
  const { segments, path } = AD.toPath(r.doc, { step: 2 }), per = new Map(), his = new Set(open.pieces.map((P) => P.id)); let out = 0, worst = 90;
  for (const q of path.samples) {
    const g = segments[q.seg], k = q.kvec, kh = Math.hypot(k[0], k[2]); if (g.kind === 'gap' || kh < 1 / 600) continue;
    const l = Math.asin(Math.max(-1, Math.min(1, (q.U[0] * k[0] + q.U[2] * k[2]) / kh))) / DEG; if (l < -5) out++; worst = Math.min(worst, l);
    // the bar on the curves is on HIS pieces: Finish's own closer is banked by D434's rule (core_finish_bank), pinned at its joints and the seam
    if (!his.has(g.id) || fl.some((f) => Math.abs(q.s - f) < FLIP_ZONE)) continue;
    if (!per.has(g.id)) per.set(g.id, []); per.get(g.id).push(l);
  }
  assert.equal(out, 0, `${what}: no curved station leans out (worst ${worst.toFixed(1)}°)`);
  for (const [id, xs] of per) if (xs.length >= 10) { const m = xs.reduce((a, b) => a + b, 0) / xs.length; assert.ok(m >= MEAN_LEAN, `${what}: ${id} away from the flip leans in by ${m.toFixed(1)}° on average`); }
  assert.match(r.report, /bank/i, `${what}: the report says where the bank was eased or withheld: ${r.report}`);
  return r;
}
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
  flipLap(d, 'the 20 m flip');
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
