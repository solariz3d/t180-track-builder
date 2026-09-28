// Tests for tools/fourier.cjs (M4, a track as one equation) and src/doc/equation.js (the loader), on SYNTHETIC laps
// only: a lap made from a known equation, read back as if the track reader had walked it. No real track is fitted here
// (an equation of a real track is its layout; design notes §12). And the privacy guard: no coefficient file is tracked,
// and the place they are written is ignored.
// Run: node --test --test-concurrency=4 test/fourier.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const F = require('../tools/fourier.cjs');
const EQ = require('../src/doc/equation.js');
const { resolve } = require('../src/doc/resolve.js');
const { buildPath } = require('../src/geom/index.js');

const REPO = path.resolve(__dirname, '..'), TAU = 2 * Math.PI, L = 3000, M = 750;
const ser = (net, c0, a, b) => ({ net, c0, a, b });
/** A closed lap from three-harmonic heading, pitch and roll series, as a read: stations every 4 m. */
function synth(ph = ser(0, 0.2, [0, 0, 0], [0.3, 0, 0])) {
  const c = F.closeLoop({ L, M, ds: L / M, pos: [[0, 0, 0]] }, ser(TAU, 0, [0, 0, 0.3], [0, 0, 0]), ser(0, 0, [0, 0.05, 0], [0, 0, 0]), ph);
  const st = c.path.samples.filter((x) => x.s < L - 1e-6 && Math.abs(x.s / 4 - Math.round(x.s / 4)) < 1e-9)
    .map((x) => ({ d: x.s, c: x.pos, f: x.T, n: x.U, wl: 10, wr: 12, psiL: [0, 5, 10, 20], psiR: [0, 2, 8, 30] }));
  return { read: { end: 'closed', stations: [...st, { closed: true, d: L }] }, closeGap: c.gap1 };
}

test('the closure projection closes a lap made from its series to within 1 mm', () => {
  assert.ok(synth().closeGap < 1e-3, `gap ${synth().closeGap} m`);
});

test('a lap made from three harmonics is rebuilt within 5 m and 5° on ≥ 95% of it at N ≤ 3', () => {
  const { out } = F.fitOne(synth().read);
  assert.ok(out.N !== null && out.N <= 3, `N = ${out.N}`);
  const row = out.sweep.find((r) => r.N === out.N);
  assert.ok(row.p95LineM < 0.5 && row.p95BankDeg < 0.5, JSON.stringify(row));
});

test('a lap that rolls over once (an inversion) keeps its whole roll turn and still fits at small N', () => {
  const { out } = F.fitOne(synth(ser(TAU, 0.2, [0, 0, 0], [0.3, 0, 0])).read);
  assert.strictEqual(out.turns.roll, 1);
  assert.ok(out.N !== null && out.N <= 3, `N = ${out.N}`);
});

test('an unclosed read is refused, not fitted', () => {
  const { read } = synth();
  assert.throws(() => F.sampleRead({ ...read, end: 'walk limit' }), /does not close/);
});

test('the loader opens the equation as a document that resolves and ends where the lap began (within 2 m)', () => {
  const { eq } = F.fitOne(synth().read, { equation: true, track: 'synthetic' });
  const { doc, words } = EQ.equationToDoc(eq);
  assert.ok(words > 100);
  const P = buildPath(resolve(doc).segments, { step: 4 });
  // the equation's own lap length (M equal chords of the read line, tools/fourier.cjs sampleRead), which is what the loader builds
  // within the document's own quantum per word (serial.js: lengths in 0.1 mm), and within 5 cm of the synthetic arc
  assert.ok(Math.abs(P.lengthM - eq.lapM) < 1e-4 * words && Math.abs(eq.lapM - L) < 0.05, `length ${P.lengthM}, equation ${eq.lapM}, ${words} words`);
  assert.ok(Math.hypot(...P._end.x) < 2, `end ${Math.hypot(...P._end.x)} m from the start`);
  assert.ok(Math.abs(P._end.theta - TAU) < 1e-3, `heading ${P._end.theta}`);
});

test('the loader turns an equation\'s jump into a jump word, and the document still resolves', () => {
  const { eq } = F.fitOne(synth().read, { equation: true, track: 'synthetic' });
  const { doc, jumps } = EQ.equationToDoc({ ...eq, jumps: [{ s: 1500, gap: 40, drop: 2 }] });
  assert.strictEqual(jumps, 1);
  assert.strictEqual(doc.words.filter((w) => w.word === 'jump').length, 1);
  assert.ok(resolve(doc).segments.length > 0);
});

test('a malformed equation is refused by name', () => {
  const { eq } = F.fitOne(synth().read, { equation: true });
  assert.throws(() => EQ.checkEquation({ ...eq, series: { ...eq.series, theta: { ...eq.series.theta, net: 1 } } }), /whole turns/);
  assert.throws(() => EQ.checkEquation({ ...eq, schema: 'x' }), /schema/);
});

