// texture_jpeg_encoder.js: a minimal BASELINE JPEG encoder, for the tests only (not a .test.js file), so the decoder is
// tested on files made here rather than on committed images. Standard Huffman tables (ITU-T T.81 Annex K.3), a float
// forward DCT, JFIF YCbCr. Options: quality 1–100 (the IJG scaling of the Annex K quantisation tables), luma sampling
// 1×1 or 2×2 (4:4:4 or 4:2:0), grey (1 component), a restart interval, 16-bit quantisation tables.
'use strict';
const { ZIGZAG } = require('../src/texture/jpeg.js');

const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array(32).fill(99)];
const DC_L = [[0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
const DC_C = [[0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
const AC_L = [[0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]];
const AC_C = [[0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]];

function codes([counts, syms]) {
  const m = new Map(); let code = 0, k = 0;
  for (let l = 1; l <= 16; l++) { for (let i = 0; i < counts[l - 1]; i++) m.set(syms[k++], [code++, l]); code <<= 1; }
  return m;
}
const scaleQ = (q, quality) => { const s = quality < 50 ? 5000 / quality : 200 - quality * 2; return q.map((v) => Math.max(1, Math.min(255, Math.floor((v * s + 50) / 100)))); };

function encodeJpeg({ width: W, height: H, rgba }, { quality = 90, sub = 1, grey = false, restart = 0, q16 = false, sofMarker = 0xc0 } = {}) {
  const out = []; const u16 = (v) => out.push(v >> 8, v & 255);
  const seg = (m, data) => { out.push(0xff, m); u16(data.length + 2); out.push(...data); };
  out.push(0xff, 0xd8);
  const ql = scaleQ(QL, quality), qc = scaleQ(QC, quality);
  const dqt = (t, q) => (q16 ? [0x10 | t, ...ZIGZAG.flatMap((z) => [q[z] >> 8, q[z] & 255])] : [t, ...ZIGZAG.map((z) => q[z])]);
  seg(0xdb, [...dqt(0, ql), ...(grey ? [] : dqt(1, qc))]);
  const nc = grey ? 1 : 3, hs = grey ? 1 : sub;
  seg(sofMarker, [8, H >> 8, H & 255, W >> 8, W & 255, nc, 1, (hs << 4) | hs, 0, ...(grey ? [] : [2, 0x11, 1, 3, 0x11, 1])]);
  const dht = (tc, th, [c, s]) => [(tc << 4) | th, ...c, ...s];
  seg(0xc4, [...dht(0, 0, DC_L), ...dht(1, 0, AC_L), ...(grey ? [] : [...dht(0, 1, DC_C), ...dht(1, 1, AC_C)])]);
  if (restart) seg(0xdd, [restart >> 8, restart & 255]);
  seg(0xda, [nc, 1, 0x00, ...(grey ? [] : [2, 0x11, 3, 0x11]), 0, 63, 0]);
  const HT = { dcL: codes(DC_L), acL: codes(AC_L), dcC: codes(DC_C), acC: codes(AC_C) };
  let acc = 0, n = 0; const bytes = [];
  const put = (code, len) => { for (let i = len - 1; i >= 0; i--) { acc = (acc << 1) | ((code >> i) & 1); if (++n === 8) { bytes.push(acc); if (acc === 0xff) bytes.push(0); acc = 0; n = 0; } } };
  const flush = () => { if (n) put((1 << (8 - n)) - 1, 8 - n); };
  const cat = (v) => { let a = Math.abs(v), s = 0; while (a) { s++; a >>= 1; } return s; };
  const bitsOf = (v, s) => (v < 0 ? v + (1 << s) - 1 : v);
  const px = (x, y) => { x = Math.min(x, W - 1); y = Math.min(y, H - 1); const p = (y * W + x) * 4; const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    return [0.299 * r + 0.587 * g + 0.114 * b, -0.168736 * r - 0.331264 * g + 0.5 * b + 128, 0.5 * r - 0.418688 * g - 0.081312 * b + 128]; };
  const C = (u) => (u ? 1 : Math.SQRT1_2);
  const block = (sample, q, pred, dcT, acT) => {
    const coef = new Array(64);
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
      let s = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += (sample(x, y) - 128) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
      coef[v * 8 + u] = Math.round((C(u) * C(v) * s / 4) / q[v * 8 + u]);
    }
    const d = coef[0] - pred, s = cat(d); put(...dcT.get(s)); if (s) put(bitsOf(d, s), s);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = coef[ZIGZAG[k]];
      if (!v) { run++; continue; }
      while (run > 15) { put(...acT.get(0xf0)); run -= 16; }
      const t = cat(v); put(...acT.get((run << 4) | t)); put(bitsOf(v, t), t); run = 0;
    }
    if (run) put(...acT.get(0));
    return coef[0];
  };
  const mcu = 8 * hs, mx = Math.ceil(W / mcu), my = Math.ceil(H / mcu); const pred = [0, 0, 0]; let count = 0, rst = 0;
  for (let by = 0; by < my; by++) for (let bx = 0; bx < mx; bx++) {
    if (restart && count && count % restart === 0) { flush(); bytes.push(0xff, 0xd0 + (rst++ & 7)); pred.fill(0); }
    for (let v = 0; v < hs; v++) for (let h = 0; h < hs; h++) {
      const x0 = bx * mcu + h * 8, y0 = by * mcu + v * 8;
      pred[0] = block((x, y) => px(x0 + x, y0 + y)[0], ql, pred[0], HT.dcL, HT.acL);
    }
    if (!grey) for (const c of [1, 2]) pred[c] = block((x, y) => { let s = 0; for (let j = 0; j < hs; j++) for (let i = 0; i < hs; i++) s += px(bx * mcu + (x * hs) + i, by * mcu + (y * hs) + j)[c]; return s / (hs * hs); }, qc, pred[c], HT.dcC, HT.acC);
    count++;
  }
  flush(); out.push(...bytes, 0xff, 0xd9);
  return Uint8Array.from(out);
}
module.exports = { encodeJpeg };
