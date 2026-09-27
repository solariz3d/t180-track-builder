// Tests for src/export/markers.js: every ARCHITECTURE §5c check passes on a good hand-made scene and fires on a
// crafted bad one. node --test, no dependencies. The scene follows the shared T1 shape (src/export/scene.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkMarkers, countPits, raceDirection, walkScene } = require('../src/export/markers.js');

// A straight road along +Z (x −6..6, z −60..60, y 0) and a pit lane beside it (x 10..16). Race direction is +Z, so
// LEFT = cross(up, +Z) = +X: the L gate sits at +X (the convention markers.js measured on five reference tracks).
function quad(name, x0, x1, z0, z1, y = 0) {
  return { type: 'mesh', name, material: 0, positions: new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), uvs: new Float32Array(8), indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
    castShadows: true, visible: true, transparent: false, renderable: true };
}
const marker = (name, x, y, z, fwd = [0, 0, 1]) => {
  const f = fwd, up = [0, 1, 0], r = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]];
  return { type: 'dummy', name, matrix: [r[0], r[1], r[2], 0, 0, 1, 0, 0, f[0], f[1], f[2], 0, x, y, z, 1], children: [] };
};
function goodMarkers() {
  return {
    AC_START_0: marker('AC_START_0', 0, 1.5, 20), AC_START_1: marker('AC_START_1', -3, 1.5, 12), AC_START_2: marker('AC_START_2', 3, 1.5, 4),
    AC_TIME_0_L: marker('AC_TIME_0_L', 5, 1.5, 30), AC_TIME_0_R: marker('AC_TIME_0_R', -5, 1.5, 30),
    AC_HOTLAP_START_0: marker('AC_HOTLAP_START_0', 0, 1.5, -40),
    AC_PIT_0: marker('AC_PIT_0', 13, 1.5, 0), AC_PIT_1: marker('AC_PIT_1', 13, 1.5, -8), AC_PIT_2: marker('AC_PIT_2', 13, 1.5, -16),
  };
}
function scene(edit = (m) => m) {
  const m = edit(goodMarkers());
  return { textures: [], materials: [{ name: 'road', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0, props: [], samplers: [] }],
    root: { type: 'dummy', name: 'root', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      children: [quad('1ROAD', -6, 6, -60, 60), quad('1PIT', 10, 16, -30, 10), quad('1WALL', 6, 7, -60, 60), ...Object.values(m)] } };
}
const check = (sc, id, opts) => checkMarkers(sc, opts).checks.find((c) => c.id === id);

test('the good scene passes every §5c check', () => {
  const r = checkMarkers(scene(), { expectedPits: 3 });
  assert.deepStrictEqual(r.checks.filter((c) => !c.ok).map((c) => [c.id, c.problems]), []);
  assert.strictEqual(r.ok, true);
});

test('race direction comes from the grid, back slot to pole', () => {
  const { dummies } = walkScene(scene());
  const grid = dummies.filter((d) => /^AC_START_\d+$/.test(d.name)).sort((a, b) => a.name.localeCompare(b.name));
  // pole AC_START_0 (0,20) minus back slot AC_START_2 (3,4) = (−3, 16), normalised: |(−3,16)| = √265 = 16.279
  assert.deepStrictEqual(raceDirection(grid).map((v) => +v.toFixed(3)), [-0.184, 0, 0.983]);
});

test('start line behind the grid fires start-ahead-of-grid', () => {
  const sc = scene((m) => { m.AC_TIME_0_L = marker('AC_TIME_0_L', 5, 1.5, 10); m.AC_TIME_0_R = marker('AC_TIME_0_R', -5, 1.5, 10); return m; });
  const c = check(sc, 'start-ahead-of-grid');
  assert.strictEqual(c.ok, false);
  assert.match(c.problems.join('\n'), /AC_START_0 is .* past the start line/);
});

test('grid numbered the wrong way (pole at the back) fires start-ahead-of-grid', () => {
  const sc = scene((m) => { m.AC_START_0 = marker('AC_START_0', 3, 1.5, 4); m.AC_START_2 = marker('AC_START_2', 0, 1.5, 20); return m; });
  // race direction now points from slot 2 (front) to slot 0 (back): the line at z=30 is BEHIND every slot
  assert.strictEqual(check(sc, 'start-ahead-of-grid').ok, false);
});

test('a grid slot ahead of the slot numbered before it fires start-ahead-of-grid, even with the line ahead of all', () => {
  // AC_START_2 (z 12) sits ahead of AC_START_1 (z 4): numbering from pole must run backwards from the line
  const sc = scene((m) => { m.AC_START_1 = marker('AC_START_1', -3, 1.5, 4); m.AC_START_2 = marker('AC_START_2', 3, 1.5, 12); return m; });
  const c = check(sc, 'start-ahead-of-grid');
  assert.deepStrictEqual(c.problems.filter((p) => /past the start line/.test(p)), []);
  assert.match(c.problems.join('\n'), /AC_START_2 is ahead of AC_START_1/);
});

test('swapped L and R gates fire gate-orientation', () => {
  const sc = scene((m) => { m.AC_TIME_0_L = marker('AC_TIME_0_L', -5, 1.5, 30); m.AC_TIME_0_R = marker('AC_TIME_0_R', 5, 1.5, 30); return m; });
  const c = check(sc, 'gate-orientation');
  assert.strictEqual(c.ok, false);
  assert.match(c.problems[0], /swapped/);
});

