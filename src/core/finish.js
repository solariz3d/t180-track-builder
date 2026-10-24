// finish.js: FINISH TO START (the keeper, 2026-10-12, ELYSIUM: "the one thing that comes to my mind as the main problem to me right now is how hard it
// is to align the last turn onto the starting straight by hand"; and to the proposal "Yes"). Close bends the pieces the user built until the end meets the
// start, and on ELYSIUM every window it offers refuses (the last piece cannot reach within 214 m; the last 20 or 40% would roll the road 7.5°/m, six times
// the bar). Finish to start ADDS road instead and moves nothing the user built:
//
//   finishToStart(doc, { radii }) -> { doc, window, plan }   the open document with new pieces appended from its end to its start, CLOSED; `window` the new
//                                                            pieces' indices; `plan` = { word, radiusM, turns: [deg, deg], straightM, lengthM, report }
//                                                            An end already at the start (NEAR_M, NEAR_RAD) adds no road: `window` is the user's last pieces, bent, and `plan.word` is 'BEND'
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

// THE END ALREADY AT THE START (D337, 2026-10-16, reported on ELYSIUM: the end was built by hand to 0.105 m from the start, 0.1° of heading and 2.7° of pitch off,
// and Finish laid 2.2 km of new road in a full circle). The routes join two poses with turns of a fixed radius, and between two poses that almost coincide every
// such route turns 360°. So an end within NEAR_M of the start, with its heading, pitch and bank each within NEAR_RAD of the start's (close.js residual, the
// flipped frame included), is closed by the SMALLEST change: Close with its window the shortest stretch of the last pieces that closes (THE WINDOW), and no new road. NEAR_RAD is
// ROLL_FREE, the few degrees Close mends in passing. NEAR_M (chosen): 1 m, under a thirtieth of the narrowest road this corpus measures wide (35 m) and well inside
// what the last pieces absorb. The bent road is held to the lap proof's own test
// (roadHold) like any finish; if the bend cannot close, or the car would leave the road, it is refused by name, never answered with a loop.
// THE WINDOW: the last road piece alone first, then the last two, and so on to NEAR_PIECES, and the first that closes with the car on the road is taken: the
// smallest stretch that can absorb the gap. On ELYSIUM the last piece alone gets no closer than 0.062 m (its start is held to the piece before it, and the 2.7° of
// pitch has to come out somewhere), and the last two close, moving them about 4 m at most: that is the pitch, not the 0.105 m, turned out over 508 m. Three pieces
// move 5.7 m, four 7.1 m, so the smallest window is also the smallest move.
// NEAR_ITER: a window that will close does so in a couple of steps (2 on ELYSIUM, every window); one that will not would run Close's 30, about 40 s on a 25 km
// track, before the next window is tried. 6 is three times what a closing window took.
const NEAR_M = 1, NEAR_RAD = ROLL_FREE, NEAR_PIECES = 6, NEAR_ITER = 6;

// THE END STRAIGHT BEHIND THE START (D357; B's find at D339: ends 8, 20 and 40 m behind the start, on its line and pointing the same way, were finished with a 360°
// loop, 1885, 1905 and 1925 m at R 300). routes() gives the plain straight first (both turns 0), but two things lost it:
//   · Close cannot bend a LONE STRAIGHT: at zero curvature nothing in it changes the length along the road (bending its knots moves the end sideways and up,
//     not forward), so its equations are singular and it refuses, or wanders off, though the straight already meets the start to a hundredth of a millimetre;
//     the next route, a full circle, closes. So when Close refuses a laid road, and the road AS LAID already meets the start within
//     Close's own bars (MET_M, the closed path's 1 mm, as close.js tolM; and MET_TOL on every other row Close solves, the heading, pitch, bank and each joined
//     channel's value and slope at the seam), it is taken as laid: there is nothing to bend. Close is still tried first, so a route it closes is unchanged.
//     MET_TOL (chosen): 1e-6, a seam kink of 0.00006°, against Close's 1e-9; the straights here meet to 1.3e-8 rad (the user's own Turn by pieces' heading)
//   · a straight under MIN_STRAIGHT_M (10 m) was never laid, so at 8 m the route laid nothing at all. A route with no turn is laid whatever its length from
//     MIN_STRAIGHT_ALONE_M (NEAR_M: an end nearer than that is the bend above), and at its exact length, since nothing else in it can take up a rounded metre
const MET_M = 1e-3, MET_TOL = 1e-6, MIN_STRAIGHT_ALONE_M = NEAR_M;
const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };

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
  const alone = Math.abs(r.a1) < MIN_TURN && Math.abs(r.a2) < MIN_TURN;   // D357: a route that is only a straight
  if (r.straightM >= MIN_STRAIGHT_M && !alone) d = extend(d, { length: Math.round(r.straightM), targets: { kh: 0, kv: 0 } });
  else if (alone && r.straightM >= MIN_STRAIGHT_ALONE_M) d = extend(d, { length: r.straightM, targets: { kh: 0, kv: 0 } });
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

/** D439: the peak side load (g) at the design speed on the pieces from index `from` on of a closed document: the validator's f = v²κ⃗ + g·ŷ across the road (the
 *  centreline, every station on road), as core_finish_bank's lean() reads it. D440: and how many of its CURVED stations lean OUT of the curve by more than
 *  LEAN_OUT_DEG (core_finish_bank's lean(), the bar D434 ruled: "no curved station leaning out by more than 5°"), of how many.
 *  D443 (plan_d438 "D443 ruled from O's side"): the lean is read against the HORIZONTAL turn, asin(U·κ̂h), κh = κ less its world-up part, and a station is curved
 *  where |κh| > 1/600 m. Read over the 3-D κ, a crest under a bend tilts κ̂ downward and reads as a lean OUT where the road leans INTO its turn: on P's five
 *  pitched laps every station so counted leaned in by +10.6° to +24.7°, and rule 1 took roads up to 3.2× longer (exo_memory/handback/p-d443-O_2026-10-23.md).
 *  Whether a crest alone could count is a COUNT, not a bound (D444, P's review of D443 §1.2): on a closed lap roadHold reads the ghost lap's speed, not the
 *  design speed, so crests tighter than R 1,665 m do hold (one of R 555 m held at 0.9 g). On 141 closed laps (P's tight 108, pitched 16 and steep 17) the
 *  stations with |κ| over 1/600 m but |κh| under it were 1–27 on 33 laps, and the horizontal lean read none of them out. */
