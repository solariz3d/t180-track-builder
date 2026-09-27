// platform_test.test.js: node --test test/   (dependency-free)
// Checks the platform test track of scripts/platform_test.js as built geometry, not as design numbers: length, closure,
// the wall-ride's angle, folds, the jump at both landings, markers, cells, and that a degenerate word is refused.
// Each check is a plain function returning { ok, why } so the mutation tests at the bottom can run it on broken input
// and assert that it FAILS there.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../scripts/platform_test.js');

const DEG = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const LEN_TOL = 0.5; // m: stated tolerance on the 500 m path (chord sampling loses ~1e-5 m per arc step)

function freshTrack() { return P.buildTrack(); }

// ---------------------------------------------------------------- the checks
/** Path length from the built station positions (chord sum), including the closing step back to station 0. */
function checkLength(dsn, target = P.CONST.L_TOTAL, tol = LEN_TOL) {
  const st = dsn.stations; let L = 0;
  for (let i = 0; i < st.length; i++) L += len(sub(i + 1 < st.length ? st[i + 1].pos : dsn.end.pos, st[i].pos));
  return { ok: Math.abs(L - target) <= tol, why: `path ${L.toFixed(4)} m vs ${target} ± ${tol}`, L };
}
/** The loop closes: the end position equals station 0's, and the end frame equals station 0's frame. */
function checkClosure(dsn) {
  const s0 = dsn.stations[0], e = dsn.end;
  const dp = len(sub(e.pos, s0.pos));
  const f0 = P.frameOf(s0), fe = P.frameOf({ h: e.h, p: 0 });
  const df = Math.max(len(sub(f0.fwd, fe.fwd)), len(sub(f0.left, fe.left)), len(sub(f0.up, fe.up)));
  return { ok: dp < 1e-6 && df < 1e-9, why: `end is ${dp.toExponential(2)} m from the start, frame differs by ${df.toExponential(2)}` };
}
/**
 * The wall-ride's turning angle, measured on the built surface: the largest angle between a road vertex's normal and
 * its station's up, over the stations of the wall-ride word. Over 90° means the road faces past vertical (overhang).
 */
function checkWallAngle(dsn, secs, minDeg = 90) {
  const wi = dsn.words.findIndex((w) => w.font === 'wallride'); let worst = 0;
  dsn.stations.forEach((st, i) => {
    if (st.word !== wi) return;
    const up = P.frameOf(st).up;
    for (const n of secs[i].N) worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, dot(n, up)))) / DEG);
  });
  return { ok: worst > minDeg, why: `wall-ride surface turns to ${worst.toFixed(2)}° from the station's up`, worst };
}
/**
 * FOLD CHECK. Method:
 *  (a) every triangle's normal (from its world vertices, winding as the mesh writes it: A, C, B) lies on the drivable
 *      side of its vertex normals (dot > 0), and agrees with its neighbour across the profile (dot > 0);
 *  (b) the two triangles of every quad agree (dot > 0): a crossed "bow-tie" quad fails here;
 *  (c) consecutive cross-sections advance: for every profile vertex, (P[i+1][j] − P[i][j]) · forward_i > 0. That is
 *      the discrete form of ARCHITECTURE §3's 1 − κ·(q·N) > 0, checked on every vertex, not just the edges;
 *  (d) every distinct cross-section, as a 2D polyline, does not cross itself (pairwise segment test).
 * Gaps (the jump) have no quads and are skipped.
 */
