// export_catch.test.js: node --test test/export_catch.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D341 (plan :876-884): a PHYSICAL CATCH under the road. The road is one zero-thickness surface (CSP's soft block, MAX_DEPTH 4) and UNDERSKIN is scenery, so nothing
// physical catches a body that crosses the road: on ELYSIUM's p18 (a sustained 56-62 g at 817 km/h) the box went through the road and the car fell 5 s. The export now lays a
// second road surface CATCH_OFFSET_M under the road cells where it is asked: `1ROAD_CATCH_…` (the ROAD surface and the soft block's `1ROAD?` already cover the name), the road's
// own winding and normals (it faces the driver, so a body coming through the road meets its front), no light, no shadow. `underCatch`: 'loaded' (the default: the stretches
// validation lists as load-sustained, plus CATCH_PAD_M each side), 'all', 'off', or an explicit list of { s0, s1 }. Rows:
//   1  which cells: off none, all every core road cell, ranges the cells that overlap a range widened by the pad, an empty list none; the ranges come from the amber list
//   2  one catch cell's geometry: the road's vertices CATCH_OFFSET_M against its normal, the road's normals and winding, columns kept to about 32, a seam row whole
//   3  an exported lap, 'off' and the default (a flat lap has no sustained load): the kn5 is the same bytes
//   4  'all': a closed underside under every road chunk, 1ROAD_CATCH_ chunks of their own, and NOTHING ELSE in the kn5 changes (every other mesh, the dummies and the existing materials hashed)
//   5  explicit ranges catch only the cells there; the surfaces.ini is the one of before (the catch needs no surface of its own)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs'), os = require('os'), path = require('path');
const C = require('../src/export/catch.js');
const TF = require('../src/export/trackfiles.js');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const AD = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const { startLayout } = require('../app/core/coreshell.js');
const { readKn5 } = require('../tools/kn5.cjs');

const core = { word: 'core' }, other = { word: 'straight' };
test('row 1: which cells: off none, all every core road cell, ranges the overlapping cells widened by the pad, an empty list none', () => {
  const cells = [{ piece: 0, s0: 0, s1: 100 }, { piece: 0, s0: 100, s1: 200 }, { piece: 1, s0: 200, s1: 300 }, { piece: 1, s0: 300, s1: 300, seam: true }, { piece: 2, s0: 300, s1: 400 }, { piece: 3, s0: 900, s1: 1000 }];
  const segs = [core, core, other, core];
  assert.deepEqual(C.catchCells(cells, segs, 'off'), []);
  assert.deepEqual(C.catchCells(cells, segs, 'all'), [0, 1, 2, 3, 5], 'cell 4 (piece 2, a word that is not core road) has none');
  assert.deepEqual(C.catchCells(cells, segs, []), [], 'an empty list: none');
  assert.equal(C.CATCH_PAD_M, 40);
  assert.deepEqual(C.catchCells(cells, segs, [{ s0: 130, s1: 150 }]), [0, 1], 'a range inside cell 1 takes it, and the pad of 40 m takes the cell before (it ends at 100, the range starts at 130)');
  assert.deepEqual(C.catchCells(cells, segs, [{ s0: 960, s1: 970 }]), [5], 'far from the rest');
  assert.deepEqual(C.catchCells(cells, segs, [{ s0: 300, s1: 300 }]), [2, 3], 'a seam row at the range counts, with the cell before it; cell 4 is not core road');
  assert.throws(() => C.catchCells(cells, segs, 'sometimes'), /underCatch/);
  assert.deepEqual(C.rangesOfAmber([{ reason: 'load-above-proven', s0: 1, s1: 2 }, { reason: 'load-sustained', s0: 8559, s1: 8897.5 }, { reason: 'roll-rate', s0: 5, s1: 6 }]), [{ s0: 8559, s1: 8897.5 }], 'only the sustained-load ambers');
});

/** A road cell mesh as geometry/mesh.js makes it: R rows of K vertices, an up normal, the road's quad winding (A, C, B) and (B, C, D). */
function cellMesh(R, K) {
  const positions = new Float32Array(R * K * 3), normals = new Float32Array(R * K * 3), uvs = new Float32Array(R * K * 2), idx = [];
  for (let r = 0; r < R; r++) for (let k = 0; k < K; k++) { const i = r * K + k; positions.set([k * 0.5, 10, r * 2], i * 3); normals.set([0, 1, 0], i * 3); uvs.set([k / (K - 1), r], i * 2); }
  for (let r = 0; r < R - 1; r++) for (let k = 0; k < K - 1; k++) { const A = r * K + k, B = A + 1, Cc = A + K, Dd = Cc + 1; idx.push(A, Cc, B, B, Cc, Dd); }
  return { type: 'mesh', name: '1ROAD_p3_body_0', material: 0, castShadows: true, visible: true, transparent: false, renderable: true, positions, normals, uvs, indices: new Uint16Array(idx) };
}
const facing = (m, t) => { const P = m.positions, I = m.indices, a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]; return u[2] * v[0] - u[0] * v[2]; };   // the y of u x v (the sign of the up component)