const LEAN_OUT_DEG = 5;
function closerLoad(doc, from) {
  const { segments, path } = toPath(doc, { step: 2 }), ids = new Set(doc.pieces.slice(from).map((P) => P.id)), v = V_DESIGN;
  let side = 0, out = 0, curved = 0;
  for (const q of path.samples) {
    const g = segments[q.seg]; if (g.kind === 'gap' || !ids.has(g.id)) continue; const k = q.kvec;
    side = Math.max(side, Math.abs((v * v * k[0] * q.L[0] + (v * v * k[1] + G) * q.L[1] + v * v * k[2] * q.L[2]) / G));
    const kh = Math.hypot(k[0], k[2]); if (kh < 1 / 600) continue;   // the horizontal turn (D443)
    curved++; if (Math.asin(Math.max(-1, Math.min(1, (q.U[0] * k[0] + q.U[2] * k[2]) / kh))) < -LEAN_OUT_DEG * DEG) out++;
  }
  return { side, out, curved };
}

// D434 (the user, 2026-10-22, TEST TRACK 10: "there needs to be a nuance for banking in large curves like that to support the car better"; the librarian's ruling,
// plan_d434 "Part 2 ruled"): THE FINISH BANKS THE CURVES IT MAKES. Its turns were laid flat: on TEST TRACK 10 the closer leaned −0.9° on average, 453 curved stations
// leaning out, and the side load at the design speed reached 10.68 g. Each new piece is banked by BANK_SHARE of the balance bank at the validator's design speed,
// −atan(v²·k/g) (the sign measured in the normal and the flipped frame, exo_memory/handback/p-d434-O_2026-10-22.md §2; 0.75 leaned TEST TRACK 10's closer as the
// user's own hand bank before it does, 53.8° against 53.2°), so a gentle curve gets its small share and a straight none. The bank follows the curvature, so it
// eases in with the curve, and it is RATE-LIMITED: at 460 km/h the balance bank is steepest near a straight (atan's slope is largest at 0), so a curve that eases
// out in a knot or two would roll the road several degrees a metre (TEST TRACK 10's last turn into the seam: 2.19°/m at 0.75). The bank's control points along the
// window, in lap order through the joints, are pinned to the laid bank at every joint (each piece's first two and last two points), and then limited, forward and
// backward, to BANK_ROLL of the amber per metre of their Greville spacing; a cubic B-spline's slope is bounded by its control polygon's, so the bank's own roll is
// too. A later piece's second point is set by the joint's slope rule, so every joint stays C1. It is sized from the CLOSED route's curvature: bank by the laid
// route's, close, swap that bank for the closed route's, close again (the bank row). Bank rolls the road about its centreline and does not move it, so the closure
// is the same. A backstop: if the road still rolls past the amber on the window, the share is scaled down.
const BANK_SHARE = 0.75, BANK_TRIES = 3, BANK_ROLL = 0.9, V_DESIGN = MACH6.designSpeedKmh / 3.6;
// D438 (the user, 2026-10-22 21:33: "where the pieces connect there is too big of a bump"; plan_d438 "Part 2 ruled"): the rate limit bounded how fast the bank
// turned but not how suddenly that rate started, so at each pinned joint the roll rate jumped from 0 to the cap in one knot, felt 8.4 m out as a step in the
// surface's vertical curvature (95.9 °/100 m at TEST TRACK 10's p41|p42, against 21.7 at his own joints' 90th percentile). BANK_ACCEL bounds the change of the
// control polygon's slope per metre (rad/m²): at a C1 joint the outer-wheel step is about 8.4 m · 2·BANK_ACCEL, so 21.7 °/100 m (0.00379 /m) allows 2.26e-4.
// It acts on the added bank, like the rate limit: the pins already keep it off any roll the route lays (a roll straight is not banked), so bounding the total
// instead changed nothing on any track measured, and was removed (D438 J3/J10, exo_memory/handback/p-d438-build-O_2026-10-22.md §4).
const BANK_ACCEL = 2e-4, BANK_SWEEPS = 400, ROLL_ACCEL_FIT = 1.5;
const bankOf = (k, share) => -share * Math.atan((V_DESIGN * V_DESIGN * k) / G);
/**
 * The bank to add to each control point of each road piece of `window` ([p] → array, 0 outside), from kFrom's curvature: pinned at the window's ends, rate-limited.
 * Only a piece laid UPRIGHT is banked: its laid bank within ROLL_FREE of `upright` (the bank the lap closes to, the start's, finishToStart's `bank`). A turn laid on
 * the user's own bank (a roll laid LAST, after the turns) keeps it: the bank is a lean into the curve against gravity, and rolling the road upright inside the turn
 * is what finish.js never does (lay: "a roll is never laid in a turn"); such a route is judged as it was laid, and the roll-first order banks its upright turns.
 */
