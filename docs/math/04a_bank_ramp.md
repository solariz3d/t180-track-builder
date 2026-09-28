# 04a · The bank ramp: how fast a word may change its roll (a section of primer 04, fairing)

Written by the vocabulary's author (D182) under the shelf's rule 4: a formula is added here, with its source, before it is
used. The code it governs: `src/doc/document.js` defaultWord (the ramp), `src/doc/vocab.js` BANK_RATE (the bound),
`tools/bankrate.cjs` (the measurement). To be folded into [04 fairing](04_fairing.md) when that primer lands.

## 1. The roll along a word is one smoothstep
**In the code, not a new formula:** `src/doc/resolve.js` gives a word's roll at arc length s along its length L as

  φ(s) = φ₀ + (φ₁ − φ₀) · S(s/L),  with S(t) = 3t² − 2t³  (resolve.js `smooth`, and `rollAt`)

**SOURCED, as the curvature law of the Bloss transition:** buildingSMART IFC 4.3, "Bloss Transition Segment": "a special case
of a fifth order spiral where the curvature rate of change is a cubic function". It populates only the quadratic term, L/√3,
and the cubic term, L/∛2, of IfcThirdOrderPolynomialSpiral.
- Source, opened 2026-09-28:
  https://github.com/buildingSMART/IFC4.3.x-development/blob/master/docs/templates/Partial%20Templates/Geometry/Curve%20Segment%20Geometry/Bloss%20Transition%20Segment/README.md
- **DERIVED:** those terms give curvature ∝ (s/(L/√3))² and (s/(L/∛2))³, that is 3(s/L)² and 2(s/L)³: the S above.
- **UNVERIFIED:** the sign between the two terms is IfcThirdOrderPolynomialSpiral's definition, which was not opened. The
  form κ(s) = κ₁·(3(s/L)² − 2(s/L)³) was seen only in a search summary of "Exploring Benefits of Using Blending Splines as
  Transition Curves" (MDPI Applied Sciences 10(12):4226, doi 10.3390/app10124226; the page returned 403, not opened).
- **UNVERIFIED:** in railway practice the cant (superelevation) ramp follows the same function as the curvature. Linear,
  Bloss, sine and cosine ramps are named, and the Bloss ramp's steepest cant gradient is "1.5 E". Both were seen only in
  search summaries, of the MDPI paper above and of C. Ciobanu, "Bloss transition – a short design guide" (ResearchGate
  282288817). Neither page could be opened (403). Nothing below depends on them. They say only that the builder's roll ramp
  is the railway's Bloss cant ramp.

## 2. Its steepest rate, DERIVED
- dφ/ds = (φ₁ − φ₀) · S′(s/L) / L, and S′(t) = 6t − 6t² = 6t(1 − t).
- S′ is largest where S″(t) = 6 − 12t = 0, at t = ½, where S′(½) = 1.5.
- So **the steepest roll rate in a word is 1.5 · |φ₁ − φ₀| / L** (per metre).
- For comparison, a linear ramp over the same L is |φ₁ − φ₀| / L everywhere. The smoothstep buys continuity of the roll rate
  at both ends for a peak 1.5 times the mean. This is the "1.5 E" above, derived rather than quoted.
- **The length a word needs** to change its roll by Δφ at no more than a rate r:

  L ≥ 1.5 · |Δφ| / r  (DERIVED from the line above)

## 3. The bound r, MEASURED
- `node tools/bankrate.cjs reads` → over the corpus's 16 layouts (tools/corpus.cjs LAYOUTS), at the steps where the bank is
  changing (> 0.1°/m): **n 33,127; p50 0.254, p90 0.849, p99 2.205 °/m**; all road steps: n 62,702, p90 0.560.
- The roll at a station is measured from the reader's normal n and forward f with world up y: L = unit(y × f), U = f × L,
  roll = atan2(n·L, n·U), unwrapped. Steps are 4 m apart (the reader's station spacing) and at most 8 m.
- **r = 0.849 °/m, the p90** (`src/doc/vocab.js` BANK_RATE, pinned to the tool by `test/vocab-corpus.test.js` when `reads/`
  is present). The p90, not the p99: the default should bank as most real banking does, not as the fastest 1% does. A
  sculpted word may bank faster, and validation's seam check (FINDINGS §2, 5.9° between adjacent stations) still judges it.
- **UNMEASURED:** whether the 4 m station spacing under-reads the fastest real bank changes. A change sharper than 4 m is
  averaged over the step, so the p99 and the max are lower bounds. The p90 is less exposed.

## 4. What the builder does with it
- A default word banks from the head's roll φ₀ to its class's bank φ₁. If its piece length L₀ is shorter than 1.5·|Δφ|/r,
  it is made longer, L = 1.5·|Δφ|/r.
- A curved word keeps its class's peak radius R, so its turn grows to L·(1 − ease)/R (the peak-radius relation of
  `src/doc/vocab.js` pieceOf).
- Worked case: a wall-ride after a default turn banks from −27.5° to −79.8° (Δ 52.3°). It needs L ≥ 1.5 × 52.3 / 0.849 ≈
  92 m, against its 37 m piece. Before this, it banked at about 2.1°/m at its steepest, and validation marked the seam
  sharper than measured.
- **Not ramped:** the inversion. Its whole 360° roll is the word, not a join.

## 5. What this does NOT establish
- **The bound is a rate along the ROAD (°/m), not in time.** At speed v the car rolls at v·dφ/ds: at 460 km/h (127.8 m/s)
  and 0.849 °/m that is about 108 °/s (DERIVED). No roll-rate limit for the car is measured here.
- **The ride-up of anything flowing along the road** (primer 06, the water line) is not computed from this ramp. The claim
  that abrupt entries double it comes from the open-channel design coefficient (research, USACE EM 1110-2-1601). It is not
  re-derived here.
