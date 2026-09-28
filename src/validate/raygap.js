// raygap.js: gaps in the PHYSICS road under the Mach 6's downforce ray (RED, reason 'downforce-ray-gap').
//
// WHY (R1, docs/research/04_ac_physics_drivability.md §4, SOURCED there from the installed car's
// mach6_active/data/script.lua:424-433): the car's downforce comes from ONE ray to the track, cast from 0.4 m above the
// car's origin and 1.0 m ahead of it, 1.0 m long, straight down the car's up axis. Suction is full when the road is
// within 0.5 m of the ray's start and gone at 0.9 m, and a MISS gives zero downforce (the miss value is inferred there
// from the code, not documented). So wherever the physics road has a gap the ray can fall into, the car loses ALL its
// downforce at once, not only the grip of a wheel. FINDINGS §5 already calls gaps or holes in the road mesh RED; this is
// the check that finds them in the mesh itself, at the ray's scale. (Validation's older 'gap-in-road' finds holes in the
// PATH, by station spacing; a hole narrower than a station step passes it.)
//
// THE CHECK, on the drivable physics meshes in WORLD space (the export's built scene: `1<KEY>…` meshes that are not WALL):
//   · vertices within 5 mm of each other are one vertex, and an edge used by ONE triangle is a boundary edge. The weld is
//     by DISTANCE, searching the neighbouring 5 mm buckets: a first form rounded each vertex to one bucket (as
//     tools/envelope.cjs does), and two part rows 1 mm apart that straddled a bucket boundary stayed unwelded and read
//     as a 0.1 m gap (test/doc-e2e.test.js's loop, at the in/body boundary of a bowl word);
//   · a boundary edge is a GAP when road starts again beyond it within the ray's reach: at probes 0.1, 0.25, 0.5 and
//     1.0 m (MACH6.downforceRay.aheadM) across the edge, in its triangle's plane, the car's OWN ray is cast: from upM
//     above the probe along the edge triangle's normal (the car's up there), lengthM long, downward; a hit on any other
//     road triangle is road beyond the gap. (A first form took "any triangle within 0.3 m that the probe lies over", and
//     it read the vertical zip triangles of a seam between two fonts, which stand in the cross-section plane, as road
//     0.1 m beyond a wall's end. A ray parallel to such a triangle never hits it, as the car's never would.)
//   · a triangle whose normal lies within 45° of the road's direction at its nearest station FACES ALONG the road (a
//     seam's zip fan between two fonts, standing in the cross-section plane): the car cannot ride it and its ray cannot
//     read it, so it is neither a gap's edge nor road beyond one. (Found on the first sample loop: the lap's closing seam
//     zips a bowl's walls down to a flat first word in that plane, and the fan's own rim read as 0.1 m gaps.)
//   · so the road's own outer edge, a jump's lip and its landing (no road within 1 m beyond them) are not gaps, and a
//     slit between two pieces, a missing triangle or a pit lane that stops short of the road are.
// Each gap is reported at the nearest path station: { s, u, widthM, at } (widthM: the first probe distance that found
// road, an upper bound on the gap's width at that edge; at: the edge's midpoint in world space).
'use strict';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : a; };
const PROBES = [0.1, 0.25, 0.5];   // plus the ray's reach, from the car's limits
const FACING = Math.cos(45 * Math.PI / 180);

/**
 * rayGaps(meshes, stations, ray): meshes = [{ positions (world, flat), indices }] of the drivable physics road;
 * stations = the path's samples ({ s, pos, L, T }); ray = MACH6.downforceRay. Returns [{ s, u, widthM, at }], one per gap
 * edge, in s order.
 */