function bankPlan(kFrom, window, share, uprightSet, relax = () => false, { flips = false, rollScale = 1 } = {}) {
  const road = window.filter((p) => kFrom.pieces[p].type === 'road'), rate = (rollScale * BANK_ROLL * ROLL_AMBER_DEG_M * Math.PI) / 180, seq = [];
  let s0 = 0; const startOf = new Map(); kFrom.pieces.forEach((P, p) => { startOf.set(p, s0); s0 += P.length || 0; });
  road.forEach((p, j) => {
    const P = kFrom.pieces[p], U = D.knotVector(P), n = P.channels.kh.length, linked = j > 0 && road[j - 1] === p - 1, nextLinked = road[j + 1] === p + 1;
    const up = uprightSet.has(p);
    // pinned: each piece's first two and last two points keep the laid bank (the ruling: meet the laid bank at EVERY joint, so a straight between turns gets none).
    // D447 (d): a joint `relax` names (two curved upright pieces, bankLap) is not pinned: its points are banked and limited like any other, and the later piece's
    // second point, like its first, follows the joint (the slope rule below), so a curve laid as several pieces banks as one
    const freeIn = linked && relax(p), freeOut = nextLinked && relax(p + 1);
    for (let i = linked ? (freeIn ? 2 : 1) : 0; i < n; i++) { const pinned = (i < 2 && !freeIn) || (i > n - 3 && !freeOut); seq.push({ p, i, s: startOf.get(p) + (U[i + 1] + U[i + 2] + U[i + 3]) / 3, t: up && !pinned ? bankOf(P.channels.kh[i], share) : 0, pinned, kh: P.channels.kh[i] }); }
  });
  // D447, P's review finding 1 (bankLap only, `flips`): WHERE THE TURN FLIPS (the stored turn rate changes sign between two points that both turn, |kh| over
  // CURVED_KH), every point from the last turning point before the flip to the first after it is pinned at no added bank, as at a straight. The bank then comes
  // down to none before the flip and rolls up again after it, inside BANK_ROLL and BANK_ACCEL, instead of lagging through it the wrong way (a Sharp corner after
  // a turn that ends still turning flips +1/300 to −1/150 in 4 m: the lagging bank leaned 43 stations out by up to 58°)
  const eased = new Set();
  // D447, P's re-read (lighthouse 75fa8491 §6.3): the flips are FOUND ON THE ROAD (flipsOf: the turn rate sampled every 2 m), not on these control points 20 m
  // apart, where one point in the dead band between the two signs hid a flip of 40–100 m. Every point inside a flip's stretch, and the nearest on either side, is
  // pinned (`flips` is that list of stretches, [s0, s1] in metres along the lap)
  if (flips) for (const [a, b] of flips) {
    let lo = -1, hi = -1; for (let k = 0; k < seq.length; k++) { if (seq[k].s < a) lo = k; else if (seq[k].s > b && hi < 0) hi = k; }
    for (let k = Math.max(0, lo); k <= (hi < 0 ? seq.length - 1 : hi); k++) { seq[k].t = 0; seq[k].pinned = true; eased.add(seq[k].p); }
  }
  // the pinned points stay where they are in both passes (a pass that moved them would undo the pin: the close would then meet the seam's bank row in one knot)
  for (let k = 1; k < seq.length; k++) { if (seq[k].pinned) continue; const d = rate * (seq[k].s - seq[k - 1].s); seq[k].t = Math.max(seq[k - 1].t - d, Math.min(seq[k - 1].t + d, seq[k].t)); }
  for (let k = seq.length - 2; k >= 0; k--) { if (seq[k].pinned) continue; const d = rate * (seq[k + 1].s - seq[k].s); seq[k].t = Math.max(seq[k + 1].t - d, Math.min(seq[k + 1].t + d, seq[k].t)); }
  // D438: THE ROLL'S ACCELERATION. Each three neighbours' slope change, |(b₊ − b)/d₁ − (b − b₋)/d₀| ≤ BANK_ACCEL·(d₀ + d₁)/2, and each span's rate above, are
  // convex sets; the free points are projected onto each in turn, sweep after sweep (alternating projections), the pins never moved. Where the pins themselves
  // break a bound (two pinned spans meeting) nothing can move and it is left as laid.
  for (let sweep = 0; sweep < BANK_SWEEPS; sweep++) {
    let worst = 0;
    for (let k = 1; k + 1 < seq.length; k++) {
      const a = seq[k - 1], m = seq[k], c = seq[k + 1], d0 = m.s - a.s, d1 = c.s - m.s; if (!(d0 > 0 && d1 > 0)) continue;
      const g = (c.t - m.t) / d1 - (m.t - a.t) / d0, lim = (BANK_ACCEL * (d0 + d1)) / 2, over = Math.abs(g) - lim;
      if (over <= 0) continue;
      const co = [[a, 1 / d0], [m, -1 / d0 - 1 / d1], [c, 1 / d1]].filter(([x]) => !x.pinned), nn = co.reduce((q, [, w]) => q + w * w, 0); if (!nn) continue;
      worst = Math.max(worst, over); const f = (Math.sign(g) * over) / nn; for (const [x, w] of co) x.t -= f * w;
    }
    for (let k = 1; k < seq.length; k++) {
      const a = seq[k - 1], c = seq[k], over = Math.abs(c.t - a.t) - rate * (c.s - a.s); if (over <= 1e-12) continue;
      const free = [a, c].filter((x) => !x.pinned); if (!free.length) continue;
      const sg = Math.sign(c.t - a.t); worst = Math.max(worst, over / (c.s - a.s));
      if (free.length === 2) { a.t += (sg * over) / 2; c.t -= (sg * over) / 2; } else if (free[0] === c) c.t -= sg * over; else a.t += sg * over;
    }
    if (worst < 1e-9) break;
  }
  const plan = new Map(road.map((p) => [p, new Array(kFrom.pieces[p].channels.kh.length).fill(0)]));
  for (const x of seq) plan.get(x.p)[x.i] = x.t;
  road.forEach((p, j) => { if (j > 0 && road[j - 1] === p - 1) { const A = plan.get(p - 1), B = plan.get(p), Pa = kFrom.pieces[p - 1], Pb = kFrom.pieces[p], na = A.length;
    const hA = Pa.length - (Pa.knots.length ? Pa.knots[Pa.knots.length - 1] : 0), hB = Pb.knots.length ? Pb.knots[0] : Pb.length; B[0] = A[na - 1]; B[1] = B[0] + (hB / hA) * (A[na - 1] - A[na - 2]); } });
  plan.eased = eased;
  return plan;
}
/** doc with plan added to each planned piece's bank, less (when given) the plan `minus` added before. */
function banked(doc, plan, minus = null) {
  return D.checkDoc({ ...doc, pieces: doc.pieces.map((P, p) => (!plan.has(p) ? P : { ...P, channels: { ...P.channels, phi: P.channels.phi.map((ph, i) => ph + plan.get(p)[i] - (minus ? minus.get(p)[i] : 0)) } })) });
}
/**
 * D438 (the user, 2026-10-22: "how the banking and cupping connects to the end of the track doesnt work right"): THE CUP COMES HOME OVER THE CLOSER. The new
 * road carried the end's cup to the start line and left the seam's cup row to pull it to p1's in the last 30–40 m (37.3° → 10° on TEST TRACK 10, 0.54–1.38 °/m,
 * where his own road never changes its cup faster than CUP_RATE_DEG_M, 0.021 °/m). Here the laid route's cup is moved by Δ·σ along the window (LINEAR, the
 * slowest a closer of that length allows), σ by each control point's Greville position over the window's length, Δ = p1's first cup less the laid end's: the
 * cup then reaches p1's at the start line, so the seam row has nothing left to do and the bank's return at the seam is no longer on top of it. (A smootherstep
 * ease was built first: its peak, 1.875·Δ/length, went over 0.021 on 14 of P's 45 short closers, exo_memory/handback/p-d438-review-P_2026-10-22.md §2 (a); the
 * joints read within 0.2 °/100 m of it.) Where even Δ/length is over CUP_RATE_DEG_M the closer is too short to do better: the cup still comes home, and
 * finishToStart's report states the rate (cupPeak). Only when every road piece of the window and p1 are cup pieces (a cup meets a legacy piece by its rendered edge, close.js heldCup).
 * A joint keeps the slope rule (a later piece's second point by the link rule), as bankPlan's does.
 */
