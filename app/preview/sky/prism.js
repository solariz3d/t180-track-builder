// sky/prism.js: the 'prism' sky (D384 widened), Glass's cold clear night, the quietest of the skies. The contract is in app/preview/sky/index.js.
// By elevation: the horizon (--sky-b, held near the skin's fog for the first ten degrees) darkening through the skin's sky (--sky) to the zenith (--sky-a).
// A sparse field of fine stars (--sky-c) with a faint twinkle, fading out toward the horizon as real stars do through the air. A pale, cold moon with a soft
// limb, a faint face and a halo. Low on the horizon, a thin soft band of light split into a faint spectrum, as if refracted through glass, brightest toward
// the moon and its strength wandering slowly round. Every edge is soft (a star is a small gaussian, the moon's limb fades over about twelve pixels), and
// nothing moves across the sky: the twinkle changes a star's brightness in place, and the band's strength wanders round over many minutes.
'use strict';

const SOURCE = `
float prism_hash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float prism_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(prism_hash(vec3(i, 1.0)), prism_hash(vec3(i + vec2(1.0, 0.0), 1.0)), u.x), mix(prism_hash(vec3(i + vec2(0.0, 1.0), 1.0)), prism_hash(vec3(i + vec2(1.0, 1.0), 1.0)), u.x), u.y);
}
// a point on one face of the cube round the eye, as a direction (the inverse of the face pick in prism_stars)
vec3 prism_face(float face, vec2 uv) {
  if (face < 0.5) return vec3(1.0, uv.y, uv.x);
  if (face < 1.5) return vec3(-1.0, uv.y, uv.x);
  if (face < 2.5) return vec3(uv.x, 1.0, uv.y);
  if (face < 3.5) return vec3(uv.x, -1.0, uv.y);
  if (face < 4.5) return vec3(uv.x, uv.y, 1.0);
  return vec3(uv.x, uv.y, -1.0);
}
// the stars: one chance of a star per cell of a grid on each cube face, set in the middle half of its cell; each pixel sums the stars of the four cells
// nearest it (its own and the three on the side it is nearer): a star in any other cell is at least three quarters of a cell away, under a thousandth of
// its peak in the middle of a face and a little more toward a face's corners, where cells are smaller (at most 8 of 255 against summing all nine)
float prism_stars(vec3 d, float t) {
  vec3 a = abs(d); vec2 uv; float face;
  if (a.x >= a.y && a.x >= a.z) { uv = d.zy / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
  float N = 120.0;
  vec2 g = (uv * 0.5 + 0.5) * N, c = floor(g) + step(0.5, fract(g)) - 1.0;
  float s = 0.0;
  for (int i = 0; i <= 1; i++) for (int j = 0; j <= 1; j++) {
    vec2 cc = c + vec2(float(i), float(j));
    if (cc.x < 1.0 || cc.y < 1.0 || cc.x > N - 2.0 || cc.y > N - 2.0) continue;   // none in a face's rim cells, so no star is cut at a seam
    if (prism_hash(vec3(cc, face)) > 0.035) continue;                             // sparse
    float h1 = prism_hash(vec3(cc, face + 7.0)), h2 = prism_hash(vec3(cc, face + 13.0)), h3 = prism_hash(vec3(cc, face + 19.0));
    vec3 sd = normalize(prism_face(face, (cc + 0.25 + 0.5 * vec2(h1, h2)) / N * 2.0 - 1.0)), dd = d - sd;
    float b = h3 * h3 * h3, sig = 0.0020 + 0.0012 * b;                            // many faint, a few bright and a little wider
    float tw = 1.0 - 0.18 * (0.5 + 0.5 * sin(t * (0.7 + 1.6 * h1) + 6.2832 * h2)); // the twinkle: brightness only, in place
    s += (0.08 + 0.18 * b) * tw * exp(-dot(dd, dd) / (2.0 * sig * sig));
  }
  return s;
}
vec3 skyPattern(vec3 dir, float t) {
  float h = dir.y, e = max(h, 0.0);
  vec3 col = mix(uSkyB, uSky, smoothstep(0.06, 0.45, e));
  col = mix(col, uSkyA, smoothstep(0.35, 1.0, e));
  if (h < 0.0) col = mix(uSkyB, uSky, 0.4 * smoothstep(0.0, -0.6, h));
  if (h > 0.17) col += uSkyC * prism_stars(dir, t) * smoothstep(0.17, 0.40, h);   // the air takes the stars near the horizon
  // the moon: about 30 degrees up, a quarter round to the left of straight ahead at the start
  vec3 moonDir = normalize(vec3(-0.557, 0.50, -0.663));
  float ma = length(dir - moonDir), R0 = 0.024;
  col += uSkyC * (0.10 * exp(-ma / 0.06) + 0.035 * exp(-ma / 0.35));
  if (ma < R0 + 0.010) {   // the disc and its soft limb (its face is worked out only here)
    vec3 mu = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0))), mv = cross(mu, moonDir);
    vec2 mp = vec2(dot(dir - moonDir, mu), dot(dir - moonDir, mv)) / R0;
    float faceShade = 0.86 - 0.16 * smoothstep(0.45, 0.75, prism_noise(mp * 1.7 + 3.1));
    vec3 moonCol = mix(uSkyC, vec3(0.78, 0.85, 0.92), 0.4) * 0.62 * faceShade;
    col = mix(col, moonCol, 1.0 - smoothstep(R0 - 0.010, R0 + 0.010, ma));
  }
  // the prismatic band: a thin soft band low on the horizon, the spectrum across its height (red at its top), brightest toward the moon
  float x = clamp((h - 0.050) / 0.040 * 0.5 + 0.5, 0.0, 1.0);
  float env = exp(-(h - 0.050) * (h - 0.050) / (2.0 * 0.024 * 0.024));
  vec3 spec = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) - (1.0 - x) * 0.85));
  float az = atan(dir.z, dir.x);
  float along = 0.5 + 0.5 * sin(az * 2.0 + 1.1 + 0.9 * sin(az * 3.0 - t * 0.005) + t * 0.004);
  float toward = pow(max(dot(normalize(dir.xz + vec2(1e-5)), normalize(moonDir.xz)), 0.0), 2.0);
  col += spec * env * (0.020 + 0.030 * along) * (0.6 + 0.4 * toward);
  return col;
}`;

module.exports = { source() { return SOURCE; } };
