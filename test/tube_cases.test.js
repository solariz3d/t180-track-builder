// tube_cases.test.js: node --test test/tube_cases.test.js   (one export and its reads, about a minute)
// A TUBE JUDGED END TO END, on one fixture track (the user: "we might need a separate test for tubing itself"). test/fixtures/tube-cases-2026-11-02.t180track is an
// open track of 16 pieces, 40 m round (a closed ring 6.37 m in radius), each piece one case, every channel held so nothing drifts on from a ringing fit:
//   lead-in (open road) · abrupt-close (to 360 over 40 m) · closed-run · abrupt-open (to 0 over 40 m, the shape whose outside showed a jag where it meets the road)
//   · road-between · gradual-close (over 200 m) · bend-in / bend-out (a closed tube on a 150 m bend) · bank-in / bank-out (on a 0.2 rad bank)
//   · climb-in / climb / crest-in / crest-out (on a climb and over its crest) · gradual-open (over 200 m) · run-out.
// The openings sit next to the open road's hull and apron. It is exported through the exporter's TEST route (an open track; its reds are warnings, not
// asserted here: the abrupt shapes ring through the slot band, which the downforce-ray check reds by design), and the scene AC is given (acScene: flat,
// welded, merged) is read whole. Rows:
//   1  the fixture is the cases it names, and every case has road and skin in the export (open cases their apron too): the control for every row below
//   2  THE JAG: across the road, the skin bends no more than the road it hangs under, plus SKIN_BEND_SLACK_DEG, in every case
//   3  the drawn hull has no open edge: every boundary edge is covered by another (a T-junction), except at the track's two ends
//   4  the drawn hull has no sliver: no triangle thinner than acready.js SLIVER
//   5  nothing clips: no drawn triangle passes through another (road, skin, apron), outside the triangles that share a vertex
//   6  collision inside: under the car on the centreline everywhere, and all round the closed ring, a ray finds a physics surface
//   7  the AI line runs through every case, on the road
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js');
const A = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const { readAiLine } = require('../src/export/ailine.js');
const { SLIVER } = require('../src/export/acready.js');
const { startLayout } = require('../app/core/coreshell.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'tube-cases-2026-11-02.t180track');
const CASES = ['lead-in', 'abrupt-close', 'closed-run', 'abrupt-open', 'road-between', 'gradual-close', 'bend-in', 'bend-out', 'bank-in', 'bank-out',
  'climb-in', 'climb', 'crest-in', 'crest-out', 'gradual-open', 'run-out'];
const OPEN = new Set(['lead-in', 'road-between', 'run-out']), CLOSED = new Set(['closed-run', 'bend-in', 'bend-out', 'bank-in', 'bank-out', 'climb-in', 'climb', 'crest-in', 'crest-out']);
const RING_R = 40 / (2 * Math.PI);   // the fixture's width is 40 m all along: a closed ring of this radius
// row 2: a skin vertex hangs under its road vertex, so across the road (from one 2 m row to the next) the skin bends as the road does; how far past the road's
// own largest bend in a case the skin's may go. Measured on the fixture as it stood before the opening was fixed: the road's largest across-road bend 0.0° to 12.5°,
// the skin's up to 0.6° past the road's in the closed, bent, banked and climbing cases, 8.4° past it in the two gradual openings, 23.9° and 24.5° past it at the abrupt ones
const SKIN_BEND_SLACK_DEG = 10;
const WELD = 1e-3;          // vertices this close are one (as the reads of the exported kn5 have welded them)
const COVER = 2e-3;         // a boundary edge lying within this of another boundary edge is covered (a T-junction), not open
const END_M = 4;            // the track's own two ends are open by design: an edge this near s = 0 or the end is not counted

let memo = null;
/** The fixture, its export, and every drawn triangle with its case: built once and shared by the rows. */
function fixture() {
  if (memo) return memo;
  const doc = D.parse(fs.readFileSync(FIXTURE, 'utf8')), segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q);
  const start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const ex = FW.buildFromSegments(segs, { name: 'tube cases', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: true }), test: true });
  const win = []; let s = 0;
  doc.pieces.forEach((p, i) => { win.push({ name: CASES[i], a: s, b: s + p.length }); s += p.length; });
  const caseOf = (x) => { const w = win.find((c) => x >= c.a && x < c.b); return w ? w.name : x >= s ? CASES[CASES.length - 1] : null; };
  // the nearest path sample of a world point (a 10 m grid; the ring's top is 2·RING_R off the centreline, so two cells each way)
  const samples = ex.path.samples, C = 10, grid = new Map(), cellOf = (p) => p.map((x) => Math.floor(x / C));
  for (const q of samples) { const k = cellOf(q.pos).join(','); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(q); }
  const sampleAt = (p) => {
    const c = cellOf(p); let best = null, bd = Infinity;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let l = -2; l <= 2; l++) {
      const L = grid.get(`${c[0] + i},${c[1] + j},${c[2] + l}`); if (L) for (const q of L) { const d = Math.hypot(p[0] - q.pos[0], p[1] - q.pos[1], p[2] - q.pos[2]); if (d < bd) { bd = d; best = q; } }
    }
    return best;
  };
  const family = (n) => (/^1ROAD_APRON/.test(n) ? 'apron' : /^1ROAD_PIT/.test(n) ? null : /^1(?:ROAD|GRIP\d{3})_/.test(n) ? 'road' : /^UNDERSKIN_/.test(n) ? 'skin'
    : /^(?:APRONSIDE|APRONLIP|JOIN)_/.test(n) ? 'join' : null);
  const meshes = ex.acScene.root.children.filter((n) => n.type === 'mesh' && n.renderable && n.visible && family(n.name));
  const ids = new Map(), tris = [];
  const vid = (p) => { const k = `${Math.round(p[0] / WELD)},${Math.round(p[1] / WELD)},${Math.round(p[2] / WELD)}`; if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  for (const m of meshes) {
    const P = m.positions, I = m.indices, f = family(m.name);
    for (let i = 0; i < I.length; i += 3) {
      const v = [I[i], I[i + 1], I[i + 2]].map((k) => [P[3 * k], P[3 * k + 1], P[3 * k + 2]]);
      const e1 = sub(v[1], v[0]), e2 = sub(v[2], v[0]), n = cross(e1, e2), area2 = Math.hypot(...n), longest = Math.max(Math.hypot(...e1), Math.hypot(...e2), Math.hypot(...sub(v[2], v[1])));
      const cen = [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3), q = sampleAt(cen);
      tris.push({ v, ids: v.map(vid), f, mesh: m.name, cen, q, s: q ? q.s : NaN, name: q ? caseOf(q.s) : null, thick: longest > 0 ? area2 / longest : 0, n: area2 > 0 ? n.map((x) => x / area2) : null });
    }
  }
  // edges by welded vertex pair, over the triangles at least SLIVER thick (a sliver's direction means nothing, and row 4 counts it)
  const edges = new Map();
  tris.forEach((t, ti) => { if (!t.n || t.thick < SLIVER) return; for (const [x, y] of [[0, 1], [1, 2], [2, 0]]) { const a = t.ids[x], b = t.ids[y]; if (a === b) continue; const k = a < b ? `${a}_${b}` : `${b}_${a}`; let L = edges.get(k); if (!L) edges.set(k, (L = [])); L.push({ ti, a: t.v[x], b: t.v[y] }); } });
  const lengthM = s;
  memo = { doc, ex, win, tris, edges, lengthM, sampleAt, caseOf, samples };
  return memo;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const DEG = 180 / Math.PI;
/** A point in its sample's road frame: u across (left +), v up, both in metres; for the messages. */
const frame = (p, q) => { const d = sub(p, q.pos); return `s ${q.s.toFixed(0)} m, u ${dot(d, q.L).toFixed(1)}, v ${dot(d, q.U).toFixed(1)}`; };

test('the fixture is the cases it names, and every case has road and skin in the export (its open cases their apron too)', () => {
  const { doc, win, tris } = fixture();
  assert.equal(doc.pieces.length, CASES.length);
  assert.equal(doc.closed, false);
  doc.pieces.forEach((p, i) => {
    const t = (u) => D.channelAt(p, 't', u * p.length).v;
    if (CLOSED.has(CASES[i])) assert.ok([0, 0.25, 0.5, 0.75, 1].every((u) => t(u) > 360 - 1e-6), `${CASES[i]} is a closed ring all along`);
    if (OPEN.has(CASES[i])) assert.ok(t(0.5) < 1, `${CASES[i]} is open road`);
  });
  // an opening or a closing goes the whole way; a short one's fit rings past its target and settles within 2° of it by the piece's end (extend.js)
  for (const [name, from, to] of [['abrupt-close', 0, 360], ['abrupt-open', 360, 0], ['gradual-close', null, 360], ['gradual-open', 360, 0]]) {
    const p = doc.pieces[CASES.indexOf(name)], t0 = D.channelAt(p, 't', 0).v, t1 = D.channelAt(p, 't', p.length).v;
    if (from !== null) assert.ok(Math.abs(t0 - from) < 2, `${name} starts at ${from}°, not ${t0.toFixed(2)}°`);
    assert.ok(Math.abs(t1 - to) < 2, `${name} ends at ${to}°, not ${t1.toFixed(2)}°`);
  }
  for (const w of win) {
    const has = (f) => tris.filter((t) => t.name === w.name && t.f === f).length;
    assert.ok(has('road') > 100 && has('skin') > 10, `${w.name}: road ${has('road')}, skin ${has('skin')} triangles`);
    if (OPEN.has(w.name)) assert.ok(has('apron') > 10, `${w.name}: apron ${has('apron')} triangles`);
  }
});

test('THE JAG: across the road the skin bends no more than the road it hangs under (plus the slack), in every case, the openings included', () => {
  const { edges, tris, win } = fixture(), most = {};
  for (const [, L] of edges) {
    if (L.length !== 2) continue;
    const t = tris[L[0].ti], g = tris[L[1].ti];
    if (t.f !== g.f || !t.name || !t.q || (t.f !== 'road' && t.f !== 'skin')) continue;
    const d = sub(L[0].b, L[0].a);
    if (Math.abs(dot(d, t.q.T)) / Math.hypot(...d) >= 0.5) continue;   // an edge ALONG the road (a ring's facets, the skin's coarser columns): not this row's
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(t.n, g.n)))) * DEG, key = `${t.name}|${t.f}`;
    if (!most[key] || ang > most[key].ang) most[key] = { ang, at: frame(L[0].a, t.q) };
  }
  const bad = [];
  for (const w of win) {
    const r = most[`${w.name}|road`] || { ang: 0 }, k = most[`${w.name}|skin`];
    assert.ok(k, `${w.name}: no skin edge across the road was read`);
    if (k.ang > r.ang + SKIN_BEND_SLACK_DEG) bad.push(`${w.name}: the skin bends ${k.ang.toFixed(1)}° across the road at ${k.at}, the road at most ${r.ang.toFixed(1)}°`);
  }
  assert.deepEqual(bad, []);
});

