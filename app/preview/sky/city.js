// sky/city.js: the 'city' sky (D405), Skyline Night's: Skyline's open sky after dark. The contract is in app/preview/sky/index.js.
// By elevation: a warm glow along the horizon (--sky-b, the city's light on the haze; held near the skin's fog for the first ten degrees, so the far road
// melts into it), giving way through the skin's night (--sky) to a deep zenith (--sky-a). The glow is stronger toward three cities round the horizon, each a
// broad soft swell in azimuth (whole multiples of the angle, so it closes with no seam). A few stars (--sky-c), small gaussians about a pixel across, fewer
// near the glow, twinkling in place by at most 15%. Nothing moves across the sky; only the twinkle changes, and the glow breathes over minutes by under 5%.
'use strict';

const SOURCE = `
float city_hash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }   // sin-free, as prism_hash (D391)
float city_stars(vec3 dir, float t) {
  // one candidate star per cell of a 3D grid laid through the sky sphere (no seam anywhere); about one cell in 60 holds one, kept off the cell's faces
  vec3 p = dir * 150.0, c = floor(p), f = p - c;
  float h = city_hash(c);
  if (h < 0.983) return 0.0;
  vec3 s = 0.4 + 0.2 * vec3(city_hash(c + 1.7), city_hash(c + 3.1), city_hash(c + 5.3));
  vec3 d = f - s;
  float b = (h - 0.983) / 0.017;
  float twinkle = 0.85 + 0.15 * sin(t * (0.6 + 0.9 * city_hash(c + 7.7)) + h * 40.0);
  return exp(-dot(d, d) / (2.0 * 0.13 * 0.13)) * (0.25 + 0.75 * b * b) * twinkle;
}
vec3 skyPattern(vec3 dir, float t) {
  float h = dir.y, e = max(h, 0.0), az = atan(dir.z, dir.x);
  // three cities round the horizon: broad swells of the glow in azimuth
  float cities = 0.45 * pow(0.5 + 0.5 * cos(az - 0.9), 6.0) + 0.35 * pow(0.5 + 0.5 * cos(az - 3.1), 8.0) + 0.25 * pow(0.5 + 0.5 * cos(az + 2.0), 10.0);
  float breathe = 0.97 + 0.03 * sin(t * 0.02 + az);
  // the night by elevation: the warm haze at the horizon, the skin's night, the deep zenith
  vec3 col = mix(uSkyB, uSky, smoothstep(0.04, 0.40, e));
  col = mix(col, uSkyA, smoothstep(0.30, 1.0, e));
  // the glow over the cities climbs a little higher and brighter
  float glow = (0.55 + cities) * breathe * exp(-e / 0.16);
  col = mix(col, uSkyB, clamp(0.35 * glow * smoothstep(0.0, 0.03, e + 0.03), 0.0, 0.6));
  if (h < 0.0) col = mix(uSkyB, uSky, 0.35 * smoothstep(0.0, 0.5, -h));   // below the horizon: the glow's haze, a little darker
  // the stars: none in the glow, a few higher up
  float stars = city_stars(dir, t) * smoothstep(0.20, 0.45, e);
  return col + uSkyC * stars * 0.9;
}`;

module.exports = { source() { return SOURCE; } };
