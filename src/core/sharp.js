// sharp.js: SHARP, a second turn type beside the broad curve (D282; the keeper, 2026-10-09 18:55: "THERE is nothign wrong with the 90 degree curves that can be
// made now, as long as its straight it is a type of turn, but i also want to be able to make thunderhead 90 degrees too"). Thunderhead's turns after the jump
// hold about R 22 m for ~88° with entries and exits of 0–8 m (exo_memory/loop/sharp_turns_measure_B_2026-10-09.md §1). The broad curve eases its rate over
// the whole piece and the "at start" ease is a fixed 20 m on 20 m knots (B §2 L1–L3), so neither draws that; this type does, and leaves both untouched.
//
//   extendSharp(doc, opts, { angle, R, ramp = 4 })   two pieces as ONE edit: a TURN piece that ramps the turn rate to ±1/R over `ramp` metres and holds it, then
//                                                  an EXIT piece of `ramp` metres that ramps it back to 0, ending with rate 0 and slope 0 (dead straight). The hold
//                                                  is solved so the two turn EXACTLY `angle` (rad, + = left) on the adapter's path; R is kept as typed.
//                                                  Both pieces carry knots every knotM = min(2, ramp) m (B §3: a ramp shorter than one knot span is drawn
//                                                  wrong, and knotM ≤ ramp draws it right). opts are extend's for the other channels (width, climb, bank…).
//   tightestSharp(doc, opts, { angle, ramp })        the smallest radius (m, to 0.1 m) at which the corner stays GREEN for the head's width and cross-section.
//
// THE MINIMUM RADIUS is the geometry's, not a cap (B §2 L4/L5): the validator at full speed reds the fold (1 − κ·o ≤ 0 at the inner edge) and surfaces stacked
// within 2 m, and ambers a normal load past the proven 90 g. Sharp refuses a radius at which any red or amber falls on the corner (SHARP_TOO_TIGHT), naming the
// tightest that stays green ("tightest at this width: 15.0 m"), and changes nothing. It is judged on a PROBE: a straight with the head's cross-section, the
// corner, and a straight after it, so it is a property of the width and cross-section (and cheap on a long track); what the corner does to the REST of the
// track (running over another part of it) is the validator's to show, as for any piece.
'use strict';
const D = require('./document.js');
const { extend } = require('./extend.js');
const { toPath, toSegments } = require('./adapter.js');
const { turnWeights } = require('./turnby.js');

const RAMP_DEFAULT = 4, KNOT_MAX = 2;
const TURN_TOL = 1e-5;          // rad (0.00057°), as turnby.js: kh's storage leaves a floor near 1e-7 rad
const PROBE_IN = 60, PROBE_OUT = 60, NEAR_M = 5;
const R_HI = 2000, R_RES = 0.05;
const DEG = Math.PI / 180;
const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };

const knotOf = (ramp) => Math.min(KNOT_MAX, ramp);
const headIdx = (d) => d.pieces.length - 1;
const turnOfPiece = (P) => { const w = turnWeights(P), c = P.channels.kh; let t = 0; for (let i = 0; i < c.length; i++) t += w[i] * c[i]; return t; };

/** The other channels' options, as extend takes them, with the turn channel taken over by Sharp (its typed rate and "at start" do not apply). */
function others(opts) {
  const targets = { ...(opts.targets || {}) }; delete targets.kh;
  let transition = opts.transition;
  if (typeof transition === 'number') transition = Object.fromEntries(Object.keys(targets).map((ch) => [ch, transition]));
  else if (transition && typeof transition === 'object') { transition = { ...transition }; delete transition.kh; }
  return { ...opts, targets, transition };
}
/** The two pieces for a hold of length L1 (the turn piece) and the exit, with the end rate and slope set to 0 exactly (the exit's Bloss blend ends there). */
function build(doc, o, k, ramp, L1) {
  const knotM = knotOf(ramp), tr = { ...(o.transition || {}) };
  const clip = (t, L) => Object.fromEntries(Object.entries(t).map(([ch, v]) => [ch, typeof v === 'number' ? Math.min(v, L) : v]));
  const d1 = extend(doc, { ...o, length: L1, knotM, targets: { ...o.targets, kh: k }, transition: { ...clip(tr, L1), kh: ramp } });
  const d2 = extend(d1, { length: ramp, knotM, targets: { kh: 0 }, transition: { kh: ramp } });
  const pieces = d2.pieces.slice(), E = pieces[headIdx(d2)], c = E.channels.kh.slice(); c[c.length - 1] = 0; c[c.length - 2] = 0;
  pieces[headIdx(d2)] = { ...E, channels: { ...E.channels, kh: c } };
  return D.checkDoc({ ...d2, pieces });
}
const turnOf = (d) => turnOfPiece(d.pieces[headIdx(d) - 1]) + turnOfPiece(d.pieces[headIdx(d)]);