test('the drawn hull has no open edge: every boundary edge is covered by another (a T-junction), except at the track\'s two ends', () => {
  const { edges, tris, lengthM, sampleAt } = fixture(), bnd = [];
  for (const [, L] of edges) if (L.length === 1) bnd.push({ ...L[0], t: tris[L[0].ti] });
  const C = 1, grid = new Map(), cellOf = (p) => p.map((x) => Math.floor(x / C));
  bnd.forEach((e, i) => { const n = Math.ceil(Math.hypot(...sub(e.b, e.a)) / C) + 1; for (let j = 0; j <= n; j++) { const k = cellOf(e.a.map((x, m) => x + ((e.b[m] - x) * j) / n)).join(','); let S = grid.get(k); if (!S) grid.set(k, (S = new Set())); S.add(i); } });
  const segDist = (p, a, b) => { const ab = sub(b, a), ap = sub(p, a), L = dot(ab, ab), u = L ? Math.max(0, Math.min(1, dot(ap, ab) / L)) : 0; return Math.hypot(ap[0] - u * ab[0], ap[1] - u * ab[1], ap[2] - u * ab[2]); };
  const coveredAt = (p, self) => { const c = cellOf(p); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { const S = grid.get(`${c[0] + x},${c[1] + y},${c[2] + z}`); if (S) for (const j of S) if (j !== self && segDist(p, bnd[j].a, bnd[j].b) < COVER) return true; } return false; };
  const open = new Map();
  bnd.forEach((e, i) => {
    // the track's ends by the EDGE's own place along the road, not its triangle's centre: a strip of the light hull (src/export/lighthull.js) runs up to 40 m, so the
    // centre of one at the track's start lies 14 m in while its end edge is the track's end
    const qe = sampleAt(e.a.map((x, m) => (x + e.b[m]) / 2));
    if (!qe || !(qe.s > END_M && qe.s < lengthM - END_M)) return;
    if ([0.25, 0.5, 0.75].every((f) => coveredAt(e.a.map((x, m) => x + (e.b[m] - x) * f), i))) return;
    const k = `${e.t.name}, ${e.t.f}`, o = open.get(k) || { n: 0, at: frame(e.a, e.t.q) }; o.n++; open.set(k, o);
  });
  assert.deepEqual([...open].map(([k, o]) => `${k}: ${o.n} open edge(s), the first at ${o.at}`), []);
});

