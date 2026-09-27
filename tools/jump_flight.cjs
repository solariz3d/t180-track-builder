// jump_flight.cjs: how a T-180 actually flies a jump, from a replay. Finds the frames where the car passes the take-off
// point, follows it until it is back near the landing, and fits the flight: take-off speed and angle, time in the air,
// and the vertical acceleration while airborne. The last is the number the builder needs: in the air a T-180 is
// pulled down by gravity AND by its own downforce, which grows with speed, so it falls harder than 1 g.
//   node jump_flight.cjs <replay> <takeoff x,y,z> <landing x,y,z>
const fs = require('fs'), path = require('path');
const { parseReplay, extractCar } = require(process.env.BLACKBOX ? path.join(process.env.BLACKBOX, 'ui/acreplay.js') : [path.join(process.env.USERPROFILE, 'blackbox'), path.join(process.env.USERPROFILE, 'Desktop', 'blackbox')].map(d => path.join(d, 'ui/acreplay.js')).find(p => fs.existsSync(p)) || (() => { throw new Error('blackbox not found: set BLACKBOX to its folder'); })());
const [file, A, B] = process.argv.slice(2), to = A.split(',').map(Number), la = B.split(',').map(Number);
const buf = fs.readFileSync(file), rep = parseReplay(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const ex = extractCar(rep, 0), N = ex.N, P = ex.pos, dt = ex.dt, G = 9.81;
const at = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const axis = [la[0] - to[0], 0, la[2] - to[2]], gapH = Math.hypot(axis[0], axis[2]); axis[0] /= gapH; axis[2] /= gapH;
const along = p => (p[0] - to[0]) * axis[0] + (p[2] - to[2]) * axis[2];
// every pass: a frame close to the take-off (within 20 m) moving toward the landing
const passes = []; let i = 1;
while (i < N - 1) {
  if (dist(at(i), to) < 20 && along(at(i + 1)) > along(at(i))) {
    let s = i; while (s < N - 1 && along(at(s)) < 0) s++;                              // the frame the car crosses the lip
    let e = s; while (e < N - 1 && along(at(e)) < gapH && e - s < 2000) e++;          // ...until it is over the landing
    if (e > s + 3 && along(at(e)) >= gapH - 1) passes.push([s, e]);
    i = e + 50;
  } else i++;
}
if (!passes.length) { console.log(`${path.basename(file)}: no pass over this jump found`); process.exit(0); }
for (const [s, e] of passes) {
  // fit y(t) = y0 + vy t + a t^2 / 2 over the flight (least squares), with x along the gap for speed
  const ts = [], ys = [], xs = []; for (let k = s; k <= e; k++) { ts.push((k - s) * dt); ys.push(P[k * 3 + 1]); xs.push(along(at(k))); }
  const n = ts.length, S = (f) => ts.reduce((a, t, k) => a + f(t, k), 0);
  const M = [[n, S(t => t), S(t => t * t / 2)], [S(t => t), S(t => t * t), S(t => t * t * t / 2)], [S(t => t * t / 2), S(t => t * t * t / 2), S(t => t * t * t * t / 4)]];
  const rhs = [S((t, k) => ys[k]), S((t, k) => t * ys[k]), S((t, k) => t * t / 2 * ys[k])];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M), solve = c => det(M.map((row, r) => row.map((v, cc) => cc === c ? rhs[r] : v))) / D;
  const y0 = solve(0), vy = solve(1), a = solve(2);
  const vh0 = (xs[Math.min(3, n - 1)] - xs[0]) / (Math.min(3, n - 1) * dt), vh1 = (xs[n - 1] - xs[Math.max(0, n - 4)]) / (Math.min(3, n - 1) * dt);
  const resid = Math.sqrt(ts.reduce((q, t, k) => q + (ys[k] - (y0 + vy * t + a * t * t / 2)) ** 2, 0) / n);
  console.log(`${path.basename(file)}  frames ${s}-${e}: in the air ${(e - s) * dt} s over ${gapH.toFixed(0)} m`);
  console.log(`  take-off: ${(vh0 * 3.6).toFixed(0)} km/h along the gap, climbing ${vy.toFixed(1)} m/s (${(Math.atan2(vy, vh0) * 180 / Math.PI).toFixed(1)}°)   landing-side: ${(vh1 * 3.6).toFixed(0)} km/h`);
  console.log(`  vertical acceleration in flight: ${a.toFixed(1)} m/s² = ${(-a / G).toFixed(2)} g down   (fit residual ${resid.toFixed(2)} m)   height ${ys[0].toFixed(1)} -> ${ys[n - 1].toFixed(1)} m`);
  // attitude in the air: the body's nose (front axle minus rear axle, from the recorded wheels) against the flight
  // path. Negative = nose below the path. The turbine's thrust acts 0.77 m above the origin, so throttle in the air
  // (only the override gives it) pitches the nose down (FINDINGS §7e).
  const rel = [], body = []; for (let k = s + 1; k < e; k++) { const f = [ex.fwd[k * 3], ex.fwd[k * 3 + 1], ex.fwd[k * 3 + 2]], fl = Math.hypot(...f);
    const v = [0, 1, 2].map(c => (P[(k + 1) * 3 + c] - P[(k - 1) * 3 + c]) / (2 * dt)), vl = Math.hypot(...v); if (!fl || !vl) continue;
    const bp = Math.asin(f[1] / fl) * 180 / Math.PI; body.push(bp); rel.push(bp - Math.asin(v[1] / vl) * 180 / Math.PI); }
  if (rel.length > 1) console.log(`  nose vs flight path: ${rel[0].toFixed(1)}° at take-off, mean ${(rel.reduce((q, x) => q + x, 0) / rel.length).toFixed(1)}°, ${rel[rel.length - 1].toFixed(1)}° at landing   body pitch rate ${((body[body.length - 1] - body[0]) / ((body.length - 1) * dt)).toFixed(1)} °/s`);
}
