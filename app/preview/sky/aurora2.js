// sky/aurora2.js (D490 PROTOTYPE, pane C): look 2, one real 3D curtain in front, flat arcs behind. The near curtain is a VOLUME (sky/arcs.js, 16 steps
// at full resolution): soft, folds seen edge-on brighten, its rays converge overhead with depth. The two far arcs are SHEETS, as look 1.
'use strict';
const ARCS = require('./arcs.js');
const SOURCE = ARCS.source('aurora2', { steps: 12, curtains: [
  { D: 0.35, W: 0.03, amp: 0.28, seed: 1.0, gain: 1.0, volume: true },
  { D: 2.1, W: 0.02, amp: 0.30, seed: 7.0, gain: 0.75, volume: false },
  { D: 4.2, W: 0.02, amp: 0.35, seed: 13.0, gain: 0.5, volume: false },
  { D: -0.45, W: 0.02, amp: 0.25, seed: 19.0, gain: 0.7, volume: false },   // a curtain just south (a sheet): with the near one, the corona closes round the magnetic zenith
] });
module.exports = { source() { return SOURCE; } };
