// ailine.test.js: node --test test/*.test.js
// The AI line (src/export/ailine.js) and its wiring into scripts/build_platform_test.js. Dependency-free.
//
// TOLERANCES:
// - Round trip: EXACT after float32 rounding (every float field is stored as float32; the ints are exact).
// - Closed length of the FLOOR line against the platform loop's path length (C's 500 m): 0.05 m. The line is a polygon
//   of 1.5 m chords, and each chord on a 28.66 m turn is shorter than its arc by R·Δθ³/24 ≈ 1.7e-4 m; about 120 of
//   them come to about 0.02 m. The WALL line is longer by design (it rides the outside walls), so it is not compared.
// - Angles on the walls: ±2° around the balance angle, from the stored surface normal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateAiLine, encodeAiLine, readAiLine, AiLineError, EXTRA } = require('../src/export/ailine.js');
const pt = require('../scripts/platform_test.js');

const TRACK = pt.buildTrack();
const WALL = generateAiLine(TRACK.dsn, TRACK.secs, { mode: 'wall' });
const FLOOR = generateAiLine(TRACK.dsn, TRACK.secs, { mode: 'floor' });
const DEG = 180 / Math.PI;
const f = Math.fround;

// An independent walk of the bytes, from the layout in ailine.js's header (checked there against real files).
function walk(b) {
  let o = 0; const i32 = () => { const v = b.readInt32LE(o); o += 4; return v; }, f32 = () => { const v = b.readFloatLE(o); o += 4; return v; };
  const h = { version: i32(), n: i32(), lapTime: i32(), sampleCount: i32() };
  h.points = []; for (let k = 0; k < h.n; k++) h.points.push({ pos: [f32(), f32(), f32()], length: f32(), id: i32() });
  h.n2 = i32(); h.extra = []; for (let k = 0; k < h.n2; k++) { const e = {}; for (const x of EXTRA) e[x] = f32(); h.extra.push(e); }
  h.hasGrid = i32(); h.left = b.length - o;
  return h;
}
// Which station each point came from, the way generateAiLine picks them (every 3rd, plus both sides of the jump gap).
const kept = (() => { const st = TRACK.dsn.stations, k = []; for (let i = 0; i < st.length; i++) if (i % 3 === 0 || st[i].gapNext || (i > 0 && st[i - 1].gapNext)) k.push(i); return k; })();
const wordOf = (k) => TRACK.dsn.stations[kept[k]].word;
const slope = (e) => Math.acos(Math.min(1, e.ny)) * DEG;   // the surface's angle from horizontal at the point

test('the header is version 7, lapTime 0, sampleCount 0; the extra count equals the point count; hasGrid 0 ends the file', () => {
  const h = walk(encodeAiLine(WALL));
  assert.deepEqual([h.version, h.lapTime, h.sampleCount, h.n2, h.hasGrid, h.left], [7, 0, 0, h.n, 0, 0]);
  assert.equal(h.n, WALL.points.length);
});

test('round trip: readAiLine gives back the same points and every extra field, after float32 rounding', () => {
  for (const L of [WALL, FLOOR]) {
    const back = readAiLine(encodeAiLine(L));
    assert.equal(back.points.length, L.points.length);
    L.points.forEach((p, k) => {
      assert.deepEqual(back.points[k].pos, p.pos.map(f), `point ${k} position`);
      assert.equal(back.points[k].length, f(p.length));
      assert.equal(back.points[k].id, k);
      for (const x of EXTRA) assert.equal(back.extra[k][x], f(L.extra[k][x]), `point ${k} ${x}`);
    });
  }
});

test('the independent walker and readAiLine agree on every byte', () => {
  const b = encodeAiLine(WALL), h = walk(b), r = readAiLine(b);
  assert.deepEqual(h.points, r.points);
  assert.deepEqual(h.extra, r.extra);
});

