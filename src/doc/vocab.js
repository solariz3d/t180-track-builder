// vocab.js: the built-in words, fonts and tempos of the document (ARCHITECTURE §2), and the handle set of each word.
//
// WORDS. The names are the ones ARCHITECTURE §2 lists. The boundaries between straight, sweep, turn and tight are ours
// to name (the keeper, via §2); they are taken from the one place the program already names them, the track reader
// (tools/read_track.cjs `word()`): straight above 1,500 m radius, sweep 500–1,500 m, turn 180–500 m, tight below
// 180 m. A word's default radius sits inside its band, and the tempo scales it.
//
// FONTS (§2 "the profile is a 2D curve by its own arc length, with a turning angle ψ(u)"). Every font is one data
// type: a flat floor of `width` m, then on each side a wall of arc length `wall` m, whose turning angle rises linearly
// to ψL / ψR (a constant-curvature wall, as the platform test builds). `wall` is a handle, so the wall's height can be
// sculpted; the font gives its default. Measured shapes (FINDINGS §1, §7): half-pipe
// (Sakura, 32 m wide), bowl (a flatter floor curving up the outside, 50–88% of profiles), flat banked ribbon (Rainbow,
// 47 m). ψ is the rise from the floor, positive on both sides, and may pass 90° (src/geom/profile.js reads it so).
//
// TEMPOS (§2 "the curvature scale and how gradually corners open and close"). `scale` multiplies every default radius;
// `ease` is the default share of a word spent opening (and closing) its curvature. Measured: Aurora sweeps at about
// 1.2 km radius, Serpents and the Test Track turn at 100–170 m (FINDINGS §7 via ARCHITECTURE §2).
'use strict';

const DEG = Math.PI / 180;

const TEMPOS = {
  standard: { scale: 1, ease: 0.3 },
  aurora: { scale: 1.2, ease: 0.4 },      // sweeps at 1,200 m, as Aurora's
  serpents: { scale: 0.45, ease: 0.25 },  // turns at 135 m, inside Serpents' and the Test Track's 100–170 m
};

const FONTS = {
  flat: { width: 20, wall: 0, psiL: 0, psiR: 0 },
  'half-pipe': { width: 16, wall: 8, psiL: 60 * DEG, psiR: 60 * DEG },
  bowl: { width: 16, wall: 8, psiIn: 15 * DEG, psiOut: 60 * DEG },   // the outside wall rises; which side is outside follows the turn
  'wall-ride': { width: 10, wall: 8, psiIn: 30 * DEG, psiOut: 110 * DEG },
  tube: { width: 8, wall: 12, psiL: 160 * DEG, psiR: 160 * DEG },
};

// Default geometry per word at tempo scale 1: `R` is the peak radius (m), `turn` the heading change (rad, + = left).
const WORDS = {
  straight: { length: 100, turn: 0, font: 'flat' },
  sweep: { R: 1000, turn: 30 * DEG, font: 'flat' },
  turn: { R: 300, turn: 60 * DEG, font: 'bowl' },
  tight: { R: 120, turn: 90 * DEG, font: 'bowl' },
  'wall-ride': { R: 30, turn: 180 * DEG, font: 'wall-ride' },
  inversion: { length: 200, turn: 0, roll: 2 * Math.PI, font: 'half-pipe' },
  jump: { gap: 12, drop: 0.7, land: -2 * DEG },
};

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

module.exports = { DEG, TEMPOS, FONTS, WORDS, ROAD_HANDLES, JUMP_HANDLES, RAMP_M, LANDING, handlesOf };
