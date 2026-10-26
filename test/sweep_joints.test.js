// sweep_joints.test.js: node --test test/sweep_joints.test.js          (SWEEP_SEEDS=60 for the landing's larger run; SWEEP_SEED=17 runs one seed)
// D459/D460 (2026-10-25, the user: "remember it isnt just about fixing the track, but understanding it so the generation system never does it again").
// A SWEEP, not one track: every seed lays a track from public words (src/core/extend.js), with turns, climbs, banks, cups, edges (both sides and the right
// alone), tubes and piece lengths drawn from a seeded generator, closed when Close converges and open otherwise. The cross-sections change from piece to
// piece, so the vertex counts of the rows either side of a joint differ (the mesher picks each piece's resolution from its own profile): exactly where the
// seam zipper stood up as a fin on TEST 10 (exo_memory/handback/p-d459-kn5-C_2026-10-25.md). On every track:
//   FINS   the mesh's own seams carry no standing triangle (the generator makes none), and the scene the export writes (weldSeams(flattenForAc(...)),
//          fromwords.js) passes the fin guard (acready.js findFins: no seam triangle standing up out of the road, none off the surface it bridges)
//   LINE   the builder's preview draws a continuous centre line across every joint: its centre segments meet end to end, and no seam it draws stands
//          up over the line (a seam's standing triangle hides the line, the break in the user's previewer shot at s 3,700)
//   (P adds the C2 assertion at every ramp joint to this file: D459 3b)
// A seed whose words the document refuses is redrawn from the same generator (the draw, not the seed, moves on), so every seed builds a track.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const { buildMesh } = require('../src/geom/mesh.js');
const { flattenForAc, weldSeams, findFins, SLIVER } = require('../src/export/acready.js');
const { createCoreShell } = require('../app/core/coreshell.js');
const { createTrackModel } = require('../app/preview/trackmodel.js');
const { linesFor, LIFT } = require('../app/preview/look.js');

const SEEDS = process.env.SWEEP_SEED ? [Number(process.env.SWEEP_SEED)]
  : Array.from({ length: Number(process.env.SWEEP_SEEDS) || 6 }, (_, i) => 1 + i);   // "check it" size in the normal suite: 6 seeds
const DEG = Math.PI / 180;

/** mulberry32: a small seeded generator, the same numbers on every machine */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** one track from a seed: { doc, closed, words } (words: the extend calls, for the message when a row fails) */
function trackOf(seed) {
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)], between = (a, b) => a + (b - a) * r();
  const firstKind = pick(['plain', 'cup', 'edge', 'tube']);
  const first = firstKind === 'cup' ? { c: Math.round(between(5, 30)) } : firstKind === 'edge' ? { e: Math.round(between(5, 30)) } : firstKind === 'tube' ? { t: Math.round(between(60, 200)) } : {};
  let doc = extend(D.createDoc(`sweep ${seed}`), { length: 300, first }); const words = [{ length: 300, first }];
  const n = 5 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    for (let tries = 0; tries < 6; tries++) {
      const t = {};
      if (r() < 0.6) t.kh = (r() < 0.5 ? -1 : 1) / between(250, 900);   // a turn
      else if (r() < 0.5) t.kh = 0;
      if (r() < 0.3) t.kv = (r() < 0.5 ? -1 : 1) / between(2000, 6000);   // a climb or a dip
      if (r() < 0.35) t.phi = (r() < 0.5 ? -1 : 1) * between(0, 20) * DEG;   // a bank
      if (firstKind === 'cup' && r() < 0.5) t.c = Math.round(between(0, 35));
      if (firstKind === 'edge' && r() < 0.6) { if (r() < 0.5) t.e = Math.round(between(-10, 30)); else t.er = Math.round(between(0, 35)); }
      if (firstKind === 'tube' && r() < 0.5) t.t = Math.round(between(30, 240));
      const w = { length: Math.round(between(40, 260)), transition: 40, targets: t };
      try { doc = extend(doc, w); words.push(w); break; } catch (e) { /* the document refused these words: draw again */ }
    }
  }
  let closed = false;
  if (seed % 2 === 0) { try { const c = close(doc, { edited: [0] }); if (c.converged) { doc = c.doc; closed = true; } } catch (e) { /* stays open */ } }
  return { doc, closed, words };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nz = (v) => { const l = Math.hypot(...v); return l ? v.map((x) => x / l) : v; };
