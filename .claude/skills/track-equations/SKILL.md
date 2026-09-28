---
name: track-equations
description: Read an Assetto Corsa T-180 track's road mesh, fit its equation (the centreline as piecewise curves, plus bank and cross-section), rebuild it through this repo's own geometry core, and check the rebuild against the original, reporting how many terms it takes at each tolerance. Use when asked to reverse-engineer, fit, recreate or measure "the equation of a track", to find how long a track's equation is, or to rebuild a track from its equation.
---

# Track equations: read, fit, rebuild, CHECK

This is the method. It is run with this repo's tested tools and the skill's `scripts/`, and every formula comes from
`references/`. Work from the repo root.

## Two hard rules
1. **Never skip the check (step 8).** A fit that has not been rebuilt and compared with the original track is not a result.
   Report it as unchecked, or not at all.
2. **Never quote a formula that is not in `references/`.** The index is [references/MATH_SOURCES.md](references/MATH_SOURCES.md).
   If a step needs a formula that is not there, stop and say so. Do not derive one on the spot.

## Privacy: real tracks' equations stay LOCAL
An equation that rebuilds a track within 5 m **is** that track's layout, and the layouts are other authors' work.
- Reads, equations and coefficient files live only in `reads/`, which is gitignored.
- Never commit, paste, upload or print them: no coefficients, no curve points, no layout.
- Report summary numbers only: N, the errors, the percentages.
- Before any commit, `git status --short` must show nothing under `reads/`, and `git check-ignore reads/x` must name
  `.gitignore`.

## Running
- Node only; no new dependencies.
- Run heavy jobs one at a time on the machine, each as `node --max-old-space-size=4096 …`. A fit of a long lap can take
  minutes.
- Nothing here launches Assetto Corsa or opens a window.

## The method
The scripts are in [scripts/](scripts/) (S = `.claude/skills/track-equations/scripts`); each one's header gives its usage.
**If a step has no script, stop at that step and report it missing.** Do not improvise it.

| step | run |
|---|---|
| 1 read | `node --max-old-space-size=4096 S/read.cjs "<AC folder>/content/tracks/<folder>" <name> [length m] [width m] [layout]` |
| 2–6, 8–9 the method | `node --max-old-space-size=4096 S/fit-pieces.cjs "<AC folder>/content/tracks/<folder>" reads/<name>.read.json [--layout L] [--tol 5] --curve` |
| the baseline (below) | `node --max-old-space-size=4096 S/fit-fourier.cjs reads/<name>.read.json` |

1. **Read the track** with `read.cjs`.
   - It runs the repo's reader (`tools/read_track.cjs`) with `READ_PROFILE=1`, so the read carries the cross-section fields
     the fits use.
   - It writes `reads/<name>.read.json`, making `reads/` if it is missing, and refuses any place git does not ignore.
   - Do not call `read_track.cjs` directly: its raw output lacks the profile.
   - `<name>` is letters, digits, `_` and `-`. Name a layout `<folder>__<layout>`, e.g. `thunderhead_raceway__normal`.
   - The length and width are hints (0 = none). `[layout]` is needed when a folder has several layouts: its
     `models_<layout>.ini`.
   - If the read is already in `reads/`, use it. If you cannot find the AC folder, ask the user where Assetto Corsa is
     installed.
2. **Take the centreline POSITION from the mesh:** the midpoint of the exact left and right road-edge hits of a
   cross-ray at each station.
   - Not the reader's smoothed walk, and not a line integrated from heading: integration drifts.
   - A station whose width jumps by more than 20% from its neighbours is flagged, excluded from the fit and listed.
   - A station whose cross-ray hits no road is a jump gap.
   - Where roads cross, the ray takes the road nearest the previous station, never the first hit ([references/01 §2](references/01_centreline.md)).
   - On twisted or inverted road, cast in the road's own frame, not world-up.
3. **Split** at jumps, where the road gives way to a gap. On a long lap, also split at the midpoint of each straight
   (|κ| < 1/1500 m⁻¹ for ≥ 200 m). A piece never starts inside a corner.
