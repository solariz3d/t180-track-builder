// geom_ramp.test.js: node --test test/geom_ramp.test.js. Font ramps (the librarian's ruling on D166 §5: "Fonts RAMP;
// they never jump ... smoothstep in s"). Stated before these tests were written:
//   · NO STEP AT THE SEAM: every vertex of the entering piece's first row lies within 2.2e-3 m of the previous piece's
//     last row (as a polyline across the road), plus 1e-5 m of float slack. Why 2.2e-3: both rows lie on the SAME
//     cross-section curve (the ramp starts at w = 0, the previous font exactly); they differ only in where the vertices
//     sit, so the gap is at most the sagitta of one across-edge: maxAcross · maxSeam / 8 = 1 m · 1° / 8 = 2.18e-3 m.
//   · The control: the same two fonts with rampM: 0 step by more than 1 m.
//   · The ramp ends on the entering font exactly: the row at rampM (20 m) lies on its own cross-section.
//   · Width ramps too: halfway (w = 0.5 at 10 m) a 26 m road going to 36 m is 31 m wide.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GDIR = process.env.GEOM_DIR || require('path').join(__dirname, '..', 'src', 'geom');
const G = require(GDIR);
const PR = require(require('path').join(GDIR, 'profile.js'));
const F = require('./geom_fixtures.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function toPolyline(x, row) {
  let best = Infinity;
  for (let k = 0; k + 1 < row.length; k++) {
    const a = row[k].p, d = sub(row[k + 1].p, a), w = sub(x, a), t = Math.max(0, Math.min(1, dot(w, d) / (dot(d, d) || 1)));
    best = Math.min(best, len(sub(w, [d[0] * t, d[1] * t, d[2] * t])));
  }
  return best;
}
const BOUND = 1 * (Math.PI / 180) / 8 + 1e-5;
const WIDE = F.prof('flat', [-18, 0, 18], [0, 0, 0]);
function step(fa, fb, opts = {}) {
  const segs = [{ id: 'a', kind: 'road', length: 40, k0: 0.01, k1: 0.01, profile: fa }, { id: 'b', kind: 'road', length: 60, k0: 0.01, k1: 0.01, profile: fb }];
  const m = G.buildMesh(G.buildPath(segs), segs, opts), [A, Bp] = m._state.pieces;
  return { m, A, Bp, worst: Math.max(...Bp.first.map((v) => toPolyline(v.p, A.last))) };
}

