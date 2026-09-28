// dds.js: read an AC track's DDS texture into RGBA, for the look-match render (src/lookmatch/raster.js). src/texture/dds.js
// reads the uncompressed DDS our own export writes; other authors' tracks also use DXT1 / DXT5 block compression and 24-bit
// uncompressed files, measured on centrifuge and sakura_speedway (D179). Read-only; nothing is written.
//
//   decodeDds(bytes, maxSide = 1024) -> { width, height, rgba, level, format } | null
//     The first mip level whose larger side is at most maxSide (all of them if the file has no smaller level): a bounded
//     memory cost and less aliasing in a render without mip filtering. null for a format this does not decode (the caller
//     counts it and draws that material untextured).
// The DXT decode is the standard block format (Microsoft, "Block Compression (Direct3D 10)"): two RGB565 endpoints and 2-bit
// indices per 4×4 block; DXT1's 3-colour mode when c0 ≤ c1, with index 3 transparent; DXT5 adds an 8-byte alpha block.
'use strict';

function rgb565(v) { const r = (v >> 11) & 31, g = (v >> 5) & 63, b = v & 31; return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]; }
function colourBlock(src, o, out, w, h, bx, by, dxt1, alpha) {
  const c0 = src[o] | (src[o + 1] << 8), c1 = src[o + 2] | (src[o + 3] << 8), a = rgb565(c0), b = rgb565(c1);
  const pal = [a.concat(255), b.concat(255)];
  if (!dxt1 || c0 > c1) { pal.push([0, 1, 2].map((k) => ((2 * a[k] + b[k]) / 3) | 0).concat(255), [0, 1, 2].map((k) => ((a[k] + 2 * b[k]) / 3) | 0).concat(255)); }
  else pal.push([0, 1, 2].map((k) => ((a[k] + b[k]) / 2) | 0).concat(255), [0, 0, 0, 0]);
  const bits = src[o + 4] | (src[o + 5] << 8) | (src[o + 6] << 16) | (src[o + 7] * 16777216);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const px = bx * 4 + x, py = by * 4 + y; if (px >= w || py >= h) continue;
    const c = pal[Math.floor(bits / Math.pow(4, y * 4 + x)) & 3], d = (py * w + px) * 4;
    out[d] = c[0]; out[d + 1] = c[1]; out[d + 2] = c[2]; out[d + 3] = alpha ? alpha[y * 4 + x] : c[3];
  }
}
function alphaBlock(src, o) {
  const a0 = src[o], a1 = src[o + 1], pal = [a0, a1];
  if (a0 > a1) for (let k = 1; k <= 6; k++) pal.push((((7 - k) * a0 + k * a1) / 7) | 0);
  else { for (let k = 1; k <= 4; k++) pal.push((((5 - k) * a0 + k * a1) / 5) | 0); pal.push(0, 255); }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) { const bit = i * 3, byte = o + 2 + (bit >> 3), v = (src[byte] | (src[byte + 1] << 8)) >> (bit & 7); out[i] = pal[v & 7]; }
  return out;
}

function decodeDds(bytes, maxSide = 1024) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 128 || b[0] !== 0x44 || b[1] !== 0x44 || b[2] !== 0x53 || b[3] !== 0x20) throw new Error('lookmatch: not a DDS');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), h = (i) => dv.getUint32(4 + i * 4, true);
  const height = h(2), width = h(3), mips = Math.max(1, h(6)), pfFlags = h(19), four = h(20), bits = h(21), masks = [h(22), h(23), h(24), h(25)];
  const fourCC = four ? String.fromCharCode(four & 255, (four >> 8) & 255, (four >> 16) & 255, four >>> 24) : null;
  let fmt = null;
  if (fourCC === 'DXT1' || fourCC === 'DXT5') fmt = fourCC;
  else if (!fourCC && (pfFlags & 0x40) && (bits === 32 || bits === 24)) fmt = `RGB${bits}`;
  if (!fmt) return null;                                    // DX10 / BC7 / DXT3 / luminance…: not decoded here
  const sizeOf = (w, hh) => (fmt === 'DXT1' ? Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(hh / 4)) * 8
    : fmt === 'DXT5' ? Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(hh / 4)) * 16 : w * hh * (bits / 8));
  let o = 128, w = width, hh = height, level = 0;
  while (level < mips - 1 && Math.max(w, hh) > maxSide) { o += sizeOf(w, hh); w = Math.max(1, w >> 1); hh = Math.max(1, hh >> 1); level++; }
  if (o + sizeOf(w, hh) > b.length) throw new Error(`lookmatch: the DDS ends inside level ${level}`);
  const rgba = new Uint8Array(w * hh * 4);
  if (fmt === 'DXT1' || fmt === 'DXT5') {
    const bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(hh / 4)), step = fmt === 'DXT1' ? 8 : 16;
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const at = o + (by * bw + bx) * step;
      if (fmt === 'DXT1') colourBlock(b, at, rgba, w, hh, bx, by, true, null);
      else colourBlock(b, at + 8, rgba, w, hh, bx, by, false, alphaBlock(b, at));
    }
  } else {
    const shift = (m) => (m ? Math.log2(m & -m) : 0), width8 = (m) => (m ? Math.log2((m >>> shift(m)) + 1) : 0);
    const get = (v, m) => { if (!m) return 255; const s = shift(m), n = width8(m), x = (v & m) >>> s; return n === 8 ? x : Math.round((x * 255) / ((1 << n) - 1)); };
    const px = bits / 8;
    for (let i = 0; i < w * hh; i++) {
      const at = o + i * px, v = px === 4 ? dv.getUint32(at, true) : b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
      rgba[i * 4] = get(v, masks[0]); rgba[i * 4 + 1] = get(v, masks[1]); rgba[i * 4 + 2] = get(v, masks[2]); rgba[i * 4 + 3] = (pfFlags & 1) ? get(v, masks[3]) : 255;
    }
  }
  return { width: w, height: hh, rgba, level, format: fmt };
}

module.exports = { decodeDds, rgb565 };
