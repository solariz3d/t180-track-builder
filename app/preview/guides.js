// guides.js: the 3D GRID and the SYMMETRY GUIDES of the preview (D237, the keeper: "a 3D grid to some how see the track and make it all symmetrical if you need it to be ...
// It will be a 2D Grid if the track has no height, but as soon as the track turns up or downward the grid becomes 3D."). Pure numbers, no GL, no DOM: the preview draws what
// guidePlan returns. PREVIEW ONLY: nothing here reads or writes the document, src/ or the export; a mirror ghost is a picture of the centreline reflected, not an edit.
//
//   guidePlan({ bounds, path, mode, mirror, centre })  ->  null | { mode, flat, base, top, ... }       see below
//   MODES = auto | ground | 3d | off      auto: the ground grid while the track is flat (its CENTRELINE spans under FLAT_M metres of height), the 3D lattice once it is not
//   MIRRORS = off | x | z | both          x: left/right (x flips about the centre), z: front/back (z flips), both: point symmetry (a half turn about the vertical through the centre)
//   projectPoint(pose, aspect, p)         a world point on screen: { nx, ny, w } (NDC, w > 0 in front of the camera) or null
//   rayAt(pose, aspect, nx, ny), planeHit(ray, y)    the world ray through an NDC point, and where it meets the plane at height y (the centre handle's drag)
//
// THE LATTICE (3D mode), over the track's box: the ground grid at the track's LOWEST point (the same lines look.js gridLines draws at y = 0), a vertical at every lattice corner
// rising to the top level, a faint rectangle at every height level up the box, a label at a few levels ("+20 m": world height), and drop lines from the centreline down to the
// base every so often. EVERY COUNT IS BOUNDED, so a 14 km track stays under about a thousand line pairs: the lattice spacing is the ground spacing times 1, 2, 5, 10 ... until at most
// MAX_CORNERS corners; the levels are a 1-2-5 spacing with at most MAX_LEVELS of them; the drop lines at most MAX_DROPS.
// THE SYMMETRY GUIDES: the centre (the box's middle unless set), the two centre axes on the base plane drawn as three strokes (bold) and the vertical through the crossing, a dashed
// mirror ghost of the centreline, and the GAP: for each point of the mirrored centreline the distance (3D, metres) to the nearest point of the real centreline, as the largest and the
// mean. A symmetric track reads about 0 about its own centre; the numbers are what "make it symmetrical" drives to zero.
'use strict';

const M = require('../camera/math.js');
const { gridExtent, gridLines } = require('./look.js');

const MODES = Object.freeze(['auto', 'ground', '3d', 'off']);
const MIRRORS = Object.freeze(['off', 'x', 'z', 'both']);
const FLAT_M = 0.5, MAX_CORNERS = 400, MAX_LEVELS = 12, MAX_LABELS = 6, MAX_DROPS = 150, MIRROR_DRAW = 900, GAP_QUERIES = 4000, MAX_DASHES = 300;   // MAX_DASHES: on and off together, so at most 150 dashes, cut at the (at most MIRROR_DRAW) ghost vertices they cross
const COLOURS = Object.freeze({ ground: [0.36, 0.44, 0.56], lattice: [0.36, 0.46, 0.62], level: [0.42, 0.52, 0.68], drop: [0.5, 0.6, 0.74], axis: [1.0, 0.82, 0.25], mirror: [0.92, 0.45, 0.95] });
const ALPHAS = Object.freeze({ ground: 0.5, lattice: 0.22, level: 0.4, drop: 0.3, axis: 0.95, mirror: 0.9 });

/** The smallest 1, 2, 5 × 10^k at least v. */
function niceAtLeast(v) {
  const e = Math.floor(Math.log10(Math.max(v, 1e-9)));
  for (const m of [1, 2, 5, 10]) { const x = m * 10 ** e; if (x >= v - 1e-9) return x; }
  return 10 ** (e + 1);
}

