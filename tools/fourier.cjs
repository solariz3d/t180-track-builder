// fourier.cjs: M4, "the length of each track's equation" (the keeper's design notes §12, registered there before any fit;
// the method in exo_memory/handback/p-m4-equations-E_2026-09-28.md §1, written before the first track was fitted).
// Each function of a read lap is fitted as a Fourier series in s (src/doc/equation.js has the form), truncated at N
// harmonics, and the centreline and frame are REBUILT from the truncated series by the builder's own geometry core
// (src/geom buildPath), after the closure projection. The smallest N at which the rebuild stays within 5 m of the read
// line on ≥ 95% of the lap and the bank within 5° on ≥ 95% is that track's equation length.
//   sample    the read's road stations, resampled linearly in s onto M = round(lap/4) points (Δs = lap/M ≈ 4 m), s being the
//             centre polyline's own 3-D arc length (NOT the reader's walked d, about 0.5% longer); a
//             jump's flight is the straight chord from take-off to landing (the read carries d across it)
//   angles    T = the centred difference of the centreline over ±Δs; heading θ = atan2(Tx, Tz), pitch p = asin(Ty),
//             kept continuous through vertical (the geometry's own convention: past ±90° θ keeps its meaning); roll φ =
//             the read normal's angle about T from the geometry's gravity frame; each unwrapped, with its whole turns
//             over the lap as `net`
//   fit       the periodic remainder f − net·s/L by its DFT (least squares on a uniform grid), truncated at N
//   rebuild   one geometry segment per Δs: k0/k1 and kp0/kp1 = the series' heading and pitch rates at its ends,
//             roll0/roll1 = the roll series; start at the read's first point, heading and pitch
//   closure   the least-norm correction of harmonics 1 … |heading turns| + 3 of θ and p and of p's mean, weighted by k² (their
//             rate energy; the mean as k = 1),
//             that makes the rebuilt end meet its start (Newton on buildPath's own end gap, to 1 mm); the heading, pitch
//             and roll close by construction (whole turns, and the trapezoid sum of a periodic series is exact)
//   score     every read road station: the distance to the rebuilt line (samples within ±150 m of its s, refined on the
//             segment), and the bank error = the angle about the read tangent between the read normal and the
//             rebuilt U; pass = both within tolerance on ≥ 95% of stations
// Prints SUMMARY NUMBERS only. Coefficient files are written ONLY into a gitignored, untracked path (reads/): an
// equation that rebuilds a track within 5 m IS that track's layout (§12). No curve of any track is printed.
//   node tools/fourier.cjs sweep <reads dir> [--write]      the 13 M1 layouts; --write also saves reads/<name>.equation.json
//   node tools/fourier.cjs one <read.json> [--write]        one layout
//   node tools/fourier.cjs open <equation.json> "<name>"    THE LOADER: the equation as a document in the builder's track
//                                                            folder (%APPDATA%/com.solariz3d.t180-track-builder/tracks)
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { buildPath } = require('../src/geom/index.js');
const EQ = require('../src/doc/equation.js');

