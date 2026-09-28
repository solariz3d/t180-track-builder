// doc-code.test.js: node --test test/doc-code.test.js. Shareable codes (ARCHITECTURE §1.1: "That makes tracks shareable
// (PolyTrack-style codes), diffable, undoable") for a track, a piece or phrase, and a texture pack.
// STATED BEFORE THE FIRST RUN: the sample track (test/export_words.test.js's "Sample Loop", closed by the connector)
// codes to at most 1,200 characters.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const D = require('../src/doc/index.js');
const C = require('../src/doc/code.js');
const L = require('../src/doc/library.js');
const P = require('../src/doc/packs.js');
const T = require('../src/texture/index.js');
const { deflateRaw } = require('../src/texture/deflate.js');
const { closeLoop } = require('../src/doc/connector.js');

const kmh = (v) => v / 3.6;
function sampleDoc() {   // test/export_words.test.js sampleDoc, verbatim in effect
  let d = D.createDoc('Sample Loop');
  for (const w of ['straight', 'straight', 'tight', 'straight', 'tight']) d = D.appendWord(d, w, { speed: kmh(200) });
  d = D.editWord(d, 'w3', { handles: { length: 50 } });
  const c = closeLoop(d);
  assert.ok(c.candidates.length, c.reason);
  const best = c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
  return best.words.reduce((x, w) => D.editWord(x, w.id, { speed: kmh(200) }), best);
}
const rich = () => {
  let d = D.appendPhrase(D.appendWord(D.createDoc('Rich — ünïcode'), 'straight', { handles: { length: 600 } }), 'S', [{ word: 'tight', opts: { font: 'flat' } }, { word: 'jump' }, { word: 'straight' }]);
  d = D.editWord(d, 'w1', { textures: { floor: { texture: 'grain', tileLength: 3 } } });
  return D.setPitLane(d, { leave: { word: 'w1', along: 100 }, rejoin: { word: 'w1', along: 500 } });
};

test('the encoder is DEFLATE any inflate reads: node\'s zlib inflates every output, text and noise, empty to 100 kB', () => {
  const noise = Uint8Array.from({ length: 100000 }, (_, i) => (i % 900 < 450 ? 97 + (i * 7 % 13) : (i * 2654435761) >>> 24));
  for (const b of [new Uint8Array(0), Buffer.from('a'), Buffer.from('ab'.repeat(500)), Buffer.from(D.serialize(rich())), noise]) {
    assert.deepEqual(new Uint8Array(zlib.inflateRawSync(deflateRaw(b))), new Uint8Array(b));
  }
});

