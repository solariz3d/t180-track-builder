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

// D331: the rule changed. The roll was always the LAST piece onto the start; that road left the surface on this very fixture (the checker's lap proof: the car leaves the road at 3.59 km, the
// old order's result), so the roll is laid first, on its own straight at the end, when rolling last would leave the road (row 10). Still never in a turn, still on a straight of its own.
test('row 5: an end upside down rolls back upright on a straight of its own (last onto the start, or first when that keeps the car on the road), never in a turn, and the lap closes with the bank of the start', () => {
  let d = openTrack(); d = extend(d, { length: 400, transition: 390, targets: { phi: Math.PI } });   // the end rolled over gently (under the bar): bank 180°
  const r = F.finishToStart(d), added = r.doc.pieces.slice(d.pieces.length), lastNew = added[added.length - 1];
  assert.equal(r.doc.closed, true); assert.ok(r.plan.rollM >= Math.ceil(Math.PI / (0.9338 * DEG)), `${r.plan.rollM} m to roll 180° at the amber rate`);
  assert.match(r.plan.report, /rolling 180° upright (onto the start|first)/);
  const rollPiece = r.plan.rollFirst ? added[0] : lastNew;
  assert.equal(Math.round(rollPiece.length), r.plan.rollM, 'the roll is the last new piece, or the first');
  assert.ok(rollPiece.channels.kh.every((v) => Math.abs(v) < 2e-3), 'and it is a straight (no turn to speak of: Close may bend it a hair)');
  assert.equal(lapOf(r.doc).ok, true, 'and the car stays on the road all the way round');
  const end = D.valuesAt(lastNew, lastNew.length).phi, start = D.valuesAt(r.doc.pieces[0], 0).phi;
  assert.ok(Math.abs(Math.atan2(Math.sin(end - start), Math.cos(end - start))) < 1e-6, 'the bank at the seam is that of the start, mod 360°');
});

// 2026-10-15, reported on ELYSIUM (the finish's roll, 54° over 64 m, was red: "the road rolls too fast" at p43): the roll was sized so its AVERAGE rate was
// the amber bar, but it eases in and out, and the checker reads its PEAK over 20 m (1.219°/m there, past the 1.2144 red bar). The laid roll is now read as
// the checker reads it: no station of the new road rolls past amber
test('row 8: the roll Finish lays, read as the checker reads it, is under the amber bar everywhere on the new road (54° and 180°)', () => {
  const AD = require('../src/core/adapter.js'), G = require('../src/geom/index.js'), V = require('../src/validate/index.js');
  for (const bank of [54 * DEG, Math.PI]) {
    let d = openTrack(); d = extend(d, { length: 400, transition: 390, targets: { phi: bank } });
    const r = F.finishToStart(d), segs = AD.toSegments(r.doc), st = r.doc.start;
    let p = G.buildPath(segs, { step: 2, closed: true, start: { pos: st.pos.slice(), theta: st.heading, p: st.pitch } }); if (AD.offsetPath) p = AD.offsetPath(r.doc, segs, p);
    const newIds = new Set(r.doc.pieces.slice(d.pieces.length).map((P) => P.id)), S = p.samples;
    const onNew = V._internal.rollRates(S, (i) => segs[S[i].seg].kind !== 'gap', true, p.lengthM).filter((q) => newIds.has(segs[S[q.i].seg].id));
    const worst = onNew.reduce((m, q) => Math.max(m, q.rate), 0);
    assert.ok(r.plan.rollM > 0 && onNew.length > 0, `control: a roll was laid (${r.plan.report})`);
    assert.ok(worst <= V.ROLL_AMBER_DEG_M, `rolling ${Math.round(bank / DEG)}°: the new road's worst roll rate ${worst.toFixed(3)}°/m, the amber bar ${V.ROLL_AMBER_DEG_M} (${r.plan.rollM} m of roll)`);
  }
});

