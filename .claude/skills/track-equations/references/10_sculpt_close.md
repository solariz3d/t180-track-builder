# 10 · Sculpt and close on the core's channels (D185, pane E)

The core's document holds each piece as cubic B-splines in its own arc length s: heading rate, pitch rate, bank, width,
rise (the spec's GO §1). A brush edits ONE channel locally; the close edits channel control points so the lap meets itself.

## §1 The falloff: the quintic smootherstep
**SOURCED** (WIKI-SMOOTHSTEP, §"Variations", opened: Ken Perlin's improved version).

  **S₂(x) = 6x⁵ − 15x⁴ + 10x³ on [0, 1]; 0 below, 1 above.** Its 1st and 2nd derivatives are zero at x = 0 and x = 1.

The brush's weight at distance d from its centre s₀, with radius r, is **f(d) = 1 − S₂(d / r)**:
- 1 at the centre and 0 at the window's edges and beyond, with zero slope and zero curvature where it meets 0;
- C2 at the centre too: near d = 0, 1 − f = 10|d/r|³ + …, whose 1st and 2nd derivatives vanish at 0.

**Known answers (`evals/10_known_answers.test.js`):**
- S₂(0) = 0, S₂(½) = ½, S₂(1) = 1;
- S₂′ = 30x²(1 − x)² is 0 at both ends and 15/8 at ½;
- S₂″ = 60x(1 − x)(1 − 2x) is 0 at both ends.

Not the builder's cubic smoothstep (02 §4, S(t) = 3t² − 2t³): that one is only C1 at its ends (S″ = ±6), so a falloff built
from it would leave a curvature step at the brush edge.

## §2 The brush acts only where the curve can change: local support
**SOURCED:** the local support of a B-spline (03 §1, tested there: "each cubic is zero outside its 4 spans"; WIKI-BSPLINE
§"Definition": Bᵢ,ₚ is non-zero only on tᵢ ≤ t < tᵢ₊ₚ₊₁).

- A control point cᵢ of a cubic reaches the curve only on its support [tᵢ, tᵢ₊₄].
- **The rule (E's, a rule and not a formula):** the brush changes cᵢ only when its WHOLE support lies inside the window
  [s₀ − r, s₀ + r]. Then every evaluation outside the window uses only untouched control points and the same knots, so it
  is the same floating-point computation, and bit for bit the same number.
- Each changed cᵢ gets Δ · f(|τ*ᵢ − s₀|), with τ*ᵢ = (tᵢ₊₁ + tᵢ₊₂ + tᵢ₊₃)/3 its KNOT AVERAGE.
  **SOURCED** (LYCHE-MORKEN §5.4, Definition 5.25, eq. (5.30), p. 116, opened): the Variation Diminishing Spline
  Approximation (Vg)(x) = Σⱼ g(τ*ⱼ) Bⱼ,d(x) with τ*ⱼ = (τⱼ₊₁ + … + τⱼ₊d)/d. "We simply evaluate f at certain points and use
  these function values as B-spline coefficients directly." With clamped knots τ*₁ = a and τ*ₙ = b (eq. (5.31)), so the end
  coefficient of every piece gets exactly Δ f at the piece's end, and two pieces meeting at a joint get the same change there:
  the channel stays continuous across joints.
- The edit to the channel is therefore the variation-diminishing approximation of the bump, restricted to the whole-support
  control points: a cubic B-spline on the same knots, so it is C2 wherever the knots are simple (03 §1). There is no new
  kink anywhere, including at the window's edges.
- **Known answer** (`evals/10_known_answers.test.js`): V reproduces a straight line exactly, Σⱼ (α + βτ*ⱼ) Bⱼ(x) = α + βx on
  non-uniform clamped knots (to 1e-12); and V of the bump agrees with the bump to within the knot spacing's square.
- **The smallest brush (E's rule, not a formula).** A window narrower than 4 knot spans holds no whole support and could change
  nothing, so a brush narrower than 3 spans is WIDENED to 3 spans, and says so. The change then stays inside the asked window
  widened by 2 spans on each side whenever r ≥ one span. A finer brush needs finer knots under it (knot insertion, Boehm's rule,
  is not on the shelf: 03).
- **Joints (the document's rule, src/core/README.md: C1 in every channel).** At a road-road joint inside the window, the next
  piece's first coefficient is set to the previous piece's last, and its second from the previous end slope, as the document
  builds a piece. A joint the window covers only in part is left untouched (all four coefficients).

## §3 The close: Gauss–Newton with the least-norm step
**SOURCED:** the least-norm step, 04 §3 (VMLS §16.1.1), δ = −W⁻¹Jᵀ(JW⁻¹Jᵀ)⁻¹ r, iterated ("Newton steps of it close a
nonlinear loop"). WIKI-GN §"Description" gives Gauss–Newton for m ≥ n. The close has FEWER residuals than control points,
which is the underdetermined case. The step there is the least-norm one of 04 §3, and that is how it is used here (the
04 §3 test "a perturbed loop starts open and closes").

**The residual** (the spec's GO §4, and 04 §4's list):
- position: p(L) − p(0), 3 rows, measured on the ADAPTER's path (src/core/adapter.js), the geometry the app draws;
- heading: ∫κh ds − 2πk, pitch: ∫κv ds, on the adapter's segment rule (rates linear over each segment); bank:
  φ(L) − φ(0) − 2πm. Linear in the control points;
- the seam is a joint like any other: every channel's value (bank mod 2π) and slope at L equal those at 0, so the seam is C1 in
  every channel and G2 in the line. Linear.

**The weight** W: a control point in the stretch edited last gets weight w_edit ≫ 1, so the step avoids it (the user's work
is not moved). Every other control point gets 1.

**J:** the linear rows exactly. The position rows come from the rebuild, DERIVED here:
- p(L) = ∫₀ᴸ T(θ(s), p(s)) ds with θ′ = κh, p′ = κv (02 §2);
- so ∂p(L)/∂cⱼ = ∫₀ᴸ ∂T/∂θ · Iⱼ(s) ds for a heading control point, with Iⱼ(s) = ∫₀ˢ Bⱼ, and the same with ∂T/∂p for pitch.
- This is computed in `src/core/close.js` by reverse accumulation over the 02 §2 midpoint rebuild (1 m steps). It is only the
  Jacobian's MODEL: the residual is the adapter's. Checked against a finite difference of the adapter in
  `test/core_close.test.js`: relative error ≤ 1.2e-4 measured, 5e-4 asserted (dropping the half-step term gives ≥ 9.6e-4).
- A joint's first two coefficients on the next piece are not free parameters: c₀ is the previous piece's last, and
  c₁ = c₀ + (h_b/h_a)(c_{n−1} − c_{n−2}) (the README's end-slope rule), so they follow the columns they depend on.