const TAU = 2 * Math.PI, DEG = Math.PI / 180, LINE_M = 5, BANK_DEG = 5, SHARE = 0.95;
const NS = [1, 2, 3, 5, 8, 12, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000];
const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], add = (u, v, s = 1) => [u[0] + v[0] * s, u[1] + v[1] * s, u[2] + v[2] * s];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], len = (u) => Math.hypot(u[0], u[1], u[2]);
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const unit = (u) => { const l = len(u) || 1; return [u[0] / l, u[1] / l, u[2] / l]; };
const tangentOf = (th, p) => [Math.cos(p) * Math.sin(th), Math.sin(p), Math.cos(p) * Math.cos(th)];
const wrapPi = (x) => x - TAU * Math.round(x / TAU);
const pct = (xs, p) => { const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

// ── sampling a read ──────────────────────────────────────────────────────────────────────────────────────────────────
function sampleRead(read) {
  const last = read.stations[read.stations.length - 1];
  if (read.end !== 'closed' || !last.closed) throw new Error('the read does not close');
  // s is the CENTRE POLYLINE'S OWN 3-D arc length (a jump is its straight chord), not the reader's d: d is the distance
  // the reader WALKED, re-centring every step, and it runs about 0.5% longer than the line it records. Integrating the
  // line's own angles over d overshot Sakura's centreline by 110 m (the M4 diagnosis, 2026-09-28). Each station keeps
  // its reader distance as d0.
  // READER GLITCHES (declared, p-m4-equations-E §1c): a road station whose centre lies more than 3 m off the chord of the
  // stations two either side (±8 m) is the reader's re-centring, not road: a 10.7 m-radius bend is the tightest that sags
  // 3 m over ±8 m. It is replaced by linear interpolation between its nearest unflagged neighbours (centre and normal). Not
  // tested where the ±2 window spans a jump's gap. Every station is still SCORED, glitch or not.
  const raw0 = read.stations.filter((x) => x.c), nR = raw0.length, flag = new Array(nR).fill(false);
  for (let k = 0; k < nR; k++) {
    const w = [-2, -1, 0, 1, 2].map((o) => raw0[(k + o + nR) % nR]);
    if (w.some((x, j) => j && Math.abs(x.d - w[j - 1].d) > 12 && Math.abs(x.d - w[j - 1].d) < read.stations[read.stations.length - 1].d / 2)) continue;   // a gap in the window
    const A = w[0].c, B = w[4].c, P = w[2].c, ab = sub(B, A), L2 = dot(ab, ab), t = L2 ? Math.max(0, Math.min(1, dot(sub(P, A), ab) / L2)) : 0;
    if (len(sub(P, add(A, ab, t))) > 3) flag[k] = true;
  }
  const fixed = raw0.map((x) => ({ ...x }));
  for (let k = 0; k < nR; k++) if (flag[k]) {
    let a = k, b = k; while (flag[(a - 1 + nR) % nR] && a - k > -nR) a--; while (flag[(b + 1) % nR] && b - k < nR) b++;
    const P = raw0[(a - 1 + nR) % nR], Q = raw0[(b + 1) % nR], t = (k - a + 1) / (b - a + 2);
    fixed[k].c = P.c.map((v, i) => v + (Q.c[i] - v) * t); fixed[k].n = unit(P.n.map((v, i) => v + (Q.n[i] - v) * t));
  }
  const glitches = flag.filter(Boolean).length;
  const St = []; let acc = 0;
  for (const x of fixed) { if (St.length) acc += len(sub(x.c, St[St.length - 1].c)); St.push({ ...x, d0: x.d, d: acc }); }
  const Larc = acc + len(sub(St[0].c, St[St.length - 1].c)), M = Math.round(Larc / 4);
  const ext = [...St, { ...St[0], d: Larc }];   // the lap wraps from its last station to its first
  const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const at = (d) => { let lo = 0, hi = ext.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ext[m].d <= d) lo = m; else hi = m; } const A = ext[lo], B = ext[hi], t = B.d > A.d ? (d - A.d) / (B.d - A.d) : 0; return { A, B, t }; };
  // EQUAL CHORDS (the M4 diagnosis): the samples are M points on the read's polyline, each exactly c from the last, with c
  // found by bisection so that the M-th point lands back on the first. The discrete line is then M chords of length c, and
  // a rebuild with segments of length c reproduces it by construction; with equal ARC-length samples the chords varied in
  // length at every noise corner, and a fixed step drifted 8–12 m over 40 km before any fitting. s = i·c; L = M·c.
  const P = (d) => { const { A, B, t } = at(d); return lerp(A.c, B.c, t); };
  const walk = (c) => {   // the params of M points each c from the last, along the polyline from d = 0
    const out = [0]; let d = 0, q = P(0), k = 0;
    for (let i = 1; i <= M; i++) {
      let found = null;
      for (; k < ext.length - 1; k++) {
        const A = ext[k].c, B = ext[k + 1].c, d0 = ext[k].d, d1 = ext[k + 1].d; if (d1 <= d) continue;
        const u0 = d1 > d0 ? Math.max(0, (d - d0) / (d1 - d0)) : 0, ab = sub(B, A), aq = sub(A, q), a2 = dot(ab, ab), b2 = 2 * dot(ab, aq), c2 = dot(aq, aq) - c * c;
        const disc = b2 * b2 - 4 * a2 * c2; if (!(a2 > 0) || disc < 0) continue;
        const r = (-b2 + Math.sqrt(disc)) / (2 * a2);   // the far root: leaving the sphere of radius c around q
        if (r >= u0 - 1e-12 && r <= 1 + 1e-12) { found = d0 + (d1 - d0) * Math.min(1, Math.max(u0, r)); break; }
      }
      if (found === null) return null;
      d = found; q = P(d); out.push(d);
    }
    return out;
  };
  let lo = 0.9 * Larc / M, hi = Larc / M, pars = null;
  for (let it = 0; it < 60; it++) { const c = (lo + hi) / 2, w = walk(c); if (!w || w[M] > Larc) hi = c; else lo = c; }
  pars = walk(lo); if (!pars) throw new Error('equal-chord resampling found no step');
  const cStep = lo, L = M * cStep, ds = cStep;
  const pos = [], nrm = [], wl = [], wr = [], psiL = [[], [], [], []], psiR = [[], [], [], []];
  for (let i = 0; i < M; i++) {
    const { A, B, t } = at(pars[i]); pos.push(lerp(A.c, B.c, t)); nrm.push(unit(lerp(A.n, B.n, t)));
    wl.push(A.wl + (B.wl - A.wl) * t); wr.push(A.wr + (B.wr - A.wr) * t);
    for (let k = 0; k < 4; k++) { psiL[k].push(A.psiL[k] + (B.psiL[k] - A.psiL[k]) * t); psiR[k].push(A.psiR[k] + (B.psiR[k] - A.psiR[k]) * t); }
  }
  // angles of each CHORD pos[i] → pos[i+1], at its midpoint s = (i + ½)·Δs (fitOne shifts the fitted series back by ½Δs):
  // integrating the chords reproduces the resampled line by construction, where centred tangents drifted about 10 m on
  // Sakura. Continuous through vertical and unwrapped; index M is the wrap back to 0, for the whole turns.
  // HEADING NEAR VERTICAL (the M4 diagnosis: Sakura climbs to 82–88°, where a chord's heading swings ±40° from one chord
  // to the next and the branch guess flipped). The geometry's own convention (src/geom/path.js CURVE MODEL): θ keeps its
  // meaning through vertical and p carries on past 90°. So θ is the chord's heading where its horizontal part is ≥ 0.3
  // (|p| < 72.5°), unwrapped; across a stretch nearer vertical than that it is interpolated from the heading before it to
  // the heading after it; and p is then taken CONSISTENT with θ, p = atan2(Ty, T·h(θ)), unwrapped, so it passes 90° when
  // the road comes back over. What is dropped is the chord's horizontal part across θ, small exactly where it is dropped.
  const Ts = []; for (let i = 0; i <= M; i++) Ts.push(unit(sub(pos[(i + 1) % M], pos[i % M])));
  const H = 0.3, good = Ts.map((T) => Math.hypot(T[0], T[2]) >= H), th = new Array(M + 1), pp = [], ph = [];
  let i0 = good.indexOf(true); if (i0 < 0) throw new Error('no chord of this lap is further than 72.5° from vertical');
  { let prev = Math.atan2(Ts[i0][0], Ts[i0][2]); th[i0] = prev; let after = false, off = 0; for (let k = 1; k <= M; k++) { const i = (i0 + k) % (M + 1); if (!good[i]) { after = true; continue; } const a2 = Math.atan2(Ts[i][0], Ts[i][2]); if (after && Math.abs(wrapPi(a2 + off + Math.PI - prev)) < Math.abs(wrapPi(a2 + off - prev))) off += Math.PI; after = false; prev = prev + wrapPi(a2 + off - prev); th[i] = prev; } }
  // Leaving a near-vertical stretch, the chords' headings may be read as a or a + π from there on (an offset that persists
  // until the next such stretch), whichever keeps θ nearer the heading before it: a road that came OVER the top keeps its θ
  // and p passes 90° (a vertical loop: θ constant, p gains 2π), as the
  // geometry's own loop does; interpolating to a + π flipped the representation instead (test/fourier.test.js, 01 §5).
  // (index M is chord 0 again: the wrap; stretches without a heading take it by interpolation between their good ends)
  for (let i = 0; i <= M; i++) if (th[i] === undefined) {
    let a0 = i, b0 = i; while (th[(a0 - 1 + M + 1) % (M + 1)] === undefined) a0--; while (th[(b0 + 1) % (M + 1)] === undefined) b0++;
    const A = th[(a0 - 1 + M + 1) % (M + 1)], B = th[(b0 + 1) % (M + 1)], Bu = A + wrapPi(B - A), t = (i - a0 + 1) / (b0 - a0 + 2);
    th[i] = A + (Bu - A) * t;
  }
  // unwrap θ along the lap from index 0 (the pass above started at the first good chord)
  for (let i = 1; i <= M; i++) th[i] = th[i - 1] + wrapPi(th[i] - th[i - 1]);
  for (let i = 0; i <= M; i++) {
    const T = Ts[i], n = unit(add(nrm[i % M], nrm[(i + 1) % M]));
    const p = Math.atan2(T[1], T[0] * Math.sin(th[i]) + T[2] * Math.cos(th[i])); pp.push(i ? pp[i - 1] + wrapPi(p - pp[i - 1]) : p);
    const R = [Math.cos(th[i]), 0, -Math.sin(th[i])], Tm = tangentOf(th[i], pp[i]), U0 = cross(Tm, R), np = unit(sub(n, Tm.map((x) => x * dot(n, Tm))));
    const phi = Math.atan2(-dot(np, R), dot(np, U0)); ph.push(i ? ph[i - 1] + wrapPi(phi - ph[i - 1]) : phi);
  }
  const nets = { theta: th[M] - th[0], pitch: pp[M] - pp[0], roll: ph[M] - ph[0] };
  for (const [k, v] of Object.entries(nets)) if (Math.abs(v / TAU - Math.round(v / TAU)) > 0.02) throw new Error(`${k}: the lap's whole turns are ${(v / TAU).toFixed(3)}, not whole: the angle representation does not close`);
  const sOf = (d0) => { let k = 0; while (k + 1 < St.length && St[k + 1].d0 <= d0) k++; return St[k].d; };   // a jump sits at its take-off station
  const jumps = read.stations.filter((x) => x.jump).map((j) => ({ s: sOf(j.d), gap: Math.hypot(j.to[0] - j.from[0], j.to[2] - j.from[2]), drop: j.from[1] - j.to[1] }));
  const scored = St.map((x, k) => ({ ...x, c: raw0[k].c, n: raw0[k].n }));   // score against the read as it is
  // THE BUILD STEP: the chords' own mean length. A chord between arc-length samples of the read's slightly zig-zag line is
  // shorter than Δs (the reader's noise lengthens its own line by about 0.03%), so turning each chord's direction into Δs
  // of road drifted 10–15 m over 40 km before any fitting (the M4 diagnosis). The Fourier grid in s stays uniform.
  return { L, Larc, M, ds, dsB: ds, closeM: len(sub(pos[0], P(pars[M] % Larc))), pos, nrm, stations: scored, glitches, jumps, raw: { theta: th.slice(0, M), pitch: pp.slice(0, M), roll: ph.slice(0, M), wl, wr, psiL, psiR }, nets: Object.fromEntries(Object.entries(nets).map(([k, v]) => [k, TAU * Math.round(v / TAU)])) };
}

