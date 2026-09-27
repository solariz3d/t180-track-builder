// Headless tests for app/validate-ui: the colour along the track, its live update at the build head, and the jump's
// two landings. They drive the real src/doc, src/geom and src/validate. Run: node --test "app/test/*.test.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../../src/doc/index.js');
const G = require('../../src/geom/index.js');
const { validate } = require('../../src/validate/index.js');
const { MACH6 } = require('../../src/validate/limits.js');
const { flightY } = require('../../src/validate/jumps.js');
const { LEVEL, loadLevel, colourMap, recolour, levelAt, rgbaAt, PALETTE } = require('../validate-ui/colour.js');
const { createLive } = require('../validate-ui/live.js');
const { jumpArcs } = require('../validate-ui/jumparcs.js');

const kmh = (v) => v / 3.6;   // a document's speed is m/s
function build(words, speed) {
  let d = D.createDoc('t');
  for (const [w, patch] of words) { d = D.appendWord(d, w, speed ? { speed: kmh(speed) } : {}); if (patch) d = D.editWord(d, d.words[d.words.length - 1].id, { handles: patch }); }
  const segs = D.resolve(d).segments;
  return { d, segs, path: G.buildPath(segs, { step: 2 }) };
}
const levelsOf = (map) => map.stations.map((e) => Array.from(e.levels));

// ── the mapping, at every threshold ──
test('load → colour: below the 20 g suspension stop is clear, and exactly 20 g is info', () => {
  assert.strictEqual(MACH6.suspensionStopG, 20);
  assert.deepStrictEqual([loadLevel(19.999999), loadLevel(20)], [LEVEL.CLEAR, LEVEL.INFO]);
});
test('load → colour: exactly the proven 90 g is still info, and anything above it is amber', () => {
  assert.strictEqual(MACH6.provenG, 90);
  assert.deepStrictEqual([loadLevel(90), loadLevel(90.000001)], [LEVEL.INFO, LEVEL.AMBER]);
});
test('load → colour: a load no matter how high is amber, never red (FINDINGS.md:116-118 withdrew the 60 g red)', () => {
  assert.strictEqual(loadLevel(1e6), LEVEL.AMBER);
});
test('load → colour: a negative load (pulled off the surface) is clear here; it is the lap proof\'s, not a colour', () => {
  assert.strictEqual(loadLevel(-5), LEVEL.CLEAR);
});
test('load → colour reads the car it is given, not constants', () => {
  const car = { ...MACH6, suspensionStopG: 10, provenG: 50 };
  assert.deepStrictEqual([9.9, 10, 50, 50.1].map((g) => loadLevel(g, car)), [LEVEL.CLEAR, LEVEL.INFO, LEVEL.INFO, LEVEL.AMBER]);
});
test('the palette has one colour per level, red and amber distinct', () => {
  assert.strictEqual(PALETTE.length, 4);
  assert.notDeepStrictEqual(PALETTE[LEVEL.RED], PALETTE[LEVEL.AMBER]);
});

// ── the map, against validation ──
test('on a real result, a line is amber by load exactly where validation lists load-above-proven', () => {
  const { segs, path } = build([['straight'], ['tight', { length: 50 }], ['straight']], 745);
  const r = validate(path, segs, {}), map = colourMap(r);
  const inAmber = (s) => r.amber.some((a) => a.reason === 'load-above-proven' && s >= a.s0 - 1e-9 && s <= a.s1 + 1e-9);
  let amberLines = 0;
  for (const e of map.stations) e.lines.forEach((l, k) => {
    if (loadLevel(l.fN_g) === LEVEL.AMBER) { amberLines++; assert.ok(inAmber(e.s), `amber line at s ${e.s} outside every range`); assert.strictEqual(e.levels[k], LEVEL.AMBER); }
  });
  assert.ok(amberLines > 0, 'the fixture must carry amber, or this test proves nothing');
});
test('a red range colours every station inside it, both ends included, none outside, even with NO speed model (no load lines)', () => {
  const { segs, path } = build([['straight'], ['straight', { width: 16 }], ['straight']]);
  const hp = segs.map((g) => (g.id === 'w2' && g.profile ? { ...g, profile: { ...g.profile, psi: g.profile.psi.map((p, k) => (k === 0 || k === g.profile.psi.length - 1 ? 60 * Math.PI / 180 : p)), u: g.profile.u } } : g));
  const r = validate(path, hp, { csp: false });
  const red = r.red.find((x) => x.reason === 'steep-without-raycast');
  assert.ok(red, JSON.stringify(r.red));
  assert.strictEqual(r.lines.length, 0);   // no speed given: validation has no loads, yet the geometry red must show
  const map = colourMap(r, { path });
  assert.strictEqual(map.stations.length, path.samples.length);
  for (const e of map.stations) {
    const inside = e.s >= red.s0 - 1e-9 && e.s <= red.s1 + 1e-9;
    assert.ok(Array.from(e.levels).every((v) => (inside ? v === LEVEL.RED : v !== LEVEL.RED)), `s ${e.s}`);
  }
  assert.ok(map.stations.some((e) => e.s === red.s0) && map.stations.some((e) => e.s === red.s1), 'the range ends are stations');
});
test('an amber range that is not a load (a seam past the proven envelope) colours its stations amber; red still wins over it', () => {
  const lines = [0, 2, 4].map((s) => ({ s, u: 0, fN_g: 1 }));
  const map = colourMap({ lines, red: [{ s0: 4, s1: 4, reason: 'fold' }], amber: [{ s0: 2, s1: 4, reason: 'seam-past-envelope' }] });
  assert.deepStrictEqual(levelsOf(map), [[LEVEL.CLEAR], [LEVEL.AMBER], [LEVEL.RED]]);
});

