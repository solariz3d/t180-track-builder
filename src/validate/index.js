// validate/index.js: validation from the data (ARCHITECTURE.md §4, :67-89; docs/INTERFACES.md §3).
//
//   validate(path, segments, opts) -> { speed, lines, red, amber, info, jumps, lap, notChecked }
//
// `path` is C's buildPath output (samples with s, seg, pos, T, L, U, kvec); `segments` is A's resolve output (kind,
// word, speed, profile). Pure and deterministic: no clock, no randomness, no I/O.
//
// THE LOAD, per lateral line u (ARCHITECTURE.md:68-69). A profile point sits at o(u) = X·L + Y·U from the centre
// (src/geom/profile.js offsetAt). With a rotation-minimising frame, that line's tangent is T·(1 − κ⃗·o), so moving along it
// at speed v the acceleration is  a = v²·κ⃗ / (1 − κ⃗·o) + (dv/dt)·T,  and the specific force the car feels is
//   f = a − g⃗ = v²·κ⃗ / (1 − κ⃗·o) + a_T·T + g·ŷ      (the "v²κN − g" of :68, with the lateral line's own κ)
// projected on the surface frame there: fN on the drivable-side normal n(u) (src/geom/profile.js normalAt: into the
// surface when positive), fLat across the surface (+ toward larger u), fAlong on T. A car at rest on a flat road reads
// fN = 1 g, the calibration FINDINGS.md:31-32 states. 1 − κ⃗·o ≤ 0 is the fold (ARCHITECTURE.md:57): no load is taken
// there, the fold is red.
// inferred: the roll RATE's contribution (the line swinging about T as φ changes) is left out; it is second order next to
// v²κ on any roll a road can drive.
'use strict';
const { G, MACH6, kmh, accelAt } = require('./limits.js');
const { checkJump } = require('./jumps.js');
const P = require('../geom/profile.js');

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const DEG = Math.PI / 180;

const SRC = Object.freeze({
  'gap-in-road': 'ARCHITECTURE.md:82; FINDINGS.md:110',
  'missing-soft-collision': 'ARCHITECTURE.md:83; FINDINGS.md:89, :110',
  fold: 'ARCHITECTURE.md:57, :84; FINDINGS.md:110 (flipped road pieces)',
  'self-intersection': 'ARCHITECTURE.md:58, :84',
  'stacked-within-2m': 'ARCHITECTURE.md:85',
  'wall-ride-from-wall-object': 'ARCHITECTURE.md:86',
  'steep-without-raycast': 'ARCHITECTURE.md:87 (community-reported)',
  'load-above-proven': 'FINDINGS.md:105, :112-113',
  'seam-past-envelope': 'FINDINGS.md:24, :110-111',
  'on-the-stops': 'FINDINGS.md:103-104',
  'head-in-the-air': 'ARCHITECTURE.md:82 (a hole: the open end is the flight of a jump, over no road)',
  'landing-misses-zone': 'ARCHITECTURE.md:75-78 (the landing ramp must catch both landings)',
});

function segProfiles(segments) {
  return segments.map((g) => (g.kind === 'gap' ? null : P.normalize(g.profile)));
}

/**
 * v(s) per sample (INTERFACES §3 `speed`), in this order:
 *   1. DESIGN: every road word has a speed, its own or, where it has none, opts.designSpeed (m/s; the app's picker,
 *      defaulting to MACH6.designSpeedKmh, FINDINGS.md:476).
 *   2. LAPSIM, the ghost lap: full thrust from car.accel (the measured table, FINDINGS.md:494). With the DEFAULT car it
 *      runs only on a CLOSED loop: a lap from a standing start on a half-built open track is not a lap, and a load
 *      from it would be claimed without anyone having asked for a speed. A caller that passes its own opts.car.accel
 *      asks for the ghost explicitly, and gets it on an open path too (as before 2026-09-27).
 *   3. NONE: no loads are claimed.
 */
