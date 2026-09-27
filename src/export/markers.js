// markers.js: the marker checks of docs/ARCHITECTURE.md §5c ("Checks before export (red if wrong)"), run on a scene
// in the shared T1 shape (see src/export/scene.js). Each check returns { id, ok, problems: [string] }; `checkMarkers`
// runs them all and `ok` is true only if every one passes. Nothing here writes files or guesses: a scene the checks
// cannot read (no grid, no gate) FAILS the check that needs it, with the reason.
//
// CONVENTIONS, measured rather than assumed (2026-09-27, pane E, on the five reference tracks on D with tools/kn5.cjs):
//   · A matrix is 16 floats in kn5's stored order: row vectors, translation at [12..14], world = local × parent
//     (tools/kn5.cjs:28-29). A marker's forward axis is the third row, [8..10].
//   · RACE DIRECTION comes from the grid, back slot → pole (AC_START_0), as tools/read_track.cjs:74-79 does, because
//     some authors' marker axes point backwards (FINDINGS §7b). With one slot, the pole's own forward axis is used.
//   · LEFT is cross(up, raceDirection) with up = (0,1,0). On centrifuge, sakura_speedway, ohyeah2389_t180testtrack,
//     t180_bowltrack and rainbow_rd, dot(AC_TIME_0_L − AC_TIME_0_R, cross(up, raceDirection)) > 0 on all five
//     (hand-back p-d165-export-E, §2). So an L gate on that side is "the right way round".
//   · THE ROAD is every physics mesh named <digit><KEY> whose KEY is not WALL (ARCHITECTURE §6: `1ROAD…`).
//
// DEFAULTS that are choices, not measurements, and can be overridden through `opts`:
//   · height band 1–2 m (§5c's own numbers);
//   · "along the road": |forward · surfaceNormal| ≤ sin 15°, and for grid slots and gates forward · raceDirection ≥ cos 30°;
//   · a car slot is a box ±1.0 m across and ±2.4 m along the slot's forward axis (inferred: T-180 dimensions not measured).
'use strict';

const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const add = (u, v) => [u[0] + v[0], u[1] + v[1], u[2] + v[2]];
const scale = (u, s) => [u[0] * s, u[1] * s, u[2] * s];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const len = (u) => Math.hypot(u[0], u[1], u[2]);
const unit = (u) => { const l = len(u); return l > 0 ? scale(u, 1 / l) : [0, 0, 0]; };
const UP = [0, 1, 0];

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, m) { // row-vector convention, as tools/kn5.cjs: result = a × m
  const r = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * m[k * 4 + j]; r[i * 4 + j] = s; }
  return r;
}

/** Walk the scene tree: every dummy with its WORLD matrix, and every mesh with its triangles in world space. */
function walkScene(scene) {
  if (!scene || !scene.root) throw new Error('walkScene: the scene has no root node');
  const dummies = [], meshes = [];
  (function visit(node, parent) {
    if (node.type === 'dummy') {
      if (!Array.isArray(node.matrix) || node.matrix.length !== 16) throw new Error(`walkScene: dummy "${node.name}" has no 16-float matrix`);
      const M = mul(node.matrix, parent);
      dummies.push({ name: node.name, matrix: M, pos: [M[12], M[13], M[14]], fwd: [M[8], M[9], M[10]] });
      for (const c of node.children || []) visit(c, M);
    } else if (node.type === 'mesh') {
      const p = node.positions, M = parent, n = p.length / 3, world = new Float64Array(p.length);
      for (let v = 0; v < n; v++) {
        const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
        world[v * 3] = x * M[0] + y * M[4] + z * M[8] + M[12];
        world[v * 3 + 1] = x * M[1] + y * M[5] + z * M[9] + M[13];
        world[v * 3 + 2] = x * M[2] + y * M[6] + z * M[10] + M[14];
      }
      meshes.push({ name: node.name, positions: world, indices: node.indices });
    } else throw new Error(`walkScene: unknown node type "${node.type}"`);
  })(scene.root, IDENTITY);
  return { dummies, meshes };
}

const isDrivable = (name) => { const m = /^\d+([A-Za-z_]+)/.exec(name || ''); return !!m && !/^WALL/i.test(m[1]); };

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection §5.1.5). Returns { q, interior }. */
function closestOnTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { q: a, interior: false };
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { q: b, interior: false };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return { q: add(a, scale(ab, d1 / (d1 - d3))), interior: false };
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { q: c, interior: false };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return { q: add(a, scale(ac, d2 / (d2 - d6))), interior: false };
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return { q: add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)))), interior: false };
  const den = 1 / (va + vb + vc);
  return { q: add(a, add(scale(ab, vb * den), scale(ac, vc * den))), interior: true };
}

