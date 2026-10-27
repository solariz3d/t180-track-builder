// sky/aurora1.js (D490 PROTOTYPE, pane C): look 1, a reworked flat sky. Three curtains drawn as SHEETS (sky/arcs.js): one hit each, so about today's
// cost, but with E's shapes: arcs from horizon to horizon, folds and curls, layered motion, and the corona the right way round (the near curtain
// overhead, its rays converging on the magnetic zenith by perspective). No volume: a curtain has no thickness of its own.
'use strict';
const ARCS = require('./arcs.js');
const SOURCE = ARCS.source('aurora1', { curtains: [
  { D: 0.35, W: 0.02, amp: 0.28, seed: 1.0, gain: 1.0, volume: false },    // the near curtain, nearly overhead: the corona when looked up at
  { D: 2.1, W: 0.02, amp: 0.30, seed: 7.0, gain: 0.75, volume: false },    // a second arc toward the pole
  { D: 4.2, W: 0.02, amp: 0.35, seed: 13.0, gain: 0.5, volume: false },    // a far arc, low
  { D: -0.45, W: 0.02, amp: 0.25, seed: 19.0, gain: 0.7, volume: false },   // a curtain just south: with the near one, the corona closes round the magnetic zenith
] });
module.exports = { source() { return SOURCE; } };
