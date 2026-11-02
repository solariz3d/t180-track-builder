// lighthull.test.js: node --test test/lighthull.test.js   (four exports of one fixture and their reads, about a minute)
// THE LIGHT HULL (src/export/lighthull.js; the user, 2026-11-02 07:01: "does the new apron and undertrack make more geometry to lag assetto?", 07:05: "if people
// make cool underneath textures, the simplification must not mess with the image beyond the curve distortion"). test/fixtures/light-hull-2026-11-02.t180track is an
// open track 27 m wide: a straight, a banked sweeper, an esse, a twist, and a climb up through vertical and over, every channel held. It is exported through the test
// route with the page's own textures (app/core/textures.js, as the page exports) and without, each with the light hull and without it (`lightHull: false`), and the
// scenes AC is given (acScene) are read whole. The full bottom is TODAY's: its uvs are the mapping the light one must keep.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const { SLIVER } = require('../src/export/acready.js');
const { withLightHull, LIGHT_TOL_M } = require('../src/export/lighthull.js');
const { startLayout } = require('../app/core/coreshell.js');
const { createCoreTextures } = require('../app/core/textures.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'light-hull-2026-11-02.t180track');
const UNDER = /^UNDERSKIN_/;
const memo = new Map();
/** The fixture's export, `textured` with the page's textures or not, `light` with the light hull or not (lightHull: false): built once each. */
function exportOf(textured, light) {
  const key = `${textured}|${light}`;
  if (memo.has(key)) return memo.get(key);
  const doc = D.parse(fs.readFileSync(FIXTURE, 'utf8')), segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q);
  const start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const textures = textured ? createCoreTextures({ segments: () => segs, closed: () => false, edge: true }).current() : undefined;
  const ex = FW.buildFromSegments(segs, { name: 'light hull', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: true }), test: true, lightHull: light, textures });
  memo.set(key, ex);
  return ex;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Every triangle of the scene's meshes whose name matches `re`: { P: [3 points], UV: [3 uvs] }, and a 4 m grid of them. */
function trianglesOf(ex, re) {
  const tris = [];
  for (const m of ex.acScene.root.children) {
    if (m.type !== 'mesh' || !re.test(m.name)) continue;
    const P = m.positions, U = m.uvs, I = m.indices;
    for (let i = 0; i < I.length; i += 3) { const k = [I[i], I[i + 1], I[i + 2]]; tris.push({ P: k.map((v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]]), UV: k.map((v) => [U[2 * v], U[2 * v + 1]]) }); }
  }
  const C = 4, grid = new Map();
  tris.forEach((t, id) => {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(t.P[0][k], t.P[1][k], t.P[2][k]) / C)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(t.P[0][k], t.P[1][k], t.P[2][k]) / C));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const key = `${x},${y},${z}`; let L = grid.get(key); if (!L) grid.set(key, (L = [])); L.push(id); }
  });
  const near = (p) => { const c = p.map((x) => Math.floor(x / C)), out = new Set(); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const id of grid.get(`${c[0] + x},${c[1] + y},${c[2] + z}`) || []) out.add(id); return out; };
  return { tris, near };
}
/** The point of `t` that carries uv (u, v), or null when no point of it does (barycentric tolerance 1e-4: a uv is a float32, its last digit at v = 13 is 5e-6 of a 2 m triangle's v). */
function atUv(t, u, v) {
  const [a, b, c] = t.UV, x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - a[0], y2 = c[1] - a[1], det = x1 * y2 - x2 * y1;
  if (!(Math.abs(det) > 1e-18)) return null;
  const px = u - a[0], py = v - a[1], l1 = (px * y2 - x2 * py) / det, l2 = (x1 * py - px * y1) / det, l0 = 1 - l1 - l2;
  if (Math.min(l0, l1, l2) < -1e-4) return null;
  return [0, 1, 2].map((k) => t.P[0][k] * l0 + t.P[1][k] * l1 + t.P[2][k] * l2);
}
/** How far the point of `on` carrying uv (u, v) lies from p, the nearest such point within the grid cells around p; Infinity when none carries it. */
function drift(on, p, u, v) {
  let best = Infinity;
  for (const id of on.near(p)) { const q = atUv(on.tris[id], u, v); if (q) best = Math.min(best, len(sub(p, q))); }
  return best;
}
const triCount = (ex, re) => ex.acScene.root.children.filter((m) => m.type === 'mesh' && re.test(m.name)).reduce((s, m) => s + m.indices.length / 3, 0);

