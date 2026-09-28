// colour.js: red and amber along the track, from src/validate's result (ARCHITECTURE §1.3, §4; the plan's step 5).
// It runs in the UI process and reads only the validation result: no geometry, no mesh.
//
//   colourMap(result, { car, path })      -> map          every station, every lateral line
//   recolour(prev, result, { car, path })  -> { map, changed: [station indices] }   keeps unchanged stations as the SAME objects
//   levelAt(map, s, u) -> 0..3            rgbaAt(map, s, u) -> [r, g, b, a]         for the preview's vertex colours
//
// LEVELS, highest wins: RED 3 > AMBER 2 > INFO 1 > CLEAR 0.
//   · From a line's own load, with validation's own comparisons (src/validate/index.js), so they cannot disagree:
//       fN_g >  provenG (90 g, FINDINGS.md:105)            → AMBER   ("no track has proven this yet")
//       fN_g >= suspensionStopG (20 g, FINDINGS.md:103-104) → INFO    (the suspension stop: shown, never a warning)
//       otherwise                                           → CLEAR
//   · From the red and amber RANGES (folds, stacks, gaps, steep, seams, …): every line of every station whose s lies in
//     [s0, s1]. A range carries only its worst u, so a range colours the whole cross-section. That is coarser than the
//     finding (a steep wall paints its floor too); per-u red needs validation to publish per-u points, which it does
//     not today.
// The thresholds come from the SAME car object validation used (opts.car, else src/validate/limits.js MACH6).
//
// STATIONS COME FROM THE PATH when it is given. Loads need a speed, and with no speed model (no design speed on every
// word and no car acceleration, the usual state while building) validation computes NO lines. The geometry reds (fold,
// stacked, steep, gaps) still stand, so every path station is in the map: one without lines gets a single entry at
// u = 0, which levelAt's nearest-u lookup spreads across the width, coloured by the ranges alone.
'use strict';
const { MACH6 } = require('../../src/validate/limits.js');

// PENDING (D179): a station not checked yet, while a drag is open (validation's result.pendingFrom). It is never shown as
// clear: it was not found clean, it was not looked at. It sits above RED in number only so a max() never hides it.
const LEVEL = Object.freeze({ CLEAR: 0, INFO: 1, AMBER: 2, RED: 3, PENDING: 4 });
// inferred: display choices, not measurements. Red and amber as the program names them; info a quiet blue.
const PALETTE = Object.freeze([
  Object.freeze([0.62, 0.64, 0.68, 1]),   // clear: the road's own grey
  Object.freeze([0.36, 0.58, 0.92, 1]),   // info
  Object.freeze([1.00, 0.68, 0.10, 1]),   // amber
  Object.freeze([0.90, 0.16, 0.12, 1]),   // red
  Object.freeze([0.42, 0.40, 0.55, 1]),   // pending: a dim violet-grey, unlike the road's own grey (inferred, display)
]);

/** A line's level from its load alone. */
function loadLevel(fN_g, car = MACH6) {
  if (fN_g > car.provenG) return LEVEL.AMBER;
  if (fN_g >= car.suspensionStopG) return LEVEL.INFO;
  return LEVEL.CLEAR;
}

/** The level the red and amber ranges give station s (ranges are closed intervals [s0, s1]). */
function rangeLevel(result, s) {
  for (const r of result.red) if (s >= r.s0 - 1e-9 && s <= r.s1 + 1e-9) return LEVEL.RED;
  for (const r of result.amber) if (s >= r.s0 - 1e-9 && s <= r.s1 + 1e-9) return LEVEL.AMBER;
  return LEVEL.CLEAR;
}

/**
 * rangeLevel for every station at once (D177: per station it scanned every red and amber range, O(stations × ranges) on
 * each edit). For stations in s order, each range marks the stations inside it, found by binary search, through a
 * difference array: O(stations + ranges · log stations), and the same level rangeLevel gives each station. Stations out of
 * order fall back to rangeLevel one by one.
 */
