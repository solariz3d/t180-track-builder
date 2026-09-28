// doc-library.test.js: node --test test/*.test.js
// Sculpting and the piece library (the keeper, 12:22: "but you can also sculp pieces, and then even create and save
// your own unqiue pieces"; ARCHITECTURE §2 handles and phrases; docs/INTERFACES.md §4b). Dependency-free.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const L = require('../src/doc/library.js');

const DEG = Math.PI / 180;
const geometry = (segs) => segs.map(({ id, ...g }) => g);   // a placed piece has new ids; everything else must match

/** A track with a sculpted two-word run (w2, w3) in the middle. */
function sculpted() {
  let d = D.appendWord(D.appendWord(D.appendWord(D.appendWord(D.createDoc('s'), 'straight'), 'turn'), 'tight', { dir: 'R' }), 'straight');
  // roll1 named: from D182 a default turn banks into itself, and w3 below starts level
  // the font NAMED, a walled one (tube): from D182 the three measured fonts build a floor across the width and no wall
  d = D.editWord(d, 'w2', { font: 'tube', handles: { length: 222.5, turn: 50 * DEG, easeIn: 0.2, climb: 2 * DEG, width: 24, wall: 10, psiR: 70 * DEG, roll1: 0 } });
  d = D.editWord(d, 'w3', { handles: { easeOut: 0.1, roll0: 0, roll1: 5 * DEG } });
  return D.editWord(d, 'w4', { handles: { roll0: 5 * DEG, roll1: 0 } });   // the next word carries the bank, then levels
}

// ── sculpting ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('every handle the keeper names is sculptable: length, curvature and ramps, pitch, bank, width, wall and ψ', () => {
  const want = ['length', 'turn', 'easeIn', 'easeOut', 'climb', 'roll0', 'roll1', 'width', 'wall', 'psiL', 'psiR'];
  for (const h of want) assert.ok(D.handlesOf('turn').includes(h), `${h} is not a handle`);
  const d = sculpted();
  assert.equal(d.words[1].handles.wall, 10);
  assert.deepEqual(D.resolve(d).segments.find((g) => g.id === 'w2').profile.u, [-22, -12, 0, 12, 22]);
});

test('each handle edit is one undo step, and undo is byte-identical', () => {
  let h = D.createHistory(D.appendWord(D.createDoc(), 'turn'));
  const before = D.serialize(h.present);
  h = D.commit(h, D.editWord(h.present, 'w1', { handles: { wall: 12 } }));
  assert.equal(h.past.length, 1);
  assert.equal(D.serialize(D.undo(h).present), before);
});

test('the sculpt hook reports each handle with its value, unit and range, and passes physics bounds through untouched', () => {
  const d = sculpted(), calls = [];
  const info = L.handleInfo(d, 'w2', (doc, id) => { calls.push(id); return { turn: { min: 0, max: 1, why: 'test', source: 'nowhere' } }; });
  assert.deepEqual(calls, ['w2']);
  assert.equal(info.handles.wall.value, 10);
  assert.equal(info.handles.wall.unit, 'm');
  assert.ok(info.handles.turn.range[0] < 0 && info.handles.turn.range[1] > 0);
  assert.deepEqual(info.physics, { turn: { min: 0, max: 1, why: 'test', source: 'nowhere' } });
  assert.equal(L.handleInfo(d, 'w2').physics, null, 'no provider, no physics: the model computes none');
});

// ── the library ────────────────────────────────────────────────────────────────────────────────────────────────────
test('the built-in library holds one piece per word and the starter phrases, and the palette reads from it', () => {
  const lib = L.builtinLibrary(), pal = L.palette(lib);
  assert.deepEqual(pal.filter((p) => p.builtin && p.kind === 'word').map((p) => p.name), Object.keys(D.WORDS));
  assert.deepEqual(pal.filter((p) => p.builtin && p.kind === 'phrase').map((p) => p.name), require('../src/doc/phrasebook.js').PHRASES.map((p) => p.name));
  assert.ok(pal.every((p) => typeof p.id === 'string' && Array.isArray(p.words)));
});

test('a sculpted run saved as a named piece, then placed, resolves to the same segments', () => {
  const d = sculpted();
  let lib = L.savePiece(L.builtinLibrary(), { name: 'my-bend', author: 'keeper', doc: d, ids: ['w2', 'w3'] });
  const piece = L.palette(lib).find((p) => p.name === 'my-bend');
  assert.deepEqual([piece.builtin, piece.kind, piece.words], [false, 'phrase', ['turn', 'tight']]);
  const placed = L.placePiece(D.appendWord(D.createDoc(), 'straight'), lib, 'my-bend');
  const orig = D.resolve(d).segments.filter((g) => g.id === 'w2' || g.id === 'w3');
  const mine = D.resolve(placed).segments.filter((g) => g.id.startsWith('w2/'));
  assert.deepEqual(geometry(mine), geometry(orig));
});

