// export-textures.test.js: node --test test/export-textures.test.js. The export writes the texture set the preview draws
// (ARCHITECTURE §1: the preview draws the export's geometry and materials). Found by a first-time run of the installed
// app: with the textures panel on the page, a textured floor showed in the preview and was missing from the kn5.
// The rule is the preview's own (app/preview/aclook.js resolveLook): a road cell whose word's FLOOR slot names a texture
// (an image or a made one) wears that slot's material; every other cell keeps the scene's; an untextured set changes
// nothing, so the kn5 of an untextured track is exactly what it was.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const T = require('../src/texture/index.js');
const TM = require('../src/texmaker/index.js');
const { buildExport } = require('../src/export/fromwords.js');
const { resolveLook } = require('../app/preview/aclook.js');

const kmh = (v) => v / 3.6, RAINBOW = TM.serialize(TM.PRESETS.rainbow);
function stadium() {
  let d = D.createDoc('Tex');
  for (const [w, o] of [['straight', { handles: { length: 600 } }], ['tight', { font: 'flat' }], ['tight', { font: 'flat' }], ['straight', { handles: { length: 600 } }], ['tight', { font: 'flat' }], ['tight', { font: 'flat' }]]) d = D.appendWord(d, w, { ...o, speed: kmh(200) });
  return D.checkDoc({ ...d, closed: true });
}
const withFloor = (d) => D.editWord(d, 'w1', { textures: { floor: { make: RAINBOW, size: 64 } } });
/** The kn5 as the export wrote it: every road mesh node's name and material name, and the embedded textures' names. */
function kn5Of(b) {
  const nodes = []; (function walk(n) { if (n.type === 'mesh') nodes.push({ name: n.name, material: b.scene.materials[n.material].name }); for (const c of n.children || []) walk(c); })(b.scene.root);
  return { roads: nodes.filter((n) => /^1ROAD_/.test(n.name)), textures: b.scene.textures.map((t) => t.name) };
}

test('a textured floor reaches the kn5: its word\'s road cells wear the set\'s floor material, and the DDS is embedded', () => {
  const d = withFloor(stadium()), set = T.buildTextureSet(d, {}), b = buildExport(d, { textures: set }), k = kn5Of(b);
  const name = set.bySegment('w1').floor.material;
  const w1 = k.roads.filter((n) => /^1ROAD_w1_/.test(n.name)), others = k.roads.filter((n) => !/^1ROAD_w1_/.test(n.name));
  assert.ok(w1.length > 0 && w1.every((n) => n.material === name), `w1's cells wear ${name}: ${JSON.stringify(w1.slice(0, 3))}`);
  assert.ok(others.length > 0 && others.every((n) => n.material === 't180b_road'), 'every other word keeps the road material');
  assert.deepEqual(k.textures, [`t180b_${T.madeName(RAINBOW, 64)}.dds`]);
  const dds = b.scene.textures[0].data;
  assert.deepEqual(T.dds.ddsLevel(new Uint8Array(dds), 0).rgba, TM.makeTexture(RAINBOW, 64, 64).rgba, 'the made pixels, exactly');
});

test('the material the preview draws for a word is the one the kn5 carries for it (the preview\'s own rule)', () => {
  const d = withFloor(stadium()), set = T.buildTextureSet(d, {}), b = buildExport(d, { textures: set }), k = kn5Of(b);
  const look = resolveLook(b.scene, set, T.previewTextures(set));
  for (const id of ['w1', 'w2', 'w4']) {
    const drawn = look.materialOf({ segId: id, materialIndex: 0, key: id }).name;
    const inKn5 = k.roads.find((n) => new RegExp(`^1ROAD_${id}_`).test(n.name)).material;
    assert.equal(drawn, inKn5, id);
  }
});

test('an untextured set changes nothing: the kn5 is byte-identical to an export without a set', () => {
  const d = stadium(), set = T.buildTextureSet(d, {});
  assert.ok(Buffer.from(buildExport(d, { textures: set }).kn5).equals(Buffer.from(buildExport(d).kn5)));
});
test('only the materials a textured cell uses are added: the set\'s untextured slots do not reach the kn5', () => {
  const d = withFloor(stadium()), set = T.buildTextureSet(d, {}), plain = buildExport(d), b = buildExport(d, { textures: set });
  const added = b.scene.materials.map((m) => m.name).filter((n) => !plain.scene.materials.some((m) => m.name === n));
  assert.deepEqual(added, [set.bySegment('w1').floor.material]);
});
