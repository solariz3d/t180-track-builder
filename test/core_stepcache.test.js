// core_stepcache.test.js: node --test test/core_stepcache.test.js
// D421 (O's shell cut, the chair's 2026-10-21 00:31Z pass): two per-drag-step costs, profiled on sculpt-frame rows 2, 4a and 4b, are now worked out once and kept:
//  - src/core/sculpt.js brush(): a hill's or swerve's peak ratio (a unit brush, then the window read every 0.25 m) is a pure function of the document, the channel,
//    s0 and r. A drag re-brushes the SAME frozen base at every step, so it is kept per base document (a WeakMap, as SEG_CACHE is) and the step divides by it.
//  - src/geom/profile.js commonFractions(): a pure function of the profiles it is given and its options, run again on every tube piece converted; kept by value.
// GEOMETRY tier: both are exact. These rows compare the kept answer with one worked out afresh, as text and with Object.is. Rows:
//   1  a hill and a swerve on the same frozen base, again and again: every answer is the one an unfrozen copy (which is never kept) gives; a different r or s0 is not the kept one
//   2  an unfrozen document written in place between two brushes: the second brush reads the written document, not a ratio kept from the first
//   3  commonFractions gives the same numbers for the same profiles, a fresh array each time (no caller can change another's), and other options or profiles are not the kept answer
// (stepcache-mutants.js in the hand-back's evidence breaks each property in turn; every one goes red)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../src/core/sculpt.js');
const D = require('../src/core/document.js');
const P = require('../src/geom/profile.js');
const { extend } = require('../src/core/extend.js');

function track() { let d = D.createDoc('t'); d = extend(d, { length: 200, family: 'bowl' }); for (let i = 1; i < 12; i++) d = extend(d, { length: 200, transition: 40, targets: { kh: (i % 2 ? 1 : -1) / 900 } }); return d; }
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const unfrozen = (d) => JSON.parse(JSON.stringify(d));   // the same document, never kept (not frozen)

test('row 1: a hill and a swerve on one frozen base, again and again, give what a fresh copy gives; another r or s0 is not the kept answer', () => {
  const base = deepFreeze(track()), off = SC.pieceOffsets(base);
  for (const mode of ['hill', 'swerve']) {
    for (const [s0, r, delta] of [[off[5] + 50, 200, 3], [off[5] + 50, 200, -1.5], [off[5] + 50, 60, 3], [off[7], 200, 3], [off[5] + 50, 200, 3]]) {
      const kept = SC.brush(base, { mode, s0, r, delta }).doc, fresh = SC.brush(unfrozen(base), { mode, s0, r, delta }).doc;
      assert.equal(D.serialize(kept), D.serialize(fresh), `${mode} at s0 ${s0}, r ${r}, delta ${delta}`);
    }
  }
});

test('row 2: an unfrozen document written in place between two brushes is brushed as written, not with a ratio kept from before', () => {
  for (const mode of ['hill', 'swerve']) {
    const doc = unfrozen(track()), off = SC.pieceOffsets(doc), s0 = off[5] + 50;
    SC.brush(doc, { mode, s0, r: 60, delta: 3 });
    // in place: the knot at 60 m moves to 55 m, under the brush, so the peak per unit change is another number. The piece's knots ARRAY is replaced, not written:
    // brush freezes the arrays its result shares with a plain input (so it did at 969ecac, before this cut), while the piece object itself stays writable
    doc.pieces[5].knots = doc.pieces[5].knots.map((t, k) => (k === 2 ? 55 : t));
    assert.equal(D.serialize(SC.brush(doc, { mode, s0, r: 60, delta: 3 }).doc), D.serialize(SC.brush(unfrozen(doc), { mode, s0, r: 60, delta: 3 }).doc), mode);
  }
});

test('row 3: commonFractions gives the same numbers for the same profiles, a fresh array each time, and other options or profiles are not the kept answer', () => {
  // A, and two that differ from it in one thing each: U in u only, S in psi only (so a key missing either is caught), with the same count of profiles throughout
  const A = { u: [-4, -2, 0, 2, 4], psi: [0.6, 0.2, 0, 0.2, 0.6] }, U = { u: [-5, -2, 0, 2, 5], psi: A.psi }, S = { u: A.u, psi: [0.9, 0.2, 0, 0.2, 0.9] };
  const same = (x, y, what) => { assert.equal(x.length, y.length, what); x.forEach((v, i) => assert.ok(Object.is(v, y[i]), `${what}: fraction ${i}`)); };
  // what an ask gives with nothing kept for it: options this file never asks with otherwise, so the first ask of them is always computed
  const a = P.commonFractions([A, A]), b = P.commonFractions([A, A]);
  assert.notEqual(a, b, 'a fresh array each time'); same(a, b, 'the same profiles twice');
  b[0] = 99; b.length = 1; same(P.commonFractions([A, A]), a, 'after a caller wrote the copy it got');
  // each of these is asked AFTER [A, A] is kept, so a key that missed what differs would hand back A's answer
  for (const [what, list, o] of [['u only', [U, U]], ['psi only', [S, S]], ['maxAcross', [A, A], { maxAcross: 0.5 }], ['maxSeam', [A, A], { maxSeam: Math.PI / 360 }]]) {
    assert.notDeepEqual(P.commonFractions(list, o), a, `${what}: not A's answer`);
  }
});
