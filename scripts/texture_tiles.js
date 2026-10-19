// texture_tiles.js: D399. Draws each look's texture tile into app/themes/tex/<look>.png (RGBA, white or black specks at an alpha; a look's colours are
// never in them), from fixed seeds, so the same command writes the same bytes. Run: node scripts/texture_tiles.js
// The tiles and their strengths are E's D397 concepts as measured there (exo_memory p-d397-texture-E_2026-10-19.md) and picked in D399:
//   sigil    film grain 0.06: every pixel a random speck, white or black, alpha up to 0.06                          128 x 128, repeated
//   skyline  paper grain 0.05: the same on 2 px cells (on Skyline's light panels the dark specks are the ones seen)  128 x 128, repeated
//   glass    ordered dither 0.08: an 8 x 8 Bayer screen that thins from the top of a surface down to 300 px            8 x 300, repeated across
//   aqua     soft fluid noise 0.08: smooth, domain-warped value noise that wraps at the tile's edges, white where high   256 x 256, repeated
//            (0.10 pushed two texts under 4.5:1 and 0.09 sat on 4.50; 0.08 is the highest strength with room, D399)
//   aurora   dot matrix 0.10: a 1 px white dot every 3 px                                                                3 x 3, repeated
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const OUT = path.join(__dirname, '..', 'app', 'themes', 'tex');

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => { const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'ascii'), data]); len.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function tile(w, h, paint) {
  const px = Buffer.alloc(w * h * 4), put = (x, y, white, a) => { const i = 4 * (y * w + x), v = white ? 255 : 0; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = Math.round(255 * Math.max(0, Math.min(1, a))); };
  paint(put); return png(w, h, px);
}
const grain = (s, cell) => tile(128, 128, (put) => { const r = rng(397); for (let y = 0; y < 128; y += cell) for (let x = 0; x < 128; x += cell) { const v = r() * 2 - 1; for (let j = 0; j < cell; j++) for (let i = 0; i < cell; i++) put(x + i, y + j, v > 0, Math.abs(v) * s); } });
const B8 = (() => { let b = [[0]]; for (let n = 1; n < 8; n *= 2) { const nb = []; for (let y = 0; y < 2 * n; y++) { nb.push([]); for (let x = 0; x < 2 * n; x++) nb[y].push(4 * b[y % n][x % n] + [[0, 2], [3, 1]][Math.floor(y / n)][Math.floor(x / n)]); } b = nb; } return b.map((r) => r.map((v) => (v + 0.5) / 64)); })();
const dither = (s) => tile(8, 300, (put) => { for (let y = 0; y < 300; y++) { const t = (1 - y / 300) * 0.85 + 0.08; for (let x = 0; x < 8; x++) if (B8[y % 8][x] < t) put(x, y, true, s); } });
function fluid(s) {
  const N = 256, P = 3, r = rng(397);   // three noise cells across the tile, each lattice wrapping at P (and 2P for the finer octave), so the tile repeats seamlessly
  const lattice = (p) => { const g = []; for (let i = 0; i < p * p; i++) g.push(r()); return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), at = (i, j) => g[(((j % p) + p) % p) * p + (((i % p) + p) % p)]; return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy) + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy; }; };
  const n1 = lattice(P), n1b = lattice(2 * P), wx = lattice(P), wy = lattice(P);
  return tile(N, N, (put) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N * P, v = y / N * P, du = (wx(u, v) - 0.5) * 2.2, dv = (wy(u, v) - 0.5) * 2.2;
    const n = 0.6 * n1(u + du, v + dv) + 0.4 * n1b(2 * (u + du), 2 * (v + dv)), a = Math.max(0, Math.min(1, (n - 0.45) / 0.35));
    put(x, y, true, s * a * a * (3 - 2 * a));
  } });
}
const dots = (s) => tile(3, 3, (put) => put(1, 1, true, s));

fs.mkdirSync(OUT, { recursive: true });
const TILES = { sigil: grain(0.06, 1), skyline: grain(0.05, 2), glass: dither(0.08), aqua: fluid(0.08), aurora: dots(0.10) };
for (const [look, buf] of Object.entries(TILES)) { fs.writeFileSync(path.join(OUT, `${look}.png`), buf); console.log(`${look}.png ${buf.length} bytes`); }