test('a single sculpted word saves as a word piece and places as the same word', () => {
  const d = sculpted();
  const lib = L.savePiece(L.builtinLibrary(), { name: 'wide-turn', author: 'keeper', doc: d, ids: ['w2'] });
  const placed = L.placePiece(D.appendWord(D.createDoc(), 'straight'), lib, 'wide-turn');
  assert.equal(placed.words[1].word, 'turn');
  assert.deepEqual(placed.words[1].handles, d.words[1].handles);
  assert.deepEqual(geometry(D.resolve(placed).segments.filter((g) => g.id === 'w2')), geometry(D.resolve(d).segments.filter((g) => g.id === 'w2')));
});

test('a piece keeps its roll RELATIVE: placed after an inversion it starts at the head\'s roll, not a roll step', () => {
  const d = sculpted();
  const lib = L.savePiece(L.builtinLibrary(), { name: 'banked', author: 'k', doc: d, ids: ['w3'] });
  const after = L.placePiece(D.appendWord(D.createDoc(), 'inversion'), lib, 'banked');
  const w = after.words[1];
  assert.ok(Math.abs(w.handles.roll0 - 2 * Math.PI) < 1e-12 && Math.abs(w.handles.roll1 - (2 * Math.PI + 5 * DEG)) < 1e-9);
  assert.doesNotThrow(() => D.resolve(after));
});

test('a run saved after an inversion is stored starting at roll 0, and places level on a level track', () => {
  const d = D.appendWord(D.appendWord(D.createDoc(), 'inversion'), 'turn');   // the turn starts at roll 2π
  const lib = L.savePiece(L.builtinLibrary(), { name: 'after-roll', author: 'k', doc: d, ids: ['w2'] });
  assert.match(L.exportPiece(lib, 'after-roll'), /"roll0":0,/);
  const placed = L.placePiece(D.appendWord(D.createDoc(), 'straight'), lib, 'after-roll'), h = placed.words[1].handles, own = d.words[1].handles;
  assert.equal(h.roll0, 0);
  assert.ok(Math.abs((h.roll1 - h.roll0) - (own.roll1 - own.roll0)) < 1e-9, 'it keeps its own lean (0 before D182, its bank after)');
});

test('placing a piece is one undo step, and undo is byte-identical', () => {
  const lib = L.savePiece(L.builtinLibrary(), { name: 'my-bend', author: 'k', doc: sculpted(), ids: ['w2', 'w3'] });
  let h = D.createHistory(D.appendWord(D.createDoc(), 'straight'));
  const before = D.serialize(h.present);
  h = D.commit(h, L.placePiece(h.present, lib, 'my-bend'));
  assert.equal(h.past.length, 1);
  assert.equal(D.serialize(D.undo(h).present), before);
});

test('a built-in piece places exactly as appending its word does', () => {
  const lib = L.builtinLibrary(), base = D.appendWord(D.createDoc(), 'straight');
  assert.equal(D.serialize(L.placePiece(base, lib, 'tight')), D.serialize(D.appendWord(base, 'tight')));
});

// ── names ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a name that clashes with a built-in is refused; so is one that clashes with a saved piece, and an empty one', () => {
  const lib = L.savePiece(L.builtinLibrary(), { name: 'mine', author: 'k', doc: sculpted(), ids: ['w2'] });
  assert.throws(() => L.savePiece(lib, { name: 'turn', author: 'k', doc: sculpted(), ids: ['w2'] }), (e) => e.code === 'NAME_IS_BUILTIN');
  assert.throws(() => L.savePiece(lib, { name: 'Turn', author: 'k', doc: sculpted(), ids: ['w2'] }), (e) => e.code === 'NAME_IS_BUILTIN', 'case does not make a new name');
  assert.throws(() => L.savePiece(lib, { name: 'mine', author: 'k', doc: sculpted(), ids: ['w2'] }), (e) => e.code === 'NAME_TAKEN');
  assert.throws(() => L.savePiece(lib, { name: '  ', author: 'k', doc: sculpted(), ids: ['w2'] }), (e) => e.code === 'BAD_NAME');
});

