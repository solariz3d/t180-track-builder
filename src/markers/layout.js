// layout.js: the §5c markers as a LAYOUT in track coordinates, and the track-coordinate markers it resolves to.
//
//   layout = {
//     version: 1, height: 1.5, gateInsetM: 0.5,
//     line:    { word, along },           the start/finish gate AC_TIME_0_L/R: a word id and metres into that word
//     grid:    { pattern, count, poleBackM, rowGapM, colGapM, edits: { <n>: { backM?, u? } } },
//     pits:    { at: { word, along }, count, spacingM, u, lane: null },
//     hotlap:  { speedKmh: null },         null: the design speed, MACH6.designSpeedKmh (docs/FINDINGS.md:476)
//     sectors: [ { word, along }, … ],     optional AC_TIME_1 and AC_TIME_2 gates
//   }
//   resolveLayout(layout, path, segments) -> { markers: [{ name, kind, n, s, u, h }], notes: [], missing: [] }
//   defaultLayout(path, segments, opts) -> layout      the grid dropped on the longest straight (D167's placement)
//   gridSlots(grid) -> [{ n, backM, u }]              numbered from pole (AC_START_0), each behind the line by backM
//   runUpM(v, car) / speedAfterM(d, car)              the hotlap run-up, from the measured thrust (FINDINGS.md:494)
//
// WHY ANCHORED TO WORDS (§5c: "markers stay on the road when the words around them are edited"). A marker is kept as a
// word id and a distance into that word, not an absolute s. Editing a word upstream moves the word, and the marker with
// it; editing the anchor word itself keeps the marker at the same distance into it (clamped to the word's new length).
// Only the grid, the pits and the hotlap are placed relative to the line, so they follow it.
//
// RACE DIRECTION is increasing s (the order the words are placed). The grid is numbered from pole, AC_START_0 nearest the
// line, and every marker faces +s, so the grid order and the marker axes agree (§5c; FINDINGS §7b found authors whose
// axes point backwards).
//
// THE PATTERNS (§5c: "2 staggered, 3 abreast like Aurora, …"): n = row·cols + col, col 0 on the LEFT (+u, pole's side).
//   '2-staggered'  two columns, the right one half a row back      '2-abreast'  two columns side by side
//   '3-abreast'    three columns side by side
// backM = poleBackM + row·rowGapM (+ rowGapM/2 in the right column when staggered); u spread by colGapM across. A slot
// edit overrides that slot's backM and/or u, and leaves the others alone.
'use strict';
const { MACH6, accelAt } = require('../validate/limits.js');
const { surfaceAt, segStarts } = require('./place.js');
const Prof = require('../geom/profile.js');

//   '1-column'     one column on the centreline, nose to tail: defaultLayout's fallback when the floor fits one slot but not two columns (a closed
//                  tube's floor is a few metres whatever its width); resolveLayout says so in an amber note
const PATTERNS = Object.freeze({ '2-staggered': { cols: 2, stagger: true }, '2-abreast': { cols: 2, stagger: false }, '3-abreast': { cols: 3, stagger: false }, '1-column': { cols: 1, stagger: false } });
// DEFAULTS, inferred (choices, not measurements), matching D167's generated placement: pole 10 m behind the line, slots
// 8 m apart along (a staggered pair every 16 m), 3 m either side of the centre; 2 pit boxes 8 m apart; 1.5 m up.
const DEFAULTS = Object.freeze({ height: 1.5, gateInsetM: 0.5, lineMarginM: 15, poleBackM: 10, rowGapM: 16, colGapM: 6, count: 4, pits: 2, pitSpacingM: 8, pattern: '2-staggered' });
const SLOT_HALF_LENGTH = 2.4, SLOT_HALF_WIDTH = 1.0;   // src/export/markers.js DEFAULTS (inferred there: T-180 size not measured)
// THE T-180, MEASURED (2026-10-09, tools/kn5.cjs over every installed T-180's collider.kn5 and body .kn5: 25 cars, 14 models): one collider for all of them,
// 2.67 m wide x 5.95 m long x 0.99 m tall; the bodies run 5.29 to 6.67 m long (Fumee and Type A longest) and 2.20 to 2.65 m wide. The slot above (SLOT_HALF_*)
// is still the older inferred one: the measured size is used for the hand-placed grid pack below, and moving SLOT_HALF_* to it is the loop's call (it
// changes which narrow tube floors fit a grid: test/export_tube_grid.test.js rows 1-3 fail with it).
const T180 = Object.freeze({ widthM: 2.67, lengthM: 6.67, colliderLengthM: 5.95 });
// THE HAND-PLACED GRID PACK's starting spacing (the keeper: "the general size and spacing that would just work first"), from T180: two staggered columns
// 6 m apart centre to centre (3.3 m of air between cars side by side), a slot every 8 m along (alternate columns), so one column is 16 m nose-to-nose
// (9.3 m of air nose to tail); pole 10 m behind the line (its nose 6.7 m from the line). The keeper stretches or condenses it from here.
const PACK = Object.freeze({ count: 8, rowGapM: 16, colGapM: 6, rowGapMinM: T180.lengthM + 1, colGapMinM: T180.widthM + 0.5 });   // the minimums: one column nose to tail with 1 m of air, two columns side by side with 0.5 m