test('the light bottom has under 40% of the full bottom\'s triangles on a textured track, and fewer on an untextured one', () => {
  const full = triCount(exportOf(true, false), UNDER), light = triCount(exportOf(true, true), UNDER);
  assert.ok(full > 50000, `the full bottom has ${full} triangles`);
  // 40,512 of 122,640 when this was written
  assert.ok(light < full * 0.4, `textured: ${light} of ${full}`);
  const uf = triCount(exportOf(false, false), UNDER), ul = triCount(exportOf(false, true), UNDER);
  // untextured, v starts again every 2 m, so only columns go (lighthull.js): 80,014 of 122,640 when this was written, the twist and the banks keeping theirs
  assert.ok(ul < uf * 0.8, `untextured: ${ul} of ${uf}`);
});

test('every mesh that is not the bottom is the same byte for byte (the road, the planks, their physics), with or without the light hull', () => {
  for (const textured of [true, false]) {
    const sig = (ex) => ex.acScene.root.children.filter((m) => m.type === 'mesh' && !UNDER.test(m.name)).map((m) => {
      const h = crypto.createHash('sha256').update(m.name).update(String(m.material));
      for (const A_ of [m.positions, m.normals, m.uvs, m.indices]) h.update(Buffer.from(A_.buffer, A_.byteOffset, A_.byteLength));
      return h.digest('hex');
    });
    const a = sig(exportOf(textured, false)), b = sig(exportOf(textured, true));
    assert.ok(a.length > 10);
    assert.deepEqual(b, a, textured ? 'textured' : 'untextured');
    assert.deepEqual(exportOf(textured, true).acScene.materials, exportOf(textured, false).acScene.materials);
  }
});

test('THE IMAGE: every vertex of the full bottom, found on the light bottom by its own uv, lies within LIGHT_TOL_M of where it was (textured and untextured)', () => {
  for (const textured of [true, false]) {
    const light = trianglesOf(exportOf(textured, true), UNDER);
    let worst = 0, at = null, n = 0;
    for (const m of exportOf(textured, false).acScene.root.children) {
      if (m.type !== 'mesh' || !UNDER.test(m.name)) continue;
      for (let i = 0; i < m.positions.length / 3; i++) {
        const p = [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]], d = drift(light, p, m.uvs[2 * i], m.uvs[2 * i + 1]);
        n++; if (!(d <= worst)) { worst = d; at = p; }
      }
    }
    assert.ok(n > 10000);
    assert.ok(worst <= LIGHT_TOL_M + 1e-5, `${textured ? 'textured' : 'untextured'}: the farthest drift ${(worst * 100).toFixed(2)} cm at ${at && at.map((x) => x.toFixed(1))}`);
  }
});

test('THE IMAGE at random points: a point of the light bottom carries the uv the full bottom carries within LIGHT_TOL_M of it', () => {
  const lightEx = exportOf(true, true), full = trianglesOf(exportOf(true, false), UNDER), light = trianglesOf(lightEx, UNDER);
  let seed = 610; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let worst = 0, at = null;
  for (let k = 0; k < 3000; k++) {
    const t = light.tris[Math.floor(rnd() * light.tris.length)];
    let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
    const w = [1 - a - b, a, b], p = [0, 1, 2].map((q) => t.P[0][q] * w[0] + t.P[1][q] * w[1] + t.P[2][q] * w[2]);
    const u = t.UV[0][0] * w[0] + t.UV[1][0] * w[1] + t.UV[2][0] * w[2], v = t.UV[0][1] * w[0] + t.UV[1][1] * w[1] + t.UV[2][1] * w[2];
    const d = drift(full, p, u, v);
    if (!(d <= worst)) { worst = d; at = p; }
  }
  assert.ok(worst <= LIGHT_TOL_M * 1.5, `the farthest drift at a random point ${(worst * 100).toFixed(2)} cm at ${at && at.map((x) => x.toFixed(1))}`);
});

