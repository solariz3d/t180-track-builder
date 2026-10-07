// validate_raygap_lean.test.js: node --test test/validate_raygap_lean.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D266 (the keeper, 01:48: "this page is having a problem and crashed … wouldnt close loop", on a 6 × 1000 m tube): the overlap check's memory.
// src/validate/raygap.js now keeps its vertices, triangles, normals, edges and grids in typed arrays, and app/core/overlapjob.js builds its own mesh
// lean (each piece's boundary rows and handles deleted before the self-check). The ANSWER must not change. Rows:
//   1  rayGaps gives exactly the first form's answer (REFERENCE below, verbatim from t180 2b929c2), gap for gap, on slits, holes, welds across bucket
//      boundaries, several meshes, degenerate triangles, a tilted road and a jump lip, and on the built road of a coil, a closed lap and a tube
//   2  the check's lean mesh gives the check buildMesh's own `selfCheck: true` gives, on a coil that overlaps itself; its two parts are the one-piece check
//   3  MEMORY: on a closed 6 × 1000 m tube oval (2.4 million road triangles), each part of the check, and the whole check, finishes in a node process
//      whose V8 old generation is capped at 1,500 MB (the registered bar). On 2b929c2 the 'rays' part and the whole check die "heap out of memory"
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path'), { spawnSync } = require('child_process');
const { rayGaps } = require('../src/validate/raygap.js');
const { MACH6 } = require('../src/validate/limits.js');
const G = require('../src/geom/index.js');
const V = require('../src/validate/index.js');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const OJ = require('../app/core/overlapjob.js');
const { walkScene, isDrivable } = require('../src/export/markers.js');
const RAY = MACH6.downforceRay;

