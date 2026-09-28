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
  return { segments, path };
}

module.exports = { toSegments, toPath, profileAt };