/** The road surface under a point: the nearest drivable triangle, with its unit normal oriented toward the point. */
function surfaceUnder(p, road) {
  let best = null;
  for (const m of road) {
    const P = m.positions, I = m.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = [P[I[t] * 3], P[I[t] * 3 + 1], P[I[t] * 3 + 2]], b = [P[I[t + 1] * 3], P[I[t + 1] * 3 + 1], P[I[t + 1] * 3 + 2]], c = [P[I[t + 2] * 3], P[I[t + 2] * 3 + 1], P[I[t + 2] * 3 + 2]];
      const r = closestOnTri(p, a, b, c), d = len(sub(p, r.q));
      if (!best || d < best.d - 1e-9) {
        let n = unit(cross(sub(b, a), sub(c, a))); const off = sub(p, r.q); if (dot(n, off) < 0) n = scale(n, -1);
        // ON the surface = the point is straight above it: the offset runs along the normal. An edge or vertex hit
        // counts (markers sit over shared edges), a point beside the road does not.
        const lateral = len(sub(off, scale(n, dot(n, off))));
        best = { d, q: r.q, n, interior: r.interior || lateral < 1e-3 * Math.max(1, d), mesh: m.name };
      } else if (Math.abs(d - best.d) <= 1e-9 && !best.interior) {
        let n = unit(cross(sub(b, a), sub(c, a))); const off = sub(p, r.q); if (dot(n, off) < 0) n = scale(n, -1);
        if (len(sub(off, scale(n, dot(n, off)))) < 1e-3 * Math.max(1, d)) best = { d, q: r.q, n, interior: true, mesh: m.name };
      }
    }
  }
  return best;
}

const DEFAULTS = { minHeight: 1, maxHeight: 2, surfaceTiltSin: Math.sin(15 * Math.PI / 180), raceCos: Math.cos(30 * Math.PI / 180), slotHalfWidth: 1.0, slotHalfLength: 2.4 };
const byIndex = (re) => (d) => { const m = re.exec(d.name); return m ? +m[1] : -1; };

function collect(dummies) {
  const grid = dummies.filter((d) => /^AC_START_\d+$/.test(d.name)).sort((a, b) => byIndex(/^AC_START_(\d+)$/)(a) - byIndex(/^AC_START_(\d+)$/)(b));
  const pits = dummies.filter((d) => /^AC_PIT_\d+$/.test(d.name)).sort((a, b) => byIndex(/^AC_PIT_(\d+)$/)(a) - byIndex(/^AC_PIT_(\d+)$/)(b));
  const find = (n) => dummies.find((d) => d.name === n);
  return { grid, pits, L: find('AC_TIME_0_L'), R: find('AC_TIME_0_R'), hotlap: find('AC_HOTLAP_START_0') };
}

/** Race direction, horizontal and unit, from the grid (back slot → pole); the pole's own axis if there is one slot. */
function raceDirection(grid) {
  if (!grid.length) return null;
  const pole = grid[0], back = grid[grid.length - 1];
  const g = back === pole ? pole.fwd : sub(pole.pos, back.pos);
  const h = unit([g[0], 0, g[2]]);
  return len(h) > 0 ? h : null;
}

// ── the five checks ────────────────────────────────────────────────────────────────────────────────────────────────
function checkStartAheadOfGrid(m) {
  const problems = [];
  const g = raceDirection(m.grid);
  if (!g) problems.push('no AC_START_n markers, so no grid and no race direction');
  if (!m.L || !m.R) problems.push('no AC_TIME_0_L / AC_TIME_0_R gate, so no start line');
  if (!problems.length) {
    const line = scale(add(m.L.pos, m.R.pos), 0.5);
    for (const s of m.grid) { const ahead = dot(sub(line, s.pos), g); if (!(ahead > 0)) problems.push(`${s.name} is ${(-ahead).toFixed(2)} m past the start line (the line must be ahead of every grid slot)`); }
    for (let i = 1; i < m.grid.length; i++) if (dot(sub(m.grid[i - 1].pos, m.grid[i].pos), g) < -0.01) problems.push(`${m.grid[i].name} is ahead of ${m.grid[i - 1].name}: the grid is numbered from pole, so the order must run backwards from the line`);
  }
  return { id: 'start-ahead-of-grid', ok: !problems.length, problems };
}

function checkGateOrientation(m) {
  const problems = [];
  const g = raceDirection(m.grid);
  if (!m.L || !m.R) problems.push('no AC_TIME_0_L / AC_TIME_0_R gate');
  else if (!g) problems.push('no grid, so no race direction to tell left from right');
  else {
    const left = cross(UP, g), side = dot(sub(m.L.pos, m.R.pos), left);
    if (!(side > 0)) problems.push(`AC_TIME_0_L is on the RIGHT of the race direction (L−R across the road = ${side.toFixed(2)} m): L and R are swapped`);
  }
  return { id: 'gate-orientation', ok: !problems.length, problems };
}

