// text.js: a texture as TEXT, canonical like the track document (src/doc/serial.js): the same texture is always the same
// bytes, and serialize(parse(serialize(t))) === serialize(t).
//
//   normalize(obj)  -> the texture in memory: every key present (defaults filled), every number quantised, colours as
//                      lowercase '#rrggbbaa'; frozen. Refuses a bad texture with a TexmakerError naming the reason.
//   serialize(tex)  -> the canonical text: fixed key order, one layer per line, numbers printed from their quantised
//                      integers (no float formatting), so no engine can print them differently
//   parse(text)     -> normalize(JSON.parse(text)); a hand-edited text loads, and its next save is canonical
//
// QUANTUM: fractions and numbers to 1e-6 (a millionth of the tile: 0.008 px at 8192, AC's largest texture). Integers are
// exact. A value finer than its quantum is snapped to it.
'use strict';

const { LAYERS, TOP, VERSION, MAX_LAYERS } = require('./schema.js');
const { TexmakerError } = require('./errors.js');

const Q = 1e6;
const quant = (x) => Math.round(x * Q) / Q;
/** A quantised number as text, from its integer: sign, whole part, up to 6 fraction digits, trailing zeros trimmed. */
function fmt(x) {
  const k = Math.round(x * Q), a = Math.abs(k), whole = Math.floor(a / Q), part = String(a % Q).padStart(6, '0').replace(/0+$/, '');
  return (k < 0 ? '-' : '') + whole + (part ? '.' + part : '');
}
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

function bad(code, where, msg) { throw new TexmakerError(code, `${where}: ${msg}`); }
function colour(v, where) {
  if (typeof v !== 'string' || !/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) bad('BAD_PARAM', where, `a colour is '#rrggbb' or '#rrggbbaa', not ${JSON.stringify(v)}`);
  return (v.length === 7 ? v + 'ff' : v).toLowerCase();
}
function number(v, lo, hi, where) {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad('BAD_PARAM', where, `must be a number, not ${JSON.stringify(v)}`);
  const q = quant(v);
  if (q < lo || q > hi) bad('BAD_PARAM', where, `${v} is outside ${lo}..${hi}`);
  return q;
}
function value(spec, v, where) {
  switch (spec.kind) {
    case 'frac': return number(v, 0, 1, where);
    case 'num': return number(v, spec.min, spec.max, where);
    case 'int':
      if (!Number.isInteger(v)) bad('BAD_PARAM', where, `must be a whole number, not ${JSON.stringify(v)}`);
      if (v < spec.min || v > spec.max) bad('BAD_PARAM', where, `${v} is outside ${spec.min}..${spec.max}`);
      return v;
    case 'colour': return colour(v, where);
    case 'enum': if (!spec.values.includes(v)) bad('BAD_PARAM', where, `must be one of ${spec.values.join(', ')}, not ${JSON.stringify(v)}`); return v;
    case 'bool': if (typeof v !== 'boolean') bad('BAD_PARAM', where, `must be true or false, not ${JSON.stringify(v)}`); return v;
    case 'point': case 'size2': {
      if (!Array.isArray(v) || v.length !== 2) bad('BAD_PARAM', where, 'must be two numbers [u, v]');
      const out = v.map((x, k) => number(x, 0, 1, `${where}[${k}]`));
      if (spec.kind === 'size2' && !(out[0] > 0 && out[1] > 0)) bad('BAD_PARAM', where, 'a size must be above 0 on both sides');
      return out;
    }
    case 'stops': {
      if (!Array.isArray(v) || v.length < 2 || v.length > 16) bad('BAD_PARAM', where, 'needs 2 to 16 stops');
      const out = v.map((s, k) => {
        if (!s || typeof s !== 'object' || Array.isArray(s)) bad('BAD_PARAM', `${where}[${k}]`, 'a stop is { at, colour }');
        for (const key of Object.keys(s)) if (key !== 'at' && key !== 'colour') bad('UNKNOWN_KEY', `${where}[${k}]`, `no key "${key}" in a stop`);
        return { at: number(s.at, 0, 1, `${where}[${k}].at`), colour: colour(s.colour, `${where}[${k}].colour`) };
      });
      for (let k = 1; k < out.length; k++) if (!(out[k].at > out[k - 1].at)) bad('BAD_PARAM', `${where}[${k}].at`, 'stops must ascend strictly');
      if (out[0].at !== 0) bad('BAD_PARAM', `${where}[0].at`, 'the first stop is at 0');
      return out;
    }
    default: throw new Error(`schema: no kind ${spec.kind}`);
  }
}
const dflt = (spec) => (spec.kind === 'colour' ? colour(spec.def, 'default') : spec.kind === 'stops' ? value(spec, spec.def, 'default') : Array.isArray(spec.def) ? spec.def.slice() : spec.def);

