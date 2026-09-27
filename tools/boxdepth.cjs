// boxdepth.cjs: frames where the T-180's collision box must be BELOW the road surface even with rigid tyres.
// Box bottom = body - 0.05 m (colliders.ini: centre 0.2, height 0.5); road = wheel centres - 0.395 m (tyres.ini RADIUS).
// So the box is under the road when the body sits more than 0.345 m below its wheel-centre plane. Tyre squash only
// makes it deeper, so these counts are a floor, not an estimate.   node boxdepth.cjs <replay>
const fs = require('fs'), path = require('path');
const { parseReplay, extractCar } = require(path.join(process.env.USERPROFILE, 'blackbox/ui/acreplay.js'));
const buf = fs.readFileSync(process.argv[2]), rep = parseReplay(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const ex = extractCar(rep, 0), N = ex.N, P = ex.pos, Wh = ex.wheels, CLEAR = 0.345;
let n = 0, under = 0, deepest = 0, at = -1; const runs = []; let run = null;
for (let i = 0; i < N; i++) {
  if (!ex.wheelsOk[i]) continue; n++;
  let nr = [ex.nrm[i * 3], ex.nrm[i * 3 + 1], ex.nrm[i * 3 + 2]]; const l = Math.hypot(...nr) || 1; nr = nr.map(x => x / l);
  const c = [0, 1, 2].map(k => (Wh[i * 12 + k] + Wh[i * 12 + 3 + k] + Wh[i * 12 + 6 + k] + Wh[i * 12 + 9 + k]) / 4);
  const h = [0, 1, 2].reduce((s, k) => s + (P[i * 3 + k] - c[k]) * nr[k], 0), depth = -(h + CLEAR);
  if (depth > 0) { under++; if (depth > deepest) { deepest = depth; at = i; } if (!run || run.end < i - 1) runs.push(run = { start: i, end: i, max: depth }); else { run.end = i; run.max = Math.max(run.max, depth); } }
}
console.log(`${path.basename(process.argv[2])}: ${n} frames, box below the road (rigid tyres) in ${under} (${(100 * under / n).toFixed(2)}%), ${runs.length} separate episodes`);
if (under) console.log(`  deepest ${(deepest * 100).toFixed(1)} cm at t=${(at * ex.dt).toFixed(2)} s; longest episode ${Math.max(...runs.map(r => r.end - r.start + 1))} frames (${(Math.max(...runs.map(r => r.end - r.start + 1)) * ex.dt).toFixed(2)} s)`);
for (const r of runs.sort((a, b) => b.max - a.max).slice(0, 6)) console.log(`  t ${(r.start * ex.dt).toFixed(2)}-${(r.end * ex.dt).toFixed(2)} s   ${r.end - r.start + 1} frames   max ${(r.max * 100).toFixed(1)} cm`);
