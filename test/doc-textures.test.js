// doc-textures.test.js: node --test test/*.test.js
// Texture SLOTS in the document (ARCHITECTURE §5b: "Each part of the cross-section gets its own material: floor, walls,
// lines, kerbs, edge glow. A font can carry default textures, and any word can override them."), schema 2, and the
// migration from schema 1. Dependency-free.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const T = require('../src/texture/slots.js');

test('the five slots, in §5b\'s order', () => {
  assert.deepEqual(T.SLOTS, ['floor', 'walls', 'lines', 'kerbs', 'edgeGlow']);
});

test('a word with no overrides takes its font\'s defaults for every slot', () => {
  const d = D.appendWord(D.createDoc(), 'turn');   // a bowl
  const eff = T.effectiveSlots(d.words[0]);
  assert.deepEqual(Object.keys(eff), T.SLOTS);
  for (const s of T.SLOTS) assert.deepEqual(eff[s], T.fontDefaults('bowl')[s]);
});

test('a word overrides one slot\'s texture and tiling; the other slots keep the font\'s', () => {
  let d = D.appendWord(D.createDoc(), 'straight');
  d = D.editWord(d, 'w1', { textures: { floor: { texture: 'asphalt-dark', tileLength: 7.5 } } });
  const eff = T.effectiveSlots(d.words[0]);
  assert.equal(eff.floor.texture, 'asphalt-dark');
  assert.equal(eff.floor.tileLength, 7.5);
  assert.equal(eff.floor.fit, T.fontDefaults('flat').floor.fit);
  assert.deepEqual(eff.walls, T.fontDefaults('flat').walls);
});

test('texture overrides are canonical in the text, and round-trip byte-exact', () => {
  let d = D.appendWord(D.appendWord(D.createDoc('t'), 'straight'), 'wall-ride');
  d = D.editWord(d, 'w2', { textures: { edgeGlow: { dir: 'across', texture: 'neon' }, floor: { offset: 2.5, fit: 'fit', texture: 'stripes' } } });
  const t = D.serialize(d);
  assert.match(t, /"textures":\{"floor":\{"texture":"stripes","fit":"fit","offset":2\.5\},"edgeGlow":\{"texture":"neon","dir":"across"\}\}/);
  assert.equal(D.serialize(D.parse(t)), t);
});

test('the document is schema 2 or later (textures arrived in 2), and writes the schema it is', () => {
  assert.ok(D.SCHEMA >= 2);
  assert.match(D.serialize(D.createDoc()), new RegExp(`"schema": ${D.SCHEMA},`));
});

test('a schema-1 document migrates: it loads as the current schema with no overrides, and resolves to the same track', () => {
  const t1 = '{\n  "schema": 1,\n  "generator": "t180-track-builder/doc 0.1.0",\n  "name": "old",\n  "closed": false,\n  "nextId": 3,\n' +
    '  "words": [\n    {"id":"w1","word":"straight","font":"flat","tempo":"standard","speedKmh":null,"handles":{"length":100,"turn":0,"climb":0,"easeIn":0.3,"easeOut":0.3,"roll0":0,"roll1":0,"heartline":0,"psiL":0,"psiR":0,"width":20,"wall":0,"ramp":20}},\n' +
    '    {"id":"w2","phrase":"S","words":[{"word":"turn","font":"bowl","tempo":"standard","speedKmh":null,"handles":{"length":448.7995,"turn":60,"climb":0,"easeIn":0.3,"easeOut":0.3,"roll0":0,"roll1":0,"heartline":0,"psiL":15,"psiR":60,"width":16,"wall":8,"ramp":20}}]}\n  ],\n' +
    '  "constraints": {"pins":[],"free":[]}\n}\n';
  const d = D.parse(t1);
  assert.equal(d.schema, D.SCHEMA);
  assert.deepEqual(d.words[0].textures, {});
  assert.deepEqual(d.words[1].words[0].textures, {});
  assert.match(D.serialize(d), new RegExp(`"schema": ${D.SCHEMA},`));
  const again = D.serialize(D.parse(D.serialize(d)));
  assert.equal(again, D.serialize(d));
  assert.ok(D.resolve(d).segments.length > 0);
});

