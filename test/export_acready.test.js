// export_acready.test.js: the kn5 the export writes is what AC loads correctly (src/export/acready.js). Found in the first
// in-game drive, 2026-10-02: with nested, transformed, repeat-named road meshes the car fell through; with no txDiffuse
// the road was black.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/doc/index.js');
const { closeLoop } = require('../src/doc/connector.js');
const { exportTrack } = require('../src/export/fromwords.js');
const { writeKn5 } = require('../src/export/kn5write.js');
const { flattenForAc, ensureDiffuse } = require('../src/export/acready.js');
const { readKn5 } = require('../tools/kn5.cjs');
const { appendOld } = require('./pre_d182_words.js');

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-acready-test-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const kmh = (v) => v / 3.6;
const readScene = (scene) => { const f = path.join(tmp(), 'x.kn5'); fs.writeFileSync(f, Buffer.from(writeKn5(scene))); return readKn5(f); };

// a minimal scene: one triangle, placed twice under rotated and moved dummies, with the SAME mesh name both times
const tri = (name) => ({ type: 'mesh', name, material: 0, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), uvs: new Float32Array(6), indices: Uint16Array.from([0, 2, 1]),
  castShadows: true, visible: true, transparent: false, renderable: true });
const rotY90 = (tx, ty, tz) => [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, tx, ty, tz, 1];
const MAT = { name: 't180b_road', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0, props: [{ name: 'ksDiffuse', value: [0.5] }], samplers: [] };
const nested = () => ({ textures: [], materials: [MAT], root: { type: 'dummy', name: 't180b_track', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [
  { type: 'dummy', name: 'CELL_a', matrix: rotY90(0, 0, 10), children: [tri('1ROAD_a')] },
  { type: 'dummy', name: 'CELL_b', matrix: rotY90(5, 2, 20), children: [tri('1ROAD_a')] },
  { type: 'dummy', name: 'AC_START_0', matrix: rotY90(1, 1, 1), children: [] }] } });

test('flattening keeps every vertex where the nested scene put it in the world', () => {
  const a = readScene(nested()), b = readScene(flattenForAc(nested()));
  assert.strictEqual(b.meshes.length, a.meshes.length);
  for (let m = 0; m < a.meshes.length; m++) for (let k = 0; k < a.meshes[m].pos.length; k++) assert.ok(Math.abs(a.meshes[m].pos[k] - b.meshes[m].pos[k]) < 1e-4, `mesh ${m} coord ${k}`);
});

test('after flattening, no mesh sits under a transformed node', () => {
  const b = readScene(flattenForAc(nested()));
  for (const m of b.meshes) assert.strictEqual(m.path, '/t180b_track', `${m.name} is under ${m.path}`);
});

test('after flattening, every mesh name is unique and still starts with its surface key', () => {
  const names = readScene(flattenForAc(nested())).meshes.map((m) => m.name);
  assert.strictEqual(new Set(names).size, names.length, names.join(','));
  for (const n of names) assert.match(n, /^1ROAD_a/);
});

test('a marker keeps its world placement', () => {
  const [a] = readScene(nested()).dummies, [b] = readScene(flattenForAc(nested())).dummies;
  assert.deepStrictEqual(b.pos.map((v) => +v.toFixed(5)), a.pos.map((v) => +v.toFixed(5)));
});

test('a name that is already unique is not changed, and a made name does not collide with a real one', () => {
  const s = nested(); s.root.children.push({ type: 'dummy', name: 'X', matrix: rotY90(0, 0, 0), children: [tri('1ROAD_a_2')] });
  const names = readScene(flattenForAc(s)).meshes.map((m) => m.name);
  assert.strictEqual(new Set(names).size, names.length, names.join(','));
  assert.ok(names.includes('1ROAD_a'));
});

test('every material without a diffuse gets one, and one that has one keeps it', () => {
  const s = nested(); s.materials.push({ ...MAT, name: 't180b_paint' }, { ...MAT, name: 'own', samplers: [{ name: 'txDiffuse', slot: 0, texture: 'mine.dds' }] });
  s.textures.push({ name: 'mine.dds', data: ensureDiffuse({ textures: [], materials: [MAT] }).textures[0].data });
  const r = ensureDiffuse(s);
  for (const m of r.materials) assert.ok(m.samplers.some((x) => x.name === 'txDiffuse'), m.name);
  assert.strictEqual(r.materials[2].samplers[0].texture, 'mine.dds');
  for (const m of r.materials) { const t = m.samplers.find((x) => x.name === 'txDiffuse').texture; assert.ok(r.textures.some((x) => x.name === t), `${t} is in the file`); }
  assert.strictEqual(r.textures.length, 3, 'one grey, one near-white, the existing one: no duplicates');
});

test('a scene with no materials and no meshes passes through both unchanged in shape', () => {
  const s = { textures: [], materials: [], root: { type: 'dummy', name: 'r', matrix: rotY90(0, 0, 0), children: [] } };
  assert.deepStrictEqual(ensureDiffuse(flattenForAc(s)).root.children, []);
  assert.deepStrictEqual(ensureDiffuse(s).textures, []);
});

