// cheap-ghost.test.js: node --test app/test/cheap-ghost.test.js   (under the heavy-run lock)
// D266 item 2 (the keeper, 01:49: "when making very long turn like 1000m tube turn it lags when scrubbing cant precise move, i think the preview could be cheaper until extend is pressed"):
// while a handle is being DRAGGED the ghost of the next piece is built CHEAP (its row grid thinned, app/preview/coarse.js, for the NEW pieces only) and the full ghost comes back when the drag
// stops. FEEL tier: rows on the track model and the headless preview; the panel's side (the flag, the final full ghost) is core-pieces-ui row 18. The placed track and the export are unchanged.
//   1  the track model: ghostFor(candidate, { cheap: true }) meshes far fewer vertices on a 1000 m tube, has the SAME path (the handles' samples), touches nothing placed, and a full ghost after it is
//      exactly the full ghost without it
//   2  the preview: showGhost(candidate, { cheap: true }) keeps ghostInfo (samples, segments, s0) and the placed track; a plain showGhost is the full one
//   3  a short plain piece: cheap is still a ghost (same path, no more vertices than full)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const P = require('../preview/preview.js');
const XS = require('../core/xsec.js');

/** A 300 m straight, placed; and the candidate of a 1000 m closed-tube turn after it (the keeper's piece). */
async function bigTube(length = 1000) {
  const sh = await createCoreShell({ brushFn: null, autosaveMs: 0 }); sh.extend({ length: 300, family: 'bowl' });
  const cand = (kh = 1 / 600) => sh.candidate({ length, targets: { kh, [XS.CHANNEL.tube]: 360, w: 31 } });
  return { sh, cand };
}
const vertsOf = (g) => g.batches.reduce((a, b) => a + (b.positions ? b.positions.length / 3 : (b.count || 0)), 0);
const samplesKey = (p) => p.samples.map((m) => m.pos.map((v) => v.toFixed(6)).join(',')).join(';');

test('row 1: the track model: a CHEAP ghost of a 1000 m tube meshes at most a quarter of the vertices, has the same path, touches nothing placed, and the full ghost after it is the full ghost without it', async () => {
  const { sh, cand } = await bigTube(), tm = createTrackModel(); tm.update(sh.getState().resolved);
  const placedPath = tm.path, placedMesh = tm.mesh, c = cand();
  const full = tm.ghostFor(c), cheap = tm.ghostFor(c, { cheap: true });
  assert.ok(vertsOf(full) > 100000, 'control: the full ghost is big (' + vertsOf(full) + ' vertices)');
  assert.ok(vertsOf(cheap) <= vertsOf(full) / 4, 'the cheap ghost is at most a quarter: ' + vertsOf(cheap) + ' against ' + vertsOf(full));
  assert.equal(samplesKey(cheap.path), samplesKey(full.path), 'the same path: the handles sit where they did'); assert.equal(cheap.segments.length, full.segments.length); assert.deepEqual(cheap.head.pos, full.head.pos);
  assert.equal(tm.path, placedPath, 'the placed path is the very same object'); assert.equal(tm.mesh, placedMesh, 'and the placed mesh');
  const again = tm.ghostFor(c); assert.equal(vertsOf(again), vertsOf(full), 'a full ghost after a cheap one is the full one'); assert.equal(samplesKey(again.path), samplesKey(full.path));
  assert.deepEqual(again.batches.map((b) => (b.positions ? Array.from(b.positions.slice(0, 30)) : null)), full.batches.map((b) => (b.positions ? Array.from(b.positions.slice(0, 30)) : null)), 'the same vertices');
  assert.equal(vertsOf(tm.ghostFor(c, { cheap: false })), vertsOf(full), 'cheap: false is the full ghost');
});

