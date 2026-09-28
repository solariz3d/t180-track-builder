# 08 · What failed tonight (2026-09-28), and the rule each failure leaves

Each entry is recorded where it was scored. They are here so the skill does not repeat them.

## 1. "T-180 corners are hyperbolic": FAILED, twice
**What was claimed.** The design notes said: "K < 0 (hyperbolic, saddle): a half-pipe or bowl sweeping through a turn".

**What was measured:**
- **M3, per vertex:** FAILS on Centrifuge, with 18.0% K < 0 area in corners against 21.0% on straights (FINDINGS §7i).
- **M3b, smoothed:** corners carry LESS K̄ < 0 than straights on BOTH tracks, and more K̄ > 0 (FINDINGS §7j). They are
  elliptic ([06](06_surfaces.md) §6 derives why).

**The pane's own picture was also wrong.** It had inferred that a dished road turning about a vertical axis is "the inside of
a torus tube, inner half K < 0". Smoothed, the inner-half share was 43.5% and 10.0% against a 60% bar. Both the design's
claim and the pane's picture came from a PICTURE.

**The rule:** a claim about a surface's shape needs the measurement, and the measurement needs smoothing. Never read the sign
of K at one vertex.

## 2. Per-vertex curvature read as the surface's value
- The torus known-answer check, per vertex, was 8.7% off on a near-square grid.
- It was first blamed on the grid. That was wrong: the triangulation biases the SHARING of the defect ([06](06_surfaces.md) §5).
- On the real meshes, 5.9–31.6% "K < 0" on straights is triangulation texture, not road.

**The rule:** K is an integral (exact by Gauss–Bonnet), or it is smoothed; it is never a vertex's value.

## 3. M2's coupling was named after the run
- M2 (geodesic share against load) PASSED, ρ −0.50. But the load contains v²κn, and so does the share.
- So they are partly the SAME fact seen twice. This was noticed only after scoring (FINDINGS §7i). M2b re-registered against
  speed, which is not inside the share, and PASSED (§7j).

**The rule:** before a correlation is registered, check that the two variables are not built from a common term.

## 4. M4's long laps: fitting the walk and integrating heading
- Rainbow never converged: 73.6% at the exact fit, with 282 reader glitches.
- Sakura needed 2,000 terms and Centrifuge 4,000 (`p-m4-equations-E` §2).

**The keeper's correction (plan addendum):** the idea was fine; the METHOD failed. It fitted a smoothed, glitchy walk, not the
mesh, and it rebuilt by integrating heading, where 0.25 mrad over 20 km is 5 m.

**The rule:**
- fit POSITION from the mesh ([01](01_centreline.md));
- split at jumps and long straights;
- join by constraints ([04](04_joints_closure.md));
- never close by integrating rates.

## 5. A check that "caught" everything was measuring nothing
- The first mutation run of the parked math shelf reported every mutant caught. But two checks FAILED on the unmutated code,
  so they "caught" every mutant.
- **The rule:** mutation results are valid only with a CONTROL. A mutant counts as caught only by checks that pass on the
  original (`evals/mutation.test.js`).
- The same shelf had a wrong null-space vector in its TEST data, [−1, 1, 0, 1]. It was verifiably wrong and was replaced with
  [3, −1, 0, 1]. Test data can be wrong too; the control is what shows it.

## 6. Figures from the wrong car
- The installed `mach6_active` is not the GitHub base car. Its springs are 15,000 N/m front and 100,000 N/m rear, against
  80,000/80,000, and its downforce ray is different.
- The "~20 g" figure was REGISTERED from the GitHub car's springs. It was MEASURED on replays driven with a third car,
  `ohyeah2389_t180_mach6`, whose springs were not read.
- So it says nothing about where `mach6_active` runs out (FINDINGS §4d).
- **The rule:** read the INSTALLED files, not the repository, before quoting a car's number.

## 7. Claims the research agents corrected before they reached the shelf
Each of these was checked against the primary source, or dropped:
- The heading and pitch rates fix a line only up to translation and rotation about the vertical.
- 3-D closure needs p(L) = p(0) as well as the rates' conditions.
- Crane's condition is orthogonality to {1, x, y}, not to "the frame".
- Meyer's area is the MIXED Voronoi area.
- The mesh-noise claim is Borrelli's, not Surazhsky's.
- A jerk limit of "0.5 m/s³" was unsupported and was dropped.