test('a schema newer than the builder reads is refused as written by a newer builder, and schema 0 as unknown', () => {
  const o = JSON.parse(D.serialize(D.appendWord(D.createDoc(), 'turn')));
  assert.throws(() => D.parse(JSON.stringify({ ...o, schema: D.SCHEMA + 1 })), (e) => e.code === 'SCHEMA_TOO_NEW');
  assert.throws(() => D.parse(JSON.stringify({ ...o, schema: 0 })), (e) => e.code === 'SCHEMA_UNKNOWN');
});

test('an unknown slot, an unknown setting, and an out-of-range value are refused by name', () => {
  const d = D.appendWord(D.createDoc(), 'straight');
  assert.throws(() => D.editWord(d, 'w1', { textures: { roof: { texture: 'x' } } }), (e) => e.code === 'BAD_TEXTURES');
  assert.throws(() => D.editWord(d, 'w1', { textures: { floor: { shine: 1 } } }), (e) => e.code === 'BAD_TEXTURES');
  assert.throws(() => D.editWord(d, 'w1', { textures: { floor: { tileLength: 0 } } }), (e) => e.code === 'BAD_TEXTURES');
  assert.throws(() => D.editWord(d, 'w1', { textures: { floor: { fit: 'squash' } } }), (e) => e.code === 'BAD_TEXTURES');
  assert.throws(() => D.editWord(d, 'w1', { textures: { floor: { texture: '../x.png' } } }), (e) => e.code === 'BAD_TEXTURES');
});

test('a jump has no surface, so it takes no texture overrides (its landing ramp wears the take-off road\'s)', () => {
  const d = D.appendWord(D.appendWord(D.createDoc(), 'straight'), 'jump');
  assert.deepEqual(d.words[1].textures, {});
  assert.throws(() => D.editWord(d, 'w2', { textures: { floor: { texture: 'x' } } }), (e) => e.code === 'BAD_TEXTURES');
});

test('sculpting a texture is one undo step, and undo is byte-identical', () => {
  let h = D.createHistory(D.appendWord(D.createDoc(), 'straight'));
  const before = D.serialize(h.present);
  h = D.commit(h, D.editWord(h.present, 'w1', { textures: { lines: { texture: 'white-dash' } } }));
  assert.equal(h.past.length, 1);
  assert.equal(D.serialize(D.undo(h).present), before);
});

test('a schema-1 piece library migrates too: its pieces\' words get no overrides, and placing one works', () => {
  const L = require('../src/doc/library.js');
  const lib1 = '{\n  "schema": 1,\n  "generator": "t180-track-builder/doc 0.1.0",\n  "nextId": 2,\n  "pieces": [\n' +
    '    {"id":"u1","name":"my s","author":"me","kind":"word","words":[{"word":"straight","font":"flat","tempo":"standard","speedKmh":null,"handles":{"length":50,"turn":0,"climb":0,"easeIn":0.3,"easeOut":0.3,"roll0":0,"roll1":0,"heartline":0,"psiL":0,"psiR":0,"width":20,"wall":0,"ramp":20}}]}\n  ]\n}\n';
  const lib = L.parseLibrary(lib1);
  const p = lib.pieces.find((x) => x.name === 'my s');
  assert.deepEqual(p.words[0].textures, {});
  assert.match(L.serializeLibrary(lib), new RegExp(`"schema": ${D.SCHEMA},`));
  assert.deepEqual(L.placePiece(D.createDoc(), lib, 'my s').words[0].textures, {});
});

test('a file whose word carries bad textures is refused on load, not only on edit', () => {
  const t = D.serialize(D.appendWord(D.createDoc(), 'straight')).replace('"textures":{}', '"textures":{"roof":{}}');
  assert.throws(() => D.parse(t), (e) => e.code === 'BAD_TEXTURES');
});

test('texture lengths in a file are snapped to the length quantum on load', () => {
  const t = D.serialize(D.appendWord(D.createDoc(), 'straight')).replace('"textures":{}', '"textures":{"floor":{"tileLength":7.500004}}');
  assert.equal(D.parse(t).words[0].textures.floor.tileLength, 7.5);
});
