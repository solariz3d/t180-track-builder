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

test('groupsText names EVERY red\'s place: none is dropped, so a refusal message carries them all', () => {
  const g = RG.groupReds(REDS, SEGS), text = RG.groupsText(g);
  for (const it of g.flatMap((x) => x.items)) assert.ok(text.includes(RG.placeText(it)), `${it.reason} ${it.km}`);
  assert.match(text, /^the road overlaps itself \(32\): at 1\.40–1\.43 km \(p2\)/);
});

test('pieceAt wraps a closed lap\'s s and is null for no segments', () => {
  assert.equal(RG.pieceAt(SEGS, 8500), 'p1'); assert.equal(RG.pieceAt(SEGS, 0), 'p1'); assert.equal(RG.pieceAt(SEGS, 7999.9), 'p8'); assert.equal(RG.pieceAt([], 10), null);
});
