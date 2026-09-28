// geodesic.cjs: M2 (design §8, pane C's registration p-d182-m2m3-C §0, sha256 e71c5555…): how much of a T-180's path
// curvature is GEODESIC (turning within the road surface) and how much is NORMAL (the surface itself bending under it),
// against the load, from replays.
//   node tools/geodesic.cjs <replay.acreplay> [...]                   (JSON to stdout: per replay, and the pooled score)
// PER FRAME, with loads.cjs's own smoothing and filters so the load is the number FINDINGS §3 reports:
//   positions smoothed over ±4 frames; v, a by central differences; N = blackbox's `nrm` (the plane of the four wheel
//   contacts, normalised); load = the specific force (a + g·ŷ) along N, in g;
//   κ = a⊥ / v² (a minus its component along v): the path's curvature vector;  κn = κ·N;  κg = |κ − κn N|;  share g = κg / |κ|.
// KEPT: wheels OK; not a teleport (the step not more than 3× speed·dt + 1 m, as loads.cjs); speed ≥ 30 m/s; |κ| ≥ 1/3000 m⁻¹.
// SCORE (registered): Spearman ρ(load, g) over every kept frame of every replay given, pooled; its 95% CI by moving-block
// bootstrap (blocks of 250 consecutive frames within a replay, 1,000 resamples, mulberry32 seed 1); the median g per load bin
// [0,3) [3,6) [6,10) [10,20) [20,40) ≥40 g. PASS iff the CI is entirely below 0 AND, over the bins holding ≥ 300 frames, the
// median never rises by more than 0.02 from one bin to the next. Reported beside it (not scored): ρ per replay.
'use strict';
const fs = require('fs'), path = require('path');
const BB = process.env.BLACKBOX ? path.join(process.env.BLACKBOX, 'ui/acreplay.js') : [path.join(process.env.USERPROFILE, 'blackbox'), path.join(process.env.USERPROFILE, 'Desktop', 'blackbox')].map((d) => path.join(d, 'ui/acreplay.js')).find((p) => fs.existsSync(p));
const blackbox = () => { if (!BB) throw new Error('blackbox not found: set BLACKBOX to its folder'); return require(BB); };   // only when a replay is read
const G = 9.81, W = 4, MIN_V = 30, MIN_K = 1 / 3000;
const BINS = [0, 3, 6, 10, 20, 40, Infinity];