for (const [name, fa, fb] of [['flat → half-pipe', F.FLAT, F.HALFPIPE], ['half-pipe → flat', F.HALFPIPE, F.FLAT], ['half-pipe → wall-ride (past vertical)', F.HALFPIPE, F.WALLRIDE], ['flat 26 m → flat 36 m', F.FLAT, WIDE]]) {
  test(`no step at the seam, ${name}: the entering row lies on the leaving row within ${BOUND.toExponential(2)} m`, () => {
    const { worst } = step(fa, fb);
    assert.ok(worst <= BOUND, `step ${worst} m`);
  });
}
test('control: with rampM: 0 the same fonts step by more than 1 m (the check can see a jump)', () => {
  assert.ok(step(F.FLAT, F.HALFPIPE, { rampM: 0 }).worst > 1);
  assert.ok(step(F.FLAT, WIDE, { rampM: 0 }).worst > 1);
});
test('the ramp ends on the entering font: the row at 20 m lies on its own cross-section', () => {
  const segs = [{ id: 'a', kind: 'road', length: 40, profile: F.FLAT }, { id: 'b', kind: 'road', length: 60, profile: F.HALFPIPE }];
  // every sample a station (maxStep 0.5 on a 0.5 m step), so the mesh has rows at 60 m (the ramp's end) and at 59.5 m
  const p = G.buildPath(segs, { step: 0.5 }), Bp = G.buildMesh(p, segs, { maxStep: 0.5, chordErr: 1e-9 })._state.pieces[1];
  const P = PR.normalize(F.HALFPIPE), c = Bp.cells[0], K = Bp.K, F0 = Bp.F;
  const rowAt = (s) => { const r = c.rowS.findIndex((x) => Math.abs(x - s) < 1e-9); assert.ok(r >= 0, `a row at ${s}`); return r; };
  const off = (s) => {                                    // worst distance of the mesh row at s from the font's own section
    const sm = p.samples.find((x) => Math.abs(x.s - s) < 1e-9), r = rowAt(s); let worst = 0;
    Bp.Us.forEach((u, k) => {
      const [X, Y] = PR.offsetAt(P, u), w = sm.pos.map((v, d) => v + sm.L[d] * X + sm.U[d] * Y), d = sub(w, F0.o);
      const want = [dot(d, F0.L), dot(d, F0.U), dot(d, F0.T)], got = [0, 1, 2].map((j) => c.positions[(r * K + k) * 3 + j]);
      worst = Math.max(worst, len(sub(want, got)));
    });
    return worst;
  };
  assert.ok(off(60) < 1e-5, `at 20 m the row is the half-pipe (off by ${off(60)} m)`);
  assert.ok(off(59.5) > 1e-4, 'at 19.5 m it is still blending (the check can tell)');
});
test('width ramps: halfway through a 26 m → 36 m ramp (w = 0.5) the road is 31 m wide', () => {
  const A = PR.normalize(F.FLAT), Bw = PR.normalize(WIDE), H = PR.blend(A, Bw, PR.smoothstep(0.5));
  assert.ok(Math.abs(H.u[0] + 15.5) < 1e-12 && Math.abs(H.u[H.u.length - 1] - 15.5) < 1e-12, JSON.stringify(H.u));
  const segs = [{ id: 'a', kind: 'road', length: 40, profile: F.FLAT }, { id: 'b', kind: 'road', length: 60, profile: WIDE }];
  const p = G.buildPath(segs, { step: 0.5 }), Bp = G.buildMesh(p, segs, { maxStep: 0.5, chordErr: 1e-9 })._state.pieces[1];
  // with every sample a station, the cell's row at s = 50 (10 m into the ramp) spans 31 m
  const c = Bp.cells[0], r = c.rowS.findIndex((s) => Math.abs(s - 50) < 1e-9), K = Bp.K;
  assert.ok(r >= 0, 'a row at 50 m');
  const x0 = c.positions[(r * K) * 3], x1 = c.positions[(r * K + K - 1) * 3];
  assert.ok(Math.abs(x1 - x0 - 31) < 1e-4, `width at 10 m into the ramp: ${x1 - x0}`);
});
test('smoothstep: 0 and 1 at the ends, 0.5 halfway, and flat at both ends (no kink where a ramp starts or stops)', () => {
  assert.strictEqual(PR.smoothstep(0), 0); assert.strictEqual(PR.smoothstep(1), 1); assert.strictEqual(PR.smoothstep(0.5), 0.5);
  assert.ok(PR.smoothstep(1e-4) < 1e-7 && 1 - PR.smoothstep(1 - 1e-4) < 1e-7);
});
test('edges: same font twice has no ramp; a ramp longer than its piece still ends on the entering font', () => {
  const same = [{ id: 'a', kind: 'road', length: 30, profile: F.FLAT }, { id: 'b', kind: 'road', length: 30, profile: F.FLAT }];
  assert.strictEqual(G.buildMesh(G.buildPath(same), same).cells.filter((c) => c.seam).length, 0, 'no seam between equal fonts');
  const short = [{ id: 'a', kind: 'road', length: 30, profile: F.FLAT }, { id: 'b', kind: 'road', length: 8, profile: F.HALFPIPE }];
  const Bp = G.buildMesh(G.buildPath(short), short)._state.pieces[1], P = PR.normalize(F.HALFPIPE);
  assert.strictEqual(Bp.ends.last.P.u.length, P.u.length);
  assert.ok(Bp.ends.last.P.u.every((u, i) => u === P.u[i]) && Bp.ends.last.P.psi.every((x, i) => x === P.psi[i]), 'the last row is the entering font');
});

