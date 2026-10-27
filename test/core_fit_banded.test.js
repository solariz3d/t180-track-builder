// core_fit_banded.test.js: node --test test/core_fit_banded.test.js      (T180_TREE=<worktree> runs it from outside the tree)
// D482 (D481's finding: a drag with bank, cup or edge typed rebuilt the ghost 4 times a second at 1,000 m and froze for 130 s a frame at 10 km). extend.js
// fitWithHold refitted every free control point with a DENSE least-squares solve: an m × S basis table, O(m²·S) normal equations, a Gauss–Jordan sweep, with
// m ≈ L/20 and S ≈ 2·L, so cubic in the length. It is BANDED now. Prove-it tier: the bank, cup and edge it fits are in every exported track. Rows:
//   1  the same answer: on every road piece of the public fixtures and on pieces laid here (each typed combination D481 used, three lengths, four transitions),
//      the banded fit gives control points byte-equal to 0.4.21's dense fit, kept below verbatim as the reference
//   2  the same answer where the elimination swaps rows (uneven knots: a short span beside a long one): 400 seeded pieces, byte-equal, and rows really were swapped
//   3  a singular system (a free point whose whole support falls between two samples) is "the fit as it was": the free points keep their values, as the dense fit's do
//   4  no free point (the transition shorter than every Greville abscissa): only the pins are written, as before
//   5  linear in the length: extend() at 10 km with bank, cup and edge typed finishes within 250 ms. Measured on this machine (d482-a, node at BelowNormal):
//      five runs at 10 km 22.8, 13.2, 9.7, 18.5, 11.3 ms (2026-10-27T01:55Z, final-fit10k.out, D482 hand-back §4); the bar is about 11 times the worst. 0.4.21's dense fit
//      took 162,211 ms on the same words (final-proof-10k.out)
//   6  where pivoting decides (a column whose own diagonal is under the singular bar, 1e-12, while the row below it is over): the banded fit pivots and goes on, as
//      the dense fit does, and writes the same control points; without pivoting it would stop there and leave the fit as it was. Such a system is ill-conditioned
//      (a knot cluster 0.01 m wide, which the panel's words do not lay), and there the two eliminations' rounding parts beyond the kept digits: this row holds
//      which points are written, not their values (the D482 hand-back lists the values)
//   7  a piece refitted after its knots were replaced reads the new basis (D482 kept the samples per piece: a typed bank, cup and edge fit four channels on one)
//   8  D484 keeps the samples by the knot vector's VALUE, so they carry to the next piece where its knots are the same: a piece of the same length and as many knots,
//      one of them moved, does not read the last piece's samples
//   9  D484 builds a new set of samples by sampleBasis, not one basisN a sample: at every sample of every knot vector here (the public fixtures' pieces, pieces laid
//      here, 400 seeded uneven ones with repeated knots, a sample on every knot and at the end) its first index and four values are basisN's, byte for byte
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const T = process.env.T180_TREE ? path.resolve(process.env.T180_TREE) : path.join(__dirname, '..');
const D = require(path.join(T, 'src/core/document.js')), X = require(path.join(T, 'src/core/extend.js'));
const DEG = Math.PI / 180;

