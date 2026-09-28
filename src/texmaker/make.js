// make.js: a texture's text → pixels. ARCHITECTURE §5b "Make your own: a texture maker inside the program".
//
//   makeTexture(params, width, height) -> { width, height, rgba: Uint8Array (RGBA, rows top to bottom), emissive: Uint8Array | null }
//
// `params` is a texture (text or object; see text.js), checked first. The image's columns run across the road (u) and its
// rows along it (v). `emissive` is an RGBA map holding only the glow layers marked `emissive`, or null when there are none
// (AC takes emissive as a material property; the map is for the slot that wants it, A's call).
//
// THE SAME TEXT GIVES THE SAME BYTES, on every run and every engine: the arithmetic is + − × ÷, Math.floor, Math.round and
// Math.imul integer hashing only. No sin, exp or pow, whose last bits the language does not pin down.
//
// RESOLUTION INDEPENDENCE. A pixel is the average of the texture over its footprint:
//   · hard-edged layers (grain, stripes, lines, gradient bands, panels) are integrated EXACTLY over the footprint, so a
//     512² render averaged 2×2 equals the 256² render up to 8-bit rounding;
//   · smooth layers (noise, smooth gradients, glow) are sampled at the pixel's centre, exact for anything linear across it;
//     noise octaves finer than the render can hold fade out (full up to 4 px per cell, gone at 2 px);
//   · decals, whose edges are not axis-aligned, are supersampled 4×4 in the footprint.
// app/../test/texmaker.test.js states the bound this gives and measures it.
'use strict';

const { normalize, parse } = require('./text.js');
const { TexmakerError } = require('./errors.js');
const { MAX_SIDE } = require('./schema.js');

