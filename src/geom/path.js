// path.js: segments → path. The centreline, its frame and its stations (docs/ARCHITECTURE.md §3, docs/INTERFACES.md §2).
//
//   buildPath(segments, { step = 0.5, closed }) -> { lengthM, closed, twist, samples: [{ s, seg, pos, T, L, U, kvec,
//                                                    roll, bankG, grade }], head }
//   extendPath(path, segments, fromSeg)          -> the same path, grown by segments[fromSeg..] from its OPEN END
//   buildHead(path)                               -> { s, pos, T, L, U, seg }: the build head, the open end's frame
//
// CURVE MODEL. Each segment is a clothoid in two angles:
//   · heading θ, turning about WORLD up at the yaw curvature k(s) = k0 + (k1 − k0)·s/L (+ = left);
//   · pitch p, at the pitch curvature kp(s) = kp0 + (kp1 − kp0)·s/L (+ = nosing up).
// So T = (cos p · sin θ, sin p, cos p · cos θ), with θ and p exact quadratics in s. That is ARCHITECTURE §2's "yaw and
// pitch curvature as ramped functions of s (clothoids, so smooth joins come by construction)". Yaw is about world up
// on purpose: a "turn left" word turns left on the map, whatever the pitch, which is how the document reads. Past a
// pitch of ±90° (an inversion) θ keeps its meaning and T stays smooth.
// Position is ∫T ds by 5-point Gauss–Legendre on every internal substep (≤ 0.25 m). Clothoid position has no closed
// form (Fresnel integrals), and this quadrature's error is far below a micrometre per metre (inferred: the fifth-order
// rule on a smooth integrand).
//
// FRAME (D177, the librarian's ruling on p-d177-rigid-C §2: OPTION 2; a DEVIATION from ARCHITECTURE §3's
// "rotation-minimising frames", recorded in docs/INTERFACES.md). The frame is the curve model's own GRAVITY frame: the
// unrolled left is the heading's left, H(θ) = (cos θ, 0, −sin θ), which is horizontal and perpendicular to
// T = (cos p · sin θ, sin p, cos p · cos θ) at EVERY pitch, ±90° and inversions included (θ keeps its meaning over the
// top, see CURVE MODEL). So a word's roll is its bank against gravity, and nothing is carried along the path but θ and p:
// a climbing turn no longer picks up the rotation-minimising frame's twist of k·sin p per metre (61° over a 360° turn at
// 10°), and a piece's shape in its own frame depends only on its handles and its start pitch. The explicit roll φ
// (+ = left side up, smoothstep between roll0 and roll1) is then applied about T. (T, L, U) is right-handed and
// L = U × T, as INTERFACES §2 and the T1 markers define left. On a CLOSED loop the frame closes with the heading, so there
// is no closing twist (path.twist is 0; the RMF's twist used to be spread over s).
// Until D177 the frame was rotation-minimising (the double reflection of Wang et al. 2008, still exported below).
//
// HEARTLINE. The curve integrated is the heartline. The road's centre is the heartline minus heartline·U (+ = the
// heartline above the road), as INTERFACES §1 "heartline … + = up" reads.
//
// GROWING FROM THE OPEN END (the keeper, 12:20: the user builds the track, coaster-builder style). Everything a segment
// needs from the past is its START STATE: position, heading, pitch, tangent and the unrolled RMF left, all carried in
// `path._end`. So extendPath integrates only the new segments. Its stations are the same set a full rebuild would pick
// (every multiple of `step`, plus every segment boundary), so an extended path equals a full rebuild, and its cost
// depends on the new tail, not on the track's length. The ONE sample it rewrites is the old open end: a boundary sample
// belongs to the segment it starts, so it is re-emitted under the new segment's roll, heartline and profile (the seam).
// A CLOSED path cannot be extended or sculpted in place: it must still meet itself, and closing a loop is the document's
// connector's job (ARCHITECTURE §2), so a closed loop is rebuilt in full.
//
// SCULPTING (rebuildPathFrom) regrows only the changed segments and RE-PLACES the unchanged tail rigidly when it can
// (D177; see BLOCKS AND THE PLACEMENT CHAIN below), bit-identical to a full build. An open path's samples are therefore
// views: read-only, same fields.
'use strict';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); if (!(l > 1e-15)) throw new Error('path: zero-length vector'); return mul(a, 1 / l); };
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const SUB = 0.25;                                    // m, largest internal substep for position and frame
const GL5 = [[-0.9061798459386640, 0.2369268850561891], [-0.5384693101056831, 0.4786286704993665], [0, 0.5688888888888889],
  [0.5384693101056831, 0.4786286704993665], [0.9061798459386640, 0.2369268850561891]];