test('row 2: a catch cell is the road\'s own surface CATCH_OFFSET_M below it: its normals and winding, about 32 columns, a seam row whole, never visible', () => {
  const road = cellMesh(4, 100), k = C.catchOf(road, '1ROAD_CATCH_p3_body_0', 100);
  assert.equal(C.CATCH_OFFSET_M, 0.3);
  assert.equal(k.name, '1ROAD_CATCH_p3_body_0'); assert.equal(k.visible, false); assert.equal(k.renderable, false); assert.equal(k.castShadows, false);
  const cols = k.positions.length / 3 / 4; assert.ok(cols >= 20 && cols <= 40, `about 32 columns kept (every 4th of 100 and the last), not ${cols}`);
  for (let i = 0; i < k.positions.length / 3; i++) assert.ok(Math.abs(k.positions[i * 3 + 1] - (10 - C.CATCH_OFFSET_M)) < 1e-6, 'every vertex is 0.3 m under the road');
  for (let i = 0; i < k.normals.length; i += 3) assert.deepEqual([k.normals[i], k.normals[i + 1], k.normals[i + 2]], [0, 1, 0], 'the road\'s own normals: facing the driver');
  const last = (k.positions.length / 3 / 4 - 1) * 3; assert.equal(k.positions[last], 99 * 0.5, 'the last column is kept');
  assert.ok(facing(road, 0) * facing(k, 0) > 0, 'the winding is the road\'s: the same side faces up');
  for (let t = 0; t < k.indices.length; t += 3) assert.ok(facing(road, 0) * facing(k, t) > 0, `triangle ${t / 3} faces the way the road does`);
  const seam = cellMesh(2, 7), ks = C.catchOf(seam, '1ROAD_CATCH_p3_join_0', null);
  assert.equal(ks.positions.length, seam.positions.length, 'a seam row keeps every vertex'); assert.deepEqual(Array.from(ks.indices), Array.from(seam.indices), 'and the road\'s own triangles, not reversed');
  assert.ok(Math.abs(ks.positions[1] - (10 - 0.3)) < 1e-6);
});

/** A closed lap (the grip test's): a 300 m straight, four 90 m-radius quarter turns, 60 m, closed. Flat: its normal load is 1 g, so validation lists no sustained load. */
function lap() {
  let d = extend(D.createDoc('catch lap'), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Math.PI * 90, transition: 40, targets: { kh: 1 / 180 } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
function exportOf(doc, underCatch, mergeMeshes) {
  const segs = AD.toSegments(doc), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }, lift = (q) => AD.offsetPath(doc, segs, q);
  return FW.buildFromSegments(segs, { name: 'catch lap', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start), mergeMeshes, ...(underCatch === undefined ? {} : { underCatch }) });
}
const hash = (...bufs) => { const h = crypto.createHash('sha256'); for (const b of bufs) h.update(Buffer.from(b.buffer ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b)); return h.digest('hex').slice(0, 16); };

test('row 3: with no sustained load, the default export is the very kn5 of before (and so is \'off\')', () => {
  const base = lap(), off = exportOf(base, 'off'), def = exportOf(base);
  assert.ok(!def.validation.amber.some((a) => a.reason === 'load-sustained'), 'the flat lap has no sustained load');
  assert.equal(Buffer.compare(Buffer.from(def.kn5), Buffer.from(off.kn5)), 0, 'the default adds nothing where nothing is loaded');
  assert.ok(!def.warnings.some((w) => /catch/i.test(w)), 'and says nothing');
});

