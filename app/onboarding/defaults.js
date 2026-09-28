// defaults.js: what a new user starts with (ARCHITECTURE §11.7: "a guided first track, defaults, a starter
// phrasebook"). Each default says where it comes from; a choice that is not a measurement says "inferred".
//
//   DEFAULTS.font / .tempo / .designSpeedKmh / .firstPiece     { value, source }
//   apply(shell)      sets the palette's pickers to the defaults (the shell's own setPicker, nothing else)
'use strict';
const { MACH6 } = require('../../src/validate/limits.js');

const DEFAULTS = Object.freeze({
  font: Object.freeze({
    value: 'auto',
    source: 'each word in its own font (src/doc/vocab.js): the curved words in the bowl, which FINDINGS.md:14 measures as "The dominant form is a **bowl** … It is 50–88% of profiles on most tracks."; straights flat',
  }),
  tempo: Object.freeze({
    value: 'standard',
    source: 'inferred: the vocabulary\'s scale 1, between the measured extremes it is named against (Aurora sweeps at ~1.2 km, Serpents at 100–170 m, ARCHITECTURE.md:44)',
  }),
  designSpeedKmh: Object.freeze({
    value: MACH6.designSpeedKmh,
    source: 'FINDINGS.md:476: the pooled median speed of seven clean Mach 6 laps, 460 km/h (the validation panel\'s picker starts there)',
  }),
  firstPiece: Object.freeze({
    value: 'sakura flow',
    source: 'the starter phrasebook (src/doc/phrasebook.js): Sakura\'s grammar, FINDINGS.md:180-181, on the track FINDINGS.md:124 names "the flow benchmark"',
  }),
});

/** Set the palette's font and tempo pickers to the defaults, through the shell. Returns the shell's state. */
function apply(shell) {
  shell.setPicker('font', DEFAULTS.font.value);
  return shell.setPicker('tempo', DEFAULTS.tempo.value);
}

module.exports = { DEFAULTS, apply };
