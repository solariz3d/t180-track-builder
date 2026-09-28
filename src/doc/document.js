// document.js: making and editing documents (ARCHITECTURE §2 "Document: ordered words with stable IDs, plus
// constraints"; docs/INTERFACES.md §4 "the build head"). Every operation returns a NEW frozen document; none mutates.
//
// STABLE IDS. A word's id is `w<n>`, from the document's own counter `nextId`, which only ever grows: removing the head
// does not hand its id to the next word. So an id names one word for the document's whole life, across every edit,
// and nothing about it depends on the clock or randomness (INTERFACES: all steps are deterministic).
//
// DEFAULTS ARE WRITTEN IN. appendWord fills every handle from the vocabulary and the tempo at the moment of the append,
// and stores them. The document never relies on a default at resolve time, so a later builder with different defaults
// still resolves an old document to the same track.
'use strict';

const { DEG, TEMPOS, FONTS, WORDS, RAMP_M, BANK_RATE, handlesOf, pieceOf, widthOf } = require('./vocab.js');
const TX = require('./textures.js');
const PL = require('./pitlane.js');
const { SCHEMA, GENERATOR, DocError, UNIT, quantise, checkDoc, checkWordBody, deepFreeze } = require('./serial.js');

function createDoc(name = '') {
  return deepFreeze(checkDoc({ schema: SCHEMA, generator: GENERATOR, name, closed: false, nextId: 1, words: [], pitLane: null, constraints: { pins: [], free: [] } }));
}

const q = (k, v) => quantise(UNIT[k], v);
const qHandles = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, UNIT[k] ? q(k, v) : v]));
const qSpeed = (v) => (v === null || v === undefined ? null : quantise('kmh', v));

/** The roll the next word starts from: the last road word's roll1 (a jump carries roll through), else 0. */
function headRoll(doc) {
  for (let i = doc.words.length - 1; i >= 0; i--) {
    const e = doc.words[i], ws = e.phrase !== undefined ? e.words : [e];
    for (let j = ws.length - 1; j >= 0; j--) if (ws[j].word !== 'jump') return ws[j].handles.roll1;
  }
  return 0;
}

/** The font of the last ROAD word (a phrase's last road word; a jump carries it through), or undefined on an empty track. */
function headFont(doc) {
  for (let i = doc.words.length - 1; i >= 0; i--) {
    const e = doc.words[i], ws = e.phrase !== undefined ? e.words : [e];
    for (let j = ws.length - 1; j >= 0; j--) if (ws[j].word !== 'jump') return ws[j].font;
  }
  return undefined;
}

