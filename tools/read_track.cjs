// read_track.cjs: READ a track as a text. Starting at the grid (AC_START_0), walk forward along the drivable surface,
// re-centring between the road's edges every step, and record the cross-section every STEP metres: width, how the
// tilt runs from edge to edge, the turn (curvature) and the grade. Then name each station with a readable word from a
// small vocabulary (cross-section shape × turn × slope) and run-length encode the lap into a sequence of words.
//   node read_track.cjs <track folder> [layout-length-m] > <name>.read.json
// Works on meshes alone: no replay, no AI line. Walls, inversions and banking are followed by keeping each normal
// continuous with the last, not by assuming "up".
const fs = require('fs'), path = require('path'); const { readKn5 } = require('./kn5.cjs');
const dir = process.argv[2], lengthHint = +(process.argv[3] || 0), widthHint = +(process.argv[4] || 0), STEP = 4;
function validKeys(d) { const keys = new Set(['ROAD']); const files = [];
  (function walk(x) { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase() === 'surfaces.ini') files.push(p); } })(d);
  for (const f of files) { let key = null; for (const line of fs.readFileSync(f, 'latin1').split(/\r?\n/)) { const k = line.match(/^\s*KEY\s*=\s*([^\s;]+)/i); if (k) key = k[1].toUpperCase(); if (/^\s*IS_VALID_TRACK\s*=\s*1/i.test(line) && key && !/PIT/i.test(key)) keys.add(key.replace(/^\d+/, '').replace(/\?$/, '')); } }
  return keys; }
const keys = validKeys(dir), T = [], dummies = [];
// Names are the author's: on Serpents Spiral "underside" is a flipped safety skin under the road (skip it), on
// Thunderhead "1ROAD_Underside" IS the road. So skip underside-named meshes only when they are a minority of the road.
const roadMeshes = [];
// a folder can hold several layouts; models_<layout>.ini lists which models belong to each (5th argument = layout)
const layout = process.argv[5]; let kn5List = fs.readdirSync(dir).filter(f => /\.kn5$/i.test(f));
if (layout) { const mi = path.join(dir, 'models_' + layout + '.ini'); if (!fs.existsSync(mi)) throw new Error('no ' + mi);
  kn5List = [...fs.readFileSync(mi, 'latin1').matchAll(/^\s*FILE\s*=\s*(.+?)\s*$/gim)].map(m => m[1]); }
for (const f of kn5List) {
  const k = readKn5(path.join(dir, f)); dummies.push(...k.dummies);
  for (const m of k.meshes) { const nm = m.name.toUpperCase().match(/^\d+([A-Z_]+)/); if (!nm || /PIT/.test(m.name.toUpperCase())) continue; if (![...keys].some(K => nm[1].startsWith(K))) continue; roadMeshes.push(m); }
}
const isUnder = m => /UNDERSIDE|UNDER_SIDE|BOTTOM/.test(m.name.toUpperCase());
const underTris = roadMeshes.filter(isUnder).reduce((a, m) => a + m.idx.length / 3, 0), allTris = roadMeshes.reduce((a, m) => a + m.idx.length / 3, 0);
const keepUnder = underTris > allTris * .6;
for (const m of roadMeshes) { if (isUnder(m) && !keepUnder) continue;
  for (let i = 0; i < m.idx.length; i += 3) { const t = []; for (const j of [m.idx[i], m.idx[i + 1], m.idx[i + 2]]) t.push(m.pos[j * 3], m.pos[j * 3 + 1], m.pos[j * 3 + 2]); T.push(t); } }
