// adapter.js: the core's document → the SAME path samples src/geom builds (the spec's GO §6), so the preview, cameras,
// mesh, validation and export are reused unchanged.
//
//   toSegments(doc, { segM = 2, segMFor, designKmh, cupRuns = true, cache }) -> src/geom segments (each carries its profile; a cup's, and a legacy segment whose
//                                               width or r changes (a CHORD, `chord: true`), also a blend: see legacySeg). `cache`, a WeakMap
//                                               the caller keeps (the window's shell, so placing a piece does not rebuild every piece before it):
//                                               a piece whose own object, neighbours, seam role and incoming state are all what they were last
//                                               time returns its last segments (FROZEN, shared between documents) instead of building them again.
//                                               The result equals the uncached one exactly (test/core_segcache.test.js); without `cache`, unchanged.
//                                               a NEW piece object that differs from the one last cached for its id only in the lift channels h
//                                               and l (a Grab's step), with the same inputs, reuses that piece's segments: no segment reads h or l
//                                               (test/core_segcache_lift.test.js).
//   toPath(doc, { step = 0.5, segM = 2, designKmh }) -> { segments, path }; path = buildPath(segments, { step, closed, start }),
//                                               samples { s, seg, pos, T, L, U, kvec, roll, bankG, grade }
//   profileAt(family, w, r)                    the LEGACY cross-section at a station (ref 09 §3), unchanged since the core began
//   cupProfile(family, w, c)                   the CUP cross-section (ref 09 §9): the edge angle is c degrees on both sides
//
// A ROAD piece becomes consecutive segments of at most segM metres. Each is the geometry's own clothoid: heading rate
// k and pitch rate kp run linearly from the channel's values at its two ends, and roll runs between them by the
// geometry's smoothstep (src/geom/path.js "CURVE MODEL"). So between knots the adapter follows the cubic channels by
// chords of segM metres. The error that costs is measured by test/core_adapter.test.js, not assumed (src/core/README.md
// "stated deviation").
// A CUP piece (P.cup) is meshed from the same segments, but each carries a cupProfile at c. By DEFAULT (cupRuns: true) a stretch where c changes
// and the width does not shares ONE blend pair (blend: { from, s0, length }, src/geom/mesh.js), with s0 and length chosen per segment so the mesh's
// smoothstep weight lands on c(s) at both ends of the segment: the rows are the same cross-section at the same sample fractions, so no seam zip
// is emitted inside the piece and the wall follows c on the road (measured: 0 seams, the edge within 0.05° of c at every row on a smoothstep ramp).
// The price: segment.profile is then the TARGET of the blend (the run's widest), so every reader of it that is not the mesh evaluates the blend at
// its station with src/geom/profile.js atSegment (the marker layout's floor, validation, the water, the camera's span, the export's sections).
// Where a cup follows a LEGACY piece the first MORPH_M metres also fade out the legacy shape's difference from the cup shape (morphZone), so the
// joint has no step inside the road either. cupRuns: false is the other scheme (each segment's profile the local end profile, a seam zip wherever
// c changes, the edge up to 0.95° off c inside a segment): kept for comparison; see README "the cup".
// A FLIGHT piece (the free flight) becomes ONE gap segment that ends at the landing's pose (src/geom/path.js `to`: the take-off's heading frame,
// forward, left, up; the landing's heading turn and pitch); its roll goes from the take-off's bank to the landing's. No ramp is generated: the road
// after it is the user's landing, which starts there. The cross-section starts afresh after the air (nothing morphs across a flight).
'use strict';

const D = require('./document.js');
const { buildPath } = require('../geom/path.js');
const { normalize, psiAt, blend, commonFractions } = require('../geom/profile.js');
const { FLOORS, AT } = require('../geom/fonts.js');
const { flightLength } = require('../geom/path.js');
const { MACH6 } = require('../validate/limits.js');

const DEG = Math.PI / 180;

/** The cross-section at width w (m) and rise rate r (°/m): the family's measured floor, each quarter's rise capped at r·w/8 (ref 09 §3). */
function profileAt(family, w, r) {
  if (!Object.prototype.hasOwnProperty.call(FLOORS, family)) throw new D.CoreError('BAD_FAMILY', `family "${family}"`);
  if (!(w > 0)) throw new D.CoreError('BAD_WIDTH', `the road's width must be positive, got ${w} m`);
  // one FROZEN profile per family, width and rate (a -0 rate told from a 0), kept: a 2,000 m ghost asked for 3,000 of them, mostly the same, each built and then frozen again (a
  // quarter of the candidate's cost, the measurement of 2026-10-19). The numbers are made by the same code as before; nothing changes a profile after it is made (every segment is frozen)
  const key = family + '|' + w + '|' + (Object.is(r, -0) ? '-0' : r);
  let hit = PROFILES.get(key);
  if (!hit) { hit = deepFreeze(profileMade(family, w, r)); if (PROFILES.size >= PROFILES_MAX) PROFILES.delete(PROFILES.keys().next().value); PROFILES.set(key, hit); }
  return hit;
}
const PROFILES = new Map(), PROFILES_MAX = 256;
function profileMade(family, w, r) {
  const F = FLOORS[family], quarter = w / 8, deg = []; let prev = 0;
  F.forEach((target, i) => { prev += Math.min(target - (i ? F[i - 1] : 0), Math.max(0, r) * quarter); deg.push(prev); });
  const side = AT.map((f, i) => [(f * w) / 2, deg[i] * DEG]);
  return {
    font: family,
    u: [...side.slice().reverse().map(([x]) => -x), 0, ...side.map(([x]) => x)],
    psi: [...side.slice().reverse().map(([, p]) => p), 0, ...side.map(([, p]) => p)],
    material: 'ROAD',
  };
}

const CUP_TOL = 0.5 * 10 ** -D.DEC.c;   // half the cup's stored quantum (DEC.c decimals): what rounds to 0 is 0
/** The CUP cross-section at width w (m) and edge angle c (degrees), ref 09 §9: ψ at the four quarters of each half-width is c·Fᵢ/F_edge, both sides. */
function cupProfile(family, w, c) {
  if (!Object.prototype.hasOwnProperty.call(FLOORS, family)) throw new D.CoreError('BAD_FAMILY', 'family "' + family + '"');
  if (!(w > 0)) throw new D.CoreError('BAD_WIDTH', 'the road\'s width must be positive, got ' + w + ' m');
  // a close measures its path on the UNROUNDED solve, where a flat cup's control point comes back as −1e-15, and this refused it
  // (TEST 10: the start try [p1, p23] fell through to [p5, p23]). A value within half the stored quantum of 0 is 0; a stored document's own check is document.js's
  if (!Number.isFinite(c) || c < -CUP_TOL) throw new D.CoreError('BAD_CUP', 'the cup must be a number of degrees from 0, got ' + c);
  if (c < 0) c = 0;
  const F = FLOORS[family], side = AT.map((f, i) => [(f * w) / 2, ((c * F[i]) / F[F.length - 1]) * DEG]);
  return {
    font: family,
    u: [...side.slice().reverse().map(([x]) => -x), 0, ...side.map(([x]) => x)],
    psi: [...side.slice().reverse().map(([, p]) => p), 0, ...side.map(([, p]) => p)],
    material: 'ROAD',
  };
}

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));   // the mesh's weight (src/geom/profile.js smoothstep); also G, the edge curve's shape (ref 09 §10)

// ── THE CROSS-SECTION LAP: the tube, the edge curve, and the pieces that carry them (ref 09 §10) ──────────────────────────────
const EDGE_MIN_N = 64;      // outer-zone intervals of an edge profile: at least this, and ceil(1.5·e_max) above 43° (the polyline's own sag is e·G″max/(8n²) ≤ 0.05° at n ≥ 47 for e = 150)
const TUBE_N = 12;          // knots per side of a tube profile: ψ is linear in u, so the polyline is exact at any count; the validator and the stack check read these lines
const HEARTLINE_FROM = 300; // a tube's roll axis leaves the road centre at this sweep and reaches the tube's own axis at 360 (smoothstep): the heartline is continuous, never a step (seal S2 ii). 300 = 2·CUP_MAX: the last sweep a cup can take over from (its edge is t/2 <= 150), so a tube handing over to a cup or a plain piece has heartline 0 at the joint

/** The TUBE cross-section at width w (m) and sweep t (degrees): ψ = (t/2)·|u|/h on each side, a circular arc of radius w/t_rad (ref 09 §10). */
function tubeProfile(w, t) {
  if (!(w > 0)) throw new D.CoreError('BAD_WIDTH', `the road's width must be positive, got ${w} m`);
  if (!Number.isFinite(t) || t < 0 || t > D.TUBE_MAX + 1e-9) throw new D.CoreError('BAD_TUBE', `the tube sweep must be from 0 to ${D.TUBE_MAX} degrees, got ${t}`);
  const h = w / 2, side = Array.from({ length: TUBE_N }, (_, k) => [(h * (k + 1)) / TUBE_N, ((t / 2) * (k + 1) / TUBE_N) * DEG]);
  return { font: 'tube', u: [...side.slice().reverse().map(([x]) => -x), 0, ...side.map(([x]) => x)], psi: [...side.slice().reverse().map(([, p]) => p), 0, ...side.map(([, p]) => p)], material: 'ROAD' };
}
/**
 * The EDGE profile (ref 09 §10): the middle profile `base` plus e degrees of extra turning over the outer zone, ψ = ψ_mid + e·G(t), t = (|u|/h − s)/(1 − s), G = 3t² − 2t³, on both
 * sides. Its knots are the base's plus nE + 1 equal steps of the outer zone each side (the slice itself and the edge included); ψ_mid at a new knot is the base's own linear
 * interpolation, as the mesh reads it. A piece with no edge never calls this: its profile object is the base, untouched (e = 0 is the identity, seal E3).
 */