test('the line is closed: the last point sits one spacing short of the first, and each length is cumulative', () => {
  for (const L of [WALL, FLOOR]) {
    const P = L.points, n = P.length;
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const close = d(P[n - 1].pos, P[0].pos);
    assert.ok(close > 0.5 && close < 3, `closing gap ${close} m`);
    assert.equal(P[0].length, 0);
    for (let k = 1; k < n; k++) assert.ok(Math.abs(P[k].length - P[k - 1].length - d(P[k].pos, P[k - 1].pos)) < 1e-9, `length at ${k}`);
    L.extra.forEach((e, k) => assert.ok(Math.abs(e.length - d(P[(k + 1) % n].pos, P[k].pos)) < 1e-9, `segment length at ${k}`));
  }
});

test('the floor line\'s closed length is the platform loop\'s path length within 0.05 m', () => {
  const n = FLOOR.points.length, total = FLOOR.points[n - 1].length + FLOOR.extra[n - 1].length;
  assert.ok(Math.abs(total - TRACK.dsn.length) <= 0.05, `${total} m against ${TRACK.dsn.length} m`);
});

test('the speed profile is 300 km/h everywhere, stored in m/s, with gas 1 and brake 0', () => {
  for (const e of WALL.extra) assert.deepEqual([e.speed, e.gas, e.brake], [300 / 3.6, 1, 0]);
});

test('on the wall-ride (turn 2) the line climbs the 110° wall to the balance angle, about 87°, 3 m up or more', () => {
  const t2 = WALL.extra.map((e, k) => ({ e, p: WALL.points[k] })).filter((_, k) => wordOf(k) === 3);
  const steepest = Math.max(...t2.map(({ e }) => slope(e)));
  assert.ok(Math.abs(steepest - 87) <= 2, `steepest ${steepest}°`);
  assert.ok(steepest < 90, 'the line stays below the part of the wall that overhangs');
  assert.ok(Math.max(...t2.map(({ p }) => p.pos[1])) > 3);
});

test('the sides are the right way round: high on the wall-ride\'s right wall, the right edge is near and the left far', () => {
  const t2 = WALL.extra.filter((_, k) => wordOf(k) === 3), top = t2.reduce((a, e) => (slope(e) > slope(a) ? e : a));
  assert.ok(top.sideRight < 3 && top.sideLeft > 20, `left ${top.sideLeft} m, right ${top.sideRight} m`);
  for (const e of [...WALL.extra, ...FLOOR.extra]) assert.ok(Math.abs(e.sideLeft + e.sideRight - 26) < 0.05, 'the two sides span the 26 m profile');
});

test('on the half-pipe (turn 1) the line is capped 10° below the 60° top: never steeper than 50°', () => {
  const t1 = WALL.extra.filter((_, k) => wordOf(k) === 1).map(slope);
  assert.ok(Math.max(...t1) <= 50.5 && Math.max(...t1) >= 49, `steepest ${Math.max(...t1)}°`);
});

test('the line crosses the jump on the floor centre, and spans the gap from road to road', () => {
  const st = TRACK.dsn.stations;
  const lip = kept.findIndex((i) => st[i].gapNext);
  assert.ok(lip >= 0, 'the lip is a point');
  for (const k of [lip, lip + 1]) {
    const s = st[kept[k]];
    assert.ok(Math.hypot(...WALL.points[k].pos.map((x, j) => x - s.pos[j])) < 1e-3, `point ${k} is off the centreline`);
  }
  assert.ok(Math.abs(WALL.extra[lip].length - 12.02) < 0.01, `the gap segment is ${WALL.extra[lip].length} m`);
});

test('the floor control line never leaves the floor: no lean, and no slope beyond the jump\'s 4° pitch', () => {
  for (const e of FLOOR.extra) assert.ok(slope(e) <= 4 + 1e-6, `slope ${slope(e)}°`);
  assert.ok(FLOOR.extra.every((e) => Math.abs(e.camber) < 1e-9));
});

test('forward is a unit vector to the next point, and grade is its y', () => {
  for (const e of WALL.extra) {
    assert.ok(Math.abs(Math.hypot(e.fx, e.fy, e.fz) - 1) < 1e-9);
    assert.equal(e.grade, e.fy);
  }
});

