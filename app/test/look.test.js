// look.test.js: node --test app/test/look.test.js. D170, "feels like a coaster builder" (the review of the
// D169 captures, items 1, 2, 6 and 7). Stated before these tests were written:
//   · LIGHT: shade(n) = ambient + key·max(n·key, 0) + fill·max(n·fill, 0), two-sided. On known normals: the floor gets
//     exactly that sum; a floor and a vertical wall differ by at least 0.15, and so do a bank facing the key light and one
//     facing away, so one colour reads as different surfaces. The fragment shader carries the same constants.
//   · EDGE LINES: the edge lines run through the profile's two EDGE vertices (u min and u max) and the centre line through
//     the vertex nearest u = 0, each lifted 3 cm along its normal; in world space an edge vertex lies within 1e-4 m (+ the
//     lift) of the geometry's own surface at that u. A tie crosses the road at least every 10 m.
//   · OVERHEAD FIT: with the track's box and the view's aspect, every vertex of every batch projects inside the view
//     (|x|, |y| ≤ 1, in front of the camera, before the far plane), for a wide and a tall view; the head is in frame.
//   · GHOST: shown and cleared; built on copies (the placed track is untouched); the ghost of a word equals, array for
//     array, what placing that word then builds, also through A's real shell.place(). A candidate that does not extend
//     the placed track is refused.
//   · GRID: every grid vertex is at y = 0, and the grid covers the track's box.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const LK = require(path.join(ADIR, 'preview', 'look.js'));
const TM = require(path.join(ADIR, 'preview', 'trackmodel.js'));
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const P = require(path.join(ADIR, 'preview', 'preview.js'));
const C = require(path.join(ADIR, 'camera', 'cameras.js'));
const M = require(path.join(ADIR, 'camera', 'math.js'));
const GW = require(path.join(ADIR, 'testhook', 'ghostword.js'));
const G = require('../../src/geom/index.js');
const D = require('../../src/doc/index.js');
const F = require('../../test/geom_fixtures.js');

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const deg = Math.PI / 180;
function words(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i % 3 === 0 ? { id: `t${i}`, kind: 'road', length: 35, k0: 0.01, k1: 0.03, kp0: 0.001, kp1: 0, roll0: 0, roll1: 0.15, profile: F.HALFPIPE }
    : i % 3 === 1 ? { id: `s${i}`, kind: 'road', length: 45, profile: F.FLAT } : { id: `w${i}`, kind: 'road', length: 40, k0: 0.025, k1: 0, profile: F.WALLRIDE });
  return out;
}
const worldOf = (b) => { const out = []; for (let i = 0; i < b.positions.length; i += 3) out.push(M.apply(b.model, [b.positions[i], b.positions[i + 1], b.positions[i + 2]]).slice(0, 3)); return out; };

// ── light ──
test('light: the floor gets exactly ambient + key·key.y + fill·fill.y', () => {
  const L = LK.LIGHT, want = L.ambient + L.keyK * Math.max(L.key[1], 0) + L.fillK * Math.max(L.fill[1], 0);
  assert.ok(Math.abs(LK.shade([0, 1, 0]) - want) < 1e-12);
});
test('light: a floor and a vertical wall, and a bank toward and away from the key, differ by at least 0.15', () => {
  const floor = LK.shade([0, 1, 0]), key = LK.LIGHT.key, side = unit([key[0], 0, key[2]]), away = side.map((x) => -x);
  const wallToward = LK.shade(side), wallAway = LK.shade(away);
  assert.ok(Math.abs(floor - wallAway) >= 0.15 || Math.abs(floor - wallToward) >= 0.15, `floor ${floor}, walls ${wallToward} / ${wallAway}`);
  const bank = (s) => unit([s[0] * Math.sin(30 * deg), Math.cos(30 * deg), s[2] * Math.sin(30 * deg)]);
  assert.ok(LK.shade(bank(side)) - LK.shade(bank(away)) >= 0.15, `banks ${LK.shade(bank(side))} vs ${LK.shade(bank(away))}`);
});
test('light: two-sided (an overhang facing down is lit like the floor facing up), and never below ambient or above 1', () => {
  assert.ok(Math.abs(LK.shade([0, -1, 0]) - LK.shade([0, 1, 0])) < 1e-12);
  for (let i = 0; i < 200; i++) { const n = unit([Math.sin(i), Math.cos(i * 1.7), Math.sin(i * 0.3)]), v = LK.shade(n); assert.ok(v >= LK.LIGHT.ambient - 1e-12 && v <= 1 + 1e-12, `${v}`); }
});
test('light: the fragment shader carries look.js\'s own constants (the test of shade() is a test of the shader)', () => {
  for (const x of [...LK.LIGHT.key, ...LK.LIGHT.fill, LK.LIGHT.ambient, LK.LIGHT.keyK, LK.LIGHT.fillK]) assert.ok(R.FS.includes(x.toFixed(6)), `${x}`);
});

