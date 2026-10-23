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

test('row 6: the bank lands in Close\'s one undo step', async () => {
  const { createCoreShell } = require('../app/core/coreshell.js');
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }), open = lap();
  s.adopt(open); const base = s.getState().history.present;
  await s.closeBest();
  const st = s.getState(); assert.equal(st.history.present.closed, true, st.message);
  leansIn({ converged: true, doc: st.history.present, report: st.message }, open, 'the shell');
  s.undo(); assert.equal(s.getState().history.present, base, 'one undo gives back the open lap');
});
