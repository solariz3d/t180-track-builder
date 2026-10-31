// preview-flowmemo.test.js: node --test app/test/preview-flowmemo.test.js
// THE PREVIEW'S TEXTURE MEMO (app/preview/preview.js texturedBatches). A textured tube cell's flowed uvs are kept by the cell's own uvs array, so an edit that keeps
// a cell's array keeps its flowed copy. But a cell's flow reads more than its own array (src/texture/flow.js flowCell): its FIRST row takes the segment before's
// end section, and a closed ring takes its run's one number of repeats round (from the run's median circumference). Rows:
//   1  sculpt the segment before a textured tube cell (p2's last metres, before p3): the cell's row-0 uvs follow, equal to a fresh flow of the edited track
//   2  sculpt elsewhere in the ring run (p1's width, which moves the run's median): a tube cell the model KEPT follows too, equal to a fresh flow
//   3  an edit that changes nothing a cell reads keeps that cell's very same flowed array (the memo still works)
// (The model updates its mesh state in place, so a "before" flow is taken before the edit, never from the old track object after it.)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const SC = require('../../src/core/sculpt.js');
const A = require('../../src/core/adapter.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const { texturedBatches } = require('../preview/preview.js');
const { createCoreTextures } = require('../core/textures.js');

/** A tube at 360 easing 60 m -> 32 m over a 100 m piece (p2), between two held pieces (p1 at 60 m, p3 at 32 m): one ring run p1-p3. */
const easing = () => extend(extend(extend(D.createDoc('easing ring'), { length: 200, first: { w: 60, t: 360 } }), { length: 100, targets: { w: 32 } }), { length: 200 });
const resolvedOf = (d) => ({ segments: A.toSegments(d), closed: false, start: { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch } });
/** The index in the track's batches of piece `id`'s cell number `n` (road cells only). */
const cellOf = (tr, id, n = 0) => { let seen = -1; return tr.mesh.cells.findIndex((c) => !c.seam && tr.segments[c.piece] && tr.segments[c.piece].id === id && ++seen === n); };
const Kof = (tr, k) => tr.mesh._state.pieces[tr.mesh.cells[k].piece].K;
const most = (a, b) => { let x = 0; for (let i = 0; i < a.length; i++) x = Math.max(x, Math.abs(a[i] - b[i])); return x; };
/** A model with the easing tube placed and flowed once (the memo filled), the set, and the memo. */
function placed() {
  const d0 = easing(), model = createTrackModel(), t0 = model.update(resolvedOf(d0));
  const set = createCoreTextures({ segments: () => t0.segments, kind: 'asphalt' }).current(), memo = new WeakMap();
  return { d0, model, t0, set, memo, first: texturedBatches(t0, set, memo) };
}

test('preview texture memo: sculpting the segment before a textured tube cell moves that cell\'s row-0 uvs to a fresh flow\'s', () => {
  const { d0, model, set, memo } = placed();
  const sc = SC.sculpt(d0, { channel: 'w', s0: 292, r: 8, delta: 4 });   // p2's last metres (p2 runs 200-300 m)
  assert.ok(sc.changed.some((c) => sc.doc.pieces[c.piece].id === 'p2'), `the sculpt reached p2: ${JSON.stringify(sc.changed)}`);
  const t1 = model.update(resolvedOf(sc.doc)), k = cellOf(t1, 'p3'), K = Kof(t1, k);
  const got = texturedBatches(t1, set, memo)[k].uvs, fresh = texturedBatches(t1, set, new WeakMap())[k].uvs;
  assert.deepEqual(Array.from(got.slice(0, 2 * K)), Array.from(fresh.slice(0, 2 * K)), 'p3\'s first cell\'s row 0 is the fresh flow\'s');
  assert.equal(most(got, fresh), 0, 'and so is the whole cell');
});

test('preview texture memo: a sculpt elsewhere in the ring run (p1\'s width) moves a tube cell the model kept, to a fresh flow\'s', () => {
  const { d0, model, t0, set, memo, first } = placed();
  const k = cellOf(t0, 'p3', 3), before = first[k].uvs, kept = t0.batches[k].uvs;
  const sc = SC.sculpt(d0, { channel: 'w', s0: 100, r: 95, delta: -26 });   // most of p1 narrowed: the run's median, and so its repeats round, moves
  assert.ok(sc.changed.every((c) => sc.doc.pieces[c.piece].id === 'p1'), `the sculpt changed p1 only: ${JSON.stringify(sc.changed)}`);
  const t1 = model.update(resolvedOf(sc.doc));
  assert.equal(t1.batches[k].uvs, kept, 'the model KEPT p3\'s cell (its own array is the same)');
  const got = texturedBatches(t1, set, memo)[k].uvs, fresh = texturedBatches(t1, set, new WeakMap())[k].uvs;
  assert.ok(most(fresh, before) > 0.1, `the fresh flow moved (by ${most(fresh, before)} of a tile), so this row tests something`);
  assert.equal(most(got, fresh), 0, `the memo's answer is the fresh flow's (it was ${most(got, fresh)} of a tile away)`);
});

test('preview texture memo: an edit that changes nothing a cell reads keeps that cell\'s very same flowed array', () => {
  const { d0, model, t0, set, memo, first } = placed();
  const k = cellOf(t0, 'p2', 1);   // p2's second cell
  const sc = SC.sculpt(d0, { channel: 'w', s0: 480, r: 8, delta: 2 });   // far down p3 (p3 runs 300-500 m)
  const t1 = model.update(resolvedOf(sc.doc)), b = texturedBatches(t1, set, memo);
  assert.equal(t1.batches[k].uvs, t0.batches[k].uvs, 'the model kept p2\'s cell');
  assert.equal(b[k].uvs, first[k].uvs, 'and the memo kept its flowed array: nothing it reads changed');
});