// the same road from a first guess that is too short (the roll sized as its average, factor 1): the laid roll is MEASURED and lengthened until it is under amber, so
// the answer does not depend on the ease shape the first guess assumed
test('row 9: a roll whose first guess is too short (factor 1, and the old 1.1) is measured and lengthened until it is under the amber bar', () => {
  const AD = require('../src/core/adapter.js'), G = require('../src/geom/index.js'), V = require('../src/validate/index.js');
  let d = openTrack(); d = extend(d, { length: 400, transition: 390, targets: { phi: 54 * DEG } });
  for (const factor of [1, 1.1]) {
    const guess = Math.ceil((54 / V.ROLL_AMBER_DEG_M) * factor), r = F.finishToStart(d, { rollGuess: factor }), segs = AD.toSegments(r.doc), st = r.doc.start;
    assert.ok(r.plan.rollM > guess, `factor ${factor}: the roll was lengthened past its first guess of ${guess} m (${r.plan.rollM} m)`);
    let p = G.buildPath(segs, { step: 2, closed: true, start: { pos: st.pos.slice(), theta: st.heading, p: st.pitch } }); if (AD.offsetPath) p = AD.offsetPath(r.doc, segs, p);
    const newIds = new Set(r.doc.pieces.slice(d.pieces.length).map((P) => P.id)), S = p.samples;
    const worst = V._internal.rollRates(S, (i) => segs[S[i].seg].kind !== 'gap', true, p.lengthM).filter((q) => newIds.has(segs[S[q.i].seg].id)).reduce((m, q) => Math.max(m, q.rate), 0);
    assert.ok(worst <= V.ROLL_AMBER_DEG_M, `factor ${factor}: the new road's worst roll rate ${worst.toFixed(3)}°/m, the amber bar ${V.ROLL_AMBER_DEG_M} (${r.plan.rollM} m of roll)`);
  }
});

// 2026-10-15, ELYSIUM's newest save (the build of cb3a7ff): Close with "new road from the end to the start" converged, the preview said "No overlap and no red", and the checker then said
// "lap FAILS": the car leaves the road at the new road. Cause, measured: Finish judged a route by Close's convergence, and on an end banked 54° a turn on the wrong side of the bank
// has a negative normal load (the car is pulled off the surface), and Close bends the new pieces hard to meet the start (a 45 m miss became -55 g). This row is that, small: any track
// whose end is banked, closed by Finish, must pass the checker's own lap proof (the independent oracle: validate, not Finish's own test of it).
const bankedEnd = (turnDeg, straightM, bankDeg) => {   // a straight, a left turn, a straight, then the road banked over 200 m and held
  let d = D.createDoc('banked'); d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: 500 }, turnDeg * DEG); d = extend(d, { length: straightM });
  d = extend(d, { length: 200, transition: 100, targets: { phi: bankDeg * DEG } }); return extend(d, { length: 100, targets: { kv: 0 } });
};
function lapOf(doc) { const AD = require('../src/core/adapter.js'), V = require('../src/validate/index.js'), { path } = AD.toPath(doc, { step: 2 }); return V.validate(path, AD.toSegments(doc), { fullSpeed: true }).lap; }
test('row 10: a banked end: the road Finish lays keeps the car on it (the lap proof of the checker passes), at 54° and at 126°', () => {
  for (const [turn, straight, bank] of [[120, 200, 54], [90, 400, 126]]) {
    const d = bankedEnd(turn, straight, bank), r = F.finishToStart(d), lap = lapOf(r.doc);
    assert.equal(r.doc.closed, true);
    assert.equal(lap.ok, true, `end banked ${bank}°: the lap fails, the car leaves the road at ${JSON.stringify((lap.where || []).slice(0, 2))} (${r.plan.report})`);
  }
});

