// core_edgesplit.test.js: node --test test/core_edgesplit.test.js
// The right edge er (the user, 2026-10-12: "lower the angle on one side and increase the banking of the edge on the other, say for a right turn,
// the left of the track will be more banked, but the inside of the right turn will be turned down so the inside isnt banked"). Rows:
//   1  an edge angle typed alone sets both sides, and the file is exactly what it was before er existed (core/4, no er)
//   2  e 30 and er 0: the left rim tilts the cup plus 30°, the right rim only the cup; the file is core/5 and reads back to the same text
//   3  the piece after a split piece continues each side on its own, with no step at the joint
//   4  a right edge past the cap is refused by name, like the edge angle
//   5  a core/4 edge file (every file made before) reads with its right side equal to its left
//   6  the panel: the "right edge" field becomes the er target; blank leaves it to follow the edge angle
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const AD = require('../src/core/adapter.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180;
const cupTrack = () => extend(D.createDoc('t'), { length: 200, family: 'bowl', first: { c: 10 } });
const rims = (d) => { const p = AD.toSegments(d).slice(-1)[0].profile; return { right: p.psi[0] / DEG, left: p.psi[p.psi.length - 1] / DEG }; };

test('row 1: an edge angle typed alone sets both sides, and the file is what it was before er (core/4, no er)', () => {
  const d = extend(cupTrack(), { length: 200, targets: { e: 30 } }), P = d.pieces[1], end = D.valuesAt(P, P.length), text = D.serialize(d);
  assert.equal(end.er, end.e); assert.equal(D.isSplit(P), false);
  assert.equal(JSON.parse(text).schema, 't180b.core/4'); assert.ok(!text.includes('"er"'), 'no er in the text');
  const r = rims(d); assert.ok(Math.abs(r.left - r.right) < 1e-9, `both rims alike (${r.left}, ${r.right})`);
});

test('row 2: e 30 and er 0 bank the left rim 30° past the cup and leave the right rim at the cup; the file is core/5 and round-trips', () => {
  const d = extend(cupTrack(), { length: 200, targets: { e: 30, er: 0, kh: -1 / 300 } }), r = rims(d);
  assert.ok(Math.abs(r.right - 10) < 1e-6, `right rim at the cup's 10° (${r.right})`);
  assert.ok(Math.abs(r.left - 40) < 1e-6, `left rim at 10 + 30 (${r.left})`);
  const text = D.serialize(d); assert.equal(JSON.parse(text).schema, 't180b.core/5'); assert.ok(text.includes('"er"'));
  assert.equal(D.serialize(D.parse(text)), text);
  // and the mirror: a left turn's inside is the left
  const m = rims(extend(cupTrack(), { length: 200, targets: { e: 0, er: 30, kh: 1 / 300 } }));
  assert.ok(Math.abs(m.left - 10) < 1e-6 && Math.abs(m.right - 40) < 1e-6, JSON.stringify(m));
});

test('row 3: the piece after a split piece continues each side on its own, with no step at the joint', () => {
  let d = extend(cupTrack(), { length: 200, targets: { e: 30, er: 5 } });
  d = extend(d, { length: 150 });   // nothing typed: both sides continue
  const a = D.pieceEnd(d.pieces[1]), b = D.valuesAt(d.pieces[2], 0);
  assert.ok(d.pieces[2].edge, 'still an edge piece');
  assert.ok(Math.abs(b.e - a.e.v) < 1e-6 && Math.abs(b.er - a.er.v) < 1e-6, `left ${a.e.v}→${b.e}, right ${a.er.v}→${b.er}`);
  assert.ok(D.isSplit(d.pieces[2]), 'the sides stay different');
  d = extend(d, { length: 150, targets: { er: 0 } });
  assert.ok(Math.abs(D.valuesAt(d.pieces[3], 150).er) < 1e-6, 'a right edge target alone moves only the right side');
  assert.ok(Math.abs(D.valuesAt(d.pieces[3], 150).e - a.e.v) < 1e-3, 'and the left one holds');
});

test('row 4: a right edge past the cap is refused by name, as the edge angle is', () => {
  assert.throws(() => extend(cupTrack(), { length: 200, targets: { e: 0, er: 145 } }), (e) => e.code === 'BAD_EDGE' && /right edge/.test(e.message));
  assert.throws(() => extend(cupTrack(), { length: 200, targets: { er: -200 } }), (e) => e.code === 'BAD_EDGE' && /floor/.test(e.message));   // D406: -1 is allowed now
});

test('row 5: a core/4 edge file reads with its right side equal to its left', () => {
  const text = D.serialize(extend(cupTrack(), { length: 200, targets: { e: 20 } })), d = D.parse(text), P = d.pieces[1];
  assert.deepEqual(P.channels.er, P.channels.e); assert.equal(D.serialize(d), text);
});

test('row 7: Flatten road for pit lowers BOTH sides\' edges (a right-side lane on a split or symmetric edge must not keep a 20° right rim)', () => {
  const { flattenUnder } = require('../src/core/pitflat.js');
  for (const targets of [{ e: 20 }, { e: 30, er: 20 }]) {
    const d = flattenUnder(extend(cupTrack(), { length: 400, targets }), { s0: 300, s1: 500, ramp: 60 }), v = D.valuesAt(d.pieces[1], 200);
    assert.ok(Math.abs(v.e) < 1e-6 && Math.abs(v.er) < 1e-6, `${JSON.stringify(targets)}: left ${v.e}, right ${v.er} beside the lane`);
  }
});

test('row 8: a saved piece keeps its sides, its mirror swaps them, and a symmetric saved piece writes no er (its file is what it was)', () => {
  const PC = require('../src/core/piece.js');
  const split = extend(cupTrack(), { length: 200, targets: { e: 30, er: 5 } }), sym = extend(cupTrack(), { length: 200, targets: { e: 20 } });
  const a = PC.saveRun(split, 1, 1, { name: 'split' }), b = PC.saveRun(sym, 1, 1, { name: 'sym' });
  assert.ok(PC.serialize(a).includes('"er"')); assert.ok(!PC.serialize(b).includes('"er"'), 'a symmetric piece file has no er');
  assert.equal(PC.serialize(PC.parse(PC.serialize(a))), PC.serialize(a), 'the split piece round-trips');
  const put = (p, mirror) => { const d = PC.insert(cupTrack(), p, { mirror }), P = d.pieces[1]; return D.valuesAt(P, P.length); };
  const plain = put(a, false), mir = put(a, true);
  assert.ok(Math.abs(plain.e - 30) < 1e-3 && Math.abs(plain.er - 5) < 1e-3, `inserted: left ${plain.e}, right ${plain.er}`);
  assert.ok(Math.abs(mir.e - 5) < 1e-3 && Math.abs(mir.er - 30) < 1e-3, `mirrored: left ${mir.e}, right ${mir.er}`);
});

test('row 6: the panel turns the right edge field into the er target; blank leaves it to follow the edge angle', () => {
  assert.deepEqual(extendOptions({ length: '100', edge: '30', edgeR: '0' }).targets, { e: 30, er: 0 });
  assert.deepEqual(extendOptions({ length: '100', edge: '30', edgeR: '' }).targets, { e: 30 });
});
