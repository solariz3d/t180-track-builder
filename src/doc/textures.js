// textures.js: the document's texture SLOTS (ARCHITECTURE §5b: "Each part of the cross-section gets its own material:
// floor, walls, lines, kerbs, edge glow. A font can carry default textures, and any word can override them.").
//
// A word holds `textures`: its OVERRIDES only, { <slot>: { <setting>: value } }, possibly {}. Its effective slots are its
// font's defaults with those laid over them. Settings, in canonical order (the text writes them in this order):
//   texture     a texture's name (see NAME_RE), or null for none (the strip's plain material colour)
//   tileLength  m: one repeat of the texture along the track (§5b "tiling length")
//   fit         'tile' (repeat every tileWidth m across) or 'fit' (stretch once across the strip's own width)
//   tileWidth   m: one repeat across, when fit is 'tile'
//   offset      m: where the first repeat starts, along
//   dir         'along' or 'across': which way the texture's own v runs (§5b "direction")
// Lengths are quantised like every other length of the document (0.1 mm, serial.js). A jump has no surface, so it
// takes no overrides: its landing ramp wears the take-off road's cross-section, and with it that road's textures.
// Nothing here reads the disk: a texture NAME is resolved to pixels by src/texture/set.js from the assets the app holds.
'use strict';

const SLOTS = Object.freeze(['floor', 'walls', 'lines', 'kerbs', 'edgeGlow']);
const SETTINGS = Object.freeze(['texture', 'tileLength', 'fit', 'tileWidth', 'offset', 'dir']);
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DEFAULT = Object.freeze({ texture: null, tileLength: 10, fit: 'tile', tileWidth: 10, offset: 0, dir: 'along' });
const LENGTHS = ['tileLength', 'tileWidth', 'offset'];
const RANGE = { tileLength: [0.1, 1000], tileWidth: [0.1, 1000], offset: [-10000, 10000] };

// Font defaults (§5b "a font can carry default textures"). v1 ships no textures of its own, so every font's slots
// start with no texture and 10 m tiling; the procedural maker (part 2) is where built-in textures come from.
const FONT_DEFAULTS = Object.freeze(Object.fromEntries(['flat', 'half-pipe', 'bowl', 'wall-ride', 'tube'].map((f) =>
  [f, Object.freeze(Object.fromEntries(SLOTS.map((s) => [s, DEFAULT])))])));

function fontDefaults(font) {
  const d = FONT_DEFAULTS[font];
  if (!d) throw new Error(`textures: no defaults for font "${font}"`);
  return d;
}

/** Why `textures` is not a valid override set for this word, or null. */
function problem(textures, word) {
  if (!textures || typeof textures !== 'object' || Array.isArray(textures)) return 'textures must be an object of slot overrides';
  const slots = Object.keys(textures);
  if (word === 'jump' && slots.length) return 'a jump has no surface, so it takes no texture overrides';
  for (const s of slots) {
    if (!SLOTS.includes(s)) return `"${s}" is not a texture slot (slots: ${SLOTS.join(', ')})`;
    const o = textures[s];
    if (!o || typeof o !== 'object' || Array.isArray(o)) return `${s}: an override is an object of settings`;
    for (const [k, v] of Object.entries(o)) {
      if (!SETTINGS.includes(k)) return `${s}: "${k}" is not a texture setting (settings: ${SETTINGS.join(', ')})`;
      if (k === 'texture' && !(v === null || (typeof v === 'string' && NAME_RE.test(v)))) return `${s}: texture ${JSON.stringify(v)} is not a texture name (lower-case letters, digits, _ and -)`;
      if (k === 'fit' && v !== 'tile' && v !== 'fit') return `${s}: fit is 'tile' or 'fit', not ${JSON.stringify(v)}`;
      if (k === 'dir' && v !== 'along' && v !== 'across') return `${s}: dir is 'along' or 'across', not ${JSON.stringify(v)}`;
      if (LENGTHS.includes(k) && !(Number.isFinite(v) && v >= RANGE[k][0] && v <= RANGE[k][1])) return `${s}: ${k} = ${v} is outside [${RANGE[k][0]}, ${RANGE[k][1]}] m`;
    }
  }
  return null;
}

/** Lay `patch` over `base` (both override sets): a slot set to null drops that slot's overrides. */
function merge(base, patch) {
  if (patch === undefined) return base || {};
  const out = { ...(base || {}) };
  for (const [s, o] of Object.entries(patch || {})) {
    if (o === null) { delete out[s]; continue; }
    out[s] = { ...(out[s] || {}), ...o };
  }
  return out;
}

/** Quantise the lengths of an override set with `q(value)`. */
function quantised(textures, q) {
  return Object.fromEntries(Object.entries(textures).map(([s, o]) => [s, Object.fromEntries(Object.entries(o).map(([k, v]) => [k, LENGTHS.includes(k) ? q(v) : v]))]));
}

/** The canonical text of an override set: slots in SLOTS order, settings in SETTINGS order; `num(x)` prints a length. */
function text(textures, num) {
  const str = JSON.stringify;
  const slots = SLOTS.filter((s) => textures[s]).map((s) => {
    const o = textures[s];
    const kv = SETTINGS.filter((k) => k in o).map((k) => `${str(k)}:${LENGTHS.includes(k) ? num(o[k]) : str(o[k])}`);
    return `${str(s)}:{${kv.join(',')}}`;
  });
  return `{${slots.join(',')}}`;
}

/** A word's effective slots: its font's defaults with its overrides laid over. A jump has none. */
function effectiveSlots(w) {
  if (w.word === 'jump') return null;
  const base = fontDefaults(w.font), over = w.textures || {};
  return Object.freeze(Object.fromEntries(SLOTS.map((s) => [s, Object.freeze({ ...base[s], ...(over[s] || {}) })])));
}

module.exports = { SLOTS, SETTINGS, NAME_RE, DEFAULT, FONT_DEFAULTS, fontDefaults, problem, merge, quantised, text, effectiveSlots, LENGTHS };
