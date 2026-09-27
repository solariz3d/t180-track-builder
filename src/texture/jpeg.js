// jpeg.js: decode a BASELINE JPEG to 8-bit RGBA, dependency-free (ITU-T T.81 / ISO 10918-1; JFIF colour conversion).
// Supported: SOF0 and SOF1 (sequential DCT, Huffman, 8-bit), 1 component (grey) or 3 (YCbCr), sampling factors 1–2 in
// each direction, 8- and 16-bit quantisation tables, restart intervals (DRI/RSTn). Chroma is upsampled by replication.
// REFUSED, by name (TEXTURE_UNSUPPORTED): progressive (SOF2), lossless (SOF3), hierarchical (SOF5–7), arithmetic coding
// (SOF9–15), 12-bit samples, 2 or 4 components (CMYK/YCCK), sampling factors above 2. Malformed data is BAD_IMAGE.
// The IDCT is the separable float form, so pixels may differ by a level or two from another decoder's integer IDCT.
'use strict';

const { TextureError } = require('./errors.js');

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
  28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const MAX_SIDE = 16384;
const bad = (m) => new TextureError('BAD_IMAGE', `JPEG: ${m}`);
const unsupported = (m) => new TextureError('TEXTURE_UNSUPPORTED', `JPEG: ${m}`);
const isJpeg = (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// cos table for the float IDCT: C[x][u] = c(u) cos((2x+1)uπ/16)
const COS = Array.from({ length: 8 }, (_, x) => Array.from({ length: 8 }, (_, u) => (u ? 1 : Math.SQRT1_2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)));
function idct(inp, out) {                      // inp: 64 dequantised coefficients in natural order → out: 64 samples (+128)
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let v = 0; v < 8; v++) s += COS[y][v] * inp[v * 8 + u]; tmp[y * 8 + u] = s / 2; }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += COS[x][u] * tmp[y * 8 + u]; out[y * 8 + x] = s / 2 + 128; }
}

function buildHuffman(counts, symbols) {        // → Map of (length << 16 | code) → symbol
  const map = new Map(); let code = 0, k = 0;
  for (let l = 1; l <= 16; l++) { for (let i = 0; i < counts[l - 1]; i++) { if (k >= symbols.length) throw bad('a Huffman table is shorter than its counts'); map.set((l << 16) | code, symbols[k++]); code++; } code <<= 1; }
  return map;
}

function decodeJpeg(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isJpeg(b)) throw new TextureError('BAD_IMAGE', 'not a JPEG (no SOI marker)');
  const qt = [], dc = [], ac = []; let frame = null, restart = 0, pos = 2, image = null;
  const u16 = (i) => { if (i + 1 >= b.length) throw bad('the file ends inside a segment'); return (b[i] << 8) | b[i + 1]; };
  while (pos < b.length) {
    if (b[pos] !== 0xff) throw bad(`expected a marker at byte ${pos}`);
    const m = b[pos + 1]; pos += 2;
    if (m === 0xff) { pos--; continue; }                         // fill byte
    if (m === 0xd9) break;                                       // EOI
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;        // TEM, stray RSTn
    const len = u16(pos), seg = b.subarray(pos + 2, pos + len);
    if (pos + len > b.length) throw bad('a segment runs past the end of the file');
    if (m === 0xc0 || m === 0xc1) {
      if (seg[0] !== 8) throw unsupported(`${seg[0]}-bit samples; only 8-bit baseline is read`);
      const H = (seg[1] << 8) | seg[2], W = (seg[3] << 8) | seg[4], n = seg[5];
      if (!W || !H) throw bad('zero width or height (DNL is not supported)');
      if (W > MAX_SIDE || H > MAX_SIDE) throw new TextureError('TEXTURE_TOO_LARGE', `JPEG: ${W}×${H} is larger than ${MAX_SIDE} on a side`);
      if (n !== 1 && n !== 3) throw unsupported(`${n} components; only greyscale (1) and YCbCr (3) are read`);
      const comps = [];
      for (let i = 0; i < n; i++) {
        const id = seg[6 + i * 3], h = seg[7 + i * 3] >> 4, v = seg[7 + i * 3] & 15, tq = seg[8 + i * 3];
        if (h < 1 || h > 2 || v < 1 || v > 2) throw unsupported(`sampling factor ${h}×${v}; only 1 and 2 are read`);
        comps.push({ id, h, v, tq });
      }
      frame = { W, H, comps, hmax: Math.max(...comps.map((c) => c.h)), vmax: Math.max(...comps.map((c) => c.v)) };
    } else if (m === 0xc2 || m === 0xc6 || m === 0xca || m === 0xce) throw unsupported('progressive encoding; save the image as baseline JPEG or as PNG');
    else if (m === 0xc3 || m === 0xc5 || m === 0xc7 || m === 0xcb || m === 0xcd || m === 0xcf) throw unsupported('lossless or hierarchical encoding');
    else if (m === 0xc9 || m === 0xcc) throw unsupported('arithmetic coding');
    else if (m === 0xc4) {
      for (let i = 0; i < seg.length;) {
        const tc = seg[i] >> 4, th = seg[i] & 15, counts = seg.subarray(i + 1, i + 17); if (counts.length < 16) throw bad('a short DHT');
        const total = counts.reduce((a, x) => a + x, 0), syms = seg.subarray(i + 17, i + 17 + total);
        if (tc > 1 || th > 3) throw bad('a Huffman table id out of range');
        (tc ? ac : dc)[th] = buildHuffman(counts, syms); i += 17 + total;
      }
    } else if (m === 0xdb) {
      for (let i = 0; i < seg.length;) {
        const p = seg[i] >> 4, t = seg[i] & 15, q = new Int32Array(64); if (t > 3) throw bad('a quantisation table id out of range');
        for (let k = 0; k < 64; k++) q[ZIGZAG[k]] = p ? (seg[i + 1 + k * 2] << 8) | seg[i + 2 + k * 2] : seg[i + 1 + k];
        qt[t] = q; i += 1 + 64 * (p ? 2 : 1);
      }
    } else if (m === 0xdd) restart = (seg[0] << 8) | seg[1];
    else if (m === 0xda) {
      if (!frame) throw bad('a scan before the frame header');
      const ns = seg[0], sc = [];
      for (let i = 0; i < ns; i++) {
        const c = frame.comps.find((x) => x.id === seg[1 + i * 2]); if (!c) throw bad('a scan names an unknown component');
        sc.push({ c, td: seg[2 + i * 2] >> 4, ta: seg[2 + i * 2] & 15 });
      }
      if (ns !== frame.comps.length) throw unsupported('more than one scan (a non-interleaved baseline file)');
      pos = scan(b, pos + len, frame, sc, qt, dc, ac, restart);
      image = frame;
      continue;
    }
    pos += len;
  }
  if (!image) throw bad('no image data (no SOS)');
  return toRgba(image);
}

