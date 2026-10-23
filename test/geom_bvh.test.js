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

// D170 addendum: the self-check must not depend on node NAMES. A's D169 report: "a default export of most tracks is
// refused" because a word's parts shared one cell name and bvh.js found each mesh's cell record BY NAME, so a triangle
// took another piece's s and u, and neighbours inside one pass were tested and "met". B's naming by (id, part) removed
// the repeat at the D167 landing; these tests pin the check itself, so a repeated name can never bring it back.
// Stated before the fix: pieces that share a name give NO intersection and NO stack on a plain straight run, and a real
// same-height crossing whose pieces share names still fires.
test('names repeat (two adjacent pieces with one id and no part): a plain straight run is still clean', () => {
  const segs = [{ id: 'w1', kind: 'road', length: 60, profile: F.FLAT }, { id: 'w1', kind: 'road', length: 60, k0: 0, k1: 0.004, profile: F.FLAT }, { id: 'w2', kind: 'road', length: 60, profile: F.FLAT }];
  const { m, r } = run(segs);
  const names = m.cells.map((c) => c.name);
  assert.ok(names.length > new Set(names).size, 'the fixture really repeats a name');
  assert.deepEqual(r.intersections, [], JSON.stringify(r.intersections.map((x) => [x.cell, x.other, x.s, x.sOther])));
  assert.deepEqual(r.stacked, []);
});
test('names repeat: a real same-height crossing still fires, between the right passes', () => {
  // the lead straight split into two pieces (0–50 m and 50–80 m) that the over road crosses both of (z 42–68), with
  // every piece named alike: two different cells meet the over road under ONE name pair
  const split = (ids) => { const [lead, ...rest] = F.crossing(0); return [{ ...lead, id: ids[0], length: 50 }, { ...lead, id: ids[1], length: 30 }, ...rest.map((g, i) => ({ ...g, id: ids[2 + i] }))]; };
  const segs = split(['w1', 'w1', 'w1', 'w1']);
  const { r } = run(segs);
  assert.ok(r.intersections.length >= 1, 'the crossing is found');
  const unique = run(split(['a', 'b', 'c', 'd'])).r.intersections.length;
  assert.ok(unique > 1, `the over road crosses both lead pieces (${unique} findings)`);
  assert.equal(r.intersections.length, unique, 'the same findings as with unique names (grouped per cell, not per name)');
  for (const x of r.intersections) assert.ok(Number.isFinite(x.s) && Number.isFinite(x.sOther) && Math.abs(x.s - x.sOther) >= 25, `a real crossing is two passes apart: ${x.s} / ${x.sOther}`);
});

// D437a: THE SOUP IN TYPED ARRAYS. soup() built plain JS arrays by push and copied them into typed arrays at the end, so for a while it held every vertex twice inside
// V8's heap (378 B a vertex on a 20 km straight, measured): on the user's 27.6 km lap with a pit lane the export ran out of heap there (P's D437 hand-back).
// It now counts first and fills typed arrays (outside the heap). The reference below is the soup() it replaced, verbatim, so the output is held to the old values.
function soupBefore(mesh) {
  const st = mesh._state; if (!st) throw new Error('selfCheck: needs a mesh from buildMesh/extendMesh/sculptMesh');
  const pos = [], nrm = [], sv = [], uv = [], vCell = [], tris = [], triCell = [], cells = [];
  const add = (arr, M, s, u, name) => {
    const base = pos.length / 3, ci = cells.push(name) - 1;
    for (let i = 0; i < arr.positions.length / 3; i++) {
      const x = arr.positions[i * 3], y = arr.positions[i * 3 + 1], z = arr.positions[i * 3 + 2];
      pos.push(x * M[0] + y * M[4] + z * M[8] + M[12], x * M[1] + y * M[5] + z * M[9] + M[13], x * M[2] + y * M[6] + z * M[10] + M[14]);
      const a = arr.normals[i * 3], b = arr.normals[i * 3 + 1], c = arr.normals[i * 3 + 2];
      nrm.push(a * M[0] + b * M[4] + c * M[8], a * M[1] + b * M[5] + c * M[9], a * M[2] + b * M[6] + c * M[10]);
      sv.push(s(i)); uv.push(u(i)); vCell.push(ci);
    }
    for (let t = 0; t < arr.indices.length; t++) tris.push(base + arr.indices[t]);
    for (let t = 0; t < arr.indices.length / 3; t++) triCell.push(ci);
  };
  const kids = mesh.scene.root.children;
  for (let k = 0; k < kids.length; k++) {
    const node = kids[k], m = node.children[0], M = node.matrix, rec = mesh.cells[k], pc = st.pieces[rec.piece];
    if (rec.seam) {
      const g = rec.piece, sm = st.seams[g], A = st.pieces[g > 0 ? g - 1 : st.pieces.length - 1], Ka = A.K;
      add(m, M, () => sm.s, (i) => (i < Ka ? A.Us[i] : pc.Us[i - Ka]), m.name);
    } else {
      const c = pc.cells[Number(m.name.slice(m.name.lastIndexOf('_') + 1))], K = pc.K;
      add(m, M, (i) => c.rowS[Math.floor(i / K)], (i) => pc.Us[i % K], m.name);
    }
  }
  return { pos: Float64Array.from(pos), nrm: Float64Array.from(nrm), s: Float64Array.from(sv), u: Float64Array.from(uv), vCell, tris: Uint32Array.from(tris), triCell, cells };
}

