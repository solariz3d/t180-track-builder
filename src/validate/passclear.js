// passclear.js: THE PASS CLEARANCE (the user, 2026-11-02: "all you had to do was forbid building the track a little bit closer because of the bulk of the
// underside"). A road may not pass over another road closer than its own underside's depth there, plus the edge apron's reach where its aprons are over the
// other road, plus the room a car needs. Red, reason 'pass-clearance': the builder refuses an edit that makes a new one, and a track that already has one
// opens with each place shown red.
//
//   passClearance(path, segments, opts) -> [{ s, u, otherS, otherU, gapM, needM, shortM, surfaceGapM, apron, onApron, hullM, clip, at }], one per station that has one, by s
//
// THE MODEL, read from the path alone (no mesh: the builder, the live checker and the export all have the path), per road station:
//   · its SOLID: each lateral point of its cross-section (src/geom/profile.js offsetAt, at most 1 m apart) from the road surface down to the hull's bottom, which
//     hangs along the section's up (src/export/underskin.js skinDir) by the hull's depth there: UNDERSKIN_OFFSET_M, deepened toward an edge that rises exactly as
//     the export deepens it (underskin.js rowDepths: hullDepth of the edge's rim, eased in over HULL_EDGE_SPAN_M by the square of the distance), never less
//     deep than the export hangs it (rowDepths may read a shallower edge from a re-leaned plank's tip, edgeDepth; this reads hullDepth, the deepest it may go);
//     and beyond each edge with an apron (not a closed ring, rim under apron.js WALL_DEG, the track's apron width over 0) the plank, the track's apron width
//     out at APRON_SLOPE_DEG down from the section's lateral, with the hull under it to the edge's own depth: a box from the plank down to the skin's edge
//     (the run under a plank is a curve from the tip to that edge, apron.js hullRun, so the box holds it);
//   · its CAR ROOM: the space a car on it can be in, CAR_MARGIN_M along the surface's normal over the road and over its aprons (a wheel that leaves the road
//     runs onto the apron, D616 §3).
// Two stations of different passes (at least opts.minSeparationM apart along the lap, measured round a closed lap: the same rule as the stack, validate
// stacked()) break the rule where the solid of one reaches into the car room of the other: a line from a lateral point's surface to its hull's bottom (or a
// plank's) has a point between 0 and CAR_MARGIN_M over the other's road or apron, measured along that surface's normal, within half a station step along it.
// So a road that passes OVER another must keep its hull's bottom CAR_MARGIN_M over the lower road; a road that passes over upside down (its road facing the
// lower) keeps its ROAD that far, its hull being on its far side; and two roads that touch or pass through each other are the case with no room at all (clip).
//
// CAR_MARGIN_M = 3.1 m. The Mach 6's collision box rode at most 2.42 m over its road on the user's ELYSIUM lap (D616 §9: 955 km/h at a crest; its median 1.33 m),
// and the camera behind the car has its eye 3 m up the road (the closed-tube rule in validate/index.js reads the same eye, with the same 0.1 m to spare: TUBE_MIN_W). So a
// pass over a road keeps its hull 0.1 m over the eye, which is 0.68 m over the highest box top measured. The lowest it can be is CAR_MARGIN_M plus the
// hull's depth: 4.6 m over a flat road (UNDERSKIN_OFFSET_M 1.5, and hullDepth(0) is 1.5 too), 5.43 m under an edge that rises 30° (hullDepth(30) = 2.33 m),
// the most 6.1 m under an edge that rises steeply (HULL_EDGE_MAX_M 3).
//
// Not modelled (said, not hidden): the pit lane (src/geom/pitlane.js is not on the path); the hull's ease where its apron stops (underskin.js hullEase) and
// in a twist (hullScaleAt), which make it SHALLOWER, so the rule is stricter there than the export; a cross-section blended along a piece (cup, chord) is read
// at its segment's profile, as the stack reads it.
'use strict';
const P = require('../geom/profile.js');
const { hullDepth, skinDir, UNDERSKIN_OFFSET_M, HULL_EDGE_SPAN_M } = require('../export/underskin.js');
const { APRON_WIDTH_M, APRON_SLOPE_DEG, WALL_DEG } = require('../export/apron.js');
const { closedRing } = require('../texture/flow.js');

