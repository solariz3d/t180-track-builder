// texture-set.test.js: node --test test/texture-set.test.js. The ONE texture set the preview and the export share
// (ARCHITECTURE §5b with §5: "the preview and the export render with the same inputs"). The kn5's texture block is read
// here by its own walker (tools/kn5.cjs skips textures), so the check does not trust the writer it checks.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const D = require('../src/doc/index.js');
const G = require('../src/geom/index.js');
const T = require('../src/texture/index.js');
const { writeKn5 } = require('../src/export/kn5write.js');
const { validateScene } = require('../src/export/scene.js');
const { encodeJpeg } = require('./texture_jpeg_encoder.js');

function image(W, H, f) { const rgba = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set(f(x, y), (y * W + x) * 4); return { width: W, height: H, rgba }; }
const stripes = () => T.png.encodePng(image(32, 8, (x) => (x & 4 ? [255, 255, 255, 255] : [200, 30, 30, 255])), zlib.deflateSync);
const grain = () => encodeJpeg(image(16, 16, (x, y) => [60 + ((x * 7 + y * 13) & 15), 60, 64, 255]), { quality: 95 });

function doc() {
  let d = D.appendWord(D.appendWord(D.createDoc('t'), 'straight'), 'turn');
  d = D.editWord(d, 'w1', { textures: { floor: { texture: 'grain' }, kerbs: { texture: 'stripes', tileLength: 2 } } });
  d = D.appendWord(D.appendWord(d, 'jump'), 'straight');
  return d;
}
/** The kn5's embedded textures, read from the bytes: [{ name, data }]. */
function kn5Textures(buf) {
  const b = Buffer.from(buf); assert.equal(b.toString('latin1', 0, 6), 'sc6969');
  let o = 6; const version = b.readUInt32LE(o); o += 4; if (version > 5) o += 4;
  const n = b.readInt32LE(o); o += 4; const out = [];
  for (let k = 0; k < n; k++) { o += 4; const l = b.readInt32LE(o); o += 4; const name = b.toString('utf8', o, o + l); o += l; const size = b.readInt32LE(o); o += 4; out.push({ name, data: b.subarray(o, o + size) }); o += size; }
  return out;
}
function exported(d, set) {
  const r = D.resolve(d), p = G.buildPath(r.segments, { step: 1 }), mesh = G.buildMesh(p, r.segments);
  const { scene } = T.applyToScene(mesh.scene, set); validateScene(scene);
  return kn5Textures(writeKn5(scene));
}

test('the preview\'s texture list is the kn5\'s embedded list: same names, same order, same bytes', () => {
  const set = T.buildTextureSet(doc(), { stripes: { bytes: stripes() }, grain: { bytes: grain() }, unused: { bytes: stripes() } });
  const kn5 = exported(doc(), set), preview = T.previewTextures(set);
  assert.deepEqual(preview.map((t) => t.file), kn5.map((t) => t.name));
  assert.deepEqual(preview.map((t) => t.file), ['t180b_grain.dds', 't180b_stripes.dds']);   // only what a slot uses
  set.textures.forEach((t, i) => assert.ok(Buffer.from(t.dds).equals(kn5[i].data), `${t.file} bytes`));
});
test('the preview shows the DDS level 0 the export writes, texel for texel, not the source image', () => {
  const set = T.buildTextureSet(doc(), { stripes: { bytes: stripes() }, grain: { bytes: grain() } });
  const kn5 = exported(doc(), set);
  for (const pv of T.previewTextures(set)) {
    const inKn5 = T.dds.ddsLevel(new Uint8Array(kn5.find((t) => t.name === pv.file).data), 0);
    assert.deepEqual([pv.width, pv.height], [inKn5.width, inKn5.height]);
    assert.deepEqual(pv.rgba, inKn5.rgba);
  }
});
test('each resolved segment finds its slots; a phrase word by <id>/<n>; a jump\'s landing ramp wears the road before it', () => {
  let d = doc(); d = D.appendPhrase(d, 'S', [{ word: 'turn' }, { word: 'straight' }]);
  const set = T.buildTextureSet(d, { stripes: { bytes: stripes() }, grain: { bytes: grain() } });
  const ids = [...new Set(D.resolve(d).segments.map((g) => g.id))];
  for (const id of ids) assert.ok(set.bySegment(id), `slots for ${id}`);
  assert.equal(set.bySegment('w1').floor.material, 't180b_floor_grain');
  assert.equal(set.bySegment('w1').kerbs.settings.tileLength, 2);
  assert.equal(set.bySegment('w2').floor.material, 't180b_floor');                          // the turn keeps its font's
  assert.deepEqual(set.bySegment('w3'), set.bySegment('w2'));                               // the jump wears w2's
  assert.equal(set.bySegment('w5/1').walls.material, 't180b_walls');
  assert.equal(set.bySegment('nope'), null);
});
test('a slot naming a texture that was never added is refused by name; so is a compressed normal map', () => {
  assert.throws(() => T.buildTextureSet(doc(), { stripes: { bytes: stripes() } }), (e) => e.code === 'NO_SUCH_TEXTURE' && /grain/.test(e.message));
  assert.throws(() => T.buildTextureSet(doc(), { stripes: { bytes: stripes() }, grain: { bytes: grain(), role: 'normal', compress: true } }), (e) => e.code === 'COMPRESSED_NORMAL');
});
test('a document with no textures gives an empty set, and the scene is unchanged but for the plain slot materials', () => {
  const d = D.appendWord(D.createDoc(), 'straight'), set = T.buildTextureSet(d, {});
  assert.equal(set.textures.length, 0);
  assert.deepEqual(set.materials.map((m) => m.material.name), ['t180b_floor', 't180b_walls', 't180b_lines', 't180b_kerbs', 't180b_edgeGlow']);
  assert.deepEqual(exported(d, set), []);
});
