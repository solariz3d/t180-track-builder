// make-icons.js: draw the app's icon and write the sizes tauri.conf.json names. node src-tauri/icons/make-icons.js
// Dependency-free (node's zlib). The picture: a dark tile with a banked track swinging up a wall, drawn in the app's
// accent colour. Deterministic: the same script writes the same bytes.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(n, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) { raw[y * (n * 4 + 1)] = 0; rgba.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** The picture at n×n: rounded tile, and a thick arc (the track) rising from bottom-left to a near-vertical wall. */
function draw(n) {
  const px = Buffer.alloc(n * n * 4), S = 4;   // 4×4 supersampling
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let tile = 0, track = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) / n, v = (y + (sy + 0.5) / S) / n;
      const r = 0.18, dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
      if (dx * dx + dy * dy <= r * r) tile++;
      const d = Math.hypot(u - 0.95, v - 0.05);   // an arc centred top-right: the road curling up a wall
      if (d > 0.52 && d < 0.68 && u < 0.9 && v > 0.1) track++;
    }
    const t = tile / (S * S), k = track / (S * S), i = (y * n + x) * 4;
    const bg = [16, 19, 24], fg = [87, 179, 255];
    for (let c = 0; c < 3; c++) px[i + c] = Math.round(bg[c] * (1 - k) + fg[c] * k);
    px[i + 3] = Math.round(255 * t);
  }
  return px;
}
function ico(entries) {   // PNG-in-ICO (Windows Vista and later read it)
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  const dir = [], data = []; let off = 6 + 16 * entries.length;
  for (const { n, bytes } of entries) {
    const e = Buffer.alloc(16); e[0] = n >= 256 ? 0 : n; e[1] = n >= 256 ? 0 : n; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(bytes.length, 8); e.writeUInt32LE(off, 12); off += bytes.length; dir.push(e); data.push(bytes);
  }
  return Buffer.concat([head, ...dir, ...data]);
}

const out = __dirname, sizes = { '32x32.png': 32, '128x128.png': 128, '128x128@2x.png': 256 };
const made = {};
for (const [f, n] of Object.entries(sizes)) { made[n] = png(n, draw(n)); fs.writeFileSync(path.join(out, f), made[n]); }
made[16] = png(16, draw(16)); made[48] = png(48, draw(48));
fs.writeFileSync(path.join(out, 'icon.ico'), ico([16, 32, 48, 256].map((n) => ({ n, bytes: made[n] }))));
console.log('wrote', [...Object.keys(sizes), 'icon.ico'].join(', '));
