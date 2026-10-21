// sculpt-release.test.js: node --test app/test/sculpt-release.test.js
// D421c part 2: THE RELEASE OF A SCULPT DRAG, BUILT A SLICE AT A TIME. After a route tool on a closed lap the shell re-closes it (a whole-lap close moves every piece), and the exact
// road was built in one frame (about 200 ms on a 10 km lap). It is now built as steps: src/geom/mesh.js reuseMeshSteps, app/preview/trackmodel.js updateSteps, and the preview runs
// them a few milliseconds a frame. Rows:
//   1  reuseMeshSteps run to the end is reuseMesh, to the byte: a closed lap with some pieces kept and some meshed again, and an open track grown into a closed one
//   2  updateSteps run to the end is update(), to the byte, on a closed lap's full rebuild; it yields more than once there, and the model is as it was until its end
//   3  the preview: after a closed-lap release the exact road is built over several frames with the drag's last frame on show until it is whole, and it is what a plain update builds;
//      a new drag before it is whole finishes it first
//   4  a ramp's blended cross-section is kept for frozen inputs (src/geom/mesh.js rampShape) and is the very mesh unfrozen inputs give; a changed from-profile is never served a kept shape
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const G = require('../../src/geom/index.js');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');

const R = 180;
async function lap() {
  const s = await createCoreShell({ autosaveMs: 0 });
  s.extend({ length: 300, family: 'bowl' }); s.extend({ length: Math.PI * R, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 300, transition: 40, targets: { kh: 0 } }); s.extend({ length: Math.PI * R, transition: 40, targets: { kh: 1 / R } }); s.close();
  assert.equal(s.getState().history.present.closed, true, s.getState().message); return s;
}
/** every number a mesh hands the renderer, in order: each node's name, matrix and arrays, and the cells */
function meshHash(m) {
  const h = crypto.createHash('sha256'), num = (a) => h.update(a ? Buffer.from(new Float64Array(Array.from(a)).buffer) : '-');
  for (const n of m.scene.root.children) { h.update(n.name); num(n.matrix); for (const c of n.children) { h.update(c.name); num(c.positions); num(c.normals); num(c.uvs); num(c.indices); } }
  h.update(JSON.stringify(m.cells)); return h.digest('hex');
}
const run = (it) => { let r = it.next(), n = 0; while (!r.done) { r = it.next(); n++; } return { value: r.value, yields: n }; };

test('row 1: reuseMeshSteps run to the end is reuseMesh to the byte, on a closed lap with some pieces kept and some meshed again, and on an open track grown closed', async () => {
  const s = await lap(), r0 = s.getState().resolved, segs = r0.segments;
  const p0 = G.buildPath(segs, { step: 2, closed: true, start: r0.start }), m0 = G.buildMesh(p0, segs);
  // a changed stretch: every 7th segment marked not the same (as a brushed window would be), the rest kept
  const same = segs.map((_, j) => j % 7 !== 3);
  const a = G.reuseMesh(m0, p0, segs, same), b = run(G.reuseMeshSteps(m0, p0, segs, same));
  assert.ok(b.yields > 10, `it yields as it goes (${b.yields} times)`);
  assert.equal(meshHash(b.value), meshHash(a), 'the same mesh to the byte');
  assert.equal(b.value.stats.reused, a.stats.reused, 'the same pieces kept'); assert.ok(a.stats.reused > 0 && a.stats.reused < segs.length, 'control: some kept, some meshed again');
  // an open track closed by adding road (the grow case): the open mesh, then the closed lap's segments
  const open = segs.slice(0, segs.length - 40), po = G.buildPath(open, { step: 2, start: r0.start }), mo = G.buildMesh(po, open);
  const grow = segs.map((_, j) => j < open.length);
  assert.equal(meshHash(run(G.reuseMeshSteps(mo, p0, segs, grow, { grow: true })).value), meshHash(G.reuseMesh(mo, p0, segs, grow, { grow: true })), 'grown: the same mesh to the byte');
  assert.throws(() => run(G.reuseMeshSteps(m0, p0, segs, same.slice(1))), /same\[\] flag for each segment/, 'a wrong same[] is refused, as reuseMesh refuses it');
});

test('row 2: updateSteps run to the end is update() to the byte on a closed lap\'s full rebuild; it yields there, and the model is as it was until its end', async () => {
  const s = await lap(), base = s.getState().resolved, P = s.getState().history.present.pieces[2];
  // the same lap with one piece's turn changed everywhere: every segment of it new, the lap still closing (a closed lap is rebuilt in full)
  const s2 = await lap(); s2.setSculpt(false);
  s2.sculptOnce({ mode: 'rate', channel: 'w', s0: 300 + Math.PI * R + 150, r: 120, delta: 2 });
  const next = s2.getState().resolved; assert.notEqual(next, base); assert.equal(next.closed, true, s2.getState().message);
  const A = createTrackModel(), B = createTrackModel(); A.update(base); B.update(base);
  const a = A.update(next), it = B.updateSteps(next), pathBefore = B.path, meshBefore = B.mesh;
  let r = it.next(), yields = 0;
  while (!r.done) { assert.equal(B.path, pathBefore, 'mid-build, the model\'s path is the one it had'); assert.equal(B.mesh, meshBefore, 'and its mesh'); r = it.next(); yields++; }
  assert.ok(yields > 10, `a full rebuild yields as it goes (${yields} times)`);
  assert.equal(r.value.how, a.how); assert.equal(meshHash(r.value.mesh), meshHash(a.mesh), 'the same mesh to the byte');
  assert.equal(r.value.batches.length, a.batches.length, 'as many batches');
  const c = createTrackModel(); c.update(base); const r2 = run(c.updateSteps(base)); assert.equal(r2.yields, 0, 'nothing to build: no yield'); assert.equal(r2.value.how, 'same');
  assert.ok(P, 'control');
});

