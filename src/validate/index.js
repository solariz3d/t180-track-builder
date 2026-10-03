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
const { rayGaps } = require('./raygap.js');

// THE ROLL RATE (D225, seal V7 and S3): the angle between the surface normal U at s − 10 m and at s + 10 m, both projected onto the plane normal to T(s), over the 20 m chord (°/m).
// The bar is MEASURED, not derived: RED above 1.2144°/m (the maximum over the whole Centrifuge lap, 8,585 windows, a lap the keeper says "flows so smooth … at max speed"),
// AMBER above 0.9338°/m (the maximum over its inverted words alone, 175 windows). It is read at a 20 m chord because the 4 m chord of that read is facet noise (4.26°/m on plain road).
// A full 360° of bank passes the bar only over about 450 m (amber until 600 m); over 300 m it is red (1.8°/m). See FINDINGS and ref 09 §10 for the command and the read's sha256.
const ROLL_RED_DEG_M = 1.2144, ROLL_AMBER_DEG_M = 0.9338, ROLL_CHORD_M = 20;
// a CLOSED tube narrower than this cannot hold the chase camera's eye: the eye is 3 m up the road's U, the ceiling of a circle of circumference w is 2R = w/π above the floor, and the seal's margin is 0.1 m (X2 i: the eye inside R − 0.1 of the axis), so w/π must exceed 3.1: w > 9.74 m (3π = 9.43 would put the eye ON the ceiling; the librarian's first ruling had that, corrected in the D225 fixes round). REFUSED by name.
const TUBE_MIN_W = 9.74;
// the cap on the total edge angle of a non-tube edge piece (CUP_MAX, document.js), and of an open tube with an edge (t/2 + e)
const EDGE_CAP_DEG = 150, TUBE_EDGE_CAP_DEG = 180;
/** The roll rate (°/m) at each road station that has a station 10 m each side on road; closed paths wrap at their length. [{ i, s, rate }] */
function rollRates(S, isRoad, closed, L) {
  const n = S.length, s0 = S[0].s, half = ROLL_CHORD_M / 2, out = [];
  const find = (x) => {   // the station index j with S[j].s <= x <= S[j+1].s, or -1 outside an open path
    if (closed) x = ((x - s0) % L + L) % L + s0;
    if (x < s0 - 1e-9 || x > S[n - 1].s + 1e-9) return null;
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= x) lo = m; else hi = m; }
    return { j: lo, x };
  };
  const normalAt = (x) => {
    const f = find(x); if (!f) return null;
    const a = S[f.j], b = S[Math.min(n - 1, f.j + 1)];
    if (!isRoad(f.j) || !isRoad(Math.min(n - 1, f.j + 1))) return null;
    const t = b.s > a.s ? (f.x - a.s) / (b.s - a.s) : 0, U = [0, 1, 2].map((k) => a.U[k] + (b.U[k] - a.U[k]) * t), l = len(U);
    return l > 0 ? mul(U, 1 / l) : null;
  };
  for (let i = 0; i < n; i++) {
    if (!isRoad(i)) continue;
    const p = S[i], ua = normalAt(p.s - half), ub = normalAt(p.s + half); if (!ua || !ub) continue;
    const pa = sub(ua, mul(p.T, dot(ua, p.T))), pb = sub(ub, mul(p.T, dot(ub, p.T))), c = len([pa[1] * pb[2] - pa[2] * pb[1], pa[2] * pb[0] - pa[0] * pb[2], pa[0] * pb[1] - pa[1] * pb[0]]);
    out.push({ i, s: p.s, rate: Math.atan2(c, dot(pa, pb)) / DEG / ROLL_CHORD_M });
  }
  return out;
}

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
  'downforce-ray-gap': 'FINDINGS.md:110 (gaps in the road mesh are RED); docs/research/04_ac_physics_drivability.md §4 (the Mach 6\'s downforce is one ray to the road, 1 m ahead of the car: a gap under it takes ALL the downforce)',
  'joint-step': 'FINDINGS.md:110 (a step in the road mesh is a gap: the D190 round-3 ruling (c) reds a lap seam or a cup joint that steps more than 1 mm)',
  'roll-rate': 'D225 seal V7 / S3 (exo_memory/loop/cross_section_seal_registration_2026-10-03.md): the roll rate over a 20 m chord, the bar the Centrifuge lap measured (RED 1.2144°/m, AMBER 0.9338°/m)',
  'tube-too-narrow': 'D225 ruling R1 (corrected): a closed tube narrower than 9.74 m cannot hold the chase camera (the 3 m eye, plus the seal\'s 0.1 m margin, must fit under the ceiling 2R = w/π)',
  'edge-past-cap': 'D225 seal V2 / E2: the total edge angle of an edge piece is capped at CUP_MAX 150° (180° on an open tube): the walls of a bowl past it touch',
  'jump-gap-not-forward': 'ARCHITECTURE.md:72 (a jump check needs a gap: here the landing lip is not ahead of the take-off lip, so there is no flight to check)',
});