function rayGaps(meshes, stations, ray) {
  const V = new Map(), P = [], T = [];
  const WELD = 0.005, vk = (a, b, c) => `${a},${b},${c}`;
  const vid = (x, y, z) => {
    const bx = Math.floor(x / WELD), by = Math.floor(y / WELD), bz = Math.floor(z / WELD);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const id of V.get(vk(bx + i, by + j, bz + k)) || []) { const q = P[id]; if (Math.hypot(q[0] - x, q[1] - y, q[2] - z) <= WELD) return id; }
    }
    const id = P.length; P.push([x, y, z]); const key = vk(bx, by, bz); let c = V.get(key); if (!c) V.set(key, c = []); c.push(id); return id;
  };
  for (const m of meshes) {
    const p = m.positions, idx = m.indices;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = vid(p[idx[t] * 3], p[idx[t] * 3 + 1], p[idx[t] * 3 + 2]), b = vid(p[idx[t + 1] * 3], p[idx[t + 1] * 3 + 1], p[idx[t + 1] * 3 + 2]), c = vid(p[idx[t + 2] * 3], p[idx[t + 2] * 3 + 1], p[idx[t + 2] * 3 + 2]);
      if (a === b || b === c || a === c) continue;   // degenerate after the weld
      T.push([a, b, c]);
    }
  }
  const E = new Map(), ek = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  T.forEach((t, i) => { for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const k = ek(a, b), e = E.get(k); if (e) e.n++; else E.set(k, { a, b, tri: i, n: 1 }); } });
  // a grid of triangles, for the probes
  const CS = 2, grid = new Map(), gk = (x, y, z) => `${x},${y},${z}`;
  const N = T.map((t) => unit(cross(sub(P[t[1]], P[t[0]]), sub(P[t[2]], P[t[0]]))));
  T.forEach((t, i) => {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(P[t[0]][k], P[t[1]][k], P[t[2]][k]) / CS)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(P[t[0]][k], P[t[1]][k], P[t[2]][k]) / CS));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = gk(x, y, z); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(i); }
  });
  /** Does the car's ray at q (cast from upM above q along up, lengthM downward) hit a road triangle other than skip? */
  const overRoad = (q, up, skip, along) => {
    const o = add(q, up, ray.upM), d = up.map((x) => -x), L = ray.lengthM, seen = new Set();
    for (let k = 0; k <= Math.ceil(L / CS) + 1; k++) {
      const c0 = add(o, d, Math.min(L, k * CS)).map((v) => Math.floor(v / CS));
      for (let x = c0[0] - 1; x <= c0[0] + 1; x++) for (let y = c0[1] - 1; y <= c0[1] + 1; y++) for (let z = c0[2] - 1; z <= c0[2] + 1; z++) {
        for (const i of grid.get(gk(x, y, z)) || []) {
          if (i === skip || seen.has(i)) continue; seen.add(i);
          if (Math.abs(dot(N[i], along)) > FACING) continue;   // faces along the road: not a surface the ray reads
          const t = T[i], e1 = sub(P[t[1]], P[t[0]]), e2 = sub(P[t[2]], P[t[0]]), pv = cross(d, e2), det = dot(e1, pv);
          if (Math.abs(det) < 1e-12) continue;   // the ray runs along the triangle: no hit
          const inv = 1 / det, tv = sub(o, P[t[0]]), u = dot(tv, pv) * inv; if (u < 0 || u > 1) continue;
          const qv = cross(tv, e1), v = dot(d, qv) * inv; if (v < 0 || u + v > 1) continue;
          const h = dot(e2, qv) * inv; if (h > 0 && h <= L) return true;
        }
      }
    }
    return false;
  };
  const reach = [...PROBES, ray.aheadM];
  // the nearest station, by a coarse grid on the stations
  const SC = 20, sg = new Map(); stations.forEach((st, i) => { const k = `${Math.floor(st.pos[0] / SC)},${Math.floor(st.pos[2] / SC)}`; let c = sg.get(k); if (!c) sg.set(k, c = []); c.push(i); });
  const nearest = (q) => { let best = -1, bd = Infinity; const cx = Math.floor(q[0] / SC), cz = Math.floor(q[2] / SC);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const i of sg.get(`${cx + dx},${cz + dz}`) || []) { const d = len(sub(stations[i].pos, q)); if (d < bd) { bd = d; best = i; } }
    return best; };
  const out = [];
  for (const e of E.values()) {
    if (e.n !== 1) continue;
    const t = T[e.tri], A = P[e.a], B = P[e.b], C = P[t.find((v) => v !== e.a && v !== e.b)], mid = add(A, sub(B, A), 0.5);
    const i = nearest(mid), st = i >= 0 ? stations[i] : null;
    if (!st || Math.abs(dot(N[e.tri], st.T)) > FACING) continue;   // not a surface the car rides (see above)
    let across = unit(cross(N[e.tri], sub(B, A))); if (dot(sub(C, mid), across) > 0) across = across.map((x) => -x);   // away from its own triangle
    const w = reach.find((d) => overRoad(add(mid, across, d), N[e.tri], e.tri, st.T));
    if (w === undefined) continue;
    out.push({ s: st.s, u: dot(sub(mid, st.pos), st.L), widthM: w, at: mid });
  }
  return out.sort((a, b) => a.s - b.s);
}

module.exports = { rayGaps, PROBES };