/** A 32-bit integer hash of up to four integers and a seed → [0, 1). */
function hash(a, b, c, seed) {
  let h = (seed | 0) ^ 0x9e3779b9;
  for (const x of [a, b, c]) { h = Math.imul(h ^ (x | 0), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; }
  return (h >>> 0) / 4294967296;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const rgbOf = (hex) => [1, 3, 5, 7].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
const smooth = (t) => t * t * (3 - 2 * t);
const mod = (x, m) => x - Math.floor(x / m) * m;

// ── exact 1D box integrals ──
/** ∫ over [0, x] of a periodic indicator: period P, on for `on` (a length) starting at `start`. */
function periodicF(x, P, on, start) {
  const y = x - start, k = Math.floor(y / P), r = y - k * P;
  return k * on + (r < on ? r : on);
}
/** The fraction of [a, b] covered by that periodic indicator. */
const periodicCover = (a, b, P, on, start) => (on <= 0 ? 0 : on >= P ? 1 : (periodicF(b, P, on, start) - periodicF(a, P, on, start)) / (b - a));
/** The fraction of [a, b] inside [lo, hi]. */
const intervalCover = (a, b, lo, hi) => { const o = Math.min(b, hi) - Math.max(a, lo); return o > 0 ? o / (b - a) : 0; };
/** Weights of the integer cells of a lattice of N cells per unit that [a, b] overlaps: [[cell, weight]], weights sum to 1. */
function cellWeights(a, b, N) {
  const out = [], A = a * N, B = b * N, L = B - A;
  for (let k = Math.floor(A); k < B; k++) { const w = (Math.min(B, k + 1) - Math.max(A, k)) / L; if (w > 0) out.push([k, w]); }
  return out;
}

// ── the layers: each returns, for a pixel footprint [u0,u1]×[v0,v1] (centre uc, vc), [r, g, b, a] or an emissive part ──
function fbm(l, u, v, size) {
  let sum = 0, total = 0, amp = 1, cells = l.cells;
  for (let o = 0; o < l.octaves; o++, cells *= 2, amp *= l.persistence) {
    total += amp;
    const fade = clamp01((size / 2 - cells) / (size / 4));   // 1 up to size/4 cells (4 px a cell), 0 at size/2 (2 px)
    if (fade <= 0) continue;
    const x = u * cells, y = v * cells, i = Math.floor(x), j = Math.floor(y), fx = smooth(x - i), fy = smooth(y - j);
    const at = (p, q) => hash(mod(p, cells), mod(q, cells), o, l.seed);   // periodic lattice: the texture tiles
    const n = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
    sum += amp * fade * (n - 0.5);
  }
  return total > 0 ? clamp01(0.5 + sum / total) : 0.5;
}
/** A stop list's colour at t in [0, 1): 'bands' holds each stop to the next; 'smooth' blends, wrapping to the first. */
function stopAt(stops, t, bands) {
  let k = stops.length - 1; while (k > 0 && stops[k].at > t) k--;
  if (bands) return stops[k].rgb;
  const a = stops[k], b = k + 1 < stops.length ? stops[k + 1] : { at: 1, rgb: stops[0].rgb }, s = (t - a.at) / (b.at - a.at);
  return a.rgb.map((x, c) => x + (b.rgb[c] - x) * s);
}
/** Exact average of the BANDS gradient over [a, b] of its coordinate. */
function bandsAverage(stops, repeat, a, b) {
  const acc = [0, 0, 0, 0], A = a * repeat, B = b * repeat, L = B - A;
  for (let p = Math.floor(A); p < B; p++) {
    for (let k = 0; k < stops.length; k++) {
      const lo = p + stops[k].at, hi = p + (k + 1 < stops.length ? stops[k + 1].at : 1), o = Math.min(B, hi) - Math.max(A, lo);
      if (o > 0) for (let c = 0; c < 4; c++) acc[c] += stops[k].rgb[c] * o / L;
    }
  }
  return acc;
}
function decalInside(shape, x, y) {   // x, y in the decal's own half-size units
  if (shape === 'rect') return x >= -1 && x <= 1 && y >= -1 && y <= 1;
  if (shape === 'circle') return x * x + y * y <= 1;
  if (shape === 'diamond') return Math.abs(x) + Math.abs(y) <= 1;
  const ax = Math.abs(x); return ax <= 1 && y >= ax - 1 && y <= ax - 0.1;   // chevron: a V band pointing back along v
}

function prepare(t) {
  return t.layers.map((l) => {
    const p = { ...l, rgb: l.colour ? rgbOf(l.colour) : null };
    if (l.type === 'gradient') p.stops = l.stops.map((s) => ({ at: s.at, rgb: rgbOf(s.colour) }));
    return p;
  });
}

function makeTexture(params, width, height) {
  for (const [k, v] of [['width', width], ['height', height]]) if (!Number.isInteger(v) || v < 1 || v > MAX_SIDE) throw new TexmakerError('BAD_SIZE', `${k}: ${JSON.stringify(v)} is not a whole number of pixels from 1 to ${MAX_SIDE}`);
  const t = typeof params === 'string' ? parse(params) : normalize(params), L = prepare(t), base = rgbOf(t.base);
  const glowsEmissive = L.some((l) => l.type === 'glow' && l.emissive);
  const rgba = new Uint8Array(width * height * 4), emissive = glowsEmissive ? new Uint8Array(width * height * 4) : null;
  const size = Math.min(width, height);
  for (let y = 0; y < height; y++) {
    const v0 = y / height, v1 = (y + 1) / height, vc = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u0 = x / width, u1 = (x + 1) / width, uc = (x + 0.5) / width;
      let r = base[0], g = base[1], b = base[2], a = base[3], er = 0, eg = 0, eb = 0;
      const blend = (mode, cr, cg, cb, k) => {
        if (k <= 0) return;
        if (mode === 'over') { r += (cr - r) * k; g += (cg - g) * k; b += (cb - b) * k; a += (1 - a) * k; }
        else if (mode === 'multiply') { r *= 1 + (cr - 1) * k; g *= 1 + (cg - 1) * k; b *= 1 + (cb - 1) * k; }
        else { r = clamp01(r + cr * k); g = clamp01(g + cg * k); b = clamp01(b + cb * k); }
      };
      for (const l of L) {
        const c = l.rgb;
        switch (l.type) {
          case 'grain': {
            let s = 0; const wu = cellWeights(u0, u1, l.cells), wv = cellWeights(v0, v1, l.cells);
            for (const [j, wj] of wv) for (const [i, wi] of wu) s += wi * wj * hash(mod(i, l.cells), mod(j, l.cells), 7, l.seed);
            blend(l.blend, c[0], c[1], c[2], l.amount * c[3] * s);
            break;
          }
          case 'noise': blend(l.blend, c[0], c[1], c[2], l.amount * c[3] * fbm(l, uc, vc, size)); break;
          case 'gradient': {
            const [a0, a1, ac] = l.dir === 'along' ? [u0, u1, uc] : [v0, v1, vc];
            const col = l.mode === 'bands' ? bandsAverage(l.stops, l.repeat, a0, a1) : stopAt(l.stops, mod(ac * l.repeat, 1), false);
            blend(l.blend, col[0], col[1], col[2], l.amount * col[3]);
            break;
          }
          case 'stripes': {
            const [a0, a1] = l.dir === 'along' ? [u0, u1] : [v0, v1], P = 1 / l.count;
            blend(l.blend, c[0], c[1], c[2], l.amount * c[3] * periodicCover(a0, a1, P, l.width * P, l.offset * P));
            break;
          }
          case 'lines': {
            const cu = intervalCover(u0, u1, l.at - l.width / 2, l.at + l.width / 2);
            const cv = l.dashes === 0 ? 1 : periodicCover(v0, v1, 1 / l.dashes, l.duty / l.dashes, 0);
            blend(l.blend, c[0], c[1], c[2], l.amount * c[3] * cu * cv);
            break;
          }
          case 'panels': {
            let tone = 0;   // the panels' own brightness, area-weighted over the panels this pixel touches
            for (const [j, wj] of cellWeights(v0, v1, l.rows)) for (const [i, wi] of cellWeights(u0, u1, l.cols)) tone += wi * wj * (1 + l.tone * (2 * hash(mod(i, l.cols), mod(j, l.rows), 11, l.seed) - 1));
            r *= tone; g *= tone; b *= tone;
            const Pu = 1 / l.cols, Pv = 1 / l.rows, su = l.seam * Pu, sv = l.seam * Pv;
            const cu = periodicCover(u0, u1, Pu, su, -su / 2), cv = periodicCover(v0, v1, Pv, sv, -sv / 2);
            blend(l.blend, c[0], c[1], c[2], l.amount * c[3] * (cu + cv - cu * cv));   // the seams' union, exact for a box
            break;
          }
          case 'glow': {
            const d = Math.abs((l.dir === 'along' ? uc : vc) - l.at), core = l.width / 2;
            const p = d <= core ? 1 : l.falloff > 0 && d < core + l.falloff ? 1 - smooth((d - core) / l.falloff) : 0;
            const k = p * l.intensity * c[3];
            blend('add', c[0], c[1], c[2], k);
            if (l.emissive && k > 0) { er = clamp01(er + c[0] * k); eg = clamp01(eg + c[1] * k); eb = clamp01(eb + c[2] * k); }
            break;
          }
          case 'decal': {
            const hw = l.size[0] / 2, hh = l.size[1] / 2, copies = l.place === 'once' ? 1 : l.count;
            let inside = 0;
            for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
              const pu = u0 + (sx + 0.5) * (u1 - u0) / 4, pv = v0 + (sy + 0.5) * (v1 - v0) / 4;
              let hit = false;
              for (let k = 0; k < copies && !hit; k++) {
                for (const wrap of [-1, 0, 1]) {   // a copy that crosses the tile's end shows on the other side too
                  const cv = l.at[1] + k / copies + wrap;
                  // turn the OFFSET by quarter turns (exact), and only then scale by the half sizes: turning after the
                  // scaling would turn a unit square into itself, and a rect would never turn
                  let ox = pu - l.at[0], oy = pv - cv;
                  for (let q = 0; q < l.turn; q++) { const t2 = ox; ox = -oy; oy = t2; }
                  if (decalInside(l.shape, ox / hw, oy / hh)) { hit = true; break; }
                }
              }
              if (hit) inside++;
            }
            blend(l.blend, c[0], c[1], c[2], l.amount * c[3] * inside / 16);
            break;
          }
          default: throw new Error(`make: no layer type ${l.type}`);
        }
      }
      const o = (y * width + x) * 4;
      rgba[o] = Math.round(clamp01(r) * 255); rgba[o + 1] = Math.round(clamp01(g) * 255); rgba[o + 2] = Math.round(clamp01(b) * 255); rgba[o + 3] = Math.round(clamp01(a) * 255);
      if (emissive) { emissive[o] = Math.round(er * 255); emissive[o + 1] = Math.round(eg * 255); emissive[o + 2] = Math.round(eb * 255); emissive[o + 3] = 255; }
    }
  }
  return { width, height, rgba, emissive };
}

module.exports = { makeTexture, hash, periodicCover, intervalCover, cellWeights };
