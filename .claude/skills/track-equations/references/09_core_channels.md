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

## §6 Knot insertion (Boehm): finer knots under a brush, with the curve unchanged
**SOURCED** (SHENE-KNOT, opened 2026-09-28: C.-K. Shene's course notes, CS3621 Michigan Tech, "B-spline/NURBS Curves: Knot
Insertion", pages.mtu.edu/~shene/COURSES/cs3621/NOTES/spline/NURBS-knot-insert.html). The primary source is W. Boehm,
"Inserting new knots into B-spline curves", *Computer-Aided Design* 12(4), 1980 (BOEHM80, not opened).

Insert a knot t into [u_k, u_{k+1}) of a degree-p spline with control points p₀ … p_{n−1}. The new points q₀ … qₙ are:
- qᵢ = pᵢ for i ≤ k − p;
- qᵢ = (1 − aᵢ)·p_{i−1} + aᵢ·pᵢ, with aᵢ = (t − uᵢ)/(u_{i+p} − uᵢ), for k − p + 1 ≤ i ≤ k;
- qᵢ = p_{i−1} for i ≥ k + 1.

The notes: "The shape of the curve does not change; however, the defining control polyline is changed."

**DERIVED, what it means for the core (p = 3):**
- only the three points q_{k−2}, q_{k−1}, q_k are new, and every other one is an old one;
- the curve on a span uses the four points below it, so only the new knot's span and the TWO spans on either side of it see
  a new point (in the old knots, [u_{k−2}, u_{k+3}]);
- every other span keeps the same knots and the same four points, and is evaluated by the same arithmetic: bit for bit.

**In the document the new points are quantised** to the channel's step (src/core/README.md), because canonical text is
quantised. So the stored curve moves by at most half a step within the three affected spans (partition of unity, ref 03 §1).
Before quantisation the change is float rounding only.

**Test:** `test/core_knots.test.js` "inserting knots leaves every channel unchanged at dense samples".

## §7 The offset channels (a hill, a swerve): the lifted centreline, its frame and its curvature, EXACT
The base geometry gives, at each sample (s its arc length): position r, unit tangent T, the curvature vector K = dT/ds
(src/geom's `kvec`), the heading θ with its rate θ′ = k and its derivative θ″ = k′ (the segment's linear yaw rate, ref 02 §2),
and the roll φ. The offsets h(s) (along world up ŷ) and l(s) (along the gravity frame's horizontal left
R = (cos θ, 0, −sin θ)) come from the channels with their first two derivatives (ref 09 §1, WIKI-BSPLINE).

**DERIVED** (differentiate twice; ∂R/∂θ = R_θ = (−sin θ, 0, −cos θ), ∂²R/∂θ² = −R):
- r̃ = r + h·ŷ + l·R;
- r̃′ = T + h′ŷ + l′R + l·R′, where R′ = θ′R_θ;
- r̃″ = K + h″ŷ + l″R + 2l′R′ + l·R″, where R″ = θ″R_θ − θ′²R.

**The tangent and the curvature vector of the lifted curve,** per metre of the LIFTED road (s is no longer its arc length):
- T̃ = r̃′/|r̃′|;
- K̃ = (r̃″ − (r̃″·T̃)T̃)/|r̃′|².
- This is the vector form of WIKI-CURV's κ = |r′ × r″|/|r′|³ (ref 02 §1). DERIVED: its magnitude is exactly that, since
  |r″ − (r″·T̃)T̃| = |r′ × r″|/|r′|.

**The frame is rebuilt from T̃ the geometry's way, with the SAME roll φ** (src/geom/path.js FRAME; lifting the road does not
tilt it about its tangent):
- R̃ from θ̃ = atan2(T̃ₓ, T̃_z), and U₀ = T̃ × R̃;
- L = R̃cos φ + U₀sin φ, and U = T̃ × L;
- bankG = asin(L_y), and grade = T̃_y/|T̃_xz|.

