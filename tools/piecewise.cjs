// piecewise.cjs: a track's line as PIECEWISE equations fitted to the MESH itself (D184; the keeper's corrections, 05:3x,
// in exo_memory/loop/plan_t180_equation_skill_2026-09-28.md "Addendum" and "The method, thought through", the spec).
// M4 (tools/fourier.cjs) fitted the reader's walk as one periodic series and rebuilt the line by integrating heading, so
// long laps drifted. Here:
//   1. the CENTRELINE comes from the road triangles: at each reader station (used for ORDER only) the road is walked
//      across the station's cross-plane by short rays (Möller–Trumbore) in the station's own frame, to its exact edges;
//   2. the lap is SPLIT at jumps (a gap is not road), and on long laps also at the middle of long straights;
//   3. each piece is an adaptive clamped cubic B-SPLINE in s for the position (x, y, z) and the bank;
//   4. pieces meet in G2 JOINTS, and the lap CLOSES, as equality constraints inside one least-squares system (KKT); a jump
//      joint has no position constraint and is checked as a FLIGHT instead (src/validate/jumps.js checkJump);
//   6. the report is a curve of control points against tolerance, and the count in stored numbers, beside M4's.
// The maths, each with its shelf section (docs/math; sources in MATH_SOURCES.md), and the formulas this adds to it are in
// exo_memory/handback/p-d184-scripts-E_2026-09-28.md §2.
// Prints SUMMARY NUMBERS only. The coefficients (another author's layout) are written only into gitignored reads/.
//   node tools/piecewise.cjs <track folder> <read.json> [--layout L] [--tol 5] [--curve] [--write <name>]
'use strict';
const fs = require('fs'), path = require('path');
const { readKn5 } = require('./kn5.cjs');
const { checkJump } = require('../src/validate/jumps.js');
const { MACH6 } = require('../src/validate/limits.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const DEG = Math.PI / 180;
const pct = (xs, p) => { if (!xs.length) return NaN; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

// ── 1. the road ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** The drivable road of a track folder, by read_track.cjs's rule (IS_VALID_TRACK keys, no pits, underside skins). */
function roadTris(dir, layout) {
  const keys = new Set(['ROAD']), files = [];
  (function walk(x) { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase() === 'surfaces.ini') files.push(p); } })(dir);
  for (const f of files) { let key = null; for (const line of fs.readFileSync(f, 'latin1').split(/\r?\n/)) { const k = line.match(/^\s*KEY\s*=\s*([^\s;]+)/i); if (k) key = k[1].toUpperCase(); if (/^\s*IS_VALID_TRACK\s*=\s*1/i.test(line) && key && !/PIT/i.test(key)) keys.add(key.replace(/^\d+/, '').replace(/\?$/, '')); } }
  let kn5List = fs.readdirSync(dir).filter((f) => /\.kn5$/i.test(f));
  if (layout) { const mi = path.join(dir, 'models_' + layout + '.ini'); if (!fs.existsSync(mi)) throw new Error('no models_' + layout + '.ini'); kn5List = [...fs.readFileSync(mi, 'latin1').matchAll(/^\s*FILE\s*=\s*(.+?)\s*$/gim)].map((m) => m[1]); }
  const road = [];
  for (const f of kn5List) for (const m of readKn5(path.join(dir, f)).meshes) { const nm = m.name.toUpperCase().match(/^\d+([A-Z_]+)/); if (!nm || /PIT/.test(m.name.toUpperCase())) continue; if ([...keys].some((K) => nm[1].startsWith(K))) road.push(m); }
  const isUnder = (m) => /UNDERSIDE|UNDER_SIDE|BOTTOM/.test(m.name.toUpperCase()), nt = (m) => m.idx.length / 3;
  const keepUnder = road.filter(isUnder).reduce((a, m) => a + nt(m), 0) > road.reduce((a, m) => a + nt(m), 0) * 0.6;
  const T = [];
  for (const m of road) { if (isUnder(m) && !keepUnder) continue; for (let i = 0; i < m.idx.length; i += 3) { const t = []; for (const j of [m.idx[i], m.idx[i + 1], m.idx[i + 2]]) t.push(m.pos[j * 3], m.pos[j * 3 + 1], m.pos[j * 3 + 2]); T.push(t); } }
  if (!T.length) throw new Error(dir + ': no drivable triangles');
  return T;
}

