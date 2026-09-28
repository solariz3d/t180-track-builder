// vocab.js: the built-in words, fonts and tempos of the document (ARCHITECTURE §2), and the handle set of each word.
//
// THE WORDS ARE MEASURED (D182). Every default below is GENERATED from the measured library, src/doc/corpus.json (the
// track reader's words over every installed T-180 layout, FINDINGS §7f), by src/doc/vocabgen.js: a word's default is
// its class MEDIAN (radius, heading change, width, bank; the straight's length; the jump's gap and drop), its default
// font is the cross-section its class uses most, and a tempo picks a percentile BAND of the class's radii. Before D182
// they were hand-set, partly from the 500 m milestone-1 test loop; the keeper, 2026-09-27 23:36: "the pieces are nowhere
// near what I want them to be, they arent good for t-180s".
//
// WORDS. The names are the ones ARCHITECTURE §2 lists. The boundaries between straight, sweep, turn and tight are the
// track reader's (tools/read_track.cjs `word()`): straight above 1,500 m radius, sweep 500–1,500 m, turn 180–500 m,
// tight below 180 m, so a word's measured class is exactly its word. The wall-ride is the reader's `wall` class (the
// road's up more than 60° off vertical). The inversion has no measured class of its own that sizes a whole roll (the
// reader's inversion class is the upside-down FRAGMENT, 139° of bank at its median), so it keeps its hand-set length and
// its full roll, and takes its width and font from its class: named, not hidden.
//
// THE JUMP is NOT the median jump, and this is the one default that is not a median. The library's median jump is 125 m
// across and 14 m down (the corpus's 19 jumps), and real T-180s fly theirs off a kicker, taking off at a median 7.2° up
// and 560 km/h (the fifteen measured flights, FINDINGS §8 and §7d). The builder's jump has no kicker: it leaves at the
// road's own pitch (resolve.js solveJump), so off a level road at the default design speed, 460 km/h, the median jump
// misses its landing at both measured falls (red, measured: test/vocab-corpus.test.js). The rule D179 made for the
// first jump a user places is that it is clean at the default speed. So the default GAP is the corpus's p10, 81 m: the
// longest of its bands that a level take-off at 460 km/h clears (caught at 3.2 g and 6.3 g, measured). The DROP is the
// median, 14 m. The landing pitch is not measured, so it stays the hand-set -2°. Before D182: 12 m across, 0.7 m down.
//
// FONTS (§2 "the profile is a 2D curve by its own arc length, with a turning angle ψ(u)"). Every font is one data
// type: a flat floor of `width` m, then on each side a wall of arc length `wall` m, whose turning angle rises linearly
// to ψL / ψR. The font gives the SHAPE, and its WIDTH: C's measured widths per family (src/geom/fonts.js, widthOf
// below). The shapes' measured forms (the bowl, Sakura's 32 m half-pipe, Rainbow's 47 m ribbon at ~30°) are C's part of
// D182.
//
// TEMPOS (§2 "the curvature scale and how gradually corners open and close"). A band tempo picks the SIZE of the piece
// (vocabgen.js; the chair's ruling, D182): for sweep, turn and tight a whole CORNER's total turn (E's corners: a tight
// corner 88°, p10 32°, p90 256°), for the straight and the wall-ride a run's; compact is the p10, standard the median,
// grand the p90, always at the class's median radius. `ease` is the default share
// of a word spent opening (and closing) its curvature. The two older tempos, aurora and serpents, scale the median
// radius as they always scaled the old one (1.2 and 0.45), at the median size; they stay because documents name them.
//
// OLD DOCUMENTS. A document stores every handle of every word (document.js "DEFAULTS ARE WRITTEN IN"), so a track made
// with the old vocabulary resolves to the same track: only NEW words get the measured defaults. Every font and tempo
// name an old document can hold is still here, so it loads (serial.js checkWordBody refuses unknown names).
'use strict';

const { generate } = require('./vocabgen.js');
const CORPUS = require('./corpus.json');

const DEG = Math.PI / 180;
const GEN = generate(CORPUS);

