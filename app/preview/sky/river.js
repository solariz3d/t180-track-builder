// sky/river.js: the 'river' sky (D416), Glass's: a clear, still night with the river of the galaxy across it, every star drawn at the screen's own
// pixels. The contract is in app/preview/sky/index.js.
// By elevation: the horizon (--sky-b, held near the skin's fog for the first ten degrees) darkening through the skin's sky (--sky) to the zenith (--sky-a).
// Over it, two fields of stars, each star a point sized in device pixels (a cone 1.25 px in radius, from the pass's uPx, so a star is about a pixel
// across at any window size and pixel density), each with its own brightness and a slight warm or cold tint of --sky-c:
//   · the open field: sparse stars everywhere above the horizon, a few bright;
//   · the river: a great circle of the sky, about 30 degrees wide, arching to 56 degrees up, where faint stars crowd in their hundreds; it is
//     clumped along its length and cut by dark lanes, and a faint glow of the stars too small to see lies under it.
// Quiet behind the work: under 12 degrees of elevation there is no star and no glow, only the gradient (sky-dither row 2 holds the band from -10 to
// 10 degrees within 1.30:1 of the fog). Nothing moves: the twinkle changes a star's brightness in place, by at most 15%.
// Unlike Aurora's curtains and Skyline Night's city glow, the light here is all points. The noise is a sin-free hash (D391), read in 3D on the sky
// sphere, so there is no seam anywhere.
'use strict';

const SOURCE = `
float river_hash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float river_noise(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = mix(river_hash(i), river_hash(i + vec3(1.0, 0.0, 0.0)), u.x), b = mix(river_hash(i + vec3(0.0, 1.0, 0.0)), river_hash(i + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(river_hash(i + vec3(0.0, 0.0, 1.0)), river_hash(i + vec3(1.0, 0.0, 1.0)), u.x), d = mix(river_hash(i + vec3(0.0, 1.0, 1.0)), river_hash(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
// a point on one face of the cube round the eye, as a direction (the inverse of the face pick in river_field)
vec3 river_face(float face, vec2 uv) {
  if (face < 0.5) return vec3(1.0, uv.y, uv.x);
  if (face < 1.5) return vec3(-1.0, uv.y, uv.x);
  if (face < 2.5) return vec3(uv.x, 1.0, uv.y);
  if (face < 3.5) return vec3(uv.x, -1.0, uv.y);
  if (face < 4.5) return vec3(uv.x, uv.y, 1.0);
  return vec3(uv.x, uv.y, -1.0);
}
// the angle of one device pixel HERE: the pass's uPx (at the middle of the view; a page that sends none gets a pixel of a 2560 x 1440 screen at 60
// degrees) times cos^1.5 of the angle off the view's axis (vRay is the unit forward plus the screen offset, so dot(vRay, vRay) = 1 / cos^2). A flat
// screen spreads an angle over 1 / cos^2 as many pixels outward from its middle and 1 / cos across, so a star sized in uPx alone grew to about 2.4 px
// at a 2560 x 1440 corner; at cos^1.5 its spot covers the same area of screen everywhere (about 1.6 px by 1.0 at a corner), never under a pixel (D416)
float river_px() { return (uPx > 0.0 ? uPx : 0.0008) * pow(dot(vRay, vRay), -0.75); }
// the river's density at a direction: 1 on the great circle's line, falling off over about 15 degrees each side, clumped along it and cut by faint dark lanes (0.35 deep: at 0.85 they read as smudges, D416)
float river_density(vec3 d) {
  float b = dot(d, normalize(vec3(-0.370, -0.563, -0.739)));                     // the sine of the angle from the river's plane
  float core = exp(-b * b / (2.0 * 0.13 * 0.13));
  float clump = 0.45 + 0.55 * river_noise(d * 5.0 + 3.0);
  float lane = smoothstep(0.52, 0.70, river_noise(d * 11.0 + 17.0)) * exp(-b * b / (2.0 * 0.05 * 0.05));
  return core * clump * (1.0 - 0.35 * lane);
}
// one field of stars: one chance per cell of a grid of N on each cube face (the chance 'chance', 0..1), set in the middle half of its cell; each
// pixel sums the stars of the four cells nearest it. A star is a cone 1.25 px in radius, so it reaches past its own cell only when a quarter cell is
// under 1.25 px (with N 300, a window under about 1000 px tall at 60 degrees), and the four cells still hold it then. Returns the light, tinted
vec3 river_field(vec3 d, float t, float N, float seed, float base, float spread, float chance) {
  vec3 a = abs(d); vec2 uv; float face;
  if (a.x >= a.y && a.x >= a.z) { uv = d.zy / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
  vec2 g = (uv * 0.5 + 0.5) * N, c = floor(g) + step(0.5, fract(g)) - 1.0;
  vec3 s = vec3(0.0);
  for (int i = 0; i <= 1; i++) for (int j = 0; j <= 1; j++) {
    vec2 cc = c + vec2(float(i), float(j));
    if (cc.x < 1.0 || cc.y < 1.0 || cc.x > N - 2.0 || cc.y > N - 2.0) continue;   // none in a face's rim cells, so no star is cut at a seam
    float h1 = river_hash(vec3(cc, face + seed + 7.0)), h2 = river_hash(vec3(cc, face + seed + 13.0));
    vec3 sd = normalize(river_face(face, (cc + 0.25 + 0.5 * vec2(h1, h2)) / N * 2.0 - 1.0));
    if (river_hash(vec3(cc, face + seed)) > chance) continue;
    float h3 = river_hash(vec3(cc, face + seed + 19.0)), h4 = river_hash(vec3(cc, face + seed + 23.0));
    float bright = base + spread * h3 * h3 * h3;                                   // many faint, a few bright
    float tw = 1.0 - 0.15 * (0.5 + 0.5 * sin(t * (0.6 + 1.4 * h1) + 6.2832 * h2));  // the twinkle: brightness only, in place
    vec3 tint = h4 < 0.5 ? mix(vec3(1.0, 0.86, 0.72), vec3(1.0), h4 * 2.0) : mix(vec3(1.0), vec3(0.80, 0.88, 1.0), h4 * 2.0 - 1.0);
    s += tint * bright * tw * max(0.0, 1.0 - length(d - sd) / (1.25 * river_px()));   // a point: a cone 1.25 device px in radius
  }
  return s;
}
vec3 skyPattern(vec3 dir, float t) {
  float h = dir.y, e = max(h, 0.0);
  vec3 col = mix(uSkyB, uSky, smoothstep(0.06, 0.45, e));
  col = mix(col, uSkyA, smoothstep(0.35, 1.0, e));
  if (h < 0.0) col = mix(uSkyB, uSky, 0.4 * smoothstep(0.0, 0.6, -h));
  float up = smoothstep(0.21, 0.42, h);                                             // nothing under 12 degrees; all of it from 25 degrees up
  if (up <= 0.0) return col;
  float rho = river_density(dir);
  col += uSkyC * 0.045 * rho * (0.75 + 0.25 * river_noise(dir * 60.0)) * up;         // the glow of the stars too small to see
  // the open field, and the river's crowd (its chance follows the density here: it changes over degrees, so the four cells round a pixel share it)
  vec3 stars = river_field(dir, t, 180.0, 0.0, 0.40, 1.75, 0.035) + river_field(dir, t, 300.0, 40.0, 0.25, 0.75, 0.03 + 0.42 * rho);
  return col + uSkyC * stars * up;
}`;

module.exports = { source() { return SOURCE; } };
