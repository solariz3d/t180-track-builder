// schema.js: every layer type as a PARAMETER SET (ARCHITECTURE §5b: "Every layer is a parameter set, so a texture is
// also text: shareable, editable, regenerable at any resolution"). Each key has a kind, a range and a default; the
// canonical text writes every key in this order, so the same texture is always the same bytes.
//
// COORDINATES. u runs ACROSS the road (0 = right edge, 1 = left edge, the profile's width) and v runs ALONG it (one tile
// of the tiling length, §5b "Mapping is automatic"). Every size and position is a FRACTION of the tile, never pixels, so
// the text regenerates at any resolution. Directions are named by the road: a stripe that runs 'along' the road varies
// across u (a lane line); one that runs 'across' varies along v (a zebra band).
//
// KINDS: frac (0..1), num {min,max}, int {min,max}, colour ('#rrggbb' or '#rrggbbaa', stored as [r, g, b, a] bytes),
// enum {values}, bool, point ([u, v] fracs), size2 ([w, h] fracs), stops (2..16 of { at: frac, colour }, at ascending).
'use strict';

const BLEND = ['over', 'multiply', 'add'];
const DIR = ['along', 'across'];
const f = (d) => ({ kind: 'frac', def: d });
const n = (min, max, d) => ({ kind: 'num', min, max, def: d });
const i = (min, max, d) => ({ kind: 'int', min, max, def: d });
const c = (d) => ({ kind: 'colour', def: d });
const e = (values, d) => ({ kind: 'enum', values, def: d });

/** The layer types, each an ordered list of [key, spec]. `type` is always first in the text. */
const LAYERS = Object.freeze({
  // fine per-cell speckle: `cells` cells across the tile, each a hashed value; coverage = amount × value
  grain: [['blend', e(BLEND, 'multiply')], ['colour', c('#000000')], ['amount', f(0.35)], ['cells', i(1, 4096, 512)], ['seed', i(0, 2147483647, 1)]],
  // smooth fractal value noise, tileable: `cells` lattice cells at the first octave, doubling each octave
  noise: [['blend', e(BLEND, 'over')], ['colour', c('#ffffff')], ['amount', f(0.2)], ['cells', i(1, 1024, 8)], ['octaves', i(1, 8, 4)],
    ['persistence', f(0.5)], ['seed', i(0, 2147483647, 1)]],
  // colour stops over u ('along' bands run along the road) or v; 'bands' holds each stop's colour to the next (Rainbow's
  // bands), 'smooth' blends; `repeat` whole repeats per tile
  gradient: [['blend', e(BLEND, 'over')], ['dir', e(DIR, 'along')], ['mode', e(['bands', 'smooth'], 'bands')], ['repeat', i(1, 256, 1)],
    ['amount', f(1)], ['stops', { kind: 'stops', def: [{ at: 0, colour: '#ffffff' }, { at: 0.5, colour: '#000000' }] }]],
  // `count` stripes per tile, each `width` of its period (the duty), shifted by `offset` of a period
  stripes: [['blend', e(BLEND, 'over')], ['dir', e(DIR, 'along')], ['colour', c('#ffffff')], ['amount', f(1)], ['count', i(1, 1024, 8)],
    ['width', f(0.5)], ['offset', f(0)]],
  // one lane line running along the road: centred at u = `at`, `width` of the tile wide; `dashes` per tile (0 = solid),
  // each on for `duty` of its period
  lines: [['blend', e(BLEND, 'over')], ['colour', c('#ffffff')], ['amount', f(1)], ['at', f(0.5)], ['width', f(0.02)],
    ['dashes', i(0, 256, 0)], ['duty', f(0.5)]],
  // a grid of `cols` × `rows` panels with seams `seam` of a panel wide in `colour`; each panel's brightness varies by
  // ±`tone` (hashed per panel)
  panels: [['blend', e(BLEND, 'over')], ['colour', c('#202020')], ['amount', f(1)], ['cols', i(1, 256, 4)], ['rows', i(1, 256, 8)],
    ['seam', f(0.04)], ['tone', f(0.1)], ['seed', i(0, 2147483647, 1)]],
  // an emissive strip running along the road (or across it): a core `width` wide at `at`, fading to nothing over
  // `falloff` each side; `intensity` scales it; `emissive` also writes it into the emissive map
  glow: [['dir', e(DIR, 'along')], ['colour', c('#40c0ff')], ['at', f(0.5)], ['width', f(0.01)], ['falloff', f(0.03)],
    ['intensity', n(0, 4, 1)], ['emissive', { kind: 'bool', def: true }]],
  // a stamped shape, placed once at `at`, or `count` times along the road starting there; `size` [w, h] of the tile;
  // turned by quarter turns only (so the pixels stay exact on every engine)
  decal: [['blend', e(BLEND, 'over')], ['shape', e(['rect', 'circle', 'diamond', 'chevron'], 'chevron')], ['colour', c('#ffffff')],
    ['amount', f(1)], ['at', { kind: 'point', def: [0.5, 0.5] }], ['size', { kind: 'size2', def: [0.2, 0.1] }], ['turn', i(0, 3, 0)],
    ['place', e(['once', 'along'], 'once')], ['count', i(1, 256, 1)]],
});
const TOP = Object.freeze([['texmaker', null], ['name', null], ['base', c('#303030')], ['layers', null]]);
const VERSION = 1, MAX_LAYERS = 32, MAX_SIDE = 8192;

module.exports = { LAYERS, TOP, VERSION, MAX_LAYERS, MAX_SIDE, BLEND, DIR };