/** The centreline's lowest and highest point (m) and the span; with no path, the box's own. */
function heightRange(path, bounds) {
  let lo = Infinity, hi = -Infinity;
  if (path && Array.isArray(path.samples)) for (const s of path.samples) { const y = s.pos[1]; if (y < lo) lo = y; if (y > hi) hi = y; }
  if (lo === Infinity && bounds) { lo = bounds.min[1]; hi = bounds.max[1]; }
  return { lo, hi, range: hi - lo };
}
/** What is drawn for a mode: auto is the ground grid while the centreline is flat, the lattice once it has height. */
function effectiveMode(mode, range) {
  if (mode === 'off' || mode === 'ground' || mode === '3d') return mode;
  return range < FLAT_M ? 'ground' : '3d';
}

const fmtLevel = (y) => { const r = Math.round(y * 10) / 10, a = Math.abs(r); return r === 0 ? '0 m' : `${r < 0 ? '−' : '+'}${Number.isInteger(a) ? a : a.toFixed(1)} m`; };
const strokes = (a, b, w, axis) => {   // three parallel strokes: a bold line (lines are one pixel wide in WebGL)
  const out = [];
  for (const k of [-1, 0, 1]) { const o = k * w; out.push(a[0] + (axis === 'x' ? 0 : o), a[1] + (axis === 'y' ? o : 0), a[2] + (axis === 'x' ? o : 0), b[0] + (axis === 'x' ? 0 : o), b[1] + (axis === 'y' ? o : 0), b[2] + (axis === 'x' ? o : 0)); }
  return out;
};

/** The centreline's points: [[x, y, z]]; a closed path closes (its last point joins its first). */
function pointsOf(path) { return path && Array.isArray(path.samples) ? path.samples.map((s) => s.pos.slice()) : []; }
/** The mirror of a point about centre { x, z }: x flips (left/right), z flips (front/back), both = the half turn. Height never changes. */
function mirrorPoint(p, c, kind) { return [kind === 'z' ? p[0] : 2 * c.x - p[0], p[1], kind === 'x' ? p[2] : 2 * c.z - p[2]]; }

/** The dashed polyline of `pts` (pairs): `dash` m on, `dash` m off, the phase running on along the line. */
function dashed(pts, dash) {
  const out = []; let phase = 0;   // distance along, in dash units: even = on
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); if (!(L > 0)) continue;
    let d = 0;
    while (d < L - 1e-9) {
      const k = Math.floor(phase / dash + 1e-9);   // the dash we are in (a phase a hair under a boundary counts as past it, so a step never shrinks to nothing)
      const room = (k + 1) * dash - phase, step = Math.min(room > 1e-9 ? room : dash, L - d), on = k % 2 === 0;
      if (on) { const t0 = d / L, t1 = (d + step) / L; out.push(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1); }
      d += step; phase += step;
    }
  }
  return out;
}

/**
 * THE REAL CENTRELINE IN A BOUNDING-BOX TREE, for the mirror gap's nearest-point search (D237b, B's finding: the grid of cells it replaces searched twelve rings and then measured
 * against EVERY segment, 95 to 230 ms per rebuild on an ordinary asymmetric track and over half a second on 7,000 points, on every brush step). A median-split tree over the
 * segments' 3D boxes: a query walks the nearer child first and drops any box farther than the best found, so it is exact (the same nearest distance as measuring against every
 * segment) and costs a few dozen box tests whether the mirrored point is on the track or kilometres from it. It depends on the path alone, not on the centre or the mirror, so it is
 * built once per path (a centre drag, or a change of mirror, reuses it). `stats` counts what was built and tested, for the tests.
 */