function gridSlots(grid) {
  const p = PATTERNS[grid.pattern];
  if (!p) throw Object.assign(new Error(`markers: grid pattern "${grid.pattern}" is not one of ${Object.keys(PATTERNS).join(', ')}`), { code: 'BAD_LAYOUT' });
  if (!(Number.isInteger(grid.count) && grid.count >= 1)) throw Object.assign(new Error(`markers: a grid needs at least one slot, got ${grid.count}`), { code: 'BAD_LAYOUT' });
  const across = p.cols === 1 ? [0] : p.cols === 2 ? [grid.colGapM / 2, -grid.colGapM / 2] : [grid.colGapM, 0, -grid.colGapM];
  const out = [];
  for (let n = 0; n < grid.count; n++) {
    const row = Math.floor(n / p.cols), col = n % p.cols;
    const e = (grid.edits && grid.edits[n]) || {};
    out.push({ n, backM: e.backM != null ? e.backM : grid.poleBackM + row * grid.rowGapM + (p.stagger && col === 1 ? grid.rowGapM / 2 : 0), u: e.u != null ? e.u : across[col] });
  }
  return out;
}

/** Run-up (m) from standing to speed v (m/s) on the flat at full thrust: ∫₀ᵛ v / a(v) dv, with a(v) = accelAt. */
function runUpM(v, car = MACH6) {
  if (!(v > 0)) return 0;
  const dv = 0.05; let d = 0;
  for (let x = 0; x < v; x += dv) { const h = Math.min(dv, v - x), m = x + h / 2; d += (m / accelAt(car, m)) * h; }
  return d;
}
/** The speed (m/s) reached after d metres from standing on the flat at full thrust (the inverse of runUpM). */
function speedAfterM(d, car = MACH6) {
  const dv = 0.05; let v = 0, used = 0;
  for (;;) { const m = v + dv / 2, step = (m / accelAt(car, m)) * dv; if (used + step > d) return v + dv * (d - used) / step; used += step; v += dv; }
}

/** The s where an anchor sits, or null if its word is gone: the word's start plus `along`, clamped into the word. */
function anchorS(anchor, segments, starts) {
  let first = -1, len = 0;
  segments.forEach((g, k) => { if (g.id === anchor.word) { if (first < 0) first = k; len += g.length; } });
  if (first < 0) return null;
  return starts[first] + Math.min(Math.max(anchor.along, 0), len);
}

