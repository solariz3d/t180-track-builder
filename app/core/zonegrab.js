// zonegrab.js: SCULPT GRABS THE ROAD ITSELF (D519 Part 2, O's design exo_memory/handback/p-d519-design-O_2026-10-28.md §1 and §3). With the Grab tool, the place a press
// lands across the road names the channel a drag changes, and the drag's direction picks between a zone's two (a lift, or out and in), the way a 3-D program's
// vertex drag does. Never a re-route: no zone names kh, kv or length (Bend, Climb and Stretch stay on their keys). Pure, and tested (app/test/zonegrab.test.js):
//   zoneAt(u, piece, mods)                 -> { zone, U, L, alt } | null   the zone at share u across the road, the channel a lift (U) and an out-and-in (L) drag change
//   axisOf(motion, axes, zone)             -> 'U' | 'L'                    which of the two a drag's first motion past the click is, locked for the drag
//   dotStations(stations, run, project, o) -> [s, ...]                    the stations of the dot rows on the selected run, thinned in metres and on screen
//   glyphOf(zone, u, alt)                  -> { kind, place }              the glyph a zone shows on hover (app/core/handles.js's brush kinds) and where it stands across
//   acrossAt(path, segments, m, u)         -> { pos, U, L } | null         a point on the road's own surface at share u across it, with its normal and outward direction
// D520 (the user, 15:12: "the mouse click gives a singular point you then drag to sculpt the track simple as that"; plan_d520_sculpt_point_follows_the_mouse): Grab no longer
// locks an axis. The pressed point follows the pointer on the grab plane, and the road around it follows with the radius as the softness:
//   planePoint(ray, at, forward)           -> [x, y, z] | null             where the pointer's ray meets the plane through the hit facing the camera
//   frameAt(path, segments, s, u)          -> frame | null                 the road's frame and section at the press, what follow reads
//   follow(delta, frame, piece)            -> { h, l, w?, phi?, c? }       the channel changes that carry the pressed point by `delta`
'use strict';

const { sealed, readAt, offsetAt, psiAt } = require('../../src/geom/profile.js');

const CENTRE = 0.2;    // |u| under this is the centre (O's §1: keeps D425's cup glyph, at 0.3, in the cup zone; ±3.2 m of a 32 m road)
const RIM = 0.9;       // |u| from here is the rim (the outer 1.6 m of a 32 m road, around Build's width mark at lat 1)
const REACH = 1.25;    // |u| past the rim the pick still counts as the road (the pick's tolerance); beyond it, no zone
const EDGE_ON_PX = 4;  // a lift axis shorter than this on screen, px per metre, is the road seen edge-on: the drag is out and in

/**
 * The zone at share `u` across the road (0 the centreline, ±1 the rims, + the left), on a piece `piece` = { cup, edge, tube, family, s, walls } (s: an edge
 * piece's edge start, a share of the half-width; walls: a half-pipe whose wall rise is above 0). `mods.alt`: Alt held, the zone's one Alt channel, any direction.
 * Returns { zone: 'centre' | 'cup' | 'edge' | 'rim', U, L, alt } (L null: the zone takes a lift only), or null off the road (|u| past REACH, or no number).
 */
function zoneAt(u, piece = {}, mods = {}) {
  if (typeof u !== 'number' || !Number.isFinite(u) || Math.abs(u) > REACH) return null;
  const P = piece || {}, a = Math.abs(u), left = u >= 0;
  const edgeZone = !!P.edge && Number.isFinite(P.s) && P.s < RIM;   // an edge piece whose edge starts at or past the rim has no edge zone: its rim does the edge
  const lift = P.cup ? 'c' : P.tube ? 't' : 'phi';                  // what lifting part of the road does where there is no edge: the cup, the sweep, or bank
  let z;
  if (a < CENTRE) z = { zone: 'centre', U: 'height', L: 'lateral', alt: 'lateral' };
  else if (a < (edgeZone ? P.s : RIM)) z = { zone: 'cup', U: lift, L: null, alt: 'phi' };
  else if (a < RIM) z = { zone: 'edge', U: left ? 'e' : 'er', L: 's', alt: 'phi' };
  else z = { zone: 'rim', U: P.edge ? (left ? 'e' : 'er') : P.cup ? 'c' : P.tube ? 't' : P.family === 'half-pipe' && P.walls ? 'r' : 'phi', L: 'w', alt: 'phi' };
  return mods && mods.alt ? { ...z, U: z.alt, L: null } : z;
}