test('row 3: a short plain piece: cheap is still a ghost of the same path, with no more vertices than the full one', async () => {
  const sh = await createCoreShell({ brushFn: null, autosaveMs: 0 }); sh.extend({ length: 300, family: 'bowl' });
  const tm = createTrackModel(); tm.update(sh.getState().resolved);
  const cand = sh.candidate({ length: 60, targets: { kh: 1 / 180 } }), full = tm.ghostFor(cand), cheap = tm.ghostFor(cand, { cheap: true });
  assert.equal(samplesKey(cheap.path), samplesKey(full.path)); assert.ok(vertsOf(cheap) <= vertsOf(full)); assert.ok(cheap.batches.length >= 1);
  // a track with nothing placed yet
  const e = await createCoreShell({ brushFn: null, autosaveMs: 0 }), te = createTrackModel(); te.update(e.getState().resolved);
  const ce = e.candidate({ length: 100 }); assert.equal(samplesKey(te.ghostFor(ce, { cheap: true }).path), samplesKey(te.ghostFor(ce).path), 'an empty track: the same');
});

function headless(s) {
  let q = [], now = 0;
  const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (fn) => { q.push(fn); return q.length; }, cancelAnimationFrame() {}, performance: { now: () => now }, setTimeout, clearTimeout };
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => ({})) });
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  return P.createPreview({ canvas, shell: s, win });
}

test('row 2: the preview: showGhost(candidate, { cheap: true }) keeps ghostInfo (the same samples, segments and s0) and the placed track; a plain showGhost is the full ghost', async () => {
  const { sh, cand } = await bigTube(), pv = headless(sh), c = cand();
  pv.showGhost(c); const full = pv.ghostInfo(), fullView = pv.view();
  pv.showGhost(c, { cheap: true }); const cheap = pv.ghostInfo();
  assert.equal(samplesKey({ samples: cheap.samples }), samplesKey({ samples: full.samples }), 'the handles read the same samples'); assert.equal(cheap.s0, full.s0); assert.equal(cheap.segments.length, full.segments.length); assert.equal(cheap.jump, full.jump);
  assert.equal(pv.view().track, fullView.track, 'the placed track is the same'); assert.ok(pv.view().ghost >= 1);
  pv.showGhost(c); assert.equal(samplesKey({ samples: pv.ghostInfo().samples }), samplesKey({ samples: full.samples })); pv.clearGhost(); assert.equal(pv.ghostInfo(), null);
  pv.dispose();
});

// 2026-10-14 (reported: stretching a piece past about 500 m drops the frames massively). Every new segment of a plain cup piece has no row grid, so the cheap
// ghost searched a grid for EACH one (coarse.js gridOf, 4,000 steps), and the candidate is rebuilt on every move, so the memo never hit: 802 searches at 1600 m,
// ~90 ms a move in node. The cheap ghost now finds ONE grid for the new run of segments.
test('row 4: a long plain piece\'s cheap ghost shares one row grid across its new segments and builds quickly at 1600 m', async () => {
  const sh = await createCoreShell({ brushFn: null, autosaveMs: 0 }), tm = createTrackModel(); tm.update(sh.getState().resolved);
  const c = sh.candidate({ length: 1600 }); assert.ok(c.segments.length > 500 && c.segments.every((s) => !Array.isArray(s.fractions)), 'control: hundreds of segments, none with a grid');
  const g = tm.ghostFor(c, { cheap: true }), grids = new Set(g.segments.map((s) => s.fractions));
  assert.equal(grids.size, 1, `the new segments share one grid (no seam zipper, one search): ${grids.size} grids`);
  const full = tm.ghostFor(c); assert.equal(samplesKey(g.path), samplesKey(full.path), 'the same path: the handles sit where they did');
  assert.ok(vertsOf(g) < vertsOf(full), 'still cheaper than the full ghost');
  let best = Infinity; for (let k = 0; k < 5; k++) { const ck = sh.candidate({ length: 1600 + k }), t = performance.now(); tm.ghostFor(ck, { cheap: true }); best = Math.min(best, performance.now() - t); }
  assert.ok(best < 35, `a cheap ghost of 1600 m builds in ${best.toFixed(1)} ms (was ~90 ms)`);
});