/** A word's full content from the vocabulary, its tempo and its turn direction, before any override. */
function defaultWord(word, { dir = 'L', tempo = 'standard', font, roll0 = 0 } = {}) {
  if (!Object.prototype.hasOwnProperty.call(WORDS, word)) throw new DocError('UNKNOWN_WORD', `"${word}" is not a word (known: ${Object.keys(WORDS).join(', ')})`);
  const T = TEMPOS[tempo]; if (!T) throw new DocError('UNKNOWN_TEMPO', `tempo "${tempo}" (known: ${Object.keys(TEMPOS).join(', ')})`);
  if (dir !== 'L' && dir !== 'R') throw new DocError('BAD_DIR', `dir must be 'L' or 'R', got ${dir}`);
  const W = WORDS[word];
  if (word === 'jump') return { word, font: null, tempo, speed: null, handles: { gap: W.gap, drop: W.drop, land: W.land }, textures: {} };
  // The piece at this tempo (vocab.js pieceOf): its total turn and length from the class's runs, its radius the median.
  const piece = pieceOf(word, tempo), sign = dir === 'L' ? 1 : -1, turn = sign * piece.turn, ease = T.ease;
  const length = piece.length;
  const f = font || W.font, F = FONTS[f]; if (!F) throw new DocError('UNKNOWN_FONT', `font "${f}" (known: ${Object.keys(FONTS).join(', ')})`);
  // A font with an outside wall puts it on the outside of the turn: the right for a left turn.
  const out = F.psiOut !== undefined, psiL = out ? (sign > 0 ? F.psiIn : F.psiOut) : F.psiL, psiR = out ? (sign > 0 ? F.psiOut : F.psiIn) : F.psiR;
  // The bank (vocab.js WORDS: the class's median tilt) leans INTO the turn: positive roll raises the left edge
  // (src/geom/path.js bankG = asin(L.y)), so a left turn ends at -bank. It is reached in the HEAD'S REVOLUTION: after an
  // inversion the head is at 2π, and the turn leans from there, never unwinding a whole roll inside one word. A word
  // with no bank keeps the head's roll, plus its own full roll if it has one (the inversion). The width follows the
  // font (vocab.js widthOf: C's measured widths, else the class median).
  const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  const roll1 = W.bank !== undefined ? roll0 + wrap(-sign * W.bank - roll0) : roll0 + (W.roll || 0);
  // THE BANK RAMPS (vocab.js BANK_RATE): roll follows one smoothstep over the word, steepest at 1.5 × |Δroll| / length.
  // A word too short to bank that far at the measured rate is made longer at its radius, so it turns further; the
  // inversion's roll is the word itself and is not ramped.
  const need = W.roll ? 0 : (1.5 * Math.abs(roll1 - roll0)) / (BANK_RATE * DEG);
  const len = Math.max(length, need), bent = len > length && piece.R !== undefined ? (sign * len * (1 - ease)) / piece.R : turn;
  return { word, font: f, tempo, speed: null, handles: {
    length: len, turn: bent, climb: 0, easeIn: ease, easeOut: ease, roll0, roll1, heartline: 0, psiL, psiR, width: widthOf(word, f), wall: F.wall, ramp: RAMP_M }, textures: {} };
}

function finishWord(body, overrides = {}, at) {
  const handles = qHandles({ ...body.handles, ...(overrides.handles || {}) });
  // Texture overrides are laid over the word's own (a slot patched to null drops back to the font's), checked BEFORE
  // their lengths are quantised, so a malformed set is refused by name rather than tripping the quantiser.
  const tx = TX.merge(body.textures, overrides.textures);
  const tp = TX.problem(tx, body.word);
  if (tp) throw new DocError('BAD_TEXTURES', `${at}: ${tp}`);
  const w = { word: body.word, font: overrides.font !== undefined ? overrides.font : body.font, tempo: body.tempo, speed: qSpeed(overrides.speed !== undefined ? overrides.speed : body.speed), handles,
    textures: TX.quantised(tx, (v) => quantise('m', v)) };
  checkWordBody(w, at);
  return w;
}

/**
 * Append a word at the head. opts: { dir: 'L'|'R', tempo, font, speed (m/s), handles: { ...overrides } }.
 * Its roll starts where the head's ends. One undo entry (history.js).
 */
function appendWord(doc, word, opts = {}) {
  // no font chosen: CONTINUITY, the previous road word's font (vocab.js says why); the first road word takes its class's
  const font = opts.font !== undefined ? opts.font : headFont(doc);
  const body = defaultWord(word, { dir: opts.dir, tempo: opts.tempo, font, roll0: headRoll(doc) });
  const id = `w${doc.nextId}`;
  const w = finishWord(body, opts, id);
  return deepFreeze(checkDoc({ ...doc, generator: GENERATOR, nextId: doc.nextId + 1, words: [...doc.words, { id, ...w }] }));
}

/** Append a phrase (§2: "a saved word sequence"): items [{ word, opts }], resolved as ids `<id>/<n>`. */
function appendPhrase(doc, phrase, items) {
  if (!Array.isArray(items) || items.length === 0) throw new DocError('BAD_PHRASE', 'a phrase needs at least one word');
  const id = `w${doc.nextId}`;
  let roll = headRoll(doc);
  const words = items.map(({ word, opts = {} }, n) => {
    const w = finishWord(defaultWord(word, { dir: opts.dir, tempo: opts.tempo, font: opts.font, roll0: roll }), opts, `${id}/${n + 1}`);
    if (w.word !== 'jump') roll = w.handles.roll1;
    return w;
  });
  return deepFreeze(checkDoc({ ...doc, generator: GENERATOR, nextId: doc.nextId + 1, words: [...doc.words, { id, phrase, words }] }));
}

