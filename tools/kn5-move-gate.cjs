// kn5-move-gate.cjs: moves a sector gate (AC_TIME_n_L / _R) of an EXISTING kn5 onto the nearest flat road, by rewriting the
// two dummies' 16-float matrices in place; every other byte of the file stays as it was (D567, the keeper 2026-10-30: "i only
// see sector one being complete"; ELYSIUM's AC_TIME_2 stood on an 85° bank, 30.2 m apart vertically and 3.45 m top-down).
// For a track already exported and raced, so it can be lapped on the exact road it has; a new export places its gates itself
// (src/markers/layout.js lapSectors).
//
//   moveGate(kn5Buffer, stations, { gate, nearS, closed }) -> { buf, station, from, to, placed, checks, widthTopDownM, tiltLRDeg }
//     stations: the AI line's points in order, { s, pos, fwd, n } (n the road's normal there; see readStations).
//     The search runs outward from nearS in both directions, up to a quarter of the line, and takes the first station where
//     the road's camber is at most 15° (layout.js FLOOR_MAX_DEG) and its climb at most 20°, the gate laid across it from edge
//     to edge less gateInsetM is within 15° of level, and the markers checks (src/markers/checks.js: gate-orientation,
//     height-and-heading, slots) pass on the gate as it reads back from the written bytes. None: NO_FLAT_STATION.
//   THE ROAD is every physics mesh <digit><KEY>, KEY not WALL (src/export/markers.js isDrivable); its edges are found by
//   short rays down the station's normal, stepped across (as tools/piecewise.cjs walks a cross-section).
//   THE GATE stands as src/markers/place.js placeMarker stands a marker: up = the surface normal under it, forward = the
//   road's tangent with the normal part removed, left = up × forward, height layout.js DEFAULTS.height above the surface.
//
//   node tools/kn5-move-gate.cjs <track folder> <new folder> --near <s> [--gate 2] [--max-tilt 15] [--name "<display name>"] [--open]
//     Copies every file of <track folder> into <new folder> (which must not exist), with the patched kn5 and ui_track.json's
//     name changed so the copy shows as its own track. Reads nothing else and never writes into <track folder>.
'use strict';
const fs = require('fs'), path = require('path');
const { DEFAULTS, FLOOR_MAX_DEG } = require('../src/markers/layout.js');
const { checkPlaced } = require('../src/markers/checks.js');
const { readAiLine } = require('../src/export/ailine.js');

const MAX_CLIMB_DEG = 20, GATE_CHECKS = ['gate-orientation', 'height-and-heading', 'slots'];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? mul(a, 1 / l) : [0, 0, 0]; };
const deg = (r) => r * 180 / Math.PI;
const fail = (code, msg) => Object.assign(new Error(`kn5-move-gate: ${msg}`), { code });
const isDrivable = (name) => { const m = /^\d+([A-Za-z_]+)/.exec(name || ''); return !!m && !/^WALL/i.test(m[1]); };
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul4 = (a, m) => { const r = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * m[k * 4 + j]; r[i * 4 + j] = s; } return r; };

/** Walk the kn5's node tree as tools/kn5.cjs does: every dummy with its matrix's byte offset and its parent's world matrix,
 *  and every drivable mesh's triangles in world space. Throws on anything kn5.cjs would. */