test('the drawn hull has no sliver: no triangle thinner than acready.js SLIVER', () => {
  const { tris } = fixture(), thin = new Map();
  for (const t of tris) {
    if (t.thick >= SLIVER || !t.name) continue;
    const k = `${t.name}, ${t.f}`, o = thin.get(k) || { n: 0, at: frame(t.cen, t.q) }; o.n++; thin.set(k, o);
  }
  assert.deepEqual([...thin].map(([k, o]) => `${k}: ${o.n} sliver(s), the first at ${o.at}`), []);
});

test('nothing clips: no drawn triangle passes through another (road, skin, apron), outside the triangles that share a vertex', () => {
  const { tris } = fixture(), EPS = 1e-4, C = 4, grid = new Map();
  const live = tris.filter((t) => t.n && t.name);
  live.forEach((t, i) => {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(t.v[0][k], t.v[1][k], t.v[2][k]) / C)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(t.v[0][k], t.v[1][k], t.v[2][k]) / C));
    t.lo = lo;
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = `${x},${y},${z}`; let L = grid.get(k); if (!L) grid.set(k, (L = [])); L.push(i); }
  });
  // an edge p→q of one triangle passes through the inside of another (a, b, c): more than EPS on each side of its plane, and inside all three of its edges
  const pierces = (p, q, t) => {
    const dp = dot(sub(p, t.v[0]), t.n), dq = dot(sub(q, t.v[0]), t.n);
    if (!((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS))) return false;
    const x = p.map((a, k) => a + ((q[k] - a) * dp) / (dp - dq));
    for (const [e0, e1] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]]) { const inward = cross(t.n, sub(e1, e0)); if (dot(sub(x, e0), inward) / Math.hypot(...inward) <= EPS) return false; }
    return true;
  };
  const clips = new Map();
  for (const [key, L] of grid) {
    const cell = key.split(',').map(Number);
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const A_ = live[L[i]], B = live[L[j]];
      if (![0, 1, 2].every((k) => Math.max(A_.lo[k], B.lo[k]) === cell[k])) continue;   // each pair once: in the first cell the two share
      if (A_.ids.some((a) => B.ids.includes(a))) continue;
      const hit = [[0, 1], [1, 2], [2, 0]].some(([x, y]) => pierces(A_.v[x], A_.v[y], B) || pierces(B.v[x], B.v[y], A_));
      if (!hit) continue;
      const k = `${A_.name}, ${[A_.f, B.f].sort().join(' through ')}`, o = clips.get(k) || { n: 0, at: frame(A_.cen, A_.q) }; o.n++; clips.set(k, o);
    }
  }
  assert.deepEqual([...clips].map(([k, o]) => `${k}: ${o.n} pair(s), the first at ${o.at}`), []);
});

