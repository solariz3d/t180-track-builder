// sky/aurora.js: the 'aurora' sky (D384, D403), Aurora's. The contract is in app/preview/sky/index.js.
// A polar night. A field of fine stars, a few brighter, twinkling faintly; and three curtains of aurora hung round the sky at different depths (D403): a near
// one, tall and bright, a middle one, and a far one, lower, finer and faint. Each curtain is a ribbon that folds and sways slowly along its length and is
// striped by rays (three ray scales multiplied into one, so there are real gaps between them): a ray that is strong stands taller, and at the hem it is
// brightest. The hem is the brightest, sharpest part (where the light is made), green; going up the green gives way to the skin's violet and, faintly, a
// red-pink at the top; under a strong ray there is a thin pink fringe below the hem. Overhead the curtains' rays fan out from one point, a corona.
// Quiet behind the work: under about 10 degrees of elevation, where the road sits against the sky, there are no curtains and no stars, and the night
// pales only to the skin's --fog at the horizon (uSkyC is the skin's fog colour, so the far road fogs into the sky it meets).
// Every edge is a smooth falloff, and the stars are points sized in device pixels (D416: a cone 1.25 px in radius, from the pass's uPx, so a star is
// about a pixel across at any window size and pixel density; they were gaussians in grid cells, a median 2.2 px across at half their peak at 2560 x 1440, measured by app/test/sky-crisp.test.js). The motion is slow: the folds travel at under 0.004 rad/s and
// the hems at under 0.006 rad/s, the rays drift at under 0.001 rad/s (and breathe over four minutes or more, changing by at most 15% of the curtain's brightness in a second), so nothing crosses the view in under four
// minutes; the twinkle changes brightness in place by at most 15%.
// Everything round the sky is a function of whole multiples of the azimuth (sin(k az), k an integer), so the curtains close with no seam; the corona's fan is
// whole multiples of its own angle. The curtains are gone well before the zenith, where the corona is.
// Colours: uSky the night overhead (--sky), uSkyA the green (--sky-a), uSkyB the violet (--sky-b), uSkyC the horizon, the skin's fog (--sky-c). The red-pink of
// the curtains' tops and fringe is --sky-b with its red and blue swapped (so it follows the skin's token, and needs no new one).
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
float aurora_rays(float x, float t, float ph, vec3 k) {
  // three ray scales, fine (k whole numbers, so they close round the sky), each drifting and breathing very slowly, over a broad patchiness so the rays come in
  // groups; the smoothstep leaves real gaps between rays
  float a = 0.5 + 0.5 * sin(x * k.x + 2.0 * sin(x * 7.0 + ph + t * 0.006) + t * 0.025 + ph);
  float b = 0.5 + 0.5 * sin(x * k.y - 1.5 * sin(x * 13.0 - ph + t * 0.009) - t * 0.02);
  float c = 0.5 + 0.5 * sin(x * k.z + t * 0.035 + ph * 2.0);
  float p = 0.5 + 0.5 * sin(x * 11.0 + ph * 3.0 + t * 0.01);
  return smoothstep(0.1, 0.9, 0.2 * p + 0.3 * a + 0.3 * b + 0.2 * c);
}
vec3 aurora_curtain(float az, float el, float t, float ph, float base, float tall, vec3 k, float gain) {
  float x = az + 0.16 * sin(az * 2.0 + ph + t * 0.012) + 0.06 * sin(az * 5.0 - ph + t * 0.02);   // the folds (travel under 0.004 rad/s)
  float hem = base + 0.03 * sin(x * 3.0 + ph * 1.3 + t * 0.017) + 0.012 * sin(x * 8.0 - t * 0.03);  // the lower edge, swaying
  float h = el - hem, hp = max(h, 0.0);
  float r = aurora_rays(az + 0.1 * (x - az), t, ph, k);                                            // the rays follow the folds only part way, so they drift slower than the ribbon
  float tl = tall * (0.45 + 1.1 * r);                                                              // a strong ray stands taller
  float rise = smoothstep(-0.012, 0.004, h);                                                       // the hem: sharp
  float body = rise * (0.65 * exp(-hp / 0.016) * (0.3 + 0.7 * r) + 0.35 * exp(-hp / tl) * (0.1 + 0.9 * r));   // the hem a line that never quite breaks, then the rays climbing from it
  float fold = 0.75 + 0.25 * cos(az * 2.0 + ph + t * 0.012);                                       // brighter where the ribbon bunches
  float span = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(az + ph + t * 0.004), 1.5);                       // strongest round one side of the sky, never gone
  float z = hp / tl;
  vec3 red = vec3(uSkyB.b, 0.5 * uSkyB.g, 0.9 * uSkyB.r);                                         // the violet token turned toward red-pink
  vec3 hue = mix(uSkyA, uSkyB, smoothstep(0.3, 1.2, z));                                           // green at the hem, violet above it
  hue = mix(hue, red, 0.7 * smoothstep(1.0, 2.4, z));                                              // and faintly red-pink at the top
  float d = (h + 0.007) / 0.0045;
  float fringe = exp(-d * d) * smoothstep(0.55, 0.95, r) * span;                                   // a thin pink line under the hem of a strong ray
  return gain * (hue * body * fold * span + mix(red, uSkyB, 0.4) * fringe * 0.35);
}
vec3 aurora_corona(vec3 dir, float t) {
  // overhead, rays fan out from one point (the curtains seen from beneath run to it): C, with E1 and E2 across it, are fixed unit vectors
  vec3 C = vec3(0.145, 0.906, -0.397), E1 = vec3(0.939, 0.0, 0.343), E2 = vec3(0.311, -0.423, -0.851);
  float rho = sqrt(max(1.0 - dot(dir, C) * dot(dir, C), 0.0)) * step(0.0, dot(dir, C));      // sine of the angle from C, 0 on the far side of the sky
  float th = atan(dot(dir, E2), dot(dir, E1));
  float a = 0.5 + 0.5 * sin(th * 13.0 + t * 0.015 + 2.0 * sin(th * 5.0 + t * 0.007));
  float b = 0.5 + 0.5 * sin(th * 31.0 - t * 0.022);
  float c = 0.5 + 0.5 * sin(th * 59.0 + t * 0.03 + 1.3);
  float fan = 0.2 + 0.8 * smoothstep(0.1, 0.9, 0.45 * a + 0.35 * b + 0.2 * c);
  float reach = exp(-rho / 0.3) * (1.0 - smoothstep(0.45, 0.66, rho)) * (0.4 + 0.6 * smoothstep(0.0, 0.2, rho));   // brightest near C, gone before it is low in the sky
  vec3 hue = mix(uSkyA, uSkyB, smoothstep(0.2, 0.6, rho));
  return hue * fan * reach * 0.4;
}
vec3 aurora_screen(vec3 a, vec3 b) { return 1.0 - (1.0 - clamp(a, 0.0, 1.0)) * (1.0 - clamp(b, 0.0, 1.0)); }
vec3 skyPattern(vec3 dir, float t) {
  float el = asin(clamp(dir.y, -1.0, 1.0)), az = atan(dir.z, dir.x);
  // the night: --sky overhead, paling to --fog at the horizon, a little darker again below it
  vec3 night = mix(uSkyC, uSky, smoothstep(0.0, 0.42, el));
  night = mix(night, mix(uSkyC, uSky, 0.5), 1.0 - smoothstep(-0.35, 0.0, el));
  float low = smoothstep(0.175, 0.25, el);                                                  // nothing under about 10 degrees
  float clear = low * (1.0 - smoothstep(1.05, 1.35, el));                                   // nor near the zenith
  vec3 g = aurora_curtain(az, el, t, 0.0, 0.30, 0.24, vec3(41.0, 113.0, 277.0), 1.25);       // the near curtain: tall, bright
  vec3 m = aurora_curtain(az, el, t, 2.4, 0.26, 0.16, vec3(53.0, 149.0, 331.0), 0.7);        // the middle one
  vec3 f = aurora_curtain(az, el, t, 4.6, 0.225, 0.09, vec3(67.0, 173.0, 389.0), 0.4);      // the far one: lower, finer, faint
  vec3 light = aurora_screen(aurora_screen(g, m), f);
  float glow = clamp(dot(g + m + f, vec3(0.3333)), 0.0, 1.0);
  vec3 cor = aurora_corona(dir, t) * low;
  float stars = aurora_stars(dir, t) * smoothstep(0.17, 0.35, el) * (1.0 - 0.7 * glow);
  vec3 col = 1.0 - (1.0 - night) * (1.0 - aurora_screen(light * clear, cor));
  return col + vec3(0.85, 0.9, 1.0) * stars;
}
`;

module.exports = { source() { return SOURCE; } };
