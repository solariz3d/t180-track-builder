// make-icons.js: draw the app's icon and write the sizes tauri.conf.json names. node src-tauri/icons/make-icons.js [outDir]
// Dependency-free (node's zlib). The picture (D395, the Crossover loop in Skyline's colours): a light tile with one closed
// circuit that crosses itself on a bridge, a figure-eight tilted as if banked, and the car as a blue dot. The icon is the same
// in every theme. Deterministic: the same script writes the same bytes. Required as a module it draws and writes nothing.
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

// Skyline's colours (app/themes/skyline.css: --bg, --text, --accent). The RIM is the tile's 1 px edge: on a light taskbar (#f3f3f3)
// the tile alone is 1.02:1 and its edge vanishes. #71849a is the lightest mix of --text into --bg that reaches 3:1 there (3.46:1).
const TILE = [0xee, 0xf6, 0xff], TRACK = [0x0b, 0x27, 0x47], CAR = [0x07, 0x57, 0xb3], RIM = [0x71, 0x84, 0x9a];
// The figure-eight (the lemniscate of Bernoulli, lobes widened 1.6x, tilted -24°) on a 32-unit grid, as a polyline from t0 to t1.
// It crosses itself at t = π/2, where the bridge is drawn: first a gap in the tile's colour, then the bridge over it.
function loop(t0, t1, steps) {
  const a = 12.2, k = 1.6, rot = -24 * Math.PI / 180, out = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + (t1 - t0) * (i / steps), s = Math.sin(t), d = 1 + s * s, x = a * Math.cos(t) / d, y = k * a * s * Math.cos(t) / d;
    out.push([16 + x * Math.cos(rot) - y * Math.sin(rot), 16 + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return out;
}
const B = Math.PI / 2, CAR_AT = loop(Math.PI * 0.2, Math.PI * 0.2, 1)[0];
// Painter's order. Widths in grid units; at a small size no stroke is thinner than MIN_PX pixels (a 16 px icon cannot draw half a pixel).
const STROKES = [
  { pts: loop(0, 2 * Math.PI, 96), w: 2.4, col: TRACK },
  { pts: loop(B - 0.42, B + 0.42, 16), w: 5.2, col: TILE },
  { pts: loop(B - 0.5, B + 0.5, 18), w: 2.4, col: TRACK },
];
const MIN_PX = 1.15, TILE_R = 7, CAR_R = 2.1;
const nearLine = (x, y, pts, half) => {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    if (x < Math.min(ax, bx) - half || x > Math.max(ax, bx) + half || y < Math.min(ay, by) - half || y > Math.max(ay, by) + half) continue;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= half) return true;
  }
  return false;
};
// The distance inside the rounded tile's edge (negative outside), in grid units.
const insideTile = (x, y) => {
  const dx = Math.abs(x - 16) - (16 - TILE_R), dy = Math.abs(y - 16) - (16 - TILE_R);
  return dx > 0 && dy > 0 ? TILE_R - Math.hypot(dx, dy) : Math.min(16 - Math.abs(x - 16), 16 - Math.abs(y - 16));
};

/** The picture at n×n, RGBA. `rim: false` leaves the tile's edge off (the before, for the light-taskbar measurement). */
function draw(n, { rim = true } = {}) {
  const px = Buffer.alloc(n * n * 4), S = n >= 64 ? 4 : 8, unit = 32 / n, minW = MIN_PX * unit;   // 8×8 supersampling under 64 px, 4×4 above
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const acc = [0, 0, 0]; let cover = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) * unit, v = (y + (sy + 0.5) / S) * unit, edge = insideTile(u, v);
      if (edge < 0) continue;
      let c = rim && edge < unit ? RIM : TILE;
      for (const s of STROKES) if (nearLine(u, v, s.pts, Math.max(s.w, minW) / 2)) c = s.col;
      if (Math.hypot(u - CAR_AT[0], v - CAR_AT[1]) <= Math.max(CAR_R, minW)) c = CAR;
      for (let k = 0; k < 3; k++) acc[k] += c[k];
      cover++;
    }
    const i = (y * n + x) * 4;
    for (let k = 0; k < 3; k++) px[i + k] = cover ? Math.round(acc[k] / cover) : 0;
    px[i + 3] = Math.round(255 * cover / (S * S));
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

const sizes = { '32x32.png': 32, '128x128.png': 128, '128x128@2x.png': 256 }, icoSizes = [16, 24, 32, 48, 256];
module.exports = { draw, png, ico, sizes, icoSizes };
if (require.main === module) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;
  const made = {};
  for (const n of new Set([...Object.values(sizes), ...icoSizes])) made[n] = png(n, draw(n));
  for (const [f, n] of Object.entries(sizes)) fs.writeFileSync(path.join(out, f), made[n]);
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(icoSizes.map((n) => ({ n, bytes: made[n] }))));
  console.log('wrote', [...Object.keys(sizes), 'icon.ico'].join(', '), 'to', out);
}