/**
 * Which axis a drag reads: its first motion past the click `motion` = [dx, dy] px against the on-screen directions of the road's up and across at the hit, `axes` =
 * { U: [dx, dy], L: [dx, dy] } (px a metre). The closer one wins and lift wins a tie; a zone with no L channel is always U; a lift axis under EDGE_ON_PX px a metre
 * (the road seen edge-on) leaves only out and in.
 */
function axisOf(motion, axes, zone) {
  if (!zone || !zone.L) return 'U';
  const U = (axes && axes.U) || [0, 0], L = (axes && axes.L) || [0, 0], lu = Math.hypot(U[0], U[1]), ll = Math.hypot(L[0], L[1]);
  if (lu < EDGE_ON_PX) return 'L';
  const mx = (motion && motion[0]) || 0, my = (motion && motion[1]) || 0;
  const cu = Math.abs(mx * U[0] + my * U[1]) / lu, cl = ll > 0 ? Math.abs(mx * L[0] + my * L[1]) / ll : 0;
  return cu >= cl - 1e-9 ? 'U' : 'L';
}

/**
 * The stations the dot rows stand at, on the run { s0, s1 }: of `stations` (the run's control-point stations, metres), walking in s, one is kept when it is at least
 * max(minM, radius) on from the last kept AND at least minPx from it on screen (`project(s)` -> [x, y] or null behind the camera, which drops it). The run's first and
 * last stations are kept when on screen (a last too close to the one before it takes that one's place). Over `cap`, every ⌈n/cap⌉-th. The same input gives the same output.
 */
function dotStations(stations, run, project, { radius = 0, minM = 100, minPx = 24, cap = 40 } = {}) {
  if (!Array.isArray(stations) || !run || !(run.s1 >= run.s0) || typeof project !== 'function') return [];
  const inRun = [...new Set(stations.filter((s) => Number.isFinite(s) && s >= run.s0 - 1e-9 && s <= run.s1 + 1e-9))].sort((a, b) => a - b);
  if (!inRun.length) return [];
  const gapM = Math.max(minM, Number.isFinite(radius) ? radius : 0), on = inRun.map((s) => ({ s, p: project(s) })).filter((x) => x.p);
  if (!on.length) return [];
  const far = (a, b) => b.s - a.s >= gapM - 1e-9 && Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) >= minPx;
  const first = on[0].s === inRun[0] ? on[0] : null, last = on[on.length - 1].s === inRun[inRun.length - 1] ? on[on.length - 1] : null;
  const kept = [];
  for (const x of on) if (!kept.length || far(kept[kept.length - 1], x)) kept.push(x);
  if (last && kept[kept.length - 1] !== last) {
    if (kept.length > 1 && kept[kept.length - 1] !== first && !far(kept[kept.length - 1], last)) kept.pop();
    const prev = kept[kept.length - 1], apart = Math.hypot(last.p[0] - prev.p[0], last.p[1] - prev.p[1]) >= minPx;
    if (far(prev, last) || (prev === first && apart)) kept.push(last);   // a run shorter than the spacing keeps both its ends, unless they meet on screen
  }
  let out = kept.map((x) => x.s);
  if (out.length > cap) { const k = Math.ceil(out.length / cap); out = out.filter((_, i) => i % k === 0); }
  return out;
}

