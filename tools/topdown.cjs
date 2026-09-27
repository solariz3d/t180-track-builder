// topdown.cjs: a top-down picture of a track's drivable road (coloured by height), with a read_track walk drawn on it.
//   node topdown.cjs <track folder> <read.json> <x0> <z0> <x1> <z1> <out.bmp>
// Plain BMP writer, no dependencies. Road triangles are filled; the walk is drawn white, junction stations orange.
const fs = require('fs'), path = require('path'); const { readKn5 } = require('./kn5.cjs');
const [dir, readFile, X0, Z0, X1, Z1, out] = process.argv.slice(2); const x0 = +X0, z0 = +Z0, x1 = +X1, z1 = +Z1;
const W = 1400, H = Math.round(W * (z1 - z0) / (x1 - x0)), img = new Uint8Array(W * H * 3).fill(18), zbuf = new Float32Array(W * H).fill(-1e9);
const px = x => (x - x0) / (x1 - x0) * W, pz = z => (z - z0) / (z1 - z0) * H;
let ymin = 1e9, ymax = -1e9; const tris = [];
for (const f of fs.readdirSync(dir).filter(f => /\.kn5$/i.test(f))) for (const m of readKn5(path.join(dir, f)).meshes) {
  if (!/^\d+ROAD/i.test(m.name)) continue;
  for (let i = 0; i < m.idx.length; i += 3) { const t = [m.idx[i], m.idx[i + 1], m.idx[i + 2]].map(j => [m.pos[j * 3], m.pos[j * 3 + 1], m.pos[j * 3 + 2]]);
    if (t.every(v => v[0] < x0 || v[0] > x1 || v[2] < z0 || v[2] > z1)) continue; tris.push(t); for (const v of t) { ymin = Math.min(ymin, v[1]); ymax = Math.max(ymax, v[1]); } }
}
const col = y => { const k = (y - ymin) / (ymax - ymin || 1); return [Math.round(40 + 200 * k), Math.round(60 + 120 * (1 - Math.abs(k - .5) * 2)), Math.round(220 - 180 * k)]; };
for (const t of tris) { const P = t.map(v => [px(v[0]), pz(v[2]), v[1]]);
  const minX = Math.max(0, Math.floor(Math.min(...P.map(p => p[0])))), maxX = Math.min(W - 1, Math.ceil(Math.max(...P.map(p => p[0])))), minY = Math.max(0, Math.floor(Math.min(...P.map(p => p[1])))), maxY = Math.min(H - 1, Math.ceil(Math.max(...P.map(p => p[1]))));
  const d = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]); if (Math.abs(d) < 1e-9) continue;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { const a = ((P[1][1] - P[2][1]) * (x - P[2][0]) + (P[2][0] - P[1][0]) * (y - P[2][1])) / d, b = ((P[2][1] - P[0][1]) * (x - P[2][0]) + (P[0][0] - P[2][0]) * (y - P[2][1])) / d, c = 1 - a - b;
    if (a < 0 || b < 0 || c < 0) continue; const hy = a * P[0][2] + b * P[1][2] + c * P[2][2], k = y * W + x; if (hy > zbuf[k]) { zbuf[k] = hy; const cc = col(hy); img[k * 3] = cc[0]; img[k * 3 + 1] = cc[1]; img[k * 3 + 2] = cc[2]; } } }
const r = JSON.parse(fs.readFileSync(readFile, 'utf8'));
for (const s of r.stations) if (s.c) { const x = Math.round(px(s.c[0])), y = Math.round(pz(s.c[2])); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const k = (Y * W + X) * 3; const c = s.junction ? [255, 150, 30] : [255, 255, 255]; img[k] = c[0]; img[k + 1] = c[1]; img[k + 2] = c[2]; } }
// BMP (bottom-up rows, BGR, rows padded to 4 bytes)
const row = Math.ceil(W * 3 / 4) * 4, size = 54 + row * H, b = Buffer.alloc(size);
b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14); b.writeInt32LE(W, 18); b.writeInt32LE(H, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * H, 34);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = (y * W + x) * 3, d = 54 + (H - 1 - y) * row + x * 3; b[d] = img[s + 2]; b[d + 1] = img[s + 1]; b[d + 2] = img[s]; }
fs.writeFileSync(out, b); console.log(`${out}: ${W}x${H}, ${tris.length} road triangles, height ${ymin.toFixed(0)}..${ymax.toFixed(0)} m`);