/** Refuse anything that is not a usable segment. A zero-length word has no tangent, so no frame. */
function checkSegments(segments, from = 0) {
  if (!Array.isArray(segments) || segments.length === 0) throw new Error('buildPath: no segments');
  for (let i = from; i < segments.length; i++) {
    const g = segments[i], at = `segment ${i}${g && g.id ? ` (${g.id})` : ''}`;
    if (!g || typeof g !== 'object') throw new Error(`${at}: not an object`);
    if (!Number.isFinite(g.length) || g.length <= 0) throw new Error(`${at}: length must be a positive finite number, got ${g.length}`);
    for (const f of ['k0', 'k1', 'kp0', 'kp1', 'roll0', 'roll1', 'heartline']) if (g[f] !== undefined && !Number.isFinite(g[f])) throw new Error(`${at}: ${f} is not finite`);
  }
}
const num = (v) => (v === undefined ? 0 : v);
function tangent(theta, p) { return [Math.cos(p) * Math.sin(theta), Math.sin(p), Math.cos(p) * Math.cos(theta)]; }

/** One double-reflection step (Wang et al. 2008, Algorithm "Double reflection"): carry r from (x0, t0) to (x1, t1). */
function doubleReflect(x0, t0, r0, x1, t1) {
  const v1 = sub(x1, x0), c1 = dot(v1, v1);
  if (c1 < 1e-30) return r0;
  const rL = sub(r0, mul(v1, (2 / c1) * dot(v1, r0))), tL = sub(t0, mul(v1, (2 / c1) * dot(v1, t0)));
  const v2 = sub(t1, tL), c2 = dot(v2, v2);
  if (c2 < 1e-30) return rL;
  return sub(rL, mul(v2, (2 / c2) * dot(v2, rL)));
}
/** Cubic Hermite between two substep points, with unit tangents scaled by the substep length. */
function hermite(x0, t0, x1, t1, h, t) {
  const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return add(add(mul(x0, h00), mul(t0, h10 * h)), add(mul(x1, h01), mul(t1, h11 * h)));
}
/** Signed angle from a to b about axis n (all unit, a and b ⟂ n). */
const angleAbout = (a, b, n) => Math.atan2(dot(cross(a, b), n), dot(a, b));
/** Rotate v about unit axis n by angle a (Rodrigues). */
function rotate(v, n, a) { const c = Math.cos(a), s = Math.sin(a); return add(add(mul(v, c), mul(cross(n, v), s)), mul(n, dot(n, v) * (1 - c))); }

/** A sample at local distance u into segment g, from the segment's start angles and the substep bracketing it. */
function sampleAt(g, gi, s, u, th0, p0, A, B) {
  const L = g.length, k0 = num(g.k0), k1 = num(g.k1), q0 = num(g.kp0), q1 = num(g.kp1);
  const theta = th0 + k0 * u + (k1 - k0) * u * u / (2 * L), p = p0 + q0 * u + (q1 - q0) * u * u / (2 * L);
  const T = tangent(theta, p), h = B.u - A.u, t = h > 0 ? Math.min(1, Math.max(0, (u - A.u) / h)) : 0;
  const x = h > 0 ? hermite(A.x, A.T, B.x, B.T, h, t) : A.x.slice();
  const R = [Math.cos(theta), 0, -Math.sin(theta)];   // the gravity frame's unrolled left (FRAME)
  const kY = k0 + (k1 - k0) * u / L, kP = q0 + (q1 - q0) * u / L;
  // the curvature vector dT/ds = kY·∂T/∂θ + kP·∂T/∂p
  const dTdth = [Math.cos(p) * Math.cos(theta), 0, -Math.cos(p) * Math.sin(theta)], dTdp = [-Math.sin(p) * Math.sin(theta), Math.cos(p), -Math.sin(p) * Math.cos(theta)];
  const kvec = add(mul(dTdth, kY), mul(dTdp, kP));
  const phi = num(g.roll0) + (num(g.roll1) - num(g.roll0)) * smooth(u / L);
  const U0 = cross(T, R), Lr = add(mul(R, Math.cos(phi)), mul(U0, Math.sin(phi))), Ur = cross(T, Lr);
  const pos = sub(x, mul(Ur, num(g.heartline)));
  const run = Math.hypot(T[0], T[2]);
  return { s, seg: gi, pos, T, L: Lr, U: Ur, kvec, roll: phi, bankG: Math.asin(Math.max(-1, Math.min(1, Lr[1]))),
    grade: run > 1e-12 ? T[1] / run : (T[1] > 0 ? Infinity : -Infinity), _R: R, _x: x };
}