test('levelAt: the last station at or before s, the nearest line in u, the first station before the start', () => {
  const lines = (s, a, b) => [{ s, u: -1, fN_g: a }, { s, u: 1, fN_g: b }];
  const map = colourMap({ lines: [...lines(0, 0, 25), ...lines(10, 95, 0)], red: [], amber: [] });
  assert.deepStrictEqual([levelAt(map, 9.99, -0.1), levelAt(map, 9.99, 0.1), levelAt(map, 10, -3), levelAt(map, -5, 5)], [LEVEL.CLEAR, LEVEL.INFO, LEVEL.AMBER, LEVEL.INFO]);
  assert.deepStrictEqual(rgbaAt(map, 10, -3), PALETTE[LEVEL.AMBER]);
});

// ── live, at the build head ──
test('an open track colours: no lap while open, and no red at the open head', () => {
  const { segs, path } = build([['straight'], ['turn']], 300);
  const out = createLive().update(path, segs);
  assert.deepStrictEqual([out.result.lap.ok, out.result.lap.reason, out.result.red.length, out.full], [null, 'open', 0, true]);
  assert.ok(out.map.stations.length > 0);
});
test('an append re-colours only the new span: earlier stations are kept as the same objects, and the map equals a full re-colour', () => {
  let { d, segs, path } = build([['straight'], ['turn'], ['straight']], 300);
  const live = createLive(), first = live.update(path, segs);
  const oldEnd = path.lengthM, nOld = first.map.stations.length;
  d = D.appendWord(d, 'tight', { speed: kmh(300) });
  const segs2 = D.resolve(d).segments, path2 = G.extendPath(path, segs2);
  const out = live.update(path2, segs2, { fromS: oldEnd });
  assert.strictEqual(out.full, false);
  const firstNew = out.map.stations.findIndex((e) => e.s >= oldEnd - 1e-9);
  // revalidate re-checks one station of look-back (its own, src/validate/index.js); nothing earlier may change
  assert.ok(out.changed.length > 0 && Math.min(...out.changed) >= firstNew - 1, `changed from ${Math.min(...out.changed)}, new span from ${firstNew}`);
  for (let k = 0; k < firstNew - 1; k++) assert.strictEqual(out.map.stations[k], first.map.stations[k], `station ${k} rebuilt`);
  assert.ok(out.map.stations.length > nOld);
  assert.deepStrictEqual(levelsOf(out.map), levelsOf(colourMap(validate(path2, segs2, {}), { path: path2 })));
});
test('re-colour also rebuilds an OLD station when a new red reaches back over it (e.g. new road stacked on old)', () => {
  const lines = [{ s: 0, u: 0, fN_g: 1 }, { s: 2, u: 0, fN_g: 1 }];
  const before = { lines, red: [], amber: [] }, after = { lines: lines.concat([{ s: 4, u: 0, fN_g: 1 }]), red: [{ s0: 0, s1: 0, reason: 'stacked-within-2m' }], amber: [] };
  const prev = colourMap(before), { map, changed } = recolour(prev, after);
  assert.deepStrictEqual(changed, [0, 2]);
  assert.strictEqual(map.stations[1], prev.stations[1]);
  assert.strictEqual(map.stations[0].levels[0], LEVEL.RED);
});