test('soup: typed arrays of the mesh\'s counted sizes, with the very values of the soup it replaced (open crossings and a closed stadium with its seams)', () => {
  const cases = [['crossing 0', F.crossing(0), false], ['crossing 6', F.crossing(6), false], ['stadium, closed', F.stadium(), true]];
  for (const [what, segs, closed] of cases) {
    const m = G.buildMesh(G.buildPath(segs, closed ? { closed: true } : {}), segs), S = B._internal.soup(m), R = soupBefore(m);
    let nv = 0, ni = 0; for (const kid of m.scene.root.children) { nv += kid.children[0].positions.length / 3; ni += kid.children[0].indices.length; }
    assert.ok(S.pos instanceof Float64Array && S.nrm instanceof Float64Array && S.s instanceof Float64Array && S.u instanceof Float64Array, `${what}: float arrays`);
    assert.ok(S.vCell instanceof Int32Array && S.tris instanceof Uint32Array && S.triCell instanceof Int32Array, `${what}: integer arrays`);
    assert.deepStrictEqual([S.pos.length, S.nrm.length, S.s.length, S.u.length, S.vCell.length, S.tris.length, S.triCell.length], [3 * nv, 3 * nv, nv, nv, nv, ni, ni / 3], `${what}: the counted sizes`);
    for (const k of ['pos', 'nrm', 's', 'u', 'tris']) assert.deepStrictEqual(Array.from(S[k]), Array.from(R[k]), `${what}: ${k} as before`);
    assert.deepStrictEqual(Array.from(S.vCell), R.vCell, `${what}: vCell as before`); assert.deepStrictEqual(Array.from(S.triCell), R.triCell, `${what}: triCell as before`);
    assert.deepStrictEqual(S.cells, R.cells, `${what}: the cell names`);
  }
});

// The heap is read two ways: what soup() KEEPS after a full collection (deterministic: the old one kept 30 B a vertex in its plain vCell and triCell, this one keeps
// none of its arrays in the heap), and what it grew by with no collection, a looser bound (other allocations and the young generation's timing move it: 10-80 B measured)
// set far under the old peak (378-582 B, measured)
test('soup: on a 20 km straight it keeps under 8 B a vertex in the heap (it kept 30), and grows it by under 200 B a vertex (it grew 378 or more)', () => {
  require('v8').setFlagsFromString('--expose-gc'); const gc = require('vm').runInNewContext('gc');
  const segs = [{ id: 's', kind: 'road', length: 20000, profile: F.FLAT }], m = G.buildMesh(G.buildPath(segs, { step: 2 }), segs);
  gc(); gc(); const h0 = process.memoryUsage().heapUsed;
  const S = B._internal.soup(m), grew = (process.memoryUsage().heapUsed - h0) / S.s.length;   // no collection yet: what it made, kept or not
  gc(); gc(); const kept = (process.memoryUsage().heapUsed - h0) / S.s.length;
  assert.ok(S.s.length > 100000, `${S.s.length} vertices`);
  assert.ok(kept < 8, `soup() keeps ${kept.toFixed(1)} B a vertex in the heap`);
  assert.ok(grew < 200, `the heap grew ${grew.toFixed(1)} B a vertex across soup()`);
});

