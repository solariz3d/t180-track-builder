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
//
// AFTER THE RELEASE, OFF THE PAGE (D678 repair, U6: on a 27.6 km closed lap the release's check took 33 s, three whole-track validates). The shell says the
// first sentence (evenDone) at once and runs evenCheck(request) as a job (app/validate-ui/checkjob.js evenCheck, in a Web Worker): plain data in, { message,
// leaves } out. The job reads the loads only at the stations inside the level's window (src/validate linesBetween: the same loads there, the speed profile still
// the whole track's), so its words equal the whole-track check's (evenWords with no window, the on-page check the rows compare against).
'use strict';
const D = require('../../src/core/document.js');
const AD = require('../../src/core/adapter.js');
const V = require('../../src/validate/index.js');
const EV = require('../../src/core/even.js');

const VOPTS = Object.freeze({ csp: true, fullSpeed: true, leanLines: true });
const km = (s) => `${(s / 1000).toFixed(2)} km`;
const gWords = (x) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(1)} g`;

/** The centre line's load (g, with the downforce) at each station of the checker's path: Map s -> load. With `win` ({ w0, w1 }), the stations inside it only. */
function centreLoads(doc, win = null) {
  const tp = AD.toPath(doc, { step: 2 }), m = new Map();
  const lines = win ? V.linesBetween(tp.path, tp.segments, win.w0, win.w1, VOPTS) : V.validate(tp.path, tp.segments, VOPTS).lines;
  for (const ln of lines) if (ln.u === 0) m.set(ln.s, ln.fHold_g !== undefined ? ln.fHold_g : ln.fN_g);
  return m;
}

/**
 * The track as it stood with the level's middle: `before`'s pieces with the sideways offset and height of `after` (the width as it was). Even cuts the knots over its
 * window's reaches (src/core/even.js refineEnds), so a piece of `before` is first cut to the knots of its piece in `after` (document.js insertKnotsRoundOnce: the
 * road as it was, within half a stored step) and only then takes l and h, which are control points on those knots.
 */
function middleOnly(before, after) {
  const pieces = before.pieces.map((P, p) => {
    const A = after.pieces[p]; if (A === P || P.type !== 'road') return P;
    const C = D.insertKnotsRoundOnce(P, A.knots.filter((k) => !P.knots.includes(k)));
    return { ...C, channels: { ...C.channels, l: A.channels.l, h: A.channels.h } };
  });
  return Object.freeze({ ...before, pieces });
}

/**
 * The stations in the level's window where the car leaves the road on the new middle and held on the old one; null when there are none.
 * Returns { from, to, at, shift, line, old, own } (lap distance in m; shift in m; loads in g): `at` the worst such station, `line` the new middle's line on the
 * track as it stood, `old` the old middle there, `own` true when that line held on the old road too (the red is the level's own). `bounded`: the loads read only
 * inside the window (the job's), not along the whole track (the same loads there).
 */
function newLeaves(before, res, { bounded = false } = {}) {
  const win = bounded ? res.window : null;
  const a = centreLoads(before, win), b = centreLoads(res.doc, win), { w0, w1 } = res.window, hit = [];
  for (const [s, v] of b) if (s >= w0 - 1e-9 && s <= w1 + 1e-9 && v < 0 && a.has(s) && a.get(s) >= 0) hit.push([s, v]);
  if (!hit.length) return null;
  const worst = hit.reduce((m, x) => (x[1] < m[1] ? x : m)), at = worst[0];
  const line = centreLoads(middleOnly(before, res.doc), win).get(at);
  return { from: hit[0][0], to: hit[hit.length - 1][0], at, shift: Math.abs(res.shiftAt(at)), line, old: a.get(at), own: !(line < 0) };
}

/**
 * The first sentence after a level, said at once: what it did, where, and what became of the edges.
 * D678 repair (the librarian's 15:4x ruling, item 3): no sentence may say an edge "stays where it is" over code that moves it. The kept edge is laid where Even
 * READS the road's own edge from the stretch's ends (src/core/even.js evenIn: restOf and the agree rule), which can be metres from where it was; the middle
 * ('centre') is laid smooth between the stretch's ends. And the stretch: the width is the value over the run and back to the road WITHIN the window's reach
 * beyond each end (50 m, more before it at the carry side). Not "20 m at the value, then a 30 m ease": the margin is at the value to 0.01 m where the road beyond
 * it is within about 5 m of the value, but a road farther off leaks into the margin's outer metre (0.0288 m for a 31 m lead levelled to 16; lighthouse
 * exo_memory/handback/p-d678-even-build-A_2026-11-27.md, section 5.3).
 * D678 (the packet's "Amended 17:4x" item 1): BEYOND THE STRETCH the road's width, line and height are as they were to a tenth of a millimetre. Even cuts the knots over the window's reaches
 * (src/core/even.js refineEnds), so outside the window every channel is within one stored step (1e-4 m in width, offset and height), not bit for bit; measured
 * on a 27.6 km closed lap, the built road moved at most 0.0123 mm there and its rims 3e-9 m (the hand-back's 5.3). Not "the road as drawn": where a 2 m
 * segment of the built road had the same cross-section at its two ends with a bump between (a grab's peak), a change within the step can make the builder
 * draw it as a chord (src/core/adapter.js legacySeg), 1.03 cm narrower at the peak (measured on the banked fixture after a grab 5 m outside the window).
 */
function evenDone(res) {
  const where = res.hold === 'centre' ? 'the middle is laid smooth between the stretch\'s ends, and both edges move' : `the ${res.hold} edge is laid where Even reads the road's own edge from the stretch's ends, so it can move`;
  const { lo, hi, w0, w1 } = res.window, a = Math.round(lo - w0), b = Math.round(w1 - hi), full = EV.EVEN_MARGIN_M + EV.EVEN_RAMP_M;
  // a window end cut short by the track's start or its open end
  const before = a < 1 ? 'from the track\'s start' : a < full ? `eased toward the road over the ${a} m to the track's start` : `back to the road within ${a} m before it`;
  const after = b < 1 ? 'to the open end' : b < full ? `eased toward the road over the ${b} m to the open end` : `back to the road within ${b} m after it`;
  const eased = a >= full && b >= full && a === b ? `back to the road within ${a} m either side` : `${before}, and ${after}`;
  return `Even: ${res.value} m wide from ${km(lo)} to ${km(hi)}, ${eased}; ${where}; beyond the stretch the road's width, line and height are as they were, to a tenth of a millimetre (Ctrl+Z puts it back).`;
}