function check(doc, { angle, R, ramp = RAMP_DEFAULT }) {
  if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: there is no open end to turn from');
  if (!(Number.isFinite(angle) && angle !== 0)) throw new D.CoreError('BAD_TARGET', `Sharp needs an angle other than 0, got ${angle}`);
  if (!(Number.isFinite(R) && R > 0)) throw new D.CoreError('BAD_TARGET', `Sharp needs a radius above 0 m, got ${R}`);
  if (!(Number.isFinite(ramp) && ramp > 0)) throw new D.CoreError('BAD_TRANSITION', `Sharp needs a ramp above 0 m, got ${ramp}`);
}

/** The corner itself: the hold solved by bisection on the path's own heading (the adapter's trapezoid on 2 m segments, turnby.js turnWeights). */
function corner(doc, opts, { angle, R, ramp = RAMP_DEFAULT }) {
  check(doc, { angle, R, ramp });
  const o = others(opts), k = Math.sign(angle) / R, want = Math.abs(angle), f = (L) => Math.abs(turnOf(build(doc, o, k, ramp, L)));
  let lo = ramp, hi = Math.max(2 * ramp, want * R + 2 * ramp);
  if (f(lo) > want + TURN_TOL) {
    const least = f(lo) / DEG;
    throw Object.assign(new D.CoreError('SHARP_TOO_SMALL', `a ${(want / DEG).toFixed(1)}° corner at R ${R} m is smaller than its own ramps (${ramp} m in, ${ramp} m out): the least it turns is ${least.toFixed(1)}°; type a larger angle, a larger radius or a shorter ramp`), { leastDeg: least });
  }
  while (f(hi) < want) hi *= 2;
  for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (f(mid) < want) lo = mid; else hi = mid; if (hi - lo < 1e-7) break; }
  const L = Math.abs(f(lo) - want) <= Math.abs(f(hi) - want) ? lo : hi;
  let d = build(doc, o, k, ramp, +L.toFixed(6));
  // the hold length moves the knot count in whole steps, so the turn is not continuous in it (measured: 0.02° short at R 12, width 24). What is left is taken up
  // by the least-norm step (turnby.js's) on the HOLD's own control points only: the entry ramp and the turn piece's last two (the joint the exit continues, C1) stay
  for (let it = 0; it < 3; it++) {
    const r = Math.abs(turnOf(d)) - want; if (Math.abs(r) <= TURN_TOL) break;
    const i1 = headIdx(d) - 1, P = d.pieces[i1], c = P.channels.kh.slice(), w = turnWeights(P), hold = [];
    for (let i = 2; i <= c.length - 3; i++) if (Math.abs(c[i] - k) <= 1e-9) hold.push(i);
    const ww = hold.reduce((a, i) => a + w[i] * w[i], 0); if (!(ww > 0)) break;
    for (const i of hold) c[i] = Number((c[i] - (Math.sign(k) * r * w[i]) / ww).toFixed(D.DEC.kh)) + 0;
    const pieces = d.pieces.slice(); pieces[i1] = { ...P, channels: { ...P.channels, kh: c } }; d = D.checkDoc({ ...d, pieces });
  }
  const miss = Math.abs(Math.abs(turnOf(d)) - want);
  if (miss > TURN_TOL) throw new D.CoreError('SHARP_NOT_EXACT', `the corner turns ${(Math.abs(turnOf(d)) / DEG).toFixed(4)}°, not ${(want / DEG).toFixed(4)}°`);
  return d;
}