// D437a: THE BVH IN TYPED ARRAYS. Its nodes were JS objects (2 million on the user's 27.6 km lap, 114 B a triangle kept, measured), built again for the pit-lane check,
// and at the room the page leaves an export (2.8 GB of heap) that build ran out of memory however the soup was made (E's cage runs). The nodes are now typed arrays and
// the split sorts the order array in place, by the same rule, so the tree is the same tree. The reference below is the build() and query() it replaced, verbatim.
function buildBefore(S) {
  const T = S.tris.length / 3, box = new Float64Array(T * 6), cen = new Float64Array(T * 3), s0 = new Float64Array(T), s1 = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], a = Infinity, b = -Infinity;
    for (let v = 0; v < 3; v++) { const i = S.tris[t * 3 + v]; for (let d = 0; d < 3; d++) { const x = S.pos[i * 3 + d]; if (x < lo[d]) lo[d] = x; if (x > hi[d]) hi[d] = x; } a = Math.min(a, S.s[i]); b = Math.max(b, S.s[i]); }
    for (let d = 0; d < 3; d++) { box[t * 6 + d] = lo[d]; box[t * 6 + 3 + d] = hi[d]; cen[t * 3 + d] = (lo[d] + hi[d]) / 2; }
    s0[t] = a; s1[t] = b;
  }
  const order = Uint32Array.from({ length: T }, (_, i) => i), nodes = [];
  const make = (from, to) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = from; k < to; k++) { const t = order[k]; for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], box[t * 6 + d]); hi[d] = Math.max(hi[d], box[t * 6 + 3 + d]); } }
    const n = { lo, hi, from, to, left: -1, right: -1 }, id = nodes.push(n) - 1;
    if (to - from > 4) {
      let ax = 0; for (let d = 1; d < 3; d++) if (hi[d] - lo[d] > hi[ax] - lo[ax]) ax = d;
      const part = Array.from(order.subarray(from, to)).sort((x, y) => cen[x * 3 + ax] - cen[y * 3 + ax]);
      order.set(part, from); const mid = (from + to) >> 1;
      n.left = make(from, mid); n.right = make(mid, to);
    }
    return id;
  };
  if (T) make(0, T);
  return { box, s0, s1, order, nodes, T };
}
function queryBefore(B, lo, hi, visit) {
  if (!B.T) return;
  const overlaps = (n) => n.lo[0] <= hi[0] && n.hi[0] >= lo[0] && n.lo[1] <= hi[1] && n.hi[1] >= lo[1] && n.lo[2] <= hi[2] && n.hi[2] >= lo[2];
  const stack = [0];
  while (stack.length) {
    const n = B.nodes[stack.pop()];
    if (!overlaps(n)) continue;
    if (n.left < 0) { for (let k = n.from; k < n.to; k++) visit(B.order[k]); } else { stack.push(n.left, n.right); }
  }
}

test('bvh: typed node arrays, the same tree as the build it replaced (node count, triangle order, and every query visiting the same triangles in the same order)', () => {
  for (const [what, segs, closed] of [['crossing 0', F.crossing(0), false], ['stadium, closed', F.stadium(), true]]) {
    const m = G.buildMesh(G.buildPath(segs, closed ? { closed: true } : {}), segs), S = B._internal.soup(m), N = B._internal.build(S), R = buildBefore(S);
    assert.ok(N.nlo instanceof Float64Array && N.nhi instanceof Float64Array && N.nleft instanceof Int32Array && N.nright instanceof Int32Array && N.nfrom instanceof Int32Array && N.nto instanceof Int32Array, `${what}: typed nodes`);
    assert.equal(N.N, R.nodes.length, `${what}: as many nodes`);
    assert.deepStrictEqual(Array.from(N.order), Array.from(R.order), `${what}: the same triangle order`);
    for (const k of ['box', 's0', 's1']) assert.deepStrictEqual(Array.from(N[k]), Array.from(R[k]), `${what}: ${k}`);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const ext = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < R.box.length; i += 6) for (let d = 0; d < 3; d++) { ext[d] = Math.min(ext[d], R.box[i + d]); ext[3 + d] = Math.max(ext[3 + d], R.box[i + 3 + d]); }
    const [x0, y0, z0, x1, y1, z1] = ext;
    for (let q = 0; q < 300; q++) {
      const c = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), z0 + rnd() * (z1 - z0)], r = 2 + rnd() * 30, lo = c.map((v) => v - r), hi = c.map((v) => v + r);
      const a = [], b = []; B._internal.query(N, lo, hi, (t) => a.push(t)); queryBefore(R, lo, hi, (t) => b.push(t));
      assert.deepStrictEqual(a, b, `${what}: query ${q} visits the same triangles in the same order`);
    }
  }
});

test('bvh: on a 20 km straight build() keeps under 8 B a triangle in the heap (its node objects kept 114), and grows it by under 120 B a triangle (it grew 180 or more)', () => {
  require('v8').setFlagsFromString('--expose-gc'); const gc = require('vm').runInNewContext('gc');
  const segs = [{ id: 's', kind: 'road', length: 20000, profile: F.FLAT }], m = G.buildMesh(G.buildPath(segs, { step: 2 }), segs), S = B._internal.soup(m);
  gc(); gc(); const h0 = process.memoryUsage().heapUsed;
  const N = B._internal.build(S), grew = (process.memoryUsage().heapUsed - h0) / N.T;   // no collection yet: what it made, kept or not
  gc(); gc(); const kept = (process.memoryUsage().heapUsed - h0) / N.T;
  assert.ok(N.T > 200000, `${N.T} triangles`);
  assert.ok(kept < 8, `build() keeps ${kept.toFixed(1)} B a triangle in the heap`);
  assert.ok(grew < 120, `the heap grew ${grew.toFixed(1)} B a triangle across build()`);
});