/** A ray index over triangles (9-number arrays): ray(o, d, maxT) → the nearest hit { t, p, n } (Möller–Trumbore). */
function rayIndex(T, CS = 2) {
  const key = (x, y, z) => ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768), grid = new Map();
  T.forEach((t, i) => {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(t[k], t[k + 3], t[k + 6]) / CS)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(t[k], t[k + 3], t[k + 6]) / CS));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = key(x, y, z); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(i); }
  });
  function ray(o, d, maxT) {
    const seen = new Set(); let best = null;
    const steps = Math.max(1, Math.ceil(maxT / (CS / 2)));
    for (let k = 0; k <= steps; k++) {
      const q = add(o, d, Math.min(maxT, (k * maxT) / steps)), c0 = q.map((v) => Math.floor(v / CS));
      for (let x = c0[0] - 1; x <= c0[0] + 1; x++) for (let y = c0[1] - 1; y <= c0[1] + 1; y++) for (let z = c0[2] - 1; z <= c0[2] + 1; z++) {
        for (const i of grid.get(key(x, y, z)) || []) {
          if (seen.has(i)) continue; seen.add(i);
          const t = T[i], A = [t[0], t[1], t[2]], e1 = [t[3] - t[0], t[4] - t[1], t[5] - t[2]], e2 = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
          const pv = cross(d, e2), det = dot(e1, pv); if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det, tv = sub(o, A), u = dot(tv, pv) * inv; if (u < -1e-9 || u > 1 + 1e-9) continue;
          const qv = cross(tv, e1), v = dot(d, qv) * inv; if (v < -1e-9 || u + v > 1 + 1e-9) continue;
          const h = dot(e2, qv) * inv; if (h < 0 || h > maxT) continue;
          if (!best || h < best.t) best = { t: h, p: add(o, d, h), n: unit(cross(e1, e2)) };
        }
      }
    }
    return best;
  }
  return { ray, count: T.length };
}

// ── 1. the mesh centreline, by cross-rays ────────────────────────────────────────────────────────────────────────────
/**
 * Walk the road across the plane through c normal to f, in the station's own frame (n: the reader's normal, which
 * follows walls and loops; trap (c)), by rays of 1.2 m cast back onto the surface from 0.6 m above the last point along
 * its OWN normal, so the surface found is the one nearest the last point, never a road above or below (trap (b)). An
 * edge is found by bisection to 1 cm. Returns the edges, the width along the surface, the CENTRE (the surface point
 * midway along the section between the edges: the 3-D midpoint of a half-pipe's rims would float above its floor), and
 * the normal there. null when there is no surface under c.
 */
function crossSection(ix, c, f, n, step = 0.5) {
  const f0 = unit(f), orient = (m, ref) => (dot(m, ref) < 0 ? scale(m, -1) : m);
  const h0 = ix.ray(add(c, n, 1.0), scale(n, -1), 2.0); if (!h0) return null;
  const q0 = h0.p, n0 = orient(h0.n, n);
  const probe = (q, qn, dir, h) => { const o = add(add(q, dir, h), qn, 0.6), hit = ix.ray(o, scale(qn, -1), 1.2); return hit && Math.abs(dot(sub(hit.p, c), f0)) < 0.5 ? { p: hit.p, n: orient(hit.n, qn) } : null; };
  const side = (sgn) => {
    const pts = [q0]; let q = q0, qn = n0, arc = 0;
    for (let k = 0; k < 400; k++) {
      let dir = scale(unit(cross(f0, qn)), sgn); dir = unit(sub(dir, scale(f0, dot(dir, f0))));
      const hit = probe(q, qn, dir, step);
      if (hit) { arc += len(sub(hit.p, q)); q = hit.p; qn = hit.n; pts.push(q); continue; }
      let lo = 0, hi = step, last = null; for (let it = 0; it < 6; it++) { const mid = (lo + hi) / 2, h = probe(q, qn, dir, mid); if (h) { lo = mid; last = h; } else hi = mid; }
      if (last) { arc += len(sub(last.p, q)); pts.push(last.p); }
      break;
    }
    return { pts, arc };
  };
  const L = side(1), R = side(-1), poly = [...R.pts.slice().reverse(), ...L.pts.slice(1)], width = L.arc + R.arc;
  let acc = 0, centre = q0; const half = width / 2;
  for (let i = 1; i < poly.length; i++) { const seg = len(sub(poly[i], poly[i - 1])); if (acc + seg >= half) { centre = add(poly[i - 1], sub(poly[i], poly[i - 1]), seg > 0 ? (half - acc) / seg : 0); break; } acc += seg; }
  const hc = ix.ray(add(centre, n0, 0.6), scale(n0, -1), 1.2);
  return { left: L.pts[L.pts.length - 1], right: R.pts[R.pts.length - 1], width, centre: hc ? hc.p : centre, normal: hc ? orient(hc.n, n0) : n0 };
}