function cupHome(laid, window) {
  const road = window.filter((p) => laid.pieces[p].type === 'road'), F = laid.pieces[0];
  if (!road.length || !F.cup || !road.every((p) => laid.pieces[p].cup)) return laid;
  const last = laid.pieces[road[road.length - 1]], delta = F.channels.c[0] - D.pieceEnd(last).c.v;
  if (!(Math.abs(delta) > 1e-9)) return laid;
  let s0 = 0; const startOf = new Map(); laid.pieces.forEach((P, p) => { startOf.set(p, s0); s0 += P.length || 0; });
  // D439 (d) (P's review of D438 (a) §5): σ = (ξ − ξ₁)/(z − ξ₁), from the first piece's SECOND Greville abscissa ξ₁ (the last point held for his last joint) to
  // the last piece's SECOND-TO-LAST one z (the first of the two points that sit at p1's cup, so where p1 starts flat the seam's C1 row has nothing to do). Every
  // span between then runs at Δ/(z − ξ₁), and the held points lie on the line (σ ≤ 0 or ≥ 1 there). Measured from the window's start, the third point already
  // carried Δ·ξ₂/L while the first two were held, so the first free span ran at 1.5 × Δ/L and the lap read 1.27–1.30 × (three laps with Δ/L under 0.021
  // printed the fallback note); ended at the start line, the seam row flattened the last span and the one before ran at 1.53 × (row 7's lap).
  const U0 = D.knotVector(laid.pieces[road[0]]), a = startOf.get(road[0]) + (U0[2] + U0[3] + U0[4]) / 3, UL = D.knotVector(last), nl = last.channels.c.length, z = startOf.get(road[road.length - 1]) + (UL[nl - 1] + UL[nl] + UL[nl + 1]) / 3, ease = (x) => Math.max(0, Math.min(1, x));
  const cs = new Map(road.map((p) => { const P = laid.pieces[p], U = D.knotVector(P); return [p, P.channels.c.map((c, i) => (p === road[0] && i < 2 ? c : c + delta * ease((startOf.get(p) + (U[i + 1] + U[i + 2] + U[i + 3]) / 3 - a) / (z - a))))]; }));
  // the joint slope rule GUARDS C1 BY CONSTRUCTION: under the linear ease it rewrites each joint's two points with the values they already have (a linear
  // function sampled at the Greville abscissae is reproduced exactly), and it keeps every joint C1 should the ease ever stop being linear (D438 J8, ruled keep)
  road.forEach((p, j) => { if (j > 0 && road[j - 1] === p - 1) { const A = cs.get(p - 1), B = cs.get(p), Pa = laid.pieces[p - 1], Pb = laid.pieces[p], na = A.length;
    const hA = Pa.length - (Pa.knots.length ? Pa.knots[Pa.knots.length - 1] : 0), hB = Pb.knots.length ? Pb.knots[0] : Pb.length; B[0] = A[na - 1]; B[1] = B[0] + (hB / hA) * (A[na - 1] - A[na - 2]); } });
  return D.checkDoc({ ...laid, pieces: laid.pieces.map((P, p) => (cs.has(p) ? { ...P, channels: { ...P.channels, c: cs.get(p) } } : P)) });
}
/** D438: the fastest the cup changes (°/m, read every metre) on the cup pieces from index `from` on; 0 when none is a cup piece. */
const CUP_RATE_DEG_M = 0.021;
function cupPeak(doc, from) {
  let worst = 0;
  for (const P of doc.pieces.slice(from)) { if (P.type !== 'road' || !P.cup) continue; let prev = D.valuesAt(P, 0).c; for (let s = 1; s <= P.length; s++) { const c = D.valuesAt(P, Math.min(s, P.length)).c; worst = Math.max(worst, Math.abs(c - prev)); prev = c; } }
  return worst;
}
/** The worst roll rate on the window's pieces, read as the checker reads it (validate's rollRates, its 20 m chord). */
function bankRollPeak(doc, window) {
  const { segments, path } = toPath(doc, { step: 2 }), S = path.samples, ids = new Set(window.map((p) => doc.pieces[p].id));
  return V._internal.rollRates(S, (i) => segments[S[i].seg].kind !== 'gap', !!doc.closed, path.lengthM).filter((q) => ids.has(segments[S[q.i].seg].id)).reduce((m, q) => Math.max(m, q.rate), 0);
}
/**
 * D447 (the user, 2026-10-23: "closing a loop should bank"; "all closed loops after if the turns and curves need to be banked, so its not just fixing the one
 * section of the track itself, it is the closed loop generator gaining the nuance"; plan_d447): THE CLOSED LAP BANKED, not only the road Finish adds. Every
 * UPRIGHT road piece of a closed lap (every bank point within ROLL_FREE of the start's) is banked by BANK_SHARE of the balance bank at the design speed, through
 * bankPlan: its rate (BANK_ROLL) and acceleration (BANK_ACCEL) limits, C1 at every joint, and the share scaled down while the lap rolls past the amber.
 * Not banked: a piece he banked or rolled himself (a bank point past ROLL_FREE: his bank stays byte for byte, and the joints into it keep it), a piece that is
 * not LEVEL (the road's up within LEVEL_DEG of the world's at every station: a loop, its way in and out, a steep ramp; measured on TEST TRACK 10's copy, the
 * loop's exit stores a bank of 0 at a pitch of −90° to −15° and was banked by 54° before this), a tube, a piece that is not road, and the road a pit lane runs
 * beside (its leave anchor's piece to its rejoin's). Finish's own banked pieces are not upright, so they stay as
 * Finish banked them. JOINTS (D447 (d), O's call): where two upright pieces that both curve meet, the joint is not pinned, so a curve laid as several pieces
 * banks as one; a joint next to a straight, a piece not banked, or the start line (the seam: p1 and the last piece keep the start's bank there) stays pinned.
 * The bank rolls the road about its centre line, so the closed lap stays closed. A backstop: if the banked lap would lean out of a curve (closerLoad, the
 * horizontal turn) at more stations than the lap as closed, the lap is returned as closed. Returns the document (the same object when nothing is banked).
 */