// ── edge lines ──
test('edge lines: through the two edge vertices and the centre vertex, lifted 3 cm, on the geometry\'s own surface', () => {
  const segs = words(3), p = G.buildPath(segs), m = G.buildMesh(p, segs, { rampM: 0 }), bs = require(path.join(ADIR, 'preview', 'batches.js')).batchesOf(m);
  const b = bs.find((x) => !x.seam && x.piece === 2), L = LK.linesFor(b), K = b.cols;
  const vtx = (r, k) => { const i = (r * K + k) * 3; return [0, 1, 2].map((d) => b.positions[i + d] + b.normals[i + d] * LK.LIFT); };
  // the first segment of each of the three lines: rows 0→1 at k = 0, centre, K − 1
  const near = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) < 1e-6;
  const first = (j) => Array.from(L.edges.slice(j * 6, j * 6 + 3));
  assert.ok(near(first(0), vtx(0, 0)) && near(first(2), vtx(0, K - 1)), 'edges at k = 0 and k = K − 1');
  assert.equal(Math.abs(b.us[L.centre]), Math.min(...b.us.map(Math.abs)));
  assert.ok(near(first(1), vtx(0, L.centre)), 'the centre line at the vertex nearest u = 0');
  // world: the edge vertex sits on the surface the geometry defines at u = u_min, lifted along its normal
  const pc = m._state.pieces[2], sm = p.samples.find((s) => s.seg === 2 && Math.abs(s.s - b.rowS[0]) < 1e-9);
  for (const [k, u] of [[0, pc.Us[0]], [K - 1, pc.Us[K - 1]]]) {
    const [X, Y] = G.profile.offsetAt(pc.P, u), want = sm.pos.map((c, d) => c + sm.L[d] * X + sm.U[d] * Y);
    const i = k * 3, w = M.apply(b.model, [b.positions[i], b.positions[i + 1], b.positions[i + 2]]);
    assert.ok(Math.hypot(w[0] - want[0], w[1] - want[1], w[2] - want[2]) < 1e-4, `edge k=${k}`);
  }
  assert.ok(Math.abs(pc.Us[0] - pc.P.u[0]) < 1e-12 && Math.abs(pc.Us[K - 1] - pc.P.u[pc.P.u.length - 1]) < 1e-12, 'the edge vertices are the profile\'s own edges');
});
test('edge lines: a tie across the road at least every 10 m of the cell, and none on seams', () => {
  const segs = words(3), bs = require(path.join(ADIR, 'preview', 'batches.js')).batchesOf(G.buildMesh(G.buildPath(segs), segs));
  for (const b of bs) {
    const L = LK.linesFor(b);
    if (b.seam) { assert.equal(L, null); continue; }
    const tieRows = (L.ties.length / 6) / (b.cols - 1), span = b.rowS[b.rowS.length - 1] - b.rowS[0];
    assert.ok(tieRows >= Math.floor(span / LK.TIE_M), `${b.key}: ${tieRows} ties over ${span} m`);
  }
});

// ── overhead fit ──
for (const aspect of [1.7, 0.6]) {
  test(`overhead fit (aspect ${aspect}): every vertex of the whole track projects inside the view, and the head is in frame`, () => {
    const segs = words(12), p = G.buildPath(segs), bs = require(path.join(ADIR, 'preview', 'batches.js')).batchesOf(G.buildMesh(p, segs));
    const bounds = LK.worldBounds(bs), pose = C.poseFor('overhead', { head: p.head, path: p, bounds, aspect }), vp = M.viewProj(pose, aspect);
    let worst = 0, n = 0;
    for (const b of bs) for (const w of worldOf(b)) {
      for (let d = 0; d < 3; d++) assert.ok(w[d] >= bounds.min[d] - 1e-6 && w[d] <= bounds.max[d] + 1e-6, 'the box contains the vertex');
      const c = M.apply(vp, w); assert.ok(c[3] > 0); worst = Math.max(worst, Math.abs(c[0] / c[3]), Math.abs(c[1] / c[3])); assert.ok(c[2] / c[3] < 1); n++;
    }
    assert.ok(n > 10000 && worst <= 1, `${n} vertices, worst |NDC| ${worst}`);
    assert.ok(worst > 0.6, `the fit is not wastefully loose (worst ${worst})`);
    const h = M.apply(vp, p.head.pos); assert.ok(Math.abs(h[0] / h[3]) < 1 && Math.abs(h[1] / h[3]) < 1);
  });
}

