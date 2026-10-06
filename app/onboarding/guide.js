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
//   · a step is DONE when the user has done the move, seen in the shell's own state (pieces extended, a brush stroke, the
//     loop closed, a folder exported). Doing it advances the guide; the guide itself never extends, brushes, closes or
//     exports anything;
//   · the colours and the grid-and-mirror steps have no move to see (reading is not an action, and the grid lives in the
//     preview, not in the track), so each is done by pressing Next.
// D239 (the keeper: "can we keep only the equation mode?"): the steps are the EQUATION builder's (app/core): Extend, the brush,
// Close the loop, the colours, Export, the grid and mirror. The piece builder's wording (words, starter phrases, handles, the
// connector) went with the Pieces page.
'use strict';

const EXTEND_AT_LEAST = 3;   // pieces on the track before "extend a few pieces" is done (inferred: "a few")

/** The pieces on a core track (src/core/document.js: doc.pieces). */
const pieceCount = (doc) => (doc && Array.isArray(doc.pieces) ? doc.pieces.length : 0);

const STEPS = Object.freeze([
  { id: 'extend', title: 'Extend a few pieces', target: '#palette',
    text: `Under "Extend at the head", set a length and a turn (or leave them), then press Extend. Each piece grows the track from its open end. Done at ${EXTEND_AT_LEAST} pieces; give at least one a turn, or there is nothing to close. To take pieces out, click them on the track (Shift-click for a run) and press "Delete selected": at the end of the track that makes no backup, so Ctrl+Z is the only way back; in the middle you see a preview first and the track is copied to its backups before it is applied.`,
    done: (st) => pieceCount(st.history.present) >= EXTEND_AT_LEAST },
  { id: 'brush', title: 'Brush the track', target: '#palette',
    text: 'Tick "on" under "Brush", pick what to change (turn, bank, width, …), then drag on the track in the preview. The brush bends the track smoothly around where you drag; a stroke stops where the track would break (red).',
    done: (st, seen) => seen.brushed },
  { id: 'close', title: 'Close the loop', target: '#palette',
    text: 'Press "Close the loop". The solver bends the pieces you edited least so the end meets the start, smoothly. A track of straights cannot close: it needs a turn.',
    done: (st) => st.history.present.closed === true },
  { id: 'colours', title: 'Read the colours', target: '#validation',
    text: 'Red is known to break, and the track will not export until it is gone. Amber is past what any track has proven (a load over 90 g, or a seam sharper than measured), allowed but untested. Each one is listed with its reason and source.',
    done: null },
  { id: 'export', title: 'Export', target: '#install',
    text: 'Press "Export to Assetto Corsa". It writes the track straight into the game, in the Assetto Corsa folder chosen at the first start (found through Steam); exporting the same track again updates it. The ⋯ menu beside it has Export… (into any folder you pick, nothing installed), the test export of an unfinished track, the Assetto Corsa folder, and See it in Assetto.',
    done: (st, seen) => seen.exported },
  { id: 'grid', title: 'The grid and the mirror', target: '#camera',
    text: 'Under the preview, Grid shows the ground or a 3D lattice once the track climbs; Mirror draws the symmetry axes and reads the mirror gap, the number "make it symmetrical" drives to zero. Drag the centre handle to move the axes. To fly the camera: W A S D, Space up and Left Ctrl down (Q and E too), Shift to go faster, the right button to look.',
    done: null },
].map((s) => Object.freeze(s)));

function createGuide({ onChange = () => {} } = {}) {
  let index = 0, status = 'active';
  const done = {}, skipped = {}, seen = { brushed: false, exported: false };
  let last = null;   // the previous shell state, to see an export that is new
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
      // a BRUSH STROKE: the core shell names the step it took (app/core/coreshell.js lastStep.op 'brush:<mode>')
      if (st.lastStep && typeof st.lastStep.op === 'string' && st.lastStep.op.startsWith('brush:')) seen.brushed = true;
      if (st.lastExport && (!last || st.lastExport !== last.lastExport)) seen.exported = true;
      last = st;
      let moved = false;
      for (const s of STEPS) if (s.done && !done[s.id] && s.done(st, seen)) { done[s.id] = true; moved = true; }
      if (status === 'active' && done[STEPS[index].id]) { advance(); moved = true; }
      return moved ? emit() : state();
    },
  };
}

module.exports = { STEPS, createGuide, EXTEND_AT_LEAST, pieceCount };