/**
 * The mesh centreline for a read: one entry per road station, in order, with s the cumulative 3-D length of the mesh
 * centres (a jump is its chord). A station whose width differs by more than 20% from its predecessor's is FLAGGED (a seam
 * or a reader glitch, trap (a)): excluded from the fit and listed.
 */
function meshCentreline(read, ix) {
  const out = [], jumps = [];
  for (const x of read.stations) {
    if (x.jump) { jumps.push({ atIndex: out.length, d: x.d, gap: x.gap_m, drop: x.drop_m }); continue; }
    if (!x.c || !x.f || !x.n) continue;
    const cs = crossSection(ix, x.c, x.f, x.n);
    out.push({ d: x.d, k: x.k, reader: x.c, cs });
  }
  const st = out.filter((x) => x.cs);   // a station with no surface under it is left out and counted
  const missing = out.length - st.length;
  let s = 0; for (let i = 0; i < st.length; i++) { if (i) s += len(sub(st[i].cs.centre, st[i - 1].cs.centre)); st[i].s = s; st[i].p = st[i].cs.centre; st[i].n = st[i].cs.normal; st[i].w = st[i].cs.width; }
  const L = s + len(sub(st[0].p, st[st.length - 1].p));
  for (let i = 0; i < st.length; i++) { const w0 = st[(i - 1 + st.length) % st.length].w, w = st[i].w; st[i].flag = Math.abs(w - w0) > 0.2 * Math.max(w, w0); }
  // jump markers by station index (the marker sits between the take-off and the landing station)
  const idxOf = (atIndex) => { let k = 0, seen = 0; for (let i = 0; i < out.length && seen < atIndex; i++) { if (out[i].cs) k++; seen++; } return k; };
  return { st, L, missing, jumps: jumps.map((j) => ({ ...j, landing: idxOf(j.atIndex) % st.length })) };
}

// ── 2. splitting ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Joint station indices (a joint sits AT a station shared by the two pieces), and jump breaks (between station i−1 and
 * i). Long laps (> longM) also split at the middle of every straight: |κ| < 1/1500 m⁻¹ held for ≥ 200 m, the reader's
 * own "straight" class, so a joint sits where the curvature is about 0 and never inside a corner.
 */
function splitPoints(mc, longM = 10000) {
  const breaks = mc.jumps.map((j) => j.landing);   // a jump: the piece ends at landing − 1, the next starts at landing
  const joints = [];
  if (mc.L > longM) {
    const st = mc.st, n = st.length; let i = 0;
    while (i < n) {
      if (st[i].k != null && Math.abs(st[i].k) < 1 / 1500) { let j = i; while (j + 1 < n && st[j + 1].k != null && Math.abs(st[j + 1].k) < 1 / 1500 && !breaks.includes(j + 1)) j++; if (st[j].s - st[i].s >= 200) joints.push(Math.floor((i + j) / 2)); i = j + 1; }
      else i++;
    }
  }
  return { breaks: [...new Set(breaks)].sort((a, b) => a - b), joints: [...new Set(joints)].filter((j) => !breaks.includes(j)).sort((a, b) => a - b) };
}

/**
 * The pieces, in cyclic order, as station index lists with an unwrapped s. Each boundary is a jump break or a G2 joint.
 * A joint station belongs to both pieces. With no boundary at all, one piece runs the whole lap and closes on itself.
 */
function piecesOf(mc, sp) {
  const n = mc.st.length, bounds = [...sp.breaks.map((i) => ({ i, type: 'jump' })), ...sp.joints.map((i) => ({ i, type: 'g2' }))].sort((a, b) => a.i - b.i);
  if (!bounds.length) return [{ idx: [...Array(n).keys(), 0], s: [...mc.st.map((x) => x.s), mc.L], closesOnItself: true }];
  const pieces = [];
  for (let b = 0; b < bounds.length; b++) {
    const A = bounds[b], B = bounds[(b + 1) % bounds.length], idx = [], s = [];
    let i = A.i, wrap = 0;
    const end = B.type === 'jump' ? (B.i - 1 + n) % n : B.i;   // a jump: stop at the take-off; a joint: include it
    for (let guard = 0; guard <= n; guard++) { idx.push(i); s.push(mc.st[i].s + wrap); if (i === end) break; i++; if (i === n) { i = 0; wrap = mc.L; } }
    pieces.push({ idx, s, startType: A.type, endType: B.type });
  }
  return pieces;
}

