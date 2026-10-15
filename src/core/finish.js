// finish.js: FINISH TO START (the keeper, 2026-10-12, ELYSIUM: "the one thing that comes to my mind as the main problem to me right now is how hard it
// is to align the last turn onto the starting straight by hand"; and to the proposal "Yes"). Close bends the pieces the user built until the end meets the
// start, and on ELYSIUM every window it offers refuses (the last piece cannot reach within 214 m; the last 20 or 40% would roll the road 7.5°/m, six times
// the bar). Finish to start ADDS road instead and moves nothing the user built:
//
//   finishToStart(doc, { radii }) -> { doc, window, plan }   the open document with new pieces appended from its end to its start, CLOSED; `window` the new
//                                                            pieces' indices; `plan` = { word, radiusM, turns: [deg, deg], straightM, lengthM, report }
//
// HOW. In plan view the end and the start are two poses (a point and a heading), and the shortest smooth way between two poses with a turning radius is a
// turn, a straight and a turn (Dubins 1957, the CSC words LSL, RSR, LSR, RSL). Each is laid as the builder lays road: Turn by pieces (exact angles that end
// straight, src/core/turnby.js) and a straight between them, with the climb rate eased to 0. Those pieces only approximate the circles (Turn by eases its
// turn in and out), so the last step is src/core/close.js with ITS WINDOW SET TO THE NEW PIECES ALONE: it bends only them, until the lap closes exactly
// in position, heading, pitch, bank and every channel at the seam, as Close always does. The routes are tried shortest first, at several radii, and the
// first that closes is the answer; a route Close refuses (too tight, too steep, the bank rolling past the bar) is skipped. If none closes, the refusal says
// so by name (FINISH_NO_ROUTE), with how far the end is from the start and the best Close could say.
'use strict';
const D = require('./document.js');
const { toPath } = require('./adapter.js');
const { extend } = require('./extend.js');
const { extendTurnBy } = require('./turnby.js');
const { close, residual } = require('./close.js');
const { ROLL_AMBER_DEG_M } = require('../validate/index.js');

const DEG = Math.PI / 180, TAU = 2 * Math.PI;
const RADII_M = Object.freeze([300, 450, 650, 200, 900]);   // tried in this order within each route length (first guesses: a T-180 corner at speed; the checker judges the loads)
const MIN_TURN = 0.5 * DEG, MIN_STRAIGHT_M = 10, MIN_TURN_M = 40;
// THE ROLL (ELYSIUM ends upside down, bank −180°, and starts upright): the lap closes only where the bank is the start's, mod 360°, so the finish rolls
// to the nearest such bank (at most 180°), on its LONGEST piece, at no more than the checker's AMBER roll rate (src/validate ROLL_AMBER_DEG_M, 0.93°/m over
// 20 m); a route too short for that is not tried at all
const ROLL_RATE = ROLL_AMBER_DEG_M * DEG, ROLL_FREE = 5 * DEG;

const fwd = (th) => [Math.sin(th), Math.cos(th)];   // plan view (x, z): heading about world up, as the geometry's T = (cos p sin θ, sin p, cos p cos θ)
const left = (th) => [Math.cos(th), -Math.sin(th)];   // L = (cos θ, 0, −sin θ)
const mod = (a) => ((a % TAU) + TAU) % TAU;

/** The end of an arc of signed angle a (+ left) and radius R from (p, th). */
function arcEnd(p, th, a, R) {
  const s = Math.sign(a) || 1, l0 = left(th), c = [p[0] + s * R * l0[0], p[1] + s * R * l0[1]], t1 = th + a, l1 = left(t1);
  return { p: [c[0] - s * R * l1[0], c[1] - s * R * l1[1]], th: t1 };
}

/** The four turn-straight-turn routes (with their straight's heading worked out, then checked by laying them out) from pose 1 to pose 0, at radius R. */
function routes(p1, th1, p0, th0, R) {
  const out = [];
  for (const [s1, s2, word] of [[1, 1, 'LSL'], [-1, -1, 'RSR'], [1, -1, 'LSR'], [-1, 1, 'RSL']]) {
    const c1 = [p1[0] + s1 * R * left(th1)[0], p1[1] + s1 * R * left(th1)[1]], c0 = [p0[0] + s2 * R * left(th0)[0], p0[1] + s2 * R * left(th0)[1]];
    const v = [c0[0] - c1[0], c0[1] - c1[1]], dist = Math.hypot(v[0], v[1]), psi = Math.atan2(v[0], v[1]);
    const phis = s1 === s2 ? [psi] : dist > 2 * R ? [psi + Math.asin(2 * R / dist), psi - Math.asin(2 * R / dist)] : [];
    for (const phi of phis) {
      const a1 = s1 * mod(s1 * (phi - th1)), a2 = s2 * mod(s2 * (th0 - phi));
      const e1 = arcEnd(p1, th1, a1 || s1 * 1e-12, R), L = s1 === s2 ? dist : Math.sqrt(Math.max(0, dist * dist - 4 * R * R)), f = fwd(phi);
      const e2 = arcEnd([e1.p[0] + L * f[0], e1.p[1] + L * f[1]], phi, a2 || s2 * 1e-12, R);
      if (Math.hypot(e2.p[0] - p0[0], e2.p[1] - p0[1]) > 1e-6 * Math.max(1, dist)) continue;   // the other tangent of the pair
      out.push({ word, radiusM: R, a1, straightM: L, a2, lengthM: R * (Math.abs(a1) + Math.abs(a2)) + L });
    }
  }
  return out;
}