const LEAF = 6, indexMemo = new WeakMap(), stats = { indexBuilds: 0, segmentTests: 0 };
const segDist2 = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], wx = p[0] - a[0], wy = p[1] - a[1], wz = p[2] - a[2], dd = dx * dx + dy * dy + dz * dz;
  const t = dd > 0 ? Math.max(0, Math.min(1, (wx * dx + wy * dy + wz * dz) / dd)) : 0, ex = wx - dx * t, ey = wy - dy * t, ez = wz - dz * t;
  return ex * ex + ey * ey + ez * ez;
};
function buildTree(items, i0, i1) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = i0; i < i1; i++) for (let d = 0; d < 3; d++) { if (items[i].lo[d] < lo[d]) lo[d] = items[i].lo[d]; if (items[i].hi[d] > hi[d]) hi[d] = items[i].hi[d]; }
  if (i1 - i0 <= LEAF) return { lo, hi, items: items.slice(i0, i1) };
  let axis = 0, span = -1; for (let d = 0; d < 3; d++) { let cl = Infinity, ch = -Infinity; for (let i = i0; i < i1; i++) { cl = Math.min(cl, items[i].c[d]); ch = Math.max(ch, items[i].c[d]); } if (ch - cl > span) { span = ch - cl; axis = d; } }
  const part = items.slice(i0, i1).sort((p, q) => p.c[axis] - q.c[axis]); for (let i = 0; i < part.length; i++) items[i0 + i] = part[i];
  const mid = (i0 + i1) >> 1; return { lo, hi, l: buildTree(items, i0, mid), r: buildTree(items, mid, i1) };
}
/** The centreline's points and its segment tree, memoised per path object (a closed path's closing edge is a segment too). */
function indexFor(path) {
  let ix = indexMemo.get(path); if (ix) return ix;
  const pts = pointsOf(path); ix = buildIndex(pts, !!(path && path.closed)); indexMemo.set(path, ix); return ix;
}
function buildIndex(pts, closed) {
  stats.indexBuilds++;
  const segs = []; for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]); if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  const items = segs.map((s) => ({ s, lo: [0, 1, 2].map((d) => Math.min(s[0][d], s[1][d])), hi: [0, 1, 2].map((d) => Math.max(s[0][d], s[1][d])), c: [0, 1, 2].map((d) => (s[0][d] + s[1][d]) / 2) }));
  return { pts, closed, segs, root: items.length ? buildTree(items, 0, items.length) : null };
}
/** The distance (m) from p to the nearest point of the indexed centreline: exact. */
function nearestDist(ix, p) {
  let best = Infinity;
  const box2 = (n) => { const dx = Math.max(n.lo[0] - p[0], 0, p[0] - n.hi[0]), dy = Math.max(n.lo[1] - p[1], 0, p[1] - n.hi[1]), dz = Math.max(n.lo[2] - p[2], 0, p[2] - n.hi[2]); return dx * dx + dy * dy + dz * dz; };
  const walk = (n) => {
    if (box2(n) >= best) return;
    if (n.items) { for (const it of n.items) { stats.segmentTests++; const d = segDist2(p, it.s[0], it.s[1]); if (d < best) best = d; } return; }
    const dl = box2(n.l), dr = box2(n.r); if (dl <= dr) { walk(n.l); walk(n.r); } else { walk(n.r); walk(n.l); }
  };
  if (ix.root) walk(ix.root); return Math.sqrt(best);
}

/**
 * The gap between a track and its mirror: for each point of the mirrored centreline, the distance (3D) to the nearest point of the real centreline (its segments, not only its
 * samples, so a symmetric track reads 0 to the chord error). { max, mean, n, tests } over the points asked (every k-th when there are more than GAP_QUERIES); `tests` is how
 * many segment distances it took. `index` (indexFor) may be passed so a caller that has it builds nothing.
 */
function mirrorGap(pts, closed, centre, kind, index = null) {
  if (pts.length < 2) return null;
  const ix = index || buildIndex(pts, closed), t0 = stats.segmentTests, stride = Math.max(1, Math.ceil(pts.length / GAP_QUERIES)); let max = 0, sum = 0, n = 0;
  for (let i = 0; i < pts.length; i += stride) { const g = nearestDist(ix, mirrorPoint(pts[i], centre, kind)); if (g > max) max = g; sum += g; n++; }
  return n ? { max, mean: sum / n, n, tests: stats.segmentTests - t0 } : null;
}

/**
 * Everything the preview draws for the grid and the guides, or null when there is nothing to draw (no track, or grid off and no mirror).
 * Returns { mode (what is drawn: ground | 3d | off), requested, flat, range, base, top, spacing, levels, lines (the line pairs in all), centre { x, z, set },
 * ground: [{ positions, colour, alpha }], depth: [{ positions, colour, alpha }] (drawn with the depth test: the grid, the lattice, the axes),
 * over: [{ positions, colour, alpha }] (drawn over the track: the mirror ghost), labels: [{ pos, text }], gap: { kind, max, mean, n } | null }.
 */