**The known answer the hill test uses:** on a LEVEL STRAIGHT base, K = 0 and θ′ = θ″ = 0, so the lifted road is the plane
graph y = h(s):
- grade = h′;
- |K̃| = |h″|/(1 + h′²)^{3/2}. That is WIKI-CURV's plane formula, on the shelf as ref 02 §1.

**Where h = h′ = h″ = l = l′ = l″ = 0,** the sample is not recomputed at all: the SAME object. So everything outside a hill is
bit for bit.

**Tests:** `test/core_offset.test.js`.

## §8 The readout: a piece's length, turn, climb, bank and pitch, from its channels
**The integrals are EXACT by Gauss–Legendre.** On each knot span a channel is one cubic polynomial (ref 03 §1). An n-point
Gauss–Legendre rule "is … constructed to yield an exact result for polynomials of degree 2n − 1 or less" (WIKI-GAUSS, opened
2026-09-28, "Gaussian quadrature"). So the 3-point rule on each span integrates a channel exactly, up to float rounding:
- nodes 0 and ±√(3/5), weights 8/9 and 5/9 on [−1, 1];
- the change of interval ∫ₐᵇ f = (b − a)/2 · Σ wᵢ f((b − a)/2·ξᵢ + (a + b)/2).

**The quantities** (DERIVED from ref 02 §2: θ′ = κh, p′ = κv, and the roll is φ):
- turn = ∫₀ᴸ κh ds, the heading change about world up (+ left);
- climb = ∫₀ᴸ κv ds, the pitch change (+ nosing up);
- bank from = φ(0) and bank to = φ(L);
- pitch from = the document's start pitch plus every earlier road piece's climb, with a flight setting it to its landing
  pitch; pitch to = pitch from + climb.

**The known answers the tests use:**
- a constant κ turns κ·L;
- a Bloss ramp 0 → T, where κ = T·S(s/L) and S(u) = 3u² − 2u³ (ref 02 §4), turns T·L·∫₀¹S = T·L·(1 − ½) = **T·L/2**;
- a flat piece climbs 0.

**The geometry the adapter draws is a close neighbour, not identical.** The adapter hands src/geom segments whose κ is linear
between 2 m ends (ref 09 §5), so its heading and pitch integrate the channel by the TRAPEZOID rule. They differ from the exact
integral by O(segM²·κ″). That difference is measured in `test/core_readout.test.js`, not assumed.

**With offsets h and l (ref 09 §7): the effective ends.**
- The lifted tangent at a piece's end is T̃ ∝ T + h′ŷ + l′R + l·θ′R_θ (ref 09 §7).
- The EFFECTIVE turn is turn + (θ̃ − θ) at the end − (θ̃ − θ) at the start. The effective climb is p̃(end) − p̃(start), with
  θ̃ = atan2(T̃ₓ, T̃_z) and p̃ = asin T̃_y.
- **A hill that fades to zero slope inside the piece changes neither.** It moves the road in between, not the ends.
- **Bank is not changed by h or l:** the lift keeps the roll (ref 09 §7).
- **Length:** s stays the base length. The ROAD over a hill is longer: ∫|r̃′| ds.
- **DERIVED:** using T·R = 0, T·R_θ = −cos p and ŷ·R = ŷ·R_θ = R·R_θ = 0,
  |r̃′|² = 1 + h′² + l′² + (l·θ′)² + 2h′·sin p − 2l·θ′·cos p.
  It is integrated by composite 5-point Gauss–Legendre over 1 m panels. That is not exact, since |r̃′| is not polynomial;
  the test measures it against the lifted path's chords.

**Test:** `test/core_readout.test.js`.

## §9 The cup channel c: the cross-section's edge angle (D190)

**The channel.** c(s), in DEGREES, is the angle ψ the road's surface has turned by, measured from the flat floor, at both edges u = ±w/2 (src/geom/profile.js: ψ(u) is the turning angle of the surface by its own arc length u). It is a clamped cubic B-spline in the piece's own s, like every channel, so its joints are C1 (§1) and it blends with the Bloss blend (§2). It is independent of bank φ: the profile is cupped first and then rolled by φ, so the road's centreline, its bank and its pitch do not depend on c (§3's cross-section is the only thing that does).