const TEMPOS = {
  standard: { band: 'p50', ease: 0.3 },
  compact: { band: 'p10', ease: 0.3 },
  grand: { band: 'p90', ease: 0.3 },
  aurora: { scale: 1.2, ease: 0.4 },      // before D182: sweeps at 1,200 m, as Aurora's; now 1.2 × the median
  serpents: { scale: 0.45, ease: 0.25 },  // before D182: turns at 135 m; now 0.45 × the median
};

// D182: the bowl, half-pipe and flat are MEASURED (src/geom/fonts.js): their floor rises across the whole width, and a new
// word gets the family's median width and NO wall, so nothing curls up past the measured edge (the keeper, 01:27: "the
// rims flip up too much"). resolve.js builds them through fonts.js fontProfile. wall-ride and tube are not measured.
const { DEFAULTS: MEASURED } = require('../geom/fonts.js');
const FONTS = {
  flat: { ...MEASURED.flat },
  'half-pipe': { ...MEASURED['half-pipe'] },
  bowl: { ...MEASURED.bowl },
  'wall-ride': { width: 10, wall: 8, psiIn: 30 * DEG, psiOut: 110 * DEG },
  tube: { width: 8, wall: 12, psiL: 160 * DEG, psiR: 160 * DEG },
};

// Default geometry per word: `R` the median peak radius (m), `turn` the median corner's (or run's) total heading change (rad, + = left),
// `bank` the median tilt into the turn (rad, unsigned), `width` the median road width (m), `bands` the piece's size at
// each tempo band (a curved word's turn, the straight's length).
const g = GEN.words;
const WORDS = {
  straight: { length: g.straight.length, turn: 0, font: g.straight.font, fontShares: g.straight.fontShares, width: g.straight.width, bands: GEN.bands.straight },
  sweep: { ...g.sweep, bands: GEN.bands.sweep },
  turn: { ...g.turn, bands: GEN.bands.turn },
  tight: { ...g.tight, bands: GEN.bands.tight },
  'wall-ride': { ...g['wall-ride'], bands: GEN.bands['wall-ride'] },
  inversion: { length: 200, turn: 0, roll: 2 * Math.PI, font: g.inversion.font, fontShares: g.inversion.fontShares, width: g.inversion.width },
  jump: { gap: GEN.bands.jump.p10.gap, drop: g.jump.drop, land: -2 * DEG },
};

/**
 * A road word's piece at a tempo: { turn (rad, unsigned), R (peak radius, m, or undefined for a straight), length (m) }.
 * A band tempo picks the size band (turn, or the straight's length) at the median radius; an older tempo scales the
 * median radius at the median size. A curved piece's length is the one that makes its PEAK radius R, given the ease
 * (INTERFACES 4b: easeIn/easeOut). Null for an unknown word or tempo, or the jump.
 */
function pieceOf(word, tempo) {
  const W = WORDS[word], T = TEMPOS[tempo];
  if (!W || !T || word === 'jump') return null;
  const b = T.band && W.bands ? W.bands[T.band] : null;
  if (W.R === undefined) return { turn: W.turn || 0, R: undefined, length: b ? b.length : W.length };
  const R = T.band ? W.R : W.R * T.scale, turn = b ? b.turn : W.turn;
  return { turn, R, length: (turn * R) / (1 - T.ease) };
}
// THE FONT of a word placed with none chosen (the palette's "the word's own") is CONTINUITY, not a quota (the
// librarian's ruling, D182): it takes the previous road word's font, through the transition ramp, and the user changes
// family deliberately. Real tracks hold one cross-section for long stretches (B's two P-LIKE target stretches are 100%
// pipe over 3 km), and a per-piece rotation made the rims flip. Only the FIRST road word of a track takes its class's
// most-used font, the bowl (document.js appendWord). The measured shares stay here as DATA (`fontShares`), not a quota.
//
// THE WIDTH follows the FONT: the cross-section family defines it. C's measured widths (src/geom/fonts.js WIDTHS: flat
// 45 m, the Rainbow-ribbon kind; bowl 31 m; half-pipe 31.5 m) come first; a font with no measured width (wall-ride,
// tube) takes the word's class median (31–37 m), and a word with neither takes its font's own table width.
const { WIDTHS: FONT_WIDTHS } = require('../geom/fonts.js');
function widthOf(word, font) {
  if (Object.prototype.hasOwnProperty.call(FONT_WIDTHS, font)) return FONT_WIDTHS[font];
  const W = WORDS[word];
  if (W && W.width !== undefined) return W.width;
  return FONTS[font] ? FONTS[font].width : undefined;
}

