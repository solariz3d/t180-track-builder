// core_xsec_shared.test.js: node --test test/core_xsec_shared.test.js      (T180_TREE=<worktree> runs it from outside the tree)
// D484 (C's D483 profile of the empty-track edge drag: each new length built every chord end's edge cross-section from nothing, and commonFractions, missing
// its cache, read psiAt twice per profile at each of 4,001 fractions). Now an edge piece builds what does not depend on e once per base and start (adapter.js
// edgeFrame), and fractionsOf finds each fraction's span and weight once per group of profiles on the same knots and keeps each value for the next step.
// Prove-it tier: the cross-sections and the fraction grid are in every mesh and export. Both must give what they gave before, byte for byte. Rows:
//   1  commonFractions equals D483's (d1e93dd:src/geom/profile.js:203-225, kept below verbatim but for its cache) on every list xsecSegments hands it: each edge
//      or tube piece of the public fixtures and of pieces laid here (an edge, two sides with a start, an edge on a cup, a tube with an edge, at three lengths),
//      and each segment carries those fractions
//   2  the same on lists whose profiles sit on DIFFERENT knots, in groups and interleaved, repeated, and where the largest step is in a later group
//   3  every chord end of an edge piece carries the profile edgeProfile makes alone there (D483's, kept below verbatim): with e, er and the start s moving
//      along the piece, so a frame made for one start is never read at another, and on a cup and a tube base as well as a legacy one
//   4  the same with the start FIXED and the base moving under it (a width, a cup and a tube coming in), so a frame made for one base is never read on another
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const T = process.env.T180_TREE ? path.resolve(process.env.T180_TREE) : path.join(__dirname, '..');
const D = require(path.join(T, 'src/core/document.js')), X = require(path.join(T, 'src/core/extend.js')), A = require(path.join(T, 'src/core/adapter.js'));
const P = require(path.join(T, 'src/geom/profile.js')), { normalize, psiAt } = P;
const DEG = Math.PI / 180;

// ── D483's code, the reference (d1e93dd) ──
const edgesOf = (Q) => [Q.u[0], Q.u[Q.u.length - 1]];   // profile.js:155
const uAt = (E, f) => (f < 0 ? -f * E[0] : f * E[1]);   // profile.js:156
function refCommonFractions(list, { maxAcross = 1, maxSeam = Math.PI / 180, cap = 40 } = {}) {   // profile.js:203, without its cache
  const step = Math.max(1, Math.ceil(list.length / cap)), ps = list.filter((_, i) => i % step === 0 || i === list.length - 1).map((p) => normalize(p));
  return refFractionsOf(ps, maxAcross, maxSeam);
}
function refFractionsOf(ps, maxAcross, maxSeam) {   // profile.js:211-225
  const Es = ps.map(edgesOf), R = Math.max(...Es.map((e) => -e[0])), Lw = Math.max(...Es.map((e) => e[1]));
  const f0 = R > 0 ? -1 : 0, f1 = Lw > 0 ? 1 : 0, N = 4000, fine = []; for (let i = 0; i <= N; i++) fine.push(f0 + (f1 - f0) * i / N);
  const m = [0];
  for (let i = 1; i <= N; i++) {
    const a = fine[i - 1], b = fine[i], side = (a + b) / 2 < 0 ? R : Lw;
    let d = 0; for (let k = 0; k < ps.length; k++) d = Math.max(d, Math.abs(psiAt(ps[k], uAt(Es[k], b)) - psiAt(ps[k], uAt(Es[k], a))));
    m.push(m[i - 1] + (b - a) * side / maxAcross + d / maxSeam);
  }
  const K = Math.max(2, Math.ceil(m[N]) + 1), out = []; let j = 0;
  for (let k = 0; k < K; k++) { const target = m[N] * k / (K - 1); while (j < N - 1 && m[j + 1] < target) j++; const t = m[j + 1] > m[j] ? (target - m[j]) / (m[j + 1] - m[j]) : 0; out.push(fine[j] + (fine[j + 1] - fine[j]) * Math.min(1, Math.max(0, t))); }
  out[0] = f0; out[K - 1] = f1;
  return out;
}
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));   // adapter.js:88
function refEdgeProfile(base, e, s, nE, er = e) {   // adapter.js:107-114
  const Q = normalize(base), hr = -Q.u[0], hl = Q.u[Q.u.length - 1], us = [...Q.u];
  for (let k = 0; k <= nE; k++) { const f = s + ((1 - s) * k) / nE; us.push(hl * f, -hr * f); }
  us.sort((a, b) => a - b);
  const u = us.filter((x, i) => i === 0 || x - us[i - 1] > 1e-12);
  const psi = u.map((x) => { const h = x < 0 ? hr : hl, r = h > 0 ? Math.abs(x) / h : 0; return psiAt(Q, x) + (r > s ? (x < 0 ? er : e) * DEG * smooth((r - s) / (1 - s)) : 0); });
  return { font: Q.font === 'tube' ? 'tube-edge' : 'edge', u, psi, material: Q.material };
}