**The shape rule (a normalisation of MEASURED numbers, not a derived law).** The family's measured floors F = FLOORS[family] (src/geom/fonts.js: bowl [2.7, 8.6, 15.5, 15.5], half-pipe [5.6, 10.8, 14.1, 30.6], flat [0.7, 1.5, 2.3, 3.0] degrees, at AT = [¼, ½, ¾, 1] of the half-width) say where along the half-width the surface rises. A cup piece keeps that character and lets c set the depth: ψ at AT_i is c·F_i / F_edge, on both sides, linear in u between the four quarters, ψ(0) = 0. The edge (i = 4) is therefore exactly c. It is monotone for c ≥ 0 because every FLOORS row is non-decreasing (tested). Source: the FLOORS table and the D190 seal (V3); the rate cap of §3 does NOT apply to a cup piece.

**Legacy pieces are not migrated.** The old rule of §3 caps each quarter's rise at r·w/8, so where the cap binds the SHAPE changes, not only the edge (worst measured quarter difference 4.458° for a 12 m half-pipe, the D190 seal V1). A piece read from a /2 file therefore keeps rendering by §3, unchanged, and is a cup piece only when a cup is set on it. The edge angle a legacy piece renders is the sum of its four quarters' rises, legacyEdgeDeg(family, w, r) = Σᵢ min(Fᵢ − Fᵢ₋₁, r·w/8) (F₀ = 0), and that is what the readout shows for it and where a cup that follows it starts.

**The range [0, 150].** The two walls of a cup meet where the section's lateral extent X(w/2) = 0. Because the whole profile scales with w this angle depends on the family only (measured by the seal, bisection on X): bowl 159.681°, half-pipe 286.48°, flat 180.000°. The bowl is the tightest, since its last quarter is a flat plank. 150° leaves 9.68° to the bowl's touch. A cup outside [0, 150] is refused by name (BAD_CUP). By 03 §1b the curve lies in [min, max] of its control points, so checking the control points binds the curve.

**The fit rings.** The least-squares fit of §2 to a Bloss blend that is flat after its transition overshoots the target, and a control point can pass it by more than the curve does (seal V5: 174.65° for a 150° target over 10 m; measured on the core's own Extend: a 90° target over 40 m of a 200 m piece gives control points up to 99.130° and a curve that peaks at 92.122° before settling at 89.978°). So the Extend that builds a cup piece clamps its control points to [0, 150] after the fit, and the readout reports the DOCUMENT's c, not the typed target. A clamp can leave the curve short of a target at the top of the range: 150° over 20 m of a 60 m piece ends at 144.499° (measured), where the same target over 40 m of a 100 m piece ends at 150.000°.

**Linear in c at a fixed width (used by the adapter).** ψ at each quarter is c times a constant, so two cup profiles A (at c_A) and B (at c_B) of the same width and family satisfy: the blend (1 − x)·ψ_A + x·ψ_B, at matched fractions of the half-width, IS the cup profile at c = (1 − x)c_A + x c_B. src/geom/mesh.js blends a segment's profile from a "from" profile to its own with weight smoothstep((s0 + d)/length) at distance d into the segment, so a segment whose c runs from c₁ to c₂ is reproduced at both ends by a blend from the cup profile at c₁ to the one at c₂ (s0 = 0, length = Δ, the segment's length: the DEFAULT, which keeps segment.profile local). The same mixture can share one pair (A, B) across a run of segments, choosing s0 and length with smoothstep((s0)/length) = x₁ and smoothstep((s0 + Δ)/length) = x₂, where x = (c − c_lo)/(c_hi − c_lo): the DEFAULT (cupRuns: true). It is exact wherever c is itself a smoothstep, since z = unsmooth(x) is then linear in s and the mesh's weight S(z) = x at every row, not only at the ends; for a general c(s) the weight is exact at each segment's ends and follows a piece of S between them (a small ripple). A per-segment pair from the profile at the segment's start to the one at its end (cupRuns: false) matches the ends too, but S then runs 1.5× the mean rate mid-segment: up to 0.95° off c on a 150° ramp (B's score, D190 R1). **Inverting the weight (DERIVED):** S(z) = 3z² − 2z³ = y. Put z = ½ − sin φ: then S = ½ − ½·(3 sin φ − 4 sin³φ) = ½ − ½ sin 3φ (the triple-angle identity), so sin 3φ = 1 − 2y and z = ½ − sin(asin(1 − 2y)/3) for y in [0, 1]. The adapter polishes it with two Newton steps. A segment where c falls swaps the two profiles (from B, own A, weight 1 − x): the mesh's sample fractions (blendSamples) are symmetric in its two profiles, so every segment of a run has the same fractions and the boundary rows of two segments coincide (no seam zip).

