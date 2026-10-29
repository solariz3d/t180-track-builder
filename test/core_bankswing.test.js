// core_bankswing.test.js: node --test test/core_bankswing.test.js
// BANK THE BEND (src/core/bankswing.js): the bank laid over a stretch of road as one swing, from the bank there to a peak and on to an exit, across every
// joint in the stretch. Only phi changes; the route does not move.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const J = require('../src/core/jump.js');
const A = require('../src/core/adapter.js');
const SC = require('../src/core/sculpt.js');
const { buildPath } = require('../src/geom/index.js');
const BS = require('../src/core/bankswing.js');

const DEG = Math.PI / 180;
/** Three 100 m straights, level (or with the first piece's bank `phi0`, rad). Each has 8 control points (knots every 20 m). */
function three(phi0 = 0) {
  let d = extend(D.createDoc('three'), { length: 100, family: 'bowl', ...(phi0 ? { first: { phi: phi0 } } : {}) });
  for (let i = 0; i < 2; i++) d = extend(d, { length: 100 });
  return d;
}
/** The piece holding lap distance s (a closed lap wraps), and s on it. */
function at(doc, s) {
  const off = SC.pieceOffsets(doc), L = off[off.length - 1] + doc.pieces[doc.pieces.length - 1].length;
  if (doc.closed) s = ((s % L) + L) % L;
  for (let i = doc.pieces.length - 1; i >= 0; i--) if (s >= off[i]) return { P: doc.pieces[i], s: Math.min(s - off[i], doc.pieces[i].length) };
  return { P: doc.pieces[0], s: 0 };
}
const phiDeg = (doc, s) => { const { P, s: u } = at(doc, s); return D.channelAt(P, 'phi', u).v / DEG; };
/** The joint between pieces i − 1 and i: value, slope and curvature of phi from both sides. */
function joint(doc, i) {
  const A0 = doc.pieces[i - 1], B0 = doc.pieces[i], a = D.channelAt(A0, 'phi', A0.length), b = D.channelAt(B0, 'phi', 0);
  return { dv: Math.abs(a.v - b.v), d1: Math.abs(a.d1 - b.d1), d2: Math.abs(a.d2 - b.d2), a, b };
}
const centre = (d) => buildPath(A.toSegments(d), { step: 2, closed: d.closed }).samples.map((m) => m.pos);
const OTHER = D.CHANNELS.filter((ch) => ch !== 'phi');

test('swing: 0° at 50 m to 40° at 150 m and back to 0° at 250 m, across both joints', () => {
  const d = three(), s = BS.swingBank(d, { s0: 50, s1: 250, peakS: 150, peakDeg: 40 });
  assert.ok(Math.abs(phiDeg(s, 50)) < 0.001, `at 50 m: ${phiDeg(s, 50)}°`);
  assert.ok(Math.abs(phiDeg(s, 250)) < 0.001, `at 250 m: ${phiDeg(s, 250)}°`);
  assert.ok(Math.abs(phiDeg(s, 150) - 40) < 0.01, `at 150 m: ${phiDeg(s, 150)}°`);
  assert.ok(phiDeg(s, 100) > 10 && phiDeg(s, 200) > 10, 'the bank rises through the first joint and falls through the second');
});

test('swing: every joint in the stretch is C1 (value and slope within 1e-9 rad, rad/m) and C2 where the pieces have six points', () => {
  const s = BS.swingBank(three(), { s0: 50, s1: 250, peakS: 150, peakDeg: 40 });
  for (const i of [1, 2]) {
    const j = joint(s, i);
    assert.ok(s.pieces[i - 1].channels.phi.length >= 6 && s.pieces[i].channels.phi.length >= 6);
    assert.ok(j.dv < 1e-9, `joint ${i}: value ${j.a.v} vs ${j.b.v}`);
    assert.ok(j.d1 < 1e-9, `joint ${i}: slope ${j.a.d1} vs ${j.b.d1}`);
    assert.ok(j.d2 < 1e-6, `joint ${i}: curvature ${j.a.d2} vs ${j.b.d2} rad/m²`);
    assert.ok(Math.abs(j.a.d1) > 1e-4, `joint ${i} is inside the swing (slope ${j.a.d1})`);
  }
});

test('swing: only phi changes; every other channel, knot and length is the same bytes, and the centreline does not move', () => {
  const d = three(), s = BS.swingBank(d, { s0: 50, s1: 250, peakS: 150, peakDeg: 40 });
  assert.equal(s.pieces.length, d.pieces.length);
  d.pieces.forEach((P, i) => {
    const Q = s.pieces[i];
    assert.equal(JSON.stringify(Q.knots), JSON.stringify(P.knots)); assert.equal(Q.length, P.length);
    for (const ch of OTHER) assert.equal(JSON.stringify(Q.channels[ch]), JSON.stringify(P.channels[ch]), `piece ${i} channel ${ch}`);
    assert.equal(JSON.stringify({ ...Q, channels: null }), JSON.stringify({ ...P, channels: null }), `piece ${i} apart from its channels`);
  });
  assert.notEqual(JSON.stringify(s.pieces[1].channels.phi), JSON.stringify(d.pieces[1].channels.phi), 'the bank did change');
  const a = centre(d), b = centre(s);
  assert.equal(a.length, b.length);
  let worst = 0; a.forEach((p, i) => p.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - b[i][k])); }));
  assert.ok(worst < 1e-9, `the centreline moved ${worst} m`);
});

