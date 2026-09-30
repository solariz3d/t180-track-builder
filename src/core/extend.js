// extend.js: grow the track from its open end (the spec's GO §2). The new piece's channels START at the previous piece's
// end value and slope and CONTINUE it (ref 09 §2: v + m·s), so with no handle touched a circle stays a circle and a
// clothoid stays a clothoid. A handle sets a TARGET for one channel, reached over a transition by the Bloss blend
// (1 − S(u))·cont(s) + S(u)·T with S(u) = 3u² − 2u³ (ref 02 §4, ref 09 §2): zero slope change at both ends, no jerk step.
//
//   extend(doc, { length, transition, targets: { kh, kv, phi, w, r, c }, family, knotM })  -> a new document, one piece longer
//
// `targets` are ABSOLUTE channel values: kh and kv in rad/m (+ = left, + = nosing up), phi in rad (+ = left side up), w in
// m, r in °/m, c (the CUP, D190) in degrees, 0 to 150. A channel with no target continues. A piece is a CUP piece when a c target is
// given, or when it is extended after a cup piece (the cup then continues like any channel); otherwise it is a LEGACY piece, rendered by
// the old profileAt, unchanged. The first piece of a track takes a cup with first: { c }; a cup that follows a legacy piece starts at the
// edge that piece renders (D.pieceEnd), held. The fit of a short transition can ring past its target (measured: 174.65° for a 150° target
// over 10 m), so the cup's control points are clamped to [0, 150] after the fit: the document never holds a cup outside that range. `transition` (m, default the piece's length) is where each target is
// reached; past it the channel holds the target. On an EMPTY track the first piece starts from `first` (default: level,
// straight, the family's measured width and rate, src/geom/fonts.js), since there is nothing to continue.
'use strict';

const D = require('./document.js');
const { WIDTHS, RATES } = require('../geom/fonts.js');

const bloss = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));   // ref 02 §4, IFC-BLOSS

/** A channel's function over the new piece: the continuation, blended to the target if there is one (ref 09 §2). */
function channelFn({ v, m }, target, Lt) {
  const cont = (s) => v + m * s;
  if (target === undefined || target === null) return cont;
  if (!Number.isFinite(target)) throw new D.CoreError('BAD_TARGET', `a target must be a finite number, got ${target}`);
  return (s) => { const u = s / Lt, S = bloss(u); return u >= 1 ? target : (1 - S) * cont(s) + S * target; };
}

function extend(doc, { length, transition, targets = {}, family, knotM, first } = {}) {
  if (!(length > 0)) throw new D.CoreError('BAD_LENGTH', `extend needs a positive length, got ${length}`);
  for (const k of Object.keys(targets)) if (!D.CHANNELS.includes(k)) throw new D.CoreError('BAD_TARGET', `no channel "${k}" (known: ${D.CHANNELS.join(', ')})`);
  if (targets.c !== undefined && targets.c !== null && !(Number.isFinite(targets.c) && targets.c >= 0 && targets.c <= D.CUP_MAX)) throw new D.CoreError('BAD_CUP', 'the cup target must be from 0 to ' + D.CUP_MAX + ' degrees, got ' + targets.c);
  if (first && first.c !== undefined && !(Number.isFinite(first.c) && first.c >= 0 && first.c <= D.CUP_MAX)) throw new D.CoreError('BAD_CUP', 'the first piece cup must be from 0 to ' + D.CUP_MAX + ' degrees, got ' + first.c);
  const Lt = transition === undefined ? length : transition;
  if (!(Lt > 0 && Lt <= length)) throw new D.CoreError('BAD_TRANSITION', `the transition must be in (0, length], got ${Lt}`);
  const last = [...doc.pieces].reverse().find((P) => P.type === 'road');
  const fam = family || (last ? last.family : 'bowl');
  let from = D.endState(doc), held = true;
  const cup = (targets.c !== undefined && targets.c !== null) || D.endIsCup(doc) || (!from && !!first && first.c !== undefined);
  if (!from) {   // an empty track: the start state, and nothing held
    const f = { kh: 0, kv: 0, phi: 0, w: WIDTHS[fam], r: RATES[fam], h: 0, l: 0, ...(first || {}) };
    if (f.c === undefined) f.c = D.legacyEdgeDeg(fam, f.w, f.r);   // a cup asked for on an empty track starts at the edge the family renders
    from = Object.fromEntries(D.CHANNELS.map((ch) => [ch, { v: f[ch], m: 0 }])); held = false;
  }
  const channels = Object.fromEntries(D.CHANNELS.map((ch) => [ch, channelFn(from[ch], targets[ch], Lt)]));
  const piece = D.roadPiece({ length, family: fam, from: held ? from : null, channels, knotM, cup });
  if (cup) {
    const c = piece.channels.c = piece.channels.c.map((x) => Math.min(D.CUP_MAX, Math.max(0, x))), n = c.length;   // the fit's ringing never leaves [0, 150]
    // a cup that ends AT a limit ends flat, so the piece after it can continue C1 without a control point past the limit (its end slope was a rounding away from 0)
    if (c[n - 1] <= 1e-3 || c[n - 1] >= D.CUP_MAX - 1e-3) c[n - 2] = c[n - 1];
  }
  return D.appendPiece(doc, piece);
}

module.exports = { extend, channelFn, bloss };
