// texture-mapping.test.js: node --test test/texture-mapping.test.js. The automatic texture mapping (ARCHITECTURE §5b:
// "along the track by distance, and across by the profile's own width, so a texture flows correctly through turns,
// walls and loops").
//
// TEXEL DENSITY, the property under test: texture length per metre of SURFACE, along and across, must be the same
// everywhere. The truth is measured independently of the mapping: the surface's own lines are walked at the path's
// 0.25 m samples (along) and at 40 sub-steps of the profile between columns (across), while the mapping only sees rows
// every 2 m (every 8th sample), as a mesh's stations are sparser than the path. Bounds, STATED BEFORE THE FIRST RUN:
//   · along: every quad's density within 0.2 % of 1 texture-length per tileLength metres;
//   · across: within 0.1 %;
//   · through a tight turn (R = 15 m on a 26 m flat road), up a wall past 90° (the wall-ride's 110° edge, in a turn),
//     and around a loop-the-loop (R = 12 m, half-pipe walls);
//   · and, as the control that shows the test can fail: the mapping mesh.js writes today (centreline distance / 10 along)
//     is off by more than 30 % somewhere on each of the three.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/geom/index.js');
const F = require('./geom_fixtures.js');
const M = require('../src/texture/mapping.js');
const { normalize, offsetAt } = require('../src/geom/profile.js');
const TX = require('../src/doc/textures.js');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const EVERY = 8;

/** Density along and across for every band of segment g, by the mapping and by mesh.js's centreline rule. */
function densities(segs, g, settings = { ...TX.DEFAULT, tileLength: 7, tileWidth: 3 }) {
  const path = G.buildPath(segs, { step: 0.25 });
  const all = [...path.samples.filter((s) => s.seg === g && s.s < path.segEnd[g].s - 1e-9), path.segEnd[g]];
  const pick = all.map((_, i) => i).filter((i) => i % EVERY === 0 || i === all.length - 1);
  const P = normalize(segs[g].profile);
  const Us = G.profile.samplesAcross(P, { maxAcross: 1, maxSeam: Math.PI / 180 }).u;
  const bands = M.bandsOf(P), { us, ranges } = M.splitColumns(Us, bands);
  const dense = M.surfaceRows(all, P, us);                     // every 0.25 m: the truth along
  const rows = pick.map((i) => dense[i]);
  const out = { along: [], across: [], cAlong: [] };
  for (const b of ranges) {
    const band = bands.find((x) => x.slot === b.slot && x.side === b.side);
    const cols = us.slice(b.k0, b.k1 + 1), strip = { rows: rows.map((r) => r.slice(b.k0, b.k1 + 1)), us: cols, u0: band.u0, u1: band.u1, side: band.side };
    const { uv } = M.mapStrip(strip, settings), K = cols.length, V = (r, k) => uv[(r * K + k) * 2 + 1], U = (r, k) => uv[(r * K + k) * 2];
    for (let r = 1; r < pick.length; r++) for (let k = 0; k < K; k++) {
      let truth = 0; for (let i = pick[r - 1] + 1; i <= pick[r]; i++) truth += dist(dense[i][b.k0 + k], dense[i - 1][b.k0 + k]);
      if (truth < 1e-3) continue;                                  // a line that does not move (a loop's pivot): no density to speak of
      out.along.push(Math.abs(V(r, k) - V(r - 1, k)) * settings.tileLength / truth);
      out.cAlong.push((all[pick[r]].s - all[pick[r - 1]].s) / truth);   // mesh.js today: v = (s − s0)/10, so 10 m of s per tile
    }
    for (let r = 0; r < pick.length; r += 5) for (let k = 1; k < K; k++) {
      const sm = all[pick[r]]; let truth = 0, prev = null;
      for (let j = 0; j <= 40; j++) {
        const u = cols[k - 1] + (cols[k] - cols[k - 1]) * j / 40, [X, Y] = offsetAt(P, u);
        const p = [0, 1, 2].map((a) => sm.pos[a] + sm.L[a] * X + sm.U[a] * Y); if (prev) truth += dist(p, prev); prev = p;
      }
      out.across.push(Math.abs(U(r, k) - U(r, k - 1)) * settings.tileWidth / truth);
    }
  }
  return out;
}
const worst = (xs) => Math.max(...xs.map((x) => Math.abs(x - 1)));

