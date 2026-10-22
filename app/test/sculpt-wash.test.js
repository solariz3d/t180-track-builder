// sculpt-wash.test.js: node --test app/test/sculpt-wash.test.js
// D425 part 3 (P's design, exo_memory/handback/p-d425-sculpt-cues-P_2026-10-21.md §1 cue 4, §3's E rows): WHAT A SCULPT TOOL MOVES, drawn by the preview. A route tool (Stretch, Bend,
// Climb) moves all the road after its window: on hover that road is washed in the tool's colour, during the drag the moved batches carry a TINT the renderer draws their edge lines in
// (no draw or geometry added), and on a closed lap the last and first road pieces are hatched in the marker orange. In node, with the real shell. Rows:
//   1  a route step tints exactly the moved batches, in the tool's colour, with the placed arrays (Bend violet, Stretch white); a shape step (Twist) tints nothing
//   2  the renderer draws each tinted chunk's edge lines in its tint, every other line as before, with no draw and no upload added (CHANGED D425, see the row)
//   3  hover: a route tool's wash is a line across the road at every station past the window's end and nowhere before it; a shape or local tool has none; the same hover builds nothing again
//   4  a closed lap: the hover hatches the last and first road pieces (every other station); during a drag that opened the lap the last piece's hatch is drawn under the drag's move
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel, WASH } = require('../preview/trackmodel.js');
const { sculptCues } = require('../preview/preview.js');

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
/** a sculpt drag with the model fed every step, as the preview feeds it; returns the last frame */
function drag(s, tm, b, deltas) {
  s.setSculpt(true); s.beginBrush(b); assert.ok(s.getState().brush, `the brush opened: ${s.getState().message}`);
  let fr = null; for (const dl of deltas) { s.brushTo(dl); const st = s.getState(); assert.ok(st.brush, `the step held: ${st.message}`); fr = tm.update(st.resolved, { drag: st.brush }); }
  return fr;
}
const stationsOf = (pos) => pos.length / 6;

test('row 1: a route step tints exactly the moved batches in the tool\'s colour with the placed arrays; a shape step tints nothing', async () => {
  for (const [tool, colour, deltas] of [['bend', WASH.kh, [2e-4, 4e-4]], ['stretch', WASH.length, [5, 10]]]) {
    const s = await openTrack(), tm = createTrackModel(), base = tm.update(s.getState().resolved);
    const fr = drag(s, tm, { tool, s0: 500, r: 100 }, deltas);
    assert.equal(fr.how, 'drag'); assert.equal(fr.drag.moved, true, `${tool}: the road after the window moved`);
    const moved = fr.batches.filter((b) => b.xform), tinted = fr.batches.filter((b) => b.tint);
    assert.ok(moved.length > 0, `${tool}: some batches moved`);
    assert.equal(tinted.length, moved.length, `${tool}: as many batches tinted (${tinted.length}) as moved (${moved.length})`);
    assert.ok(moved.every((b) => b.tint), `${tool}: every moved batch is tinted`);
    assert.ok(tinted.every((b) => b.tint === colour), `${tool}: in the tool's colour`);
    const placed = new Set(base.batches.map((b) => b.positions));
    assert.ok(tinted.every((b) => placed.has(b.positions)), `${tool}: with the placed vertex arrays (no geometry added)`);
  }
  const s = await openTrack(), tm = createTrackModel(); tm.update(s.getState().resolved);
  const fr = drag(s, tm, { tool: 'twist', s0: 500, r: 100 }, [2 * DEG, 4 * DEG]);
  assert.equal(fr.how, 'drag'); assert.equal(fr.batches.filter((b) => b.tint).length, 0, 'Twist moves nothing after its window: nothing is tinted');
});

// CHANGED D425 (this lap, before landing): the wash was a second blended pass of each moved chunk's surfaces; it cost row 3 of sculpt-frame about 0.5-0.8 ms a frame, so it is now the
// colour of the moved road's edge lines, the uniform each chunk's lines set already. The rule this row holds is the same: the moved road is shown in the tool's colour, nothing is added
test('row 2: the renderer draws each tinted chunk\'s edge lines in its tint and every other line as before, with no draw and no upload added', async () => {
  const { createRenderer, COLOURS } = require('../preview/renderer.js');
  const fake = () => { const data = new Map(), bound = {}, lines = []; let id = 0, uploads = 0, draws = 0, colour = null;
    const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13, BLEND: 14, LINES: 15, SRC_ALPHA: 17, ONE_MINUS_SRC_ALPHA: 18,
      depthMask() {}, blendFunc() {}, disableVertexAttribArray() {}, createShader: () => ({ id: ++id }), shaderSource() {}, compileShader() {}, getShaderParameter: () => true, getShaderInfoLog: () => '', createProgram: () => ({ id: ++id }), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, getProgramInfoLog: () => '',
      getAttribLocation: () => 0, getUniformLocation: (p, n) => n, useProgram() {}, viewport() {}, clearColor() {}, clear() {}, enable() {}, disable() {}, uniform3f(loc, a, b, c) { if (loc === 'uColour') colour = [a, b, c]; }, uniform1f() {}, uniform2f() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
      uniformMatrix4fv() {}, createBuffer: () => ({ id: ++id }), bindBuffer(t, b) { bound[t] = b; }, bufferData(t, arr) { data.set(bound[t], arr); uploads++; }, deleteBuffer() {}, deleteProgram() {},
      drawElements() { draws++; }, drawArrays() { draws++; lines.push({ arr: data.get(bound[5]), colour }); } };
    return { gl, lines, uploads: () => uploads, draws: () => draws }; };
  const s = await openTrack(), tm = createTrackModel(); tm.update(s.getState().resolved);
  const fr = drag(s, tm, { tool: 'bend', s0: 500, r: 100 }, [2e-4, 4e-4]), pose = { eye: [0, 300, -300], target: [0, 0, 400], up: [0, 1, 0], fov: 1 };
  const plain = fr.batches.map((b) => { if (!b.tint) return b; const { tint, ...rest } = b; return rest; });
  const A = fake(); createRenderer(A.gl, { chunkVertices: 4000 }).draw(plain, pose, { width: 800, height: 600 }, { look: 'words' });
  const B = fake(); createRenderer(B.gl, { chunkVertices: 4000 }).draw(fr.batches, pose, { width: 800, height: 600 }, { look: 'words' });
  assert.equal(B.draws(), A.draws(), 'as many draws with the tint as without'); assert.equal(B.uploads(), A.uploads(), 'no buffer more is uploaded');
  assert.equal(B.lines.length, A.lines.length);
  const same = (c, d) => c.every((v, i) => Math.abs(v - d[i]) < 1e-12);
  let tinted = 0;
  for (let i = 0; i < A.lines.length; i++) {
    const a = A.lines[i], b = B.lines[i];
    if (same(b.colour, a.colour)) continue;
    assert.ok(same(a.colour, COLOURS.edge) && same(b.colour, WASH.kh), `line list ${i}: only an edge list changes colour, from the edge colour to the tint`);
    tinted++;
  }
  assert.ok(tinted > 0, 'the moved road\'s edges are drawn in the tint');
  assert.ok(tinted <= fr.batches.filter((b) => b.tint).length, 'no more tinted edge lists than moved batches');
});