function guidePlan({ bounds, path = null, mode = 'auto', mirror = 'off', centre = null }) {
  if (!bounds) return null;
  if (!MODES.includes(mode)) throw new Error(`guides: unknown grid mode ${mode}`);
  if (!MIRRORS.includes(mirror)) throw new Error(`guides: unknown mirror ${mirror}`);
  const hr = heightRange(path, bounds), eff = effectiveMode(mode, hr.range);
  if (eff === 'off' && mirror === 'off') return null;
  const ext = gridExtent(bounds), base = bounds.min[1];
  const plan = { mode: eff, requested: mode, flat: hr.range < FLAT_M, range: hr.range, base, top: bounds.max[1], spacing: ext.sp, levels: [], lines: 0, ground: [], depth: [], over: [], labels: [], gap: null, centre: null, extent: ext };
  const add = (list, positions, kind) => { if (positions.length) { list.push({ positions: Float32Array.from(positions), colour: COLOURS[kind], alpha: ALPHAS[kind], kind }); plan.lines += positions.length / 6; } };

  if (eff !== 'off') {
    add(plan.depth, gridLines(bounds, base, ext).positions, 'ground');   // the ground grid, at the lowest point
    if (eff === '3d') {
      // the lattice spacing: the ground spacing times 1, 2, 5, 10, ... until the corners are few enough; its lines lie on the ground grid's
      const corners = (sp) => (Math.floor((ext.x1 - ext.x0) / sp + 1e-9) + 1) * (Math.floor((ext.z1 - ext.z0) / sp + 1e-9) + 1);
      const mult = (k) => [1, 2, 5][k % 3] * 10 ** Math.floor(k / 3); let k = 0; while (corners(ext.sp * mult(k)) > MAX_CORNERS) k++;
      const lsp = ext.sp * mult(k); plan.latticeSpacing = lsp;
      const ls = niceAtLeast(Math.max(1, (bounds.max[1] - base) / MAX_LEVELS));      // the level spacing (m): 1, 2, 5, 10 ...
      const first = Math.floor(base / ls + 1e-9) + 1, lastK = Math.max(first, Math.ceil(bounds.max[1] / ls - 1e-9)), levels = []; for (let k = first; k <= lastK; k++) levels.push(k * ls);
      plan.levels = levels; plan.levelSpacing = ls; const topY = levels.length ? levels[levels.length - 1] : base + ls; plan.top = Math.max(plan.top, topY);
      const v = [], xs = [], zs = [];
      for (let x = Math.ceil(ext.x0 / lsp - 1e-9) * lsp; x <= ext.x1 + 1e-9; x += lsp) xs.push(x);
      for (let z = Math.ceil(ext.z0 / lsp - 1e-9) * lsp; z <= ext.z1 + 1e-9; z += lsp) zs.push(z);
      const at = new Set(); const post = (x, z) => { const id = `${x}|${z}`; if (!at.has(id)) { at.add(id); v.push(x, base, z, x, topY, z); } };
      for (const x of xs) for (const z of zs) post(x, z);
      for (const x of [ext.x0, ext.x1]) for (const z of [ext.z0, ext.z1]) post(x, z);   // the four corners of the box, so it reads as a box
      add(plan.depth, v, 'lattice');
      const r = []; for (const y of levels) r.push(ext.x0, y, ext.z0, ext.x1, y, ext.z0, ext.x1, y, ext.z0, ext.x1, y, ext.z1, ext.x1, y, ext.z1, ext.x0, y, ext.z1, ext.x0, y, ext.z1, ext.x0, y, ext.z0);
      add(plan.depth, r, 'level');
      const every = Math.max(1, Math.ceil(levels.length / MAX_LABELS)); levels.forEach((y, i) => { if (i % every === every - 1 || i === levels.length - 1) plan.labels.push({ pos: [ext.x0, y, ext.z0], text: fmtLevel(y) }); });
      // drop lines: from the centreline down to the base every so often, only where it is off the base
      const pts = pointsOf(path), stride = Math.max(1, Math.ceil(pts.length / MAX_DROPS)), d = [];
      for (let i = 0; i < pts.length; i += stride) if (pts[i][1] - base > FLAT_M) d.push(pts[i][0], pts[i][1], pts[i][2], pts[i][0], base, pts[i][2]);
      add(plan.depth, d, 'drop');
    }
  }
  if (mirror !== 'off') {
    const c = centre && Number.isFinite(centre.x) && Number.isFinite(centre.z) ? { x: centre.x, z: centre.z, set: true } : { x: (bounds.min[0] + bounds.max[0]) / 2, z: (bounds.min[2] + bounds.max[2]) / 2, set: false };
    plan.centre = c;
    const w = Math.max(0.05, 0.0015 * Math.max(ext.x1 - ext.x0, ext.z1 - ext.z0)), topY = Math.max(plan.top, base + 10);
    add(plan.depth, strokes([ext.x0, base, c.z], [ext.x1, base, c.z], w, 'x'), 'axis');
    add(plan.depth, strokes([c.x, base, ext.z0], [c.x, base, ext.z1], w, 'z'), 'axis');
    add(plan.depth, strokes([c.x, base, c.z], [c.x, topY, c.z], w, 'z'), 'axis');
    const pts = pointsOf(path), closed = !!(path && path.closed);
    if (pts.length > 1) {
      const stride = Math.max(1, Math.ceil(pts.length / MIRROR_DRAW)), ghost = []; for (let i = 0; i < pts.length; i += stride) ghost.push(mirrorPoint(pts[i], c, mirror));
      if (stride > 1) ghost.push(mirrorPoint(pts[pts.length - 1], c, mirror)); if (closed) ghost.push(ghost[0]);
      let gl = 0; for (let i = 0; i + 1 < ghost.length; i++) gl += Math.hypot(ghost[i + 1][0] - ghost[i][0], ghost[i + 1][1] - ghost[i][1], ghost[i + 1][2] - ghost[i][2]);
      add(plan.over, dashed(ghost, Math.max(Math.min(40, Math.max(2, Math.max(ext.x1 - ext.x0, ext.z1 - ext.z0) / 150)), gl / MAX_DASHES)), 'mirror');   // the dash grows with the ghost's length, so its pieces stay bounded (D237b)
      const g = mirrorGap(pts, closed, c, mirror, indexFor(path)); plan.gap = g ? { kind: mirror, ...g } : null;
    }
  }
  return plan;
}