/**
 * THE ONE-TURN ROUTES (2026-10-15, reported on ELYSIUM: an end 90° off, the start 468 m to its left and 76 m ahead, finished with a 307° right turn, 431 m
 * and a 37° left, 2.3 km, because the routes above come only at fixed radii and none of those fits a quarter turn there). A turn then a straight (CS), or
 * a straight then a turn (SC), with the turn the whole heading change: the end and the start fix the radius and the straight between them, two linear
 * equations (the turn's displacement R·s·(L(θ1) − L(θ0)) plus the straight's L·f equals the gap). Kept when R ≥ ONE_TURN_MIN_R and the straight ≥ 0,
 * shortest first; tried before the fixed radii. The checker judges the corner like any other.
 */
const ONE_TURN_MIN_R = 50;
function oneTurnRoutes(p1, th1, p0, th0) {
  const d = Math.atan2(Math.sin(th0 - th1), Math.cos(th0 - th1));
  if (Math.abs(d) < MIN_TURN) return [];
  const s = Math.sign(d), L1 = left(th1), L0 = left(th0), w = [s * (L1[0] - L0[0]), s * (L1[1] - L0[1])], v = [p0[0] - p1[0], p0[1] - p1[1]], out = [];
  for (const [word, dir] of [['CS', fwd(th0)], ['SC', fwd(th1)]]) {
    const det = w[0] * dir[1] - w[1] * dir[0]; if (Math.abs(det) < 1e-12) continue;
    const R = (v[0] * dir[1] - v[1] * dir[0]) / det, L = (w[0] * v[1] - w[1] * v[0]) / det;
    if (!(R >= ONE_TURN_MIN_R) || !(L >= 0)) continue;
    out.push({ word, radiusM: R, a1: word === 'CS' ? d : 0, straightM: L, a2: word === 'SC' ? d : 0, lengthM: R * Math.abs(d) + L });
  }
  return out.sort((a, b) => a.lengthM - b.lengthM);
}

/** The pose the open track ends at, on the adapter's own path: plan position, heading and pitch. */
function endPose(doc) {
  const S = toPath({ ...doc, closed: false }).path.samples, e = S[S.length - 1], T = e.T;
  return { p: [e.pos[0], e.pos[2]], y: e.pos[1], th: Math.atan2(T[0], T[2]), pitch: Math.asin(Math.max(-1, Math.min(1, T[1]))) };
}

/** The route's pieces appended to doc: Turn by, the straight, Turn by (each left out when it is next to nothing), the climb rate eased to 0; then, when the
 *  bank must come round, a straight of rollM metres that rolls to `bank` (radians) onto the start. A ROLL IS NEVER LAID IN A TURN: rolled in the turn of
 *  the first try on ELYSIUM, the road met the car with no speed that holds it (the checker's red "no speed holds") for 480 m. */
function lay(doc, r, roll) {
  let d = doc;
  // NOT mirrored in the flipped frame (corrected 2026-10-15): there the heading is only OFFSET by π (T = (−sin θ, 0, −cos θ) at pitch π), so a turn of the
  // heading channel turns the road the same way; only the PITCH reverses (close.js residual). Mirroring the turns sent ELYSIUM's quarter turn the wrong way
  const turn = (a) => { if (Math.abs(a) >= MIN_TURN) d = extendTurnBy(d, { length: Math.max(MIN_TURN_M, Math.round(r.radiusM * Math.abs(a))), targets: { kv: 0 } }, a); };
  turn(r.a1);
  if (r.straightM >= MIN_STRAIGHT_M) d = extend(d, { length: Math.round(r.straightM), targets: { kh: 0, kv: 0 } });
  turn(r.a2);
  if (roll) d = extend(d, { length: roll.lengthM, targets: { kh: 0, kv: 0, phi: roll.bank } });
  return d;
}

