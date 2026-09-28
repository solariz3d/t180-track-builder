// pitlane.js: the PIT LANE's road (ARCHITECTURE §11.1, §5c: "a side road leaving and rejoining the loop"), from the
// document's `pitLane` (src/doc/pitlane.js) and the main road it is anchored to.
//
//   buildPitLane(mainPath, mainSegments, pitLane, { stepM = 1 })
//     -> { path, segments, joins: { leave: { s, sLane }, rejoin: { s, sLane } }, parts: { diverge, run, merge },
//          at(s) -> { inner, centre, edge, L, U, g } }            at(s): the lane at MAIN-road s, exactly, for checks
//   laneCheck(mainMesh, laneMesh, lane, { stackedM = 2, exemptM = 5 }) -> { intersections, stacked, stats }
//
// SHAPE. The lane is built in the MAIN road's own coordinates, so it follows every word it runs beside. At main s:
//   e(s)  = the main road's surface point at its lane-side EDGE (the profile the mesh builds there: the font, or the font
//           RAMP's blend, profile.js blend, the same as mesh.js and src/markers/place.js profileAt)
//   g(s)  = the gap from that edge to the lane's inner edge: 0 at the leave, easing out over divergeM of main road to
//           offsetM, offsetM along the run, easing back to 0 over mergeM. The ease is profile.js smoothstep, the one the
//           font ramps use: zero slope at both ends, so the lane's inner edge leaves the road's edge TANGENTIALLY.
//   φ(s)  = the lane's TILT about the road's T: the road's edge angle ψe(s) at the joins, easing to 0 with the gap
//           (φ = ψe·(1 − g/offsetM)), so the lane runs level beside the road and leaves it in the edge's own plane
//   A(s)  = the edge's outward tangent tilted by φ: σ·L·cos φ + U·sin φ (the road's own across-direction there, at φ = ψe)
//   inner = e + A·g,  centre = e + A·(g + width/2)      σ = +1 on the left (+u), −1 on the right
// JOINS WITH NO STEP, AND G1. At the leave and the rejoin g = 0 and g' = 0, so the lane's inner edge IS the road's edge
// (same point) and runs along it (same tangent: inner' = e' + A'g + Ag' = e'). There φ = ψe, so the lane's rows lie along
// the road's own surface tangent at its edge and its normal is the road's there (profile.js normalAt): across that shared
// edge the surface continues in the same plane, whatever the edge's tilt.
// D182 (pane C): this was "the lane is flat, and the edge must be flat (≤ 1°)". The measured fonts (src/geom/fonts.js) rise
// from the centre, 15.5° at the bowl's edge and 30.6° at the half-pipe's, so no lane could leave a default road. Now an
// edge is refused only past JOIN_MAX (35°, the reader's own lip: a fold sharper than 35° in a metre is an edge, not road,
// tools/read_track.cjs), still as PIT_JOIN_NOT_FLAT. The lane never overlaps the road's surface, so there is no stacked
// surface at a join: the two meshes share an edge line and nothing else.
// THE ROWS ARE THE MAIN ROAD'S. Each lane station lies at a main-road s and its cross-section runs along the main road's
// L: on the run that is square to the lane; in a diverge it is sheared by the lane's angle to the road (at most
// atan(1.5·offsetM/divergeM): 12.8° for the defaults 12 m over 80 m, so the lane measures width·cos 12.8° = 97.5 % of its
// width across its own direction there, inferred from that bound). In return the joins are exact.
// The lane's s is its own ARC LENGTH (centreline), from 0 at the leave, so pit boxes spaced along it are spaced on it.
// Its kvec is the main road's, scaled to the lane's offset (kvec/(1 − kvec·Q), Q the lane centre's offset from the
// main centreline), so mesh.js's fold margin measures the lane's own rows.
//
// REFUSED, by name (err.code): PIT_ANCHOR_MISSING (an anchor's word is gone), PIT_BACKWARDS (the rejoin is not after
// the leave: a lane across the loop's start is not built), PIT_TOO_SHORT (diverge + merge longer than the lane),
// PIT_OVER_GAP (a jump's flight inside the lane's span), PIT_JOIN_NOT_FLAT.
//
// NOT DONE HERE: banking. Along the run the lane lies in the main road's plane (φ = 0), so beside a banked road it is banked
// too, and rises or falls by offset·sin(bank). Pit lanes run beside straights; a lane off a banked turn would need its own roll.
'use strict';
const Prof = require('./profile.js');
const { triTri, segTri, _internal: { soup, build, query } } = require('./bvh.js');