// ── the camera's view of a point and of a pointer: for the level labels and the draggable centre ────────────────────────────────────────────────────────────────────────────────
/** A world point on screen: { nx, ny, w } in NDC (x right, y up), w > 0 when it is in front of the camera, or null when it is behind it. */
function projectPoint(pose, aspect, p) {
  const c = M.apply(M.viewProj(pose, aspect), p); if (!(c[3] > 0)) return null;
  return { nx: c[0] / c[3], ny: c[1] / c[3], w: c[3] };
}
/** The world ray through an NDC point of the view: { o, d } (d unit). The camera is lookAt(eye, target, up) with a VERTICAL field of view pose.fov. */
function rayAt(pose, aspect, nx, ny) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = norm(sub(pose.target, pose.eye)), r = norm(cross(f, pose.up)), u = cross(r, f), t = Math.tan(pose.fov / 2);
  return { o: pose.eye.slice(), d: norm([f[0] + r[0] * nx * t * aspect + u[0] * ny * t, f[1] + r[1] * nx * t * aspect + u[1] * ny * t, f[2] + r[2] * nx * t * aspect + u[2] * ny * t]) };
}
/** Where a ray meets the horizontal plane at height y: [x, y, z], or null (parallel, or behind the origin). */
function planeHit(ray, y) {
  if (Math.abs(ray.d[1]) < 1e-9) return null;
  const t = (y - ray.o[1]) / ray.d[1]; if (!(t > 0)) return null;
  return [ray.o[0] + ray.d[0] * t, y, ray.o[2] + ray.d[2] * t];
}

module.exports = { guidePlan, heightRange, effectiveMode, mirrorGap, indexFor, buildIndex, nearestDist, stats, mirrorPoint, dashed, projectPoint, rayAt, planeHit, niceAtLeast, fmtLevel, MODES, MIRRORS, FLAT_M, MAX_CORNERS, MAX_LEVELS, MAX_LABELS, MAX_DROPS, COLOURS, ALPHAS };
