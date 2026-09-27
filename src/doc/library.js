// library.js: the piece library, and the sculpt hook (the keeper, 12:22: "but you can also sculp pieces, and then even
// create and save your own unqiue pieces"; ARCHITECTURE §2 handles and phrases; docs/INTERFACES.md §4b).
//
//   builtinLibrary() -> lib            one built-in piece per word, from the program itself
//   palette(lib) -> [{ id, name, builtin, kind, words }]      what the build palette shows: built-ins first
//   savePiece(lib, { name, author, doc, ids }) -> lib         a sculpted word, or a run of consecutive words, by name
//   placePiece(doc, lib, name) -> doc                         append it at the head: one operation, one undo entry
//   exportPiece(lib, name) -> text · importPiece(lib, text) -> lib             share one piece as text
//   serializeLibrary(lib) -> text · parseLibrary(text) -> lib                  the user's whole library
//   handleInfo(doc, id, boundsFn?) -> { handles: { h: { value, unit, range } }, physics }
//
// A PIECE is { id, name, author, builtin, kind: 'word' | 'phrase', words: [word] }: a word is exactly a document word's
// content (word, font, tempo, speed, handles). A phrase is two or more of them.
// ROLL IS STORED RELATIVE. A piece's first road word starts at roll 0, and placing it adds the head's roll. A piece saved
// after an inversion therefore places anywhere without a roll step.
// NAMES. §2 says users make and share their own phrases; it says nothing about names. So a name that is a built-in
// word's, in any case, is REFUSED, and so is one a saved piece already has: a palette entry must mean one thing.
// THE TEXT is the document's canonical form (serial.js), so a piece pasted as text round-trips byte-exact. A saved
// library holds the user's pieces only; the built-ins come from the program, so a newer builder's built-ins are not
// frozen into old files.
// PHYSICS BOUNDS are validation's (INTERFACES §4b handleBounds). The model computes none: handleInfo passes a provider's
// answer through untouched, and says `physics: null` without one. Whether a drag stops at red or only turns red is the
// app's call (§4b leaves it open).
'use strict';

const { WORDS } = require('./vocab.js');
const S = require('./serial.js');
const { DocError, UNIT, RANGE, quantise, checkWordBody, wordText, loadWord, onlyKeys, deepFreeze, SCHEMA, GENERATOR } = S;
const { appendWord, appendPhrase, defaultWord, headRoll } = require('./document.js');

const SI_UNIT = { m: 'm', deg: 'rad', ratio: 'ratio' };
const key = (s) => s.trim().toLowerCase();
const isBuiltinName = (name) => Object.keys(WORDS).some((w) => key(w) === key(name));

function builtinLibrary() {
  const pieces = Object.keys(WORDS).map((w) => {
    const d = defaultWord(w);
    return { id: `b-${w}`, name: w, author: 't180-track-builder', builtin: true, kind: 'word', words: [{ word: d.word, font: d.font, tempo: d.tempo, speed: d.speed, handles: d.handles, textures: d.textures }] };
  });
  return deepFreeze({ schema: SCHEMA, generator: GENERATOR, nextId: 1, pieces });
}

function palette(lib) {
  return [...lib.pieces.filter((p) => p.builtin), ...lib.pieces.filter((p) => !p.builtin)]
    .map((p) => ({ id: p.id, name: p.name, builtin: p.builtin, kind: p.kind, words: p.words.map((w) => w.word) }));
}

function checkName(lib, name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60 || /[\u0000-\u001f]/.test(name)) throw new DocError('BAD_NAME', `a piece needs a name of 1 to 60 printable characters, got ${JSON.stringify(name)}`);
  if (name !== name.trim()) throw new DocError('BAD_NAME', 'a name may not start or end with a space');
  if (isBuiltinName(name)) throw new DocError('NAME_IS_BUILTIN', `"${name}" is a built-in word`);
  if (lib.pieces.some((p) => !p.builtin && key(p.name) === key(name))) throw new DocError('NAME_TAKEN', `a saved piece is already called "${name}"`);
}