const JOIN_MAX = 35 * Math.PI / 180;  // the steepest road edge a lane joins: the reader's lip (a sharper fold is an edge, not road)
const MAT = 'ROAD';                    // drivable: its cells are 1ROAD_PIT_<part>_<n> (surfaces.ini MESHES=1ROAD?)

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return l > 0 ? mul(a, 1 / l) : [0, 0, 0]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const err = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code, name: 'PitLaneError' });

/** Segment start s's: the running sum of lengths from the path's first station (as src/markers/place.js segStarts). */
function starts(path, segments) { const out = []; let s = path.samples[0].s; for (const g of segments) { out.push(s); s += g.length; } return out; }
/** An anchor's s, or null if its word is gone (as src/markers/layout.js anchorS: the word's start plus along, clamped). */
function anchorS(a, segments, st) {
  let first = -1, total = 0;
  segments.forEach((g, k) => { if (g.id === a.word) { if (first < 0) first = k; total += g.length; } });
  return first < 0 ? null : st[first] + Math.min(Math.max(a.along, 0), total);
}
function profileAt(seg, d) {
  const P = Prof.normalize(seg.profile);
  if (!seg.blend) return P;
  const w = Prof.smoothstep((seg.blend.s0 + d) / seg.blend.length);
  return w >= 1 ? P : Prof.normalize(Prof.blend(Prof.normalize(seg.blend.from), P, w));
}

