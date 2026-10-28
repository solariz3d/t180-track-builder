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
const { pickAt, pickAcross, rayAt } = require('../preview/preview.js');
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
// ── D520: THE GRABBED POINT FOLLOWS THE MOUSE (plan_d520_sculpt_point_follows_the_mouse_2026-10-28.md). Each row presses a REAL road (a 200 m piece through the core and
// its adapter), drags through the core shell as the panel does (beginFollow, brushTo with follow's set, endBrush), builds the road again and reads where the pressed
// point and the far rim went. The falsifier the plan registers: the pressed point drifting from the pointer.
const { createCoreShell } = require('../core/coreshell.js');
const S0 = 100, RAD = 60, DEGR = Math.PI / 180;
const road = (phiDeg, o = {}) => D.appendPiece(D.createDoc('p'), D.roadPiece({ length: 200, family: o.family || 'flat', ...(o.cup !== undefined ? { cup: true } : {}),
  channels: { kh: () => o.kh || 0, kv: () => o.kv || 0, phi: () => phiDeg * DEGR, w: () => 32, r: () => 0, ...(o.cup !== undefined ? { c: () => o.cup } : {}) } }));
const surface = (doc, u, s = S0) => { const { path, segments } = toPath(doc), m = path.samples.find((x) => Math.abs(x.s - s) < 1e-9); return ZG.acrossAt(path, segments, m, u).pos; };
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
async function grabbed(doc, u, delta) {
  const sh = await createCoreShell({ autosaveMs: 0 }); sh.adopt(doc); sh.setSculpt(true);
  const { path, segments } = toPath(doc), F = ZG.frameAt(path, segments, S0, u), info = sh.zoneInfo(S0, u), d = ZG.follow(delta, F, info);
  sh.beginFollow({ s0: S0, r: RAD }); assert.ok(sh.getState().brush, sh.getState().message || 'the grab opened'); sh.brushTo(d); const out = sh.getState().history.present; sh.endBrush();
  const want = surface(doc, u).map((x, k) => x + delta[k] - dotv(delta, F.T) * F.T[k]);
  return { d, F, out, sh, miss: gap(surface(out, u), want), far: gap(surface(out, u < 0 ? 1 : -1), surface(doc, u < 0 ? 1 : -1)) };
}
const MM = 5e-4;   // half a millimetre: the doubles stored to 0.1 mm (DEC.h, l, w) and the bank's smoothstep between the path's samples (measured 0.004 to 0.05 mm, D520 probe.js)

test('row 14a (D520): the pointer\'s ray passes through the world point drawn under it, and the grab plane meets it there: a pointer that has not moved lands on the hit', () => {
  const pose = { eye: [10, 40, -30], target: [0, 0, 50], up: [0, 1, 0], fov: Math.PI / 3 }, VP = M.viewProj(pose, W / H);
  for (const p of [[0, 0, 50], [12, 3, 70], [-20, -4, 40]]) {
    const c = M.apply(VP, p), x = (c[0] / c[3] * 0.5 + 0.5) * W, y = (1 - (c[1] / c[3] * 0.5 + 0.5)) * H, r = rayAt(pose, x, y, W, H);
    const t = dotv(p.map((v, k) => v - r.origin[k]), r.dir), off = gap(p, r.origin.map((v, k) => v + r.dir[k] * t));
    assert.ok(off < 1e-9, `the ray misses ${p} by ${off}`); assert.ok(gap(ZG.planePoint(r, p, r.forward), p) < 1e-9, 'the plane through p, under the same pointer, is p');
  }
  assert.equal(rayAt(pose, 1, 1, 0, H), null); assert.equal(ZG.planePoint({ origin: [0, 0, 0], dir: [1, 0, 0] }, [0, 0, 5], [0, 0, 1]), null, 'a ray along the plane meets it nowhere');
});