test('row 3: hover: a route tool\'s wash is a line across the road at every station past the window\'s end; a shape or local tool has none; the same hover builds nothing again', async () => {
  const s = await openTrack(), tr = createTrackModel().update(s.getState().resolved), P = tr.path;
  const cues = sculptCues(tr, { s0: 500, r: 100, tool: 'bend' });
  assert.equal(cues.length, 1, 'an open track: the wash only, no hatch');
  const w = cues[0]; assert.equal(w.colour, WASH.kh); assert.equal(w.alpha, 0.18); assert.equal(w.blend, true);
  const after = P.samples.filter((x) => x.s >= 600);
  assert.equal(stationsOf(w.positions), after.length, `a line at every one of the ${after.length} stations past the window's end`);
  // each line lies across the road at its station: its middle is that station, lifted 5 cm
  for (let k = 0; k < after.length; k += 37) {
    const x = after[k], mid = [0, 1, 2].map((d) => (w.positions[k * 6 + d] + w.positions[k * 6 + 3 + d]) / 2);
    assert.ok(Math.hypot(...[0, 1, 2].map((d) => mid[d] - (x.pos[d] + 0.05 * x.U[d]))) < 1e-3, `line ${k} is across the road at s ${x.s}`);
  }
  assert.equal(sculptCues(tr, { s0: 500, r: 100, tool: 'bend' }), cues, 'the same hover: the very list, nothing built');
  assert.equal(sculptCues(tr, { s0: 500, r: 100, tool: 'twist' }), null, 'Twist moves nothing: no wash');
  assert.equal(sculptCues(tr, { s0: 500, r: 100, tool: 'grab-up' }), null, 'Grab leaves the road after it: no wash');
  assert.equal(sculptCues(tr, null), null, 'no hover: nothing');
  // Stretch's window is the piece under s0 (the third piece, 400 to 600 m), whatever the radius
  for (const [s0, r] of [[500, 100], [450, 10]]) {
    const st = sculptCues(tr, { s0, r, tool: 'stretch' });
    assert.equal(st[0].colour, WASH.length, 'Stretch washes white');
    assert.equal(stationsOf(st[0].positions), after.length, `Stretch at ${s0} m, r ${r}: from the end of the piece under the pointer`);
  }
});

test('row 4: a closed lap: the hover hatches the last and first road pieces; a drag that opened the lap draws the last piece\'s hatch under its move', async () => {
  const s = await closedTrack(), tm = createTrackModel(), tr = tm.update(s.getState().resolved), P = tr.path, segs = tr.segments;
  const cues = sculptCues(tr, { s0: 200, r: 100, tool: 'bend' });
  assert.equal(cues.length, 3, 'the wash and two hatches');
  const [, last, first] = cues;
  const idL = segs[segs.length - 1].id, idF = segs[0].id;
  const onPiece = (id) => P.samples.filter((x, i) => segs[x.seg] && segs[x.seg].id === id && i % 2 === 0).length;
  assert.equal(stationsOf(last.positions), onPiece(idL), 'the last piece: a line at every other station');
  assert.equal(stationsOf(first.positions), onPiece(idF), 'the first piece: a line at every other station');
  assert.deepEqual([last.colour, last.alpha, first.alpha], [[1, 0.55, 0.15], 0.6, 0.3], 'the marker orange, the first lighter');
  // the drag: a Bend on the second straight opens the lap; the hatch of the last piece moves with the road after the window
  const fr = drag(s, tm, { tool: 'bend', s0: 400 + Math.PI * R + 200, r: 100 }, [2e-4, 4e-4]);
  assert.equal(fr.how, 'drag'); assert.ok(fr.drag.gap, 'the lap is drawn open');
  const dc = sculptCues(fr, null);
  assert.ok(dc && dc.length >= 1, 'the drag has its hatch');
  assert.equal(dc[0].model, fr.drag.move, 'the last piece\'s hatch is drawn under the drag\'s move');
  assert.equal(dc[0].positions, last.positions, 'built once, from the placed path: the very lines of the hover');
  assert.equal(sculptCues(fr, null), dc, 'the same frame: nothing built again');
});