const CAR_MARGIN_M = 3.1;
const SEPARATION_M = 25;   // validate stacked()'s default minSeparationM: closer along the lap is the same pass
const ACROSS_M = 1;        // the lateral spacing of the points read, as the stack reads them
const EPS = 1e-6;
const SEAM_DEG = 30;      // an open track's last piece on its first, running within this of the same way, is the seam a Close joins
const TOUCH_M = 1e-3;     // a solid within this of a surface touches it: two roads crossing level are the case with no room at all
const DEG = Math.PI / 180;

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * The hull's depth at lateral X of a cross-section whose edges stand at X0 (side 0) and X1 (side 1) with the given depths there: UNDERSKIN_OFFSET_M,
 * deepened by each edge's extra depth times x², x = 1 − (distance in from that edge) / HULL_EDGE_SPAN_M (underskin.js rowDepths).
 */
function depthAcross(X, X0, X1, d0, d1) {
  let d = UNDERSKIN_OFFSET_M;
  for (const [E, dE] of [[X0, d0], [X1, d1]]) { const t = Math.abs(X - E); if (dE > UNDERSKIN_OFFSET_M && t < HULL_EDGE_SPAN_M) { const x = 1 - t / HULL_EDGE_SPAN_M; d += (dE - UNDERSKIN_OFFSET_M) * x * x; } }
  return d;
}

/**
 * One cross-section, in its own frame (X along the section's lateral L, Y along its up U; the centre line at u = 0): the road's points and the apron's,
 * each { u, X, Y, nX, nY (the surface's unit normal, toward the car), dX, dY (the unit direction its hull hangs, away from the car), depth, apron }.
 * Read once per segment. `ring`: the section is a closed ring (texture/flow.js closedRing, as the export reads it: no apron, the plain depth).
 */
function sectionOf(prof, apronM, ring = false) {
  // evenly across, at most ACROSS_M apart, both edges and the centre line exactly: a profile's own knots can be 0.1 m apart in an edge zone (137 on his
  // ELYSIUM), and every point is read against every point of the other pass
  const u0 = prof.u[0], u1 = prof.u[prof.u.length - 1], us = [];
  for (const [a, b] of [[u0, Math.min(0, u1)], [Math.max(0, u0), u1]]) { if (!(b > a)) continue; const m = Math.ceil((b - a) / ACROSS_M); for (let j = 0; j <= m; j++) { const u = a + ((b - a) * j) / m; if (!us.length || u > us[us.length - 1] + 1e-12) us.push(u); } }
  if (!us.length) us.push(u0);
  const uA = us[0], uB = us[us.length - 1];
  const [XA] = P.offsetAt(prof, uA), [XB] = P.offsetAt(prof, uB);
  // an edge's rim: the surface's angle there above the section's lateral (psiAt, + rising), as apron.js sideRows and underskin.js rowEdges read it
  const rimOf = (u) => P.psiAt(prof, u) / DEG;
  const edges = [uA, uB].map((u) => { const rim = rimOf(u); return { u, rim, depth: ring ? UNDERSKIN_OFFSET_M : hullDepth(rim), apron: !ring && apronM > 0 && rim < WALL_DEG }; });
  const nc = P.normalAt(prof, 0), pts = [];
  for (const u of us) {
    const [X, Y] = P.offsetAt(prof, u), n = P.normalAt(prof, u);
    // the hull hangs along the section's up (the centre's normal), blending to the point's own normal on a wall (underskin.js skinDir): away from the car
    const h = skinDir([n[0], n[1], 0], [nc[0], nc[1], 0]);
    pts.push({ u, X, Y, nX: n[0], nY: n[1], dX: -h[0], dY: -h[1], depth: depthAcross(X, XA, XB, edges[0].depth, edges[1].depth), apron: false });
  }
  // each apron: points out to the plank's tip, at APRON_SLOPE_DEG down from the section's lateral, with the hull under them to the edge's own depth (a box)
  const sl = APRON_SLOPE_DEG * DEG;
  for (const [i, e] of edges.entries()) {
    if (!e.apron) continue;
    const [EX, EY] = P.offsetAt(prof, e.u), out = i === 0 ? Math.sign(XA - XB) || -1 : Math.sign(XB - XA) || 1;
    const bottomY = EY - e.depth * nc[1], m = Math.max(1, Math.ceil(apronM / ACROSS_M));
    for (let j = 1; j <= m; j++) {
      const w = (apronM * j) / m, X = EX + out * w * Math.cos(sl), Y = EY - w * Math.sin(sl);
      // the plank's normal: the section's up turned outward by the slope; its box reaches down to the skin's edge level (never above the plank itself)
      pts.push({ u: e.u, X, Y, nX: out * Math.sin(sl), nY: Math.cos(sl), dX: 0, dY: -1, depth: Math.max(0, Y - bottomY), apron: true, w });
    }
  }
  return { pts, r: Math.max(...pts.map((p) => Math.hypot(p.X, p.Y) + p.depth)), w: Math.max(...pts.map((p) => Math.abs(p.X))) };
}