// AMENDED D522 (plan_d522_grab_one_side_within_the_radius decision 1; the user, 15:39: "it should only affect one side of the track ... not both sides"): D520 slid the whole
// section for any press off the rims; now only a press in the centre band (|u| < ZG.HINGE_U) does, and every other hinges about the far rim. So this row keeps its centre-band
// press (u 0.05: l only) and its u 0.5 press now pins the hinge: the far rim stays and the near side follows.
test('row 14b (D520, amended D522): a sideways drag in the centre band slides the road under the point, l only; at u 0.5 it hinges about the far rim; the point follows both', async () => {
  const doc = road(0), { path, segments } = toPath(doc), F = ZG.frameAt(path, segments, S0, 0.05), r = await grabbed(doc, 0.05, F.R.map((x) => x * 2.5));
  assert.ok(Math.abs(r.d.l - 2.5) < 1e-9 && Math.abs(r.d.h) < 1e-9 && r.d.w === undefined && r.d.phi === undefined, JSON.stringify(r.d));
  assert.ok(r.miss < MM, `u 0.05: the point misses the pointer by ${r.miss} m`);
  const F5 = ZG.frameAt(path, segments, S0, 0.5), h = await grabbed(doc, 0.5, F5.R.map((x) => x * 2.5));
  assert.ok(Number.isFinite(h.d.w) && h.d.w > 0, `the road widens on the pressed side: ${JSON.stringify(h.d)}`);
  assert.ok(h.far < MM, `u 0.5: the far rim moves ${h.far} m`); assert.ok(h.miss < MM, `u 0.5: the point misses the pointer by ${h.miss} m`);
});

test('row 14c (D520, plan item 2, "centre, up"): an upward drag at the centre lifts the height by the drag, and the point follows', async () => {
  const r = await grabbed(road(0), 0.05, [0, 2, 0]);
  assert.ok(Math.abs(r.d.h - 2) < 1e-9 && Math.abs(r.d.l) < 1e-9, JSON.stringify(r.d)); assert.ok(r.miss < MM, `misses by ${r.miss}`);
});

// AMENDED D522 (decision 1, as row 14b): D520 turned the cup to lift a press partway out on a cup piece, and lifted a plain road whole; both now hinge about the far rim, which
// moves both sides no more (the cup is a both-sides shape: turning it lifted the far side as well). The row pins that: no cup change, a bank, and the far rim kept.
test('row 14d (D520, amended D522): partway out on a cup piece or a plain road an upward drag hinges about the far rim: no cup change, the far rim stays, the point follows', async () => {
  for (const o of [{ cup: 30, family: 'bowl' }, {}]) {
    const r = await grabbed(road(0, o), 0.6, [0, 1.5, 0]);
    assert.equal(r.d.c, undefined, JSON.stringify(r.d)); assert.ok(r.d.phi > 0, `the left side up is a left bank: ${JSON.stringify(r.d)}`);
    assert.ok(r.far < MM, `${o.cup ? 'cup' : 'plain'}: the far rim moves ${r.far} m`); assert.ok(r.miss < MM, `${o.cup ? 'cup' : 'plain'}: the point misses by ${r.miss} m`);
  }
});

test('row 14l (D522, the plan\'s far-rim rows): a press at u 0.25, 0.5 and 0.75, either side, on a flat road and at 60°, dragged up, out and both: the far rim stays within 1 cm', async () => {
  let worstFar = 0, worstMiss = 0;
  for (const phi of [0, 60]) for (const u of [0.25, 0.5, 0.75, -0.25, -0.5, -0.75]) for (const delta of [[0, 1.5, 0], [2, 0, 0], [-1, 1, 0.5]]) {
    const r = await grabbed(road(phi), u, delta); worstFar = Math.max(worstFar, r.far); worstMiss = Math.max(worstMiss, r.miss);
  }
  assert.ok(worstFar < 0.01, `the far rim moves up to ${worstFar} m`); assert.ok(worstMiss < 0.01, `the point misses by up to ${worstMiss} m`);
});

test('row 14m (D522, decision 2): a 30 m grab on 20 m knots is sharp: the road changes by more than 0.1 mm only within the 30 m asked, and outside it by under 0.1 mm (Sharp\'s declared spill)', async () => {
  // the road read every 0.5 m along the 200 m piece, its centreline and both rims; "moved" is the most any of the three moved there
  const along = (doc) => { const { path, segments } = toPath(doc); return path.samples.filter((m) => Math.abs(m.s * 2 - Math.round(m.s * 2)) < 1e-9).map((m) => ({ s: m.s, p: [-1, 0, 1].map((u) => ZG.acrossAt(path, segments, m, u).pos) })); };
  const doc = road(60), before = along(doc), { path, segments } = toPath(doc), F = ZG.frameAt(path, segments, S0, 0.5), d = ZG.follow([0, 1.5, 0], F, {});
  const sh = await createCoreShell({ autosaveMs: 0 }); sh.adopt(doc); sh.setSculpt(true); sh.beginFollow({ s0: S0, r: 30 }); sh.brushTo(d);
  const rUsed = sh.getState().brush.rUsed, after = along(sh.getState().history.present); sh.endBrush();
  const moved = after.map((x, i) => ({ s: x.s, m: Math.max(...x.p.map((p, k) => gap(p, before[i].p[k]))) }));
  const reach = (tol) => Math.max(0, ...moved.filter((x) => x.m > tol).map((x) => Math.abs(x.s - S0)));
  assert.equal(rUsed, 30, 'the band shows 30 m: the radius used is the radius asked');
  assert.ok(reach(1e-4) <= 30, `more than 0.1 mm reaches ${reach(1e-4)} m from the press`);
  assert.ok(Math.max(...moved.filter((x) => Math.abs(x.s - S0) > 30).map((x) => x.m)) <= 1e-4, 'outside the 30 m, under 0.1 mm (Sharp\'s declared spill)');
});

