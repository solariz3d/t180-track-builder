# 01 · The true centreline, from the mesh

M4 fitted the reader's walk: 4 m steps, smoothed about ±20 m, with glitches (Rainbow had 282 of them). Its long laps blew up
([07](07_fourier.md), [08](08_what_failed.md)). The skill instead reads the centreline's POSITION from the road triangles
themselves. The reader's stations give only the ORDER.

## §1 Ray against triangle (Möller–Trumbore)
**SOURCED** from MOLLER97 (via Wikipedia).

**The setup.** Take a ray O + tD and a triangle V₀V₁V₂. Let e₁ = V₁ − V₀, e₂ = V₂ − V₀ and P = D × e₂.

**The test.**
1. Compute det = e₁ · P. If |det| < ε, the ray is parallel to the triangle: a miss.
2. Let T = O − V₀. Then u = (T · P)/det. If u < 0 or u > 1: a miss.
3. Let Q = T × e₁. Then v = (D · Q)/det. If v < 0 or u + v > 1: a miss.
4. Then t = (e₂ · Q)/det. It is a hit only if t > ε, so the hit is in front of the origin.

**The hit point.** It is O + tD, which equals (1 − u − v)V₀ + uV₁ + vV₂.

**Test:** `evals/checks.js` 01 §1 (`mathref.rayTriangle`) checks five cases:
- a hit, at the right t, u and v;
- a ray outside the triangle;
- a parallel ray;
- a hit behind the origin;
- and the hit point equals the barycentric point.

**Mutants K1 and K2 are caught.**

## §2 Of stacked hits, take the one nearest the previous station's height
This is trap (b): roads that cross over or under, as on Rainbow. A cross-ray can meet two decks, and the FIRST hit may be
the wrong one. Take the hit whose height is nearest the previous station's.

**Test:** 01 §2 (`mathref.nearestHit`). **Mutant K3** ("take the first") **is caught.**

## §3 The centre is the midpoint of the edge hits
At each station, a ray across the road, in the station's cross-plane, finds the left and right edges. The centre is their
midpoint. The width is right − left. The cross-section is the polyline of hits between them.

**Test:** 01 §3 (`mathref.midpoint`).

## §4 Method rules with no formula of their own
These are NOT known-answer-tested here. They are properties of E's scripts and must be tested there.

- **(c) The cross-plane comes from the path's FRAME, not from world-up.**
  - Otherwise, on a loop or an inversion, the cross-ray points into the ground.
  - The builder's gravity frame, H(θ) = (cos θ, 0, −sin θ) plus an explicit roll, is `src/geom`'s. Its through-vertical
    convention is tested in `test/fourier.test.js`:
    - "01 §5, through vertical: a vertical loop keeps its heading and gains one whole turn of pitch".
- **(a) The width check comes before fitting.**
  - A width jump of more than 20% between neighbouring stations flags a seam or a reader glitch.
  - A flagged station is excluded from the fit AND listed.
- **A cross-ray that hits nothing is a JUMP gap, not bad data.** See [05](05_flight.md).

## §5 E's resampling at equal chords (M4, kept for the Fourier path)
- The read line is resampled at an equal chord length c, by bisection, so that the M-th point closes the lap. Then s = i·c.
  - On M4 this took the floor on Rainbow, Centrifuge and Thunderhead from 8–12 m to 0.00–0.73 m (`p-m4-equations-E` §1b row 6).
  - **Test:** `test/fourier.test.js`, "01 §5, equal chords".
- Headings and pitches are taken from CHORDS at their midpoints (§1b row 3). Near vertical, where the chord's horizontal part
  is below 0.3, the heading is interpolated.
  - **That 0.3 was tuned on ONE track (Sakura).** It is a choice, not a result.

## True of T-180 tracks (MEASURED)
- **Sakura has one vertical loop, and Onuris three:** pitch gains +1 and +3 turns.
  - Found by E's reader work: `p-m4-equations-E_2026-09-28.md` §1b row 4, `node tools/fourier.cjs`.
- **Reader glitches per layout (M4):** 0–23 on twelve layouts, and 282 on Rainbow.
  - `p-m4-equations-E` §2, sweep sha256 4068490edb40a5e5.
