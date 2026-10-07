// core_grip.test.js: node --test test/core_grip.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D261 step 2, GRIP PER PIECE, the core (the keeper, 18:46: "it would be interesting to be able to change which piece has different grip, than the global
// track being one value"; the plan: exo_memory/loop/plan_t180_piece_grip_2026-10-06.md). A road piece carries `grip`, an integer percent of AC's road
// friction, 50 to 150, default 100. It lives ON THE PIECE (it changes at piece boundaries, never smoothly), it is written in the file only when it is not
// 100 (so every track made before it, and every all-100 track, saves byte for byte as before), and it is carried by saved pieces and mirror, and left
// alone by Close, Sculpt, delete and the free jump. The export's keys come in step 2's second half.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../src/core/document.js');
const PC = require('../src/core/piece.js');
const SC = require('../src/core/sculpt.js');
const J = require('../src/core/jump.js');
const RO = require('../src/core/readout.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');

const R = 180, Q = Math.PI * R / 2;
const grips = (d) => d.pieces.filter((P) => P.type === 'road').map((P) => D.gripOf(P));
/** Three straights: p1 100, p2 70, p3 125. */
const three = () => { let d = extend(D.createDoc('g'), { length: 100, family: 'bowl' }); d = extend(d, { length: 100, grip: 70 }); return extend(d, { length: 100, grip: 125 }); };
/** A closed lap whose pieces have different grips: a straight at 80, four quarter turns, a straightening at 110. */
function gripLap() {
  let d = extend(D.createDoc('lap'), { length: 300, family: 'bowl', grip: 80 });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R }, grip: i === 1 ? 140 : 100 });
  return extend(d, { length: 60, transition: 40, targets: { kh: 0 }, grip: 110 });
}

test('a piece\'s grip is an integer percent on the piece, default 100; Extend takes one, and carries the last piece\'s grip when none is given', () => {
  assert.deepEqual(grips(three()), [100, 70, 125]);
  assert.equal(three().pieces[0].grip, undefined, 'a 100% piece carries no grip field at all');
  assert.deepEqual(grips(extend(three(), { length: 50 })), [100, 70, 125, 125], 'the next piece keeps the road\'s grip until it is changed');
});

test('setGrip changes the chosen pieces only, on an open or a CLOSED track, and 100 removes the field', () => {
  const d = D.setGrip(three(), [0, 2], 60);
  assert.deepEqual(grips(d), [60, 70, 60]);
  assert.equal(D.setGrip(d, [0], 100).pieces[0].grip, undefined);
  const lap = close(gripLap(), { edited: [5] }).doc;
  assert.equal(lap.closed, true);
  assert.deepEqual(grips(D.setGrip(lap, [2], 90)), [80, 100, 90, 100, 100, 110]);
});

test('refused by name (BAD_GRIP): 49, 151, 100.5, a string, NaN; and setGrip on a flight (NOT_ROAD) or a piece that does not exist (BAD_INDEX)', () => {
  const t = three();
  for (const bad of [49, 151, 100.5, '80', NaN, null]) {
    assert.throws(() => D.setGrip(t, [1], bad), (e) => e.code === 'BAD_GRIP', `setGrip ${bad}`);
    assert.throws(() => extend(t, { length: 50, grip: bad }), (e) => e.code === 'BAD_GRIP', `extend ${bad}`);
  }
  for (const ok of [50, 150]) assert.equal(D.gripOf(D.setGrip(t, [1], ok).pieces[1]), ok, `${ok} is inside the range`);
  const j = J.jumpHere(t, null);
  assert.throws(() => D.setGrip(j, [3], 80), (e) => e.code === 'NOT_ROAD');
  assert.throws(() => D.setGrip(t, [7], 80), (e) => e.code === 'BAD_INDEX');
});

