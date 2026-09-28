// jumparcs.js: every jump's two landings drawn (ARCHITECTURE §4 "Show two landings, not one"; FINDINGS §7d-e): the
// clean-flight fall (3.2 g) and the override-dive fall (6.3 g), as world-space polylines, and the landing zone marked.
//
//   jumpArcs(result, path, { points = 48 }) -> [{ id, s, speed, speedFrom, rampDeg, arcs: [arc], zone }]
//   arc  = { g, caught, clear, minSpeed, xEnd, points: [[x, y, z]], touchdown: { x, s, pos } | null }
//   zone = { s0, s1 } on the landing road, between the two touchdowns (null unless both land)
//
// THE NUMBERS ARE VALIDATION'S, never re-derived: the lip, the axis and θ are rebuilt exactly as src/validate/index.js
// builds them (the take-off sample A, the horizontal of A.T, θ = asin(A.T.y)), the curve is src/validate/jumps.js
// flightY, and each touchdown x is the landing's own `x` from the result. So an arc cannot disagree with the red/amber.
//   speed  the take-off speed validation used (design speed or lap sim): `speedFrom: 'validation'`. With none (no
//          speed model), each landing is drawn at its OWN minimum speed, the slowest flight that still clears the
//          landing lip: `speedFrom: 'minimum'`. A landing no speed makes (minSpeed ∞) has no arc.
//   extent a caught landing's arc ends at its touchdown; any other runs to 1.5 × the gap (inferred: a display length).
// Pending jumps (no landing yet at the open head) are skipped: validation has nothing to draw from.
'use strict';
const { flightY } = require('../../src/validate/jumps.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function lipFrame(path, s) {
  const S = path.samples, i = S.findIndex((p) => p.s === s);
  if (i < 0) throw new Error(`jumpArcs: no sample at the jump's take-off s = ${s}`);
  const A = S[i], h = [A.T[0], 0, A.T[2]], l = Math.hypot(h[0], h[2]);
  return { A, i, axis: l > 0 ? [h[0] / l, 0, h[2] / l] : [0, 0, 1], theta: Math.asin(Math.max(-1, Math.min(1, A.T[1]))) };
}

/** The road's s at horizontal distance x past the lip, interpolated between samples. Called only with a touchdown x,
 *  which is never short of the landing lip (jumps.js searches the landing road from x = D), while every sample inside
 *  the flight lies short of it: so the crossing is always found on the landing road, and no sample needs skipping. */
function sAtX(path, f, x) {
  const S = path.samples;
  let prev = null;
  for (let k = f.i + 1; k < S.length; k++) {
    const xk = dot(sub(S[k].pos, f.A.pos), f.axis);
    if (xk >= x && prev) { const t = (x - prev.x) / (xk - prev.x); return prev.s + (S[k].s - prev.s) * t; }
    prev = { x: xk, s: S[k].s };
  }
  return null;
}

function jumpArcs(result, path, { points = 48 } = {}) {
  const out = [];
  for (const jp of result.jumps) {
    if (jp.pending || jp.badGap) continue;   // badGap: no flight to draw (validation's red 'jump-gap-not-forward' says why)
    const f = lipFrame(path, jp.s), known = Number.isFinite(jp.speed) && jp.speed > 0;
    const at = (x, v, g) => [f.A.pos[0] + f.axis[0] * x, f.A.pos[1] + flightY(x, v, f.theta, g), f.A.pos[2] + f.axis[2] * x];
    const arcs = jp.landings.map((L) => {
      const v = known ? jp.speed : L.minSpeed;
      if (!(Number.isFinite(v) && v > 0)) return { g: L.g, caught: L.caught, clear: L.clear, minSpeed: L.minSpeed, xEnd: null, points: [], touchdown: null };
      const xEnd = L.caught ? L.x : 1.5 * jp.gap;
      const pts = []; for (let k = 0; k <= points; k++) pts.push(at(xEnd * k / points, v, L.g));
      const touchdown = L.caught ? { x: L.x, s: sAtX(path, f, L.x), pos: pts[pts.length - 1] } : null;
      return { g: L.g, caught: L.caught, clear: L.clear, minSpeed: L.minSpeed, xEnd, points: pts, touchdown };
    });
    const td = arcs.filter((a) => a.touchdown && a.touchdown.s != null).map((a) => a.touchdown.s);
    out.push({ id: jp.id, s: jp.s, speed: known ? jp.speed : null, speedFrom: known ? 'validation' : 'minimum', rampDeg: jp.rampDeg, arcs,
      zone: td.length === arcs.length && td.length ? { s0: Math.min(...td), s1: Math.max(...td) } : null });
  }
  return out;
}

module.exports = { jumpArcs };
