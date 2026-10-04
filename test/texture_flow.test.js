// texture_flow.test.js: node --test test/texture_flow.test.js   (under the heavy-run lock, --max-old-space-size=4096; about a minute)
// D228: a real road texture on the equation-core tracks, the tube included. Rows:
//   1  a core export WITH a texture set writes its DDS and its material (and the kn5 reads back wearing it)
//   2  WITHOUT a set the export is what it was (the scene is returned as is, no cell's uvs change; the nine fixtures are core_cup_fixtures row 5a)
//   3  the coordinates FLOW along the path: continuous through every 2 m segment, where mesh.js restarts them every segment
//   4  a closed tube wraps a whole number of repeats round, with no stretch beyond the rounding: the seam is at the ceiling
//   5  an open road keeps its across coordinates; a seam row takes the path's own arc length
//   6  a word document's coordinates are untouched by a set
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const G = require('../src/geom/index.js');
const FW = require('../src/export/fromwords.js');
const T = require('../src/texture/index.js');
const { flowUvs, closedRing } = require('../src/texture/flow.js');
const { startLayout } = require('../app/core/coreshell.js');
const { createCoreTextures, ASPHALT } = require('../app/core/textures.js');
const { readKn5 } = require('../tools/kn5.cjs');

const Rr = 180, Q = (Math.PI * Rr) / 2;
function lap(first) {
  let d = extend(D.createDoc('flow lap'), { length: 300, ...(first ? { first } : { family: 'bowl' }) });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const tubeOval = (w) => lap({ w, t: 360 });
const plainOval = (w) => lap({ w });
/** The export route the app uses, with an optional texture set. */
function exportDoc(doc, textures) {
  const segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  return FW.buildFromSegments(segs, { name: 'flow', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start), ...(textures !== undefined ? { textures } : {}) });
}
const setFor = (doc, kind = 'asphalt') => { const ctl = createCoreTextures({ segments: () => A.toSegments(doc), kind }); return ctl.current(); };
const roadNodes = (scene) => scene.root.children.filter((c) => c.children && c.children[0] && /^1ROAD_/.test(c.children[0].name)).map((c) => c.children[0]);