function checkFolds(dsn, secs) {
  const st = dsn.stations, n = st.length, m = P.CONST.PROFILE_POINTS, bad = [];
  const tri = (a, b, c) => cross(sub(b, a), sub(c, a));
  for (let i = 0; i < n && bad.length < 5; i++) {
    if (st[i].gapNext) continue;
    const S0 = secs[i], S1 = secs[(i + 1) % n], fwd = P.frameOf(st[i]).fwd;
    let prev = null;
    for (let j = 0; j < m - 1; j++) {
      const A = S0.P[j], B = S0.P[j + 1], C = S1.P[j], D = S1.P[j + 1];
      const t1 = tri(A, C, B), t2 = tri(B, C, D);
      if (dot(t1, t2) <= 0) { bad.push(`bow-tie quad at station ${i}, profile ${j}`); break; }
      if (dot(t1, S0.N[j]) <= 0 || dot(t2, S1.N[j + 1]) <= 0) { bad.push(`triangle faces away from the road at station ${i}, profile ${j}`); break; }
      if (prev && dot(prev, t1) <= 0) { bad.push(`normal flips against its neighbour at station ${i}, profile ${j}`); break; }
      prev = t2;
    }
    for (let j = 0; j < m; j++) if (dot(sub(S1.P[j], S0.P[j]), fwd) <= 0) { bad.push(`cross-sections ${i}→${i + 1} fold at profile ${j}`); break; }
  }
  // (d) self-intersection of each distinct profile, in its own (u, v) plane
  const seen = new Set();
  for (let i = 0; i < n && bad.length < 5; i++) {
    const key = secs[i].font.map((x) => x.toFixed(4)).join('/'); if (seen.has(key)) continue; seen.add(key);
    const pr = secs[i].prof;
    const inter = (p, q, r, s) => { const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0; };
    outer: for (let a = 0; a < pr.length - 1; a++) for (let b = a + 2; b < pr.length - 1; b++) if (inter(pr[a], pr[a + 1], pr[b], pr[b + 1])) { bad.push(`profile ${key} crosses itself at segments ${a}, ${b}`); break outer; }
  }
  return { ok: bad.length === 0, why: bad.length ? bad.join('; ') : `no folds over ${n} stations × ${m - 1} segments; ${seen.size} distinct profiles simple` };
}
/** The jump holds at BOTH landings (3.2 g and 6.3 g), over the whole speed band. */
function checkJump(dsn) {
  const jc = P.jumpCheck(dsn);
  const gs = new Set(jc.rows.map((r) => r.g));
  const both = gs.has(3.2) && gs.has(6.3);
  const failing = jc.rows.filter((r) => !r.ok).map((r) => `${r.kmh} km/h @ ${r.g} g`);
  return { ok: both && jc.ok && jc.reachable, why: failing.length ? `fails: ${failing.join(', ')}` : `${jc.rows.length} flights hold; reachable ${jc.reachable}`, jc };
}

// ---------------------------------------------------------------- the tests
test('total length is 500 m ± 0.5 m', () => {
  const { dsn } = freshTrack(); const r = checkLength(dsn); assert.ok(r.ok, r.why);
});
test('the loop closes: end position and frame match the start', () => {
  const { dsn } = freshTrack(); const r = checkClosure(dsn); assert.ok(r.ok, r.why);
});
test('the wall-ride turns past 90° (measured on the built surface)', () => {
  const { dsn, secs } = freshTrack(); const r = checkWallAngle(dsn, secs); assert.ok(r.ok, r.why);
});
test('fold check: no flipped normals, no bow-ties, no folding or self-crossing cross-sections', () => {
  const { dsn, secs } = freshTrack(); const r = checkFolds(dsn, secs); assert.ok(r.ok, r.why);
});
test('the jump holds at the 3.2 g and the 6.3 g landing across the design band, and is reachable (FINDINGS §7d)', () => {
  const { dsn } = freshTrack(); const r = checkJump(dsn); assert.ok(r.ok, r.why);
});
test('cells stay under 65,536 vertices and have valid 16-bit indices', () => {
  const { scene } = freshTrack();
  const meshes = scene.root.children.filter((c) => c.type === 'mesh');
  assert.ok(meshes.length >= 2);
  for (const m of meshes) {
    const nv = m.positions.length / 3;
    assert.ok(nv < 65536, `${m.name}: ${nv} vertices`);
    assert.match(m.name, /^\d[A-Z]+/, `${m.name}: a physics mesh must be named <digit><KEY>`);
    assert.strictEqual(m.normals.length, m.positions.length); assert.strictEqual(m.uvs.length / 2, nv);
    assert.strictEqual(m.indices.length % 3, 0);
    for (const k of m.indices) assert.ok(k < nv);
    for (const x of m.positions) assert.ok(Number.isFinite(x));
  }
});
test('markers: names, 1–2 m above the surface, along the road, L/R the right way round, the line ahead of the grid', () => {
  const { scene, dsn } = freshTrack();
  const d = Object.fromEntries(scene.root.children.filter((c) => c.type === 'dummy').map((m) => [m.name, m]));
  for (const nm of ['AC_START_0', 'AC_START_1', 'AC_PIT_0', 'AC_HOTLAP_START_0', 'AC_TIME_0_L', 'AC_TIME_0_R']) assert.ok(d[nm], `missing ${nm}`);
  const pos = (m) => m.matrix.slice(12, 15), fwd = (m) => m.matrix.slice(8, 11);
  for (const m of Object.values(d)) {
    const st = P.stationAt(dsn, m.track.s), f = P.frameOf(st);
    const surf = [st.pos[0] + f.left[0] * m.track.u, st.pos[1] + f.left[1] * m.track.u, st.pos[2] + f.left[2] * m.track.u];
    const h = dot(sub(pos(m), surf), f.up);
    assert.ok(h >= 1 && h <= 2, `${m.name} is ${h.toFixed(3)} m above the surface`);
    assert.ok(dot(fwd(m), f.fwd) > Math.cos(5 * DEG), `${m.name} does not point along the road`);
  }
  // race direction from the grid's back slot to the pole, as read_track.cjs and src/export/markers.js do
  const starts = Object.keys(d).filter((k) => /^AC_START_\d+$/.test(k)).sort((a, b) => +a.slice(9) - +b.slice(9));
  const race = sub(pos(d[starts[0]]), pos(d[starts[starts.length - 1]]));
  const left = cross([0, 1, 0], race);
  assert.ok(dot(sub(pos(d.AC_TIME_0_L), pos(d.AC_TIME_0_R)), left) > 0, 'AC_TIME_0_L must be on the left of the race direction');
  const line = [(pos(d.AC_TIME_0_L)[0] + pos(d.AC_TIME_0_R)[0]) / 2, 0, (pos(d.AC_TIME_0_L)[2] + pos(d.AC_TIME_0_R)[2]) / 2];
  for (const k of starts) assert.ok(dot(sub(line, pos(d[k])), race) > 0, `the start line must be ahead of ${k}`);
  assert.ok(d.AC_HOTLAP_START_0.track.s < d.AC_TIME_0_L.track.s - 50, 'the hotlap start needs a run-up of at least 50 m before the line');
  // no marker inside another car's slot (±1.0 m across, ±2.4 m along: the same inferred box E's checks use)
  const names = Object.keys(d);
  for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
    const A = d[names[a]], B = d[names[b]];
    const clash = Math.abs(A.track.u - B.track.u) < 2.0 && Math.abs(A.track.s - B.track.s) < 4.8;
    assert.ok(!clash, `${names[a]} and ${names[b]} overlap`);
  }
});
test('the scene has the shared T1 shape (materials, root, mesh fields)', () => {
  const { scene } = freshTrack();
  assert.ok(Array.isArray(scene.textures) && Array.isArray(scene.materials) && scene.root.type === 'dummy');
  const mat = scene.materials[0];
  assert.strictEqual(mat.shader, 'ksPerPixel'); assert.strictEqual(mat.alphaBlend, 0); assert.strictEqual(mat.samplers.length, 0);
  assert.strictEqual(scene.root.matrix.length, 16);
  for (const c of scene.root.children) if (c.type === 'mesh') {
    assert.ok(c.positions instanceof Float32Array && c.normals instanceof Float32Array && c.uvs instanceof Float32Array && c.indices instanceof Uint16Array);
    assert.strictEqual(c.material, 0);
  }
});
test('edge case: a degenerate zero-length segment is refused', () => {
  assert.throws(() => P.buildCenterline([{ kind: 'straight', L: 0, font: 'flat' }]), /positive finite/);
  assert.throws(() => P.buildCenterline([{ kind: 'arc', angle: Math.PI, R: 0, font: 'flat' }]), /positive finite/);
  assert.throws(() => P.buildCenterline([{ kind: 'arc', angle: 0, R: 30, font: 'flat' }]), /positive finite/);
  assert.throws(() => P.buildCenterline([{ kind: 'program', font: 'flat', prog: [{ L: 10, p0: 0, p1: 0 }, { gap: true, D: 0, drop: 1 }] }]), /positive finite/);
  assert.throws(() => P.buildCenterline([{ kind: 'straight', L: NaN, font: 'flat' }]), /positive finite/);
});