test('a track round-trips byte-exact through its code, whatever it holds (a phrase, a jump, textures, a pit lane, non-ASCII)', () => {
  const t = D.serialize(rich()), code = C.docToCode(rich());
  assert.match(code, /^t180d1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  assert.equal(D.serialize(C.docFromCode(code)), t);
  assert.equal(C.docToCode(C.docFromCode(code)), code, 'the same track, the same code');
});

test('the sample track\'s code is under the stated 1,200 characters, and round-trips', (t) => {
  const d = sampleDoc(), code = C.docToCode(d);
  t.diagnostic(`sample track: ${code.length} characters of code for ${D.serialize(d).length} of canonical text`);
  assert.ok(code.length <= 1200, `the sample track's code is ${code.length} characters (${D.serialize(d).length} of text)`);
  assert.equal(D.serialize(C.docFromCode(code)), D.serialize(d));
});

test('a piece and a phrase round-trip byte-exact through their codes into another library', () => {
  let d = D.appendWord(D.appendWord(D.appendWord(D.createDoc(), 'straight'), 'tight'), 'straight');
  d = D.editWord(d, 'w2', { handles: { length: 77 } });
  let lib = L.savePiece(L.builtinLibrary(), { name: 'hook', author: 'me', doc: d, ids: ['w2'] });
  lib = L.savePiece(lib, { name: 'run', author: 'me', doc: d, ids: ['w1', 'w2', 'w3'] });
  for (const name of ['hook', 'run']) {
    const back = C.pieceFromCode(L.builtinLibrary(), C.pieceToCode(lib, name));
    assert.equal(L.exportPiece(back, name), L.exportPiece(lib, name));
  }
  assert.throws(() => C.pieceFromCode(lib, C.pieceToCode(lib, 'hook')), (e) => e.code === 'NAME_TAKEN');
});

const png = (n) => { const rgba = new Uint8Array(n * n * 4); let x = 7; for (let i = 0; i < rgba.length; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; rgba[i] = i % 4 === 3 ? 255 : x >>> 24; } return T.png.encodePng({ width: n, height: n, rgba }, zlib.deflateSync); };
const packWith = (n) => P.makePack({ name: 'P', font: 'flat', slots: { floor: { texture: 'img' } }, images: { img: { bytes: png(n) } } });

test('a texture pack round-trips byte-exact through its code; one whose images pass the limit is refused with its size', () => {
  const t = P.serializePack(packWith(16));
  assert.equal(C.packFromCode(C.packToCode(packWith(16))), t);
  assert.equal(P.serializePack(P.importPack({ packs: [], images: {} }, C.packFromCode(C.packToCode(packWith(16)))).packs[0]), t);
  assert.throws(() => C.packToCode(packWith(512)), (e) => e.code === 'CODE_TOO_LARGE' && /characters, over the 262,144/.test(e.message) && /pack file/.test(e.message));
});

test('a corrupted or truncated code is refused by name, and nothing is imported', () => {
  const code = C.docToCode(rich()), [head, payload, check] = code.split('.');
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  const cases = {
    'a flipped payload character': `${head}.${flip(payload, Math.floor(payload.length / 2))}.${check}`,
    'the payload cut short': `${head}.${payload.slice(0, payload.length - 9)}.${check}`,
    'a wrong check': `${head}.${payload}.${check === '00000000' ? '00000001' : '00000000'}`,
  };
  for (const [what, bad] of Object.entries(cases)) assert.throws(() => C.docFromCode(bad), (e) => e.code === 'CODE_CORRUPT', what);
  assert.throws(() => C.docFromCode(code.slice(0, code.length - 3)), (e) => e.code === 'CODE_MALFORMED', 'the check cut short');
  assert.throws(() => C.docFromCode('hello'), (e) => e.code === 'CODE_MALFORMED');
  const lib = L.builtinLibrary(), before = L.serializeLibrary(lib);
  assert.throws(() => C.pieceFromCode(lib, 't180p1.AAAA.00000000'), (e) => e.code === 'CODE_CORRUPT');
  assert.equal(L.serializeLibrary(lib), before, 'the library is untouched');
});

test('spaces and line breaks in a pasted code are ignored; the wrong kind, a newer or unknown format are refused by name', () => {
  const code = C.docToCode(rich()), wrapped = code.replace(/(.{40})/g, '$1\n  ');
  assert.equal(D.serialize(C.docFromCode(wrapped)), D.serialize(rich()));
  assert.throws(() => C.pieceFromCode(L.builtinLibrary(), code), (e) => e.code === 'CODE_KIND' && /track code/.test(e.message));
  assert.throws(() => C.docFromCode(code.replace('t180d1', 't180d2')), (e) => e.code === 'CODE_TOO_NEW');
  assert.throws(() => C.docFromCode(code.replace('t180d1', 't180d0')), (e) => e.code === 'CODE_VERSION');
  assert.throws(() => C.docFromCode(code.replace('t180d1', 't180x1')), (e) => e.code === 'CODE_KIND');
});

test('a code holding an older document migrates as src/doc does; a newer schema is refused as src/doc does', () => {
  const t3 = D.serialize(D.appendWord(D.createDoc('old'), 'straight'));
  const t2 = t3.replace('"schema": 3', '"schema": 2').replace('  "pitLane": null,\n', '');
  assert.equal(D.serialize(C.docFromCode(C.encode('d', t2))), t3);
  assert.throws(() => C.docFromCode(C.encode('d', t3.replace('"schema": 3', '"schema": 9'))), (e) => e.code === 'SCHEMA_TOO_NEW');
});

test('a code that would inflate past the text limit is refused as too large, not held in memory', () => {
  const bomb = C.encode('d', 'x'.repeat(10)).split('.');
  const big = deflateRaw(new Uint8Array(C.MAX_TEXT + 10).fill(120));
  const b64u = Buffer.from(big).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.ok(b64u.length < C.MAX_CODE, `the bomb's code is ${b64u.length} characters`);
  assert.throws(() => C.docFromCode(`${bomb[0]}.${b64u}.${bomb[2]}`), (e) => e.code === 'CODE_TOO_LARGE');
});

test('a payload of impossible length, and bytes that are not UTF-8 (even with a matching check), are refused as corrupt, each by its reason', () => {
  const [head, payload, check] = C.docToCode(rich()).split('.');
  const cut = payload.slice(0, Math.floor((payload.length - 1) / 4) * 4 + 1);   // 4k + 1 characters: no base64 ends so
  assert.equal(cut.length % 4, 1);
  assert.throws(() => C.docFromCode(`${head}.${cut}.${check}`), (e) => e.code === 'CODE_CORRUPT' && /impossible length/.test(e.message));
  const bytes = Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]), crc = T.png.crc32(bytes, 0, bytes.length).toString(16).padStart(8, '0');
  const b64u = Buffer.from(deflateRaw(bytes)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.throws(() => C.docFromCode(`t180d1.${b64u}.${crc}`), (e) => e.code === 'CODE_CORRUPT' && /UTF-8/.test(e.message));
});
