# 04 · Joints and closure as constraints (KKT), and the least-norm correction

## §1 Least squares
**SOURCED** (VMLS ch. 12, opened). This is the unconstrained core of every fit.

**Test (04 §1):** an exact line is recovered from its samples.

**Mutant K12 is caught.**

## §2 Equality-constrained least squares (the KKT system)
**SOURCED** (VMLS §16.1, eq. (16.4), opened).

**The problem.** Minimise ‖Ax − b‖² subject to Cx = d. Solve

  [ 2AᵀA  Cᵀ ] [x]   [2Aᵀb]
  [  C    0  ] [z] = [ d  ]

for x and the multipliers z. VMLS gives the condition for a unique solution: C has independent rows, and [A; C] has
independent columns.

**How the skill uses it:**
- **G2 joints.** The rows of C say that piece k's end and piece k+1's start agree in position, first derivative and second
  derivative in s, each evaluated from the basis at the joint.
  - This is DERIVED: G2 for curves parametrised by arc length is equality of γ, γ′ and γ″.
  - On a spline in the fitted s, which is only close to arc length, C¹ and C² equality is SUFFICIENT for G1 and G2, not
    necessary.
  - The plan puts joints at straights (|κ| < 1/1500 m for ≥ 200 m), where κ is about 0, so G2 costs almost nothing there.
- **Closure.** The last road piece's end equals the first piece's start (G2), inside the same system. So position closure is
  exact by construction.
- **A jump joint carries NO position constraint.** It is checked by the flight instead ([05](05_flight.md)).

**Tests (04 §2):**
- two cubic pieces, fitted to data, meet at their joint in value, slope AND curvature, as constrained;
- a cubic constrained to end where it starts, with the same slope, does.

**Mutant K13** (ignoring the constraint rows) **is caught by both.**

## §3 The least-norm correction (after-the-fact closure, as in M4)
**SOURCED** (VMLS §16.1.1, eq. (16.2), opened).

**The correction.** The smallest weighted step δ that zeroes a linearised residual r, with J δ = −r, is

  **δ = −W⁻¹Jᵀ (J W⁻¹ Jᵀ)⁻¹ r**

It is orthogonal (in W) to J's null space, and no feasible step is cheaper in ‖δ‖_W. Newton steps of it close a nonlinear
loop.

**Tests (04 §3):**
- J δ = −r; δ is orthogonal to the null space; weighted, it is no dearer than any other feasible step (a null-space vector
  is added to test it);
- a perturbed loop starts open and closes to < 1e-9·L.

**Mutants K14** (sign), **K15** (no weights) **and K16** (no correction applied) **are caught.**

**E's version on the Fourier path:**
- It closes with harmonics 1 … |heading turns| + 3, since the 1st and 2nd harmonics barely move a lap that winds n times.
  - Closing Centrifuge (10 turns) with 1–2 harmonics bent its line by 84 m; with 1–13, by 21.6 m.
  - Source: `p-m4-equations-E` §1b row 5.
- **Test:** `test/fourier.test.js`, "the closure projection closes a lap made from its series to within 1 mm".

## §4 What closure needs in 3-D
Stated, and tested only in its position part:
- **Position:** p(L) = p(0). The 04 §2 closure check, and 04 §3.
- **Tangent:** T(L) = T(0), i.e. G1, the slope row in 04 §2.
- **Heading:** a closed planar lap turns through 2πn. The 02 §2 circle turns 2π.
- **A closed curve's natural frame need not close.**
  - WANG08 §6.3, primary: "In general, the RMF of a closed smooth spine curve does not form a closed moving frame."
  - So the roll/bank must be closed explicitly. It is not implied by the position closing.
  - NOT tested here.
- **Crane's condition** (CRANE13, Appendix A, primary): for a PLANAR curve edited through its curvature, a change κ̇ keeps it
  closed when ∫κ̇ = 0 and κ̇ is L²-orthogonal to f_x and f_y.
  - It is cited for fairing by curvature. The skill closes by position, so this is context, NOT on the tested shelf.
  - A rates-only fit fixes the line only up to translation and rotation about the vertical. That is why the skill anchors by
    position.