/** Road words' roll made relative to the first road word's roll0 (shift = −that roll0), or re-based onto `base`. */
function shiftRoll(words, shift) {
  return words.map((w) => (w.word === 'jump' ? w : { ...w, handles: { ...w.handles, roll0: quantise('deg', w.handles.roll0 + shift), roll1: quantise('deg', w.handles.roll1 + shift) } }));
}
const firstRoll = (words) => { const r = words.find((w) => w.word !== 'jump'); return r ? r.handles.roll0 : 0; };

function savePiece(lib, { name, author = '', doc, ids }) {
  checkName(lib, name);
  if (typeof author !== 'string') throw new DocError('BAD_NAME', 'author must be a string');
  if (!Array.isArray(ids) || ids.length === 0) throw new DocError('NOT_A_RUN', 'a piece needs at least one word id');
  const at = ids.map((id) => { const i = doc.words.findIndex((e) => e.id === id); if (i < 0) throw new DocError('NO_SUCH_WORD', `no word with id ${id}`); return i; });
  for (let k = 1; k < at.length; k++) if (at[k] !== at[k - 1] + 1) throw new DocError('NOT_A_RUN', `${ids.join(', ')} are not consecutive words of the document`);
  let words = [];
  for (const i of at) { const e = doc.words[i]; for (const w of e.phrase !== undefined ? e.words : [e]) words.push({ word: w.word, font: w.font, tempo: w.tempo, speed: w.speed, handles: w.handles, textures: w.textures }); }
  words = shiftRoll(words, -firstRoll(words));
  words.forEach((w, j) => checkWordBody(w, `${name}[${j}]`));
  const piece = { id: `u${lib.nextId}`, name, author, builtin: false, kind: words.length === 1 ? 'word' : 'phrase', words };
  return deepFreeze({ ...lib, nextId: lib.nextId + 1, pieces: [...lib.pieces, piece] });
}

function findPiece(lib, name) {
  const p = lib.pieces.find((x) => x.name === name);
  if (!p) throw new DocError('NO_SUCH_PIECE', `no piece called "${name}"`);
  return p;
}

/** Append a piece at the head of doc. A built-in appends its word with the defaults; a user piece, its handles. */
function placePiece(doc, lib, name) {
  const p = findPiece(lib, name);
  if (p.builtin) return appendWord(doc, p.words[0].word);
  const words = shiftRoll(p.words, headRoll(doc));
  const opts = (w) => ({ tempo: w.tempo, font: w.font === null ? undefined : w.font, speed: w.speed, handles: w.handles, textures: w.textures });
  if (p.kind === 'word') return appendWord(doc, words[0].word, opts(words[0]));
  return appendPhrase(doc, p.name, words.map((w) => ({ word: w.word, opts: opts(w) })));
}

// ---------------------------------------------------------------------------------------------- text
const str = JSON.stringify;
const pieceBody = (p) => `${str('name')}:${str(p.name)},${str('author')}:${str(p.author)},${str('kind')}:${str(p.kind)},${str('words')}:[${p.words.map((w) => `{${wordText(w)}}`).join(',')}]`;
const head = (lib) => `  ${str('schema')}: ${lib.schema},\n  ${str('generator')}: ${str(lib.generator)},\n`;

function exportPiece(lib, name) {
  const p = findPiece(lib, name);
  if (p.builtin) throw new DocError('BUILTIN_PIECE', `"${name}" is built in; every builder already has it`);
  return `{\n${head(lib)}  ${str('piece')}: {${pieceBody(p)}}\n}\n`;
}

function serializeLibrary(lib) {
  const user = lib.pieces.filter((p) => !p.builtin);
  const list = user.length ? '[\n' + user.map((p) => `    {${str('id')}:${str(p.id)},${pieceBody(p)}}`).join(',\n') + '\n  ]' : '[]';
  return `{\n${head(lib)}  ${str('nextId')}: ${lib.nextId},\n  ${str('pieces')}: ${list}\n}\n`;
}

