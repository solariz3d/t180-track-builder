// core_offset_lift.test.js: node --test test/core_offset_lift.test.js
// D421 (A's Part 5 Step 2 profile, p-d421-subscribers-A_2026-10-20.md §3: the height offset's lift, src/core/adapter.js offsetPath, 383 ms of every drag step on 50 x 200 m): offsetPath
// now skips, piece by piece, a road piece whose h and l control points are all zero. On such a piece the value and both derivatives are zero at every s, so the old code returned the very
// same sample there; skipping it cannot change a bit. GEOMETRY tier: every lifted sample is compared with a frozen copy of the old offsetPath, field by field, with Object.is. Rows:
//   1  a hill on ONE piece of a long track: the lifted path is the old one, bit for bit; every sample outside the hill is the very same object as the base path's
//   2  a swerve across a joint, and offsets on every piece: the same, bit for bit
//   3  no offset anywhere: the very same path object back (unchanged)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AD = require('../src/core/adapter.js');
const D = require('../src/core/document.js');
const G = require('../src/geom/index.js');
const SC = require('../src/core/sculpt.js');
const { extend } = require('../src/core/extend.js');

// THE OLD offsetPath, frozen here as it was at ea54ac3 (src/core/adapter.js:400-436), so the new one is compared with it and not with itself
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function oldOffsetPath(doc, segments, path) {
  const pieces = new Map(doc.pieces.map((P) => [P.id, P]));
  const any = doc.pieces.some((P) => P.type === 'road' && D.OFFSETS.some((ch) => P.channels[ch].some((v) => v !== 0)));
  if (!any) return path;
  const segStart = [], pieceStart = new Map(); let acc = 0;
  segments.forEach((g, i) => { segStart.push(acc); if (!pieceStart.has(g.id)) pieceStart.set(g.id, acc); acc += g.length; });
  const UP = [0, 1, 0];
  const lift = (x) => {
    const g = segments[x.seg], P = pieces.get(g.id);
    if (!P || P.type !== 'road' || g.kind !== 'road') return x;
    const s = Math.min(Math.max(x.s - pieceStart.get(g.id), 0), P.length), h = D.channelAt(P, 'h', s), l = D.channelAt(P, 'l', s);
    if (!(h.v || h.d1 || h.d2 || l.v || l.d1 || l.d2)) return x;
    const T = x.T, K = x.kvec, th = Math.atan2(T[0], T[2]), u = x.s - segStart[x.seg];
    const k0 = g.k0 || 0, k1 = g.k1 || 0, dth = k0 + ((k1 - k0) * u) / g.length, ddth = (k1 - k0) / g.length;
    const R = [Math.cos(th), 0, -Math.sin(th)], Rth = [-Math.sin(th), 0, -Math.cos(th)];
    const dR = vmul(Rth, dth), ddR = vadd(vmul(Rth, ddth), vmul(R, -dth * dth));
    const pos = vadd(vadd(x.pos, vmul(UP, h.v)), vmul(R, l.v));
    const d1 = vadd(vadd(vadd(T, vmul(UP, h.d1)), vmul(R, l.d1)), vmul(dR, l.v));
    const d2 = vadd(vadd(vadd(vadd(K, vmul(UP, h.d2)), vmul(R, l.d2)), vmul(dR, 2 * l.d1)), vmul(ddR, l.v));
    const sp = Math.hypot(d1[0], d1[1], d1[2]), Tn = vmul(d1, 1 / sp), kvec = vmul(vadd(d2, vmul(Tn, -vdot(d2, Tn))), 1 / (sp * sp));
    const thn = Math.atan2(Tn[0], Tn[2]), Rn = [Math.cos(thn), 0, -Math.sin(thn)], U0 = vcross(Tn, Rn), phi = x.roll;
    const L = vadd(vmul(Rn, Math.cos(phi)), vmul(U0, Math.sin(phi))), U = vcross(Tn, L), run = Math.hypot(Tn[0], Tn[2]);
    return { s: x.s, seg: x.seg, pos, T: Tn, L, U, kvec, roll: phi, bankG: Math.asin(Math.max(-1, Math.min(1, L[1]))),
      grade: run > 1e-12 ? Tn[1] / run : (Tn[1] > 0 ? Infinity : -Infinity), _R: Rn, _x: pos };
  };
  const samples = path.samples.map(lift), segEnd = path.segEnd.map(lift), e = samples[samples.length - 1];
  const head = { s: e.s, seg: e.seg, pos: e.pos.slice(), T: e.T.slice(), L: e.L.slice(), U: e.U.slice() };
  return { ...path, samples, segEnd, head };
}