/** 0.4.21's fitWithHold (9648a25:src/core/extend.js:123-141), verbatim but for its name: the reference the banded fit must equal. */
function denseFit(piece, ch, f, Lt, target) {
  const C = piece.channels[ch], n = C.length, U = D.knotVector(piece), L = piece.length, dec = D.DEC[ch], t = Number(target.toFixed(dec)) + 0;
  const pinned = new Set([0, 1, n - 2, n - 1]); for (let i = 2; i < n; i++) if ((U[i + 1] + U[i + 2] + U[i + 3]) / 3 >= Lt - 1e-9) pinned.add(i);
  for (const i of pinned) if (i >= 2) C[i] = t;
  const free = []; for (let i = 0; i < n; i++) if (!pinned.has(i)) free.push(i);
  if (!free.length) return;
  const S = []; const ds = Math.max(0.25, Math.min(0.5, L / 400)); for (let s = 0; s < L; s += ds) S.push(s); S.push(L);
  const one = (i) => ({ ...piece, channels: { ...piece.channels, [ch]: C.map((_, k) => (k === i ? 1 : 0)) } });
  const B = free.map((i) => { const Q = one(i); return S.map((s) => D.channelValue(Q, ch, s)); });
  const held = { ...piece, channels: { ...piece.channels, [ch]: C.map((v, k) => (pinned.has(k) ? v : 0)) } }, rest = S.map((s, q) => f(s) - D.channelValue(held, ch, s));
  const m = free.length, A = Array.from({ length: m }, () => new Float64Array(m + 1));
  for (let a = 0; a < m; a++) { for (let b = 0; b < m; b++) { let v = 0; for (let q = 0; q < S.length; q++) v += B[a][q] * B[b][q]; A[a][b] = v; } let r = 0; for (let q = 0; q < S.length; q++) r += B[a][q] * rest[q]; A[a][m] = r; }
  for (let c = 0; c < m; c++) {   // Gaussian elimination with partial pivoting (m is at most a few tens)
    let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; if (p !== c) [A[c], A[p]] = [A[p], A[c]];
    if (!(Math.abs(A[c][c]) > 1e-12)) return;   // a singular system: the fit as it was
    for (let r = 0; r < m; r++) { if (r === c) continue; const k = A[r][c] / A[c][c]; if (k) for (let j = c; j <= m; j++) A[r][j] -= k * A[c][j]; }
  }
  free.forEach((i, a) => { C[i] = Number((A[a][m] / A[a][a]).toFixed(dec)) + 0; });
}

/** a piece with its own copy of one channel (the fit writes into it) */
const withChannel = (P, ch, arr) => ({ ...P, channels: { ...P.channels, [ch]: arr.slice() } });
/** the ramp the fit is asked to follow: from the channel's start value to `target` by the quintic over Lt, then held */
const rampOf = (a, target, Lt) => (s) => a + (target - a) * X.smoother(Math.min(1, s / Lt));
/** both fits on copies of one piece; the indices where they differ (Object.is: -0 and +0 told apart) */
function both(P, ch, target, Lt) {
  const a = withChannel(P, ch, P.channels[ch]), b = withChannel(P, ch, P.channels[ch]), f = rampOf(P.channels[ch][0], target, Lt);
  denseFit(a, ch, f, Lt, target); X.fitWithHold(b, ch, f, Lt, target);
  const differ = []; a.channels[ch].forEach((v, k) => { if (!Object.is(v, b.channels[ch][k])) differ.push(`${ch}[${k}] dense ${v} banded ${b.channels[ch][k]}`); });
  return { differ, dense: a.channels[ch], banded: b.channels[ch] };
}
const TARGETS = { phi: 20 * DEG, c: 30, e: 20, er: -5 };

test('row 1: the banded fit equals 0.4.21\'s dense fit byte for byte, on every public fixture\'s road pieces and on pieces laid with bank, cup and edge', (t) => {
  const pieces = [];
  const FX = path.join(T, 'test', 'fixtures');
  for (const f of fs.readdirSync(FX).filter((f) => f.endsWith('.core2.json'))) for (const P of D.parse(fs.readFileSync(path.join(FX, f), 'utf8')).pieces) if (P.type === 'road') pieces.push([`${f} ${P.id}`, P]);
  const COMBOS = { bank: { phi: 20 * DEG }, cup: { c: 30 }, edge: { e: 20 }, stack: { phi: 20 * DEG, c: 30, e: 20 } };
  for (const L of [200, 400, 1000]) for (const [cn, targets] of Object.entries(COMBOS)) pieces.push([`laid ${cn} ${L} m`, X.extend(D.createDoc('d482'), { length: L, targets }).pieces[0]]);
  let fits = 0; const differ = [];
  for (const [name, P] of pieces) for (const ch of X.C2_CHANNELS) {
    if (!Array.isArray(P.channels[ch])) continue;
    for (const k of [1, 0.9, 0.5, 1 / 3]) { const r = both(P, ch, TARGETS[ch], P.length * k); fits++; for (const d of r.differ) differ.push(`${name} Lt ${k}·L: ${d}`); }
  }
  t.diagnostic(`${fits} fits on ${pieces.length} pieces`);
  assert.ok(fits >= 400, `only ${fits} fits ran`);
  assert.deepEqual(differ.slice(0, 20), [], `${differ.length} control points differ`);
});