const start = dummies.find(d => /^AC_START_0$/i.test(d.name)) || dummies.find(d => /START/i.test(d.name));
if (!start) throw new Error('no AC_START marker');
// geometry
const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], add = (u, v, s = 1) => [u[0] + v[0] * s, u[1] + v[1] * s, u[2] + v[2] * s], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = u => Math.hypot(...u), unit = u => { const l = len(u) || 1; return u.map(x => x / l); };
const N = T.map(t => unit(cross(sub(t.slice(3, 6), t.slice(0, 3)), sub(t.slice(6, 9), t.slice(0, 3)))));
const CS = 4, grid = new Map();
T.forEach((t, i) => { const lo = [0, 1, 2].map(k => Math.floor(Math.min(t[k], t[k + 3], t[k + 6]) / CS)), hi = [0, 1, 2].map(k => Math.floor(Math.max(t[k], t[k + 3], t[k + 6]) / CS));
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const key = `${x},${y},${z}`; let c = grid.get(key); if (!c) grid.set(key, c = []); c.push(i); } });
function closest(p, t) { const a = t.slice(0, 3), b = t.slice(3, 6), c = t.slice(6, 9), ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b; const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c; const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const den = 1 / (va + vb + vc); return [a[0] + ab[0] * vb * den + ac[0] * vc * den, a[1] + ab[1] * vb * den + ac[1] * vc * den, a[2] + ab[2] * vb * den + ac[2] * vc * den]; }
function onSurface(p, maxD = 2.5, refN = null, maxTurn = 0) { const cosT = maxTurn ? Math.cos(maxTurn * Math.PI / 180) : -2; const r = Math.ceil(maxD / CS), c0 = p.map(v => Math.floor(v / CS)); let best = null, bd = maxD;
  for (let x = c0[0] - r; x <= c0[0] + r; x++) for (let y = c0[1] - r; y <= c0[1] + r; y++) for (let z = c0[2] - r; z <= c0[2] + r; z++) { const cell = grid.get(`${x},${y},${z}`); if (!cell) continue;
    for (const i of cell) { if (refN && Math.abs(dot(N[i], refN)) < cosT) continue; const q = closest(p, T[i]), d = len(sub(q, p)); if (d < bd) { bd = d; best = { q, i }; } } }
  if (!best) return null; let n = N[best.i]; if (refN && dot(n, refN) < 0) n = n.map(v => -v); return { q: best.q, n }; }