// ── BLOCKS AND THE PLACEMENT CHAIN (D177, rigid downstream edits, exact) ──────────────────────────────────────────────
// Every segment is grown ONCE, in its own LOCAL coordinates: from the origin, at heading 0, at its real start pitch p0
// and its start frame R0 expressed in those coordinates. That is a BLOCK: its samples (records), its local end state, its
// sample count. Nothing in a block depends on where the segment is placed or which way it faces, because with the
// world-up curve model T(θ + d, p) is T(θ, p) turned by d about y, and so is the gravity frame's left H(θ + d).
// A block's PLACEMENT is { x, th, s0, seg }: world = x + Ry(th)·local, s = s0 + u. Placements come from ONE CHAIN,
//   x(j) = x(j−1) + Ry(th(j−1))·endL(j−1).x,   th(j) = th(j−1) + endL(j−1).θ,   s0(j) = s0(j−1) + length(j−1),
// and the next block's local start from the previous block alone: p0(j) = endL(j−1).p, and R0(j) = H(0) = (1, 0, 0)
// always (the gravity frame, FRAME), so a block's shape depends on its handles and its start pitch only.
// A full build and an incremental edit run the SAME chain on the SAME floats, so they give BIT-IDENTICAL paths.
//
// RIGID RE-PLACEMENT: when a sculpt leaves a later segment's handles, its p0 and its R0 bit for bit the same, its block
// is kept and only its placement is recomputed by the chain: O(1) per segment, whatever its length. Every block after it
// then keeps its p0 and R0 too (they come from blocks that did not change), so the whole unchanged tail is re-placed.
// Samples are views that read a record through its block's placement (computed on first read, cached per placement),
// so re-placing a block touches none of its samples. A turn about world up leaves every y component alone, so bankG,
// grade and pitch of a re-placed sample are bit-identical to before.
// WHEN IT IS NOT RIGID: a pitch edit (the next block's p0 changes, and under world-up yaw its shape really changes). A
// sculpt regrows the tail's blocks ONE AT A TIME until the next block's local start (p0, R0) is bit for bit its old one,
// and re-places the rest; with the gravity frame R0 is always (1, 0, 0), so that is the first block whose start pitch is
// unchanged. (Under the rotation-minimising frame, D177's first build, R0 also carried the frame's twist, and a turn edit on
// a slope regrew the whole tail.)
const blockKey = (g) => [g.length, g.k0, g.k1, g.kp0, g.kp1, g.roll0, g.roll1, g.heartline].map(num).join(',');
const ry = (v, c, sn) => [c * v[0] + sn * v[2], v[1], c * v[2] - sn * v[0]];
const same3 = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Grow segment g (index gi) as a block, in local coordinates, from pitch p0 and local frame R0. */
function growBlock(g, gi, p0, R0, step, isLast, work) {
  const L = g.length, k0 = num(g.k0), k1 = num(g.k1), q0 = num(g.kp0), q1 = num(g.kp1);
  const thAt = (u) => k0 * u + (k1 - k0) * u * u / (2 * L), pAt = (u) => p0 + q0 * u + (q1 - q0) * u * u / (2 * L);
  let x = [0, 0, 0], T = tangent(0, p0), R = R0.slice();
  const n = Math.max(1, Math.ceil(L / SUB)), h = L / n, sub_ = [{ u: 0, x, T, R }];
  for (let i = 0; i < n; i++) {
    const a = i * h, b = (i === n - 1) ? L : a + h;
    let dx = [0, 0, 0];
    for (const [xi, w] of GL5) { const u = (a + b) / 2 + xi * (b - a) / 2; dx = add(dx, mul(tangent(thAt(u), pAt(u)), w * (b - a) / 2)); }
    const x1 = add(x, dx), T1 = tangent(thAt(b), pAt(b));
    R = [Math.cos(thAt(b)), 0, -Math.sin(thAt(b))]; // the gravity frame's unrolled left (FRAME)
    x = x1; T = T1; sub_.push({ u: b, x, T, R }); work.n++;
  }
  // stations on the segment's OWN grid (multiples of step from its start, so a piece samples the same wherever it is
  // placed): its start (a boundary belongs to the segment it starts), every multiple of step strictly inside, and, for
  // the path's last segment, its end
  const us = [0];
  for (let k = 1; k * step < L - 1e-9; k++) us.push(k * step);
  if (isLast) us.push(L);
  const recs = []; let j = 0;
  for (const u of us) {
    while (j < sub_.length - 2 && sub_[j + 1].u <= u) j++;
    recs.push(sampleAt(g, gi, u, u, 0, p0, sub_[j], sub_[Math.min(j + 1, sub_.length - 1)])); work.n++;
  }
  // the segment's OWN end sample (its own roll1 and heartline), so a piece's mesh never borrows the next piece's frame
  const endRec = sampleAt(g, gi, L, L, 0, p0, sub_[n - 1], sub_[n]); work.n++;
  return { key: blockKey(g), p0, R0: R0.slice(), L, recs, endRec, n: us.length, endL: { x, theta: thAt(L), p: pAt(L), T, R }, pl: null };
}
function placement(x, th, s0, seg) { return { x, th, c: Math.cos(th), sn: Math.sin(th), s0, seg }; }
/** The placement and local start of the block after `blk` (placed at blk.pl), as index gi: the chain step. */
function nextOf(blk, gi) {
  const P = blk.pl, e = blk.endL;
  return { pl: placement(add(P.x, ry(e.x, P.c, P.sn)), P.th + e.theta, P.s0 + blk.L, gi), p0: e.p, R0: [1, 0, 0] };   // local heading 0: H(0)
}
/** The first block's placement and local start, from the path's start { pos, theta, p }. */
function firstOf(start) {
  return { pl: placement(start.pos.slice(), start.theta, 0, 0), p0: start.p, R0: [1, 0, 0] };   // local heading 0: H(0)
}
/** A record seen through a placement: the world sample. */
function placeRec(r, P) {
  const f = (v) => ry(v, P.c, P.sn), pt = (v) => add(P.x, f(v));
  return { s: P.s0 + r.s, seg: P.seg, pos: pt(r.pos), T: f(r.T), L: f(r.L), U: f(r.U), kvec: f(r.kvec), roll: r.roll, bankG: r.bankG, grade: r.grade, _R: f(r._R), _x: pt(r._x) };
}
/** A state { x, theta, p, T, R, s } in world coordinates: a block's start (local origin) or end (endL). */
function worldStart(blk) { const P = blk.pl; return { x: P.x.slice(), theta: P.th, p: blk.p0, T: ry(tangent(0, blk.p0), P.c, P.sn), R: ry(blk.R0, P.c, P.sn), s: P.s0 }; }
function worldEnd(blk) { const P = blk.pl, e = blk.endL; return { x: add(P.x, ry(e.x, P.c, P.sn)), theta: P.th + e.theta, p: e.p, T: ry(e.T, P.c, P.sn), R: ry(e.R, P.c, P.sn), s: P.s0 + blk.L }; }
/**
 * A sample of an OPEN path: a block's record read through the block's current placement, computed on first read after
 * a (re-)placement and cached. It has a grown sample's fields (s, seg, pos, T, L, U, kvec, roll, bankG, grade) as
 * getters, so readers are unchanged; toJSON gives the plain object. Samples are never written to.
 */