test('collision inside: under the car on the centreline everywhere, and all round the closed ring, a ray finds a physics surface', () => {
  const { ex, samples, caseOf, lengthM } = fixture(), C = 4, grid = new Map(), phys = [];
  for (const m of ex.acScene.root.children) {
    if (m.type !== 'mesh' || !/^1(?:ROAD|GRIP\d{3})_/.test(m.name) || /^1ROAD_PIT/.test(m.name)) continue;
    const P = m.positions, I = m.indices;
    for (let i = 0; i < I.length; i += 3) {
      const v = [I[i], I[i + 1], I[i + 2]].map((k) => [P[3 * k], P[3 * k + 1], P[3 * k + 2]]), id = phys.push(v) - 1;
      const lo = [0, 1, 2].map((k) => Math.floor(Math.min(v[0][k], v[1][k], v[2][k]) / C)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(v[0][k], v[1][k], v[2][k]) / C));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = `${x},${y},${z}`; let L = grid.get(k); if (!L) grid.set(k, (L = [])); L.push(id); }
    }
  }
  // Möller–Trumbore along o + t·d, 0 < t < len, over the triangles in every cell of the segment's box; a ray on the edge two triangles share hits both
  // (barycentrics within BARY of the triangle), so it cannot slip between them
  const BARY = 1e-4;
  const hits = (o, d, len) => {
    const e = o.map((x, k) => x + d[k] * len), lo = [0, 1, 2].map((k) => Math.floor(Math.min(o[k], e[k]) / C)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(o[k], e[k]) / C));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const L = grid.get(`${x},${y},${z}`);
      if (L) for (const id of L) {
        const [a, b, cc] = phys[id], e1 = sub(b, a), e2 = sub(cc, a), p = cross(d, e2), det = dot(e1, p);
        if (Math.abs(det) < 1e-12) continue;
        const tv = sub(o, a), u = dot(tv, p) / det; if (u < -BARY || u > 1 + BARY) continue;
        const qv = cross(tv, e1), w = dot(d, qv) / det; if (w < -BARY || u + w > 1 + BARY) continue;
        const t = dot(e2, qv) / det; if (t > 0 && t < len) return true;
      }
    }
    return false;
  };
  const miss = new Map(), note = (name, what, q) => { const k = `${name}: ${what}`, o = miss.get(k) || { n: 0, at: `s ${q.s.toFixed(0)} m` }; o.n++; miss.set(k, o); };
  for (const q of samples) {
    if (!(q.s > END_M && q.s < lengthM - END_M)) continue;
    const name = caseOf(q.s), down = q.U.map((x) => -x);
    if (!hits(q.pos.map((x, k) => x + q.U[k]), down, 2)) note(name, 'no surface under the car', q);
    if (!CLOSED.has(name)) continue;
    const c = q.pos.map((x, k) => x + q.U[k] * RING_R);
    for (let a = 0; a < 360; a += 15) {
      const d = q.U.map((x, k) => -Math.cos(a / DEG) * x + Math.sin(a / DEG) * q.L[k]);
      if (!hits(c, d, RING_R + 1.5)) note(name, `no wall at ${a}° round the ring`, q);
    }
  }
  assert.deepEqual([...miss].map(([k, o]) => `${k}, ${o.n} time(s), the first at ${o.at}`), []);
});

test('the AI line runs through every case, on the road', () => {
  const { ex, sampleAt, caseOf, lengthM } = fixture(), pts = readAiLine(ex.ai).points.map((p) => p.pos);
  assert.ok(pts.length > lengthM / 10, `${pts.length} points over ${lengthM} m`);
  const per = new Map(), far = [];
  let gap = 0;
  pts.forEach((p, i) => {
    const q = sampleAt(p), name = q ? caseOf(q.s) : null;
    per.set(name, (per.get(name) || 0) + 1);
    if (!q || Math.hypot(...sub(p, q.pos)) > 1) far.push(q ? `${name} at ${frame(p, q)}` : `a point off the track at ${p.map((x) => x.toFixed(1))}`);
    if (i) gap = Math.max(gap, Math.hypot(...sub(p, pts[i - 1])));
  });
  assert.deepEqual(CASES.filter((n) => !per.get(n)), [], 'every case has AI points');
  assert.ok(gap < 10, `the largest step between AI points is ${gap.toFixed(1)} m`);
  assert.deepEqual(far.slice(0, 5), [], `${far.length} AI point(s) more than 1 m off the road's centreline`);
});
