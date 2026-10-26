// core_smooth_ramps.test.js: node --test test/core_smooth_ramps.test.js
// D465 (pane C): Track ▸ Smooth ramps, the core (src/core/smoothramps.js). A track laid before 0.4.20 keeps the ramps it was laid with (a saved document stores
// control points, not words), so its bank, cup and edge ramps arrive with the Bloss cubic's curvature step at every joint; this re-lays them with the C2 quintic
// extend.js lays now. The ramps here are laid from public words, the shapes TEST 10 is made of (a 30° bank over 100 m with a 30° edge, a 1,000 m bank with a 15°
// cup, a 30° edge to 0 over 50 m, a 10° bank with a 35° right edge over 50 m), and then given the ramps 0.4.19 laid (the Bloss cubic fitted on the piece's knots,
// document.js fitChannel, as 0.4.19's extend did). The joints are read by src/core/continuity.js (P's instrument, D459 3b).
//   1  the ramps go from C1 to C2: c2Breaks lists every ramp joint before (the control), none after; every joint keeps its value and slope (C1, as it was)
//   2  the route is the same bytes: kh, kv, w, r, h, l, s, t, every length, every knot, every id and every non-road piece; and the laid path's stations
//   3  each re-laid ramp goes from its start value to its end value and stays between them (a cup stays in [0, 150]); it reaches its end where it reached it before
//   4  a lap: a closed track keeps its closure (the seam's value and slope), and its ramps go C2
//   5  a track laid by this build is already smooth: nothing moves, the same document comes back; smoothing twice is smoothing once
//   6  an empty track: nothing to do, the same document
//   7  a track with no ramps (turns and climbs only): nothing to do, the same document
//   8  what is not a rest-to-rest ramp is left as it is, and listed with the reason (a continued slope at either end, a bump, a piece too short)
//   9  the shape is the quintic's, 6u⁵ − 15u⁴ + 10u³: a 30° bank over 100 m within 1.5% of the change, a 35° right edge over 50 m (three knots) within 3%
//      (P's two bars, D459 core_joint_c2 row 8; the cubic is 5.2% off it)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const X = require('../src/core/extend.js');
const C = require('../src/core/continuity.js');
const AD = require('../src/core/adapter.js');
const { smoothRamps } = require('../src/core/smoothramps.js');

const DEG = Math.PI / 180, R = 180, Q = (Math.PI * R) / 2;
const RAMP = ['phi', 'c', 'e', 'er'];

/** The ramps as 0.4.19 laid them: every rest-to-rest bank, cup and edge channel refitted by the Bloss cubic on the piece's own knots, its start held (fitChannel). */
function as0419(doc) {
  const pieces = doc.pieces.map((P) => {
    if (P.type !== 'road') return P;
    const channels = { ...P.channels };
    for (const ch of RAMP) {
      const c = P.channels[ch]; if (!Array.isArray(c)) continue;
      const n = c.length, v0 = c[0], v1 = c[n - 1];
      if (v0 === v1 || c[1] !== v0 || c[n - 2] !== v1) continue;
      const f = (s) => v0 + (v1 - v0) * X.bloss(s / P.length);
      channels[ch] = D.fitChannel(f, P.length, P.knots.map(Number), { v: v0, m: 0 }).map((x) => Number(x.toFixed(D.DEC[ch])) + 0);
    }
    return { ...P, channels };
  });
  return D.checkDoc({ ...doc, pieces });
}
/** TEST 10's ramp shapes in public words, on an open track. */
function rampsTrack() {
  let d = D.createDoc();
  d = X.extend(d, { length: 300, family: 'bowl' });
  d = X.extend(d, { length: 100, targets: { phi: 30 * DEG, e: 30 } });                 // a 30° bank over 100 m, with a 30° edge
  d = X.extend(d, { length: 200, transition: 60, targets: { kh: 1 / 400 } });          // a turn in, the bank held
  d = X.extend(d, { length: 1000, targets: { phi: 0, c: 15, kh: 0 } });              // the bank off and a 15° cup in over 1,000 m
  d = X.extend(d, { length: 50, targets: { e: 0 } });                                  // the edge to 0 over 50 m
  d = X.extend(d, { length: 50, targets: { phi: -10 * DEG, er: 35 } });                // a 10° bank the other way with a 35° right edge over 50 m
  d = X.extend(d, { length: 100, targets: { phi: 0, er: 0, kv: 0.001 } });             // both back to 0 over 100 m, a climb in
  d = X.extend(d, { length: 200, targets: { kv: 0 } });
  return as0419(d);
}
const routeOf = (P) => { const { channels, ...rest } = P; return JSON.stringify({ ...rest, channels: Object.fromEntries(Object.entries(channels).filter(([ch]) => !RAMP.includes(ch))) }); };
const stations = (d) => AD.toPath(d, { step: 2 }).path.samples.map((x) => JSON.stringify([x.s, x.pos, x.T]));   // where the road's centre is and which way it heads, every 2 m

