// core_finish.test.js: node --test test/core_finish.test.js
// FINISH TO START (src/core/finish.js; the keeper, 2026-10-12: aligning the last turn onto the start straight by hand is the main problem; "Yes" to a tool
// that ADDS road from the end to the start). Rows:
//   1  the plan-view routes: each turn-straight-turn the solver gives, laid out arc by arc, ends exactly on the start pose (position and heading)
//   2  straight ahead: an end behind the start, pointing at it, is one straight of the gap, no turns
//   3  a track is finished: new pieces only (every piece the user built is the very same object), the loop is closed, and the new road reaches the start
//   4  refusals by name: a closed loop, an empty track
//   5  an end upside down rolls upright on a straight of its own onto the start
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { extendTurnBy } = require('../src/core/turnby.js');
const F = require('../src/core/finish.js');

const DEG = Math.PI / 180;
const fwd = (th) => [Math.sin(th), Math.cos(th)], left = (th) => [Math.cos(th), -Math.sin(th)];
function arc(p, th, a, R) { const s = Math.sign(a) || 1, c = [p[0] + s * R * left(th)[0], p[1] + s * R * left(th)[1]], t = th + a; return { p: [c[0] - s * R * left(t)[0], c[1] - s * R * left(t)[1]], th: t }; }
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('row 1: every route the solver gives, laid out arc, straight, arc, ends on the start pose', () => {
  const cases = [[[0, 0], 0, [500, 300], 1.2], [[100, -50], 2.5, [0, 0], 0], [[0, 0], 0, [0, -400], 0], [[30, 900], -1, [-200, 50], 3]];
  for (const [p1, th1, p0, th0] of cases) for (const R of [150, 300]) {
    const rs = F.routes(p1, th1, p0, th0, R);
    assert.ok(rs.length >= 2, `${rs.length} routes for ${JSON.stringify([p1, th1, p0, th0])} at R ${R}`);
    for (const r of rs) {
      const e1 = arc(p1, th1, r.a1 || 1e-12, R), f = fwd(e1.th), e2 = arc([e1.p[0] + r.straightM * f[0], e1.p[1] + r.straightM * f[1]], e1.th, r.a2 || 1e-12, R);
      assert.ok(Math.hypot(e2.p[0] - p0[0], e2.p[1] - p0[1]) < 1e-6, `${r.word}: ends ${Math.hypot(e2.p[0] - p0[0], e2.p[1] - p0[1])} m off`);
      assert.ok(Math.abs(wrap(e2.th - th0)) < 1e-9, `${r.word}: heading off by ${wrap(e2.th - th0)}`);
      assert.ok(Math.abs(r.lengthM - (R * (Math.abs(r.a1) + Math.abs(r.a2)) + r.straightM)) < 1e-9);
    }
  }
});

test('row 2: an end behind the start and pointing at it is one straight of the gap, with no turn', () => {
  const best = F.routes([0, -88.2], 0, [0, 0], 0, 300).sort((a, b) => a.lengthM - b.lengthM)[0];
  assert.ok(Math.abs(best.straightM - 88.2) < 1e-9 && Math.abs(best.a1) < 1e-12 && Math.abs(best.a2) < 1e-12, JSON.stringify(best));
});

/** An open track: a straight, a 120° left turn, a straight. */
function openTrack() {
  let d = D.createDoc('finish');
  d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: 500 }, 120 * DEG); d = extend(d, { length: 600 });
  return d;
}

test('row 3: a track is finished with new pieces only, closed, and the new road ends on the start', () => {
  const d = openTrack(), r = F.finishToStart(d);
  assert.equal(r.doc.closed, true);
  assert.ok(r.doc.pieces.length > d.pieces.length, 'road was added');
  d.pieces.forEach((P, i) => assert.equal(r.doc.pieces[i], P, `piece ${i} is the user's own, untouched`));
  assert.ok(r.window.every((i) => i >= d.pieces.length), 'only the new pieces were bent');
  assert.match(r.plan.report, /^(LSL|RSR|LSR|RSL|CS|SC) at R \d+ m: turn -?\d+(\.\d)?°, \d+ m straight, turn -?\d+(\.\d)?°; \d+ new pieces?, \d+ m; closed/);
});

test('row 4: refusals by name: a closed loop, an empty track', () => {
  const d = openTrack(), done = F.finishToStart(d).doc;
  assert.throws(() => F.finishToStart(done), (e) => e.name === 'CoreError' && e.code === 'CLOSED');
  assert.throws(() => F.finishToStart(D.createDoc('empty')), (e) => e.name === 'CoreError' && e.code === 'EMPTY');
});