function walk(b) {
  let o = 0;
  const i32 = () => { const v = b.readInt32LE(o); o += 4; return v; }, u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; }, u8 = () => b[o++];
  const str = () => { const n = i32(); if (n < 0 || n > 1e6) throw fail('BAD_KN5', `bad string length ${n} at ${o - 4}`); const s = b.toString('utf8', o, o + n); o += n; return s; };
  if (b.toString('latin1', 0, 6) !== 'sc6969') throw fail('BAD_KN5', 'not a kn5 (no sc6969 magic)');
  o = 6; const version = u32(); if (version > 5) u32();
  const nTex = i32(); for (let k = 0; k < nTex; k++) { i32(); str(); const size = i32(); o += size; }
  const nMat = i32();
  for (let k = 0; k < nMat; k++) { str(); str(); u8(); u8(); i32(); const nProp = i32(); for (let p = 0; p < nProp; p++) { str(); o += 40; } const nSamp = i32(); for (let p = 0; p < nSamp; p++) { str(); i32(); str(); } }
  const dummies = [], tris = [];
  function node(parent) {
    const cls = i32(), name = str(), nChild = i32(); u8();
    let M = parent;
    if (cls === 1) {
      const offset = o, m = []; for (let k = 0; k < 16; k++) { m.push(b.readFloatLE(o)); o += 4; }
      M = mul4(m, parent); dummies.push({ name, offset, local: m, parent, world: M });
    } else if (cls === 2) {
      o += 3; const nv = u32(), P = new Float64Array(nv * 3);
      for (let v = 0; v < nv; v++) {
        const x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8); o += 44;
        P[v * 3] = x * M[0] + y * M[4] + z * M[8] + M[12]; P[v * 3 + 1] = x * M[1] + y * M[5] + z * M[9] + M[13]; P[v * 3 + 2] = x * M[2] + y * M[6] + z * M[10] + M[14];
      }
      const ni = u32(), idx = new Array(ni); for (let k = 0; k < ni; k++) { idx[k] = b.readUInt16LE(o); o += 2; }
      o += 4 + 4 + 4 + 4 + 16 + 1;
      if (isDrivable(name)) for (let k = 0; k < ni; k += 3) tris.push([idx[k], idx[k + 1], idx[k + 2]].map((q) => [P[q * 3], P[q * 3 + 1], P[q * 3 + 2]]));
    } else throw fail('BAD_KN5', `node class ${cls} (${name}) not supported at ${o}`);
    for (let c = 0; c < nChild; c++) node(M);
  }
  node(IDENT);
  if (o !== b.length) throw fail('BAD_KN5', `${b.length - o} bytes left after the node tree`);
  return { dummies, tris };
}
const locateDummies = (buf) => walk(buf).dummies.map(({ name, offset, local, parent }) => ({ name, offset, local, parent }));

/** The drivable triangles in 16 m cells, and a ray against them (Möller–Trumbore): the nearest hit along d within maxT. */
function rayIndex(tris) {
  const C = 16, cells = new Map(), key = (i, j, k) => `${i},${j},${k}`;
  tris.forEach((t, n) => {
    const lo = [0, 1, 2].map((a) => Math.floor(Math.min(t[0][a], t[1][a], t[2][a]) / C)), hi = [0, 1, 2].map((a) => Math.floor(Math.max(t[0][a], t[1][a], t[2][a]) / C));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const q = key(i, j, k); if (!cells.has(q)) cells.set(q, []); cells.get(q).push(n); }
  });
  return (o, d, maxT) => {
    const e = add(o, mul(d, maxT)), lo = [0, 1, 2].map((a) => Math.floor(Math.min(o[a], e[a]) / C)), hi = [0, 1, 2].map((a) => Math.floor(Math.max(o[a], e[a]) / C));
    let best = null; const seen = new Set();
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) for (const n of cells.get(key(i, j, k)) || []) {
      if (seen.has(n)) continue; seen.add(n);
      const [a, b, c] = tris[n], e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
      if (Math.abs(det) < 1e-12) continue;
      const iv = 1 / det, tv = sub(o, a), u = dot(tv, p) * iv; if (u < 0 || u > 1) continue;
      const q = cross(tv, e1), v = dot(d, q) * iv; if (v < 0 || u + v > 1) continue;
      const t = dot(e2, q) * iv;
      if (t >= 0 && t <= maxT && (!best || t < best.t)) best = { t, p: add(o, mul(d, t)), n: unit(cross(e1, e2)) };
    }
    return best;
  };
}

/** The road under a point: a ray down -n from 8 m above it, 16 m long (a banked or cupped edge rises up to 8 m over the centre's plane and is still found); its normal turned to the n side. */
const UNDER_FROM_M = 8;
const under = (ray, p, n) => { const h = ray(add(p, mul(n, UNDER_FROM_M)), mul(n, -1), 2 * UNDER_FROM_M); if (h && dot(h.n, n) < 0) h.n = mul(h.n, -1); return h; };

/** The road's two edges at a station: the last hit of rays stepped across from the centre, each side (u, + is left). */
function edges(ray, P, n, lat) {
  const one = (side) => { let last = null; for (let q = 0; q <= 60; q += 0.02) { if (under(ray, add(P, mul(lat, side * q)), n)) last = q; else if (last !== null && q > last + 0.5) break; else if (last === null && q > 0.5) break; } return last; };
  return { left: one(1), right: one(-1) };
}