// ── THE REFERENCE: rayGaps as it was at t180 2b929c2 (src/validate/raygap.js:45-109), verbatim, with the helpers it used ──
const PROBES = [0.1, 0.25, 0.5];
const FACING = Math.cos(45 * Math.PI / 180);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : a; };
function REFERENCE(meshes, stations, ray) {
  const V = new Map(), P = [], T = [];
  const WELD = 0.005, vk = (a, b, c) => `${a},${b},${c}`;
  const vid = (x, y, z) => {
    const bx = Math.floor(x / WELD), by = Math.floor(y / WELD), bz = Math.floor(z / WELD);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const id of V.get(vk(bx + i, by + j, bz + k)) || []) { const q = P[id]; if (Math.hypot(q[0] - x, q[1] - y, q[2] - z) <= WELD) return id; }
    }
    const id = P.length; P.push([x, y, z]); const key = vk(bx, by, bz); let c = V.get(key); if (!c) V.set(key, c = []); c.push(id); return id;
  };
  for (const m of meshes) {
    const p = m.positions, idx = m.indices;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = vid(p[idx[t] * 3], p[idx[t] * 3 + 1], p[idx[t] * 3 + 2]), b = vid(p[idx[t + 1] * 3], p[idx[t + 1] * 3 + 1], p[idx[t + 1] * 3 + 2]), c = vid(p[idx[t + 2] * 3], p[idx[t + 2] * 3 + 1], p[idx[t + 2] * 3 + 2]);
      if (a === b || b === c || a === c) continue;   // degenerate after the weld
      T.push([a, b, c]);
    }
  }
  const E = new Map(), ek = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  T.forEach((t, i) => { for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const k = ek(a, b), e = E.get(k); if (e) e.n++; else E.set(k, { a, b, tri: i, n: 1 }); } });
  // a grid of triangles, for the probes
  const CS = 2, grid = new Map(), gk = (x, y, z) => `${x},${y},${z}`;
  const N = T.map((t) => unit(cross(sub(P[t[1]], P[t[0]]), sub(P[t[2]], P[t[0]]))));
  T.forEach((t, i) => {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(P[t[0]][k], P[t[1]][k], P[t[2]][k]) / CS)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(P[t[0]][k], P[t[1]][k], P[t[2]][k]) / CS));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = gk(x, y, z); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(i); }
  });
  /** Does the car's ray at q (cast from upM above q along up, lengthM downward) hit a road triangle other than skip? */
  const overRoad = (q, up, skip, along) => {
    const o = add(q, up, ray.upM), d = up.map((x) => -x), L = ray.lengthM, seen = new Set();
    for (let k = 0; k <= Math.ceil(L / CS) + 1; k++) {
      const c0 = add(o, d, Math.min(L, k * CS)).map((v) => Math.floor(v / CS));
      for (let x = c0[0] - 1; x <= c0[0] + 1; x++) for (let y = c0[1] - 1; y <= c0[1] + 1; y++) for (let z = c0[2] - 1; z <= c0[2] + 1; z++) {
        for (const i of grid.get(gk(x, y, z)) || []) {
          if (i === skip || seen.has(i)) continue; seen.add(i);
          if (Math.abs(dot(N[i], along)) > FACING) continue;   // faces along the road: not a surface the ray reads
          const t = T[i], e1 = sub(P[t[1]], P[t[0]]), e2 = sub(P[t[2]], P[t[0]]), pv = cross(d, e2), det = dot(e1, pv);
          if (Math.abs(det) < 1e-12) continue;   // the ray runs along the triangle: no hit
          const inv = 1 / det, tv = sub(o, P[t[0]]), u = dot(tv, pv) * inv; if (u < 0 || u > 1) continue;
          const qv = cross(tv, e1), v = dot(d, qv) * inv; if (v < 0 || u + v > 1) continue;
          const h = dot(e2, qv) * inv; if (h > 0 && h <= L) return true;
        }
      }
    }
    return false;
  };
  const reach = [...PROBES, ray.aheadM];
  // the nearest station, by a coarse grid on the stations
  const SC = 20, sg = new Map(); stations.forEach((st, i) => { const k = `${Math.floor(st.pos[0] / SC)},${Math.floor(st.pos[2] / SC)}`; let c = sg.get(k); if (!c) sg.set(k, c = []); c.push(i); });
  const nearest = (q) => { let best = -1, bd = Infinity; const cx = Math.floor(q[0] / SC), cz = Math.floor(q[2] / SC);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const i of sg.get(`${cx + dx},${cz + dz}`) || []) { const d = len(sub(stations[i].pos, q)); if (d < bd) { bd = d; best = i; } }
    return best; };
  const out = [];
  for (const e of E.values()) {
    if (e.n !== 1) continue;
    const t = T[e.tri], A = P[e.a], B = P[e.b], C = P[t.find((v) => v !== e.a && v !== e.b)], mid = add(A, sub(B, A), 0.5);
    const i = nearest(mid), st = i >= 0 ? stations[i] : null;
    if (!st || Math.abs(dot(N[e.tri], st.T)) > FACING) continue;   // not a surface the car rides (see above)
    let across = unit(cross(N[e.tri], sub(B, A))); if (dot(sub(C, mid), across) > 0) across = across.map((x) => -x);   // away from its own triangle
    const w = reach.find((d) => overRoad(add(mid, across, d), N[e.tri], e.tri, st.T));
    if (w === undefined) continue;
    out.push({ s: st.s, u: dot(sub(mid, st.pos), st.L), widthM: w, at: mid });
  }
  return out.sort((a, b) => a.s - b.s);
}

/** A flat strip x ∈ [x0, x1], z ∈ [z0, z1], cells of `cell` m, as one mesh { positions, indices } (test/validate_raygap.test.js's, with a cell size). */
function strip(x0, x1, z0, z1, y = 0, cell = 1) {
  const nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell)), pos = [], idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) pos.push(x0 + (x1 - x0) * i / nx, y, z0 + (z1 - z0) * j / nz);
  const at = (i, j) => j * (nx + 1) + i;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  return { positions: Float64Array.from(pos), indices: idx };
}
const stations = (z1) => Array.from({ length: z1 + 1 }, (_, z) => ({ s: z, pos: [0, 0, z], L: [1, 0, 0], T: [0, 0, 1] }));
const same = (meshes, st, what) => { const a = REFERENCE(meshes, st, RAY), b = rayGaps(meshes, st, RAY); assert.deepEqual(b, a, what); return a.length; };

