// core_finish_joints.test.js: node --test test/core_finish_joints.test.js
// D438 (the user, 2026-10-22 21:33, TEST TRACK 10: "where the pieces connect there is too big of a bump, then how the banking and cupping connects to the end
// of the track doesnt work right"). Measured (exo_memory/handback/p-d438-O_2026-10-22.md, P's kstep436.js at 300 km/h): D434's bank stepped under the outer wheels
// at the closer's joints, 95.9 °/100 m at p41|p42 against 24.3 at the worst of his own 39 joints; and every closer pulled his 37.3° cup to p1's 10° in the last
// 30–40 m before the start line, where his own road never changes its cup faster than 0.021 °/m. The ruling (plan_d438 "Part 2 ruled"): every closer joint and the
// seam within his own joints' 90th percentile, 21.7 °/100 m at u ±8.4; the cup eased home over the closer's whole length at no more than 0.021 °/m. GEOMETRY tier.
//
// THE STEP (kstep436.js's measure, its code ported here and run only near each joint): the road surface line at lateral u (0, +8.4, −8.4) from the core's path at
// 0.5 m and the profile there; its vertical curvature by second differences over 2 m along the sample's up vector; and the change of that curvature over 2 m. At a
// joint, the largest |change| within 5 m of it, in °/100 m. Rows:
//   1  TEST TRACK 10 (its open lap; a private track kept off the repository, skipped by name when absent): every joint of the closer and the seam ≤ 21.7 at u ±8.4
//   2  TEST 10 (the same, private): the same
//   3  TEST TRACK 10: the closer's cup changes no faster than 0.021 °/m anywhere, and meets p1's cup at the seam
//   4  TEST 10: the same
//   5  a track built here (public, so the rows run without the private fixtures, and the mutation harnesses can name them): a cup laid at 10°, a half turn, then
//      300 m rolling 40° and cupping to 35°; its closer rolls upright first, banks its turns, and brings the cup home: rows 1 and 3's bars on it
// "Every closer joint" includes its first, where the closer meets the user's own last piece (TEST TRACK 10's p40|p41: Finish's roll straight starting).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { extendTurnBy } = require('../src/core/turnby.js');
const AD = require('../src/core/adapter.js');
const Prof = require('../src/geom/profile.js');
const F = require('../src/core/finish.js');

const BAR = 21.7, CUP_RATE = 0.021, US = [0, 8.4, -8.4], p100 = (x) => (x * 100 * 180) / Math.PI;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** kstep436.js's step at each joint s (within ±5 m), per u: the largest |change over 2 m| of the surface line's vertical curvature, in °/100 m. */
function jointSteps(doc, jointS) {
  const { segments, path: p } = AD.toPath(doc, { step: 0.5 }), LAP = p.lengthM, NB = 4, W = 4, h = 0.5, hh = NB * h;
  // a closed path's last sample is its first again (s = the lap's length, the same point): left out, or the wrapped line would carry that point twice
  const S = doc.closed && p.samples.length > 1 && Math.abs(p.samples[p.samples.length - 1].s - LAP) < 1e-6 ? p.samples.slice(0, -1) : p.samples;
  const segS0 = []; { let a = S[0].s; for (const g of segments) { segS0.push(a); a += g.length; } }
  const near = (s, j) => Math.abs(((s - j + LAP / 2) % LAP + LAP) % LAP - LAP / 2);
  const out = [];
  for (const js of jointS) {
    const idx = []; S.forEach((sm, i) => { if (near(sm.s, js) <= 5 + (W + NB + 1) * h + 1) idx.push(i); });
    idx.sort((a, b) => ((S[a].s - js + LAP / 2) % LAP + LAP) % LAP - ((S[b].s - js + LAP / 2) % LAP + LAP) % LAP);
    const line = (u) => idx.map((i) => { const sm = S[i], seg = segments[sm.seg], P = Prof.readAt(seg, Math.max(0, Math.min(seg.length, sm.s - segS0[sm.seg]))), u0 = P.u[0], u1 = P.u[P.u.length - 1], uu = Math.max(u0, Math.min(u1, u));
      let a = u0, b = u1; for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (Prof.offsetAt(P, m)[0] < uu) a = m; else b = m; } const [X, Y] = Prof.offsetAt(P, (a + b) / 2); return add(sm.pos, add(mul(sm.L, X), mul(sm.U, Y))); });
    const res = { s: js };
    for (const u of US) {
      const L = line(u), n = L.length, kap = new Float64Array(n);
      for (let i = NB; i + NB < n; i++) kap[i] = dot(sub(add(L[i - NB], L[i + NB]), mul(L[i], 2)), S[idx[i]].U) / (hh * hh);
      let worst = 0; for (let i = W + NB; i + W + NB < n; i++) { if (near(S[idx[i]].s, js) > 5) continue; worst = Math.max(worst, Math.abs(kap[i + W] - kap[i - W])); }
      res[u] = p100(worst);
    }
    out.push(res);
  }
  return out;
}
function closer(open, what) {
  const r = F.finishToStart(open), n0 = open.pieces.length, doc = r.doc;
  assert.equal(doc.closed, true, `${what}: ${r.plan.report}`);
  const s0 = []; let a = 0; for (const P of doc.pieces) { s0.push(a); a += P.length; }
  const joints = []; for (let j = n0; j < doc.pieces.length; j++) joints.push({ name: `${doc.pieces[j - 1].id}|${doc.pieces[j].id}`, s: s0[j] }); joints.push({ name: `${doc.pieces[doc.pieces.length - 1].id}|${doc.pieces[0].id}`, s: 0 });
  return { r, doc, n0, joints };
}
function stepsUnderBar(open, what) {
  const { doc, joints } = closer(open, what), st = jointSteps(doc, joints.map((j) => j.s));
  const bad = joints.map((j, k) => ({ j: j.name, s: j.s, up: st[k][8.4], down: st[k][-8.4] })).filter((x) => x.up > BAR || x.down > BAR);
  assert.deepEqual(bad.map((x) => `${x.j} at ${x.s.toFixed(0)} m: u +8.4 ${x.up.toFixed(1)}, u −8.4 ${x.down.toFixed(1)} °/100 m`), [], `${what}: every closer joint and the seam ≤ ${BAR} °/100 m at u ±8.4`);
}
function cupHome(open, what) {
  const { doc, n0 } = closer(open, what), last = doc.pieces[doc.pieces.length - 1], first = doc.pieces[0];
  let worst = 0, at = null;
  for (const P of doc.pieces.slice(n0)) { if (!P.cup) continue; let prev = D.valuesAt(P, 0).c; for (let s = 1; s <= P.length; s += 1) { const c = D.valuesAt(P, Math.min(s, P.length)).c, r = Math.abs(c - prev); if (r > worst) { worst = r; at = `${P.id} +${s} m`; } prev = c; } }
  assert.ok(worst <= CUP_RATE, `${what}: the closer's cup changes no faster than ${CUP_RATE} °/m (worst ${worst.toFixed(4)} °/m at ${at})`);
  if (last.cup && first.cup) assert.ok(Math.abs(D.pieceEnd(last).c.v - first.channels.c[0]) < 1e-6, `${what}: the cup meets p1's at the seam`);
}
const privateRow = (file, name) => (fs.existsSync(path.join(__dirname, '..', 'fixtures-d431', file)) ? false : `fixtures-d431/${file} is not here (${name}: a private track, kept off the repository)`);
const openOf = (file) => D.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures-d431', file), 'utf8'));

