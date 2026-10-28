// zonegrab.test.js: node --test app/test/zonegrab.test.js
// D519 Part 2, SCULPT GRABS THE ROAD ITSELF (O's design, exo_memory/handback/p-d519-design-O_2026-10-28.md §5): the pure functions, check-it tier.
//   zoneAt       rows 1-9: the zone at a share across the road and the channels it names, by piece kind; never a re-route (property)
//   axisOf       row 10: which axis a drag's first motion picks
//   dotStations  row 11: the dot rows' stations, thinned in metres and on screen
//   glyphOf      row 12: the glyph a zone shows on hover, and where across the road it stands
//   pickAcross   row 13: the pick across the road (app/preview/preview.js), on a real path and pose
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ZG = require('../core/zonegrab.js');

const FLAT = { cup: false, edge: false, tube: false, family: 'flat', s: null, walls: false };
const CUP = { ...FLAT, family: 'bowl', cup: true };
const EDGE = { ...FLAT, family: 'bowl', edge: true, s: 0.64 };
const TUBE = { ...FLAT, family: 'bowl', tube: true };
const PIPE = { ...FLAT, family: 'half-pipe', walls: true };
const chans = (z) => z && [z.U, z.L, z.alt];

test('row 1: the centre, |u| under 0.2: height on a lift, sideways out and in', () => {
  for (const u of [0, 0.19, -0.19]) { const z = ZG.zoneAt(u, FLAT); assert.equal(z.zone, 'centre', `u ${u}`); assert.equal(z.U, 'height'); assert.equal(z.L, 'lateral'); }
});

test('row 2: u 0.2 is the cup zone: a boundary belongs to the outer zone', () => {
  assert.equal(ZG.zoneAt(0.2, FLAT).zone, 'cup'); assert.equal(ZG.zoneAt(-0.2, FLAT).zone, 'cup');
});

test('row 3: the cup zone lifts the cup on a cup piece and banks a flat one; it takes no out-and-in; Alt is bank', () => {
  assert.deepEqual(chans(ZG.zoneAt(0.5, CUP)), ['c', null, 'phi']);
  assert.deepEqual(chans(ZG.zoneAt(0.5, FLAT)), ['phi', null, 'phi']);
  assert.equal(ZG.zoneAt(0.5, TUBE).U, 't', 'a tube: its sweep');
});

test('row 4: an edge piece (s 0.64): the edge zone lifts that side\'s edge and moves the edge start; just inside s is the cup zone', () => {
  assert.deepEqual(chans(ZG.zoneAt(0.7, EDGE)), ['e', 's', 'phi']);
  assert.deepEqual(chans(ZG.zoneAt(-0.7, EDGE)), ['er', 's', 'phi']);
  assert.equal(ZG.zoneAt(0.63, EDGE).zone, 'cup');
});

test('row 5: an edge piece whose edge starts at 0.95 has no edge zone: u 0.92 is the rim', () => {
  const z = ZG.zoneAt(0.92, { ...EDGE, s: 0.95 }); assert.equal(z.zone, 'rim'); assert.equal(z.U, 'e', 'its rim does the edge');
});

test('row 6: the rim, 0.9 to 1.25: width out and in, and the side\'s lift by piece kind', () => {
  assert.deepEqual(chans(ZG.zoneAt(0.95, EDGE)), ['e', 'w', 'phi']);
  assert.deepEqual(chans(ZG.zoneAt(-1.2, EDGE)), ['er', 'w', 'phi']);
  assert.equal(ZG.zoneAt(0.95, CUP).U, 'c');
  assert.equal(ZG.zoneAt(0.95, TUBE).U, 't');
  assert.equal(ZG.zoneAt(0.95, PIPE).U, 'r', 'a half-pipe with walls: wall rise');
  assert.equal(ZG.zoneAt(0.95, { ...PIPE, walls: false }).U, 'phi', 'a half-pipe without walls banks');
  assert.equal(ZG.zoneAt(0.95, FLAT).U, 'phi');
  assert.equal(ZG.zoneAt(1.25, FLAT).zone, 'rim', '1.25 is still the road');
});

test('row 7: off the road there is no zone (the key\'s tool takes the press)', () => {
  for (const u of [1.3, -1.26, NaN, null, undefined, Infinity, '0.5']) assert.equal(ZG.zoneAt(u, FLAT), null, `u ${u}`);
});