test('row 1: Smooth ramps takes every bank, cup and edge ramp joint of a track laid by 0.4.19 from C1 to C2, and every joint keeps its value and slope', () => {
  const before = rampsTrack(), b = C.c2Breaks(before);
  assert.ok(b.length >= 10, `control: the 0.4.19 ramps step in curvature at their joints (${b.length} breaks: ${b.map((e) => `${e.joint} ${e.ch} ${e.dkDeg.toFixed(4)}`).join(', ')})`);
  const r = smoothRamps(before), a = C.c2Breaks(r.doc);
  assert.deepEqual(a.map((e) => `${e.joint} ${e.ch} ${e.dkDeg.toFixed(5)} deg/m²`), [], 'no joint of a bank, cup or edge steps in curvature');
  assert.ok(r.moved >= 8, `the ramps were re-laid (${r.moved})`);
  const steps = (d) => C.jointSteps(d, { channels: RAMP }).map((e) => [e.joint, e.ch, e.dv, e.dm]);
  for (const [[j, ch, dv0, dm0], [, , dv1, dm1]] of steps(before).map((s, i) => [s, steps(r.doc)[i]])) {
    assert.ok(Math.abs(dv1 - dv0) < 1e-12 && Math.abs(dm1 - dm0) < 1e-12, `${j} ${ch}: the value and slope steps are as they were (${dv0}, ${dm0} -> ${dv1}, ${dm1})`);
  }
});

test('row 2: the route is the same bytes: every channel but the bank, cup and edges, every length and knot, and the laid path', () => {
  const before = rampsTrack(), after = smoothRamps(before).doc;
  assert.notEqual(D.serialize(after), D.serialize(before), 'control: the ramps moved');
  assert.equal(after.pieces.length, before.pieces.length);
  before.pieces.forEach((P, i) => assert.equal(routeOf(after.pieces[i]), routeOf(P), `${P.id}: kh, kv, w, r, h, l, s, t, the length, the knots and the rest are the same bytes`));
  const { pieces: pa, ...ra } = after, { pieces: pb, ...rb } = before;
  assert.deepEqual(ra, rb, 'the start, the name, the spawns and the rest of the document are as they were');
  assert.deepEqual(stations(after), stations(before), 'the laid path is where it was');
});