**The legacy → cup morph (D190 R2).** ψ is linear in c, so the cup shape at c is c·f with f the vector of F_i/F_edge. A legacy profile at the same edge c₀ is ψ_L = c₀·f + d, with d the difference of the capped shape from the proportional one (zero at the edge, up to 148 mm of surface on a 24 m half-pipe). The cup piece starts from ψ_L and fades d: ψ(s) = c(s)·f + μ(s)·d with μ = 1 − smoothstep(s/L_m) over L_m = 10 m. At s = 0 that is the legacy piece's last profile exactly; the edge is c throughout (d has no edge component); past L_m it is the pure cup shape. Derived, no source: it is linear algebra on the two profiles and the smoothstep of §2.

**The cup → legacy lap seam (D190 round 3).** The mirror of the morph above, at the end of a closed lap: close() sets the cup's last value to the legacy start's rendered edge c₀ (so d has no edge component again), and the last L_m ≥ 10 m of the cup fade the difference d = ψ_T − c_end·f in by smoothstep, from μ = 0 at a segment boundary to μ = 1 at the end: the last row IS the legacy start's first row (ψ_T, the first segment's profile). Derived; linear algebra on the two profiles.

**The short ramp, and why it is not fitted (D194b, D195).** `extend` takes `transition` as a number (one ramp for every channel) or a map { w: 20, phi: 'start', … }; a channel with a short ramp R < the piece length reaches its target inside R and holds it. The Bloss blend (§2) has zero slope at both ends but its curvature jumps at u = 1; the least-squares fit of §2 (03 §2) follows that jump by ringing, MEASURED (`scratchpad/d195/probe1.js`, `probe2.js`): on w 31 → 12 over a 100 m piece (knots every 20 m) a 20 m ramp fits to 1.55 m off the ideal, overshoots the target by 1.05 m and puts control points 5.1 m outside [12, 31]; 10 m and 5 m ramps are worse (2.7 and 4.4 m off); extra knots shrink it (0.28 m past the target at 4 subdivisions of a 20 m ramp, 0.07 m at 8) but never remove it, and the fitted hold is not flat (still 0.35 m off at twice the ramp). So a short-ramp channel is not fitted: its control points are the ideal ramp read at the knot averages ξᵢ = (uᵢ₊₁ + uᵢ₊₂ + uᵢ₊₃)/3 (10 §2: the variation-diminishing approximation, LYCHE-MORKEN Def. 5.25, SOURCED), the two control points a joint fixes are left alone (so the joint is C1), and every other one is clamped into [start, target] (03 §1b: the curve lies in the hull of its control points, SOURCED). The piece carries 4 extra knots inside the ramp; the ideal ramp is compressed to R − 2R/4 = R/2 because the curve at s is fed by control points up to about half a ramp ahead, so the CURVE reaches its target by R and is exactly the target after (the control points from ξ ≥ R/2 are the target). 'start' is R = the first knot span of the piece, at most 20 m, or the whole piece when it is shorter (then it is the ordinary whole-piece blend). Monotone control points give a monotone curve (the derivative's coefficients are their differences over positive spans: derived, not sourced, sampled in the tests). The mesh side of a fast ramp was a staircase (a legacy piece drew each 2 m segment at its middle width: 4.8 m steps for a 20 m ramp of 19 m, a 0.26 m joint into it) and is fixed by D196's legacy chords (`src/core/adapter.js` `legacySeg`: the profile at the segment's end blended from its start, as the cup's chord segments; linear algebra on the two profiles and the mesh's smoothstep weight, ref 09 §9's chord). Measured before / after on the seal's fixtures: F4 row gap inside a piece 144.5 mm → 0.53 mm, width step 0.29 m → 0; F6 (r brushed) 191.8 mm → 0.55 mm and the joint 71.8 mm → 0.54 mm; F8 431.7 mm → 0.56 mm (its remaining 239 mm joint is the bowl → half-pipe family change, unchanged).

**Cup then roll (no new formula).** The drivable-side normal of a profile point is n = cos ψ·U − sign(u)·sin ψ·L (src/geom/profile.js) in the gravity-frame station frame that already includes the roll (src/geom/path.js). At φ = +30° (left side up) and c = 60° the left edge's surface is at 60° + 30° = 90° to gravity, the right edge's at 60° − 30° = 30°, the centre's at 30°, by that normal (D190 seal row 6; measured there by a probe).

## §10 The edge curve e, s, the tube t, and the spiral's heartline (D225, the cross-section lap)

Sealed by pane E (`exo_memory/loop/cross_section_seal_registration_2026-10-03.md`, V1-V8 and §4), built by A. Shelved BEFORE use, as the seal's §4 asks: each formula below is on the shelf only with its source and the test that holds it (`test/core_xsec_math.test.js`).

**The edge profile (V1, §1).** At a station with the middle profile ψ_mid(u) (the legacy `profileAt`, the cup, or a tube), half-width h = w/2 and slice s ∈ [0.5, 0.95], with t = (|u|/h − s)/(1 − s):

  ψ(u) = ψ_mid(u) + e·G(t) for t > 0, ψ(u) = ψ_mid(u) for t ≤ 0, G(t) = 3t² − 2t³, e in degrees, + on BOTH sides (profile.js: a wall rises whichever edge it is on).

- G is the smoothstep that is already on the shelf as the roll ramp (§2 above, ref 02 §4, IFC-BLOSS: the Bloss transition's S(u) = 3u² − 2u³). **DERIVED there and re-checked in the test:** G(0) = 0, G′(0) = 0, G(1) = 1, G′(1) = 0, G′(t) = 6t(1 − t) ≥ 0 on [0, 1] (monotone), G′(½) = 3/2 (the steepest slope). G′(0) = 0 makes the slice continuous in angle and in slope (no kink, no crease); G′(1) = 0 makes the band arrive at the edge at a held angle (a t² would end at its fastest turning, G′(1) = 2: a curl at the lip).
- **Linear in e at a fixed s** (DERIVED, tested to 1e-12 rad): ψ is e times a constant at each u, so the fraction-matched blend of two edge profiles at the same s, e₁ and e₂, IS the edge profile at (1 − x)e₁ + x e₂. The adapter shares one profile pair across a run where only e moves.
- **NOT linear in s** (DERIVED, with a known-answer test): G((|u|/h − s)/(1 − s)) is not linear in s, so a moving slice cannot share one blend pair. Measured by the seal (D_movingSlice), the fraction blend of two edge profiles against the exact profile between them is 0.036° (Δs 0.03, e 15), 0.324° (Δs 0.1), 5.06° (Δs 0.4). So a segment of a moving slice is a CHORD (its own end profile, blended from its start profile): the rows at its two ends are exact, and the middle is within 0.5° for the Δs a 2 m segment spans on a 40 m ramp (the test).
- **e = 0 is the identity.** x + 0·G = x exactly, but ψ_mid RE-EVALUATED at its own knots by interpolation is not bit for bit ψ_mid (seal KE3-2: 7 of 9 fixtures differ). So a piece that carries no edge returns the middle profile object UNTOUCHED, and a piece that carries one builds its profile from the middle's knots plus the slice knots.
- **The total edge angle** ψ_mid(edge) + e is bounded by CUP_MAX = 150° on a non-tube piece (the walls of a bowl touch at 159.681°, §9; the seal V2 measured that no (c, s) on the grid lets the walls meet below 150°). On control points it is a convex-hull bound (ref 03 §1b): c(s) + e(s) = Σ Nᵢ(cᵢ + eᵢ), the same basis.

**The tube (§1).** ψ(u) = (t/2)·|u|/h, t in [0, 360]: constant dψ/du = t/(2h) per side, i.e. constant curvature 1/R with R = w/(t·π/180) (the plane form of WIKI-CURV, ref 02 §1: a circle is the curve of constant curvature; the turning angle of an arc of length ℓ is ℓ/R). **DERIVED from profile.js's closed form X = ∫cos ψ du, Y = ∫sin ψ du:** the section is a circular arc; at t = 360 the two edge points meet (X(h) = 0, the gap ≤ 1e-14 m) and the section is a cylinder of circumference w, R = w/2π, with its far point at Y = 2R. The gap between the two tips of an open tube is 2R·sin(t/2) = 2(w/t)·sin(t/2) (t in radians); the tube is HELD refused where it is under the downforce ray's 1.0 m reach (MACH6.downforceRay.aheadM): t₁ₘ(w) is the root of that gap = 1.0 in (π, 2π), found by bisection (`tubeSlotMinDeg`): w 31 → 348.7°, w 12 → 332.1° (the seal's checked values).

**The heartline of a closed tube (V6).** The integrated curve is the heartline; the road's centre is the heartline minus heartline·U (path.js). Rolling a tube about its AXIS (heartline = R = w/2π) keeps the tube straight and puts the floor centre on a helix of radius R round the axis: a = R, b = 1/ω for a roll rate ω = φ′, so the floor centre's curvature is the helix curvature a/(a² + b²) = R·ω²/(1 + R²ω²) (ref 02 §1, on the shelf and tested; here the form with b = 1/ω, DERIVED). The heartline must be CONTINUOUS along the road (a step of ΔR moves the road by ΔR: a 0 → R step moves it 4.46 m on w 31), and the roll must be C1 across segments, because path.js's per-segment smoothstep roll has zero roll RATE at every joint, which throws a floor at radius R sideways every segment (measured by the seal: 0.417/m against the helix's 0.0048/m at 2 m segments). The adapter therefore gives every segment of a tube piece a heartline that runs LINEARLY over the segment between the values at its two ends, R(s) = (w/2π)·smoothstep((t − 300°)/60°): 0 for any sweep a cup can take over from (t ≤ 300° = 2·CUP_MAX, an edge of 150°), so a joint to a cup or a plain piece has heartline 0 and steps nothing, and R once the tube is closed; and a cubic Hermite roll through the channel's own value and slope at both ends (a Hermite cubic reproduces the channel to O(L⁴)). A segment with no heartline keeps the smoothstep and is unchanged. The road centre's curvature vector is then taken from the road-centre polyline (three-point, uneven spacing), because the integrated curve's is the straight axis's (0), and the validator would read the spiral's floor at 1 g.

**The roll rate (V7, S3)** is geometric: the angle between the surface normal U at s − 10 m and at s + 10 m, both projected onto the plane normal to T(s), divided by 20 m (°/m, a 20 m chord). The bar is a MEASURED number, not a formula: RED above 1.2144°/m (the whole Centrifuge lap's maximum), AMBER above 0.9338°/m (its inverted words' maximum). It lives in FINDINGS with its command (`rollprobe.js`) and the read's sha256 (`1fae0ae1…`), not here; the validator holds it as the constants ROLL_RED_DEG_M and ROLL_AMBER_DEG_M.
