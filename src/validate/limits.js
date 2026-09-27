// limits.js: every number validation uses, each beside the FINDINGS or ARCHITECTURE line it comes from (the label rule:
// a number with no source is a bug). Per car, from its open config (ARCHITECTURE.md:70-71); the Mach 6 is the only car
// FINDINGS measured, so it is the default. Units: g as multiples of G, metres, degrees only where the source says degrees.
'use strict';

const G = 9.81;   // m/s², the same constant the measuring tools use (tools/jump_flight.cjs:11 `G = 9.81`, tools/read_track.cjs:151)

const MACH6 = Object.freeze({
  // FINDINGS.md:103-104 "About 20 g: the suspension runs out (measured). It is a change in how the car sits, not a
  // failure." INFORMATIONAL: never red, never amber (docs/INTERFACES.md §3).
  suspensionStopG: 20,
  // FINDINGS.md:105 "Up to about 90 g: proven, on a soft-collision surface"; FINDINGS.md:112-113 "AMBER, for 'beyond
  // what any track has proven': load above the highest survived (about 90 g today). It is shown, not forbidden."
  // The withdrawn 60 g red line (FINDINGS.md:116-118, struck) is deliberately absent.
  provenG: 90,
  // FINDINGS.md:336-337 (§7d): "the measured range is 3.2–6.3 g"; ARCHITECTURE.md:73-78: "a jump must hold at both
  // ends of that range … the landing ramp must catch both". The clean flight and the override dive (FINDINGS.md:383-386).
  jumpG: Object.freeze([3.2, 6.3]),
  // FINDINGS.md:312-313 (§7d), as tools/read_track.cjs:149-151 implements it: "The deepest allowed drop is
  // dist·tan10° + ½·6.5 g·(dist / 375 km/h)²". ARCHITECTURE.md:79: "A landing must be reachable. The same bound".
  reach: Object.freeze({ downDeg: 10, fallG: 6.5, minTakeoffKmh: 375 }),
  // FINDINGS.md:24 (§2): seam angle between adjacent road triangles "p90 1.1–5.9°" on the proven tracks. Past 5.9° is
  // sharper than any proven track's p90: AMBER (FINDINGS.md:110-111 calls such seams red but "inferred, not yet observed
  // failing"; ARCHITECTURE.md:81-87, the master, leaves them off the red list).
  seamP90Deg: 5.9,
  // ARCHITECTURE.md:85 "drivable surfaces stacked within about 2 m" (RED).
  stackedM: 2,
  // ARCHITECTURE.md:87 "surfaces above ~50° without CSP's wall raycasting (vanilla AC tyres ignore steep surfaces;
  // community-reported)" (RED only when the export does not target CSP).
  steepDeg: 50,
  // FINDINGS.md:37 (§3): the highest speed in the data, "89.8 g at 745 km/h" on Centrifuge. Used ONLY as the lap sim's
  // speed cap. inferred: that the Mach 6's top speed is near it (FINDINGS measures speeds reached, not a top speed).
  vmaxKmh: 745,
  // NOT IN FINDINGS: the car's longitudinal acceleration. The lap sim needs it (or a design speed on every word). No
  // default is invented: with neither, the lap reports 'no-speed-model' instead of a made-up proof.
  accel: null,
});

const kmh = (v) => v / 3.6;   // km/h → m/s

/** The deepest drop a landing may sit below its take-off and still be reachable (FINDINGS.md:312-313). */
function reachDrop(dist, reach = MACH6.reach) {
  return dist * Math.tan(reach.downDeg * Math.PI / 180) + 0.5 * reach.fallG * G * (dist / kmh(reach.minTakeoffKmh)) ** 2;
}

module.exports = { G, MACH6, kmh, reachDrop };
