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
  // THE DOWNFORCE RAY (R1, docs/research/04_ac_physics_drivability.md §4, SOURCED there from the INSTALLED car's
  // mach6_active/data/script.lua:424-433): cast from upM above the car's origin and aheadM ahead of it, lengthM long, down
  // the car's up axis; suction full within fullWithinM of the ray's start, none at noneAtM, and none on a miss (inferred
  // there from the code). src/validate/raygap.js uses aheadM as the reach of a gap the ray can fall into.
  downforceRay: Object.freeze({ upM: 0.4, aheadM: 1.0, lengthM: 1.0, fullWithinM: 0.5, noneAtM: 0.9 }),
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
  // FINDINGS.md:484 (§3d): the lap sim's speed cap, the pooled p99 of seven Mach 6 laps (FINDINGS.md:474), a stated
  // choice of percentile. It was 745 until 2026-09-27, read off FINDINGS.md:37, which is the speed at Centrifuge's
  // hardest MOMENT, not a top speed (FINDINGS.md:478-481): both Centrifuge laps spend over 10% of their frames above it.
  vmaxKmh: 764,
  // FINDINGS.md:476 (§3d): the design-speed default, the pooled p50 of the same laps (FINDINGS.md:474). Validation uses
  // it only when asked to (opts.designSpeed); the app's picker starts at it.
  designSpeedKmh: 460,
  // FINDINGS.md:494 (§3d, the table; read as below at :496-500): the lap sim's full-thrust acceleration against speed,
  // the p95 of the propulsive acceleration per band, placed at each band's middle: [km/h, m/s²]. "Full thrust" is an
  // INFERENCE (a replay carries no throttle), stated at :498-500. Read with accelAt(): linear between points, the end values held beyond them.
  accel: Object.freeze([[100, 24.71], [250, 25.52], [350, 23.20], [450, 20.07], [550, 17.73], [650, 14.75], [750, 11.50]].map((r) => Object.freeze(r))),
});

const kmh = (v) => v / 3.6;   // km/h → m/s

/** The car's full-thrust acceleration (m/s²) at speed v (m/s). `accel` is a number, or a [km/h, m/s²] table; null → NaN. */
function accelAt(car, v) {
  const a = car.accel;
  if (typeof a === 'number') return a;
  if (!Array.isArray(a) || !a.length) return NaN;
  const k = v * 3.6;
  if (k <= a[0][0]) return a[0][1];
  for (let i = 1; i < a.length; i++) if (k <= a[i][0]) { const t = (k - a[i - 1][0]) / (a[i][0] - a[i - 1][0]); return a[i - 1][1] + (a[i][1] - a[i - 1][1]) * t; }
  return a[a.length - 1][1];
}

/** The deepest drop a landing may sit below its take-off and still be reachable (FINDINGS.md:312-313). */
function reachDrop(dist, reach = MACH6.reach) {
  return dist * Math.tan(reach.downDeg * Math.PI / 180) + 0.5 * reach.fallG * G * (dist / kmh(reach.minTakeoffKmh)) ** 2;
}

module.exports = { G, MACH6, kmh, reachDrop, accelAt };
