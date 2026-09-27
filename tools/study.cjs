// study.cjs: measures the drivable surface of Assetto Corsa tracks — how steeply it tilts, and how that tilt changes
// ACROSS the road, which is what separates a flat road, a planar bank, and a half-pipe.
//   node study.cjs <track folder> [<track folder> ...] > out.json
// Drivable meshes are the ones named <digit><KEY>… where KEY is a surface in data/surfaces.ini with IS_VALID_TRACK=1
// (plus any 1ROAD-style mesh). Tilt is the angle between a triangle's normal and straight up: 0 flat, 90 a wall,
// over 90 an overhang. Cross-section profiles are walked on the surface itself (not by vertical rays), so they keep
// working up the wall of a bowl.
const fs = require('fs'), path = require('path'); const { readKn5 } = require('./kn5.cjs');

function validKeys(dir) {
  const keys = new Set(['ROAD']);
  const files = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase() === 'surfaces.ini') files.push(p); } })(dir);
  for (const f of files) {
    let key = null;
    for (const line of fs.readFileSync(f, 'latin1').split(/\r?\n/)) {
      const k = line.match(/^\s*KEY\s*=\s*([^\s;]+)/i); if (k) key = k[1].toUpperCase();
      const v = line.match(/^\s*IS_VALID_TRACK\s*=\s*1/i); if (v && key) keys.add(key.replace(/^\d+/, '').replace(/\?$/, ''));
    }
  }
  return keys;
}

