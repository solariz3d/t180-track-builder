// resolve.js: resolve(doc) -> { segments, closed, constraints, head }, the explicit list the geometry consumes
// (docs/INTERFACES.md §1). Pure and deterministic: the same document gives the same segments, number for number.
//
// HOW A ROAD WORD BECOMES SEGMENTS (ARCHITECTURE §2: "yaw and pitch curvature as ramped functions of s (clothoids, so
// smooth joins come by construction), roll φ(s), and a heartline offset"):
// - Its curvature OPENS over easeIn·L, from the curvature it arrives with to its peak, HOLDS, then CLOSES over
//   easeOut·L back to 0. So joins are continuous in curvature by construction. easeOut = 0 hands the peak to the next
//   word, which opens from it (Sakura's `sweep → turn → tight` steps: FINDINGS §7).
// - The peak is solved so the word turns by exactly its `turn` handle: turn = k_in·a·L/2 + k·L·(1 − a/2 − b/2).
//   Pitch works the same way from `climb`, so the pitch change across a word is exactly `climb`.
// - It is emitted as up to three segments (parts 'in', 'body', 'out'; a zero-length part is left out), each linear in
//   curvature, as INTERFACES §1's k0/k1 and kp0/kp1 are. All three carry the word's id.
// - Roll follows ONE smoothstep over the whole word, from roll0 to roll1. A part's roll0/roll1 are that smoothstep's
//   values at the part's ends. The geometry smoothsteps again inside each part, so the roll is piecewise smoothstep,
//   level at every part boundary: close to one smoothstep, not identical (a shape note for docs/INTERFACES.md).
// - The profile (INTERFACES §1 `profile`): a floor of `width`, then on each side a wall of arc length `wall` (a handle),
//   its turning angle rising linearly to ψR / ψL: u = [−(w/2 + wall), −w/2, 0, w/2, w/2 + wall], ψ = [ψR, 0, 0, 0, ψL].
//
// A JUMP becomes one segment of kind 'gap', with no surface. It flies straight in plan (no grip in the air, so the yaw
// curvature is 0), and its pitch is a clothoid solved so the flight covers `gap` m horizontally, comes down `drop` m,
// and meets the landing at pitch `land`. After it the road starts again with no curvature carried over.
//
// REFUSED, loudly (ResolveError): a roll step or a heartline step between words (both would tear the surface; a
// heartline ramp has no field in the segment shape), a jump no clothoid can fly, a jump whose take-off or flight is at
// or past vertical (JUMP_PAST_VERTICAL: the car would fly backwards; found by the soak, seed 17 op #4649), and a CLOSED document. Closing the
// loop (§2: a G1/G2 connector ranked by physics margin) needs the path's end frame, and is not built in this lap.
'use strict';

const { TEMPOS, FONTS, LANDING } = require('./vocab.js');
const jumps = require('../validate/jumps.js');
const { checkDoc } = require('./serial.js');

class ResolveError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'ResolveError'; this.code = code; }
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const TOL_ROLL = 1e-9, TOL_HEART = 1e-9;

function profileOf(font, h) {
  const wall = h.wall, w = h.width / 2;
  if (wall === 0) return { font, u: [-w, 0, w], psi: [0, 0, 0], material: 'ROAD' };
  return { font, u: [-(w + wall), -w, 0, w, w + wall], psi: [h.psiR, 0, 0, 0, h.psiL], material: 'ROAD' };
}

// Gauss–Legendre, 5 points, on 32 panels: the flight integrals ∫cos p and ∫sin p for a quadratic p(s).
const GL5 = [[-0.906179845938664, 0.2369268850561891], [-0.5384693101056831, 0.4786286704993665], [0, 0.5688888888888889],
  [0.5384693101056831, 0.4786286704993665], [0.906179845938664, 0.2369268850561891]];
