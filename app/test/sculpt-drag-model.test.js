// sculpt-drag-model.test.js: node --test app/test/sculpt-drag-model.test.js
// D421 part 4, THE SCULPT DRAG'S FRAME in the preview's track model (app/preview/trackmodel.js update(resolved, { drag }), app/preview/coarse.js mergeChords and sameSegment;
// design exo_memory/loop/design_d421_sculpt_P_2026-10-20.md §4.3): what a brush step draws, in node, with the real shell. The frame's TIME is app/test/sculpt-frame.test.js
// (A's, on the real page). Rows:
//   1  mergeChords: a piece's 2 m chords become a few long ones, within the heading cap, never across two pieces or a gap; one chord stays the very same object
//   2  a drag step builds nothing placed: how 'drag', the placed path and mesh are the very ones, every batch outside the window is the placed batch itself, the window is
//      drawn from a few dozen chords, and after the drag the release equals a fresh build
//   3  a route step on an OPEN track moves the road after the window as one piece: its batches carry the placed vertex arrays and lie within 2 cm of an exact build's
//   4  a route step on a CLOSED lap leaves it open while the drag lasts: the joint's seam is hidden and the gap from the moved end to the start is a line of that length
//   5  a hill (Grab, the lift): the window is the brush's span, and the ghost stands on the hill (its road is lifted where the exact build's is)
//   6  coarsen keeps a frozen segment frozen (A's D421 §1.3), so the track model keys its coarse copy once
//   7  the renderer draws a moved batch (xform) from its baked chunk under the move: a new move uploads nothing, and the picture is the moved matrices'
// The preview's side (a drag never rebuilds, the release in the next animation frame) is app/test/preview-speed.test.js row 4.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const C = require('../preview/coarse.js');

const R = 180, DEG = Math.PI / 180;
async function openTrack() {
  const s = await createCoreShell({ autosaveMs: 0 });
  s.extend({ length: 200, family: 'bowl' }); for (let i = 1; i < 8; i++) s.extend({ length: 200, transition: 40, targets: { kh: (i % 2 ? 12 : -12) * DEG / 200 } });
  assert.equal(s.getState().message, null, s.getState().message); return s;
}
async function closedTrack() {
  const s = await createCoreShell({ autosaveMs: 0 });
  s.extend({ length: 400, family: 'bowl' }); s.extend({ length: Math.PI * R, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 400, transition: 40, targets: { kh: 0 } }); s.extend({ length: Math.PI * R, transition: 40, targets: { kh: 1 / R } }); s.close();
  assert.equal(s.getState().history.present.closed, true, s.getState().message); return s;
}
const mid = (d, i) => d.pieces.slice(0, i).reduce((a, P) => a + P.length, 0) + d.pieces[i].length / 2;
const mul4 = (A, B) => { const C = new Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) C[r * 4 + c] = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c] + A[r * 4 + 3] * B[12 + c]; return C; };
/** a vertex of a batch in the world: local · model, then the batch's rigid move when it has one (xform, the road after a sculpted window: renderer.js chunkModel) */
const world = (bt, k, M = bt.xform ? mul4(bt.model, bt.xform) : bt.model) => { const p = [bt.positions[k * 3], bt.positions[k * 3 + 1], bt.positions[k * 3 + 2]]; return [0, 1, 2].map((c) => p[0] * M[c] + p[1] * M[4 + c] + p[2] * M[8 + c] + M[12 + c]); };
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
/** the placed batch of segment g, found by its CELL (by position: batches.js keeps the cells' order) */
const batchOf = (res, g) => { const k = res.mesh.cells.findIndex((c) => c.piece === g && !c.seam); return k < 0 ? null : res.batches[k]; };
/** a brush drag with the model fed every step, as the preview feeds it */
function drag(s, tm, b, deltas) {
  s.beginBrush(b); assert.ok(s.getState().brush, `the brush opened: ${s.getState().message}`);
  let fr = null; for (const dl of deltas) { s.brushTo(dl); const st = s.getState(); assert.ok(st.brush, `the step held: ${st.message}`); fr = tm.update(st.resolved, { drag: st.brush }); }
  return fr;
}