// THE BANK RAMPS (D182; the maths is docs/math/04a_bank_ramp.md). A word's roll follows ONE smoothstep over its whole
// length (resolve.js; the Bloss polynomial, §1), so its steepest bank change is 1.5 × |roll1 − roll0| / length (§2). BANK_RATE is the MEASURED ceiling for that, in °/m: the p90 of how fast real
// T-180 roads change their bank along the road, over the corpus's own layouts, at the steps where the bank is changing
// at all (> 0.1°/m): `node tools/bankrate.cjs reads` → n 33,127, p50 0.254, p90 0.849, p99 2.205 °/m. A default word
// whose bank change would be faster is made LONGER, at its class's radius, so it turns further (document.js
// defaultWord); it is never banked short of its class. Before this, a wall-ride after a turn banked 52° inside 36 m
// (3.3°/m at its steepest), and validation marked the seam "sharper than measured". Abrupt entries also double the
// ride-up of anything flowing along the road (research: USACE EM 1110-2-1601, simple curve 1.0 against spiral 0.5).
// The inversion's full roll is the word itself, not a join, and is not ramped.
const BANK_RATE = 0.849;

/** A curved word's peak radius at a tempo (the phrasebook's angled words keep it). */
const radiusOf = (word, tempo) => { const p = pieceOf(word, tempo); return p ? p.R : null; };

const GRAMMAR = GEN.grammar;

const ROAD_HANDLES = ['length', 'turn', 'climb', 'easeIn', 'easeOut', 'roll0', 'roll1', 'heartline', 'psiL', 'psiR', 'width', 'wall', 'ramp'];

// THE FONT TRANSITION (the design ruling, 2026-09-27: "Fonts RAMP; they never jump … default 20 m (inferred as a
// sensible default, to be tuned), user-sculptable as a handle"). Every road word carries `ramp`: the distance over which
// the surface blends from the previous road word's profile into this word's, over this word's first `ramp` metres,
// smoothstep in s. When the two profiles are the same it changes nothing. After a jump there is no surface to blend
// from, so the landing starts on its own profile. It is never below 1 m: a change inside one row step is a hole.
const RAMP_M = 20;
const JUMP_HANDLES = ['gap', 'drop', 'land'];
const handlesOf = (word) => (word === 'jump' ? JUMP_HANDLES : ROAD_HANDLES);

// THE LANDING RAMP a jump carries (the D170 review: "a jump word should carry its landing ramp, so the head sits on road
// and the next piece starts on the landing"). Its length is validation's: src/validate/jumps.js landingRamp() solves
// where the flight comes down at both measured falls (MACH6.jumpG, 3.2 g and 6.3 g, FINDINGS.md:336-337) and adds its
// margin. A jump with no speed of its own is sized for the DESIGN SPEED: the one the caller passes (the app's speed
// slider, app/shell.js setDesignSpeed), else DEFAULT_KMH, the validation panel's own default, MACH6.designSpeedKmh,
// 460 km/h (docs/FINDINGS.md:476, the pooled median of seven clean Mach 6 laps). D179: sized for 300 km/h, the first
// jump a new user placed was RED at the default 460 ("3.2 g clears, no touchdown found").
const { MACH6 } = require('../validate/limits.js');
const LANDING = Object.freeze({ DEFAULT_KMH: MACH6.designSpeedKmh });

module.exports = { DEG, TEMPOS, FONTS, WORDS, GRAMMAR, ROAD_HANDLES, JUMP_HANDLES, RAMP_M, LANDING, BANK_RATE, handlesOf, pieceOf, radiusOf, widthOf, CORPUS_SOURCE: GEN.source };