class SampleView {
  constructor(rec, blk) { this._r = rec; this._b = blk; this._m = null; this._c = null; }
  get _v() { const P = this._b.pl; if (P !== this._m) { this._m = P; this._c = placeRec(this._r, P); } return this._c; }
  get s() { return this._v.s; } get seg() { return this._v.seg; } get pos() { return this._v.pos; } get T() { return this._v.T; }
  get L() { return this._v.L; } get U() { return this._v.U; } get kvec() { return this._v.kvec; } get roll() { return this._v.roll; }
  get bankG() { return this._v.bankG; } get grade() { return this._v.grade; } get _R() { return this._v._R; } get _x() { return this._v._x; }
  toJSON() { const v = this._v; return { s: v.s, seg: v.seg, pos: v.pos, T: v.T, L: v.L, U: v.U, kvec: v.kvec, roll: v.roll, bankG: v.bankG, grade: v.grade }; }
}
/** Make room for n entries in place of arr[a..b), moving arr[b..] natively (copyWithin: pointer moves, no geometry). */
function resize(arr, a, b, n) {
  const old = arr.length, delta = n - (b - a);
  if (delta > 0) { arr.length = old + delta; arr.copyWithin(b + delta, b, old); }
  else if (delta < 0) { arr.copyWithin(b + delta, b, old); arr.length = old + delta; }
}
/**
 * Grow segments[from..to) as blocks by the chain from `inp` ({ pl, p0, R0 } of block `from`), setting path.blocks,
 * segFirst, starts and segEnd for them and appending their sample views at the end of path.samples. Returns the chain
 * input of block `to`.
 */