function flight(p0, L, kp0, kp1) {
  let X = 0, Y = 0; const P = 32, h = L / P;
  for (let i = 0; i < P; i++) for (const [x, wt] of GL5) {
    const s = (i + 0.5 + x / 2) * h, p = p0 + kp0 * s + ((kp1 - kp0) * s * s) / (2 * L);
    X += wt * (h / 2) * Math.cos(p); Y += wt * (h / 2) * Math.sin(p);
  }
  return [X, Y];
}
/** Solve L, kp0, kp1 so the flight from pitch p0 covers X = gap, Y = −drop, and arrives at pitch `land`. */
function solveJump(p0, gap, drop, land, id) {
  const V = Math.PI / 2, deg = (x) => `${(x * 180 / Math.PI).toFixed(1)}°`;
  if (!(Math.abs(p0) < V)) throw new ResolveError('JUMP_PAST_VERTICAL', `${id}: the road before the jump is pitched ${deg(p0)}, at or past vertical; a jump takes off with its pitch inside (−90°, 90°)`);
  // the flight's pitch p(s) = p0 + kp0·s + (kp1 − kp0)s²/2L is quadratic: its extremes are at the two ends or its vertex
  const past = (L, kp0, kp1) => { const a = (kp1 - kp0) / (2 * L), pts = [0, L]; if (a !== 0) { const sv = -kp0 / (2 * a); if (sv > 0 && sv < L) pts.push(sv); } return pts.map((x) => p0 + kp0 * x + a * x * x).find((x) => !(Math.abs(x) < V)); };
  const kp1Of = (L, kp0) => (2 * (land - p0)) / L - kp0;
  const F = (L, kp0) => { const [X, Y] = flight(p0, L, kp0, kp1Of(L, kp0)); return [X - gap, Y + drop]; };
  let L = Math.hypot(gap, drop), kp0 = (land - p0) / L;
  for (let it = 0; it < 100; it++) {
    const f = F(L, kp0);
    if (Math.hypot(f[0], f[1]) < 1e-10) {
      const kp1 = kp1Of(L, kp0), bad = past(L, kp0, kp1);
      if (bad !== undefined) throw new ResolveError('JUMP_PAST_VERTICAL', `${id}: the only flight from ${deg(p0)} that lands ${gap} m on turns its pitch to ${deg(bad)}, through vertical; the car would fly backwards`);
      return { L, kp0, kp1 };
    }
    const dL = 1e-6 * Math.max(1, L), dk = 1e-8;
    const fL = F(L + dL, kp0), fk = F(L, kp0 + dk);
    const a = (fL[0] - f[0]) / dL, b = (fk[0] - f[0]) / dk, c = (fL[1] - f[1]) / dL, d = (fk[1] - f[1]) / dk, det = a * d - b * c;
    if (!(Math.abs(det) > 1e-300)) break;
    L -= (d * f[0] - b * f[1]) / det; kp0 -= (a * f[1] - c * f[0]) / det;
    if (!(L > 0) || !Number.isFinite(kp0)) break;
  }
  throw new ResolveError('JUMP_UNSOLVABLE', `${id}: no pitch clothoid flies ${gap} m across and ${drop} m down, arriving at ${land} rad`);
}

const START = Object.freeze({ kIn: 0, kpIn: 0, pitch: 0, roll: 0, heart: 0, first: true, prevId: null, prof: null });
const sameProfile = (a, b) => a.u.length === b.u.length && a.u.every((x, i) => x === b.u[i]) && a.psi.every((x, i) => x === b.psi[i]);
const flatten = (e) => (e.phrase !== undefined ? e.words.map((w, n) => ({ id: `${e.id}/${n + 1}`, ...w })) : [e]);

const flatProfile = () => profileOf('flat', { width: FONTS.flat.width, wall: 0, psiL: 0, psiR: 0 });

/**
 * Size a jump's landing ramp with VALIDATION'S OWN function, src/validate/jumps.js landingRamp(): the ramp is the line
 * from the landing lip at the landing pitch, the flight meets it exactly at each measured fall, and the ramp runs past
 * the farther touchdown by that function's margin. Its length is horizontal; along the straight ramp it is that over
 * cos(landing pitch). With no speed on the jump it is sized for the design speed: `designKmh` from the caller
 * (speedFrom 'design'), else LANDING.DEFAULT_KMH (speedFrom 'default'), and says which. A fall the car does not clear
 * adds nothing (the jump is then red in validation, not here), and `landing.why` says so.
 */