/** byte for byte: every number by Object.is (-0 told from 0), arrays and plain objects key by key */
function sameDeep(a, b, at = '') {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${at}: ${a} / ${b}`;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return `${at}: keys ${ka} / ${kb}`;
  for (const k of ka) { const d = sameDeep(a[k], b[k], `${at}.${k}`); if (d) return d; }
  return null;
}
/** the pieces an edge or tube is built for: the public fixtures and pieces laid here */
function documents() {
  const docs = [];
  const FX = path.join(T, 'test', 'fixtures');
  for (const f of fs.readdirSync(FX).filter((f) => f.endsWith('.core2.json'))) docs.push([f, D.parse(fs.readFileSync(path.join(FX, f), 'utf8'))]);
  const LAID = { edge: { e: 20 }, sides: { e: -5, er: 12, s: 0.7 }, 'edge on a cup': { c: 30, e: 20 }, 'tube and edge': { t: 200, e: 10 } };
  for (const L of [60, 400, 1000]) for (const [name, targets] of Object.entries(LAID)) {
    const one = X.extend(D.createDoc('d484'), { length: L, targets });
    docs.push([`laid ${name} ${L} m`, one], [`laid ${name} ${L} m, then a turn with an edge`, X.extend(one, { length: L / 2, targets: { kh: 0.01, e: 35 } })]);
  }
  return docs;
}
/** each xsec piece's chord segments: the list of its cross-sections xsecSegments made (its first segment's start, then every segment's end) */
function chordRuns(doc) {
  if (!doc.pieces.length) return [];   // an empty fixture has no segments
  const runs = [], segs = A.toSegments(doc);
  for (let i = 0; i < segs.length;) {
    const g = segs[i]; if (!g.chord || !g.fractions) { i++; continue; }
    let j = i; while (j + 1 < segs.length && segs[j + 1].id === g.id && segs[j + 1].fractions === g.fractions) j++;
    runs.push({ id: g.id, segs: segs.slice(i, j + 1), list: [g.blend.from, ...segs.slice(i, j + 1).map((x) => x.profile)] });
    i = j + 1;
  }
  return runs;
}

test('row 1: commonFractions equals D483\'s byte for byte on every list xsecSegments makes, and each segment carries those fractions', (t) => {
  let lists = 0, profiles = 0; const differ = [];
  for (const [name, doc] of documents()) for (const run of chordRuns(doc)) {
    lists++; profiles += run.list.length;
    const want = refCommonFractions(run.list), got = P.commonFractions(run.list), d = sameDeep(got, want);
    if (d) differ.push(`${name} ${run.id}: commonFractions${d}`);
    for (const g of run.segs) { const e = sameDeep(Array.from(g.fractions), want); if (e) { differ.push(`${name} ${run.id}: a segment's fractions${e}`); break; } }
  }
  t.diagnostic(`${lists} lists, ${profiles} cross-sections`);
  assert.ok(lists >= 30, `only ${lists} lists: the edge and tube pieces this row is for were not built`);
  assert.deepEqual(differ.slice(0, 10), [], `${differ.length} differ`);
});

test('row 2: the same on lists whose profiles sit on different knots: grouped, interleaved, repeated, and with the largest step in a later group', () => {
  const legacy = A.profileAt('bowl', 12, 2), cup = A.cupProfile('bowl', 14, 40), tube = A.tubeProfile(12, 260);
  const edgesOn = (base, es, s, nE) => es.map((e) => A.edgeProfile(base, e, s, nE, -e / 2));
  const a = edgesOn(legacy, [0, 5, 10, 20], 0.6, 30), b = edgesOn(cup, [3, 30, 60], 0.75, 45), c = edgesOn(tube, [0, 8], 0.5, 20);
  const LISTS = {
    'two groups': [...a, ...b], 'three groups interleaved': [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2]], 'repeats': [a[1], a[1], b[0], b[0], a[1]],
    'largest step last': [...a.slice(0, 2), b[2]], 'plain profiles': [legacy, cup, tube, legacy], 'one profile': [b[1]], 'a long list (subsampled)': Array.from({ length: 95 }, (_, i) => [a, b, c][i % 3][i % 2]),
  };
  const wide = edgesOn(A.profileAt('bowl', 15, 2), [0, 5, 10, 20], 0.6, 30);   // as many knots as `a`, at other u
  LISTS['as many knots, other u'] = [a[0], wide[1], a[2], wide[3]];
  for (const [name, list] of Object.entries(LISTS)) for (const opt of [{}, { maxAcross: 0.5, maxSeam: 2 * DEG }]) {
    const d = sameDeep(P.commonFractions(list, opt), refCommonFractions(list, opt));
    assert.equal(d, null, `${name} ${JSON.stringify(opt)}: ${d}`);
  }
  // two lists that differ only in the knots of their second profile (its ψ the same numbers), asked one after the other: the second is its own answer, not the first's
  const moved = { ...a[1], u: a[1].u.map((x) => x * 1.25) }, opt = { maxAcross: 0.75 };
  for (const list of [[a[0], a[1]], [a[0], moved]]) { const d = sameDeep(P.commonFractions(list, opt), refCommonFractions(list, opt)); assert.equal(d, null, `the list ending ${list[1] === moved ? 'on the moved knots' : 'as laid'}: ${d}`); }
});

