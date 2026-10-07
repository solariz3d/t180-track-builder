// adapter.js: the core's document → the SAME path samples src/geom builds (the spec's GO §6), so the preview, cameras,
// mesh, validation and export are reused unchanged.
//
//   toSegments(doc, { segM = 2, designKmh, cupRuns = true }) -> src/geom segments (each carries its profile; a cup's, and a legacy segment whose
//                                               width or r changes (D196, a CHORD, `chord: true`), also a blend: see legacySeg)
//   toPath(doc, { step = 0.5, segM = 2, designKmh }) -> { segments, path }; path = buildPath(segments, { step, closed, start }),
//                                               samples { s, seg, pos, T, L, U, kvec, roll, bankG, grade }
//   profileAt(family, w, r)                    the LEGACY cross-section at a station (ref 09 §3), unchanged since D186
//   cupProfile(family, w, c)                   the CUP cross-section (D190, ref 09 §9): the edge angle is c degrees on both sides
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
// A FLIGHT piece (D258, the free flight) becomes ONE gap segment that ends at the landing's pose (src/geom/path.js `to`: the take-off's heading frame,
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

/** The CUP cross-section at width w (m) and edge angle c (degrees), ref 09 §9: ψ at the four quarters of each half-width is c·Fᵢ/F_edge, both sides. */
function cupProfile(family, w, c) {
  if (!Object.prototype.hasOwnProperty.call(FLOORS, family)) throw new D.CoreError('BAD_FAMILY', 'family "' + family + '"');
  if (!(w > 0)) throw new D.CoreError('BAD_WIDTH', 'the road\'s width must be positive, got ' + w + ' m');
  if (!Number.isFinite(c) || c < 0) throw new D.CoreError('BAD_CUP', 'the cup must be a number of degrees from 0, got ' + c);
  const F = FLOORS[family], side = AT.map((f, i) => [(f * w) / 2, ((c * F[i]) / F[F.length - 1]) * DEG]);
  return {
    font: family,
    u: [...side.slice().reverse().map(([x]) => -x), 0, ...side.map(([x]) => x)],
    psi: [...side.slice().reverse().map(([, p]) => p), 0, ...side.map(([, p]) => p)],
    material: 'ROAD',
  };
}

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));   // the mesh's weight (src/geom/profile.js smoothstep); also G, the edge curve's shape (ref 09 §10)

// ── D225, THE CROSS-SECTION LAP: the tube, the edge curve, and the pieces that carry them (ref 09 §10) ──────────────────────────────
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
function edgeProfile(base, e, s, nE) {
  const P = normalize(base), hr = -P.u[0], hl = P.u[P.u.length - 1], us = [...P.u];
  for (let k = 0; k <= nE; k++) { const f = s + ((1 - s) * k) / nE; us.push(hl * f, -hr * f); }
  us.sort((a, b) => a - b);
  const u = us.filter((x, i) => i === 0 || x - us[i - 1] > 1e-12);
  const psi = u.map((x) => { const h = x < 0 ? hr : hl, r = h > 0 ? Math.abs(x) / h : 0; return psiAt(P, x) + (r > s ? e * DEG * smooth((r - s) / (1 - s)) : 0); });
  return { font: P.font === 'tube' ? 'tube-edge' : 'edge', u, psi, material: P.material };   // the font says which cap applies (validate: edge-past-cap)
}
/** The middle cross-section of piece P at the channel values x: the legacy profileAt, the cup, or the tube. */
function baseProfileOf(P, x) { return P.tube ? tubeProfile(x.w, x.t) : P.cup ? cupProfile(P.family, x.w, x.c) : profileAt(P.family, x.w, x.r); }
/** The heartline (m) a tube's roll turns about at channel values x: R = w/2π once the tube is closed, 0 while it is open, a smoothstep between (ref 09 §10). */
const heartlineOf = (P, x) => (P.tube ? (x.w / (2 * Math.PI)) * smooth((x.t - HEARTLINE_FROM) / (D.TUBE_MAX - HEARTLINE_FROM)) : 0);