// ── the DFT ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function dft(x, net, M) {
  const r = x.map((v, i) => v - net * i / M), K = Math.floor((M - 1) / 2), cs = new Float64Array(M), sn = new Float64Array(M);
  for (let j = 0; j < M; j++) { cs[j] = Math.cos(TAU * j / M); sn[j] = Math.sin(TAU * j / M); }
  const a = new Float64Array(K), b = new Float64Array(K); let c0 = 0; for (const v of r) c0 += v; c0 /= M;
  for (let k = 1; k <= K; k++) { let sa = 0, sb = 0; for (let i = 0, j = 0; i < M; i++, j = (j + k) % M) { sa += r[i] * cs[j]; sb += r[i] * sn[j]; } a[k - 1] = 2 * sa / M; b[k - 1] = 2 * sb / M; }
  return { net, c0, a, b };
}
const cut = (f, N) => ({ net: f.net, c0: f.c0, a: Array.from(f.a.slice(0, N)), b: Array.from(f.b.slice(0, N)) });
/** A series fitted to samples at s = (j + ½)·Δs, re-expressed in s: f(s) = g(s − ½Δs). Exact, harmonic by harmonic. */
function halfShift(f, L, M) {
  const a = new Float64Array(f.a.length), b = new Float64Array(f.b.length);
  for (let k = 1; k <= f.a.length; k++) { const w = Math.PI * k / M, c = Math.cos(w), sn = Math.sin(w); a[k - 1] = f.a[k - 1] * c - f.b[k - 1] * sn; b[k - 1] = f.a[k - 1] * sn + f.b[k - 1] * c; }
  return { net: f.net, c0: f.c0 - f.net * 0.5 / M, a, b };
}
/** A series' values and rates at every grid node 0..M (fast: the twiddle table). */
function nodes(f, L, M) {
  const v = new Float64Array(M + 1), r = new Float64Array(M + 1), cs = new Float64Array(M), sn = new Float64Array(M);
  for (let j = 0; j < M; j++) { cs[j] = Math.cos(TAU * j / M); sn[j] = Math.sin(TAU * j / M); }
  for (let i = 0; i <= M; i++) {
    let x = f.net * i / M + f.c0, y = f.net / L;
    for (let k = 1, j = i % M; k <= f.a.length; k++, j = (j + i) % M) { const c = TAU * k / L; x += f.a[k - 1] * cs[j] + f.b[k - 1] * sn[j]; y += c * (f.b[k - 1] * cs[j] - f.a[k - 1] * sn[j]); }
    v[i] = x; r[i] = y;
  }
  return { v, r };
}

