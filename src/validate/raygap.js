// raygap.js: gaps in the PHYSICS road under the Mach 6's downforce ray (RED, reason 'downforce-ray-gap').
//
// WHY (R1, docs/research/04_ac_physics_drivability.md §4, SOURCED there from the installed car's
// mach6_active/data/script.lua:424-433): the car's downforce comes from ONE ray to the track, cast from 0.4 m above the
// car's origin and 1.0 m ahead of it, 1.0 m long, straight down the car's up axis. Suction is full when the road is
// within 0.5 m of the ray's start and gone at 0.9 m, and a MISS gives zero downforce (the miss value is inferred there
// from the code, not documented). So wherever the physics road has a gap the ray can fall into, the car loses ALL its
// downforce at once, not only the grip of a wheel. FINDINGS §5 already calls gaps or holes in the road mesh RED; this is
// the check that finds them in the mesh itself, at the ray's scale. (Validation's older 'gap-in-road' finds holes in the
// PATH, by station spacing; a hole narrower than a station step passes it.)
//
// THE CHECK, on the drivable physics meshes in WORLD space (the export's built scene: `1<KEY>…` meshes that are not WALL):
//   · vertices within 5 mm of each other are one vertex, and an edge used by ONE triangle is a boundary edge. The weld is
//     by DISTANCE, searching the neighbouring 5 mm buckets: a first form rounded each vertex to one bucket (as
//     tools/envelope.cjs does), and two part rows 1 mm apart that straddled a bucket boundary stayed unwelded and read
//     as a 0.1 m gap (test/doc-e2e.test.js's loop, at the in/body boundary of a bowl word);
//   · a boundary edge is a GAP when road starts again beyond it within the ray's reach: at probes 0.1, 0.25, 0.5 and
//     1.0 m (MACH6.downforceRay.aheadM) across the edge, in its triangle's plane, the car's OWN ray is cast: from upM
//     above the probe along the edge triangle's normal (the car's up there), lengthM long, downward; a hit on any other
//     road triangle is road beyond the gap. (A first form took "any triangle within 0.3 m that the probe lies over", and
//     it read the vertical zip triangles of a seam between two fonts, which stand in the cross-section plane, as road
//     0.1 m beyond a wall's end. A ray parallel to such a triangle never hits it, as the car's never would.)
//   · a triangle whose normal lies within 45° of the road's direction at its nearest station FACES ALONG the road (a
//     seam's zip fan between two fonts, standing in the cross-section plane): the car cannot ride it and its ray cannot
//     read it, so it is neither a gap's edge nor road beyond one. (Found on the first sample loop: the lap's closing seam
//     zips a bowl's walls down to a flat first word in that plane, and the fan's own rim read as 0.1 m gaps.)
//   · so the road's own outer edge, a jump's lip and its landing (no road within 1 m beyond them) are not gaps, and a
//     slit between two pieces, a missing triangle or a pit lane that stops short of the road are.
// Each gap is reported at the nearest path station: { s, u, widthM, at } (widthM: the first probe distance that found
// road, an upper bound on the gap's width at that edge; at: the edge's midpoint in world space).
//
// D446 (a track, TEST 10 banked, refused on export with two of these at s 2574 and 2928 of one piece): road beyond an edge
// counts only when it is the SAME PASS, the road resuming. There the probe past one edge of a banked piece that curls back on
// itself found the OTHER pass's lip, 355 m on along the lap and 0.64 m away, and read the space between the two edges as a slit.
// Nothing is lost under the car there: past either edge it is off the road whether or not the other pass is beside it. So a hit
// counts only when its triangle's nearest station lies within SAME_PASS_M of the edge's own station along the lap, or within the
// road's width there if that is more (twice the edge's distance from the centre line), measured round a closed lap (opts.lapM)
// so its seam is one pass. A slit, a missing triangle, a tear along the road and a pit lane short of the road all resume within a
// few metres of the edge's station; another pass of the lap is hundreds of metres on. A hit on another pass is not a gap: it is
// reported in opts.near (when given) as { s, u, otherS, edgeM }, edgeM the distance from the edge's midpoint to that pass's road,
// which validate() reports as information ('near-touch'), never red.
'use strict';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : a; };
const PROBES = [0.1, 0.25, 0.5];   // plus the ray's reach, from the car's limits
const FACING = Math.cos(45 * Math.PI / 180);
const SAME_PASS_M = 30;   // D446: road found past an edge is the same pass when its station is this close along the lap (or the road's width, if more)

