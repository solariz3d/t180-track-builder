// speed.cjs: how fast a T-180 is driven, and how hard it accelerates, measured from a replay. The design-speed default
// and the lap sim's acceleration in src/validate come from this (docs/FINDINGS.md §3d).
//   node speed.cjs <replay.acreplay> [more replays…]      one table per replay, then all of them pooled
//
// Positions are smoothed and differentiated exactly as loads.cjs does (a centred window of ±4 frames; frames with an
// invalid wheel quad, under 5 m/s, or that teleport are dropped). Then:
//   · SPEED is |v|, from the smoothed position.
//   · PROPULSIVE ACCELERATION is what the car's own thrust gave it along its path, gravity taken out:
//       a_prop = dv/dt + g · (v_y / |v|)          (a climb costs g·sinθ; that part is gravity's, not the engine's)
//     dv/dt is the central difference of the speed over ±A frames (A = 6: a second difference of float32 positions is
//     too noisy frame to frame). Braking, drag and the tyres are all inside a_prop; the replay carries no throttle.
//   · Per speed band, the p50 and the p95 of a_prop. The p95 is read as "the car at full thrust" in that band: an
//     INFERENCE (a driver at full throttle for at least 5% of the band's frames), not a throttle measurement.
'use strict';
const fs = require('fs'), path = require('path');
const { parseReplay, extractCar } = require(process.env.BLACKBOX ? path.join(process.env.BLACKBOX, 'ui/acreplay.js') : [path.join(process.env.USERPROFILE, 'blackbox'), path.join(process.env.USERPROFILE, 'Desktop', 'blackbox')].map(d => path.join(d, 'ui/acreplay.js')).find(p => fs.existsSync(p)) || (() => { throw new Error('blackbox not found: set BLACKBOX to its folder'); })());

const G = 9.81, W = 4, A = 6;
const BANDS = [[0, 200], [200, 300], [300, 400], [400, 500], [500, 600], [600, 700], [700, 800]];
const q = (arr, p) => { if (!arr.length) return NaN; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

/** Every measured frame of one replay: { kph, aProp } (m/s²). */
function measure(file) {
  const buf = fs.readFileSync(file), rep = parseReplay(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const ex = extractCar(rep, 0), N = ex.N, dt = ex.dt, P = ex.pos;
  const sm = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { let s = 0, n = 0; for (let j = Math.max(0, i - W); j <= Math.min(N - 1, i + W); j++) { s += P[j * 3 + k]; n++; } sm[i * 3 + k] = s / n; }
  const vel = (i) => [0, 1, 2].map(k => (sm[(i + 1) * 3 + k] - sm[(i - 1) * 3 + k]) / (2 * dt));
  const ok = new Uint8Array(N), spd = new Float64Array(N), vy = new Float64Array(N);
  for (let i = W + 2; i < N - W - 2; i++) {
    if (!ex.wheelsOk[i]) continue;
    const v = vel(i), s = Math.hypot(...v);
    if (s < 5) continue;
    const jump = Math.hypot(...[0, 1, 2].map(k => P[(i + 1) * 3 + k] - P[i * 3 + k])); if (jump > s * dt * 3 + 1) continue;   // a teleport/reset
    ok[i] = 1; spd[i] = s; vy[i] = v[1];
  }
  const rows = [];
  for (let i = A; i < N - A; i++) {
    if (!ok[i]) continue;
    let whole = true; for (let j = i - A; j <= i + A; j++) if (!ok[j]) { whole = false; break; }   // no gap inside the window
    if (!whole) continue;
    const dvdt = (spd[i + A] - spd[i - A]) / (2 * A * dt);
    rows.push({ kph: spd[i] * 3.6, aProp: dvdt + G * vy[i] / spd[i] });
  }
  return { rows, N, dt, car: ex.car.carId || '' };
}

function table(label, rows) {
  const k = rows.map(r => r.kph);
  const out = [`${label}: ${rows.length} frames · speed km/h p10 ${q(k, .1).toFixed(0)} p50 ${q(k, .5).toFixed(0)} p90 ${q(k, .9).toFixed(0)} p99 ${q(k, .99).toFixed(0)} p99.9 ${q(k, .999).toFixed(0)} max ${k.reduce((m, x) => Math.max(m, x), 0).toFixed(0)}`];
  for (const [lo, hi] of BANDS) {
    const a = rows.filter(r => r.kph >= lo && r.kph < hi).map(r => r.aProp);
    if (a.length) out.push(`  ${String(lo).padStart(3)}-${hi} km/h: ${String(a.length).padStart(6)} frames, a_prop p50 ${q(a, .5).toFixed(2)} p95 ${q(a, .95).toFixed(2)} m/s²`);
  }
  return out.join('\n');
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('usage: node speed.cjs <replay.acreplay> [more…]');
  const all = [];
  for (const f of files) { const m = measure(f); for (const r of m.rows) all.push(r); console.log(table(`${path.basename(f)} (car ${m.car}, dt ${m.dt.toFixed(4)} s)`, m.rows)); }
  if (files.length > 1) console.log(table(`POOLED, ${files.length} replays`, all));
}
module.exports = { measure, table, BANDS };
