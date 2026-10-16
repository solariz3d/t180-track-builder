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
const V = require('../validate/index.js'), { ROLL_AMBER_DEG_M } = V, { MACH6, G } = require('../validate/limits.js');

const DEG = Math.PI / 180, TAU = 2 * Math.PI;
const RADII_M = Object.freeze([300, 450, 650, 200, 900]);   // tried in this order within each route length (first guesses: a T-180 corner at speed; the checker judges the loads)
const MIN_TURN = 0.5 * DEG, MIN_STRAIGHT_M = 10, MIN_TURN_M = 40;
// THE ROLL (ELYSIUM ends upside down, bank −180°, and starts upright): the lap closes only where the bank is the start's, mod 360°, so the finish rolls
// to the nearest such bank (at most 180°), on its LONGEST piece, at no more than the checker's AMBER roll rate (src/validate ROLL_AMBER_DEG_M, 0.93°/m over
// 20 m); a route too short for that is not tried at all
const ROLL_RATE = ROLL_AMBER_DEG_M * DEG, ROLL_FREE = 5 * DEG;
// THE ROLL'S PEAK (2026-10-15, ELYSIUM: "the road rolls too fast" at the roll, 54° over 64 m): the roll eases in and out, so the rate the checker reads over its
// 20 m chord PEAKS at about 1.45 to 1.5 times the average (angle / length), and a roll sized so its AVERAGE was amber read 1.13 to 1.27°/m, past the red bar. So the first
// guess is the average at 1/1.5 of amber, and then the laid roll is MEASURED as the checker measures it (rollPeak) and lengthened until its worst station is under amber
const ROLL_PEAK_OVER_MEAN = 1.5, ROLL_LENGTHEN = 1.03, ROLL_ROUNDS = 6;

// THE CAR MUST STAY ON THE ROAD (2026-10-15, ELYSIUM's newest save: Close "closed" and the checker said "lap FAILS", the car leaving the surface at the new road). Finish judged a route
// by whether Close converged, and Close converges onto roads the car cannot drive: on a road banked 54° the centripetal load of a turn on the wrong side of the bank pulls the car OFF the
// surface (the normal load is negative), and an eased turn is not the circle the route was planned on, so Close bends the new pieces hard to meet the start (a 45 m miss became
// -55 g). So a laid route is (1) RE-AIMED by where its road really ends against the start (the eased turns fall short of the circles) until it ends within REFINE_M, (2) closed,
// and (3) judged by the lap proof's own test on the new road before it is taken: the centreline's normal load with the downforce (fHold, src/validate/index.js), at the ghost
// lap's speed, must be at least 0. A route that fails (3) is skipped, GATE_TRIES of them in a row per order of laying, then the next order: the roll laid FIRST, on its own
// straight at the end, so every turn after it is made upright, where no bank can turn a load away from the road. Nothing that is left is a refusal that says why.
const REFINE_ROUNDS = 4, REFINE_M = 0.3, GATE_TRIES = 2;

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