// ── 3. cubic B-splines ───────────────────────────────────────────────────────────────────────────────────────────────
/** A clamped cubic knot vector on [a, b] with the given interior knots. */
const knotsOf = (a, b, interior) => [a, a, a, a, ...interior, b, b, b, b];
/**
 * The four nonzero cubic basis functions at s, and their first and second derivatives, by the Cox–de Boor recursion
 * (shelf: see the hand-back §2), with the derivative formula N′(i,p) = p/(u(i+p) − u(i))·N(i,p−1) − p/(u(i+p+1) − u(i+1))·N(i+1,p−1).
 * Returns { first: the index of the first nonzero function, N, D1, D2 }.
 */
function basis(U, s) {
  const p = 3, m = U.length - 1, nCP = m - p;
  let k = p; if (s >= U[nCP]) k = nCP - 1; else while (k < nCP - 1 && s >= U[k + 1]) k++;
  const tab = [[1]];   // tab[d][j] = N(k−d+j, d)
  const Nd = (d, i) => { const j = i - (k - d); return j >= 0 && j <= d ? tab[d][j] : 0; };
  const frac = (num, den) => (den > 0 ? num / den : 0);
  for (let d = 1; d <= p; d++) { tab[d] = []; for (let j = 0; j <= d; j++) { const i = k - d + j; tab[d][j] = frac(s - U[i], U[i + d] - U[i]) * Nd(d - 1, i) + frac(U[i + d + 1] - s, U[i + d + 1] - U[i + 1]) * Nd(d - 1, i + 1); } }
  const d1 = (d, i) => frac(d, U[i + d] - U[i]) * Nd(d - 1, i) - frac(d, U[i + d + 1] - U[i + 1]) * Nd(d - 1, i + 1);
  const d2 = (i) => frac(3, U[i + 3] - U[i]) * d1(2, i) - frac(3, U[i + 4] - U[i + 1]) * d1(2, i + 1);
  const first = k - p, N = [], D1 = [], D2 = [];
  for (let j = 0; j <= p; j++) { const i = first + j; N.push(Nd(3, i)); D1.push(d1(3, i)); D2.push(d2(i)); }
  return { first, N, D1, D2 };
}

// ── 4–5. the constrained least squares: banded normal equations, joints and closure by a Schur complement ────────────
/** Banded Cholesky of a symmetric positive definite matrix given as lower bands B[i][j] = M(i, i − j), j ≤ bw. */
function bandChol(B, bw) {
  const n = B.length, L = B.map((r) => r.slice());
  for (let i = 0; i < n; i++) {
    for (let j = Math.max(0, i - bw); j <= i; j++) {
      let sum = L[i][i - j];
      for (let k = Math.max(0, i - bw); k < j; k++) sum -= L[i][i - k] * L[j][j - k];
      if (i === j) { if (!(sum > 0)) throw new Error(`bandChol: not positive definite at ${i} (${sum})`); L[i][0] = Math.sqrt(sum); }
      else L[i][i - j] = sum / L[j][0];
    }
  }
  return (b) => {   // solve M x = b
    const y = b.slice(); for (let i = 0; i < n; i++) { for (let k = Math.max(0, i - bw); k < i; k++) y[i] -= L[i][i - k] * y[k]; y[i] /= L[i][0]; }
    for (let i = n - 1; i >= 0; i--) { for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) y[i] -= L[k][k - i] * y[k]; y[i] /= L[i][0]; }
    return y;
  };
}
/** Dense solve (Gaussian elimination, partial pivoting) for the small constraint system. */
function denseSolve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-300) throw new Error('denseSolve: singular constraint system');
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; if (k) for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; } }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Fit every piece's spline at once. rows: [{ piece, s, values: [v1, v2, …] }] (one value per fitted channel; null skips
 * that channel for that row). joints: [{ a: { piece, s }, b: { piece, s }, orders: [0, 1, 2], rhs: [[per channel]…] }]:
 * C_a^(r)(s_a) − C_b^(r)(s_b) = rhs. Minimises Σ (C(s) − v)² + λ Σ (Δ²P)² (a tiny second-difference ridge so that a span
 * with no data is still determined) subject to the joints: min ‖Ax − b‖² s.t. Cx = d, solved through its KKT system by a
 * Schur complement (shelf 02 §2 is the least-norm case of the same Lagrange argument).
 */
