// envelope.cjs: the geometry that working T-180 tracks survive. For every pair of drivable road triangles that share an
// edge (matched by position, so seams BETWEEN meshes count too), it measures the seam angle, the curvature that
// seam implies (angle / distance between the triangles' centres), and whether the surface bends up into the car
// (concave: a dip or a bowl, the car is compressed) or away from it (convex: a crest, the car goes light).
// Triangle size is reported too. Output: per-track percentiles, i.e. the envelope that proven tracks stay inside.
//   node envelope.cjs <track folder> [...] > envelope.json
const fs = require('fs'), path = require('path'); const { readKn5 } = require('./kn5.cjs');

function validKeys(dir) {
  const keys = new Set(['ROAD']); const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase() === 'surfaces.ini') files.push(p); } })(dir);
  for (const f of files) { let key = null; for (const line of fs.readFileSync(f, 'latin1').split(/\r?\n/)) { const k = line.match(/^\s*KEY\s*=\s*([^\s;]+)/i); if (k) key = k[1].toUpperCase(); if (/^\s*IS_VALID_TRACK\s*=\s*1/i.test(line) && key) keys.add(key.replace(/^\d+/, '').replace(/\?$/, '')); } }
  return keys;
}
const pct = (arr, ps) => { if (!arr.length) return null; const s = Float64Array.from(arr).sort(); return Object.fromEntries(ps.map(p => [`p${p}`, +s[Math.min(s.length - 1, Math.floor(p / 100 * (s.length - 1)))].toFixed(3)])); };

function envelope(dir) {
  const keys = validKeys(dir), kn5s = fs.readdirSync(dir).filter(f => /\.kn5$/i.test(f));
  const V = new Map(); const vid = (x, y, z) => { const k = `${Math.round(x * 200)},${Math.round(y * 200)},${Math.round(z * 200)}`; let i = V.get(k); if (i === undefined) { i = V.size; V.set(k, i); } return i; };  // 5 mm weld
  const tris = [];
  for (const f of kn5s) for (const m of readKn5(path.join(dir, f)).meshes) {
    const nm = m.name.toUpperCase().match(/^\d+([A-Z_]+)/); if (!nm || /UNDERSIDE|UNDER_SIDE|BOTTOM/.test(m.name.toUpperCase())) continue;
    if (![...keys].some(K => nm[1].startsWith(K))) continue;
    for (let i = 0; i < m.idx.length; i += 3) {
      const P = [m.idx[i], m.idx[i + 1], m.idx[i + 2]].map(j => [m.pos[j * 3], m.pos[j * 3 + 1], m.pos[j * 3 + 2]]);
      const u = P[1].map((v, k) => v - P[0][k]), w = P[2].map((v, k) => v - P[0][k]);
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const L = Math.hypot(...n); if (L < 1e-9) continue;
      n = n.map(v => v / L); if (n[1] < 0) n = n.map(v => -v);     // winding is unreliable on these tracks: face every triangle up
      const edges = [Math.hypot(...u), Math.hypot(...w), Math.hypot(...P[2].map((v, k) => v - P[1][k]))];
      tris.push({ v: P.map(p => vid(...p)), n, c: [0, 1, 2].map(k => (P[0][k] + P[1][k] + P[2][k]) / 3), a: L / 2, e: Math.max(...edges) });
    }
  }
  const E = new Map();
  tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const a = t.v[k], b = t.v[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; let l = E.get(key); if (!l) E.set(key, l = []); l.push(i); } });
  const seam = [], smooth = [], concaveR = [], convexR = [], concaveSteep = []; let creases = 0;
  for (const l of E.values()) {
    if (l.length !== 2) continue;
    const A = tris[l[0]], B = tris[l[1]];
    const cosang = Math.max(-1, Math.min(1, A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2])), ang = Math.acos(cosang) * 180 / Math.PI;
    seam.push(ang);
    if (ang > 30) { creases++; continue; }   // a fold this sharp is an edge (road to wall, kerb lip), not a surface a car drives across
    smooth.push(ang);
    if (ang < .05) continue;
    const d = B.c.map((v, k) => v - A.c[k]), dist = Math.hypot(...d); if (dist < .01) continue;
    const R = dist / (ang * Math.PI / 180);                                           // the radius this bend implies
    const dn = B.n.map((v, k) => v - A.n[k]), s = dn[0] * d[0] + dn[1] * d[1] + dn[2] * d[2];
    if (s < 0) { concaveR.push(R); if (Math.acos(Math.min(1, A.n[1])) > 35 * Math.PI / 180) concaveSteep.push(R); } else convexR.push(R);
  }
  const edgeLen = tris.map(t => t.e);
  return {
    track: path.basename(dir), road_triangles: tris.length, shared_edges: seam.length,
    triangle_longest_edge_m: pct(edgeLen, [50, 90, 99]),
    seam_angle_deg: pct(seam, [50, 90, 99, 99.9, 100]), creases_over_30deg_pct: +(100 * creases / seam.length).toFixed(2), smooth_seam_deg: pct(smooth, [50, 90, 99, 99.9]),
    concave_radius_m: pct(concaveR, [0.1, 1, 5, 50]), concave_radius_on_walls_over35deg_m: pct(concaveSteep, [0.1, 1, 5, 50]),
    convex_radius_m: pct(convexR, [0.1, 1, 5, 50]),
  };
}
const out = [];
for (const d of process.argv.slice(2)) { const t0 = Date.now(); try { const r = envelope(d); r.ms = Date.now() - t0; out.push(r); console.error(`${r.track}: ${r.road_triangles} tris, ${r.ms} ms`); } catch (e) { console.error(path.basename(d) + ': ' + e.message); out.push({ track: path.basename(d), error: e.message }); } }
console.log(JSON.stringify(out, null, 1));