// tilt of a surface normal relative to the ROAD'S local "up" at the centre (so a whole section tipped onto a wall still
// reads its own floor as flat and its own walls as rising): angle between the normal and the centre normal
const rel = (n, n0) => Math.acos(Math.max(-1, Math.min(1, dot(n, n0)))) * 180 / Math.PI;
function crossSection(p, n0, f) {
  const side = dir => { const out = []; let q = p, n = n0;
    for (let k = 0; k < 70; k++) { const L = unit(cross(f, n)).map(v => v * dir); const hit = onSurface(add(q, L), 2.5, n, 35); if (!hit || len(sub(hit.q, q)) < .5) break;
      if (rel(hit.n, n) > 35) break;   // a fold this sharp in one metre is an edge (the lip onto the underside skin), not road
      q = hit.q; n = hit.n; out.push({ q, n }); }
    return out; };
  const left = side(1), right = side(-1);
  return { left, right };
}
// walk
let s0 = onSurface(start.pos, 8, [0, 1, 0]);
// the grid can sit on pit concrete (not read as road) next to narrow strips: start at the nearest spot within 80 m whose
// cross-section is at least 60% of the stated width, so the walk begins on the racing road itself
if (widthHint) {
  const w0 = s0 ? (() => { const c = crossSection(s0.q, s0.n, unit(start.fwd)); return c.left.length + c.right.length + 1; })() : 0;
  if (w0 < widthHint * .6) { let best = null;
    for (let r = 5; r <= 80 && !best; r += 5) for (let a = 0; a < 360; a += 15) {
      const q = [start.pos[0] + r * Math.cos(a * Math.PI / 180), start.pos[1], start.pos[2] + r * Math.sin(a * Math.PI / 180)], h = onSurface(q, 10, [0, 1, 0]);
      if (!h) continue; const c = crossSection(h.q, h.n, unit(start.fwd)), w = c.left.length + c.right.length + 1;
      if (w >= widthHint * .6 && w <= widthHint * 1.6) { best = h; break; } }
    if (best) s0 = best; }
}
if (!s0) throw new Error('start marker not on the road');
// direction of the race: from grid slot 1 toward pole (slot 0) — the grid order holds for every author, where the
// marker's own forward axis does not (Coast's points backwards)
// the grid's LAST slot is at the back whatever the grid's width (Aurora's is three abreast, so slot 1 is beside pole)
const slots = dummies.filter(d => /^AC_START_\d+$/i.test(d.name)).sort((p, q) => +q.name.split('_')[2] - +p.name.split('_')[2]), slotBack = slots[0];
let fwd0 = unit(start.fwd);
if (slotBack && slotBack !== start) { const g = unit([start.pos[0] - slotBack.pos[0], 0, start.pos[2] - slotBack.pos[2]]), dd = dot(g, unit([fwd0[0], 0, fwd0[2]])); if (dd < -0.5) fwd0 = fwd0.map(v => -v); }   // overrule the marker only on a clear disagreement
let p = s0.q, n = s0.n, f = fwd0, travelled = 0; const rows = [];
const maxLen = (lengthHint || 60000) * 1.15;
for (let step = 0, wallUp = false; travelled < maxLen; step++) { wallUp = false;
  f = unit(sub(f, n.map(v => v * dot(f, n))));
  // aim along the ROAD, not along momentum: when both edges are found, the road runs perpendicular to the edge-to-edge
  // line. Two passes so the heading settles; walking straight on a banked curve would otherwise climb its outer wall.
  let cs = crossSection(p, n, f);
  const W_ = c => c.left.length + c.right.length + 1;
  const recent = rows.filter(r => r.width && !r.junction).slice(-25).map(r => r.width).sort((a, b) => a - b), usual = Math.max(recent.length ? recent[Math.floor(recent.length / 2)] : W_(cs), widthHint);
  // the true cross-section is the NARROWEST cut: if this one reads much wider than the road has been, the heading lags
  // a turn, so search headings within ±40° (rotating about the road normal) and keep the narrowest
  if ((rows.length > 10 || widthHint) && W_(cs) > usual * 1.3 + 4) {
    const rot = (v, a) => { const c = Math.cos(a), s = Math.sin(a), k = n; return add(add(v.map(x => x * c), cross(k, v).map(x => x * s)), k, dot(k, v) * (1 - c)); };
    let best = { f, cs, w: W_(cs) };
    for (const deg of [-40, -32, -24, -16, -8, 8, 16, 24, 32, 40]) { const ft = unit(rot(f, deg * Math.PI / 180)), ct = crossSection(p, n, ft), w = W_(ct); if (w < best.w) best = { f: ft, cs: ct, w }; }
    f = best.f; cs = best.cs;
  }
  // settle the heading on the edge-to-edge perpendicular (two passes)
  for (let pass = 0; pass < 2; pass++) {
    if (!cs.left.length || !cs.right.length || cs.left.length >= 70 || cs.right.length >= 70) break;
    const E = unit(sub(cs.left[cs.left.length - 1].q, cs.right[cs.right.length - 1].q));
    let fp = unit(cross(E, n)); if (dot(fp, f) < 0) fp = fp.map(v => -v);
    const ct = crossSection(p, n, unit(add(f.map(v => v * .2), fp, .8))); if (W_(ct) <= W_(cs) + 1) { f = unit(add(f.map(v => v * .2), fp, .8)); cs = ct; }
  }
  const wl = cs.left.length, wr = cs.right.length, width = wl + wr + 1;
  // only if even the narrowest cut is far too wide is it a real junction (a merge or split): hold the line through it
  const junction = rows.length > 10 && width > usual * 1.6 + 8;
  // re-centre: move to the middle of the cross-section
  const pts = [...cs.left.slice().reverse(), { q: p, n }, ...cs.right], mid = junction ? { q: p, n } : pts[Math.floor(pts.length / 2)];
  const c = mid.q, nc = mid.n;
  if (junction) f = rows.length ? unit(sub(f, nc.map(v => v * dot(f, nc)))) : f;
  const tl = cs.left.map(x => rel(x.n, nc)), tr = cs.right.map(x => rel(x.n, nc));
  rows.push({ d: Math.round(travelled), junction: junction || undefined, c: c.map(v => +v.toFixed(1)), up: +(Math.acos(Math.max(-1, Math.min(1, nc[1]))) * 180 / Math.PI).toFixed(1), width,
    edgeL: tl.length ? +Math.max(...tl).toFixed(1) : 0, edgeR: tr.length ? +Math.max(...tr).toFixed(1) : 0, f: f.map(v => +v.toFixed(4)), n: nc.map(v => +v.toFixed(4)) });
  let next = onSurface(add(c, f, STEP), 3, nc, 40);
  // the road curling up in front (floor into a wall-ride, a quarter-pipe): a CONCAVE fold ahead, facing back at us,
  // followed in short steps even when it folds far more than a plain seam would
  if (!next || rel(next.n, nc) > 45) for (const st of [1, 1.5, 2, 3]) {
    const h = onSurface(add(c, f, st), 2, nc, 75); if (!h) continue;
    const concave = dot(h.n, f) < -0.05 && rel(h.n, nc) > 10;
    if (concave && len(sub(h.q, c)) > .5) { next = h; wallUp = true; break; } }
  if (!wallUp && (!next || rel(next.n, nc) > 45)) {
    // the road ends ahead: look across the gap (a JUMP on these tracks) for where it resumes — along the heading, up to
    // 250 m out, anywhere from 60 m below to 30 m above the take-off line
    let land = null, seam = false;
    // aim across a gap along the road's direction over the last ~40 m, not the heading at the lip: ramps taper to
    // narrow tips, and a cross-section across a narrow tip points the wrong way (Coast: 28° off)
    { const back = rows.filter(r => r.c && !r.jump).slice(-11, -1); if (back.length >= 8) { const g = unit(sub(c, back[0].c)); if (dot(g, f) > 0.5) f = g; } }
    // (a) a seam between road pieces: a short gap at almost the same height and angle — bridge it quietly
    for (let dist = 5; dist <= 24 && !land; dist += 1) for (const dh of [0, 1, -1, 2, -2]) {
      const probe = add(add(c, f, dist), nc, dh), hit = onSurface(probe, 2, nc, 25);
      if (hit) { land = { hit, dist, dh }; seam = true; break; }
    }
    // (a2) the road carries on offset to one side (a wide bowl narrowing back to the normal road, a step at its end):
    // look a little left and right before calling it a jump
    const Lat = unit(cross(f, nc));
    for (let dist = 4; dist <= 16 && !land; dist += 4) for (const side of [8, -8, 16, -16, 24, -24, 32, -32, 40, -40]) {
      const probe = add(add(c, f, dist), Lat, side), hit = onSurface(probe, 2.5, nc, 30);
      if (hit) { land = { hit, dist, dh: 0 }; seam = true; break; }
    }
    // (b) a real jump: the landing must be the SAME road carrying on — angled like the take-off (within 35°), and
    // running along the heading (longer along it than across it); a road crossing above or below fails that
    const runsAlong = (hit) => { const across = crossSection(hit.q, hit.n, f), along = crossSection(hit.q, hit.n, unit(cross(hit.n, f)));
      if (along.left.length + along.right.length <= across.left.length + across.right.length) return false;
      // a landing is where a road BEGINS after the gap: road ahead of it, almost none behind it. A road that only passes
      // underneath (or runs the other way) carries on behind the landing point too — that is a fall, not a jump.
      const ahead = along.left.length, behind = along.right.length; return ahead >= 20 && behind < 15; };
    // (sweeping sideways too: the ramps taper to narrow tips, and a heading skewed by a few degrees misses a 5 m tip)
    for (let dist = 25; dist <= 400 && !land; dist += 4) for (const side of [0, 4, -4, 8, -8, 12, -12, 16, -16]) for (let dh = 40; dh >= -100 && !land; dh -= 3) {
      const probe = add(add(add(c, f, dist), [0, 1, 0], dh), Lat, side), hit = onSurface(probe, 3, nc, 35);
      if (hit && len(sub(hit.q, probe)) < 3 && runsAlong(hit)) land = { hit, dist, dh };
    }
    if (!land && process.env.DEBUGJUMP) { const seen = []; for (let dist = 25; dist <= 400; dist += 8) for (let dh = 40; dh >= -100; dh -= 4) { const probe = add(add(c, f, dist), [0, 1, 0], dh), hit = onSurface(probe, 3, null); if (!hit) continue; const hn = dot(hit.n, nc) < 0 ? hit.n.map(v => -v) : hit.n; seen.push({ dist, dh, angle: +rel(hn, nc).toFixed(0), along: runsAlong({ q: hit.q, n: hn }) }); if (seen.length > 25) break; } console.error('JUMP CANDIDATES', JSON.stringify(seen.slice(0, 25))); }
    if (!land) { const raw = onSurface(add(c, f, STEP), 12, null); const why = raw ? { ahead_m: +len(sub(raw.q, add(c, f, STEP))).toFixed(1), rise_m: +(raw.q[1] - c[1]).toFixed(1), angle_deg: +rel(raw.n[1] * nc[1] < 0 ? raw.n.map(v => -v) : raw.n, nc).toFixed(0) } : 'no surface within 12 m'; rows.push({ lost: true, d: Math.round(travelled), at: c.map(v => +v.toFixed(1)), f: f.map(v => +v.toFixed(3)), why }); break; }
    if (!seam) rows.push({ jump: true, d: Math.round(travelled), gap_m: land.dist, drop_m: -land.dh, from: c.map(v => +v.toFixed(1)), to: land.hit.q.map(v => +v.toFixed(1)) });
    next = land.hit;
  }
  const nf = unit(sub(next.q, c)); if (!junction) f = unit(add(f.map(v => v * .5), nf, .5)); p = next.q; n = next.n; travelled += len(sub(next.q, c));
  if (travelled > 800 && len(sub(p, s0.q)) < 30) { rows.push({ closed: true, d: Math.round(travelled) }); break; }
}
// curvature (turn) and grade per station, in the road's own plane
// measured on the centreline itself, smoothed over ±5 stations (±20 m) and read over a ±5-station (≈40 m) baseline:
// each station's centre wobbles a metre or two sideways, which over a short baseline reads as a hairpin. (The heading
// is not used: after a sideways catch it can lag the road.)
{ const S = rows.map((r, i) => r.c && r.n ? i : -1).filter(i => i >= 0), W5 = 5, B = 5;
  const sm = S.map((_, j) => { const lo = Math.max(0, j - W5), hi = Math.min(S.length - 1, j + W5), acc = [0, 0, 0]; for (let m = lo; m <= hi; m++) for (let k = 0; k < 3; k++) acc[k] += rows[S[m]].c[k]; return acc.map(v => v / (hi - lo + 1)); });
  for (let j = B; j < S.length - B; j++) { const n0 = rows[S[j]].n, proj = v => { const d = dot(v, n0); return v.map((x, k) => x - n0[k] * d); };
    const u = proj(sub(sm[j], sm[j - B])), w = proj(sub(sm[j + B], sm[j])), ds = (len(u) + len(w)) / 2 || 1;
    rows[S[j]].k = +(Math.atan2(dot(cross(u, w), n0), dot(u, w)) / ds).toFixed(5);
    rows[S[j]].grade = +(100 * (sm[j + B][1] - sm[j - B][1]) / (2 * ds)).toFixed(1); } }