test('the file: a grip is written only when it is not 100, reads back exactly, and a file with no grip reads 100 everywhere', () => {
  const d = three(), text = D.serialize(d), back = D.parse(text);
  assert.deepEqual(back, d); assert.equal(D.serialize(back), text);
  assert.match(text, /"family":"bowl","grip":70,/); assert.equal((text.match(/"grip":/g) || []).length, 2, 'only the two pieces that are not 100');
  const plain = extend(extend(D.createDoc('p'), { length: 100, family: 'bowl' }), { length: 100 });
  assert.ok(!/"grip"/.test(D.serialize(plain)), 'an all-100 track carries no grip in its text');
  const F1 = fs.readFileSync(path.join(__dirname, 'fixtures', 'F1-bowl-default-lap-closed.core2.json'), 'utf8');
  assert.deepEqual(grips(D.parse(F1)), [100, 100, 100, 100, 100, 100], 'an old file reads 100 everywhere');
});

test('the file: a grip out of range or not an integer is refused by name when it is read (BAD_GRIP); "grip": 100 in a file reads as no grip', () => {
  const o = JSON.parse(D.serialize(three()));
  for (const bad of [49, 151, 100.5, '70', null]) { const x = JSON.parse(JSON.stringify(o)); x.pieces[1].grip = bad; assert.throws(() => D.parse(JSON.stringify(x)), (e) => e.code === 'BAD_GRIP', `${bad}`); }
  const h = JSON.parse(JSON.stringify(o)); h.pieces[1].grip = 100;
  const back = D.parse(JSON.stringify(h)); assert.equal(back.pieces[1].grip, undefined); assert.ok(!/"grip":100/.test(D.serialize(back)));
});

test('Close leaves every piece\'s grip as it was', () => {
  const d = gripLap(), c = close(d, { edited: [5] });
  assert.equal(c.converged, true, c.report);
  assert.deepEqual(grips(c.doc), grips(d));
});

test('Sculpt and the brushes leave every piece\'s grip as it was', () => {
  const d = three();
  for (const opt of [{ mode: 'value', channel: 'phi', s0: 150, r: 60, delta: 0.1 }, { mode: 'hill', s0: 150, r: 60, delta: 3 }, { mode: 'value', channel: 'w', s0: 150, r: 40, delta: -2 }]) {
    const r = SC.brush(d, opt); assert.deepEqual(grips(r.doc), [100, 70, 125], JSON.stringify(opt));
  }
});

test('delete keeps each piece\'s own grip: at the open end and in the middle (the far side re-joined)', () => {
  const d = three();
  assert.deepEqual(grips(PC.deleteRun(d, 2)), [100, 70]);
  assert.deepEqual(grips(PC.deleteRun(d, 1)), [100, 125]);
});

test('the free jump keeps each road piece\'s grip, and its landing starts at the take-off\'s', () => {
  const d = J.jumpHere(three(), null), roads = d.pieces.filter((P) => P.type === 'road');
  assert.deepEqual(roads.map((P) => D.gripOf(P)), [100, 70, 125, 125]);
  assert.deepEqual(grips(J.setLanding(d, { forward: 60 })), [100, 70, 125, 125]);
});

test('saved pieces carry grip: a run saved, written, read and inserted keeps each piece\'s grip, and its mirror keeps it too', () => {
  const d = three(), sp = PC.parse(PC.serialize(PC.saveRun(d, 0, 2, { name: 'grips' })));
  assert.deepEqual(sp.pieces.map((P) => (P.grip === undefined ? 100 : P.grip)), [100, 70, 125]);
  const head = extend(D.createDoc('h'), { length: 80, family: 'bowl' });
  assert.deepEqual(grips(PC.insert(head, sp)), [100, 100, 70, 125]);
  assert.deepEqual(grips(PC.insert(head, sp, { mirror: true })), [100, 100, 70, 125]);
  const bad = JSON.parse(PC.serialize(sp)); bad.pieces[1].grip = 200;
  assert.throws(() => PC.checkPiece(bad), (e) => e.code === 'BAD_GRIP');
});

test('the readout says each road piece\'s grip, for the hover label', () => {
  const d = three();
  assert.deepEqual([0, 1, 2].map((i) => RO.pieceReadout(d, i).gripPct), [100, 70, 125]);
});