function readJson(text) {
  let o; try { o = JSON.parse(text); } catch (e) { throw new DocError('BAD_JSON', e.message); }
  if (!o || typeof o !== 'object') throw new DocError('BAD_DOC', 'not an object');
  // Schema 1 -> 2: every piece's words get `textures: {}`, exactly as serial.js migrates a document's words.
  if (o.schema === 1) {   // strictly the integer, as serial.js
    const up = (q) => (q && Array.isArray(q.words) ? { ...q, words: q.words.map((w) => ({ ...w, textures: {} })) } : q);
    o = { ...o, schema: 2, ...(o.piece !== undefined ? { piece: up(o.piece) } : {}), ...(Array.isArray(o.pieces) ? { pieces: o.pieces.map(up) } : {}) };
  }
  if (o.schema !== SCHEMA) S.checkDoc({ schema: o.schema });   // throws SCHEMA_TOO_NEW / SCHEMA_UNKNOWN
  if (typeof o.generator !== 'string' || !o.generator) throw new DocError('BAD_DOC', 'generator must be a non-empty string');
  return o;
}
function loadPiece(o, at) {
  onlyKeys(o, ['id', 'name', 'author', 'kind', 'words'], at);
  if (!Array.isArray(o.words) || o.words.length === 0) throw new DocError('BAD_PHRASE', `${at}: a piece needs words`);
  const words = o.words.map((w, j) => { const x = loadWord(w, `${at}.words[${j}]`, false); checkWordBody(x, `${at}.words[${j}]`); return x; });
  const kind = words.length === 1 ? 'word' : 'phrase';
  if (o.kind !== kind) throw new DocError('BAD_PHRASE', `${at}: kind "${o.kind}" but ${words.length} word(s)`);
  if (typeof o.author !== 'string') throw new DocError('BAD_NAME', `${at}: author must be a string`);
  return { name: o.name, author: o.author, kind, words };
}

function importPiece(lib, text) {
  const o = readJson(text);
  onlyKeys(o, ['schema', 'generator', 'piece'], 'piece file');
  const body = loadPiece(o.piece, 'piece');
  checkName(lib, body.name);
  const piece = { id: `u${lib.nextId}`, builtin: false, ...body };
  return deepFreeze({ ...lib, nextId: lib.nextId + 1, pieces: [...lib.pieces, piece] });
}

function parseLibrary(text) {
  const o = readJson(text);
  onlyKeys(o, ['schema', 'generator', 'nextId', 'pieces'], 'library');
  if (!Number.isSafeInteger(o.nextId) || o.nextId < 1 || !Array.isArray(o.pieces)) throw new DocError('BAD_DOC', 'a library needs nextId and pieces');
  let lib = { ...builtinLibrary(), generator: o.generator, nextId: o.nextId };
  const pieces = [...lib.pieces];
  o.pieces.forEach((p, i) => {
    const body = loadPiece(p, `pieces[${i}]`);
    if (typeof p.id !== 'string' || !/^u\d+$/.test(p.id) || Number(p.id.slice(1)) >= o.nextId) throw new DocError('BAD_ID', `pieces[${i}]: id ${p.id} is not u<n> below nextId`);
    if (pieces.some((x) => x.id === p.id)) throw new DocError('DUPLICATE_ID', `pieces[${i}]: id ${p.id} appears twice`);
    checkName({ pieces }, body.name);
    pieces.push({ id: p.id, builtin: false, ...body });
  });
  return deepFreeze({ ...lib, pieces });
}

// ---------------------------------------------------------------------------------------------- the sculpt hook
/** What sculpt mode needs for one word: every handle's value, unit and schema range, plus physics bounds if given. */
function handleInfo(doc, id, boundsFn) {
  const [top, n] = id.split('/'), e = doc.words.find((x) => x.id === top);
  if (!e) throw new DocError('NO_SUCH_WORD', `no word with id ${id}`);
  const w = e.phrase !== undefined ? e.words[Number(n) - 1] : e;
  if (!w) throw new DocError('NO_SUCH_WORD', `no word ${id}`);
  const handles = {};
  for (const [h, v] of Object.entries(w.handles)) handles[h] = { value: v, unit: SI_UNIT[UNIT[h]], range: RANGE[h].slice() };
  return { id, word: w.word, font: w.font, handles, physics: typeof boundsFn === 'function' ? boundsFn(doc, id) : null };
}

module.exports = { builtinLibrary, palette, savePiece, placePiece, exportPiece, importPiece, serializeLibrary, parseLibrary, handleInfo };