const sectionMemo = new WeakMap();   // segment -> Map(local distance -> sealed section): a pose change re-picks the same stations
const sectionOf = (g, d) => {
  if (!Object.isFrozen(g)) return sealed(readAt(g, d));
  let m = sectionMemo.get(g); if (!m) { m = new Map(); sectionMemo.set(g, m); }
  if (!m.has(d)) { if (m.size > 4096) m.clear(); m.set(d, sealed(readAt(g, d))); }
  return m.get(d);
};
/**
 * A point on the road's own surface at share `u` across it (0 the centreline, +1 the left rim, -1 the right, as the samples' L), at the path sample `m`: its world
 * position, the section's local normal `U` and its local across direction `L` (unit world vectors; L points OUTWARD on the side of u, and left at u = 0), or null where
 * the sample's segment has no cross-section. Read from the section the mesh draws there (profile.js readAt, offsetAt, normalAt), as acrossLines and clearanceAtHead do.
 */
function acrossAt(path, segments, m, u) {
  const g = segments && segments[m.seg]; if (!g || !g.profile || !Number.isFinite(u)) return null;
  const P = sectionOf(g, m.s - path.starts[m.seg].s), E = [P.u[0], P.u[P.u.length - 1]], uu = u >= 0 ? u * E[1] : -u * E[0];
  const o = offsetAt(P, uu), p = psiAt(P, uu), sg = uu > 0 ? 1 : uu < 0 ? -1 : 0, side = sg || 1;
  const nl = -sg * Math.sin(p), nu = Math.cos(p), tl = side * Math.cos(p), tu = Math.sin(p);   // the normal (profile.js normalAt) and the outward tangent, in [L, U]
  const at = [0, 1, 2].map((k) => m.pos[k] + m.L[k] * o[0] + m.U[k] * o[1]);
  return { pos: at, U: [0, 1, 2].map((k) => m.L[k] * nl + m.U[k] * nu), L: [0, 1, 2].map((k) => m.L[k] * tl + m.U[k] * tu) };
}

/**
 * The glyph a zone shows on hover (design §4): { kind (handles.js's brush kinds), place ({ sides, lat } for model.brush: the mark at the hit's u; {} for a pair at its own
 * place, the width at the rims and the cup just inside them) }. Alt: sideways at the centre, bank off it. A zone's lift names the glyph where it has no pair: the cup's,
 * the sweep's (a tube), or bank.
 */
function glyphOf(z, u, alt = false) {
  const kind = alt ? (z.zone === 'centre' ? 'brush-side' : 'brush-twist') : z.zone === 'centre' ? 'brush-grab' : z.zone === 'rim' ? 'brush-width' : z.zone === 'edge' ? 'brush-edge'
    : z.U === 'c' ? 'brush-cup' : z.U === 't' ? 'brush-sweep' : 'brush-twist';
  return { kind, place: kind === 'brush-width' || kind === 'brush-cup' ? {} : { sides: [u < 0 ? -1 : 1], lat: Math.abs(u) } };
}

// ── D520: THE GRABBED POINT FOLLOWS THE MOUSE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const UP_MIN = 0.05;     // the road's unrolled up must keep this much of world up (a pitch under ~87°): h is along world up, so past it a lift cannot reach the plane
const SQUEEZE_MIN = 0.1; // a rim drag never takes the road under this share of its width (the point then lags rather than fold the road)

/**
 * The grab plane (plan item 1): the plane through `at` facing the camera (`forward`, the camera's view direction, is its normal), `ray` = { origin, dir } the
 * pointer's ray in world (dir toward the scene). Returns the point where the ray meets it, or null when the ray runs along it or points away. A pointer that has
 * not moved lands on `at` exactly.
 */
function planePoint(ray, at, forward) {
  if (!ray || !at || !forward) return null;
  const den = dot3(ray.dir, forward); if (!(Math.abs(den) > 1e-12)) return null;
  const t = dot3([at[0] - ray.origin[0], at[1] - ray.origin[1], at[2] - ray.origin[2]], forward) / den; if (!(t > 0)) return null;
  return [0, 1, 2].map((k) => ray.origin[k] + ray.dir[k] * t);
}