test('a marker 5 m up fires height-and-heading', () => {
  const sc = scene((m) => { m.AC_START_1 = marker('AC_START_1', -3, 5, 12); return m; });
  const c = check(sc, 'height-and-heading');
  assert.strictEqual(c.ok, false);
  assert.match(c.problems.join('\n'), /AC_START_1 is 5\.00 m above the surface/);
});

test('a marker 0.3 m up (below the 1 m floor) fires height-and-heading', () => {
  const sc = scene((m) => { m.AC_PIT_1 = marker('AC_PIT_1', 13, 0.3, -8); return m; });
  assert.match(check(sc, 'height-and-heading').problems.join('\n'), /AC_PIT_1 is 0\.30 m above/);
});

test('a grid slot pointing backwards fires height-and-heading', () => {
  const sc = scene((m) => { m.AC_START_1 = marker('AC_START_1', -3, 1.5, 12, [0, 0, -1]); return m; });
  assert.match(check(sc, 'height-and-heading').problems.join('\n'), /AC_START_1 does not point along the race direction/);
});

test('a marker pointing into the road fires height-and-heading', () => {
  const sc = scene((m) => { m.AC_PIT_0 = marker('AC_PIT_0', 13, 1.5, 0, [0, -0.7071, 0.7071]); return m; });
  assert.match(check(sc, 'height-and-heading').problems.join('\n'), /AC_PIT_0 points 45° out of the surface/);
});

test('a marker off the road fires height-and-heading and slots', () => {
  const sc = scene((m) => { m.AC_PIT_2 = marker('AC_PIT_2', 30, 1.5, -16); return m; });
  assert.match(check(sc, 'height-and-heading').problems.join('\n'), /AC_PIT_2 is off the road/);
  assert.match(check(sc, 'slots').problems.join('\n'), /AC_PIT_2 is off the road/);
});

test('a marker straight above a shared triangle edge is ON the road', () => {
  // the road quad's diagonal runs (−6,−60)→(6,60); a point on it projects onto an EDGE of both triangles, not an interior
  const sc = scene((m) => { m.AC_PIT_2 = marker('AC_PIT_2', 13, 1.5, -16); m.AC_START_2 = marker('AC_START_2', 1, 1.5, 10); return m; });
  assert.deepStrictEqual(check(sc, 'height-and-heading').problems, []);
  assert.deepStrictEqual(check(sc, 'slots').problems, []);
});

test('a marker straight above the road\'s outer edge is on the road', () => {
  const sc = scene((m) => { m.AC_PIT_2 = marker('AC_PIT_2', 16, 1.5, -16); return m; });
  assert.deepStrictEqual(check(sc, 'slots').problems, []);
});

test('a marker over a WALL mesh only counts as off the road', () => {
  const sc = scene((m) => { m.AC_PIT_2 = marker('AC_PIT_2', 6.5, 1.5, -16); return m; });
  assert.strictEqual(check(sc, 'slots').ok, false);
});

test('a grid slot inside another fires slots', () => {
  const sc = scene((m) => { m.AC_START_1 = marker('AC_START_1', 0.4, 1.5, 18.5); return m; });
  const c = check(sc, 'slots');
  assert.strictEqual(c.ok, false);
  assert.match(c.problems.join('\n'), /AC_START_1 and AC_START_0 overlap/);
});

test('a pit box inside another fires slots', () => {
  const sc = scene((m) => { m.AC_PIT_1 = marker('AC_PIT_1', 13, 1.5, -1); return m; });
  assert.match(check(sc, 'slots').problems.join('\n'), /AC_PIT_1 and AC_PIT_0 overlap/);
});

test('a wrong pit count fires pit-count', () => {
  const c = check(scene(), 'pit-count', { expectedPits: 4 });
  assert.strictEqual(c.ok, false);
  assert.match(c.problems.join('\n'), /says 4 pit boxes but the scene has 3/);
});

test('a gap in the pit numbering fires pit-count', () => {
  const sc = scene((m) => { delete m.AC_PIT_1; m.AC_PIT_1 = marker('AC_PIT_3', 13, 1.5, -8); return m; });
  assert.match(check(sc, 'pit-count').problems.join('\n'), /not numbered 0\.\.2/);
});

test('no pit markers fires pit-count', () => {
  const sc = scene((m) => { delete m.AC_PIT_0; delete m.AC_PIT_1; delete m.AC_PIT_2; return m; });
  assert.strictEqual(check(sc, 'pit-count').ok, false);
});

test('no gate fails the checks that need one, with the reason', () => {
  const sc = scene((m) => { delete m.AC_TIME_0_L; delete m.AC_TIME_0_R; return m; });
  assert.match(check(sc, 'start-ahead-of-grid').problems.join('\n'), /no AC_TIME_0_L/);
  assert.match(check(sc, 'gate-orientation').problems.join('\n'), /no AC_TIME_0_L/);
});

test('countPits counts AC_PIT_n markers only', () => {
  assert.strictEqual(countPits(scene()), 3);
});

test('a nested dummy gets its parent transform (world = local × parent)', () => {
  const sc = scene();
  const pit = sc.root.children.find((c) => c.name === 'AC_PIT_0');
  const holder = { type: 'dummy', name: 'holder', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 100, 1], children: [{ ...pit, matrix: [...pit.matrix.slice(0, 14), -100, 1] }] };
  sc.root.children = sc.root.children.filter((c) => c !== pit).concat([holder]);
  const p = walkScene(sc).dummies.find((d) => d.name === 'AC_PIT_0').pos;
  assert.deepStrictEqual(p, [13, 1.5, 0]);
  assert.strictEqual(checkMarkers(sc, { expectedPits: 3 }).ok, true);
});