test('privacy: no coefficient file is tracked, and reads/ (where they are written) is ignored', (t) => {
  // a copied tree (the seats' scratch copies for landing runs) is not a git work tree: nothing is tracked there, so there is
  // nothing to check, and the test says so rather than failing. In the real checkout it runs in full.
  if (spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: REPO, encoding: 'utf8' }).stdout.trim() !== 'true') { t.skip('not a git work tree (a copied tree): nothing is tracked here'); return; }
  const ls = spawnSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' });
  assert.strictEqual(ls.status, 0, 'git ls-files');
  const hits = ls.stdout.split('\n').filter((f) => /\.equation\.json$/i.test(f) || /^reads\//.test(f));
  assert.deepStrictEqual(hits, [], 'a coefficient file or a read is tracked');
  assert.strictEqual(spawnSync('git', ['check-ignore', '-q', 'reads/probe.equation.json'], { cwd: REPO }).status, 0, 'reads/ is not ignored');
});

test('privacy: the writer refuses a path git does not ignore', () => {
  assert.throws(() => F.writeLocal(path.join(REPO, 'docs', 'probe.equation.json'), '{}'), /does not ignore/);
});

// ── the shelf's known answers for the formulas M4 adds (docs/math 03 §1 "the half-sample shift", 01 §5) ──
test('03 §1, the half-sample shift: a cosine sampled at chord midpoints comes back as exactly that cosine in s', () => {
  const M = 64, L = 256, k = 3, f = (s) => Math.cos(2 * Math.PI * k * s / L) + 0.5 * Math.sin(2 * Math.PI * 5 * s / L);
  const x = Array.from({ length: M }, (_, j) => f((j + 0.5) * L / M));   // samples at the midpoints
  const g = F.halfShift(F.dft(x, 0, M), L, M);
  const want = { 3: [1, 0], 5: [0, 0.5] };
  for (let h = 1; h < 10; h++) { const [a, b] = want[h] || [0, 0]; assert.ok(Math.abs(g.a[h - 1] - a) < 1e-12 && Math.abs(g.b[h - 1] - b) < 1e-12, `harmonic ${h}: ${g.a[h - 1]}, ${g.b[h - 1]}`); }
});

/** A read of a closed curve given by pos(t), t ∈ [0, 1), stations every ~4 m of its arc, flat road. */
function curveRead(pos, n, up = [0, 1, 0]) {
  const st = []; let d = 0;
  for (let i = 0; i < n; i++) { const c = pos(i / n); if (i) { const p = st[i - 1].c; d += Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]); } st.push({ d, c, f: [0, 0, 1], n: typeof up === 'function' ? up(i / n) : up, wl: 5, wr: 5, psiL: [0, 0, 0, 0], psiR: [0, 0, 0, 0] }); }
  const p0 = st[0].c, pl = st[n - 1].c; return { end: 'closed', stations: [...st, { closed: true, d: d + Math.hypot(p0[0] - pl[0], p0[1] - pl[1], p0[2] - pl[2]) }] };
}

test('01 §5, equal chords: a circle read is resampled into chords all of one length, and the last point closes the lap', () => {
  const R = 100, sm = F.sampleRead(curveRead((t) => [R * Math.sin(2 * Math.PI * t), 0, R * Math.cos(2 * Math.PI * t)], 157));
  const ch = sm.pos.map((p, i) => { const q = sm.pos[(i + 1) % sm.M]; return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); });
  assert.ok(Math.max(...ch) - Math.min(...ch) < 1e-6, `chords ${Math.min(...ch)}–${Math.max(...ch)}`);
  assert.ok(Math.abs(ch[0] - sm.ds) < 1e-6 && sm.closeM < 1e-6, `c ${sm.ds}, closing ${sm.closeM}`);
  assert.strictEqual(sm.nets.theta / (2 * Math.PI), 1);
});

test('01 §5, through vertical: a vertical loop keeps its heading and gains one whole turn of pitch (the geometry\'s convention)', () => {
  const R = 60, loop = (t) => [0, R - R * Math.cos(2 * Math.PI * t), R * Math.sin(2 * Math.PI * t)];
  const inward = (t) => [0, Math.cos(2 * Math.PI * t), -Math.sin(2 * Math.PI * t)];   // the road's up points to the loop's centre
  const sm = F.sampleRead(curveRead(loop, 95, inward));
  assert.deepStrictEqual([sm.nets.theta / (2 * Math.PI), sm.nets.pitch / (2 * Math.PI), sm.nets.roll / (2 * Math.PI)], [0, 1, 0]);
});