test('row 3: the preview builds the release over several frames with the drag\'s last frame on show, and it is what a plain update builds; a new drag first finishes it', async () => {
  const Pv = require('../preview/preview.js');
  const s = await lap(), d = s.getState().history.present, s0 = 300 + Math.PI * R + 150;
  let now = 0, rafs = [];
  const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; }, cancelAnimationFrame() {},
    setTimeout, clearTimeout, performance: { now: () => now } };
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  const p = Pv.createPreview({ canvas, shell: s, win }), v = () => p.view();
  // each update call advances the clock 1 ms (a slow machine): a slice ends after EXACT_SLICE_MS
  const real = p.model.updateSteps.bind(p.model); p.model.updateSteps = function* (...a) { const it = real(...a); let r = it.next(); while (!r.done) { now += 1; yield r.value; r = it.next(); } return r.value; };
  const frame = () => { const run2 = rafs; rafs = []; for (const f of run2) f(16); };
  s.beginBrush({ mode: 'rate', channel: 'w', s0, r: 120 }); s.brushTo(1); s.brushTo(2);
  assert.equal(v().track.how, 'drag'); s.endBrush();
  const want = createTrackModel(); want.update(s.getState().resolved);
  frame(); assert.equal(v().track.how, 'drag', 'the first frame after the release: still the drag\'s last frame (the build is under way)');
  let frames = 1; while (v().track.how === 'drag' && frames < 2000) { frame(); frames++; }
  assert.ok(frames > 3, `the exact road took ${frames} frames, a slice at a time`); assert.notEqual(v().track.how, 'drag');
  assert.equal(meshHash(v().track.mesh), meshHash(want.update(s.getState().resolved).mesh), 'and it is what a plain update builds, to the byte');
  // a new drag before the next release's build is whole: the build is finished at once, then the drag's frame is drawn from it
  s.beginBrush({ mode: 'rate', channel: 'w', s0, r: 120 }); s.brushTo(1); s.endBrush(); frame();
  assert.equal(v().track.how, 'drag', 'control: a second release, its build under way');
  s.beginBrush({ mode: 'rate', channel: 'w', s0, r: 120 }); s.brushTo(0.5);
  assert.equal(v().track.how, 'drag', 'the new drag\'s frame'); assert.ok(v().track.drag && v().track.drag.base, 'drawn from a finished base');
  // and the build it finished does not land later, over the drag: frames pass with the drag still open, and every one shows the drag's frame
  for (let i = 0; i < 1500; i++) { s.brushTo(0.5 + (i % 50) / 100); frame();   // longer than any build here takes, so a build left running would land inside it
    assert.equal(v().track.how, 'drag', `frame ${i + 1} of the new drag shows the drag's frame`); }
  s.endBrush(); for (let i = 0; i < 2000 && v().track.how === 'drag'; i++) frame();
  assert.notEqual(v().track.how, 'drag'); p.dispose(); assert.ok(d);
});

test('row 4: a ramp\'s blended cross-section is kept for frozen inputs and is the very mesh unfrozen inputs give; a changed from-profile is never served a kept shape', async () => {
  // a tube whose sweep ramps (each chord blends over the piece's frozen row grid: what the memo keeps; a cup has no grid of its own and never reaches it), and the same segments unfrozen
  const s = await createCoreShell({ autosaveMs: 0 });
  s.extend({ length: 200, first: { w: 31, t: 200 } }); s.extend({ length: 200, transition: 120, targets: { t: 300 } });
  const r = s.getState().resolved, segs = r.segments, ramped = segs.filter((g) => g.blend && Object.isFrozen(g.blend.from) && Array.isArray(g.fractions) && Object.isFrozen(g.fractions));
  assert.ok(ramped.length > 10 && Object.isFrozen(segs[0]), `control: ${ramped.length} chords whose ramp the memo keeps (from-profile and row grid frozen), the shell's segments frozen`);
  const thaw = (g) => JSON.parse(JSON.stringify(g)), loose = segs.map(thaw);
  const path = G.buildPath(segs, { step: 2, start: r.start });
  const once = meshHash(G.buildMesh(path, segs)), twice = meshHash(G.buildMesh(path, segs)), plain = meshHash(G.buildMesh(path, loose));
  assert.equal(twice, once, 'built again from the kept shapes: the same mesh to the byte');
  assert.equal(once, plain, 'and the same as unfrozen inputs, blended afresh row by row');
  // the same chords with their ramps from a different profile (the edge raised): never the kept shapes of the first
  const other = segs.map((g) => (g.blend ? Object.freeze({ ...g, blend: Object.freeze({ ...g.blend, from: Object.freeze({ ...g.blend.from, psi: Object.freeze(g.blend.from.psi.map((x) => x * 1.1)) }) }) }) : g));
  const changed = meshHash(G.buildMesh(path, other)), changedPlain = meshHash(G.buildMesh(path, other.map(thaw)));
  assert.notEqual(changed, once, 'control: a different ramp is a different mesh'); assert.equal(changed, changedPlain, 'and it is the one unfrozen inputs give');
});