// the road test Finish applies (F.roadHold) is the lap proof's own test of the centreline, so it finds what the checker finds. The fixture is the road the OLD Finish laid at a 54° end
// (a synthetic track, test/fixtures/finish-banked-end-leaves-road.core2.json): the checker's lap proof fails on it at 1.5 km, and roadHold must put its lowest load inside the stretch the
// checker names, below 0; on the road the new Finish lays at the same end it finds none (the same verdict, on the same track).
test('row 11: F.roadHold is the own test of the lap proof: the same place on the road the old Finish laid at a banked end, and nothing on the new road', () => {
  const fs = require('node:fs'), path = require('node:path');
  const bad = D.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'finish-banked-end-leaves-road.core2.json'), 'utf8')), lap = lapOf(bad), hold = F.roadHold(bad, 0);
  assert.equal(lap.ok, false, 'control: the checker fails this lap'); const where = lap.where.filter((w) => w.reason === 'leaves-surface').map((w) => w.s);
  assert.ok(where.length > 0, 'control: it names where the car leaves the road');
  assert.ok(hold.worst < 0, `roadHold finds it: ${hold.worst}`); assert.ok(hold.at >= Math.min(...where) - 2 && hold.at <= Math.max(...where) + 2, `at ${hold.at}, inside the checker's ${Math.min(...where)} to ${Math.max(...where)} m`);
  // the same figure, not only the same sign: the lowest centreline load with the downforce the checker's own lines carry (fHold_g), over the same stations
  const AD = require('../src/core/adapter.js'), V = require('../src/validate/index.js'), { path: P } = AD.toPath(bad, { step: 2 }), lines = V.validate(P, AD.toSegments(bad), { fullSpeed: true }).lines.filter((l) => l.u === 0);
  const lowest = Math.min(...lines.map((l) => l.fHold_g)); assert.ok(Math.abs(hold.worst - lowest) < 0.3, `roadHold ${hold.worst.toFixed(3)} g, the checker's lowest ${lowest.toFixed(3)} g`);
  // it reads only the pieces from the index asked for: the stretch where the car leaves the road is in the earlier pieces, so after them the answer is a road that holds
  let at = 0, lastBad = -1; bad.pieces.forEach((Q, i) => { if (where.some((w) => w >= at && w < at + Q.length)) lastBad = i; at += Q.length; });
  assert.ok(lastBad >= 0 && lastBad < bad.pieces.length - 1, 'control: the road is left in a piece before the last'); assert.ok(F.roadHold(bad, lastBad + 1).worst >= 0, 'the pieces after it hold the car');
  const good = F.finishToStart(bankedEnd(120, 200, 54)); assert.ok(F.roadHold(good.doc, 0).worst >= 0, 'the new road holds the car'); assert.equal(lapOf(good.doc).ok, true);
});

// when no road the car can stay on exists from where the track ends (here it has dropped 148 m and points down 18 degrees), Finish says so by name, with where and how hard, and what to
// do, instead of closing the loop into a lap the checker fails (the old answer on this track: a closed loop the car leaves at 2.2 km)
test('row 13: an end Finish cannot close onto a road the car stays on is refused by name, with where the car leaves the road and what to change', () => {
  let d = D.createDoc('dropped'); d = extend(d, { length: 300 }); d = extendTurnBy(d, { length: 400 }, 90 * DEG); d = extend(d, { length: 600, transition: 300, targets: { kv: -0.001 } }); d = extend(d, { length: 100, targets: { kv: 0 } });
  assert.throws(() => F.finishToStart(d), (e) => e.name === 'CoreError' && e.code === 'FINISH_LEAVES_ROAD' && /the car would leave the road at [0-9]+[.][0-9][0-9] km [(]a load of -?[0-9]+ g/.test(e.message) && /[0-9.]+ m below it/.test(e.message) && /level and straighten the last pieces/.test(e.message), 'refused by name');
});


// The compact road is kept when the car stays on it. An eased turn falls short of the circle the route was planned on, so the road as laid ended 20 m or more from the start and Close bent the
// new pieces hard to meet it (-55 g on ELYSIUM); the route is now RE-AIMED by where its road really ends until it ends within 0.3 m, and then the roll laid last passes the road test. Without the
// re-aim this banked end (a right-hand turn into a road banked the way it turns) failed the road test and was thrown away for a 3.1 km road with the roll first; with it, 1.3 km.
test('row 12: re-aimed by where it really ends, the compact road with the roll last is kept at a banked end that turns the way it is banked (and its mirror)', () => {
  for (const [turn, bank] of [[-150, 54], [150, -54]]) {
    const d = bankedEnd(turn, 200, bank), r = F.finishToStart(d);
    assert.equal(r.plan.rollFirst, false, `turn ${turn}, bank ${bank}: the roll is the last piece (${r.plan.report})`);
    assert.ok(r.plan.lengthM < 2000, `and the road is the compact one, ${r.plan.lengthM} m`);
    assert.ok(r.plan.minHoldG >= 0 && lapOf(r.doc).ok === true, 'and the car stays on it');
  }
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
