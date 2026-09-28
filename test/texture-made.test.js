// texture-made.test.js: node --test test/texture-made.test.js. A slot holding a MADE texture (the procedural maker,
// src/texmaker, ARCHITECTURE §5b "Make your own"), stored as its parameter text, rendered to DDS with mips at export and
// in the preview, one list for both (the D172 seam, extended); and the live texture-memory budget (§5b "Budget").
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const G = require('../src/geom/index.js');
const T = require('../src/texture/index.js');
const TM = require('../src/texmaker/index.js');
const { writeKn5 } = require('../src/export/kn5write.js');
const { validateScene } = require('../src/export/scene.js');

const RAINBOW = TM.serialize(TM.PRESETS.rainbow), LANES = TM.serialize(TM.PRESETS.lanes);
function kn5Textures(buf) {
  const b = Buffer.from(buf); let o = 6; const version = b.readUInt32LE(o); o += 4; if (version > 5) o += 4;
  const n = b.readInt32LE(o); o += 4; const out = [];
  for (let k = 0; k < n; k++) { o += 4; const l = b.readInt32LE(o); o += 4; const name = b.toString('utf8', o, o + l); o += l; const size = b.readInt32LE(o); o += 4; out.push({ name, data: b.subarray(o, o + size) }); o += size; }
  return out;
}
function doc() {
  let d = D.appendWord(D.appendWord(D.createDoc('m'), 'straight'), 'straight');
  d = D.editWord(d, 'w1', { textures: { floor: { make: RAINBOW, size: 64 }, lines: { make: LANES, size: 32 } } });
  return D.editWord(d, 'w2', { textures: { floor: { make: RAINBOW, size: 64 } } });
}

test('a slot holds a made texture as its canonical TEXT, and the document round-trips byte-exact', () => {
  const t = D.serialize(doc());
  assert.equal(D.serialize(D.parse(t)), t);
  assert.equal(doc().words[0].textures.floor.make, RAINBOW);
  const messy = JSON.stringify({ ...JSON.parse(RAINBOW), base: '#101010FF' });   // keys canonical, colour case not
  assert.equal(D.editWord(doc(), 'w2', { textures: { walls: { make: messy } } }).words[1].textures.walls.make, TM.serialize(TM.parse(messy)));
});

test('an image and a made texture in one slot, a refused text, and a size that is not a power of two are refused by name', () => {
  const d = doc(), refuse = (p) => assert.throws(() => D.editWord(d, 'w2', { textures: { walls: p } }), (e) => e.code === 'BAD_TEXTURES', JSON.stringify(p));
  refuse({ texture: 'x', make: RAINBOW });
  refuse({ make: '{"texmaker":1,"name":"x","layers":[{"type":"nope"}]}' });
  refuse({ make: RAINBOW, size: 1000 }); refuse({ make: RAINBOW, size: 16384 });
});

test('the preview\'s list is the kn5\'s embedded list with made textures: same names, same bytes; one render per text and size', () => {
  const set = T.buildTextureSet(doc(), {});
  const by = Object.fromEntries(set.textures.map((t) => [t.width, [t.made, t.slots.join(), t.name]]));
  assert.deepEqual([by[64].slice(0, 2), by[32].slice(0, 2)], [[true, 'floor'], [true, 'lines']]);
  assert.equal(by[64][2], T.madeName(RAINBOW, 64));
  assert.equal(set.textures.length, 2, 'the same rainbow at 64 on two words is one texture');
  const r = D.resolve(doc()), p = G.buildPath(r.segments, { step: 1 }), mesh = G.buildMesh(p, r.segments);
  const { scene } = T.applyToScene(mesh.scene, set); validateScene(scene);
  const kn5 = kn5Textures(writeKn5(scene));
  assert.deepEqual(T.previewTextures(set).map((x) => x.file), kn5.map((x) => x.name));
  set.textures.forEach((t, i) => assert.ok(Buffer.from(t.dds).equals(kn5[i].data), t.file));
});