function landingRamp(lipPitch, h, speed, designKmh) {
  const own = Number.isFinite(speed) && speed > 0, given = Number.isFinite(designKmh) && designKmh > 0;
  const v = own ? speed : (given ? designKmh : LANDING.DEFAULT_KMH) / 3.6, speedFrom = own ? 'word' : given ? 'design' : 'default';
  const r = jumps.landingRamp({ D: h.gap, dh: -h.drop, thetaRad: lipPitch, landRad: h.land, v });
  const cosL = Math.cos(h.land), touchdownsM = r.touchdowns.map((t) => (t.x == null ? null : (t.x - h.gap) / cosL));
  let far = -1, sizedBy = null;
  r.touchdowns.forEach((t, i) => { if (touchdownsM[i] != null && touchdownsM[i] > far) { far = touchdownsM[i]; sizedBy = `${t.g}g`; } });
  const missed = r.touchdowns.filter((t) => t.x == null).map((t) => `${t.g} g`);
  const why = sizedBy === null ? `neither fall clears the ${h.gap} m gap at ${(v * 3.6).toFixed(0)} km/h, so the ramp is only the margin`
    : missed.length ? `at ${missed.join(' and ')} the car does not clear the gap at ${(v * 3.6).toFixed(0)} km/h` : null;
  return { length: r.length / cosL, landing: { speed: v, speedFrom, touchdownsM, sizedBy, marginM: r.length - (sizedBy === null ? 0 : far * cosL), why } };
}

/** Resolve one flat word from carried state st; pushes its segments, returns the state after it. */
function resolveWord(w, st, segments, designKmh) {
  let { kIn, kpIn, pitch, roll, heart, first, prevId, prof } = st;
  const h = w.handles, tempo = { name: w.tempo, ...TEMPOS[w.tempo] };
  if (w.word === 'jump') {
    const J = solveJump(pitch, h.gap, h.drop, h.land, w.id);
    segments.push({ id: w.id, word: 'jump', part: 'gap', kind: 'gap', length: J.L, k0: 0, k1: 0, kp0: J.kp0, kp1: J.kp1,
      roll0: roll, roll1: roll, heartline: heart, profile: null, speed: w.speed, tempo });
    // THE LANDING RAMP: road straight at the landing pitch, on the take-off road's cross-section, long enough that the
    // flight comes down on it at both measured falls (vocab.js LANDING). So the head always sits on road.
    const rampProfile = prof || flatProfile(), R = landingRamp(pitch, h, w.speed, designKmh);
    segments.push({ id: w.id, word: 'jump', part: 'land', kind: 'road', length: R.length, k0: 0, k1: 0, kp0: 0, kp1: 0,
      roll0: roll, roll1: roll, heartline: heart, profile: rampProfile, blend: null, speed: w.speed, tempo, landing: R.landing });
    return { kIn: 0, kpIn: 0, pitch: h.land, roll, heart, first: false, prevId: w.id, prof: rampProfile };
  }
  if (!first && Math.abs(h.roll0 - roll) > TOL_ROLL) throw new ResolveError('ROLL_STEP', `${w.id} starts at roll ${h.roll0} rad but ${prevId} ends at ${roll} rad: the surface would tear`);
  if (!first && Math.abs(h.heartline - heart) > TOL_HEART) throw new ResolveError('HEARTLINE_STEP', `${w.id}'s heartline ${h.heartline} m differs from ${prevId}'s ${heart} m, and a segment has no field for a heartline ramp`);
  const L = h.length, a = h.easeIn, b = h.easeOut, den = L * (1 - a / 2 - b / 2);
  const kY = (h.turn - (kIn * a * L) / 2) / den, kP = (h.climb - (kpIn * a * L) / 2) / den;
  const cuts = [0, a * L, (1 - b) * L, L];
  const parts = [['in', kIn, kY, kpIn, kP], ['body', kY, kY, kP, kP], ['out', kY, 0, kP, 0]];
  const rollAt = (s) => h.roll0 + (h.roll1 - h.roll0) * smooth(s / L), profile = profileOf(w.font, h);
  const R = Math.min(h.ramp, L), blends = !!prof && !sameProfile(prof, profile);   // a transition stays inside its word
  parts.forEach(([part, k0, k1, kp0, kp1], i) => {
    const len = cuts[i + 1] - cuts[i];
    if (!(len > 0)) return;
    const blend = blends && cuts[i] < R ? { from: prof, s0: cuts[i], length: R } : null;
    segments.push({ id: w.id, word: w.word, part, kind: 'road', length: len, k0, k1, kp0, kp1,
      roll0: rollAt(cuts[i]), roll1: rollAt(cuts[i + 1]), heartline: h.heartline, profile, blend, speed: w.speed, tempo });
  });
  return { kIn: b > 0 ? 0 : kY, kpIn: b > 0 ? 0 : kP, pitch: pitch + h.climb, roll: h.roll1, heart: h.heartline, first: false, prevId: w.id, prof: profile };
}