test('row 3: each re-laid ramp goes from its start value to its end value, stays between them, and reaches its end where it did before', () => {
  const before = rampsTrack(), r = smoothRamps(before);
  for (const x of r.ramps) {
    const P = r.doc.pieces.find((Q) => Q.id === x.id), c = P.channels[x.ch], n = c.length, lo = Math.min(x.from, x.to), hi = Math.max(x.from, x.to);
    assert.equal(c[0], x.from, `${x.id} ${x.ch} starts where it did`); assert.equal(c[n - 1], x.to, `${x.id} ${x.ch} ends where it did`);
    assert.ok(c.every((v) => v >= lo && v <= hi), `${x.id} ${x.ch}: every control point between ${lo} and ${hi}: ${c.join(', ')}`);
    assert.equal(x.over, P.length, `${x.id} ${x.ch}: a ramp over the whole piece stays over the whole piece`);
    if (x.ch === 'c') assert.ok(c.every((v) => v >= 0 && v <= D.CUP_MAX), 'a cup stays in [0, 150]');
  }
  // a ramp typed with a transition (a 20° bank reached in 'start', then held on a 120 m piece): re-laid over the metres it reached its end in before, held after
  let d = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  d = asShort0419(X.extend(d, { length: 120, transition: { phi: 40 }, targets: { phi: 20 * DEG } }), 1, 20);
  const was = d.pieces[1], v1 = 20 * DEG, U = D.knotVector(was), j = was.channels.phi.indexOf(Number(v1.toFixed(9)));
  const r2 = smoothRamps(d), P = r2.doc.pieces[1], held = (Q) => [30, 40, 60, 80, 100, 120].map((s) => +D.valuesAt(Q, s).phi.toFixed(9));
  assert.ok(C.c2Breaks(d).length >= 1, 'control: the short ramp steps');
  assert.equal(r2.ramps.length, 1); assert.equal(r2.ramps[0].over, U[j + 3], `laid over the ${U[j + 3]} m it reached its end in before (${r2.ramps[0].over} m)`);
  assert.deepEqual(held(P), held(was), 'the hold is the hold it was');
  assert.deepEqual(held(P), held(P).map(() => +v1.toFixed(9)));
  assert.deepEqual(C.c2Breaks(r2.doc), []);
  // uneven knots: a 200 m piece that also carried a 5 m width ramp (its knots crowd its first metres), with a bank held from 8 m; the fit there rings (15% of the
  // change below the start, then up), so the ramp must still go one way only, stay between its two values, and arrive C2
  let u = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  u = X.extend(u, { length: 200, transition: { w: 5 }, targets: { w: 20 } });
  u = asShort0419(u, 1, 8, 0.5);
  const r3 = smoothRamps(u), c3 = r3.doc.pieces[1].channels.phi;
  assert.equal(r3.moved, 1, 'control: the bank was re-laid');
  assert.ok(c3.every((v, i) => i === 0 || v >= c3[i - 1]), `the bank never turns back: ${c3.join(', ')}`);
  assert.ok(c3.every((v) => v >= 0 && v <= 0.5), 'and stays between 0 and 0.5');
  assert.deepEqual(C.c2Breaks(r3.doc), []);
});
/** A short ramp as 0.4.19 laid it (extend.js rampControl at its time): the joint's two points held, the rest the Bloss cubic over Lc metres read at the Greville abscissae. */
function asShort0419(doc, i, Lc, to) {
  const P = doc.pieces[i], c = P.channels.phi, v0 = c[0], v1 = to === undefined ? c[c.length - 1] : to, U = D.knotVector(P);
  const f = (s) => v0 + (v1 - v0) * X.bloss(s / Lc);
  const phi = c.map((x, k) => (k < 2 ? v0 : Number(f((U[k + 1] + U[k + 2] + U[k + 3]) / 3).toFixed(D.DEC.phi)) + 0));
  return D.checkDoc({ ...doc, pieces: doc.pieces.map((Q, k) => (k === i ? { ...Q, channels: { ...Q.channels, phi } } : Q)) });
}

test('row 4: a closed lap keeps its closure (the seam\'s value and slope), the route is the same bytes, and its ramps go C2', () => {
  let d = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  d = X.extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = X.extend(d, { length: Q, targets: { phi: 15 * DEG } });
  d = X.extend(d, { length: Q, targets: { phi: 0 } });
  d = X.extend(d, { length: Q, transition: 40, targets: { kh: 0 } });
  const { close } = require('../src/core/close.js');
  const shut = close(d, { edited: [0] });
  assert.ok(shut.converged && shut.doc.closed, 'control: the lap closes');
  const before = as0419(shut.doc), seam = (x) => C.jointSteps(x, { channels: D.CHANNELS }).filter((e) => e.k === x.pieces.length - 1);
  assert.ok(C.c2Breaks(before).length >= 2, 'control: the bank ramps step');
  const after = smoothRamps(before).doc;
  assert.equal(after.closed, true);
  assert.deepEqual(seam(after).map((e) => [e.ch, e.dv, e.dm]), seam(before).map((e) => [e.ch, e.dv, e.dm]), 'the seam\'s value and slope steps are the same');
  before.pieces.forEach((P, i) => assert.equal(routeOf(after.pieces[i]), routeOf(P), `${P.id}: the route channels, the length and the knots`));
  assert.deepEqual(stations(after), stations(before), 'the laid lap is where it was');
  assert.deepEqual(C.c2Breaks(after).map((e) => `${e.joint} ${e.ch}`), []);
});

