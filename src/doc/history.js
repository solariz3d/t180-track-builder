// history.js: undo as the document's history (ARCHITECTURE §2: "Undo is the document's history (immutable snapshots or
// patches), and a whole drag is one entry"). Snapshots: every document is frozen (document.js), so keeping the object
// IS keeping the state, and undo hands back the very object, byte-identical when serialised.
//
//   let h = createHistory(doc);
//   h = commit(h, appendWord(h.present, 'turn'));        one entry
//   h = beginDrag(h); h = dragTo(h, d1); h = dragTo(h, d2); h = endDrag(h);   one entry for the whole drag
//   h = undo(h); h = redo(h);
// Every function returns a new history; none mutates. A new commit clears the redo side, as editors do.
'use strict';

const { checkDoc } = require('./serial.js');

class HistoryError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'HistoryError'; this.code = code; }
}
const freeze = (h) => Object.freeze(h);

function createHistory(doc) { return freeze({ past: Object.freeze([]), present: checkDoc(doc), future: Object.freeze([]), dragBase: null }); }

function commit(h, doc) {
  if (h.dragBase) throw new HistoryError('IN_DRAG', 'a drag is open: dragTo or endDrag it first');
  if (doc === h.present) return h;
  return freeze({ past: Object.freeze([...h.past, h.present]), present: checkDoc(doc), future: Object.freeze([]), dragBase: null });
}

function beginDrag(h) {
  if (h.dragBase) throw new HistoryError('IN_DRAG', 'a drag is already open');
  return freeze({ ...h, dragBase: h.present });
}
/** Move the drag's live state. Not an entry: the history does not grow until endDrag. */
function dragTo(h, doc) {
  if (!h.dragBase) throw new HistoryError('NO_DRAG', 'dragTo needs beginDrag first');
  return freeze({ ...h, present: checkDoc(doc) });
}
/** Close the drag as ONE entry: undo goes back to the state before the drag began. A drag that changed nothing adds none. */
function endDrag(h) {
  if (!h.dragBase) throw new HistoryError('NO_DRAG', 'endDrag needs beginDrag first');
  if (h.present === h.dragBase) return freeze({ ...h, dragBase: null });
  return freeze({ past: Object.freeze([...h.past, h.dragBase]), present: h.present, future: Object.freeze([]), dragBase: null });
}

function undo(h) {
  if (h.dragBase) throw new HistoryError('IN_DRAG', 'end the drag before undoing');
  if (h.past.length === 0) throw new HistoryError('NOTHING_TO_UNDO', 'the history is at its start');
  return freeze({ past: Object.freeze(h.past.slice(0, -1)), present: h.past[h.past.length - 1], future: Object.freeze([h.present, ...h.future]), dragBase: null });
}
function redo(h) {
  if (h.dragBase) throw new HistoryError('IN_DRAG', 'end the drag before redoing');
  if (h.future.length === 0) throw new HistoryError('NOTHING_TO_REDO', 'there is nothing undone to redo');
  return freeze({ past: Object.freeze([...h.past, h.present]), present: h.future[0], future: Object.freeze(h.future.slice(1)), dragBase: null });
}

module.exports = { createHistory, commit, beginDrag, dragTo, endDrag, undo, redo, HistoryError };