// ── the document's `blend` field (A's resolve, p-d167-ramp-connector-A §4): { from, s0, length } | null. Stated before
// these tests: the field WINS over the geometry's own inheritance; a transition split across segments continues where
// it left off (no restart, no seam where the two segments share a profile); `blend: null` means no ramp at all. ──
const HP = F.HALFPIPE, FL = F.FLAT, bl = (s0) => ({ from: FL, s0, length: 20 });
test('document blend: { from, s0: 0, length: 20 } on the entering word equals the geometry\'s own default ramp', () => {
  const own = [{ id: 'a', kind: 'road', length: 40, profile: FL }, { id: 'b', kind: 'road', length: 60, profile: HP }];
  const doc = [own[0], { ...own[1], blend: bl(0) }];
  const A = G.buildMesh(G.buildPath(own), own), B = G.buildMesh(G.buildPath(doc), doc);
  const arr = (m) => m.scene.root.children.map((c) => [c.name, Array.from(c.children[0].positions)]);
  assert.deepStrictEqual(arr(B), arr(A));
});
test('document blend: a transition split across two segments of one word continues (no restart, no step, no seam)', () => {
  const segs = [{ id: 'a', kind: 'road', length: 40, profile: FL }, { id: 'b1', kind: 'road', length: 12, profile: HP, blend: bl(0) },
    { id: 'b2', kind: 'road', length: 48, profile: HP, blend: bl(12) }];
  const m = G.buildMesh(G.buildPath(segs), segs), [, B1, B2] = m._state.pieces;
  const worst = Math.max(...B2.first.map((v) => toPolyline(v.p, B1.last)));
  assert.ok(worst < 1e-9, `the two segments' rows coincide at the cut (step ${worst} m)`);
  assert.ok(!m.cells.some((c) => c.seam && c.name.includes('b2')), 'no seam where the transition continues');
  // at the cut, 12 m into a 20 m ramp, the surface is MID-blend (w = smoothstep(0.6)), not already the half-pipe
  const mid = PR.normalize(PR.blend(PR.normalize(FL), PR.normalize(HP), PR.smoothstep(12 / 20)));
  assert.ok(B1.ends.last.P.psi.length === mid.psi.length && B1.ends.last.P.psi.every((x, i) => Math.abs(x - mid.psi[i]) < 1e-12)
    && B1.ends.last.P.u.every((x, i) => Math.abs(x - mid.u[i]) < 1e-12), 'the cut sits at w = smoothstep(12/20)');
  const whole = [segs[0], { id: 'b', kind: 'road', length: 60, profile: HP, blend: bl(0) }];
  const W = G.buildMesh(G.buildPath(whole), whole)._state.pieces[1];
  // 20 m into the word (8 m into b2) the surface is the half-pipe, as in the unsplit word
  assert.strictEqual(B2.ends.last.P.u.length, PR.normalize(HP).u.length);
  assert.ok(W.ends.last.P.psi.every((x, i) => x === B2.ends.last.P.psi[i]));
});
test('document blend: null means no ramp, even after a different font (the document spoke; the geometry adds none)', () => {
  const segs = [{ id: 'a', kind: 'road', length: 40, profile: FL }, { id: 'b', kind: 'road', length: 60, profile: HP, blend: null }];
  const m = G.buildMesh(G.buildPath(segs), segs), [A, Bp] = m._state.pieces;
  assert.ok(Math.max(...Bp.first.map((v) => toPolyline(v.p, A.last))) > 1, 'the fonts step, as the document asked');
});
test('document blend: a malformed field is refused loudly (no from, negative s0, zero length)', () => {
  const base = { id: 'a', kind: 'road', length: 40, profile: FL };
  for (const b of [{ s0: 0, length: 20 }, { from: FL, s0: -1, length: 20 }, { from: FL, s0: 0, length: 0 }]) {
    const segs = [base, { id: 'b', kind: 'road', length: 30, profile: HP, blend: b }];
    assert.throws(() => G.buildMesh(G.buildPath(segs), segs), /blend needs/);
  }
});