test('row 5: a track laid by this build is already smooth: nothing moves and the same document comes back; smoothing twice is smoothing once', () => {
  let d = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  d = X.extend(d, { length: 100, targets: { phi: 30 * DEG, e: 30 } });
  d = X.extend(d, { length: 400, targets: { phi: 0, c: 15 } });
  const r = smoothRamps(d);
  assert.ok(r.ramps.length >= 3, 'control: it has ramps');
  assert.equal(r.moved, 0, `none moves: ${r.ramps.filter((x) => x.moved).map((x) => `${x.id} ${x.ch}`).join(', ')}`);
  assert.equal(r.doc, d, 'the same document');
  const once = smoothRamps(rampsTrack()), twice = smoothRamps(once.doc);
  assert.ok(once.moved > 0); assert.equal(twice.moved, 0); assert.equal(twice.doc, once.doc);
});

test('row 6: an empty track: nothing to smooth, the same document', () => {
  const d = D.createDoc(), r = smoothRamps(d);
  assert.deepEqual([r.ramps, r.moved, r.left], [[], 0, []]);
  assert.equal(r.doc, d);
});

test('row 7: a track with no ramps (turns and climbs only): nothing to smooth, the same document', () => {
  let d = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  for (let i = 0; i < 2; i++) d = X.extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = X.extend(d, { length: 200, targets: { kh: 0, kv: 0.002 } });
  d = X.extend(d, { length: 200, targets: { kv: 0 } });
  const r = smoothRamps(d);
  assert.deepEqual([r.ramps, r.moved, r.left], [[], 0, []]);
  assert.equal(r.doc, d);
});

test('row 8: a channel that changes but is not a rest-to-rest ramp is left as it is and listed with the reason', () => {
  let d = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  d = X.extend(d, { length: 100, targets: { phi: 20 * DEG } });
  const P = d.pieces[1], phi = P.channels.phi.slice(), n = phi.length; phi[n - 2] = phi[n - 1] - 0.001;   // the track's last piece: it arrives with a slope
  d = D.checkDoc({ ...d, pieces: [d.pieces[0], { ...P, channels: { ...P.channels, phi } }] });
  let r = smoothRamps(d);
  assert.deepEqual(r.left.map((x) => [x.id, x.ch]), [[P.id, 'phi']]); assert.match(r.left[0].why, /rest/);
  assert.equal(r.doc, d);
  // the track's first piece: nothing before it, so it may leave with a slope
  let f = X.extend(D.createDoc(), { length: 100, family: 'bowl', targets: { phi: 20 * DEG } });
  const F = f.pieces[0], fphi = F.channels.phi.slice(); fphi[1] = fphi[0] + 0.001;
  f = D.checkDoc({ ...f, pieces: [{ ...F, channels: { ...F.channels, phi: fphi } }] });
  r = smoothRamps(f);
  assert.deepEqual(r.left.map((x) => [x.id, x.ch]), [[F.id, 'phi']]); assert.match(r.left[0].why, /rest/);
  assert.equal(r.doc, f);
  // a bump: the bank goes up and comes back to where it started
  let g = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  g = X.extend(g, { length: 100 });
  const G = g.pieces[1], gphi = G.channels.phi.map((x, i, a) => (i >= 2 && i < a.length - 2 ? 0.1 : x));
  g = D.checkDoc({ ...g, pieces: [g.pieces[0], { ...G, channels: { ...G.channels, phi: gphi } }] });
  r = smoothRamps(g);
  assert.deepEqual(r.left.map((x) => [x.id, x.ch]), [[G.id, 'phi']]); assert.match(r.left[0].why, /bump/);
  assert.equal(r.doc, g);
  // a piece too short for two interior knots (0.4.19 laid a 30 m piece on one): its ends cannot both be made C2
  let e = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  e = X.extend(e, { length: 30, knotM: 20 });
  const S = e.pieces[1], v1 = Number((10 * DEG).toFixed(9));
  assert.equal(S.channels.phi.length, 5, 'control: one interior knot, five control points');
  e = D.checkDoc({ ...e, pieces: [e.pieces[0], { ...S, channels: { ...S.channels, phi: [0, 0, v1 / 2, v1, v1] } }] });
  r = smoothRamps(e);
  assert.deepEqual(r.left.map((x) => [x.id, x.ch]), [[S.id, 'phi']]); assert.match(r.left[0].why, /too short/);
  assert.equal(r.doc, e);
});