function edgeProfile(base, e, s, nE, er = e, frame = edgeFrame(base, s, nE)) {   // er: the RIGHT side (u < 0), e the left; equal, it is the symmetric edge exactly as before
  const { P, u, R, mid } = frame;
  const psi = u.map((x, i) => { const r = R[i]; return mid[i] + (r > s ? (x < 0 ? er : e) * DEG * smooth((r - s) / (1 - s)) : 0); });
  return { font: P.font === 'tube' ? 'tube-edge' : 'edge', u: u.slice(), psi, material: P.material };   // the font says which cap applies (validate: edge-past-cap)
}
/** What an edge profile takes from its base, its start s and nE alone, not from e: the knots u, each one's share r of its side, and ψ_mid there. xsecSegments
 *  makes it once per piece for each base it meets (a piece of one width and rate has one), so a chord end adds only its e·G; the same numbers by the same expressions. */
function edgeFrame(base, s, nE) {
  const P = normalize(base), hr = -P.u[0], hl = P.u[P.u.length - 1], us = [...P.u];
  for (let k = 0; k <= nE; k++) { const f = s + ((1 - s) * k) / nE; us.push(hl * f, -hr * f); }
  us.sort((a, b) => a - b);
  const u = us.filter((x, i) => i === 0 || x - us[i - 1] > 1e-12), R = new Array(u.length), mid = new Array(u.length);
  u.forEach((x, i) => { const h = x < 0 ? hr : hl, r = h > 0 ? Math.abs(x) / h : 0; R[i] = r; mid[i] = psiAt(P, x); });
  return { P, u, R, mid };
}
/** The middle cross-section of piece P at the channel values x: the legacy profileAt, the cup, or the tube. */
function baseProfileOf(P, x) { return P.tube ? tubeProfile(x.w, x.t) : P.cup ? cupProfile(P.family, x.w, x.c) : profileAt(P.family, x.w, x.r); }
/** The heartline (m) a tube's roll turns about at channel values x: R = w/2π once the tube is closed, 0 while it is open, a smoothstep between (ref 09 §10). */
const heartlineOf = (P, x) => (P.tube ? (x.w / (2 * Math.PI)) * smooth((x.t - HEARTLINE_FROM) / (D.TUBE_MAX - HEARTLINE_FROM)) : 0);

/**
 * The segments of a TUBE or EDGE piece, or of a piece entering from a different kind of cross-section. Every segment is a CHORD: its profile is the one at its END, blended
 * from the one at its START, so the rows at its two ends are the ends' own cross-sections (a moving edge slice is not linear in s, ref 09 §10, so no blend pair can be shared
 * along a run as the cup's is). ONE fraction array serves the whole piece (profile.js commonFractions, mesh.js seg.fractions), so the row a segment ends on and the next one
 * starts on are the same vertices: no seam zip inside the piece. Entering from another kind (legacy, cup or tube), the first MORPH_M metres blend from the previous piece's
 * last profile into the piece's own (smoothstep in s), so the first row IS the previous last row and the joint steps nothing. A piece with a closed tube also carries the
 * heartline fields (linear over the segment) and the roll rates (so the roll is C1 across segments): the spiral's floor is smooth.
 */
function xsecSegments(P, n, at, join) {
  const s = (j) => (P.length * j) / n, E = Array.from({ length: n + 1 }, (_, j) => at(s(j))), edge = !!P.edge;
  const nE = edge ? Math.max(EDGE_MIN_N, Math.ceil(1.5 * Math.max(...E.map((x) => Math.max(Math.abs(x.e), Math.abs(x.er)))))) : 0;   // sized by the steeper side, a side that turns down by its size
  const frames = new Map();   // one edgeFrame per base and start, not one per chord end (the legacy base is one kept object per width and rate, profileAt)
  const frameOf = (b, s) => { let byS = frames.get(b); if (!byS) frames.set(b, (byS = new Map())); let f = byS.get(s); if (!f) byS.set(s, (f = edgeFrame(b, s, nE))); return f; };
  const own = (x) => { const b = baseProfileOf(P, x); return edge ? edgeProfile(b, x.e, x.s, nE, x.er, frameOf(b, x.s)) : b; };
  const Lm = join ? Math.min(MORPH_M, P.length) : 0, J = join ? normalize(join.profile) : null;
  const prof = E.map((x, j) => { const o = own(x); return J && s(j) < Lm - 1e-9 ? blend(J, normalize(o), smooth(s(j) / Lm)) : o; });
  const fractions = commonFractions(prof), hl = E.map((x) => heartlineOf(P, x)), spiral = hl.some((x) => x > 0), out = new Array(n);
  const rate = (j) => D.channelAt(P, 'phi', s(j)).d1;
  for (let j = 0; j < n; j++) {
    out[j] = { profile: prof[j + 1], blend: { from: prof[j], s0: 0, length: s(j + 1) - s(j) }, start: prof[j], end: prof[j + 1], chord: true, fractions,
      ...(spiral ? { heartline: hl[j], heartline1: hl[j + 1], rollRate0: rate(j), rollRate1: rate(j + 1) } : {}) };
  }
  return out;
}
/** z in [0, 1] with smooth(z) = y (the mesh's weight inverted), by the closed form then two Newton steps. */
function unsmooth(y) {
  if (y <= 0) return 0; if (y >= 1) return 1;
  let z = 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3);
  for (let k = 0; k < 2; k++) { const d = 6 * z * (1 - z); if (d > 1e-12) z = Math.min(1, Math.max(0, z - (smooth(z) - y) / d)); }
  return z;
}

/**
 * The profile and blend of each of a cup piece's n segments. at(s) gives the channels; segment j spans s_j to s_{j+1}.
 * A RUN is consecutive segments over which the width stays put. Its ends make ONE pair: A at the run's lowest c and B at its highest.
 * At a fixed width the cup profile is linear in c (ref 09 §9), so blend(A, B, x) IS the cup profile at c = (1 − x)·c_lo + x·c_hi, and
 * a segment's blend puts the mesh's smoothstep weight on x at both of its ends (s0 and length solve smoothstep((s0 + d)/length) = x
 * at d = 0 and at d = the segment's length). A segment where c falls swaps the pair (from B, own A, weight 1 − x): blendSamples is
 * symmetric in its two profiles, so every segment of the run has the same sample fractions and the same K, and the boundary rows of
 * two segments are the same cross-section at the same u: no seam zip between them, and the wall follows c along the road instead of
 * stepping every segM metres. A run where c does not move is one profile with no blend. A segment where the width moves is a run of
 * its own (its chord, from the profile at its start to the one at its end).
 */
function cupSegmentsRuns(P, n, at, join = null, tail = null) {
  const s = (j) => (P.length * j) / n, E = Array.from({ length: n + 1 }, (_, j) => at(s(j))), out = new Array(n);
  const wTol = (w) => 1e-9 * Math.max(1, w), cTol = 1e-9;
  let j = 0;
  if (join) j = morphZone(P, n, E, s, join, out);   // the first metres of a cup that follows a legacy piece
  const nr = tail ? tailZone(P, n, E, s, tail, out, j) : n;   // the last metres of a cup that closes onto a legacy start: the runs stop where the fade begins
  while (j < nr) {
    const wRun = E[j].w, chord = Math.abs(E[j + 1].w - wRun) > wTol(wRun);
    if (chord) {
      const A = cupProfile(P.family, wRun, E[j].c), B = cupProfile(P.family, E[j + 1].w, E[j + 1].c);
      out[j] = { profile: B, blend: { from: A, s0: 0, length: s(j + 1) - s(j) }, end: B };
      j++; continue;
    }
    let k = j; while (k + 1 < nr && Math.abs(E[k + 2].w - wRun) <= wTol(wRun)) k++;   // the run is segments j..k
    let lo = Infinity, hi = -Infinity; for (let m = j; m <= k + 1; m++) { lo = Math.min(lo, E[m].c); hi = Math.max(hi, E[m].c); }
    if (hi - lo <= cTol) {
      const prof = cupProfile(P.family, wRun, E[j].c);
      for (let m = j; m <= k; m++) out[m] = { profile: prof, blend: null, end: prof };
    } else {
      const A = cupProfile(P.family, wRun, lo), B = cupProfile(P.family, wRun, hi), X = (m) => Math.min(1, Math.max(0, (E[m].c - lo) / (hi - lo)));
      for (let m = j; m <= k; m++) {
        const len = s(m + 1) - s(m), up = X(m + 1) >= X(m);
        const from = up ? A : B, own = up ? B : A, ya = up ? X(m) : 1 - X(m), yb = up ? X(m + 1) : 1 - X(m + 1);   // the weight of own runs ya → yb, rising
        let blend;
        if (ya >= 1 - 1e-12) blend = { from, s0: len, length: len };            // weight 1 all along: the segment is own
        else if (yb <= 1e-12) blend = { from, s0: 0, length: 1e15 };            // weight 0 all along: the segment is from
        else { const za = unsmooth(ya), zb = Math.max(unsmooth(yb), za + 1e-12), length = len / (zb - za); blend = { from, s0: za * length, length }; }
        out[m] = { profile: own, blend, end: cupProfile(P.family, wRun, E[m + 1].c) };
      }
    }
    j = k + 1;
  }
  return out;
}

