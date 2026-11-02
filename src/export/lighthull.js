// lighthull.js: the hull's BOTTOM drawn with as few triangles as its shape and its image need. The user, 2026-11-02 07:01: "does the new apron and undertrack
// make more geometry to lag assetto? It should be optimized in a way to be simple and not as complex as the track itself that is driven on"; 07:05: "if people make
// cool underneath textures, the simplification must not mess with the image beyond the curve distortion".
//
//   withLightHull(scene, mesh, segments) -> scene    the export's scene (after withUnderskin and withApron) with the underside skin of every STRETCH of plain cells
//                                                      redrawn as one mesh: few vertices across, long steps along
//
// WHY. The skin (underskin.js) hangs under EVERY road row (2 m apart) with about SKIN_COLUMNS vertices across, and each side's run out to its plank's tip (apron.js
// withRuns) adds RUN_COLUMNS more: about 80 triangles every 2 m, a third of the road's own count on his ELYSIUM, for a surface nobody drives on and that is seen only
// from below. Its shape (his red line: one smooth curve from tip to tip, following the road's sag) is smooth along the road almost everywhere, and across it is the
// road's own section at depth.
//
// THE IMAGE IS KEPT. Every vertex the light skin has IS a vertex of the full skin, with its own position, normal and uv (src/texture/flow.js on a textured floor: v the
// path's arc length, u the section's): nothing is made up between two. The measure of every choice below is the TEXEL DRIFT: for a vertex of the full skin, how far
// the point of the light skin that carries the same (u, v) lies from it. That is the curve's distortion and the image's at once, and no stretch is kept whose drift at
// any vertex of the full skin, or at the centre of any of its quads, passes LIGHT_TOL_M. A row where the uv JUMPS (an untextured track's v starts again at every 2 m segment, src/geom/mesh.js) is always a
// kept row, its two sides each with their own vertices, so no triangle spans a jump: no new seam, no stretch.
//
// WHAT IS KEPT, so nothing it meets opens:
//   - every PLANK TIP vertex (a run's first column, apron.js hullRun's O), at every road row: the plank (1ROAD_APRON, physics, drawn as it is) keeps its own rows, and
//     its outer edge is the hull's; the tips between two kept rows are fanned into the strip, so that edge has no T-junction;
//   - a stretch's FIRST and LAST rows whole (every vertex): they are the rows the cells beside it (not redrawn) share;
//   - each row's two skin EDGE vertices (where a run meets the grid) and, on a closed ring, its quarter points.
// ACROSS: the columns a stretch keeps are the same in every row between its ends: those each row needs for its chord to hold every dropped vertex within LIGHT_ACROSS_M
// of the point carrying its u. ALONG: from a kept row, the next is the farthest (at most LIGHT_MAX_STEP_M on, never past a uv jump) for which every vertex between
// keeps its drift within LIGHT_TOL_M. The redraw is then checked on the built mesh: where a sample drifts too far its columns are kept and the stretch built again
// (a long triangle across two rows that TWIST bows away from the full skin between its vertices); where they are kept already, the step is halved, down to one row
// (across only). A stretch that still fails, or has a triangle thinner than acready.js SLIVER, or passes a kn5 mesh's 65,536 vertices, is left as it was.
// A stretch is redrawn in pieces of LIGHT_CHUNK_CELLS, each with the columns its own rows need, meeting on a whole row.
// WHAT IS A PLAIN CELL: a grid cell (not a seam row) whose skin keeps its decimated columns only (no full row: not beside a seam, not in the twisted zone, underskin.js),
// and that has a run under a plank on BOTH sides (an open road) or none because it is a closed ring. Anything else (a wall side, the pit lane's side, a plank on one side
// only) is left exactly as withUnderskin and withApron made it. Nothing here is physics: the skin is scenery (underskin.js), and no road, plank or catch node is touched.
'use strict';
const { ringCells } = require('./underskin.js');
const { RUN_COLUMNS } = require('./apron.js');
const { SLIVER } = require('./acready.js');

