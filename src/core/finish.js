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
const bankOf = (k, share) => -share * Math.atan((V_DESIGN * V_DESIGN * k) / G);
/**
 * The bank to add to each control point of each road piece of `window` ([p] → array, 0 outside), from kFrom's curvature: pinned at the window's ends, rate-limited.
 * Only a piece laid UPRIGHT is banked: its laid bank within ROLL_FREE of `upright` (the bank the lap closes to, the start's, finishToStart's `bank`). A turn laid on
 * the user's own bank (a roll laid LAST, after the turns) keeps it: the bank is a lean into the curve against gravity, and rolling the road upright inside the turn
 * is what finish.js never does (lay: "a roll is never laid in a turn"); such a route is judged as it was laid, and the roll-first order banks its upright turns.
 */
function bankPlan(kFrom, window, share, uprightSet) {
  const road = window.filter((p) => kFrom.pieces[p].type === 'road'), rate = (BANK_ROLL * ROLL_AMBER_DEG_M * Math.PI) / 180, seq = [];
  let s0 = 0; const startOf = new Map(); kFrom.pieces.forEach((P, p) => { startOf.set(p, s0); s0 += P.length || 0; });
  road.forEach((p, j) => {
    const P = kFrom.pieces[p], U = D.knotVector(P), n = P.channels.kh.length, linked = j > 0 && road[j - 1] === p - 1;
    const up = uprightSet.has(p);
    // pinned: each piece's first two and last two points keep the laid bank (the ruling: meet the laid bank at EVERY joint, so a straight between turns gets none)
    for (let i = linked ? 1 : 0; i < n; i++) { const pinned = i < 2 || i > n - 3; seq.push({ p, i, s: startOf.get(p) + (U[i + 1] + U[i + 2] + U[i + 3]) / 3, t: up && !pinned ? bankOf(P.channels.kh[i], share) : 0, pinned }); }
  });
  // the pinned points stay where they are in both passes (a pass that moved them would undo the pin: the close would then meet the seam's bank row in one knot)
  for (let k = 1; k < seq.length; k++) { if (seq[k].pinned) continue; const d = rate * (seq[k].s - seq[k - 1].s); seq[k].t = Math.max(seq[k - 1].t - d, Math.min(seq[k - 1].t + d, seq[k].t)); }
  for (let k = seq.length - 2; k >= 0; k--) { if (seq[k].pinned) continue; const d = rate * (seq[k + 1].s - seq[k].s); seq[k].t = Math.max(seq[k + 1].t - d, Math.min(seq[k + 1].t + d, seq[k].t)); }
  const plan = new Map(road.map((p) => [p, new Array(kFrom.pieces[p].channels.kh.length).fill(0)]));
  for (const x of seq) plan.get(x.p)[x.i] = x.t;
  road.forEach((p, j) => { if (j > 0 && road[j - 1] === p - 1) { const A = plan.get(p - 1), B = plan.get(p), Pa = kFrom.pieces[p - 1], Pb = kFrom.pieces[p], na = A.length;
    const hA = Pa.length - (Pa.knots.length ? Pa.knots[Pa.knots.length - 1] : 0), hB = Pb.knots.length ? Pb.knots[0] : Pb.length; B[0] = A[na - 1]; B[1] = B[0] + (hB / hA) * (A[na - 1] - A[na - 2]); } });
  return plan;
}
/** doc with plan added to each planned piece's bank, less (when given) the plan `minus` added before. */
function banked(doc, plan, minus = null) {
  return D.checkDoc({ ...doc, pieces: doc.pieces.map((P, p) => (!plan.has(p) ? P : { ...P, channels: { ...P.channels, phi: P.channels.phi.map((ph, i) => ph + plan.get(p)[i] - (minus ? minus.get(p)[i] : 0)) } })) });
}
/** The worst roll rate on the window's pieces, read as the checker reads it (validate's rollRates, its 20 m chord). */
function bankRollPeak(doc, window) {
  const { segments, path } = toPath(doc, { step: 2 }), S = path.samples, ids = new Set(window.map((p) => doc.pieces[p].id));
  return V._internal.rollRates(S, (i) => segments[S[i].seg].kind !== 'gap', !!doc.closed, path.lengthM).filter((q) => ids.has(segments[S[q.i].seg].id)).reduce((m, q) => Math.max(m, q.rate), 0);
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
  const roll0 = rollRad > ROLL_FREE ? { bank, lengthM: Math.ceil((rollRad / ROLL_RATE) * rollGuess) } : null;
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
      // D357: what Close refuses is taken AS LAID when it already meets the start (metAsLaid: a lone straight it cannot bend). (A windowed Close never returns
      // unconverged: it refuses by name, close.js D242)
      try { res = closeBanked(laid, window, bank); } catch (err) { if (err.name !== 'CoreError') throw err; res = metAsLaid(laid); if (!res) { best = best || err.message; continue; } }
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

module.exports = { finishToStart, isNear, NEAR_M, roadHold, routes, oneTurnRoutes, ONE_TURN_MIN_R, endPose, RADII_M };