test('row 8: with Alt the zone is one channel, any direction: sideways at the centre, bank anywhere off it', () => {
  const c = ZG.zoneAt(0.1, FLAT, { alt: true }); assert.equal(c.U, 'lateral'); assert.equal(c.L, null);
  for (const [u, P] of [[0.5, CUP], [0.7, EDGE], [-0.95, TUBE], [1.1, PIPE]]) { const z = ZG.zoneAt(u, P, { alt: true }); assert.equal(z.U, 'phi', `u ${u}`); assert.equal(z.L, null); }
});

test('row 9 (property): never a re-route: no zone at any u, on any piece, with any modifiers, names kh, kv or length', () => {
  const kinds = [FLAT, CUP, EDGE, TUBE, PIPE, { ...EDGE, s: 0.5 }, { ...EDGE, s: 0.95 }, { ...EDGE, cup: true }, { ...PIPE, walls: false }, {}, null];
  let seen = 0;
  for (const P of kinds) for (const alt of [false, true]) for (let i = -130; i <= 130; i++) {
    const z = ZG.zoneAt(i / 100, P, { alt }); if (!z) continue; seen++;
    for (const ch of chans(z)) assert.ok(!['kh', 'kv', 'length'].includes(ch), `u ${i / 100} names ${ch}`);
  }
  assert.ok(seen > 5000, `the property was checked on ${seen} zones`);
});

test('row 10: axisOf: the axis a drag lies closer to wins; lift wins a tie; a road seen edge-on is out and in; a lift-only zone is always lift', () => {
  const axes = { U: [0, -10], L: [10, 0] }, z = ZG.zoneAt(0, FLAT), cup = ZG.zoneAt(0.5, CUP);
  assert.equal(ZG.axisOf([0, -8], axes, z), 'U'); assert.equal(ZG.axisOf([8, 0], axes, z), 'L');
  assert.equal(ZG.axisOf([6, -6], axes, z), 'U', '45 degrees: lift wins the tie');
  assert.equal(ZG.axisOf([0, -8], { U: [0, -3.9], L: [10, 0] }, z), 'L', 'U under 4 px a metre: edge-on');
  assert.equal(ZG.axisOf([8, 0], axes, cup), 'U', 'no L channel: lift whatever the motion');
});

test('row 11: dotStations thins the run\'s stations to 100 m (or the radius) and 24 px, drops those behind the camera, caps at 40, keeps the ends, and is stable', () => {
  const knots = Array.from({ length: 251 }, (_, i) => i * 20), run = { s0: 0, s1: 5000 }, proj = (s) => [s / 4, 300];   // a 5,000 m piece, 4 m a pixel
  assert.deepEqual(ZG.dotStations([], run, proj), []);
  const gaps = (a) => a.slice(1).map((x, i) => x - a[i]);
  const a = ZG.dotStations(knots, run, proj, { cap: 1000 }); assert.ok(Math.min(...gaps(a)) >= 100, `spacing ${Math.min(...gaps(a))}`);
  assert.equal(a[0], 0); assert.equal(a[a.length - 1], 5000, 'the run\'s first and last stations are kept');
  const r = ZG.dotStations(knots, run, proj, { radius: 150, cap: 1000 }); assert.ok(Math.min(...gaps(r)) >= 150, 'radius 150: 150 m apart');
  const tight = ZG.dotStations(knots, run, (s) => [s / 100, 300], { cap: 1000 }); assert.ok(gaps(tight).every((g) => g / 100 >= 24 - 1e-9), 'within 24 px they collapse to one');
  const behind = ZG.dotStations(knots, run, (s) => (s < 2500 ? null : [s / 4, 300]), { cap: 1000 }); assert.ok(behind.every((s) => s >= 2500), 'behind the camera: dropped');
  assert.ok(ZG.dotStations(knots, run, proj).length <= 40, 'at most 40');
  assert.deepEqual(ZG.dotStations(knots, run, proj), ZG.dotStations(knots, run, proj), 'the same input, the same dots');
  assert.deepEqual(ZG.dotStations([0, 20, 40], { s0: 0, s1: 40 }, (s) => [s * 2, 0]), [0, 40], 'a run shorter than the spacing keeps both its ends');
});