/**
 * Resolve doc.words from entry i0 on, given the segments and state before it. `marks[i]` records, for each entry,
 * where its segments start and the state it opened from, so a later edit can restart at the first entry it changed.
 */
function resolveTail(doc, i0, segsBefore, stBefore, marksBefore, designKmh) {
  const segments = segsBefore.slice(), marks = marksBefore.slice(0, i0);
  let st = stBefore;
  for (let i = i0; i < doc.words.length; i++) {
    const e = doc.words[i];
    marks.push(Object.freeze({ entry: e, segStart: segments.length, state: st }));
    for (const w of flatten(e)) st = resolveWord(w, st, segments, designKmh);
  }
  const lastEntry = doc.words[doc.words.length - 1], lastWord = lastEntry ? flatten(lastEntry).slice(-1)[0] : null;
  return { segments, closed: false, constraints: doc.constraints, resolvedFrom: i0, marks, designSpeedKmh: designKmh === undefined ? null : designKmh,
    head: { id: lastEntry ? lastEntry.id : null, word: lastWord ? lastWord.word : null, k: st.kIn, kp: st.kpIn, pitch: st.pitch, roll: st.roll }, _end: st };
}

function openCheck(doc) {
  checkDoc(doc);
  if (doc.closed) throw new ResolveError('CLOSE_NOT_BUILT', 'the document is closed, and the closing connector (ARCHITECTURE §2 "Closing the loop") is not built yet; resolve an open document');
}

/**
 * resolve(doc, { designSpeedKmh }): a jump with no speed of its own sizes its landing ramp for designSpeedKmh (D179: the
 * app's speed slider), or for LANDING.DEFAULT_KMH when none is given. Nothing else reads it.
 */
function designOf(opts) {
  const k = opts && opts.designSpeedKmh;
  if (k === undefined || k === null) return undefined;
  if (!(Number.isFinite(k) && k > 0)) throw new ResolveError('BAD_DESIGN_SPEED', `the design speed must be a positive number of km/h, got ${k}`);
  return k;
}
function resolve(doc, opts) { openCheck(doc); return resolveTail(doc, 0, [], START, [], designOf(opts)); }

/**
 * Incremental resolve (the build head, docs/INTERFACES.md §4): re-resolve only from the first entry that differs
 * from the previous document. Documents are immutable and edits reuse untouched entries, so "differs" is object
 * identity. The segments before that point are the previous result's own objects, unchanged. The result is equal,
 * field for field, to a full resolve (tested).
 */
function resolveFrom(prev, doc, opts) {
  openCheck(doc);
  const designKmh = designOf(opts);
  // a different design speed resizes every jump's ramp, so nothing of the previous result is kept
  if (!prev || !Array.isArray(prev.marks) || !Array.isArray(prev.segments) || (prev.designSpeedKmh === undefined ? null : prev.designSpeedKmh) !== (designKmh === undefined ? null : designKmh)) return resolve(doc, opts);
  let i0 = 0;
  const n = Math.min(prev.marks.length, doc.words.length);
  while (i0 < n && prev.marks[i0].entry === doc.words[i0]) i0++;
  if (i0 === prev.marks.length && i0 === doc.words.length) return prev;          // nothing changed
  const segStart = i0 < prev.marks.length ? prev.marks[i0].segStart : prev.segments.length;
  const st = i0 < prev.marks.length ? prev.marks[i0].state : prev._end;
  return resolveTail(doc, i0, prev.segments.slice(0, segStart), st, prev.marks, designKmh);
}

module.exports = { resolve, resolveFrom, ResolveError, solveJump, flight, profileOf };