function finishToStart(doc, { radii = RADII_M } = {}) {
  D.checkDoc(doc);
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is already closed: there is no end to finish from');
  const last = doc.pieces[doc.pieces.length - 1];
  if (!last) throw new D.CoreError('EMPTY', 'there is no track to finish yet: extend first');
  if (last.type !== 'road') throw new D.CoreError('FINISH_FROM_FLIGHT', 'the track ends in the air (a jump with no landing): place the landing first, then finish');
  if (doc.pieces[0].type !== 'road') throw new D.CoreError('NO_START_STRAIGHT', 'the track has no first road piece to finish onto');
  const e = endPose(doc), th0 = doc.start.heading;
  // THE BANK: the lap closes where the bank is the start's, mod 360°, so the finish rolls to the one nearest the end's (at most 180°); more than a few
  // degrees is rolled on a straight of its own onto the start, at no more than the amber rate (Close mends a few degrees in passing)
  // THE FLIPPED FRAME (2026-10-14, ELYSIUM): over the top of a loop the end is carried as (heading + 180°, 180° − pitch, bank + 180°), the same orientation
  // written the other way, so an end at bank −180° there is UPRIGHT; the finish rolled it 180° (upside down). Its target bank
  // is the start's plus 180° in that form (its turns are NOT mirrored: lay)
  const flip = residual(doc).flip, half = flip ? Math.PI : 0;
  const b0 = D.valuesAt(doc.pieces[0], 0).phi, b1 = D.valuesAt(last, last.length).phi, bank = b0 + half + TAU * Math.round((b1 - b0 - half) / TAU), rollRad = Math.abs(bank - b1);
  const roll = rollRad > ROLL_FREE ? { bank, lengthM: Math.ceil((rollRad / ROLL_RATE) * 1.1) } : null;
  // the route aims at the start, or, with a roll, at the point that straight's length behind the start, on the start's heading
  const f0 = fwd(th0), back = roll ? roll.lengthM : 0, p0 = [doc.start.pos[0] - back * f0[0], doc.start.pos[2] - back * f0[1]];
  const gap = Math.hypot(doc.start.pos[0] - e.p[0], doc.start.pos[1] - e.y, doc.start.pos[2] - e.p[1]);
  // the radii in the order given (the gentler first), and at each radius the shortest route first
  const all = [...oneTurnRoutes(e.p, e.th, p0, th0), ...radii.flatMap((R) => routes(e.p, e.th, p0, th0, R).sort((a, b) => a.lengthM - b.lengthM))];   // the one-turn routes first (2026-10-15)
  let best = null;
  for (const r of all) {
    let laid;
    try { laid = lay(doc, r, roll); } catch (err) { if (err.name !== 'CoreError') throw err; best = best || err.message; continue; }
    const window = []; for (let i = doc.pieces.length; i < laid.pieces.length; i++) window.push(i);
    if (!window.length) continue;
    let res;
    try { res = close(laid, { window }); } catch (err) { if (err.name !== 'CoreError') throw err; best = best || err.message; continue; }
    if (!res.converged) { best = best || res.report; continue; }
    const deg = (a) => Math.round((a / DEG) * 10) / 10, added = res.doc.pieces.slice(doc.pieces.length).reduce((a, P) => a + P.length, 0);
    const rolled = roll ? `, then ${roll.lengthM} m rolling ${Math.round(rollRad / DEG)}° upright onto the start` : '';
    const report = `${r.word} at R ${Math.round(r.radiusM)} m: turn ${deg(r.a1)}°, ${Math.round(r.straightM)} m straight, turn ${deg(r.a2)}°${rolled}; ${window.length} new piece${window.length === 1 ? '' : 's'}, ${Math.round(added)} m; ${res.report}`;
    return { doc: res.doc, window, plan: Object.freeze({ word: r.word, radiusM: r.radiusM, turns: [deg(r.a1), deg(r.a2)], straightM: Math.round(r.straightM), rollM: roll ? roll.lengthM : 0, lengthM: Math.round(added), report }) };
  }
  throw new D.CoreError('FINISH_NO_ROUTE', `no finish closes from here: the end is ${Math.round(gap)} m from the start${roll ? ` and must roll ${Math.round(rollRad / DEG)}° to meet it (${roll.lengthM} m of straight)` : ''}, and none of the ${all.length} routes tried (turn, straight, turn at radius ${radii.join(', ')} m) could be closed${best ? ` (the first refusal: ${best})` : ''}. Extend toward the start and try again`);
}

module.exports = { finishToStart, routes, oneTurnRoutes, ONE_TURN_MIN_R, endPose, RADII_M };
