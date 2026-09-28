# 07 · Fourier on a loop (M1, M4), and why it is not the skill's main method

## §1 The series and its fit
A function f sampled at M equal steps around a closed lap of length L is expanded as:

  f(s) ≈ a₀ + Σₖ [aₖ cos(2πks/L) + bₖ sin(2πks/L)]

with aₖ = (2/M) Σ f cos(·) and bₖ = (2/M) Σ f sin(·) for k ≥ 1.

The source is FOURIER-TXT (not opened) and WIKI-DFT. The normalisation is held by the test.

**A jump in f makes the coefficients decay only as 1/k.** A square wave gives bₖ = 4/(πk) on odd k. So one step on a lap
costs terms all the way up the spectrum. That is why a periodic series is the wrong basis across a jump, and why the skill
splits there.

**Test (07 §1):**
- cos(3·2πs/L) gives a₃ = 1 and all else 0;
- a square wave gives 4/(πk) on odd k and 0 on even k.

**Mutant K24** (1/M) **is caught.**

## §2 E's formulas on the Fourier path
These are tested in `test/fourier.test.js`, not here:
- the half-sample shift: "03 §1, the half-sample shift" (coefficients of angles taken at chord midpoints);
- equal chords: 01 §5;
- through vertical: 01 §5;
- the closure projection: "closes … to within 1 mm";
- the roll turn of an inversion: "a lap that rolls over once …".

## §3 M1: T-180 tracks share a spectrum (MEASURED, PASS)
- W 0.808 against B 1.215, B/W 1.50, p = 0.012.
- Source: FINDINGS §7g, `node tools/spectrum.cjs reads`. Its PSD is Welch's (WELCH67).

## True of T-180 tracks (MEASURED): M4, a single Fourier series per lap
Source: `exo_memory/handback/p-m4-equations-E_2026-09-28.md` §2, `node tools/fourier.cjs sweep reads --write`, sweep
sha256 4068490edb40a5e5.

**The verdict: PASS by one track.** 7 of 13 layouts reach N ≤ 200 within 5 m and 5° on ≥ 95%:

| layout | N |
|---|---|
| Serpents | 12 |
| Bowltrack | 30 |
| Eagleton | 75 |
| Onuris | 150 |
| T-180 Bowl Track | 150 |
| Thunderhead | 200 |
| Test Track | 200 |

**The BANK is short everywhere:** N ≤ 300 on all 13.

**The LINE grows with the lap:**

| layout | N |
|---|---|
| Coast | 1,000 |
| Sakura | 2,000 |
| Nordic | 2,652 |
| Hazen | 3,000 |
| Centrifuge | 4,000 |
| Rainbow | never (73.6% at the exact fit) |

**Why:** it fitted the reader's walk and rebuilt by integrating heading. A 0.25 mrad error sustained over 20 km is 5 m. See
[08](08_what_failed.md).

**These are the numbers the skill's regression evals are held to:**
- Rainbow must pass once split.
- Sakura and Centrifuge must need FEWER total degrees of freedom than 2,000 and 4,000 terms' worth (the plan's trap (d),
  [03](03_bsplines.md) §3).
