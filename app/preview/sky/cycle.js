// sky/cycle.js (D490, shipped in D495): the aurora's slow colour drift, worked out ONCE A FRAME on the CPU and sent as the two colours the sky pass
// already sends each frame (uSkyA, uSkyB; D489 §10 way 2: about 25 ns a frame, nothing on the GPU). --sky-c is never touched, so it stays --fog.
// At t = 0 it returns the skin's own colours, so under prefers-reduced-motion (t frozen at 0) the sky is the skin's.
//   'a' (D489 §7, lifelike): activity swells and fades over about 10 minutes, not on an exact clock (two periods that do not divide, 600 and 253 s);
//       the hem's green (uSkyA) stays; the red tops and magenta lower edges, made from uSkyB, follow the activity with a lag of about 90 s (the 630 nm
//       red's lifetime), through the strength of uSkyB.
//   'none' the skin's own colours at every t.
'use strict';
const TAU = 2 * Math.PI;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** activity in 0..1 at t seconds: 1 at t = 0 */
function activity(t) { return clamp01(0.5 + 0.38 * Math.cos(TAU * t / 600) + 0.12 * Math.cos(TAU * t / 253)); }
/** the two colours at t seconds for cycle mode ('a' or 'none'), from the skin's a and b; a mode it does not know throws */
function colours(mode, t, a, b) {
  if (mode !== 'a' && mode !== 'none') throw new Error(`sky cycle: no cycle ${JSON.stringify(mode)} (the cycles are 'a' and 'none')`);
  if (mode === 'none' || !(t > 0)) return [a, b];
  const k = 0.2 + 0.8 * activity(Math.max(0, t - 90));
  return [a, b.map((v) => clamp01(v * k))];
}
module.exports = { colours, activity };