/** A long open track: a straight and `n` alternating turns. */
function track(n) {
  let d = D.createDoc('t'); d = extend(d, { length: 300, family: 'bowl' });
  for (let i = 0; i < n; i++) d = extend(d, { length: 200, transition: 40, targets: { kh: (i % 2 ? -1 : 1) / 400 } });
  return d;
}
const pathOf = (d) => { const segments = AD.toSegments(d); return { segments, path: G.buildPath(segments, { step: 2, start: { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch } }) }; };
/** Every number of a sample, as [name, value] pairs, so a difference names its field. */
const flat = (x) => Object.entries(x).flatMap(([k, v]) => (Array.isArray(v) ? v.map((n, i) => [`${k}[${i}]`, n]) : [[k, v]]));
function sameBits(a, b, what) {
  assert.equal(a.samples.length, b.samples.length, `${what}: sample count`);
  for (const key of ['samples', 'segEnd']) a[key].forEach((x, i) => { const fa = flat(x), fb = flat(b[key][i]); assert.equal(fa.length, fb.length, `${what} ${key}[${i}]: fields`); fa.forEach(([k, v], j) => assert.ok(Object.is(v, fb[j][1]) && k === fb[j][0], `${what} ${key}[${i}].${k}: ${v} vs ${fb[j][1]}`)); });
  assert.deepEqual(flat(a.head), flat(b.head), `${what}: head`);
}

test('row 1: a hill on ONE piece of a long track: bit for bit the old lift, and every sample outside it the very same object as the base path\'s', () => {
  const d0 = track(40), off = SC.pieceOffsets(d0), s0 = off[20] + d0.pieces[20].length / 2;
  const d = SC.brush(d0, { mode: 'hill', s0, r: 60, delta: 3 }).doc;
  const { segments, path } = pathOf(d), now = AD.offsetPath(d, segments, path), was = oldOffsetPath(d, segments, path);
  sameBits(now, was, 'hill');
  const hill = new Set(d.pieces.filter((P) => P.type === 'road' && D.OFFSETS.some((ch) => P.channels[ch].some((v) => v !== 0))).map((P) => P.id));
  assert.ok(hill.size >= 1 && hill.size < 5, `the hill is on a few pieces (${hill.size})`);
  let outside = 0; path.samples.forEach((x, i) => { if (!hill.has(segments[x.seg].id)) { outside++; assert.equal(now.samples[i], x, `sample ${i} is outside the hill: the same object`); } });
  assert.ok(outside > 1000, `most of the track is outside the hill (${outside} samples)`);
});

test('row 2: a swerve across a joint, and offsets on every piece: bit for bit the old lift', () => {
  const d0 = track(12), off = SC.pieceOffsets(d0);
  const swerve = SC.brush(d0, { mode: 'swerve', s0: off[6], r: 120, delta: 2 }).doc;   // centred on the joint between pieces 5 and 6
  let p = pathOf(swerve); sameBits(AD.offsetPath(swerve, p.segments, p.path), oldOffsetPath(swerve, p.segments, p.path), 'swerve across a joint');
  let all = d0; for (let i = 0; i < all.pieces.length; i++) all = SC.brush(all, { mode: 'hill', s0: SC.pieceOffsets(all)[i] + all.pieces[i].length / 2, r: all.pieces[i].length / 2, delta: 1 }).doc;
  p = pathOf(all); sameBits(AD.offsetPath(all, p.segments, p.path), oldOffsetPath(all, p.segments, p.path), 'offsets on every piece');
});

test('row 3: no offset anywhere: the very same path object back', () => {
  const d = track(4), { segments, path } = pathOf(d);
  assert.equal(AD.offsetPath(d, segments, path), path);
});
