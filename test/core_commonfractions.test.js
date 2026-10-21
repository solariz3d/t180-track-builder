// core_commonfractions.test.js: node --test test/core_commonfractions.test.js
// src/geom/profile.js `commonFractions`, cut for speed (D421, pane C: a tube drag step spent most of its time there, several times more once the mesh had
// run and made psiAt see profiles of many shapes). The cut must give the SAME numbers, bit for bit, as the version it replaced, which is kept below verbatim
// as the reference; the lists are the adapter's own, captured from tube and edge tracks, and made-up ones for the edges of the input.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PR = require('../src/geom/profile.js');
// capture every list the adapter hands commonFractions (installed before adapter.js loads, which destructures it at load)
const captured = [], cf = PR.commonFractions;
PR.commonFractions = (list, o) => { captured.push(list); return cf(list, o); };
const D = require('../src/core/document.js');
const { extend: EXT } = require('../src/core/extend.js');
const { toSegments } = require('../src/core/adapter.js');
PR.commonFractions = cf;

// ── the reference: commonFractions and psiAt as they were before the cut (ea54ac3 src/geom/profile.js:27-32, :147-148, :190-205), verbatim ──
const psiAt0 = (P, u) => {
  if (u <= P.u[0]) return P.psi[0]; if (u >= P.u[P.u.length - 1]) return P.psi[P.psi.length - 1];
  let lo = 1, hi = P.u.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (P.u[m] < u) lo = m + 1; else hi = m; }
  const i = lo, t = (u - P.u[i - 1]) / (P.u[i] - P.u[i - 1]); return P.psi[i - 1] + (P.psi[i] - P.psi[i - 1]) * t;
};
const edgesOf0 = (P) => [P.u[0], P.u[P.u.length - 1]];
const uAt0 = (E, f) => (f < 0 ? -f * E[0] : f * E[1]);
function commonFractions0(list, { maxAcross = 1, maxSeam = Math.PI / 180, cap = 40 } = {}) {
  const step = Math.max(1, Math.ceil(list.length / cap)), ps = list.filter((_, i) => i % step === 0 || i === list.length - 1).map((p) => PR.normalize(p));
  const Es = ps.map(edgesOf0), R = Math.max(...Es.map((e) => -e[0])), Lw = Math.max(...Es.map((e) => e[1]));
  const f0 = R > 0 ? -1 : 0, f1 = Lw > 0 ? 1 : 0, N = 4000, fine = []; for (let i = 0; i <= N; i++) fine.push(f0 + (f1 - f0) * i / N);
  const m = [0];
  for (let i = 1; i <= N; i++) {
    const a = fine[i - 1], b = fine[i], side = (a + b) / 2 < 0 ? R : Lw;
    let d = 0; for (let k = 0; k < ps.length; k++) d = Math.max(d, Math.abs(psiAt0(ps[k], uAt0(Es[k], b)) - psiAt0(ps[k], uAt0(Es[k], a))));
    m.push(m[i - 1] + (b - a) * side / maxAcross + d / maxSeam);
  }
  const K = Math.max(2, Math.ceil(m[N]) + 1), out = []; let j = 0;
  for (let k = 0; k < K; k++) { const target = m[N] * k / (K - 1); while (j < N - 1 && m[j + 1] < target) j++; const t = m[j + 1] > m[j] ? (target - m[j]) / (m[j + 1] - m[j]) : 0; out.push(fine[j] + (fine[j + 1] - fine[j]) * Math.min(1, Math.max(0, t))); }
  out[0] = f0; out[K - 1] = f1;
  return out;
}
const bitSame = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const check = (list, o, what) => { const want = commonFractions0(list, o), got = PR.commonFractions(list, o); assert.ok(bitSame(got, want), `${what}: ${got.length} fractions, the reference gives ${want.length}; first difference at ${got.findIndex((x, i) => !Object.is(x, want[i]))}`); };

// the tracks: A's tube ovals (E's probe3, the 360° and 280° rows) and a cut edge, every piece converted by the adapter
const R = 180, Q = (Math.PI * R) / 2;
const oval = (t) => { let d = EXT(D.createDoc('cf'), { length: 300, first: { w: 31, t } }); for (let i = 0; i < 4; i++) d = EXT(d, { length: Q, transition: 40, targets: { kh: 1 / R } }); return EXT(d, { length: 60, transition: 40, targets: { kh: 0 } }); };
const edged = () => { let d = EXT(D.createDoc('cf'), { length: 200, first: { e: 40 } }); d = EXT(d, { length: 150, transition: 40, targets: { e: -30, kh: 1 / 300 } }); return EXT(d, { length: 120, transition: 40, targets: { e: 0 } }); };

test('commonFractions gives the same fractions, bit for bit, as before the cut, on every list the adapter builds for tube and edge tracks', () => {
  for (const doc of [oval(360), oval(280), edged()]) toSegments(doc);
  assert.ok(captured.length >= 10, `control: the adapter handed over ${captured.length} lists`);
  assert.ok(captured.some((l) => l.length > 40), 'control: a list longer than the cap (the subsampling is exercised)');
  captured.forEach((l, k) => check(l, undefined, `list ${k} (${l.length} profiles)`));
});

// made-up profiles: a symmetric bowl, walls, a ψ of −0, and sides of zero width
const prof = (uR, uL, psiR, psiL) => {
  const u = [], psi = [];
  uR.forEach((x, i) => { u.push(-x); psi.push(psiR[i]); }); u.reverse(); psi.reverse();
  u.push(0); psi.push(0); uL.forEach((x, i) => { u.push(x); psi.push(psiL[i]); });
  return { u, psi };
};
const A = prof([4, 8, 12], [4, 8, 12], [0.1, 0.6, 1.4], [0.1, 0.6, 1.4]), B = prof([5, 9], [3, 7, 11, 13], [0.2, 2.9], [-0, 0.3, 1.9, 3.1]);
const leftOnly = { u: [0, 3, 9], psi: [0, 0.4, 1.2] }, rightOnly = { u: [-9, -3, 0], psi: [1.2, 0.4, 0] }, flat = { u: [-6, 0, 6], psi: [0, 0, 0] };
test('commonFractions is the same as before on repeats, a ψ of −0, a side of zero width, one profile, lists past the cap, and other options', () => {
  check([A], undefined, 'one profile');
  check([A, A, A, B, B, A], undefined, 'repeats, as copies');
  check([A, { u: A.u.slice(), psi: A.psi.slice() }, B], undefined, 'a repeat that is a different object');
  check([A, { u: A.u, psi: A.psi.map((x) => (x === 0 ? -0 : x)) }], undefined, 'the same profile with −0 for 0');
  check([leftOnly, leftOnly], undefined, 'no right side');
  check([rightOnly], undefined, 'no left side');
  check([leftOnly, rightOnly, flat], undefined, 'each side from a different profile');
  check([flat], undefined, 'a flat profile');
  const many = Array.from({ length: 123 }, (_, k) => (k % 7 === 3 ? B : k % 5 === 0 ? { u: A.u, psi: A.psi.map((x) => x * (1 + k / 200)) } : A));
  check(many, undefined, '123 profiles, past the cap');
  check(many, { cap: 5 }, 'cap 5');
  check([A, B], { maxAcross: 0.25, maxSeam: Math.PI / 720 }, 'finer options');
  check([{ u: [-4, 4], psi: [0.3, 0.3] }], undefined, 'no knot at 0 (normalize adds it)');
});
