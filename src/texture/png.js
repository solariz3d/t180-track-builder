// png.js: decode a PNG to 8-bit RGBA, dependency-free (the PNG spec, W3C Recommendation, 2nd edition, 2003).
// Supported: every colour type (0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA) at every bit depth the spec allows for
// it (1/2/4/8/16 grey, 1/2/4/8 palette, 8/16 otherwise); all five filters; tRNS transparency; the CRC of every chunk.
// 16-bit samples keep their high byte. REFUSED, by name: Adam7 interlacing (TEXTURE_UNSUPPORTED), and anything
// malformed (BAD_IMAGE). Gamma, colour-profile and text chunks are skipped: the pixels are taken as they are stored.
'use strict';

const { inflateZlib } = require('./inflate.js');
const { TextureError } = require('./errors.js');

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf, a, b) { let c = 0xffffffff; for (let i = a; i < b; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const MAX_SIDE = 16384;

const isPng = (b) => b.length >= 8 && SIG.every((x, i) => b[i] === x);

function decodePng(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isPng(b)) throw new TextureError('BAD_IMAGE', 'not a PNG (the signature is wrong)');
  let i = 8, hdr = null, plte = null, trns = null; const idat = [];
  while (true) {
    if (i + 12 > b.length) throw new TextureError('BAD_IMAGE', 'PNG: the file ends before IEND');
    const len = u32(b, i), type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]), d0 = i + 8, d1 = d0 + len;
    if (len > 0x7fffffff || d1 + 4 > b.length) throw new TextureError('BAD_IMAGE', `PNG: chunk ${type} runs past the end of the file`);
    if (crc32(b, i + 4, d1) !== u32(b, d1)) throw new TextureError('BAD_IMAGE', `PNG: chunk ${type} fails its CRC`);
    const d = b.subarray(d0, d1);
    if (type === 'IHDR') {
      if (len !== 13) throw new TextureError('BAD_IMAGE', 'PNG: IHDR is not 13 bytes');
      hdr = { width: u32(d, 0), height: u32(d, 4), depth: d[8], color: d[9], comp: d[10], filter: d[11], interlace: d[12] };
    } else if (type === 'PLTE') plte = d.slice();
    else if (type === 'tRNS') trns = d.slice();
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    else if (!(b[i + 4] & 32)) throw new TextureError('TEXTURE_UNSUPPORTED', `PNG: critical chunk ${type} is not understood`);
    i = d1 + 4;
  }
  if (!hdr) throw new TextureError('BAD_IMAGE', 'PNG: no IHDR');
  const { width: W, height: H, depth, color } = hdr;
  if (!W || !H) throw new TextureError('BAD_IMAGE', 'PNG: zero width or height');
  if (W > MAX_SIDE || H > MAX_SIDE) throw new TextureError('TEXTURE_TOO_LARGE', `PNG: ${W}×${H} is larger than ${MAX_SIDE} on a side`);
  if (!DEPTHS[color] || !DEPTHS[color].includes(depth)) throw new TextureError('BAD_IMAGE', `PNG: colour type ${color} at bit depth ${depth} is not valid`);
  if (hdr.comp !== 0 || hdr.filter !== 0) throw new TextureError('BAD_IMAGE', 'PNG: unknown compression or filter method');
  if (hdr.interlace === 1) throw new TextureError('TEXTURE_UNSUPPORTED', 'PNG: Adam7 interlacing is not supported; save the image non-interlaced');
  if (hdr.interlace !== 0) throw new TextureError('BAD_IMAGE', `PNG: interlace method ${hdr.interlace}`);
  if (color === 3 && !plte) throw new TextureError('BAD_IMAGE', 'PNG: a palette image with no PLTE');
  if (!idat.length) throw new TextureError('BAD_IMAGE', 'PNG: no IDAT');

  const total = idat.reduce((a, x) => a + x.length, 0), z = new Uint8Array(total); let o = 0; for (const x of idat) { z.set(x, o); o += x.length; }
  const bpp = CHANNELS[color] * depth, stride = Math.ceil((W * bpp) / 8), step = Math.max(1, bpp >> 3);
  let raw; try { raw = inflateZlib(z, (stride + 1) * H); } catch (e) { throw new TextureError('BAD_IMAGE', `PNG: ${e.message}`); }
  if (raw.length < (stride + 1) * H) throw new TextureError('BAD_IMAGE', `PNG: ${raw.length} bytes of pixel data, ${(stride + 1) * H} needed`);

  const rows = new Uint8Array(stride * H);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    if (f > 4) throw new TextureError('BAD_IMAGE', `PNG: row ${y} has filter ${f}`);
    for (let x = 0; x < stride; x++) {
      const a = x >= step ? rows[dst + x - step] : 0, c0 = y ? rows[up + x] : 0, c = y && x >= step ? rows[up + x - step] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += c0; else if (f === 3) v += (a + c0) >> 1;
      else if (f === 4) { const p = a + c0 - c, pa = Math.abs(p - a), pb = Math.abs(p - c0), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? c0 : c; }
      rows[dst + x] = v & 255;
    }
  }
  const sample = (y, k) => {                     // the k-th sample of row y, scaled to 8 bits (palette: the index)
    if (depth === 8) return rows[y * stride + k];
    if (depth === 16) return rows[y * stride + k * 2];
    const bit = k * depth, v = (rows[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return color === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const raw16 = (y, k) => (rows[y * stride + k * 2] << 8) | rows[y * stride + k * 2 + 1];
  const tkey = trns && (color === 0 ? (trns[0] << 8) | trns[1] : color === 2 ? [0, 2, 4].map((j) => (trns[j] << 8) | trns[j + 1]) : null);
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4, ch = CHANNELS[color], k = x * ch;
    if (color === 3) {
      const idx = sample(y, k); if (idx * 3 + 2 >= plte.length) throw new TextureError('BAD_IMAGE', `PNG: palette index ${idx} is past the palette`);
      rgba[p] = plte[idx * 3]; rgba[p + 1] = plte[idx * 3 + 1]; rgba[p + 2] = plte[idx * 3 + 2]; rgba[p + 3] = trns && idx < trns.length ? trns[idx] : 255;
    } else if (color === 0 || color === 4) {
      const g = sample(y, k); rgba[p] = rgba[p + 1] = rgba[p + 2] = g;
      let al = color === 4 ? sample(y, k + 1) : 255;
      if (color === 0 && tkey !== null && trns) { const rv = depth === 16 ? raw16(y, k) : depth === 8 ? rows[y * stride + k] : (sample(y, k) * ((1 << depth) - 1)) / 255; if (rv === tkey) al = 0; }
      rgba[p + 3] = al;
    } else {
      rgba[p] = sample(y, k); rgba[p + 1] = sample(y, k + 1); rgba[p + 2] = sample(y, k + 2);
      let al = color === 6 ? sample(y, k + 3) : 255;
      if (color === 2 && tkey) { const rv = depth === 16 ? [0, 1, 2].map((j) => raw16(y, k + j)) : [0, 1, 2].map((j) => rows[y * stride + k + j]); if (rv.every((v, j) => v === tkey[j])) al = 0; }
      rgba[p + 3] = al;
    }
  }
  return { width: W, height: H, rgba };
}

/** Encode 8-bit RGBA as a PNG (colour type 6, filter 0 on every row); `deflate` is a zlib compressor (the tests pass
 *  node's, the app passes its stored-block shim). For tests and for writing previews; the export writes DDS, not PNG. */
function encodePng({ width, height, rgba }, deflate, { color = 6, depth = 8 } = {}) {
  const ch = CHANNELS[color], bpp = ch * depth / 8, stride = width * bpp, raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < ch; c++) {
    const v = rgba[(y * width + x) * 4 + (color === 0 ? 0 : color === 4 && c === 1 ? 3 : c)];
    if (depth === 8) raw[y * (stride + 1) + 1 + x * bpp + c] = v;
    else { raw[y * (stride + 1) + 1 + x * bpp + c * 2] = v; raw[y * (stride + 1) + 1 + x * bpp + c * 2 + 1] = v; }
  }
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length), t = [...type].map((s) => s.charCodeAt(0));
    const w = (i, v) => { out[i] = v >>> 24; out[i + 1] = (v >>> 16) & 255; out[i + 2] = (v >>> 8) & 255; out[i + 3] = v & 255; };
    w(0, data.length); out.set(t, 4); out.set(data, 8); w(8 + data.length, crc32(out, 4, 8 + data.length)); return out;
  };
  const ih = new Uint8Array(13); const dv = new DataView(ih.buffer); dv.setUint32(0, width); dv.setUint32(4, height); ih[8] = depth; ih[9] = color;
  const parts = [Uint8Array.from(SIG), chunk('IHDR', ih), chunk('IDAT', new Uint8Array(deflate(raw))), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

module.exports = { decodePng, encodePng, isPng, crc32 };