function growInto(path, segments, from, to, inp, work) {
  for (let gi = from; gi < to; gi++) {
    const blk = growBlock(segments[gi], gi, inp.p0, inp.R0, path.step, gi === segments.length - 1, work);
    blk.pl = inp.pl;
    path.blocks[gi] = blk; path.segFirst[gi] = path.samples.length; path.starts[gi] = worldStart(blk);
    for (const r of blk.recs) path.samples.push(new SampleView(r, blk));
    path.segEnd[gi] = new SampleView(blk.endRec, blk);
    inp = nextOf(blk, gi + 1);
  }
  return inp;
}
function finish(path, segments, work) {
  const last = path.blocks[path.blocks.length - 1];
  path._end = worldEnd(last); path.lengthM = path._end.s; path._nseg = segments.length; path.work = work.n;
  path.head = buildHead(path);
  return path;
}

/**
 * buildPath(segments, { step = 0.5, closed = false, start }).
 * Stations every `step` metres, plus every segment boundary. On a closed loop the end must meet the start in position
 * (within `closeTol`, default 1e-3 m) and tangent, or it throws: closing the loop is the document's connector's job
 * (ARCHITECTURE §2), not the geometry's.
 */
function buildPath(segments, opts = {}) {
  checkSegments(segments);
  const step = opts.step === undefined ? 0.5 : opts.step;
  if (!(step > 0)) throw new Error('buildPath: step must be positive');
  const closed = !!opts.closed, start = { pos: [0, 0, 0], theta: 0, p: 0, ...(opts.start || {}) };
  const work = { n: 0 }, path = { lengthM: 0, closed, twist: 0, samples: [], step, starts: [], segFirst: [], segEnd: [], blocks: [] };
  growInto(path, segments, 0, segments.length, firstOf(start), work);
  finish(path, segments, work);
  if (closed) {
    // the loop must meet itself in position and tangent; the closing is the document's connector's job (ARCHITECTURE §2).
    // With the gravity frame the frame closes exactly when the heading does, so there is no closing twist to spread
    // (path.twist stays 0; until D177 the rotation-minimising frame's twist was spread over s here)
    const a0 = path.samples[0], b0 = path.samples[path.samples.length - 1], tol = opts.closeTol === undefined ? 1e-3 : opts.closeTol;
    const gap = len(sub(a0._x, b0._x)), tgap = len(sub(a0.T, b0.T));
    if (gap > tol || tgap > 1e-6) throw new Error(`buildPath: closed loop does not close (position ${gap.toExponential(2)} m, tangent ${tgap.toExponential(2)})`);
  }
  return path;
}

/**
 * extendPath(path, segments, fromSeg = path._nseg): grow an OPEN path by segments[fromSeg..], in place.
 * `segments` is the whole list (the old ones plus the new). Only the new ones are read. Returns the same path object.
 * `path.work` becomes the work this call did (substeps + samples), for the cost measure.
 */
function extendPath(path, segments, fromSeg) {
  if (path.closed) throw new Error('extendPath: a closed loop has no open end; rebuild it');
  const from = fromSeg === undefined ? path._nseg : fromSeg;
  if (from !== path._nseg) throw new Error(`extendPath: the path ends after segment ${path._nseg - 1}, cannot grow from ${from}`);
  if (from >= segments.length) throw new Error('extendPath: no new segments');
  checkSegments(segments, from);
  path.samples.pop();                               // the old open end is re-emitted as the new segment's start (the seam)
  const last = path.blocks[from - 1]; last.n--;
  const work = { n: 0 };
  growInto(path, segments, from, segments.length, nextOf(last, from), work);
  return finish(path, segments, work);
}

