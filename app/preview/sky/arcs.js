// sky/arcs.js (D490 PROTOTYPE, pane C): the GLSL of the reworked aurora, shared by the three prototype styles aurora1/2/3 (sky/aurora1.js and on).
// Not a sky style itself: each style calls source(prefix, opts) for its own copy, its helpers named with its own prefix (the sky contract, index.js).
//
// THE MODEL (E's D489 research, p-d489-aurora-research-E_2026-10-27.md §0-§3; written here from that, nothing copied): an aurora is a few CURTAINS,
// thin vertical sheets of light hung along the magnetic field at about 100 to 300 km up. Each runs roughly magnetic east-west for far longer than
// the sky is wide, so seen from the ground it rises from one horizon, crosses the sky and sets at the other. The field dips 77 degrees, so the
// sheets lean a little: their rays run along it and converge by perspective on the MAGNETIC zenith, 13 degrees south of the zenith; seen from under
// a curtain that is the corona, green ray bases outward and faint tops converging (and nothing drawn at the point itself).
//   Units: 1 = 100 km. The viewer is at the origin; a sky at infinity uses only the direction. A point p has field-line coordinates u (along the arc,
//   magnetic east), v (across it, magnetic north) of the field line's foot, and h its height. A curtain k is the sheet v = D_k + F_k(u, t), the folds
//   F a domain-warped fbm in u drifting in time; its light starts at the hem h = hem_k(u, t) (a sharp lower edge near 100 km), green, fading upward
//   with a tail as long as the ray is strong, red-topped above about 200 km, and a thin magenta lower border only under a bright ray.
//   Motion in layers (E §3): the arc's shape drifts at about 0.15 km/s, the folds and curls along it at under 1 km/s, the rays along the hem at about
//   1 km/s and low in contrast, a pulsating patch field over about 9 s; nothing large crosses the view in under four minutes (D403).
// Two ways to draw a curtain:
//   SHEET   one hit: the ray meets the sheet once (a Newton step for the fold), and the light there is weighted by 1 / |cos| of the angle to the sheet
//           (a sheet seen edge-on is brighter, as real curtains are). Cheap: today's cost.
//   VOLUME  the ray is marched through the curtain's slab in N steps, and in each step the sheet's Gaussian thickness is integrated exactly across the
//           step (the folded sheet's offset taken at both ends of the step, an erf difference), so a fold seen edge-on is as bright as it should be and
//           the result is soft and has no banding at any step count; N only has to follow the folds' shape.
// opts = { curtains: [{ D, W, amp, seed, gain, volume }], steps, overlay }   overlay true: skyPattern leaves out the stars, and skyOverlay(dir, t)
// returns them, for a style drawn at a lower resolution (sky/index.js scaleOf) whose stars stay sharp in the full-resolution composite (D416).
'use strict';