test('row 1: mergeChords makes a piece\'s 2 m chords a few long ones, within the heading cap, never across two pieces or a gap; one chord is the very same object', async () => {
  const s = await openTrack(), segs = s.getState().resolved.segments, two = segs.filter((g) => g.id === segs[0].id || g.id === segs[segs.length - 1].id);
  const m = C.mergeChords(segs, { maxTurn: 0.03 });
  assert.ok(segs.length > 700 && m.length < segs.length / 8, `${segs.length} chords became ${m.length}`);
  const total = (l) => l.reduce((a, g) => a + g.length, 0); assert.ok(Math.abs(total(m) - total(segs)) < 1e-6, 'the same length');
  for (const g of m) { const turn = Math.abs(((g.k0 || 0) + (g.k1 || 0)) / 2 * g.length); assert.ok(turn <= 0.03 + 1e-9, `a merged chord turns ${turn} rad`); }
  const ids = (l) => l.map((g) => g.id); assert.deepEqual([...new Set(ids(m))], [...new Set(ids(segs))], 'the pieces in the same order');
  for (let i = 1; i < m.length; i++) if (m[i].id === m[i - 1].id) continue; else assert.notEqual(m[i].id, m[i - 1].id);
  assert.ok(m.every((g) => segs.filter((x) => x.id === g.id).length > 0), 'every merged chord is of one piece');
  assert.equal(C.mergeChords([segs[3]])[0], segs[3], 'one chord stays the very same object');
  const gap = { kind: 'gap', id: 'jump', length: 50 }, withGap = [...two.slice(0, 5), gap, ...two.slice(0, 5).map((g) => ({ ...g }))];
  const mg = C.mergeChords(withGap); assert.ok(mg.includes(gap), 'a gap is kept as it is'); assert.ok(mg.indexOf(gap) > 0 && mg.indexOf(gap) < mg.length - 1, 'and nothing merges across it');
  assert.equal(C.mergeChords([]).length, 0, 'empty in, empty out'); assert.equal(C.sameSegment(segs[3], { ...segs[3] }), true, 'an equal copy is the same segment');
  assert.equal(C.sameSegment(segs[3], { ...segs[3], k1: segs[3].k1 + 1e-6 }), false, 'a changed rate is not');
});

test('row 2: a drag step builds nothing placed: how "drag", the placed path and mesh the very ones, every other batch the placed one, the window a few dozen chords; the release equals a fresh build', async () => {
  const s = await openTrack(), tm = createTrackModel(), base = tm.update(s.getState().resolved), d = s.getState().history.present;
  const fr = drag(s, tm, { mode: 'rate', channel: 'phi', s0: mid(d, 4), r: 50 }, [0.05, 0.1, 0.15]);   // r under half the piece: the shell converts the whole piece again, the window is the brushed part
  assert.equal(fr.how, 'drag'); assert.equal(fr.path, base.path, 'the placed path, not rebuilt'); assert.equal(fr.mesh, base.mesh, 'the placed mesh, not rebuilt');
  const w = fr.drag.window; assert.ok(w.to > w.from && w.to - w.from <= 80, `the window is the brushed stretch: segments ${w.from} to ${w.to}`);
  const s0 = mid(d, 4), wA = base.path.starts[w.from].s, wB = base.path.starts[w.to].s;   // the brush's span, give or take a knot span (20 m): not the whole piece the shell converted again
  assert.ok(wA >= s0 - 50 - 20 && wB <= s0 + 50 + 20, `the window ${wA.toFixed(0)} to ${wB.toFixed(0)} m lies within the brush's span ${s0 - 50} to ${s0 + 50}, a knot span either side`);
  assert.ok(fr.drag.chords <= 60 && fr.drag.chords < w.to - w.from, `the window drawn from ${fr.drag.chords} chords, not ${w.to - w.from}`);
  const placed = new Set(base.batches), ghosts = fr.batches.filter((b) => !placed.has(b));
  assert.equal(ghosts.length, fr.batches.filter((b) => String(b.key).startsWith('drag:')).length, 'every batch that is not a placed one is the window\'s ghost');
  const inWindow = base.mesh.cells.filter((c) => c.piece >= w.from && c.piece < w.to).length;
  assert.equal(fr.batches.length - ghosts.length, base.batches.length - inWindow - base.mesh.cells.filter((c) => c.seam && (c.piece === w.from || c.piece === w.to)).length, 'the window\'s placed batches (and its two seams) are hidden, the rest kept');
  assert.equal(fr.drag.moved, false, 'a bank brush moves no road after the window'); assert.equal(fr.drag.gap, null);
  s.endBrush();
  const rel = tm.update(s.getState().resolved), fresh = createTrackModel().update(s.getState().resolved);
  assert.notEqual(rel.how, 'drag'); assert.equal(rel.batches.length, fresh.batches.length, 'the release: as many batches as a fresh build');
  for (let k = 0; k < rel.batches.length; k += 37) assert.ok(dist(world(rel.batches[k], 0), world(fresh.batches[k], 0)) < 1e-9, `batch ${k} is where a fresh build puts it`);
});