/** The pose the open track ends at, on the adapter's own path: plan position, heading and pitch (step: the path's sample spacing; the end is its last sample). */
function endPose(doc, step = 0.5) {
  const S = toPath({ ...doc, closed: false }, { step }).path.samples, e = S[S.length - 1], T = e.T;
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

/** The worst roll rate (°/m) on the pieces from index `from` on of a closed document, read as the checker reads it (validate's own rollRates, over its 20 m chord). */
function rollPeak(doc, from) {
  const { segments, path } = toPath(doc, { step: 2 }), S = path.samples, ids = new Set(doc.pieces.slice(from).map((P) => P.id));
  const rates = V._internal.rollRates(S, (i) => segments[S[i].seg].kind !== 'gap', true, path.lengthM).filter((q) => ids.has(segments[S[q.i].seg].id));
  return rates.reduce((m, q) => Math.max(m, q.rate), 0);
}

/**
 * The lowest centreline load, with the car's downforce, on the pieces from index `from` on of a CLOSED document, and where: the lap proof's own test (src/validate/index.js: the
 * station's normal load fN = (kappa . U v^2 + g U_y) / g plus the downforce d v / g, which must be at least 0 or the car leaves the surface), at the speed of the ghost lap.
 * { worst (g), at (m along the lap) }; worst is Infinity when there is no road in them.
 */
function roadHold(doc, from) {
  const { segments, path } = toPath(doc, { step: 2 }), S = path.samples, ids = new Set(doc.pieces.slice(from).map((P) => P.id));
  const sp = V.speedProfile(path, segments, MACH6, { fullSpeed: true }), df = MACH6.downforce ? MACH6.downforce.nPerMps / MACH6.downforce.massKg : 0, vTop = MACH6.vmaxKmh / 3.6;
  let worst = Infinity, at = null;
  for (let i = 0; i < S.length; i++) {
    const g = segments[S[i].seg]; if (g.kind === 'gap' || !ids.has(g.id)) continue;
    const p = S[i], K = p.kvec, U = p.U, v = sp.v ? sp.v[i] : vTop, h = ((K[0] * U[0] + K[1] * U[1] + K[2] * U[2]) * v * v + G * U[1]) / G + (df * v) / G;
    if (h < worst) { worst = h; at = p.s; }
  }
  return { worst, at };
}

function finishToStart(doc, { radii = RADII_M, rollGuess = ROLL_PEAK_OVER_MEAN } = {}) {   // rollGuess: the first guess's factor, for the test that the measured lengthening works from a bad one
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
  const roll0 = rollRad > ROLL_FREE ? { bank, lengthM: Math.ceil((rollRad / ROLL_RATE) * rollGuess) } : null;
  const gap = Math.hypot(doc.start.pos[0] - e.p[0], doc.start.pos[1] - e.y, doc.start.pos[2] - e.p[1]);
  const deg = (a) => Math.round((a / DEG) * 10) / 10, f0 = fwd(th0);
  // One order of laying: 'last' (the roll, if there is one, is the last piece onto the start: the shortest roads) or 'first' (the roll is laid at the end first, on its own straight, and
  // the route runs from the upright end). Returns { result } | { tooFast } (the roll reads too fast: lengthen it and search again) | { fail } (what was refused, and the least bad road the car left).
  const search = (mode, roll) => {
    const first = mode === 'first' && roll, base = first ? extend(doc, { length: roll.lengthM, targets: { kh: 0, kv: 0, phi: roll.bank } }) : doc, laidRoll = first ? null : roll;
    const e1 = first ? endPose(base) : e;
    // the route aims at the start, or, with a roll last, at the point that straight's length behind the start, on the start's heading
    const back = laidRoll ? laidRoll.lengthM : 0, p0 = [doc.start.pos[0] - back * f0[0], doc.start.pos[2] - back * f0[1]];
    // the radii in the order given (the gentler first), and at each radius the shortest route first
    const all = [...oneTurnRoutes(e1.p, e1.th, p0, th0), ...radii.flatMap((R) => routes(e1.p, e1.th, p0, th0, R).sort((a, b) => a.lengthM - b.lengthM))];   // the one-turn routes first (2026-10-15)
    let best = null, left = 0, worstRoad = null;
    for (const r0 of all) {
      let laid, r = r0;
      try {
        laid = lay(base, r, laidRoll);
        // RE-AIM: where the laid road really ends against the start, in plan, moves the aim by that much and the same word is laid again (the eased turns fall short of the circles)
        let aim = p0;
        for (let k = 0; k < REFINE_ROUNDS; k++) {
          const ep = endPose(laid, 5), miss = [ep.p[0] - doc.start.pos[0], ep.p[1] - doc.start.pos[2]];
          if (Math.hypot(miss[0], miss[1]) < REFINE_M) break;
          aim = [aim[0] - miss[0], aim[1] - miss[1]];
          const again = (r0.word.length === 2 ? oneTurnRoutes(e1.p, e1.th, aim, th0) : routes(e1.p, e1.th, aim, th0, r0.radiusM)).find((x) => x.word === r0.word);
          if (!again) break;
          r = again; laid = lay(base, r, laidRoll);
        }
      } catch (err) { if (err.name !== 'CoreError') throw err; best = best || err.message; continue; }
      const window = []; for (let i = doc.pieces.length; i < laid.pieces.length; i++) window.push(i);
      if (!window.length) continue;
      let res;
      try { res = close(laid, { window }); } catch (err) { if (err.name !== 'CoreError') throw err; best = best || err.message; continue; }
      if (!res.converged) { best = best || res.report; continue; }
      const peak = roll ? rollPeak(res.doc, doc.pieces.length) : 0;
      if (peak > ROLL_AMBER_DEG_M) return { tooFast: peak };   // the roll reads too fast as the checker reads it: lengthen it and search again
      const hold = roadHold(res.doc, doc.pieces.length);
      if (hold.worst < 0) {   // the lap proof would fail here: the car leaves the road
        if (!worstRoad || hold.worst > worstRoad.worst) worstRoad = { ...hold, word: r.word, radiusM: r.radiusM };
        best = best || `the car would leave the road at ${(hold.at / 1000).toFixed(2)} km (a load of ${hold.worst.toFixed(0)} g on it)`;
        if (++left >= GATE_TRIES) break;
        continue;
      }
      const added = res.doc.pieces.slice(doc.pieces.length).reduce((a, P) => a + P.length, 0);
      const rolled = roll ? (first ? `, after ${roll.lengthM} m rolling ${Math.round(rollRad / DEG)}° upright first` : `, then ${roll.lengthM} m rolling ${Math.round(rollRad / DEG)}° upright onto the start`) : '';
      const report = `${r.word} at R ${Math.round(r.radiusM)} m: turn ${deg(r.a1)}°, ${Math.round(r.straightM)} m straight, turn ${deg(r.a2)}°${rolled}; ${window.length} new piece${window.length === 1 ? '' : 's'}, ${Math.round(added)} m; ${res.report}`;
      return { result: { doc: res.doc, window, plan: Object.freeze({ word: r.word, radiusM: r.radiusM, turns: [deg(r.a1), deg(r.a2)], straightM: Math.round(r.straightM), rollM: roll ? roll.lengthM : 0, rollFirst: !!first, rollPeakDegM: Math.round(peak * 1000) / 1000, minHoldG: Math.round(hold.worst * 10) / 10, lengthM: Math.round(added), report }) } };
    }
    return { fail: { tried: all.length, best, worstRoad } };
  };
  let fail = null;
  for (const mode of roll0 ? ['last', 'first'] : ['last']) {
    let roll = roll0;
    for (let round = 0; ; round++) {
      const out = search(mode, roll);
      if (out.result) return out.result;
      if (out.tooFast) {
        if (round >= ROLL_ROUNDS) throw new D.CoreError('FINISH_ROLL', `the roll upright onto the start still reads ${out.tooFast.toFixed(3)}°/m (the amber bar is ${ROLL_AMBER_DEG_M}) at ${roll.lengthM} m after ${round + 1} lengthenings`);
        roll = { bank, lengthM: Math.ceil(roll.lengthM * (out.tooFast / ROLL_AMBER_DEG_M) * ROLL_LENGTHEN) };
        continue;
      }
      if (out.fail.worstRoad && (!fail || !fail.worstRoad || out.fail.worstRoad.worst > fail.worstRoad.worst)) fail = out.fail;
      else if (!fail) fail = out.fail;
      break;
    }
  }
  const rollText = roll0 ? ` and must roll ${Math.round(rollRad / DEG)}° to meet it (${roll0.lengthM} m of straight)` : '';
  if (fail.worstRoad) {
    const pitch = e.pitch / DEG, dy = doc.start.pos[1] - e.y;
    throw new D.CoreError('FINISH_LEAVES_ROAD', `no finish keeps the car on the road from here: the closest ones close the loop, but the car would leave the road at ${(fail.worstRoad.at / 1000).toFixed(2)} km (a load of ${fail.worstRoad.worst.toFixed(0)} g on the surface; the best road laid was ${fail.worstRoad.word} at R ${Math.round(fail.worstRoad.radiusM)} m). The end is ${Math.round(gap)} m from the start${rollText}${Math.abs(pitch) > 1 || Math.abs(dy) > 1 ? `, ${Math.abs(dy) > 1 ? `${Math.abs(dy).toFixed(1)} m ${dy > 0 ? 'below' : 'above'} it` : ''}${Math.abs(pitch) > 1 ? `${Math.abs(dy) > 1 ? ' and ' : ' '}pointing ${Math.abs(pitch).toFixed(1)}° ${pitch > 0 ? 'up' : 'down'}` : ''}` : ''}: level and straighten the last pieces, or give the road more room, and try again`);
  }
  throw new D.CoreError('FINISH_NO_ROUTE', `no finish closes from here: the end is ${Math.round(gap)} m from the start${rollText}, and none of the ${fail.tried} routes tried (turn, straight, turn at radius ${radii.join(', ')} m) could be closed${fail.best ? ` (the first refusal: ${fail.best})` : ''}. Extend toward the start and try again`);
}

module.exports = { finishToStart, roadHold, routes, oneTurnRoutes, ONE_TURN_MIN_R, endPose, RADII_M };
