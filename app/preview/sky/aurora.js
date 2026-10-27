// sky/aurora.js: the 'aurora' sky (D384, D403; reworked in D495 from the D490 prototypes, look 2), Aurora's. The contract is in app/preview/sky/index.js.
// A polar night with curtains of aurora hung along the magnetic field (the GLSL is sky/arcs.js, which says how it is made and why). Each curtain runs
// magnetic east-west from one horizon over the sky to the other; its folds and curls drift slowly along it, and its rays run along the hem, low in
// contrast; a patch brightens now and then over about 9 s. The near curtain is drawn as a VOLUME: soft, a fold seen edge-on brightens as it should,
// and seen from beneath its rays converge with real depth on the magnetic zenith, the corona, green bases outward and faint tops in. The other
// three, a curtain just south (with the near one it closes the corona) and two arcs toward the pole, are SHEETS, one hit each.
// Quiet behind the work: nothing under about 10 degrees of elevation, where the road sits against the sky; the night pales only to the skin's --fog
// (uSkyC) at the horizon; the large shapes drift at about 0.16 km/s of the real thing, so nothing large crosses the view in under four minutes (D403).
// The stars are D416's points, a device pixel across. Colours are the skin's tokens: uSkyA the hem's green, uSkyB the violet as it climbs, the red
// tops and magenta lower edge made from uSkyB (its red and blue swapped), uSkyC the horizon.
// CYCLE 'a' (sky/cycle.js, D489 §7 and §10): over about ten minutes, not on an exact clock, the red tops and pink lower edges fade and swell while the
// hem stays green, worked out once a frame on the CPU and sent as uSkyA / uSkyB; at t = 0 they are the skin's own, so reduced motion holds the skin's
// colours.
// FALLBACK: the same curtains with the near one drawn as a sheet too (the D490 look 1, about a quarter of the cost). The renderer draws it instead
// when the sky's measured GPU time on the user's machine is over its budget (renderer.js, sky/budget.js).
'use strict';
const ARCS = require('./arcs.js');

const NEAR = { D: 0.3, W: 0.03, amp: 0.28, seed: 1.0, gain: 1.0 };    // the near curtain, nearly overhead: the corona when looked up at
const REST = [
  { D: 2.1, W: 0.02, amp: 0.30, seed: 7.0, gain: 0.75, volume: false },    // an arc toward the pole
  { D: 4.2, W: 0.02, amp: 0.35, seed: 13.0, gain: 0.5, volume: false },    // a far arc, low
  { D: -0.25, W: 0.02, amp: 0.25, seed: 19.0, gain: 0.7, volume: false },  // a curtain just south: with the near one, the corona closes round the magnetic zenith
];
const SOURCE = ARCS.source('aurora', { steps: 12, curtains: [{ ...NEAR, volume: true }, ...REST] });
const FLAT = ARCS.source('aurora', { curtains: [{ ...NEAR, W: 0.02, volume: false }, ...REST] });

module.exports = { source() { return SOURCE; }, fallback() { return FLAT; }, cycle: 'a' };