test('row 2: where the elimination swaps rows (uneven knots), the banded fit still equals the dense fit byte for byte', (t) => {
  const base = X.extend(D.createDoc('d482'), { length: 200, targets: { phi: 20 * DEG } }).pieces[0];
  let seed = 482, swapped = 0; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), differ = [];
  for (let trial = 0; trial < 400; trial++) {
    const L = 50 + rnd() * 400, K = [];
    for (let i = 0, k = 3 + Math.floor(rnd() * 12); i < k; i++) K.push(Number((rnd() * L).toFixed(4)));
    K.sort((a, b) => a - b);
    const knots = K.filter((x, i) => x > 0.01 && x < L - 0.01 && (i === 0 || x - K[i - 1] > 1e-3));
    const P = { ...base, length: L, knots, channels: { ...base.channels, phi: new Array(knots.length + 4).fill(0) } }, Lt = L * (0.2 + 0.8 * rnd());
    const r = both(P, 'phi', 0.3, Lt); for (const d of r.differ) differ.push(`trial ${trial}: ${d}`);
    if (pivots(P, Lt)) swapped++;
  }
  t.diagnostic(`${swapped} of 400 pieces swap rows in the elimination`);
  assert.ok(swapped >= 20, `only ${swapped} pieces swapped rows: the case this row is for did not happen`);
  assert.deepEqual(differ.slice(0, 20), [], `${differ.length} control points differ`);
});
/** does the dense elimination of this fit pick a pivot below the diagonal? (the reference's own matrix, so the row cannot pass vacuously) */
function pivots(P, Lt) {
  const ch = 'phi', C = P.channels[ch], n = C.length, U = D.knotVector(P), L = P.length;
  const pinned = new Set([0, 1, n - 2, n - 1]); for (let i = 2; i < n; i++) if ((U[i + 1] + U[i + 2] + U[i + 3]) / 3 >= Lt - 1e-9) pinned.add(i);
  const free = []; for (let i = 0; i < n; i++) if (!pinned.has(i)) free.push(i);
  const S = []; const ds = Math.max(0.25, Math.min(0.5, L / 400)); for (let s = 0; s < L; s += ds) S.push(s); S.push(L);
  const B = free.map((i) => S.map((s) => D.channelValue({ ...P, channels: { ...P.channels, [ch]: C.map((_, k) => (k === i ? 1 : 0)) } }, ch, s)));
  const m = free.length, A = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => B[a].reduce((v, x, q) => v + x * B[b][q], 0)));
  for (let c = 0; c < m; c++) {
    let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (p !== c) return true;
    if (!(Math.abs(A[c][c]) > 1e-12)) return false;
    for (let r = c + 1; r < m; r++) { const k = A[r][c] / A[c][c]; for (let j = c; j < m; j++) A[r][j] -= k * A[c][j]; }
  }
  return false;
}

test('row 3: a singular system (a free point whose support falls between two samples) is "the fit as it was", as in the dense fit', () => {
  const base = X.extend(D.createDoc('d482'), { length: 100, targets: { phi: 20 * DEG } }).pieces[0];
  const knots = [20, 40.01, 40.02, 40.03, 40.04, 40.05, 60, 80], before = new Array(knots.length + 4).fill(0.05);   // the point on [40.01, 40.05]: no sample there (every 0.25 m)
  const P = { ...base, length: 100, knots, channels: { ...base.channels, phi: before } };
  const r = both(P, 'phi', 0.3, 100);
  assert.deepEqual(r.differ, []);
  const n = before.length;
  for (let i = 2; i < n - 2; i++) assert.equal(r.banded[i], 0.05, `free point ${i} was written (${r.banded[i]}): a singular system must leave the fit as it was`);
  assert.deepEqual([r.banded[n - 2], r.banded[n - 1]], [0.3, 0.3], 'the pins are still written');
});