test('row 1: a core export WITH a texture set writes its DDS and its material, and the kn5 reads back with the road wearing it', () => {
  const doc = plainOval(31), set = setFor(doc);
  assert.ok(set && set.textures.length === 1 && set.textures[0].made, 'the default set is the made asphalt');
  assert.equal(set.bySegment('p1').floor.settings.make, ASPHALT);
  const out = exportDoc(doc, set), tex = set.textures[0], mat = set.materials.find((m) => m.slot === 'floor').material;
  const dds = out.scene.textures.find((t) => t.name === tex.file); assert.ok(dds, `the scene carries ${tex.file}`); assert.ok(Buffer.from(dds.data).equals(Buffer.from(tex.dds)), 'the DDS bytes are the set\'s, byte for byte');
  const mi = out.scene.materials.findIndex((m) => m.name === mat.name); assert.ok(mi >= 0, `the scene carries the material ${mat.name}`); assert.equal(out.scene.materials[mi].samplers[0].texture, tex.file);
  const nodes = roadNodes(out.scene); assert.ok(nodes.length > 100 && nodes.every((n) => n.material === mi), 'every road mesh wears the floor material');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-flow-')), f = path.join(tmp, 'x.kn5');
  try { fs.writeFileSync(f, out.kn5); const back = readKn5(f); assert.ok(back.meshes.some((m) => /^1ROAD_p1_/.test(m.name) && m.material === mat.name), 'read back: a road mesh wears the material'); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('row 2: WITHOUT a set nothing changes: the scene is returned as it is and flowUvs has nothing to do', () => {
  const doc = plainOval(31), segs = A.toSegments(doc), { path: p } = A.toPath(doc), mesh = G.buildMesh(p, segs);
  assert.equal(T.withTextureSet(mesh.scene, mesh, segs, null), mesh.scene, 'no set: the very same scene');
  assert.equal(flowUvs(mesh, segs, null).size, 0);
  const solid = setFor(doc, 'solid'); assert.equal(solid, null, 'a solid colour is no set at all');
  const a = exportDoc(doc), b = exportDoc(doc, null); assert.ok(a.kn5.equals(b.kn5), 'a null set and no set are the same export');
});

test('row 3: with a set the coordinates FLOW: v is the path\'s arc length over 10, continuous through every segment and seam; mesh.js restarts it every segment', () => {
  const doc = plainOval(31), segs = A.toSegments(doc), { path: p } = A.toPath(doc), mesh = G.buildMesh(p, segs), set = setFor(doc);
  const flow = flowUvs(mesh, segs, set); assert.ok(flow.size >= mesh.cells.length - 5, `${flow.size} of ${mesh.cells.length} cells are textured`);
  const kids = mesh.scene.root.children, node = (cell) => kids[mesh.cells.indexOf(cell)].children[0];
  const restarts = mesh.cells.filter((c) => !c.seam && node(c).uvs[1] === 0).length;
  assert.ok(restarts > 100, `control: mesh.js's own v restarts at 0 in ${restarts} cells (every segment)`);
  let prevEnd = null, worstEnd = 0, worstJoin = 0;
  const flowOf = (cell) => flow.get(node(cell));
  for (const cell of mesh.cells) {
    const u = flowOf(cell); assert.ok(u, `${cell.name} is textured`);
    const K = u.length / 2 / (cell.seam ? 1 : 2);
    if (cell.seam) { for (let i = 0; i < u.length / 2; i++) worstEnd = Math.max(worstEnd, Math.abs(u[i * 2 + 1] - cell.s0 / 10)); continue; }
    worstEnd = Math.max(worstEnd, Math.abs(u[1] - cell.s0 / 10), Math.abs(u[u.length - 1] - cell.s1 / 10));
    if (prevEnd !== null && prevEnd.piece === cell.piece) worstJoin = Math.max(worstJoin, Math.abs(prevEnd.v - u[1]));
    prevEnd = { piece: cell.piece, v: u[u.length - 1] }; assert.ok(Number.isInteger(K));
  }
  assert.ok(worstEnd < 1e-4, `a cell's v follows its own s0 and s1 (worst ${worstEnd})`); assert.ok(worstJoin < 1e-4, `the next cell starts where the last ended (worst ${worstJoin})`);
  let segJoin = 0; for (let g = 1; g < segs.length; g++) { const a = mesh.cells.filter((c) => c.piece === g - 1 && !c.seam).pop(), b = mesh.cells.find((c) => c.piece === g && !c.seam); if (a && b) segJoin = Math.max(segJoin, Math.abs(flowOf(a)[flowOf(a).length - 1] - flowOf(b)[1])); }
  assert.ok(segJoin < 1e-3, `v is continuous across segment boundaries (worst jump ${segJoin} tiles)`);
});

test('row 4: a CLOSED TUBE wraps a whole number of repeats round the ring, evenly: no stretch beyond the rounding, and the ends meet at the ceiling', () => {
  for (const [w, n] of [[31, 3], [40, 4], [37, 4]]) {
    const doc = tubeOval(w), segs = A.toSegments(doc), { path: p } = A.toPath(doc), mesh = G.buildMesh(p, segs), set = setFor(doc);
    assert.ok([0, 100, 400].every((i) => closedRing(segs[i])), `w ${w}: this tube is closed from its first metre: the first segment, one 200 m in and one in the turns are rings`);
    const flow = flowUvs(mesh, segs, set), kids = mesh.scene.root.children, at = mesh.cells.findIndex((c) => !c.seam && c.piece === 100), cell = mesh.cells[at], K = mesh._state.pieces[100].K;
    const old = kids[at].children[0].uvs, nu = flow.get(kids[at].children[0]);
    for (let r = 0; r < nu.length / 2 / K; r++) {
      const row = (k) => nu[(r * K + k) * 2], arc = (k) => old[(r * K + k) * 2] * 10, width = arc(K - 1) - arc(0);
      assert.ok(Math.abs(row(K - 1) - row(0) - n) < 1e-4, `w ${w}: the ring runs ${n} repeats, got ${row(K - 1) - row(0)}`);
      for (let k = 0; k + 1 < K; k++) { const rate = (row(k + 1) - row(k)) / (arc(k + 1) - arc(k)); assert.ok(Math.abs(rate - n / width) < 1e-4 * n, `w ${w} row ${r} vertex ${k}: the density is ${rate} per metre, even round the ring (${n / width})`); }
    }
    const tileM = w / n; assert.ok(Math.abs(tileM / 10 - 1) < 0.25, `w ${w}: a repeat is ${tileM.toFixed(2)} m against the 10 m tile: the rounding is under 25%`);
    assert.ok(Math.abs(nu[(0 * K + 0) * 2] + n / 2) < 1e-4 && Math.abs(nu[(0 * K + K - 1) * 2] - n / 2) < 1e-4, 'the two ends of the ring, at the ceiling, are -n/2 and +n/2: the seam sits at the ceiling');
  }
});

test('row 5: an open road keeps u = arc / 10 across (only v flows), and an OPEN tube is not wrapped', () => {
  const doc = plainOval(31), segs = A.toSegments(doc), { path: p } = A.toPath(doc), mesh = G.buildMesh(p, segs), flow = flowUvs(mesh, segs, setFor(doc));
  assert.ok(!closedRing(segs[0]));
  for (const cell of mesh.cells.filter((c) => !c.seam).slice(0, 40)) {
    const kid = mesh.scene.root.children[mesh.cells.indexOf(cell)].children[0], old = kid.uvs, nu = flow.get(kid);
    for (let i = 0; i < old.length / 2; i++) assert.ok(Math.abs(old[i * 2] - nu[i * 2]) < 1e-6, `${cell.name}: u changed`);
  }
  let d = extend(D.createDoc('open tube'), { length: 80, first: { w: 31 } }); d = extend(d, { length: 100, transition: 100, targets: { t: 200 } });
  const s2 = A.toSegments(d); assert.ok(s2.every((g) => !closedRing(g)), 'a tube swept to 200 degrees is open: no ring');
});

test('row 5b: the seam rows of a tube that changes carry the path\'s arc length at the seam, one value for the whole row', () => {
  const doc = tubeOval(31), segs = A.toSegments(doc), { path: p } = A.toPath(doc), mesh = G.buildMesh(p, segs), flow = flowUvs(mesh, segs, setFor(doc));
  const seams = mesh.cells.filter((c) => c.seam);
  for (const c of seams) { const u = flow.get(mesh.scene.root.children[mesh.cells.indexOf(c)].children[0]); assert.ok(u, `${c.name} is textured`); const v = u[1]; for (let i = 0; i < u.length / 2; i++) assert.equal(u[i * 2 + 1], v); assert.ok(Math.abs(v - c.s0 / 10) < 1e-4); }
  assert.ok(seams.length >= 1, `control: the tube lap has ${seams.length} seam row(s) (the section changes there)`);
});

test('row 6: a WORD document\'s coordinates are untouched by a set (flow is for the equation core only)', () => {
  const Dw = require('../src/doc/index.js');
  let d = Dw.createDoc('w'); for (const w of ['straight', 'straight']) d = Dw.appendWord(d, w, { speed: 200 / 3.6 });
  d = Dw.editWord(d, 'w1', { textures: { floor: { make: ASPHALT } } });
  const segs = Dw.resolve(d).segments, mesh = G.buildMesh(G.buildPath(segs), segs), set = T.buildTextureSet(d, {});
  assert.ok(set.bySegment('w1').floor.settings.make, 'control: word w1 wears a made floor');
  assert.equal(flowUvs(mesh, segs, set).size, 0, 'a word document is not a core track: mesh.js\'s coordinates stand');
  assert.ok(segs.every((g) => g.word !== 'core'));
});
