// bvh.js: the whole-surface checks that no single piece can see (docs/ARCHITECTURE.md §3 `:58`, §4 `:84-85`).
//
//   selfCheck(mesh, { closed, lengthM, minSeparationM = 25, stackedM = 2 })
//     -> { intersections: [{ s, u, cell, other, sOther, uOther, pairs }],
//          stacked:       [{ s, u, cell, other, sOther, gap, vertices }],
//          stats: { triangles, vertices, nodes, triTests, rayTests } }
//   `trace: {}` fills trace.pairs (every meeting triangle pair [t, o], t < o) and trace.stacked (vertex → gap), for tests.
//
// It reads the FINISHED mesh: every exported triangle, in world coordinates, rebuilt from the float32 arrays the kn5
// gets (local × node matrix), so it checks what AC would load, not the f64 path.
//
// SAME PASS. Triangles closer than `minSeparationM` along s are one pass of the road and are never tested against each
// other: neighbouring cells share edges, and folding within one pass is the fold check's job (§3 `:57`). 25 m is the
// validator's default (src/validate/index.js `stacked`, inferred there: "well beyond any cross-section and any radius a
// T-180 drives"). On a closed loop the gap is measured both ways round.
//
// SELF-INTERSECTION (§3 `:58`, red §4 `:84`): any two triangles of different passes that meet. Non-coplanar triangles
// meet iff an edge of one crosses the other (each end of their common segment lies on an edge of one of them).
// Coplanar triangles (every vertex within `EPS_PLANE` of the other's plane: two roads crossing at one height ARE
// coplanar) are tested in 2D: an edge pair crosses, or a vertex lies inside the other triangle. Touching counts.
//
// STACKED (§4 `:85`, "drivable surfaces stacked within about 2 m"): from every surface vertex, a segment along its
// normal to `stackedM` on both sides; a triangle of another pass crossing it is a stack, with gap = the distance along
// the normal. Every road mesh is drivable (walls are road, §4 `:86`). Sampled at the vertices, so between vertices
// (at most `maxAcross` = 1 m across and `maxStep` = 4 m along, mesh.js) a stack narrower than that could be missed.
//
// The BVH: a binary tree of triangle bounding boxes, split at the median centroid of the longest axis, 4 per leaf.
// Findings are grouped per pair of cells (a crossing is hundreds of triangle pairs); each group keeps its lowest-s hit.
// Cells are identified by their POSITION in the mesh, never by name (names are for people and may repeat).
'use strict';

const EPS_PLANE = 1e-4;   // m: float32 vertices of a 100 m cell are good to ~1e-5 m, so 1e-4 is "the same plane"
const EPS_BARY = 1e-9;

// ── the triangle soup ──
function soup(mesh) {
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
  // Each scene node is paired with its cell record BY POSITION (mesh.js assemble pushes them in the same order), never
  // by name: two pieces may share a name (a word's parts did, before names carried the part), and a lookup by name then
  // gives a triangle ANOTHER piece's s, which makes neighbours in one pass look far apart and "meet" (D170 addendum).
  const kids = mesh.scene.root.children;
  if (kids.length !== mesh.cells.length) throw new Error(`selfCheck: ${kids.length} scene nodes but ${mesh.cells.length} cell records`);
  for (let k = 0; k < kids.length; k++) {
    const node = kids[k], m = node.children[0], M = node.matrix, rec = mesh.cells[k];
    if (rec.name !== m.name) throw new Error(`selfCheck: scene node ${k} is ${m.name} but its cell record is ${rec.name}`);
    const pc = st.pieces[rec.piece];
    if (rec.seam) {
      const g = rec.piece, sm = st.seams[g], A = st.pieces[g > 0 ? g - 1 : st.pieces.length - 1], Ka = A.K;   // on a closed loop seam 0 joins the last piece
      add(m, M, () => sm.s, (i) => (i < Ka ? A.Us[i] : pc.Us[i - Ka]), m.name);
    } else {
      const c = pc.cells[Number(m.name.slice(m.name.lastIndexOf('_') + 1))], K = pc.K;
      add(m, M, (i) => c.rowS[Math.floor(i / K)], (i) => pc.Us[i % K], m.name);
    }
  }
  return { pos: Float64Array.from(pos), nrm: Float64Array.from(nrm), s: Float64Array.from(sv), u: Float64Array.from(uv), vCell, tris: Uint32Array.from(tris), triCell, cells };
}

