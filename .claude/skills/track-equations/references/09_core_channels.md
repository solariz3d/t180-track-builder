# 09 · The core's channels: continuation, the Bloss blend, the cross-section, rates from position

The formulas the equation core (`src/core`) uses beyond 02 and 03. Each has its source or its derivation, and the test that
exercises it (in `test/core_*.test.js`). Labels as in the [README](README.md).

## §1 The end slope of a clamped cubic B-spline (the joint rule)
**SOURCED** (WIKI-BSPLINE, opened 2026-09-28, §"Derivative expressions"): the derivative of a spline is a spline one degree
lower, d/dx Σᵢ αᵢ B_{i,k}(x) = Σᵢ k·(αᵢ − αᵢ₋₁)/(t_{i+k} − tᵢ) · B_{i,k−1}(x).

**DERIVED.** On a clamped cubic, knots t₀ = t₁ = t₂ = t₃ = 0 < t₄ …, only B_{1,2} is non-zero at x = 0, and it is 1 there.
So:
- c(0) = P₀, and c′(0) = 3(P₁ − P₀)/t₄;
- at the far end, c(L) = P_{n−1}, and c′(L) = 3(P_{n−1} − P_{n−2})/(L − t_{n−1}), where t_{n−1} is the last interior knot
  (or 0 when there is none).

So a piece starts at the previous piece's end value v and slope m exactly when P₀ = v and P₁ = v + m·t₄/3. That is the
core's joint rule: C1 in every channel, and so G2 in the line.

**Test:** `test/core_doc.test.js` "a clamped cubic starts at P0 with slope 3(P1 − P0)/t4" (against a finite difference).

## §2 The continuation and the Bloss blend (extend)
**The continuation, DERIVED** (the first-order Taylor polynomial): from an end value v and slope m, cont(s) = v + m·s.
- A constant channel (m = 0: a circle's heading rate, a steady bank) continues constant.
- A linear one (a clothoid's heading rate, ref 02 §4) continues linear.
- So with no handle touched, a circle stays a circle and a clothoid stays a clothoid.

**The blend to a handle target T over a transition of length Lₜ, DERIVED from the Bloss polynomial** S(u) = 3u² − 2u³
(ref 02 §4, IFC-BLOSS):
- c(s) = (1 − S(u))·cont(s) + S(u)·T, where u = min(1, s/Lₜ); and c(s) = T past Lₜ.
- **Value and slope at s = 0:** S(0) = S′(0) = 0, so c(0) = v and c′(0) = m. The joint rule (§1) holds.
- **At s = Lₜ:** c′(s) = (1 − S)·m + (S′(u)/Lₜ)·(T − cont(s)). With S(1) = 1 and S′(1) = 0, c = T and c′ = 0. So it meets
  the constant target with zero slope: C1, no step in the channel's rate.
- With T = cont (no handle), c ≡ cont.

**The blend is not a polynomial of degree ≤ 3** when m ≠ 0 (it is quartic). So the piece's B-spline is FITTED to it by
least squares (ref 03 §2), with P₀ and P₁ held by §1, and its error is measured by the test.

**Tests** (`test/core_extend.test.js`):
- a continued circle's radius error is < 1%;
- a continued clothoid's κ stays linear;
- the blend reaches T with zero slope.

## §3 The cross-section from the rise-rate channel
**MEASURED law** (C, D182: "a rim rises at a rate, not to an angle"; `src/geom/fonts.js` `floorAt`; the measurement is in
FINDINGS §7f's corpus). A family's floor is ψ at ¼, ½, ¾ and the edge of each half-width (FLOORS), with each quarter's rise
capped by a rate:

  ψ(qᵢ) = ψ(qᵢ₋₁) + min(FLOORS[i] − FLOORS[i−1], r · w/8)   (degrees; w/8 is a quarter of a half-width)

- fonts.js holds r at the family's measured median (RATES).
- **The core makes r a channel, r(s).** At r = RATES[family], the profile is exactly fonts.js's.

**Test:** `test/core_adapter.test.js` "at the family's rate, the core's profile is fonts.js's".

## §4 Heading and pitch rates from a curve's position (loading a real track)
**DERIVED** from ref 02 §2's T = (cos p sin θ, sin p, cos p cos θ), with θ = atan2(Tₓ, T_z) and p = asin(T_y):
- κh = θ′ = (T_z·Tₓ′ − Tₓ·T_z′)/(Tₓ² + T_z²);
- κv = p′ = T_y′/cos p.
- Here T′ is the unit tangent's derivative per metre. For a curve r(t) in any parameter t, with T = r′/|r′|,
  dT/ds = (r″ − (r″·T)T)/|r′|².

**Test:** `test/core_doc.test.js` "a circle's position gives κh = 1/R, κv = 0" and "a helix gives κv = 0 and its pitch".

## §5 The adapter's roll: the geometry's smoothstep per segment against the channel
`src/geom` gives each segment a roll that runs from roll₀ to roll₁ by the smoothstep S(t) = 3t² − 2t³ (ref 02 §4), not
linearly. The adapter cuts a channel into segments of ≤ segM metres, so between the segment ends the roll departs from a
straight interpolation by (roll₁ − roll₀)·(S(t) − t).

**DERIVED:** S(t) − t = 3t² − 2t³ − t. Its derivative, 6t − 6t² − 1, is zero at t = ½ ± 1/(2√3). There
|S(t) − t| = 1/(6√3) ≈ 0.0962. So:
- the roll a sample carries is within 0.0962·|Δφ_seg| of the chord between its segment's ends, where Δφ_seg is that
  segment's roll change;
- plus the channel's own departure from that chord, which is of order |φ″|·segM²/8.

**MEASURED** on `test/core_adapter.test.js`'s sample track, at segM = 2 m and a peak bank rate of 0.31°/m: 1.02e-3 rad
(0.06°).

**Test:** `test/core_adapter.test.js` "the samples' roll is within the smoothstep bound of the φ channel".