function source(P, opts) {
  const steps = opts.steps || 24;
  const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));
  const curtainCalls = opts.curtains.map((c, k) => `  col += ${f(c.gain)} * ${P}_${c.volume ? 'volume' : 'sheet'}(d, dq, t, ${f(c.D)}, ${f(c.W)}, ${f(c.amp)}, ${f(c.seed)}, act);`).join('\n');
  return `
float ${P}_hash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }   // sin-free (D391)
float ${P}_h2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float ${P}_vn(vec2 p) { vec2 i = floor(p), w = fract(p); w = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  return mix(mix(${P}_h2(i), ${P}_h2(i + vec2(1.0, 0.0)), w.x), mix(${P}_h2(i + vec2(0.0, 1.0)), ${P}_h2(i + vec2(1.0, 1.0)), w.x), w.y); }
float ${P}_fbm3(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * ${P}_vn(p); p = vec2(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y) + 3.7; a *= 0.5; } return s / 0.875; }   // the fold's, run at every step of a volume
float ${P}_fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * ${P}_vn(p); p = vec2(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y) + 3.7; a *= 0.5; } return s / 0.9375; }
// the device pixel's angle here, as aurora.js's (D416)
float ${P}_px() { return (uPx > 0.0 ? uPx : 0.0008) * pow(dot(vRay, vRay), -0.75); }
// the frame: magnetic north and east (north is the cameras' azimuth), and the field direction upward, dipping 77 degrees
const vec3 ${P}_N = vec3(-0.6430, 0.0, -0.7658);
const vec3 ${P}_E = vec3(0.7658, 0.0, -0.6430);
const vec3 ${P}_B = vec3(0.1447, 0.9744, 0.1723);
// the fold: the sheet's offset across the arc at u, metres of 100 km. A long gentle bend (the arc is not straight), folds of tens of km drifting
// slowly along it, and curls on those, the curls' positions warped by a slower noise so they roll rather than slide
float ${P}_fold(float u, float t, float amp, float sd) {
  float bend = 0.5 * (${P}_vn(vec2(u * 0.07 + sd, sd * 1.7)) - 0.5);
  float big = ${P}_fbm3(vec2(u * 0.55 - t * 0.0009, sd)) - 0.5;
  float warp = ${P}_vn(vec2(u * 1.7 + sd, t * 0.004));
  float curl = ${P}_vn(vec2(u * 4.5 + 1.4 * warp - t * 0.004, sd + 5.0)) - 0.5;
  return bend + amp * (2.0 * big + 0.55 * curl);
}
float ${P}_hem(float u, float t, float sd) { return 1.0 + 0.09 * (${P}_vn(vec2(u * 1.3 + sd, t * 0.003 + sd)) - 0.5); }
// the rays: columns 2 to 3 km wide running along the hem at about 1 km/s, over groups 8 km wide; fpx is how much u one pixel spans here, so a ray
// scale finer than about two pixels fades to its mean instead of shimmering
float ${P}_rays(float u, float t, float sd, float fpx) {
  float fine = ${P}_vn(vec2(u * 40.0 - t * 0.45, sd + 9.0)), mid = ${P}_vn(vec2(u * 12.0 + t * 0.06, sd + 2.0));
  fine = mix(0.5, fine, 1.0 - smoothstep(0.012, 0.03, fpx)); mid = mix(0.5, mid, 1.0 - smoothstep(0.04, 0.1, fpx));
  return smoothstep(0.2, 0.85, 0.55 * fine + 0.45 * mid);
}
// the light of a curtain at height hh over its hem, under ray strength r, along-arc brightness g: rgb. Green at the hem, a touch of the skin's violet
// as it climbs (the skin's palette; nature's is blue at the same height, E §1.2), red above 200 km, and a magenta lower border under a bright ray
vec3 ${P}_light(float hh, float r, float g, float act) {
  float up = max(hh, 0.0);
  float green = smoothstep(-0.035, 0.015, hh) * (0.55 * exp(-up / 0.1) + 0.45 * exp(-up / (0.14 + 0.5 * r))) * (0.25 + 0.75 * r);
  float red = smoothstep(0.55, 1.4, hh) * exp(-max(hh - 1.4, 0.0) / 0.8) * (0.35 + 0.65 * r) * 0.16;
  vec3 rc = vec3(uSkyB.b, 0.5 * uSkyB.g, 0.9 * uSkyB.r);                                  // the violet token turned toward red, as aurora.js
  float d = (hh + 0.03) / 0.018, edge = exp(-d * d) * smoothstep(0.55, 0.95, r * g) * act;
  vec3 c = mix(uSkyA, uSkyB, 0.22 * smoothstep(0.12, 0.7, hh)) * green + rc * red + mix(rc, uSkyB, 0.4) * edge * 0.45;
  return c * g;
}
float ${P}_along(float u, float t, float sd) {
  float span = 0.35 + 0.65 * ${P}_fbm(vec2(u * 0.33 + sd * 3.0, t * 0.0025));                 // brighter in stretches, never gone
  float pulse = 1.0 + 0.22 * smoothstep(0.62, 0.9, ${P}_vn(vec2(u * 1.6 + sd, t / 9.0)));      // a patch that brightens over about 9 s
  return span * pulse;
}
vec3 ${P}_sheet(vec3 d, vec3 dq, float t, float D, float W, float amp, float sd, float act) {
  float vd = dot(dq, ${P}_N), ud = dot(dq, ${P}_E);
  if (vd * D <= 0.0 || abs(vd) < 1e-4) return vec3(0.0);
  float s = D / vd; s = (D + ${P}_fold(s * ud, t, amp, sd)) / vd;
  if (s <= 0.0 || s > 40.0) return vec3(0.0);
  float u = s * ud, h = s * d.y, hem = ${P}_hem(u, t, sd);
  if (h < hem - 0.08 || h > hem + 2.6) return vec3(0.0);
  vec3 nrm = normalize(cross(${P}_E, ${P}_B));
  float k = 0.02 / max(abs(dot(d, nrm)), 0.08);
  return ${P}_light(h - hem, ${P}_rays(u, t, sd, s * ${P}_px()), ${P}_along(u, t, sd), act) * k * 22.0;
}
float ${P}_erf(float x) { float e = exp(-1.2732 * x * x); return sign(x) * sqrt(1.0 - e * (1.0 - 0.14 * x * x) / (1.0 + 0.14 * x * x)); }   // within 1e-3
vec3 ${P}_volume(vec3 d, vec3 dq, float t, float D, float W, float amp, float sd, float act) {
  float vd = dot(dq, ${P}_N), ud = dot(dq, ${P}_E);
  if (d.y < 0.015) return vec3(0.0);
  float A = 0.25 + 1.3 * amp + 3.0 * W;                                                     // the slab the folded sheet can be in: |fold| <= 0.25 + 1.275 amp, and its thickness
  float s0 = 0.86 / d.y, s1 = min(3.4 / d.y, 40.0);
  if (abs(vd) > 1e-4) { float a = (D - A) / vd, b = (D + A) / vd; s0 = max(s0, min(a, b)); s1 = min(s1, max(a, b)); }
  if (s1 <= s0) return vec3(0.0);
  float ds = (s1 - s0) / ${steps}.0;
  vec3 col = vec3(0.0);
  float sa = s0, ca = ${P}_fold(sa * ud, t, amp, sd), da = sa * vd - D - ca;
  for (int i = 0; i < ${steps}; i++) {
    float sb = sa + ds, cb = ${P}_fold(sb * ud, t, amp, sd), db = sb * vd - D - cb;
    float cover = 0.5 * abs(${P}_erf(db / W) - ${P}_erf(da / W));                              // how much of the sheet's thickness this step crosses
    if (cover > 0.0015) {
      float x = (da * db < 0.0) ? da / (da - db) : (abs(da) < abs(db) ? 0.0 : 1.0), sm = sa + x * ds, u = sm * ud, h = sm * d.y, hem = ${P}_hem(u, t, sd);   // the light where the ray crosses the sheet, or the end of the step nearest it (a step's middle left seams)
      float slope = abs(db - da) / ds;                                                    // how fast the ray crosses the sheet: slow (edge-on) is bright
      col += ${P}_light(h - hem, ${P}_rays(u, t, sd, sm * ${P}_px()), ${P}_along(u, t, sd), act) * cover * (0.02 / max(slope, 0.08)) * 22.0;   // W sets only the softness; the brightness of a crossing is a thin sheet's
    }
    sa = sb; da = db;
  }
  return col;
}
float ${P}_stars(vec3 dir, float t) {
  vec3 p = dir * 180.0, c = floor(p);
  float h = ${P}_hash(c);
  if (h < 0.96) return 0.0;
  vec3 s = 0.4 + 0.2 * vec3(${P}_hash(c + 1.7), ${P}_hash(c + 3.1), ${P}_hash(c + 5.3));
  vec3 sd = normalize(c + s), q = sd * 180.0 - c;
  if (any(lessThan(q, vec3(0.2))) || any(greaterThan(q, vec3(0.8)))) return 0.0;
  float b = (h - 0.96) / 0.04;
  float twinkle = 0.85 + 0.15 * sin(t * (0.7 + 1.1 * ${P}_hash(c + 7.7)) + h * 40.0);
  return max(0.0, 1.0 - length(dir - sd) / (1.25 * ${P}_px())) * 1.8 * (0.18 + 0.82 * b * b) * twinkle;
}
vec3 ${P}_night(float el) { vec3 n = mix(uSkyC, uSky, smoothstep(0.0, 0.42, el)); return mix(n, mix(uSkyC, uSky, 0.5), 1.0 - smoothstep(-0.35, 0.0, el)); }
vec3 ${P}_aurora(vec3 d, float t) {
  vec3 dq = d - ${P}_B * (d.y / ${P}_B.y);
  float act = 0.6;
  vec3 col = vec3(0.0);
${curtainCalls}
  float el = asin(clamp(d.y, -1.0, 1.0));
  return col * smoothstep(0.175, 0.25, el);                                                // nothing under about 10 degrees, as today
}
vec3 skyPattern(vec3 dir, float t) {
  float el = asin(clamp(dir.y, -1.0, 1.0));
  vec3 light = ${P}_aurora(dir, t);
  vec3 col = 1.0 - (1.0 - ${P}_night(el)) * (1.0 - clamp(light, 0.0, 1.0));
${opts.overlay ? '  return col;' : `  float glow = clamp(dot(light, vec3(0.3333)), 0.0, 1.0);
  return col + vec3(0.85, 0.9, 1.0) * ${P}_stars(dir, t) * smoothstep(0.17, 0.35, el) * (1.0 - 0.7 * glow);`}
}
${opts.overlay ? `vec3 skyOverlay(vec3 dir, float t, vec3 under) {
  float el = asin(clamp(dir.y, -1.0, 1.0)), glow = clamp(dot(max(under - ${P}_night(el), 0.0), vec3(0.3333)) * 1.5, 0.0, 1.0);
  return vec3(0.85, 0.9, 1.0) * ${P}_stars(dir, t) * smoothstep(0.17, 0.35, el) * (1.0 - 0.7 * glow);
}` : ''}
`;
}

module.exports = { source };
