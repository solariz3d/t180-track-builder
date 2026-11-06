// geom_branch_path.test.js: node --test test/geom_branch_path.test.js
// D642 (pane E's review b8872153 §3): the preview's ghost of a candidate that re-lays the last placed piece's built tail rebuilt the WHOLE path (123 ms against 30 on a 22 km
// track). src/geom/path.js branchPathFrom(path, segments, g) makes a NEW open path: `path` up to segment g, its blocks shared and never written, then segments[g..] grown from
// block g's own start (rebuildPathFrom's chain, which is a full build to the bit). Rows:
//   1  the branch is buildPath(segments) to the bit (every station's s, pos, T, L, U, the segment ends and the head), for a change at the last segment, in the middle and at 0
//   2  the path it branched from is untouched: the same arrays, the same stations, the same head, and still extendable as before
//   3  it grows only from g: its work is the regrown blocks' alone; a closed path or a g out of range is refused by name
//   4  branchPathFromSteps run to the end is branchPathFrom, to the bit, and yields at least once a regrown block
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/geom/index.js');
const P = require('../src/geom/path.js');

const seg = (k1, roll1 = 0, length = 20) => ({ id: 'p', word: 'core', part: 'body', kind: 'road', length, k0: k1, k1, kp0: 0, kp1: 0, roll0: 0, roll1, heartline: 0, profile: null, blend: null, speed: null });
const placedSegs = () => Array.from({ length: 60 }, (_, i) => seg(i % 7 === 0 ? 0.01 : 0, 0));
const same = (a, b, what) => {
  assert.equal(a.samples.length, b.samples.length, `${what}: stations`);
  for (let k = 0; k < a.samples.length; k++) { const x = a.samples[k], y = b.samples[k]; assert.equal(x.s, y.s, `${what}: s at ${k}`); for (const f of ['pos', 'T', 'L', 'U']) assert.deepEqual(Array.from(x[f]), Array.from(y[f]), `${what}: ${f} at ${k}`); }
  for (let j = 0; j < a.segEnd.length; j++) assert.deepEqual(Array.from(a.segEnd[j].pos), Array.from(b.segEnd[j].pos), `${what}: segment ${j}'s end`);
  assert.deepEqual(a.head, b.head, `${what}: the head`); assert.equal(a.lengthM, b.lengthM, `${what}: the length`);
};
for (const g of [59, 30, 0]) {
  test(`branchPathFrom 1 (g ${g}): the branch is a full build of the new segments, to the bit`, () => {
    const old = placedSegs(), path = G.buildPath(old, { step: 2 }), next = [...old.slice(0, g), ...old.slice(g).map((x) => ({ ...x, roll0: 0.1, roll1: 0.2 })), seg(0.02), seg(0)];
    same(G.branchPathFrom(path, next, g), G.buildPath(next, { step: 2 }), `branched at ${g}`);
  });
}
test('branchPathFrom 2: the path it branched from is untouched (its arrays, stations and head), and still extends as before', () => {
  const old = placedSegs(), path = G.buildPath(old, { step: 2 }), arrays = ['samples', 'blocks', 'segFirst', 'starts', 'segEnd'].map((k) => [k, path[k], path[k].slice()]);
  const json = JSON.stringify(path.samples), head = JSON.stringify(path.head), next = [...old.slice(0, 50), ...old.slice(50).map((x) => ({ ...x, roll1: 0.3 })), seg(0.02)];
  G.branchPathFrom(path, next, 50);
  for (const [k, ref, copy] of arrays) { assert.equal(path[k], ref, `${k}: the same array`); assert.equal(ref.length, copy.length, `${k}: its length`); ref.forEach((v, i) => assert.equal(v, copy[i], `${k}[${i}]: the same entry`)); }
  assert.equal(JSON.stringify(path.samples), json, 'the same stations'); assert.equal(JSON.stringify(path.head), head, 'the same head');
  same(G.extendPath(path, [...old, seg(0.02)]), G.buildPath([...old, seg(0.02)], { step: 2 }), 'extended after');
});
test('branchPathFrom 3: it grows only from g (its work is the regrown blocks alone); a closed path or a g out of range is refused by name', () => {
  const old = placedSegs(), path = G.buildPath(old, { step: 2 }), next = [...old, seg(0.02)];
  const b = G.branchPathFrom(path, next, 59), tail = G.buildPath(next.slice(59), { step: 2 });
  assert.ok(b.work <= tail.work + 4, `the branch's work ${b.work}, the two regrown blocks' alone ${tail.work}`);
  assert.throws(() => G.branchPathFrom(path, next, 60), /branchPathFrom: no segment 60/);
  assert.throws(() => G.branchPathFrom(path, next, -1), /branchPathFrom: no segment -1/);
  assert.throws(() => G.branchPathFrom({ ...path, closed: true }, next, 10), /branchPathFrom: a closed loop/);
});
test('branchPathFrom 4: branchPathFromSteps run to the end is branchPathFrom, and yields at every regrown block', () => {
  const old = placedSegs(), path = G.buildPath(old, { step: 2 }), next = [...old.slice(0, 55), ...old.slice(55).map((x) => ({ ...x, roll1: 0.2 })), seg(0.02)];
  const it = P.branchPathFromSteps(path, next, 55); let r = it.next(), yields = 0; while (!r.done) { yields++; r = it.next(); }
  assert.ok(yields >= next.length - 55, `${yields} yields for ${next.length - 55} regrown blocks`);
  same(r.value, G.branchPathFrom(path, next, 55), 'steps against plain');
});