test('swing: a piece the stretch does not reach is the same object, and a joint it does not reach keeps its bytes', () => {
  const d = three(), s = BS.swingBank(d, { s0: 120, s1: 180, peakS: 150, peakDeg: 10 });
  assert.equal(s.pieces[0], d.pieces[0]); assert.equal(s.pieces[2], d.pieces[2]);
  assert.ok(Math.abs(phiDeg(s, 150) - 10) < 0.01);
});

test('swing: an exit bank of 20° ends the swing at 20°, and the road after it holds it', () => {
  const s = BS.swingBank(three(), { s0: 50, s1: 250, peakS: 150, peakDeg: 40, exitDeg: 20 });
  assert.ok(Math.abs(phiDeg(s, 250) - 20) < 0.001, `at 250 m: ${phiDeg(s, 250)}°`);
  assert.ok(Math.abs(phiDeg(s, 150) - 40) < 0.01);
  // inside the fit's reach past s1 (the supports of the points it moved) the bank is 20° to the fit's ripple; past it, 20° exactly
  for (const x of [260, 280]) assert.ok(Math.abs(phiDeg(s, x) - 20) < 0.5, `at ${x} m: ${phiDeg(s, x)}°`);
  assert.ok(Math.abs(phiDeg(s, 300) - 20) < 1e-6, `at 300 m: ${phiDeg(s, 300)}°`);
  assert.ok(Math.abs(phiDeg(s, 0)) < 1e-9, 'where no moved point reaches, the bank is as it was');
  for (let x = 0; x < 50; x += 2) assert.ok(Math.abs(phiDeg(s, x)) < 0.1, `before the stretch, at ${x} m: ${phiDeg(s, x)}°`);
});

test('swing: into a road already banked 30° the swing starts from 30°', () => {
  const d = three(30 * DEG);
  assert.ok(Math.abs(phiDeg(d, 50) - 30) < 1e-6, `the road is banked ${phiDeg(d, 50)}° at 50 m`);
  const s = BS.swingBank(d, { s0: 50, s1: 250, peakS: 150, peakDeg: 40 });
  assert.ok(Math.abs(phiDeg(s, 50) - 30) < 0.001, `at 50 m: ${phiDeg(s, 50)}°`);
  assert.ok(Math.abs(phiDeg(s, 150) - 40) < 0.01);
  assert.ok(Math.abs(phiDeg(s, 250) - 30) < 0.001, 'with no exit bank it ends at the bank there, 30°');
});

test('swing: the rounded swing rolls at its plateau, rounding over the 20 m knot span: 40° over 100 m each way rolls 40 / (100 − 20) = 0.5 °/m', () => {
  const s = BS.swingBank(three(), { s0: 50, s1: 250, peakS: 150, peakDeg: 40 });
  const roll = (x) => (phiDeg(s, x + 10) - phiDeg(s, x - 10)) / 20;
  for (const x of [90, 100, 110]) assert.ok(Math.abs(roll(x) - 0.5) < 0.025, `the roll at ${x} m: ${roll(x)} °/m`);
  for (const x of [190, 200, 210]) assert.ok(Math.abs(roll(x) + 0.5) < 0.025, `the roll at ${x} m: ${roll(x)} °/m`);
  let worst = 0; for (let x = 20; x <= 280; x++) worst = Math.max(worst, Math.abs(roll(x)));
  assert.ok(worst < 0.5 * 1.05, `the worst roll ${worst} °/m`);
});

test('swing: the quintic shape lays the same ends and peak', () => {
  const s = BS.swingBank(three(), { s0: 50, s1: 250, peakS: 150, peakDeg: 40, shape: 'quintic' });
  assert.ok(Math.abs(phiDeg(s, 50)) < 0.001 && Math.abs(phiDeg(s, 250)) < 0.001 && Math.abs(phiDeg(s, 150) - 40) < 0.01);
  assert.throws(() => BS.swingBank(three(), { s0: 50, s1: 250, peakS: 150, peakDeg: 40, shape: 'square' }), (e) => e.code === 'BAD_SHAPE');
});