const CASES = {
  'a tight turn (R 15 m, 26 m flat road)': [F.hairpin('T', 15, 10, F.FLAT), 1],
  'a wall past 90° (the wall-ride\'s 110° edge, in a turn)': [F.hairpin('T', 30, 20, F.WALLRIDE), 1],
  'a loop-the-loop (R 12 m, half-pipe)': [F.loopTheLoop({ R: 12 }), 1],
};
for (const [name, [segs, g]] of Object.entries(CASES)) {
  test(`texel density is constant along (0.2 %) and across (0.1 %) through ${name}`, () => {
    const d = densities(segs, g);
    assert.ok(d.along.length > 100 && d.across.length > 100, `enough quads measured: ${d.along.length} along, ${d.across.length} across`);
    assert.ok(worst(d.along) <= 0.002, `along: worst ${(worst(d.along) * 100).toFixed(4)} %`);
    assert.ok(worst(d.across) <= 0.001, `across: worst ${(worst(d.across) * 100).toFixed(4)} %`);
  });
  test(`the control: centreline distance (mesh.js today) is off by more than 30 % through ${name}`, () => {
    const d = densities(segs, g);
    assert.ok(worst(d.cAlong) > 0.3, `centreline mapping: worst ${(worst(d.cAlong) * 100).toFixed(1)} %`);
  });
}

test('the bands of a flat road: floor across the centre, then line, kerb and glow on each side, edge to edge, no gaps', () => {
  const b = M.bandsOf(F.FLAT);
  assert.deepEqual(b.map((x) => `${x.slot}/${x.side}`), ['edgeGlow/R', 'kerbs/R', 'lines/R', 'floor/C', 'lines/L', 'kerbs/L', 'edgeGlow/L']);
  assert.equal(b[0].u0, -13); assert.equal(b[b.length - 1].u1, 13);
  for (let i = 1; i < b.length; i++) assert.equal(b[i].u0, b[i - 1].u1);
  assert.deepEqual([b[5].u0, b[5].u1, b[6].u0], [11.5, 12.5, 12.5]);
});

test('a wall gets the walls slot from where it reaches 30°, the glow along its top, and the kerb just inside it', () => {
  const b = M.bandsOf(F.WALLRIDE), left = b.filter((x) => x.side === 'L');
  assert.deepEqual(left.map((x) => x.slot), ['lines', 'kerbs', 'walls', 'edgeGlow']);
  const wall = left.find((x) => x.slot === 'walls');
  // ψ is 0 at u = 5 and 110° at u = 13, linear: 30° at 5 + 8·30/110
  assert.ok(Math.abs(wall.u0 - (5 + 8 * 30 / 110)) < 1e-12, `wall starts at ${wall.u0}`);
  assert.equal(wall.u1, 12.5);
  assert.equal(left.find((x) => x.slot === 'kerbs').u1, wall.u0);
});

test('every band edge becomes a column, and each band\'s columns start and end on its edges', () => {
  const P = normalize(F.WALLRIDE), bands = M.bandsOf(P);
  const { us, ranges } = M.splitColumns(G.profile.samplesAcross(P).u, bands);
  for (let i = 1; i < us.length; i++) assert.ok(us[i] > us[i - 1]);
  ranges.forEach((r, i) => { assert.equal(us[r.k0], bands[i].u0); assert.equal(us[r.k1], bands[i].u1); });
});

const straightStrip = () => ({ rows: [[[0, 0, 0], [2, 0, 0]], [[0, 0, 5], [2, 0, 5]]], us: [1, 3], u0: 1, u1: 3, side: 'L' });
test('fit stretches the band once across; tile repeats every tileWidth', () => {
  const fit = M.mapStrip(straightStrip(), { ...TX.DEFAULT, fit: 'fit' }).uv, tile = M.mapStrip(straightStrip(), { ...TX.DEFAULT, tileWidth: 4 }).uv;
  assert.deepEqual([fit[0], fit[2]], [0, 1]);
  assert.deepEqual([tile[0], tile[2]], [0, 0.5]);
});
test('offset shifts along, tileLength scales along, and dir across swaps the two', () => {
  const s = { ...TX.DEFAULT, tileLength: 2.5, offset: 1 };
  const a = M.mapStrip(straightStrip(), s).uv, x = M.mapStrip(straightStrip(), { ...s, dir: 'across' }).uv;
  assert.deepEqual([a[1], a[5]], [0.4, 2.4]);                     // (0 + 1)/2.5 and (5 + 1)/2.5
  assert.deepEqual([x[0], x[1], x[4], x[5]], [a[1], a[0], a[5], a[4]]);
});
test('the right side runs outward too: a right kerb and a left kerb are mirror images', () => {
  const L = M.mapStrip(straightStrip(), TX.DEFAULT).uv;
  const R = M.mapStrip({ rows: [[[-3, 0, 0], [-1, 0, 0]], [[-3, 0, 5], [-1, 0, 5]]], us: [-3, -1], u0: -3, u1: -1, side: 'R' }, TX.DEFAULT).uv;
  assert.deepEqual([R[0], R[2]], [L[2], L[0]]);
});
test('a strip with no width, or one column, is refused by name', () => {
  assert.throws(() => M.mapStrip({ ...straightStrip(), u1: 1 }, TX.DEFAULT), /no width/);
  assert.throws(() => M.mapStrip({ ...straightStrip(), rows: [[[0, 0, 0]]] }, TX.DEFAULT), /two columns/);
});