function resolveLayout(layout, path, segments) {
  const starts = segStarts(path, segments), notes = [], missing = [], markers = [];
  const S = path.samples, s0 = S[0].s, s1 = S[S.length - 1].s, L = path.lengthM;
  const h = layout.height, back = (s, d) => {                       // d metres before s, against the race direction
    const t = s - d;
    if (path.closed) return ((t - s0) % L + L) % L + s0;
    return t;                                                        // may run off the start: the checks say so
  };
  const sLine = anchorS(layout.line, segments, starts);
  if (sLine == null) { missing.push({ what: 'the start line', word: layout.line.word }); return { markers, notes, missing }; }
  // the gate: across the road at the cross-section's edges, inset (left = +u)
  const span = surfaceAt(path, segments, sLine, 0, starts).span;
  markers.push({ name: 'AC_TIME_0_L', kind: 'gate', s: sLine, u: span[1] - layout.gateInsetM, h }, { name: 'AC_TIME_0_R', kind: 'gate', s: sLine, u: span[0] + layout.gateInsetM, h });
  for (const sl of gridSlots(layout.grid)) markers.push({ name: `AC_START_${sl.n}`, kind: 'grid', n: sl.n, s: back(sLine, sl.backM), u: sl.u, h, backM: sl.backM });
  if (layout.grid.pattern === '1-column') notes.push({ id: 'grid-single-column', level: 'amber', text: 'the grid is a single column on the centreline, cars nose to tail: the start straight\'s floor is too narrow for two columns' });
  const sPit = anchorS(layout.pits.at, segments, starts);
  if (sPit == null) missing.push({ what: 'the pit boxes', word: layout.pits.at.word });
  else for (let k = 0; k < layout.pits.count; k++) markers.push({ name: `AC_PIT_${k}`, kind: 'pit', n: k, s: back(sPit, k * layout.pits.spacingM), u: layout.pits.u, h });
  // the hotlap PLACED BY HAND (the keeper, 2026-10-09: "I place it down manually … literally plop down the spawn"): hotlap.at is an anchor like the line's.
  // It stands where it is put; what it reports is the run it gets to the line, and the speed the T-180 reaches over that run on the flat at full thrust.
  if (layout.hotlap.at) {
    const sAt = anchorS(layout.hotlap.at, segments, starts);
    if (sAt == null) missing.push({ what: 'the hotlap spawn', word: layout.hotlap.at.word });
    else {
      const run = path.closed ? ((sLine - sAt) % L + L) % L : sLine - sAt;
      if (!(run > 0)) notes.push({ id: 'hotlap-past-line', level: 'amber', text: `the hotlap spawn is ${(-run).toFixed(0)} m past the start line: the car starts its lap from there` });
      const kmhAt = run > 0 ? speedAfterM(run) * 3.6 : 0;
      markers.push({ name: 'AC_HOTLAP_START_0', kind: 'hotlap', s: sAt, u: 0, h, runUpM: Math.max(run, 0), speedKmh: Math.round(kmhAt) });
    }
  } else {
  // the hotlap: a run-up that reaches the design speed at the line (§5c: "so the car arrives at speed")
  const kmh = layout.hotlap.speedKmh != null ? layout.hotlap.speedKmh : MACH6.designSpeedKmh, need = runUpM(kmh / 3.6);
  let sHot = back(sLine, need);
  if (!path.closed && sHot < s0) {
    const have = sLine - s0;
    notes.push({ id: 'hotlap-short', level: 'amber', text: `the hotlap run-up to ${kmh} km/h needs ${need.toFixed(0)} m and the track has ${have.toFixed(0)} m before the line, so the car arrives at ${(speedAfterM(have) * 3.6).toFixed(0)} km/h` });
    sHot = s0;
  }
  markers.push({ name: 'AC_HOTLAP_START_0', kind: 'hotlap', s: sHot, u: 0, h, runUpM: need, speedKmh: kmh });
  }
  (layout.sectors || []).forEach((a, i) => {
    const s = anchorS(a, segments, starts);
    if (s == null) { missing.push({ what: `sector ${i + 1}`, word: a.word }); return; }
    const sp = surfaceAt(path, segments, s, 0, starts).span;
    markers.push({ name: `AC_TIME_${i + 1}_L`, kind: 'sector', s, u: sp[1] - layout.gateInsetM, h }, { name: `AC_TIME_${i + 1}_R`, kind: 'sector', s, u: sp[0] + layout.gateInsetM, h });
  });
  if (s1 < s0) notes.push({ id: 'empty', level: 'amber', text: 'no track' });
  return { markers, notes, missing };
}

// THE GRID'S FLOOR (D182, pane C): the central band where the cross-section tilts no more than FLOOR_MAX_DEG from the centre's
// normal. It was "exactly ψ = 0", which the measured fonts (src/geom/fonts.js) never are: they rise from the centre, as the
// library's roads do, so no grid could stand on a default road. Measured on the learning library (the tilt under every
// AC_START_n dummy, projected on the read's start section; pane C's scratchpad d182/gridtilt.js): the steepest slot per track
// is 6.1° at the median, every slot is at most 12.4° on 12 of 17 layouts, and 5 put a slot at 17-31° (the bowl tracks,
// Centrifuge, Eagleton). 15° holds every slot of those 12, and the measured fonts' floor is then at least ½ the road.
const FLOOR_MAX_DEG = 15;
/** Half-width of the grid's floor of a normalised profile: the |u| where ψ first passes FLOOR_MAX_DEG, on the narrower side. */
function floorHalf(P) {
  const lim = FLOOR_MAX_DEG * Math.PI / 180, i0 = P.u.indexOf(0);
  const reach = (dir) => {
    for (let i = i0; i + dir >= 0 && i + dir < P.u.length; i += dir) {
      const a = Math.abs(P.psi[i]), b = Math.abs(P.psi[i + dir]);
      if (b > lim) return Math.abs(P.u[i] + (P.u[i + dir] - P.u[i]) * (a >= lim ? 0 : (lim - a) / (b - a)));
    }
    return Math.abs(P.u[dir > 0 ? P.u.length - 1 : 0]);
  };
  return Math.min(reach(1), reach(-1));
}
// ONE SLOT (D226): the single-column fallback needs the floor's half width to clear a slot's half width by this much (a slot is 2 m across and
// stands on the centreline, so nothing else is needed; the two-column grid's 0.5 m outer margin has no outer column to protect here).
const ONE_SLOT_MARGIN_M = 0.1;
const isStraight = (g) => g.kind === 'road' && g.word === 'straight' && [g.k0, g.k1, g.kp0, g.kp1, g.roll0, g.roll1].every((x) => x === 0);