function frames(file) {
  const { parseReplay, extractCar } = blackbox();
  const buf = fs.readFileSync(file), rep = parseReplay(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const ex = extractCar(rep, 0), N = ex.N, dt = ex.dt, P = ex.pos, sm = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { let s = 0, n = 0; for (let j = Math.max(0, i - W); j <= Math.min(N - 1, i + W); j++) { s += P[j * 3 + k]; n++; } sm[i * 3 + k] = s / n; }
  const out = [];
  for (let i = W + 2; i < N - W - 2; i++) {
    if (!ex.wheelsOk[i]) continue;
    const a = [0, 1, 2].map((k) => (sm[(i + 1) * 3 + k] - 2 * sm[i * 3 + k] + sm[(i - 1) * 3 + k]) / (dt * dt));
    const v = [0, 1, 2].map((k) => (sm[(i + 1) * 3 + k] - sm[(i - 1) * 3 + k]) / (2 * dt)), speed = Math.hypot(...v);
    if (speed < MIN_V) continue;
    const jump = Math.hypot(...[0, 1, 2].map((k) => P[(i + 1) * 3 + k] - P[i * 3 + k])); if (jump > speed * dt * 3 + 1) continue;
    let n = [ex.nrm[i * 3], ex.nrm[i * 3 + 1], ex.nrm[i * 3 + 2]]; const nl = Math.hypot(...n) || 1; n = n.map((x) => x / nl);
    const load = (a[0] * n[0] + (a[1] + G) * n[1] + a[2] * n[2]) / G;
    const t = v.map((x) => x / speed), at = a[0] * t[0] + a[1] * t[1] + a[2] * t[2];
    const kap = [0, 1, 2].map((k) => (a[k] - at * t[k]) / (speed * speed)), km = Math.hypot(...kap);
    if (km < MIN_K) continue;
    const kn = kap[0] * n[0] + kap[1] * n[1] + kap[2] * n[2], kg = Math.hypot(...[0, 1, 2].map((k) => kap[k] - kn * n[k]));
    out.push([load, kg / km, km, speed]);   // [load g, share, |κ|, speed m/s]
  }
  return { dt, N, frames: out };
}
/** mulberry32: the same seed, the same resamples */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function ranks(xs) { const idx = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]), r = new Float64Array(xs.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const m = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = m; i = j + 1; } return r; }
function spearman(pairs) {
  const a = ranks(pairs.map((p) => p[0])), b = ranks(pairs.map((p) => p[1])), n = pairs.length;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb);
}
const median = (xs) => { const s = xs.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

// M2b (registration exo_memory/loop/m2b_m3b_registration_2026-09-28.md, sha256 36b23de8…): the share against SPEED, which is
// not inside the share (κn is, via |κ|; load is, via v²κn). PASS iff the pooled CI is below 0, ρ < 0 on at least 4 of the
// replays alone, and over bins holding ≥ 300 frames the median never rises by more than 0.02. Beside it, not scored: ρ within
// each |κ| tercile, so a pass carried by "slow corners are tight" shows.
const SPEED_BINS = [30, 60, 90, 120, 150, 180, Infinity];
function scoreSpeed(runs) {
  const pairs = (fr) => fr.map((x) => [x[3], x[1]]);
  const all = runs.flatMap((r) => pairs(r.frames)), rho = spearman(all);
  const blocks = []; for (const r of runs) { const p = pairs(r.frames); for (let i = 0; i < p.length; i += 250) blocks.push(p.slice(i, i + 250)); }
  const rnd = prng(1), boot = [];
  for (let b = 0; b < 1000; b++) { const x = []; while (x.length < all.length) x.push(...blocks[Math.floor(rnd() * blocks.length)]); boot.push(spearman(x.slice(0, all.length))); }
  boot.sort((x, y) => x - y);
  const ci = [boot[24], boot[974]];
  const per = runs.map((r) => ({ file: r.file, rho: +spearman(pairs(r.frames)).toFixed(4) })), negative = per.filter((p) => p.rho < 0).length;
  const bins = SPEED_BINS.slice(0, -1).map((lo, i) => { const g = all.filter((f) => f[0] >= lo && f[0] < SPEED_BINS[i + 1]).map((f) => f[1]); return { speed: `[${lo}, ${SPEED_BINS[i + 1]})`, n: g.length, median: g.length ? +median(g).toFixed(4) : null }; });
  const big = bins.filter((b) => b.n >= 300); let rise = 0; for (let i = 1; i < big.length; i++) rise = Math.max(rise, big[i].median - big[i - 1].median);
  const ks = runs.flatMap((r) => r.frames).map((x) => x[2]).sort((a, b) => a - b), t1 = ks[Math.floor(ks.length / 3)], t2 = ks[Math.floor(2 * ks.length / 3)];
  const tercile = [[0, t1], [t1, t2], [t2, Infinity]].map(([lo, hi]) => { const p = runs.flatMap((r) => r.frames).filter((x) => x[2] >= lo && x[2] < hi).map((x) => [x[3], x[1]]); return { kappa: `[${lo.toExponential(2)}, ${hi === Infinity ? 'inf' : hi.toExponential(2)})`, n: p.length, rho: +spearman(p).toFixed(4) }; });
  const pass = ci[1] < 0 && negative >= 4 && rise <= 0.02;
  return { frames: all.length, rho: +rho.toFixed(4), ci95: ci.map((x) => +x.toFixed(4)), perReplay: per, negativeReplays: negative, bins, maxRiseBetweenBins: +rise.toFixed(4), byKappaTercile: tercile, verdict: pass ? 'PASS' : 'FAILS' };
}

function score(runs) {
  const all = runs.flatMap((r) => r.frames), rho = spearman(all);
  const blocks = []; for (const r of runs) for (let i = 0; i < r.frames.length; i += 250) blocks.push(r.frames.slice(i, i + 250));
  const rnd = prng(1), boot = [];
  for (let b = 0; b < 1000; b++) { const s = []; while (s.length < all.length) s.push(...blocks[Math.floor(rnd() * blocks.length)]); boot.push(spearman(s.slice(0, all.length))); }
  boot.sort((x, y) => x - y);
  const ci = [boot[24], boot[974]];
  const bins = BINS.slice(0, -1).map((lo, i) => { const g = all.filter((f) => f[0] >= lo && f[0] < BINS[i + 1]).map((f) => f[1]); return { load: `[${lo}, ${BINS[i + 1]})`, n: g.length, median: g.length ? +median(g).toFixed(4) : null }; });
  const big = bins.filter((b) => b.n >= 300); let rise = 0; for (let i = 1; i < big.length; i++) rise = Math.max(rise, big[i].median - big[i - 1].median);
  const pass = ci[1] < 0 && rise <= 0.02;
  return { frames: all.length, rho: +rho.toFixed(4), ci95: ci.map((x) => +x.toFixed(4)), bins, maxRiseBetweenBins: +rise.toFixed(4), verdict: pass ? 'PASS' : 'FAILS' };
}

if (require.main === module) {
  const by = process.argv.includes('--by') ? process.argv[process.argv.indexOf('--by') + 1] : 'load';
  if (by !== 'load' && by !== 'speed') { console.error('--by is load (M2) or speed (M2b)'); process.exit(1); }
  const files = process.argv.slice(2).filter((a, i, arr) => a !== '--by' && arr[i - 1] !== '--by'); if (!files.length) { console.error('usage: node tools/geodesic.cjs [--by load|speed] <replay.acreplay> [...]'); process.exit(1); }
  const runs = [];
  for (const f of files) {
    try { const r = frames(f); runs.push({ file: path.basename(f), dt: r.dt, N: r.N, frames: r.frames }); }
    catch (e) { runs.push({ file: path.basename(f), error: e.message, frames: [] }); }
  }
  const ok = runs.filter((r) => r.frames.length);
  process.stdout.write(JSON.stringify({
    registration: by === 'speed' ? 'exo_memory/loop/m2b_m3b_registration_2026-09-28.md (sha256 36b23de80f6c0291)' : 'exo_memory/handback/p-d182-m2m3-C_2026-09-27.md §0 (sha256 e71c5555ecd1cb04)',
    replays: runs.map((r) => ({ file: r.file, error: r.error, N: r.N, dt: r.dt, kept: r.frames.length, rho: r.frames.length > 2 ? +spearman(r.frames).toFixed(4) : null, medianShare: r.frames.length ? +median(r.frames.map((f) => f[1])).toFixed(4) : null, medianLoad: r.frames.length ? +median(r.frames.map((f) => f[0])).toFixed(3) : null,
      bins: BINS.slice(0, -1).map((lo, i) => { const g = r.frames.filter((x) => x[0] >= lo && x[0] < BINS[i + 1]).map((x) => x[1]); return [lo, g.length, g.length ? +median(g).toFixed(4) : null]; }) })),
    by, pooled: ok.length ? (by === 'speed' ? scoreSpeed(ok) : score(ok)) : null,
  }, null, 1) + '\n');
}
module.exports = { frames, spearman, score, scoreSpeed };