function fitSystem(pieces, rows, joints, channels, lambda = 1e-6) {
  const off = []; let n = 0; for (const p of pieces) { off.push(n); n += p.U.length - 4; }
  const bw = 3, B = Array.from({ length: n }, () => new Float64Array(bw + 1)), rhs = Array.from({ length: channels }, () => new Float64Array(n));
  const addM = (i, j, v) => { if (i < j) [i, j] = [j, i]; B[i][i - j] += v; };
  for (const r of rows) {
    // a row with NO value (a held-out or flagged station) is skipped whole: adding its basis to the normal matrix with no
    // right-hand side made it a data point at zero (the D184 hand-back: the bank fell to half its data). A row's values are
    // all present or all null; channels share the one matrix.
    if (r.values.every((v) => v == null)) continue;
    if (r.values.some((v) => v == null)) throw new Error('fitSystem: a row has some values and not others; the channels share one matrix');
    const P = pieces[r.piece], b = basis(P.U, r.s), o = off[r.piece] + b.first, w = r.w == null ? 1 : r.w;
    for (let a = 0; a < 4; a++) { for (let c = 0; c <= a; c++) addM(o + a, o + c, w * b.N[a] * b.N[c]); for (let ch = 0; ch < channels; ch++) if (r.values[ch] != null) rhs[ch][o + a] += w * b.N[a] * r.values[ch]; }
  }
  // the ridge, on each piece's control polygon (i−1, i, i+1): λ·(P(i−1) − 2P(i) + P(i+1))²
  pieces.forEach((P, pi) => { const m = P.U.length - 4; for (let i = 1; i < m - 1; i++) { const g = [off[pi] + i - 1, off[pi] + i, off[pi] + i + 1], c = [1, -2, 1]; for (let a = 0; a < 3; a++) for (let e = 0; e <= a; e++) addM(g[a], g[e], lambda * c[a] * c[e]); } });
  for (let i = 0; i < n; i++) B[i][0] += 1e-12;
  const solveM = bandChol(Array.from(B, (r) => Array.from(r)), bw);
  const X = rhs.map((b) => solveM(Array.from(b)));
  if (!joints.length) return { off, x: X };
  // the constraint rows
  const Crows = [], D = [];
  for (const j of joints) for (const [oi, r] of j.orders.entries()) {
    const row = new Map(), put = (idx, v) => row.set(idx, (row.get(idx) || 0) + v);
    const ba = basis(pieces[j.a.piece].U, j.a.s), bb = basis(pieces[j.b.piece].U, j.b.s), pick = (b) => (r === 0 ? b.N : r === 1 ? b.D1 : b.D2);
    pick(ba).forEach((v, a) => put(off[j.a.piece] + ba.first + a, v)); pick(bb).forEach((v, a) => put(off[j.b.piece] + bb.first + a, -v));
    Crows.push(row); D.push(Array.from({ length: channels }, (_, ch) => (j.rhs ? j.rhs[oi][ch] : 0)));
  }
  const k = Crows.length, Y = Crows.map((row) => { const e = new Array(n).fill(0); for (const [i, v] of row) e[i] = v; return solveM(e); });   // M⁻¹Cᵀ, one column per row
  const S = Crows.map((row) => Y.map((y) => { let s = 0; for (const [i, v] of row) s += v * y[i]; return s; }));
  const x = X.map((Xc, ch) => {
    const r = Crows.map((row, a) => { let s = 0; for (const [i, v] of row) s += v * Xc[i]; return s - D[a][ch]; });
    const lam = denseSolve(S, r), out = Xc.slice(); for (let a = 0; a < k; a++) for (let i = 0; i < n; i++) out[i] -= Y[a][i] * lam[a];
    return out;
  });
  return { off, x };
}
/** Evaluate a fitted channel on a piece at s: value, first and second derivative. */
function evalPiece(fit, pieces, pi, ch, s) { const b = basis(pieces[pi].U, s), o = fit.off[pi] + b.first; let v = 0, d1 = 0, d2 = 0; for (let a = 0; a < 4; a++) { const c = fit.x[ch][o + a]; v += c * b.N[a]; d1 += c * b.D1[a]; d2 += c * b.D2[a]; } return { v, d1, d2 }; }

