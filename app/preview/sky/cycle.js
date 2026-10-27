// sky/cycle.js (D490 PROTOTYPE, pane C): the aurora's slow colour drift, worked out ONCE A FRAME on the CPU and sent as the two colours the sky pass
// already sends each frame (uSkyA, uSkyB; C's D489 §10 way 2: about 25 ns a frame, nothing on the GPU). --sky-c is never touched, so it stays --fog.
// At t = 0 both return the skin's own colours, so under prefers-reduced-motion (t frozen at 0) the sky is the skin's.
//   'a' lifelike (E §7): activity swells and fades over about 10 minutes, not on an exact clock (two periods that do not divide, 600 and 253 s); the
//       hem's green stays; the red tops and magenta lower edges follow the activity with a lag of about 90 s (the 630 nm red's lifetime), through
//       the strength of --sky-b, from which aurora's red is made
//   'b' stylised: the hem's colour goes round green -> teal -> violet -> rose and back every 600 s, --sky-b a step ahead of it. Invention (E §7.2).
'use strict';
const TAU = 2 * Math.PI;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mix = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
const smooth = (x) => x * x * (3 - 2 * x);
/** activity in 0..1 at t seconds: 1 at t = 0 */
function activity(t) { return clamp01(0.5 + 0.38 * Math.cos(TAU * t / 600) + 0.12 * Math.cos(TAU * t / 253)); }
const TEAL = [0.22, 0.92, 0.86], VIOLET = [0.62, 0.46, 1], ROSE = [1, 0.47, 0.68], GREEN2 = [0.42, 0.98, 0.62];
function path(keys, x) { const n = keys.length, s = ((x % 1) + 1) % 1 * n, i = Math.floor(s), f = smooth(s - i); return mix(keys[i], keys[(i + 1) % n], f); }
/** the two colours at t for cycle 'a' or 'b' (anything else: the skin's own), from the skin's a and b */
function colours(mode, t, a, b) {
  if (!(t > 0) || (mode !== 'a' && mode !== 'b')) return [a, b];
  if (mode === 'a') { const k = 0.2 + 0.8 * activity(Math.max(0, t - 90)); return [a, b.map((v) => clamp01(v * k))]; }
  const x = t / 600;
  return [path([a, TEAL, VIOLET, ROSE], x), path([b, ROSE, GREEN2, TEAL], x)];
}
module.exports = { colours, activity };
