// checks.js: ARCHITECTURE §5c's checks before export ("red if wrong"), on the placed markers, in track coordinates.
//
//   checkPlaced(placed, layout, path, missing, notes) -> { ok, checks: [{ id, ok, problems }], amber: [{ id, text }] }
//
// RED (they refuse the export, src/export/fromwords.js MARKERS):
//   anchors               every marker's word still exists (a removed word takes its anchor with it)
//   start-ahead-of-grid   §5c "the start line is ahead of the grid": every slot is behind the line along the race
//                         direction (+s; on a closed loop, within half a lap behind), and numbered from pole (a slot
//                         is never ahead of the one before it)
//   gate-orientation      §5c "L and R gates are the right way round": L is left of R across the road, in track
//                         coordinates (+u is left); the world-side test is T1's, on the built scene at export
//   height-and-heading    §5c "markers are 1–2 m above the surface, oriented along the road": h in [1, 2] m, forward
//                         within 15° of the road's tangent and within 15° of the surface plane (15°: inferred, the same
//                         tolerance src/export/markers.js uses)
//   slots                 §5c "no marker is inside another car's slot or off the road": a car slot (grid, pit,
//                         hotlap) is ±1.0 m across and ±2.4 m along (src/export/markers.js, inferred there); no marker's
//                         origin inside another's slot, every slot fully on the cross-section, every gate on it, and
//                         nothing over a jump's flight or off the track's ends
//   pit-count             §5c "the pit count matches": as many AC_PIT_n as the layout asks for, at least one, numbered
//                         0…n−1 (ui_track.json's pitboxes is counted from these, src/export/trackfiles.js)
// AMBER (said, never refusing): the hotlap run-up is shorter than the design speed needs (open tracks), and a grid slot
// that is not on a straight word (§5c: "dropped on a straight").
'use strict';
const { SLOT_HALF_LENGTH, SLOT_HALF_WIDTH } = require('./layout.js');
const { _vec: { dot } } = require('./place.js');

const COS15 = Math.cos(15 * Math.PI / 180), SIN15 = Math.sin(15 * Math.PI / 180);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// A STRAIGHT for the grid amber: a word-built 'straight' exactly (curvature and roll 0), or an EQUATION piece (word 'core', src/core/adapter.js) that is
// nearly straight by the same bar the automatic placement uses (app/core/coreshell.js STRAIGHT_K, STRAIGHT_ROLL: radius 5 km or more, bank 0.5 degrees or
// less). Before this every core segment failed the word test, so every grid on a core track was "on a core, not a straight" (2026-10-09, the keeper's
// TEST OVAL: a grid on a dead-straight first piece warned).
const CORE_STRAIGHT_K = 1 / 5000, CORE_STRAIGHT_ROLL = 0.5 * Math.PI / 180;
const isStraight = (g) => g.kind === 'road' && (g.word === 'straight'
  ? [g.k0, g.k1, g.kp0, g.kp1, g.roll0, g.roll1].every((x) => x === 0)
  : g.word === 'core' && [g.k0, g.k1, g.kp0, g.kp1].every((x) => Math.abs(x) <= CORE_STRAIGHT_K) && [g.roll0, g.roll1].every((x) => Math.abs(x) <= CORE_STRAIGHT_ROLL));

