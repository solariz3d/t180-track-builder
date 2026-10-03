// core_xsec_math.test.js (D225): the formulas ref 09 §10 puts on the shelf, each with a known-answer or a derived-property test (the seal's §4: "a formula is on the shelf only with
// its source and a test"). node --test, no dependencies. Every number named here is the seal's (exo_memory/loop/cross_section_seal_registration_2026-10-03.md), re-derived by code.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/core/adapter.js');
const D = require('../src/core/document.js');
const P = require('../src/geom/profile.js');

const DEG = Math.PI / 180, G = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

test('G = 3t² − 2t³: G(0) = 0, G′(0) = 0, G(1) = 1, G′(1) = 0, monotone, G′ peaks at ½ with 3/2 (ref 09 §10, DERIVED)', () => {
  assert.strictEqual(G(0), 0); assert.strictEqual(G(1), 1);
  const d = (t) => (G(t + 1e-6) - G(t - 1e-6)) / 2e-6;
  assert.ok(Math.abs(d(1e-4)) < 1e-3, 'G′(0) is 0'); assert.ok(Math.abs(d(1 - 1e-4)) < 1e-3, 'G′(1) is 0 (the band arrives at the edge at a held angle; t² would end at 2)');
  assert.ok(Math.abs(d(0.5) - 1.5) < 1e-6, 'G′(½) = 3/2');
  let prev = -1; for (let i = 0; i <= 1000; i++) { const g = G(i / 1000); assert.ok(g >= prev - 1e-15, 'monotone'); prev = g; }
  for (let i = 1; i < 1000; i++) { const t = i / 1000; assert.ok(Math.abs(d(t) - 6 * t * (1 - t)) < 1e-5, `G′ = 6t(1 − t) at ${t}`); }
});

/** The analytic ψ of an edge profile at u (degrees), from the base ψ at u and the definition (ref 09 §10). */
const analytic = (base, e, s, u) => { const h = u < 0 ? -base.u[0] : base.u[base.u.length - 1], r = Math.abs(u) / h; return P.psiAt(base, u) / DEG + (r > s ? e * G((r - s) / (1 - s)) : 0); };

test('the edge profile is the analytic ψ_mid + e·G within 0.05° at 4000 points a side, for every family, width, s and e on the seal grid (E1 iii)', () => {
  let worst = 0;
  for (const fam of ['bowl', 'half-pipe', 'flat']) for (const w of [8, 31, 50]) for (const s of [0.5, 0.64, 0.95]) for (const e of [5, 30, 60, 150 - 15.5]) {
    const base = P.normalize(A.cupProfile(fam, w, 15)), nE = Math.max(A.EDGE_MIN_N, Math.ceil(1.5 * e)), prof = A.edgeProfile(base, e, s, nE);
    for (const side of [-1, 1]) for (let i = 0; i <= 4000; i++) { const u = side * (w / 2) * (i / 4000), d = Math.abs(P.psiAt(prof, u) / DEG - analytic(base, e, s, u)); if (d > worst) worst = d; }
    // consecutive knots turn by at most 1° (the mesh's maxSeam), the profile is non-decreasing from the centre out (E1 v)
    const term = (k) => prof.psi[k] - P.psiAt(base, prof.u[k]);   // the EDGE term at knot k (the base profile's own knots are the base's: the mesh fills those in)
    for (let k = 1; k < prof.u.length; k++) { assert.ok(Math.abs(term(k) - term(k - 1)) / DEG <= 1.0 + 1e-9, `${fam} w${w} s${s} e${e}: knots ${k - 1}-${k}: the edge term turns ${(Math.abs(term(k) - term(k - 1)) / DEG).toFixed(3)}°`); }
    for (let k = 1; k < prof.u.length; k++) if (prof.u[k - 1] >= 0) assert.ok(prof.psi[k] >= prof.psi[k - 1] - 1e-12, 'ψ rises outward on the left');
  }
  assert.ok(worst <= 0.05, `worst deviation from the analytic edge profile ${worst}°`);
});

test('the slice is no kink: |Δψ| at u = s·h is 0 and the one-sided slope difference of ψ − ψ_mid is 3e-6 of what G = t gives (the seal measured 3e-6, E1 ii)', () => {
  const w = 31, h = w / 2, s = 0.64, e = 15, base = P.normalize(A.cupProfile('bowl', w, 45)), prof = A.edgeProfile(base, e, s, 64), u0 = s * h, d = 1e-6 * (1 - s) * h;
  const f = (u) => P.psiAt(prof, u) - P.psiAt(base, u);
  const closed = (u) => e * DEG * G((u / h - s) / (1 - s));   // the analytic edge term
  assert.ok(Math.abs(closed(u0)) < 1e-12, '|Δψ| at the slice is 0');
  const jump = Math.abs((closed(u0 + d) - closed(u0)) / d - (closed(u0) - closed(u0 - d)) / d), ref = (e * DEG) / ((1 - s) * h);   // G = t has a slope jump of exactly ref
  assert.ok(jump <= 1e-4 * ref, `slope jump ${jump} against G = t's ${ref}`);
  assert.ok(Math.abs(f(u0)) < 1e-9, 'the rendered ψ − ψ_mid is 0 at the slice');
});

