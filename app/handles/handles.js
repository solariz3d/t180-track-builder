// handles.js: sculpt handles with live physics bounds (the keeper, 12:22: "you can also sculp pieces"; ARCHITECTURE §2
// "Handles: the continuous parameters sculpt mode drags, bounded live by physics"; docs/INTERFACES.md §4b).
//
//   SCULPT                                  the handles this app exposes, grouped as the plan names them
//   handlesOf(doc, id, { bounds })          -> A's handleInfo (value, unit, range) + E's bounds, per handle present on the word
//   startDrag(target, id, handle, { bounds, pastRed })    -> drag       target: a history (src/doc/history.js), or the
//                                                                       app shell (app/shell.js beginDrag/dragTo/endDrag)
//     drag.move(value) -> { history, value, asked, clamped, level: 'clean' | 'amber' | 'red' | 'refused', why }
//     drag.end()       -> history           ONE undo entry for the whole drag (src/doc/history.js beginDrag/dragTo/endDrag)
//     drag.cancel()    -> history           the document as it was before the drag, no entry
//
// A DRAG STOPS AT RED, AND PASSES AMBER. ARCHITECTURE §1.3: "Guardrails, not gates … Red is kept for what is known to
// break; amber means 'no track has proven this yet'." So amber never blocks: the drag goes on and the handle shows
// amber. Red is known breakage, and the export refuses it (src/export/fromwords.js RED), so a drag that would make the
// word red is CLAMPED to the last clean value, and `why` names the limit that stopped it. `pastRed: true` (e.g. a held
// key) lets the drag through and shows red instead, for a user who will fix the neighbour next. §2 :46 "bounded live by
// physics" reads as the clamp; §1.3 as the colour. The clamp is the default because only red is a known break.
//
// WHERE THE BOUNDS COME FROM: src/validate/bounds.js handleBounds, the same validation the colour uses, once per drag
// (or passed in by the caller, who may have computed them when the word was selected). During the drag each move is a
// clamp and one editWord: no validation, no bounds search, and no mesh data crosses IPC (§9). The preview rebuilds from
// the dragged document in the UI process. COST, measured on D (D166 addendum 2): about 2.3 s per handle on one tight
// word (27.3 s for 12). That is a selection-time cost, not a per-move one; it is NOT live-speed.
//
// ROLL. A's resolve refuses a roll step between words (ROLL_STEP), so on a middle word roll0/roll1 are refused, and only
// the head's roll1 is draggable. The bounds report that as `refused`, and so does a drag.
'use strict';
const D = require('../../src/doc/index.js');
const { handleInfo } = require('../../src/doc/library.js');
const { beginDrag, dragTo, endDrag } = require('../../src/doc/history.js');
const { handleBounds } = require('../../src/validate/bounds.js');

// The plan's list (CORRECTED block, 12:22): length, curvature and its ramps, pitch, roll/bank, width, wall height, ψ,
// and the font transition (`ramp`, the metres over which a font blends in: src/geom/mesh.js FONT RAMPS).
const SCULPT = Object.freeze({
  length: ['length'], curvature: ['turn'], ramps: ['easeIn', 'easeOut'], pitch: ['climb'], bank: ['roll0', 'roll1'],
  width: ['width'], wall: ['wall'], psi: ['psiL', 'psiR'], transition: ['ramp'],
});
const ALL = Object.freeze(Object.values(SCULPT).flat());

/** Every sculpt handle present on word `id`: A's value, unit and range, with E's bounds (computed unless given). */
function handlesOf(doc, id, { bounds, validate: vopts, step } = {}) {
  const w = doc.words.find((x) => x.id === id);
  if (!w) throw new Error(`handlesOf: no word "${id}"`);
  const names = ALL.filter((h) => h in w.handles);
  const b = bounds || handleBounds(doc, id, { handles: names, step, validate: vopts });
  const info = handleInfo(doc, id, () => b);
  return Object.fromEntries(names.map((h) => [h, { ...info.handles[h], bounds: info.physics.handles[h] }]));
}

/**
 * Clamp a value to a handle's bounds. Returns { value, clamped, level, why, stop }: `why` is the technical reason (ids and
 * sources, for tooltips and tests); `stop` { at, reasons, sources } when a red bound stopped it, for the panel's plain words.
 */