test('no light triangle spans a uv jump: an untextured track\'s v starts again every 2 m, and no triangle of its bottom runs over more than one start', () => {
  const ex = exportOf(false, true);
  let widest = 0;
  for (const m of ex.acScene.root.children) {
    if (m.type !== 'mesh' || !UNDER.test(m.name)) continue;
    for (let i = 0; i < m.indices.length; i += 3) { const v = [0, 1, 2].map((j) => m.uvs[2 * m.indices[i + j] + 1]); widest = Math.max(widest, Math.max(...v) - Math.min(...v)); }
  }
  assert.ok(widest <= 0.2 + 1e-5, `a bottom triangle spans ${widest.toFixed(3)} in v (one 2 m segment is 0.2)`);
});

test('the light bottom opens no edge and has no sliver: the drawn hull\'s uncovered boundary edges are the full one\'s, and no bottom triangle is thinner than SLIVER', () => {
  const hull = /^(?:UNDERSKIN_|APRONSIDE_|1(?:ROAD|GRIP\d{3})_APRON)/;
  const open = (ex) => {
    const W = 1e-3, ids = new Map(), vid = (p) => { const k = p.map((x) => Math.round(x / W)).join(','); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); }, edges = new Map();
    for (const m of ex.acScene.root.children) {
      if (m.type !== 'mesh' || !hull.test(m.name)) continue;
      for (let i = 0; i < m.indices.length; i += 3) {
        const v = [0, 1, 2].map((j) => { const q = m.indices[i + j]; return [m.positions[3 * q], m.positions[3 * q + 1], m.positions[3 * q + 2]]; }), id = v.map(vid);
        for (const [x, y] of [[0, 1], [1, 2], [2, 0]]) { if (id[x] === id[y]) continue; const k = id[x] < id[y] ? `${id[x]}_${id[y]}` : `${id[y]}_${id[x]}`; const L = edges.get(k) || []; L.push([v[x], v[y]]); edges.set(k, L); }
      }
    }
    // a boundary edge is open unless another boundary edge covers its three quarter points within 2 mm (a T-junction)
    const bnd = [...edges.values()].filter((L) => L.length === 1).map((L) => L[0]), C = 1, grid = new Map(), cellOf = (p) => p.map((x) => Math.floor(x / C));
    bnd.forEach((e, i) => { const n = Math.ceil(len(sub(e[1], e[0])) / C) + 1; for (let j = 0; j <= n; j++) { const k = cellOf(e[0].map((x, q) => x + ((e[1][q] - x) * j) / n)).join(','); if (!grid.has(k)) grid.set(k, new Set()); grid.get(k).add(i); } });
    const segDist = (p, a, b) => { const ab = sub(b, a), L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L)) : 0; return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])); };
    const covered = (p, self) => { const c = cellOf(p); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const j of grid.get(`${c[0] + x},${c[1] + y},${c[2] + z}`) || []) if (j !== self && segDist(p, bnd[j][0], bnd[j][1]) < 2e-3) return true; return false; };
    return bnd.filter((e, i) => ![0.25, 0.5, 0.75].every((f) => covered(e[0].map((x, q) => x + (e[1][q] - x) * f), i))).map((e) => e[0].map((x, q) => (x + e[1][q]) / 2));
  };
  for (const textured of [true, false]) {
    const f = open(exportOf(textured, false)), l = open(exportOf(textured, true));
    // the track's own two ends are open in both (a stretch's end rows are whole, so the light ones lie on the full ones); no open edge anywhere else
    const nearAny = (p) => f.some((q) => len(sub(p, q)) < 1);
    assert.deepEqual(l.filter((p) => !nearAny(p)).map((p) => p.map((x) => +x.toFixed(1))), [], textured ? 'textured' : 'untextured');
    let thin = 0;
    for (const m of exportOf(textured, true).acScene.root.children) {
      if (m.type !== 'mesh' || !UNDER.test(m.name)) continue;
      for (let i = 0; i < m.indices.length; i += 3) {
        const v = [0, 1, 2].map((j) => { const q = m.indices[i + j]; return [m.positions[3 * q], m.positions[3 * q + 1], m.positions[3 * q + 2]]; });
        const x = cross(sub(v[1], v[0]), sub(v[2], v[0])), longest = Math.max(len(sub(v[1], v[0])), len(sub(v[2], v[0])), len(sub(v[2], v[1])));
        if (!(longest > 0 && len(x) / longest >= SLIVER)) thin++;
      }
    }
    assert.equal(thin, 0);
  }
});