test('row 3: a route step on an OPEN track moves the road after the window as one piece, the placed vertex arrays within 2 cm of an exact build', async () => {
  const s = await openTrack(), tm = createTrackModel(), base = tm.update(s.getState().resolved), d = s.getState().history.present;
  const fr = drag(s, tm, { mode: 'rate', channel: 'kh', s0: mid(d, 3), r: 100 }, [0.0004, 0.0008]);
  assert.equal(fr.how, 'drag'); assert.equal(fr.drag.moved, true, 'a bend moves the road after it'); assert.equal(fr.drag.gap, null, 'an open track has no gap');
  const ex = createTrackModel().update(s.getState().resolved), w = fr.drag.window;
  let worst = 0, n = 0;
  for (const off of [2, 40, 200]) {
    const was = batchOf(base, w.to + off), want = batchOf(ex, w.toNew + off); if (!was || !want) continue;
    const got = fr.batches.find((b) => b.positions === was.positions); assert.ok(got, `segment ${w.to + off}: drawn from its placed arrays`); assert.equal(got.model, was.model, 'its placed matrix kept'); assert.ok(got.xform, 'and the move beside it');
    for (const k of [0, (was.positions.length / 6) | 0, was.positions.length / 3 - 1]) { worst = Math.max(worst, dist(world(got, k), world(want, k))); n++; }
  }
  assert.ok(n >= 6 && worst < 0.02, `the moved road lies within ${worst.toExponential(2)} m of the exact build (${n} vertices)`);
  const before = batchOf(base, w.from - 3); assert.ok(fr.batches.includes(before), 'the road before the window is the placed batch itself');
  s.endBrush();
});

test('row 4: a route step on a CLOSED lap leaves it open while the drag lasts: the joint\'s seam hidden, the gap a line from the moved end to the start', async () => {
  const s = await closedTrack(), d = s.getState().history.present;
  const st0 = s.getState().resolved;
  // the step the release re-closes: a heading brush on the first straight, the shell's own segments for it with no per-step close (D421 part 2 removes that)
  const P = d.pieces[0], bent = { ...d, pieces: [{ ...P, channels: { ...P.channels, kh: P.channels.kh.map((v, i, a) => (i > 2 && i < a.length - 3 ? v + 0.0006 : v)) } }, ...d.pieces.slice(1)] };
  const { toSegments } = require('../../src/core/adapter.js');
  const segs = toSegments(bent);
  // both forms of a step: the lap still marked closed (a shell that re-closes per step) and the lap OPENED for the drag (D421 part 2's route tools re-close on release only)
  for (const closed of [true, false]) {
  const tm = createTrackModel(), base = tm.update(s.getState().resolved);
  const resolved = Object.freeze({ ...st0, closed, segments: Object.freeze(segs.map((g, j) => (j >= segs.length - 600 && st0.segments[j] && C.sameSegment(g, st0.segments[j]) ? st0.segments[j] : g))) });
  const fr = tm.update(resolved, { drag: { mode: 'rate', channel: 'kh', s0: P.length / 2, r: P.length / 2 } });
  assert.equal(fr.how, 'drag'); assert.equal(fr.drag.moved, true, 'the road after the window moved');
  assert.ok(fr.drag.gap && fr.drag.gap.metres > 0.5, `the lap is drawn open: a gap of ${fr.drag.gap && fr.drag.gap.metres} m`);
  const g = fr.drag.gap.positions; assert.equal(g.length, 6, 'one line');
  assert.ok(dist([g[3], g[4], g[5]], base.path.samples[0].pos) < 1e-9, 'it ends at the lap\'s start');
  const joint = base.mesh.cells.findIndex((c) => c.seam && c.piece === 0);
  if (joint >= 0) assert.ok(!fr.batches.includes(base.batches[joint]), 'the joint\'s seam is hidden');
  assert.equal(fr.path, base.path, 'nothing closed: the placed path is the one on show');
  }
});

