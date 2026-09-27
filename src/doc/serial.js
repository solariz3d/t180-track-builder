// serial.js: the document's canonical serialisation (ARCHITECTURE §2: "canonical serialisation with quantised numbers,
// a schema version and a generator version"), and the checks every document passes, in memory or on load.
//
// IN MEMORY a document is SI (metres, radians, m/s) and frozen. Every number in it is already QUANTISED, so the
// document and its own serialisation are the same thing: serialize(parse(serialize(d))) === serialize(d) byte for byte,
// and resolve() of either gives identical segments.
//
// QUANTA (the text's units): lengths 0.1 mm · angles 0.00001° · ease ratios 0.0001 · speeds 0.01 km/h. Degrees and km/h
// appear only here, never inside the program (docs/INTERFACES.md conventions). The quanta are that fine because the
// close-the-loop connector (connector.js) must close to the geometry's 1e-3 m: at 1 mm and 0.001°, one angle quantum on
// a few hundred metres of lever moves the seam by millimetres.
//
// THE TEXT is JSON written by this file, not by JSON.stringify of an object, so its bytes do not depend on key insertion
// order: fixed key order, one word per line, numbers printed from their quantised integers (no float formatting).
// Loading accepts only the schema's keys. A value finer than its quantum is snapped to it, so a hand-edited file loads,
// and its next save is canonical; canonical text round-trips exactly.
//
// SCHEMA VERSIONS. This is schema 1, the first. §2 says a document carries a schema version; it says nothing about
// migrating one, and there is no older schema to migrate from. So a document of any other schema is REFUSED with a
// named error: newer ones were written by a newer builder, and older ones do not exist. MIGRATIONS is where a step from
// schema n to n + 1 goes when there is one; it is empty on purpose.
'use strict';

const { DEG, TEMPOS, FONTS, WORDS, handlesOf } = require('./vocab.js');

const SCHEMA = 1;
const GENERATOR = 't180-track-builder/doc 0.1.0';
const MIGRATIONS = {};

class DocError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'DocError'; this.code = code; }
}

const UNIT = { length: 'm', turn: 'deg', climb: 'deg', easeIn: 'ratio', easeOut: 'ratio', roll0: 'deg', roll1: 'deg',
  heartline: 'm', psiL: 'deg', psiR: 'deg', width: 'm', wall: 'm', ramp: 'm', gap: 'm', drop: 'm', land: 'deg' };
const DIGITS = { m: 4, deg: 5, ratio: 4, kmh: 2 };
const toQ = { m: (x) => Math.round(x * 1e4), deg: (x) => Math.round((x / DEG) * 1e5), ratio: (x) => Math.round(x * 10000), kmh: (v) => Math.round(v * 3.6 * 100) };
const fromQ = { m: (q) => q / 1e4, deg: (q) => (q / 1e5) * DEG, ratio: (q) => q / 10000, kmh: (q) => q / 100 / 3.6 };
/** Snap an SI value to its quantum. Every number that enters a document goes through here. */
const quantise = (unit, x) => { const q = toQ[unit](x); return fromQ[unit](q === 0 ? 0 : q); };

/** A quantised integer as decimal text, e.g. (120500, 3) -> "120.5", (-5, 3) -> "-0.005", (0, 3) -> "0". */
function fmt(q, digits) {
  if (!Number.isSafeInteger(q)) throw new DocError('BAD_NUMBER', `${q} is out of range for a quantised value`);
  if (q === 0) return '0';
  const neg = q < 0, s = String(Math.abs(q)).padStart(digits + 1, '0');
  let int = s.slice(0, s.length - digits), frac = s.slice(s.length - digits).replace(/0+$/, '');
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
}
const num = (unit, x) => fmt(toQ[unit](x), DIGITS[unit]);

// ---------------------------------------------------------------------------------------------- the checks
const RANGE = {
  length: [1e-3, 1e5], turn: [-8 * Math.PI, 8 * Math.PI], climb: [-Math.PI / 2, Math.PI / 2], easeIn: [0, 1], easeOut: [0, 1],
  roll0: [-64 * Math.PI, 64 * Math.PI], roll1: [-64 * Math.PI, 64 * Math.PI], heartline: [-10, 10], psiL: [0, 175 * DEG], psiR: [0, 175 * DEG],
  width: [1, 200], wall: [0, 100], ramp: [1, 1000], gap: [1e-3, 1e4], drop: [-1e3, 1e3], land: [-Math.PI / 3, Math.PI / 3],
};
const isId = (s) => typeof s === 'string' && /^[a-z][a-z0-9]*$/.test(s);