test('the light bottom faces where the full one does: every triangle is wound so its normal agrees with its vertices\' normals (away from the road)', () => {
  for (const textured of [true, false]) for (const light of [false, true]) {
    let wrong = 0, n = 0;
    for (const m of exportOf(textured, light).acScene.root.children) {
      if (m.type !== 'mesh' || !UNDER.test(m.name)) continue;
      for (let i = 0; i < m.indices.length; i += 3) {
        const k = [m.indices[i], m.indices[i + 1], m.indices[i + 2]], v = k.map((q) => [m.positions[3 * q], m.positions[3 * q + 1], m.positions[3 * q + 2]]);
        const x = cross(sub(v[1], v[0]), sub(v[2], v[0])), s_ = [0, 1, 2].map((c) => k.reduce((acc, q) => acc + m.normals[3 * q + c], 0));
        n++; if (x[0] * s_[0] + x[1] * s_[1] + x[2] * s_[2] < 0) wrong++;
      }
    }
    assert.ok(n > 1000);
    assert.equal(wrong, 0, `${textured ? 'textured' : 'untextured'}, ${light ? 'light' : 'full'}: ${wrong} of ${n} triangles face the road`);
  }
});

test('vertex for vertex: the light hull has no boundary edge the full one does not have (a row it shares with a cell beside it carries the same vertices on both sides)', () => {
  // stricter than the row above, which lets a T-junction within 2 mm pass: here an edge is open when no other triangle uses both its (welded) vertices, and every open edge
  // of the light hull must be an open edge of the full one too (the track's ends, and the T-junctions the full hull already had)
  const hull = /^(?:UNDERSKIN_|APRONSIDE_|1(?:ROAD|GRIP\d{3})_APRON)/, W = 1e-3, B = 0.01;
  // every open edge of an export's hull, as its two end points: a vertex is welded to any earlier one within W (its neighbouring buckets searched too, so two copies
  // either side of a bucket's edge are one)
  const openEdges = (ex) => {
    const pts = new Map(), at = [], edges = new Map();
    const weld = (p) => {
      const c = p.map((x) => Math.floor(x / B));
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) for (const id of pts.get(`${c[0] + a},${c[1] + b},${c[2] + d}`) || []) if (len(sub(p, at[id])) < W) return id;
      const id = at.push(p) - 1, k = c.join(','); if (!pts.has(k)) pts.set(k, []); pts.get(k).push(id); return id;
    };
    for (const m of ex.acScene.root.children) {
      if (m.type !== 'mesh' || !hull.test(m.name)) continue;
      for (let i = 0; i < m.indices.length; i += 3) {
        const k = [0, 1, 2].map((j) => { const q = m.indices[i + j]; return weld([m.positions[3 * q], m.positions[3 * q + 1], m.positions[3 * q + 2]]); });
        for (const [x, y] of [[0, 1], [1, 2], [2, 0]]) { if (k[x] === k[y]) continue; const e = k[x] < k[y] ? `${k[x]}|${k[y]}` : `${k[y]}|${k[x]}`; edges.set(e, (edges.get(e) || 0) + 1); }
      }
    }
    return [...edges].filter(([, n]) => n === 1).map(([e]) => e.split('|').map((id) => at[+id]));
  };
  for (const textured of [true, false]) {
    const f_ = openEdges(exportOf(textured, false)), l = openEdges(exportOf(textured, true)), near = new Map();
    for (const e of f_) { const k = e[0].map((x, q) => Math.floor((x + e[1][q]) / 2)).join(','); if (!near.has(k)) near.set(k, []); near.get(k).push(e); }
    const same = (e) => { const c = e[0].map((x, q) => Math.floor((x + e[1][q]) / 2)); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) for (const g of near.get(`${c[0] + a},${c[1] + b},${c[2] + d}`) || []) if ((len(sub(e[0], g[0])) < 2 * W && len(sub(e[1], g[1])) < 2 * W) || (len(sub(e[0], g[1])) < 2 * W && len(sub(e[1], g[0])) < 2 * W)) return true; return false; };
    const extra = l.filter((e) => !same(e));
    assert.ok(f_.length > 0, 'control: the full hull has open edges (the track\'s ends)');
    assert.deepEqual(extra.slice(0, 5).map((e) => e.map((p) => p.map((x) => +x.toFixed(2)))), [], `${textured ? 'textured' : 'untextured'}: ${extra.length} open edge(s) the full hull does not have`);
  }
});