// ── the frame, and the bank ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * A rotation-minimising frame along the ordered stations by the double reflection method (WANG08, primary on the shelf,
 * 01 §4): r(i+1) from r(i), the positions x(i), x(i+1) and the tangents t(i), t(i+1). Returns the reference vectors.
 */
function rmf(xs, ts, r0) {
  const r = [unit(sub(r0, scale(ts[0], dot(r0, ts[0]))))];
  for (let i = 0; i + 1 < xs.length; i++) {
    const v1 = sub(xs[i + 1], xs[i]), c1 = dot(v1, v1); if (c1 < 1e-18) { r.push(r[i]); continue; }
    const rL = sub(r[i], scale(v1, 2 * dot(v1, r[i]) / c1)), tL = sub(ts[i], scale(v1, 2 * dot(v1, ts[i]) / c1));
    const v2 = sub(ts[i + 1], tL), c2 = dot(v2, v2);
    r.push(unit(c2 < 1e-18 ? rL : sub(rL, scale(v2, 2 * dot(v2, rL) / c2))));
  }
  return r;
}
const angleAbout = (a, b, t) => Math.atan2(dot(t, cross(a, b)), dot(a, b));
const wrapPi = (x) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));

// ── the fit of one track ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * mc: meshCentreline(); opts: { tol (m), bankTolDeg, cap (control points per piece), longM, holdout }.
 * Returns the fitted pieces and the per-station errors. Knots start every 200 m; every span holding a station past the
 * tolerance (position, or bank) gets a knot at its midpoint, until none does or a piece reaches the cap.
 */
