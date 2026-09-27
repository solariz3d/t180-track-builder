// loads.cjs: the load that actually pressed a T-180 into the road on a lap that did not clip, measured from a replay.
// Blackbox's parser gives each frame's car position and the road plane under it (the plane of the four wheel
// contacts). Speed and acceleration come from position over time (smoothed). The load INTO the road is the
// specific force (acceleration minus gravity) along the road's normal, in g: 1.0 is sitting still on flat ground;
// more is the road pushing harder (dips, bowls, banked turns at speed). Also reported: the curve radius that load
// implies at that speed, R = v^2 / ((load - cos(tilt)) g), i.e. the tightest bends the car was actually driven through.
//   node loads.cjs <replay.acreplay>
const fs = require('fs'), path = require('path');
const { parseReplay, extractCar } = require(path.join(process.env.USERPROFILE, 'blackbox/ui/acreplay.js'));
const file = process.argv[2]; if (!file) throw new Error('usage: node loads.cjs <replay.acreplay>');
const buf = fs.readFileSync(file), rep = parseReplay(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const ex = extractCar(rep, 0), N = ex.N, dt = ex.dt, P = ex.pos, G = 9.81;
// smooth positions with a centred window (float32 positions are noisy once differentiated twice)
const W = 4, sm = new Float64Array(N * 3);
for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { let s = 0, n = 0; for (let j = Math.max(0, i - W); j <= Math.min(N - 1, i + W); j++) { s += P[j * 3 + k]; n++; } sm[i * 3 + k] = s / n; }
const rows = [];
for (let i = W + 2; i < N - W - 2; i++) {
  if (!ex.wheelsOk[i]) continue;
  const a = [0, 1, 2].map(k => (sm[(i + 1) * 3 + k] - 2 * sm[i * 3 + k] + sm[(i - 1) * 3 + k]) / (dt * dt));
  const v = [0, 1, 2].map(k => (sm[(i + 1) * 3 + k] - sm[(i - 1) * 3 + k]) / (2 * dt)), speed = Math.hypot(...v);
  if (speed < 5) continue;
  const jump = Math.hypot(...[0, 1, 2].map(k => P[(i + 1) * 3 + k] - P[i * 3 + k])); if (jump > speed * dt * 3 + 1) continue;   // a teleport/reset, not driving
  let n = [ex.nrm[i * 3], ex.nrm[i * 3 + 1], ex.nrm[i * 3 + 2]]; const nl = Math.hypot(...n) || 1; n = n.map(x => x / nl);
  const f = [a[0], a[1] + G, a[2]];                                   // specific force: what the road must supply
  const load = (f[0] * n[0] + f[1] * n[1] + f[2] * n[2]) / G;
  const tilt = Math.acos(Math.max(-1, Math.min(1, n[1]))) * 180 / Math.PI;
  const extra = load - Math.cos(tilt * Math.PI / 180);                // the part from curving, beyond what gravity alone gives
  rows.push({ i, t: +(i * dt).toFixed(2), kph: speed * 3.6, load, tilt, R: extra > .05 ? speed * speed / (extra * G) : Infinity });
}
const q = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const L = rows.map(r => r.load), R = rows.filter(r => isFinite(r.R) && r.kph > 150).map(r => r.R);
console.log(`${path.basename(file)}: ${rows.length} frames measured of ${N}, car ${ex.car.carId || ''}`);
console.log(`load into the road (g):  p50 ${q(L, .5).toFixed(2)}  p90 ${q(L, .9).toFixed(2)}  p99 ${q(L, .99).toFixed(2)}  p99.9 ${q(L, .999).toFixed(2)}  max ${Math.max(...L).toFixed(2)}`);
console.log(`curve radius driven through above 150 km/h (m):  p0.1 ${q(R, .001).toFixed(0)}  p1 ${q(R, .01).toFixed(0)}  p10 ${q(R, .1).toFixed(0)}  median ${q(R, .5).toFixed(0)}`);
console.log('the ten hardest moments (load, speed, road tilt, implied radius):');
const top = [...rows].sort((x, y) => y.load - x.load); const seen = [];
for (const r of top) { if (seen.some(s => Math.abs(s - r.i) < 40)) continue; seen.push(r.i); console.log(`  t ${String(r.t).padStart(6)} s   ${r.load.toFixed(2)} g   ${r.kph.toFixed(0).padStart(4)} km/h   tilt ${r.tilt.toFixed(0).padStart(3)} deg   R ${isFinite(r.R) ? r.R.toFixed(0) + ' m' : '-'}`); if (seen.length >= 10) break; }
// load by speed band: where the envelope gets tight
for (const [lo, hi] of [[0, 200], [200, 300], [300, 400], [400, 500], [500, 700]]) { const b = rows.filter(r => r.kph >= lo && r.kph < hi).map(r => r.load); if (b.length) console.log(`  ${lo}-${hi} km/h: ${b.length} frames, load p50 ${q(b, .5).toFixed(2)} p99 ${q(b, .99).toFixed(2)} max ${Math.max(...b).toFixed(2)} g`); }
