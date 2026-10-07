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
