// preview-undo.test.js: node --test app/test/preview-undo.test.js
// Undo of a placement in the track model (the keeper, 2026-10-12: "undoing the last piece lags too long"). An undo straight back over the last
// placement puts back the copy the model kept before it grew (app/preview/trackmodel.js UNDO OF A PLACEMENT) instead of rebuilding the track.
// It is only worth having if it is the track: rows
//   1  after place-then-undo the model's batches equal a fresh full build of the same document, with no mesh built, and placing again from
//      the restored track equals a fresh full build too (the copy is a sound base to grow from)
//   2  with a hill (the lift: the equation core's height offsets) on the track: the same
//   3  a change in between (a brush after the placement) drops the copy: the undo is a rebuild, and still equals a fresh full build
//   4  undoing two placements in a row: the first is restored, the second is rebuilt, both equal a fresh full build
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('util');
const G = require('../../src/geom/index.js');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');

const R = 180, Q = (Math.PI * R) / 2;
/** A model whose geom counts the full mesh builds, so a test can tell a restore from a rebuild. */
function counted() { const n = { build: 0 }, geom = { ...G, buildMesh: (...a) => { n.build++; return G.buildMesh(...a); } }; return { model: createTrackModel({ geom }), n }; }
/** The model's batches equal a fresh model's full build of the same resolved document. */
function sameAsFresh(r, resolved, what) {
  const fresh = createTrackModel().update(resolved);
  assert.equal(r.batches.length, fresh.batches.length, `${what}: batch count`);
  const bad = r.batches.findIndex((b, i) => !isDeepStrictEqual(b, fresh.batches[i]));
  assert.equal(bad, -1, `${what}: batch ${bad} differs from a fresh full build`);
  assert.ok(isDeepStrictEqual(r.bounds, fresh.bounds), `${what}: bounds`);
}
async function track() {
  const s = await createCoreShell({});
  s.extend({ length: 200, family: 'bowl' });
  s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 300, first: { c: 30 } });
  s.extend({ length: 150, targets: { e: 20, er: 5 } });
  return s;
}

test('row 1: place then undo restores the track without meshing it, equal to a fresh full build, and placing again from it equals a fresh build', async () => {
  const s = await track(), { model, n } = counted();
  model.update(s.getState().resolved);
  s.extend({ length: 200 }); assert.equal(model.update(s.getState().resolved).how, 'extend');
  const before = n.build; s.undo(); const r = model.update(s.getState().resolved);
  assert.equal(n.build, before, 'the undo built no mesh');
  sameAsFresh(r, s.getState().resolved, 'after the undo');
  s.extend({ length: 120, transition: 40, targets: { kh: -1 / 250 } }); const g = model.update(s.getState().resolved);
  assert.equal(g.how, 'extend', 'growing again from the restored track is an extend');
  sameAsFresh(g, s.getState().resolved, 'placed again after the undo');
});

test('row 2: with a hill on the track (the lift), place then undo is restored and equal to a fresh full build', async () => {
  const s = await track();
  s.beginBrush({ channel: 'height', s0: 150, r: 60 }); s.brushTo(3); s.endBrush();
  assert.equal(s.getState().message, null, s.getState().message);
  const { model, n } = counted(); model.update(s.getState().resolved);
  s.extend({ length: 200 }); model.update(s.getState().resolved);
  const before = n.build; s.undo(); const r = model.update(s.getState().resolved);
  assert.equal(n.build, before, 'restored, not rebuilt');
  sameAsFresh(r, s.getState().resolved, 'hill, after the undo');
});

test('row 3: a brush between the placement and the undo drops the copy: the undo rebuilds, and equals a fresh full build', async () => {
  const s = await track(), { model, n } = counted();
  model.update(s.getState().resolved);
  s.extend({ length: 200 }); model.update(s.getState().resolved);
  s.beginBrush({ channel: 'height', s0: 150, r: 60 }); s.brushTo(3); s.endBrush(); model.update(s.getState().resolved);
  s.undo(); model.update(s.getState().resolved);   // the brush undone
  const before = n.build; s.undo(); const r = model.update(s.getState().resolved);   // the placement undone
  assert.ok(n.build > before, 'no copy to put back: a rebuild');
  sameAsFresh(r, s.getState().resolved, 'after the brush and both undos');
});

test('row 5: a SCULPT of the restored track (it re-places the path\'s blocks in place) still equals a fresh full build: the restored samples read the blocks the path holds', async () => {
  const s = await track(), { model } = counted();
  model.update(s.getState().resolved);
  s.extend({ length: 200 }); model.update(s.getState().resolved);
  s.undo(); model.update(s.getState().resolved);   // restored from the copy
  s.beginBrush({ mode: 'rate', channel: 'kh', s0: 300, r: 60 }); s.brushTo(0.0005); s.endBrush();
  assert.equal(s.getState().message, null, s.getState().message);
  const r = model.update(s.getState().resolved);
  assert.equal(r.how, 'sculpt', 'the restored track is sculpted in place');
  // (a sculpt moves later pieces rigidly, so its MESH may differ from a fresh build by rounding, with or without an undo; the path may not)
  const fresh = createTrackModel().update(s.getState().resolved);
  const bad = r.path.samples.findIndex((x, i) => !isDeepStrictEqual(x.pos, fresh.path.samples[i].pos));
  assert.equal(bad, -1, `sample ${bad} of the restored path is stale`);
});

test('row 4: two placements undone in a row: the first is restored, the second rebuilt, both equal a fresh full build', async () => {
  const s = await track(), { model, n } = counted();
  model.update(s.getState().resolved);
  s.extend({ length: 200 }); model.update(s.getState().resolved);
  s.extend({ length: 100 }); model.update(s.getState().resolved);
  let before = n.build; s.undo(); let r = model.update(s.getState().resolved);
  assert.equal(n.build, before, 'the last placement is restored');
  sameAsFresh(r, s.getState().resolved, 'one undo');
  before = n.build; s.undo(); r = model.update(s.getState().resolved);
  assert.ok(n.build > before, 'the one before has no copy: a rebuild');
  sameAsFresh(r, s.getState().resolved, 'two undos');
});