function checkHeightAndHeading(m, road, o) {
  const problems = [];
  const g = raceDirection(m.grid);
  const all = [...m.grid, ...m.pits, m.hotlap, m.L, m.R].filter(Boolean);
  if (!all.length) problems.push('no markers');
  if (!road.length) problems.push('no drivable physics mesh (<digit><KEY>, KEY not WALL) to stand the markers on');
  if (problems.length) return { id: 'height-and-heading', ok: false, problems };
  for (const d of all) {
    const s = surfaceUnder(d.pos, road);
    if (!s.interior) { problems.push(`${d.name} is off the road: no drivable surface directly beneath it (nearest ${s.d.toFixed(2)} m, at an edge)`); continue; }
    if (s.d < o.minHeight || s.d > o.maxHeight) problems.push(`${d.name} is ${s.d.toFixed(2)} m above the surface (${o.minHeight}–${o.maxHeight} m required)`);
    const f = unit(d.fwd);
    if (len(d.fwd) === 0) { problems.push(`${d.name} has no forward axis`); continue; }
    if (Math.abs(dot(f, s.n)) > o.surfaceTiltSin) problems.push(`${d.name} points ${(Math.asin(Math.min(1, Math.abs(dot(f, s.n)))) * 180 / Math.PI).toFixed(0)}° out of the surface (along the road means parallel to it)`);
    const racing = /^AC_START_|^AC_TIME_|^AC_HOTLAP_START_/.test(d.name);
    if (racing && g && dot(unit([f[0], 0, f[2]]), g) < o.raceCos) problems.push(`${d.name} does not point along the race direction (forward · race = ${dot(unit([f[0], 0, f[2]]), g).toFixed(2)})`);
  }
  return { id: 'height-and-heading', ok: !problems.length, problems };
}

function checkSlots(m, road, o) {
  const problems = [];
  const slots = [...m.grid, ...m.pits, m.hotlap].filter(Boolean);
  const inside = (a, b) => { // is b's origin inside a's slot box?
    const f = unit([a.fwd[0], 0, a.fwd[2]]), r = cross(UP, f), d = sub(b.pos, a.pos);
    return Math.abs(dot(d, f)) < o.slotHalfLength && Math.abs(dot(d, r)) < o.slotHalfWidth && Math.abs(d[1]) < o.maxHeight ? d : null;
  };
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j];
    if (inside(a, b) || inside(b, a)) problems.push(`${b.name} and ${a.name} overlap: one is inside the other's slot (${len(sub(b.pos, a.pos)).toFixed(2)} m apart)`);
  }
  for (const s of slots) { const u = road.length ? surfaceUnder(s.pos, road) : null; if (!u || !u.interior) problems.push(`${s.name} is off the road`); }
  return { id: 'slots', ok: !problems.length, problems };
}

function checkPitCount(m, expected) {
  const problems = [];
  const idx = m.pits.map(byIndex(/^AC_PIT_(\d+)$/));
  idx.forEach((v, k) => { if (v !== k) problems.push(`pit markers are not numbered 0..${m.pits.length - 1} (found AC_PIT_${v} where AC_PIT_${k} belongs)`); });
  if (expected != null && +expected !== m.pits.length) problems.push(`the track says ${expected} pit boxes but the scene has ${m.pits.length} AC_PIT_n markers`);
  if (!m.pits.length) problems.push('no AC_PIT_n markers: AC needs at least one pit box');
  return { id: 'pit-count', ok: !problems.length, problems };
}

/**
 * Run every §5c check. `expectedPits` is the count the track description claims (null = no claim, only numbering and
 * presence are checked). Returns { ok, checks: [{ id, ok, problems }] }.
 */
function checkMarkers(scene, { expectedPits = null, ...opts } = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { dummies, meshes } = walkScene(scene);
  const m = collect(dummies), road = meshes.filter((x) => isDrivable(x.name));
  const checks = [checkStartAheadOfGrid(m), checkGateOrientation(m), checkHeightAndHeading(m, road, o), checkSlots(m, road, o), checkPitCount(m, expectedPits)];
  return { ok: checks.every((c) => c.ok), checks };
}

/** The count `ui_track.json` must carry: the AC_PIT_n markers in the scene, never typed by hand (§5c). */
function countPits(scene) { return walkScene(scene).dummies.filter((d) => /^AC_PIT_\d+$/.test(d.name)).length; }

module.exports = { checkMarkers, countPits, walkScene, isDrivable, raceDirection, DEFAULTS, _internal: { closestOnTri, surfaceUnder, mul } };