/**
 * THE MORPH OUT OF A LEGACY CROSS-SECTION. Where the r cap binds, the legacy piece's last profile is the CAPPED shape and the cup's
 * first is the proportional one at the same edge: they agree at the edge and differ inside the road (36.0 mm on a 12 m bowl, 148.2 mm on a 24 m
 * half-pipe, B's score). So the first metres of the cup carry the legacy profile's difference from the cup shape at c(0), fading by smoothstep
 * over MORPH_M metres: the first row IS the legacy piece's last row (no step), the edge stays c throughout, and past MORPH_M the road is the pure
 * cup shape. Each morph segment is a chord (from the morph profile at its start to the one at its end). Returns the index of the first segment
 * after the zone. `join.profile` is the profile of the segment before the cup (the legacy piece's last).
 */
const MORPH_M = 10;
function morphZone(P, n, E, s, join, out) {
  const Lg = join.profile, C0 = cupProfile(P.family, E[0].w, E[0].c);
  if (!Lg || !Array.isArray(Lg.psi) || Lg.psi.length !== C0.psi.length || Lg.u.length !== C0.u.length) return 0;
  const dpsi = Lg.psi.map((x, i) => x - C0.psi[i]);
  if (dpsi.every((x) => Math.abs(x) < 1e-9)) return 0;   // (measured: the legacy and cup profiles' u are equal at the same width, so only ψ morphs)
  const Lm = Math.min(MORPH_M, P.length), mu = (x) => 1 - smooth(x / Lm);
  const at = (j) => { const cw = cupProfile(P.family, E[j].w, E[j].c), m = mu(s(j)); return { font: cw.font, material: cw.material, u: cw.u, psi: cw.psi.map((x, i) => x + m * dpsi[i]) }; };
  let j = 0;
  while (j < n && s(j) < Lm - 1e-9) { const B = at(j + 1); out[j] = { profile: B, blend: { from: at(j), s0: 0, length: s(j + 1) - s(j) }, end: B }; j++; }
  return j;
}

/**
 * THE MORPH INTO A LEGACY CROSS-SECTION: the mirror of morphZone, for a cup that CLOSES a lap onto a legacy start (the zip at
 * s = 0 joins the cup's last row to the legacy start's first row: B measured 23.2 mm on a 16 m bowl and 148.2 mm on a 24 m half-pipe where the r
 * cap binds). close() holds c at the seam to the legacy start's rendered edge, so the two shapes agree at the edge and differ inside the road; the
 * last metres of the cup (at least MORPH_M, from the last segment boundary at or before length − MORPH_M, and never into the head morph) fade
 * the difference d = T.psi − cupProfile(c end).psi in by smoothstep, and the width the same way: the last row IS the legacy start's first row.
 * T is that first row's profile (the legacy piece's first segment). Returns the index of the first segment of the zone (the runs stop there).
 */
function tailZone(P, n, E, s, T, out, jStart) {
  if (!T || !Array.isArray(T.psi)) return n;
  const Cend = cupProfile(P.family, E[n].w, E[n].c);
  if (T.psi.length !== Cend.psi.length || T.u.length !== Cend.u.length) return n;
  const dpsi = T.psi.map((x, i) => x - Cend.psi[i]), du = T.u.map((x, i) => x - Cend.u[i]);
  if (dpsi.every((x) => Math.abs(x) < 1e-9) && du.every((x) => Math.abs(x) < 1e-9)) return n;
  let m0 = n; while (m0 > jStart && s(m0) > P.length - MORPH_M + 1e-9) m0--;   // s(m0) <= length - MORPH_M (or the piece is too short: the zone is what is left after the head morph)
  m0 = Math.max(m0, jStart); if (m0 >= n) return n;
  const a0 = s(m0), Lz = P.length - a0, mu = (x) => smooth((x - a0) / Lz);
  const at = (j) => { const cw = cupProfile(P.family, E[j].w, E[j].c), m = mu(s(j)); return { font: cw.font, material: cw.material, u: cw.u.map((x, i) => x + m * du[i]), psi: cw.psi.map((x, i) => x + m * dpsi[i]) }; };
  for (let j = m0; j < n; j++) { const B = at(j + 1); out[j] = { profile: B, blend: { from: at(j), s0: 0, length: s(j + 1) - s(j) }, end: B }; }
  return m0;
}

/**
 * The LOCAL cup segments (cupRuns: false): each segment's profile is the cup profile at its END and its blend runs from the profile at its START,
 * so segment.profile is the local cross-section (within one segment's change of c of the road it draws) and the rows still follow
 * c(s) at every segment end. Where neither c nor the width moves by more than CFLAT_DEG = 0.02° (the fit's ringing decays for
 * about a hundred metres after a transition, so c is never exactly constant), the segments share ONE profile (the first one's, the ANCHOR) with no blend:
 * identical profiles have identical rows, so no seam zip is emitted along a held cup. The price is at most CFLAT_DEG of wall.
 */
const CFLAT_DEG = 0.02;
function cupSegmentsLocal(P, n, at) {
  const s = (j) => (P.length * j) / n, out = new Array(n), wTol = (w) => 1e-9 * Math.max(1, w);
  const near = (x, y) => Math.abs(x.c - y.c) <= CFLAT_DEG && Math.abs(x.w - y.w) <= wTol(y.w);
  let a = at(0), anchor = null, anchorProfile = null;
  for (let j = 0; j < n; j++) {
    const b = at(s(j + 1));
    if (anchor && near(a, anchor) && near(b, anchor)) out[j] = { profile: anchorProfile, blend: null, end: anchorProfile };
    else if (near(a, b)) { anchor = a; anchorProfile = cupProfile(P.family, a.w, a.c); out[j] = { profile: anchorProfile, blend: null, end: anchorProfile }; }
    else { anchor = null; const B = cupProfile(P.family, b.w, b.c); out[j] = { profile: B, blend: { from: cupProfile(P.family, a.w, a.c), s0: 0, length: s(j + 1) - s(j) }, end: B }; }
    a = b;
  }
  return out;
}

/** Two profiles are the same cross-section when every u and ψ agrees to 1e-12 (an r that does not bind the cap gives the same profile at any r). */
const sameProfile = (A, B) => A.u.length === B.u.length && A.u.every((x, i) => Math.abs(x - B.u[i]) <= 1e-12) && A.psi.every((x, i) => Math.abs(x - B.psi[i]) <= 1e-12);
/**
 * A LEGACY segment. Where the width or the rise rate changes inside the segment so that its cross-section does, it is drawn as a CHORD, like the cup's
 * chord segments: the profile at its END, blended from the profile at its START (the mesh's smoothstep weight over the segment), so the rows at its two ends
 * are the ends' own cross-sections and neighbouring segments share their row: no staircase of width steps and no step at a joint (before: one profile at the
 * MIDDLE width per segment: 0.29 m steps between segments in fixture F4, 0.86 m in F8, 4.8 m for a 20 m ramp of 19 m). Where the two ends draw the same
 * cross-section (a constant width and r, or an r that does not bind the cap) it is exactly today's segment, the profile at the middle width and no blend,
 * so such a piece renders byte for byte as before. `start` and `end` are the segment's first and last rows; `chord` marks it for the readers.
 */
function legacySeg(fam, a, b, mid, length) {
  const A = profileAt(fam, a.w, a.r), B = profileAt(fam, b.w, b.r);
  if (sameProfile(A, B)) { const p = profileAt(fam, mid.w, mid.r); return { profile: p, blend: null, start: p, end: p, chord: false }; }
  return { profile: B, blend: { from: A, s0: 0, length }, start: A, end: B, chord: true };
}

/** Freeze a segment and every object and array inside it (its profiles, blend, fractions), so a cached segment cannot change under a reader that keys it once. */
function deepFreeze(v) {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v) || ArrayBuffer.isView(v)) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze(v[k]);
  return v;
}