test('row 3: every chord end of an edge piece carries the profile edgeProfile makes alone there, with e, er and the start moving along the piece, on a legacy, cup and tube base', (t) => {
  let ends = 0; const differ = [];
  const CASES = { 'start moves': { e: 25, s: 0.8 }, 'sides and start move': { e: 30, er: -8, s: 0.55 }, 'edge on a cup, start moves': { c: 40, e: 15, s: 0.75 }, 'tube, start moves': { t: 220, e: 12, s: 0.6 } };
  for (const [name, targets] of Object.entries(CASES)) for (const L of [100, 700]) {
    const doc = X.extend(D.createDoc('d484'), { length: L, targets }), Q = doc.pieces[0], segs = A.toSegments(doc), n = segs.length;
    const at = (j) => D.valuesAt(Q, (Q.length * j) / n), E = Array.from({ length: n + 1 }, (_, j) => at(j));
    const nE = Math.max(A.EDGE_MIN_N, Math.ceil(1.5 * Math.max(...E.map((x) => Math.max(Math.abs(x.e), Math.abs(x.er))))));
    const starts = new Set(E.map((x) => x.s));
    assert.ok(starts.size > n / 2, `${name} ${L} m: the start takes only ${starts.size} values over ${n + 1} chord ends`);
    const base = (x) => (Q.tube ? A.tubeProfile(x.w, x.t) : Q.cup ? A.cupProfile(Q.family, x.w, x.c) : A.profileAt(Q.family, x.w, x.r));
    for (let j = 0; j <= n; j++) {
      ends++;
      const want = refEdgeProfile(base(E[j]), E[j].e, E[j].s, nE, E[j].er), got = j ? segs[j - 1].profile : segs[0].blend.from, d = sameDeep(got, want);
      if (d) { differ.push(`${name} ${L} m chord end ${j}${d}`); break; }
    }
  }
  t.diagnostic(`${ends} chord ends`);
  assert.deepEqual(differ, []);
});

test('row 4: every chord end of an edge piece carries the profile edgeProfile makes alone there, with the start fixed and the base moving under it: a width, a cup and a tube coming in', (t) => {
  let ends = 0; const differ = [];
  const CASES = { 'width comes in': { w: 16, e: 20 }, 'cup comes in': { c: 40, e: 15 }, 'tube comes in': { t: 220, e: 12 } };
  for (const [name, targets] of Object.entries(CASES)) for (const L of [100, 700]) {
    const doc = X.extend(D.createDoc('d484'), { length: L, targets }), Q = doc.pieces[0], segs = A.toSegments(doc), n = segs.length;
    const at = (j) => D.valuesAt(Q, (Q.length * j) / n), E = Array.from({ length: n + 1 }, (_, j) => at(j));
    const nE = Math.max(A.EDGE_MIN_N, Math.ceil(1.5 * Math.max(...E.map((x) => Math.max(Math.abs(x.e), Math.abs(x.er))))));
    const key = (x) => `${x.w} ${x.c} ${x.t} ${x.r}`, bases = new Set(E.map(key)), byStart = new Map();   // the start is fixed to within a last bit, so it repeats
    for (const x of E) { if (!byStart.has(x.s)) byStart.set(x.s, new Set()); byStart.get(x.s).add(key(x)); }
    assert.ok(Math.max(...[...byStart.values()].map((b) => b.size)) > n / 4, `${name} ${L} m: no start recurs on many bases (${byStart.size} starts)`);
    assert.ok(bases.size > n / 2, `${name} ${L} m: the base takes only ${bases.size} values over ${n + 1} chord ends`);
    const base = (x) => (Q.tube ? A.tubeProfile(x.w, x.t) : Q.cup ? A.cupProfile(Q.family, x.w, x.c) : A.profileAt(Q.family, x.w, x.r));
    for (let j = 0; j <= n; j++) {
      ends++;
      const want = refEdgeProfile(base(E[j]), E[j].e, E[j].s, nE, E[j].er), got = j ? segs[j - 1].profile : segs[0].blend.from, d = sameDeep(got, want);
      if (d) { differ.push(`${name} ${L} m chord end ${j}${d}`); break; }
    }
  }
  t.diagnostic(`${ends} chord ends`);
  assert.deepEqual(differ, []);
});