// ── the jump's two landings ──
function jumpTrack(speed) { return build([['straight'], ['jump'], ['straight']], speed); }
test('the landing arcs are src/validate/jumps.js flights: every point is flightY from the lip, at validation\'s speed and θ', () => {
  // flat take-off, and a 10° ramp (a climbing straight before the jump), so θ is really exercised
  const ramped = build([['straight'], ['straight', { climb: 10 * Math.PI / 180 }], ['jump'], ['straight']], 360);
  for (const { segs, path } of [jumpTrack(360), ramped]) {
    const r = validate(path, segs, {}), [jp] = r.jumps, [ja] = jumpArcs(r, path);
    const A = path.samples.find((p) => p.s === jp.s), h = Math.hypot(A.T[0], A.T[2]), axis = [A.T[0] / h, 0, A.T[2] / h], th = Math.asin(A.T[1]);
    assert.deepStrictEqual([ja.speedFrom, ja.speed, ja.arcs.map((a) => a.g)], ['validation', jp.speed, MACH6.jumpG.slice()]);
    for (const a of ja.arcs) for (const p of a.points) {
      const x = (p[0] - A.pos[0]) * axis[0] + (p[2] - A.pos[2]) * axis[2];
      assert.ok(Math.abs(p[1] - A.pos[1] - flightY(x, jp.speed, th, a.g)) < 1e-9, `g ${a.g} x ${x}`);
    }
  }
  assert.ok(Math.abs(validate(ramped.path, ramped.segs, {}).jumps[0].rampDeg - 10) < 0.1, 'the ramped fixture takes off at about 10°');
});
test('each caught arc ends exactly at validation\'s touchdown x, and the landing zone spans both touchdowns', () => {
  const { segs, path } = jumpTrack(360);
  const r = validate(path, segs, {}), [jp] = r.jumps, [ja] = jumpArcs(r, path);
  assert.ok(jp.landings.every((L) => L.caught), JSON.stringify(jp.landings));   // 100 m/s: both land (6.3 g needs 86.4)
  ja.arcs.forEach((a, k) => { assert.strictEqual(a.xEnd, jp.landings[k].x); assert.strictEqual(a.touchdown.x, jp.landings[k].x); });
  const td = ja.arcs.map((a) => a.touchdown.s);
  assert.deepStrictEqual(ja.zone, { s0: Math.min(...td), s1: Math.max(...td) });
  assert.ok(ja.zone.s0 > jp.s + jp.gap - 1, 'the zone is on the landing road, past the gap');
});
test('a landing the flight misses has no touchdown and no zone', () => {
  const { segs, path } = jumpTrack(300);   // 83.3 m/s: the 3.2 g flight lands, the 6.3 g one needs 86.4
  const r = validate(path, segs, {}), [ja] = jumpArcs(r, path);
  assert.deepStrictEqual(ja.arcs.map((a) => a.caught), [true, false]);
  assert.strictEqual(ja.arcs[1].touchdown, null); assert.strictEqual(ja.zone, null);
});
test('with no speed model, each landing is drawn at its own minimum speed, which just clears the landing lip', () => {
  const { segs, path } = jumpTrack(null);
  const r = validate(path, segs, {}), [jp] = r.jumps, [ja] = jumpArcs(r, path);
  assert.strictEqual(ja.speedFrom, 'minimum');
  const A = path.samples.find((p) => p.s === jp.s), h = Math.hypot(A.T[0], A.T[2]), axis = [A.T[0] / h, 0, A.T[2] / h], th = Math.asin(A.T[1]);
  ja.arcs.forEach((a, k) => {
    const v = jp.landings[k].minSpeed;
    assert.ok(Math.abs(flightY(jp.gap, v, th, a.g) - jp.climb) < 1e-9, 'that speed just clears the landing lip');
    // and the DRAWN arc is that flight: every point on it
    for (const p of a.points) {
      const x = (p[0] - A.pos[0]) * axis[0] + (p[2] - A.pos[2]) * axis[2];
      assert.ok(Math.abs(p[1] - A.pos[1] - flightY(x, v, th, a.g)) < 1e-9, `g ${a.g} x ${x}`);
    }
  });
});
test('a jump still waiting for its landing at the open head is not drawn', () => {
  const { segs, path } = build([['straight'], ['jump']], 300);
  const r = validate(path, segs, {});
  assert.ok(r.jumps[0].pending);
  assert.deepStrictEqual(jumpArcs(r, path), []);
});
