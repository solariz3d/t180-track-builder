// Tests for validation while the user builds (the keeper, 12:20: "youre not the one who builds the track, the user
// does"; docs/INTERFACES.md §4): validate() on an OPEN track, and revalidate() after appending one segment at the head,
// which must equal a full validate() exactly while carrying, not recomputing, what the append cannot change.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validate, revalidate } = require('../src/validate/index.js');
const X = require('./validate_paths.js');

// Grow a track the way the build head does: each step appends one segment's stations to the samples so far.
function grow(pieces) {
  const samples = [], segs = [];
  for (const [g, make] of pieces) {
    const j = segs.length, last = samples[samples.length - 1];
    const st = make({ seg: j, s0: last ? last.s : 0, start: last ? last.pos : [0, 0, 0] });
    samples.push(...(last ? st.slice(1) : st));
    segs.push(g);
  }
  return { path: X.pathOf(samples.map((p) => ({ ...p }))), segs };
}
const straightPiece = (len, o = {}) => (at) => X.straight(len, { ...at, ...o });
// a left turn continuing from the end of a +Z straight (headings stay +Z at the join)
const turnPiece = (R, ang) => (at) => X.leftTurn(R, ang, at).map((p) => ({ ...p, pos: [p.pos[0], p.pos[1], p.pos[2]] }));

/** Build `pieces`, validate all but the last, append the last, revalidate, and compare with a full validate. */
function appendAndCompare(pieces, opts = {}) {
  const before = grow(pieces.slice(0, -1)), after = grow(pieces);
  const prev = validate(before.path, before.segs, opts);
  const fromS = before.path.samples[before.path.samples.length - 1].s;
  const inc = revalidate(prev, after.path, after.segs, fromS, opts), full = validate(after.path, after.segs, opts);
  return { prev, inc, full, before, after, fromS };
}

test('an OPEN track: no lap result, only the reason, and no red at the open end', () => {
  const { path, segs } = grow([[X.seg({ speed: 60 }), straightPiece(80)], [X.seg({ id: 't', word: 'turn', speed: 60 }), turnPiece(60, 0.5)]]);
  const r = validate(path, segs);
  assert.deepStrictEqual(r.lap, { ok: null, reason: 'open' });
  assert.deepStrictEqual(r.red, []);
});

// CHANGED 2026-09-27 (D170): the head in the air was exempt; it is now red, `head-in-the-air`, the librarian's item 3
// ("an open end must sit on road"). What stays true is kept: no gap-in-road red, and the jump pending, not failed.
test('an OPEN track whose head is a gap (mid-build): no gap-in-road red, the jump is pending, and the head in the air is red', () => {
  const { path, segs } = grow([[X.seg({ speed: 150 }), straightPiece(80)], [X.seg({ id: 'g', kind: 'gap', word: 'straight', speed: 150 }), straightPiece(20)]]);
  const r = validate(path, segs);
  // the red runs over the flight: from its first station (the take-off road owns s = 80) to the head
  const inFlight = path.samples.filter((p) => p.seg === 1);
  assert.deepStrictEqual(r.red.map((x) => [x.reason, x.s0, x.s1]), [['head-in-the-air', inFlight[0].s, path.samples[path.samples.length - 1].s]]);
  assert.strictEqual(r.jumps[0].pending, true);
  assert.deepStrictEqual(r.lap, { ok: null, reason: 'open' });
});

test('append a straight after a straight: revalidate equals a full validate', () => {
  const { inc, full } = appendAndCompare([[X.seg({ speed: 60 }), straightPiece(50)], [X.seg({ id: 'b', speed: 80 }), straightPiece(40)]]);
  assert.deepStrictEqual(inc, full);
});

test('append a turn (new loads, a new along-track term at the join): revalidate equals a full validate', () => {
  const { inc, full } = appendAndCompare([[X.seg({ speed: 60 }), straightPiece(50)], [X.seg({ id: 't', word: 'turn', speed: 90 }), turnPiece(40, 1.2)]]);
  assert.deepStrictEqual(inc, full);
  assert.ok(full.lines.length > 0);
});

test('append the landing after a pending jump: the jump resolves with both landings, and equals a full validate', () => {
  const pieces = [[X.seg({ speed: 200 }), straightPiece(80)], [X.seg({ id: 'j', kind: 'gap', word: 'jump', speed: 200 }), (at) => X.straight(40, at).map((p) => p)], [X.seg({ id: 'land', speed: 200 }), (at) => X.straight(120, { ...at, start: [at.start[0], at.start[1] - 3, at.start[2]] })]];
  const { prev, inc, full } = appendAndCompare(pieces);
  assert.strictEqual(prev.jumps[0].pending, true);
  assert.deepStrictEqual(inc, full);
  assert.deepStrictEqual(inc.jumps[0].landings.map((l) => l.g), [3.2, 6.3]);
});