function rangeLevels(result, ss) {
  const n = ss.length, out = new Uint8Array(n);
  for (let k = 1; k < n; k++) if (!(ss[k] >= ss[k - 1])) { for (let j = 0; j < n; j++) out[j] = rangeLevel(result, ss[j]); return out; }
  const first = (x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (ss[m] >= x) hi = m; else lo = m + 1; } return lo; };   // first s ≥ x
  const past = (x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (ss[m] <= x) lo = m + 1; else hi = m; } return lo; };   // first s > x
  const cover = (ranges) => {
    const d = new Int32Array(n + 1);
    for (const r of ranges) { const a = first(r.s0 - 1e-9), b = past(r.s1 + 1e-9); if (a < b) { d[a]++; d[b]--; } }
    const c = new Uint8Array(n); let run = 0;
    for (let k = 0; k < n; k++) { run += d[k]; c[k] = run > 0 ? 1 : 0; }
    return c;
  };
  const red = cover(result.red), amber = cover(result.amber);
  for (let k = 0; k < n; k++) out[k] = red[k] ? LEVEL.RED : amber[k] ? LEVEL.AMBER : LEVEL.CLEAR;
  return out;
}

/** Group validation's lines (station order, u order within) into stations; with a path, every path station, lines or not. */
function stationsOf(result, path) {
  const out = [];
  for (const l of result.lines) {
    const last = out[out.length - 1];
    if (last && last.s === l.s) last.lines.push(l); else out.push({ s: l.s, lines: [l] });
  }
  if (!path) return out;
  const byS = new Map(out.map((st) => [st.s, st]));
  return path.samples.map((p) => byS.get(p.s) || { s: p.s, lines: [] });
}

function entry(st, rl, car) {
  if (!st.lines.length) return Object.freeze({ s: st.s, u: Float64Array.of(0), levels: Uint8Array.of(rl), rangeLevel: rl, lines: st.lines });
  const levels = new Uint8Array(st.lines.length);
  st.lines.forEach((l, k) => { levels[k] = Math.max(loadLevel(l.fN_g, car), rl); });
  return Object.freeze({ s: st.s, u: Float64Array.from(st.lines, (l) => l.u), levels, rangeLevel: rl, lines: st.lines });
}

/** A station past validation's pendingFrom: not checked yet, so PENDING across its width, whatever it was before. */
const isPending = (result, s) => result.pendingFrom != null && s >= result.pendingFrom - 1e-9;
const pendingEntry = (s) => Object.freeze({ s, u: Float64Array.of(0), levels: Uint8Array.of(LEVEL.PENDING), rangeLevel: LEVEL.PENDING, lines: [] });

function colourMap(result, { car = MACH6, path } = {}) {
  const sts = stationsOf(result, path), rl = rangeLevels(result, sts.map((st) => st.s));
  return Object.freeze({ stations: Object.freeze(sts.map((st, k) => (isPending(result, st.s) ? pendingEntry(st.s) : entry(st, rl[k], car)))), pendingFrom: result.pendingFrom == null ? null : result.pendingFrom });
}

/**
 * Colour a new result, reusing every station of `prev` whose lines are the very same objects (revalidate carries the
 * untouched ones by identity) and whose range level did not change. `changed` lists the stations built anew.
 */
function recolour(prev, result, { car = MACH6, path } = {}) {
  const sts = stationsOf(result, path), changed = [], levels = rangeLevels(result, sts.map((st) => st.s));
  const stations = sts.map((st, k) => {
    const old = prev && prev.stations[k];
    if (isPending(result, st.s)) { if (old && old.s === st.s && old.rangeLevel === LEVEL.PENDING) return old; changed.push(k); return pendingEntry(st.s); }
    const rl = levels[k];
    if (old && old.s === st.s && old.rangeLevel === rl && old.lines.length === st.lines.length && old.lines.every((l, j) => l === st.lines[j])) return old;
    changed.push(k);
    return entry(st, rl, car);
  });
  return { map: Object.freeze({ stations: Object.freeze(stations), pendingFrom: result.pendingFrom == null ? null : result.pendingFrom }), changed };
}

/** The level at (s, u): the last station at or before s (the first, before the start), and the nearest line in u. */
function levelAt(map, s, u) {
  const st = map.stations;
  if (!st.length) return LEVEL.CLEAR;
  let lo = 0, hi = st.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (st[m].s <= s) lo = m; else hi = m - 1; }
  const e = st[lo];
  let best = 0; for (let k = 1; k < e.u.length; k++) if (Math.abs(e.u[k] - u) < Math.abs(e.u[best] - u)) best = k;
  return e.levels[best];
}
const rgbaAt = (map, s, u) => PALETTE[levelAt(map, s, u)];

module.exports = { LEVEL, PALETTE, loadLevel, rangeLevel, rangeLevels, colourMap, recolour, levelAt, rgbaAt };