test('row 5: an end upside down rolls back upright on a straight of its own onto the start, never in a turn, and the lap closes with the bank of the start', () => {
  let d = openTrack(); d = extend(d, { length: 400, transition: 390, targets: { phi: Math.PI } });   // the end rolled over gently (under the bar): bank 180°
  const r = F.finishToStart(d), added = r.doc.pieces.slice(d.pieces.length), lastNew = added[added.length - 1];
  assert.equal(r.doc.closed, true); assert.ok(r.plan.rollM >= Math.ceil(Math.PI / (0.9338 * DEG)), `${r.plan.rollM} m to roll 180° at the amber rate`);
  assert.match(r.plan.report, /rolling 180° upright onto the start/);
  assert.equal(Math.round(lastNew.length), r.plan.rollM, 'the roll is the last new piece');
  assert.ok(lastNew.channels.kh.every((v) => Math.abs(v) < 2e-3), 'and it is a straight (no turn to speak of: Close may bend it a hair)');
  const end = D.valuesAt(lastNew, lastNew.length).phi, start = D.valuesAt(r.doc.pieces[0], 0).phi;
  assert.ok(Math.abs(Math.atan2(Math.sin(end - start), Math.cos(end - start))) < 1e-6, 'the bank at the seam is that of the start, mod 360°');
});

// 2026-10-15, reported on ELYSIUM: the end pointed 90° off with the start 468 m to its left and 76 m ahead, and Finish laid a 307° right turn, 431 m and a
// 37° left (2.3 km) for what is one left quarter turn and a straight. Its routes were only at the fixed radii (200 m and up). It now first solves the
// ONE-TURN routes exactly: a turn then a straight (CS), or a straight then a turn (SC), whose radius and length the end and the start fix between them.
test('row 6: an end a quarter turn short of the lap is finished with one turn and one straight, not a detour', () => {
  let d = D.createDoc('quarter');
  d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: 300 }, 90 * DEG); d = extend(d, { length: 600 }); d = extendTurnBy(d, { length: 300 }, 90 * DEG); d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: 300 }, 90 * DEG); d = extend(d, { length: 200 });   // three sides: a quarter turn short
  const r = F.finishToStart(d);
  assert.equal(r.doc.closed, true);
  assert.match(r.plan.word, /^(CS|SC)$/, r.plan.report);
  const turned = r.plan.turns.filter((t) => Math.abs(t) > 0.5);
  assert.equal(turned.length, 1, `one turn: ${r.plan.report}`); assert.ok(Math.abs(turned[0] - 90) < 1, `a left quarter turn: ${turned[0]}°`);
  assert.ok(r.plan.lengthM < 1500, `${r.plan.lengthM} m of new road`);
  d.pieces.forEach((P, i) => assert.equal(r.doc.pieces[i], P, `piece ${i} is the user's own, untouched`));
});

test('row 7: the one-turn routes, laid out, end on the start pose; none tighter than the floor', () => {
  for (const [p1, th1, p0, th0] of [[[0, 0], 0, [-300, 500], -Math.PI / 2], [[100, 0], Math.PI / 2, [600, 800], 0], [[0, 0], 0, [0, 500], 0]]) {
    for (const r of F.oneTurnRoutes(p1, th1, p0, th0)) {
      const e1 = arc(p1, th1, r.a1 || 1e-12, r.radiusM), f = fwd(e1.th), e2 = arc([e1.p[0] + r.straightM * f[0], e1.p[1] + r.straightM * f[1]], e1.th, r.a2 || 1e-12, r.radiusM);
      assert.ok(Math.hypot(e2.p[0] - p0[0], e2.p[1] - p0[1]) < 1e-6, `${r.word}: ends ${Math.hypot(e2.p[0] - p0[0], e2.p[1] - p0[1])} m off`);
      assert.ok(Math.abs(wrap(e2.th - th0)) < 1e-9, `${r.word}: heading off by ${wrap(e2.th - th0)}`);
      assert.ok(r.radiusM >= F.ONE_TURN_MIN_R && r.straightM >= 0);
    }
  }
  assert.deepEqual(F.oneTurnRoutes([0, 0], 0, [5, 3], Math.PI / 2), [], 'a turn tighter than the floor is no route');
});
