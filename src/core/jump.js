// jump.js: ADD A JUMP at the open end of an equation track (D243, pane E). The UI's "Add jump" calls this; the next Extend starts the landing road.
//
//   jump(doc, { gap, drop, land })  -> a new document, one flight piece longer
//
// gap (m, > 0): how far the flight goes along the ground, measured from the take-off lip; drop (m, + = down): how far the landing lip is below the
// take-off lip; land (rad, + = nosing up, so a landing slope is negative): the pitch of the landing ramp. The take-off is the last road piece's end:
// its pitch at the lip is the ramp, set with the existing fields before the jump (ref: the plan, D243 item 1). The flight is solved and its landing
// ramp sized exactly as the adapter builds them (src/core/adapter.js toSegments: src/doc/resolve.js solveJump, src/validate/jumps.js landingRamp at
// the design speed), so a jump this accepts is one the adapter can build; one it cannot (a flight through vertical, none that meets the gap and
// drop) is REFUSED BY NAME here, at the click, rather than later in the preview.
//
// Refused by name: an empty track or one whose end is already a jump (NO_TAKEOFF, JUMP_AFTER_JUMP: land on road first), a closed track
// (CLOSED, D.appendPiece), a bad number (BAD_JUMP), a road that still carries a height or sideways offset at the lip (FLIGHT_OFFSET, D.checkDoc),
// and a flight the solver cannot fly (JUMP_PAST_VERTICAL, JUMP_UNSOLVABLE).
'use strict';

const D = require('./document.js');
const { toSegments } = require('./adapter.js');

const V = Math.PI / 2;

function jump(doc, { gap, drop = 0, land = 0 } = {}) {
  D.checkDoc(doc);
  if (doc.closed) throw new D.CoreError('CLOSED', 'a closed track has no open end; open it first');
  if (!doc.pieces.length) throw new D.CoreError('NO_TAKEOFF', 'a jump needs road to take off from: extend first');
  if (doc.pieces[doc.pieces.length - 1].type === 'flight') throw new D.CoreError('JUMP_AFTER_JUMP', 'the track already ends in a jump: extend the landing road first, then add the next jump');
  if (!(Number.isFinite(gap) && gap > 0)) throw new D.CoreError('BAD_JUMP', `a jump's gap must be a positive number of metres, got ${gap}`);
  if (!Number.isFinite(drop)) throw new D.CoreError('BAD_JUMP', `a jump's drop must be a number of metres (+ down), got ${drop}`);
  if (!(Number.isFinite(land) && Math.abs(land) < V)) throw new D.CoreError('BAD_JUMP', `a jump's landing pitch must be inside (−90°, 90°), got ${land} rad`);
  const out = D.appendPiece(doc, D.flightPiece({ gap, drop, land }));
  // the flight as the adapter will build it: a jump it cannot fly is refused now, by its own name
  try { toSegments(out); } catch (e) {
    if (e && (e.code === 'JUMP_PAST_VERTICAL' || e.code === 'JUMP_UNSOLVABLE')) throw new D.CoreError(e.code, e.message);
    throw e;
  }
  return out;
}

module.exports = { jump };
