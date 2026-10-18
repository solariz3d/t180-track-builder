// sky/index.js: the skin skies (D384), drawn by the WebGL view as a sky at infinity, so it stays put in the world as the camera turns.
// A skin names its sky with the token --sky-style (app/themes/*.css); 'none' (SIGIL, since D384 widened the one skin without a sky) draws no sky pass,
// only today's clear colour.
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
//   The source may define helpers of its own; prefix their names with the style (sun_, prism_, caustics_, aurora_), so two never clash.
//   A module that cannot build its sky throws from source(): the renderer compiles a style when setTheme names it, so it fails loudly there.
//   TWO GLSL RULES (D391, from E's 0.4.4 review, findings 1 and 3), checked on every source by contractProblems below, so a style breaking one is refused:
//     · no smoothstep(e0, e1, x) with literal edges e0 >= e1: GLSL ES 1.00 leaves it undefined (write smoothstep(0.0, 0.6, -h) for a ramp downward)
//     · no sin hash, fract(sin(dot(p, ...)) * k): GPUs reduce a large sin argument differently, so the pattern can come out banded; use a sin-free
//       hash like prism_hash (sky/prism.js)
'use strict';

const STYLES = Object.freeze(['none', 'sun', 'prism', 'caustics', 'aurora']);
// each required by name, written out: the page's loader (app/lib/cjs.js) fetches only the requires it can read in the source. Requiring a module costs
// nothing until its source() is called, so a stub that is not built yet throws only when a skin names it.
const MODULES = { sun: require('./sun.js'), prism: require('./prism.js'), caustics: require('./caustics.js'), aurora: require('./aurora.js') };

/** D391: every way a style's GLSL breaks the two rules above, as readable lines (empty: it keeps them). Comments are not code, so they are skipped. */
function contractProblems(style, src) {
  const code = String(src).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''), out = [];
  const num = '\\s*(-?(?:\\d+\\.?\\d*|\\.\\d+))\\s*';
  for (const m of code.matchAll(new RegExp(`\\bsmoothstep\\s*\\(${num},${num},`, 'g'))) {
    if (Number(m[1]) >= Number(m[2])) out.push(`${style}: smoothstep(${m[1]}, ${m[2]}, ...) has edge0 >= edge1, which GLSL ES leaves undefined`);
  }
  if (/\bsin\s*\(\s*dot\s*\(/.test(code)) out.push(`${style}: a sin hash (sin(dot(...))), whose large argument GPUs reduce differently; use a sin-free hash`);
  return out;
}

/** The GLSL of a style's skyPattern, or null for 'none'; an unknown style throws, and so does a style that breaks a GLSL rule (D391). */
function patternSource(style) {
  if (!STYLES.includes(style)) throw new Error(`sky: no style named ${JSON.stringify(style)} (the styles are ${STYLES.join(', ')})`);
  if (style === 'none') return null;
  const src = MODULES[style].source();
  if (typeof src !== 'string' || !/vec3\s+skyPattern\s*\(\s*vec3\s+\w+\s*,\s*float\s+\w+\s*\)/.test(src)) throw new Error(`sky: ${style}.js does not define vec3 skyPattern(vec3 dir, float t)`);
  const bad = contractProblems(style, src); if (bad.length) throw new Error(`sky: ${style}.js breaks the GLSL rules: ${bad.join('; ')}`);
  return src;
}

module.exports = { STYLES, patternSource, contractProblems };