/** The message after a level: { message, leaves (newLeaves's, or null) }. With no options, the whole track's check (the on-page check); `bounded`, the job's. */
function evenWords(before, res, opts = {}) {
  const done = evenDone(res);
  const x = newLeaves(before, res, opts);
  if (!x) return { message: done, leaves: null };
  const span = x.from === x.to ? `at ${km(x.from)}` : `from ${km(x.from)} to ${km(x.to)}`;
  const moved = `The bank rolls there, and the middle has moved ${x.shift.toFixed(1)} m to one side`;
  const said = x.own
    ? `${moved}, taking the bottom of the road's dish with it: on the track as it stood, that line read ${gWords(x.line)} at ${km(x.at)} and the old middle ${gWords(x.old)}.`
    : `${moved}: on the track as it stood, a car on that line already leaves the road at ${km(x.at)} (${gWords(x.line)}), and on the old middle it did not (${gWords(x.old)}), because the bank turns about the middle. Even adds no bump of its own there.`;
  return { message: `${done} But ${span} the car now leaves the road on the new middle at the checker's speed. ${said} A longer bank change there, or a run that ends before it, would clear it.`, leaves: x };
}

/**
 * THE JOB (plain data in and out, for a Web Worker): `req` { before, after (documents), window { lo, hi, w0, w1 }, value, hold }, as the shell sends it after a
 * level. Returns evenWords' { message, leaves }, the loads read inside the window only. Throws on a request that is not one.
 */
function evenCheck(req) {
  const { before, after, window: win, value, hold } = req || {};
  if (!before || !Array.isArray(before.pieces) || !after || !Array.isArray(after.pieces)) throw new Error('Even\'s check needs the track before and after the level');
  if (!win || ![win.lo, win.hi, win.w0, win.w1].every(Number.isFinite) || !(win.w0 <= win.w1)) throw new Error('Even\'s check needs the level\'s window');
  return evenWords(before, { doc: after, window: win, value, hold, shiftAt: EV.shiftOf(before, after) }, { bounded: true });
}

module.exports = { evenWords, evenDone, evenCheck, newLeaves, centreLoads, middleOnly, VOPTS };
