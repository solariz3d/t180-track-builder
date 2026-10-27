// ghost-stalekey.test.js: node --test app/test/ghost-stalekey.test.js
// D483 part 2: the cheap ghost (a handle being dragged) keeps a new chord's mesh when the chord is the same as the last cheap ghost's at its index. It told that by hashed
// keys; it now compares the chords themselves (app/preview/segkey.js sameContent) against a snapshot of the last ones as they were meshed. Stated before the change: a chord
// that changed never keeps the mesh made from what it was, whoever changed it and however; the unchanged chords are still kept (cheap-ghost.test.js row 6).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const { sameContent, snapshot } = require('../preview/segkey.js');

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { for (const k of Object.keys(o)) deepFreeze(o[k]); Object.freeze(o); } return o; };
const flat = (g) => g.batches.flatMap((b) => Array.from(b.positions || []));
const worst = (a, b) => { assert.equal(a.length, b.length, 'the same vertex count'); let w = 0; for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs(a[i] - b[i])); return w; };

test('a chord handed out with a cheap ghost, changed in place by a reader to what the next candidate holds, does not make the next ghost keep its old mesh', async () => {
  const sh = await createCoreShell({ brushFn: null, autosaveMs: 0 }); sh.extend({ length: 300 });
  const placed = sh.getState().resolved, tm = createTrackModel(); tm.update(placed);
  const c1 = sh.candidate({ length: 1000 }, { coarse: true }), n0 = placed.segments.length, j = n0 + 10;
  // c2: c1 with one new chord bent hard (a 50 m radius), so its mesh in its own frame is not the one c1's chord made
  const c2 = { ...c1, segments: c1.segments.map((g, i) => (i === j ? deepFreeze({ ...g, k0: 0.02, k1: 0.02 }) : g)) };
  const g1 = tm.ghostFor(c1, { cheap: true });
  const fresh2 = createTrackModel(); fresh2.update(placed); const f2 = fresh2.ghostFor(c2, { cheap: true });
  const fresh1 = createTrackModel(); fresh1.update(placed); const f1 = fresh1.ghostFor(c1, { cheap: true });
  assert.ok(worst(flat(f1), flat(f2)) > 0.5, 'control: the bent chord really moves vertices');
  Object.assign(g1.segments[j], f2.segments[j]);   // the reader: the handed-out chord now reads as c2's chord does
  const g2 = tm.ghostFor(c2, { cheap: true });
  assert.ok(worst(flat(g2), flat(f2)) < 1e-3, `the ghost is where a fresh build puts it (worst ${worst(flat(g2), flat(f2))} m)`);
});

test('sameContent: equal content in different objects is the same, frozen or not; a number, a key or a kind that differs is not', () => {
  const a = { k0: 0, profile: { u: [-1, 0, 1], psi: [0, 0, 0] }, blend: { s0: 1 } }, b = JSON.parse(JSON.stringify(a));
  assert.equal(sameContent(a, b), true); assert.equal(sameContent(deepFreeze(JSON.parse(JSON.stringify(a))), b), true);
  assert.equal(sameContent(a, { ...b, k0: 1e-12 }), false, 'a number');
  assert.equal(sameContent(a, { ...b, profile: { ...b.profile, psi: [0, 0, 1e-9] } }), false, 'a number deep inside');
  assert.equal(sameContent(a, { ...b, extra: 1 }), false, 'a key more');
  assert.equal(sameContent({ x: [1, 2] }, { x: { 0: 1, 1: 2 } }), false, 'an array is not an object');
  assert.equal(sameContent({ x: 0 }, { x: -0 }), true, '-0 is 0, as the key reads it');
  assert.equal(sameContent({ x: NaN }, { x: NaN }), false, 'NaN is taken as changed (a rebuild, never a stale mesh)');
});

test('sameContent: one object reached from both sides is the same only when it is frozen all the way down', () => {
  const loose = { u: [-1, 0, 1], psi: [0, 0, 0] }, shallow = Object.freeze({ u: [-1, 0, 1], psi: [0, 0, 0] }), deep = deepFreeze({ u: [-1, 0, 1], psi: [0, 0, 0] });
  assert.equal(sameContent({ p: loose }, { p: loose }), false, 'not frozen: it may have changed in place since');
  assert.equal(sameContent({ p: shallow }, { p: shallow }), false, 'frozen, but its arrays are not');
  assert.equal(sameContent({ p: deep }, { p: deep }), true, 'frozen all the way down');
  const getter = Object.freeze({ get u() { return [Math.random()]; } });
  assert.equal(sameContent({ p: getter }, { p: getter }), false, 'a getter is not a value');
});

test('snapshot: a change made in place after it does not reach it; what is frozen all the way down is shared, not copied', () => {
  const P = deepFreeze({ u: [-1, 0, 1], psi: [0, 0, 0] }), seg = { k0: 0, profile: P, blend: { from: P, s0: 1 }, list: [1, 2] }, s = snapshot(seg);
  assert.equal(s.profile, P); assert.equal(s.blend.from, P); assert.notEqual(s.blend, seg.blend);
  seg.k0 = 5; seg.blend.s0 = 9; seg.list.push(3);
  assert.equal(s.k0, 0); assert.equal(s.blend.s0, 1); assert.deepEqual(s.list, [1, 2]);
  assert.equal(sameContent(seg, s), false, 'the changed segment is not the one snapshotted');
  assert.equal(sameContent(snapshot({ d: new Date(0) }), { d: new Date(0) }), false, 'a kind it does not copy is never taken as the same');
});