function clampTo(b, v, pastRed) {
  if (b.min == null || b.max == null) return { value: v, clamped: false, level: 'red', why: 'the word is already red: there is no clean range to hold to' };
  if (v > b.max || v < b.min) {
    const stop = v > b.max ? b.above : b.below;
    const why = stop.kind === 'red' ? `stopped at ${v > b.max ? b.max : b.min}: past it the track is red: ${stop.reasons.join(', ')} (${stop.sources.join(', ')})`
      : stop.kind === 'refused' ? `refused by the document: ${stop.message}` : `the handle's range ends at ${v > b.max ? b.max : b.min}`;
    const stopAt = stop.kind === 'red' ? { at: v > b.max ? b.max : b.min, reasons: stop.reasons, sources: stop.sources } : null;
    if (pastRed && stop.kind === 'red') return { value: v, clamped: false, level: 'red', why, stop: stopAt };
    return { value: v > b.max ? b.max : b.min, clamped: true, level: amberLevel(b, v > b.max ? b.max : b.min), why, stop: stopAt };
  }
  return { value: v, clamped: false, level: amberLevel(b, v), why: null };
}
const amberLevel = (b, v) => (b.amberMin == null || b.amberMax == null || v > b.amberMax || v < b.amberMin ? 'amber' : 'clean');

/** A drag target over a bare history: every move edits the drag's base document. */
function historyPort(history) {
  const base = history.present;
  let h = beginDrag(history);
  return {
    base, history: () => h, current: () => h.present,
    to(id, patch) { h = dragTo(h, D.editWord(base, id, patch)); return h; },   // a DocError propagates to move()
    end() { const out = endDrag(h); h = null; return out; },
    cancel() { const out = endDrag(dragTo(h, base)); h = null; return out; },
  };
}
/** A drag target over the app shell. The shell turns a model error into state.message and returns null. */
function shellPort(shell) {
  const base = shell.getState().history.present;
  if (!shell.beginDrag()) throw new Error(`startDrag: the shell refused to begin a drag: ${shell.getState().message}`);
  return {
    base, history: () => shell.getState().history, current: () => shell.getState().history.present,
    to(id, patch) { const st = shell.dragTo(id, patch); if (!st) throw new D.DocError('REFUSED', shell.getState().message); return st.history; },
    end() { shell.endDrag(); return shell.getState().history; },
    // The shell has no cancel: moving back to the base values and ending leaves ONE no-op entry (seam for app/shell.js)
    cancel() { const w = base.words.find((x) => x.id === this.id); shell.dragTo(this.id, { handles: { [this.handle]: w.handles[this.handle] } }); shell.endDrag(); return shell.getState().history; },
  };
}

function startDrag(target, id, handle, { bounds, pastRed = false, validate: vopts, step } = {}) {
  if (!ALL.includes(handle)) throw new Error(`startDrag: "${handle}" is not a sculpt handle (${ALL.join(', ')})`);
  const isShell = typeof target.getState === 'function';
  const base = isShell ? target.getState().history.present : target.present;
  const b = (bounds && bounds.handles ? bounds : handleBounds(base, id, { handles: [handle], step, validate: vopts })).handles[handle];
  if (!b) throw new Error(`startDrag: word "${id}" has no handle "${handle}"`);
  const port = isShell ? Object.assign(shellPort(target), { id, handle }) : historyPort(target);
  return {
    bounds: b,
    move(asked) {
      const c = clampTo(b, asked, pastRed);
      // A refusal (the document will not take the value) keeps the last good state and says why; it is not swallowed
      try { port.to(id, { handles: { [handle]: c.value } }); } catch (e) {
        if (!(e instanceof D.DocError)) throw e;
        return { history: port.history(), asked, value: port.current().words.find((x) => x.id === id).handles[handle], clamped: true, level: 'refused', why: e.message };
      }
      return { history: port.history(), asked, ...c };
    },
    end() { return port.end(); },
    cancel() { return port.cancel(); },
  };
}

module.exports = { SCULPT, ALL, handlesOf, startDrag, clampTo };