function fitTrack(mc, opts = {}) {
  const tol = opts.tol || 5, bankTol = (opts.bankTolDeg || 5) * DEG, cap = opts.cap || 500, st = mc.st;
  const sp = splitPoints(mc, opts.longM), pieces = piecesOf(mc, sp).map((p) => { const a = p.s[0], b = p.s[p.s.length - 1], m = Math.max(0, Math.floor((b - a) / 200) - 0), inner = []; for (let j = 1; j <= m; j++) { const t = a + (j * (b - a)) / (m + 1); if (t > a + 1e-6 && t < b - 1e-6) inner.push(t); } return { ...p, a, b, inner }; });
  const use = (i) => !st[i].flag && (!opts.holdout || i % 2 === 0);   // the hold-out fits the even stations only
  let iter = 0, fitPos, fitBank, errs, capped = false, bankData = null;
  for (; iter < 40; iter++) {
    pieces.forEach((p) => { p.U = knotsOf(p.a, p.b, p.inner); });
    // the joints: G2 between road pieces (and the closure), none at a jump
    const joints = [];
    pieces.forEach((P, pi) => { const Q = (pi + 1) % pieces.length; if (P.closesOnItself) joints.push({ a: { piece: pi, s: P.b }, b: { piece: pi, s: P.a }, orders: [0, 1, 2], shift: true }); else if (P.endType === 'g2' && pieces.length > 1) joints.push({ a: { piece: pi, s: P.b }, b: { piece: Q, s: pieces[Q].a }, orders: [0, 1, 2] }); });
    // position: channels x, y, z; a joint across the lap's wrap is the same point (no shift in space)
    const rows = []; pieces.forEach((P, pi) => P.idx.forEach((i, j) => { if (use(i)) rows.push({ piece: pi, s: P.s[j], values: st[i].p }); }));
    fitPos = fitSystem(pieces, rows, joints, 3);
    // the frame along the fitted line, and the measured bank against it
    // every station once, in lap order (a joint station, or a self-closing piece's repeated first station, only once)
    const seq = []; pieces.forEach((P, pi) => P.idx.forEach((i, j) => { if (j === P.idx.length - 1 && (P.endType === 'g2' || P.closesOnItself)) return; seq.push({ pi, i, s: P.s[j] }); }));
    const xs = seq.map((q) => [0, 1, 2].map((c) => evalPiece(fitPos, pieces, q.pi, c, q.s).v)), ts = seq.map((q) => unit([0, 1, 2].map((c) => evalPiece(fitPos, pieces, q.pi, c, q.s).d1)));
    const R = rmf(xs, ts, st[seq[0].i].n);
    const phi = []; seq.forEach((q, k) => { const nn = st[q.i].n, np = unit(sub(nn, scale(ts[k], dot(nn, ts[k])))), a = angleAbout(R[k], np, ts[k]); phi.push(k ? phi[k - 1] + wrapPi(a - phi[k - 1]) : a); });
    // the bank closes around the lap: carry the frame one more step back to the first station
    const rBack = rmf([xs[xs.length - 1], xs[0]], [ts[ts.length - 1], ts[0]], R[R.length - 1])[1], np0 = unit(sub(st[seq[0].i].n, scale(ts[0], dot(st[seq[0].i].n, ts[0]))));
    const phiWrap = phi[phi.length - 1] + wrapPi(angleAbout(rBack, np0, ts[0]) - phi[phi.length - 1]), netPhi = phiWrap - phi[0];
    const bankRows = seq.map((q, k) => ({ piece: q.pi, s: q.s, values: [use(q.i) ? phi[k] : null] }));
    bankData = { phi, netPhi };
    // the joint where the lap WRAPS (a self-closing piece, or the last piece into the first) carries the whole lap's bank
    // change, measured against the frame carried round: C_end − C_start = netPhi. Every other G2 joint carries none.
    const isWrap = (j) => j.shift || (j.a.piece === pieces.length - 1 && j.b.piece === 0);
    fitBank = fitSystem(pieces, bankRows, joints.map((j) => (isWrap(j) ? { ...j, rhs: [[netPhi], [0], [0]] } : j)), 1);
    // errors at every station, and the spans past tolerance
    errs = seq.map((q, k) => {
      const pos = len(sub(xs[k], st[q.i].p)), f = evalPiece(fitBank, pieces, q.pi, 0, q.s).v, U = rotAbout(R[k], ts[k], f);
      const nn = st[q.i].n, np = unit(sub(nn, scale(ts[k], dot(nn, ts[k]))));
      return { ...q, pos, bank: Math.abs(angleAbout(U, np, ts[k])), flag: st[q.i].flag };
    });
    let inserted = 0;
    pieces.forEach((P, pi) => {
      const nCP = P.U.length - 4; if (nCP >= cap) { capped = true; return; }
      const bad = new Set(); errs.forEach((e) => { if (e.pi !== pi || !use(e.i)) return;   // only stations that are FITTED steer the knots (a held-out station never does)
      if (e.pos > tol || e.bank > bankTol) { const b = basis(P.U, e.s); bad.add(b.first + 3); } });
      // a span is split only while it holds at least 4 FITTED stations, so each half keeps data to fit: shorter spans had
      // none, the ridge left them free, and a hold-out fit ran away to the cap (498 of 500 on Serpents; the D184 hand-back)
      const inSpan = (lo, hi) => P.idx.reduce((c, i, j) => c + (use(i) && P.s[j] >= lo && P.s[j] < hi ? 1 : 0), 0);
      const add = []; for (const k of bad) { const lo = P.U[k], hi = P.U[k + 1]; if (inSpan(lo, hi) >= 4) add.push((lo + hi) / 2); }
      const room = cap - nCP; add.sort((u, v) => u - v).slice(0, room).forEach((t) => P.inner.push(t)); P.inner.sort((u, v) => u - v); inserted += Math.min(add.length, room);
    });
    if (!inserted) break;
  }
  return { pieces, sp, fitPos, fitBank, errs, bankData, iterations: iter + 1, capped };
}
function rotAbout(v, k, a) { const c = Math.cos(a), s = Math.sin(a); return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c))); }

/** The jump joints as FLIGHTS: at the design speed, does the ballistic arc from the fitted take-off land on the fitted road? */
function jumpChecks(t, mc, vKmh = MACH6.designSpeedKmh) {
  const out = [];
  t.pieces.forEach((P, pi) => {
    if (P.endType !== 'jump') return;
    const Q = t.pieces[(pi + 1) % t.pieces.length], at = (piece, ch, s) => evalPiece(t.fitPos, t.pieces, piece, ch, s);
    const A = [0, 1, 2].map((c) => at(pi, c, P.b).v), T = unit([0, 1, 2].map((c) => at(pi, c, P.b).d1)), h = unit([T[0], 0, T[2]]);
    const x = (p) => dot(sub(p, A), h), road = [];
    for (let s = Q.a; s <= Math.min(Q.b, Q.a + 250); s += 2) { const p = [0, 1, 2].map((c) => at((pi + 1) % t.pieces.length, c, s).v); road.push({ x: x(p), y: p[1] - A[1] }); }
    const D = road.length ? road[0].x : 0;
    if (!(D > 0)) { out.push({ atS: +(P.b % mc.L).toFixed(1), gap: D, note: 'the landing is not ahead of the take-off' }); return; }
    const r = checkJump({ D, dh: road[0].y, thetaRad: Math.asin(Math.max(-1, Math.min(1, T[1]))), v: vKmh / 3.6, landingRoad: road });
    out.push({ atS: +(P.b % mc.L).toFixed(1), gapM: +D.toFixed(1), dropM: +(-road[0].y).toFixed(1), landings: r.landings.map((L) => ({ g: L.g, caught: L.caught })) });
  });
  return out;
}

