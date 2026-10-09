// export_pittexture.test.js: node --test test/export_pittexture.test.js. D279: the pit lane wears the same road texture as the track
// (the keeper, 2026-10-09 13:47: "ALSO MAKE the pits the same texture as the track"). Before: withTextureSet (src/texture/set.js) gives the
// textured floor material to the ROAD's cells only, so the lane kept the plain road material while the road around it wore the texture
// (measured in an exported kn5: road 6/6 on the floor material, lane 5/5 on t180b_road). Rows, under each of the three texture settings:
//   1  solid (no floor texture): the lane and the road both wear t180b_road, as before
//   2  a made texture (the asphalt preset) on every word: the lane wears the road's floor material, and the same diffuse DDS
//   3  the user's own picture on every word: the same
//   4  the pit box paint, the lane's surface keys (1ROAD_PIT_…) and its mesh count in the kn5 are unchanged, and the export's AC-ready
//      checks pass (buildExport reads its own kn5 back before it returns)
//   5  a word document's texture coordinates are untouched (mesh.js's 10 m repeats, the rule the road's own word cells keep)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const D = require('../src/doc/index.js');
const T = require('../src/texture/index.js');
const TM = require('../src/texmaker/index.js');
const { buildExport } = require('../src/export/fromwords.js');
const { readKn5 } = require('../tools/kn5.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const kmh = (v) => v / 3.6, TIGHT90 = { turn: Math.PI / 2, length: (Math.PI / 2) * 120 / 0.7 };
/** test/export-layouts.test.js's stadium, which closes by symmetry, with its pit lane on the first straight. */
function stadium() {
  let d = D.createDoc('Pits');
  const S = { font: 'flat', handles: { length: 600, width: 20 } }, Tt = { font: 'flat', handles: { ...TIGHT90, width: 20 } };
  for (const [w, o] of [['straight', S], ['tight', Tt], ['tight', Tt], ['straight', S], ['tight', Tt], ['tight', Tt]]) d = D.appendWord(d, w, { ...o, speed: kmh(200) });
  d = D.checkDoc({ ...d, closed: true });
  return D.setPitLane(d, { side: 'R', leave: { word: 'w1', along: 60 }, rejoin: { word: 'w1', along: 540 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80 });
}
const everyWord = (d, floor) => d.words.reduce((acc, w) => D.editWord(acc, w.id, { textures: { floor } }), d);
const image = (w, h, f) => { const rgba = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(f(x, y), (y * w + x) * 4); return { width: w, height: h, rgba }; };
const PICTURE = T.png.encodePng(image(32, 32, (x, y) => ((x ^ y) & 8 ? [90, 90, 95, 255] : [60, 60, 64, 255])), zlib.deflateSync);
const SETTINGS = {
  solid: { doc: (d) => d, set: () => null },
  asphalt: { doc: (d) => everyWord(d, { make: TM.serialize(TM.PRESETS.asphalt), size: 64 }), set: (d) => T.buildTextureSet(d, {}) },
  picture: { doc: (d) => everyWord(d, { texture: 'pic' }), set: (d) => T.buildTextureSet(d, { pic: { bytes: PICTURE } }) },
};
function exported(kind) {
  const s = SETTINGS[kind], d = s.doc(stadium()), set = s.set(d), b = buildExport(d, set ? { textures: set } : {});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-pittex-')); made.push(dir);
  const f = path.join(dir, 'x.kn5'); fs.writeFileSync(f, b.kn5);
  const nodes = []; (function walk(n) { if (n.type === 'mesh') nodes.push(n); for (const c of n.children || []) walk(c); })(b.scene.root);
  const mat = (n) => b.scene.materials[n.material];
  const diffuse = (m) => { const x = (m.samplers || []).find((q) => q.name === 'txDiffuse'); return x ? x.texture : null; };
  const isLane = (n) => /^1ROAD_PIT_/.test(n.name), isRoad = (n) => /^1ROAD_/.test(n.name) && !isLane(n);
  return { b, kn5: readKn5(f), lane: nodes.filter(isLane), road: nodes.filter(isRoad), paint: nodes.filter((n) => mat(n).name === 't180b_paint'), mat, diffuse };
}
const one = (arr) => [...new Set(arr)];

test('row 1: solid (no floor texture): the lane and the road both wear t180b_road, as before', () => {
  const e = exported('solid');
  assert.deepEqual(one(e.road.map((n) => e.mat(n).name)), ['t180b_road']);
  assert.deepEqual(one(e.lane.map((n) => e.mat(n).name)), ['t180b_road']);
});

for (const kind of ['asphalt', 'picture']) {
  test(`row ${kind === 'asphalt' ? 2 : 3}: ${kind}: the lane wears the road's floor material and the same diffuse texture, in the scene and in the kn5`, () => {
    const e = exported(kind);
    const roadMats = one(e.road.map((n) => e.mat(n).name)), laneMats = one(e.lane.map((n) => e.mat(n).name));
    assert.equal(roadMats.length, 1, `one road floor: ${roadMats}`);
    assert.match(roadMats[0], /^t180b_floor_/);
    assert.deepEqual(laneMats, roadMats, 'the lane wears the road\'s floor material');
    const roadTex = one(e.road.map((n) => e.diffuse(e.mat(n)))), laneTex = one(e.lane.map((n) => e.diffuse(e.mat(n))));
    assert.ok(roadTex[0], 'the road\'s floor has a diffuse texture');
    assert.deepEqual(laneTex, roadTex, 'the same diffuse texture');
    const kLane = e.kn5.meshes.filter((m) => /^1ROAD_PIT_/.test(m.name));
    assert.ok(kLane.length > 0 && kLane.every((m) => m.material === roadMats[0]), `the kn5's lane meshes: ${one(kLane.map((m) => m.material))}`);
  });
}

test('row 4: paint, the lane\'s surface keys and its mesh count are unchanged, and the AC-ready read-back passes', () => {
  const s = exported('solid'), a = exported('asphalt');
  assert.ok(a.paint.length > 0, 'pit box and start paint exist');
  assert.equal(a.paint.length, s.paint.length, 'the same paint meshes');
  assert.deepEqual(one(a.paint.map((n) => a.mat(n).name)), ['t180b_paint'], 'paint keeps its own material');
  const lk = (e) => e.kn5.meshes.filter((m) => /^1ROAD_PIT_/.test(m.name)).map((m) => m.name);
  assert.deepEqual(lk(a), lk(s), 'the same lane meshes in the kn5: names (the surface key) and count (still out of the road merge)');
  for (const e of [s, a]) assert.ok(e.b.readback, 'the export read its own kn5 back');
});

test('row 5: a word document\'s texture coordinates are untouched: the lane keeps mesh.js\'s, as the road\'s word cells do', () => {
  const s = exported('solid'), a = exported('asphalt');
  assert.equal(a.lane.length, s.lane.length);
  a.lane.forEach((n, i) => assert.deepEqual(Array.from(n.uvs), Array.from(s.lane[i].uvs), `${n.name}`));
});