test('row 1: TEST TRACK 10: every closer joint and the seam step no more than his own joints\' 90th percentile under the outer wheels', { skip: privateRow('testtrack10-open.t180track', 'TEST TRACK 10') }, () => stepsUnderBar(openOf('testtrack10-open.t180track'), 'TEST TRACK 10'));
test('row 2: TEST 10: every closer joint and the seam step no more than his own joints\' 90th percentile under the outer wheels', { skip: privateRow('test10-open.t180track', 'TEST 10') }, () => stepsUnderBar(openOf('test10-open.t180track'), 'TEST 10'));
test('row 3: TEST TRACK 10: the closer brings the cup home over its length, no faster than his own road changes it', { skip: privateRow('testtrack10-open.t180track', 'TEST TRACK 10') }, () => cupHome(openOf('testtrack10-open.t180track'), 'TEST TRACK 10'));
test('row 4: TEST 10: the closer brings the cup home over its length, no faster than his own road changes it', { skip: privateRow('test10-open.t180track', 'TEST 10') }, () => cupHome(openOf('test10-open.t180track'), 'TEST 10'));

function builtHere() {
  let d = D.createDoc('rolled cup');
  d = extend(d, { length: 1000, family: 'bowl', first: { c: 10 } });
  d = extendTurnBy(d, { length: 1500, targets: { kv: 0 } }, Math.PI);
  return extend(d, { length: 300, targets: { c: 35, phi: (40 * Math.PI) / 180 } });
}
test('row 5: a track built here: its closer rolls upright, steps no more than the bar at every joint and the seam, and brings the cup home slowly', () => {
  const open = builtHere(), { r, doc, n0 } = closer(open, 'the rolled cup');
  assert.ok(doc.pieces.slice(n0).some((P) => P.channels.kh.some((k) => Math.abs(k) > 1e-6) && P.channels.phi.some((x) => Math.abs(x - P.channels.phi[0]) > 0.1)), `control: the closer banks a turn (${r.plan.report})`);
  // D434's upright rule: a turn laid on the end's own 40° keeps it, so the closer that banks its turns is the one that rolls upright FIRST (finish.js bankPlan); a
  // closer that banked a turn laid rolled (roll last) would carry it on top, 9.99 g of side load on this track against 4.38 (survivor-figures.out, mutant B4)
  assert.equal(r.plan.rollFirst, true, `the closer rolls upright first (${r.plan.report})`);
  stepsUnderBar(open, 'the rolled cup');
  cupHome(open, 'the rolled cup');
});