// ── ghost ──
/** The same batches, array for array (exact). Reports the first mismatch: a deepEqual of these arrays takes minutes to
 *  print its diff when they differ, which turns a failure into a timeout (seen in D168 and again here). */
function sameBatches(a, b) {
  assert.deepEqual(a.map((x) => x.key), b.map((x) => x.key), 'the same batches');
  for (let i = 0; i < a.length; i++) for (const f of ['model', 'positions', 'normals', 'indices']) {
    const x = a[i][f], y = b[i][f]; assert.equal(x.length, y.length, `${a[i].key}.${f} length`);
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) assert.fail(`${a[i].key}.${f}[${k}]: ${x[k]} vs ${y[k]}`);
  }
}
test('ghost: the ghost of a segment tail equals what placing it builds, and the placed track is untouched by the ghost', () => {
  const all = words(8), tm = TM.createTrackModel(), before = tm.update({ segments: all.slice(0, 6), closed: false });
  const keep = before.batches.map((b) => [b.positions, Array.from(b.model)]);
  const g = tm.ghostFor({ segments: all.slice(0, 7) });
  assert.ok(g.batches.length > 0 && g.batches.every((b) => b.piece === 6), 'only the new piece (and its seam)');
  assert.deepEqual(before.batches.map((b) => [b.positions, Array.from(b.model)]), keep, 'the live batches are the same objects, unmoved');
  const placed = tm.update({ segments: all.slice(0, 7), closed: false });
  assert.equal(placed.how, 'extend');
  sameBatches(placed.batches.filter((b) => b.piece === 6), g.batches);
  assert.ok(Math.hypot(...[0, 1, 2].map((d) => g.head.pos[d] - placed.path.head.pos[d])) < 1e-12, 'the ghost head is where the head goes');
});
test('ghost: a candidate that does not extend the placed track is refused; on an empty track the ghost stands alone', () => {
  const all = words(4), tm = TM.createTrackModel();
  const first = tm.ghostFor({ segments: all.slice(0, 1) }); assert.ok(first.batches.length > 0 && first.head);
  tm.update({ segments: all.slice(0, 3), closed: false });
  assert.throws(() => tm.ghostFor({ segments: all.slice(0, 3) }), /must extend/);
  const bent = all.slice(0, 4); bent[1] = { ...bent[1], length: 50 };
  assert.throws(() => tm.ghostFor({ segments: bent }), /must extend/);
});
test('ghost through A\'s real shell: the candidate for a word equals what shell.place() then builds', async () => {
  const { createShell } = require('../shell.js');
  const store = { saveDoc: async () => {}, openDoc: async () => '', listDocs: async () => [], saveLibrary: async () => {}, openLibrary: async () => null };
  const s = await createShell({ storage: store }), tm = TM.createTrackModel();
  s.place('straight'); s.setPicker('font', 'half-pipe'); s.place('turn'); tm.update(s.getState().resolved);
  s.setPicker('font', 'half-pipe');                       // not the turn's own font (bowl), so a candidate that ignored the pickers would differ
  const n0 = s.getState().resolved.segments.length, g = tm.ghostFor(GW.candidateFor(s.getState(), 'turn'));
  s.place('turn'); const placed = tm.update(s.getState().resolved);
  assert.equal(s.getState().history.present.words.at(-1).font, 'half-pipe', 'the placed word took the picker');
  assert.equal(placed.how, 'extend');
  sameBatches(placed.batches.filter((b) => b.piece >= n0), g.batches);
});