// (A tube drag step rebuilt every piece after the brushed one, at every step.) the cross-sections carried in from the piece before (inputsOf's lastProfile
// and lastPlain) are keyed by VALUE. A rebuilt piece hands on a new object even when its last row is unchanged, and keyed by identity that missed for the
// next piece, whose own last row was then new too, and so on to the lap's end. `piece` reads a carried cross-section only for its numbers and strings, so
// equal values give the same segments, bit for bit.
const BY_VALUE = new Set([10, 13]);
// the LIFT channels, height and lateral. No segment reads them (the lift does: offsetPath, after the path is built), so a piece that differs from the
// one last cached for its id in these alone has that piece's segments, number for number. A Grab drag makes exactly such pieces at every step (measured on
// sculpt-frame row 2: 3 pieces a step, every segment identical, about 1.5 ms). The piece last cached for each id is kept beside the cache (LAST_BY_ID, per cache).
const LIFT = new Set(['h', 'l']), LAST_BY_ID = new WeakMap();
/** The same piece but for its lift channels: every field equal by value, and every channel but h and l. */
function sameButLift(A, B) {
  const ka = Object.keys(A), kb = Object.keys(B);
  if (ka.length !== kb.length || !ka.every((x, i) => x === kb[i])) return false;
  for (const x of ka) {
    if (x !== 'channels') { if (!sameValue(A[x], B[x])) return false; continue; }
    const ca = Object.keys(A.channels), cb = Object.keys(B.channels);
    if (ca.length !== cb.length || !ca.every((c, i) => c === cb[i] && (LIFT.has(c) || sameValue(A.channels[c], B.channels[c])))) return false;
  }
  return true;
}
/** Equal all the way down: numbers by Object.is (−0 is not 0), arrays and plain objects key by key; anything else by identity. */
function sameValue(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const pa = Object.getPrototypeOf(a), pb = Object.getPrototypeOf(b);
  if (pa !== pb || !(pa === Object.prototype || pa === Array.prototype)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((x, i) => x === kb[i] && sameValue(a[x], b[x]));
}

/**
 * The lip of road piece R as the lift builds it (offsetPath), in a flight's own frame (x left, y up, z forward; heading 0, the route's pitch p0 at the lip): its
 * end moved by l along the heading's left and h along world up, and the lifted tangent there, d1 = T + h′·up + l′·left − kh·l·forward (offsetPath's d1 at the end),
 * as a heading and a pitch. Null when h, l and their slopes are all 0 at the end: then the lift leaves the lip where the route put it.
 */
function lipOf(R, p0) {
  if (!R || R.type !== 'road') return null;
  const h = D.channelAt(R, 'h', R.length), l = D.channelAt(R, 'l', R.length);
  if (!(h.v || h.d1 || l.v || l.d1)) return null;
  const kh = D.valuesAt(R, R.length).kh, d1 = [l.d1, Math.sin(p0) + h.d1, Math.cos(p0) - kh * l.v];
  return { x: [l.v, h.v, 0], theta: Math.atan2(d1[0], d1[2]), p: Math.asin(d1[1] / Math.hypot(d1[0], d1[1], d1[2])) };
}
/** What a flight's segment reads of the piece before it (lipOf's inputs), as one string for the segment cache's key. */
const lipKey = (R) => (R && R.type === 'road' ? ['h', 'l'].map((ch) => { const v = D.channelAt(R, ch, R.length); return `${v.v},${v.d1}`; }).join(';') + `;${D.valuesAt(R, R.length).kh}` : '');

/**
 * THE ROLL CARRIED THROUGH A JOINT, as built (the user, 2026-11-02, RIBBON CORKSCREW TEST: "on some turns there are bumps from connecting different banking, it is
 * shown completely with the telemetry going through the last straight ribbon section that goes banked 90 degrees all the way around 360 degrees"). Every bank ramp
 * starts and ends at rest (src/core/extend.js), so where the next piece rolls on the same way the roll stopped at the joint and started again: on his 250 m pieces
 * banking -90° each, from 0.516 °/m mid-piece to 0.006 °/m at every joint, a surge of roll at a wheel off the centre each time.
 * A joint is CARRIED where two road pieces meet with the roll at rest and both roll the same way at their middles (at least CARRY_MIN). The bank at the joint stays
 * the document's; the roll passes through it at the two pieces' joint rate, their bank changes added over their lengths added, with no roll acceleration. Each side
 * of a carried joint is built as a quintic that keeps the bank, its rate and its roll acceleration at both of its ends, so the built roll is C2 throughout:
 *   - a piece carried at both ends: one quintic over the whole piece, joint rate to joint rate (his equal -90° pieces: exactly constant, 0.36 °/m);
 *   - a piece carried at one end only: its other half is built as it was, and the carried half runs from its middle (as built there) to the joint.
 * Only the BUILT roll moves, and only on such pieces; the document is not rewritten, so his saved track is carried as it is. Not across a flight (the pieces are
 * adjacent roads), into or out of a tube (its roll axis is the heartline), at the lap's seam, or where a carried half's rate would turn back.
 *   carryOf(doc, i) -> the carry across the joint between pieces i and i + 1, or null: { r, key }, r the roll rate through the joint, rad/m
 */
const CARRY_MIN = 0.02 * Math.PI / 180;   // rad/m: a piece rolling slower than this at its middle is holding its bank
const CARRY_REST = 0.002 * Math.PI / 180;   // rad/m: the roll at the joint counts as at rest under this
const deltaOf = (P) => D.channelAt(P, 'phi', P.length).v - D.channelAt(P, 'phi', 0).v;
function carryOf(doc, i) {
  const A = doc.pieces[i], B = doc.pieces[i + 1];
  if (!A || !B || A.type !== 'road' || B.type !== 'road' || A.tube || B.tube) return null;
  const mA = D.channelAt(A, 'phi', A.length / 2), mB = D.channelAt(B, 'phi', B.length / 2);
  if (Math.abs(D.channelAt(A, 'phi', A.length).d1) > CARRY_REST || Math.abs(D.channelAt(B, 'phi', 0).d1) > CARRY_REST) return null;
  if (!(Math.abs(mA.d1) >= CARRY_MIN && Math.abs(mB.d1) >= CARRY_MIN) || Math.sign(mA.d1) !== Math.sign(mB.d1)) return null;
  const r = (deltaOf(A) + deltaOf(B)) / (A.length + B.length);
  if (Math.sign(r) !== Math.sign(mA.d1)) return null;
  // each side's half on its own (its far end as built), so the rate never turns back: the whole-piece quintic of a piece carried at both ends lies between them
  const halfA = [mA.v, mA.d1 * A.length / 2, mA.d2 * (A.length / 2) ** 2, 0, r * A.length / 2, D.channelAt(A, 'phi', A.length).v];
  const halfB = [D.channelAt(B, 'phi', 0).v, r * B.length / 2, 0, mB.d2 * (B.length / 2) ** 2, mB.d1 * B.length / 2, mB.v];
  for (const c of [halfA, halfB]) for (let k = 0; k <= 64; k++) if (Math.sign(quinticD1(c, k / 64)) !== Math.sign(r)) return null;
  return { r, key: String(r) };
}
// the quintic Hermite on u in [0, 1] through value, slope and second derivative at both ends: c = [y0, d0, c0, c1, d1, y1], slopes and seconds scaled by the span
function quinticAt(c, u) {
  const u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u, [y0, d0, c0, c1, d1, y1] = c;
  return y0 * (1 - 10 * u3 + 15 * u4 - 6 * u5) + d0 * (u - 6 * u3 + 8 * u4 - 3 * u5) + c0 * (0.5 * u2 - 1.5 * u3 + 1.5 * u4 - 0.5 * u5)
    + c1 * (0.5 * u3 - u4 + 0.5 * u5) + d1 * (-4 * u3 + 7 * u4 - 3 * u5) + y1 * (10 * u3 - 15 * u4 + 6 * u5);
}
function quinticD1(c, u) {
  const u2 = u * u, u3 = u2 * u, u4 = u3 * u, [y0, d0, c0, c1, d1, y1] = c;
  return y0 * (-30 * u2 + 60 * u3 - 30 * u4) + d0 * (1 - 18 * u2 + 32 * u3 - 15 * u4) + c0 * (u - 4.5 * u2 + 6 * u3 - 2.5 * u4)
    + c1 * (1.5 * u2 - 4 * u3 + 2.5 * u4) + d1 * (-12 * u2 + 28 * u3 - 15 * u4) + y1 * (30 * u2 - 60 * u3 + 30 * u4);
}
/** The built bank of piece P given the carries through its first joint (left) and its last (right): a function of s, or null where nothing is carried. */
function carriedPhiOf(P, left, right) {
  if (!left && !right) return null;
  const L = P.length, h = L / 2, v0 = D.channelAt(P, 'phi', 0).v, v1 = D.channelAt(P, 'phi', L).v, m = D.channelAt(P, 'phi', h);
  if (left && right) { const c = [v0, left.r * L, 0, 0, right.r * L, v1]; return (s) => quinticAt(c, s / L); }
  if (right) { const c = [m.v, m.d1 * h, m.d2 * h * h, 0, right.r * h, v1]; return (s) => (s >= h ? quinticAt(c, (s - h) / h) : null); }
  const c = [v0, left.r * h, 0, m.d2 * h * h, m.d1 * h, m.v]; return (s) => (s <= h ? quinticAt(c, s / h) : null);
}
/**
 * THE BANK'S CORNERS, as built (the user, 2026-11-03, RIBBON CORKSCREW TEST: "EVERYTIME there is a banked piece that tries to bank back towards center or another
 * banking there are rank bumps"; his picture shows a crease in the road's edge there). A bank ramp starts and ends its roll over a short rounding (about 10 to
 * 20 m, src/core/extend.js), so wherever the roll starts, stops, turns back or changes rate, the roll's ACCELERATION peaked: on his track up to 0.058 °/m², a lift
 * of 295 m/s² at a wheel 10 m out at 170 m/s (his replay: 62 to 134 m/s² where it turns back, holds or starts). After the carry (above), the built bank of each run
 * of road pieces (a flight or a tube ends a run) is read every BANK_DS m; wherever the roll accelerates faster than BANK_BAR (3 g at a wheel 10 m out at 170
 * m/s, the bar the bank ramps' own onset is held to elsewhere), that corner is re-rounded: a window centred where the roll's two straight runs would meet, grown
 * until one quintic across it (the bank, its rate and its acceleration matched at both ends, so the built bank stays C2) accelerates no faster than the bar.
 * Outside the windows the built bank is the carried one, value for value, so every hold and target is kept; inside, the corner's roll is spread over the
 * window instead of its rounding. A window is at most CORNER_MAX either side, never leaves its run, and windows that would overlap are one window. A bank that
 * never accelerates faster than the bar is built exactly as before. Only the BUILT roll moves; the document is not rewritten.
 *   bankPlan(doc) -> per piece index: { fn: s -> phi, or null where the piece is built as the document lays it, key: a string of what it depends on }
 */
const BANK_BAR = 29.4 / (10 * 170 * 170);   // rad/m²: 3 g at a wheel 10 m out at 170 m/s
const BANK_DS = 2;   // m: the built bank is read this often along a run
const CORNER_MAX = 250;   // m: the longest a window reaches either side of its corner
const BANK_WILD = 0.1 * Math.PI / 180;   // rad: how far a window may leave the range of the bank it replaces (see build in bankPlan)
const BANK_TURN_KEEP = 4 * Math.PI / 180;   // rad: how far a window may move the bank where the road turns: inside the lean rows' 5° (core_close_banks_lap), a degree kept for the lean being read off the built path, not the bank
const TURN_KH = 1 / 600;   // 1/m: a station turns when |κh| is over this (D443's curved station)
const JOINT_NEAR = 25;   // m: a corner this close to a joint is rounded up to the joint from each side, so the joint keeps its own bank
// A piece's own bank read every BANK_DS (the document's, before any carry), kept by its BANK CHANNEL (the array, with its knots and length), not by the piece:
// a turn or climb drag makes a new piece object every step and leaves the bank array as it was, and re-reading a 20 km piece's bank cost 90 ms a step (the
// 20,000 m turn drag went from 8 to 100 ms p95, drag-frame row 4). A bank whose control points are all one value is that value everywhere: no reading at all
const BANK_DOC = new WeakMap();
const constantPhi = (P) => { const c = P.channels.phi; for (let k = 1; k < c.length; k++) if (c[k] !== c[0]) return false; return true; };
function docSamples(P) {
  const c = P.channels.phi, hit = BANK_DOC.get(c);
  if (hit && hit.knots === P.knots && hit.length === P.length) return hit.r;
  const n = Math.max(1, Math.round(P.length / BANK_DS)), v = new Float64Array(n + 1);
  // L141 (pane B): the value alone, by document.js channelValue ("exactly channelAt(P, ch, s).v", the same basis values summed in the same order, its knot vector kept)
  if (constantPhi(P)) v.fill(c[0]); else for (let k = 0; k <= n; k++) v[k] = D.channelValue(P, 'phi', (P.length * k) / n);
  const r = { n, v }; BANK_DOC.set(c, { knots: P.knots, length: P.length, r });
  return r;
}
function bankPlan(doc) {
  const out = doc.pieces.map(() => ({ fn: null, key: '' }));
  const carryFn = doc.pieces.map((P, i) => (P.type === 'road' ? carriedPhiOf(P, carryOf(doc, i - 1), carryOf(doc, i)) : null));
  const phi1 = (i) => { const P = doc.pieces[i], c = carryFn[i]; return (s) => { const x = c ? c(s) : null; return x === null ? D.channelValue(P, 'phi', s) : x; }; };   // L141: the value alone (channelValue, exactly channelAt's .v)
  doc.pieces.forEach((P, i) => { if (carryFn[i]) out[i] = { fn: phi1(i), key: `c${carryOf(doc, i - 1) ? carryOf(doc, i - 1).key : ''}|${carryOf(doc, i) ? carryOf(doc, i).key : ''}` }; });
  // runs of road pieces, a flight or a tube between them
  const runs = []; let cur = null;
  doc.pieces.forEach((P, i) => { if (P.type !== 'road' || P.tube) { cur = null; return; } if (!cur) runs.push((cur = [])); cur.push(i); });
  for (const run of runs) {
    // the run's built bank (after the carry) every BANK_DS: global s, value, and which piece
    const S = [], V = [], at = []; let o = 0;
    for (const i of run) {
      const P = doc.pieces[i], f = carryFn[i] ? phi1(i) : null, d = f ? null : docSamples(P), n = f ? Math.max(1, Math.round(P.length / BANK_DS)) : d.n;
      for (let k = S.length ? 1 : 0; k <= n; k++) { const s = (P.length * k) / n; S.push(o + s); V.push(f ? f(s) : d.v[k]); at.push(i); }
      o += P.length;
    }
    const N = S.length; if (N < 8) continue;
    const rate = (k) => (V[k + 1] - V[k]) / (S[k + 1] - S[k]);   // between samples k and k + 1
    const acc = (k) => (rate(k) - rate(k - 1)) / ((S[k + 1] - S[k - 1]) / 2);   // at sample k
    const over = []; for (let k = 1; k < N - 1; k++) if (Math.abs(acc(k)) > BANK_BAR) over.push(k);
    if (!over.length) continue;
    // corners: runs of samples over the bar, a gap shorter than 20 m joining them
    const zones = []; for (const k of over) { const z = zones[zones.length - 1]; if (z && S[k] - S[z[1]] < 20) z[1] = k; else zones.push([k, k]); }
    const pieceOf = (s) => { let pos = 0; for (const i of run) { const L = doc.pieces[i].length; if (s <= pos + L + 1e-9) return [i, Math.min(L, Math.max(0, s - pos))]; pos += L; } const i = run[run.length - 1]; return [i, doc.pieces[i].length]; };
    const f1 = run.map((i) => phi1(i));
    const val = (s) => { const [i, t] = pieceOf(s); return f1[run.indexOf(i)](t); };
    // L141 (pane B): a piece whose turn control points are all exactly 0 turns nowhere (a B-spline of zeros is exactly 0), so it is answered without reading it: a
    // window's turning test reads 101 stations a try, and on the bank probe's straight road (extend.js probePeak) that was 8.5 of a drag's 58 ms of probes
    const straight = new Set(run.filter((i) => doc.pieces[i].channels.kh.every((x) => x === 0)));
    const turnsAt = (s) => { const [i, t] = pieceOf(s); if (straight.has(i)) return false; return Math.abs(D.channelValue(doc.pieces[i], 'kh', t)) > TURN_KH; };   // a curved station (D443's)
    const h = 0.5, d1 = (s) => (val(Math.min(S[N - 1], s + h)) - val(Math.max(0, s - h))) / (Math.min(S[N - 1], s + h) - Math.max(0, s - h));
    const d2 = (s) => { const a = Math.max(h, Math.min(S[N - 1] - h, s)); return (val(a + h) - 2 * val(a) + val(a - h)) / (h * h); };
    // the run's joints (global s): no window crosses one, so a joint keeps the bank, rate and acceleration its pieces give it, and a piece's edit moves no bank
    // past its two neighbours (a neighbour's rounding starts from the joint's own rate and acceleration). A corner within JOINT_NEAR of a joint is rounded on each side up to the joint itself; a corner inside a piece is centred where the
    // bank's two straight runs would meet, inside that piece
    const bounds = [0]; { let q = 0; for (const i of run) bounds.push((q += doc.pieces[i].length)); }
    // and the bank's own turning points inside a piece (its rate's sign flips; on a flat top, the top's middle), pinned the same way: a window joining a bump's
    // two feet erased the bump (a 5° bump built as 0°). At a turning point the rate is 0 and the acceleration is the bank's own, at most the bar, both sides
    const turns = [];
    { let last = -1; for (let k = 0; k + 1 < N; k++) { const r = rate(k); if (Math.abs(r) < 1e-9) continue;
      if (last >= 0 && Math.sign(r) !== Math.sign(rate(last))) {
        let t;
        if (k === last + 1) { let lo = S[last], hi = S[k + 1]; const sg = Math.sign(rate(last)); for (let g = 0; g < 40; g++) { const m = (lo + hi) / 2; if (Math.sign(d1(m)) === sg) lo = m; else hi = m; } t = (lo + hi) / 2; } else t = (S[last + 1] + S[k]) / 2;
        if (!bounds.some((x) => Math.abs(x - t) < 1)) turns.push(t);
      }
      last = k; } }
    const pins = [...bounds, ...turns].sort((p, q) => p - q), isTurn = (x) => turns.some((t) => Math.abs(t - x) < 1e-9);
    const spanOf = (x) => { for (let k = 1; k < pins.length; k++) if (x < pins[k] - 1e-9 || k === pins.length - 1) return [pins[k - 1], pins[k]]; return [0, S[N - 1]]; };
    // at every pin the acceleration a window starts from is at most the bar: a fitted or sculpted piece can end mid-swing (15 times the bar), and a window
    // grown from that swung the next piece's bank to -135° on its way to -40°
    const isPin = (x) => pins.some((t) => Math.abs(t - x) < 1e-9);
    const r1At = (x) => (isTurn(x) ? 0 : d1(x)), r2At = (x) => (isPin(x) ? Math.max(-BANK_BAR, Math.min(BANK_BAR, d2(x))) : d2(x));
    const build = (a, b) => {
      const W = b - a, c = [val(a), r1At(a) * W, (a <= 0 ? 0 : r2At(a)) * W * W, (b >= S[N - 1] ? 0 : r2At(b)) * W * W, r1At(b) * W, val(b)];
      let peak = 0; for (let k = 0; k <= 200; k++) { const u = k / 200, x = Math.abs(quinticD2(c, u)) / (W * W); if (x > peak) peak = x; }
      // WILD: it leaves the range of the bank it replaces by more than 0.1° (an overshoot, never a rounding); such a window is never used
      let lo = Infinity, hi = -Infinity, qlo = Infinity, qhi = -Infinity;
      for (let k = 0; k <= 100; k++) { const x = a + (W * k) / 100, v = val(x), q = quinticAt(c, k / 100); lo = Math.min(lo, v); hi = Math.max(hi, v); qlo = Math.min(qlo, q); qhi = Math.max(qhi, q); }
      const wild = qlo < lo - BANK_WILD || qhi > hi + BANK_WILD;
      // HELD: where the road turns, the bank is what the curve leans on, and a rounding centred at a corner near a curve's end re-laid the curve's last few
      // hundred metres (a Close-banked curve's exit, 32.5°, built at 15°). So a window may move a turning road's bank by at most BANK_TURN_KEEP; a wider one is
      // never used, and the corner keeps more of the document's own roll there
      let td = 0;
      for (let k = 0; k <= 100; k++) { const x = a + (W * k) / 100; if (turnsAt(x)) td = Math.max(td, Math.abs(quinticAt(c, k / 100) - val(x))); }
      return { a, b, c, peak: wild ? Infinity : peak, wild, held: td > BANK_TURN_KEEP };
    };
    const accNear = (a, b) => { let m = 0; for (let k = 1; k < N - 1; k++) if (S[k] >= a && S[k] <= b) m = Math.max(m, Math.abs(acc(k))); return m; };
    const windows = [];
    for (const [k0, k1] of zones) {
      const ka = Math.max(1, k0 - 3), kb = Math.min(N - 2, k1 + 3), r1 = rate(ka - 1), r2 = rate(kb), p1 = V[ka], p2 = V[kb];
      const H0 = Math.max((S[k1] - S[k0]) / 2 + 2 * BANK_DS, 0.9375 * Math.abs(r2 - r1) / BANK_BAR);
      // every pin the zone reaches (a turning point next to a joint is two: each rounds its own sides)
      const js = pins.slice(1, -1).filter((x) => x >= S[k0] - JOINT_NEAR && x <= S[k1] + JOINT_NEAR);
      if (js.length) for (const j of js) {
        // up to the joint from each side, each grown inside its own piece until it is under the bar; a side that does not change its bank there needs none
        for (const side of [-1, 1]) {
          const [lo, hi] = spanOf(side < 0 ? j - 1e-6 : j + 1e-6);
          if (accNear(side < 0 ? Math.max(lo, j - JOINT_NEAR) : j, side < 0 ? j : Math.min(hi, j + JOINT_NEAR)) <= BANK_BAR) continue;
          let W = 2 * H0, w, ok = null;
          for (;;) { const a = side < 0 ? Math.max(lo, j - W) : j, b = side < 0 ? j : Math.min(hi, j + W); w = build(a, b); if (w.held) break; if (!w.wild) ok = w; if (w.peak <= BANK_BAR || W >= 2 * CORNER_MAX || (side < 0 ? a <= lo : b >= hi)) break; W = Math.min(2 * CORNER_MAX, W * 1.15); }
          if (ok) windows.push(ok);   // the widest that is neither wild nor held
        }
      }
      if (js.length) continue;
      // inside a piece: centred where the two straight runs would meet (the middle of the zone when they are parallel)
      const [lo, hi] = spanOf((S[k0] + S[k1]) / 2);
      let mid = (S[k0] + S[k1]) / 2;
      if (Math.abs(r2 - r1) > 1e-9) { const x = (p2 - p1 - r2 * S[kb] + r1 * S[ka]) / (r1 - r2); if (x > S[ka] - 50 && x < S[kb] + 50) mid = x; }
      // at least the whole zone (a steep roll easing into a gentle one meets the runs either side of the zone outside it, and a window there missed the corner)
      let H = Math.max(H0, mid - S[k0] + BANK_DS, S[k1] - mid + BANK_DS), w, ok = null;
      for (;;) { const a = Math.max(lo, mid - H), b = Math.min(hi, mid + H); w = build(a, b); if (w.held) break; if (!w.wild) ok = w; if (w.peak <= BANK_BAR || H >= CORNER_MAX || (a <= lo && b >= hi)) break; H = Math.min(CORNER_MAX, H * 1.15); }
      if (ok) windows.push(ok);
    }
    // windows that overlap inside one piece become one; never across a joint (each window lies in one piece's span)
    windows.sort((p, q) => p.a - q.a);
    for (let k = 1; k < windows.length; k++) {
      const p = windows[k - 1], q = windows[k], [lo, hi] = spanOf((q.a + q.b) / 2);
      if (q.a < p.b - 1e-9 && p.a >= lo - 1e-9 && p.b <= hi + 1e-9) {
        let a = Math.min(p.a, q.a), b = Math.max(p.b, q.b), m = build(a, b);
        for (let g = 0; !m.held && m.peak > BANK_BAR && g < 12 && (a > lo || b < hi); g++) { const a2 = Math.max(lo, a - 0.1 * (b - a)), b2 = Math.min(hi, b + 0.1 * (b - a)), m2 = build(a2, b2); if (m2.held) break; a = a2; b = b2; m = m2; }
        if (m.wild || m.held) windows.splice(k - 1, 2); else windows.splice(k - 1, 2, m);   // two that cannot be one without overshooting, or without re-laying a curve, are neither
        k = Math.max(0, k - 2);
      }
    }
    // the pieces' built bank: the window's quintic where a window covers s, else the carried bank
    let pos = 0;
    for (const i of run) {
      const P = doc.pieces[i], p0 = pos, mine = windows.filter((w) => w.b > p0 && w.a < p0 + P.length); pos += P.length;
      if (!mine.length) continue;
      const g = f1[run.indexOf(i)];
      out[i] = { fn: (s) => { const x = p0 + s; for (const w of mine) if (x >= w.a && x <= w.b) return quinticAt(w.c, (x - w.a) / (w.b - w.a)); return g(s); },
        key: `${out[i].key}#${mine.map((w) => [w.a, w.b, ...w.c].join(',')).join(';')}` };
    }
  }
  return out;
}
function quinticD2(c, u) {
  const u2 = u * u, u3 = u2 * u, [y0, d0, c0, c1, d1, y1] = c;
  return y0 * (-60 * u + 180 * u2 - 120 * u3) + d0 * (-36 * u + 96 * u2 - 60 * u3) + c0 * (1 - 9 * u + 18 * u2 - 10 * u3)
    + c1 * (3 * u - 12 * u2 + 10 * u3) + d1 * (-24 * u + 84 * u2 - 60 * u3) + y1 * (60 * u - 180 * u2 + 120 * u3);
}
function toSegments(doc, { segM = 2, segMFor = null, designKmh = MACH6.designSpeedKmh, cupRuns = true, cache = null } = {}) {
  D.checkDoc(doc);
  if (!doc.pieces.length) throw new D.CoreError('EMPTY', 'an empty track has no path');
  if (!(segM > 0)) throw new D.CoreError('BAD_STEP', `segM must be positive, got ${segM}`);
  const segs = []; let pitch = doc.start.pitch, roll = 0, lastProfile = null, lastLegacy = false, lastKind = null, lastPlain = null;   // lastPlain: the last row without an edge (what a cup entering from a legacy piece fades from)
  // A CLOSED lap whose two ends are not the same kind: the cup end fades into the legacy end's rendered profile (tailZone; or, when the
  // cup is the START, the first metres fade out of the legacy END's last profile: morphZone), so the zip at s = 0 has no step
  const roadIdx = doc.pieces.map((P, i) => (P.type === 'road' ? i : -1)).filter((i) => i >= 0), firstRoad = roadIdx[0], lastRoad = roadIdx[roadIdx.length - 1];
  const seam = doc.closed && roadIdx.length > 1 && !!doc.pieces[firstRoad].cup !== !!doc.pieces[lastRoad].cup && cupRuns;
  const chan = (P, s) => D.valuesAt(P, s);
  const plan = bankPlan(doc);   // the built bank: the roll carried through a joint, and its corners rounded (bankPlan above)
  // `segMFor(P, i)` may give one piece its own chord length (the preview's ghost while a handle is dragged: a piece of 1,000 m is 500 chords of 2 m, and every
  // move of the pointer rebuilds all of them). Absent, or answering undefined, a piece is cut by segM, exactly as before: nothing that is placed or exported passes it.
  const at0 = segMFor ? new Map(doc.pieces.map((P, i) => [P, i])) : null;
  const mOf = (P) => { const m = segMFor ? segMFor(P, at0.get(P)) : undefined; return m === undefined ? segM : m; };
  const nOf = (P) => Math.max(1, Math.ceil(P.length / mOf(P) - 1e-9));
  const legacyAt = (P, j) => { const n = nOf(P), s0 = (P.length * j) / n, s1 = (P.length * (j + 1)) / n; return legacySeg(P.family, chan(P, s0), chan(P, s1), chan(P, (s0 + s1) / 2), s1 - s0); };
  const legacyFirst = (P) => legacyAt(P, 0).start;   // the first row of the piece's first segment
  const legacyLast = (P) => legacyAt(P, nOf(P) - 1).end;   // and the last row of its last
  const piece = (P, pi) => {
    if (P.type === 'flight') {
      // the take-off is the lip AS BUILT (lipOf): with an offset there, the flight starts at the lifted lip along the lifted road's tangent, and the landing is
      // that pose plus the flight's own (forward and left turned with it, up along world up, its heading added). A lip with no offset is the segment as it always was
      const lip = lipOf(doc.pieces[pi - 1], pitch), c = lip ? Math.cos(lip.theta) : 1, s = lip ? Math.sin(lip.theta) : 0;
      const to = lip ? { x: [lip.x[0] + P.left * c + P.forward * s, lip.x[1] + P.up, lip.x[2] - P.left * s + P.forward * c], theta: lip.theta + P.heading, p: P.pitch, from: lip }
        : { x: [P.left, P.up, P.forward], theta: P.heading, p: P.pitch };
      segs.push({ id: P.id, word: 'core', part: 'gap', kind: 'gap', length: flightLength(pitch, to), k0: 0, k1: 0, kp0: 0, kp1: 0, roll0: roll, roll1: P.bank, heartline: 0, profile: null, blend: null, speed: null, to });
      pitch = P.pitch; roll = P.bank;
      lastProfile = null; lastLegacy = false; lastKind = null; lastPlain = null;   // the landing's cross-section starts afresh: nothing morphs across the air
      return;
    }
    const carried = plan[pi].fn;   // the built bank where it is not the document's (bankPlan above)
    const n = nOf(P), at = !carried ? (s) => D.valuesAt(P, s) : (s) => ({ ...D.valuesAt(P, s), phi: carried(s) });
    // the built bank's RATE at a segment's ends, so the geometry rolls through each 2 m segment by the cubic Hermite (src/geom/path.js) instead of its smoothstep,
    // which brought the roll rate to rest at both ends of every segment: a small joint bump every 2 m wherever the bank changes (the user, 2026-11-03, "I notice
    // it with my perception"). Where the plan re-laid the bank, the rate is read from it over 5 cm, one-sided at the piece's ends
    const rateAt = !carried ? (s) => D.channelAt(P, 'phi', s).d1 : (s) => { const h = 0.05, lo = Math.max(0, s - h), hi = Math.min(P.length, s + h); return (carried(hi) - carried(lo)) / (hi - lo); };
    // the roll's rate at a segment's ends, carried so path.js rolls through it (a cubic Hermite) and not to rest at every end (a smoothstep). Written only where
    // the roll is moving: with both rates 0 the Hermite IS the smoothstep, so a segment that does not roll is built and serialised exactly as before
    // (a piece whose bank is one value and is neither carried nor re-laid by the plan never rolls: no rate is read for it, which on a 20 km piece was 90 ms a build)
    const rolls = !!carried || !constantPhi(P);
    const rollRates = (s0, s1) => { if (!rolls) return {}; const r0 = rateAt(s0), r1 = rateAt(s1); return Math.abs(r0) > 1e-12 || Math.abs(r1) > 1e-12 ? { rollRate0: r0, rollRate1: r1 } : {}; };
    let a = at(0);
    if (pi === 0 || doc.pieces[pi - 1].type === 'flight') roll = a.phi;
    const kind = D.kindOf(P), xs = kind === 'tube' || !!P.edge || (kind === 'cup' && lastKind === 'tube');   // a tube, an edge, or a cup entering from a tube is built by xsecSegments
    let join = P.cup && !xs && lastLegacy && lastProfile ? { profile: lastPlain || lastProfile } : null;   // a cup handed over from a legacy cross-section
    if (seam && pi === firstRoad && P.cup) join = { profile: legacyLast(doc.pieces[lastRoad]) };   // the lap's start is a cup that follows the legacy END round the seam
    // a cup piece followed by a LEGACY road piece (a file can hold one; Extend never makes one) fades into that piece's first profile, and so does the
    // lap's last cup piece into the legacy START: the last metres of the cup are the reverse morph (tailZone)
    // (The user: projecting a tube off a cup road "bugs the track, then eventually turns into a tube"): ONLY a next piece the LEGACY path builds. A tube,
    // or a piece with an edge, is built by xsecSegments, which morphs out of the previous piece's own last profile itself (MORPH_M); the fade here rendered such a
    // piece as a legacy bowl (legacyFirst) and bent the PLACED cup's last 10 m into it (17.9° of surface angle on FIRST TRACK) before the tube morphed out of that
    const nextP = doc.pieces[pi + 1];
    const nextLegacy = nextP && nextP.type === 'road' && !nextP.cup && !nextP.tube && !nextP.edge;
    const tail = !P.cup || !cupRuns ? null : nextLegacy ? legacyFirst(nextP) : seam && pi === lastRoad ? legacyFirst(doc.pieces[firstRoad]) : null;
    const cup = xs ? xsecSegments(P, n, at, lastKind && lastKind !== kind && lastProfile ? { profile: lastProfile } : null) : P.cup ? (cupRuns ? cupSegmentsRuns(P, n, at, join, tail) : cupSegmentsLocal(P, n, at)) : null;
    lastLegacy = kind === 'legacy'; lastKind = kind;
    for (let j = 0; j < n; j++) {
      const s0 = (P.length * j) / n, s1 = (P.length * (j + 1)) / n, b = at(s1), mid = at((s0 + s1) / 2);
      const L = cup ? null : legacySeg(P.family, a, b, mid, s1 - s0), profile = cup ? cup[j].profile : L.profile;   // a legacy piece: today's profileAt, or a chord where the width or r changes
      segs.push({ id: P.id, word: 'core', part: 'body', kind: 'road', ...(D.gripOf(P) !== D.GRIP_DEFAULT ? { grip: D.gripOf(P) } : {}), length: s1 - s0, k0: a.kh, k1: b.kh, kp0: a.kv, kp1: b.kv, roll0: a.phi, roll1: b.phi, ...rollRates(s0, s1), heartline: 0, profile, blend: cup ? cup[j].blend : L.blend, speed: null, ...(cup ? (xs ? { chord: true, fractions: cup[j].fractions, ...(cup[j].heartline1 !== undefined ? { heartline: cup[j].heartline, heartline1: cup[j].heartline1, rollRate0: cup[j].rollRate0, rollRate1: cup[j].rollRate1 } : {}) } : { cup: true }) : L.chord ? { chord: true } : {}) });
      pitch += ((a.kv + b.kv) / 2) * (s1 - s0);   // the geometry's pitch: kp linear over the segment (src/geom/path.js)
      a = b; lastProfile = cup ? cup[j].end : L.end;
    }
    lastPlain = xs ? baseProfileOf(P, a) : lastProfile;   // the piece's own last row without its edge
    roll = a.phi;
  };
  // Everything a piece's segments are built from, beside the piece itself: its neighbours (the roll restart after a flight, a cup's tail
  // fade into the next piece), its role at the lap seam and the seam's two ends, the state carried in from the piece before, and the options.
  // Each entry is only as wide as `piece` reads it, so placing a piece after this one does not rebuild it: the next piece matters only as a cup's
  // tail target (a legacy road after a cup, `nextLegacy` below), and the first/last road roles only at a mixed lap seam (`seam`).
  const inputsOf = (pi) => {
    const P = doc.pieces[pi], nextP = doc.pieces[pi + 1];
    const tailTo = P.type === 'road' && P.cup && cupRuns && nextP && nextP.type === 'road' && !nextP.cup && !nextP.tube && !nextP.edge ? nextP : null;
    // the first entry also carries the piece's built bank (bankPlan: its carry and its rounded corners), which depends on its neighbours: one entry, so every index after keeps its place
    return [`${pi === 0}|${plan[pi].key}`, pi ? doc.pieces[pi - 1].type : null, tailTo, seam, seam && pi === firstRoad, seam && pi === lastRoad,
      seam ? doc.pieces[firstRoad] : null, seam ? doc.pieces[lastRoad] : null, pitch, roll, lastProfile, lastLegacy, lastKind, lastPlain, mOf(P), tailTo ? mOf(tailTo) : null, seam ? mOf(doc.pieces[firstRoad]) : null, seam ? mOf(doc.pieces[lastRoad]) : null, designKmh, cupRuns,   // the chord length of every piece this one's segments read (a tail fade, the lap seam) is an input too
      P.type === 'flight' ? lipKey(doc.pieces[pi - 1]) : null];   // a flight takes off from the lip as built: the piece before it's offsets at its end
  };
  doc.pieces.forEach((P, pi) => {
    if (!cache) { piece(P, pi); return; }
    const k = inputsOf(pi), same = (h) => h && h.k.length === k.length && h.k.every((x, i) => Object.is(x, k[i]) || (BY_VALUE.has(i) && sameValue(x, k[i])));
    let byId = LAST_BY_ID.get(cache); if (!byId) LAST_BY_ID.set(cache, (byId = new Map()));
    let hit = cache.get(P);
    if (!same(hit)) { const last = byId.get(P.id), h = last && last !== P && cache.get(last); hit = same(h) && sameButLift(last, P) ? h : null; if (hit) cache.set(P, hit); }
    if (hit) {
      byId.set(P.id, P);
      for (const g of hit.out) segs.push(g);
      ({ pitch, roll, lastProfile, lastLegacy, lastKind, lastPlain } = hit.st);
      return;
    }
    const from = segs.length;
    piece(P, pi);
    const out = segs.slice(from);
    out.forEach(deepFreeze);   // shared by every later document that reuses them: a reader that writes to one throws instead of changing another's
    cache.set(P, { k, out, st: { pitch, roll, lastProfile, lastLegacy, lastKind, lastPlain } }); byId.set(P.id, P);
  });
  return segs;
}

function toPath(doc, { step = 0.5, segM = 2, designKmh, cupRuns, cache = null } = {}) {
  const segments = toSegments(doc, { segM, designKmh, cupRuns, cache });   // cache: toSegments' per-piece cache (2026-10-14: src/core/close.js keeps one for a whole close)
  const path = buildPath(segments, { step, closed: doc.closed, start: { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch } });
  return { segments, path: heartlineLift(segments, offsetPath(doc, segments, path)) };
}

/**
 * THE ROAD CENTRE'S CURVATURE where the roll axis is off the road. The path integrates the heartline curve, and its samples' kvec is that curve's curvature; the road
 * centre of a closed tube is a HELIX round it, which the heartline curve (a straight line) does not show, so the validator would read the spiral's floor at 1 g (seal: 0 against the
 * helix's 0.0012/m). Every sample of a segment that carries a heartline gets the curvature vector of the road-centre polyline instead (three-point, uneven spacing, exact for a
 * quadratic): κ = (r″ − (r″·t)t)/|r′|². A path with no such segment is returned as it is.
 */
function heartlineLift(segments, path) {
  if (!segments.some((g) => g.heartline || g.heartline1)) return path;
  const S = path.samples, n = S.length;
  const samples = S.map((x, i) => {
    const g = segments[x.seg];
    if (!(g.heartline || g.heartline1) || i === 0 || i === n - 1) return x;
    const a = S[i - 1].pos, b = x.pos, c = S[i + 1].pos, h1 = x.s - S[i - 1].s, h2 = S[i + 1].s - x.s;
    if (!(h1 > 1e-9 && h2 > 1e-9)) return x;
    const d1 = [0, 1, 2].map((k) => ((c[k] - b[k]) * h1 / h2 + (b[k] - a[k]) * h2 / h1) / (h1 + h2)), d2 = [0, 1, 2].map((k) => (2 * ((c[k] - b[k]) / h2 - (b[k] - a[k]) / h1)) / (h1 + h2));
    const sp2 = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2], along = (d2[0] * d1[0] + d2[1] * d1[1] + d2[2] * d1[2]) / sp2;
    // a sample is a VIEW (src/geom/path.js SampleView: its fields are getters), so it is copied field by field, never spread
    return { s: x.s, seg: x.seg, pos: x.pos, T: x.T, L: x.L, U: x.U, kvec: [0, 1, 2].map((k) => (d2[k] - along * d1[k]) / sp2), roll: x.roll, bankG: x.bankG, grade: x.grade, _R: x._R, _x: x._x };
  });
  return { ...path, samples };
}

