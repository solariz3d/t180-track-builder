// jumpwords.js: THE JUMP'S NAMED REFUSALS, IN PLAIN WORDS (D243 item 1, kept for D258's free jump: "its named refusals are shown in plain words"). `e` is a CoreError from src/core/jump.js or
// src/core/document.js (code and message). Never the code name; an unknown refusal keeps the core's own sentence minus its code, so nothing is hidden.
'use strict';

function jumpWords(e) {
  const code = e && e.code, msg = String((e && e.message) || e || '');
  switch (code) {
    case 'NO_TAKEOFF': return 'A jump needs road to take off from: press Extend first, then Jump.';
    case 'CLOSED': return 'The loop is closed, so there is no open end to add a jump to. Undo the close first.';
    case 'JUMP_AFTER_JUMP': return 'The track already ends in a jump. Extend from its landing first, so the car has road to land on, then add the next one.';
    case 'FLIGHT_OFFSET': return 'The road at the end still carries a height or sideways offset (from the local brush), and a jump can only take off from road where those have faded back to zero. Brush them out, or Extend a little further so they fade.';
    case 'FLIGHT_TOO_SHORT': return 'The landing is too close to the take-off: put it at least 1 m away.';
    case 'BAD_FLIGHT': return msg.replace(/^BAD_FLIGHT:\s*/, '');
    case 'BAD_LENGTH': return 'The landing\'s length must be more than 0 m.';
    case 'LANDING_NOT_HEAD': return 'The landing can only be moved while it is the last piece of the track. Once road is extended from it, it is fixed: delete back to it (Ctrl+Backspace) to move it again.';
    default: return msg.replace(/^[A-Z_]+:\s*/, '');
  }
}

module.exports = { jumpWords };