/** The summary of one fit (numbers only). DOF = the numbers stored: 4 per control point (x, y, z, bank), plus the knots. */
function summarise(t, tol) {
  const ok = t.errs.filter((e) => !e.flag), cps = t.pieces.map((P) => P.U.length - 4), knots = t.pieces.reduce((a, P) => a + P.inner.length + 2, 0);
  return { tolM: tol, pieces: t.pieces.length, jumps: t.pieces.filter((P) => P.endType === 'jump').length, controlPoints: cps.reduce((a, b) => a + b, 0), perPiece: cps, dof: 4 * cps.reduce((a, b) => a + b, 0) + knots,
    lineWithin5: +(ok.filter((e) => e.pos <= 5).length / ok.length).toFixed(4), lineP95: +pct(ok.map((e) => e.pos), 0.95).toFixed(2), lineMax: +Math.max(...ok.map((e) => e.pos)).toFixed(2),
    bankWithin5: +(ok.filter((e) => e.bank <= 5 * DEG).length / ok.length).toFixed(4), bankP95Deg: +(pct(ok.map((e) => e.bank), 0.95) / DEG).toFixed(2), iterations: t.iterations, capped: t.capped };
}

module.exports = { roadTris, rayIndex, crossSection, meshCentreline, splitPoints, piecesOf, knotsOf, basis, bandChol, denseSolve, fitSystem, evalPiece, rmf, fitTrack, jumpChecks, summarise };

if (require.main === module) {
  const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
  const VALUED = ['--layout', '--tol', '--write'], [dir, readFile] = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
  if (!dir || !readFile) { console.error('usage: node tools/piecewise.cjs <track folder> <read.json> [--layout L] [--tol 5] [--curve] [--write <name>]'); process.exit(1); }
  const t0 = Date.now(), ix = rayIndex(roadTris(dir, flag('--layout', null))), mc = meshCentreline(JSON.parse(fs.readFileSync(readFile, 'utf8')), ix);
  const tol = +flag('--tol', 5), main = fitTrack(mc, { tol }), hold = fitTrack(mc, { tol, holdout: true });
  // the hold-out: fitted on the even stations only, scored on the odd ones (not a verdict; how well the equation interpolates)
  const odd = hold.errs.filter((e) => e.i % 2 === 1 && !e.flag);
  const report = { method: 'p-d184-scripts-E §1', lapM: +mc.L.toFixed(1), stations: mc.st.length, missingSurface: mc.missing, flagged: mc.st.map((x, i) => (x.flag ? i : -1)).filter((i) => i >= 0),
    result: summarise(main, tol), holdout: { lineWithin5: +(odd.filter((e) => e.pos <= 5).length / odd.length).toFixed(4), lineP95: +pct(odd.map((e) => e.pos), 0.95).toFixed(2) }, jumps: jumpChecks(main, mc) };
  if (args.includes('--curve')) report.curve = [10, 5, 2, 1].map((tt) => { const r = summarise(fitTrack(mc, { tol: tt }), tt); return { tolM: tt, controlPoints: r.controlPoints, dof: r.dof, lineWithin: r.lineWithin5, capped: r.capped }; });
  const w = flag('--write', null);
  if (w) { const { writeLocal } = require('./fourier.cjs'); writeLocal(path.join(path.dirname(readFile), `${w}.pieces.json`), JSON.stringify({ schema: 't180b.pieces/1', lapM: mc.L, pieces: main.pieces.map((P, pi) => ({ a: P.a, b: P.b, knots: P.inner, endType: P.endType, x: [0, 1, 2].map((c) => Array.from(main.fitPos.x[c].slice(main.fitPos.off[pi], main.fitPos.off[pi] + P.U.length - 4))), bank: Array.from(main.fitBank.x[0].slice(main.fitBank.off[pi], main.fitBank.off[pi] + P.U.length - 4)) })) }) + '\n'); }
  report.seconds = Math.round((Date.now() - t0) / 1000);
  process.stdout.write(JSON.stringify(report, null, 1) + '\n');
}