// ── the BVH ──
function build(S) {
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
const overlaps = (n, lo, hi) => n.lo[0] <= hi[0] && n.hi[0] >= lo[0] && n.lo[1] <= hi[1] && n.hi[1] >= lo[1] && n.lo[2] <= hi[2] && n.hi[2] >= lo[2];
/** Every triangle whose box meets [lo, hi]. */
function query(B, lo, hi, visit) {
  if (!B.T) return;
  const stack = [0];
  while (stack.length) {
    const n = B.nodes[stack.pop()];
    if (!overlaps(n, lo, hi)) continue;
    if (n.left < 0) { for (let k = n.from; k < n.to; k++) visit(B.order[k]); } else { stack.push(n.left, n.right); }
  }
}

// ── geometry ──
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const P = (S, i) => [S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]];
/** Is point x (on the triangle's plane) inside triangle abc, edges included? Barycentric, relative tolerance. */
function inside(x, a, b, c) {
  const v0 = sub(c, a), v1 = sub(b, a), v2 = sub(x, a);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d02 = dot(v0, v2), d11 = dot(v1, v1), d12 = dot(v1, v2), den = d00 * d11 - d01 * d01;
  if (!(den > 0)) return false;
  const u = (d11 * d02 - d01 * d12) / den, v = (d00 * d12 - d01 * d02) / den;
  return u >= -EPS_BARY && v >= -EPS_BARY && u + v <= 1 + EPS_BARY;
}
/** Where segment pq crosses the plane of abc inside the triangle: the parameter t in [0, 1], or null. */
function segTri(p, q, a, b, c) {
  const n = cross(sub(b, a), sub(c, a)), nn = Math.sqrt(dot(n, n)); if (!(nn > 0)) return null;
  const dp = dot(sub(p, a), n) / nn, dq = dot(sub(q, a), n) / nn;
  if ((dp > EPS_PLANE && dq > EPS_PLANE) || (dp < -EPS_PLANE && dq < -EPS_PLANE)) return null;
  if (Math.abs(dp - dq) < 1e-15) return null;                 // lies in the plane: the coplanar test handles it
  const t = Math.max(0, Math.min(1, dp / (dp - dq))), x = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  return inside(x, a, b, c) ? t : null;
}
function seg2(a, b, c, d) {                                     // do 2D segments ab and cd meet (touching included)?
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d), e = 1e-12;
  if (((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) return true;
  const on = (p, q, r) => Math.min(p[0], q[0]) - e <= r[0] && r[0] <= Math.max(p[0], q[0]) + e && Math.min(p[1], q[1]) - e <= r[1] && r[1] <= Math.max(p[1], q[1]) + e;
  return (Math.abs(d1) <= e && on(c, d, a)) || (Math.abs(d2) <= e && on(c, d, b)) || (Math.abs(d3) <= e && on(a, b, c)) || (Math.abs(d4) <= e && on(a, b, d));
}
/** Do triangles T1 = (a, b, c) and T2 = (d, e, f) meet? */
function triTri(a, b, c, d, e, f) {
  const n2 = cross(sub(e, d), sub(f, d)), m2 = Math.sqrt(dot(n2, n2)), n1 = cross(sub(b, a), sub(c, a)), m1 = Math.sqrt(dot(n1, n1));
  if (!(m1 > 0) || !(m2 > 0)) return false;
  const dist2 = [a, b, c].map((x) => dot(sub(x, d), n2) / m2), dist1 = [d, e, f].map((x) => dot(sub(x, a), n1) / m1);
  if (dist2.every((x) => x > EPS_PLANE) || dist2.every((x) => x < -EPS_PLANE)) return false;
  if (dist1.every((x) => x > EPS_PLANE) || dist1.every((x) => x < -EPS_PLANE)) return false;
  if (dist2.every((x) => Math.abs(x) <= EPS_PLANE) && dist1.every((x) => Math.abs(x) <= EPS_PLANE)) {
    // coplanar: drop the normal's largest axis and test in 2D
    const ax = [0, 1, 2].reduce((m, i) => (Math.abs(n1[i]) > Math.abs(n1[m]) ? i : m), 0), [i, j] = [0, 1, 2].filter((x) => x !== ax);
    const A = [a, b, c].map((p) => [p[i], p[j]]), D = [d, e, f].map((p) => [p[i], p[j]]);
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (seg2(A[x], A[(x + 1) % 3], D[y], D[(y + 1) % 3])) return true;
    const in2 = (p, T) => { const s = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]); const k = [s(T[0], T[1], p), s(T[1], T[2], p), s(T[2], T[0], p)]; return k.every((x) => x >= 0) || k.every((x) => x <= 0); };
    return in2(A[0], D) || in2(D[0], A);
  }
  for (const [p, q] of [[a, b], [b, c], [c, a]]) if (segTri(p, q, d, e, f) !== null) return true;
  for (const [p, q] of [[d, e], [e, f], [f, d]]) if (segTri(p, q, a, b, c) !== null) return true;
  return false;
}

/** The s-gap between two s-intervals, both ways round on a closed loop. */
function gapS(a0, a1, b0, b1, closed, L) {
  let g = Math.max(0, b0 - a1, a0 - b1);
  if (closed && L > 0) g = Math.min(g, Math.max(0, L - (Math.max(a1, b1) - Math.min(a0, b0))));
  return g;
}

