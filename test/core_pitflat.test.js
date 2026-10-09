// core_pitflat.test.js: node --test test/core_pitflat.test.js
// FLATTEN FOR THE PIT (src/core/pitflat.js; the keeper, 2026-10-09: "a cupped track could change its cupping directly at the part the flat pit connects").
// The road's shape (cup, tube sweep, edge) goes to the plain road beside the lane and eases back; the route does not move; the lane then builds.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const { buildPath } = require('../src/geom/index.js');
const { buildPitLane } = require('../src/geom/pitlane.js');
const PF = require('../src/core/pitflat.js');

const R = 180, Q = Math.PI * R / 2;
function lap(shape) {   // a closed lap whose start straight and every turn carry `shape` ({ c } a cup, { t } a tube sweep)
  let d = extend(D.createDoc('lap'), { length: 600, family: 'bowl', first: shape });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R, ...shape } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0, ...shape } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const ROAD = { ...D.PIT_DEFAULT, leave: { word: 'p1', along: 60 }, rejoin: { word: 'p1', along: 540 } };
const { boxes, boxSpacingM, ...LANE } = ROAD;
const pathOf = (d) => { const segs = A.toSegments(d); return { segs, p: A.offsetPath(d, segs, buildPath(segs, { step: 2, closed: true, start: { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch } })) }; };
const lane = (d) => { const { segs, p } = pathOf(d); try { return buildPitLane(p, segs, LANE); } catch (e) { return e; } };

test('a 90° cup lap refuses a pit lane; flattened beside it, the same lane builds', () => {
  const d = lap({ c: 90 });
  assert.equal(lane(d).code, 'PIT_JOIN_NOT_FLAT');
  const f = PF.flattenUnder(d, { s0: 60, s1: 540, ramp: 60 });
  const r = lane(f);
  assert.ok(!(r instanceof Error), r.message);
  assert.ok(r.path.lengthM > 400);
});

test('the route does not move: every centreline station is where it was, to the bit', () => {
  const d = lap({ c: 90 }), f = PF.flattenUnder(d, { s0: 60, s1: 540, ramp: 60 });
  const a = buildPath(A.toSegments(d), { step: 2, closed: true }).samples, b = buildPath(A.toSegments(f), { step: 2, closed: true }).samples;
  assert.equal(a.length, b.length);
  assert.ok(a.every((m, i) => m.pos.every((v, k) => v === b[i].pos[k])));
});

test('only the shape beside the lane changes: the cup is 0 under the lane, untouched past the ramp, and no other channel moves', () => {
  const d = lap({ c: 90 }), f = PF.flattenUnder(d, { s0: 60, s1: 540, ramp: 60 });
  const P = d.pieces[0], F = f.pieces[0], t = [0, 0, 0, 0, ...P.knots, P.length, P.length, P.length, P.length];
  const avg = (k) => (t[k + 1] + t[k + 2] + t[k + 3]) / 3;
  P.channels.c.forEach((v, k) => {
    const s = avg(k);
    if (s >= 60 && s <= 540) assert.equal(F.channels.c[k], 0, `c[${k}] at ${s.toFixed(1)} m`);
    if (s <= 0 || s >= 600) assert.equal(F.channels.c[k], v, `c[${k}] at ${s.toFixed(1)} m is past the ramp`);
  });
  for (const ch of D.CHANNELS.filter((x) => x !== 'c')) assert.deepEqual(F.channels[ch], P.channels[ch], ch);
  assert.deepEqual(f.pieces.slice(1, 5), d.pieces.slice(1, 5), 'the turns, far from the lane, are the very same pieces');
});

test('a closed TUBE lap opens beside the lane, and the lane builds', () => {
  const d = lap({ t: 360 });
  assert.equal(lane(d).code, 'PIT_JOIN_NOT_FLAT');
  const r = lane(PF.flattenUnder(d, { s0: 60, s1: 540, ramp: 60 }));
  assert.ok(!(r instanceof Error), r.message);
});

test('a plain road has nothing to flatten, and says so', () => {
  assert.throws(() => PF.flattenUnder(lap({}), { s0: 60, s1: 540 }), (e) => e.code === 'NOTHING_TO_FLATTEN');
});

test('the result saves and opens byte for byte (a valid document)', () => {
  const f = PF.flattenUnder(lap({ c: 90 }), { s0: 60, s1: 540, ramp: 60 });
  assert.equal(D.serialize(D.parse(D.serialize(f))), D.serialize(f));
});

test('the weight is 1 on the stretch, eases to 0 over the ramp, and is 0 beyond it', () => {
  assert.equal(PF.weight(300, 60, 540, 60), 1);
  assert.equal(PF.weight(0, 60, 540, 60), 0);
  assert.ok(PF.weight(30, 60, 540, 60) > 0 && PF.weight(30, 60, 540, 60) < 1);
  assert.equal(PF.weight(700, 60, 540, 60), 0);
});