function normalizeLayer(l, k) {
  const where = `layers[${k}]`;
  if (!l || typeof l !== 'object' || Array.isArray(l)) bad('BAD_PARAM', where, 'a layer is an object with a "type"');
  const schema = LAYERS[l.type];
  if (!schema) bad('UNKNOWN_LAYER', where, `no layer type ${JSON.stringify(l.type)} (the types: ${Object.keys(LAYERS).join(', ')})`);
  const keys = new Set(['type', ...schema.map(([key]) => key)]);
  for (const key of Object.keys(l)) if (!keys.has(key)) bad('UNKNOWN_KEY', where, `no key "${key}" in a ${l.type} layer`);
  const out = { type: l.type };
  for (const [key, spec] of schema) out[key] = l[key] === undefined ? dflt(spec) : value(spec, l[key], `${where}.${key} (${l.type})`);
  return Object.freeze(out);
}
function normalize(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t) || t.texmaker === undefined) bad('BAD_TEXT', 'texture', 'not a texture: no "texmaker" version');
  if (!Number.isInteger(t.texmaker) || t.texmaker < 1) bad('BAD_TEXT', 'texmaker', `version ${JSON.stringify(t.texmaker)} is not a version`);
  if (t.texmaker > VERSION) bad('BAD_VERSION', 'texmaker', `version ${t.texmaker} is newer than this maker (${VERSION})`);
  for (const key of Object.keys(t)) if (!TOP.some(([k]) => k === key)) bad('UNKNOWN_KEY', 'texture', `no key "${key}"`);
  if (typeof t.name !== 'string' || !NAME_RE.test(t.name)) bad('BAD_PARAM', 'name', 'a name is 1–64 letters, digits, spaces, _ or -, starting with a letter or digit');
  const layers = t.layers === undefined ? [] : t.layers;
  if (!Array.isArray(layers)) bad('BAD_PARAM', 'layers', 'must be a list');
  if (layers.length > MAX_LAYERS) bad('TOO_MANY_LAYERS', 'layers', `${layers.length} layers; at most ${MAX_LAYERS}`);
  return Object.freeze({ texmaker: VERSION, name: t.name, base: t.base === undefined ? colour('#303030', 'base') : colour(t.base, 'base'), layers: Object.freeze(layers.map(normalizeLayer)) });
}

function text(spec, v) {
  switch (spec.kind) {
    case 'frac': case 'num': return fmt(v);
    case 'int': return String(v);
    case 'bool': return v ? 'true' : 'false';
    case 'point': case 'size2': return `[${v.map(fmt).join(', ')}]`;
    case 'stops': return `[${v.map((s) => `{ "at": ${fmt(s.at)}, "colour": "${s.colour}" }`).join(', ')}]`;
    default: return JSON.stringify(v);   // colour, enum: plain strings from a fixed alphabet
  }
}
function serialize(tex) {
  const t = normalize(tex);   // an in-memory texture that was hand-built is checked and canonicalised first
  const layer = (l) => `    { "type": "${l.type}", ${LAYERS[l.type].map(([key, spec]) => `"${key}": ${text(spec, l[key])}`).join(', ')} }`;
  return `{\n  "texmaker": ${t.texmaker},\n  "name": ${JSON.stringify(t.name)},\n  "base": "${t.base}",\n  "layers": [${t.layers.length ? '\n' + t.layers.map(layer).join(',\n') + '\n  ' : ''}]\n}\n`;
}
function parse(s) {
  if (typeof s !== 'string') bad('BAD_TEXT', 'text', 'a texture text is a string');
  let o; try { o = JSON.parse(s); } catch (e) { bad('BAD_TEXT', 'text', `not JSON (${e.message})`); }
  return normalize(o);
}

module.exports = { normalize, serialize, parse, fmt, quant, Q };
