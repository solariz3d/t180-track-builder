// adapter.js: the core's document → the SAME path samples src/geom builds (the spec's GO §6), so the preview, cameras,
// mesh, validation and export are reused unchanged.
//
//   toSegments(doc, { segM = 2, designKmh })   -> src/geom segments (each carries its profile)
//   toPath(doc, { step = 0.5, segM = 2, designKmh }) -> { segments, path }; path = buildPath(segments, { step, closed, start }),
//                                               samples { s, seg, pos, T, L, U, kvec, roll, bankG, grade }
//   profileAt(family, w, r)                    the cross-section at a station (ref 09 §3)
//
// A ROAD piece becomes consecutive segments of at most segM metres. Each is the geometry's own clothoid: heading rate
// k and pitch rate kp run linearly from the channel's values at its two ends, and roll runs between them by the
// geometry's smoothstep (src/geom/path.js "CURVE MODEL"). So between knots the adapter follows the cubic channels by
// chords of segM metres. The error that costs is measured by test/core_adapter.test.js, not assumed (src/core/README.md
// "stated deviation").
// A FLIGHT piece becomes the old jump's two segments, by the same two functions the paused resolver used: the gap solved by
// src/doc/resolve.js solveJump, and the landing ramp sized by src/validate/jumps.js landingRamp at the design speed.
'use strict';

const D = require('./document.js');
const { buildPath } = require('../geom/path.js');
const { FLOORS, AT } = require('../geom/fonts.js');
const { solveJump } = require('../doc/resolve.js');
const jumps = require('../validate/jumps.js');
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

function toSegments(doc, { segM = 2, designKmh = MACH6.designSpeedKmh } = {}) {
  D.checkDoc(doc);
  if (!doc.pieces.length) throw new D.CoreError('EMPTY', 'an empty track has no path');
  if (!(segM > 0)) throw new D.CoreError('BAD_STEP', `segM must be positive, got ${segM}`);
  const segs = []; let pitch = doc.start.pitch, roll = 0, lastProfile = null;
  doc.pieces.forEach((P, pi) => {
    if (P.type === 'flight') {
      const J = solveJump(pitch, P.gap, P.drop, P.land, P.id);
      segs.push({ id: P.id, word: 'core', part: 'gap', kind: 'gap', length: J.L, k0: 0, k1: 0, kp0: J.kp0, kp1: J.kp1, roll0: roll, roll1: roll, heartline: 0, profile: null, blend: null, speed: null });
      const r = jumps.landingRamp({ D: P.gap, dh: -P.drop, thetaRad: pitch, landRad: P.land, v: designKmh / 3.6 });
      segs.push({ id: P.id, word: 'core', part: 'land', kind: 'road', length: r.length / Math.cos(P.land), k0: 0, k1: 0, kp0: 0, kp1: 0, roll0: roll, roll1: roll, heartline: 0, profile: lastProfile, blend: null, speed: null });
      pitch = P.land;
      return;
    }
    const n = Math.max(1, Math.ceil(P.length / segM - 1e-9)), at = (s) => Object.fromEntries(D.CHANNELS.map((ch) => [ch, D.channelAt(P, ch, s).v]));
    let a = at(0);
    if (pi === 0) roll = a.phi;
    for (let j = 0; j < n; j++) {
      const s0 = (P.length * j) / n, s1 = (P.length * (j + 1)) / n, b = at(s1), mid = at((s0 + s1) / 2);
      const profile = profileAt(P.family, mid.w, mid.r);
      segs.push({ id: P.id, word: 'core', part: 'body', kind: 'road', length: s1 - s0, k0: a.kh, k1: b.kh, kp0: a.kv, kp1: b.kv, roll0: a.phi, roll1: b.phi, heartline: 0, profile, blend: null, speed: null });
      pitch += ((a.kv + b.kv) / 2) * (s1 - s0);   // the geometry's pitch: kp linear over the segment (src/geom/path.js)
      a = b; lastProfile = profile;
    }
    roll = a.phi;
  });
  return segs;
}

function toPath(doc, { step = 0.5, segM = 2, designKmh } = {}) {
  const segments = toSegments(doc, { segM, designKmh });
  const path = buildPath(segments, { step, closed: doc.closed, start: { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch } });
  return { segments, path: offsetPath(doc, segments, path) };
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

module.exports = { toSegments, toPath, profileAt, offsetPath };