/** The distance from point p to triangle (a, b, c): Ericson, Real-Time Collision Detection §5.1.5, the closest point by Voronoi region. */
function pointTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return len(ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return len(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return len(sub(p, add(a, ab, d1 / (d1 - d3))));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return len(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return len(sub(p, add(a, ac, d2 / (d2 - d6))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return len(sub(p, add(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)))));
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return len(sub(p, add(add(a, ab, v), ac, w)));
}

/**
 * rayGaps(meshes, stations, ray, opts): meshes = [{ positions (world, flat), indices }] of the drivable physics road;
 * stations = the path's samples ({ s, pos, L, T }); ray = MACH6.downforceRay; opts.lapM = a closed lap's length (s is then
 * measured round it), opts.near = an array that receives the edges whose probe met another pass (D446). Returns
 * [{ s, u, widthM, at }], one per gap edge, in s order.
 */
// D266 (the keeper's 6 × 1000 m tube crashed the page on Close): the same check in TYPED ARRAYS. The first form kept a JS array per vertex, per triangle and
// per normal, an object per edge and string keys for every bucket ("x,y,z", "a,b"): 1.47 GB of JavaScript heap on a 2.4-million-triangle tube, where a
// browser renderer holds every heap of the page and its workers in 4 GB (V8's shared pointer-compression cage). The vertices, triangles, normals, edges and
// both grids are now flat typed arrays (outside the V8 heap), the buckets hashed by their integer coordinates. NOTHING ELSE CHANGED: the same weld (the first
// vertex within WELD, searched in the same bucket order), the same edges in the order they were first met, the same triangles in each grid cell in the same
// order and the same arithmetic, so the answer is the first form's, gap for gap (test/validate_raygap_lean.test.js compares the two).

/** A hash of integer triples to dense indices 0, 1, 2, … in the order they are first added (open addressing, grows by doubling). */
function tripleIndex(cap) {
  let size = 1; while (size < cap * 2) size <<= 1;
  let slot = new Int32Array(size).fill(-1), kx = new Int32Array(cap), ky = new Int32Array(cap), kz = new Int32Array(cap), n = 0;
  const h = (x, y, z, mask) => ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) & mask;
  const grow = () => {
    const nk = (a) => { const b = new Int32Array(a.length * 2); b.set(a); return b; };
    kx = nk(kx); ky = nk(ky); kz = nk(kz); size <<= 1; slot = new Int32Array(size).fill(-1);
    for (let i = 0; i < n; i++) { let s = h(kx[i], ky[i], kz[i], size - 1); while (slot[s] >= 0) s = (s + 1) & (size - 1); slot[s] = i; }
  };
  return {
    /** The index of (x, y, z), or -1 when it was never added. */
    get(x, y, z) { let s = h(x, y, z, size - 1); for (;;) { const i = slot[s]; if (i < 0) return -1; if (kx[i] === x && ky[i] === y && kz[i] === z) return i; s = (s + 1) & (size - 1); } },
    /** The index of (x, y, z), added when new. */
    add(x, y, z) {
      let s = h(x, y, z, size - 1);
      for (;;) { const i = slot[s]; if (i < 0) break; if (kx[i] === x && ky[i] === y && kz[i] === z) return i; s = (s + 1) & (size - 1); }
      if (n >= kx.length || (n + 1) * 2 > size) { grow(); return this.add(x, y, z); }
      kx[n] = x; ky[n] = y; kz[n] = z; slot[s] = n; return n++;
    },
    get count() { return n; },
  };
}

function rayGaps(meshes, stations, ray, opts = {}) {
  const WELD = 0.005;
  const lapM = Number.isFinite(opts.lapM) && opts.lapM > 0 ? opts.lapM : null, near = Array.isArray(opts.near) ? opts.near : null;
  /** How far apart two stations are along the road: round a closed lap when its length is given. */
  const alongM = (a, b) => { const d = Math.abs(a - b); return lapM === null ? d : Math.min(d, Math.abs(lapM - (d % lapM))); };
  let nIdx = 0, nPos = 0; for (const m of meshes) { nIdx += m.indices.length; nPos += m.positions.length / 3; }
  // the weld: a vertex is the FIRST earlier vertex within WELD, searched bucket by bucket (i, j, k from −1 to 1) and in each bucket in the order added
  const P = new Float64Array(nPos * 3), buckets = tripleIndex(Math.max(16, nPos)), next = new Int32Array(nPos).fill(-1);
  let head = new Int32Array(Math.max(16, nPos)).fill(-1), tail = new Int32Array(head.length).fill(-1), nV = 0;
  const vid = (x, y, z) => {
    const bx = Math.floor(x / WELD), by = Math.floor(y / WELD), bz = Math.floor(z / WELD);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const b = buckets.get(bx + i, by + j, bz + k); if (b < 0) continue;
      for (let id = head[b]; id >= 0; id = next[id]) { if (Math.hypot(P[id * 3] - x, P[id * 3 + 1] - y, P[id * 3 + 2] - z) <= WELD) return id; }
    }
    const id = nV++; P[id * 3] = x; P[id * 3 + 1] = y; P[id * 3 + 2] = z;
    const b = buckets.add(bx, by, bz);
    if (b >= head.length) { const g = (a) => { const c = new Int32Array(a.length * 2).fill(-1); c.set(a); return c; }; head = g(head); tail = g(tail); }
    if (head[b] < 0) head[b] = id; else next[tail[b]] = id; tail[b] = id;
    return id;
  };
  const T = new Int32Array(nIdx - (nIdx % 3)); let nT = 0;
  for (const m of meshes) {
    const p = m.positions, idx = m.indices;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = vid(p[idx[t] * 3], p[idx[t] * 3 + 1], p[idx[t] * 3 + 2]), b = vid(p[idx[t + 1] * 3], p[idx[t + 1] * 3 + 1], p[idx[t + 1] * 3 + 2]), c = vid(p[idx[t + 2] * 3], p[idx[t + 2] * 3 + 1], p[idx[t + 2] * 3 + 2]);
      if (a === b || b === c || a === c) continue;   // degenerate after the weld
      T[nT * 3] = a; T[nT * 3 + 1] = b; T[nT * 3 + 2] = c; nT++;
    }
  }
  const pt = (id) => [P[id * 3], P[id * 3 + 1], P[id * 3 + 2]];
  // the edges, in the order they are first met (each triangle's (0,1), (1,2), (2,0)), keyed by their lower vertex: { a, b } as first met, its triangle, its use count
  const deg = new Int32Array(nV + 1);
  for (let i = 0; i < nT * 3; i++) { const a = T[i], b = T[i % 3 === 2 ? i - 2 : i + 1]; deg[Math.min(a, b) + 1]++; }
  for (let v = 0; v < nV; v++) deg[v + 1] += deg[v];
  const fill = new Int32Array(nV), slotHi = new Int32Array(nT * 3), slotE = new Int32Array(nT * 3);
  const EA = new Int32Array(nT * 3), EB = new Int32Array(nT * 3), ET = new Int32Array(nT * 3), EN = new Int32Array(nT * 3); let nE = 0;
  for (let i = 0; i < nT; i++) for (let k = 0; k < 3; k++) {
    const a = T[i * 3 + k], b = T[i * 3 + (k + 1) % 3], lo = a < b ? a : b, hi = a < b ? b : a, s0 = deg[lo];
    let e = -1; for (let s = s0; s < s0 + fill[lo]; s++) if (slotHi[s] === hi) { e = slotE[s]; break; }
    if (e >= 0) { EN[e]++; continue; }
    e = nE++; EA[e] = a; EB[e] = b; ET[e] = i; EN[e] = 1; slotHi[s0 + fill[lo]] = hi; slotE[s0 + fill[lo]] = e; fill[lo]++;
  }
  // a grid of triangles, for the probes: each 2 m cell's triangles in triangle order
  const CS = 2, N = new Float64Array(nT * 3);
  for (let i = 0; i < nT; i++) {
    const n = unit(cross(sub(pt(T[i * 3 + 1]), pt(T[i * 3])), sub(pt(T[i * 3 + 2]), pt(T[i * 3]))));
    N[i * 3] = n[0]; N[i * 3 + 1] = n[1]; N[i * 3 + 2] = n[2];
  }
  const cellIx = tripleIndex(Math.max(16, nT)), lohi = new Int32Array(nT * 6);
  let cnt = new Int32Array(Math.max(16, nT)), pairs = 0;
  for (let i = 0; i < nT; i++) {
    for (let k = 0; k < 3; k++) {
      const c0 = P[T[i * 3] * 3 + k], c1 = P[T[i * 3 + 1] * 3 + k], c2 = P[T[i * 3 + 2] * 3 + k];
      lohi[i * 6 + k] = Math.floor(Math.min(c0, c1, c2) / CS); lohi[i * 6 + 3 + k] = Math.floor(Math.max(c0, c1, c2) / CS);
    }
    for (let x = lohi[i * 6]; x <= lohi[i * 6 + 3]; x++) for (let y = lohi[i * 6 + 1]; y <= lohi[i * 6 + 4]; y++) for (let z = lohi[i * 6 + 2]; z <= lohi[i * 6 + 5]; z++) {
      const c = cellIx.add(x, y, z); if (c >= cnt.length) { const b = new Int32Array(cnt.length * 2); b.set(cnt); cnt = b; } cnt[c]++; pairs++;
    }
  }
  const nC = cellIx.count, start = new Int32Array(nC + 1); for (let c = 0; c < nC; c++) start[c + 1] = start[c] + cnt[c];
  const at = new Int32Array(nC), cellTri = new Int32Array(pairs);
  for (let i = 0; i < nT; i++) {
    for (let x = lohi[i * 6]; x <= lohi[i * 6 + 3]; x++) for (let y = lohi[i * 6 + 1]; y <= lohi[i * 6 + 4]; y++) for (let z = lohi[i * 6 + 2]; z <= lohi[i * 6 + 5]; z++) {
      const c = cellIx.get(x, y, z); cellTri[start[c] + at[c]++] = i;
    }
  }
  /**
   * Does the car's ray at q (cast from upM above q along up, lengthM downward) hit a road triangle other than skip, ON THE SAME PASS as station st (D446:
   * within `bound` of it along the lap)? A hit on another pass does not count; the first is kept in `other` for the near-touch.
   */
  let other = null;
  const passOf = new Map();   // a hit triangle's nearest station, by its centroid, met once each
  const samePass = (i, st, bound) => {
    let k = passOf.get(i);
    if (k === undefined) { const a = pt(T[i * 3]), b = pt(T[i * 3 + 1]), c = pt(T[i * 3 + 2]); k = nearest([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]); passOf.set(i, k); }
    return k < 0 || alongM(stations[k].s, st.s) <= bound;   // no station near it: counted, as before
  };
  const overRoad = (q, up, skip, along, st, bound) => {
    const o = add(q, up, ray.upM), d = up.map((x) => -x), L = ray.lengthM, seen = new Set();
    for (let k = 0; k <= Math.ceil(L / CS) + 1; k++) {
      const c0 = add(o, d, Math.min(L, k * CS)).map((v) => Math.floor(v / CS));
      for (let x = c0[0] - 1; x <= c0[0] + 1; x++) for (let y = c0[1] - 1; y <= c0[1] + 1; y++) for (let z = c0[2] - 1; z <= c0[2] + 1; z++) {
        const c = cellIx.get(x, y, z); if (c < 0) continue;
        for (let r = start[c]; r < start[c + 1]; r++) {
          const i = cellTri[r];
          if (i === skip || seen.has(i)) continue; seen.add(i);
          if (Math.abs(dot([N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], along)) > FACING) continue;   // faces along the road: not a surface the ray reads
          const P0 = pt(T[i * 3]), e1 = sub(pt(T[i * 3 + 1]), P0), e2 = sub(pt(T[i * 3 + 2]), P0), pv = cross(d, e2), det = dot(e1, pv);
          if (Math.abs(det) < 1e-12) continue;   // the ray runs along the triangle: no hit
          const inv = 1 / det, tv = sub(o, P0), u = dot(tv, pv) * inv; if (u < 0 || u > 1) continue;
          const qv = cross(tv, e1), v = dot(d, qv) * inv; if (v < 0 || u + v > 1) continue;
          const h = dot(e2, qv) * inv; if (!(h > 0 && h <= L)) continue;
          if (samePass(i, st, bound)) return true;
          if (!other) other = i;   // another pass of the lap: not road beyond a gap (D446)
        }
      }
    }
    return false;
  };
  /** D446: the least distance from point m to the road of ANOTHER pass than station st's, over the grid cells within one cell of m (the closest approach, edge to that road). */
  const closestOther = (m, st, bound) => {
    const c0 = m.map((v) => Math.floor(v / CS)); let best = Infinity;
    for (let x = c0[0] - 1; x <= c0[0] + 1; x++) for (let y = c0[1] - 1; y <= c0[1] + 1; y++) for (let z = c0[2] - 1; z <= c0[2] + 1; z++) {
      const c = cellIx.get(x, y, z); if (c < 0) continue;
      for (let r = start[c]; r < start[c + 1]; r++) { const i = cellTri[r]; if (samePass(i, st, bound)) continue; const d = pointTriangle(m, pt(T[i * 3]), pt(T[i * 3 + 1]), pt(T[i * 3 + 2])); if (d < best) best = d; }
    }
    return best;
  };
  const reach = [...PROBES, ray.aheadM];
  // the nearest station, by a coarse grid on the stations
  const SC = 20, sg = new Map(); stations.forEach((st, i) => { const k = `${Math.floor(st.pos[0] / SC)},${Math.floor(st.pos[2] / SC)}`; let c = sg.get(k); if (!c) sg.set(k, c = []); c.push(i); });
  const nearest = (q) => { let best = -1, bd = Infinity; const cx = Math.floor(q[0] / SC), cz = Math.floor(q[2] / SC);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const i of sg.get(`${cx + dx},${cz + dz}`) || []) { const d = len(sub(stations[i].pos, q)); if (d < bd) { bd = d; best = i; } }
    return best; };
  const out = [];
  for (let e = 0; e < nE; e++) {
    if (EN[e] !== 1) continue;
    const ti = ET[e], ea = EA[e], eb = EB[e], A = pt(ea), B = pt(eb), mid = add(A, sub(B, A), 0.5);
    let cv = T[ti * 3]; if (cv === ea || cv === eb) { cv = T[ti * 3 + 1]; if (cv === ea || cv === eb) cv = T[ti * 3 + 2]; }
    const C = pt(cv), Ne = [N[ti * 3], N[ti * 3 + 1], N[ti * 3 + 2]];
    const i = nearest(mid), st = i >= 0 ? stations[i] : null;
    if (!st || Math.abs(dot(Ne, st.T)) > FACING) continue;   // not a surface the car rides (see above)
    let across = unit(cross(Ne, sub(B, A))); if (dot(sub(C, mid), across) > 0) across = across.map((x) => -x);   // away from its own triangle
    const u = dot(sub(mid, st.pos), st.L), bound = Math.max(SAME_PASS_M, 2 * Math.abs(u));
    other = null;
    const w = reach.find((d) => overRoad(add(mid, across, d), Ne, ti, st.T, st, bound));
    if (w === undefined) {
      if (near && other !== null) near.push({ s: st.s, u, otherS: stations[passOf.get(other)].s, edgeM: closestOther(mid, st, bound) });
      continue;
    }
    out.push({ s: st.s, u, widthM: w, at: mid });
  }
  return out.sort((a, b) => a.s - b.s);
}

module.exports = { rayGaps, PROBES, SAME_PASS_M };
