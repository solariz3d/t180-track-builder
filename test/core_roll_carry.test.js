// core_roll_carry.test.js: node --test test/core_roll_carry.test.js
// THE ROLL CARRIED THROUGH A JOINT, as built (the user, 2026-11-02, on RIBBON CORKSCREW TEST: "on some turns there are bumps from connecting different banking, it is
// shown completely with the telemetry going through the last straight ribbon section that goes banked 90 degrees all the way around 360 degrees"). Each piece's bank
// ramp starts and ends at rest (src/core/extend.js), so where the next piece rolls on the same way the road's roll stopped at the joint and started again: on his
// ribbon (250 m pieces banking -90° each) the built roll rate fell from 0.516 °/m mid-piece to 0.006 °/m at every joint. The ribbon here is laid as the panel lays
// it (app/core/panel.js extendOptions, his values); its last three pieces' bank channels are his save's exactly. Rows:
//   1  through each of the ribbon's rolling joints, the built roll rate stays at least half its mid-piece rate (before: about 1%)
//   2  the carry moves nothing it should not: the bank at every joint (the straight's end and the ribbon's end among them) is the document's, and the run's
//      outer halves (the first rolling piece's first half, the last one's second) are built as the document lays them
//   3  the built roll stays C2 through the joints: from the first rolling piece's middle to the last one's, its rate moves by no more than 0.01 °/m from one
//      2 m segment to the next (before: up to 0.07 °/m where a ramp eased into a joint)
//   4  where the roll does not run on the same way across a joint it is the document's own, segment for segment: a roll that turns back, a bank held
//      between two rolls, and a ribbon whose next piece rolls the other way
//   5  the per-piece cache: after the next piece is added, the piece before is built carried (the cached build equals a fresh one)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180;
const opts = (length, bank) => extendOptions({ length: String(length), turn: '', climb: '', bank: String(bank), width: '', cup: '', edge: '', start: '', tube: '', atStart: {}, turnAs: 'rate' });
const lay = (banks, L = 250) => { let d = extend(D.createDoc('ribbon'), { length: 100, family: 'bowl' }); for (const b of banks) d = extend(d, opts(L, b)); return d; };
const RIBBON = [-90, -180, -270, -359.99];
// the path at each 2 m segment's end (src/geom/path.js eases the roll inside a segment, so 0.5 m samples there read 0.225 to 0.495 °/m for a steady 0.360; the
// segment ends carry the roll the adapter laid)
const samples = (doc) => A.toPath(doc).path.samples.map((x) => ({ s: x.s, roll: x.roll })).filter((x) => Math.abs(x.s / 2 - Math.round(x.s / 2)) < 1e-9);
const rollRate = (P) => P.map((x, i) => (i ? (x.roll - P[i - 1].roll) / (x.s - P[i - 1].s) / DEG : 0));
const jointsOf = (doc) => { let s = 0; return doc.pieces.map((P) => (s += P.length)); };
const rollAt = (P, s) => { let best = P[0]; for (const x of P) if (Math.abs(x.s - s) < Math.abs(best.s - s)) best = x; return best.roll / DEG; };
const docRollAt = (doc, s) => { let o = 0; for (const P of doc.pieces) { if (s <= o + P.length + 1e-9) return D.valuesAt(P, s - o).phi / DEG; o += P.length; } return null; };

test('row 1: through each of the ribbon\'s rolling joints, the built roll rate stays at least half its mid-piece rate', () => {
  const doc = lay(RIBBON), P = samples(doc), r = rollRate(P), J = jointsOf(doc), got = [];
  for (const j of J.slice(1, 4)) {   // the joints between the four rolling pieces
    const mid = Math.abs(r[P.findIndex((x) => x.s >= j - 125)]);
    const slow = Math.min(...P.map((x, i) => [x.s, Math.abs(r[i])]).filter(([s]) => s > j - 60 && s < j + 60).map(([, v]) => v));
    got.push({ joint: j, mid: +mid.toFixed(4), slowest: +slow.toFixed(4) });
    assert.ok(slow >= 0.5 * mid, `the roll stops at the joint at s ${j}: ${slow.toFixed(4)} °/m against ${mid.toFixed(4)} mid-piece (all: ${JSON.stringify(got)})`);
  }
});

test('row 2: the carry moves nothing it should not: the bank at every joint is the document\'s, and the run\'s outer halves are built as the document lays them', () => {
  const doc = lay(RIBBON), P = samples(doc), J = jointsOf(doc), near = (x, s) => Math.abs(x.s - s) < 1e-9;
  const check = (x, what) => { const d = docRollAt(doc, x.s); assert.ok(Math.abs(x.roll / DEG - d) < 1e-6, `${what} at s ${x.s}: built ${(x.roll / DEG).toFixed(4)}°, the document ${d.toFixed(4)}°`); };
  for (const j of J) check(P.find((x) => near(x, j)), 'a joint');
  for (const x of P) if ((x.s >= J[0] && x.s <= J[0] + 125) || (x.s >= J[4] - 125 && x.s <= J[4])) check(x, 'an outer half');
});

test('row 3: the built roll stays C2 through the joints: its rate moves by at most 0.01 °/m from one sample to the next', () => {
  // from the first rolling piece's middle to the last one's: the joints the carry spans (the bank's own rise off the straight at s 100 is not one of them)
  const doc = lay(RIBBON), P = samples(doc), r = rollRate(P), J = jointsOf(doc), from = J[0] + 125, to = J[3] + 125;
  let worst = 0, at = 0; for (let i = 2; i < r.length; i++) { if (P[i - 1].s < from || P[i].s > to) continue; const d = Math.abs(r[i] - r[i - 1]); if (d > worst) { worst = d; at = P[i].s; } }
  assert.ok(worst <= 0.01, `the roll rate jumps ${worst.toFixed(4)} °/m between samples at s ${at.toFixed(1)}`);
});

test('row 4: where the roll does not run on the same way across a joint, the built roll is the document\'s own, segment for segment', () => {
  for (const [name, banks] of [['a roll that turns back', [-30, 0]], ['a bank held between two rolls', [-30, -30, -60]], ['a ribbon whose next piece rolls the other way', [-90, 0]]]) {
    const doc = lay(banks), segs = A.toSegments(doc), J = [0, ...jointsOf(doc)];
    let s = 0, worst = 0;
    for (const g of segs) {
      const pi = doc.pieces.findIndex((P) => P.id === g.id), base = J[pi], P = doc.pieces[pi];
      worst = Math.max(worst, Math.abs(g.roll0 - D.valuesAt(P, s - base).phi), Math.abs(g.roll1 - D.valuesAt(P, s + g.length - base).phi));
      s += g.length;
    }
    assert.ok(worst < 1e-12, `${name}: the built roll differs from the document by ${worst} rad`);
  }
});

test('row 5: after the next piece is added, the piece before is built carried: the cached build equals a fresh one', () => {
  const cache = new Map(), three = lay(RIBBON.slice(0, 2));
  A.toSegments(three, { cache });
  const four = extend(three, opts(250, -270));
  const cached = A.toSegments(four, { cache }).map((g) => [g.id, g.roll0, g.roll1]), fresh = A.toSegments(four).map((g) => [g.id, g.roll0, g.roll1]);
  assert.deepEqual(cached, fresh, 'the cache rebuilt the piece whose next piece now carries its roll');
});