test('row 12: glyphOf: the glyph a zone shows, and the mark at the hit\'s u (a pair stands at its own place)', () => {
  const g = (u, P, alt) => ZG.glyphOf(ZG.zoneAt(u, P, { alt }), u, alt);
  assert.deepEqual(g(0.1, FLAT), { kind: 'brush-grab', place: { sides: [1], lat: 0.1 } });
  assert.deepEqual(g(-0.5, CUP), { kind: 'brush-cup', place: {} });
  assert.deepEqual(g(-0.5, FLAT), { kind: 'brush-twist', place: { sides: [-1], lat: 0.5 } });
  assert.deepEqual(g(0.7, EDGE), { kind: 'brush-edge', place: { sides: [1], lat: 0.7 } });
  assert.deepEqual(g(-0.95, FLAT), { kind: 'brush-width', place: {} });
  assert.equal(g(0.1, FLAT, true).kind, 'brush-side'); assert.equal(g(0.95, FLAT, true).kind, 'brush-twist');
});

// row 13: pickAcross on a real path: a 200 m straight seen from 60 m straight above its station at 100 m
const D = require('../../src/core/document.js'), { toPath } = require('../../src/core/adapter.js'), M = require('../camera/math.js');
const { pickAt, pickAcross } = require('../preview/preview.js');
const W = 800, H = 600;
function view(piece) {
  const { path, segments } = toPath(D.appendPiece(D.createDoc('p'), D.roadPiece(piece))), m = path.samples.find((x) => x.s === 100);
  const pose = { eye: [m.pos[0], m.pos[1] + 60, m.pos[2]], target: m.pos.slice(), up: m.T.slice(), fov: Math.PI / 3 }, VP = M.viewProj(pose, W / H);
  const scr = (p) => { const c = M.apply(VP, p); return [(c[0] / c[3] * 0.5 + 0.5) * W, (1 - (c[1] / c[3] * 0.5 + 0.5)) * H]; };
  return { path, segments, m, pose, scr };
}
const ROAD = { length: 200, family: 'flat', channels: { kh: () => 0, kv: () => 0, phi: () => 0, w: () => 32, r: () => 0 } };

test('row 13a: pickAcross on a straight flat 32 m road, from above: the left rim reads u +1, the centre 0, the right rim -1; pickAt misses the rims', () => {
  const V = view(ROAD);
  for (const k of [1, 0, -1]) {
    const [x, y] = V.scr([0, 1, 2].map((i) => V.m.pos[i] + k * 16 * V.m.L[i])), hit = pickAcross(V.path, V.segments, V.pose, x, y, W, H);
    assert.ok(hit, `a hit at k ${k}`); assert.ok(Math.abs(hit.u - k) <= 0.05, `u ${hit.u} at k ${k}`); assert.equal(hit.s, 100);
    if (k) assert.equal(pickAt(V.path, V.pose, x, y, W, H), null, 'pickAt finds nothing on the rim');
  }
});

test('row 13b: at the centreline pickAcross keeps pickAt\'s s, pos and px (the labels read the same); far off the road it is null', () => {
  const V = view(ROAD), [x, y] = V.scr(V.path.samples.find((q) => q.s === 120).pos), a = pickAcross(V.path, V.segments, V.pose, x, y, W, H), b = pickAt(V.path, V.pose, x, y, W, H);
  assert.equal(a.s, b.s); assert.deepEqual(a.pos, b.pos); assert.ok(Math.abs(a.px - b.px) < 1e-6, `px ${a.px} vs ${b.px}`);
  assert.equal(pickAcross(V.path, V.segments, V.pose, 5, 5, W, H), null);
});

test('row 13c: a cup section: u is the share along its arc, so a point halfway up the cup\'s side reads about 0.5', () => {
  const V = view({ ...ROAD, family: 'bowl', cup: true, channels: { ...ROAD.channels, c: () => 60 } });
  const A = ZG.acrossAt(V.path, V.segments, V.m, 0.5); assert.ok(A.pos[1] > V.m.pos[1] + 0.1, 'the cup rises toward the rim');
  const [x, y] = V.scr(A.pos), hit = pickAcross(V.path, V.segments, V.pose, x, y, W, H);
  assert.ok(Math.abs(hit.u - 0.5) <= 0.05, `u ${hit.u}`);
});