// A light piece's two end rows are whole (every column), and the strip off a whole end row is one row long, so a piece ends on the full skin's own last cell.
// It was so only where the piece kept fewer columns than the whole row: a piece that keeps every column (a twist, or his CRAZY TEST's last 200 m) ran its end
// strip 20 m long onto the row, and the export's final-scene check, which reads an open route's last 4 m by the path sample nearest each triangle's centre, read
// that end row as a line of sky (CRAZY TEST, s 19,649, 36 edges). Read on the fixture unmerged and textured (v runs on along the road): a light piece is a
// bottom node the full export has under the same name with a different triangle count, and a cell is a full cell node's own v span.
test('every light piece ends on a whole cell: no triangle on a piece\'s first or last row reaches further along than one cell, on a piece that keeps every column too', () => {
  const build = (light) => { const k = `unmerged|${light}`; if (memo.has(k)) return memo.get(k);
    const doc = D.parse(fs.readFileSync(FIXTURE, 'utf8')), segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
    const textures = createCoreTextures({ segments: () => segs, closed: () => false, edge: true }).current();
    const ex = FW.buildFromSegments(segs, { name: 'light hull', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: true }), test: true, lightHull: light, textures, mergeMeshes: false });
    memo.set(k, ex); return ex; };
  // the bottom's nodes (each a dummy holding its mesh, or the mesh itself), by name
  const nodes = (ex) => { const out = new Map(); for (const c of ex.acScene.root.children) { const m = c.type === 'mesh' ? c : (c.children || []).find((x) => x.type === 'mesh'); if (m && UNDER.test(m.name)) out.set(m.name, m); } return out; };
  const full = nodes(build(false)), light = nodes(build(true));
  const vSpan = (m) => { let lo = Infinity, hi = -Infinity; for (let i = 1; i < m.uvs.length; i += 2) { lo = Math.min(lo, m.uvs[i]); hi = Math.max(hi, m.uvs[i]); } return [lo, hi]; };
  const spans = [...full.values()].map((m) => { const [lo, hi] = vSpan(m); return hi - lo; }).sort((a, b) => a - b), cell = spans[Math.floor(spans.length / 2)];
  assert.ok(cell > 0, 'control: a full cell has a v span');
  const pieces = [...light.values()].filter((m) => full.has(m.name) && full.get(m.name).indices.length !== m.indices.length);
  assert.ok(pieces.length >= 10, `control: the fixture has light pieces (${pieces.length})`);
  let wide = 0; const bad = [];
  for (const m of pieces) {
    const [lo, hi] = vSpan(m), V = (k) => m.uvs[2 * k + 1], I = m.indices, n = new Set();
    for (let i = 0; i < I.length; i++) { if (Math.abs(V(I[i]) - lo) < 1e-4) n.add(I[i]); }
    if (n.size) wide++;
    for (let t = 0; t < I.length; t += 3) {
      const v = [V(I[t]), V(I[t + 1]), V(I[t + 2])];
      if (v.some((x) => Math.abs(x - lo) < 1e-4) && Math.max(...v) - lo > cell * 1.001) { bad.push(`${m.name} first row, ${((Math.max(...v) - lo) / cell).toFixed(1)} cells`); break; }
      if (v.some((x) => Math.abs(x - hi) < 1e-4) && hi - Math.min(...v) > cell * 1.001) { bad.push(`${m.name} last row, ${((hi - Math.min(...v)) / cell).toFixed(1)} cells`); break; }
    }
  }
  assert.equal(wide, pieces.length, 'control: every light piece has a first row');
  assert.deepEqual(bad, [], 'a strip off a whole end row is longer than one cell');
});
test('a scene with no equation-core road to lighten is returned as it is', () => {
  const scene = { root: { children: [] }, materials: [] };
  assert.equal(withLightHull(scene, null, []), scene);
  assert.equal(withLightHull(scene, { cells: [], scene: { root: { children: [] } } }, []), scene);
});
// Where the bottom itself ends (an open route's two ends) its last 2 m is the full skin's own cell: a light piece stops a cell short. The export's final-scene check
// (src/export/finalscene.js) reads an open edge within 4 m of the route's end as the end, by the path sample nearest each triangle's centre; a light triangle
// 40 m long ending there has its centre far up the road, so the same end row read as a line of sky (his CRAZY TEST, s 19,649, 36 edges)
/** A plain straight open route, 300 m of a flat bowl, as the TEST route exports it, textured: its bottom is one stretch end to end, with long steps along. */
function straightOf(light) {
  const key = `straight|${light}`;
  if (memo.has(key)) return memo.get(key);
  const doc = extend(D.createDoc('light hull straight'), { length: 300, family: 'bowl', first: { w: 20, c: 0 } }), segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q);
  const start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const textures = createCoreTextures({ segments: () => segs, closed: () => false, edge: true }).current();
  const ex = FW.buildFromSegments(segs, { name: 'light hull straight', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: true }), test: true, lightHull: light, textures });
  memo.set(key, ex);
  return ex;
}
test('at an open route\'s two ends the light bottom ends on the full skin\'s own last cell: no light triangle on the bottom\'s end row reaches further along than a cell (the fixture textured and untextured, a plain straight route textured)', () => {
  for (const [what, full, light] of [['the fixture, textured', exportOf(true, false), exportOf(true, true)], ['the fixture, untextured', exportOf(false, false), exportOf(false, true)], ['a plain straight route', straightOf(false), straightOf(true)]]) {
    const textured = what, S = full.path.samples;
    for (const [q, sign] of [[S[S.length - 1], 1], [S[0], -1]]) {
      // along the road from this end, out of the route: the full bottom's end row is its farthest vertices out, within 60 m of the end
      const along = (p) => sign * (sub(p, q.pos)[0] * q.T[0] + sub(p, q.pos)[1] * q.T[1] + sub(p, q.pos)[2] * q.T[2]);
      const nearEnd = (t) => t.P.every((p) => len(sub(p, q.pos)) < 60);
      const fullEnd = trianglesOf(full, UNDER).tris.filter(nearEnd), lightEnd = trianglesOf(light, UNDER).tris.filter(nearEnd);
      assert.ok(fullEnd.length > 0, `control: the full bottom reaches the route's ${sign > 0 ? 'last' : 'first'} 60 m`);
      const endRow = Math.max(...fullEnd.flatMap((t) => t.P.map(along)));
      const onEnd = lightEnd.filter((t) => t.P.some((p) => along(p) > endRow - 0.01));
      assert.ok(onEnd.length > 0, `${textured}: control: the light bottom reaches the full one's end row`);
      const far = onEnd.filter((t) => t.P.some((p) => along(p) < endRow - 2.01));
      assert.equal(far.length, 0, `${textured}: ${far.length} light triangle(s) on the bottom's ${sign > 0 ? 'last' : 'first'} row reach more than a cell (2 m) along, to ${far.length ? (endRow - Math.min(...far.flatMap((t) => t.P.map(along)))).toFixed(1) : 0} m`);
    }
    // and the export's own final-scene check finds no open edge on the light bottom it does not find on the full one
    const opens = (ex) => [...ex.sceneCheck.refuse, ...ex.sceneCheck.warn].filter((f) => f.kind === 'open').map((f) => f.message);
    assert.deepEqual(opens(light).filter((m) => !opens(full).includes(m)), [], `${what}: the light bottom opens an edge the full one does not`);
  }
});