function checkPlaced(placed, layout, path, missing = [], notes = [], segments = null) {
  const by = (k) => placed.filter((m) => m.kind === k), find = (n) => placed.find((m) => m.name === n);
  const L = path.lengthM, closed = path.closed;
  const checks = [];

  checks.push({ id: 'anchors', problems: missing.map((m) => `${m.what} was placed on word ${m.word}, which is no longer in the track`) });

  { // start ahead of the grid
    const p = [], gl = find('AC_TIME_0_L'), grid = by('grid').sort((a, b) => a.n - b.n);
    if (!gl) p.push('no start line (AC_TIME_0), so nothing to be ahead of the grid');
    else if (!grid.length) p.push('no grid (AC_START_n)');
    else {
      const behind = (m) => (closed ? ((gl.s - m.s) % L + L) % L : gl.s - m.s);
      for (const m of grid) {
        const b = behind(m);
        if (!(b > 0) || (closed && b >= L / 2)) p.push(`${m.name} is not behind the start line (${(-b).toFixed(2)} m past it)`);
      }
      for (let k = 1; k < grid.length; k++) if (behind(grid[k]) < behind(grid[k - 1]) - 1e-9) p.push(`${grid[k].name} is ahead of ${grid[k - 1].name}: the grid is numbered from pole, so each slot sits at or behind the one before it`);
    }
    checks.push({ id: 'start-ahead-of-grid', problems: p });
  }

  { // L and R gates the right way round
    const p = [];
    for (const k of [0, 1, 2]) {
      const l = find(`AC_TIME_${k}_L`), r = find(`AC_TIME_${k}_R`);
      if (!l && !r) { if (k === 0) p.push('no AC_TIME_0 gate'); continue; }
      if (!l || !r) { p.push(`AC_TIME_${k} has only one side`); continue; }
      // in track coordinates (+u is left); the world-side check is T1's, on the built scene (src/export/markers.js)
      if (!(l.u > r.u)) p.push(`AC_TIME_${k}_L is not left of _R across the road (u ${l.u.toFixed(2)} vs ${r.u.toFixed(2)} m): L and R are swapped`);
    }
    checks.push({ id: 'gate-orientation', problems: p });
  }

  { // 1–2 m above the surface, along the road
    const p = [];
    for (const m of placed) {
      if (m.error) continue;
      if (!(m.h >= 1 && m.h <= 2)) p.push(`${m.name} is ${m.h.toFixed(2)} m above the surface (1–2 m required)`);
      if (dot(m.fwd, m.T) < COS15) p.push(`${m.name} does not point along the road (forward · road = ${dot(m.fwd, m.T).toFixed(2)})`);
      if (Math.abs(dot(m.fwd, m.normal)) > SIN15) p.push(`${m.name} points out of the surface (${(Math.asin(Math.min(1, Math.abs(dot(m.fwd, m.normal)))) * 180 / Math.PI).toFixed(0)}°)`);
    }
    checks.push({ id: 'height-and-heading', problems: p });
  }

  { // no marker inside another car's slot, and none off the road
    const p = [], cars = placed.filter((m) => ['grid', 'pit', 'hotlap'].includes(m.kind) && !m.error);
    for (const m of placed) {
      if (m.error) { p.push(`${m.name} is off the road: ${m.error}`); continue; }
      const half = ['grid', 'pit', 'hotlap'].includes(m.kind) ? SLOT_HALF_WIDTH : 0;
      if (m.u - half < m.span[0] - 1e-9 || m.u + half > m.span[1] + 1e-9) p.push(`${m.name} is off the road: ${half ? 'its slot reaches' : 'it sits at'} u ${(m.u - half).toFixed(2)}…${(m.u + half).toFixed(2)} m on a cross-section of ${m.span[0].toFixed(2)}…${m.span[1].toFixed(2)} m`);
    }
    const inside = (a, b) => { const d = sub(b.surface, a.surface); return Math.abs(dot(d, a.fwd)) < SLOT_HALF_LENGTH && Math.abs(dot(d, a.left)) < SLOT_HALF_WIDTH; };
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      if (inside(cars[i], cars[j]) || inside(cars[j], cars[i])) p.push(`${cars[j].name} and ${cars[i].name} overlap: one is inside the other's slot`);
    }
    checks.push({ id: 'slots', problems: p });
  }

  { // the pit count
    const p = [], pits = by('pit').sort((a, b) => a.n - b.n);
    if (!pits.length) p.push('no AC_PIT_n markers: AC needs at least one pit box');
    if (pits.length !== layout.pits.count) p.push(`the layout asks for ${layout.pits.count} pit boxes but ${pits.length} are placed`);
    pits.forEach((m, k) => { if (m.name !== `AC_PIT_${k}`) p.push(`pit markers are not numbered 0…${pits.length - 1} (found ${m.name} where AC_PIT_${k} belongs)`); });
    checks.push({ id: 'pit-count', problems: p });
  }

  const amber = notes.filter((n) => n.level === 'amber').map((n) => ({ id: n.id, text: n.text }));
  if (segments) for (const m of by('grid')) if (!m.error && !isStraight(segments[m.seg])) amber.push({ id: 'grid-on-straight', text: `${m.name} is on a ${segments[m.seg].word}, not a straight (§5c: the grid is dropped on a straight)` });
  for (const c of checks) c.ok = c.problems.length === 0;
  return { ok: checks.every((c) => c.ok), checks, amber };
}

module.exports = { checkPlaced };