/** Remove the head word. Its id is not reused. */
function removeHead(doc) {
  if (doc.words.length === 0) throw new DocError('EMPTY_DOC', 'there is no head word to remove');
  return deepFreeze(checkDoc({ ...doc, generator: GENERATOR, words: doc.words.slice(0, -1) }));
}

/**
 * Replace the head word with another (the build head's third core edit, with append and remove). One operation, so
 * one undo entry. The new word gets a NEW id: it is a different word, and an id names one word for life.
 */
function replaceHead(doc, word, opts = {}) {
  if (doc.words.length === 0) throw new DocError('EMPTY_DOC', 'there is no head word to replace');
  return appendWord(removeHead(doc), word, opts);
}

/** Sculpt one word: patch { font?, speed?, handles?: {...}, textures?: { <slot>: {...} | null } }. Every other word, and every id, is untouched. */
function editWord(doc, id, patch = {}) {
  const i = doc.words.findIndex((e) => e.id === id);
  if (i < 0) throw new DocError('NO_SUCH_WORD', `no word with id ${id}`);
  const e = doc.words[i];
  if (e.phrase !== undefined) throw new DocError('BAD_EDIT', `${id} is a phrase; edit its words through editPhraseWord`);
  const w = finishWord(e, patch, id);
  const words = doc.words.slice(); words[i] = { id, ...w };
  return deepFreeze(checkDoc({ ...doc, generator: GENERATOR, words }));
}

/** Sculpt the n-th (1-based) word of a phrase. */
function editPhraseWord(doc, id, n, patch = {}) {
  const i = doc.words.findIndex((e) => e.id === id);
  if (i < 0 || doc.words[i].phrase === undefined) throw new DocError('NO_SUCH_WORD', `no phrase with id ${id}`);
  const e = doc.words[i]; if (!(n >= 1 && n <= e.words.length)) throw new DocError('NO_SUCH_WORD', `${id} has no word ${n}`);
  const ws = e.words.slice(); ws[n - 1] = finishWord(ws[n - 1], patch, `${id}/${n}`);
  const words = doc.words.slice(); words[i] = { ...e, words: ws };
  return deepFreeze(checkDoc({ ...doc, generator: GENERATOR, words }));
}

/**
 * Give the document a pit lane (src/doc/pitlane.js), replace it, or remove it with null. One operation, so one undo
 * entry (history.js). `lane` may leave out any key of PL.DEFAULTS; leave and rejoin are required.
 */
function setPitLane(doc, lane) {
  const full = lane === null ? null : { ...PL.DEFAULTS, ...lane };
  const p = PL.problem(full); if (p) throw new DocError('BAD_PIT_LANE', p);
  return deepFreeze(checkDoc({ ...doc, generator: GENERATOR, pitLane: PL.quantised(full, (v) => quantise('m', v), (v) => Math.round(v * 100) / 100) }));
}
/** Sculpt the pit lane: patch any of its keys (leave and rejoin are replaced whole). One undo entry. */
function editPitLane(doc, patch = {}) {
  if (!doc.pitLane) throw new DocError('NO_PIT_LANE', 'the document has no pit lane to edit; setPitLane adds one');
  return setPitLane(doc, { ...doc.pitLane, ...patch });
}

/** The document's open end: the last word's id, and whether the loop is closed (INTERFACES §4). */
function head(doc) { return { id: doc.words.length ? doc.words[doc.words.length - 1].id : null, closed: doc.closed }; }

module.exports = { createDoc, appendWord, appendPhrase, removeHead, replaceHead, editWord, editPhraseWord, setPitLane, editPitLane, head, defaultWord, headRoll, handlesOf };