const CURVED_KH = 1 / 600, LEVEL_DEG = 30, WITHHOLD_ROUNDS = 3, FLIP_STEP_M = 2, FLIP_STRAIGHT_M = 60;
function pitPieces(doc) {
  const lane = doc.pitLane, at = (a) => (a ? doc.pieces.findIndex((P) => P.id === a.word) : -1); if (!lane) return new Set();
  const a = at(lane.leave), b = at(lane.rejoin), out = new Set(); if (a < 0 || b < 0) return out;
  for (let p = a; ; p = (p + 1) % doc.pieces.length) { out.add(p); if (p === b || out.size > doc.pieces.length) break; }
  return out;
}
/**
 * D447 (P's re-read): THE FLIPS of a lap, as stretches [s0, s1] in metres along it: the stored turn rate kh sampled every FLIP_STEP_M on every road piece; a flip
 * runs from the last turning sample (|kh| > CURVED_KH) of one sign to the first of the other, when no straight run longer than FLIP_STRAIGHT_M lies between them
 * (a longer one is a straight the bank comes down on anyway). bankPlan pins the bank at none across each; core_close_banks_lap reads its flip zones from this
 * same function, so the plan and the rows cannot disagree. FLIP_STRAIGHT_M: the longest dead band of a flip in P's sweep is 38 m (kh +1/300 → −1/300 over
 * 100 m), so 60 m.
 */
function flipsOf(doc) {
  const out = []; let s0 = 0, last = 0, lastS = -Infinity;
  for (const P of doc.pieces) {
    if (P.type !== 'road') { last = 0; s0 += P.length || 0; continue; }
    for (let s = 0; s <= P.length; s += FLIP_STEP_M) { const k = D.valuesAt(P, Math.min(s, P.length)).kh; if (!(Math.abs(k) > CURVED_KH)) continue;
      const sg = Math.sign(k), at = s0 + s; if (last && sg !== last && at - lastS <= FLIP_STRAIGHT_M) out.push([lastS, at]); last = sg; lastS = at; }
    s0 += P.length || 0;
  }
  return out;
}
/** bankLap with what it held back: { doc, eased (piece ids where the bank eased to none for a flip), withheld (piece ids left unbanked: they would lean out),
 *  none (when there were curves to bank and none was banked: why, in words; P's re-read (d)) }. */
function bankLapWith(doc) { const r = bankLapRun(doc); return { doc: r.doc, eased: r.eased || [], withheld: r.withheld || [], none: r.none || null }; }
function bankLap(doc) { return bankLapRun(doc).doc; }
/** One path of a closed lap read for bankLap at once (D447, its cost): per piece id the least road-up (U·ŷ, the level rule), the curved stations leaning out
 *  (leanOutPieces' read), and the roll rates as the checker reads them (validate's rollRates, its 20 m chord). One build of a 25 km path, not three. */