// ── the preview: showGhost / clearGhost, the grid and the marker in a frame ──
function fake() {
  const calls = { drawElements: 0, drawArrays: 0 };
  const gl = new Proxy({ VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7,
    COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13, BLEND: 14, LINES: 15,
    getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    drawElements() { calls.drawElements++; }, drawArrays() { calls.drawArrays++; } }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  let q = [];
  const win = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {}, step() { const f = q; q = []; for (const g of f) g(16); } };
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  return { calls, win, canvas };
}
test('preview: showGhost draws the ghost, clearGhost removes it, and placing the word retires it', () => {
  const all = words(5); let resolved = { segments: all.slice(0, 3), closed: false }, sub = null;
  const shell = { getState: () => ({ resolved, resolveError: null }), subscribe: (f) => { sub = f; return () => {}; } };
  const { calls, win, canvas } = fake(), p = P.createPreview({ canvas, shell, win });
  win.step(); const base = calls.drawElements;
  assert.ok(p.showGhost({ segments: all.slice(0, 4) }) > 0); assert.ok(p.view().ghost > 0);
  const d0 = calls.drawElements; win.step(); assert.ok(calls.drawElements - d0 > base, 'the ghost adds surface draws');
  p.clearGhost(); assert.equal(p.view().ghost, 0);
  const d1 = calls.drawElements; win.step(); assert.equal(calls.drawElements - d1, base);
  p.showGhost({ segments: all.slice(0, 4) }); resolved = { segments: all.slice(0, 4), closed: false }; sub(shell.getState());
  assert.equal(p.view().ghost, 0, 'placing the word retires its ghost');
});
test('preview: a frame draws the grid and the head marker as lines', () => {
  const shell = { getState: () => ({ resolved: { segments: words(3), closed: false } }), subscribe: () => () => {} };
  const { calls, win, canvas } = fake(), p = P.createPreview({ canvas, shell, win }); win.step();
  const cells = p.view().track.batches.filter((b) => !b.seam).length;
  assert.ok(p.view().grid > 0);
  assert.equal(p.renderer.stats().lines, 1 + 1 + 2 * cells, 'the grid, the head marker, and the edges and ties of each road cell');
  assert.equal(calls.drawArrays, 1 + 1 + 2 * cells);
});

// ── grid and marker ──
test('grid: every vertex at y = 0, covering the track\'s box, and the spacing widens so a long track stays a few hundred lines', () => {
  const segs = words(9), bs = require(path.join(ADIR, 'preview', 'batches.js')).batchesOf(G.buildMesh(G.buildPath(segs), segs));
  const b = LK.worldBounds(bs), g = LK.gridLines(b), P3 = g.positions;
  for (let i = 1; i < P3.length; i += 3) assert.equal(P3[i], 0);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < P3.length; i += 3) { x0 = Math.min(x0, P3[i]); x1 = Math.max(x1, P3[i]); z0 = Math.min(z0, P3[i + 2]); z1 = Math.max(z1, P3[i + 2]); }
  assert.ok(x0 <= b.min[0] && x1 >= b.max[0] && z0 <= b.min[2] && z1 >= b.max[2]);
  assert.equal(g.spacing, 10);
  const huge = LK.gridLines({ min: [-7000, 0, -7000], max: [7000, 50, 7000] });
  assert.ok(huge.spacing > 10 && huge.positions.length / 6 <= 2 * 201 + 2, `${huge.positions.length / 6} lines at ${huge.spacing} m`);
  assert.equal(LK.gridLines(null), null);
});
test('head marker: it grows with the camera distance (2%, never under 3 m), and its ring surrounds the head in the road plane', () => {
  const p = G.buildPath(words(2)), h = p.head;
  assert.equal(P.markerSize({ eye: h.pos.map((x, i) => x + (i === 1 ? 50 : 0)) }, h), 3);
  assert.ok(Math.abs(P.markerSize({ eye: h.pos.map((x, i) => x + (i === 1 ? 2000 : 0)) }, h) - 40) < 1e-9);
  const mk = LK.headMarker(h, 40).positions, ring = mk.slice(18);
  assert.equal(ring.length, 24, 'four sides');
  for (let i = 0; i < ring.length; i += 3) { const d = [0, 1, 2].map((k) => ring[i + k] - h.pos[k]); assert.ok(Math.abs(dot(d, h.U)) < 1e-3, 'in the road plane'); assert.ok(Math.hypot(...d) >= 64 - 1e-3, 'around the head, not on it'); }
});
test('head marker: a 10 m mast straight up from the head', () => {
  const p = G.buildPath(words(2)), mk = LK.headMarker(p.head).positions;
  assert.deepEqual(Array.from(mk.slice(0, 3)), Array.from(new Float32Array(p.head.pos)));
  assert.ok(Math.abs(mk[4] - mk[1] - 10) < 1e-4 && Math.abs(mk[3] - mk[0]) < 1e-9 && Math.abs(mk[5] - mk[2]) < 1e-9);
});