test('row 4: no free point (a transition shorter than every Greville abscissa): only the pins are written, as in the dense fit', () => {
  const P = X.extend(D.createDoc('d482'), { length: 200, targets: { phi: 20 * DEG } }).pieces[0];
  const r = both(P, 'phi', 0.3, 0.001);
  assert.deepEqual(r.differ, []);
  assert.deepEqual(r.banded.slice(0, 2), P.channels.phi.slice(0, 2), 'the start pair is kept');
  assert.ok(r.banded.slice(2).every((v) => v === 0.3), `every point after the start pair is the target: ${r.banded}`);
});

test('row 5: linear in the length: extend() at 10 km with bank, cup and edge typed finishes within 250 ms (0.4.21: 141 s)', (t) => {
  const doc = D.createDoc('d482'), targets = { phi: 20 * DEG, c: 30, e: 20 };
  let best = Infinity;
  for (let k = 0; k < 3; k++) { const t0 = process.hrtime.bigint(); X.extend(doc, { length: 10000, targets: { ...targets } }); best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6); if (best <= 250) break; }
  t.diagnostic(`extend at 10 km, all three typed: ${best.toFixed(1)} ms`);
  assert.ok(best <= 250, `extend() at 10 km with bank, cup and edge typed took ${best.toFixed(0)} ms (the bar 250 ms, about 11 times the worst of five measured runs, 22.8 ms, on d482-a)`);
});

test('row 6: where pivoting decides whether a column is singular, the banded fit pivots and writes the same control points as the dense fit', () => {
  const base = X.extend(D.createDoc('d482'), { length: 100, targets: { phi: 20 * DEG } }).pieces[0];
  for (const knots of [[20, 40.01, 40.02, 40.03, 40.04, 40.2501, 60, 80], [20, 40.1, 40.15, 40.2, 40.249, 40.2501, 60, 80]]) {
    const P = { ...base, length: 100, knots, channels: { ...base.channels, phi: new Array(knots.length + 4).fill(0.05) } };
    const r = both(P, 'phi', 0.3, 100), written = (arr) => arr.map((v, i) => (v !== 0.05 ? i : -1)).filter((i) => i >= 0);
    assert.ok(written(r.dense).length > 2, `the dense fit wrote only ${written(r.dense)}: this case does not pivot past the bar`);
    assert.deepEqual(written(r.banded), written(r.dense), `knots ${knots}: the banded fit wrote ${written(r.banded)}, the dense fit ${written(r.dense)}`);
  }
});

test('row 7: a piece refitted after its knots were replaced reads the new basis (the samples kept per piece are not reused across knots)', () => {
  const P = { ...X.extend(D.createDoc('d482'), { length: 200, targets: { phi: 20 * DEG } }).pieces[0] };
  P.channels = { ...P.channels, phi: P.channels.phi.slice() };
  X.fitWithHold(P, 'phi', rampOf(0, 0.3, 200), 200, 0.3);   // the first fit keeps this piece's samples
  P.knots = [25, 50, 75, 100, 125, 150, 175]; P.channels = { ...P.channels, phi: new Array(P.knots.length + 4).fill(0) };
  const ref = withChannel(P, 'phi', P.channels.phi), f = rampOf(0, 0.3, 200);
  denseFit(ref, 'phi', f, 200, 0.3); X.fitWithHold(P, 'phi', f, 200, 0.3);   // the SAME piece object refitted: the kept samples are its old knots'
  assert.deepEqual(P.channels.phi, ref.channels.phi, 'the refit used the samples of the knots it had before');
});

