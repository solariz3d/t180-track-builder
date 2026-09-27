// bottoming.cjs: does the T-180's suspension run out of travel, and at what load? For every frame it measures how high
// the car's recorded position (the body) sits above the centre of its four wheel centres, along the road normal, and
// pairs that with the load into the road (the same measure as loads.cjs). As springs compress the body drops toward
// the wheels; if the travel runs out, the height STOPS dropping while the load keeps rising. The per-load-band medians
// show where that happens.
//   node bottoming.cjs <replay.acreplay>
const fs = require('fs'), path = require('path');
const { parseReplay, extractCar } = require(path.join(process.env.USERPROFILE, 'blackbox/ui/acreplay.js'));
const file = process.argv[2]; if (!file) throw new Error('usage: node bottoming.cjs <replay.acreplay>');
const buf = fs.readFileSync(file), rep = parseReplay(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const ex = extractCar(rep, 0), N = ex.N, dt = ex.dt, P = ex.pos, G = 9.81, Wh = ex.wheels;
const W = 4, sm = new Float64Array(N * 3);
for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { let s = 0, n = 0; for (let j = Math.max(0, i - W); j <= Math.min(N - 1, i + W); j++) { s += P[j * 3 + k]; n++; } sm[i * 3 + k] = s / n; }
const rows = [];
for (let i = W + 2; i < N - W - 2; i++) {
  if (!ex.wheelsOk[i]) continue;
  const a = [0, 1, 2].map(k => (sm[(i + 1) * 3 + k] - 2 * sm[i * 3 + k] + sm[(i - 1) * 3 + k]) / (dt * dt));
  const v = [0, 1, 2].map(k => (sm[(i + 1) * 3 + k] - sm[(i - 1) * 3 + k]) / (2 * dt)), speed = Math.hypot(...v);
  if (speed < 5) continue;
  if (Math.hypot(...[0, 1, 2].map(k => P[(i + 1) * 3 + k] - P[i * 3 + k])) > speed * dt * 3 + 1) continue;
  let n = [ex.nrm[i * 3], ex.nrm[i * 3 + 1], ex.nrm[i * 3 + 2]]; const nl = Math.hypot(...n) || 1; n = n.map(x => x / nl);
  const load = (a[0] * n[0] + (a[1] + G) * n[1] + a[2] * n[2]) / G;
  const c = [0, 1, 2].map(k => (Wh[i * 12 + k] + Wh[i * 12 + 3 + k] + Wh[i * 12 + 6 + k] + Wh[i * 12 + 9 + k]) / 4);
  const h = [0, 1, 2].reduce((s, k) => s + (P[i * 3 + k] - c[k]) * n[k], 0);           // body above the wheel-centre plane
  // front/rear split too: pitch changes can hide a bottoming axle
  const cf = [0, 1, 2].map(k => (Wh[i * 12 + k] + Wh[i * 12 + 3 + k]) / 2), cr = [0, 1, 2].map(k => (Wh[i * 12 + 6 + k] + Wh[i * 12 + 9 + k]) / 2);
  rows.push({ load, h, kph: speed * 3.6, gap: Math.hypot(...[0, 1, 2].map(k => cf[k] - cr[k])) });
}
const q = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
console.log(`${path.basename(file)}: ${rows.length} frames`);
console.log('load band        frames   body height above wheel centres (m): p10 / median / p90     wheelbase check (m)');
const bands = [[0, 1.5], [1.5, 3], [3, 5], [5, 8], [8, 12], [12, 16], [16, 20], [20, 25], [25, 30], [30, 40], [40, 60], [60, 100]];
for (const [lo, hi] of bands) { const b = rows.filter(r => r.load >= lo && r.load < hi); if (b.length < 5) continue;
  const hs = b.map(r => r.h); console.log(`${String(lo).padStart(3)}-${String(hi).padEnd(3)} g   ${String(b.length).padStart(6)}     ${q(hs, .1).toFixed(3)} / ${q(hs, .5).toFixed(3)} / ${q(hs, .9).toFixed(3)}              ${q(b.map(r => r.gap), .5).toFixed(3)}`); }
