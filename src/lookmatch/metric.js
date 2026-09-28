// metric.js: the look-match number (ARCHITECTURE §5.3: "Render the same views in the builder and measure the image
// difference … The difference is a tracked number, not an impression"). PARKED until the keeper provides AC screenshots.
//
//   srgbToLab([r, g, b])            8-bit sRGB (D65) → CIELAB { L, a, b }
//   deltaE00(lab1, lab2)             CIEDE2000, as Sharma, Wu and Dalal, "The CIEDE2000 color-difference formula:
//                                   implementation notes, supplementary test data, and mathematical observations",
//                                   Color Research & Application 30(1), 2005 (kL = kC = kH = 1)
//   compareImages(ref, ours, opts)   { meanDE, p95DE, maxDE, pixels } over two RGBA images of one size; a pixel whose
//                                   alpha is below 128 in EITHER image is left out (a mask: sky, UI, anything not compared)
//
// WHY CIEDE2000, and not SSIM (D179): §5.3 tunes the LOOK (light, material colour, brightness) of a scene whose GEOMETRY
// is the same in both images (the same kn5 seen from the same fixed camera). ΔE00 measures exactly that, per pixel, in
// units with a meaning (about 1 is a just-noticeable difference, 2.3 the usual JND for flat patches). SSIM compares local
// structure and is largely blind to the global tone and brightness shifts that the tuning is about, and its value has no
// perceptual unit. The mean is the tracked number; the 95th percentile rides beside it, because a wrong material or a glare
// patch on a small part of the frame barely moves a mean.
'use strict';

function lin(c) { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const D65 = [0.95047, 1.0, 1.08883], E = 6 / 29;
const f = (t) => (t > E * E * E ? Math.cbrt(t) : t / (3 * E * E) + 4 / 29);
function srgbToLab([r8, g8, b8]) {
  const R = lin(r8), G = lin(g8), B = lin(b8);
  const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B, Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B, Z = 0.0193339 * R + 0.1191920 * G + 0.9503041 * B;
  const fx = f(X / D65[0]), fy = f(Y / D65[1]), fz = f(Z / D65[2]);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const RAD = Math.PI / 180, P25 = Math.pow(25, 7);
const hue = (b, a) => { if (a === 0 && b === 0) return 0; const h = Math.atan2(b, a) / RAD; return h < 0 ? h + 360 : h; };
function deltaE00(c1, c2) {
  const C1 = Math.hypot(c1.a, c1.b), C2 = Math.hypot(c2.a, c2.b), Cb = (C1 + C2) / 2, Cb7 = Math.pow(Cb, 7);
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + P25)));
  const a1 = (1 + G) * c1.a, a2 = (1 + G) * c2.a, C1p = Math.hypot(a1, c1.b), C2p = Math.hypot(a2, c2.b);
  const h1 = hue(c1.b, a1), h2 = hue(c2.b, a2);
  const dL = c2.L - c1.L, dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * RAD);
  const Lb = (c1.L + c2.L) / 2, Cbp = (C1p + C2p) / 2;
  let hb = h1 + h2;
  if (C1p * C2p !== 0) hb = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * RAD) + 0.24 * Math.cos(2 * hb * RAD) + 0.32 * Math.cos((3 * hb + 6) * RAD) - 0.20 * Math.cos((4 * hb - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2)), Cbp7 = Math.pow(Cbp, 7), RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + P25));
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * RAD) * RC;
  const l = dL / SL, c = dC / SC, hh = dH / SH;
  return Math.sqrt(l * l + c * c + hh * hh + RT * c * hh);
}

function compareImages(ref, ours) {
  for (const [name, im] of [['ref', ref], ['ours', ours]]) {
    if (!im || !(im.width > 0) || !(im.height > 0) || !im.rgba || im.rgba.length !== im.width * im.height * 4) throw new Error(`lookmatch: ${name} is not an RGBA image`);
  }
  if (ref.width !== ours.width || ref.height !== ours.height) throw new Error(`lookmatch: the images differ in size (${ref.width}×${ref.height} vs ${ours.width}×${ours.height}); render the view at the reference's size`);
  const A = ref.rgba, B = ours.rgba, cache = new Map(), lab = (p, i) => { const k = (p[i] << 16) | (p[i + 1] << 8) | p[i + 2]; let v = cache.get(k); if (!v) { v = srgbToLab([p[i], p[i + 1], p[i + 2]]); cache.set(k, v); } return v; };
  const d = [];
  for (let i = 0; i < A.length; i += 4) {
    if (A[i + 3] < 128 || B[i + 3] < 128) continue;
    d.push(A[i] === B[i] && A[i + 1] === B[i + 1] && A[i + 2] === B[i + 2] ? 0 : deltaE00(lab(A, i), lab(B, i)));
  }
  if (!d.length) throw new Error('lookmatch: no pixel is compared (every pixel is masked)');
  const sorted = Float64Array.from(d).sort(), sum = d.reduce((x, y) => x + y, 0);
  return { meanDE: sum / d.length, p95DE: sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)], maxDE: sorted[sorted.length - 1], pixels: d.length };
}

module.exports = { srgbToLab, deltaE00, compareImages };
