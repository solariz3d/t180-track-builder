// sky/aurora.js: the 'aurora' sky (D384), Aurora's. The contract is in app/preview/sky/index.js.
// A polar night. A field of fine stars, a few brighter, twinkling faintly; and two curtains of aurora hung round the sky, a green one and a higher,
// fainter violet one. Each curtain is a ribbon that folds and sways slowly along its length, with fine vertical rays, its lower edge the brightest
// part (where the light is made) and its top fading upward into violet. Where a fold bunches the ribbon, it glows a little brighter.
// Quiet behind the work: under about 10 degrees of elevation, where the road sits against the sky, there are no curtains and no stars, and the night
// pales only to the skin's --fog at the horizon (uSkyC is the skin's fog colour, so the far road fogs into the sky it meets).
// Every edge is a smooth falloff, and the stars are points sized in device pixels (D416: a cone 1.25 px in radius, from the pass's uPx, so a star is
// about a pixel across at any window size and pixel density; they were gaussians in grid cells, a median 2.2 px across at half their peak at 2560 x 1440, measured by app/test/sky-crisp.test.js). The motion is slow: the folds travel at under 0.004 rad/s and
// the hems at under 0.006 rad/s, so nothing crosses the view in under four minutes; the twinkle changes brightness in place by at most 15%.
// Everything round the sky is a function of whole multiples of the azimuth (sin(k az), k an integer), so the curtains close with no seam; they and
// the stars are gone well before the zenith.
// Colours: uSky the night overhead (--sky), uSkyA the green (--sky-a), uSkyB the violet (--sky-b), uSkyC the horizon, the skin's fog (--sky-c).
'use strict';

const SOURCE = `
float aurora_hash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }   // sin-free, as prism_hash (D391)
// the angle of one device pixel HERE: the pass's uPx (at the middle of the view; a page that sends none gets a pixel of a 2560 x 1440 screen at 60
// degrees) times cos^1.5 of the angle off the view's axis (vRay is the unit forward plus the screen offset, so dot(vRay, vRay) = 1 / cos^2). A flat
// screen spreads an angle over 1 / cos^2 as many pixels outward from its middle and 1 / cos across, so a star sized in uPx alone grew to about 2.4 px
// at a 2560 x 1440 corner; at cos^1.5 its spot covers the same area of screen everywhere (about 1.6 px by 1.0 at a corner), never under a pixel (D416)
float aurora_px() { return (uPx > 0.0 ? uPx : 0.0008) * pow(dot(vRay, vRay), -0.75); }
float aurora_stars(vec3 dir, float t) {
  // one candidate star per cell of a 3D grid laid through the sky sphere (no seam anywhere); about one cell in 25 holds one. The star is drawn round
  // its own direction (its point in the cell, carried out to the sphere), and only when that lands in the middle of the cell, so the pixels round it
  // are in this cell too and no star is cut at a cell's face
  vec3 p = dir * 180.0, c = floor(p);
  float h = aurora_hash(c);
  if (h < 0.96) return 0.0;
  vec3 s = 0.4 + 0.2 * vec3(aurora_hash(c + 1.7), aurora_hash(c + 3.1), aurora_hash(c + 5.3));
  vec3 sd = normalize(c + s), q = sd * 180.0 - c;
  if (any(lessThan(q, vec3(0.2))) || any(greaterThan(q, vec3(0.8)))) return 0.0;
  float b = (h - 0.96) / 0.04;
  float twinkle = 0.85 + 0.15 * sin(t * (0.7 + 1.1 * aurora_hash(c + 7.7)) + h * 40.0);
  return max(0.0, 1.0 - length(dir - sd) / (1.25 * aurora_px())) * 1.8 * (0.18 + 0.82 * b * b) * twinkle;   // a point: a cone 1.25 device px in radius, 1.8 times as strong, so it carries the soft star's light (D416)
}
vec3 aurora_curtain(float az, float el, float t, float ph, float base, float tall) {
  float x = az + 0.16 * sin(az * 2.0 + ph + t * 0.012) + 0.06 * sin(az * 5.0 - ph + t * 0.02);   // the folds (travel under 0.004 rad/s)
  float hem = base + 0.03 * sin(x * 3.0 + ph * 1.3 + t * 0.017) + 0.012 * sin(x * 8.0 - t * 0.03);  // the lower edge, swaying
  float h = el - hem;
  float rise = smoothstep(-0.022, 0.012, h);
  float body = rise * (0.5 * exp(-max(h, 0.0) / tall) + 0.5 * exp(-max(h, 0.0) / 0.022));          // brightest at the lower edge, then a long fade
  float rays = 0.66 + 0.34 * (0.5 + 0.5 * sin(x * 160.0 + 2.5 * sin(x * 11.0 + t * 0.04))) * (0.6 + 0.4 * sin(x * 61.0 - ph));
  float fold = 0.75 + 0.25 * cos(az * 2.0 + ph + t * 0.012);                                       // brighter where the ribbon bunches
  float span = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(az + ph + t * 0.004), 1.5);                       // strongest round one side of the sky, never gone
  vec3 hue = mix(uSkyA, uSkyB, smoothstep(0.02, 0.2, h));                                         // green at the lower edge, violet above it
  return hue * body * rays * fold * span;
}
vec3 skyPattern(vec3 dir, float t) {
  float el = asin(clamp(dir.y, -1.0, 1.0)), az = atan(dir.z, dir.x);
  // the night: --sky overhead, paling to --fog at the horizon, a little darker again below it
  vec3 night = mix(uSkyC, uSky, smoothstep(0.0, 0.42, el));
  night = mix(night, mix(uSkyC, uSky, 0.5), 1.0 - smoothstep(-0.35, 0.0, el));
  float clear = smoothstep(0.175, 0.25, el) * (1.0 - smoothstep(1.05, 1.35, el));   // nothing under about 10 degrees, nor near the zenith
  vec3 g = aurora_curtain(az, el, t, 0.0, 0.215, 0.16);
  vec3 v = aurora_curtain(az, el, t, 2.4, 0.33, 0.22);
  vec3 light = 1.0 - (1.0 - 0.95 * g) * (1.0 - 0.6 * v);
  float glow = clamp(dot(g + v, vec3(0.3333)), 0.0, 1.0);
  float stars = aurora_stars(dir, t) * smoothstep(0.17, 0.35, el) * (1.0 - 0.7 * glow);
  vec3 col = 1.0 - (1.0 - night) * (1.0 - clamp(light, 0.0, 1.0) * clear);
  return col + vec3(0.85, 0.9, 1.0) * stars;
}
`;

module.exports = { source() { return SOURCE; } };