test('edge case: an empty centreline is refused, and so is one of 2 stations', () => {
  assert.throws(() => generateAiLine({ stations: [] }, []), (e) => e instanceof AiLineError && e.code === 'EMPTY_CENTRELINE');
  assert.throws(() => generateAiLine({ stations: TRACK.dsn.stations.slice(0, 2) }, TRACK.secs.slice(0, 2)), (e) => e.code === 'EMPTY_CENTRELINE');
});

test('encodeAiLine refuses an open line, and lengths that are not cumulative', () => {
  const open = { ...WALL, points: WALL.points.slice(0, 100), extra: WALL.extra.slice(0, 100) };
  assert.throws(() => encodeAiLine(open), (e) => e.code === 'NOT_CLOSED');
  const bad = { ...FLOOR, points: FLOOR.points.map((p, k) => (k === 5 ? { ...p, length: 0 } : p)) };
  assert.throws(() => encodeAiLine(bad), (e) => e.code === 'BAD_LENGTH');
});

test('readAiLine refuses version 6, a grid, and bytes left over', () => {
  const b = encodeAiLine(FLOOR);
  const v6 = Buffer.from(b); v6.writeInt32LE(6, 0);
  assert.throws(() => readAiLine(v6), (e) => e.code === 'BAD_VERSION');
  const grid = Buffer.from(b); grid.writeInt32LE(1, grid.length - 4);
  assert.throws(() => readAiLine(grid), (e) => e.code === 'HAS_GRID');
  assert.throws(() => readAiLine(Buffer.concat([b, Buffer.alloc(4)])), (e) => e.code === 'TRAILING');
});

test('generating twice gives byte-identical files', () => {
  assert.ok(encodeAiLine(generateAiLine(TRACK.dsn, TRACK.secs)).equals(encodeAiLine(WALL)));
});

// ── the build (scripts/build_platform_test.js) ──────────────────────────────────────────────────────────────────────
const REPO = path.resolve(__dirname, '..');
function copyRepo(skip) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'ailine-build-'));
  const cp = (src, dst) => { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const a = path.join(src, e.name), b = path.join(dst, e.name); if (skip.includes(path.relative(REPO, a).replace(/\\/g, '/'))) continue; if (e.isDirectory()) cp(a, b); else fs.copyFileSync(a, b); } };
  for (const d of ['scripts', 'src', 'tools']) cp(path.join(REPO, d), path.join(top, d));
  return top;
}

test('the build writes the same ai/fast_lane.ai into both variants, and it reads back as version 7 with no grid', () => {
  const top = copyRepo([]);
  try {
    const r = require(path.join(top, 'scripts/build_platform_test.js')).build();
    const files = r.built.map((b) => fs.readFileSync(path.join(b.dir, 'ai', 'fast_lane.ai')));
    assert.equal(files.length, 2);
    assert.ok(files[0].equals(files[1]), 'the two variants carry different AI lines');
    assert.ok(r.built.every((b) => b.files.includes('ai/fast_lane.ai')), 'ai/fast_lane.ai is not in the install list');
    const back = readAiLine(files[0]);
    assert.deepEqual([back.version, back.hasGrid], [7, 0]);
  } finally { fs.rmSync(top, { recursive: true, force: true }); }
});

test('the build fails loudly AT VALIDATION when src/export/scene.js is missing, instead of skipping it', () => {
  // The kn5 writer also requires scene.js, so a later step fails anyway; the point is that validation itself says so,
  // rather than being skipped and the failure surfacing as "the kn5 writer could not be loaded".
  const top = copyRepo(['src/export/scene.js']);
  try {
    assert.throws(() => require(path.join(top, 'scripts/build_platform_test.js')).build(), (e) => /scene\.js could not be loaded/.test(e.message) && !/kn5write/.test(e.message));
  } finally { fs.rmSync(top, { recursive: true, force: true }); }
});
