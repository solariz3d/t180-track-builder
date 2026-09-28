# 05 · The jump: a ballistic arc between pieces

A run of stations whose cross-ray hits nothing is a jump gap ([01](01_centreline.md) §4):
- the take-off is the last hit;
- the landing is the first hit after it.

The joint across the gap is the FLIGHT, not a position constraint ([04](04_joints_closure.md) §2).

## §1 The projectile
**SOURCED** (WIKI-PROJ), with up as +y:

  **y(t) = y₀ + v_y t − ½ g t²**,  x(t) = x₀ + v_x t

**On level ground:**
- the time of flight is 2v sin θ / g;
- the range is v² sin 2θ / g.

A frictionless particle conserves ½v² + g y.

**Test (05 §1):** the range, the time of flight, and the energy along the arc.

**Mutant K17** (g not halved) **is caught.**

## §2 The landing time is the LATER root
The time to come down to a landing height y_L is

  t = (v_y + √(v_y² + 2g(y₀ − y_L))) / g

The other root is the time the arc passes that height on the way UP (or before take-off).

**Test (05 §2):** the later root, and the arc is at y_L at that time.

**Mutant K18** (the earlier root) **is caught.**

## How the skill uses it
1. Take the take-off tangent and the design speed.
2. Run the arc at the ends of the measured fall range below.
3. Ask: does it land within the landing's tolerance?

This is REPORTED as a check. It is not fitted.

## True of T-180 tracks (MEASURED)
- **The Mach 6's fall in the air is NOT g, and it is not one number: 3.2–6.3 g.**
  - Source: FINDINGS §7d, `node tools/jump_flight.cjs`: thirteen Hazen flights, plus Sakura and Coast. It supersedes §8's
    "g_eff ≈ 3.3 g".
- **The same jump at the same speed** (Hazen 3922, 639 km/h) fell at 6.25 g on one lap and 4.68 g on the other.
  - The lead, from FINDINGS §7e: the turbine override pitches the nose down, about 0.4 g per degree.
  - That is inferred from attitude and speed gain, not read from input.
- **So a jump check runs BOTH ends:** the long flight (3.2 g) and the short one (6.3 g). The landing ramp must catch both.
- **The FINDINGS §7d fit residuals were 0.05–0.36 m.** The ordinary projectile, with the fall fitted, describes a flight to
  that accuracy.

## Not on the shelf
None of these is modelled or tested:
- drag;
- lift;
- thrust in the air, of which there is a measured trace: 639→650 km/h in the air on 3922 (§7e);
- the car's rotation.
