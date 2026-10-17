// core_cut.test.js: node --test test/core_cut.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D361 part 1 (pane C): CUT (src/core/piece.js cutRun; the keeper, 2026-10-17: "step 1 select and cut, two open ends, and then the user chooses how to connect them").
// A cut takes the selected pieces out and leaves the track OPEN at the gap, moving nothing that is kept: a closed lap is ROTATED so the piece after the cut comes first
// (its start is where that piece began) and the piece before the cut is the open end (D360 §2). Rows, stated before the code:
//   1  a closed lap's middle run cut: open, the kept pieces' ids rotated (the piece after the cut first), nextId kept, frozen; every kept piece's path samples where they were
//   2  checkDoc passes on the rotated lap, whose old lap seam is now an ordinary joint, for a legacy, a cup and a tube lap (D360's open question)
//   3  the start piece cut: the next piece starts the track where it began; the end of a closed lap cut: the same start, exactly; a cut across the start line
//   4  an open track: a cut at its end or its start leaves one piece of road, unmoved; in its middle it would leave two, refused by name (CUT_OPEN_MIDDLE)
//   5  flights: a jump cut out leaves its landing starting the track where it lands; a cut that would start the track in the air is refused by name (CUT_STARTS_IN_AIR);
//      the landing cut leaves the jump at the open end
//   6  the start line is kept when its piece is still the first piece, and otherwise reset to the start of the new first piece; a pit lane or hotlap on a cut piece is dropped;
//      each is said in the notes
//   7  what is refused by name: the whole track (CUT_ALL), a bad range (BAD_RANGE)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close, residual } = require('../src/core/close.js');
const J = require('../src/core/jump.js');
const A = require('../src/core/adapter.js');
const PC = require('../src/core/piece.js');
const { PACK } = require('../src/markers/layout.js');

const Rr = 180, Q = (Math.PI * Rr) / 2;
const closedOk = (r) => { assert.equal(r.converged, true, r.report); return r.doc; };
// the laps of test/core_piece.test.js, one of each cross-section kind, closed by the core's own close (their pieces are the ADJUSTED ones)
function lap(name, first = {}, targets = {}) {
  let d = extend(D.createDoc(name), { length: 300, family: 'bowl', first });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, ...targets } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0, ...targets } });
  return closedOk(close(d, { edited: [0] }));
}
const LAPS = { legacy: () => lap('legacy lap'), cup: () => lap('cup lap', { c: 45 }, { c: 45 }), tube: () => lap('tube lap', { w: 40, t: 360 }) };
/** Every path sample of each piece, by piece id: { id: [pos, …] } (the centreline the preview, the mesh and the export are built on). */
function samplesById(doc) {
  const { segments, path } = A.toPath(doc), out = {};
  for (const smp of path.samples) { const id = segments[smp.seg].id; (out[id] = out[id] || []).push(smp.pos.slice()); }
  return out;
}
/**
 * The largest distance between a kept piece's samples before and after, over every kept piece, sample by sample from the piece's start. A piece's samples start at its own start
 * (each segment is grown from its own origin), so they pair up; only the sample AT a piece's end may belong to it in one track and not the other (a closed lap's last sample is its
 * first, an open track keeps its end), so the counts may differ by that one.
 */
function maxMoved(before, after, ids) {
  let worst = 0;
  for (const id of ids) {
    const a = before[id], b = after[id];
    assert.ok(a && b, `piece ${id} has samples before and after`); assert.ok(Math.abs(b.length - a.length) <= 1, `piece ${id}: the same samples (${a.length}, ${b.length})`);
    for (let k = 0; k < Math.min(a.length, b.length); k++) worst = Math.max(worst, Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1], a[k][2] - b[k][2]));
  }
  return worst;
}
// the start is kept to the document's own quanta (0.1 mm, 1e-9 rad), so a cut's start is within half of one: a sample 30 km on moves at most a few hundredths of a mm more
const UNMOVED_M = 1e-4;
const ids = (d) => d.pieces.map((P) => P.id);
/**
 * Nothing kept moves: the pieces from the cut round to the old start line are where they were (to the start's quanta); the pieces after the old start line, which a closed lap
 * placed at its start, now follow the piece before them, so they move by the lap's own closing gap (close() stops within 1 mm, tolM) and no more. Returns the two figures.
 */