// words: cross-section shape x turn x slope
function word(r) {
  if (r.jump) return `JUMP(${r.gap_m}m gap, ${r.drop_m > 0 ? r.drop_m + "m drop" : -r.drop_m + "m up"})`;
  if (r.lost || r.closed || r.k == null) return null;
  const e1 = Math.min(r.edgeL, r.edgeR), e2 = Math.max(r.edgeL, r.edgeR);
  const shape = e2 < 12 ? 'flat' : e1 > 25 ? (e2 > 70 ? 'pipe+' : 'pipe') : (e2 > 70 ? 'bowl+' : 'bowl');
  const R = Math.abs(r.k) > 1e-6 ? 1 / Math.abs(r.k) : Infinity, dirn = r.k > 0 ? 'L' : 'R';
  const turn = R > 1500 ? 'straight' : R > 500 ? 'sweep' + dirn : R > 180 ? 'turn' + dirn : 'tight' + dirn;
  const slope = r.grade > 6 ? '/up' : r.grade < -6 ? '/down' : '';
  const roll = r.up > 60 ? (r.up > 110 ? '^inv' : '^wall') : '';
  return `${shape}-${turn}${slope}${roll}`;
}
const words = []; for (const r of rows) { const w = word(r); if (!w) continue; const last = words[words.length - 1]; if (last && last.w === w) { last.to = r.d; last.n++; } else words.push({ w, from: r.d, to: r.d, n: 1 }); }
// merge words shorter than 3 stations (12 m) into their neighbour, so the text is not noise
const text = []; for (const w of words) { const last = text[text.length - 1]; if (w.n < 3 && last && !/^JUMP/.test(w.w) && !/^JUMP/.test(last.w)) { last.to = w.to; last.n += w.n; continue; } if (last && last.w === w.w) { last.to = w.to; last.n += w.n; } else text.push({ ...w }); }
const end = rows[rows.length - 1];
console.error(`${path.basename(dir)}: ${rows.length} stations, ${Math.round(travelled)} m walked, ${end.closed ? 'CLOSED the lap' : end.lost ? 'LOST the road at ' + end.d + ' m' : 'stopped at the length limit'}; ${text.length} words`);
console.log(JSON.stringify({ track: path.basename(dir), start: start.name, walked_m: Math.round(travelled), end: end.closed ? 'closed' : end.lost ? 'lost' : 'limit', stations: rows, text }, null, 0));