// ── the offset channels h and l (a hill, a swerve), applied AFTER the base geometry (ref 09 §7) ────────────────────────
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The path with every sample inside an offset LIFTED: its position moved by h along world up and l along the gravity frame's
 * horizontal left, and its tangent, frame, curvature vector, bankG and grade RECOMPUTED from the lifted curve, exactly
 * (ref 09 §7), so validation, the loads and the water read the road as brushed. A sample where both offsets and their first
 * two derivatives are zero is the SAME object, so outside a hill the path is bit for bit. The path's s and length stay the
 * base's (s is the parameter; the road over a hill is a little longer). Returns the same path object when no offset is set.
 * The mesh's per-segment end samples (path.segEnd) and the build head are lifted the same way. A path lifted here is for READING
 * (preview, mesh, validation, water, export): src/geom's incremental extendPath and rebuildPathFrom grow the BASE path, so
 * after one of those, call offsetPath again on the result.
 */
function offsetPath(doc, segments, path) {
  const pieces = new Map(doc.pieces.map((P) => [P.id, P]));
  // (Profiled: this lift was 383 ms of a 3 s height drag.) a road piece whose h and l control points are ALL zero has value and both
  // derivatives zero at every s, so every sample on it came back as the very same object, after two channel evaluations each. Such a piece is now skipped without them: the same
  // answer, bit for bit (test/core_offset_lift.test.js compares with the old lift), and the cost falls to the samples of the pieces that carry an offset.
  const offsetOn = new Set(doc.pieces.filter((P) => P.type === 'road' && D.OFFSETS.some((ch) => P.channels[ch].some((v) => v !== 0))).map((P) => P.id));
  const any = offsetOn.size > 0;
  if (!any) return path;
  const segStart = [], pieceStart = new Map(); let acc = 0;
  segments.forEach((g, i) => { segStart.push(acc); if (!pieceStart.has(g.id)) pieceStart.set(g.id, acc); acc += g.length; });
  const UP = [0, 1, 0];
  const lift = (x) => {
    const g = segments[x.seg], P = pieces.get(g.id);
    if (!P || P.type !== 'road' || g.kind !== 'road' || !offsetOn.has(P.id)) return x;
    const s = Math.min(Math.max(x.s - pieceStart.get(g.id), 0), P.length), h = D.channelAt(P, 'h', s), l = D.channelAt(P, 'l', s);
    if (!(h.v || h.d1 || h.d2 || l.v || l.d1 || l.d2)) return x;
    const T = x.T, K = x.kvec, th = Math.atan2(T[0], T[2]), u = x.s - segStart[x.seg];
    const k0 = g.k0 || 0, k1 = g.k1 || 0, dth = k0 + ((k1 - k0) * u) / g.length, ddth = (k1 - k0) / g.length;   // θ′, θ″ (ref 02 §2)
    const R = [Math.cos(th), 0, -Math.sin(th)], Rth = [-Math.sin(th), 0, -Math.cos(th)];
    const dR = vmul(Rth, dth), ddR = vadd(vmul(Rth, ddth), vmul(R, -dth * dth));
    const pos = vadd(vadd(x.pos, vmul(UP, h.v)), vmul(R, l.v));
    const d1 = vadd(vadd(vadd(T, vmul(UP, h.d1)), vmul(R, l.d1)), vmul(dR, l.v));
    const d2 = vadd(vadd(vadd(vadd(K, vmul(UP, h.d2)), vmul(R, l.d2)), vmul(dR, 2 * l.d1)), vmul(ddR, l.v));
    const sp = Math.hypot(d1[0], d1[1], d1[2]), Tn = vmul(d1, 1 / sp), kvec = vmul(vadd(d2, vmul(Tn, -vdot(d2, Tn))), 1 / (sp * sp));
    const thn = Math.atan2(Tn[0], Tn[2]), Rn = [Math.cos(thn), 0, -Math.sin(thn)], U0 = vcross(Tn, Rn), phi = x.roll;
    const L = vadd(vmul(Rn, Math.cos(phi)), vmul(U0, Math.sin(phi))), U = vcross(Tn, L), run = Math.hypot(Tn[0], Tn[2]);
    return { s: x.s, seg: x.seg, pos, T: Tn, L, U, kvec, roll: phi, bankG: Math.asin(Math.max(-1, Math.min(1, L[1]))),
      grade: run > 1e-12 ? Tn[1] / run : (Tn[1] > 0 ? Infinity : -Infinity), _R: Rn, _x: pos };
  };
  // the samples, each segment's END sample (the mesh closes every segment on it) and the build head (from the last sample)
  const samples = path.samples.map(lift), segEnd = path.segEnd.map(lift), e = samples[samples.length - 1];
  const head = { s: e.s, seg: e.seg, pos: e.pos.slice(), T: e.T.slice(), L: e.L.slice(), U: e.U.slice() };
  return { ...path, samples, segEnd, head };
}

module.exports = { toSegments, toPath, carryOf, bankPlan, lipOf, profileAt, cupProfile, tubeProfile, edgeProfile, legacyEdgeDeg: D.legacyEdgeDeg, offsetPath, heartlineLift, heartlineOf, EDGE_MIN_N, TUBE_N, HEARTLINE_FROM };