test('swing: refused by name BAD_RANGE when the stretch is out of order or the peak is not inside it', () => {
  const d = three(), go = (o) => () => BS.swingBank(d, { peakDeg: 40, ...o });
  for (const o of [{ s0: 250, s1: 250, peakS: 250 }, { s0: 250, s1: 50, peakS: 150 }, { s0: 50, s1: 250, peakS: 50 }, { s0: 50, s1: 250, peakS: 250 }, { s0: 50, s1: 250, peakS: 300 },
    { s0: -10, s1: 250, peakS: 150 }, { s0: 50, s1: 320, peakS: 150 }, { s0: NaN, s1: 250, peakS: 150 }]) {
    assert.throws(go(o), (e) => e.name === 'CoreError' && e.code === 'BAD_RANGE', JSON.stringify(o));
  }
});

test('swing: refused by name NOT_ROAD when a jump is inside the stretch', () => {
  let d = extend(D.createDoc('jump'), { length: 100, family: 'bowl' });
  d = J.jumpHere(d, null, { landingM: 100 });
  d = extend(d, { length: 100 });
  assert.equal(d.pieces[1].type, 'flight');
  const off = SC.pieceOffsets(d);
  assert.throws(() => BS.swingBank(d, { s0: 50, s1: off[2] + 60, peakS: off[2] + 10, peakDeg: 20 }), (e) => e.code === 'NOT_ROAD');
});

test('swing: an exit bank carries to the next jump and stops there: the take-off ends at it, the landing keeps its own bank', () => {
  let d = three();
  d = J.jumpHere(d, null, { landingM: 100 });
  const s = BS.swingBank(d, { s0: 50, s1: 250, peakS: 150, peakDeg: 40, exitDeg: 15 });
  const t = s.pieces[2]; assert.ok(Math.abs(D.channelAt(t, 'phi', t.length).v / DEG - 15) < 1e-6, 'the take-off ends at the exit bank');
  assert.equal(s.pieces[3], d.pieces[3]); assert.equal(s.pieces[4], d.pieces[4]);
});

test('swing: a stretch that starts just after a landing keeps the landing starting at its flight bank', () => {
  let d = extend(D.createDoc('landing'), { length: 100, family: 'bowl' });
  d = J.jumpHere(d, null, { landingM: 100 });
  d = extend(d, { length: 100 }); d = extend(d, { length: 100 });
  const off = SC.pieceOffsets(d), s = BS.swingBank(d, { s0: off[2] + 5, s1: off[2] + 205, peakS: off[2] + 105, peakDeg: 30 });
  assert.equal(s.pieces[2].channels.phi[0], d.pieces[2].channels.phi[0]);
  assert.ok(Math.abs(phiDeg(s, off[2] + 105) - 30) < 0.01);
});

test('swing: refused by name TOO_SHORT when a half is under one knot span', () => {
  assert.throws(() => BS.swingBank(three(), { s0: 50, s1: 250, peakS: 53, peakDeg: 40 }), (e) => e.code === 'TOO_SHORT');
  assert.throws(() => BS.swingBank(three(), { s0: 50, s1: 153, peakS: 150, peakDeg: 40 }), (e) => e.code === 'TOO_SHORT');
});

test('swing: refused by name SWING_REFUSED, with the cause, when the result would break a rule of the track', () => {
  // a closed lap with no jump: an exit bank other than the bank there would have to come all the way round to where the swing starts
  const d = lap();
  assert.throws(() => BS.swingBank(d, { s0: 100, s1: 400, peakS: 250, peakDeg: 20, exitDeg: 10 }), (e) => e.code === 'SWING_REFUSED' && /exit/.test(e.message));
});

const R = 180, Q = Math.PI * R / 2;
function lap() {
  let d = extend(D.createDoc('lap'), { length: 600, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}

test('swing: on a closed lap a stretch past the length wraps, and the joint at the seam is C1', () => {
  const d = lap(), off = SC.pieceOffsets(d), L = off[off.length - 1] + d.pieces[d.pieces.length - 1].length;
  const s = BS.swingBank(d, { s0: L - 120, s1: L + 120, peakS: L, peakDeg: 25 });
  assert.ok(Math.abs(phiDeg(s, 0) - 25) < 0.01, `at the seam: ${phiDeg(s, 0)}°`);
  assert.ok(Math.abs(phiDeg(s, L - 120) - phiDeg(d, L - 120)) < 0.001 && Math.abs(phiDeg(s, 120) - phiDeg(d, 120)) < 0.001);
  const last = s.pieces[s.pieces.length - 1], a = D.channelAt(last, 'phi', last.length), b = D.channelAt(s.pieces[0], 'phi', 0);
  assert.ok(Math.abs(a.v - b.v) < 1e-9 && Math.abs(a.d1 - b.d1) < 1e-9, `the seam: ${a.v}/${a.d1} vs ${b.v}/${b.d1}`);
  const ca = centre(d), cb = centre(s);
  let worst = 0; ca.forEach((p, i) => p.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - cb[i][k])); }));
  assert.ok(worst < 1e-9, `the centreline moved ${worst} m`);
  assert.throws(() => BS.swingBank(d, { s0: 10, s1: L + 50, peakS: 300, peakDeg: 25 }), (e) => e.code === 'BAD_RANGE', 'a stretch longer than the lap');
});