// ── the rebuild, with the closure projection ─────────────────────────────────────────────────────────────────────────
function segmentsOf(sm, TH, PP, PH) {
  const segs = [];
  // each segment turns and climbs by EXACTLY the series' change across it (a constant rate over the segment), so the
  // builder's heading and pitch equal the equation's at every node; linear node RATES drifted (a trapezoid of the rate is
  // not the series' own angle where the rate swings between nodes)
  for (let i = 0; i < sm.M; i++) { const k = (TH.v[i + 1] - TH.v[i]) / (sm.dsB || sm.ds), kp = (PP.v[i + 1] - PP.v[i]) / (sm.dsB || sm.ds); segs.push({ length: (sm.dsB || sm.ds), k0: k, k1: k, kp0: kp, kp1: kp, roll0: PH.v[i], roll1: PH.v[i + 1], heartline: 0 }); }
  return segs;
}
function build(sm, th, pp, ph) {
  const TH = nodes(th, sm.L, sm.M), PP = nodes(pp, sm.L, sm.M), PH = nodes(ph, sm.L, sm.M);
  const path = buildPath(segmentsOf(sm, TH, PP, PH), { step: 4, start: { pos: sm.pos[0], theta: TH.v[0], p: PP.v[0] } });
  return { path, TH, PP, PH, gap: sub(path._end.x, path.samples[0]._x) };
}
/** Least-norm (weights k²) correction of the 1st and 2nd harmonics of θ and p that closes the rebuilt position. */
function closeLoop(sm, th, pp, ph) {
  th = { ...th, a: th.a.slice(), b: th.b.slice() }; pp = { ...pp, a: pp.a.slice(), b: pp.b.slice() };
  // harmonics 1 … |whole heading turns| + 3: on a lap that winds n times, the harmonics near n move its end point; the 1st
  // and 2nd alone barely do (their effect averages over the windings), so closing even a few metres took a correction
  // that bent the whole line (the M4 diagnosis: Centrifuge, 10 turns, bent 84 m at the exact fit)
  const K = Math.min(Math.round(Math.abs(th.net) / TAU) + 3, th.a.length, pp.a.length), vars = [];
  for (const [f, name] of [[th, 'th'], [pp, 'p']]) for (let k = 1; k <= K; k++) for (const ab of ['a', 'b']) vars.push({ f, name, k, ab });
  // the net CLIMB is not reachable by any periodic pitch term (a zero-mean change integrates to nothing at first order),
  // so the pitch's mean is a variable too, weighted as a first harmonic
  vars.push({ f: pp, name: 'p', k: 0, ab: 'c0' });
  let r = build(sm, th, pp, ph); const gap0 = len(r.gap);
  for (let it = 0; it < 12 && len(r.gap) > 1e-3 && vars.length >= 3; it++) {
    // the Jacobian of the end point by the rectangle rule on the nodes: ∂x/∂c = Σ ∂T/∂angle · basis · Δs
    const J = [[], [], []];
    for (const v of vars) {
      const col = [0, 0, 0];
      for (let i = 0; i < sm.M; i++) {
        const t = r.TH.v[i], p = r.PP.v[i], w = TAU * v.k * i / sm.M, basis = v.ab === 'c0' ? 1 : v.ab === 'a' ? Math.cos(w) : Math.sin(w);
        const d = v.name === 'th' ? [Math.cos(p) * Math.cos(t), 0, -Math.cos(p) * Math.sin(t)] : [-Math.sin(p) * Math.sin(t), Math.cos(p), -Math.sin(p) * Math.cos(t)];
        for (let q = 0; q < 3; q++) col[q] += d[q] * basis * (sm.dsB || sm.ds);
      }
      for (let q = 0; q < 3; q++) J[q].push(col[q]);
    }
    const Wi = vars.map((v) => 1 / Math.max(1, v.k * v.k)), A = [0, 1, 2].map((a) => [0, 1, 2].map((b) => J[a].reduce((s, x, j) => s + x * Wi[j] * J[b][j], 0)));
    const y = solve3(A, r.gap.map((x) => -x)), delta = vars.map((_, j) => Wi[j] * (J[0][j] * y[0] + J[1][j] * y[1] + J[2][j] * y[2]));
    vars.forEach((v, j) => { if (v.ab === 'c0') v.f.c0 += delta[j]; else v.f[v.ab][v.k - 1] += delta[j]; });
    r = build(sm, th, pp, ph);
  }
  return { ...r, th, pp, gap0, gap1: len(r.gap) };
}
function solve3(A, b) {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r; [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; } }
  return [0, 1, 2].map((i) => m[i][3] / m[i][i]);
}