test('row 5: a hill (Grab, the lift): the window is the brush\'s span, and the ghost stands on the hill', async () => {
  const s = await openTrack(), tm = createTrackModel(), base = tm.update(s.getState().resolved), d = s.getState().history.present, s0 = mid(d, 4);
  const fr = drag(s, tm, { mode: 'local', channel: 'height', s0, r: 150 }, [2, 4]);
  assert.equal(fr.how, 'drag'); assert.equal(fr.drag.moved, false, 'a hill moves no road after it');
  const w = fr.drag.window, sA = base.path.starts[w.from].s, sB = base.path.starts[w.to] ? base.path.starts[w.to].s : base.path.lengthM;
  assert.ok(sA <= s0 - 150 + 2 && sB >= s0 + 150 - 2 && sB - sA < 300 + 30, `the window ${sA.toFixed(0)} to ${sB.toFixed(0)} m is the span ${s0 - 150} to ${s0 + 150}`);
  const ex = createTrackModel().update(s.getState().resolved), top = (bs) => Math.max(...bs.map((b) => world(b, (b.positions.length / 6) | 0)[1]));
  const ghost = fr.batches.filter((b) => String(b.key).startsWith('drag:')), exact = ex.mesh.cells.map((c, k) => (!c.seam && c.piece >= w.from && c.piece < w.to ? ex.batches[k] : null)).filter(Boolean);
  const placed = base.mesh.cells.map((c, k) => (!c.seam && c.piece >= w.from && c.piece < w.to ? base.batches[k] : null)).filter(Boolean);
  assert.ok(top(exact) > top(placed) + 3, 'control: the exact build is lifted by the hill');
  assert.ok(Math.abs(top(ghost) - top(exact)) < 0.5, `the ghost's crest ${top(ghost).toFixed(2)} m stands where the exact one's ${top(exact).toFixed(2)} does`);
  s.endBrush();
});

