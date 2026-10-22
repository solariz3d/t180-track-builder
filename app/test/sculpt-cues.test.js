// sculpt-cues.test.js: D425 part 4, the page side of the Sculpt cues (P's design, exo_memory/handback/p-d425-sculpt-cues-P_2026-10-21.md §3, B's rows). The parts nobody can see by looking:
// the band's stations found once per drag, not per frame (the saving that pays for the cues); where the reach's end marks fall; the piece Stretch reaches; the glyph never takes a press;
// one value format for the road and the strip; the overlay's Sculpt cells. Pure, on a synthetic straight track; no browser.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SL = require('../core/selectionlayer.js');
const HD = require('../core/handles.js');
const VO = require('../core/valuesoverlay.js');

// a straight 1,000 m road along +z, a station every 2 m, five 200 m pieces p0..p4
const S = []; for (let s = 0; s <= 1000; s += 2) S.push({ s, seg: Math.min(4, Math.floor(s / 200)), pos: [0, 0, s], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] });
const track = (closed = false) => ({ closed, path: { samples: S }, segments: [0, 1, 2, 3, 4].map((i) => ({ id: `p${i}`, length: 200 })) });
const pose = { eye: [0, 300, -200], target: [0, 0, 500], up: [0, 1, 0], fov: 60 * Math.PI / 180 }, W = 1200, H = 700;

test('row 1: the band is worked out once while nothing it reads changes, and again when the camera, the band or the track does', () => {
  const tr = track(); let calls = 0;
  const f = SL.keyed((...a) => { calls++; return SL.bandLine(...a); });
  const band = { s0: 500, r: 60 }, first = f(tr, band, pose, W, H);
  for (let i = 0; i < 50; i++) assert.equal(f(tr, { s0: 500, r: 60 }, { ...pose }, W, H), first, 'a still frame gets the same list');
  assert.equal(calls, 1, 'fifty still frames: one filter over the stations');
  assert.equal(f.runs(), 1);
  f(tr, { s0: 500, r: 80 }, pose, W, H); f(tr, { s0: 500, r: 80 }, { ...pose, eye: [0, 310, -200] }, W, H); f(track(), { s0: 500, r: 80 }, { ...pose, eye: [0, 310, -200] }, W, H); f(track(), { s0: 500, r: 80 }, { ...pose, eye: [0, 310, -200] }, W, 800);
  assert.equal(calls, 5, 'a new radius, a moved camera, a new track and a new size each work it out again');
  assert.ok(first.length > 10 && first.every((p) => p.w >= 0 && p.w <= 1), 'and it is the band');
});

test('row 2: the reach\'s end marks sit at s0 − r and s0 + r, a tick across the road; past an open lap\'s end there is none, round a closed lap\'s start it wraps', () => {
  const VP = require('../camera/math.js').viewProj(pose, W / H), at = (s) => { const c = require('../camera/math.js').apply(VP, [0, 0, s]); return { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H }; };
  const m = SL.endMarks(track(), { s0: 500, r: 60 }, pose, W, H);
  assert.equal(m.length, 2);
  for (const [k, s] of [[0, 440], [1, 560]]) { const e = at(s); assert.ok(Math.abs(m[k].x - e.x) < 0.01 && Math.abs(m[k].y - e.y) < 0.01, `end ${k} at station ${s}`); }
  // the road runs up the screen here (along +z away from the camera), so a tick across it runs left-right
  for (const e of m) { assert.ok(Math.abs(Math.hypot(e.nx, e.ny) - 1) < 1e-9, 'a unit vector'); assert.ok(Math.abs(e.nx) > 0.99, `across the road: ${JSON.stringify(e)}`); }
  assert.equal(SL.endMarks(track(), { s0: 30, r: 60 }, pose, W, H).length, 1, 'an open lap: the end before its start has no mark');
  const w = SL.endMarks(track(true), { s0: 30, r: 60 }, pose, W, H), e970 = at(970);
  assert.equal(w.length, 2, 'a closed lap: both'); assert.ok(Math.abs(w[0].x - e970.x) < 0.01 && Math.abs(w[0].y - e970.y) < 0.01, 'the first wraps to station 970');
  assert.deepEqual(SL.endMarks(track(), { s0: 500, r: 0 }, pose, W, H), [], 'no radius, no marks');
});