// ── the score ────────────────────────────────────────────────────────────────────────────────────────────────────────
function score(sm, path) {
  const P = path.samples, dist = [], bank = [];
  let j = 0;
  for (const st of sm.stations) {
    while (j + 1 < P.length && P[j + 1].s <= st.d - 150) j++;
    let best = Infinity, bi = -1;
    for (let k = j; k < P.length && P[k].s <= st.d + 150; k++) {
      const a = P[k].pos, e = len(sub(st.c, a)); if (e < best) { best = e; bi = k; }
      if (k + 1 < P.length) { const ab = sub(P[k + 1].pos, a), L2 = dot(ab, ab); if (L2 > 0) { const u = Math.max(0, Math.min(1, dot(sub(st.c, a), ab) / L2)), e2 = len(sub(st.c, add(a, ab, u))); if (e2 < best) { best = e2; bi = u < 0.5 ? k : k + 1; } } }
    }
    dist.push(best);
    if (bi >= 0) {
      const T = unit(st.f), n = unit(sub(st.n, T.map((x) => x * dot(st.n, T)))), U = P[bi].U, u = unit(sub(U, T.map((x) => x * dot(U, T))));
      bank.push(Math.abs(Math.atan2(dot(T, cross(n, u)), dot(n, u))) / DEG);
    } else bank.push(Infinity);
  }
  const share = (xs, tol) => xs.filter((x) => x <= tol).length / xs.length;
  return { lineShare: share(dist, LINE_M), bankShare: share(bank, BANK_DEG), p95LineM: pct(dist, 0.95), p95BankDeg: pct(bank, 0.95), stations: dist.length };
}
/** The cross-section series on the grid: within 1 m (widths) and 5° (tilts) on ≥ 95% of samples, at N. */
function sectionOK(sm, fits, N) {
  const ok = (f, raw, tol) => { const v = nodes(cut(f, N), sm.L, sm.M).v; let n = 0; for (let i = 0; i < sm.M; i++) if (Math.abs(v[i] - raw[i]) <= tol) n++; return n / sm.M >= SHARE; };
  return { width: ok(fits.wl, sm.raw.wl, 1) && ok(fits.wr, sm.raw.wr, 1), psi: [0, 1, 2, 3].every((k) => ok(fits.psiL[k], sm.raw.psiL[k], 5) && ok(fits.psiR[k], sm.raw.psiR[k], 5)) };
}
/** The N that holds 99% of a series' power (its rate's power for the angles: the curvature the car feels). */
function n99(f, isAngle) {
  const pw = Array.from(f.a, (a, i) => (a * a + f.b[i] * f.b[i]) * (isAngle ? (i + 1) ** 2 : 1)), tot = pw.reduce((s, x) => s + x, 0);
  let acc = 0; for (let k = 0; k < pw.length; k++) { acc += pw[k]; if (acc >= 0.99 * tot) return k + 1; } return pw.length;
}

