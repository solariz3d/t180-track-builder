// presets.js: starting textures, each a parameter set (so each is also its canonical text). Our own parameters only: no
// other author's texture bytes are read or copied (the README's promise). "rainbow" takes its bands' look from our own
// render, results/rainbow_full.png (red through amber and green to blue and white), as colour stops.
'use strict';

const PRESETS = Object.freeze({
  asphalt: { texmaker: 1, name: 'asphalt', base: '#3a3a3c', layers: [
    { type: 'noise', blend: 'multiply', colour: '#000000', amount: 0.25, cells: 6, octaves: 5, persistence: 0.55, seed: 3 },
    { type: 'grain', blend: 'multiply', colour: '#000000', amount: 0.35, cells: 512, seed: 7 },
    { type: 'grain', blend: 'over', colour: '#8a8a8a', amount: 0.12, cells: 256, seed: 8 },
  ] },
  rainbow: { texmaker: 1, name: 'rainbow', base: '#101010', layers: [
    { type: 'gradient', blend: 'over', dir: 'along', mode: 'bands', repeat: 1, amount: 1, stops: [
      { at: 0, colour: '#e8452c' }, { at: 0.16, colour: '#d98a3c' }, { at: 0.32, colour: '#8fb07a' },
      { at: 0.48, colour: '#5f86a8' }, { at: 0.64, colour: '#3c5ad8' }, { at: 0.8, colour: '#f2f4f6' }] },
    { type: 'grain', blend: 'multiply', colour: '#000000', amount: 0.12, cells: 256, seed: 2 },
    { type: 'lines', blend: 'over', colour: '#ffffff', amount: 1, at: 0.02, width: 0.012, dashes: 0, duty: 0.5 },
    { type: 'lines', blend: 'over', colour: '#ffffff', amount: 1, at: 0.98, width: 0.012, dashes: 0, duty: 0.5 },
  ] },
  lanes: { texmaker: 1, name: 'lanes', base: '#2e2e30', layers: [
    { type: 'grain', blend: 'multiply', colour: '#000000', amount: 0.3, cells: 512, seed: 5 },
    { type: 'lines', blend: 'over', colour: '#f0f0f0', amount: 1, at: 0.03, width: 0.015, dashes: 0, duty: 0.5 },
    { type: 'lines', blend: 'over', colour: '#f0f0f0', amount: 1, at: 0.97, width: 0.015, dashes: 0, duty: 0.5 },
    { type: 'lines', blend: 'over', colour: '#f2c230', amount: 1, at: 0.5, width: 0.01, dashes: 4, duty: 0.5 },
    { type: 'decal', blend: 'over', shape: 'chevron', colour: '#f2c230', amount: 0.9, at: [0.25, 0.25], size: [0.12, 0.08], turn: 0, place: 'along', count: 2 },
  ] },
  'neon-night': { texmaker: 1, name: 'neon-night', base: '#0c0d12', layers: [
    { type: 'panels', blend: 'over', colour: '#050507', amount: 1, cols: 4, rows: 8, seam: 0.03, tone: 0.15, seed: 4 },
    { type: 'stripes', blend: 'over', dir: 'across', colour: '#1c2030', amount: 0.6, count: 16, width: 0.1, offset: 0 },
    { type: 'glow', dir: 'along', colour: '#40c0ff', at: 0.04, width: 0.01, falloff: 0.04, intensity: 1.2, emissive: true },
    { type: 'glow', dir: 'along', colour: '#ff40c0', at: 0.96, width: 0.01, falloff: 0.04, intensity: 1.2, emissive: true },
  ] },
});

module.exports = { PRESETS };