function unmoved(H, o, label) {
  const before = samplesById(H), after = samplesById(o), ord = ids(o), k = H.closed ? ord.indexOf(H.pieces[0].id) : -1;
  const far = k > 0 ? ord.slice(0, k) : ord, near = k > 0 ? ord.slice(k) : [];
  const farM = maxMoved(before, after, far);
  assert.ok(farM < UNMOVED_M, `${label}: the pieces up to the old start line are within ${UNMOVED_M} m of where they were (moved ${farM})`);
  if (!near.length) return { farM, nearM: 0, gapM: 0 };
  const gapM = residual({ ...H, closed: false }).gapM, nearM = maxMoved(before, after, near);
  assert.ok(gapM <= 1e-3, `${label}: the lap closed within close's 1 mm (${gapM})`);
  assert.ok(nearM <= gapM + UNMOVED_M, `${label}: the pieces after the old start line move by at most the lap's closing gap, ${gapM} m (moved ${nearM})`);
  return { farM, nearM, gapM };
}

test('row 1: a closed lap\'s middle run cut is OPEN, its kept pieces rotated so the piece after the cut comes first, and every kept piece is where it was', () => {
  const H = LAPS.legacy(), n = H.pieces.length;
  assert.equal(n, 6); assert.equal(H.closed, true);
  const r = PC.cutRun(H, 2, 3), o = r.doc;
  assert.equal(o.closed, false, 'two open ends');
  assert.deepEqual(ids(o), ['p5', 'p6', 'p1', 'p2'], 'the piece after the cut first, then round the old start line to the piece before the cut');
  assert.deepEqual(r.removed, ['p3', 'p4']);
  assert.equal(o.nextId, H.nextId, 'ids are never reused');
  for (const P of o.pieces) assert.equal(P, H.pieces.find((x) => x.id === P.id), `${P.id} is the very same piece object: nothing built is edited`);
  assert.ok(Object.isFrozen(o) && Object.isFrozen(o.pieces), 'frozen, as every document is');
  unmoved(H, o, 'the middle cut');
  assert.equal(H.closed, true, 'the input is untouched');
});

test('row 2: checkDoc passes on the rotated lap: the old lap seam is an ordinary joint now, on a legacy, a cup and a tube lap; the text round-trips', () => {
  for (const [kind, make] of Object.entries(LAPS)) {
    const H = make(), o = PC.cutRun(H, 2, 2).doc;
    assert.doesNotThrow(() => D.checkDoc(o), `${kind}: the rotated lap is a valid document`);
    assert.deepEqual(ids(o), ['p4', 'p5', 'p6', 'p1', 'p2'], kind);
    const back = D.parse(D.serialize(o));
    assert.equal(D.serialize(back), D.serialize(o), `${kind}: saved and opened, it is the same text`);
    unmoved(H, back, `${kind}, saved and opened`);
  }
});

test('row 3: the start piece cut starts the track where the next piece began; the end of a closed lap cut keeps the same start exactly; a cut across the start line', () => {
  const H = LAPS.legacy(), before = samplesById(H);
  const a = PC.cutRun(H, 0, 0).doc;
  assert.deepEqual(ids(a), ['p2', 'p3', 'p4', 'p5', 'p6']); assert.equal(a.closed, false);
  unmoved(H, a, 'the start piece cut');
  assert.notDeepEqual(a.start, H.start, 'the start is where p2 began');
  const b = PC.cutRun(H, 4, 5).doc;
  assert.deepEqual(ids(b), ['p1', 'p2', 'p3', 'p4']); assert.deepEqual(b.start, H.start, 'the end cut: the start is the lap\'s own, exactly');
  assert.ok(maxMoved(before, samplesById(b), ids(b)) < 1e-12, 'and nothing moves at all');
  const c = PC.cutRun(H, 5, 0).doc;   // across the start line (from > to, as a closed lap's selection gives it)
  assert.deepEqual(ids(c), ['p2', 'p3', 'p4', 'p5']);
  unmoved(H, c, 'across the start line');
});

