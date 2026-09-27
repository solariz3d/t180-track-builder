// geom_bvh.test.js: node --test test/geom_bvh.test.js. Self-intersection and stacked surfaces (src/geom/bvh.js;
// ARCHITECTURE §3 `:58`, §4 `:84-85`). Stated before these tests were written:
//   · A crossing at the SAME height (coplanar roads) is a self-intersection, found between the two passes' cells.
//   · A crossing 6 m up is clean: no intersection and no stack (the 2 m reach cannot reach it).
//   · A crossing 1.5 m up (at the centreline) is no intersection but IS a stack, every reported gap in (0, 2) m.
//   · The BVH's answers equal a brute-force all-pairs check, pair for pair and vertex for vertex, on a small track.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GDIR = process.env.GEOM_DIR || require('path').join(__dirname, '..', 'src', 'geom');
const G = require(GDIR);
const B = require(require('path').join(GDIR, 'bvh.js'));
const F = require('./geom_fixtures.js');

const run = (segs, opts = {}) => { const p = G.buildPath(segs), m = G.buildMesh(p, segs, { selfCheck: true, ...opts }); return { p, m, r: m.selfCheck }; };
const pairOf = (x) => [x.cell, x.other].sort().join('|');

test('triTri: the basic cases (coplanar overlap, coplanar apart, piercing, parallel planes, a touching vertex)', () => {
  const T = [[0, 0, 0], [4, 0, 0], [0, 0, 4]];
  assert.ok(B.triTri(...T, [1, 0, 1], [5, 0, 1], [1, 0, 5]), 'coplanar, overlapping');
  assert.ok(!B.triTri(...T, [5, 0, 5], [9, 0, 5], [5, 0, 9]), 'coplanar, apart');
  assert.ok(B.triTri(...T, [1, -1, 1], [1, 1, 1], [2, 1, 1]), 'piercing');
  assert.ok(!B.triTri(...T, [0, 1, 0], [4, 1, 0], [0, 1, 4]), 'parallel, 1 m apart');
  assert.ok(B.triTri(...T, [1, 0, 1], [1, 2, 1], [2, 2, 1]), 'a vertex touching the interior');
  assert.ok(!B.triTri(...T, [3, 0, 3], [5, 0, 5], [3, 0, 5]), 'coplanar, just past the hypotenuse');
});
test('figure-8, same height: the crossing is a self-intersection between the two passes, and lands in folds[]', () => {
  const { m, r } = run(F.crossing(0));
  assert.ok(r.intersections.some((x) => pairOf(x) === '1ROAD_lead_0|1ROAD_over_0'), JSON.stringify(r.intersections.map(pairOf)));
  const x = r.intersections.find((y) => pairOf(y) === '1ROAD_lead_0|1ROAD_over_0');
  assert.ok(x.s >= 40 && x.s <= 70, `the lead straight is crossed between s = 42 and 68 (±13 m about 55), first hit at ${x.s}`);
  const self = m.folds.filter((f) => f.margin === null);
  assert.ok(self.length >= 2 && self.every((f) => typeof f.other === 'string'), 'docs/INTERFACES.md §2: { s, u, margin: null, other }');
});
test('figure-8, 6 m separation: clean (no intersection, no stack)', () => {
  const { p, r } = run(F.crossing(6));
  assert.ok(Math.abs(p.samples[p.samples.length - 1].pos[1] - 6) < 0.05, 'the fixture really crosses 6 m up');
  assert.deepStrictEqual(r.intersections, []);
  assert.deepStrictEqual(r.stacked, []);
});
test('figure-8, 1.5 m separation (at the centreline): not an intersection, but stacked within 2 m', () => {
  const { p, r } = run(F.crossing(1.5));
  assert.ok(Math.abs(p.samples[p.samples.length - 1].pos[1] - 1.5) < 0.01, 'the fixture really crosses 1.5 m up');
  assert.deepStrictEqual(r.intersections, []);
  assert.ok(r.stacked.some((x) => pairOf(x) === '1ROAD_lead_0|1ROAD_over_0'), 'the two passes are reported as stacked');
  // the gap is measured along the normal at each vertex; the upper road leaves the climbing turn slightly banked (the
  // rotation-minimising frame), so the local gap is under 1.5 m at one edge: every one is still a real gap in (0, 2)
  for (const x of r.stacked) assert.ok(x.gap > 0 && x.gap < 2, `gap ${x.gap}`);
});
test('stacked: nothing on a single flat straight or a proper stadium (one pass is never stacked on itself)', () => {
  assert.deepStrictEqual(run([{ id: 's', kind: 'road', length: 120, profile: F.FLAT }]).r.stacked, []);
  const segs = F.stadium(), { r } = run(segs, {}), rc = G.buildMesh(G.buildPath(segs, { closed: true }), segs, { selfCheck: true }).selfCheck;
  assert.deepStrictEqual(rc.intersections, []); assert.deepStrictEqual(rc.stacked, []);
  assert.ok(r.stats.triangles > 1000);
});
test('BVH = brute force: every meeting triangle pair and every stacked vertex, on a small banked crossing', () => {
  const NARROW = F.prof('flat', [-4, 0, 4], [0, 0, 0]);
  // 0.2 m up, rolled 15°: the upper road's low edge dips ~0.8 m, so it cuts through the lower one (at 0.5 m and 8° it
  // does not: the climbing turn's frame leaves the road banked the other way by ~2.9°, measured)
  const segs = F.crossing(0.2, { R: 10, lead: 30, tail: 30, profile: NARROW, tailRoll: 15 * F.D });
  const p = G.buildPath(segs), m = G.buildMesh(p, segs, { maxAcross: 1 }), trace = {};
  B.selfCheck(m, { trace });
  const S = trace.soup, T = S.tris.length / 3, sep = 25, reach = 2;
  const tv = (t) => [0, 1, 2].map((k) => { const i = S.tris[t * 3 + k]; return [S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]]; });
  const sr = (t) => { const v = [0, 1, 2].map((k) => S.s[S.tris[t * 3 + k]]); return [Math.min(...v), Math.max(...v)]; };
  const brute = [];
  for (let a = 0; a < T; a++) for (let b = a + 1; b < T; b++) {
    const [a0, a1] = sr(a), [b0, b1] = sr(b); if (B._internal.gapS(a0, a1, b0, b1, false, 0) < sep) continue;
    const A = tv(a), O = tv(b); if (B.triTri(A[0], A[1], A[2], O[0], O[1], O[2])) brute.push(`${a},${b}`);
  }
  assert.ok(brute.length > 0, 'the fixture must intersect (a banked road cutting through a flat one)');
  assert.deepStrictEqual(trace.pairs.map(([a, b]) => `${a},${b}`).sort(), brute.sort());
  const bs = new Map();
  for (let i = 0; i < S.s.length; i++) {
    const P = [S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]], n = [S.nrm[i * 3], S.nrm[i * 3 + 1], S.nrm[i * 3 + 2]], l = Math.hypot(...n);
    const q0 = P.map((x, d) => x - n[d] / l * reach), q1 = P.map((x, d) => x + n[d] / l * reach);
    let best = null;
    for (let o = 0; o < T; o++) {
      const [b0, b1] = sr(o); if (B._internal.gapS(S.s[i], S.s[i], b0, b1, false, 0) < sep) continue;
      const O = tv(o), t = B.segTri(q0, q1, O[0], O[1], O[2]); if (t === null) continue;
      const gap = Math.abs(t * 2 - 1) * reach; if (gap < reach && (best === null || gap < best)) best = gap;
    }
    if (best !== null) bs.set(i, best);
  }
  assert.ok(bs.size > 0);
  // the same vertices exactly; the gaps within 1e-12 (the two normalise the normal differently: sqrt(dot) vs hypot)
  assert.deepStrictEqual([...trace.stacked.keys()].sort((x, y) => x - y), [...bs.keys()].sort((x, y) => x - y));
  for (const [i, g] of bs) assert.ok(Math.abs(trace.stacked.get(i) - g) < 1e-12, `vertex ${i}: ${trace.stacked.get(i)} vs ${g}`);
});