const LIGHT_TOL_M = 0.02;        // the texel drift allowed at any vertex of the full skin: the curve's distortion and the image's
const LIGHT_ACROSS_M = 0.01;     // the share of it the columns across may take, so the steps along have the rest
const LIGHT_MAX_STEP_M = 40;     // the longest step along the road between two kept rows
const LIGHT_MIN_CELLS = 3;       // a stretch shorter than this keeps its skin (its two end rows are whole anyway)
const LIGHT_CHUNK_CELLS = 50;    // a stretch is redrawn in pieces of at most this many cells (100 m): each keeps the columns its own rows need, and stays inside a kn5 mesh's 65,536 vertices
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toWorld = (M, p) => [0, 1, 2].map((j) => p[0] * M[j] + p[1] * M[4 + j] + p[2] * M[8 + j] + M[12 + j]);
const turnWorld = (M, v) => [0, 1, 2].map((j) => v[0] * M[j] + v[1] * M[4 + j] + v[2] * M[8 + j]);
/** Where t lies between a and b (0 at a, 1 at b), or `fallback` when they are the same. */
const frac = (t, a, b, fallback) => (Math.abs(b - a) > 1e-12 ? (t - a) / (b - a) : fallback);

/**
 * Adds to `out` the columns row `row` needs between columns lo and hi (both kept) so that every column between lies within tol of the chord's point that carries
 * its own u (the chord from lo to hi, its u from theirs).
 */
function across(row, lo, hi, tol, out) {
  if (hi - lo < 2) return;
  let far = -1, d = tol;
  for (let i = lo + 1; i < hi; i++) {
    const x = len(sub(row.P[i], lerp(row.P[lo], row.P[hi], frac(row.U[i], row.U[lo], row.U[hi], (i - lo) / (hi - lo)))));
    if (x > d) { d = x; far = i; }
  }
  if (far < 0) return;
  out.add(far); across(row, lo, far, tol, out); across(row, far, hi, tol, out);
}

/**
 * One plain cell's skin read as rows across, tip to tip (a run's first column, its points in to the skin's edge, the grid's columns, the other run's points out to its
 * tip), in world space: { rows: [{ P, N, U, V }], anchors }, every row the same length, or null when the cell is not plain.
 */
function cellRows(sm, M, R, ring) {
  const C = sm.gridColumns, Jn = RUN_COLUMNS - 1, nv = sm.positions.length / 3;
  if (!(Number.isInteger(C) && C >= 2) || (sm.fullRows && sm.fullRows.length) || sm.roadIndex) return null;
  if (!(ring ? nv === R * C : nv === R * C + 2 * R * Jn)) return null;
  const at = (A, i) => [A[i * 3], A[i * 3 + 1], A[i * 3 + 2]];
  // the run whose last point before the skin's edge lies nearer the grid's column 0 is that side's (withRuns appends side 0's first, but read it, not assume it)
  let first = R * C, second = R * C + R * Jn;
  if (!ring && len(sub(at(sm.positions, first + Jn - 1), at(sm.positions, 0))) > len(sub(at(sm.positions, first + Jn - 1), at(sm.positions, C - 1)))) [first, second] = [second, first];
  const rows = [];
  for (let r = 0; r < R; r++) {
    const ix = ring ? Array.from({ length: C }, (_, c) => r * C + c)
      : [...Array.from({ length: Jn }, (_, j) => first + r * Jn + j), ...Array.from({ length: C }, (_, c) => r * C + c), ...Array.from({ length: Jn }, (_, j) => second + r * Jn + (Jn - 1 - j))];
    rows.push({ P: ix.map((i) => toWorld(M, at(sm.positions, i))), N: ix.map((i) => turnWorld(M, at(sm.normals, i))), U: ix.map((i) => sm.uvs[i * 2]), V: ix.map((i) => sm.uvs[i * 2 + 1]) });
  }
  const n = rows[0].P.length, anchors = new Set([0, n - 1]);
  if (ring) for (const q of [1, 2, 3]) anchors.add(Math.round(((n - 1) * q) / 4)); else anchors.add(Jn).add(Jn + C - 1);
  return { rows, anchors };
}

/** The point of triangle (a, b, c) (each { P, U, V }) that carries uv (u, v), and how far outside the triangle that uv lies (0 inside), in barycentric terms. */
function atUv(a, b, c, u, v) {
  const x1 = b.U - a.U, y1 = b.V - a.V, x2 = c.U - a.U, y2 = c.V - a.V, det = x1 * y2 - x2 * y1;
  if (!(Math.abs(det) > 1e-18)) return null;
  const px = u - a.U, py = v - a.V, l1 = (px * y2 - x2 * py) / det, l2 = (x1 * py - px * y1) / det, l0 = 1 - l1 - l2;
  return { P: [a.P[0] * l0 + b.P[0] * l1 + c.P[0] * l2, a.P[1] * l0 + b.P[1] * l1 + c.P[1] * l2, a.P[2] * l0 + b.P[2] * l1 + c.P[2] * l2], out: Math.max(0, -l0, -l1, -l2) };
}

