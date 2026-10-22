// core_close_joint.test.js: node --test test/core_close_joint.test.js
// D431 (the user, 2026-10-22 09:17 and 09:49, TEST TRACK 10 and TEST 10: "towards the end there is a bump as the gen came out a bit higher than the end of the
// track was so it made a hump"; 09:20: "remember not to fix the track itself, but the close loop generation itself to be more accurate and smooth"). Finish to start
// lays a route and closes it with close.js's WINDOWED close; the climb and turn it must add came out of the window's control points unevenly: at each joint between
// the new pieces the turn and climb rates went one way and then the other within a knot or two (TEST TRACK 10's p42|p43 kh: -0.15, -11.81 | -23.54 against -6 to
// -7 either side; TEST 10's p22|p23 kv: 0.02, -0.58 | -0.58, -1.19 against -0.30). GEOMETRY tier.
//
// TWO BARS, in kh and kv (degrees per 100 m), at every joint between two pieces the finish laid and at the lap's seam (its last laid piece into the lap's first);
// the joint INTO the first laid piece is not read (the piece before it is the user's and the two points after it are linked to it: the close moves none of them):
//   THE JOINT BAR (registered before the fix): the three control points at the joint (the last two before it, the second after it; the first after IS the last
//   before) lie within the range of the four beyond them (two each side), give or take 0.05.
//   THE WIGGLE BAR (written after the first fix was measured, when a variant passed the joint bar with a zig-zag one knot inside the seam): within the six points
//   before the joint and the five after, no two OPPOSITE local extremes (a point beyond both its neighbours by more than 0.05) lie within two knots of each other.
//   A smooth correction may have one gentle peak near a joint; the defect is the road going one way and then the other within 40 m.
// Rows:
//   1  TEST TRACK 10's open lap (its undo history's newest open state; a private track, kept off the repository and skipped by name when absent): the finish
//      closes, nothing it did not lay moves, both bars hold
//   2  TEST 10's open lap (the same, private): the same
//   3  a lap built here that ends 212 m below its start, level (so the finish must climb): the same
//   4  a windowed close rolls the road as gently as the bank allows: core_close_local's lap with its start banked 57° closes in its last 200 m under the
//      roll-rate bar (it rolled 2.343°/m before D431 and was refused)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../src/core/document.js');
const C = require('../src/core/close.js');
const AD = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const { extend } = require('../src/core/extend.js');
const { extendTurnBy } = require('../src/core/turnby.js');
const { finishToStart, endPose } = require('../src/core/finish.js');

const BAR = 0.05;   // °/100 m
const per100 = (v) => (v * 100 * 180) / Math.PI;
/** Each closer joint, in kh and kv: between the pieces the finish laid (from index `from`, its first), and at the seam into the lap's first piece. */
function joints(doc, from) {
  const pairs = [];
  for (let j = from + 1; j < doc.pieces.length; j++) pairs.push([j - 1, j]);
  if (doc.closed) pairs.push([doc.pieces.length - 1, 0]);
  const out = [];
  for (const [i, j] of pairs) {
    const A = doc.pieces[i], B = doc.pieces[j];
    if (A.type !== 'road' || B.type !== 'road') continue;
    for (const ch of ['kh', 'kv']) {
      const a = A.channels[ch].map(per100), b = B.channels[ch].map(per100), n = a.length;
      const outer = [a[n - 4], a[n - 3], b[2], b[3]], inner = [a[n - 2], a[n - 1], b[1]], lo = Math.min(...outer), hi = Math.max(...outer);
      const over = Math.max(...inner.map((v) => (v < lo ? lo - v : v > hi ? v - hi : 0)));
      const S = [...a.slice(-6), ...b.slice(1, 6)], ext = [];   // the wiggle: opposite local extremes within two knots
      for (let k = 1; k + 1 < S.length; k++) { const up = S[k] - Math.max(S[k - 1], S[k + 1]), down = Math.min(S[k - 1], S[k + 1]) - S[k]; if (up > BAR) ext.push([k, 1]); else if (down > BAR) ext.push([k, -1]); }
      const wiggle = ext.some(([k, s]) => ext.some(([k2, s2]) => s2 === -s && Math.abs(k2 - k) <= 2));
      out.push({ joint: `${A.id}|${B.id}`, ch, over, wiggle, inner: inner.map((v) => +v.toFixed(2)), range: [+lo.toFixed(2), +hi.toFixed(2)], seq: S.map((v) => +v.toFixed(2)) });
    }
  }
  return out;
}
function finishes(open, what) {
  const r = finishToStart(open), n0 = open.pieces.length;
  assert.equal(r.doc.closed, true, `${what}: ${r.plan.report}`);
  open.pieces.forEach((P, i) => assert.equal(r.doc.pieces[i], P, `${what}: piece ${i} is the user's own, untouched`));
  const js = joints(r.doc, n0);
  assert.deepEqual(js.filter((x) => x.over > BAR).map((x) => `${x.joint} ${x.ch}: ${x.inner.join(', ')} against ${x.range.join(' to ')} (over by ${x.over.toFixed(2)})`), [], `${what}: the joint bar`);
  assert.deepEqual(js.filter((x) => x.wiggle).map((x) => `${x.joint} ${x.ch}: ${x.seq.join(', ')}`), [], `${what}: the wiggle bar`);
  return r;
}
const privateRow = (file, name) => (fs.existsSync(path.join(__dirname, '..', 'fixtures-d431', file)) ? false : `fixtures-d431/${file} is not here (${name}: a private track, kept off the repository)`);
const openOf = (file) => D.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures-d431', file), 'utf8'));