/**
 * The road at a press (station `s`, share `u` across): the path sample nearest s and, from it, T (the road's tangent), R (the gravity frame's horizontal left, the
 * axis of l, document.js), U0 = T × R (the unrolled up), the bank as cos and sin (the section's across is R·cos φ + U0·sin φ, so φ is read off the sample's own L),
 * the full width `w` (rim to rim along the section's u, which is the document's w), and the section offsets [along L, along U] of the pressed point `oP` and the
 * far rim `oF` (the rim on the other side; the right rim for a press at the centre). Null where the sample has no section.
 */
function frameAt(path, segments, s, u) {
  if (!path || !Array.isArray(path.samples) || !path.samples.length || !Number.isFinite(s) || !Number.isFinite(u)) return null;
  const S = path.samples; let lo = 0, hi = S.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (S[mid].s < s) lo = mid + 1; else hi = mid; }
  const m = lo > 0 && Math.abs(S[lo - 1].s - s) <= Math.abs(S[lo].s - s) ? S[lo - 1] : S[lo];
  const g = segments && segments[m.seg]; if (!g || !g.profile) return null;
  const P = sectionOf(g, m.s - path.starts[m.seg].s), E = [P.u[0], P.u[P.u.length - 1]], side = u < 0 ? -1 : 1, uu = u >= 0 ? u * E[1] : -u * E[0];
  const T = m.T, th = Math.atan2(T[0], T[2]), R = [Math.cos(th), 0, -Math.sin(th)], U0 = cross3(T, R);
  return { s: m.s, T: T.slice(), R, U0, cos: dot3(m.L, R), sin: dot3(m.L, U0), w: E[1] - E[0], side, u, oP: offsetAt(P, uu), oF: offsetAt(P, side > 0 ? E[0] : E[1]), section: P };
}

/**
 * THE FOLLOW (plan item 2): the channel changes { h, l, w?, phi?, c? } (h, l, w in m; phi in rad; c in degrees) that carry the pressed point by `delta` (world, the
 * grab plane's P′ − at) on the road's section at the press, `frame` = frameAt's. The forward part of delta (along the road) is dropped: no re-route, no stretch.
 * What is left lies in the section's plane (R, U0), and each zone carries the point there exactly:
 *   - centre (and partway out on a piece with nothing to lift: a plain road, a tube, an edge piece's edge band): the section slides whole, l by the across and h
 *     by the up (h is along WORLD up, so h = the up / (U0 · world up));
 *   - partway out on a CUP piece (`piece.cupMove(dc)` = how far the point moves in the section, [along L, along U] m, when the cup turns by dc degrees, null past the
 *     cup's limits): the section slides along its own across and the cup turns, solved together (Newton, the cup's own profile) so the point lands on the pointer; a
 *     cup whose lift there runs along the across, or that cannot reach, slides whole instead;
 *   - a rim: the FAR rim stays where it is and the pressed point follows: the chord from the far rim to the point turns (phi) and stretches (w, the section scaled
 *     about the far rim), and the centre moves with it (l, h). The section is the same shape at any width (its knots are shares of it), so this holds at any bank:
 *     O's catch, D519 §6, that l is world-horizontal and a banked road's rims are not, is why the rim is solved through the bank and not as w += e, l += e/2.
 *     A rim pulled toward the far rim keeps SQUEEZE_MIN of the chord along where it was, so the road never folds over (the chord turns under a quarter turn a drag).
 * Null when the road's up has no world-up part to lift with (pitched past ~87°).
 */