test('row 14e (D520, plan item 2, "a rim, sideways"): on a flat road the touched edge moves and the far edge stays: w += side·e, l += e/2, as the plan checks it', async () => {
  for (const side of [1, -1]) {
    const u = 0.95 * side, doc = road(0), { path, segments } = toPath(doc), F = ZG.frameAt(path, segments, S0, u), e = 3 * side, r = await grabbed(doc, u, F.R.map((x) => x * e));
    const reach = (1 + 0.95) / 2;   // the press at 0.95 is this share of the width from the far rim, so the width grows by e / reach and the centre by half of that
    assert.ok(Math.abs(r.d.w - (side * e) / reach) < 1e-6 && Math.abs(r.d.l - e / (2 * reach)) < 1e-6 && Math.abs(r.d.phi) < 1e-9, JSON.stringify(r.d));
    assert.ok(r.far < MM, `side ${side}: the far rim moves ${r.far} m`); assert.ok(r.miss < MM, `side ${side}: the point misses by ${r.miss} m`);
  }
});

test('row 14f (D520, plan item 2, "a rim, up"): on a flat road the touched side rises, the far rim stays: a bank and half the lift', async () => {
  for (const side of [1, -1]) {
    const r = await grabbed(road(0), side, [0, 2, 0]);
    assert.ok(Math.sign(r.d.phi) === side && Math.abs(Math.abs(Math.tan(r.d.phi)) - 2 / 32) < 1e-9 && Math.abs(r.d.h - 1) < 1e-6, JSON.stringify(r.d));
    assert.ok(r.far < MM, `the far rim moves ${r.far} m`); assert.ok(r.miss < MM, `the point misses by ${r.miss} m`);
  }
});

test('row 14g (D520, plan item 2, "the forward component is dropped"): a drag along the road changes nothing anywhere across it', () => {
  const doc = road(-60, { kh: 0.004 }), { path, segments } = toPath(doc);
  for (const u of [0, 0.5, -0.95, 1]) { const F = ZG.frameAt(path, segments, S0, u), d = ZG.follow(F.T.map((x) => x * 4), F, {}); for (const k of Object.keys(d)) assert.ok(Math.abs(d[k]) < 1e-9, `u ${u}: ${k} ${d[k]}`); }
});

test('row 14h (D520, O\'s catch, D519 §6): on a road banked 60° and 85°, either way, a rim dragged any way keeps the FAR rim where it was, and the point follows', async () => {
  let worstFar = 0, worstMiss = 0;
  for (const phi of [60, -60, 85, -85]) for (const u of [1, -1, 0.95, -0.95]) for (const delta of [[0, 2, 0], [2, 0, 0], [1.5, -1, 0.7], [0, -3, 0]]) {
    const r = await grabbed(road(phi), u, delta); worstFar = Math.max(worstFar, r.far); worstMiss = Math.max(worstMiss, r.miss);
  }
  assert.ok(worstFar < MM, `the far rim moves up to ${worstFar} m`); assert.ok(worstMiss < MM, `the point misses by up to ${worstMiss} m`);
});

