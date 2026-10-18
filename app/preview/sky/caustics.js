// sky/caustics.js: the 'caustics' sky (D384), Aqua's. The contract is in app/preview/sky/index.js.
// Looking up from the bottom of a clear sea. Overhead is Snell's window: the whole sky above the surface, squeezed into a bright, soft disc 97 degrees across
// (light refracts in through the surface only within 48.6 degrees of straight up), its rim alive with slow caustic ripples. Around it the sea
// lightens upward from deep teal, and faint shafts of light fall from the window and fade with depth. Below the horizon, deep teal.
// Quiet behind the work: under about 10 degrees of elevation, where the road sits against the sky, the sea stays between the skin's --sky and its
// --fog (uSkyC is the skin's fog colour, so the far road fogs into the sea it meets), and nothing moves there.
// Every edge is a smooth falloff (no line anywhere), and the motion is slow: nothing crosses the view in under about two minutes (the speeds are
// stated term by term below; the ripples change shape in place faster than they travel). Faint motes hang in the sea above 10 degrees.
// Colours: uSky the deep sea (--sky), uSkyA the sky seen through the window (--sky-a), uSkyB the lit sea under the surface (--sky-b), uSkyC the
// sea at the horizon, the skin's fog (--sky-c).
// (The word for it is "sea" here: the builder's own files keep clear of the word for the removed flow simulation, D238; core-readout-display.test.js.)
'use strict';

const SOURCE = `
float caustics_net(vec2 p, float t) {
  // three crossing wave trains, each bent by another; where they cancel, a soft bright crease (1 - v^2 is smooth, so a crease never becomes a line).
  // Travel: t * 0.13 at a spatial frequency of about 1 in p, and p is 22 per unit of q (about 37 per radian at the rim): about 0.004 rad/s.
  float v = sin(p.x + 1.2 * sin(p.y * 1.3 + t * 0.21) + t * 0.13);
  v += sin(p.y * 1.1 + 1.3 * sin(p.x * 0.9 - t * 0.17) - t * 0.11);
  v += sin((p.x + p.y) * 0.8 + sin((p.x - p.y) * 1.2 + t * 0.15) - t * 0.09);
  v /= 3.0;
  return pow(1.0 - v * v, 10.0);
}
float caustics_hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float caustics_motes(vec3 dir, float t) {
  // specks drifting in the sea, soft and dim: one candidate per cell of a 3D grid through the sky sphere, about one cell in 30 holding one, kept
  // off the cell's faces; the whole field turns slowly round the vertical (0.003 rad/s: about eight minutes to cross the view)
  float a = t * 0.003, ca = cos(a), sa = sin(a);
  vec3 p = vec3(ca * dir.x - sa * dir.z, dir.y, sa * dir.x + ca * dir.z) * 70.0, c = floor(p), f = p - c;
  float h = caustics_hash(c);
  if (h < 0.966) return 0.0;
  vec3 d = f - (0.4 + 0.2 * vec3(caustics_hash(c + 1.7), caustics_hash(c + 3.1), caustics_hash(c + 5.3)));
  return exp(-dot(d, d) / (2.0 * 0.12 * 0.12)) * (0.4 + 0.6 * (h - 0.966) / 0.034);
}
vec3 skyPattern(vec3 dir, float t) {
  float y = clamp(dir.y, -1.0, 1.0), el = asin(y), az = atan(dir.z, dir.x);
  // the sea: deep teal below and at the horizon (between --sky and --fog up to 10 degrees), lightening up toward the window
  vec3 sea = mix(uSky, uSkyC, smoothstep(-0.35, 0.17, el));
  sea = mix(sea, uSkyB, smoothstep(0.17, 0.75, el));
  // the shafts: soft rays round the sky, converging on the window overhead, swaying and breathing slowly (they travel round at under 0.003 rad/s);
  // none below 10 degrees, and they fade with depth, so they are faintest low down
  float x = az + 0.05 * sin(az * 3.0 + t * 0.02) + t * 0.002;
  float rays = 0.6 * pow(0.5 + 0.5 * sin(x * 23.0 + 1.5 * sin(x * 7.0 - t * 0.015)), 10.0) + 0.4 * pow(0.5 + 0.5 * sin(x * 37.0 + 2.0 * sin(x * 5.0 + t * 0.012)), 14.0);
  rays *= 0.6 + 0.4 * sin(x * 4.0 + t * 0.05);                                   // the shafts breathe, slowly, in place
  float depth = smoothstep(0.17, 0.45, el) * (1.0 - smoothstep(0.68, 0.74, el)); // from 10 degrees up to the window, gone below 10
  vec3 col = sea + uSkyA * 0.16 * rays * depth;
  col += mix(uSkyB, uSkyA, 0.5) * 0.22 * caustics_motes(dir, t) * smoothstep(0.17, 0.30, el);
  // Snell's window: the zenith angle z maps to r = tan(z / 2) (a flat, seamless map round the zenith); the window's edge, 48.6 degrees from the
  // zenith, is r = 0.4515. A soft disc, brighter toward its middle, with the ripples strongest along its rim
  vec2 q = dir.xz / max(1.0 + y, 0.05);
  float r = length(q);
  float net = caustics_net(q * 22.0, t);
  float win = 1.0 - smoothstep(0.405, 0.47, r);
  float rim = exp(-pow((r - 0.43) / 0.05, 2.0));
  vec3 seen = mix(uSkyB, uSkyA, 0.5 + 0.3 * (1.0 - r / 0.47)) * (0.88 + 0.2 * net);
  col = mix(col, seen, win);
  col += uSkyA * 0.42 * rim * net;
  return col;
}
`;

module.exports = { source() { return SOURCE; } };
