// zonegrab.js: SCULPT GRABS THE ROAD ITSELF (D519 Part 2, O's design exo_memory/handback/p-d519-design-O_2026-10-28.md §1 and §3). With the Grab tool, the place a press
// lands across the road names the channel a drag changes, and the drag's direction picks between a zone's two (a lift, or out and in), the way a 3-D program's
// vertex drag does. Never a re-route: no zone names kh, kv or length (Bend, Climb and Stretch stay on their keys). Pure, and tested (app/test/zonegrab.test.js):
//   zoneAt(u, piece, mods)                 -> { zone, U, L, alt } | null   the zone at share u across the road, the channel a lift (U) and an out-and-in (L) drag change
//   axisOf(motion, axes, zone)             -> 'U' | 'L'                    which of the two a drag's first motion past the click is, locked for the drag
//   dotStations(stations, run, project, o) -> [s, ...]                    the stations of the dot rows on the selected run, thinned in metres and on screen
//   glyphOf(zone, u, alt)                  -> { kind, place }              the glyph a zone shows on hover (app/core/handles.js's brush kinds) and where it stands across
//   acrossAt(path, segments, m, u)         -> { pos, U, L } | null         a point on the road's own surface at share u across it, with its normal and outward direction
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

module.exports = { glyphOf, acrossAt, zoneAt, axisOf, dotStations, CENTRE, RIM, REACH, EDGE_ON_PX };
