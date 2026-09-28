# track-equations · references

The mathematics the skill's method uses: read a track's true centreline from its mesh, fit it piecewise with B-splines
joined at G2, close it, check it. Each formula has a SOURCE and a KNOWN-ANSWER TEST.

**THE RULE: a formula is in these references only when a test exercises it.** The tests are in `../evals/`:
`known_answers.test.js` holds 28 checks against the reference implementations (`mathref.cjs`), and `mutation.test.js` shows
that a one-formula change is caught. A formula a packet needs that is not here is ADDED, with its source and a test, BEFORE
it is used.

**Run the evals** (one heavy job at a time, with `--max-old-space-size=4096`):
`node --test --test-concurrency=4 .claude/skills/track-equations/evals/known_answers.test.js .claude/skills/track-equations/evals/mutation.test.js`

| reference | covers |
|---|---|
| [01 centreline](01_centreline.md) | the true centreline by cross-rays against the road triangles (Möller–Trumbore); the traps |
| [02 curvature](02_curvature.md) | curvature from position; heading and pitch; rebuilding a line; clothoid and smoothstep ramps |
| [03 B-splines](03_bsplines.md) | the cubic basis (Cox–de Boor), the least-squares fit, adaptive knots; the term count |
| [04 joints and closure](04_joints_closure.md) | G0/G1/G2 joints and closure as equality constraints (KKT); the least-norm correction |
| [05 flight](05_flight.md) | the ballistic arc of a jump, and what the replays measured |
| [06 surfaces](06_surfaces.md) | Gaussian curvature, measured integrated or smoothed; T-180 corners measure ELLIPTIC; the particle on the surface |
| [07 Fourier](07_fourier.md) | Fourier on a loop (M1, M4), and why jumps and long laps break a single series |
| [08 what failed](08_what_failed.md) | tonight's failures and the rule each one left, so the skill does not repeat them |
| [10 sculpt and close](10_sculpt_close.md) | the core's brush (the quintic smootherstep falloff, knot averages on whole-support control points) and the one-click close (Gauss–Newton with the least-norm step) |
| [MATH_SOURCES](MATH_SOURCES.md) | the citation index: what each source is, and whether it was opened |

## Labels
- **SOURCED:** as the cited source gives it, with that source opened.
- **DERIVED:** our own step from sourced formulas, shown so it can be checked.
- **UNVERIFIED:** the source was not opened.
- **MEASURED:** a number from the repository's instruments, with its command and its FINDINGS section.

A "true of T-180 tracks" line is always MEASURED, or it is marked **UNMEASURED** and is not written as a fact.

## Cite, don't copy
The sources are cited and paraphrased. Only Wikipedia (CC BY-SA 4.0, attributed), raphlinus/spiro (Apache/MIT) and the
Clothoids docs (BSD-2) may be quoted, and no text of theirs is quoted here. No other author's track data appears here beyond
summary numbers.

## Conventions
- World up is +y, as in Assetto Corsa and `src/geom`.
- Heading θ is about world up, pitch p above the horizontal, so T = (cos p sin θ, sin p, cos p cos θ).
- Metres and radians.

**Dependencies: none.** Avoid CGAL, libspiro and libspiro-js (GPL), and numeric.js.