/**
 * The segments of a TUBE or EDGE piece, or of a piece entering from a different kind of cross-section (D225). Every segment is a CHORD: its profile is the one at its END, blended
 * from the one at its START, so the rows at its two ends are the ends' own cross-sections (a moving edge slice is not linear in s, ref 09 §10, so no blend pair can be shared
 * along a run as the cup's is). ONE fraction array serves the whole piece (profile.js commonFractions, mesh.js seg.fractions), so the row a segment ends on and the next one
 * starts on are the same vertices: no seam zip inside the piece. Entering from another kind (legacy, cup or tube), the first MORPH_M metres blend from the previous piece's
 * last profile into the piece's own (smoothstep in s), so the first row IS the previous last row and the joint steps nothing. A piece with a closed tube also carries the
 * heartline fields (linear over the segment) and the roll rates (so the roll is C1 across segments): the spiral's floor is smooth.
 */
function xsecSegments(P, n, at, join) {
  const s = (j) => (P.length * j) / n, E = Array.from({ length: n + 1 }, (_, j) => at(s(j))), edge = !!P.edge;
  const nE = edge ? Math.max(EDGE_MIN_N, Math.ceil(1.5 * Math.max(...E.map((x) => x.e)))) : 0;
  const own = (x) => { const b = baseProfileOf(P, x); return edge ? edgeProfile(b, x.e, x.s, nE) : b; };
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
 * The profile and blend of each of a cup piece's n segments (D190 row 1b). at(s) gives the channels; segment j spans s_j to s_{j+1}.
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
 * THE MORPH OUT OF A LEGACY CROSS-SECTION (D190 R2). Where the r cap binds, the legacy piece's last profile is the CAPPED shape and the cup's
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
 * THE MORPH INTO A LEGACY CROSS-SECTION (D190 round 3, R3): the mirror of morphZone, for a cup that CLOSES a lap onto a legacy start (the zip at
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
 * A LEGACY segment (D196). Where the width or the rise rate changes inside the segment so that its cross-section does, it is drawn as a CHORD, like the cup's
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

function toSegments(doc, { segM = 2, designKmh = MACH6.designSpeedKmh, cupRuns = true } = {}) {
  D.checkDoc(doc);
  if (!doc.pieces.length) throw new D.CoreError('EMPTY', 'an empty track has no path');
  if (!(segM > 0)) throw new D.CoreError('BAD_STEP', `segM must be positive, got ${segM}`);
  const segs = []; let pitch = doc.start.pitch, roll = 0, lastProfile = null, lastLegacy = false, lastKind = null, lastPlain = null;   // lastPlain: the last row without an edge (what a cup entering from a legacy piece fades from)
  // A CLOSED lap whose two ends are not the same kind (D190 R3): the cup end fades into the legacy end's rendered profile (tailZone; or, when the
  // cup is the START, the first metres fade out of the legacy END's last profile: morphZone), so the zip at s = 0 has no step
  const roadIdx = doc.pieces.map((P, i) => (P.type === 'road' ? i : -1)).filter((i) => i >= 0), firstRoad = roadIdx[0], lastRoad = roadIdx[roadIdx.length - 1];
  const seam = doc.closed && roadIdx.length > 1 && !!doc.pieces[firstRoad].cup !== !!doc.pieces[lastRoad].cup && cupRuns;
  const chan = (P, s) => D.valuesAt(P, s);
  const nOf = (P) => Math.max(1, Math.ceil(P.length / segM - 1e-9));
  const legacyAt = (P, j) => { const n = nOf(P), s0 = (P.length * j) / n, s1 = (P.length * (j + 1)) / n; return legacySeg(P.family, chan(P, s0), chan(P, s1), chan(P, (s0 + s1) / 2), s1 - s0); };
  const legacyFirst = (P) => legacyAt(P, 0).start;   // the first row of the piece's first segment
  const legacyLast = (P) => legacyAt(P, nOf(P) - 1).end;   // and the last row of its last
  doc.pieces.forEach((P, pi) => {
    if (P.type === 'flight') {
      const to = { x: [P.left, P.up, P.forward], theta: P.heading, p: P.pitch };
      segs.push({ id: P.id, word: 'core', part: 'gap', kind: 'gap', length: flightLength(pitch, to), k0: 0, k1: 0, kp0: 0, kp1: 0, roll0: roll, roll1: P.bank, heartline: 0, profile: null, blend: null, speed: null, to });
      pitch = P.pitch; roll = P.bank;
      lastProfile = null; lastLegacy = false; lastKind = null; lastPlain = null;   // the landing's cross-section starts afresh: nothing morphs across the air
      return;
    }
    const n = Math.max(1, Math.ceil(P.length / segM - 1e-9)), at = (s) => D.valuesAt(P, s);
    let a = at(0);
    if (pi === 0 || doc.pieces[pi - 1].type === 'flight') roll = a.phi;
    const kind = D.kindOf(P), xs = kind === 'tube' || !!P.edge || (kind === 'cup' && lastKind === 'tube');   // D225: a tube, an edge, or a cup entering from a tube is built by xsecSegments
    let join = P.cup && !xs && lastLegacy && lastProfile ? { profile: lastPlain || lastProfile } : null;   // a cup handed over from a legacy cross-section
    if (seam && pi === firstRoad && P.cup) join = { profile: legacyLast(doc.pieces[lastRoad]) };   // the lap's start is a cup that follows the legacy END round the seam
    // a cup piece followed by a LEGACY road piece (a file can hold one; Extend never makes one) fades into that piece's first profile, and so does the
    // lap's last cup piece into the legacy START: the last metres of the cup are the reverse morph (tailZone)
    const nextP = doc.pieces[pi + 1];
    const tail = !P.cup || !cupRuns ? null : nextP && nextP.type === 'road' && !nextP.cup ? legacyFirst(nextP) : seam && pi === lastRoad ? legacyFirst(doc.pieces[firstRoad]) : null;
    const cup = xs ? xsecSegments(P, n, at, lastKind && lastKind !== kind && lastProfile ? { profile: lastProfile } : null) : P.cup ? (cupRuns ? cupSegmentsRuns(P, n, at, join, tail) : cupSegmentsLocal(P, n, at)) : null;
    lastLegacy = kind === 'legacy'; lastKind = kind;
    for (let j = 0; j < n; j++) {
      const s0 = (P.length * j) / n, s1 = (P.length * (j + 1)) / n, b = at(s1), mid = at((s0 + s1) / 2);
      const L = cup ? null : legacySeg(P.family, a, b, mid, s1 - s0), profile = cup ? cup[j].profile : L.profile;   // a legacy piece: today's profileAt, or a chord where the width or r changes
      segs.push({ id: P.id, word: 'core', part: 'body', kind: 'road', ...(D.gripOf(P) !== D.GRIP_DEFAULT ? { grip: D.gripOf(P) } : {}), length: s1 - s0, k0: a.kh, k1: b.kh, kp0: a.kv, kp1: b.kv, roll0: a.phi, roll1: b.phi, heartline: 0, profile, blend: cup ? cup[j].blend : L.blend, speed: null, ...(cup ? (xs ? { chord: true, fractions: cup[j].fractions, ...(cup[j].heartline1 !== undefined ? { heartline: cup[j].heartline, heartline1: cup[j].heartline1, rollRate0: cup[j].rollRate0, rollRate1: cup[j].rollRate1 } : {}) } : { cup: true }) : L.chord ? { chord: true } : {}) });
      pitch += ((a.kv + b.kv) / 2) * (s1 - s0);   // the geometry's pitch: kp linear over the segment (src/geom/path.js)
      a = b; lastProfile = cup ? cup[j].end : L.end;
    }
    lastPlain = xs ? baseProfileOf(P, a) : lastProfile;   // the piece's own last row without its edge
    roll = a.phi;
  });
  return segs;
}

function toPath(doc, { step = 0.5, segM = 2, designKmh, cupRuns } = {}) {
  const segments = toSegments(doc, { segM, designKmh, cupRuns });
  const path = buildPath(segments, { step, closed: doc.closed, start: { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch } });
  return { segments, path: heartlineLift(segments, offsetPath(doc, segments, path)) };
}

/**
 * THE ROAD CENTRE'S CURVATURE where the roll axis is off the road (D225, seal S4). The path integrates the heartline curve, and its samples' kvec is that curve's curvature; the road
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
  const any = doc.pieces.some((P) => P.type === 'road' && D.OFFSETS.some((ch) => P.channels[ch].some((v) => v !== 0)));
  if (!any) return path;
  const segStart = [], pieceStart = new Map(); let acc = 0;
  segments.forEach((g, i) => { segStart.push(acc); if (!pieceStart.has(g.id)) pieceStart.set(g.id, acc); acc += g.length; });
  const UP = [0, 1, 0];
  const lift = (x) => {
    const g = segments[x.seg], P = pieces.get(g.id);
    if (!P || P.type !== 'road' || g.kind !== 'road') return x;
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

module.exports = { toSegments, toPath, profileAt, cupProfile, tubeProfile, edgeProfile, legacyEdgeDeg: D.legacyEdgeDeg, offsetPath, heartlineLift, heartlineOf, EDGE_MIN_N, TUBE_N, HEARTLINE_FROM };