/** Check one word's content (not its id): known word, font and tempo, exactly its handle set, each in range. */
function checkWordBody(w, at) {
  if (!w || typeof w !== 'object') throw new DocError('BAD_WORD', `${at} is not an object`);
  if (!Object.prototype.hasOwnProperty.call(WORDS, w.word)) throw new DocError('UNKNOWN_WORD', `${at}: "${w.word}" is not a word (known: ${Object.keys(WORDS).join(', ')})`);
  if (w.word !== 'jump' && !Object.prototype.hasOwnProperty.call(FONTS, w.font)) throw new DocError('UNKNOWN_FONT', `${at}: font "${w.font}" (known: ${Object.keys(FONTS).join(', ')})`);
  if (w.word === 'jump' && w.font !== null) throw new DocError('BAD_WORD', `${at}: a jump has no surface, so its font is null`);
  if (!Object.prototype.hasOwnProperty.call(TEMPOS, w.tempo)) throw new DocError('UNKNOWN_TEMPO', `${at}: tempo "${w.tempo}" (known: ${Object.keys(TEMPOS).join(', ')})`);
  const want = handlesOf(w.word), have = Object.keys(w.handles || {});
  const missing = want.filter((h) => !have.includes(h)), extra = have.filter((h) => !want.includes(h));
  if (missing.length || extra.length) throw new DocError('BAD_HANDLES', `${at} (${w.word}): ${missing.length ? 'missing ' + missing.join(', ') : ''}${missing.length && extra.length ? '; ' : ''}${extra.length ? 'not a handle of this word: ' + extra.join(', ') : ''}`);
  for (const h of want) {
    const v = w.handles[h], [lo, hi] = RANGE[h];
    if (!Number.isFinite(v) || v < lo || v > hi) throw new DocError('HANDLE_RANGE', `${at}: ${h} = ${v} is outside [${lo}, ${hi}]`);
  }
  if (w.word !== 'jump' && w.handles.easeIn + w.handles.easeOut > 1 + 1e-12) throw new DocError('HANDLE_RANGE', `${at}: easeIn + easeOut exceeds 1`);
  if (w.speed !== null && !(Number.isFinite(w.speed) && w.speed > 0)) throw new DocError('BAD_SPEED', `${at}: speed must be null or a positive number of m/s`);
}

/** Check a whole document. Throws DocError on the first problem; returns the document. */
function checkDoc(d) {
  if (!d || typeof d !== 'object') throw new DocError('BAD_DOC', 'not an object');
  if (d.schema !== SCHEMA) throw new DocError(Number.isInteger(d.schema) && d.schema > SCHEMA ? 'SCHEMA_TOO_NEW' : 'SCHEMA_UNKNOWN',
    `schema ${d.schema}: this builder reads schema ${SCHEMA} only${Number.isInteger(d.schema) && d.schema > SCHEMA ? ' (the file was written by a newer builder)' : ' (no migration to it exists)'}`);
  if (typeof d.generator !== 'string' || !d.generator) throw new DocError('BAD_DOC', 'generator must be a non-empty string');
  if (typeof d.name !== 'string') throw new DocError('BAD_DOC', 'name must be a string');
  if (d.closed !== false && d.closed !== true) throw new DocError('BAD_DOC', 'closed must be true or false');
  if (!Number.isSafeInteger(d.nextId) || d.nextId < 1) throw new DocError('BAD_DOC', 'nextId must be a positive integer');
  if (!Array.isArray(d.words)) throw new DocError('BAD_DOC', 'words must be an array');
  const seen = new Set();
  d.words.forEach((e, i) => {
    const at = `words[${i}]`;
    if (!e || !isId(e.id)) throw new DocError('BAD_ID', `${at}: id must be lower-case letters and digits, starting with a letter`);
    if (seen.has(e.id)) throw new DocError('DUPLICATE_ID', `${at}: id ${e.id} appears twice`);
    const n = Number(e.id.replace(/^[a-z]+/, ''));
    if (Number.isInteger(n) && n >= d.nextId) throw new DocError('BAD_ID', `${at}: id ${e.id} is not below nextId ${d.nextId}, so a new word could reuse it`);
    seen.add(e.id);
    if (e.phrase !== undefined) {
      if (typeof e.phrase !== 'string' || !e.phrase) throw new DocError('BAD_PHRASE', `${at}: a phrase needs a name`);
      if (!Array.isArray(e.words) || e.words.length === 0) throw new DocError('BAD_PHRASE', `${at}: a phrase needs at least one word`);
      e.words.forEach((w, j) => checkWordBody(w, `${at}.words[${j}]`));
    } else checkWordBody(e, at);
  });
  const c = d.constraints;
  if (!c || !Array.isArray(c.pins) || !Array.isArray(c.free) || ![...c.pins, ...c.free].every((x) => typeof x === 'string'))
    throw new DocError('BAD_DOC', 'constraints must be { pins: [string], free: [string] }');
  return d;
}