function speedProfile(path, segments, car, opts) {
  const S = path.samples, n = S.length;
  const road = segments.filter((g) => g.kind !== 'gap');
  const fill = Number.isFinite(opts.designSpeed) && opts.designSpeed > 0 ? opts.designSpeed : null;
  const own = (g) => (Number.isFinite(g.speed) && g.speed > 0 ? g.speed : fill);
  if (road.length && road.every((g) => own(g) != null)) {
    const v = S.map((p) => { const g = segments[p.seg]; return g.kind === 'gap' ? null : own(g); });
    for (let i = 0; i < n; i++) if (v[i] == null) v[i] = i ? v[i - 1] : own(road[0]);   // flight carries its speed
    return { from: 'design', v };
  }
  const asked = !!(opts.car && opts.car.accel != null);
  if (!Number.isFinite(accelAt(car, 0)) || !(path.closed || asked)) return { from: 'none', v: null };
  // The ghost point-mass lap (ARCHITECTURE.md:88-89): full thrust at accelAt(car, v), gravity along T, capped at vmax;
  // the flight over a gap keeps its speed. A closed loop runs three laps so the start speed is the carried one.
  const vmax = kmh(car.vmaxKmh);
  const v = new Array(n).fill(0);
  let cur = Number.isFinite(opts.startSpeed) ? opts.startSpeed : 0;
  for (let lap = 0; lap < (path.closed ? 3 : 1); lap++) {
    for (let i = 0; i < n; i++) {
      if (i || lap) {
        const a = S[i ? i - 1 : n - 1], b = S[i], ds = i ? b.s - a.s : 0;
        if (segments[b.seg].kind !== 'gap' && ds > 0) {
          const along = accelAt(car, cur) - G * (a.T[1] + b.T[1]) / 2;
          cur = Math.sqrt(Math.max(0, cur * cur + 2 * along * ds));
          if (cur > vmax) cur = vmax;
        }
      }
      v[i] = cur;
    }
  }
  return { from: 'lapsim', v };
}

/** Group point findings into ranges along s: same reason, consecutive stations. */
function ranges(list, step) {
  const out = [];
  // a total order (reason, s, u), so the ranges do not depend on the order findings were produced in
  const uu = (x) => (x.u == null ? -Infinity : x.u);
  for (const f of list.slice().sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : a.s - b.s || uu(a) - uu(b)))) {
    const last = out[out.length - 1];
    const s1 = f.s1 == null ? f.s : f.s1;
    if (last && last.reason === f.reason && f.s - last.s1 <= step * 1.5 + 1e-9) { last.s1 = Math.max(last.s1, s1); if (f.worst != null && (last.worst == null || f.worst > last.worst)) { last.worst = f.worst; last.u = f.u; } }
    else out.push({ s0: f.s, s1, u: f.u == null ? null : f.u, reason: f.reason, source: SRC[f.reason], worst: f.worst == null ? null : f.worst });
  }
  return out;
}