function lapReads(doc) {
  const { segments, path } = toPath(doc, { step: 2 }), S = path.samples, lowUp = new Map(), out = new Map();
  for (const q of S) {
    const g = segments[q.seg]; lowUp.set(g.id, Math.min(lowUp.has(g.id) ? lowUp.get(g.id) : 1, q.U[1])); if (g.kind === 'gap') continue;
    const k = q.kvec, kh = Math.hypot(k[0], k[2]); if (kh < 1 / 600) continue;
    if (Math.asin(Math.max(-1, Math.min(1, (q.U[0] * k[0] + q.U[2] * k[2]) / kh))) < -LEAN_OUT_DEG * DEG) out.set(g.id, (out.get(g.id) || 0) + 1);
  }
  const rates = V._internal.rollRates(S, (i) => segments[S[i].seg].kind !== 'gap', !!doc.closed, path.lengthM).map((q) => ({ id: segments[S[q.i].seg].id, rate: q.rate }));
  return { lowUp, out, peak: (ids) => rates.reduce((m, q) => (ids.has(q.id) ? Math.max(m, q.rate) : m), 0) };
}
function bankLapRun(doc) {
  if (!doc.closed || !doc.pieces.length || doc.pieces[0].type !== 'road') return { doc };
  const upright = D.valuesAt(doc.pieces[0], 0).phi, lane = pitPieces(doc), curved = (p) => doc.pieces[p].channels.kh.some((k) => Math.abs(k) > CURVED_KH);
  const flat = []; doc.pieces.forEach((P, p) => { if (P.type === 'road' && !P.tube && !lane.has(p) && P.channels.phi.every((ph) => Math.abs(ph - upright) <= ROLL_FREE)) flat.push(p); });
  // nothing on the lap is both upright and curved (every curve his own bank: TEST TRACK 10, ELYSIUM, the reported save): nothing to bank, and no path built
  if (!flat.some(curved)) return { doc };
  const reads = lapReads(doc), level = (P) => reads.lowUp.has(P.id) && reads.lowUp.get(P.id) >= Math.cos(LEVEL_DEG * DEG);
  const lap = flat.filter((p) => level(doc.pieces[p]));
  if (!lap.length) return { doc };
  // a joint is relaxed (D447 (d)) between two pieces that both curve; a flip at or near it is pinned by bankPlan's flip rule (`flips`), not by the joint
  const outBefore = reads.out, withheld = [], flipList = flipsOf(doc);
  // PER PIECE, never the whole lap (P's review finding 1 (c)): a piece that would still lean out where the closed lap did not is left as closed and the rest is
  // banked again without it, up to WITHHOLD_ROUNDS times. (Before, one leaning station left the whole lap flat, and the press said nothing.)
  for (let round = 0; round <= WITHHOLD_ROUNDS; round++) {
    const set = lap.filter((p) => !withheld.includes(doc.pieces[p].id)); if (!set.length) return { doc, withheld, none: 'every curve it could bank would lean out of its turn' };
    const uprightSet = new Set(set), relax = (p) => p > 0 && uprightSet.has(p - 1) && uprightSet.has(p) && curved(p - 1) && curved(p);
    const flatPeak = reads.peak(new Set(set.map((p) => doc.pieces[p].id)));
    // the share is scaled down while the lap rolls past the amber, as ruled; AND the roll's own rate (P's re-read, Sharp ramp 40 m: the bank's rate is capped at
    // 0.84 °/m in its own channel, but on a tight turn the checker reads the road's roll at 0.966 °/m where it rolls up after a flip, and a smaller share does
    // not slow a ramp that rides the cap: 0.966 → 0.959 → 0.948 over the three tries, and the WHOLE lap came back flat and silent)
    let share = BANK_SHARE, rollScale = 1, res = null, plan = null, outAfter = null;
    for (let t = 0; t < BANK_TRIES; t++) {
      plan = bankPlan(doc, set, share, uprightSet, relax, { flips: flipList, rollScale });
      if ([...plan.values()].every((a) => a.every((x) => x === 0))) return { doc, withheld };
      const cand = D.checkDoc(banked(doc, plan)), candReads = lapReads(cand), peak = candReads.peak(new Set(set.map((p) => doc.pieces[p].id))), allowed = Math.max(ROLL_AMBER_DEG_M, flatPeak + 1e-6);
      if (peak <= allowed) { res = cand; outAfter = candReads.out; break; }
      share *= (Math.max(ROLL_AMBER_DEG_M, flatPeak) / peak) * 0.97; rollScale *= (allowed / peak) * 0.97;
    }
    if (!res) return { doc, withheld, none: 'its roll would pass the amber' };   // the bank could not be kept under the amber: the lap as closed
    const worse = set.filter((p) => (outAfter.get(doc.pieces[p].id) || 0) > (outBefore.get(doc.pieces[p].id) || 0)).map((p) => doc.pieces[p].id);
    if (!worse.length) return { doc: freeze(res), eased: [...plan.eased].map((p) => doc.pieces[p].id), withheld };
    withheld.push(...worse);
  }
  return { doc, withheld, none: 'every curve it could bank would lean out of its turn' };
}
/** D434: the laid route banked and closed, the bank sized from the closed route (above); the share scaled down while the window rolls past the amber. */
function closeBanked(laid, window, upright) {
  const flatPeak = bankRollPeak(laid, window);   // a roll the laid route already has (a roll straight) is not the bank's to cure
  // which pieces are laid upright is judged ONCE, on the laid route (the closed one already carries the first pass's bank)
  const uprightSet = new Set(window.filter((p) => laid.pieces[p].type === 'road' && laid.pieces[p].channels.phi.every((ph) => Math.abs(ph - upright) <= ROLL_FREE)));
  let share = BANK_SHARE, res = null;
  for (let t = 0; t < BANK_TRIES; t++) {
    const plan1 = bankPlan(laid, window, share, uprightSet), first = close(banked(laid, plan1), { window });
    if (!first.converged) return first;
    res = close(banked({ ...first.doc, closed: false }, bankPlan(first.doc, window, share, uprightSet), plan1), { window });
    if (!res.converged) return res;
    const peak = bankRollPeak(res.doc, window);
    if (peak <= Math.max(ROLL_AMBER_DEG_M, flatPeak + 1e-6)) return res;
    share *= (Math.max(ROLL_AMBER_DEG_M, flatPeak) / peak) * 0.97;
  }
  return close(laid, { window });   // the bank could not be kept under the amber: the turns as laid
}

/** D357: the laid road closed AS IT IS, when it already meets the start within Close's bars (THE END STRAIGHT BEHIND THE START); else null. */
function metAsLaid(laid) {
  const shut = { ...laid, closed: true };
  let rs;
  try { rs = residual(shut); } catch (err) { if (err.name !== 'CoreError') throw err; return null; }
  if (!(rs.gapM < MET_M) || !rs.r.slice(3).every((v) => Math.abs(v) < MET_TOL)) return null;
  let doc;
  try { doc = freeze(D.checkDoc(shut)); } catch (err) { if (err.name !== 'CoreError') throw err; return null; }
  return { converged: true, doc, report: `met the start as laid: ${(rs.gapM * 1000).toFixed(3)} mm, tangent ${rs.tangentRad.toExponential(1)} rad` };
}

