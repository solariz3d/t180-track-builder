// spectrum.cjs: M1 (D182; the keeper's design notes §8): do T-180 tracks share a spectral signature, distinct from normal
// circuits? The method was registered before this ran (exo_memory/handback/p-d182-m1-E_2026-09-27.md §1):
//   signals   κ_h = the reader's k (1/m); κ_v = d(atan(grade/100))/ds (1/m); bank = up (deg); road stations only
//   grid      linear interpolation onto Δs = 4 m, mean removed
//   estimator Welch PSD: 256-sample (1,024 m) segments, Hann window, 50% overlap, one-sided, averaged
//   band      1/512 … 1/16 cycles per metre (wavelengths 16–512 m)
//   summary   falloff β = LS slope of log10 PSD vs log10 f over the band; dominant period = 1/f at the band's PSD maximum
//   distance  per signal: the in-band PSD normalised to unit power, RMS of the log10 difference; averaged over 3 signals
//   verdict   W = mean T-180 × T-180 distance, B = mean T-180 × circuit distance; PASS iff W < B
// Prints SUMMARY NUMBERS only (no curve of any track).
//   node tools/spectrum.cjs <reads dir>
'use strict';
const fs = require('fs'), path = require('path');

const T180 = [['rainbow_rd', 'Rainbow Road'], ['centrifuge', 'Centrifuge'], ['hazenloop', 'Hazen Loop'], ['Chases_Onuris__layout_long', 'Onuris Long'],
  ['sakura_speedway', 'Sakura Speedway'], ['coast', 'Coast'], ['ohyeah2389_nordic', 'Nordic'], ['thunderhead_raceway__normal', 'Thunderhead'],
  ['eagleton__eagleton', 'Eagleton'], ['ohyeah2389_t180testtrack', 'T-180 Test Track'], ['bowltrack_2', 'The Bowltrack'],
  ['t180_bowltrack', 'T-180 Bowl Track'], ['serpents_spiral', 'Serpents Spiral']];
const CIRCUITS = [['ks_silverstone1967__main', 'Silverstone 1967'], ['magione__main', 'Magione'], ['ks_monza66__road', 'Monza 1966 (road)']];
const REGISTERED = ['Silverstone 1967', 'Magione'];
const DS = 4, SEG = 256, F_LO = 1 / 512, F_HI = 1 / 16, DEG = Math.PI / 180;

function signals(file) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (r.end !== 'closed') throw new Error(`${file}: the read did not close`);
  const S = r.stations.filter((s) => s.c && !s.jump && !s.junction && s.k != null && s.grade != null);
  const s0 = S[0].d, s1 = S[S.length - 1].d, n = Math.floor((s1 - s0) / DS) + 1;
  const interp = (f) => { const out = new Float64Array(n); let j = 0; for (let i = 0; i < n; i++) { const s = s0 + i * DS; while (j < S.length - 2 && S[j + 1].d < s) j++; const a = S[j], b = S[j + 1] || a, t = b.d > a.d ? (s - a.d) / (b.d - a.d) : 0; out[i] = f(a) + (f(b) - f(a)) * Math.max(0, Math.min(1, t)); } return out; };
  const kh = interp((s) => s.k), g = interp((s) => Math.atan(s.grade / 100)), bank = interp((s) => s.up);
  const kv = new Float64Array(n); for (let i = 0; i < n; i++) kv[i] = (g[Math.min(n - 1, i + 1)] - g[Math.max(0, i - 1)]) / ((Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * DS);
  const demean = (x) => { const m = x.reduce((a, v) => a + v, 0) / x.length; return x.map((v) => v - m); };
  return { kh: demean(kh), kv: demean(kv), bank: demean(bank), lengthM: (n - 1) * DS };
}

/** Welch PSD by a direct DFT per segment (the segments are short). Returns { f, P } one-sided. */
function welch(x) {
  if (x.length < SEG) throw new Error(`shorter than one segment (${x.length} < ${SEG})`);
  const w = Float64Array.from({ length: SEG }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SEG - 1)));
  const U = w.reduce((a, v) => a + v * v, 0), half = SEG / 2, P = new Float64Array(half + 1);
  let segs = 0;
  for (let start = 0; start + SEG <= x.length; start += SEG / 2) {
    segs++;
    for (let k = 0; k <= half; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < SEG; i++) { const v = x[start + i] * w[i], a = (-2 * Math.PI * k * i) / SEG; re += v * Math.cos(a); im += v * Math.sin(a); }
      P[k] += ((re * re + im * im) / (U / DS)) * (k === 0 || k === half ? 1 : 2);
    }
  }
  for (let k = 0; k <= half; k++) P[k] /= segs;
  return { f: Array.from({ length: half + 1 }, (_, k) => k / (SEG * DS)), P, segs };
}
const inBand = (sp) => sp.f.map((f, k) => [f, sp.P[k]]).filter(([f]) => f >= F_LO - 1e-12 && f <= F_HI + 1e-12);