test('row 1a: on synthetic roads, rayGaps is the first form, gap for gap (slits, holes, welds across a bucket boundary, degenerates, several meshes)', () => {
  const st = stations(60);
  assert.equal(same([strip(-5, 5, 0, 60)], st, 'unbroken'), 0);
  assert.ok(same([strip(-5, 5, 0, 30), strip(-5, 5, 30.3, 60)], st, 'a 0.3 m slit') > 0, 'control: the slit is found');
  assert.ok(same([strip(-5, 5, 0, 30), strip(-5, 5, 30.8, 60)], st, 'a 0.8 m slit') > 0);
  assert.equal(same([strip(-5, 5, 0, 30), strip(-5, 5, 31.5, 60)], st, 'a gap wider than the ray'), 0);
  // rows 0.2 mm apart that straddle a 5 mm bucket boundary (why the weld searches the neighbouring buckets), and rows 6 mm apart (no weld)
  assert.equal(same([strip(-5, 5, 0, 30.0049), strip(-5, 5, 30.0051, 60)], st, 'a 0.2 mm step across a bucket boundary welds'), 0);
  assert.ok(same([strip(-5, 5, 0, 30), strip(-5, 5, 30.006, 60)], st, 'a 6 mm slit does not weld') > 0);
  // holes: some of a strip's triangles taken out
  const h = strip(-5, 5, 0, 60); h.indices = h.indices.filter((_, k) => Math.floor(k / 6) % 97 !== 40);
  assert.ok(same([h], st, 'holes') > 0);
  // a degenerate triangle (all three corners within the weld), and the same mesh laid twice
  const d = strip(-5, 5, 0, 60), nd = d.positions.length / 3; d.positions = Float64Array.from([...d.positions, 0, 0, 10, 0.001, 0, 10, 0, 0.001, 10]); d.indices = [...d.indices, nd, nd + 1, nd + 2];
  assert.equal(same([d, strip(-5, 5, 0, 60)], st, 'a degenerate triangle and a mesh laid twice'), 0);
  // a tilted road with a slit, and a jump's lip (the road ends, road again 3 m on and 1 m lower)
  const tilt = (m, a) => ({ ...m, positions: m.positions.map((v, i) => (i % 3 === 1 ? m.positions[i - 1] * Math.tan(a) : v)) });
  assert.ok(same([tilt(strip(-5, 5, 0, 30, 0, 0.5), 0.3), tilt(strip(-5, 5, 30.25, 60, 0, 0.5), 0.3)], st, 'tilted, slit') > 0);
  assert.equal(same([strip(-5, 5, 0, 30), strip(-5, 5, 33, 60, -1)], st, 'a lip'), 0);
});

/** The road meshes and samples of a document, as the check builds them. */
function roadOf(doc) {
  const r = OJ.resolveDoc(doc), p0 = G.buildPath(r.segments, { step: 2, closed: !!doc.closed, start: r.start }), p = r.lift ? r.lift(p0) : p0;
  return { meshes: walkScene(G.buildMesh(p, r.segments, {}).scene).meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length), samples: p.samples };
}
/** A straight and `turns` quarter circles of radius 90 m, then 60 m: with 8 turns, two circles on one another (the road runs into itself). */
function coil(turns = 8) {
  let d = extend(D.createDoc('coil'), { length: 300, family: 'bowl' });
  for (let i = 0; i < turns; i++) d = extend(d, { length: Math.PI * 90, transition: 40, targets: { kh: 1 / 180 } });
  return extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
}

test('row 1b: on built roads (an open coil that runs into itself, a closed lap, a tube) rayGaps is the first form, gap for gap', () => {
  const lap = close(coil(4), { edited: [0] }).doc;
  const tube = extend(extend(D.createDoc('t'), { length: 200, family: 'bowl' }), { length: 400, targets: { t: 360 } });
  for (const [name, doc] of [['coil', coil(8)], ['closed lap', lap], ['tube', tube]]) { const r = roadOf(doc); same(r.meshes, r.samples, name); }
});