function buildPitLane(mainPath, segments, lane, { stepM = 1 } = {}) {
  if (!lane) throw err('NO_PIT_LANE', 'the document has no pit lane');
  const S = mainPath.samples, st = starts(mainPath, segments), sg = lane.side === 'L' ? 1 : -1, w = lane.width;
  const s0 = anchorS(lane.leave, segments, st), s1 = anchorS(lane.rejoin, segments, st);
  if (s0 === null || s1 === null) throw err('PIT_ANCHOR_MISSING', `the lane's ${s0 === null ? `leave word ${lane.leave.word}` : `rejoin word ${lane.rejoin.word}`} is not in the track`);
  if (!(s1 > s0)) throw err('PIT_BACKWARDS', `the lane rejoins at s ${s1.toFixed(1)} m, not after it leaves at s ${s0.toFixed(1)} m (a lane across the loop's start is not built)`);
  if (lane.divergeM + lane.mergeM > s1 - s0 + 1e-9) throw err('PIT_TOO_SHORT', `diverge ${lane.divergeM} m + merge ${lane.mergeM} m do not fit in the ${(s1 - s0).toFixed(1)} m between leave and rejoin`);
  const sa = s0 + lane.divergeM, sb = s1 - lane.mergeM;

  const bracket = (s) => { let lo = 0, hi = S.length - 1; if (s <= S[0].s) return 0; if (s >= S[hi].s) return hi - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; } return lo; };
  const segAt = (s) => { let g = 0; for (let k = 0; k < segments.length; k++) if (st[k] <= s + 1e-9) g = k; return g; };
  const gapAt = (s) => (s <= s0 ? 0 : s < sa ? lane.offsetM * Prof.smoothstep((s - s0) / lane.divergeM) : s <= sb ? lane.offsetM : s < s1 ? lane.offsetM * Prof.smoothstep((s1 - s) / lane.mergeM) : 0);
  /** The lane at main-road s: every point of it, exactly (the main frame interpolated as src/markers/place.js does). */
  function at(s) {
    const i = bracket(s), a = S[i], b = S[Math.min(i + 1, S.length - 1)], t = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 0;
    const k = segAt(s), seg = segments[k];
    if (seg.kind === 'gap') throw err('PIT_OVER_GAP', `s ${s.toFixed(1)} m is over a jump's flight: a pit lane cannot run beside it`);
    const P = profileAt(seg, s - st[k]), uE = sg > 0 ? P.u[P.u.length - 1] : P.u[0];
    const T = unit(lerp(a.T, b.T, t)), L = unit(lerp(a.L, b.L, t)), U = unit(lerp(a.U, b.U, t)), pos = lerp(a.pos, b.pos, t);
    const kv = lerp(a.kvec, b.kvec, t);
    const [X, Y] = Prof.offsetAt(P, uE), edge = add(pos, add(mul(L, X), mul(U, Y))), g = gapAt(s), psiEdge = Prof.psiAt(P, uE);
    const phi = psiEdge * (lane.offsetM > 0 ? 1 - Math.min(1, g / lane.offsetM) : 1), c = Math.cos(phi), sn = Math.sin(phi);
    const A = add(mul(L, sg * c), mul(U, sn)), Ll = add(mul(L, c), mul(U, sg * sn)), Ul = add(mul(U, c), mul(L, -sg * sn));   // the lane's across (+u = L side) and up
    return { s, T, L, U, pos, kvec: kv, edge, psiEdge, phi, Ll, Ul, g, inner: add(edge, mul(A, g)), centre: add(edge, mul(A, g + w / 2)) };
  }
  for (const [name, s] of [['leave', s0], ['rejoin', s1]]) {
    const x = at(s); if (Math.abs(x.psiEdge) > JOIN_MAX) throw err('PIT_JOIN_NOT_FLAT', `the road's ${lane.side === 'L' ? 'left' : 'right'} edge at the ${name} (s ${s.toFixed(1)} m) turns ${(x.psiEdge * 180 / Math.PI).toFixed(1)}° from flat; a lane joins an edge of at most 35° (the reader's lip)`);
  }

  // stations: the main road's own samples inside the span, the four part boundaries, and every stepM between
  const cuts = [s0, sa, sb, s1], ss = new Set(cuts);
  for (const sm of S) if (sm.s > s0 && sm.s < s1) ss.add(sm.s);
  for (let x = s0 + stepM; x < s1; x += stepM) ss.add(x);
  const main = [...ss].sort((x, y) => x - y).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 1e-6);
  const pts = main.map(at);
  let arc = 0;
  const partOf = (s) => (s < sa - 1e-9 ? 0 : s < sb - 1e-9 ? 1 : 2);
  const samples = pts.map((x, j) => {
    if (j) arc += len(sub(x.centre, pts[j - 1].centre));
    const Q = sub(x.centre, x.pos), kq = 1 - dot(x.kvec, Q);
    return { s: arc, seg: partOf(x.s), sMain: x.s, pos: x.centre, T: x.T, L: x.Ll, U: x.Ul, kvec: kq > 1e-9 ? mul(x.kvec, 1 / kq) : x.kvec,
      roll: 0, bankG: Math.asin(Math.max(-1, Math.min(1, x.Ll[1]))), grade: x.T[1] };
  });
  const sLane = (sMain) => samples.find((x) => Math.abs(x.sMain - sMain) < 1e-9).s;
  const bounds = [0, sLane(sa), sLane(sb), arc];
  const profile = { font: 'pit', material: MAT, u: [-w / 2, 0, w / 2], psi: [0, 0, 0] };
  const partNames = ['in', 'body', 'out'];
  const segs = partNames.map((part, g) => ({ id: 'PIT', part, word: 'pit', kind: 'road', length: bounds[g + 1] - bounds[g], k0: 0, k1: 0, kp0: 0, kp1: 0,
    profile, blend: null, speed: lane.speedKmh === null ? null : lane.speedKmh / 3.6 }));
  // path.js's shape: a boundary sample belongs to the part it STARTS; segEnd[g] is that sample again, as part g's end
  const segFirst = [0, 0, 0].map((_, g) => samples.findIndex((x) => x.seg === g));
  const segEnd = [0, 1, 2].map((g) => ({ ...samples[g < 2 ? segFirst[g + 1] : samples.length - 1], seg: g }));
  if (segFirst.some((i) => i < 0)) throw err('PIT_TOO_SHORT', 'a part of the lane has no length (diverge or merge fills the whole lane)');
  const path = { lengthM: arc, closed: false, samples, segFirst, segEnd, twist: 0 };
  return { path, segments: segs, joins: { leave: { s: s0, sLane: 0 }, rejoin: { s: s1, sLane: arc } }, parts: { diverge: [s0, sa], run: [sa, sb], merge: [sb, s1] }, at };
}

