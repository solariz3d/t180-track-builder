// sky/index.js: the skin skies (D384), drawn by the WebGL view as a sky at infinity, so it stays put in the world as the camera turns.
// A skin names its sky with the token --sky-style (app/themes/*.css); 'none' (SIGIL, Glass) draws no sky pass, only today's clear colour.
//
// THE CONTRACT for a style module, app/preview/sky/<style>.js:
//   module.exports = { source() }      source() returns GLSL ES 1.0 that defines
//       vec3 skyPattern(vec3 dir, float t)
//     dir  the pixel's world view direction, unit length, +y up (the camera's rotation only: moving or zooming does not change it)
//     t    seconds; frozen at 0 under prefers-reduced-motion, so a still sky is the t = 0 frame
//     returns the pixel's colour, 0..1, written as it is (no fog over it; the track and the fog draw over the sky as today)
//   The pass declares these uniforms before the module's source, for it to read:
//     uniform vec3 uSky;                       the skin's --sky (today's clear colour)
//     uniform vec3 uSkyA, uSkyB, uSkyC;        the skin's --sky-a, --sky-b, --sky-c, each falling back to --sky
//   The source may define helpers of its own; prefix their names with the style (sun_, caustics_, aurora_), so two never clash.
//   A module that cannot build its sky throws from source(): the renderer compiles a style when setTheme names it, so it fails loudly there.
'use strict';

const STYLES = Object.freeze(['none', 'sun', 'caustics', 'aurora']);
const MODULES = { sun: './sun.js', caustics: './caustics.js', aurora: './aurora.js' };

/** The GLSL of a style's skyPattern, or null for 'none'; an unknown style throws. */
function patternSource(style) {
  if (!STYLES.includes(style)) throw new Error(`sky: no style named ${JSON.stringify(style)} (the styles are ${STYLES.join(', ')})`);
  if (style === 'none') return null;
  const src = require(MODULES[style]).source();
  if (typeof src !== 'string' || !/vec3\s+skyPattern\s*\(\s*vec3\s+\w+\s*,\s*float\s+\w+\s*\)/.test(src)) throw new Error(`sky: ${style}.js does not define vec3 skyPattern(vec3 dir, float t)`);
  return src;
}

module.exports = { STYLES, patternSource };