// ── the core: raw findings from station `from` on, merged with what is carried ──────────────────────────────────────
// Every station-level finding is tagged with its station index, every segment-level red with its segment, and every
// stacked hit with both of its stations, so `revalidate` can carry what an append cannot have changed and recompute the
// rest. `validate` is the core run from station 0 with nothing carried, so the two cannot drift apart.
//
// LOOK-BACK, per check (docs/INTERFACES.md §4 asks each to be stated):
//   · loads, amber, info    1 station: a station's along-track term reads its neighbours' speeds
//   · seams, holes          1 station: they compare a station with the next
//   · folds                 0: local to the station
//   · segment-level reds    the segment of the look-back station, i.e. the word before the change: an open head's gap
//                           is exempt, and stops being the head on an append
//   · stacked-within-2m     every new surface point is checked against EVERY point, old and new, and a hit marks
//                           both stations, so an old road that a new piece lands on turns red too
//   · jumps                 recomputed whole: a jump's landing depends on road up to landingSearchM after it, and
//                           jumps are few (each costs at most its landing search)
//   · the lap               only on a closed path, and closing re-validates everything (C spreads the closing twist
//                           along the whole loop, so every frame changes: docs/INTERFACES.md §4)
function core(path, segments, opts, from, carried) {
  if (!path || !Array.isArray(path.samples) || !Array.isArray(segments)) throw new Error('validate: needs a path with samples and the segments');
  const car = { ...MACH6, ...(opts.car || {}) };
  const S = path.samples, n = S.length;
  if (n < 2) throw new Error('validate: the path needs at least two samples');
  const profiles = segProfiles(segments);
  const step = (S[n - 1].s - S[0].s) / (n - 1);
  const isRoad = (i) => segments[S[i].seg].kind !== 'gap';
  const sp = speedProfile(path, segments, car, opts);
  const raw = { lines: [], pts: [], segReds: [], stacked: new Map(), speedFrom: sp.from, designSpeed: opts.designSpeed }, rederive = new Set();
  if (carried) {
    for (const l of carried.lines) if (l.i < from) raw.lines.push(l);
    for (const p of carried.pts) if (p.i < from) raw.pts.push(p);
    for (const r of carried.segReds) if (r.j < carried.fromSeg) raw.segReds.push(r);
    // a carried stack stays only if BOTH its station and its deepest partner lie before the cut; a station whose deepest
    // partner was in the changed part is re-queried against every point (an edit can remove what it was stacked on)
    for (const [k, e] of carried.stacked) { if (e.i >= from) continue; if (e.p < from) raw.stacked.set(k, { ...e }); else rederive.add(e.i); }
  }

  // ── loads per lateral line, folds, seams, holes: stations from `from` on ──
  const normalOf = (i, u) => { const [nl, nu] = P.normalAt(profiles[S[i].seg], u); return add(mul(S[i].L, nl), mul(S[i].U, nu)); };
  for (let i = from; i < n; i++) {
    if (!isRoad(i)) continue;
    const p = S[i], prof = profiles[p.seg];
    let aT = 0;
    if (sp.v) { const a = S[Math.max(0, i - 1)], b = S[Math.min(n - 1, i + 1)]; const va = sp.v[Math.max(0, i - 1)], vb = sp.v[Math.min(n - 1, i + 1)]; if (b.s > a.s) aT = (vb * vb - va * va) / (2 * (b.s - a.s)); }
    for (const u of prof.u) {
      // steep: the surface's angle to gravity, so a wall's ψ and the whole section's bank both count (ARCHITECTURE.md:87
      // "surfaces above ~50°"); red only for an export without CSP's wall raycasting
      if (opts.csp === false) { const up = Math.max(-1, Math.min(1, normalOf(i, u)[1])); if (Math.acos(up) > car.steepDeg * DEG + 1e-12) raw.pts.push({ i, kind: 'red', s: p.s, u, reason: 'steep-without-raycast', worst: Math.acos(up) / DEG }); }
      const [X, Y] = P.offsetAt(prof, u), o = add(mul(p.L, X), mul(p.U, Y)), margin = 1 - dot(p.kvec, o);
      if (margin <= 0) { raw.pts.push({ i, kind: 'red', s: p.s, u, reason: 'fold', worst: -margin }); continue; }
      if (!sp.v) continue;
      const v = sp.v[i], nrm = normalOf(i, u);
      const psi = P.psiAt(prof, u), sg = u > 0 ? 1 : u < 0 ? -1 : 0;
      const lat = sg === 0 ? p.L : add(mul(p.L, Math.cos(psi)), mul(p.U, sg * Math.sin(psi)));
      const f = add(add(mul(p.kvec, v * v / margin), mul(p.T, aT)), [0, G, 0]);
      const line = { s: p.s, u, fN_g: dot(f, nrm) / G, fLat_g: dot(f, lat) / G, fAlong_g: dot(f, p.T) / G, f_g: len(f) / G };
      raw.lines.push({ i, line });
      if (line.fN_g > car.provenG) raw.pts.push({ i, kind: 'amber', s: p.s, u, reason: 'load-above-proven', worst: line.fN_g });
      else if (line.fN_g >= car.suspensionStopG) raw.pts.push({ i, kind: 'info', s: p.s, u, reason: 'on-the-stops', worst: line.fN_g });
    }
    if (i + 1 < n && isRoad(i + 1) && S[i + 1].seg === p.seg) for (const u of prof.u) {
      const c = Math.max(-1, Math.min(1, dot(normalOf(i, u), normalOf(i + 1, u))));
      const deg = Math.acos(c) / DEG;
      if (deg > car.seamP90Deg) raw.pts.push({ i, kind: 'amber', s: p.s, u, reason: 'seam-past-envelope', worst: deg });
    }
    // a hole inside a road word: consecutive road stations further apart than their s says
    if (i + 1 < n && isRoad(i + 1) && len(sub(S[i + 1].pos, S[i].pos)) > (S[i + 1].s - S[i].s) * 1.5 + 1e-6) raw.pts.push({ i, kind: 'red', s: S[i].s, u: null, reason: 'gap-in-road' });
  }

  // ── segment-level reds (ARCHITECTURE.md:81-87), from station `from`'s segment on ──
  // from the segment of station `from`: revalidate's one-station look-back already puts that station in the word before
  // the change, so the old head (whose gap exemption ends when it stops being the head) is always re-checked
  const fromSeg = S[Math.min(from, n - 1)].seg, lastSeg = S[n - 1].seg;
  raw.fromSeg = fromSeg;
  segments.forEach((g, j) => {
    if (j < fromSeg) return;
    const idx = S.map((p, i) => (p.seg === j ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return;
    const s0 = S[idx[0]].s, s1 = S[idx[idx.length - 1]].s;
    // a gap that is not a jump is a hole; the open head is exempt (INTERFACES §4: "no 'gap in road' red at the head")
    if (g.kind === 'gap' && g.word !== 'jump' && !(!path.closed && j === lastSeg)) raw.segReds.push({ j, s: s0, s1, u: null, reason: 'gap-in-road' });
    if (g.kind !== 'gap' && g.word === 'wall-ride' && /^WALL/i.test(profiles[j].material)) raw.segReds.push({ j, s: s0, s1, u: null, reason: 'wall-ride-from-wall-object' });
  });

  stacked(S, isRoad, profiles, path, car, opts, from, raw.stacked, rederive);

  // ── whole-track reds that do not depend on stations ──
  const red = [], notChecked = [];
  if (opts.softCollision === false) red.push({ s: S[0].s, s1: S[n - 1].s, u: null, reason: 'missing-soft-collision' });
  if (Array.isArray(opts.folds)) {
    for (const f of opts.folds) red.push({ s: f.s, u: f.u == null ? null : f.u, reason: f.other ? 'self-intersection' : 'fold', worst: f.margin == null ? null : -f.margin });
  } else notChecked.push('self-intersection: needs buildMesh folds[] (a BVH between cells, ARCHITECTURE.md:58); pass opts.folds');
  for (const p of raw.pts) if (p.kind === 'red') red.push(p);
  for (const r of raw.segReds) red.push(r);
  for (const e of raw.stacked.values()) red.push({ s: e.s, u: e.u, reason: 'stacked-within-2m', worst: e.worst });
  const amber = raw.pts.filter((p) => p.kind === 'amber'), info = raw.pts.filter((p) => p.kind === 'info');
  const lines = raw.lines.slice().sort((a, b) => a.i - b.i).map((l) => l.line);   // station order, u order within

  // ── jumps (ARCHITECTURE.md:72-80) ──
  const jumps = [];
  segments.forEach((g, j) => {
    if (g.kind !== 'gap') return;
    const first = S.findIndex((p) => p.seg === j); if (first < 0) return;
    let last = first; while (last + 1 < n && S[last + 1].seg === j) last++;
    // THE LIP is the station AT the gap's start, the end of the take-off road. C's buildPath samples every boundary and
    // gives it to the segment it starts, so there it is the flight's first station, S[first]; a path sampled the other
    // way (the boundary kept by the road before) has it at S[first − 1]. So the lip is whichever of the two sits at the
    // gap's start s. (Until D170 it was always S[first − 1], which on buildPath's paths is one station BEFORE the edge:
    // every jump read one station step too long, a 12 m gap as 13 m at a 1 m step. test/validate_head.test.js pins it.)
    // the gap's start s, from the segment lengths (on C's paths this is exactly path.starts[j].s). Where segments carry no
    // length it is NaN, and the older rule (the road's last station) stands, right for a path that keeps the boundary on
    // the road before.
    const sGap = S[0].s + segments.slice(0, j).reduce((a, x) => a + x.length, 0);
    const take = first > 0 && !(Math.abs(S[first].s - sGap) < Math.abs(S[first - 1].s - sGap)) ? first - 1 : first, land = last + 1;
    if (first === 0 || land >= n) { jumps.push({ s: S[first].s, id: g.id, pending: true, reason: land >= n ? 'no landing yet (open head)' : 'no take-off road' }); return; }
    const A = S[take], axis = (() => { const h = [A.T[0], 0, A.T[2]], l = len(h); return l > 0 ? mul(h, 1 / l) : [0, 0, 1]; })();
    const x = (p) => dot(sub(p, A.pos), axis), D = x(S[land].pos), dh = S[land].pos[1] - A.pos[1];
    const landingRoad = [];
    for (let i = land; i < n && isRoad(i) && S[i].s - S[land].s <= (opts.landingSearchM || 150); i++) landingRoad.push({ x: x(S[i].pos), y: S[i].pos[1] - A.pos[1] });
    const v = sp.v ? sp.v[take] : null;
    const r = checkJump({ D, dh, thetaRad: Math.asin(Math.max(-1, Math.min(1, A.T[1]))), v, landingRoad, jumpG: car.jumpG, reach: car.reach });
    jumps.push({ s: A.s, id: g.id, speed: v, ...r });
  });

  // ── the open end and the landings (D170, the librarian's item 3, 2026-09-27) ──
  // An OPEN end must sit on road. A head that is a jump's flight is over nothing: a hole at the head (ARCHITECTURE.md:82).
  // The open-head exemption above is for a gap word that is still being placed; a jump's flight never ends on road by
  // itself, so it is red until a landing is there (the jump word's own landing ramp, or the next word).
  if (!path.closed && n && segments[lastSeg].kind === 'gap') {
    const first = S.findIndex((p) => p.seg === lastSeg);
    red.push({ s: S[first].s, s1: S[n - 1].s, u: null, reason: 'head-in-the-air' });
  }
  // With a known take-off speed, the landing road must catch BOTH landings (ARCHITECTURE.md:75-78; jumps.js). A missed
  // one is red on an open track too, not only in the closed lap's proof; `worst` is the heaviest fall that misses.
  for (const jp of jumps) {
    if (jp.pending || !Number.isFinite(jp.speed)) continue;
    const missed = jp.landings.filter((L) => !L.caught);
    if (missed.length) red.push({ s: jp.s, s1: jp.s + jp.gap, u: null, reason: 'landing-misses-zone', worst: Math.max(...missed.map((L) => L.g)) });
  }

  // ── the lap (ARCHITECTURE.md:88-89) ──
  let lap;
  if (!path.closed) lap = { ok: null, reason: 'open' };
  else if (!sp.v) lap = { ok: null, reason: 'no-speed-model' };
  else {
    const where = [];
    let t = 0, minV = Infinity;
    for (let i = 0; i < n; i++) {
      minV = Math.min(minV, sp.v[i]);
      if (i) { const va = (sp.v[i] + sp.v[i - 1]) / 2; t += va > 0 ? (S[i].s - S[i - 1].s) / va : Infinity; }
      if (isRoad(i) && !(sp.v[i] > 0)) where.push({ s: S[i].s, reason: 'stall' });
    }
    for (const l of lines) if (l.u === 0 && l.fN_g < 0) where.push({ s: l.s, reason: 'leaves-surface', fN_g: l.fN_g });
    for (const jp of jumps) {
      if (jp.pending) continue;
      for (const L of jp.landings) if (!L.caught) where.push({ s: jp.s, reason: `jump-not-caught-${L.g}g`, speed: jp.speed, minSpeed: L.minSpeed });
      if (!jp.reachable) where.push({ s: jp.s, reason: 'landing-unreachable' });
    }
    lap = { ok: where.length === 0, timeS: t, minV, where };
  }

  const result = {
    speed: sp.v ? S.map((p, i) => ({ s: p.s, v: sp.v[i], from: sp.from })) : [],
    speedFrom: sp.from,
    lines, red: ranges(red, step), amber: ranges(amber, step), info: ranges(info, step), jumps, lap, notChecked,
  };
  // the raw findings ride along, NOT enumerable, so a result compares and serialises as the INTERFACES shape alone
  Object.defineProperty(result, '_raw', { value: raw, enumerable: false });
  return result;
}

function validate(path, segments, opts = {}) { return core(path, segments, opts, 0, null); }

/**
 * Re-check after the path changed from `fromS` on (an append at the head, or an edit of the word starting there):
 * docs/INTERFACES.md §4 `revalidate(prev, path, segments, fromS, opts)`. Everything before fromS − look-back (above) is
 * carried from `prev`; the rest is recomputed. The result equals `validate(path, segments, opts)` exactly (tested).
 * A full `validate` runs instead when the carried part could have changed: the path is closed (the closing twist moves
 * every frame), `prev` has no raw findings, or the speed model changed (e.g. a word without a design speed was added).
 */
function revalidate(prev, path, segments, fromS, opts = {}) {
  if (!prev || !prev._raw || path.closed) return validate(path, segments, opts);
  const S = path.samples;
  let from = S.findIndex((p) => p.s >= fromS - 1e-9);
  if (from < 0) from = S.length - 1;
  from = Math.max(0, from - 1);   // look-back: one station (loads, seams, holes)
  const car = { ...MACH6, ...(opts.car || {}) };
  // a different speed model, or a different design speed from the picker, changes every load: re-validate everything
  if (speedProfile(path, segments, car, opts).from !== prev._raw.speedFrom || opts.designSpeed !== prev._raw.designSpeed) return validate(path, segments, opts);
  return core(path, segments, opts, from, prev._raw);
}

/**
 * Drivable surfaces stacked within `car.stackedM` (ARCHITECTURE.md:85): surface points of two passes of the road closer
 * than that. Points on the same pass (within `minSeparationM` of s, default 25 m, inferred: well beyond any cross-section
 * and any radius a T-180 drives, FINDINGS.md:39 "about 33–50 m radius at the tightest") are not a stack.
 * Only points from station `from` on (plus the `rederive` stations) are QUERIED, against every point; a hit marks both
 * stations, each keeping its
 * worst (deepest) overlap. With from = 0 that is the whole-track check.
 */
function stacked(S, isRoad, profiles, path, car, opts, from, out, rederive = new Set()) {
  const cell = car.stackedM, sep = opts.minSeparationM || 25, L = path.lengthM || (S[S.length - 1].s - S[0].s);
  const grid = new Map(), pts = [];
  const key = (a, b, c) => `${a},${b},${c}`;
  for (let i = 0; i < S.length; i++) {
    if (!isRoad(i)) continue;
    const prof = profiles[S[i].seg], us = [];
    for (let k = 0; k < prof.u.length; k++) { us.push(prof.u[k]); if (k + 1 < prof.u.length) { const m = Math.ceil((prof.u[k + 1] - prof.u[k]) / 1); for (let j = 1; j < m; j++) us.push(prof.u[k] + (prof.u[k + 1] - prof.u[k]) * j / m); } }
    for (const u of us) {
      const [X, Y] = P.offsetAt(prof, u), q = add(S[i].pos, add(mul(S[i].L, X), mul(S[i].U, Y)));
      const pt = { q, s: S[i].s, u, i }, c = q.map((x) => Math.floor(x / cell));
      pts.push(pt);
      const k = key(c[0], c[1], c[2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(pt);
    }
  }
  // one entry per station: its deepest overlap, the smaller u on a tie, so the answer never depends on visiting order
  const mark = (pt, worst, partner) => {
    const k = pt.i, e = out.get(k);
    if (!e || worst > e.worst || (worst === e.worst && pt.u < e.u)) out.set(k, { i: pt.i, s: pt.s, u: pt.u, worst, p: partner });
  };
  for (const pt of pts) {
    if (pt.i < from && !rederive.has(pt.i)) continue;
    const c = pt.q.map((x) => Math.floor(x / cell));
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
      for (const o of grid.get(key(c[0] + a, c[1] + b, c[2] + d)) || []) {
        let ds = Math.abs(o.s - pt.s); if (path.closed) ds = Math.min(ds, L - ds);
        const dist = len(sub(o.q, pt.q));
        if (ds < sep || dist >= cell) continue;
        mark(pt, cell - dist, o.i); mark(o, cell - dist, pt.i);
      }
    }
  }
}

module.exports = { validate, revalidate, speedProfile, SRC, _internal: { ranges } };