// THE DOWNFORCE STEP a jump carries (R1, research §4): the car's downforce is a ray 1 m ahead of it, so it goes to zero
// the moment the ray passes the take-off lip, and comes back IN ONE STEP when the ray finds the landing, not gradually.
// The landing should expect that step, not only the fall. Its size is not given: the research's figure (about 2.4 g at
// 100 m/s) rests on UNVERIFIED arithmetic (the script's speed unit), so only the fact and its source are carried.
const DOWNFORCE_STEP = (car) => ({ aheadM: car.downforceRay.aheadM, note: `the downforce drops to zero as the car's downforce ray, ${car.downforceRay.aheadM} m ahead, passes the lip, and returns in one step when it finds the landing (docs/research/04_ac_physics_drivability.md §4)` });

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
//   · stacked-within-2m     every changed station is checked against every station, old and new, that can hold a
//                           surface point within 2 m of its own: a SPATIAL reach of r_i + r_j + 2 m around it (r the
//                           station's half-section, at most 15.9 m for the built-in words, the bowl; so ≤ 33.8 m), at
//                           ANY s, since a new piece can land on road laid kilometres earlier. A hit marks both stations,
//                           so an old road that a new piece lands on turns red too; an old station whose deepest stack
//                           was on a changed one is re-derived. The work is the stations near the changed ones, not the
//                           track (stacked() below)
//   · jumps                 recomputed whole: a jump's landing depends on road up to its landing search after its flight
//                           (150 m, or the jump's own landing ramp when that is longer), so a word placed within that of
//                           an earlier jump can change it; jumps are few, and each costs at most its landing search
//   · self-intersection     not computed here: it is buildMesh's (C's BVH between cells), passed in as opts.folds
//   · the speed             v(s) is O(stations) per call (a design speed per word, or the closed loop's ghost lap)
//   · the lap               only on a closed path, and closing re-validates everything (C spreads the closing twist
//                           along the whole loop, so every frame changes: docs/INTERFACES.md §4). opts.lap === false
//                           defers its proof (a drag tick); lapOf() gives it afterwards
// DOWNSTREAM of a sculpt every station is recomputed, per station: a sculpt moves what follows it (C's rigid re-placement
// turns and shifts it about world up), and a full validate of the moved path reads the moved coordinates, so carrying the
// old figures would differ from it in rounding. Per station this is cheap (the profile's constants are per segment);
// what made a sculpt cost seconds was the stacking check measuring every surface point of the whole track (D177).
function core(path, segments, opts, from, carried, upto) {
  if (!path || !Array.isArray(path.samples) || !Array.isArray(segments)) throw new Error('validate: needs a path with samples and the segments');
  const car = { ...MACH6, ...(opts.car || {}) };
  const S = path.samples, n = S.length;
  if (n < 2) throw new Error('validate: the path needs at least two samples');
  // THE WINDOW (D179 drag budget): stations from `end` on are PENDING, not checked. `end` is n unless the caller bounds
  // it (revalidate's opts.uptoS); the result says where the pending stretch starts (pendingFrom), so no one reads it as clean
  const end = upto === undefined ? n : Math.max(Math.min(from, n), Math.min(n, upto));
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
  // What depends only on the profile and u (offset, normal, ψ) is computed once per segment (D177: this loop allocated
  // several vectors per station and line); each station then combines it with its own frame, in the same arithmetic
  // order as the vector helpers above, so every figure is bit-identical to the per-station form it replaced.
  const perSeg = new Map();
  const constOf = (prof) => prof.u.map((u) => { const [X, Y] = P.offsetAt(prof, u), [nl, nu] = P.normalAt(prof, u), psi = P.psiAt(prof, u), sg = u > 0 ? 1 : u < 0 ? -1 : 0;
    return { u, X, Y, nl, nu, sg, cos: Math.cos(psi), sgsin: sg * Math.sin(psi) }; });
  const segConst = (j) => {
    let c = perSeg.get(j);
    if (c) return c;
    c = constOf(profiles[j]);
    perSeg.set(j, c); return c;
  };
  // a segment that carries a BLEND (the cup's) has a different cross-section at every station: the blend is evaluated at the station (D190),
  // so the loads, the folds and the steepness read the road as the mesh draws it, not the blend's target for the whole segment
  const segS0 = new Array(segments.length);
  for (let i = 0; i < n; i++) if (segS0[S[i].seg] === undefined) segS0[S[i].seg] = S[i].s;
  const constAt = (p) => { const g = segments[p.seg]; return P.readsBlend(g) && g.blend ? constOf(P.atSegment(g, p.s - segS0[p.seg])) : segConst(p.seg); };   // only a cup's blend: a word's font transition is judged at its target, as before
  // the normal n(u) at a station: L·nl + U·nu (add(mul(L, nl), mul(U, nu)))
  const nx = (p, c) => p.L[0] * c.nl + p.U[0] * c.nu, ny = (p, c) => p.L[1] * c.nl + p.U[1] * c.nu, nz = (p, c) => p.L[2] * c.nl + p.U[2] * c.nu;
  for (let i = from; i < end; i++) {
    if (!isRoad(i)) continue;
    const p = S[i], cs = constAt(p), Lv = p.L, Uv = p.U, K = p.kvec, Tv = p.T;
    let aT = 0;
    if (sp.v) { const a = S[Math.max(0, i - 1)], b = S[Math.min(n - 1, i + 1)]; const va = sp.v[Math.max(0, i - 1)], vb = sp.v[Math.min(n - 1, i + 1)]; if (b.s > a.s) aT = (vb * vb - va * va) / (2 * (b.s - a.s)); }
    for (const c of cs) {
      const u = c.u;
      // steep: the surface's angle to gravity, so a wall's ψ and the whole section's bank both count (ARCHITECTURE.md:87
      // "surfaces above ~50°"); red only for an export without CSP's wall raycasting
      if (opts.csp === false) { const up = Math.max(-1, Math.min(1, ny(p, c))); if (Math.acos(up) > car.steepDeg * DEG + 1e-12) raw.pts.push({ i, kind: 'red', s: p.s, u, reason: 'steep-without-raycast', worst: Math.acos(up) / DEG }); }
      const o0 = Lv[0] * c.X + Uv[0] * c.Y, o1 = Lv[1] * c.X + Uv[1] * c.Y, o2 = Lv[2] * c.X + Uv[2] * c.Y;
      const margin = 1 - (K[0] * o0 + K[1] * o1 + K[2] * o2);
      if (margin <= 0) { raw.pts.push({ i, kind: 'red', s: p.s, u, reason: 'fold', worst: -margin }); continue; }
      if (!sp.v) continue;
      const v = sp.v[i], n0 = nx(p, c), n1 = ny(p, c), n2 = nz(p, c);
      const l0 = c.sg === 0 ? Lv[0] : Lv[0] * c.cos + Uv[0] * c.sgsin, l1 = c.sg === 0 ? Lv[1] : Lv[1] * c.cos + Uv[1] * c.sgsin, l2 = c.sg === 0 ? Lv[2] : Lv[2] * c.cos + Uv[2] * c.sgsin;
      const w = v * v / margin, f0 = (K[0] * w + Tv[0] * aT) + 0, f1 = (K[1] * w + Tv[1] * aT) + G, f2 = (K[2] * w + Tv[2] * aT) + 0;
      const line = { s: p.s, u, fN_g: (f0 * n0 + f1 * n1 + f2 * n2) / G, fLat_g: (f0 * l0 + f1 * l1 + f2 * l2) / G, fAlong_g: (f0 * Tv[0] + f1 * Tv[1] + f2 * Tv[2]) / G, f_g: Math.hypot(f0, f1, f2) / G };
      raw.lines.push({ i, line });
      if (line.fN_g > car.provenG) raw.pts.push({ i, kind: 'amber', s: p.s, u, reason: 'load-above-proven', worst: line.fN_g });
      else if (line.fN_g >= car.suspensionStopG) raw.pts.push({ i, kind: 'info', s: p.s, u, reason: 'on-the-stops', worst: line.fN_g });
    }
    if (i + 1 < n && isRoad(i + 1) && S[i + 1].seg === p.seg) for (const c of cs) {
      const q = S[i + 1];
      const d = Math.max(-1, Math.min(1, nx(p, c) * nx(q, c) + ny(p, c) * ny(q, c) + nz(p, c) * nz(q, c)));
      const deg = Math.acos(d) / DEG;
      if (deg > car.seamP90Deg) raw.pts.push({ i, kind: 'amber', s: p.s, u: c.u, reason: 'seam-past-envelope', worst: deg });
    }
    // a hole inside a road word: consecutive road stations further apart than their s says
    if (i + 1 < n && isRoad(i + 1) && len(sub(S[i + 1].pos, S[i].pos)) > (S[i + 1].s - S[i].s) * 1.5 + 1e-6) raw.pts.push({ i, kind: 'red', s: S[i].s, u: null, reason: 'gap-in-road' });
  }

  // ── segment-level reds (ARCHITECTURE.md:81-87), from station `from`'s segment on ──
  // from the segment of station `from`: revalidate's one-station look-back already puts that station in the word before
  // the change, so the old head (whose gap exemption ends when it stops being the head) is always re-checked
  const fromSeg = S[Math.min(from, n - 1)].seg, lastSeg = S[n - 1].seg;
  raw.fromSeg = fromSeg;
  // each segment's first and last station, in one pass (D177: this was a scan of every station per segment)
  const firstOf = new Array(segments.length).fill(-1), lastOf = new Array(segments.length).fill(-1);
  for (let i = 0; i < n; i++) { const j = S[i].seg; if (firstOf[j] < 0) firstOf[j] = i; lastOf[j] = i; }
  // a cup's joint (legacy <-> cup, the lap seam) or any joint inside a cup whose curve steps more than 1 mm (D190 R3, the chair's ruling (c)): red, so
  // the panel never reads "0 red · lap proved" over a cliff. Word documents' joints are unchanged (jointSteps looks only where a cup is).
  const jointStep = new Map(P.jointSteps(segments, path.closed).filter((x) => x.m > 1e-3).map((x) => [x.j, x]));
  segments.forEach((g, j) => {
    if (j < fromSeg) return;
    if (firstOf[j] < 0 || firstOf[j] >= end) return;   // a segment wholly in the pending stretch is not checked yet
    const s0 = S[firstOf[j]].s, s1 = S[lastOf[j]].s;
    if (jointStep.has(j)) raw.segReds.push({ j, s: s0, s1: s0, u: null, reason: 'joint-step', worst: jointStep.get(j).m });
    if (g.kind !== 'gap' && g.profile) {
      const pr = profiles[j], w = pr.u[pr.u.length - 1] - pr.u[0], edgeDeg = Math.max(pr.psi[0], pr.psi[pr.psi.length - 1]) / DEG;
      if (pr.psi[0] >= Math.PI - 1e-6 && pr.psi[pr.psi.length - 1] >= Math.PI - 1e-6 && w < TUBE_MIN_W) raw.segReds.push({ j, s: s0, s1, u: null, reason: 'tube-too-narrow', worst: w });   // a CLOSED tube (both edges at 180°) under the camera's width
      const cap = pr.font === 'edge' ? EDGE_CAP_DEG : pr.font === 'tube-edge' ? TUBE_EDGE_CAP_DEG : null;
      if (cap !== null && edgeDeg > cap + 1e-3) raw.segReds.push({ j, s: s0, s1, u: null, reason: 'edge-past-cap', worst: edgeDeg });
    }
    // a gap that is not a jump is a hole; the open head is exempt (INTERFACES §4: "no 'gap in road' red at the head")
    if (g.kind === 'gap' && g.word !== 'jump' && !(!path.closed && j === lastSeg)) raw.segReds.push({ j, s: s0, s1, u: null, reason: 'gap-in-road' });
    if (g.kind !== 'gap' && g.word === 'wall-ride' && /^WALL/i.test(profiles[j].material)) raw.segReds.push({ j, s: s0, s1, u: null, reason: 'wall-ride-from-wall-object' });
  });

  stacked(S, isRoad, profiles, path, car, opts, from, raw.stacked, rederive, end);
  raw.end = end;

  // ── whole-track reds that do not depend on stations ──
  const red = [], notChecked = [];
  if (opts.softCollision === false) red.push({ s: S[0].s, s1: S[n - 1].s, u: null, reason: 'missing-soft-collision' });
  if (Array.isArray(opts.folds)) {
    for (const f of opts.folds) if (end === n || f.s < S[end].s) red.push({ s: f.s, u: f.u == null ? null : f.u, reason: f.other ? 'self-intersection' : 'fold', worst: f.margin == null ? null : -f.margin });
  } else notChecked.push('self-intersection: needs buildMesh folds[] (a BVH between cells, ARCHITECTURE.md:58); pass opts.folds');
  // gaps in the PHYSICS road the downforce ray can fall into (raygap.js): needs the built road, which the export has
  if (Array.isArray(opts.roadMesh)) {
    for (const g of rayGaps(opts.roadMesh, S, car.downforceRay)) if (g.s != null && (end === n || g.s < S[end].s)) red.push({ s: g.s, u: g.u, reason: 'downforce-ray-gap', worst: g.widthM });
  } else notChecked.push('downforce-ray-gap: needs the built physics road (src/validate/raygap.js); pass opts.roadMesh');
  for (const p of raw.pts) if (p.kind === 'red') red.push(p);
  for (const r of raw.segReds) red.push(r);
  // the roll rate: a whole-track check read from the path (a station's chord reaches 10 m each side, so it is recomputed every call and revalidate equals validate)
  const rollAmber = [];
  // the core's own segments only (word 'core', src/core/adapter.js): the paused piece builder's word documents are not newly judged by a bar the Centrifuge lap measured for the equation core's roads (their lap seams step the roll)
  const isCore = (i) => isRoad(i) && segments[S[i].seg].word === 'core';
  for (const q of rollRates(S, isCore, path.closed, path.lengthM || (S[n - 1].s - S[0].s))) {
    if (q.i >= end) continue;
    if (q.rate > ROLL_RED_DEG_M) red.push({ s: q.s, u: null, reason: 'roll-rate', worst: q.rate });
    else if (q.rate > ROLL_AMBER_DEG_M) rollAmber.push({ s: q.s, u: null, reason: 'roll-rate', worst: q.rate });
  }
  for (const e of raw.stacked.values()) red.push({ s: e.s, u: e.u, reason: 'stacked-within-2m', worst: e.worst });
  const amber = [...raw.pts.filter((p) => p.kind === 'amber'), ...rollAmber], info = raw.pts.filter((p) => p.kind === 'info');
  const lines = raw.lines.slice().sort((a, b) => a.i - b.i).map((l) => l.line);   // station order, u order within

  // ── jumps (ARCHITECTURE.md:72-80) ──
  const jumps = [];
  segments.forEach((g, j) => {
    if (g.kind !== 'gap') return;
    const first = firstOf[j]; if (first < 0) return;
    if (first >= end) { jumps.push({ s: S[first].s, id: g.id, pending: true, deferred: true, reason: 'not checked until the drag ends' }); return; }
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
    // THE LANDING SEARCH: 150 m of road past the landing lip (opts.landingSearchM), and never less than the jump's OWN
    // landing ramp, the road resolve sized to catch both measured falls at the design speed (resolve.js landingRamp). A
    // search shorter than the ramp read a touchdown ON the ramp as a miss: the measured 81 m jump at 755 km/h comes down
    // about 152 m past the lip, on a 162 m ramp (the ripple, p-d182-ripple-E; test/validate_jumps.test.js).
    const own = segments[j + 1] && segments[j + 1].part === 'land' && segments[j + 1].id === g.id ? segments[j + 1].length : 0;
    const searchM = Math.max(opts.landingSearchM || 150, own);
    const landingRoad = [];
    for (let i = land; i < n && isRoad(i) && S[i].s - S[land].s <= searchM; i++) landingRoad.push({ x: x(S[i].pos), y: S[i].pos[1] - A.pos[1] });
    const v = sp.v ? sp.v[take] : null;
    // A landing lip NOT AHEAD of the take-off lip (a measured gap ≤ 0: the flight would go straight up or backwards) has
    // no flight to check. It is RED, with that reason, and never a throw: validation runs under the user's hand, and a
    // throw there is a crash path (D179: checkJump threw on it, and buildExport passed the throw straight through)
    if (!(D > 0)) {
      jumps.push({ s: A.s, id: g.id, speed: v, gap: D, climb: dh, rampDeg: Math.asin(Math.max(-1, Math.min(1, A.T[1]))) * 180 / Math.PI, minSpeed: null, landings: [], reachable: false, badGap: true });
      red.push({ s: A.s, s1: S[last].s, u: null, reason: 'jump-gap-not-forward', worst: Number.isFinite(D) ? -D : null });
      return;
    }
    const r = checkJump({ D, dh, thetaRad: Math.asin(Math.max(-1, Math.min(1, A.T[1]))), v, landingRoad, jumpG: car.jumpG, reach: car.reach });
    jumps.push({ s: A.s, id: g.id, speed: v, ...r, downforceStep: DOWNFORCE_STEP(car) });
  });

  // ── the open end and the landings (D170, the librarian's item 3, 2026-09-27) ──
  // An OPEN end must sit on road. A head that is a jump's flight is over nothing: a hole at the head (ARCHITECTURE.md:82).
  // The open-head exemption above is for a gap word that is still being placed; a jump's flight never ends on road by
  // itself, so it is red until a landing is there (the jump word's own landing ramp, or the next word).
  if (end === n && !path.closed && n && segments[lastSeg].kind === 'gap') {
    const first = firstOf[lastSeg];
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
  // opts.lap === false DEFERS the proof (D177: "the lap proof runs on demand or debounced, NEVER on every drag tick"):
  // the result says so, and lapOf() gives the proof from the result afterwards, the same as it would have been
  let lap;
  if (!path.closed) lap = { ok: null, reason: 'open' };
  else if (end < n) lap = { ok: null, reason: 'deferred' };
  else if (!sp.v) lap = { ok: null, reason: 'no-speed-model' };
  else if (opts.lap === false) lap = { ok: null, reason: 'deferred' };
  else lap = proveLap(S, isRoad, sp.v, lines, jumps);

  const result = {
    speed: sp.v ? S.map((p, i) => ({ s: p.s, v: sp.v[i], from: sp.from })) : [],
    speedFrom: sp.from,
    lines, red: ranges(red, step), amber: ranges(amber, step), info: ranges(info, step), jumps, lap, notChecked,
    pendingFrom: end < n ? S[end].s : null,
  };
  // the raw findings ride along, NOT enumerable, so a result compares and serialises as the INTERFACES shape alone
  Object.defineProperty(result, '_raw', { value: raw, enumerable: false });
  return result;
}

/** The ghost lap's proof on a closed loop: its time, its slowest speed, and every place the lap would fail. */
function proveLap(S, isRoad, v, lines, jumps) {
  const n = S.length, where = [];
  let t = 0, minV = Infinity;
  for (let i = 0; i < n; i++) {
    minV = Math.min(minV, v[i]);
    if (i) { const va = (v[i] + v[i - 1]) / 2; t += va > 0 ? (S[i].s - S[i - 1].s) / va : Infinity; }
    if (isRoad(i) && !(v[i] > 0)) where.push({ s: S[i].s, reason: 'stall' });
  }
  for (const l of lines) if (l.u === 0 && l.fN_g < 0) where.push({ s: l.s, reason: 'leaves-surface', fN_g: l.fN_g });
  for (const jp of jumps) {
    if (jp.pending) continue;
    if (jp.badGap) { where.push({ s: jp.s, reason: 'jump-gap-not-forward', gap: jp.gap }); continue; }
    for (const L of jp.landings) if (!L.caught) where.push({ s: jp.s, reason: `jump-not-caught-${L.g}g`, speed: jp.speed, minSpeed: L.minSpeed });
    if (!jp.reachable) where.push({ s: jp.s, reason: 'landing-unreachable' });
  }
  return { ok: where.length === 0, timeS: t, minV, where };
}

/**
 * The lap a result DEFERRED (validate with opts.lap === false), proven now from the result itself: its speeds, lines and
 * jumps are the ones the proof reads, so this equals the lap an undeferred validate gives (tested). Any other lap is
 * returned as it is. O(stations + lines + jumps): no load or stack is recomputed.
 */
function lapOf(path, segments, result) {
  if (!result.lap || result.lap.reason !== 'deferred') return result.lap;
  const S = path.samples, isRoad = (i) => segments[S[i].seg].kind !== 'gap';
  return proveLap(S, isRoad, result.speed.map((x) => x.v), result.lines, result.jumps);
}

/** The station index of opts.uptoS (the first station at or past it), or undefined: no window. */
const uptoOf = (S, opts) => { if (opts.uptoS == null) return undefined; const k = S.findIndex((p) => p.s >= opts.uptoS - 1e-9); return k < 0 ? S.length : k; };

/**
 * validate(path, segments, opts): the whole track. With opts.uptoS, only the stations before it; the rest is PENDING
 * (result.pendingFrom), checked by the next revalidate.
 */
function validate(path, segments, opts = {}) { return core(path, segments, opts, 0, null, uptoOf(path.samples, opts)); }

/**
 * Re-check after the path changed from `fromS` on (an append at the head, or an edit of the word starting there):
 * docs/INTERFACES.md §4 `revalidate(prev, path, segments, fromS, opts)`. Everything before fromS − look-back (above) is
 * carried from `prev`; the rest is recomputed. The result equals `validate(path, segments, opts)` exactly (tested).
 * A full `validate` runs instead when the carried part could have changed: the path is closed (the closing twist moves
 * every frame), `prev` has no raw findings, or the speed model changed (e.g. a word without a design speed was added).
 *
 * THE DRAG WINDOW (D179, the librarian's direction). opts.uptoS bounds the recheck: stations from it on are PENDING, and
 * result.pendingFrom says where they start. Every station before it is exact: a pending station still has its stacking
 * measured against them. A `prev` that was windowed carries nothing past its pendingFrom, so the next revalidate starts
 * no later than there; revalidate(windowed, …, prev.pendingFrom) with no uptoS finishes the track, equal to a full
 * validate exactly (tested).
 */
function revalidate(prev, path, segments, fromS, opts = {}) {
  if (!prev || !prev._raw || path.closed) return validate(path, segments, opts);
  const S = path.samples;
  // before the edit's cut nothing moved, so the previous pending start still names the same station
  if (prev.pendingFrom != null && prev.pendingFrom < fromS) fromS = prev.pendingFrom;
  let from = S.findIndex((p) => p.s >= fromS - 1e-9);
  if (from < 0) from = S.length - 1;
  from = Math.max(0, from - 1);   // look-back: one station (loads, seams, holes)
  const car = { ...MACH6, ...(opts.car || {}) };
  // a different speed model, or a different design speed from the picker, changes every load: re-validate everything
  if (speedProfile(path, segments, car, opts).from !== prev._raw.speedFrom || opts.designSpeed !== prev._raw.designSpeed) return validate(path, segments, opts);
  return core(path, segments, opts, from, prev._raw, uptoOf(S, opts));
}

/**
 * Drivable surfaces stacked within `car.stackedM` (ARCHITECTURE.md:85): surface points of two passes of the road closer
 * than that. Points on the same pass (within `minSeparationM` of s, default 25 m, inferred: well beyond any cross-section
 * and any radius a T-180 drives, FINDINGS.md:39 "about 33–50 m radius at the tightest") are not a stack.
 * Only stations from `from` on (plus the `rederive` stations) are QUERIED, against every station; a hit marks both
 * stations, each keeping its worst (deepest) overlap. With from = 0 that is the whole-track check.
 *
 * THE POINTS are each road station's surface: the profile's u, with points at most 1 m apart laterally between them, at
 * q = pos + L·X + U·Y. Two points of different passes closer than `cell` are a stack. Which pairs are measured (D177, the
 * incremental-validation ruling) is decided per STATION PAIR first, by two lower bounds on the distance between any
 * point of station i and any point of station j, where r is a station's largest |(X, Y)| (its points lie within r of
 * pos, in the plane through pos normal to T):
 *   · the sphere bound   |pos_j − pos_i| − r_i − r_j
 *   · the plane bound    |T_i·(pos_j − pos_i)| − r_j·sinθ, and the same from j's side   (θ the angle between T_i and T_j:
 *                        i's points have no T_i component, j's have at most r_j·sinθ; this is what rejects the
 *                        same road 25 m on, which the sphere bound cannot)
 * Only a pair both bounds leave under cell (+ SLACK for rounding) has its points measured, with the same arithmetic as
 * the point-by-point check this replaced, so a finding is bit-identical; a pair that is rejected has no point within
 * cell of the other's. Candidates come from a grid over station positions whose cell is 2·r_max + cell, so every pair
 * that can hold a stack is in neighbouring grid cells. The cost is the stations near each queried station, not every
 * surface point of the track (the point grid this replaced was 95% of a full validate at 40 km: 3.1 of 3.3 s).
 */
const SLACK = 1e-4;   // m: a pair whose bounds clear the stack distance by less than this is measured anyway
function stacked(S, isRoad, profiles, path, car, opts, from, out, rederive = new Set(), end = S.length) {
  const cell = car.stackedM, sep = opts.minSeparationM || 25, L = path.lengthM || (S[S.length - 1].s - S[0].s), n = S.length;
  // the lateral points of each segment's profile, with their (X, Y) and the largest |(X, Y)|, once per segment
  const lat = new Map();
  const latOf = (j) => {
    let e = lat.get(j);
    if (e) return e;
    const prof = profiles[j], us = [];
    for (let k = 0; k < prof.u.length; k++) { us.push(prof.u[k]); if (k + 1 < prof.u.length) { const m = Math.ceil((prof.u[k + 1] - prof.u[k]) / 1); for (let jj = 1; jj < m; jj++) us.push(prof.u[k] + (prof.u[k + 1] - prof.u[k]) * jj / m); } }
    const xy = us.map((u) => P.offsetAt(prof, u));
    e = { us, xy, r: Math.max(0, ...xy.map(([X, Y]) => Math.hypot(X, Y))) };
    lat.set(j, e); return e;
  };
  let rMax = 0;
  // each station's r, whether it is queried, and its s and pos in flat arrays (the pair loop reads them for every candidate)
  const rOf = new Float64Array(n), qd = new Uint8Array(n), sOf = new Float64Array(n), px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  for (let i = 0; i < n; i++) if (isRoad(i)) { rOf[i] = latOf(S[i].seg).r; rMax = Math.max(rMax, rOf[i]); qd[i] = i >= from || rederive.has(i) ? 1 : 0; sOf[i] = S[i].s; px[i] = S[i].pos[0]; py[i] = S[i].pos[1]; pz[i] = S[i].pos[2]; }
  const B = 2 * rMax + cell + SLACK, grid = new Map();
  // an exact integer key per grid cell, counted from the track's own lowest cell (one row of margin each side), so on
  // any track up to ~2^30 cells in its box the key is a small integer, which a Map hashes fastest
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) if (isRoad(i)) for (let d = 0; d < 3; d++) { const c = Math.floor(S[i].pos[d] / B); if (c < lo[d]) lo[d] = c; if (c > hi[d]) hi[d] = c; }
  const NY = hi[1] - lo[1] + 3, NZ = hi[2] - lo[2] + 3;
  const keyOf = (a, b, c) => (a * NY + b) * NZ + c;   // exact while (hi − lo + 3)³ < 2^53: any track on Earth
  const kx = new Int32Array(n), ky = new Int32Array(n), kz = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!isRoad(i)) continue;
    const p = S[i].pos; kx[i] = Math.floor(p[0] / B) - lo[0] + 1; ky[i] = Math.floor(p[1] / B) - lo[1] + 1; kz[i] = Math.floor(p[2] / B) - lo[2] + 1;
    const k = keyOf(kx[i], ky[i], kz[i]), list = grid.get(k);
    if (list) list.push(i); else grid.set(k, [i]);
  }
  // the points of a station, computed only when a pair needs them (q exactly as pos + (L·X + U·Y), per component)
  const ptsCache = new Map();
  const ptsOf = (i) => {
    let q = ptsCache.get(i);
    if (q) return q;
    const { us, xy } = latOf(S[i].seg), { pos, L: l, U: w } = S[i];
    q = us.map((u, k) => { const [X, Y] = xy[k]; return { q: add(pos, add(mul(l, X), mul(w, Y))), s: S[i].s, u, i }; });
    ptsCache.set(i, q); return q;
  };
  // one entry per station: its deepest overlap, the smaller u on a tie, so the answer never depends on visiting order
  const mark = (pt, worst, partner) => {
    if (pt.i >= end) return;   // a pending station keeps no finding: it is checked in full when the window ends
    const k = pt.i, e = out.get(k);
    if (!e || worst > e.worst || (worst === e.worst && pt.u < e.u)) out.set(k, { i: pt.i, s: pt.s, u: pt.u, worst, p: partner });
  };
  const lim = cell + SLACK;
  for (let i = 0; i < n; i++) {
    if (!qd[i]) continue;   // not a road station, or not queried
    const A = S[i], ri = rOf[i], sA = sOf[i], ax = px[i], ay = py[i], az = pz[i];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
      const list = grid.get(keyOf(kx[i] + a, ky[i] + b, kz[i] + d));
      if (!list) continue;
      for (let t = 0; t < list.length; t++) {
        const j = list[t];
        // a pair of two PENDING stations waits for the window to end; a pending station is still measured against the
        // window and everything before it, so a station that is not pending never shows a stale "clean" (D179)
        if (i >= end && j >= end) continue;
        if (qd[j] && j <= i) continue;   // a pair of two queried stations is measured once
        let ds = Math.abs(sOf[j] - sA); if (path.closed) ds = Math.min(ds, L - ds);
        if (ds < sep) continue;
        const rj = rOf[j], dx = px[j] - ax, dy = py[j] - ay, dz = pz[j] - az;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) - ri - rj >= lim) continue;   // a bound, with SLACK: its rounding does not matter
        const Bj = S[j];
        const c = dot(A.T, Bj.T), sin = Math.sqrt(Math.max(0, 1 - c * c));
        if (Math.abs(A.T[0] * dx + A.T[1] * dy + A.T[2] * dz) - rj * sin >= lim) continue;
        if (Math.abs(Bj.T[0] * dx + Bj.T[1] * dy + Bj.T[2] * dz) - ri * sin >= lim) continue;
        for (const pt of ptsOf(i)) for (const o of ptsOf(j)) {
          const dist = len(sub(o.q, pt.q));
          if (dist >= cell) continue;
          mark(pt, cell - dist, o.i); mark(o, cell - dist, pt.i);
        }
      }
    }
  }
}

module.exports = { validate, revalidate, lapOf, speedProfile, SRC, ROLL_RED_DEG_M, ROLL_AMBER_DEG_M, ROLL_CHORD_M, TUBE_MIN_W, _internal: { ranges, rollRates } };