/** A marker as place.js stands it, as kn5's 16 floats (rows left, up, forward, position). */
function standAt(hit, T, h) {
  const up = hit.n, fwd = unit(sub(T, mul(up, dot(T, up)))), left = cross(up, fwd), pos = add(hit.p, mul(up, h));
  return [...left, 0, ...up, 0, ...fwd, 0, ...pos, 1].map(Math.fround);
}

function moveGate(src, stations, { gate = 2, nearS, closed = true, heightM = DEFAULTS.height, insetM = DEFAULTS.gateInsetM, maxTiltDeg = FLOOR_MAX_DEG, maxClimbDeg = MAX_CLIMB_DEG, reachM } = {}) {
  if (!Buffer.isBuffer(src)) throw fail('BAD_INPUT', 'the kn5 must be a Buffer');
  if (!Array.isArray(stations) || stations.length < 2) throw fail('BAD_INPUT', 'at least two AI stations are needed');
  if (!Number.isFinite(nearS)) throw fail('BAD_INPUT', 'nearS must be a number');
  const { dummies, tris } = walk(src);
  const names = [`AC_TIME_${gate}_L`, `AC_TIME_${gate}_R`], found = names.map((nm) => dummies.filter((d) => d.name === nm));
  found.forEach((f, k) => { if (f.length !== 1) throw fail('NO_GATE', `${names[k]}: ${f.length} dummies of that name, not 1`); });
  const [dL, dR] = found.map((f) => f[0]);
  for (const d of [dL, dR]) if (d.parent.some((x, k) => x !== IDENT[k])) throw fail('PARENT_NOT_IDENTITY', `${d.name}'s parent is not the identity, so a world matrix cannot be written as its local one`);
  if (!tris.length) throw fail('NO_ROAD', 'no drivable mesh');
  const ray = rayIndex(tris);
  const s0 = stations[0].s, lap = stations[stations.length - 1].s - s0, reach = reachM != null ? reachM : lap / 4;
  const dist = (s) => { const d = Math.abs(s - nearS); return closed ? Math.min(d, lap - d) : d; };
  const order = stations.map((st, k) => ({ k, d: dist(st.s) })).filter((x) => x.d <= reach).sort((a, b) => a.d - b.d || a.k - b.k);
  const UP = [0, 1, 0];
  for (const { k } of order) {
    const st = stations[k], n = unit(st.n), T = unit(st.fwd);
    const camberDeg = deg(Math.acos(Math.min(1, dot(n, UP)))), climbDeg = deg(Math.asin(Math.min(1, Math.abs(T[1]))));
    if (!(camberDeg <= maxTiltDeg && climbDeg <= maxClimbDeg)) continue;
    const lat = unit(cross(n, T)), ed = edges(ray, st.pos, n, lat);
    if (ed.left === null || ed.right === null || ed.left <= insetM || ed.right <= insetM) continue;
    const hL = under(ray, add(st.pos, mul(lat, ed.left - insetM)), n), hR = under(ray, add(st.pos, mul(lat, -(ed.right - insetM))), n);
    if (!hL || !hR) continue;
    const mL = standAt(hL, T, heightM), mR = standAt(hR, T, heightM);
    const pL = mL.slice(12, 15), pR = mR.slice(12, 15), lr = sub(pL, pR);
    const tiltLRDeg = deg(Math.asin(Math.min(1, Math.abs(lr[1]) / Math.hypot(...lr))));
    if (!(tiltLRDeg <= maxTiltDeg)) continue;
    // the gate as it will read back: measured height over the road along its own up, the road's normal there, its u across
    const placed = [[names[0], mL], [names[1], mR]].map(([name, m]) => {
      const pos = m.slice(12, 15), up = m.slice(4, 7), fwd = m.slice(8, 11), hit = under(ray, pos, up);
      return { name, kind: 'sector', s: st.s, u: dot(sub(pos, st.pos), lat), h: hit ? hit.t - UNDER_FROM_M : NaN, fwd, T, normal: hit ? hit.n : up, span: [-ed.right, ed.left], error: hit ? undefined : 'no road under it' };
    });
    const res = checkPlaced(placed, { pits: { count: 0 } }, { lengthM: lap, closed });
    // only this gate's problems: the set holds no start gate or grid, which the same checks would otherwise report missing
    const problems = res.checks.filter((c) => GATE_CHECKS.includes(c.id)).flatMap((c) => c.problems).filter((p) => p.includes(`AC_TIME_${gate}`));
    if (problems.length) continue;
    const buf = Buffer.from(src);
    for (const [d, m] of [[dL, mL], [dR, mR]]) m.forEach((x, j) => buf.writeFloatLE(x, d.offset + 4 * j));
    return {
      buf, station: { k, s: st.s, camberDeg, climbDeg, edgeLeftM: ed.left, edgeRightM: ed.right },
      from: { L: dL.local.slice(12, 15), R: dR.local.slice(12, 15) }, to: { L: pL, R: pR },
      placed, checks: { ids: GATE_CHECKS.slice(), problems }, widthTopDownM: Math.hypot(lr[0], lr[2]), tiltLRDeg,
    };
  }
  throw fail('NO_FLAT_STATION', `no station within ${reach.toFixed(0)} m of s ${nearS} has road flat enough (camber ≤ ${maxTiltDeg}°, climb ≤ ${maxClimbDeg}°) for a gate that passes the markers checks`);
}

