// extend.js: grow the track from its open end (the spec's GO §2). The new piece's channels START at the previous piece's
// end value and slope and CONTINUE it (ref 09 §2: v + m·s), so with no handle touched a circle stays a circle and a
// clothoid stays a clothoid. A handle sets a TARGET for one channel, reached over a transition by the Bloss blend
// (1 − S(u))·cont(s) + S(u)·T with S(u) = 3u² − 2u³ (ref 02 §4, ref 09 §2): zero slope change at both ends, no jerk step.
//
//   extend(doc, { length, transition, targets: { kh, kv, phi, w, r }, family, knotM })  -> a new document, one piece longer
//
// `targets` are ABSOLUTE channel values: kh and kv in rad/m (+ = left, + = nosing up), phi in rad (+ = left side up), w in
// m, r in °/m. A channel with no target continues. `transition` (m, default the piece's length) is where each target is
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
  const Lt = transition === undefined ? length : transition;
  if (!(Lt > 0 && Lt <= length)) throw new D.CoreError('BAD_TRANSITION', `the transition must be in (0, length], got ${Lt}`);
  const last = [...doc.pieces].reverse().find((P) => P.type === 'road');
  const fam = family || (last ? last.family : 'bowl');
  let from = D.endState(doc), held = true;
  if (!from) {   // an empty track: the start state, and nothing held
    const f = { kh: 0, kv: 0, phi: 0, w: WIDTHS[fam], r: RATES[fam], ...(first || {}) };
    from = Object.fromEntries(D.CHANNELS.map((ch) => [ch, { v: f[ch], m: 0 }])); held = false;
  }
  const channels = Object.fromEntries(D.CHANNELS.map((ch) => [ch, channelFn(from[ch], targets[ch], Lt)]));
  return D.appendPiece(doc, D.roadPiece({ length, family: fam, from: held ? from : null, channels, knotM }));
}

module.exports = { extend, channelFn, bloss };