function study(dir) {
  const keys = validKeys(dir), kn5s = fs.readdirSync(dir).filter(f => /\.kn5$/i.test(f));
  const T = [];      // triangles: [ax,ay,az,bx,by,bz,cx,cy,cz]
  const meshNames = new Set();
  for (const f of kn5s) {
    const k = readKn5(path.join(dir, f));
    for (const m of k.meshes) {
      const nm = m.name.toUpperCase().match(/^\d+([A-Z_]+)/); if (!nm) continue;
      if (/UNDERSIDE|UNDER_SIDE|BOTTOM/.test(m.name.toUpperCase())) continue;   // flipped copies under the road so cars cannot fall through: not driven on
      const key = [...keys].find(K => nm[1].startsWith(K)); if (!key) continue;
      meshNames.add(f + ':' + m.name);
      for (let i = 0; i < m.idx.length; i += 3) { const t = []; for (const j of [m.idx[i], m.idx[i + 1], m.idx[i + 2]]) t.push(m.pos[j * 3], m.pos[j * 3 + 1], m.pos[j * 3 + 2]); T.push(t); }
    }
  }
  if (!T.length) throw new Error(dir + ': no drivable meshes found (keys ' + [...keys].join(',') + ')');
  // per-triangle normal, area, tilt
  const N = [], A = [], C = []; let area = 0, ymin = 1e9, ymax = -1e9;
  const bins = [0, 3, 8, 15, 25, 35, 45, 60, 75, 90, 180], hist = new Array(bins.length - 1).fill(0);
  for (const t of T) {
    const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz); const a = L / 2;
    if (L > 0) { nx /= L; ny /= L; nz /= L; }
    N.push([nx, ny, nz]); A.push(a); C.push([(t[0] + t[3] + t[6]) / 3, (t[1] + t[4] + t[7]) / 3, (t[2] + t[5] + t[8]) / 3]);
    area += a; ymin = Math.min(ymin, t[1], t[4], t[7]); ymax = Math.max(ymax, t[1], t[4], t[7]);
  }
  // road meshes have no guaranteed winding: most of a road faces up, so orient each triangle's normal to agree with
  // its neighbours' by flood fill from triangles that clearly face up
  const grid = new Map(), CS = 4, key3 = (x, y, z) => `${Math.floor(x / CS)},${Math.floor(y / CS)},${Math.floor(z / CS)}`;
  T.forEach((t, i) => { const xs = [t[0], t[3], t[6]], ys = [t[1], t[4], t[7]], zs = [t[2], t[5], t[8]];
    for (let x = Math.floor(Math.min(...xs) / CS); x <= Math.floor(Math.max(...xs) / CS); x++) for (let y = Math.floor(Math.min(...ys) / CS); y <= Math.floor(Math.max(...ys) / CS); y++) for (let z = Math.floor(Math.min(...zs) / CS); z <= Math.floor(Math.max(...zs) / CS); z++) {
      const k = `${x},${y},${z}`; let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(i); } });
  const near = (p, r = 1) => { const out = new Set(), cx = Math.floor(p[0] / CS), cy = Math.floor(p[1] / CS), cz = Math.floor(p[2] / CS);
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) { const c = grid.get(`${x},${y},${z}`); if (c) for (const i of c) out.add(i); } return out; };
  // orientation: majority vote of nearby triangles, seeded by up-facing ones (cheap and good enough for tilt statistics)
  const up = N.map(n => n[1]);
  for (let pass = 0; pass < 2; pass++) N.forEach((n, i) => { if (Math.abs(n[1]) > .5) return; let s = 0; for (const j of near(C[i], 0)) if (j !== i) { const m = N[j]; s += (m[0] * n[0] + m[1] * n[1] + m[2] * n[2]) * A[j] * Math.sign(up[j] || 1); } if (s < 0) { N[i] = [-n[0], -n[1], -n[2]]; } });
  N.forEach((n, i) => { const tilt = Math.acos(Math.min(1, Math.abs(n[1]))) * 180 / Math.PI; for (let b = 0; b < hist.length; b++) if (tilt >= bins[b] && tilt < bins[b + 1]) { hist[b] += A[i]; break; } });
  // closest point on a triangle (Ericson, Real-Time Collision Detection 5.1.5)
  function closest(p, t) {
    const a = [t[0], t[1], t[2]], b = [t[3], t[4], t[5]], c = [t[6], t[7], t[8]];
    const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], add = (u, v, s) => [u[0] + v[0] * s, u[1] + v[1] * s, u[2] + v[2] * s];
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, ab, d1 / (d1 - d3));
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, ac, d2 / (d2 - d6));
    const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return add(b, sub(c, b), w); }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  }
  const onSurface = (p, maxD = 2.5) => { let best = null, bd = maxD; for (const i of near(p)) { const q = closest(p, T[i]), d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); if (d < bd) { bd = d; best = { q, i }; } } return best; };
  const tiltOf = n => Math.acos(Math.min(1, Math.abs(n[1]))) * 180 / Math.PI;
  // cross-section profiles: from area-weighted seeds, walk across the road (perpendicular to its direction) both ways
  const cum = []; let acc = 0; for (const a of A) cum.push(acc += a);
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const profiles = [];
  for (let s = 0; s < 400 && profiles.length < 250; s++) {
    const r = rnd() * acc; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    const n0 = N[lo]; const nh = Math.hypot(n0[0], n0[2]);
    // the road's direction: level and perpendicular to the downhill direction; for a near-flat triangle, use its
    // neighbourhood's longest horizontal extent instead
    let fwd;
    if (nh > .08) fwd = [-n0[2] / nh, 0, n0[0] / nh];
    else { const ids = [...near(C[lo], 2)]; if (ids.length < 6) continue; let mx = 0, mz = 0; ids.forEach(i => { mx += C[i][0]; mz += C[i][2]; }); mx /= ids.length; mz /= ids.length; let sxx = 0, sxz = 0, szz = 0; ids.forEach(i => { const dx = C[i][0] - mx, dz = C[i][2] - mz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; });
      const ang = .5 * Math.atan2(2 * sxz, sxx - szz); fwd = [Math.cos(ang), 0, Math.sin(ang)]; }
    const walk = dir => { const pts = []; let p = C[lo], n = N[lo];
      for (let k = 0; k < 80; k++) {
        let L = [fwd[1] * n[2] - fwd[2] * n[1], fwd[2] * n[0] - fwd[0] * n[2], fwd[0] * n[1] - fwd[1] * n[0]]; const l = Math.hypot(...L) || 1; L = L.map(v => v / l * dir);
        const hit = onSurface([p[0] + L[0], p[1] + L[1], p[2] + L[2]]); if (!hit) break;
        if (Math.hypot(hit.q[0] - p[0], hit.q[1] - p[1], hit.q[2] - p[2]) < .5) break;   // snapped back to the edge: the road ended
        p = hit.q; n = N[hit.i]; pts.push(tiltOf(n));
      } return pts; };
    const left = walk(1), right = walk(-1);
    if (left.length + right.length < 6) continue;
    profiles.push({ tilts: [...left.reverse(), tiltOf(n0), ...right], y: C[lo][1] });
  }
  // classify each profile by its shape across the road
  const shape = { flat: 0, planar_bank: 0, progressive: 0, pipe: 0, other: 0 };
  const edgeMax = [], centreTilt = [], widths = [];
  for (const pr of profiles) {
    const t = pr.tilts, w = t.length, mid = t[Math.floor(w / 2)], mx = Math.max(...t), mn = Math.min(...t), q = Math.floor(w / 4);
    const inner = Math.min(t[q], t[w - 1 - q]), outer = Math.max(t[0], t[w - 1]);
    widths.push(w); edgeMax.push(mx); centreTilt.push(mid);
    if (mx < 5) shape.flat++;
    else if (mx - mn < 8) shape.planar_bank++;
    else if (Math.min(t[0], t[w - 1]) > inner + 15 && mn < 12) shape.pipe++;          // rises at BOTH edges from a flatter bottom
    else if (outer > inner + 10) shape.progressive++;                                  // rises toward one edge: the bowl
    else shape.other++;
  }
  const pct = v => +(100 * v / area).toFixed(1), q = (arr, f) => { const s = [...arr].sort((a, b) => a - b); return s.length ? +s[Math.floor(f * (s.length - 1))].toFixed(1) : null; };
  return {
    track: path.basename(dir), meshes: [...meshNames].length, triangles: T.length, drivable_area_m2: Math.round(area), elevation_range_m: +(ymax - ymin).toFixed(1),
    tilt_area_pct: Object.fromEntries(hist.map((h, i) => [`${bins[i]}-${bins[i + 1]}deg`, pct(h)])),
    profiles: profiles.length, profile_shapes: shape,
    road_width_m: { p10: q(widths, .1), median: q(widths, .5), p90: q(widths, .9) },
    centre_tilt_deg: { median: q(centreTilt, .5), p90: q(centreTilt, .9) }, max_tilt_across_deg: { median: q(edgeMax, .5), p90: q(edgeMax, .9), max: q(edgeMax, 1) },
    sample_profiles: profiles.filter((_, i) => i % 50 === 0).map(p => p.tilts.filter((_, k) => k % 2 === 0).map(v => Math.round(v))),
  };
}
const out = [];
for (const d of process.argv.slice(2)) { const t0 = Date.now(); try { const r = study(d); r.ms = Date.now() - t0; out.push(r); console.error(`${r.track}: ${r.triangles} tris, ${r.profiles} profiles, ${r.ms} ms`); } catch (e) { console.error(path.basename(d) + ': ' + e.message); out.push({ track: path.basename(d), error: e.message }); } }
console.log(JSON.stringify(out, null, 1));