/**
 * The redrawn skin of one stretch, `rows` its fine rows ({ P, N, U, V, Uin?, Vin? }: a row on a uv jump carries the side before's uv as Uin, Vin), `jump[r]` true where
 * the uv jumps at row r, `cols` the kept columns between the ends, `maxStep` the longest step: { mesh, drift, bad } (bad: the columns where a sample drifted past
 * LIGHT_TOL_M), or null when a triangle would be thinner than SLIVER or the mesh would pass a kn5 mesh's 65,536 vertices.
 */
function lightStretch(rows, jump, cols, ring, maxStep) {
  const n = rows[0].P.length, last = rows.length - 1, mid = Math.floor(n / 2), along = [0];
  for (let r = 1; r < rows.length; r++) along.push(along[r - 1] + len(sub(rows[r].P[mid], rows[r - 1].P[mid])));
  const all = Array.from({ length: n }, (_, i) => i), keepAt = (r) => (r === 0 || r === last ? all : cols);
  // a fine row's vertex as the strip after (side 'out') or before ('in') a kept row sees it: a row on a jump has the side before's uv as Uin, Vin
  const vx = (r, i, side) => ({ P: rows[r].P[i], N: rows[r].N[i], U: side === 'in' && jump[r] ? rows[r].Uin[i] : rows[r].U[i], V: side === 'in' && jump[r] ? rows[r].Vin[i] : rows[r].V[i] });
  // the drift of every vertex of fine row r between kept rows a and b, against the strip's grid (kept columns; the fans at the tips are checked on the built mesh)
  const drift = (a, b, r) => {
    let worst = 0; const X = keepAt(a), Y = keepAt(b);
    // a strip from a whole end row is one row long, never stretched, even where the piece keeps every column: so a piece ends on the full skin's own last cell
    // (a 20 m strip onto an open route's end row read as a line of sky to the export's final-scene check, which places a triangle by its centre)
    if (X !== Y) return Infinity;
    for (let q = 0; q + 1 < X.length; q++) {
      const j = X[q], k = X[q + 1];
      for (let i = j; i <= k; i++) {
        const t = vx(r, i, 'out'), A0 = vx(a, j, 'out'), A1 = vx(a, k, 'out'), B0 = vx(b, j, 'in'), B1 = vx(b, k, 'in');
        const p = atUv(A0, A1, B0, t.U, t.V), s = atUv(A1, B1, B0, t.U, t.V), best = p && (!s || p.out <= s.out) ? p : s;
        if (!best) return Infinity;
        worst = Math.max(worst, len(sub(t.P, best.P)));
      }
    }
    return worst;
  };
  const kept = [0];
  for (let a = 0; a < last;) {
    let b = a + 1;
    if (!jump[a + 1] || a + 1 === last) for (let c = a + 2; c <= last && along[c] - along[a] <= maxStep && !jump[c - 1]; c++) {
      let ok = true;
      for (let r = a + 1; r < c && ok; r++) if (!(drift(a, c, r) <= LIGHT_TOL_M)) ok = false;
      if (!ok) break;
      b = c;
      if (jump[c]) break;
    }
    kept.push(b); a = b;
  }
  // the mesh: each kept row's columns ('out' and, on a jump, 'in' copies), the tips of every fine row between
  const P = [], Nn = [], UV = [], idx = [];
  const add = (v) => { P.push(v.P); Nn.push(v.N); UV.push([v.U, v.V]); return P.length - 1; };
  const ids = new Map();
  const id = (r, i, side) => { const s = side === 'in' && jump[r] ? 'in' : 'out', k = `${r}|${i}|${s}`; if (!ids.has(k)) ids.set(k, add(vx(r, i, s))); return ids.get(k); };
  const strips = [];   // per strip, the triangles it made (for the drift check)
  for (let q = 0; q + 1 < kept.length; q++) {
    const ra = kept[q], rb = kept[q + 1], X = keepAt(ra), Y = keepAt(rb), t0 = idx.length;
    const A = (i) => id(ra, i, 'out'), B = (i) => id(rb, i, 'in');
    const Xi = ring ? X : X.slice(1, -1), Yi = ring ? Y : Y.slice(1, -1);
    let i = 0, j = 0;
    while (i < Xi.length - 1 || j < Yi.length - 1) {
      if (j === Yi.length - 1 || (i < Xi.length - 1 && Xi[i + 1] <= Yi[j + 1])) { idx.push(A(Xi[i]), A(Xi[i + 1]), B(Yi[j])); i++; }
      else { idx.push(A(Xi[i]), B(Yi[j + 1]), B(Yi[j])); j++; }
    }
    if (!ring) for (const [tip, xa, yb] of [[0, Xi[0], Yi[0]], [n - 1, Xi[Xi.length - 1], Yi[Yi.length - 1]]]) {
      const chain = []; for (let r = ra; r <= rb; r++) chain.push(r === ra ? A(tip) : r === rb ? B(tip) : id(r, tip, 'out'));
      const pa = A(xa), pb = B(yb), m = Math.floor((chain.length - 1) / 2);
      for (let c = 0; c < m; c++) idx.push(chain[c], chain[c + 1], pa);
      for (let c = m; c + 1 < chain.length; c++) idx.push(chain[c], chain[c + 1], pb);
      idx.push(chain[m], pb, pa);
    }
    strips.push({ ra, rb, t0, t1: idx.length });
  }
  // each triangle wound so its normal agrees with its own vertices' (the skin faces away from the road); none thinner than SLIVER
  for (let t = 0; t < idx.length; t += 3) {
    const a = P[idx[t]], b = P[idx[t + 1]], c = P[idx[t + 2]], x = cross(sub(b, a), sub(c, a)), longest = Math.max(len(sub(b, a)), len(sub(c, a)), len(sub(c, b)));
    if (!(longest > 0 && len(x) / longest >= SLIVER)) return null;
    const s = [0, 1, 2].map((k) => Nn[idx[t]][k] + Nn[idx[t + 1]][k] + Nn[idx[t + 2]][k]);
    if (dot(x, s) < 0) { const y = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = y; }
  }
  // THE DRIFT CHECK on the built mesh, found by uv in the strip's own triangles: every vertex of every fine row, and the centre of every fine quad (the mean of its four
  // corners and of their uvs: a long thin triangle across rows that twist bows away from the full skin between its vertices, where no vertex is). `bad`: the columns
  // where a sample drifts too far, the reader's to keep
  let worst = 0; const bad = new Set();
  const T = (k) => ({ P: P[k], U: UV[k][0], V: UV[k][1] });
  const probe = (t0, t1, q, cols_) => {
    let best = null;
    for (let t = t0; t < t1; t += 3) { const h = atUv(T(idx[t]), T(idx[t + 1]), T(idx[t + 2]), q.U, q.V); if (h && (!best || h.out < best.out)) best = h; if (best && best.out === 0) break; }
    // a uv is a float32: at v = 13 (130 m on) its last digit is 1e-6, 5e-6 of a 2 m triangle's v, so a vertex on a corner reads up to that outside it; 1e-4 is under a millimetre
    const d = best && best.out < 1e-4 ? len(sub(q.P, best.P)) : Infinity;
    worst = Math.max(worst, d); if (!(d <= LIGHT_TOL_M)) for (const c of cols_) bad.add(c);
  };
  for (const { ra, rb, t0, t1 } of strips) for (let r = ra; r <= rb; r++) for (let i = 0; i < n; i++) {
    probe(t0, t1, vx(r, i, r === rb ? 'in' : 'out'), [i]);
    if (r < rb && i + 1 < n) {
      const c = [vx(r, i, 'out'), vx(r, i + 1, 'out'), vx(r + 1, i, r + 1 === rb ? 'in' : 'out'), vx(r + 1, i + 1, r + 1 === rb ? 'in' : 'out')];
      probe(t0, t1, { P: [0, 1, 2].map((k) => (c[0].P[k] + c[1].P[k] + c[2].P[k] + c[3].P[k]) / 4), U: (c[0].U + c[1].U + c[2].U + c[3].U) / 4, V: (c[0].V + c[1].V + c[2].V + c[3].V) / 4 }, [i, i + 1]);
    }
  }
  if (P.length > 65535) return null;
  const positions = new Float32Array(P.length * 3), normals = new Float32Array(P.length * 3), uvs = new Float32Array(P.length * 2);
  P.forEach((p, k) => { positions.set(p, k * 3); const l = len(Nn[k]) || 1; normals.set(Nn[k].map((x) => x / l), k * 3); uvs.set(UV[k], k * 2); });
  return { mesh: { positions, normals, uvs, indices: Uint16Array.from(idx) }, drift: worst, bad };
}