test('an exported track has no transformed road, unique names, and a diffuse on every material', () => {
  let d = D.createDoc('Acready Loop');
  for (const w of ['straight', 'straight', 'tight', 'straight', 'tight']) d = appendOld(D, d, w, { speed: kmh(200) });
  const c = closeLoop(d); assert.ok(c.candidates.length, c.reason);
  const doc = c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
  const out = tmp(), r = exportTrack(doc.words.reduce((x, w) => D.editWord(x, w.id, { speed: kmh(200) }), doc), { outDir: out });
  const dir = path.join(out, r.folders[0].folder), k = readKn5(path.join(dir, `${r.folders[0].folder}.kn5`));
  const road = k.meshes.filter((m) => /^\d/.test(m.name));
  assert.ok(road.length > 0);
  for (const m of road) assert.strictEqual(m.path, '/t180b_track', `${m.name} under ${m.path}`);
  assert.strictEqual(new Set(k.meshes.map((m) => m.name)).size, k.meshes.length, 'mesh names unique');
  const raw = fs.readFileSync(path.join(dir, `${r.folders[0].folder}.kn5`));
  assert.ok(raw.includes(Buffer.from('txDiffuse')), 'a txDiffuse sampler is written');
});

// ── weldSeams: a sub-2 mm zipper is a strip of slivers facing along the road; it is dropped and the edge shared ─────────
const { weldSeams, SNAP, SLIVER } = require('../src/export/acready.js');
const strip = (A, B) => {   // the zipper's own layout: row A then row B, each a line across the road at z = 0
  const pts = [...A, ...B], idx = [];
  for (let i = 0; i < A.length - 1; i++) idx.push(i, A.length + i, i + 1, i + 1, A.length + i, A.length + i + 1);
  return { type: 'mesh', name: '1ROAD_seam_p1_body', material: 0, positions: Float32Array.from(pts.flat()), normals: new Float32Array(pts.length * 3),
    uvs: new Float32Array(pts.length * 2), indices: Uint16Array.from(idx), castShadows: true, visible: true, transparent: false, renderable: true };
};
const rowA = [[0, 0, 0], [5, 0, 0], [10, 0, 0]], rowB = (dz) => [[0, 0, dz], [5, 0, dz], [10, 0, dz]];
const nextPiece = (dz) => ({ ...tri('1ROAD_p1_body_0'), positions: Float32Array.from([...rowB(dz)[0], ...rowB(dz)[2], 0, 0, 2]) });
const flat = (kids) => ({ textures: [], materials: [MAT], root: { type: 'dummy', name: 't180b_track', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: kids } });

test('a seam whose rows are within SNAP is dropped, and the next piece\'s edge is moved onto the earlier row', () => {
  const r = weldSeams(flat([strip(rowA, rowB(0.0005)), nextPiece(0.0005)]));
  assert.deepStrictEqual(r.root.children.map((n) => n.name), ['1ROAD_p1_body_0']);
  const p = r.root.children[0].positions;
  assert.deepStrictEqual([p[2], p[5]].map((z) => Math.abs(z) < 1e-6), [true, true], 'the two edge points now lie on row A (z = 0)');
  assert.strictEqual(p[8], 2, 'a point not on the seam is not moved');
});

test('a seam wider than SNAP is a real bridge and is kept untouched', () => {
  const s = flat([strip(rowA, rowB(SNAP * 5)), nextPiece(SNAP * 5)]), r = weldSeams(s);
  assert.strictEqual(r, s);
});

test('a scene with no seam is returned as it was', () => {
  const s = flat([nextPiece(0)]);
  assert.strictEqual(weldSeams(s), s);
});

test('an exported closed track has no sliver seam left on its road', () => {
  let d = D.createDoc('Weld Loop');
  for (const w of ['straight', 'straight', 'tight', 'straight', 'tight']) d = appendOld(D, d, w, { speed: kmh(200) });
  const c = closeLoop(d); assert.ok(c.candidates.length, c.reason);
  const doc = c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
  const out = tmp(), r = exportTrack(doc.words.reduce((x, w) => D.editWord(x, w.id, { speed: kmh(200) }), doc), { outDir: out });
  const k = readKn5(path.join(out, r.folders[0].folder, `${r.folders[0].folder}.kn5`));
  for (const m of k.meshes.filter((x) => /^\d.*seam/i.test(x.name))) {
    for (let i = 0; i < m.idx.length; i += 3) {
      const v = [m.idx[i], m.idx[i + 1], m.idx[i + 2]].map((j) => [m.pos[3 * j], m.pos[3 * j + 1], m.pos[3 * j + 2]]);
      const e1 = v[1].map((x, j) => x - v[0][j]), e2 = v[2].map((x, j) => x - v[0][j]);
      const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
      const e3 = v[2].map((x, j) => x - v[1][j]), thick = (2 * area) / Math.max(Math.hypot(...e1), Math.hypot(...e2), Math.hypot(...e3));
      assert.ok(thick >= SLIVER * 0.99, `${m.name} keeps a sliver ${(thick * 1000).toFixed(2)} mm thick`);
    }
  }
});
