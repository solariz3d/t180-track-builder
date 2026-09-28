// fonts.js: the MEASURED FONTS (D182, pane C). A font is a cross-section shape, ψ(u) (profile.js), and these three are
// measured, not drawn: the learning library's road words, grouped by the shape the reader names them
// (tools/fontshape.cjs; the numbers it gave are src/geom/fontshape.json).
//
//   fontProfile(font, { width, wall, psiL, psiR })  -> a profile { font, u, psi, material } (profile.js normalize takes it)
//   DEFAULTS[font]                                   -> { width, wall: 0, psiL, psiR }: the handles a new word should get
//
// THE FLOOR IS THE WHOLE ROAD, and it rises progressively across it: ψ at ¼, ½, ¾ and the edge of each side's half-width,
// linear in between, ψ(0) = 0. There is no flat floor with a wall curling up at its end. The keeper, 2026-09-28 01:27, of
// the old fonts (a flat floor, then an 8 m wall to 60-110°): "the rims flip up too much and dont make sense".
//   · The value at each fraction is the mean of the inside and outside medians (they differ by ≤ 1.65° at ¼, ½ and ¾ in
//     every family; fontshape.json), so a font is symmetric and does not need the turn's direction. A corner tilts the
//     WHOLE section by the word's roll (the bank, document.js), not the outer rim.
//   · THE EDGE is the larger of the edge median and the ¾ median, per side. The reader's edge sample is its last point
//     before a fold sharper than 35° in a metre (FINDINGS §7f "ψ is the cross-section up to the lip, not the lip"), so
//     on the bowl it reads BELOW ¾ (7.7° inside against 15.6°): a fold, not the shape turning back down.
//   · THE HALF-PIPE is the library's Sakura-shaped mode (a gentle floor, then 14° → 31° over the last quarter); the pipe
//     words are two shapes, and their overall median is a profile no track has (tools/fontshape.cjs PIPE_SPLIT).
//   · NO LIP: each font's steepest rise across the width, at its family's median width, lies inside the p10-p90 of the
//     real words' steepest rise (test/geom_fonts.test.js): bowl 1.8°/m (real 0.6-6.1), half-pipe 4.2 (3.8-4.8),
//     flat 0.14 (0.05-0.71).
//   · A RIM RISES AT A RATE, NOT TO AN ANGLE (measured, D182): the half-pipe's real rise is about the same in degrees per
//     METRE at every width (median 4.7 at 24 m, 4.6 at 30-33 m, 3.6 above 36 m), so a narrow real rim reaches a lower
//     angle (Thunderhead's 24 m pipes: 25.7° at the edge; Sakura's 32 m: 30.7°). The angles above scale with the width,
//     so on a narrow road they would rise faster than any real rim. So each quarter's rise is CAPPED at the family's
//     median real rate (RATES): ψ(qᵢ) = ψ(qᵢ₋₁) + min(Δψᵢ, RATE · width/8). At the family's median width no cap binds, so
//     the fractions above are the font there; at 24 m the half-pipe's edge is 27.5°.
// THE WALL above the floor is the word's `wall` handle (resolve.js): beyond the half-width, an arc of `wall` metres whose ψ
// rises linearly from the floor's edge value to ψL / ψR. The corpus does not measure one (the reader stops at the lip),
// so a measured font's DEFAULT is NO wall (DEFAULTS: wall 0, and ψL = ψR = the edge value, so a wall a user then sculpts
// starts as the floor's own continuation). In the library a wall-ride is the whole road banked (bank 80° on a wall-ride
// word, FINDINGS §7f), not a font wall.
'use strict';

const DEG = Math.PI / 180;
const AT = Object.freeze([0.25, 0.5, 0.75, 1]);

// ψ in degrees at AT, and the family's median width, from `node tools/fontshape.cjs reads` (2026-09-28; 3,543 road-class
// words of 4,026).
const FLOORS = Object.freeze({
  bowl: Object.freeze([2.7, 8.6, 15.5, 15.5]),          // 1,872 words, 53% of the road classes; median width 31 m
  'half-pipe': Object.freeze([5.6, 10.8, 14.1, 30.6]),  // 349 words (the Sakura mode), 10%; median width 31.5 m
  flat: Object.freeze([0.7, 1.5, 2.3, 3.0]),            // 823 words, 23%; median width 45 m: the flat banked ribbon is this font plus the roll
});
const WIDTHS = Object.freeze({ bowl: 31, 'half-pipe': 31.5, flat: 45 });
// °/m: each family's median steepest rise over its words (fontshape.json rate_deg_per_m.p50)
const RATES = Object.freeze({ bowl: 2.993, 'half-pipe': 4.55, flat: 0.2 });
/** The floor's ψ (degrees) at AT for a road `width` m wide: the measured angles, each quarter's rise capped at RATES. */
function floorAt(font, width) {
  const q = width / 2 / 4, out = []; let prev = 0;
  for (const target of FLOORS[font]) { prev += Math.min(target - (out.length ? FLOORS[font][out.length - 1] : 0), RATES[font] * q); out.push(prev); }
  return out;
}

const isMeasured = (font) => Object.prototype.hasOwnProperty.call(FLOORS, font);

/** The handles a new word in a measured font should get: the family's median width, no wall, the wall's top at the edge. */
const DEFAULTS = Object.freeze(Object.fromEntries(Object.keys(FLOORS).map((f) => {
  const edge = FLOORS[f][3] * DEG;
  return [f, Object.freeze({ width: WIDTHS[f], wall: 0, psiL: edge, psiR: edge })];
})));

/**
 * The profile of a measured font at the given handles. `width` is the whole floor (m, > 0), `wall` the arc length of each
 * wall above it (m, ≥ 0; 0 means no wall), `psiL` / `psiR` the wall's top angle on each side (rad).
 */
function fontProfile(font, { width, wall = 0, psiL = 0, psiR = 0 } = {}) {
  if (!isMeasured(font)) throw new Error(`fontProfile: "${font}" is not a measured font (${Object.keys(FLOORS).join(', ')})`);
  if (!(Number.isFinite(width) && width > 0)) throw new Error(`fontProfile: width must be a positive number of metres, not ${width}`);
  if (!(Number.isFinite(wall) && wall >= 0)) throw new Error(`fontProfile: wall must be ≥ 0 m, not ${wall}`);
  if (!Number.isFinite(psiL) || !Number.isFinite(psiR)) throw new Error('fontProfile: psiL and psiR must be finite (rad)');
  const w = width / 2, F = floorAt(font, width).map((d) => d * DEG);
  const side = AT.map((f, i) => [f * w, F[i]]);
  const u = [...side.slice().reverse().map(([x]) => -x), 0, ...side.map(([x]) => x)];
  const psi = [...side.slice().reverse().map(([, p]) => p), 0, ...side.map(([, p]) => p)];
  if (wall > 0) { u.unshift(-(w + wall)); psi.unshift(psiR); u.push(w + wall); psi.push(psiL); }
  return { font, u, psi, material: 'ROAD' };
}

/** The steepest rise of ψ across a measured font's floor at `width`, in degrees per metre (the no-lip measure). */
function steepestRise(font, width) {
  const k = [0, ...floorAt(font, width)], q = width / 2 / 4;
  let m = 0; for (let i = 1; i < k.length; i++) m = Math.max(m, (k[i] - k[i - 1]) / q);
  return m;
}

module.exports = { FLOORS, WIDTHS, RATES, DEFAULTS, AT, fontProfile, floorAt, steepestRise, isMeasured };