// ---------------------------------------------------------------------------------------------- text
const str = (s) => JSON.stringify(s);
function wordText(w) {
  const h = handlesOf(w.word).map((k) => `${str(k)}:${num(UNIT[k], w.handles[k])}`).join(',');
  return `${str('word')}:${str(w.word)},${str('font')}:${w.font === null ? 'null' : str(w.font)},${str('tempo')}:${str(w.tempo)},` +
    `${str('speedKmh')}:${w.speed === null ? 'null' : num('kmh', w.speed)},${str('handles')}:{${h}}`;
}
function entryText(e) {
  if (e.phrase !== undefined) return `{${str('id')}:${str(e.id)},${str('phrase')}:${str(e.phrase)},${str('words')}:[${e.words.map((w) => `{${wordText(w)}}`).join(',')}]}`;
  return `{${str('id')}:${str(e.id)},${wordText(e)}}`;
}

/** The canonical text of a document. Same document, same bytes. */
function serialize(d) {
  checkDoc(d);
  const words = d.words.length ? '[\n' + d.words.map((e) => '    ' + entryText(e)).join(',\n') + '\n  ]' : '[]';
  const list = (a) => '[' + a.map(str).join(',') + ']';
  return '{\n' +
    `  ${str('schema')}: ${d.schema},\n  ${str('generator')}: ${str(d.generator)},\n  ${str('name')}: ${str(d.name)},\n` +
    `  ${str('closed')}: ${d.closed},\n  ${str('nextId')}: ${d.nextId},\n  ${str('words')}: ${words},\n` +
    `  ${str('constraints')}: {${str('pins')}:${list(d.constraints.pins)},${str('free')}:${list(d.constraints.free)}}\n}\n`;
}

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
function onlyKeys(o, keys, at) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new DocError('BAD_DOC', `${at} is not an object`);
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) throw new DocError('UNKNOWN_KEY', `${at}: ${extra.join(', ')} ${extra.length > 1 ? 'are' : 'is'} not part of schema ${SCHEMA}`);
}
function loadWord(w, at, withId) {
  onlyKeys(w, withId ? ['id', 'word', 'font', 'tempo', 'speedKmh', 'handles'] : ['word', 'font', 'tempo', 'speedKmh', 'handles'], at);
  const handles = {};
  if (w.handles && typeof w.handles === 'object') for (const [k, v] of Object.entries(w.handles)) {
    if (!UNIT[k]) throw new DocError('BAD_HANDLES', `${at}: ${k} is not a handle`);
    if (typeof v !== 'number') throw new DocError('BAD_HANDLES', `${at}: ${k} is not a number`);
    handles[k] = fromQ[UNIT[k]](toQ[UNIT[k]](UNIT[k] === 'deg' ? v * DEG : v) || 0);
  }
  const sp = w.speedKmh;
  if (sp !== null && typeof sp !== 'number') throw new DocError('BAD_SPEED', `${at}: speedKmh must be null or a number`);
  return { word: w.word, font: w.font === undefined ? undefined : w.font, tempo: w.tempo, handles, speed: sp === null ? null : fromQ.kmh(Math.round(sp * 100) || 0) };
}

/** Load a document from text. Refuses other schemas, unknown keys, and anything checkDoc refuses. */
function parse(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new DocError('BAD_JSON', e.message); }
  if (!o || typeof o !== 'object') throw new DocError('BAD_DOC', 'not an object');
  while (o.schema !== SCHEMA && MIGRATIONS[o.schema]) o = MIGRATIONS[o.schema](o);   // none exist yet (see the header)
  if (o.schema !== SCHEMA) checkDoc({ schema: o.schema });   // throws the named schema error
  onlyKeys(o, ['schema', 'generator', 'name', 'closed', 'nextId', 'words', 'constraints'], 'document');
  if (!Array.isArray(o.words)) throw new DocError('BAD_DOC', 'words must be an array');
  const words = o.words.map((e, i) => {
    const at = `words[${i}]`;
    if (e && e.phrase !== undefined) {
      onlyKeys(e, ['id', 'phrase', 'words'], at);
      if (!Array.isArray(e.words)) throw new DocError('BAD_PHRASE', `${at}: a phrase needs words`);
      return { id: e.id, phrase: e.phrase, words: e.words.map((w, j) => loadWord(w, `${at}.words[${j}]`, false)) };
    }
    const x = loadWord(e, at, true);
    return { id: e && e.id, ...x };
  });
  onlyKeys(o.constraints, ['pins', 'free'], 'constraints');
  const d = { schema: o.schema, generator: o.generator, name: o.name, closed: o.closed, nextId: o.nextId, words, constraints: { pins: o.constraints.pins, free: o.constraints.free } };
  return deepFreeze(checkDoc(d));
}

module.exports = { SCHEMA, GENERATOR, MIGRATIONS, DocError, UNIT, RANGE, quantise, fmt, checkDoc, checkWordBody, serialize, parse, deepFreeze,
  wordText, loadWord, onlyKeys };
