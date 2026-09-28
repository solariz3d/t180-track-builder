// guide.js: the guided first track as a STEP MACHINE, with no DOM (ARCHITECTURE §11.7; the keeper: the USER builds the
// track, and the guide only shows the moves).
//
//   STEPS                              [{ id, title, text, target, done(state, seen) | null }]
//   createGuide({ onChange })           -> guide
//     guide.state -> { index, step, status: 'active' | 'finished', done: { <id>: true }, skipped: { <id>: true } }
//     guide.next() / guide.back() / guide.skip() / guide.finish()
//     guide.observe(shellState)          marks a step done when the user has made that move (never makes it for them)
//
// THE RULES:
//   · every step is SHORT (one sentence of what to do, one of why) and SKIPPABLE, and the whole guide can be finished at
//     any step: it never blocks the expert path. It holds no lock on the app, and the app works the same with it closed;
//   · a step is DONE when the user has done the move, seen in the shell's own state (a word placed, a handle dragged,
//     the loop closed, a folder exported). Doing it advances the guide; the guide itself never places, drags, closes or
//     exports anything;
//   · the colours step has no move to see (reading is not an action), so it is done by pressing Next.
'use strict';

const PLACE_AT_LEAST = 3;   // words on the track before "place a few pieces" is done (inferred: "a few")

/** Every word on the track, phrase words counted one by one. */
const wordCount = (doc) => doc.words.reduce((a, e) => a + (e.phrase !== undefined ? e.words.length : 1), 0);

const STEPS = Object.freeze([
  { id: 'place', title: 'Place a few pieces', target: '#palette',
    text: `Pick a word or a starter phrase in the palette (try "sakura flow"). The track grows from its open end, and the build view follows it. Done at ${PLACE_AT_LEAST} words.`,
    done: (st) => wordCount(st.history.present) >= PLACE_AT_LEAST },
  { id: 'sculpt', title: 'Sculpt one handle', target: '#handles',
    text: 'Click one placed word in the track list, then drag one of its handles. A starter phrase has no handles here yet, so place a single word (e.g. "turn") if you have only phrases. A drag stops where the track would break (red); amber is allowed.',
    done: (st, seen) => seen.sculpted },
  { id: 'close', title: 'Close the loop', target: '#palette',
    text: 'Press "Close the loop". The connector adds the closing words, choosing the candidate with the most physics margin, not the shortest.',
    done: (st) => st.history.present.closed === true },
  { id: 'colours', title: 'Read the colours', target: '#validation',
    text: 'Red is known to break, and the track will not export until it is gone. Amber is past what any track has proven (a load over 90 g, or a seam sharper than measured), allowed but untested. Each one is listed with its reason and source.',
    done: null },
  { id: 'export', title: 'Export', target: '#export',
    text: 'Press "Export…" and pick a folder. It writes an Assetto Corsa track folder there; nothing is installed and the game is not launched.',
    done: (st, seen) => seen.exported },
].map((s) => Object.freeze(s)));

function createGuide({ onChange = () => {} } = {}) {
  let index = 0, status = 'active';
  const done = {}, skipped = {}, seen = { sculpted: false, exported: false };
  let last = null;   // the previous shell state, to tell a sculpt from a placement
  const state = () => ({ index, step: status === 'active' ? STEPS[index] : null, status, done: { ...done }, skipped: { ...skipped } });
  const emit = () => { onChange(state()); return state(); };
  const step1 = () => { if (index < STEPS.length - 1) index++; else status = 'finished'; };
  // moving forward passes over a step the user has already done (a loop closed early is not asked for again);
  // going BACK does not, so a user can look again at a step they did
  const advance = () => { step1(); while (status === 'active' && done[STEPS[index].id]) step1(); };

  return {
    get state() { return state(); },
    next() {
      if (status !== 'active') return state();
      if (!STEPS[index].done) done[STEPS[index].id] = true;   // a reading step is done by reading it
      advance(); return emit();
    },
    back() { if (status === 'active' && index > 0) index--; return emit(); },
    skip() { if (status !== 'active') return state(); skipped[STEPS[index].id] = true; advance(); return emit(); },
    finish() { status = 'finished'; return emit(); },
    /** Look at the shell's state: the user's own moves mark steps done, and the current step's completion advances. */
    observe(st) {
      if (!st || !st.history) return state();
      const cur = st.history.present, prev = last && last.history.present;
      // a SCULPT: the same number of entries, and at least one existing entry replaced (placing adds an entry instead)
      if (prev && cur !== prev && cur.words.length === prev.words.length && cur.words.some((e, i) => e !== prev.words[i])) seen.sculpted = true;
      if (st.lastExport && (!last || st.lastExport !== last.lastExport)) seen.exported = true;
      last = st;
      let moved = false;
      for (const s of STEPS) if (s.done && !done[s.id] && s.done(st, seen)) { done[s.id] = true; moved = true; }
      if (status === 'active' && done[STEPS[index].id]) { advance(); moved = true; }
      return moved ? emit() : state();
    },
  };
}

module.exports = { STEPS, createGuide, PLACE_AT_LEAST, wordCount };