test('a run must be consecutive words of the document', () => {
  assert.throws(() => L.savePiece(L.builtinLibrary(), { name: 'gappy', author: 'k', doc: sculpted(), ids: ['w1', 'w3'] }), (e) => e.code === 'NOT_A_RUN');
  assert.throws(() => L.savePiece(L.builtinLibrary(), { name: 'none', author: 'k', doc: sculpted(), ids: ['w9'] }), (e) => e.code === 'NO_SUCH_WORD');
});

// ── text ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a piece exported as text and re-imported exports byte-exact again', () => {
  const lib = L.savePiece(L.builtinLibrary(), { name: 'my-bend', author: 'keeper', doc: sculpted(), ids: ['w2', 'w3'] });
  const text = L.exportPiece(lib, 'my-bend');
  const other = L.importPiece(L.builtinLibrary(), text);
  assert.equal(L.exportPiece(other, 'my-bend'), text);
});

test('an imported piece places to the same segments as the one it was exported from', () => {
  const lib = L.savePiece(L.builtinLibrary(), { name: 'my-bend', author: 'keeper', doc: sculpted(), ids: ['w2', 'w3'] });
  const other = L.importPiece(L.builtinLibrary(), L.exportPiece(lib, 'my-bend'));
  const base = D.appendWord(D.createDoc(), 'straight');
  assert.deepEqual(D.resolve(L.placePiece(base, other, 'my-bend')), D.resolve(L.placePiece(base, lib, 'my-bend')));
});

test('the exported text does not depend on where the piece sits: imported into a fuller library, it exports the same', () => {
  const lib = L.savePiece(L.builtinLibrary(), { name: 'my-bend', author: 'keeper', doc: sculpted(), ids: ['w2', 'w3'] });
  const fuller = L.savePiece(L.builtinLibrary(), { name: 'other', author: 'k', doc: sculpted(), ids: ['w1'] });
  const text = L.exportPiece(lib, 'my-bend'), there = L.importPiece(fuller, text);
  assert.equal(there.pieces.find((p) => p.name === 'my-bend').id, 'u2', 'it got the next id of the library it went into');
  assert.equal(L.exportPiece(there, 'my-bend'), text);
});

test('a library file with two pieces of one name, or a piece named like a built-in, is refused on load', () => {
  const lib = L.savePiece(L.savePiece(L.builtinLibrary(), { name: 'a', author: 'k', doc: sculpted(), ids: ['w2'] }), { name: 'b', author: 'k', doc: sculpted(), ids: ['w3'] });
  const t = L.serializeLibrary(lib);
  assert.throws(() => L.parseLibrary(t.replace('"name":"b"', '"name":"A"')), (e) => e.code === 'NAME_TAKEN');
  assert.throws(() => L.parseLibrary(t.replace('"name":"b"', '"name":"jump"')), (e) => e.code === 'NAME_IS_BUILTIN');
});

test('importing a piece whose name is a built-in, or already taken, is refused', () => {
  const lib = L.savePiece(L.builtinLibrary(), { name: 'my-bend', author: 'k', doc: sculpted(), ids: ['w2'] });
  const text = L.exportPiece(lib, 'my-bend');
  assert.throws(() => L.importPiece(lib, text), (e) => e.code === 'NAME_TAKEN');
  assert.throws(() => L.importPiece(L.builtinLibrary(), text.replace('"name":"my-bend"', '"name":"sweep"')), (e) => e.code === 'NAME_IS_BUILTIN');
});

test('the whole library saves and loads byte-exact, and a newer schema is refused', () => {
  let lib = L.savePiece(L.builtinLibrary(), { name: 'a', author: 'k', doc: sculpted(), ids: ['w2'] });
  lib = L.savePiece(lib, { name: 'b', author: 'k', doc: sculpted(), ids: ['w2', 'w3'] });
  const t = L.serializeLibrary(lib);
  assert.equal(L.serializeLibrary(L.parseLibrary(t)), t);
  assert.throws(() => L.parseLibrary(t.replace('"schema": 3', '"schema": 4')), (e) => e.code === 'SCHEMA_TOO_NEW');
  assert.throws(() => L.importPiece(L.builtinLibrary(), L.exportPiece(lib, 'a').replace('"schema": 3', '"schema": 4')), (e) => e.code === 'SCHEMA_TOO_NEW');
});

test('a saved library holds only the user\'s pieces; the built-ins come from the program, not the file', () => {
  const lib = L.savePiece(L.builtinLibrary(), { name: 'a', author: 'k', doc: sculpted(), ids: ['w2'] });
  const o = JSON.parse(L.serializeLibrary(lib));
  assert.deepEqual(o.pieces.map((p) => p.name), ['a']);
  assert.ok(L.palette(L.parseLibrary(L.serializeLibrary(lib))).some((p) => p.builtin && p.name === 'tight'));
});