/**
 * THE RULE, over a path (src/geom/path.js buildPath's samples: s, seg, pos, T, L, U) and its segments (kind, profile).
 * opts: apronM (the track's edge apron width, doc.edgeApronM; default apron.js APRON_WIDTH_M), marginM (CAR_MARGIN_M), minSeparationM (SEPARATION_M),
 * from (only stations from this index are QUERIED, each against every other: an edit's new road against the whole track; default 0).
 * Each finding is the station of the road whose car room is reached: s, u (where across it), otherS and otherU (the other pass's point that reaches it), gapM (how far
 * over this road's surface, along its normal, the other's solid comes: negative when it is through), needM (marginM), shortM (needM − gapM, > 0), surfaceGapM (the
 * other's own SURFACE there over this one: its road, or its plank when `apron`), apron (the other's point is on its apron), onApron (this road's point is on ITS apron: the car room a wheel off the road reaches), hullM (the other's hull depth there), clip
 * (that surface, a physics surface, touches or is through this road or apron: the drivable meshes themselves meet), at (the point, world space). The worst a station has (largest shortM; the smaller u, then the smaller otherS on a tie).
 */
function passClearance(path, segments, opts = {}) {
  const S = path.samples, n = S.length, apronM = opts.apronM === undefined ? APRON_WIDTH_M : opts.apronM, margin = opts.marginM === undefined ? CAR_MARGIN_M : opts.marginM;
  const sep = opts.minSeparationM === undefined ? SEPARATION_M : opts.minSeparationM, from = Math.max(0, opts.from || 0), L = path.lengthM || (n ? S[n - 1].s - S[0].s : 0);
  if (!(margin > 0)) throw new Error('passClearance: marginM must be above 0');
  if (!(apronM >= 0)) throw new Error('passClearance: apronM must be 0 or more');
  const isRoad = (i) => { const g = segments[S[i].seg]; return !!g && g.kind !== 'gap' && !!g.profile; };
  const secMemo = new Map(), secOf = (j) => { let e = secMemo.get(j); if (!e) { e = sectionOf(P.normalize(segments[j].profile), apronM, closedRing(segments[j])); secMemo.set(j, e); } return e; };
  // each station's points in world space, built when a pair needs them
  const world = new Map();
  const ptsOf = (i) => {
    let w = world.get(i); if (w) return w;
    const { pos, L: l, U: up, T } = S[i], sec = secOf(S[i].seg);
    const at = (X, Y) => add(add(pos, l, X), up, Y), dir = (x, y) => add([l[0] * x, l[1] * x, l[2] * x], up, y);
    const hs = 0.5 * Math.max(i + 1 < n ? S[i + 1].s - S[i].s : 0, i > 0 ? S[i].s - S[i - 1].s : 0) + EPS;
    w = { T, hs, pts: sec.pts.map((p) => { const q = at(p.X, p.Y), nn = dir(p.nX, p.nY), d = dir(p.dX, p.dY); return { q, n: nn, b: add(q, d, p.depth), u: p.u, apron: p.apron, depth: p.depth }; }) };
    world.set(i, w); return w;
  };
  // pairs: a spatial grid of stations, cell B, the farthest two stations' solids can reach each other's car room
  let rMax = 0; for (let i = 0; i < n; i++) if (isRoad(i)) rMax = Math.max(rMax, secOf(S[i].seg).r);
  const reach = 2 * rMax + margin, grid = new Map(), key = (p) => `${Math.floor(p[0] / reach)},${Math.floor(p[1] / reach)},${Math.floor(p[2] / reach)}`;
  for (let i = 0; i < n; i++) if (isRoad(i)) { const k = key(S[i].pos), l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); }
  const ptsHalf = (i) => 0.5 * Math.max(i + 1 < n ? S[i + 1].s - S[i].s : 0, i > 0 ? S[i].s - S[i - 1].s : 0) + EPS;
  // the open track's first and last pieces, by their segments' piece id (validate's and the preview's seam: app/preview/preview.js seamSpans)
  const pieceOf = (i) => { const g = segments[S[i].seg]; return g && g.id !== undefined ? g.id : S[i].seg; };
  const firstPiece = n ? pieceOf(0) : null, lastPiece = n ? pieceOf(n - 1) : null;
  // ...running the same way (within SEAM_DEG): the last piece laid onto the first, along it. One that crosses it (a figure of eight's last straight over its first) is a pass
  const seamPair = (i, j) => firstPiece !== lastPiece && ((pieceOf(i) === firstPiece && pieceOf(j) === lastPiece) || (pieceOf(i) === lastPiece && pieceOf(j) === firstPiece)) && dot(S[i].T, S[j].T) > Math.cos(SEAM_DEG * DEG);
  const best = new Map();
  // a station keeps its worst finding; `clip` is kept if ANY line at it had the other's surface on or through this road (as validate stacked()'s mark keeps its clip)
  const note = (i, f) => { const e = best.get(i), clip = f.clip || !!(e && e.clip); if (!e || f.shortM > e.shortM + 1e-12 || (Math.abs(f.shortM - e.shortM) <= 1e-12 && (f.u < e.u || (f.u === e.u && f.otherS < e.otherS)))) best.set(i, { ...f, clip }); else if (clip && !e.clip) best.set(i, { ...e, clip }); };
  /** the solid of station j against the car room of station i: every point of j's lateral lines (surface to hull bottom) over i's road or apron */
  const reachInto = (i, j) => {
    const A = ptsOf(i), Bj = ptsOf(j);
    let above = false, below = false, on = false;   // where j's SURFACE lies over i's footprint: its two sides, or on it (the meshes meet: validate stacked()'s clip test)
    for (const o of Bj.pts) {
      // the point of i this line stands OVER: the least distance ACROSS i's surface (the part of the offset off that point's normal and off the road's direction),
      // from either end of the line, so a line over the apron finds the plank, not the road's edge beside it (the nearest in space can be the edge)
      let k = -1, bd = Infinity;
      for (let m = 0; m < A.pts.length; m++) {
        const p = A.pts[m];
        for (const e of [o.q, o.b]) { const v = sub(e, p.q), g = dot(v, p.n), t = dot(v, A.T); if (Math.abs(t) > A.hs) continue; const w = len(sub(v, add([p.n[0] * g, p.n[1] * g, p.n[2] * g], A.T, t))); if (w < bd) { bd = w; k = m; } }
      }
      // over i's footprint: its lateral reach is its own points, so a line more than half their spacing across from the nearest is beside it, not over it
      if (!(bd <= 0.5 * ACROSS_M + EPS)) continue;
      const a = A.pts[k], vq = sub(o.q, a.q), vb = sub(o.b, a.q);
      const gq = dot(vq, a.n), gb = dot(vb, a.n), lo = Math.min(gq, gb), hi = Math.max(gq, gb);
      if (gq > TOUCH_M) above = true; else if (gq < -TOUCH_M) below = true; else on = true;
      if (!(lo < margin && hi > -TOUCH_M)) continue;   // the line stays wholly over the car's room, or wholly under this surface
      const gap = lo;   // the lowest the solid comes over this surface (negative: through it)
      note(i, { s: S[i].s, u: a.u, otherS: S[j].s, otherU: o.u, gapM: gap, needM: margin, shortM: margin - gap, surfaceGapM: gq, apron: o.apron, onApron: a.apron, hullM: o.depth, clip: gq <= TOUCH_M, at: gq < gb ? o.q : o.b });
    }
    // the other's surface on both sides of this one, or on it: the two meet (their surfaces cross between the points read)
    if ((above && below) || on) { const e = best.get(i); if (e && !e.clip) best.set(i, { ...e, clip: true }); }
  };
  for (let i = from; i < n; i++) {   // only the queried stations lead; each meets every other station, before `from` too
    if (!isRoad(i)) continue;
    const pi = S[i].pos, [cx, cy, cz] = [Math.floor(pi[0] / reach), Math.floor(pi[1] / reach), Math.floor(pi[2] / reach)];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const list = grid.get(`${cx + a},${cy + b},${cz + c}`); if (!list) continue;
      for (const j of list) {
        if (j >= from && j <= i) continue;   // a pair of two queried stations is measured once; a station before `from` is met by each queried one
        let ds = Math.abs(S[j].s - S[i].s); if (path.closed) ds = Math.min(ds, L - ds);
        // THE SAME PASS: closer along the lap than opts.minSeparationM, or than the two sections' lateral reach (road and apron) added: a wide cupped road's rim, across a
        // joint into a turn, reads as over its own road a few stations on (the panel's default road, 300 m then a 750 m turn: two stations 28 m apart, one road)
        if (ds < Math.max(sep, secOf(S[i].seg).w + secOf(S[j].seg).w)) continue;
        // AN OPEN TRACK'S TWO ENDS: the road's last stretch on its first is the seam a Close will join, not a pass over it (as on a closed lap, where they are one pass):
        // within opts.minSeparationM of either end (a bend that opened a closed lap brings its two ends together across the seam), or the LAST PIECE on the FIRST along
        // it (a lap is built by laying its last piece onto its start, then Close)
        if (!path.closed && ((Math.min(S[i].s, S[j].s) - S[0].s < sep && S[n - 1].s - Math.max(S[i].s, S[j].s) < sep) || seamPair(i, j))) continue;
        const ri = secOf(S[i].seg).r, rj = secOf(S[j].seg).r, d = sub(S[j].pos, pi);
        if (len(d) - ri - rj >= margin) continue;
        // each cross-section reaches along the other's road by at most its own size times the sine between the two roads (validate stacked()'s bound), so
        // a pair whose sections cannot come within a station step of each other along either road is not measured
        const c = dot(S[i].T, S[j].T), sin = Math.sqrt(Math.max(0, 1 - c * c));
        if (Math.abs(dot(d, S[i].T)) - rj * sin >= ptsHalf(i) && Math.abs(dot(d, S[j].T)) - ri * sin >= ptsHalf(j)) continue;
        reachInto(i, j); reachInto(j, i);
      }
    }
  }
  return [...best.values()].sort((x, y) => x.s - y.s);
}

module.exports = { passClearance, CAR_MARGIN_M, SEPARATION_M, _internal: { sectionOf, depthAcross } };