test('row 2: the check\'s lean mesh gives the check on buildMesh\'s own self-checked mesh, on a coil that overlaps itself; its two parts are the one-piece check', () => {
  const doc = close(coil(8), { edited: [0] }).doc, r = OJ.resolveDoc(doc), p0 = G.buildPath(r.segments, { step: 2, closed: true, start: r.start }), p = r.lift ? r.lift(p0) : p0;
  const full = G.buildMesh(p, r.segments, { selfCheck: true });
  assert.ok(full.selfCheck.intersections.length + full.selfCheck.stacked.length > 0, 'control: the coil runs into itself');
  const roadMesh = walkScene(full.scene).meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length);
  const v = V.validate(p, r.segments, { csp: true, softCollision: true, folds: full.folds, roadMesh, fullSpeed: true });
  const whole = OJ.runJob({ doc, closed: true });
  assert.deepEqual(whole, { overlaps: v.red.filter((x) => OJ.OVERLAP.has(x.reason)), others: v.red.filter((x) => !OJ.OVERLAP.has(x.reason)), amber: v.amber.length }, 'the lean check is the check on the full mesh');
  assert.ok(whole.overlaps.length > 0);
  assert.deepEqual(OJ.mergeParts(OJ.runJob({ doc, closed: true, part: 'rest' }), OJ.runJob({ doc, closed: true, part: 'rays' })), whole, 'the two parts are the one-piece check (the D240 merge rule)');
});

// ── row 3: memory ──
/** The keeper's 6 × 1000 m tube oval, rebuilt from its shape (not his file): 1000 m straights and half turns of 2 × 1000 m, kh = −(π/1000)·(1 − cos(πs/1000))/2 rising then
 * falling, every piece a full tube (t 360, r 2.993, w 45). */
function bigTubeOval() {
  // a cubic spline on the knots 20, 40, … 980: 53 control points, each at its Greville abscissa, the first two and the last two equal (zero slope at the joints)
  const knots = Array.from({ length: 49 }, (_, i) => 20 * (i + 1)), n = 53, fill = (x) => Array(n).fill(x);
  const T = [0, 0, 0, 0, ...knots, 1000, 1000, 1000, 1000], at = (j) => (T[j + 1] + T[j + 2] + T[j + 3]) / 3;
  const ch = (kh) => ({ kh, kv: fill(0), phi: fill(0), w: fill(45), r: fill(2.993), h: fill(0), l: fill(0), t: fill(360) });
  const up = Array.from({ length: n }, (_, j) => -(Math.PI / 1000) * (1 - Math.cos((Math.PI * at(j)) / 1000)) / 2);
  up[1] = up[0]; up[n - 2] = up[n - 1];
  const down = up.slice().reverse(), flat = fill(0);
  let d = D.createDoc('big tube');
  for (const kh of [flat, up, down, flat, up, down]) d = D.appendPiece(d, D.roadPiece({ length: 1000, channels: ch(kh), knots, tube: true }));
  return d;
}
const CAP_MB = 1500;
/** One part of the check ('rest', 'rays', or null: the whole) in a node process with its old generation capped at CAP_MB. */
function capped(doc, part) {
  const env = { ...process.env, NODE_OPTIONS: (process.env.NODE_OPTIONS || '').replace(/--max-old-space-size=\d+/g, '').trim() };
  const job = JSON.stringify(path.join(__dirname, '..', 'app', 'core', 'overlapjob.js'));
  const code = `const OJ = require(${job}); let s = ''; process.stdin.on('data', (c) => { s += c; }).on('end', () => { const r = OJ.runJob({ doc: JSON.parse(s), closed: true${part ? `, part: '${part}'` : ''} }); process.stdout.write(JSON.stringify({ ok: true })); });`;
  return spawnSync(process.execPath, [`--max-old-space-size=${CAP_MB}`, '-e', code], { input: JSON.stringify(doc), env, encoding: 'utf8', maxBuffer: 1 << 24 });
}

test('row 3: on a closed 6 × 1000 m tube oval, each part of the overlap check and the whole check finish within a 1,500 MB heap', () => {
  const res = close(bigTubeOval(), {}), doc = res.doc; assert.ok(doc && doc.closed, `the oval closes: ${res.report}`);
  const r = OJ.resolveDoc(doc); assert.ok(r.segments.length >= 2900, `control: 2 m segments over 6 km (${r.segments.length})`);
  for (const part of ['rest', 'rays', null]) {
    const run = capped(doc, part), err = (run.stderr || '').split('\n').filter((l) => /heap|memory|FATAL/i.test(l)).slice(0, 2).join(' | ');
    assert.equal(run.status, 0, `${part || 'whole'} did not finish within ${CAP_MB} MB: ${err || String(run.stderr).slice(0, 300)}`);
    assert.match(run.stdout, /"ok":true/);
  }
});