test('row 5: an empty run and a run of one segment are coarsened as before', async () => {
  const { coarsenRun, coarsen } = require('../preview/coarse.js');
  assert.deepEqual(coarsenRun([], 12), []);
  const sh = await createCoreShell({ brushFn: null, autosaveMs: 0 }), one = sh.candidate({ length: 2 }).segments;
  assert.equal(one.length, 1); assert.deepEqual(coarsenRun(one, 12)[0].fractions, coarsen(one, 12)[0].fractions);
  assert.equal(coarsenRun(one, 1), one, 'detail 1 is the same array');
});

// 2026-10-14, the second pass: the cheap ghost REMEMBERS its last mesh, and a length drag (whole 2 m, app/core/panel.js) leaves every chord but the end as it was.
test('row 6: a cheap ghost after a cheap ghost reuses the unchanged chords and draws the same as one built fresh', async () => {
  const G = require('../../src/geom/index.js');
  const sh = await createCoreShell({ brushFn: null, autosaveMs: 0 }); sh.extend({ length: 300 });
  let stats = null; const geom = { ...G, reuseMesh: (...a) => { const m = G.reuseMesh(...a); stats = m.stats; return m; } };
  const tm = createTrackModel({ geom }); tm.update(sh.getState().resolved);
  const opts = (L) => ({ length: L, targets: { c: 15.5, w: 31, [XS.CHANNEL.start]: 0.64 } });
  tm.ghostFor(sh.candidate(opts(1000)), { cheap: true }); const c2 = sh.candidate(opts(1006)), g = tm.ghostFor(c2, { cheap: true });
  const fresh = createTrackModel(); fresh.update(sh.getState().resolved); const f = fresh.ghostFor(c2, { cheap: true });
  const newPieces = c2.segments.length - sh.getState().resolved.segments.length;
  assert.ok(stats && stats.reused >= newPieces - 8, `reused ${stats && stats.reused} of ${newPieces} new chords`);
  assert.equal(vertsOf(g), vertsOf(f), 'the same vertex count as a fresh cheap ghost');
  const flat = (x) => x.batches.flatMap((b) => Array.from(b.positions));
  const a = flat(g), b = flat(f); let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  assert.ok(worst < 1e-3, `every vertex where a fresh build puts it (worst ${worst} m)`);
  assert.equal(samplesKey(g.path), samplesKey(f.path), 'the same path');
  const full = tm.ghostFor(c2); assert.ok(vertsOf(full) > vertsOf(g), 'a full ghost after it is full detail (the memory is not used for it)');
});

test('row 7: reuseMesh keeps its old rule unless asked: a different count needs `grow`, and a closed loop is refused with it', async () => {
  const G = require('../../src/geom/index.js');
  const sh = await createCoreShell({ brushFn: null, autosaveMs: 0 }), tm = createTrackModel(); tm.update(sh.getState().resolved);
  const s1 = sh.candidate({ length: 20 }).segments, s2 = sh.candidate({ length: 30 }).segments;
  const p1 = G.buildPath(s1, { step: 2 }), m1 = G.buildMesh(p1, s1), p2 = G.buildPath(s2, { step: 2 });
  assert.throws(() => G.reuseMesh(m1, p2, s2, s2.map(() => true)), /same number of segments/);
  const grown = G.reuseMesh(m1, p2, s2, s2.map((_, j) => j < s1.length - 1), { grow: true }), built = G.buildMesh(p2, s2);
  assert.equal(grown.stats.reused, s1.length - 1, 'every chord said to be the same is kept'); assert.equal(grown.cells.length, built.cells.length);
  assert.throws(() => G.reuseMesh({ _state: { ...m1._state, closed: true } }, p2, s2, s2.map(() => false), { grow: true }), /same number of segments/);
});
