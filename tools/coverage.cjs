// coverage.cjs: does a track read match where a car was actually driven? For every moving replay frame, the nearest
// station of the read line; a frame counts as covered within 25 m. Also: which way the car went along the read
// (station order forward vs backward), how many laps of the read it covered, the car's own distance per lap, and
// every stretch of road the car drove that the read line does not pass near (a section the reader missed).
// Jump markers in the read carry no centre and are skipped; a car in flight over one shows up as a stretch off the line.
//   node coverage.cjs <read.json> <replay.acreplay> [maxDist=25]
const fs = require('fs'), path = require('path');
const { parseReplay, extractCar } = require(process.env.BLACKBOX ? path.join(process.env.BLACKBOX, 'ui/acreplay.js') : [path.join(process.env.USERPROFILE, 'blackbox'), path.join(process.env.USERPROFILE, 'Desktop', 'blackbox')].map(d => path.join(d, 'ui/acreplay.js')).find(p => fs.existsSync(p)) || (() => { throw new Error('blackbox not found: set BLACKBOX to its folder'); })());
const [readFile, repFile, md] = process.argv.slice(2);
if (!readFile || !repFile) throw new Error('usage: node coverage.cjs <read.json> <replay.acreplay> [maxDist=25]');
const MAX = +(md || 25);
const read = JSON.parse(fs.readFileSync(readFile, 'utf8')), S = read.stations, NS = S.length;
if (!NS) throw new Error('read has no stations');
// bucket the stations on a 50 m grid (x,z) so the nearest search stays local
const CELL = 50, grid = new Map(), key = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
S.forEach((s, i) => { if (!s.c) return; const k = key(s.c[0], s.c[2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
function nearest(p) {
  const cx = Math.floor(p[0] / CELL), cz = Math.floor(p[2] / CELL); let best = -1, bd = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const i of grid.get((cx + dx) + ',' + (cz + dz)) || []) {
    const c = S[i].c, d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]); if (d < bd) { bd = d; best = i; } }
  return [best, bd];
}
const buf = fs.readFileSync(repFile), rep = parseReplay(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const ex = extractCar(rep, 0), N = ex.N, dt = ex.dt, P = ex.pos;
let lastSt = -1, moving = 0, covered = 0, fwd = 0, back = 0, adv = 0, prev = -1, carDist = 0;
const misses = []; let run = null;
for (let i = 1; i < N; i++) {
  const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], q = [P[i * 3 - 3], P[i * 3 - 2], P[i * 3 - 1]], step = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  if (step < 5 * dt || step > 200 * dt) { prev = -1; continue; }                 // parked, or a teleport/reset
  moving++; carDist += step;
  const [si, d] = nearest(p);
  if (si >= 0 && d <= MAX) {
    covered++;
    if (prev >= 0) { let dd = si - prev; if (dd > NS / 2) dd -= NS; if (dd < -NS / 2) dd += NS; if (dd > 0) fwd++; else if (dd < 0) back++; adv += dd; }
    if (run) { run.rejoin = si; run.back = S[si].d; if (run.m > 50) misses.push(run); run = null; }
    prev = si; lastSt = si;
  } else { prev = -1; if (!run) run = { t: +(i * dt).toFixed(1), m: 0, p, left: lastSt >= 0 ? S[lastSt].d : null }; run.m += step; }
}
if (run && run.m > 50) misses.push(run);
const lapM = read.walked_m, laps = Math.abs(adv) * (lapM / NS) / lapM;
console.log(`${path.basename(repFile)} vs ${read.track} (${(lapM / 1000).toFixed(1)} km read, ${NS} stations)`);
console.log(`  covered ${(100 * covered / moving).toFixed(1)}%  (${covered}/${moving} moving frames within ${MAX} m)`);
console.log(`  direction: forward ${fwd} / backward ${back} station steps;  net ${laps.toFixed(2)} laps of the read`);
console.log(`  car drove ${(carDist / 1000).toFixed(1)} km;  per read-lap ${laps > 0.5 ? (carDist / laps / 1000).toFixed(1) + ' km' : '-'}`);
console.log(`  stretches off the read line (>50 m): ${misses.length}`);
for (const r of misses.sort((a, b) => b.m - a.m).slice(0, 10)) console.log(`    t ${String(r.t).padStart(7)} s  ${r.m.toFixed(0).padStart(6)} m  from ${r.p.map(v => v.toFixed(0)).join(',')}  read d ${r.left ?? '-'} -> ${r.back ?? '-'} m`);
