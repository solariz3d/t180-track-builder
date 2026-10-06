// redgroups.test.js: node --test app/test/redgroups.test.js
// D242 item 4: a refusal shows EVERY red in plain words, grouped, with where (s in km and the piece). The reds below are TEST 1's kinds and places
// (E's diagnosis, loop/test1_raygap_diagnosis_2026-10-04.md: 6 downforce-ray-gap, 13 self-intersection, 13 stacked, 1 roll-rate, 1 lap-proof), on a
// synthetic layout of segments, so nothing of the keeper's is read.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RG = require('../validate-ui/redgroups.js');

// segments: p1 … p8, each 1,000 m, the lap 8 km
const SEGS = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, length: 1000 }));
const ranges = (reason, list) => list.map(([s0, s1]) => ({ reason, s0, s1 }));
const RAY = [[4510, 4510], [5814, 5818], [5856, 5858], [5946, 5948], [5984, 5984], [6022, 6022]];
const OVER = [[1404, 1428], [1478, 1506], [1720, 1730], [2246, 2248], [4508, 4518], [5816, 5856], [5910, 5944], [5984, 6020], [6348, 6382], [6442, 6446], [6498, 6516], [6524, 6556], [6576, 6578]];
const REDS = [...ranges('downforce-ray-gap', RAY), ...ranges('self-intersection', OVER), ...ranges('stacked-within-2m', OVER), { reason: 'roll-rate', s0: 2482, s1: 2492, worst: 1.219 }, { reason: 'lap-proof', s0: 1376, s1: 7224, detail: 'stacked at s 1404.0 m' }];

test('every red is in exactly one group, and the groups count them all (34 in, 34 out)', () => {
  const g = RG.groupReds(REDS, SEGS);
  assert.equal(g.reduce((a, x) => a + x.count, 0), REDS.length); assert.equal(g.reduce((a, x) => a + x.items.length, 0), REDS.length);
});

test('the overlap is ONE group, first, in plain words: self-intersection, stacked and a ray red on an overlap all say the road overlaps itself', () => {
  const g = RG.groupReds(REDS, SEGS);
  assert.equal(g[0].key, 'overlap'); assert.equal(g[0].title, 'the road overlaps itself'); assert.equal(g[0].count, 6 + 13 + 13);
  assert.ok(g[0].items.every((it) => !/[a-z]+-[a-z]+-[a-z]+/.test(it.what)), 'no validator id in the words a person reads');
  assert.equal(g[0].items.find((it) => it.reason === 'downforce-ray-gap').what, 'another road under the car\'s downforce ray');
});

test('a downforce-ray-gap with NO overlap near it keeps its own words (a real gap), never called an overlap', () => {
  const g = RG.groupReds([{ reason: 'downforce-ray-gap', s0: 3000, s1: 3000 }, { reason: 'self-intersection', s0: 6000, s1: 6010 }], SEGS);
  const gap = g.find((x) => x.key === 'downforce-ray-gap'); assert.ok(gap, 'its own group'); assert.match(gap.title, /gap in the road under the car/);
  assert.equal(g.find((x) => x.key === 'overlap').count, 1);
});

test('where: s in km and the piece it is on (a range spanning two pieces names both); roll-rate and lap-proof get their own plain titles', () => {
  const g = RG.groupReds(REDS, SEGS), all = g.flatMap((x) => x.items);
  const it = all.find((x) => x.s0 === 5816 && x.reason === 'self-intersection'); assert.equal(it.km, '5.82–5.86 km'); assert.equal(it.piece, 'p6');
  assert.equal(RG.placeText(all.find((x) => x.reason === 'lap-proof')), 'at 1.38–7.22 km (p2–p8)');
  assert.equal(g.find((x) => x.key === 'roll-rate').title, 'the road rolls too fast'); assert.equal(g.find((x) => x.key === 'lap-proof').title, 'the lap does not prove');
});