test('a made texture\'s DDS level 0 is the maker\'s pixels exactly, with a full mip chain at its size', () => {
  const set = T.buildTextureSet(doc(), {}), t = set.textures.find((x) => x.width === 64);
  const h = T.dds.readDdsHeader(t.dds);
  assert.deepEqual([h.width, h.height, h.mipCount], [64, 64, 7]);
  assert.deepEqual(T.previewTextures(set).find((x) => x.name === t.name).rgba, TM.makeTexture(RAINBOW, 64, 64).rgba);
});

test('the same text regenerates the same bytes, cache or no cache: a fresh process\'s render equals this one', () => {
  const a = T.buildTextureSet(doc(), {}).textures.map((t) => Buffer.from(t.dds).toString('base64'));
  const { execFileSync } = require('child_process');
  const code = `const D=require('./src/doc/index.js'),T=require('./src/texture/index.js');const d=D.parse(${JSON.stringify(D.serialize(doc()))});` +
    `process.stdout.write(JSON.stringify(T.buildTextureSet(d,{}).textures.map(t=>Buffer.from(t.dds).toString('base64'))))`;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: require('path').join(__dirname, '..'), maxBuffer: 1 << 26 }).toString()), a);
});

// ── the budget (§5b "Budget: a live count of texture memory and resolution per track", docs/ARCHITECTURE.md:125) ──
test('the budget counts a 1024² texture as the hand-computed DDS size: 128 + 4·(1024² + 512² + … + 1) = 5,592,532 B', () => {
  // Σ over 11 levels of 4^k texels = (4^11 − 1)/3 = 1,398,101; × 4 bytes + the 128-byte header
  assert.equal(T.ddsBytes(1024, 1024), 5592532);
  let d = D.appendWord(D.createDoc(), 'straight');
  d = D.editWord(d, 'w1', { textures: { floor: { make: RAINBOW, size: 1024 } } });
  const set = T.buildTextureSet(d, {}), b = set.budget;
  assert.equal(set.textures[0].dds.length, 5592532);
  assert.deepEqual([b.bytes, b.rows[0].format, b.rows[0].mips, b.rows[0].width, b.perSlot.floor, b.level], [5592532, 'A8R8G8B8', 11, 1024, 5592532, 'ok']);
});
test('a non-square, non-power-of-two size by hand too: 48×20 → 24×10 → 12×5 → 6×2 → 3×1 → 1×1: 128 + 4·(960 + 240 + 60 + 12 + 3 + 1) = 5,232 B', () => {
  assert.equal(T.ddsBytes(48, 20), 5232);
  assert.equal(T.dds.encodeDds({ width: 48, height: 20, rgba: new Uint8Array(48 * 20 * 4) }).length, 5232);
});
test('per slot and in total: a texture two slots share counts in each slot, once in the total', () => {
  let d = D.appendWord(D.createDoc(), 'straight');
  d = D.editWord(d, 'w1', { textures: { floor: { make: RAINBOW, size: 64 }, walls: { make: RAINBOW, size: 64 }, lines: { make: LANES, size: 32 } } });
  const b = T.buildTextureSet(d, {}).budget, r64 = T.ddsBytes(64, 64), r32 = T.ddsBytes(32, 32);
  assert.deepEqual([b.perSlot.floor, b.perSlot.walls, b.perSlot.lines, b.bytes], [r64, r64, r32, r64 + r32]);
});
test('the levels are the measured ones: amber above the eleven tracks\' median, red above their largest', () => {
  assert.deepEqual([T.AMBER_BYTES, T.RED_BYTES], [56278061, 328874531]);
  const rows = (mb) => [{ name: 'x', width: 8192, height: 8192, mips: 14, dds: { length: Math.round(mb * 1048576) } }];
  assert.deepEqual([50, 54, 300, 314].map((mb) => T.budget(rows(mb)).level), ['ok', 'amber', 'amber', 'red']);
  assert.equal(T.budget(rows(314)).warnings[0].code, 'TEXTURE_BUDGET');
});