// ── one layout ───────────────────────────────────────────────────────────────────────────────────────────────────────
function fitOne(read, opts = {}) {
  const sm = sampleRead(read), K = Math.floor((sm.M - 1) / 2);
  const fits = { theta: halfShift(dft(sm.raw.theta, sm.nets.theta, sm.M), sm.L, sm.M), pitch: halfShift(dft(sm.raw.pitch, sm.nets.pitch, sm.M), sm.L, sm.M), roll: halfShift(dft(sm.raw.roll, sm.nets.roll, sm.M), sm.L, sm.M),
    wl: dft(sm.raw.wl, 0, sm.M), wr: dft(sm.raw.wr, 0, sm.M), psiL: sm.raw.psiL.map((x) => dft(x, 0, sm.M)), psiR: sm.raw.psiR.map((x) => dft(x, 0, sm.M)) };
  const list = [...NS.filter((n) => n < K), K], rows = [];
  let first = null;
  for (const N of list) {
    const c = closeLoop(sm, cut(fits.theta, N), cut(fits.pitch, N), cut(fits.roll, N)), s = score(sm, c.path);
    const row = { N, lineShare: +s.lineShare.toFixed(4), bankShare: +s.bankShare.toFixed(4), p95LineM: +s.p95LineM.toFixed(2), p95BankDeg: +s.p95BankDeg.toFixed(2), gapBeforeM: +c.gap0.toFixed(2), gapAfterM: +c.gap1.toExponential(1) };
    rows.push(row);
    if (!first && s.lineShare >= SHARE && s.bankShare >= SHARE) { first = { N, c }; if (!opts.all) break; }
  }
  const firstOf = (key) => { const r = rows.find((x) => x[key] >= SHARE); return r ? r.N : null; };
  const secN = (key) => { for (const N of list) if (sectionOK(sm, fits, N)[key]) return N; return null; };
  const out = { lapM: sm.L, glitches: sm.glitches, M: sm.M, dsM: +sm.ds.toFixed(3), Kmax: K, jumps: sm.jumps.length, turns: { theta: sm.nets.theta / TAU, pitch: sm.nets.pitch / TAU, roll: sm.nets.roll / TAU },
    N: first ? first.N : null, Nline: firstOf('lineShare'), Nbank: firstOf('bankShare'), Nwidth: secN('width'), Npsi: secN('psi'),
    n99: { headingRate: n99(fits.theta, true), pitchRate: n99(fits.pitch, true), roll: n99(fits.roll, true) }, sweep: rows };
  let eq = null;
  const Neq = first ? first.N : K, c = first ? first.c : null;
  if (opts.equation) {
    const cc = c || closeLoop(sm, cut(fits.theta, Neq), cut(fits.pitch, Neq), cut(fits.roll, Neq));
    eq = EQ.checkEquation({ schema: EQ.SCHEMA, track: opts.track || read.track || '', lapM: sm.L, N: Neq, start: { pos: sm.pos[0], theta: cc.TH.v[0], p: cc.PP.v[0] },
      series: { theta: cc.th, pitch: cc.pp, roll: cut(fits.roll, Neq), wl: cut(fits.wl, Neq), wr: cut(fits.wr, Neq), psiL: fits.psiL.map((f) => cut(f, Neq)), psiR: fits.psiR.map((f) => cut(f, Neq)) }, jumps: sm.jumps });
  }
  return { out, eq };
}