test('row 8: the samples carry only to a piece whose knot vector is the same: one of the same length and as many knots, one knot moved, reads its own basis', () => {
  const base = X.extend(D.createDoc('d484'), { length: 200, targets: { phi: 20 * DEG } }).pieces[0], f = rampOf(0, 0.3, 200);
  const make = (knots) => ({ ...base, knots, channels: { ...base.channels, phi: new Array(knots.length + 4).fill(0) } });
  const A = make([25, 50, 75, 100, 125, 150, 175]), B = make([25, 50, 75, 101.5, 125, 150, 175]);   // B: the same length, as many knots, the fourth moved
  X.fitWithHold(A, 'phi', f, 200, 0.3);   // A's samples are kept
  const ref = withChannel(B, 'phi', B.channels.phi); denseFit(ref, 'phi', f, 200, 0.3); X.fitWithHold(B, 'phi', f, 200, 0.3);
  assert.deepEqual(B.channels.phi, ref.channels.phi, 'B was fitted on the samples kept for A');
  const C = make([25, 50, 75, 100, 125, 150, 175]), refC = withChannel(C, 'phi', C.channels.phi);   // a new piece on A's very knots: its fit is still the dense fit's
  denseFit(refC, 'phi', f, 200, 0.3); X.fitWithHold(C, 'phi', f, 200, 0.3);
  assert.deepEqual(C.channels.phi, refC.channels.phi);
});

test('row 9: sampleBasis gives basisN\'s first index and four values at every sample, byte for byte (fixtures, laid pieces, uneven and repeated knots, samples on the knots)', (t) => {
  const { basisN } = require(path.join(T, 'tools/piecewise.cjs'));
  const vectors = [];
  const FX = path.join(T, 'test', 'fixtures');
  for (const f of fs.readdirSync(FX).filter((f) => f.endsWith('.core2.json'))) for (const P of D.parse(fs.readFileSync(path.join(FX, f), 'utf8')).pieces) if (P.type === 'road') vectors.push([f, P.length, P.knots]);
  for (const L of [37, 200, 400, 1000, 2000]) for (const targets of [{ phi: 20 * DEG }, { phi: 20 * DEG, c: 30, e: 20 }]) { const P = X.extend(D.createDoc('d484'), { length: L, targets, transition: { phi: L / 5 } }).pieces[0]; vectors.push([`laid ${L}`, L, P.knots]); }
  let seed = 484; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let trial = 0; trial < 400; trial++) {
    const L = 5 + rnd() * 600, K = [];
    for (let i = 0, k = Math.floor(rnd() * 14); i < k; i++) K.push(Number((rnd() * L).toFixed(trial % 3 ? 4 : 0)));
    if (trial % 5 === 0 && K.length) K.push(K[0], K[0]);   // a knot of multiplicity three
    K.sort((a, b) => a - b);
    vectors.push([`seeded ${trial}`, L, K.filter((x) => x > 0 && x < L)]);
  }
  let samples = 0; const differ = [];
  for (const [name, L, knots] of vectors) {
    const U = [0, 0, 0, 0, ...knots, L, L, L, L];
    const S = []; const ds = Math.max(0.25, Math.min(0.5, L / 400)); for (let s = 0; s < L; s += ds) S.push(s); S.push(L);
    for (const k of knots) S.push(k); S.sort((a, b) => a - b);   // a sample on every knot (the span changes there)
    const { first, N } = X.sampleBasis(U, S, L);
    S.forEach((s, q) => {
      samples++; const b = basisN(U, Math.min(Math.max(s, 0), L));
      if (first[q] !== b.first || [0, 1, 2, 3].some((j) => !Object.is(N[4 * q + j], b.N[j]))) differ.push(`${name} s ${s}: first ${first[q]} / ${b.first}, N ${Array.from(N.slice(4 * q, 4 * q + 4))} / ${b.N}`);
    });
  }
  t.diagnostic(`${samples} samples on ${vectors.length} knot vectors`);
  assert.ok(vectors.length >= 440 && samples >= 100000, `only ${samples} samples on ${vectors.length} knot vectors`);
  assert.deepEqual(differ.slice(0, 10), [], `${differ.length} samples differ`);
});