/** Decode the interleaved scan into each component's sample plane; returns the byte after the entropy-coded data. */
function scan(b, start, F, sc, qt, dc, ac, restart) {
  const mcuW = 8 * F.hmax, mcuH = 8 * F.vmax, mx = Math.ceil(F.W / mcuW), my = Math.ceil(F.H / mcuH);
  for (const { c } of sc) { c.bw = mx * c.h; c.bh = my * c.v; c.plane = new Float64Array(c.bw * 8 * c.bh * 8); c.pred = 0; if (!qt[c.tq]) throw bad(`quantisation table ${c.tq} is missing`); }
  for (const s of sc) if (!dc[s.td] || !ac[s.ta]) throw bad('a scan uses a missing Huffman table');
  let pos = start, buf = 0, cnt = 0;
  const bit = () => {
    if (cnt === 0) {
      if (pos >= b.length) throw bad('the scan ends early');
      let x = b[pos++];
      if (x === 0xff) { const n = b[pos]; if (n === 0) pos++; else throw bad(`marker FF${n.toString(16)} inside the scan data`); }
      buf = x; cnt = 8;
    }
    cnt--; return (buf >> cnt) & 1;
  };
  const decode = (h) => { let code = 0; for (let l = 1; l <= 16; l++) { code = (code << 1) | bit(); const s = h.get((l << 16) | code); if (s !== undefined) return s; } throw bad('a code that is not in the Huffman table'); };
  const receive = (s) => { let v = 0; for (let i = 0; i < s; i++) v = (v << 1) | bit(); return s && v < 1 << (s - 1) ? v - (1 << s) + 1 : v; };
  const zz = new Float64Array(64), blk = new Float64Array(64);
  let mcu = 0, rst = 0;
  for (let y = 0; y < my; y++) for (let x = 0; x < mx; x++) {
    if (restart && mcu && mcu % restart === 0) {                 // byte-align, expect RSTn, reset the predictors
      cnt = 0;
      if (b[pos] !== 0xff || b[pos + 1] !== 0xd0 + (rst & 7)) throw bad(`restart marker RST${rst & 7} is missing at MCU ${mcu}`);
      pos += 2; rst++; for (const { c } of sc) c.pred = 0;
    }
    for (const { c, td, ta } of sc) for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) {
      zz.fill(0);
      const t = decode(dc[td]); if (t > 11) throw bad('a DC difference too large');
      c.pred += receive(t); zz[0] = c.pred * qt[c.tq][0];
      for (let k = 1; k < 64;) {
        const rs = decode(ac[ta]), r = rs >> 4, s = rs & 15;
        if (!s) { if (r === 15) { k += 16; continue; } break; }
        k += r; if (k > 63) throw bad('AC coefficients run past the block');
        zz[ZIGZAG[k]] = receive(s) * qt[c.tq][ZIGZAG[k]]; k++;
      }
      idct(zz, blk);
      const bx = (x * c.h + h) * 8, by = (y * c.v + v) * 8, pw = c.bw * 8;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) c.plane[(by + j) * pw + bx + i] = blk[j * 8 + i];
    }
    mcu++;
  }
  // skip to the next marker (not a stuffed byte or a restart)
  while (pos < b.length && !(b[pos] === 0xff && b[pos + 1] !== 0 && !(b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7))) pos++;
  return pos;
}

function toRgba(F) {
  const { W, H, comps, hmax, vmax } = F, rgba = new Uint8Array(W * H * 4);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  const at = (c, x, y) => c.plane[Math.floor((y * c.v) / vmax) * c.bw * 8 + Math.floor((x * c.h) / hmax)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    if (comps.length === 1) { rgba[p] = rgba[p + 1] = rgba[p + 2] = clamp(at(comps[0], x, y)); }
    else {
      const Y = at(comps[0], x, y), cb = at(comps[1], x, y) - 128, cr = at(comps[2], x, y) - 128;
      rgba[p] = clamp(Y + 1.402 * cr); rgba[p + 1] = clamp(Y - 0.344136 * cb - 0.714136 * cr); rgba[p + 2] = clamp(Y + 1.772 * cb);
    }
    rgba[p + 3] = 255;
  }
  return { width: W, height: H, rgba };
}

module.exports = { decodeJpeg, isJpeg, ZIGZAG };
