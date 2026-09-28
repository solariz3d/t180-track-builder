# 02 · Curvature, heading and pitch

## §1 Curvature from position
**SOURCED** (WIKI-CURV; do Carmo §1-5).

For any parametrisation γ(t), with no need for arc length:

  **κ = ‖γ′ × γ″‖ / ‖γ′‖³**

This lets κ be read off a fitted B-spline position ([03](03_bsplines.md)) directly, by its derivatives.

**Test:** 02 §1 checks three cases:
- a circle gives 1/R;
- a line gives 0;
- a helix (a cos t, a sin t, bt) gives a/(a² + b²).

**Mutant K4** (‖γ′‖² in place of ‖γ′‖³) **is caught.**

## §2 Heading, pitch and the tangent (the builder's convention)
**SOURCED** from `src/geom`. World up is +y, heading θ is about up, and pitch p is above the horizontal:

  **T = (cos p · sin θ, sin p, cos p · cos θ)**

So heading 0 is +z, heading 90° is +x, and pitch 90° is straight up.

**Rebuilding a line from rates.** Integrate θ′ = κh and p′ = κp, then integrate T. Use the midpoint rule, with T at the
half-step. Explicit Euler drifts.

**Tests (02 §2):**
- the tangent convention;
- a constant heading rate of 1/R, run for 2πR, rebuilds a circle of radius R that closes, with a net heading of 2π.

**Mutants K5** (sin and cos swapped) **and K6** (explicit Euler) **are caught.**

**The warning** (MEASURED, M4): a heading error of 0.25 mrad sustained over 20 km is 5 m off the line.
- Integrating rates is why the long laps drifted. The skill fits POSITION ([01](01_centreline.md)) and derives the rates
  from it, never the other way.

## §3 Discrete curvature from three points
The turn angle between two chords, divided by the MEAN chord length:

  κᵢ ≈ ∠(pᵢ − pᵢ₋₁, pᵢ₊₁ − pᵢ) / ((|u| + |w|)/2)

This is DERIVED: for a circle, the turn angle equals the arc angle, and the arc is about the mean chord.

**Test (02 §3):** a circle's heading rate, read back from its points, is 1/R. **Mutant K7** (dividing by the sum) **is caught.**

## §4 Clothoid and smoothstep ramps
- **The clothoid (Euler spiral)**, SOURCED (WIKI-EULER): κ(s) = s/A². So κ is linear in s and reaches 1/R at L when A² = R·L.
- **The smoothstep**, the builder's roll ramp: S(t) = 3t² − 2t³.
  - Its source, the Bloss transition (IFC-BLOSS), and its derivation are in A's `docs/math/04a_bank_ramp.md`.
  - Its steepest slope is S′(½) = 1.5. That is DERIVED: S″ = 6 − 12t = 0 at t = ½.
  - So a word's steepest roll rate is 1.5·|φ₁ − φ₀|/L.

**Tests:**
- 02 §4 checks κ linear in s, 1/R at L, and the smoothstep's slope of 1.5 at ½.
- `test/geom_ramp.test.js` checks the builder's ramp itself ("smoothstep: 0 and 1 at the ends, 0.5 halfway, and flat at both ends").

**Mutants K8** (κ ∝ s²) **and K9** (2u² − u³) **are caught.**

## True of T-180 tracks (MEASURED)
- **The half-pipe's steepest bank rise is 4.19 °/m.** The real library measures 3.83–4.77 (p10–p90).
- **The bowl's is 1.78 °/m.** The real library measures 0.58–6.12.
- Source: `exo_memory/handback/p-d182-fonts-C_2026-09-28.md`, from `src/geom/fonts.js` against the library corpus
  (FINDINGS §7f).