test('row 6: coarsen keeps a frozen segment frozen (A\'s D421 §1.3), so the track model keys its coarse copy once; an unfrozen segment stays unfrozen', async () => {
  const s = await openTrack(), segs = s.getState().resolved.segments, withGrid = segs.find((g) => Array.isArray(g.fractions) && g.fractions.length > 2) || null;
  const frozen = Object.freeze({ ...segs[5], fractions: Object.freeze(Array.from({ length: 13 }, (_, i) => i / 12)) }), loose = { ...segs[6], fractions: Array.from({ length: 13 }, (_, i) => i / 12) };
  const [cf, cl] = C.coarsen([frozen, loose], 6);
  assert.notEqual(cf, frozen, 'control: the grid was thinned (a new segment)'); assert.ok(cf.fractions.length < 13);
  assert.equal(Object.isFrozen(cf), true, 'the coarse copy of a frozen segment is frozen');
  assert.equal(Object.isFrozen(cl), false, 'the coarse copy of an unfrozen one is not');
  assert.equal(C.coarsen([frozen], 6)[0], cf, 'and it is the same object on the next call');
  if (withGrid) assert.equal(Object.isFrozen(C.coarsen([withGrid], 6)[0]), Object.isFrozen(withGrid), 'a shell segment with a grid keeps its frozenness');
});
test('row 7: the renderer draws a moved batch (xform) from its baked chunk under the move: a new move uploads nothing, and the picture is the one the moved matrices give', async () => {
  const { createRenderer } = require('../preview/renderer.js');
  // a fake GL that keeps the arrays it is given, and for each draw the first vertex array pointed at since the last one (the positions: the renderer points them first) and its matrix
  const fake = () => { const data = new Map(), bound = {}, drawn = []; let id = 0, uploads = 0, model = null, ptrs = [];
    const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13, BLEND: 14, LINES: 15, SRC_ALPHA: 17, ONE_MINUS_SRC_ALPHA: 18,
      depthMask() {}, blendFunc() {}, disableVertexAttribArray() {}, createShader: () => ({ id: ++id }), shaderSource() {}, compileShader() {}, getShaderParameter: () => true, getShaderInfoLog: () => '', createProgram: () => ({ id: ++id }), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, getProgramInfoLog: () => '',
      getAttribLocation: () => 0, getUniformLocation: (p, n) => n, useProgram() {}, viewport() {}, clearColor() {}, clear() {}, enable() {}, disable() {}, uniform3f() {}, uniform1f() {}, uniform2f() {}, enableVertexAttribArray() {}, vertexAttribPointer() { ptrs.push(data.get(bound[5])); },
      uniformMatrix4fv(loc, t, m) { if (loc === 'uModel') model = Array.from(m); }, createBuffer: () => ({ id: ++id }), bindBuffer(t, b) { bound[t] = b; }, bufferData(t, arr) { data.set(bound[t], arr); uploads++; }, deleteBuffer() {}, deleteProgram() {},
      drawElements(mode, count) { drawn.push({ pos: ptrs[0], idx: data.get(bound[6]), model }); ptrs = []; }, drawArrays() {} };
    return { gl, drawn, uploads: () => uploads }; };
  const worldOf = (d) => { const out = []; for (const i of d.idx) { const p = [d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]], M = d.model; out.push([0, 1, 2].map((c) => p[0] * M[c] + p[1] * M[4 + c] + p[2] * M[8 + c] + M[12 + c])); } return out; };
  const s = await openTrack(), base = createTrackModel().update(s.getState().resolved), pose = { eye: [0, 300, -300], target: [0, 0, 400], up: [0, 1, 0], fov: 1 };
  // the moved road begins mid-chunk (not on a chunk boundary), as the road after a window does: a chunk must never hold both
  const half = Math.floor(base.batches.length / 2) + 7, move = (th, dx) => [Math.cos(th), 0, -Math.sin(th), 0, 0, 1, 0, 0, Math.sin(th), 0, Math.cos(th), 0, dx, 0, 3, 1];
  const withMove = (X) => base.batches.map((b, k) => (k >= half ? { ...b, xform: X } : b)), baked = (X) => base.batches.map((b, k) => (k >= half ? { ...b, model: mul4(b.model, X) } : b));
  const A = fake(), r = createRenderer(A.gl, { chunkVertices: 4000 });
  r.draw(withMove(move(0.01, 1)), pose, { width: 800, height: 600 }, { look: 'words', lines: false }); const after1 = A.uploads();
  A.drawn.length = 0; r.draw(withMove(move(0.03, 4)), pose, { width: 800, height: 600 }, { look: 'words', lines: false });
  assert.equal(A.uploads(), after1, 'a new move of the same batches uploads nothing: the baked chunks are drawn under it');
  const B = fake(); createRenderer(B.gl, { chunkVertices: 4000 }).draw(baked(move(0.03, 4)), pose, { width: 800, height: 600 }, { look: 'words', lines: false });
  const a = A.drawn.flatMap(worldOf), b = B.drawn.flatMap(worldOf);
  assert.equal(a.length, b.length, 'as many triangle corners as the moved matrices draw');
  let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, dist(a[i], b[i]));
  assert.ok(worst < 1e-3, `every corner where the moved matrices put it (worst ${worst.toExponential(2)} m)`);
  assert.ok(A.drawn.some((d) => d.model[12] === 4), 'control: some chunk was drawn under the move');
});