test('append after a NON-jump gap at the head: the old head loses its exemption and turns red, as in a full validate', () => {
  const pieces = [[X.seg({ speed: 60 }), straightPiece(50)], [X.seg({ id: 'g', kind: 'gap', word: 'straight', speed: 60 }), straightPiece(10)], [X.seg({ id: 'c', speed: 60 }), straightPiece(30)]];
  const { prev, inc, full } = appendAndCompare(pieces);
  assert.ok(!prev.red.some((x) => x.reason === 'gap-in-road'), 'exempt while it is the head');
  assert.ok(inc.red.some((x) => x.reason === 'gap-in-road'), 'red once built past');
  assert.deepStrictEqual(inc, full);
});

test('a new piece laid 1.5 m over the old road turns the OLD road red too, exactly as a full validate does', () => {
  // the append jumps back over the start (a hole too, which is fine: the point is the stack on OLD stations)
  const pieces = [[X.seg({ speed: 60 }), straightPiece(60)], [X.seg({ id: 'over', speed: 60 }), (at) => X.straight(40, { seg: at.seg, s0: at.s0, start: [0, 1.5, 0] })]];
  const { inc, full, fromS } = appendAndCompare(pieces);
  const st = inc.red.filter((x) => x.reason === 'stacked-within-2m');
  assert.ok(st.some((x) => x.s0 < fromS), 'an old station is red');
  assert.deepStrictEqual(inc, full);
});

test('append with the lap sim as the speed model (no design speeds): equals a full validate', () => {
  const opts = { car: { accel: 15 } };
  const { inc, full } = appendAndCompare([[X.seg(), straightPiece(200, { step: 2 })], [X.seg({ id: 'b', word: 'turn' }), turnPiece(80, 0.8)]], opts);
  assert.strictEqual(full.speedFrom, 'lapsim');
  assert.deepStrictEqual(inc, full);
});

test('only what the append affects is recomputed: early stations are CARRIED (the same objects), the rest is new', () => {
  const { prev, inc, fromS } = appendAndCompare([[X.seg({ speed: 60 }), straightPiece(100)], [X.seg({ id: 't', word: 'turn', speed: 60 }), turnPiece(50, 0.6)]]);
  const early = inc.lines.filter((l) => l.s < fromS - 1.5), late = inc.lines.filter((l) => l.s > fromS);
  assert.ok(early.length > 100 && late.length > 10);
  for (const l of early) assert.ok(prev.lines.includes(l), `carried at s ${l.s}`);
  for (const l of late) assert.ok(!prev.lines.includes(l), `recomputed at s ${l.s}`);
  // the one-station look-back: the station just before the join is recomputed (its along-track term reads the new speed)
  const join = inc.lines.filter((l) => Math.abs(l.s - (fromS - 1)) < 1e-9);
  for (const l of join) assert.ok(!prev.lines.includes(l), 'the look-back station is recomputed');
});

test('closing the loop re-validates everything (the closing twist moves every frame) and gives the lap result', () => {
  const R = 20, all = X.loop(R);
  const half = X.pathOf(all.filter((p) => p.s <= Math.PI * R + 1e-9)), segs = [X.seg({ speed: 40 })];
  const prev = validate(half, segs), closed = X.pathOf(all, true);
  const inc = revalidate(prev, closed, segs, Math.PI * R);
  assert.deepStrictEqual(inc, validate(closed, segs));
  assert.strictEqual(inc.lap.ok, true);
});

test('a speed-model change (a word without a design speed appended) re-validates everything', () => {
  const opts = { car: { accel: 15 } };
  const { inc, full } = appendAndCompare([[X.seg({ speed: 60 }), straightPiece(80)], [X.seg({ id: 'b' }), straightPiece(40)]], opts);
  assert.strictEqual(full.speedFrom, 'lapsim');
  assert.deepStrictEqual(inc, full);
});

test('revalidate without a previous result is a full validate', () => {
  const { path, segs } = grow([[X.seg({ speed: 60 }), straightPiece(50)]]);
  assert.deepStrictEqual(revalidate(null, path, segs, 0), validate(path, segs));
});

