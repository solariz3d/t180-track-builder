// jump.js: A JUMP THE KEEPER'S WAY (D258, pane E; it replaces D243's solved gap and generated landing ramp). The keeper: "the user will initiate a
// jump by instead of clicking extend, it says jump … it then lets the user move around a blank straight piece just like the first piece for them to
// then place down in the space they need it to be through testing in the game trial and error driving it themselves". So a jump is a FREE FLIGHT
// (document.js flightPiece: the landing's start pose relative to the take-off end) and a LANDING, an ordinary road piece that starts at that pose.
// Nothing between them is solved or generated: no arc, no ramp, no reach.
//
//   jumpHere(doc, extendOpts, { landing, landingM })  -> the Jump button: the current piece placed exactly as Extend would (extendOpts; null takes off
//                                                       from the track's end as it is), then a free flight to `landing` (default LANDING_DEFAULT: lined
//                                                       up, 40 m ahead, at the same height, level), then a straight landing of landingM (default 60 m)
//   jump(doc, pose)                                  -> a free flight appended at the open end (pose: forward, left, up, heading, pitch, bank)
//   landingOf(doc)                                   -> { flight, index, pose } while the landing is the HEAD (the last piece, right after its flight,
//                                                       or a flight still waiting for its landing at the end), else null
//   setLanding(doc, pose)                            -> the head landing moved: its flight's pose changed (a partial pose keeps the rest), the landing's
//                                                       bank following the flight's; refused by name, LANDING_NOT_HEAD, once road is extended from it
//
// The landing is movable only while it is the head (the keeper: "the user will make the landing and perfect it before expanding it on outward after the
// jump … there is no need for this idea of tweaking a jump that tweaks the rest of the track"). Deleting back to it makes it the head, and movable, again.
//
// Refused by name: an empty track (NO_TAKEOFF), a closed one (CLOSED), a track that ends in a jump (JUMP_AFTER_JUMP, D.checkDoc), a road that still
// carries a height or sideways offset at the lip (FLIGHT_OFFSET), a pose that is not one (BAD_FLIGHT, FLIGHT_TOO_SHORT), a landing that is not the head
// (LANDING_NOT_HEAD).
'use strict';

const D = require('./document.js');
const { extend } = require('./extend.js');
const { WIDTHS, RATES } = require('../geom/fonts.js');

const LANDING_M = 60;   // the Jump button's landing: a 60 m straight

/** The free flight's pose from `pose`, every missing field from `base` (default LANDING_DEFAULT); refused by name when a field is not a number. */
function poseOf(pose = {}, base = D.LANDING_DEFAULT) {
  if (!pose || typeof pose !== 'object') throw new D.CoreError('BAD_FLIGHT', 'a landing pose is an object: forward, left, up, heading, pitch, bank');
  if (['gap', 'drop', 'land'].some((k) => pose[k] !== undefined)) throw new D.CoreError('OLD_FLIGHT', 'a jump is placed by its landing now (forward, left, up, heading, pitch, bank), not by gap, drop and landing angle');
  const out = {};
  for (const k of D.FLIGHT_POSE) {
    const v = pose[k] === undefined ? base[k] : pose[k];
    if (!Number.isFinite(v)) throw new D.CoreError('BAD_FLIGHT', `the landing's ${k} must be a number, got ${v}`);
    out[k] = v;
  }
  return out;
}

function jump(doc, pose = {}) {
  D.checkDoc(doc);
  if (doc.closed) throw new D.CoreError('CLOSED', 'a closed track has no open end; open it first');
  if (!doc.pieces.length) throw new D.CoreError('NO_TAKEOFF', 'a jump needs road to take off from: extend first');
  return D.appendPiece(doc, D.flightPiece(poseOf(pose)));
}

/** The Jump button's landing after flight F: a straight of `length` m, level, at F's bank, the family's own width and rate ("just like the first piece"). */
function landingPiece(F, family, length) {
  const fam = D.FAMILIES.includes(family) ? family : 'bowl', c = (v) => () => v;
  return D.roadPiece({ length, family: fam, channels: { kh: c(0), kv: c(0), phi: c(F.bank), w: c(WIDTHS[fam]), r: c(RATES[fam]), h: c(0), l: c(0) } });
}

function jumpHere(doc, extendOpts = null, { landing = {}, landingM = LANDING_M } = {}) {
  D.checkDoc(doc);
  if (!(Number.isFinite(landingM) && landingM > 0)) throw new D.CoreError('BAD_LENGTH', `the landing's length must be a positive number of metres, got ${landingM}`);
  const takeoff = extendOpts ? extend(doc, extendOpts) : doc;
  const withFlight = jump(takeoff, landing), F = withFlight.pieces[withFlight.pieces.length - 1];
  const fam = (takeoff.pieces.filter((P) => P.type === 'road').pop() || {}).family;
  return D.appendPiece(withFlight, landingPiece(F, fam, landingM));
}

function landingOf(doc) {
  const n = doc.pieces.length, last = doc.pieces[n - 1], before = doc.pieces[n - 2];
  if (!last || doc.closed) return null;
  if (last.type === 'flight') return { flight: last, index: n - 1, pose: Object.fromEntries(D.FLIGHT_POSE.map((k) => [k, last[k]])) };
  if (last.type === 'road' && before && before.type === 'flight') return { flight: before, index: n - 2, pose: Object.fromEntries(D.FLIGHT_POSE.map((k) => [k, before[k]])) };
  return null;
}

function setLanding(doc, pose = {}) {
  D.checkDoc(doc);
  const L = landingOf(doc);
  if (!L) throw new D.CoreError('LANDING_NOT_HEAD', doc.closed ? 'a closed track has no landing to move; open it first'
    : 'only the landing at the end of the track can be moved: once road is extended from a landing it is fixed (delete back to it to move it again)');
  const F = { ...L.flight, ...D.flightPiece(poseOf(pose, L.pose)), id: L.flight.id };
  const pieces = doc.pieces.slice();
  pieces[L.index] = F;
  const land = pieces[L.index + 1];
  if (land) {   // the landing's bank follows its flight's: every control point moved by the same amount, so its shape about its start is kept
    const d = F.bank - L.flight.bank;
    if (d !== 0) pieces[L.index + 1] = { ...land, channels: { ...land.channels, phi: land.channels.phi.map((v, i) => (i === 0 ? F.bank : Number((v + d).toFixed(D.DEC.phi)))) } };
  }
  return deepFreeze(D.checkDoc({ ...doc, pieces }));
}
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };   // as document.js freezes every document

module.exports = { jump, jumpHere, landingOf, setLanding, LANDING_M };