// ---------------------------------------------------------------- mutations: each check must FAIL on broken input
test('mutation: one cross-section flipped (its profile reversed) is caught by the fold check', () => {
  const { dsn, secs } = freshTrack();
  const k = 50; secs[k] = { ...secs[k], P: secs[k].P.slice().reverse(), N: secs[k].N.slice().reverse() };
  assert.strictEqual(checkFolds(dsn, secs).ok, false);
});
test('mutation: a shortened loop is caught by the length check and the closure check', () => {
  const { dsn } = freshTrack();
  const cut = { ...dsn, stations: dsn.stations.slice(0, -20), end: { pos: dsn.stations[dsn.stations.length - 20].pos, h: dsn.stations[dsn.stations.length - 20].h } };
  assert.strictEqual(checkLength(cut).ok, false);
  assert.strictEqual(checkClosure(cut).ok, false);
});
test('mutation: the wall-ride built at 80° is caught by the wall-angle check', () => {
  const F = P.CONST.FONTS, keep = F.wallride.slice();
  try { F.wallride[1] = 80; const { dsn, secs } = P.buildTrack(); assert.strictEqual(checkWallAngle(dsn, secs).ok, false); }
  finally { F.wallride[0] = keep[0]; F.wallride[1] = keep[1]; }
});
test('mutation: a jump that cannot hold the 6.3 g landing (gap widened to 30 m) is caught by the jump check', () => {
  const J = P.CONST.JUMP, keep = J.gap;
  try { J.gap = 30; const { dsn } = P.buildTrack(); assert.strictEqual(checkJump(dsn).ok, false); }
  finally { J.gap = keep; }
});

module.exports = { checkLength, checkClosure, checkWallAngle, checkFolds, checkJump };