/**
 * The default layout: the line near the far end of the LONGEST straight, the grid behind it, the pits behind the grid.
 * Throws { code: 'NO_START_STRAIGHT' } when no straight is long or wide enough.
 */
function defaultLayout(path, segments, o = {}) {
  const c = { ...DEFAULTS, ...o };
  const starts = segStarts(path, segments);
  let best = null, run = null;
  segments.forEach((g, k) => {
    if (isStraight(g)) {
      const prev = run ? null : segments.slice(0, k).reverse().find((x) => x.kind === 'road');
      // the floor of a segment is the narrowest of its start, middle and end cross-sections (a cup's segments carry a blend, not one shape)
      const floorOf = (x) => Math.min(floorHalf(Prof.readAt(x, 0)), floorHalf(Prof.readAt(x, x.length / 2)), floorHalf(Prof.readAt(x, x.length)));
      const hw = Math.min(floorOf(g), prev ? floorHalf(Prof.readAt(prev, prev.length)) : Infinity);
      run = run ? { ...run, b: starts[k] + g.length, half: Math.min(run.half, hw) } : { a: starts[k], b: starts[k] + g.length, half: hw };
      if (!best || run.b - run.a > best.b - best.a) best = run;
    } else run = null;
  });
  const err = (m) => Object.assign(new Error(m), { code: 'NO_START_STRAIGHT' });
  if (!best) throw err('the track has no straight word to put the grid on');
  const colGapM = 2 * Math.min(c.colGapM / 2, best.half - SLOT_HALF_WIDTH - 0.5);
  let grid = { pattern: c.pattern, count: c.count, poleBackM: c.poleBackM, rowGapM: c.rowGapM, colGapM, edits: {} };
  if (!(colGapM / 2 > SLOT_HALF_WIDTH)) {
    // not two columns: ONE slot still fits when the floor clears a slot's half width by ONE_SLOT_MARGIN_M (0.1 m); then the cars stand nose to
    // tail on the centreline, a slot every half a row (the same along-the-road spacing the staggered pair has), and resolveLayout says so
    if (!(best.half > SLOT_HALF_WIDTH + ONE_SLOT_MARGIN_M)) throw err(`the start straight's floor is ${(2 * best.half).toFixed(2)} m wide, too narrow for even one grid slot (a slot needs more than ${(2 * (SLOT_HALF_WIDTH + ONE_SLOT_MARGIN_M)).toFixed(1)} m)`);
    grid = { pattern: '1-column', count: c.count, poleBackM: c.poleBackM, rowGapM: c.rowGapM / 2, colGapM: 0, edits: {} };
  }
  const lastBack = Math.max(...gridSlots(grid).map((x) => x.backM));
  const need = c.lineMarginM + lastBack + c.pits * c.pitSpacingM + SLOT_HALF_LENGTH;
  if (best.b - best.a < need) throw err(`the longest straight is ${(best.b - best.a).toFixed(1)} m; a grid of ${c.count} and ${c.pits} pit boxes need ${need.toFixed(1)} m`);
  const sLine = best.b - c.lineMarginM, sPit = sLine - lastBack - c.pitSpacingM;
  const at = (s) => { let k = 0; segments.forEach((g, j) => { if (starts[j] <= s + 1e-9) k = j; }); const id = segments[k].id, first = segments.findIndex((g) => g.id === id); return { word: id, along: s - starts[first] }; };
  return { version: 1, height: c.height, gateInsetM: c.gateInsetM, line: at(sLine), grid, pits: { at: at(sPit), count: c.pits, spacingM: c.pitSpacingM, u: 0, lane: null }, hotlap: { speedKmh: c.hotlapKmh != null ? c.hotlapKmh : null }, sectors: [] };
}

module.exports = { PATTERNS, DEFAULTS, SLOT_HALF_LENGTH, SLOT_HALF_WIDTH, T180, PACK, FLOOR_MAX_DEG, ONE_SLOT_MARGIN_M, gridSlots, runUpM, speedAfterM, anchorS, resolveLayout, defaultLayout, floorHalf };
