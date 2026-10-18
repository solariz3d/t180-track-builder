// sky/sun.js: the 'sun' sky (D384), Skyline's clear day with depth. The contract is in app/preview/sky/index.js.
// By elevation: the horizon's pale (--sky-b, held near the skin's fog for the first ten degrees, so the far road melts into it) deepening through the skin's
// sky (--sky) to the zenith (--sky-a); a touch paler on the sun's side and deeper away from it. A sun fixed in the world, low in one quarter of it, with a
// small soft disc, a corona and a faint wide bloom (--sky-c). Thin high cirrus streaks on the sun's side of the sky, drifting on one wind over minutes; and a
// low haze band along the horizon. Every edge is soft: the disc fades over about eight pixels, the cirrus's finer strokes fade out where they would be finer
// than a pixel (at the default 60° lens), and nothing crosses the view in under a minute.
'use strict';

const SOURCE = `
float sun_hash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float sun_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sun_hash(i), sun_hash(i + vec2(1.0, 0.0)), u.x), mix(sun_hash(i + vec2(0.0, 1.0)), sun_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// cirrus: centred noise summed over five octaves; k is how many deck units one radian of view spans here, so an octave finer than about a pixel fades out
float sun_cirrus(vec2 q, float k) {
  float s = 0.0, a = 0.5, f = 1.0;
  for (int o = 0; o < 5; o++) {
    s += a * (1.0 - smoothstep(0.12, 0.30, f * 4.0 * k * 0.0017)) * (sun_noise(q * f + vec2(float(o) * 17.3, float(o) * 9.1)) - 0.5);
    f *= 2.03; a *= 0.5;
  }
  return s;
}
vec3 skyPattern(vec3 dir, float t) {
  float h = dir.y, e = max(h, 0.0);
  vec3 sunDir = normalize(vec3(0.596, 0.375, -0.710));   // about 22 degrees up, a quarter round from straight ahead at the start
  float cosS = dot(dir, sunDir);
  // the gradient, and its depth: paler toward the sun, deeper away from it
  vec3 col = mix(uSkyB, uSky, smoothstep(0.06, 0.45, e));
  col = mix(col, uSkyA, smoothstep(0.35, 1.0, e));
  col = mix(col, uSkyA, 0.14 * (0.5 - 0.5 * cosS) * smoothstep(0.12, 0.6, e));
  col = mix(col, uSkyB, 0.22 * pow(max(cosS, 0.0), 5.0) * smoothstep(0.02, 0.2, e));
  if (h < 0.0) col = mix(uSkyB, uSky, 0.3 * smoothstep(0.0, -0.6, h));   // below the horizon: the same pale, a little deeper (no ground: the track floats in sky)
  // cirrus, on a deck overhead: long along the wind, thin across it, drifting with it
  if (h > 0.05) {
    vec2 p = dir.xz / (h + 0.06);
    float k = (1.0 + 0.06 * h) / ((h + 0.06) * (h + 0.06));
    vec2 w = vec2(0.8, -0.6);
    vec2 q = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
    q.x -= t * 0.010;
    q *= vec2(0.5, 4.0);
    float c = smoothstep(0.10, 0.26, sun_cirrus(q + vec2(0.0, 0.6 * sun_noise(q * vec2(0.3, 0.5) + t * 0.002)), k));
    float side = smoothstep(-0.25, 0.85, dot(normalize(dir.xz + vec2(1e-5)), normalize(sunDir.xz)));
    float deck = smoothstep(0.12, 0.32, h) * (1.0 - smoothstep(0.75, 0.97, h));
    col = mix(col, mix(uSkyB, uSkyC, 0.55 + 0.45 * pow(max(cosS, 0.0), 4.0)), 0.38 * c * side * deck);
  }
  // the low haze band along the horizon, its strength wandering slowly round
  float az = atan(dir.z, dir.x);
  float haze = exp(-h * h / (2.0 * 0.035 * 0.035)) * (0.75 + 0.25 * sin(az * 2.0 + t * 0.004 + 0.8 * sin(az * 5.0 - t * 0.003)));
  col = mix(col, mix(uSkyB, uSkyC, 0.5), 0.45 * haze);
  // the sun: a faint wide bloom, a corona, a small soft disc
  float ang = length(dir - sunDir);
  float sun = 0.16 * exp(-ang / 0.40) + 0.55 * exp(-ang * ang / (2.0 * 0.045 * 0.045)) + 1.0 - smoothstep(0.010, 0.024, ang);
  return mix(col, uSkyC, clamp(sun, 0.0, 1.0));
}`;

module.exports = { source() { return SOURCE; } };