test('row 1: TEST TRACK 10 finishes with no bump or wiggle at its closer joints, and nothing it did not lay moves', { skip: privateRow('testtrack10-open.t180track', 'TEST TRACK 10') }, () => {
  finishes(openOf('testtrack10-open.t180track'), 'TEST TRACK 10');
});

test('row 2: TEST 10 finishes with no bump or wiggle at its closer joints, and nothing it did not lay moves', { skip: privateRow('test10-open.t180track', 'TEST 10') }, () => {
  const open = openOf('test10-open.t180track');
  assert.ok(endPose(open).y < -250, 'control: the open end is far below the start, so the finish must climb');
  finishes(open, 'TEST 10');
});

test('row 3: a lap that ends 212 m below its start, level, finishes with no bump or wiggle at its closer joints', () => {
  let d = D.createDoc('t');
  d = extend(d, { length: 500, family: 'bowl' });
  d = extend(d, { length: 600, transition: 60, targets: { kv: -0.0002 } });
  d = extend(d, { length: 600, transition: 60, targets: { kv: 0 } });
  d = extendTurnBy(d, { length: 900, targets: { kv: 0 } }, Math.PI);
  assert.ok(endPose(d).y < -200, 'control: the open end is far below the start');
  finishes(d, 'the 212 m climb');
});

test('row 4: a windowed close rolls the road as gently as the bank allows: a 57° start closes in the last 200 m under the roll-rate bar', () => {
  // core_close_local.test.js's lap, nearLap and bankedStart, verbatim (its row 4 used this 57° start for the refusal until D431)
  const R = 180, Q = (Math.PI * R) / 2;
  let lap = extend(D.createDoc('local'), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) lap = extend(lap, { length: Q, transition: 40, targets: { kh: 1 / R } });
  lap = extend(lap, { length: 200, transition: 40, targets: { kh: 0 } });
  const open = D.checkDoc({ ...C.close(lap, { edited: [0] }).doc, closed: false });
  const d = D.checkDoc({ ...open, pieces: open.pieces.map((P, k) => (k === 0 ? { ...P, channels: { ...P.channels, phi: P.channels.phi.map((v, i) => (i <= 2 ? 1.0 : i >= 8 ? 0 : (1.0 * (8 - i)) / 6)) } } : P)) });
  const r = C.close(d, { window: C.closeWindow(d, { last: true }) });
  assert.equal(r.converged, true, r.report);
  const { path: p } = AD.toPath(r.doc);
  let worst = 0; for (const q of V._internal.rollRates(p.samples, () => true, true, p.lengthM)) if (q.s >= r.window.fromS - 1e-9) worst = Math.max(worst, q.rate);
  assert.ok(worst < V.ROLL_RED_DEG_M, `the window rolls ${worst.toFixed(3)}°/m at worst, under the ${V.ROLL_RED_DEG_M}°/m bar`);
});