/** The AI line's points as stations { s, pos, fwd, n } (src/export/ailine.js readAiLine; n and fwd from its extra block). */
function readStations(aiBuf) {
  const ai = readAiLine(aiBuf);
  return ai.points.map((p, k) => { const e = ai.extra[k]; return { s: p.length, pos: p.pos, fwd: [e.fx, e.fy, e.fz], n: [e.nx, e.ny, e.nz] }; });
}

function main(argv) {
  const [srcDir, outDir, ...rest] = argv, opt = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
  if (!srcDir || !outDir || opt('--near') == null) { console.error('usage: node tools/kn5-move-gate.cjs <track folder> <new folder> --near <s> [--gate 2] [--max-tilt 15] [--name "<display name>"] [--open]'); process.exit(2); }
  const tilt = opt('--max-tilt') != null ? Number(opt('--max-tilt')) : FLOOR_MAX_DEG;
  if (!(tilt > 0 && tilt <= 45)) throw fail('BAD_INPUT', '--max-tilt must be a number of degrees in (0, 45]');
  if (fs.existsSync(outDir)) throw fail('OUT_EXISTS', `${outDir} exists; this writes a new folder only`);
  const models = fs.readFileSync(path.join(srcDir, 'models.ini'), 'utf8'), kn5Name = (/^FILE=(.+)$/m.exec(models) || [])[1];
  if (!kn5Name || models.match(/^FILE=/gm).length !== 1) throw fail('BAD_INPUT', 'models.ini must name exactly one kn5');
  const src = fs.readFileSync(path.join(srcDir, kn5Name.trim()));
  const r = moveGate(src, readStations(fs.readFileSync(path.join(srcDir, 'ai', 'fast_lane.ai'))), { gate: Number(opt('--gate') || 2), nearS: Number(opt('--near')), closed: !rest.includes('--open'), maxTiltDeg: tilt });
  const files = []; (function list(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r2 = path.join(rel, e.name); if (e.isDirectory()) list(path.join(d, e.name), r2); else files.push(r2); } })(srcDir, '');
  for (const f of files) {
    const to = path.join(outDir, f); fs.mkdirSync(path.dirname(to), { recursive: true });
    if (f === kn5Name.trim()) fs.writeFileSync(to, r.buf);
    else if (f === path.join('ui', 'ui_track.json') && opt('--name')) { const j = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8')); j.name = opt('--name'); fs.writeFileSync(to, JSON.stringify(j, null, 2) + '\n'); }
    else fs.copyFileSync(path.join(srcDir, f), to);
  }
  const f = (a) => a.map((x) => x.toFixed(2)).join(', ');
  console.log(`moved AC_TIME_${opt('--gate') || 2} from s ${opt('--near')} to the AI station at s ${r.station.s.toFixed(1)} (the bar ${tilt}°: camber ${r.station.camberDeg.toFixed(1)}°, climb ${r.station.climbDeg.toFixed(1)}°)`);
  console.log(`  L ${f(r.from.L)} -> ${f(r.to.L)}\n  R ${f(r.from.R)} -> ${f(r.to.R)}`);
  console.log(`  top-down width ${r.widthTopDownM.toFixed(2)} m, L-R tilt ${r.tiltLRDeg.toFixed(2)}°, heights ${r.placed.map((m) => m.h.toFixed(2)).join(' / ')} m; checks ${r.checks.ids.join(', ')}: ${r.checks.problems.length ? r.checks.problems.join('; ') : 'pass'}`);
  console.log(`  wrote ${files.length} files to ${outDir}`);
}

if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); } }
module.exports = { moveGate, locateDummies, readStations };