// D248 amended this row BY NAME: it asserted every red's OWN place text in the message; places are now merged (E's note B), so it asserts
// one line per PLACE, every red inside exactly one of them, and the count in places (was "(32)", the reds)
test('groupsText names one line per PLACE and every red lies inside exactly one of them: none is dropped, the count is of places', () => {
  const g = RG.groupReds(REDS, SEGS), text = RG.groupsText(g);
  for (const grp of g) for (const it of grp.items) {
    const holders = grp.places.filter((p) => it.s0 >= p.s0 && it.s1 <= p.s1);   // a group's places never overlap (overlapping reds always merge)
    assert.equal(holders.length, 1, `${it.reason} ${it.km} lies in exactly one place`); assert.ok(text.includes(RG.placeText(holders[0])), `and that place is in the text`);
  }
  // 13: the ray red at 6.022 km (p7) touches 5.98–6.02 km (p6–p7) on the piece that place ends on, so it is that place (the first D248 rule,
  // same STARTING piece only, said 14; the real-window check showed that rule leaves a red inside a two-piece place on its own line)
  assert.match(text, /^the road overlaps itself \(13 places\): at 1\.40–1\.43 km \(p2\), at 1\.48–1\.51 km \(p2\)/);
  assert.equal(g[0].count, 32, 'the group still counts every red');
});

// D248 (E's note B on the D242 look): near-duplicate places merged, per piece, per group
test('D248: overlapping reds on one piece are ONE place (a self-intersection, a stacked red and a ray red at 1.47–1.51 km), and a click goes to its start', () => {
  const g = RG.groupReds([{ reason: 'self-intersection', s0: 1474, s1: 1506 }, { reason: 'stacked-within-2m', s0: 1478, s1: 1506 }, { reason: 'downforce-ray-gap', s0: 1480, s1: 1480 }], SEGS);
  assert.equal(g.length, 1); const [p] = g[0].places;
  assert.equal(g[0].places.length, 1); assert.equal(RG.placeText(p), 'at 1.47–1.51 km (p2)'); assert.equal(p.s, 1474, 'the click target is the merged start');
  assert.equal(p.reds, 3); assert.deepEqual(p.reasons, ['self-intersection', 'stacked-within-2m', 'downforce-ray-gap']); assert.equal(RG.placesText(g[0]), '1 place'); assert.equal(g[0].count, 3);
});

test('D248: TOUCHING reds merge (a gap of 2 m, one station), a gap of 3 m does not; reds on DIFFERENT pieces never merge, even touching', () => {
  const touch = RG.groupReds([{ reason: 'roll-rate', s0: 2400, s1: 2410 }, { reason: 'roll-rate', s0: 2412, s1: 2420 }], SEGS)[0];
  assert.equal(touch.places.length, 1); assert.equal(touch.places[0].km, '2.40–2.42 km');
  const apart = RG.groupReds([{ reason: 'roll-rate', s0: 2400, s1: 2410 }, { reason: 'roll-rate', s0: 2413, s1: 2420 }], SEGS)[0];
  assert.equal(apart.places.length, 2, 'a 3 m gap is two places');
  const across = RG.groupReds([{ reason: 'roll-rate', s0: 990, s1: 999 }, { reason: 'roll-rate', s0: 1000, s1: 1010 }], SEGS)[0];
  assert.deepEqual(across.places.map((p) => p.piece), ['p1', 'p2'], 'one place per piece');
});

// found by the D248 real-window check: a coil's close preview read "at 1.08–1.16 km (p4–p5), at 1.15 km (p5)", one place on two lines, because
// the second red STARTS on a later piece than the first, though it lies inside it
test('D248: a red inside a place that spans two pieces is the same place (a red on p3 inside 1.99–2.06 km on p2–p3); touching after it on its END piece merges too', () => {
  const g = RG.groupReds([{ reason: 'self-intersection', s0: 1990, s1: 2060 }, { reason: 'stacked-within-2m', s0: 2050, s1: 2050 }, { reason: 'self-intersection', s0: 2062, s1: 2070 }], SEGS)[0];
  assert.deepEqual(g.places.map(RG.placeText), ['at 1.99–2.07 km (p2–p3)']); assert.equal(g.places[0].s, 1990, 'the click target is the merged start');
});

test('pieceAt wraps a closed lap\'s s and is null for no segments', () => {
  assert.equal(RG.pieceAt(SEGS, 8500), 'p1'); assert.equal(RG.pieceAt(SEGS, 0), 'p1'); assert.equal(RG.pieceAt(SEGS, 7999.9), 'p8'); assert.equal(RG.pieceAt([], 10), null);
});
