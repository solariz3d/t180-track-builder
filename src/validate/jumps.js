// jumps.js: the jump check of ARCHITECTURE.md:72-80, as the FORWARD problem. Given the take-off (speed v, ramp angle θ)
// and where the landing road starts (D metres ahead, Δh above), does the car reach it, and at what speed at least?
//
// WHY NOT tools/jump_flight.cjs. That tool solves the INVERSE problem: it reads a replay (at require time) and fits the
// fall g_eff of a flight that happened. Its OUTPUT is what this file consumes: the 3.2–6.3 g range of FINDINGS.md:336-337
// came from it. The model is the one FINDINGS settled on, an ordinary projectile falling at g_eff (FINDINGS.md:246-247:
// "a roughly constant fall … fits better than g + k·v²"; §7d widens the constant to a range). So:
//   y(x) = x·tanθ − g_eff·x² / (2·v²·cos²θ)          (x horizontal, from the lip)
// makeable at speed v  ⇔  y(D) ≥ Δh;   minimum speed  v_min = √( g_eff·D² / (2·cos²θ·(D·tanθ − Δh)) ),
// and no speed makes it when D·tanθ ≤ Δh (the lip points below the landing): FINDINGS.md:254-256's "makeable or not and
// the minimum take-off speed from the gap, the climb and the ramp angle".
// Limits (FINDINGS.md:258-262, :387-388): the car is treated as a point; thrust in the air (FINDINGS.md:379-381) and
// in-air attitude are not modelled except through the g range itself.
'use strict';
const { G, MACH6, reachDrop } = require('./limits.js');

/** Height of the flight above the lip at horizontal distance x, falling at gEff (in g). */
function flightY(x, v, thetaRad, gEff) {
  const c = Math.cos(thetaRad);
  return x * Math.tan(thetaRad) - gEff * G * x * x / (2 * v * v * c * c);
}

/** Minimum take-off speed (m/s) to reach a landing D ahead and dh above, falling at gEff; Infinity if none does. */
function minSpeed(D, dh, thetaRad, gEff) {
  if (!(D > 0)) throw new Error(`minSpeed: the gap must be positive, got ${D}`);
  const reach = D * Math.tan(thetaRad) - dh;
  if (!(reach > 0)) return Infinity;
  const c = Math.cos(thetaRad);
  return Math.sqrt(gEff * G * D * D / (2 * c * c * reach));
}

/**
 * Check one jump at both landings. `landingRoad` is the road after the gap as [{ x, y }] (horizontal distance from the
 * lip, height relative to the lip), in order, starting with the landing lip at x = D. Returns the INTERFACES shape:
 * { gap, climb, rampDeg, minSpeed, landings: [{ g, minSpeed, clear, x, caught }], reachable }.
 *  · clear   the flight is at or above the landing lip at x = D (it does not fall into the gap)
 *  · x       where the flight comes down onto the landing road (null if it never does within the road given)
 *  · caught  clear AND a touchdown point was found on the landing road given
 */
function checkJump({ D, dh, thetaRad, v, landingRoad = [], jumpG = MACH6.jumpG, reach = MACH6.reach }) {
  if (!(D > 0)) throw new Error(`checkJump: the gap must be positive, got ${D}`);
  const landings = jumpG.map((g) => {
    const vmin = minSpeed(D, dh, thetaRad, g);
    const clear = v != null && Number.isFinite(vmin) && v >= vmin;
    let x = null;
    if (clear) for (let i = 0; i < landingRoad.length; i++) {
      const p = landingRoad[i];
      if (flightY(p.x, v, thetaRad, g) <= p.y) {
        // touchdown between the previous road point and this one: interpolate the crossing
        const q = i ? landingRoad[i - 1] : p, fq = flightY(q.x, v, thetaRad, g) - q.y, fp = flightY(p.x, v, thetaRad, g) - p.y;
        x = fq === fp ? p.x : q.x + (p.x - q.x) * fq / (fq - fp);
        break;
      }
    }
    return { g, minSpeed: vmin, clear, x, caught: clear && x != null };
  });
  const drop = -dh;
  return {
    gap: D, climb: dh, rampDeg: thetaRad * 180 / Math.PI,
    minSpeed: Math.max(...landings.map((l) => l.minSpeed)),   // the harder landing binds (ARCHITECTURE.md:75-78)
    landings,
    // FINDINGS.md:312-313: a drop deeper than the bound is a road the car cannot reach (ARCHITECTURE.md:79-80)
    reachable: drop <= reachDrop(D, reach),
  };
}

module.exports = { flightY, minSpeed, checkJump };