4. **Fit each piece**: position (x, y, z) and bank as functions of s, in an open basis (a cubic B-spline with adaptive
   knots), refined until the piece is inside the tolerance or a per-piece cap is hit. A cap that is hit is reported.
5. **Join the pieces with G2**: position, tangent and curvature agree at every road joint. A jump joint is the flight
   instead: a ballistic arc from take-off to landing, reported as a check.
6. **Close the lap** exactly, inside the same constrained fit.
7. **Evaluate the fitted curves themselves.**
   - The pieces ARE curves in space, so the method evaluates them directly. It does not go through the builder's `buildPath`,
     which is a heading/pitch model.
   - Only the Fourier baseline below rebuilds through `buildPath` (`src/geom`).
8. **CHECK against the original.** A track passes when, on the stations the fit did not exclude:
   - the fitted line is within **5 m** of the MESH centreline (step 2) on **≥ 95%**, **and**
   - the bank is within **5°** on **≥ 95%**.
   - The baseline checks the same bar against the reader's line instead. Say which one you checked.
9. **Report N versus tolerance**, never one number:
   - pieces (road, jumps), and control points per piece and in total;
   - line error p95, max, and % within 5 m; bank error p95 and % within 5°;
   - the control points needed at 10, 5, 2 and 1 m (`--curve`);
   - every flagged station, and the hold-out score it prints.

**Which N is which.** Report both, labelled.
- **The method's N is its CONTROL POINTS**, the piecewise fit's.
- **The baseline's N is Fourier harmonics per function.**
- They count different things, so compare them only in **degrees of freedom** (numbers stored). The Fourier baseline stores
  3(2N + 1); `fit-pieces.cjs` prints its own DOF. See [references/03](references/03_bsplines.md).

## The baseline that already works (Fourier, one closed series per function)
Before the piecewise fit, the method was one periodic Fourier series per function over the whole lap (heading rate,
pitch rate, roll), rebuilt through `buildPath` after a closure projection, and scored by the same step-8 check:

    node --max-old-space-size=4096 .claude/skills/track-equations/scripts/fit-fourier.cjs reads/<name>.read.json

It prints JSON, whose `layouts[0].N` is the smallest N (harmonics per function) that passes the check. Measured on
2026-09-28:

| track | folder (and layout) | read name | baseline N |
|---|---|---|---|
| Serpents Spiral | `serpents_spiral` | `serpents_spiral` | 12 |
| The Bowltrack | `bowltrack_2` | `bowltrack_2` | 30 |
| Eagleton | `eagleton`, layout `eagleton` | `eagleton__eagleton` | 75 |
| Thunderhead | `thunderhead_raceway`, layout `normal` | `thunderhead_raceway__normal` | 200 |
| T-180 Test Track | `ohyeah2389_t180testtrack` | `ohyeah2389_t180testtrack` | 200 |

Long laps drifted or did not converge (Rainbow Road never passed). That is why steps 2–6 use the mesh's position,
piecewise.

## What failed before, so it is not repeated
- **T-180 corners measure ELLIPTIC** (Gaussian curvature K > 0 when smoothed), not hyperbolic. A claim about the surface's
  shape needs the measurement, not a picture.
- Fitting the reader's 4 m walk (smoothed about ±20 m, with glitches) instead of the mesh, and rebuilding by integrating
  heading, is what made the long laps blow up.

Both are written up with their sources in [references/](references/).

## Evals
The evals live in [evals/](evals/), and [references/README.md](references/README.md) says what each covers.
- `known_answers.test.js`: every formula on the shelf against a known answer, e.g. a sphere's K = 1/R², a cylinder and a
  cone K = 0, a circle's heading rate 1/R.
- `mutation.test.js`: a one-formula change is caught.
- `regressions.test.js`: the real-track results. A real-track eval runs only where that track's read is in `reads/`;
  otherwise it reports SKIPPED, never passed.

Run them from the repo root:

    node --max-old-space-size=4096 --test --test-concurrency=4 .claude/skills/track-equations/evals/known_answers.test.js .claude/skills/track-equations/evals/mutation.test.js .claude/skills/track-equations/evals/regressions.test.js