/** The probe for the minimum radius: a straight with the head's width and cross-section, the corner, a straight after it. */
function probe(doc, opts, sharp) {
  const last = [...doc.pieces].reverse().find((P) => P.type === 'road'), from = D.endState(doc);
  let start = D.createDoc('sharp probe');
  if (from) {
    const kind = D.endKind(doc), first = { kh: 0, kv: 0, phi: from.phi.v, w: from.w.v, r: from.r.v, e: from.e.v, s: from.s.v };
    if (kind === 'cup') first.c = from.c.v; else if (kind === 'tube') first.t = from.tNext ? from.tNext.v : from.t.v;
    start = extend(start, { length: PROBE_IN, family: last ? last.family : 'bowl', first });
  } else start = extend(start, { length: PROBE_IN, family: opts.family || 'bowl' });
  const c = corner(start, opts, sharp), s0 = PROBE_IN, s1 = c.pieces.slice(1).reduce((a, P) => a + P.length, PROBE_IN);
  const d = extend(c, { length: PROBE_OUT, knotM: knotOf(sharp.ramp || RAMP_DEFAULT) });
  return { d, s0, s1 };
}
/** The reds and ambers the validator (full speed, as the app runs it) puts on the probe's corner. */
function faults(doc, opts, sharp) {
  const V = require('../validate/index.js');
  const { d, s0, s1 } = probe(doc, opts, sharp), { path } = toPath(d), res = V.validate(path, toSegments(d), { csp: true, fullSpeed: true });
  const on = (xs) => (xs || []).filter((x) => { const a = x.s0 != null ? x.s0 : x.s, b = x.s1 != null ? x.s1 : a; return b >= s0 - NEAR_M && a <= s1 + NEAR_M; }).map((x) => x.reason);
  return { red: [...new Set(on(res.red))], amber: [...new Set(on(res.amber))] };
}
const green = (doc, opts, sharp) => { const f = faults(doc, opts, sharp); return !f.red.length && !f.amber.length; };

/** The smallest radius (rounded UP to 0.1 m) at which this corner stays green from this head, or null when none up to R_HI m does. */
function tightestSharp(doc, opts, { angle, ramp = RAMP_DEFAULT }, fromR = 1) {
  let lo = fromR, hi = Math.max(2 * fromR, 8);
  const ok = (R) => { try { return green(doc, opts, { angle, R, ramp }); } catch (e) { if (e && e.code === 'SHARP_TOO_SMALL') return false; throw e; } };
  while (!ok(hi)) { lo = hi; hi *= 2; if (hi > R_HI) return null; }
  while (hi - lo > R_RES) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
  let r = Math.ceil(hi * 10 - 1e-9) / 10; while (!ok(r) && r <= R_HI) r = +(r + 0.1).toFixed(1);
  return r;
}

/** Extend with a Sharp corner, or refuse by name: too tight for the width (with the tightest that works), or too small for its ramps. */
function extendSharp(doc, opts, sharp) {
  const s = { ramp: RAMP_DEFAULT, ...sharp };
  check(doc, s);
  const f = faults(doc, opts, s);
  if (f.red.length || f.amber.length) {
    const need = tightestSharp(doc, opts, s, s.R);
    const why = [...f.red, ...f.amber].join(', ');
    throw Object.assign(new D.CoreError('SHARP_TOO_TIGHT', need === null ? `R ${s.R} m is too tight here (${why}), and no radius up to ${R_HI} m is green` : `R ${s.R} m is too tight for this width (${why}): tightest at this width: ${need.toFixed(1)} m`), { needR: need, faults: f });
  }
  return freeze(corner(doc, opts, s));
}

module.exports = { extendSharp, tightestSharp, RAMP_DEFAULT };