/**
 * rebuildPathFrom(path, segments, g): SCULPT. Segments[g] (and possibly later ones) changed; everything before g is
 * kept. The CHANGED RANGE is regrown from block g's own start (its placement and local start did not change): from g up
 * to the unchanged TAIL, the longest run of trailing segments whose path handles (blockKey) are the same as before,
 * matched from the end. Then the tail's blocks are regrown ONE AT A TIME until the next one's local start (p0, R0) is
 * bit for bit the one the chain now gives it (see BLOCKS AND THE PLACEMENT CHAIN); from there its blocks are kept and
 * only their placements are recomputed, O(1) each. If none converges, the whole tail is regrown. Either way the result
 * is bit-identical to a full build.
 * `path.work` counts substeps + samples grown + blocks re-placed; `path.replaced` is the number re-placed.
 * A closed loop cannot be sculpted in place: it must still close (the connector's job), so that is a full rebuild.
 */
function rebuildPathFrom(path, segments, g) {
  if (path.closed) throw new Error('rebuildPathFrom: a closed loop is rebuilt in full (its closure is the connector job)');
  if (!(g >= 0 && g < path._nseg && g < segments.length)) throw new Error(`rebuildPathFrom: no segment ${g}`);
  checkSegments(segments, g);
  const oldN = path._nseg, newN = segments.length, work = { n: 0 };
  let eo = oldN, en = newN;                         // the tail: old blocks [eo, oldN) would be new segments [en, newN)
  while (eo - 1 > g && en - 1 > g && path.blocks[eo - 1].key === blockKey(segments[en - 1])) { eo--; en--; }
  const a = path.segFirst[g], tailBlocks = path.blocks.slice(eo, oldN), tailFirst = path.segFirst.slice(eo, oldN);
  // regrow [g, en) on its own (block g's placement and local start are unchanged: the segments before g are the same)
  const fresh = { step: path.step, samples: [], blocks: [], segFirst: [], starts: [], segEnd: [] }, b0 = path.blocks[g];
  let inp = growInto(fresh, segments, g, en, { pl: b0.pl, p0: b0.p0, R0: b0.R0 }, work);
  // then the tail's blocks, one at a time, until the next one's local start is bit for bit its old one
  const same = (t) => t.p0 === inp.p0 && same3(t.R0, inp.R0);
  let k = 0;
  while (k < tailBlocks.length && !same(tailBlocks[k])) { inp = growInto(fresh, segments, en + k, en + k + 1, inp, work); k++; }
  const rigid = k < tailBlocks.length, cut = en + k;
  path.replaced = 0;
  if (rigid) resize(path.samples, a, tailFirst[k], fresh.samples.length);   // the re-placed views stay; one native move shifts them
  else path.samples.length = a;
  for (let i = 0; i < fresh.samples.length; i++) path.samples[a + i] = fresh.samples[i];
  path.blocks.length = g; path.segFirst.length = g; path.starts.length = g; path.segEnd.length = g;
  for (let j = g; j < cut; j++) { path.blocks[j] = fresh.blocks[j]; path.segFirst[j] = a + fresh.segFirst[j]; path.starts[j] = fresh.starts[j]; path.segEnd[j] = fresh.segEnd[j]; }
  if (rigid) {
    let at = a + fresh.samples.length;
    for (let m = k; m < tailBlocks.length; m++) {
      const blk = tailBlocks[m], j = en + m, P = blk.pl, Q = inp.pl;
      // an unchanged placement keeps its object, so the block's views keep their cached world samples
      if (!(same3(P.x, Q.x) && P.th === Q.th && P.s0 === Q.s0 && P.seg === Q.seg)) blk.pl = Q;
      path.blocks[j] = blk; path.segFirst[j] = at; at += blk.n; path.starts[j] = worldStart(blk); path.segEnd[j] = new SampleView(blk.endRec, blk);
      inp = nextOf(blk, j + 1);
      work.n++; path.replaced++;
    }
  }
  return finish(path, segments, work);
}

/** The build head: the open end's frame. The build-view camera sits behind and above it, looking along T. */
function buildHead(path) {
  const e = path.samples[path.samples.length - 1];
  return { s: e.s, seg: e.seg, pos: e.pos.slice(), T: e.T.slice(), L: e.L.slice(), U: e.U.slice() };
}
/** A build-view camera for the head: `back` metres behind along T, `up` metres above along U, looking along T. */
function headCamera(head, { back = 15, up = 6 } = {}) {
  return { eye: add(sub(head.pos, mul(head.T, back)), mul(head.U, up)), look: head.T.slice(), up: head.U.slice(), target: add(head.pos, mul(head.T, back)) };
}

module.exports = { buildPath, extendPath, rebuildPathFrom, buildHead, headCamera, doubleReflect, tangent, rotate, angleAbout, _vec: { add, sub, mul, dot, cross, len, unit } };