test('LINEAR in e at a fixed s: the fraction-matched blend of two edge profiles IS the profile at the blended e (to 1e-12 rad); NOT linear in s (ref 09 §10, E4 iv and v)', () => {
  const w = 31, s = 0.64, base = P.normalize(A.cupProfile('bowl', w, 30)), nE = 64;
  const e1 = A.edgeProfile(base, 15, s, nE), e2 = A.edgeProfile(base, 60, s, nE);
  for (const x of [0.25, 0.5, 0.75]) {
    const mixed = P.blend(e1, e2, x), want = A.edgeProfile(base, (1 - x) * 15 + x * 60, s, nE);
    let worst = 0; for (let i = -400; i <= 400; i++) { const u = (w / 2) * (i / 400); worst = Math.max(worst, Math.abs(P.psiAt(mixed, u) - P.psiAt(want, u))); }
    assert.ok(worst < 1e-12, `blend at ${x} is off by ${worst} rad`);
  }
  // not linear in s: the blend of the profiles at s 0.5 and 0.9 against the exact profile at the middle slice is off by degrees at e 15 (the seal: 5.06°)
  const sa = A.edgeProfile(base, 15, 0.5, nE), sb = A.edgeProfile(base, 15, 0.9, nE), mix = P.blend(sa, sb, 0.5), exact = A.edgeProfile(base, 15, 0.7, nE);
  let off = 0; for (let i = -400; i <= 400; i++) { const u = (w / 2) * (i / 400); off = Math.max(off, Math.abs(P.psiAt(mix, u) - P.psiAt(exact, u)) / DEG); }
  assert.ok(off > 1, `a blend across Δs 0.4 must NOT equal the exact profile (it is off by ${off.toFixed(2)}°, the seal measured 5.06° at the quarter points)`);
});

test('the TUBE: ψ = (t/2)|u|/h is a circular arc of radius w/t_rad, and at t = 360 its two edges meet at Y = 2R = w/π within 1e-9 m (E T1 i, ii)', () => {
  for (const w of [4, 8, 12, 31, 60]) for (const t of [90, 180, 270, 340]) {
    const tp = P.normalize(A.tubeProfile(w, t)), R = w / (t * DEG);
    for (let i = -50; i <= 50; i++) { const u = (w / 2) * (i / 50), [X, Y] = P.offsetAt(tp, u), c = Math.hypot(X, Y - R); assert.ok(Math.abs(c - R) < 1e-9 * Math.max(1, w), `w${w} t${t}: a vertex is ${c - R} m off the circle`); }
  }
  for (const w of [4, 12, 31, 60]) {
    const tp = P.normalize(A.tubeProfile(w, 360)), L = P.offsetAt(tp, w / 2), Rr = P.offsetAt(tp, -w / 2);
    assert.ok(Math.hypot(L[0] - Rr[0], L[1] - Rr[1]) < 1e-9, `w${w}: the closure gap`); assert.ok(Math.abs(L[1] - w / Math.PI) < 1e-9, `w${w}: the far point is 2R`);
  }
});

test('the tube slot: t1m(w) is where the two tips are 1.0 m apart: 4 → 283.566°, 8 → 319.241°, 12 → 332.053°, 31 → 348.732°, 60 → 354.096° (the seal, F_tube)', () => {
  const want = { 4: 283.566, 8: 319.241, 12: 332.053, 31: 348.732, 60: 354.096 };
  for (const [w, t] of Object.entries(want)) assert.ok(Math.abs(D.tubeSlotMinDeg(Number(w)) - t) < 5e-4, `w ${w}: ${D.tubeSlotMinDeg(Number(w))} against ${t}`);
  // the root property: the tip gap of an open tube at t1m is the downforce ray's reach
  for (const w of [8, 31]) { const tt = D.tubeSlotMinDeg(w) * DEG, gap = 2 * (w / tt) * Math.sin(tt / 2); assert.ok(Math.abs(gap - 1) < 1e-9, `w${w}: the gap at t1m is ${gap}`); }
});

test('the helix curvature of a floor at radius R rolling at ω is R·ω²/(1 + R²ω²) (a = R, b = 1/ω, ref 02 §1), by finite differences of the helix', () => {
  for (const [R, om] of [[4.93, 0.01], [4.93, 0.05], [10, 0.02]]) {
    const pos = (s) => [R * Math.cos(om * s), R * Math.sin(om * s), s], h = 1e-3, s0 = 3;
    const a = pos(s0 - h), b = pos(s0), c = pos(s0 + h), d2 = [0, 1, 2].map((k) => (a[k] - 2 * b[k] + c[k]) / (h * h)), d1 = [0, 1, 2].map((k) => (c[k] - a[k]) / (2 * h));
    const sp2 = d1[0] ** 2 + d1[1] ** 2 + d1[2] ** 2, along = (d2[0] * d1[0] + d2[1] * d1[1] + d2[2] * d1[2]) / sp2, kv = [0, 1, 2].map((k) => (d2[k] - along * d1[k]) / sp2);
    assert.ok(Math.abs(Math.hypot(...kv) - (R * om * om) / (1 + R * R * om * om)) < 1e-6, `R ${R} ω ${om}`);
  }
});