test('an EDIT of the head piece (not only an append): a stack the old piece made is dropped, as in a full validate', () => {
  // before: 60 m of road, then a head piece laid 1.5 m over it (stacked). After: the head piece replaced by one 5 m up.
  const base = [X.seg({ speed: 60 }), straightPiece(60)];
  const before = grow([base, [X.seg({ id: 'h', speed: 60 }), (at) => X.straight(40, { seg: at.seg, s0: at.s0, start: [0, 1.5, 0] })]]);
  const after = grow([base, [X.seg({ id: 'h', speed: 60 }), (at) => X.straight(40, { seg: at.seg, s0: at.s0, start: [0, 5, 0] })]]);
  const prev = validate(before.path, before.segs);
  assert.ok(prev.red.some((x) => x.reason === 'stacked-within-2m'), 'the old head piece was stacked');
  const inc = revalidate(prev, after.path, after.segs, 60), full = validate(after.path, after.segs);
  assert.ok(!full.red.some((x) => x.reason === 'stacked-within-2m'));
  assert.deepStrictEqual(inc, full);
});

test('closing the loop when the closing twist MOVED the earlier frames: revalidate still equals a full validate', () => {
  // C spreads the closing twist along the loop (INTERFACES §4), so the closed path's early stations differ from the
  // open one's. Emulate it: roll every station of the closed path by a small angle growing along s.
  const R = 20, open = X.loop(R).filter((p) => p.s <= Math.PI * R + 1e-9), segs = [X.seg({ speed: 40, profile: { font: 'bowl', u: [-5, 0, 5, 8], psi: [0, 0, 0, 0.8] } })];
  const roll = (p) => { const a = 0.02 * p.s / (2 * Math.PI * R), c = Math.cos(a), s = Math.sin(a);
    const L = [p.L[0] * c + p.U[0] * s, p.L[1] * c + p.U[1] * s, p.L[2] * c + p.U[2] * s], U = [p.U[0] * c - p.L[0] * s, p.U[1] * c - p.L[1] * s, p.U[2] * c - p.L[2] * s];
    return { ...p, L, U }; };
  const prev = validate(X.pathOf(open), segs), closed = X.pathOf(X.loop(R).map(roll), true);
  assert.deepStrictEqual(revalidate(prev, closed, segs, Math.PI * R), validate(closed, segs));
});

test('stacked: each station keeps its DEEPEST overlap, whatever order the points are visited in', () => {
  // an old road at y 0 and a new one 1.0 m over it: every old station's nearest new point is straight above, 1.0 m away,
  // but a neighbouring new station (1.41 m away) is visited first. The worst must be 2 − 1.0 = 1.0, not 2 − 1.41.
  const { path, segs } = grow([[X.seg({ speed: 60 }), straightPiece(60)], [X.seg({ id: 'over', speed: 60 }), (at) => X.straight(40, { seg: at.seg, s0: at.s0, start: [0, 1, 0] })]]);
  const r = validate(path, segs);
  const oldStations = [...r._raw.stacked.values()].filter((e) => e.s > 1 && e.s < 39);
  assert.ok(oldStations.length > 30);
  for (const e of oldStations) assert.ok(Math.abs(e.worst - 1) < 1e-9, `station s ${e.s}: worst ${e.worst}`);
});

test('ranges: the same findings in any order give the same ranges (a total order, so full and incremental agree)', () => {
  const { _internal: { ranges } } = require('../src/validate/index.js');
  const a = { s: 5, u: 3, reason: 'fold', worst: 0.2 }, b = { s: 5, u: -2, reason: 'fold', worst: 0.2 }, c = { s: 6, u: 1, reason: 'fold', worst: 0.1 };
  assert.deepStrictEqual(ranges([a, b, c], 1), ranges([c, b, a], 1));
  assert.strictEqual(ranges([a, b, c], 1)[0].u, -2, 'a tie in depth keeps the smaller u');
});

test('an EDIT that removes the deepest stack keeps the shallower OLD one: those stations are re-derived, not dropped', () => {
  // A (y 0), then B laid 1.8 m over A (an old stack, depth 0.2), then the head laid 1.0 m over A (deeper, depth 1.0).
  // Editing the head away must leave A red through B at 0.2, exactly as a full validate does.
  const A = [X.seg({ speed: 60 }), straightPiece(60)];
  const B = [X.seg({ id: 'B', speed: 60 }), (at) => X.straight(60, { seg: at.seg, s0: at.s0, start: [0, 1.8, 0] })];
  const head = (y) => [X.seg({ id: 'h', speed: 60 }), (at) => X.straight(40, { seg: at.seg, s0: at.s0, start: [0, y, 0] })];
  const before = grow([A, B, head(1.0)]), after = grow([A, B, head(5)]);
  const prev = validate(before.path, before.segs), fromS = before.path.samples.find((p) => p.seg === 2).s;
  const inc = revalidate(prev, after.path, after.segs, fromS), full = validate(after.path, after.segs);
  const onA = [...full._raw.stacked.values()].filter((e) => e.s < 59);
  assert.ok(onA.length > 30 && onA.every((e) => Math.abs(e.worst - 0.2) < 1e-9), 'A stays stacked on B at 0.2');
  assert.deepStrictEqual(inc, full);
});
