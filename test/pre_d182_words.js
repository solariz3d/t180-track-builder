// pre_d182_words.js: the words as the builder placed them BEFORE D182's measured vocabulary, spelled out as explicit
// handles, for the tests whose subject is a BEHAVIOUR (a loop exports, a bound clamps, a jump is caught) and which had
// only been leaning on the defaults (the ripple, p-d182-ripple-E_2026-09-28). A test that appends through here builds
// the same document under either vocabulary, so it keeps testing what it tested. It is NOT a claim about what the
// defaults should be; the measured defaults are src/doc/vocab.js's, and tests of THEM live with it.
//
// The values are the pre-D182 src/doc/vocab.js at the standard tempo (scale 1, ease 0.3), copied as numbers:
//   straight: 100 m, font flat (20 m floor, no wall)          sweep: R 1000 m, 30°, flat
//   turn: R 300 m, 60°, bowl (16 m floor, 8 m walls, ψ 15° in / 60° out)    tight: R 120 m, 90°, bowl
//   wall-ride: R 30 m, 180°, font wall-ride (10 m, 8 m walls, ψ 30° in / 110° out)
//   inversion: 200 m, one full roll, half-pipe (16 m, 8 m walls, ψ 60°)     jump: gap 12 m, drop 0.7 m, lands at −2°
// A curved word's length makes its PEAK radius R: |turn|·R / (1 − ease). No word banks: roll1 is the head's roll (the
// inversion adds its one full roll). Anything the caller passes (font, dir, handles) still wins.
'use strict';

const DEG = Math.PI / 180, EASE = 0.3;
const FONT = {
  flat: { width: 20, wall: 0, psiL: 0, psiR: 0 },
  'half-pipe': { width: 16, wall: 8, psiL: 60 * DEG, psiR: 60 * DEG },
  bowl: { width: 16, wall: 8, psiIn: 15 * DEG, psiOut: 60 * DEG },
  'wall-ride': { width: 10, wall: 8, psiIn: 30 * DEG, psiOut: 110 * DEG },
  tube: { width: 8, wall: 12, psiL: 160 * DEG, psiR: 160 * DEG },
};
const WORD = {
  straight: { length: 100, turn: 0, font: 'flat' },
  sweep: { R: 1000, turn: 30 * DEG, font: 'flat' },
  turn: { R: 300, turn: 60 * DEG, font: 'bowl' },
  tight: { R: 120, turn: 90 * DEG, font: 'bowl' },
  'wall-ride': { R: 30, turn: 180 * DEG, font: 'wall-ride' },
  inversion: { length: 200, turn: 0, roll: 2 * Math.PI, font: 'half-pipe' },
};

/** appendWord's options that place `word` as the pre-D182 vocabulary did, on `doc` (for the head's roll). */
function oldWord(D, doc, word, opts = {}) {
  if (word === 'jump') return { ...opts, handles: { gap: 12, drop: 0.7, land: -2 * DEG, ...(opts.handles || {}) } };
  const W = WORD[word]; if (!W) throw new Error(`pre_d182_words: no word "${word}"`);
  const dir = opts.dir || 'L', sign = dir === 'L' ? 1 : -1, font = opts.font || W.font, F = FONT[font];
  const turn = sign * W.turn, length = W.length !== undefined ? W.length : (Math.abs(turn) * W.R) / (1 - EASE);
  const out = F.psiOut !== undefined, psiL = out ? (sign > 0 ? F.psiIn : F.psiOut) : F.psiL, psiR = out ? (sign > 0 ? F.psiOut : F.psiIn) : F.psiR;
  const roll0 = D.headRoll(doc);
  return { ...opts, dir, font: carrier(D, font), handles: { length, turn, climb: 0, easeIn: EASE, easeOut: EASE, roll0, roll1: roll0 + (W.roll || 0), heartline: 0, psiL, psiR, width: F.width, wall: F.wall, ramp: 20, ...(opts.handles || {}) } };
}

// THE CARRIER (the walled-bowl tests, p-d182-walltests-E). Where the builder makes bowl, half-pipe and flat from the
// MEASURED floor (C's src/geom/fonts.js through resolve.js profileOf: a dish rising across the whole width, whatever
// the handles say), a pre-D182 word is carried by a font that is still built from its handles alone: 'wall-ride'.
// resolve.js profileOf builds a non-measured font as exactly the pre-D182 profile: a flat floor of `width`, then walls of
// arc length `wall` rising linearly to ψR/ψL (none when wall is 0). So the SURFACE is the pre-D182 one to the metre;
// only the font's label differs. Where the measured fonts are not built (the tree before C's diffs), nothing changes and
// the document is byte-identical to a bare appendWord's. Detected by resolving one probe word: a walled pre-D182 bowl
// resolves to five profile points; a measured one to more.
const measuredCache = new WeakMap();
function buildsMeasured(D) {
  if (measuredCache.has(D)) return measuredCache.get(D);
  const probe = D.appendWord(D.createDoc('probe'), 'straight', { font: 'bowl', handles: { width: 16, wall: 8, psiL: DEG, psiR: DEG } });
  const m = D.resolve(probe).segments[0].profile.u.length !== 5;
  measuredCache.set(D, m); return m;
}
const carrier = (D, font) => (buildsMeasured(D) && ['bowl', 'half-pipe', 'flat'].includes(font) ? 'wall-ride' : font);

/** D.appendWord with the pre-D182 word. */
const appendOld = (D, doc, word, opts = {}) => D.appendWord(doc, word, oldWord(D, doc, word, opts));

module.exports = { oldWord, appendOld, buildsMeasured };
