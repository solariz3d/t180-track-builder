// sky/aurora3.js (D490 PROTOTYPE, pane C): look 3, fully 3D. All three curtains are VOLUMES (sky/arcs.js, 20 steps), drawn at HALF resolution and
// scaled up by the renderer (scale below); the stars are drawn in the full-resolution composite (skyOverlay), so they stay a device pixel (D416).
'use strict';
const ARCS = require('./arcs.js');
const SOURCE = ARCS.source('aurora3', { steps: 20, overlay: true, curtains: [
  { D: 0.35, W: 0.03, amp: 0.28, seed: 1.0, gain: 1.0, volume: true },
  { D: 2.1, W: 0.03, amp: 0.30, seed: 7.0, gain: 0.75, volume: true },
  { D: 4.2, W: 0.03, amp: 0.35, seed: 13.0, gain: 0.5, volume: true },
  { D: -0.45, W: 0.03, amp: 0.25, seed: 19.0, gain: 0.7, volume: true },   // a curtain just south: with the near one, the corona closes round the magnetic zenith
] });
module.exports = { source() { return SOURCE; }, scale: 0.5 };
