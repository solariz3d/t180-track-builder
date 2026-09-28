# 03 · Cubic B-splines: the basis, the fit, the knots

Each open piece of track is fitted as a cubic B-spline in s: the position (x, y, z) and the bank.

**Why a B-spline and not Chebyshev or Fourier:** LOCAL SUPPORT. A tight corner adds knots only where it is, instead of
spreading its cost over the whole piece.

## §1 The basis (Cox–de Boor)
**SOURCED** (WIKI-BSPLINE; DEBOOR78 not opened).

**The recursion.** Take a non-decreasing knot vector t:
- B_{i,0}(x) = 1 if tᵢ ≤ x < tᵢ₊₁, and 0 otherwise.
- B_{i,k}(x) = (x − tᵢ)/(tᵢ₊ₖ − tᵢ) · B_{i,k−1}(x) + (tᵢ₊ₖ₊₁ − x)/(tᵢ₊ₖ₊₁ − tᵢ₊₁) · B_{i+1,k−1}(x).
- A term with a zero denominator is 0.

**Clamped cubic knots.** For [a, b], repeat a and b four times each, with interior knots between them. The number of basis
functions (control points) is the number of interior knots plus 4.

**The half-open trap.** The rule tᵢ ≤ x < tᵢ₊₁ makes every basis function 0 at x = b. So evaluate at b as a point just inside
it (`mathref` `inside()`), or the fit loses its last point.

**Test (03 §1):**
- partition of unity (Σ B = 1 on [a, b]);
- each cubic is zero outside its 4 spans.

**Mutant K10** (dropping the right-hand term) **is caught.**

## §2 The least-squares fit
**SOURCED** (WIKI-BSPLINE; VMLS ch. 12). Minimise Σ‖Σⱼ cⱼBⱼ(sₖ) − yₖ‖² over the control points c. Its normal equations are
AᵀA c = Aᵀy, with A_{kj} = Bⱼ(sₖ).
- In the reference implementation they are solved by Gaussian elimination with partial pivoting.
- On a long piece, prefer QR (VMLS ch. 12), since AᵀA squares the condition number. That is a note, not a tested claim.

**Test (03 §2):** a cubic polynomial is reproduced exactly. It lies in the cubic spline space, so the residual must be about 0.

**Mutant K12** (dropping Aᵀ on the right) **is caught** by 03 §2 and 04 §1.

## §3 Adaptive knots (the plan's method, step 3)
1. Start with a knot every 200 m.
2. Fit.
3. Insert a knot at the MIDPOINT of every span whose maximum deviation exceeds the tolerance.
4. Refit.
5. Repeat until every span is inside the tolerance, or until the cap of 500 control points per piece.
   - **Reaching the cap is REPORTED, never hidden.**

**The term count is the number of control points.**
- Compare it with M4 in DEGREES OF FREEDOM: numbers stored.
- A B-spline piece stores 3 × (control points) for the position, plus the bank's.
- M4 stores 2N + 1 per function.
- That is the plan's trap (d). Counting "terms" on both sides is apples to oranges.

**Test (03 §3):** refinement adds a midpoint knot only where the error exceeds the tolerance, and nowhere else.

**Mutant K11** (refining every span) **is caught.**

## Not on the shelf
These are all UNTESTED here, so they are not to be quoted as formulas until they are tested:
- de Boor's evaluation algorithm;
- knot insertion by Boehm's rule;
- derivative control points.

`mathref.evalBspline` evaluates by the basis directly.