test('row 4: an open track cut at its end or its start leaves one piece of road, unmoved; cut in its middle it would be two pieces of road, refused by name', () => {
  let d = extend(D.createDoc('open'), { length: 200, family: 'bowl' });
  for (let i = 0; i < 3; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  const before = samplesById(d);
  const end = PC.cutRun(d, 2, 3).doc; assert.deepEqual(ids(end), ['p1', 'p2']); assert.deepEqual(end.start, d.start); assert.equal(end.closed, false);
  const start = PC.cutRun(d, 0, 1).doc; assert.deepEqual(ids(start), ['p3', 'p4']);
  assert.ok(maxMoved(before, samplesById(start), ids(start)) < UNMOVED_M, 'the start cut: the rest stays where it was');
  assert.throws(() => PC.cutRun(d, 1, 2), (e) => e.code === 'CUT_OPEN_MIDDLE' && /two/.test(e.message), 'the middle of an open track');
});

test('row 5: flights: a jump cut out leaves its landing starting the track where it lands; a cut that would start the track in the air is refused; the landing cut leaves the jump at the open end', () => {
  // a lap with a jump on its opening straight: straight, jump, landing, four quarter turns, a short straight
  let d = extend(D.createDoc('jump lap'), { length: 200, family: 'bowl' });
  d = J.jump(d, { forward: 40 });
  d = extend(d, { length: 100 });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const H = closedOk(close(d, { edited: [7] })), before = samplesById(H);
  assert.equal(H.pieces[1].type, 'flight');
  const a = PC.cutRun(H, 1, 1).doc;   // the jump alone
  assert.deepEqual(ids(a).slice(0, 2), [H.pieces[2].id, H.pieces[3].id], 'the landing starts the track');
  assert.doesNotThrow(() => D.checkDoc(a));
  unmoved(H, a, 'the jump cut out');
  assert.throws(() => PC.cutRun(H, 0, 0), (e) => e.code === 'CUT_STARTS_IN_AIR' && /jump/.test(e.message), 'the piece before the jump cut: the track would start with the jump');
  const b = PC.cutRun(H, 2, 3).doc;   // the landing and the next piece: the jump is the open end
  assert.equal(b.pieces[b.pieces.length - 1].type, 'flight', 'the open end is the jump, ready for a new landing');
  unmoved(H, b, 'the landing cut');
});

test('row 6: the start line is kept while its piece is still first, else reset to the new first piece\'s start; a hotlap or a pit lane on a cut piece is dropped; the notes say each', () => {
  const H0 = LAPS.legacy();
  const grid = { count: 8, rowGapM: PACK.rowGapM, colGapM: PACK.colGapM };
  const lane = { ...D.PIT_DEFAULT, side: 'R', leave: { word: 'p1', along: 20 }, rejoin: { word: 'p1', along: 280 } };
  const H = D.setPitLane(D.setSpawns(H0, { line: { along: 120 }, grid, hotlap: { piece: 'p3', along: 10 } }), lane);
  const kept = PC.cutRun(H, 4, 5);   // the end: p1 stays first
  assert.deepEqual(kept.doc.spawns.line, { along: 120 }); assert.equal(kept.notes.line, 'kept');
  assert.deepEqual(kept.doc.spawns.hotlap, { piece: 'p3', along: 10 }); assert.equal(kept.notes.hotlap, 'kept');
  assert.deepEqual(kept.doc.pitLane, H.pitLane); assert.equal(kept.notes.pitLane, 'kept');
  const mid = PC.cutRun(H, 2, 3);   // p3 (the hotlap's) is cut; p1 survives but is no longer first
  assert.deepEqual(mid.doc.spawns.line, { along: 0 }, 'reset to the start of the new first piece');
  assert.equal(mid.notes.line, 'reset'); assert.equal(mid.notes.lineWas, 'p1'); assert.equal(mid.notes.lineNow, 'p5');
  assert.equal(mid.doc.spawns.hotlap, undefined); assert.equal(mid.notes.hotlap, 'dropped');
  assert.deepEqual(mid.doc.spawns.grid, H.spawns.grid, 'the grid pack is kept');
  assert.deepEqual(mid.doc.pitLane, H.pitLane, 'the pit lane on p1 is kept'); assert.equal(mid.notes.pitLane, 'kept');
  const lap = PC.cutRun(H, 0, 0);   // the lane's piece is cut
  assert.equal(lap.doc.pitLane, undefined); assert.equal(lap.notes.pitLane, 'dropped');
  const none = PC.cutRun(H0, 2, 3);
  assert.equal(none.doc.spawns, undefined); assert.equal(none.doc.pitLane, undefined, 'a track with none has none after');
  assert.deepEqual([none.notes.line, none.notes.hotlap, none.notes.pitLane], [null, null, null]);
});

test('row 7: refused by name: the whole track, and a bad range', () => {
  const H = LAPS.legacy(), n = H.pieces.length;
  assert.throws(() => PC.cutRun(H, 0, n - 1), (e) => e.code === 'CUT_ALL');
  assert.throws(() => PC.cutRun(H, 3, 2), (e) => e.code === 'CUT_ALL', 'across the start line, the whole lap but nothing');
  for (const [a, b] of [[-1, 0], [0, n], [1.5, 2], [null, 1]]) assert.throws(() => PC.cutRun(H, a, b), (e) => e.code === 'BAD_RANGE', `${a}..${b}`);
  let o = extend(D.createDoc('open'), { length: 200, family: 'bowl' });
  assert.throws(() => PC.cutRun(o, 0, 0), (e) => e.code === 'CUT_ALL', 'an open track\'s only piece');
  o = extend(o, { length: 100 });
  assert.throws(() => PC.cutRun(o, 1, 0), (e) => e.code === 'BAD_RANGE', 'an open track has no run across a start line');
});