test('row 4: \'all\' lays a closed underside under every road chunk, in 1ROAD_CATCH_ chunks of their own, and nothing else in the kn5 changes', () => {
  const base = lap(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't180-catch-'));
  try {
    const read = (b) => { const f = path.join(tmp, `${Math.random()}.kn5`); fs.writeFileSync(f, Buffer.from(b.kn5)); return readKn5(f); };
    const meshHash = (m) => `${m.name} ${m.material} ${hash(m.pos)} ${hash(m.idx)}`;
    const off = exportOf(base, 'off'), all = exportOf(base, 'all'), koff = read(off), kall = read(all);
    const isCatch = (m) => /^1ROAD_CATCH_/.test(m.name);
    const roadOff = koff.meshes.filter((m) => /^1ROAD_/.test(m.name) && !/^1ROAD_PIT/.test(m.name)), catches = kall.meshes.filter(isCatch);
    assert.ok(catches.length > 0, 'catch meshes exist'); assert.ok(koff.meshes.every((m) => !isCatch(m)), 'and none without it');
    // nothing else changes: every non-catch mesh, byte for byte, in the same order
    assert.deepEqual(kall.meshes.filter((m) => !isCatch(m)).map(meshHash), koff.meshes.map(meshHash), 'every other mesh is the same, names and triangles');
    assert.ok(catches.every((m) => /^1ROAD_CATCH_[A-Za-z0-9]+_chunk_\d+$/.test(m.name)), `catch chunks are a class of their own, named for their piece and numbered from 0: ${catches.slice(0, 2).map((m) => m.name)}`);
    assert.ok(catches.some((m) => /_chunk_0$/.test(m.name)));
    assert.deepEqual(kall.dummies.map((d) => d.name), koff.dummies.map((d) => d.name), 'the markers are the same');
    assert.deepEqual(kall.materials.slice(0, koff.materials.length).map((m) => m.name), koff.materials.map((m) => m.name), 'the existing materials are first and the same');
    assert.equal(kall.materials.length, koff.materials.length + 1, 'and one is added: the catch\'s');
    assert.equal(Buffer.compare(Buffer.from(all.ai), Buffer.from(off.ai)), 0, 'the AI line is the same');
    // the closed underside: a catch vertex for every road vertex row's ends, and the catch lies inside the road's box widened by the offset
    const box = (ms) => { const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (const m of ms) for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], m.pos[i + k]); b[k + 3] = Math.max(b[k + 3], m.pos[i + k]); } return b; };
    const rb = box(roadOff), cb = box(catches);
    for (let k = 0; k < 3; k++) { assert.ok(cb[k] >= rb[k] - C.CATCH_OFFSET_M - 1e-3, `catch min ${k}`); assert.ok(cb[k + 3] <= rb[k + 3] + C.CATCH_OFFSET_M + 1e-3, `catch max ${k}`); }
    const tri = (ms) => ms.reduce((a, m) => a + m.idx.length / 3, 0);
    assert.ok(tri(catches) > 0.3 * tri(roadOff) && tri(catches) < 1.05 * tri(roadOff), `about the road's triangle count, decimated across: ${tri(catches)} against ${tri(roadOff)}`);
    // the unmerged export: one catch cell per core road cell, each 0.3 m under its road cell
    const rawOff = read(exportOf(base, 'off', false)), rawAll = read(exportOf(base, 'all', false));
    const roadCells = rawOff.meshes.filter((m) => /^1ROAD_/.test(m.name) && !/^1ROAD_PIT/.test(m.name)), catchCells = rawAll.meshes.filter(isCatch);
    const plain = catchCells.filter((m) => !/_join_/.test(m.name)); assert.equal(plain.length, roadCells.length, `one catch cell for each road cell (${catchCells.length - plain.length} more under the seam rows, which the road's own weld folds into its neighbours)`);
    assert.ok(catchCells.every((m) => m.name.startsWith('1ROAD_CATCH_')), 'named for the road surface: the ROAD key and the soft block\'s 1ROAD? both cover it');
    const byName = new Map(roadCells.map((m) => [m.name, m]));
    let checked = 0;
    for (const c of catchCells) {
      const road = byName.get(c.name.replace(/^1ROAD_CATCH_/, '1ROAD_').replace(/join/, 'seam'));
      if (!road) continue;
      // the catch's first vertex is the road's first vertex, 0.3 m under it (the vertex order is the road's)
      const d = Math.hypot(c.pos[0] - road.pos[0], c.pos[1] - road.pos[1], c.pos[2] - road.pos[2]); assert.ok(Math.abs(d - C.CATCH_OFFSET_M) < 1e-3, `${c.name}: ${d} m under`); checked++;
    }
    assert.ok(checked > 10, `${checked} cells compared by name`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('row 5: explicit ranges catch only the cells there, and surfaces.ini is the file of before', () => {
  const base = lap(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't180-catch-'));
  try {
    const read = (b) => { const f = path.join(tmp, `${Math.random()}.kn5`); fs.writeFileSync(f, Buffer.from(b.kn5)); return readKn5(f); };
    const some = exportOf(base, [{ s0: 400, s1: 500 }], false), all = exportOf(base, 'all', false);
    const cs = read(some).meshes.filter((m) => /^1ROAD_CATCH_/.test(m.name)), ca = read(all).meshes.filter((m) => /^1ROAD_CATCH_/.test(m.name));
    assert.ok(cs.length > 0 && cs.length < ca.length / 2, `a part of the lap: ${cs.length} of ${ca.length}`);
    assert.ok(some.warnings.some((w) => /catch/i.test(w) && /s 3[0-9]{2}–5[0-9]{2} m/.test(w)), 'and the export says where: ' + JSON.stringify(some.warnings.filter((w) => /catch/i.test(w))));
    const dir = path.join(tmp, 'a'); TF.writeTrackFiles(dir, all.scene, { kn5Files: ['a.kn5'], desc: all.desc });
    assert.equal(fs.readFileSync(path.join(dir, 'data', 'surfaces.ini'), 'utf8'), TF.surfacesIni(), 'surfaces.ini: the catch needs no surface of its own');
    assert.throws(() => exportOf(base, 'sometimes'), /underCatch/, 'a switch that is not one is refused by name');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
