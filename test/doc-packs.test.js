// doc-packs.test.js: node --test test/doc-packs.test.js. TEXTURE PACKS (ARCHITECTURE §5b: "Texture packs: save and
// share sets (a font's full look), and import packs other users made"): one file, canonical text with its images
// embedded; a round-trip is byte-exact; a name clash is refused as the piece library refuses one; a pack carrying a
// file §5b warns against is refused. Every image is generated here.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const D = require('../src/doc/index.js');
const P = require('../src/doc/packs.js');
const T = require('../src/texture/index.js');
const TM = require('../src/texmaker/index.js');

const png = (r) => { const rgba = new Uint8Array(8 * 8 * 4); for (let i = 0; i < rgba.length; i += 4) rgba.set([r, i & 255, 40, 255], i); return T.png.encodePng({ width: 8, height: 8, rgba }, zlib.deflateSync); };
const LANES = TM.serialize(TM.PRESETS.lanes);
function look() {
  let d = D.appendWord(D.appendWord(D.createDoc(), 'tight', { font: 'bowl' }), 'straight', { font: 'flat' });   // w1 a bowl, w2 flat (named: D182 made the defaults the library's)
  return D.editWord(d, 'w1', { textures: { floor: { texture: 'kerbstripe', tileLength: 4 }, lines: { make: LANES, size: 64 }, walls: { texture: 'wallpaint', fit: 'fit' } } });
}
const images = () => ({ kerbstripe: { bytes: png(200) }, wallpaint: { bytes: png(90) }, unused: { bytes: png(1) } });
const pack = () => P.packFromWord(look(), 'w1', { name: 'Red Bowl', author: 'me', images: images() });

test('a word\'s look saves as a pack: its font, all five slots in full, a made texture as text, and only the images it names', () => {
  const p = pack();
  assert.equal(p.font, 'bowl');
  assert.deepEqual(Object.keys(p.slots), ['floor', 'walls', 'lines', 'kerbs', 'edgeGlow']);
  assert.equal(p.slots.lines.make, LANES);
  assert.equal(p.slots.floor.tileLength, 4);
  assert.deepEqual(p.images.map((i) => i.name), ['kerbstripe', 'wallpaint']);
});

test('a pack round-trips byte-exact, images and all, whatever key order the file was written in', () => {
  const t = P.serializePack(pack());
  assert.equal(P.serializePack(P.parsePack(t)), t);
  const o = JSON.parse(t), shuffled = JSON.stringify({ images: o.images.map((i) => ({ bytes: i.bytes, role: i.role, name: i.name })), slots: o.slots, font: o.font, author: o.author, name: o.name, pack: o.pack });
  assert.equal(P.serializePack(P.parsePack(shuffled)), t);
  assert.deepEqual(P.parsePack(t).images[0].bytes, images().kerbstripe.bytes);
});

test('base64 round-trips every length (0 to 5 bytes, and a PNG)', () => {
  for (const u of [[], [1], [1, 2], [1, 2, 3], [250, 0, 7, 9], [0, 0, 0, 0, 255]].map((a) => Uint8Array.from(a)).concat([png(3)])) {
    assert.equal(P.toBase64(u), Buffer.from(u).toString('base64'));
    assert.deepEqual(P.fromBase64(P.toBase64(u), 'x'), u);
  }
});

test('an imported pack applies to every word of its font, in one edit (one undo step)', () => {
  let d = D.appendPhrase(D.appendWord(D.appendWord(D.createDoc(), 'tight', { font: 'bowl' }), 'straight', { font: 'flat' }), 'S', [{ word: 'tight', opts: { font: 'bowl' } }, { word: 'straight', opts: { font: 'flat' } }]);
  const col = P.importPack({ packs: [], images: {} }, P.serializePack(pack()));
  let h = D.createHistory(d); const before = D.serialize(h.present);
  const r = P.applyPack(h.present, col.packs[0]);
  h = D.commit(h, r.doc);
  assert.equal(r.words, 2, 'w1 and the phrase\'s tight');
  assert.equal(h.present.words[0].textures.floor.texture, 'kerbstripe');
  assert.equal(h.present.words[2].words[0].textures.lines.make, LANES);
  assert.deepEqual(h.present.words[1].textures, {}, 'the flat straight is not a bowl');
  assert.equal(D.serialize(D.undo(h).present), before);
  assert.ok(T.buildTextureSet(h.present, Object.fromEntries(Object.entries(col.images).map(([n, b]) => [n, { bytes: b }]))).textures.length === 3);
});

test('a name clash on import is refused as the library refuses one: a pack\'s name in any case, an image\'s name with other pixels', () => {
  const t = P.serializePack(pack()), col = P.importPack({ packs: [], images: {} }, t);
  assert.throws(() => P.importPack(col, t.replace('"Red Bowl"', '"RED BOWL"')), (e) => e.code === 'NAME_TAKEN');
  const other = P.serializePack(P.makePack({ name: 'Other', font: 'flat', slots: { floor: { texture: 'kerbstripe' } }, images: { kerbstripe: { bytes: png(7) } } }));
  assert.throws(() => P.importPack(col, other), (e) => e.code === 'NAME_TAKEN' && /kerbstripe/.test(e.message));
  const same = P.serializePack(P.makePack({ name: 'Same', font: 'flat', slots: { floor: { texture: 'kerbstripe' } }, images: { kerbstripe: { bytes: png(200) } } }));
  assert.deepEqual(Object.keys(P.importPack(col, same).images).sort(), ['kerbstripe', 'wallpaint'], 'the same bytes under the same name are one image');
});

test('a pack carrying a DDS is refused; a block-compressed normal map is refused as §5b warns', () => {
  const dds = T.dds.encodeDds({ width: 4, height: 4, rgba: new Uint8Array(64) });
  const bc = dds.slice(); bc.set([0x44, 0x58, 0x54, 0x35], 84);   // FourCC DXT5
  const t = (bytes, role) => { const o = JSON.parse(P.serializePack(pack())); o.images[0] = { name: 'kerbstripe', role, bytes: Buffer.from(bytes).toString('base64') }; return JSON.stringify(o); };
  assert.throws(() => P.parsePack(t(dds, 'diffuse')), (e) => e.code === 'PACK_BAD_IMAGE' && /DDS/.test(e.message));
  assert.throws(() => P.parsePack(t(bc, 'normal')), (e) => e.code === 'COMPRESSED_NORMAL');
  assert.throws(() => P.parsePack(t(Buffer.from('GIF89a......'), 'diffuse')), (e) => e.code === 'PACK_BAD_IMAGE');
});

test('a pack missing an image a slot names, or carrying one no slot names, is refused', () => {
  const o = JSON.parse(P.serializePack(pack()));
  assert.throws(() => P.parsePack(JSON.stringify({ ...o, images: o.images.slice(1) })), (e) => e.code === 'PACK_MISSING_IMAGE');
  assert.throws(() => P.makePack({ name: 'x', font: 'flat', slots: {}, images: { stray: { bytes: png(1) } } }), (e) => e.code === 'PACK_UNUSED_IMAGE');
  assert.throws(() => P.parsePack(JSON.stringify({ ...o, font: 'moon' })), (e) => e.code === 'BAD_PACK');
  assert.throws(() => P.parsePack(JSON.stringify({ ...o, pack: 2 })), (e) => e.code === 'SCHEMA_TOO_NEW');
});
