// Tests for validation while the user builds (the user, 12:20: "youre not the one who builds the track, the user
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

// 2026-10-13, found while making undo incremental: a SEGMENT-level red before the cut (a gap in the road) was dropped by the second
// revalidate in a row, because the carry kept segment reds before the PREVIOUS run's cut (0 after a full validate) instead of this one's.
// The panel then showed a broken track as clean after the next placement, while a full validate (the export's) still found it.
test('a gap in the road well before the head stays red through two appends in a row, as in a full validate', () => {
  const sp = (len) => (at) => X.straight(len, at);
  const P = [[X.seg({ speed: 60 }), sp(50)], [X.seg({ id: 'g', kind: 'gap', word: 'straight', speed: 60 }), sp(10)], [X.seg({ id: 'c', speed: 60 }), sp(30)], [X.seg({ id: 'd', speed: 60 }), sp(30)], [X.seg({ id: 'e', speed: 60 }), sp(30)]];
  const a = grow(P.slice(0, 3)), b = grow(P.slice(0, 4)), c = grow(P), end = (g) => g.path.samples[g.path.samples.length - 1].s;
  const v1 = validate(a.path, a.segs), v2 = revalidate(v1, b.path, b.segs, end(a)), v3 = revalidate(v2, c.path, c.segs, end(b));
  assert.ok(v1.red.some((x) => x.reason === 'gap-in-road'), 'red in the full validate');
  assert.deepStrictEqual(v2, validate(b.path, b.segs), 'after one append');
  assert.deepStrictEqual(v3, validate(c.path, c.segs), 'after the second append');
});
// AMENDED (D432): the 2 m stack is information since D432, and a piece lying ON the old road is red as self-intersection (the clip test). The row's rule is the
// same (what a new piece does to OLD stations is found incrementally exactly as a full validate finds it); it is held for both now: 1.5 m over (info), and on it (red)
test('a new piece laid over the old road marks the OLD road too, exactly as a full validate does: 1.5 m over in info, lying on it red', () => {
  // the append jumps back over the start (a hole too, which is fine: the point is the stack on OLD stations)
  const over = (h) => [[X.seg({ speed: 60 }), straightPiece(60)], [X.seg({ id: 'over', speed: 60 }), (at) => X.straight(40, { seg: at.seg, s0: at.s0, start: [0, h, 0] })]];
  const a = appendAndCompare(over(1.5));
  assert.ok(a.inc.info.filter((x) => x.reason === 'stacked-within-2m').some((x) => x.s0 < a.fromS), 'an old station is in info');
  assert.ok(!a.inc.red.some((x) => x.reason === 'stacked-within-2m' || x.reason === 'self-intersection'), '1.5 m over does not clip');
  assert.deepStrictEqual(a.inc, a.full);
  const b = appendAndCompare(over(0));
  assert.ok(b.inc.red.filter((x) => x.reason === 'self-intersection').some((x) => x.s0 < b.fromS), 'lying on it: an old station is red');
  assert.deepStrictEqual(b.inc, b.full);
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

// AMENDED (D432): the head piece now lies ON the old road (a clip, red as self-intersection) rather than 1.5 m over it (information since D432), so the row
// still drops a RED the old piece made, as a full validate does
test('an EDIT of the head piece (not only an append): a clip the old piece made is dropped, as in a full validate', () => {
  // before: 60 m of road, then a head piece laid on it (a clip). After: the head piece replaced by one 5 m up.
  const base = [X.seg({ speed: 60 }), straightPiece(60)];
  const before = grow([base, [X.seg({ id: 'h', speed: 60 }), (at) => X.straight(40, { seg: at.seg, s0: at.s0, start: [0, 0, 0] })]]);
  const after = grow([base, [X.seg({ id: 'h', speed: 60 }), (at) => X.straight(40, { seg: at.seg, s0: at.s0, start: [0, 5, 0] })]]);
  const prev = validate(before.path, before.segs);
  assert.ok(prev.red.some((x) => x.reason === 'self-intersection'), 'the old head piece clipped');
  const inc = revalidate(prev, after.path, after.segs, 60), full = validate(after.path, after.segs);
  assert.ok(!full.red.some((x) => x.reason === 'self-intersection'));
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

// D498 item 2 (A's review of ab24ba8, p-d497-A §3): a stacked entry is carried whole when its DEEPEST partner is unchanged, but its `low` (D435, the least room
// overhead) can have come from another partner, one in the changed part; mark() only lowers it, so a low-overhead amber set by a road that has since moved outlived it
// until a full validate. The lap: a side road, a right U-turn bringing the lead back 0.3 m from it (the lead's deepest partner, unchanged), and F.crossing's climbing
// 270 deg turn whose last straight crosses the lead 0.8 m up (the low room, from the changed part). Raising the crossing to 3 m (the climb and everything after it
// change) clears the amber in a full validate, and revalidate must say the same
test('revalidate: a low-overhead amber set by a road that has since moved is not carried by a station whose deepest stack is on an unchanged road', () => {
  const G = require('../src/geom/index.js'), F = require('./geom_fixtures.js');
  const lap = (h, gap = 0.3) => {
    const Ru = 13 + gap / 2, R = 25, T = 1.5 * Math.PI * R, Lh = T - 40, a = h / (200 + 20 * Lh + 200), k = 1 / R;
    return [{ id: 'side', kind: 'road', length: 120, profile: F.FLAT }, { id: 'uturn', kind: 'road', length: Math.PI * Ru, k0: -1 / Ru, k1: -1 / Ru, profile: F.FLAT },
      { id: 'lead', kind: 'road', length: 110, profile: F.FLAT }, { id: 'up', kind: 'road', length: 20, k0: k, k1: k, kp0: a, kp1: a, profile: F.FLAT },
      { id: 'hold', kind: 'road', length: Lh, k0: k, k1: k, profile: F.FLAT }, { id: 'down', kind: 'road', length: 20, k0: k, k1: k, kp0: -a, kp1: -a, profile: F.FLAT },
      { id: 'over', kind: 'road', length: 80, profile: F.FLAT }];
  };
  const opts = { csp: true, fullSpeed: true }, low = (v) => v.amber.filter((x) => x.reason === 'low-overhead');
  const segsA = lap(0.8), pA = G.buildPath(segsA, { step: 2 }), vA = validate(pA, segsA, opts);
  assert.ok(low(vA).length > 0, 'control: the 0.8 m crossing is a low-overhead amber');
  const lead = [...vA._raw.stacked.values()].filter((e) => segsA[pA.samples[e.i].seg].id === 'lead' && e.low < Infinity);
  assert.ok(lead.length && lead.every((e) => segsA[pA.samples[e.p].seg].id === 'side'), 'control: on the lead, the deepest partner is the unchanged side road and the low room is the crossing\'s');
  const segsB = lap(3.0), pB = G.buildPath(segsB, { step: 2 }), fromS = pB.samples[pB.samples.findIndex((x) => x.seg === 3)].s;
  const full = validate(pB, segsB, opts), inc = revalidate(vA, pB, segsB, fromS, opts);
  assert.equal(low(full).length, 0, 'control: at 3 m a full validate has no low-overhead amber');
  assert.deepStrictEqual(low(inc), low(full), 'revalidate keeps no stale low-overhead amber');
  assert.deepStrictEqual(inc, full, 'and the whole result equals a full validate');
});
