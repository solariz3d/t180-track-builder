// sky/sun.js: the 'sun' sky (D384), Skyline's open sky. The contract is in app/preview/sky/index.js.
// A day sky by elevation: the pale horizon (--sky-b) under the skin's sky (--sky) under the deep zenith (--sky-a), the same pale below the horizon (with
// no ground, the track floats in sky); a sun fixed in the world, high in one quarter of it, with a wide soft glow and a small bright disc (--sky-c); and a
// faint haze along the horizon that drifts round very slowly. What D379 drew as a sunlit haze pinned to the screen's top right is now that sun.
'use strict';

const SOURCE = `
vec3 skyPattern(vec3 dir, float t) {
  float h = dir.y;
  vec3 col = h >= 0.0 ? mix(mix(uSkyB, uSky, smoothstep(0.0, 0.22, h)), uSkyA, smoothstep(0.22, 0.95, h)) : mix(uSkyB, uSky, smoothstep(0.0, -0.6, h) * 0.5);
  vec3 sunDir = normalize(vec3(0.55, 0.45, -0.70));
  float s = max(dot(dir, sunDir), 0.0);
  col = mix(col, uSkyC, clamp(0.5 * pow(s, 10.0) + pow(s, 900.0), 0.0, 1.0));
  float az = atan(dir.z, dir.x + 1e-6);
  float haze = 0.5 + 0.5 * sin(az * 3.0 + t * 0.02 + 0.6 * sin(az * 7.0 - t * 0.013));
  col = mix(col, uSkyC, 0.10 * haze * smoothstep(-0.05, 0.08, h) * (1.0 - smoothstep(0.08, 0.35, h)));
  return col;
}`;

module.exports = { source() { return SOURCE; } };