// ── the privacy guard ────────────────────────────────────────────────────────────────────────────────────────────────
/** Write a coefficient file only where git ignores it and tracks nothing: fail closed if git cannot say. */
function writeLocal(file, text) {
  // git runs from the nearest folder that EXISTS: in a fresh checkout reads/ is not there yet, and a git run from a missing folder
  // crashed the first read (D184 gap G1, p-d184-read-B). The folder is created only AFTER both checks pass, so a refused path
  // never leaves a folder behind.
  const dir = path.dirname(path.resolve(file));
  let cwd = dir; while (!fs.existsSync(cwd) && path.dirname(cwd) !== cwd) cwd = path.dirname(cwd);
  const git = (args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const ign = git(['check-ignore', '-q', path.resolve(file)]);
  if (ign.status !== 0) throw new Error(`refusing to write ${path.basename(file)}: git does not ignore that path (an equation of a real track is its layout; it stays in reads/)`);
  const tracked = git(['ls-files', '--error-unmatch', path.resolve(file)]);
  if (tracked.status === 0) throw new Error(`refusing to write ${path.basename(file)}: that path is tracked`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, text);
}

const M1 = ['rainbow_rd', 'centrifuge', 'hazenloop', 'Chases_Onuris__layout_long', 'sakura_speedway', 'coast', 'ohyeah2389_nordic', 'thunderhead_raceway__normal',
  'eagleton__eagleton', 'ohyeah2389_t180testtrack', 'bowltrack_2', 't180_bowltrack', 'serpents_spiral'];

module.exports = { sampleRead, dft, cut, halfShift, nodes, build, closeLoop, score, fitOne, writeLocal, M1, NS };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2), write = process.argv.includes('--write');
  if (cmd === 'sweep' || cmd === 'one') {
    const files = cmd === 'sweep' ? M1.map((n) => path.join(a, `${n}.read.json`)) : [a];
    const res = [];
    for (const f of files) {
      const t0 = Date.now(), name = path.basename(f, '.read.json'), { out, eq } = fitOne(JSON.parse(fs.readFileSync(f, 'utf8')), { equation: write, track: name, all: process.argv.includes('--all') });
      if (write) writeLocal(path.join(path.dirname(f), `${name}.equation.json`), JSON.stringify(eq) + '\n');
      res.push({ layout: name, ...out, seconds: Math.round((Date.now() - t0) / 1000) });
      console.error(`${name}: N ${out.N} (line ${out.Nline}, bank ${out.Nbank}) in ${res[res.length - 1].seconds} s`);
    }
    const Nv = res.map((r) => r.N), le200 = Nv.filter((n) => n != null && n <= 200).length, over1000 = Nv.filter((n) => n == null || n > 1000).length;
    const verdict = { tracks: res.length, nLe200: le200, nOver1000OrNever: over1000, falsifierFired: over1000 > res.length / 2, predictionMet: le200 > res.length / 2 };
    process.stdout.write(JSON.stringify({ method: 'p-m4-equations-E §1', tolerance: { lineM: LINE_M, bankDeg: BANK_DEG, share: SHARE }, verdict: { ...verdict, verdict: verdict.falsifierFired ? 'FAILS' : 'PASS' }, layouts: res }, null, 1) + '\n');
  } else if (cmd === 'open') {
    if (!a || !b) { console.error('usage: node tools/fourier.cjs open <equation.json> "<track name>"'); process.exit(1); }
    const { serialize } = require('../src/doc/serial.js');
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(b)) throw new Error('a track name is 1 to 64 letters, digits, spaces, _ or -');
    const { doc, words, jumps } = EQ.equationToDoc(JSON.parse(fs.readFileSync(a, 'utf8')), { name: b });
    const dir = path.join(process.env.APPDATA || '', 'com.solariz3d.t180-track-builder', 'tracks'), file = path.join(dir, `${b}.t180track`);
    if (!process.env.APPDATA) throw new Error('no APPDATA: the builder keeps its tracks there');
    if (fs.existsSync(file)) throw new Error(`a track named "${b}" exists already; pick another name`);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, serialize(doc));
    console.log(`"${b}": ${words} words, ${jumps} jumps, in the builder's track list (Open → "${b}")`);
  } else { console.error('usage: node tools/fourier.cjs sweep <reads dir> [--write] | one <read.json> [--write] | open <equation.json> "<name>"'); process.exit(1); }
}
