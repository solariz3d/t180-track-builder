// meshcurv.cjs: M3 (design §8; pane C's registration p-d182-m2m3-C §0, sha256 e71c5555…): the discrete Gaussian curvature
// of a track's ROAD mesh (angle defect), and whether its hyperbolic (K < 0) area sits in the corners.
//   node tools/meshcurv.cjs <track dir> <read.json> [layout]         (JSON to stdout: numbers only, no mesh, no map)
// THE ROAD MESHES are read_track.cjs's: physics meshes whose surface key is a valid track surface (surfaces.ini KEY with
// IS_VALID_TRACK=1, or ROAD), PIT skipped, "underside" meshes skipped unless they are most of the road.
// WELDED by position on a 1 mm grid (AC splits a road per material and cell). INTERIOR vertices only: every incident edge is
// shared by exactly two triangles, and the incident triangles close into one fan; boundary and seam vertices are counted and
// left out. Per interior vertex: δ = 2π − Σ incident angles, A = ⅓ Σ incident areas, K = δ / A; |δ| < 1e-4 rad is flat (K = 0).
// AGAINST THE CORNERS: each vertex goes to the nearest station of the read (4 m apart) within 60 m; a station's K<0 (K>0)
// share is its K<0 (K>0) area over its interior area; |k| is the read's curvature there.
// SCORE (registered): Spearman ρ(|k|, station K<0 share) over stations holding ≥ 20 interior vertices, 95% CI by moving-block
// bootstrap (blocks of 25 stations, 1,000 resamples, seed 1); and the K<0 share on corner stations (|k| ≥ 1/500) against
// straights (|k| < 1/1500). The track PASSES iff the CI is above 0 AND corners > straights; M3 passes iff both tracks pass.
'use strict';
const fs = require('fs'), path = require('path');
const { readKn5 } = require('./kn5.cjs');
const { spearman } = require('./geodesic.cjs');

function roadTriangles(dir, layout) {
  const keys = new Set(['ROAD']), files = [];
  (function walk(x) { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase() === 'surfaces.ini') files.push(p); } })(dir);
  for (const f of files) { let key = null; for (const line of fs.readFileSync(f, 'latin1').split(/\r?\n/)) { const k = line.match(/^\s*KEY\s*=\s*([^\s;]+)/i); if (k) key = k[1].toUpperCase(); if (/^\s*IS_VALID_TRACK\s*=\s*1/i.test(line) && key && !/PIT/i.test(key)) keys.add(key.replace(/^\d+/, '').replace(/\?$/, '')); } }
  let kn5 = fs.readdirSync(dir).filter((f) => /\.kn5$/i.test(f));
  if (layout) kn5 = [...fs.readFileSync(path.join(dir, `models_${layout}.ini`), 'latin1').matchAll(/^\s*FILE\s*=\s*(.+?)\s*$/gim)].map((m) => m[1]);
  const meshes = [];
  for (const f of kn5) for (const m of readKn5(path.join(dir, f)).meshes) { const nm = m.name.toUpperCase().match(/^\d+([A-Z_]+)/); if (!nm || /PIT/.test(m.name.toUpperCase())) continue; if (![...keys].some((K) => nm[1].startsWith(K))) continue; meshes.push(m); }
  const isUnder = (m) => /UNDERSIDE|UNDER_SIDE|BOTTOM/.test(m.name.toUpperCase());
  const tri = (m) => m.idx.length / 3, under = meshes.filter(isUnder).reduce((a, m) => a + tri(m), 0), all = meshes.reduce((a, m) => a + tri(m), 0);
  return meshes.filter((m) => !isUnder(m) || under > all * 0.6);
}