function withLightHull(scene, mesh, segments) {
  if (!mesh || !mesh.cells || !mesh._state || !scene || !scene.root) return scene;
  const kids = scene.root.children, rings = ringCells(mesh, segments), pcs = mesh._state.pieces;
  const skinOf = new Map(); kids.forEach((c, i) => { if (/^SKIN_/.test(c.name)) skinOf.set(c.matrix, i); });
  // the plain cells, by s
  const plain = [];
  mesh.cells.forEach((cell, k) => {
    const seg = segments[cell.piece], pc = pcs[cell.piece];
    if (cell.seam || !seg || seg.word !== 'core' || !pc || !kids[k]) return;
    const si = skinOf.get(kids[k].matrix); if (si === undefined) return;
    const R = kids[k].children[0].positions.length / 3 / pc.K;
    const cr = cellRows(kids[si].children[0], kids[si].matrix, R, rings.has(k));
    if (cr) plain.push({ k, si, cell, ring: rings.has(k), ...cr });
  });
  plain.sort((a, b) => a.cell.s0 - b.cell.s0);
  const stretches = [];
  for (const p of plain) {
    const t = stretches[stretches.length - 1], q = t && t[t.length - 1];
    const joins = q && q.ring === p.ring && q.rows[0].P.length === p.rows[0].P.length && Math.abs(q.cell.s1 - p.cell.s0) < 1e-6
      && Math.max(...q.rows[q.rows.length - 1].P.map((x, i) => len(sub(x, p.rows[0].P[i])))) < 1e-3;
    if (joins) t.push(p); else stretches.push([p]);
  }
  // each stretch in pieces of at most LIGHT_CHUNK_CELLS cells, the last one long enough to keep (a short tail joins the piece before); two pieces meet on a whole row
  const pieces = [];
  for (const st of stretches) for (let i = 0; i < st.length; i += LIGHT_CHUNK_CELLS) { const c = st.slice(i, i + LIGHT_CHUNK_CELLS); if (c.length < LIGHT_MIN_CELLS && pieces.length && i > 0) pieces[pieces.length - 1].push(...c); else pieces.push(c); }
  const replace = new Map(), drop = new Set();
  for (const st of pieces) {
    if (st.length < LIGHT_MIN_CELLS) continue;
    // the stretch's fine rows: each cell's first row but the first cell's is the row before's, kept once; where its uv differs from the row before's (a jump), the row
    // keeps both: the side before's as Uin, Vin
    const rows = [], jump = [];
    st.forEach((c, ci) => c.rows.forEach((row, r) => {
      if (ci > 0 && r === 0) {
        const prev = rows[rows.length - 1];
        if (row.U.some((u, i) => Math.abs(u - prev.U[i]) > 1e-6) || row.V.some((v, i) => Math.abs(v - prev.V[i]) > 1e-6)) { rows[rows.length - 1] = { ...prev, Uin: prev.U, Vin: prev.V, U: row.U, V: row.V }; jump[rows.length - 1] = true; }
        return;
      }
      rows.push(row); jump.push(false);
    }));
    // the columns every row between the ends keeps
    const keep = new Set(st[0].anchors), anchors = [...keep].sort((x, y) => x - y);
    for (let r = 1; r < rows.length - 1; r++) for (let a = 0; a + 1 < anchors.length; a++) across(rows[r], anchors[a], anchors[a + 1], LIGHT_ACROSS_M, keep);
    const cols = [...keep].sort((x, y) => x - y);
    // built, checked, and built again: a column where a sample drifts too far is kept; where every such column is kept already, the step along is halved, down to one row
    let lm = null, cur = cols;
    for (let step = LIGHT_MAX_STEP_M, round = 0; step >= 1 && round < 64; round++) {
      const t = lightStretch(rows, jump, cur, st[0].ring, step);
      if (!t) { step /= 2; continue; }
      if (t.drift <= LIGHT_TOL_M) { lm = t; break; }
      const more = [...t.bad].filter((i) => !cur.includes(i));
      if (more.length) cur = [...cur, ...more].sort((x, y) => x - y); else step /= 2;
    }
    if (!lm) continue;
    const first = kids[st[0].si], sm = first.children[0];
    replace.set(st[0].si, { type: 'dummy', name: first.name, matrix: IDENTITY.slice(), children: [{ type: 'mesh', name: sm.name, material: sm.material, castShadows: sm.castShadows, visible: sm.visible, transparent: sm.transparent, renderable: sm.renderable, ...lm.mesh }] });
    for (const c of st.slice(1)) drop.add(c.si);
  }
  if (!replace.size) return scene;
  const children = [];
  kids.forEach((c, i) => { if (!drop.has(i)) children.push(replace.get(i) || c); });
  return { ...scene, root: { ...scene.root, children } };
}

module.exports = { withLightHull, LIGHT_TOL_M, LIGHT_ACROSS_M, LIGHT_MAX_STEP_M, LIGHT_MIN_CELLS, LIGHT_CHUNK_CELLS };