test('row 9: the shape is the quintic\'s: a 30° bank over 100 m within 1.5% of the change, a 35° right edge over 50 m within 3%', () => {
  const r = smoothRamps(rampsTrack()), q = X.smoother;
  for (const [id, ch, bar] of [['p2', 'phi', 0.015], ['p6', 'er', 0.03]]) {
    const P = r.doc.pieces.find((Q) => Q.id === id), c = P.channels[ch], v0 = c[0], v1 = c[c.length - 1];
    let worst = 0; for (let s = 0; s <= P.length; s += 0.5) worst = Math.max(worst, Math.abs(D.valuesAt(P, s)[ch] - (v0 + (v1 - v0) * q(s / P.length))) / Math.abs(v1 - v0));
    assert.ok(worst <= bar, `${id} ${ch}: ${(100 * worst).toFixed(2)}% off the quintic`);
  }
});

// D465 (the librarian's ruling, plan § "D465 in"): a piece that ramps its cup AND its edges. The edge's cap is 150° less the cup there (document.js CUP_MAX, extend.js's
// clamps), and that cap moves along the piece with the cup, so each channel staying between its own two values does not by itself keep their sum under it. The track is
// laid at the cap: a cup falling 140 → 100 while the edge rises 10 → 50 (150 all the way), then a cup 100 → 20 while the edge rises 50 → 120 over 200 m.
test('row 10: a piece that ramps cup and edge together keeps edge ≤ 150 − cup at every sample, before (the control) and after', () => {
  let d = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  d = X.extend(d, { length: 100, targets: { c: 140, e: 10 } });
  d = X.extend(d, { length: 100, targets: { c: 100, e: 50, er: 40 } });
  d = X.extend(d, { length: 200, targets: { c: 20, e: 120 } });
  const before = as0419(d), r = smoothRamps(before), Q6 = 1e-6;   // the cup's and the edges' quantum (document.js DEC: 6 decimals)
  const over = (doc) => {
    const out = [];
    for (const P of doc.pieces) for (let s = 0; s <= P.length + 1e-9; s += 0.25) {
      const v = D.valuesAt(P, Math.min(s, P.length));
      for (const ch of ['e', 'er']) if (v[ch] > D.CUP_MAX - v.c + Q6) out.push(`${P.id} s ${s} ${ch} ${v[ch].toFixed(6)} + cup ${v.c.toFixed(6)} = ${(v[ch] + v.c).toFixed(6)}`);
    }
    return out;
  };
  assert.deepEqual(over(before), [], 'control: the track as 0.4.19 laid it is under the cap');
  assert.ok(r.ramps.filter((x) => x.moved && (x.ch === 'c' || x.ch === 'e')).length >= 4, `control: the cups and edges were re-laid (${r.ramps.map((x) => `${x.id} ${x.ch}`).join(', ')})`);
  assert.deepEqual(over(r.doc), [], 'the edge never goes past 150 less the cup');
  assert.deepEqual(C.c2Breaks(r.doc), []);
  // and the same track as this build lays it is already smooth: extend's edge clamp leaves 21.886067999999995 where the re-lay rounds to 21.886068, the same ramp
  const laid = smoothRamps(d);
  assert.deepEqual(laid.ramps.filter((x) => x.moved).map((x) => `${x.id} ${x.ch}`), [], 'nothing moves on the track as laid');
  assert.equal(laid.doc, d);
});