/**
 * The lane's mesh against the main road's, with the self-check's own tests (bvh.js triTri and segTri, on the finished
 * float32 mesh): every lane triangle against every main triangle it could meet, and every lane vertex's normal segment
 * (stackedM each way) against the main road. EXEMPT, and only this: a lane triangle of the DIVERGE (MERGE) part against
 * a main triangle within exemptM of that part's span of main road, where the two share their edge line by design.
 * Everything else is tested, including the diverge against any OTHER pass of the main road (a bridge overhead).
 */
function laneCheck(mainMesh, laneMesh, lane, { stackedM = 2, exemptM = 5 } = {}) {
  const A = soup(mainMesh), Bm = build(A), Ls = soup(laneMesh);
  const bL = lane.path.segEnd[0].s, bR = lane.path.segEnd[1].s;          // lane s where the diverge ends and the merge starts
  const zone = (sl) => (sl <= bL + 1e-9 ? lane.parts.diverge : sl >= bR - 1e-9 ? lane.parts.merge : null);
  const exempt = (sLaneMax, sLaneMin, m0, m1) => {
    const z = zone(sLaneMin) || zone(sLaneMax); if (!z) return false;
    return m1 >= z[0] - exemptM && m0 <= z[1] + exemptM;
  };
  const P = (S, i) => [S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]];
  const tv = (S, t) => [P(S, S.tris[t * 3]), P(S, S.tris[t * 3 + 1]), P(S, S.tris[t * 3 + 2])];
  const stats = { laneTriangles: Ls.tris.length / 3, mainTriangles: Bm.T, triTests: 0, rayTests: 0, exempted: 0 };
  const inter = [], stacked = [];
  for (let t = 0; t < Ls.tris.length / 3; t++) {
    const V = tv(Ls, t), lo = [0, 1, 2].map((d) => Math.min(V[0][d], V[1][d], V[2][d])), hi = [0, 1, 2].map((d) => Math.max(V[0][d], V[1][d], V[2][d]));
    const sl = [0, 1, 2].map((v) => Ls.s[Ls.tris[t * 3 + v]]);
    query(Bm, lo, hi, (o) => {
      if (exempt(Math.max(...sl), Math.min(...sl), Bm.s0[o], Bm.s1[o])) { stats.exempted++; return; }
      stats.triTests++; const O = tv(A, o);
      if (triTri(V[0], V[1], V[2], O[0], O[1], O[2])) inter.push({ sLane: Math.min(...sl), sMain: Bm.s0[o], cell: Ls.cells[Ls.triCell[t]], other: A.cells[A.triCell[o]] });
    });
  }
  for (let i = 0; i < Ls.s.length; i++) {
    const p = P(Ls, i), n = [Ls.nrm[i * 3], Ls.nrm[i * 3 + 1], Ls.nrm[i * 3 + 2]], nl = len(n); if (!(nl > 0)) continue;
    const q0 = p.map((x, d) => x - n[d] / nl * stackedM), q1 = p.map((x, d) => x + n[d] / nl * stackedM);
    query(Bm, q0.map((x, d) => Math.min(x, q1[d])), q0.map((x, d) => Math.max(x, q1[d])), (o) => {
      if (exempt(Ls.s[i], Ls.s[i], Bm.s0[o], Bm.s1[o])) { stats.exempted++; return; }
      stats.rayTests++; const O = tv(A, o), t = segTri(q0, q1, O[0], O[1], O[2]);
      if (t !== null) stacked.push({ sLane: Ls.s[i], sMain: Bm.s0[o], gap: Math.abs(t * 2 - 1) * stackedM, cell: Ls.cells[Ls.vCell[i]], other: A.cells[A.triCell[o]] });
    });
  }
  return { intersections: inter, stacked, stats };
}

module.exports = { buildPitLane, laneCheck, JOIN_MAX };