function selfCheck(mesh, opts = {}) {
  const closed = !!opts.closed, L = opts.lengthM || 0, sep = opts.minSeparationM === undefined ? 25 : opts.minSeparationM;
  const reach = opts.stackedM === undefined ? 2 : opts.stackedM;
  const trace = opts.trace || null; if (trace) { trace.pairs = []; trace.stacked = new Map(); }
  const S = soup(mesh), B = build(S), stats = { triangles: B.T, vertices: S.s.length, nodes: B.nodes.length, triTests: 0, rayTests: 0 };
  const tv = (t) => [P(S, S.tris[t * 3]), P(S, S.tris[t * 3 + 1]), P(S, S.tris[t * 3 + 2])];
  const groups = new Map(), sgroups = new Map();
  const keep = (map, key, rec) => { const g = map.get(key); if (!g) map.set(key, { ...rec, n: 1 }); else { g.n++; if (rec.s < g.s) Object.assign(g, rec, { n: g.n }); } };

  // self-intersection: each triangle against every later triangle whose box meets its box
  for (let t = 0; t < B.T; t++) {
    const lo = [B.box[t * 6], B.box[t * 6 + 1], B.box[t * 6 + 2]], hi = [B.box[t * 6 + 3], B.box[t * 6 + 4], B.box[t * 6 + 5]];
    let A = null;
    query(B, lo, hi, (o) => {
      if (o <= t || gapS(B.s0[t], B.s1[t], B.s0[o], B.s1[o], closed, L) < sep) return;
      stats.triTests++; A = A || tv(t); const O = tv(o);
      if (!triTri(A[0], A[1], A[2], O[0], O[1], O[2])) return;
      if (trace) trace.pairs.push([t, o]);
      const ia = S.tris[t * 3], io = S.tris[o * 3], ca = S.cells[S.triCell[t]], co = S.cells[S.triCell[o]];
      const [x, y] = S.s[ia] <= S.s[io] ? [[ca, ia], [co, io]] : [[co, io], [ca, ia]];
      const kx = S.s[ia] <= S.s[io] ? `${S.triCell[t]}|${S.triCell[o]}` : `${S.triCell[o]}|${S.triCell[t]}`;   // grouped by cell INDEX, not name
      keep(groups, kx, { s: S.s[x[1]], u: S.u[x[1]], cell: x[0], other: y[0], sOther: S.s[y[1]], uOther: S.u[y[1]] });
    });
  }
  // stacked: a segment along each vertex normal, `reach` each way
  for (let i = 0; i < S.s.length; i++) {
    const p = P(S, i), n = [S.nrm[i * 3], S.nrm[i * 3 + 1], S.nrm[i * 3 + 2]], nl = Math.sqrt(dot(n, n)); if (!(nl > 0)) continue;
    const q0 = p.map((x, d) => x - n[d] / nl * reach), q1 = p.map((x, d) => x + n[d] / nl * reach);
    const lo = q0.map((x, d) => Math.min(x, q1[d])), hi = q0.map((x, d) => Math.max(x, q1[d]));
    let best = null;
    query(B, lo, hi, (o) => {
      if (gapS(S.s[i], S.s[i], B.s0[o], B.s1[o], closed, L) < sep) return;
      stats.rayTests++; const O = tv(o), t = segTri(q0, q1, O[0], O[1], O[2]); if (t === null) return;
      const gap = Math.abs(t * 2 - 1) * reach;
      if (gap < reach && (!best || gap < best.gap)) best = { gap, o };
    });
    if (best && trace) trace.stacked.set(i, best.gap);
    if (best) {
      const cell = S.cells[S.vCell[i]], other = S.cells[S.triCell[best.o]];
      const key = `${S.vCell[i]}|${S.triCell[best.o]}`, g = sgroups.get(key);   // by cell index, not name
      const rec = { s: S.s[i], u: S.u[i], cell, other, sOther: B.s0[best.o], gap: best.gap };
      if (!g) sgroups.set(key, { ...rec, vertices: 1 }); else { g.vertices++; if (rec.gap < g.gap || (rec.gap === g.gap && rec.s < g.s)) Object.assign(g, rec, { vertices: g.vertices }); }
    }
  }
  const intersections = [...groups.values()].map(({ n, ...r }) => ({ ...r, pairs: n })).sort((a, b) => a.s - b.s || a.u - b.u);
  const stacked = [...sgroups.values()].sort((a, b) => a.s - b.s || a.u - b.u);
  if (trace) trace.soup = S;
  return { intersections, stacked, stats };
}
/** The self-intersections as folds[] entries (docs/INTERFACES.md §2: `margin: null, other: <cell name>`), both sides. */
function asFolds(res) {
  return res.intersections.flatMap((x) => [{ s: x.s, u: x.u, margin: null, other: x.other }, { s: x.sOther, u: x.uOther, margin: null, other: x.cell }]);
}

module.exports = { selfCheck, asFolds, triTri, segTri, _internal: { soup, build, query, gapS } };