/** Whether the open track's end already meets its start (THE END ALREADY AT THE START): within NEAR_M, and heading, pitch and bank each within NEAR_RAD. */
function isNear(doc, rs = residual(doc)) { return rs.gapM <= NEAR_M && Math.abs(rs.r[3]) <= NEAR_RAD && Math.abs(rs.r[4]) <= NEAR_RAD && Math.abs(rs.r[5]) <= NEAR_RAD; }

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
  // D438: and long enough that its roll fits BANK_ACCEL (bankPlan): a roll of θ from rest to rest needs at least 2·√(θ/A) at an acceleration A; ROLL_ACCEL_FIT
  // over that leaves room for the pinned ends (TEST TRACK 10: 54° on 87 m stepped 33.6 °/100 m under the outer wheels at both of its ends).
  // 1.5 is a MARGIN SET BY THE SHAPE OF THE BLOSS BLEND (P, exo_memory/handback/p-d438-review-P_2026-10-22.md §1.1), not a fit to one track: extend lays the roll
  // as bloss(u) = u²(3 − 2u) (extend.js channelFn), whose acceleration peaks at both ends at 6θ/L²; at L = 1.5·2·√(θ/A) = 3√(θ/A) that is (2/3)·A for every θ.
  // A change to channelFn's blend moves this margin.
  const roll0 = rollRad > ROLL_FREE ? { bank, lengthM: Math.ceil(Math.max((rollRad / ROLL_RATE) * rollGuess, ROLL_ACCEL_FIT * 2 * Math.sqrt(rollRad / BANK_ACCEL))) } : null;
  const gap = Math.hypot(doc.start.pos[0] - e.p[0], doc.start.pos[1] - e.y, doc.start.pos[2] - e.p[1]);
  const deg = (a) => Math.round((a / DEG) * 10) / 10, f0 = fwd(th0);
  const rs = residual(doc);
  if (isNear(doc, rs)) {
    const off = `${rs.gapM.toFixed(3)} m from the start (heading ${deg(rs.r[3])}°, pitch ${deg(rs.r[4])}° off)`, road = [];
    for (let i = doc.pieces.length - 1; i >= 0 && doc.pieces[i].type === 'road' && road.length < NEAR_PIECES; i--) road.unshift(i);
    let why = null;
    for (let k = 1; k <= road.length; k++) {
      const window = road.slice(road.length - k);
      let res;
      try { res = close(doc, { window, maxIter: NEAR_ITER }); } catch (err) { if (err.name !== 'CoreError') throw err; why = err.message; continue; }
      if (!res.converged) { why = res.report; continue; }
      const hold = roadHold(res.doc, window[0]);
      if (hold.worst < 0) { why = `the car would leave the road at ${(hold.at / 1000).toFixed(2)} km (a load of ${hold.worst.toFixed(0)} g)`; continue; }
      const lenM = window.reduce((a, i) => a + doc.pieces[i].length, 0), which = k === 1 ? `the last piece, p${window[0] + 1},` : `the last ${k} pieces, p${window[0] + 1} to p${window[k - 1] + 1} (${Math.round(lenM)} m),`;
      const report = `the end is already ${off}: ${which} bent onto it, with no new road; ${res.report}`;
      return { doc: res.doc, window, plan: Object.freeze({ word: 'BEND', radiusM: 0, turns: [0, 0], straightM: 0, rollM: 0, rollFirst: false, rollPeakDegM: 0, minHoldG: Math.round(hold.worst * 10) / 10, lengthM: 0, windowText: k === 1 ? `the last piece (p${window[0] + 1}, ${Math.round(lenM)} m)` : `the last ${k} pieces (p${window[0] + 1} to p${window[k - 1] + 1}, ${Math.round(lenM)} m)`, report }) };
    }
    throw new D.CoreError('FINISH_NEAR', `the end is already ${off}, too close for new road (every route would be a loop), and bending the last ${road.length} piece(s) onto the start does not close it${why ? ` (${why})` : ''}: close with the last ~20% of the lap instead`);
  }
  // One order of laying: 'last' (the roll, if there is one, is the last piece onto the start: the shortest roads) or 'first' (the roll is laid at the end first, on its own straight, and
  // the route runs from the upright end). Returns { result } | { tooFast } (the roll reads too fast: lengthen it and search again) | { fail } (what was refused, and the least bad road the car left).
  const search = (mode, roll) => {
    const first = mode === 'first' && roll, base = first ? extend(doc, { length: roll.lengthM, targets: { kh: 0, kv: 0, phi: roll.bank } }) : doc, laidRoll = first ? null : roll;
    const e1 = first ? endPose(base) : e;
    // the route aims at the start, or, with a roll last, at the point that straight's length behind the start, on the start's heading
    const back = laidRoll ? laidRoll.lengthM : 0, p0 = [doc.start.pos[0] - back * f0[0], doc.start.pos[2] - back * f0[1]];
    // the radii in the order given (the gentler first), and at each radius the shortest route first
    const all = [...oneTurnRoutes(e1.p, e1.th, p0, th0), ...radii.flatMap((R) => routes(e1.p, e1.th, p0, th0, R).sort((a, b) => a.lengthM - b.lengthM))];   // the one-turn routes first (2026-10-15)
    // D440 (O's D439 §5): a route that leans out is never taken; the search goes on to the next (`out`, the least of them, is kept for the refusal). On a lap
    // whose own turn is tight, roll-last closed leaning out at 1,171 of 1,172 curved stations (9.22 g) and was taken for its lower side load. Of the routes
    // that pass, the first in the order they have always been tried is still taken: ranking them by side load was measured three ways and each broke a rule
    // already held (exo_memory/handback/p-d440-O_2026-10-23.md §2: R 900 detours of 10–11 km on his two tracks; core_finish row 6's one-turn finish; row 12's
    // compact roll-last road).
    let best = null, left = 0, worstRoad = null, out = null;
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
      // D439 (P's review of D438 §2 (b)): with the roll laid FIRST, Close, the bank and the cup work on the pieces after its roll straight. Closed with them, the
      // straight was bent into a curve (to R 326 m) while it still rolled, and a rolling piece is never banked (bankPlan's upright rule), so its roll leaned the
      // wrong way through the bend: 41 stations out, to −26.3°, 5.07 g on P's turn 210 / tail 300 / roll 30. Left as laid it stays straight; the pieces after
      // it close the lap. (window, all the new road, is still what the plan reports and the shell outlines, and what the cup comes home over (cupHome): the cup
      // does not move the centreline, and over the whole new road it is slowest, D439 (d).)
      const shut = first ? window.slice(1) : window;
      if (!shut.length) continue;
      let res;
      // D357: what Close refuses is taken AS LAID when it already meets the start (metAsLaid: a lone straight it cannot bend). (A windowed Close never returns
      // unconverged: it refuses by name, close.js D242)
      try { laid = cupHome(laid, window); res = closeBanked(laid, shut, bank); } catch (err) { if (err.name !== 'CoreError') throw err; res = metAsLaid(laid); if (!res) { best = best || err.message; continue; } }
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
      const load = closerLoad(res.doc, doc.pieces.length);
      if (load.out > 0) { if (!out || load.out < out.out) out = { ...load, word: r.word, radiusM: r.radiusM }; continue; }
      const added = res.doc.pieces.slice(doc.pieces.length).reduce((a, P) => a + P.length, 0), cupRate = cupPeak(res.doc, doc.pieces.length);
      // D438: the closer too short to bring the cup home at his own road's fastest says so, and at what rate (it is already the slowest the closer allows: cupHome)
      const cupNote = cupRate > CUP_RATE_DEG_M ? `; the cup comes home at ${cupRate.toFixed(3)}°/m, faster than ${CUP_RATE_DEG_M}°/m: the new road is too short to bring it home slower` : '';
      const rolled = roll ? (first ? `, after ${roll.lengthM} m rolling ${Math.round(rollRad / DEG)}° upright first` : `, then ${roll.lengthM} m rolling ${Math.round(rollRad / DEG)}° upright onto the start`) : '';
      const report = `${r.word} at R ${Math.round(r.radiusM)} m: turn ${deg(r.a1)}°, ${Math.round(r.straightM)} m straight, turn ${deg(r.a2)}°${rolled}; ${window.length} new piece${window.length === 1 ? '' : 's'}, ${Math.round(added)} m; ${res.report}${cupNote}`;
      const cand = ({ side: load.side, result: { doc: res.doc, window, plan: Object.freeze({ word: r.word, radiusM: r.radiusM, turns: [deg(r.a1), deg(r.a2)], straightM: Math.round(r.straightM), rollM: roll ? roll.lengthM : 0, rollFirst: !!first, rollPeakDegM: Math.round(peak * 1000) / 1000, minHoldG: Math.round(hold.worst * 10) / 10, lengthM: Math.round(added), cupRateDegM: Math.round(cupRate * 10000) / 10000, report }) } });
      return { passed: [cand] };
    }
    return { passed: [], fail: { tried: all.length, best, worstRoad, out } };
  };
  let fail = null;
  // D439 (P's review of D438 §2 (c)): when a roll is owed, BOTH orders are searched and the closer with the lower peak side load at the design speed is taken
  // (closerLoad). Laid last, the roll leaves the turns on the end's bank, which the bank never touches (bankPlan's upright rule): on P's turn 180 / tail 1,200 /
  // roll 10 and 30 that closer was taken first and carried 10.89 and 9.16 g, against 4.68 and 4.65 rolled first. But where the end is banked the way the turns
  // go, the end's own bank is the better lean: core_finish row 12's lap carries 5.55 g rolled last against 8.08 rolled first. A tie keeps the order below.
  const found = []; let leanOut = null;
  for (const mode of roll0 ? ['last', 'first'] : ['last']) {
    let roll = roll0;
    for (let round = 0; ; round++) {
      // D440 (h) (P's review of D439 §2.4): a refusal in the SECOND order keeps the closer the first order found. inferred unreachable today (the roll laid
      // first is long enough for its own roll, D438, and the lengthening converges in a round or two), so no row; it guards a later change
      let out;
      try { out = search(mode, roll); } catch (err) { if (err.name === 'CoreError' && found.length) break; throw err; }
      if (out.fail && out.fail.out && (!leanOut || out.fail.out.out < leanOut.out)) leanOut = out.fail.out;
      if (out.passed && out.passed.length) { found.push(...out.passed); break; }
      if (out.tooFast) {
        if (round >= ROLL_ROUNDS && found.length) break;   // D440 (h)
        if (round >= ROLL_ROUNDS) throw new D.CoreError('FINISH_ROLL', `the roll upright onto the start still reads ${out.tooFast.toFixed(3)}°/m (the amber bar is ${ROLL_AMBER_DEG_M}) at ${roll.lengthM} m after ${round + 1} lengthenings`);
        roll = { bank, lengthM: Math.ceil(roll.lengthM * (out.tooFast / ROLL_AMBER_DEG_M) * ROLL_LENGTHEN) };
        continue;
      }
      if (out.fail.worstRoad && (!fail || !fail.worstRoad || out.fail.worstRoad.worst > fail.worstRoad.worst)) fail = out.fail;
      else if (!fail) fail = out.fail;
      break;
    }
  }
  if (found.length) return found.reduce((a, b) => (b.side < a.side ? b : a)).result;
  // D440: never a closer that leans out. Every route that closed and held the car leaned the road out of a curve somewhere: refused by name, with the least of them
  if (leanOut) throw new D.CoreError('FINISH_LEANS_OUT', `no finish both closes and leans into its curves from here: every road that closes and keeps the car on it leans out of a curve, the least ${leanOut.out} of its ${leanOut.curved} curved stations by more than ${LEAN_OUT_DEG}° (${leanOut.word} at R ${Math.round(leanOut.radiusM)} m). Extend toward the start, or bank the end the way the road must turn, and finish again`);
  const rollText = roll0 ? ` and must roll ${Math.round(rollRad / DEG)}° to meet it (${roll0.lengthM} m of straight)` : '';
  if (fail.worstRoad) {
    const pitch = e.pitch / DEG, dy = doc.start.pos[1] - e.y;
    throw new D.CoreError('FINISH_LEAVES_ROAD', `no finish keeps the car on the road from here: the closest ones close the loop, but the car would leave the road at ${(fail.worstRoad.at / 1000).toFixed(2)} km (a load of ${fail.worstRoad.worst.toFixed(0)} g on the surface; the best road laid was ${fail.worstRoad.word} at R ${Math.round(fail.worstRoad.radiusM)} m). The end is ${Math.round(gap)} m from the start${rollText}${Math.abs(pitch) > 1 || Math.abs(dy) > 1 ? `, ${Math.abs(dy) > 1 ? `${Math.abs(dy).toFixed(1)} m ${dy > 0 ? 'below' : 'above'} it` : ''}${Math.abs(pitch) > 1 ? `${Math.abs(dy) > 1 ? ' and ' : ' '}pointing ${Math.abs(pitch).toFixed(1)}° ${pitch > 0 ? 'up' : 'down'}` : ''}` : ''}: level and straighten the last pieces, or give the road more room, and try again`);
  }
  throw new D.CoreError('FINISH_NO_ROUTE', `no finish closes from here: the end is ${Math.round(gap)} m from the start${rollText}, and none of the ${fail.tried} routes tried (turn, straight, turn at radius ${radii.join(', ')} m) could be closed${fail.best ? ` (the first refusal: ${fail.best})` : ''}. Extend toward the start and try again`);
}

module.exports = { finishToStart, bankLap, bankLapWith, flipsOf, isNear, NEAR_M, roadHold, routes, oneTurnRoutes, ONE_TURN_MIN_R, endPose, RADII_M };
