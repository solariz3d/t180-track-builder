# MATH_SOURCES: the citation index

Each source is cited, never copied. **"Opened"** records what was actually read on 2026-09-28:
- **primary:** the source's own text;
- **secondary:** another source restating it, named;
- **not opened:** cited from reports only.

A page number appears only where one was seen.

The PDFs were read by a zlib-only text extractor (no PDF tool is installed), so section numbers were seen and page numbers
mostly not.

| id | source | used in | opened |
|---|---|---|---|
| MOLLER97 | T. Möller, B. Trumbore, "Fast, minimum storage ray-triangle intersection", *Journal of Graphics Tools* 2(1), 1997, 21–28. The ray O + tD equals the barycentric point (1 − u − v)V₀ + uV₁ + vV₂; solved by cross products (det = e₁·(D × e₂), then u, v, t); a hit needs u ≥ 0, v ≥ 0, u + v ≤ 1, t > 0; det ≈ 0 means parallel. | 01 §1 | secondary: Wikipedia, "Möller–Trumbore intersection algorithm" |
| WIKI-CURV | Wikipedia, "Curvature": for any parametrisation, κ = ‖γ′ × γ″‖ / ‖γ′‖³ (space curves); κ = \|x′y″ − y′x″\| / (x′² + y′²)^(3/2) (plane). | 02 §1 | secondary |
| DOCARMO | M. P. do Carmo, *Differential Geometry of Curves and Surfaces*, 1976/2016. §1-5 the Frenet formulas and the fundamental theorem of curves; §3-2/§3-3 normal and Gaussian curvature, the torus example; §4-5 Gauss–Bonnet. The sections are from reports; no page seen. | 02, 06 | not opened |
| WIKI-EULER | Wikipedia, "Euler spiral": curvature changes linearly with arc length; R·s = const. | 02 §4 | secondary |
| IFC-BLOSS | buildingSMART IFC 4.3, "Bloss Transition Segment" (github.com/buildingSMART/IFC4.3.x-development …/Bloss Transition Segment/README.md). Opened by the vocabulary's author (docs/math/04a); the smoothstep S(t) = 3t² − 2t³ is DERIVED from its terms there. | 02 §4 | primary (by A) |
| WIKI-BSPLINE | Wikipedia, "B-spline": the Cox–de Boor recursion; partition of unity; local support on [t_i, t_{i+p+1}); least-squares fitting, minimising Σ W(x)[y(x) − Σ α_i B_i(x)]². | 03 | secondary |
| WIKI-GAUSS | Wikipedia, "Gaussian quadrature": an n-point rule "is a quadrature rule constructed to yield an exact result for polynomials of degree 2n − 1 or less"; §Gauss–Legendre: the 3-point nodes 0, ±√(3/5) with weights 8/9, 5/9 on [−1, 1]; the change of interval ∫ₐᵇ f = (b − a)/2 Σ wᵢ f((b − a)/2 ξᵢ + (a + b)/2). (Added for the readout, ref 09 §8.) | 09 §8 | secondary |
| DEBOOR78 | C. de Boor, *A Practical Guide to Splines*, Springer 1978 (the recursion's source). | 03 §1 | not opened |
| VMLS | S. Boyd, L. Vandenberghe, *Introduction to Applied Linear Algebra*, Cambridge UP 2018 (vmls-book.stanford.edu). **§16.1** constrained least squares (minimise ‖Ax − b‖² subject to Cx = d), its **KKT equations (16.4)** [2AᵀA Cᵀ; C 0][x; z] = [2Aᵀb; d]; §16.1.1 the least-norm problem and x̂ = C†d; ch. 12 least squares. | 03 §2, 04 | **primary** |
| CRANE13 | K. Crane, U. Pinkall, P. Schröder, "Robust fairing via conformal curvature flow", *ACM TOG* 32(4), 2013. Appendix A "A Closure Condition for Curves": the curvature change must be L²-orthogonal to f_x and f_y (and have zero integral) to keep a planar curve closed. | 04 §4 | **primary** |
| WANG08 | W. Wang, B. Jüttler, D. Zheng, Y. Liu, "Computation of rotation minimizing frames", *ACM TOG* 27(1), 2008, art. 2. §6.3: "In general, the RMF of a closed smooth spine curve does not form a closed moving frame." | 04 §4 | **primary** |
| WIKI-PROJ | Wikipedia, "Projectile motion", §"Displacement": x = v₀t cos θ, y = v₀t sin θ − ½gt²; time of flight 2v₀ sin θ/g; range v₀² sin 2θ/g. | 05 | secondary |
| MATHWORLD-TORUS | E. W. Weisstein, "Torus", MathWorld, eqs. (2)–(4) and (30): K = cos v / (a(c + a cos v)). | 06 §3 | secondary (via a research agent) |
| WIKI-GB | Wikipedia, "Gauss–Bonnet theorem", §"Polyhedra": the angle defects of a polyhedron of Euler characteristic χ sum to 2πχ (Descartes). | 06 §4 | secondary |
| MEYER03 | M. Meyer, M. Desbrun, P. Schröder, A. Barr, "Discrete differential-geometry operators for triangulated 2-manifolds", in *Visualization and Mathematics III*, Springer 2003, 35–57: angle defect over the mixed Voronoi area. | 06 §4 | not opened |
| BORRELLI03 | V. Borrelli, F. Cazals, J.-M. Morvan, "On the angular defect of triangulations and the pointwise approximation of curvatures", *CAGD* 20(6), 2003, 319–341: the defect over area converges pointwise only on regular meshes (abstract, as quoted by search). | 06 §5 | not opened |
| WIKI-JACOBI | Wikipedia, "Jacobi field": f″ + K f = 0 on a surface. | 06 (not on the shelf) | secondary |
| CHANDA17 | S. Chanda, G. W. Gibbons, P. Guha, "Jacobi-Maupertuis-Eisenhart metric and geodesic flows", *J. Math. Phys.* 58, 032503 (2017), arXiv:1612.00375, §2.2 eq. (2.2.2). | 06 (not on the shelf) | primary (via ar5iv, a research agent) |
| FOURIER-TXT | The Fourier series normalisation, Parseval, and 1/k coefficient decay at a jump. Cited to E. M. Stein, R. Shakarchi, *Fourier Analysis: An Introduction*, 2003, ch. 2–3. | 07 | not opened; held by the tests |
| WELCH67 | P. D. Welch, "The use of fast Fourier transform for the estimation of power spectra: a method based on time averaging over short, modified periodograms", *IEEE Trans. Audio Electroacoustics* AU-15(2), 1967, 70–73. The citation was checked via Crossref. | 07 §3 | not opened |
| WIKI-DFT | Wikipedia, "Discrete Fourier transform": the orthogonality of the sampled harmonics, the shift theorem, Parseval (as used by E in `tools/fourier.cjs`). | 07 §2 | secondary (by E) |
| WIKI-SMOOTHSTEP | Wikipedia, "Smoothstep", §"Variations": Ken Perlin's smootherstep S₂(x) = 6x⁵ − 15x⁴ + 10x³ on [0, 1], with zero 1st and 2nd derivatives at x = 0 and x = 1. (Added by E, D185.) | 10 §1 | secondary |
| LYCHE-MORKEN | T. Lyche, K. Mørken, *Spline Methods*, Dept. of Mathematics, Univ. of Oslo (mn.uio.no …/lyche-morken-spline-methods.pdf). §5.4, Definition 5.25, eq. (5.30), p. 116: the Variation Diminishing Spline Approximation (Vf)(x) = Σⱼ f(τ*ⱼ) Bⱼ,d(x), τ*ⱼ = (τⱼ₊₁ + … + τⱼ₊d)/d the knot averages; eq. (5.31) τ*₁ = a, τ*ₙ = b. Read by E's zlib-only text extractor, so the page number is the printed one in the text. (Added by E, D185.) | 10 §2 | **primary** |
| WIKI-GN | Wikipedia, "Gauss–Newton algorithm", §"Description": β⁽ˢ⁺¹⁾ = β⁽ˢ⁾ − (JᵀJ)⁻¹Jᵀr, stated for m ≥ n. The underdetermined step used is 04 §3's least-norm one instead. (Added by E, D185.) | 10 §3 | secondary |
| WIKI-BANKED | Wikipedia, "Banked turn", §"Frictionless banked turn": the balancing speed v = √(r·g·tan θ). | 06 §8 | secondary (opened 2026-09-28, D185) |
