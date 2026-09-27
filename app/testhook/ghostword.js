// ghostword.js: the resolved CANDIDATE for placing a built-in word at the head, without placing it: the document with
// the word appended exactly as app/shell.js place() appends it (the pickers' tempo and direction; the font picker unless
// it is 'auto' or the word is a jump), then resolved. For the ghost preview's tests and the window proof, until A's
// palette sends its own candidates (the wiring proposed in the D170 hand-back). If place() changes, this must follow it;
// app/test/look.test.js checks that a ghost from here equals the track that place() then builds.
'use strict';

const D = require('../../src/doc/index.js');

function candidateFor(state, word) {
  if (!state || !state.history) throw new Error('ghost: needs the shell state');
  const { font, tempo, dir } = state.pickers || {};
  const next = D.appendWord(state.history.present, word, { tempo, dir, font: font === 'auto' || word === 'jump' ? undefined : font });
  return D.resolve(next);
}

module.exports = { candidateFor };
