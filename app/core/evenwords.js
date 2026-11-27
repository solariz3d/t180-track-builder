// evenwords.js: what Even says when it lands (D678), with no DOM. evenWords(before, res) reads the checker on the track before and after the level
// (src/validate validate, the centre line's load with the car's downforce at the checker's speed, as the track checker reads it: open tracks at the lap
// sim's cap) and says, in plain words, where the car now leaves the road on the new middle and did not on the old one.
//
// WHY THE SENTENCE (D678 probe 3, lighthouse exo_memory/handback/p-d678-even-banked-probe3-A_2026-11-27.md, section 4): where the bank ROLLS along the run,
// a line beside the centre rises and falls with the roll, and the bank turns about the centre, not about that line. So a road can already throw a car off
// along the new middle's line while its old middle holds. The level adds no bump of its own there, but its new middle runs on that line. The sentence carries
// three figures: how far the middle moved; that line's load on the track as it stood (the old road with its middle moved by the level, its width as it was);
// and the old middle's load. Where the line held on the old road too, the red is the level's own (on a cupped road it moves the bottom of the dish onto the
// line), and the sentence says that instead.
'use strict';
const AD = require('../../src/core/adapter.js');
const V = require('../../src/validate/index.js');

const VOPTS = Object.freeze({ csp: true, fullSpeed: true, leanLines: true });
const km = (s) => `${(s / 1000).toFixed(2)} km`;
const gWords = (x) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(1)} g`;

/** The centre line's load (g, with the downforce) at each station of the checker's path: Map s -> load. */
function centreLoads(doc) {
  const tp = AD.toPath(doc, { step: 2 }), r = V.validate(tp.path, tp.segments, VOPTS), m = new Map();
  for (const ln of r.lines) if (ln.u === 0) m.set(ln.s, ln.fHold_g !== undefined ? ln.fHold_g : ln.fN_g);
  return m;
}

/** The track as it stood with the level's middle: `before`'s pieces with the sideways offset and height of `after` (the width as it was). */
function middleOnly(before, after) {
  const pieces = before.pieces.map((P, p) => {
    const A = after.pieces[p]; if (A === P || P.type !== 'road') return P;
    return { ...P, channels: { ...P.channels, l: A.channels.l, h: A.channels.h } };
  });
  return Object.freeze({ ...before, pieces });
}

/**
 * The stations in the level's window where the car leaves the road on the new middle and held on the old one; null when there are none.
 * Returns { from, to, at, shift, line, old, own } (lap distance in m; shift in m; loads in g): `at` the worst such station, `line` the new middle's line on the
 * track as it stood, `old` the old middle there, `own` true when that line held on the old road too (the red is the level's own).
 */
function newLeaves(before, res) {
  const a = centreLoads(before), b = centreLoads(res.doc), { w0, w1 } = res.window, hit = [];
  for (const [s, v] of b) if (s >= w0 - 1e-9 && s <= w1 + 1e-9 && v < 0 && a.has(s) && a.get(s) >= 0) hit.push([s, v]);
  if (!hit.length) return null;
  const worst = hit.reduce((m, x) => (x[1] < m[1] ? x : m)), at = worst[0];
  const line = centreLoads(middleOnly(before, res.doc)).get(at);
  return { from: hit[0][0], to: hit[hit.length - 1][0], at, shift: Math.abs(res.shiftAt(at)), line, old: a.get(at), own: !(line < 0) };
}

/** The message after a level: { message, leaves (newLeaves's, or null) }. */
function evenWords(before, res) {
  const where = res.hold === 'centre' ? 'the middle stays where it was' : `the ${res.hold} edge stays where it was`;
  const { lo, hi, w0, w1 } = res.window, a = Math.round(lo - w0), b = Math.round(w1 - hi);
  const eased = a === b ? `over the ${a} m either side` : !b ? `over the ${a} m before it (it ends at the open end)` : !a ? `over the ${b} m after it (it starts at the track's start)` : `over the ${a} m before it and the ${b} m after`;
  const done = `Even: ${res.value} m wide from ${km(lo)} to ${km(hi)}, eased back to the road ${eased}; ${where} (Ctrl+Z puts it back).`;
  const x = newLeaves(before, res);
  if (!x) return { message: done, leaves: null };
  const span = x.from === x.to ? `at ${km(x.from)}` : `from ${km(x.from)} to ${km(x.to)}`;
  const moved = `The bank rolls there, and the middle has moved ${x.shift.toFixed(1)} m to one side`;
  const said = x.own
    ? `${moved}, taking the bottom of the road's dish with it: on the track as it stood, that line read ${gWords(x.line)} at ${km(x.at)} and the old middle ${gWords(x.old)}.`
    : `${moved}: on the track as it stood, a car on that line already leaves the road at ${km(x.at)} (${gWords(x.line)}), and on the old middle it did not (${gWords(x.old)}), because the bank turns about the middle. Even adds no bump of its own there.`;
  return { message: `${done} But ${span} the car now leaves the road on the new middle at the checker's speed. ${said} A longer bank change there, or a run that ends before it, would clear it.`, leaves: x };
}

module.exports = { evenWords, newLeaves, centreLoads, middleOnly, VOPTS };