/** standing triangles of one mesh: thicker than SLIVER, normal more than 60° from its vertices' road normals (the guard's own rule, measured here independently) */
function standing(m) {
  const P = (i) => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]], N = (i) => [m.normals[3 * i], m.normals[3 * i + 1], m.normals[3 * i + 2]];
  let n = 0, tallest = 0;
  for (let k = 0; k < m.indices.length; k += 3) {
    const t = [m.indices[k], m.indices[k + 1], m.indices[k + 2]], v = t.map(P), c = cr(sub(v[1], v[0]), sub(v[2], v[0]));
    const longest = Math.max(Math.hypot(...sub(v[1], v[0])), Math.hypot(...sub(v[2], v[0])), Math.hypot(...sub(v[2], v[1]))), thick = longest ? Math.hypot(...c) / longest : 0;
    const road = nz(t.map(N).reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]));
    if (thick < SLIVER || Math.hypot(...road) === 0) continue;
    if (Math.acos(Math.min(1, Math.abs(dot(nz(c), road)))) / DEG > 60) { n++; tallest = Math.max(tallest, thick); }
  }
  return { n, tallest };
}
const world = (p, M) => [p[0] * M[0] + p[1] * M[4] + p[2] * M[8] + M[12], p[0] * M[1] + p[1] * M[5] + p[2] * M[9] + M[13], p[0] * M[2] + p[1] * M[6] + p[2] * M[10] + M[14]];
const mm = (x) => (x * 1000).toFixed(1);

for (const seed of SEEDS) {
  test(`seed ${seed}: no fin in the mesh's seams or in the scene the export writes`, () => {
    const { doc, closed, words } = trackOf(seed);
    const segs = A.toSegments(doc), mesh = buildMesh(A.toPath(doc).path, segs);
    const seams = mesh._state.seams.map((sm) => (sm ? { s: sm.s, ...standing(sm) } : null)).filter(Boolean);
    const raw = seams.filter((x) => x.n).map((x) => `s ${x.s.toFixed(1)}: ${x.n} standing, ${mm(x.tallest)} mm`);
    assert.deepEqual(raw, [], `seed ${seed} (${closed ? 'closed' : 'open'}, ${doc.pieces.length} pieces, ${seams.length} seams; words ${JSON.stringify(words)})`);
    const fins = findFins(weldSeams(flattenForAc(mesh.scene)));
    assert.deepEqual(fins.map((f) => f.message), [], `seed ${seed}: the fin guard on the scene the export writes`);
  });
  test(`seed ${seed}: the preview's centre line is continuous across every joint, and no seam stands up over it`, async () => {
    const { doc, closed, words } = trackOf(seed), text = D.serialize(doc);
    const sh = await createCoreShell({ brushFn: null, exporter: null, storage: { openDoc: async () => text } }); await sh.open(`sweep ${seed}`);
    const batches = createTrackModel().update(sh.getState().resolved).batches;
    const over = batches.filter((b) => b.seam).map((b) => ({ key: b.key, ...standing(b) })).filter((x) => x.n && x.tallest > LIFT * 0.5);
    assert.deepEqual(over.map((x) => `${x.key}: ${x.n} standing, ${mm(x.tallest)} mm over a line lifted ${mm(LIFT)} mm`), [], `seed ${seed} (${closed ? 'closed' : 'open'}; words ${JSON.stringify(words)})`);
    // the centre line's segments, in world space: every segment end meets another segment's end (a closed lap has no free end, an open one has two)
    const ends = [];
    for (const b of batches) { const ln = linesFor(b); if (!ln) continue; const E = ln.edges; for (let o = 0; o < E.length; o += 18) { const a = world([E[o + 6], E[o + 7], E[o + 8]], b.model), c = world([E[o + 9], E[o + 10], E[o + 11]], b.model); ends.push(a, c); } }
    const G = 0.5, grid = new Map(), key = (p) => `${Math.floor(p[0] / G)},${Math.floor(p[1] / G)},${Math.floor(p[2] / G)}`;
    ends.forEach((p, i) => { const k = key(p); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
    let free = 0;
    ends.forEach((p, i) => { const cx = Math.floor(p[0] / G), cy = Math.floor(p[1] / G), cz = Math.floor(p[2] / G); let met = false;
      for (let dx = -1; dx <= 1 && !met; dx++) for (let dy = -1; dy <= 1 && !met; dy++) for (let dz = -1; dz <= 1 && !met; dz++) for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) if (j !== i && (j >> 1) !== (i >> 1) && Math.hypot(...sub(ends[j], p)) < 1e-3) { met = true; break; }
      if (!met) free++; });
    assert.ok(ends.length > 0, 'the preview draws a centre line');
    assert.ok(free <= (closed ? 0 : 2), `seed ${seed}: ${free} centre-line segment ends meet no other (a ${closed ? 'closed lap has none' : 'open track has two'})`);
  });
}
module.exports = { trackOf, rng };