function follow(delta, frame, piece = {}) {
  if (!frame || !Array.isArray(delta) || delta.length !== 3 || !delta.every(Number.isFinite)) return null;
  const { T, R, U0, cos, sin, w, oP, oF } = frame, upY = U0[1];
  if (!(upY > UP_MIN)) return null;
  const f = dot3(delta, T), p = [0, 1, 2].map((k) => delta[k] - f * T[k]), e = dot3(p, R), v = dot3(p, U0);   // in the section's plane: e along R, v along U0
  const rot = (a, b, c = cos, s = sin) => [a * c - b * s, a * s + b * c];   // section [along L, along U] -> [along R, along U0]
  const slide = (dR, dU) => ({ h: dU / upY, l: dR });
  const zone = zoneAt(frame.u, piece || {});
  if (zone && zone.zone === 'rim') {
    const v0 = rot(oP[0] - oF[0], oP[1] - oF[1]), n0 = Math.hypot(v0[0], v0[1]);
    if (!(n0 > 1e-9)) return slide(e, v);
    const v1 = [v0[0] + e, v0[1] + v], short = Math.max(0, SQUEEZE_MIN * n0 * n0 - (v1[0] * v0[0] + v1[1] * v0[1])) / (n0 * n0);   // never nearer the far rim than SQUEEZE_MIN along the chord
    v1[0] += short * v0[0]; v1[1] += short * v0[1];
    const k = Math.hypot(v1[0], v1[1]) / n0, dphi = Math.atan2(v0[0] * v1[1] - v0[1] * v1[0], v0[0] * v1[0] + v0[1] * v1[1]);
    const c1 = Math.cos(dphi) * cos - Math.sin(dphi) * sin, s1 = Math.sin(dphi) * cos + Math.cos(dphi) * sin;   // the bank after: φ + dφ
    const F0 = rot(oF[0], oF[1]), F1 = rot(oF[0] * k, oF[1] * k, c1, s1);   // the far rim from the centre, before and after
    return { ...slide(F0[0] - F1[0], F0[1] - F1[1]), w: w * (k - 1), phi: dphi };
  }
  const cupped = zone && zone.zone === 'cup' && piece && piece.cup && typeof piece.cupMove === 'function' ? cupSolve(e, v, cos, sin, piece.cupMove) : null;
  return cupped ? { ...slide(cupped.t * cos, cupped.t * sin), c: cupped.dc } : slide(e, v);
}
/**
 * The cup zone's solve: t (m, the section's slide along its own across) and dc (degrees) with t·across + rot(cupMove(dc)) = (e, v) in the section's plane. Newton on
 * the cup's own profile (CUP_STEP degrees for the slope), at most CUP_ITER steps, to CUP_TOL m. Null when the cup's lift there runs along the across (it cannot lift
 * the point), or the solve does not land (the cup's limits, or no convergence): the point then slides whole.
 */
const CUP_STEP = 0.5, CUP_ITER = 12, CUP_TOL = 1e-5;
function cupSolve(e, v, cos, sin, cupMove) {
  const rot = (p) => [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos];
  let dc = 0;
  for (let i = 0; i < CUP_ITER; i++) {
    const m0 = cupMove(dc), m1 = cupMove(dc + CUP_STEP); if (!m0 || !m1) return null;
    const p0 = rot(m0), g = [(rot(m1)[0] - p0[0]) / CUP_STEP, (rot(m1)[1] - p0[1]) / CUP_STEP], ng = Math.hypot(g[0], g[1]);
    const det = cos * g[1] - sin * g[0]; if (!(ng > 1e-9) || !(Math.abs(det) > 0.05 * ng)) return null;   // the cup's lift has no real part off the across here
    const rx = e - p0[0], ry = v - p0[1], t = (rx * g[1] - ry * g[0]) / det, step = (cos * ry - sin * rx) / det;   // the slide takes the across, the cup the rest
    if (Math.abs(step) < CUP_TOL / ng) { const m = cupMove(dc); return m ? { t, dc } : null; }
    dc += step;
  }
  return null;
}

module.exports = { glyphOf, acrossAt, zoneAt, axisOf, dotStations, planePoint, frameAt, follow, CENTRE, RIM, REACH, EDGE_ON_PX, UP_MIN, SQUEEZE_MIN };