test('row 14i (D520, the control for 14h): the plan\'s flat-road rim rule (w += e, l += e/2 along world-horizontal left) moves the far rim of an 85° road by more than a metre', async () => {
  const doc = road(-85), { path, segments } = toPath(doc), F = ZG.frameAt(path, segments, S0, 1), sh = await createCoreShell({ autosaveMs: 0 });
  sh.adopt(doc); sh.setSculpt(true); sh.beginFollow({ s0: S0, r: RAD }); sh.brushTo({ w: 2, l: 1 }); const naive = sh.getState().history.present; sh.endBrush();
  const far = gap(surface(naive, -1), surface(doc, -1)), solved = await grabbed(doc, 1, F.R.map((x) => x * 2));
  assert.ok(far > 1, `the plan's rule moves the far rim ${far} m`); assert.ok(solved.far < MM, `the follow keeps it within ${solved.far} m`);
});

test('row 14j (D520): on a road pitched up to 23°, where a lift along world up also slides the section along the road, the road stays under the pointer to 1 cm', async () => {
  const toLine = (doc, u, p) => {
    const { path, segments } = toPath(doc), pts = path.samples.filter((m) => Math.abs(m.s - S0) <= 10).map((m) => ZG.acrossAt(path, segments, m, u).pos); let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], v = pts[i + 1].map((x, k) => x - a[k]), t = Math.max(0, Math.min(1, dotv(p.map((x, k) => x - a[k]), v) / dotv(v, v))); best = Math.min(best, gap(p, a.map((x, k) => x + v[k] * t))); }
    return best;
  };
  let worst = 0;
  for (const o of [{ kv: 0.002 }, { kv: 0.004 }, { kh: 0.004, kv: -0.002 }]) for (const phi of [-85, 60]) for (const u of [1, -0.95, 0, 0.5]) {
    const doc = road(phi, o), r = await grabbed(doc, u, [1.2, 1.5, -0.8]), want = surface(doc, u).map((x, k) => x + [1.2, 1.5, -0.8][k] - dotv([1.2, 1.5, -0.8], r.F.T) * r.F.T[k]);
    worst = Math.max(worst, toLine(r.out, u, want));
  }
  assert.ok(worst < 0.01, `the pointer is ${worst} m off the road`);
});

test('row 14k (D520): follow\'s boundaries: no frame, a delta that is not three numbers, and a road pitched past ~87° give null; a rim pulled past the far rim keeps a tenth of the width and does not fold the road over', () => {
  const doc = road(0), { path, segments } = toPath(doc), F = ZG.frameAt(path, segments, S0, 1);
  assert.equal(ZG.follow([0, 1, 0], null), null); assert.equal(ZG.follow([0, NaN, 0], F), null); assert.equal(ZG.follow([0, 1], F), null);
  assert.equal(ZG.follow([0, 1, 0], { ...F, U0: [0, 0.01, 1] }), null);
  const d = ZG.follow(F.R.map((x) => x * -100), F, {}); assert.ok(Math.abs(d.w - 32 * (ZG.SQUEEZE_MIN - 1)) < 1e-6, `the width change ${d.w}`); assert.ok(Math.abs(d.phi) < 1e-9, `the bank change ${d.phi}`);
  assert.equal(ZG.frameAt(path, segments, NaN, 0), null); assert.equal(ZG.frameAt({ samples: [] }, segments, S0, 0), null);
});

// 0.4.29 (O's before-release review, p-0429-review-O_2026-10-28.md item 2): the panel draws the dots and handles from shell.sculptInfo(), which reads the selection only while it
// belongs to the document shown. A follow step made a new document and left the selection on the old one, so after the first step the dots vanished until the run was clicked again.
test('row 14n (0.4.29): a grab at a dot keeps the run selected: the handles read it at every step and after the release, on the document the grab made', async () => {
  const doc = road(0), sh = await createCoreShell({ autosaveMs: 0 }); sh.adopt(doc); sh.setSculpt(true); sh.selectPiece(0);
  assert.equal(sh.sculptInfo().index, 0, 'the run is selected before the press');
  const { path, segments } = toPath(doc), F = ZG.frameAt(path, segments, S0, 0.5);
  sh.beginFollow({ s0: S0, r: RAD });
  for (const k of [1, 2, 3]) { sh.brushTo(ZG.follow([0, 0.5 * k, 0], F, {})); const si = sh.sculptInfo(); assert.ok(si && si.index === 0, `step ${k}: the run is still selected`); }
  sh.endBrush();
  const st = sh.getState(), si = sh.sculptInfo();
  assert.ok(st.history.present !== doc, 'the grab changed the road'); assert.ok(si && si.index === 0, 'after the release the run is still selected'); assert.equal(st.selection.base, st.history.present, 'on the document the grab made');
});