test('row 3: Stretch\'s reach is the piece holding the station, from its first joint to its last', () => {
  assert.deepEqual(SL.pieceSpan(track(), 450), { id: 'p2', s0: 499, r: 99 }, 'p2 holds stations 400 to 598');
  assert.equal(SL.pieceSpan(track(), 999).id, 'p4');
  assert.equal(SL.pieceSpan({ path: { samples: [] }, segments: [] }, 10), null);
  assert.equal(SL.pieceSpan(track(), NaN), null);
});

test('row 4: the brush glyph stands on the road at its station and is never hit, so a press on it is the tool\'s, not a handle\'s', () => {
  const brush = { samples: S, s: 500, half: 15 };
  const one = HD.placeHandles({ kinds: ['brush-twist'], brush, samples: [], s0: 0, s1: 0, half: () => 0 });
  assert.equal(one.length, 1); assert.deepEqual(one[0].pos, [0, 0, 500]); assert.equal(one[0].brush, true);
  const pair = HD.placeHandles({ kinds: ['brush-width'], brush, samples: [], s0: 0, s1: 0, half: () => 0 });
  assert.deepEqual(pair.map((h) => h.pos[0]).sort((a, b) => a - b), [-15, 15], 'Width: a mark at each edge, as Build\'s');
  assert.deepEqual(HD.placeHandles({ kinds: ['brush-edge'], brush: { ...brush, sides: [-1] }, samples: [], s0: 0, s1: 0, half: () => 0 }).map((h) => h.pos[0]), [-15], 'Edge: the right edge when it is named');
  const list = one.map((h) => ({ ...h, screen: { x: 100, y: 100 } }));
  assert.equal(HD.hitTest(list, 100, 100), null, 'the pointer exactly on it: no handle');
  assert.equal(HD.hitTest([...list, { id: 'bank:1', screen: { x: 101, y: 100 } }], 100, 100).id, 'bank:1', 'a real handle beside it still wins');
});

test('row 5: one format for the road and the strip: the channel\'s name, a sign, two decimals, its unit; and the words for each way', () => {
  assert.equal(HD.brushFormat('kh', 0.12 * HD.DEG / 100), 'turn rate +0.12 °/100 m');
  assert.equal(HD.brushFormat('phi', -12 * HD.DEG), 'bank −12.00 °');
  assert.equal(HD.brushFormat('height', 1.2), 'height +1.20 m');
  assert.equal(HD.brushFormat('s', 0.05), 'edge start +0.05', 'a share has no unit');
  assert.equal(HD.brushFormat('nope', 1), ''); assert.equal(HD.brushFormat('kh', NaN), '');
  for (const [k, x] of Object.entries(HD.BRUSH_CHANNELS)) assert.ok(x.label && typeof x.unit === 'string' && x.k > 0 && /^#[0-9a-f]{6}$/.test(x.colour), k);
  assert.equal(HD.brushWords('brush-grab'), 'lift ↑ / ↓ sink · Alt ↔');
  assert.equal(HD.brushWords('brush-side'), 'left ← / → right', 'Alt\'s other axis reads sideways');
  assert.equal(HD.brushWords('brush-stretch'), 'longer ↑ / ↓ shorter · Alt: keep rate');
  assert.equal(HD.brushWords('brush-smooth'), 'smoother ↑', 'Smooth: one way');
});

test('row 6: in Sculpt the big overlay has four cells, the tool, the value under its channel\'s name, the radius and what moves', () => {
  const e = VO.sculptEntries({ tool: 'Bend', name: 'turn rate', value: '+0.12 °/100 m', radius: '60 m', moves: 'road after' });
  assert.deepEqual(e.map((x) => [x.key, x.label, x.value]), [['tool', 'tool', 'Bend'], ['value', 'turn rate', '+0.12 °/100 m'], ['radius', 'radius', '60 m'], ['moves', 'moves', 'road after']]);
  assert.equal(VO.sculptEntries({ tool: 'Twist', name: 'bank' })[1].value, '—', 'before a drag: no value yet');
  assert.equal(VO.sculptEntries(null), null);
});
