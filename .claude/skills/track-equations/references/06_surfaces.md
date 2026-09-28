# 06 · Surfaces: Gaussian curvature on a mesh, the shape of T-180 corners, and a particle on the road

The road's cross-section and its surface shape are the "feel" functions. They are fitted beside the line. This primer covers:
- how the surface's curvature K is measured on a triangle mesh;
- what it measured on T-180 tracks.

## §1 Gaussian curvature from a mesh: the angle defect
- At an interior vertex, the angle defect is **δ = 2π − Σ (the triangle angles at that vertex)**.
- The discrete Gaussian curvature is δ divided by an area around the vertex:
  - a third of the incident triangles (this repo's `tools/meshcurv.cjs`);
  - or the mixed Voronoi area (MEYER03, not opened).
- **Smoothed K:** K̄ = Σδ / ΣA over a ball of radius ρ around the vertex. This is `meshcurv.cjs --radius`.

**Re-running a check:** use the exported meshes and parameters. Do not copy the builder or choose a radius.

```js
const { meshes, params, meshCurvature, smoothK } = require('./.claude/skills/track-equations/evals/checks.js');
const c = meshCurvature(meshes.sphere({ R: 5 })), K = smoothK(c, params.sphere.smoothRadius);   // 1 m, as the check
```

- **The meshes:** `sphere`, `cylinder`, `cone`, `torus` (returns `{ mesh, vs }`) and `dishedCorner`. Each takes named
  parameters, and each default is what its check uses.
- **`params.<name>.smoothRadius`** is the averaging radius: 1 m for the sphere, 6 m for the dished corner, and `null` where
  the check reads raw defects or their sums.

## §2 Known surfaces
- **A sphere of radius R has K = 1/R².**
  - **Test (06 §2):** the smoothed K̄ over 1 m, away from the poles, within 5%.
  - **Mutant K19** (1/R) **is caught.**
- **A cylinder and a cone have K = 0.** They are developable: every interior vertex has zero angle defect.
  - **Test (06 §2):** checked to 1e-9, at every interior vertex.

## §3 The torus
**SOURCED** (MATHWORLD-TORUS; do Carmo §3-3, not opened). The tube radius is r, the centre radius R, and v is the tube angle,
with v = 0 on the OUTER equator:

  **K = cos v / (r (R + r cos v))**

- K > 0 on the outside (v = 0).
- K = 0 on the top and bottom circles.
- K < 0 on the inside (v = π).

**Test (06 §3):** each ring's SUMMED angle defect equals ∫K dA over its band, with dA = r(R + r cos v) du dv (Simpson). Also
checked: the sign, positive outside and negative inside.

**Mutant K20** (sin v) **is caught.**

## §4 Gauss–Bonnet (Descartes' theorem)
**SOURCED** (WIKI-GB). On a closed mesh, **Σ δ = 2πχ**: a sphere gives 4π and a torus gives 0. This holds exactly, for ANY
triangulation.

**Test (06 §4):** checked to 1e-9.

## §5 The per-vertex estimate is BIASED; sums are exact (found tonight, on the test itself)
- The first torus check compared the per-vertex K̄ with the formula. It FAILED:
  - at v = 0.52, 0.0249 against 0.0229, 8.7% off;
  - that was on a near-square grid (208 × 48).
- The first diagnosis was "the grid is too anisotropic". **That was wrong.**
- The cause: the triangulation biases how the defect is SHARED between neighbouring vertices, not its total.
  - BORRELLI03 (not opened; abstract as quoted by search): δ/A converges pointwise only on special, regular meshes.
- **The rule it leaves:**
  - read K as an INTEGRAL (Σδ over a region), or smoothed over a ball;
  - never as a sign or a value at one vertex;
  - an integral is exact by Gauss–Bonnet, and a per-vertex value is not.

## §6 A dished corner banked into its turn is ELLIPTIC (DERIVED)
**The derivation.** At the corner's centre the two principal directions are across the road and along it.
- **Across:** the section's own curvature, dψ/du (the dish).
- **Along:** the path's normal curvature, which is the horizontal curvature κh times the component of the turn's normal along
  the surface normal. Banked into the turn by β, that component is sin β.
- K is the product: **K ≈ κh · sin β · dψ/du**. It is > 0 when the dish and the bank curve the same way, that is ELLIPTIC.
- The twist term is neglected, so it holds at the centre only.

**Test (06 §6):**
- a meshed corner with Rh = 200 m, β = 0.5, a dish of 0.01 rad/m and a width of 30 m;
- smoothed over 6 m;
- the centre K̄ is > 0 and within 25% of the formula.

**Mutant K21** (cos β) **is caught.**

## §7 A frictionless particle on the road (the "pour water" evaluator's core)
**DERIVED** from Newton's law with a normal force, on a graph y = f(x, z), with up +y:
- q = g + f_xx ẋ² + 2 f_xz ẋż + f_zz ż²
- D = 1 + f_x² + f_z²
- ẍ = −f_x q / D
- z̈ = −f_z q / D
- N/m = q / √D. **N < 0 means the particle lifts off.**

**Tests (06 §7):**
- on a bowl, ½v² + g y is conserved to 1e-6;
- over a crest of radius R it lifts off exactly when v² > gR, with N(20 m/s) = g − v²/R at R = 100.

**Mutants K22** (gravity sign) **and K23** (no 1/D) **are caught.**

**Its limit:** a graph cannot represent a wall past vertical or an inversion. Those need the surface in the path's frame.
- Also, at 20–90 g the car's balance bank is 87–89°, and grip, downforce and throttle let it leave the water line on purpose.
- Source: `exo_memory/research/t180_be_like_water_2026-09-28.md`.

## True of T-180 tracks (MEASURED)
- **M3, per vertex: FAILS** (FINDINGS §7i, `node tools/meshcurv.cjs <track dir> <read.json>`).
  - Share of K < 0 area, corners against straights:
    - Sakura: 14.4% against 5.9%;
    - Centrifuge: 18.0% against 21.0%.
  - The design's "hyperbolic in the corners" did not hold on Centrifuge.
- **M3b, smoothed over 6 m: FAILS, opposite to the prediction** (FINDINGS §7j, `--radius 3,6,12`).
  - Share of K̄ < 0, corners against straights:
    - Sakura: 20.7% against 31.6%;
    - Centrifuge: 16.3% against 24.1%.
  - Share of K̄ > 0, corners against straights:
    - Sakura: 78.8% against 63.0%;
    - Centrifuge: 83.5% against 73.4%.
  - **At 3–6 m, T-180 corners read ELLIPTIC, which is what §6 derives for a dish banked into its turn.**
- **The caution that fired:**
  - straights still carry ≥ 10% K̄ < 0 at 6 m;
  - the 1e-6 m⁻² flat floor sits below the mesh noise;
  - so shape is not fully separated from triangulation texture.
  - The inner-half test (43.5% and 10.0% against a 60% bar) depends on an unverified handedness chain, and is evidence of
    nothing yet.
- **M2b, PASS** (FINDINGS §7j, `node tools/geodesic.cjs --by speed`).
  - The faster a T-180 goes, the more of its turning the surface does: ρ(speed, geodesic share) −0.478, CI [−0.536, −0.419],
    5 of 5 replays.
  - M2 against load, ρ −0.50, is weakened by the load/κn coupling (§7i).

## Not on the shelf
The following are cited for context only and are NOT tested, so they are not to be quoted as formulas:
- **Jacobi fields**, f″ + K f = 0 (WIKI-JACOBI; do Carmo §5-5 from memory).
- **The Jacobi–Maupertuis metric** (CHANDA17 §2.2).
