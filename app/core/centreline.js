// centreline.js: THE SCULPT GUARD (D244b, the keeper: a mode "to sculpt pieces once they are already put down, so they don't change the structure of the rest of the
// track, it's mostly just banking and cupping tweaks"). Sculpt offers ONLY the shape channels (bank, cup, width, edge angle, edge start, wall rise, tube sweep); the guard is the
// runtime proof that an edit made in it really left the CENTRELINE alone, and it REFUSES BY NAME when it did not (SCULPT_MOVES_CENTRELINE), so a future channel, or a piece whose
// shape does feed the route (a closed tube's heartline is its width / 2π, adapter.js heartlineOf), can never move the rest of the track silently.
//
//   routeMoved(baseDoc, baseSegments, newDoc, newSegments, baseStart, newStart) -> null | string   the CHEAP, EXACT check made at every drag step: the road's path is a pure function
//        of the start pose, each segment's route fields (length, k0, k1, kp0, kp1, heartline, heartline1; and, where a heartline is
//        in play, the roll fields, because the road's centre is then the heartline minus heartline * U) and the offset channels h and l,
//        so when none of those moved, every centreline sample is the same bit pattern at any step. Returns what moved, or null.
//   pathMoved(base, newResolved, step) -> null | string                                   the DIRECT check, made when a drag ends: both paths are built and every sample's
//        position and tangent compared bit for bit (Object.is). Returns the first sample that differs, or null.
'use strict';

const G = require('../../src/geom/index.js');

const ROUTE = Object.freeze(['length', 'k0', 'k1', 'kp0', 'kp1', 'heartline', 'heartline1']);
const ROLL = Object.freeze(['roll0', 'roll1', 'rollRate0', 'rollRate1']);   // they move the centre only when a heartline is in play
const same = (a, b) => (a === undefined || b === undefined ? a === b : Object.is(a, b));
const offsets = (doc) => JSON.stringify(doc.pieces.map((P) => [P.id, P.channels ? P.channels.h : null, P.channels ? P.channels.l : null]));

/** What moved, structured: { kind, text, id, seg, field, from, to } (kind: 'segments', 'piece', 'field', 'start', 'offsets'); null when nothing the path is made of moved. `text` is the technical sentence routeMoved returns. */
function routeMovedDetail(baseDoc, baseSegments, newDoc, newSegments, baseStart, newStart) {
  if (baseSegments.length !== newSegments.length) return { kind: 'segments', text: `the number of segments changed (${baseSegments.length} to ${newSegments.length})` };
  for (let i = 0; i < baseSegments.length; i++) {
    const a = baseSegments[i], b = newSegments[i];
    if (a.id !== b.id || a.kind !== b.kind) return { kind: 'piece', seg: i, id: a.id, text: `segment ${i} is not the same piece any more` };
    const fields = a.heartline || a.heartline1 || b.heartline || b.heartline1 ? [...ROUTE, ...ROLL] : ROUTE;
    for (const f of fields) if (!same(a[f], b[f])) return { kind: 'field', seg: i, id: a.id, field: f, from: a[f], to: b[f], text: `${a.id} (segment ${i}): ${f} moved from ${a[f]} to ${b[f]}` };
  }
  if (baseStart && newStart) for (const k of ['theta', 'p']) if (!same(baseStart[k], newStart[k])) return { kind: 'start', text: `the start ${k} moved` };
  if (baseStart && newStart) for (let k = 0; k < 3; k++) if (!same(baseStart.pos[k], newStart.pos[k])) return { kind: 'start', text: 'the start position moved' };
  if (offsets(baseDoc) !== offsets(newDoc)) return { kind: 'offsets', text: 'a height or sideways offset changed' };
  return null;
}
/** The same check as one technical sentence, or null (what the unit tests and the log read). */
function routeMoved(...a) { const d = routeMovedDetail(...a); return d ? d.text : null; }

/**
 * THE REASON IN THE KEEPER'S WORDS (D243's F3: C's look found the refusal naming an internal field, "heartline1 moved from undefined to 0"). `d` is what routeMovedDetail returns. A tube's roll axis is its own
 * centre once its sweep passes 300° (src/core/adapter.js heartlineOf), so its width, bank and sweep feed the route there; a sweep that CROSSES 300° makes that field appear.
 */
function plainWhy(d) {
  if (!d) return '';
  if (d.kind === 'field') {
    if (/^heartline|^roll/.test(d.field)) return d.from === undefined || d.to === undefined
      ? `the sweep of ${d.id} would pass 300°, where a tube starts to turn about its own centre, and that would move the road after it`
      : `${d.id} is a tube past 300° of sweep, where it turns about its own centre, so changing its sweep, width or bank would move the road after it`;
    if (d.field === 'length') return `it would change the length of ${d.id}, and that moves everything after it`;
    return `it would change the turn or climb of ${d.id}, and that steers everything after it`;
  }
  if (d.kind === 'start') return 'it would move where the track starts';
  if (d.kind === 'offsets') return 'it would change a height or sideways offset of the road';
  return 'it would change how the track is built, and that moves the road after it';
}

/** The centreline as numbers: x, y, z and the tangent at every sample, from the resolved track (segments, start, closed, lift), the way the preview builds it. */
function snapshot(resolved, step = 2) {
  const segs = resolved.segments;
  if (!segs.length) return new Float64Array(0);
  const p0 = G.buildPath(segs, { step, closed: !!resolved.closed, start: resolved.start }), p = typeof resolved.lift === 'function' ? resolved.lift(p0) : p0;
  const out = new Float64Array(p.samples.length * 6);
  p.samples.forEach((m, i) => { const pos = m.pos, T = m.T; for (let k = 0; k < 3; k++) { out[i * 6 + k] = pos[k]; out[i * 6 + 3 + k] = T[k]; } });
  return out;
}

function pathMoved(base, newResolved, step = 2) {
  const a = base instanceof Float64Array ? base : snapshot(base, step), b = snapshot(newResolved, step);
  if (a.length !== b.length) return `the centreline has ${b.length / 6} samples, it had ${a.length / 6}`;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return `sample ${Math.floor(i / 6)}: ${i % 6 < 3 ? 'position' : 'tangent'} ${'xyz'[i % 3]} moved from ${a[i]} to ${b[i]}`;
  return null;
}

module.exports = { routeMoved, routeMovedDetail, plainWhy, pathMoved, snapshot, ROUTE, ROLL };