function curvature(meshes) {
  const id = new Map(), P = [];   // welded vertex positions
  const vid = (x, y, z) => { const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`; let i = id.get(k); if (i === undefined) { i = P.length / 3; id.set(k, i); P.push(x, y, z); } return i; };
  const T = [];
  for (const m of meshes) for (let i = 0; i < m.idx.length; i += 3) {
    const t = [0, 1, 2].map((q) => { const j = m.idx[i + q]; return vid(m.pos[j * 3], m.pos[j * 3 + 1], m.pos[j * 3 + 2]); });
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) T.push(t);
  }
  const nV = P.length / 3, angle = new Float64Array(nV), area = new Float64Array(nV), edges = new Map();
  const v = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(a[0], a[1], a[2]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const degree = new Uint32Array(nV);
  for (const t of T) {
    const [a, b, c] = t.map(v), A = len(cross(sub(b, a), sub(c, a))) / 2;
    for (let q = 0; q < 3; q++) {
      const o = t[q], p1 = v(t[(q + 1) % 3]), p2 = v(t[(q + 2) % 3]), po = v(o), e1 = sub(p1, po), e2 = sub(p2, po);
      const l1 = len(e1), l2 = len(e2); if (l1 > 0 && l2 > 0) angle[o] += Math.acos(Math.max(-1, Math.min(1, dot(e1, e2) / (l1 * l2))));
      area[o] += A / 3; degree[o]++;
      const x = t[q], y = t[(q + 1) % 3], k = x < y ? `${x},${y}` : `${y},${x}`; edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  // interior: every incident edge used exactly twice, and as many incident edges as triangles (one closed fan)
  const incident = new Uint32Array(nV), bad = new Uint8Array(nV);
  for (const [k, n] of edges) { const [x, y] = k.split(',').map(Number); incident[x]++; incident[y]++; if (n !== 2) { bad[x] = 1; bad[y] = 1; } }
  const K = new Float64Array(nV), delta = new Float64Array(nV), interior = new Uint8Array(nV); let nInterior = 0;
  for (let i = 0; i < nV; i++) {
    if (bad[i] || incident[i] !== degree[i] || !(area[i] > 0)) continue;
    interior[i] = 1; nInterior++;
    const d = 2 * Math.PI - angle[i]; delta[i] = d; K[i] = Math.abs(d) < 1e-4 ? 0 : d / area[i];
  }
  return { P, nV, nT: T.length, nInterior, K, delta, area, interior };
}

// M3b: K SMOOTHED over a ball of radius r BEFORE any sign is counted: K̄(i) = Σ δ_j / Σ A_j over the interior vertices j within
// r of vertex i (the Gauss–Bonnet mean curvature of the patch; the raw δ, no per-vertex floor). |K̄| < 1e-6 m⁻² is flat.
function smoothK(c, r) {
  const grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < c.nV; i++) if (c.interior[i]) { const k = key(Math.floor(c.P[i * 3] / r), Math.floor(c.P[i * 3 + 1] / r), Math.floor(c.P[i * 3 + 2] / r)); let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(i); }
  const out = new Float64Array(c.nV), r2 = r * r;
  for (let i = 0; i < c.nV; i++) {
    if (!c.interior[i]) continue;
    const x = c.P[i * 3], y = c.P[i * 3 + 1], z = c.P[i * 3 + 2], gx = Math.floor(x / r), gy = Math.floor(y / r), gz = Math.floor(z / r);
    let sd = 0, sa = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) for (const j of grid.get(key(gx + a, gy + b, gz + e)) || []) {
      const dx = c.P[j * 3] - x, dy = c.P[j * 3 + 1] - y, dz = c.P[j * 3 + 2] - z;
      if (dx * dx + dy * dy + dz * dz <= r2) { sd += c.delta[j]; sa += c.area[j]; }
    }
    const kb = sa > 0 ? sd / sa : 0; out[i] = Math.abs(kb) < 1e-6 ? 0 : kb;
  }
  return out;
}

function score(c, read, { K = c.K } = {}) {
  const S = read.stations.filter((s) => s.c && s.k != null), cell = 60, grid = new Map();
  S.forEach((s, j) => { const k = s.c.map((x) => Math.floor(x / cell)).join(','); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(j); });
  const st = S.map((s) => ({ k: Math.abs(s.k), sk: Math.sign(s.k), neg: 0, pos: 0, all: 0, n: 0, negIn: 0, negOut: 0 }));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let i = 0; i < c.nV; i++) {
    if (!c.interior[i]) continue;
    const p = [c.P[i * 3], c.P[i * 3 + 1], c.P[i * 3 + 2]], g = p.map((x) => Math.floor(x / cell));
    let best = -1, bd = 60;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const j of grid.get(`${g[0] + x},${g[1] + y},${g[2] + z}`) || []) { const d = Math.hypot(p[0] - S[j].c[0], p[1] - S[j].c[1], p[2] - S[j].c[2]); if (d < bd) { bd = d; best = j; } }
    if (best < 0) continue;
    const s = st[best]; s.all += c.area[i]; s.n++; if (K[i] < 0) s.neg += c.area[i]; else if (K[i] > 0) s.pos += c.area[i];
    // the inner half of a turn is the side it turns toward: u > 0 (the reader's left, cross(f, n)) for k > 0
    const sb = S[best]; if (K[i] < 0 && sb.f && sb.n) { const L = cross(sb.f, sb.n), u = (p[0] - sb.c[0]) * L[0] + (p[1] - sb.c[1]) * L[1] + (p[2] - sb.c[2]) * L[2]; if (Math.sign(u) === s.sk) s.negIn += c.area[i]; else s.negOut += c.area[i]; }
  }
  const use = st.filter((s) => s.n >= 20), pairs = use.map((s) => [s.k, s.neg / s.all]);
  const rho = spearman(pairs);
  const blocks = []; for (let i = 0; i < pairs.length; i += 25) blocks.push(pairs.slice(i, i + 25));
  let a = 1; const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const boot = []; for (let b = 0; b < 1000; b++) { const s = []; while (s.length < pairs.length) s.push(...blocks[Math.floor(rnd() * blocks.length)]); boot.push(spearman(s.slice(0, pairs.length))); }
  boot.sort((x, y) => x - y);
  const share = (f, key) => { const Z = use.filter(f), A = Z.reduce((x, s) => x + s.all, 0); return A ? +(Z.reduce((x, s) => x + s[key], 0) / A).toFixed(4) : null; };
  const corner = (s) => s.k >= 1 / 500, straight = (s) => s.k < 1 / 1500;
  const ci = [boot[24], boot[974]], negC = share(corner, 'neg'), negS = share(straight, 'neg');
  const totA = st.reduce((x, s) => x + s.all, 0);
  return {
    stations: use.length, rho: +rho.toFixed(4), ci95: ci.map((x) => +x.toFixed(4)),
    kNegShare: { corners: negC, straights: negS, whole: totA ? +(st.reduce((x, s) => x + s.neg, 0) / totA).toFixed(4) : null },
    kPosShare: { corners: share(corner, 'pos'), straights: share(straight, 'pos'), whole: totA ? +(st.reduce((x, s) => x + s.pos, 0) / totA).toFixed(4) : null },
    cornerStations: use.filter(corner).length, straightStations: use.filter(straight).length,
    verdict: ci[0] > 0 && negC > negS ? 'PASS' : 'FAILS',
    innerHalf: (() => { const C = use.filter(corner).filter((s) => s.negIn + s.negOut > 0); const m = C.filter((s) => s.negIn > s.negOut).length; return { cornerStationsWithKneg: C.length, innerMore: m, share: C.length ? +(m / C.length).toFixed(4) : null }; })(),
  };
}

if (require.main === module) {
  const args = process.argv.slice(2), ri = args.indexOf('--radius'), radii = ri >= 0 ? args[ri + 1].split(',').map(Number) : null;
  const [dir, readFile, layout] = args.filter((a, i) => a !== '--radius' && args[i - 1] !== '--radius');
  if (!dir || !readFile) { console.error('usage: node tools/meshcurv.cjs [--radius r1,r2,…] <track dir> <read.json> [layout]'); process.exit(1); }
  const c = curvature(roadTriangles(dir, layout)), read = JSON.parse(fs.readFileSync(readFile, 'utf8'));
  const head = { track: path.basename(dir), vertices: c.nV, triangles: c.nT, interior: c.nInterior };
  if (!radii) process.stdout.write(JSON.stringify({ registration: 'p-d182-m2m3-C §0 (sha256 e71c5555ecd1cb04)', ...head, score: score(c, read) }, null, 1) + '\n');
  else process.stdout.write(JSON.stringify({ registration: 'exo_memory/loop/m2b_m3b_registration_2026-09-28.md (sha256 36b23de80f6c0291); scored radius 6 m', ...head, byRadius: Object.fromEntries(radii.map((r) => [r, score(c, read, { K: smoothK(c, r) })])) }, null, 1) + '\n');
}
module.exports = { roadTriangles, curvature, smoothK, score };