function summary(sp) {
  const b = inBand(sp), xs = b.map(([f]) => Math.log10(f)), ys = b.map(([, p]) => Math.log10(Math.max(p, 1e-300)));
  const mx = xs.reduce((a, v) => a + v, 0) / xs.length, my = ys.reduce((a, v) => a + v, 0) / ys.length;
  const beta = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const top = b.reduce((m, e) => (e[1] > m[1] ? e : m), b[0]);
  return { beta: +beta.toFixed(3), periodM: +(1 / top[0]).toFixed(1) };
}
function shape(sp) { const b = inBand(sp), tot = b.reduce((a, [, p]) => a + p, 0); return b.map(([, p]) => Math.log10(Math.max(p / tot, 1e-300))); }
const rms = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);

function run(dir) {
  const tracks = [...T180.map(([f, n]) => ({ f, n, group: 't180' })), ...CIRCUITS.map(([f, n]) => ({ f, n, group: 'circuit' }))];
  for (const t of tracks) {
    const s = signals(path.join(dir, `${t.f}.read.json`));
    t.lengthM = s.lengthM; t.spec = {}; t.sum = {}; t.shape = {};
    for (const k of ['kh', 'kv', 'bank']) { const sp = welch(s[k]); t.spec[k] = sp; t.sum[k] = summary(sp); t.shape[k] = shape(sp); t.segs = sp.segs; }
  }
  const dist = (a, b) => (['kh', 'kv', 'bank'].reduce((s, k) => s + rms(a.shape[k], b.shape[k]), 0)) / 3;
  const verdictFor = (circNames) => {
    const T = tracks.filter((t) => t.group === 't180'), C = tracks.filter((t) => circNames.includes(t.n));
    const within = []; for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) within.push(dist(T[i], T[j]));
    const between = []; for (const a of T) for (const c of C) between.push(dist(a, c));
    const W = within.reduce((a, v) => a + v, 0) / within.length, B = between.reduce((a, v) => a + v, 0) / between.length;
    return { circuits: circNames, W: +W.toFixed(4), B: +B.toFixed(4), ratio: +(B / W).toFixed(3), pairsW: within.length, pairsB: between.length, verdict: W < B ? 'PASS' : 'FAILS' };
  };
  const reg = verdictFor(REGISTERED);
  // nearest neighbour of each T-180 track, among the 12 other T-180 tracks and the 2 registered circuits
  const T = tracks.filter((t) => t.group === 't180'), C = tracks.filter((t) => REGISTERED.includes(t.n));
  const nn = T.map((a) => { const cands = [...T.filter((b) => b !== a), ...C].map((b) => ({ b, d: dist(a, b) })).sort((x, y) => x.d - y.d); return { track: a.n, nearest: cands[0].b.n, isT180: cands[0].b.group === 't180' }; });
  // the permutation check (seed 1): shuffle the labels of the 15 tracks; how often B − W ≥ the observed
  const all = [...T, ...C], D = all.map((a) => all.map((b) => (a === b ? 0 : dist(a, b))));
  const obs = reg.B - reg.W; let rnd = 1; const R = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
  let ge = 0; const N = 10000;
  for (let it = 0; it < N; it++) {
    const idx = all.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const g1 = idx.slice(0, T.length), g2 = idx.slice(T.length);
    let w = 0, nw = 0; for (let i = 0; i < g1.length; i++) for (let j = i + 1; j < g1.length; j++) { w += D[g1[i]][g1[j]]; nw++; }
    let b = 0, nb = 0; for (const i of g1) for (const j of g2) { b += D[i][j]; nb++; }
    if (b / nb - w / nw >= obs - 1e-12) ge++;
  }
  const pairs = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => verdictFor([CIRCUITS[a][1], CIRCUITS[b][1]]));
  return {
    method: 'p-d182-m1-E §1: Δs 4 m; Welch 256×4 m, Hann, 50%; band 1/512–1/16 m⁻¹; normalised log-PSD RMS, mean of κ_h, κ_v, bank',
    tracks: tracks.map((t) => ({ track: t.n, group: t.group, lengthM: t.lengthM, segments: t.segs, kh: t.sum.kh, kv: t.sum.kv, bank: t.sum.bank })),
    registered: reg, nearestNeighbour: nn, permutation: { shuffles: N, seed: 1, atLeastObserved: ge, p: +(ge / N).toFixed(4) }, sensitivity: pairs,
  };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/spectrum.cjs <reads dir>'); process.exit(1); }
  process.stdout.write(JSON.stringify(run(dir), null, 1) + '\n');
}
module.exports = { run, welch, summary, signals };
