// core_knots.test.js: node --test test/core_knots.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// KNOT INSERTION in the core's document (src/core/document.js; ref 09 §6, Boehm): finer knots under a narrow brush, with the
// curve unchanged. Its purpose is the D185 sculpt limit: with knots every 20 m, a C2 brush of r = 20 m had to widen, and the
// three r = 20 kh / kv brushes missed the no-kink rule at their asked edges. After refining the knots under the window, the
// same brushes stay C2 at s₀ ± r.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { toPath } = require('../src/core/adapter.js');
const S = require('../src/core/sculpt.js');
const H = require('./core_helpers.js');
const { basis } = require('../tools/piecewise.cjs');

const DEG = Math.PI / 180;
/** A piece with uneven knots and every channel curving, so an insertion has something to preserve. */
function curvy() {
  const f = { kh: (s) => 0.004 * Math.sin(s / 37) + 1e-5 * s, kv: (s) => 5e-4 * Math.cos(s / 23), phi: (s) => 0.3 * Math.sin(s / 51), w: (s) => 31 + 4 * Math.sin(s / 29), r: (s) => 3 + Math.cos(s / 41) };
  return D.appendPiece(D.createDoc('k'), D.roadPiece({ length: 300, channels: f, knots: [17, 40, 41.5, 90, 150, 222, 280] }));
}
/** One channel of a piece from raw control points (no quantisation), by the basis itself. */
function rawAt(U, P, s) { const b = basis(U, s); let v = 0; for (let a = 0; a < 4; a++) v += P[b.first + a] * b.N[a]; return v; }

test('Boehm\'s rule is exact: inserting knots (first span, last span, uneven spacing) leaves each channel unchanged to float rounding at 3,001 samples', () => {
  const P = curvy().pieces[0];
  for (const ch of D.CHANNELS) {
    let U = D.knotVector(P), C = P.channels[ch].slice();
    for (const t of [3.25, 299.5, 40.75, 120, 60.1]) { const Q = D.boehm(U, C, t); U = [...U.slice(0, 4), ...[...U.slice(4, -4), t].sort((a, b) => a - b), ...U.slice(-4)]; C = Q; }
    let worst = 0; for (let i = 0; i <= 3000; i++) { const s = (300 * i) / 3000; worst = Math.max(worst, Math.abs(rawAt(U, C, s) - D.channelAt(P, ch, s).v)); }
    const scale = Math.max(...P.channels[ch].map(Math.abs));
    assert.ok(worst <= 1e-12 * scale, `${ch}: ${worst} (scale ${scale})`);
  }
});

test('inserting knots leaves every channel unchanged at dense samples: within half the channel\'s quantisation step (the three new points are quantised), and bit for bit outside the new knot\'s span and the two either side', () => {
  const P = curvy().pieces[0], t = 120, Q = D.insertKnot(P, t);
  assert.deepEqual(Q.knots, [17, 40, 41.5, 90, 120, 150, 222, 280]);
  for (const ch of D.CHANNELS) {
    let worst = 0, far = 0;
    for (let i = 0; i <= 3000; i++) {
      const s = (300 * i) / 3000, a = D.channelAt(P, ch, s).v, b = D.channelAt(Q, ch, s).v;
      worst = Math.max(worst, Math.abs(a - b));
      if (s < 40 || s >= 280) { if (!Object.is(a, b)) far++; }   // outside the new knot's span [90, 150) and the two spans either side: [0, 40) and [280, 300]
    }
    assert.ok(worst <= 0.5 * 10 ** -D.DEC[ch] + 1e-15, `${ch}: moved ${worst}, half a step is ${0.5 * 10 ** -D.DEC[ch]}`);
    assert.equal(far, 0, `${ch}: ${far} samples changed outside the affected spans`);
  }
});

test('refineKnots cuts every span over [a, b] to ≤ maxSpan, and leaves the spans outside it with the same knots', () => {
  const d = curvy(), { doc, inserted } = D.refineKnots(d, 'p1', 95, 160, 5);
  const t = [0, ...doc.pieces[0].knots, 300];
  for (let j = 0; j + 1 < t.length; j++) if (t[j + 1] > 95 && t[j] < 160) assert.ok(t[j + 1] - t[j] <= 5 + 1e-9, `span [${t[j]}, ${t[j + 1]}]`);
  for (const k of [17, 40, 41.5, 222, 280]) assert.ok(doc.pieces[0].knots.includes(k), `knot ${k} kept`);
  assert.ok(inserted.every((x) => x > 90 && x < 222), 'only the spans that overlap [95, 160] were cut');
  assert.equal(D.refineKnots(doc, 'p1', 95, 160, 5).doc, doc, 'nothing more to do: the same document');
});

test('knots inserted in a LATER piece\'s first span keep its joint C1 (the document checks every joint)', () => {
  let d = extend(D.createDoc('j'), { length: 120, first: { kh: 1 / 300 } });
  d = extend(d, { length: 160, transition: 100, targets: { kh: -1 / 150, phi: 15 * DEG } });
  const before = D.channelAt(d.pieces[1], 'kh', 0), { doc } = D.refineKnots(d, 'p2', 0, 10, 2);
  assert.ok(doc.pieces[1].knots[0] <= 2);
  const after = D.channelAt(doc.pieces[1], 'kh', 0);
  assert.equal(after.v, before.v);
  assert.ok(Math.abs(after.d1 - before.d1) <= (3 * 10 ** -D.DEC.kh) / doc.pieces[1].knots[0], `slope ${after.d1} vs ${before.d1}`);
});

test('the new knots serialise canonically (ascending, byte-exact on reload), and undo removes them', () => {
  const d = curvy(), { doc } = D.refineKnots(d, 'p1', 100, 130, 4), text = D.serialize(doc);
  assert.equal(D.serialize(D.parse(text)), text);
  const ks = JSON.parse(text).pieces[0].knots; assert.deepEqual(ks, [...ks].sort((a, b) => a - b));
  const h = D.commit(D.createHistory(d), doc);
  assert.equal(D.serialize(D.undo(h).present), D.serialize(d));
  assert.equal(D.undo(h).present.pieces[0].knots.length, 7);
});

test('refusals by name: a knot already there, outside the piece, a flight, a span under 1 cm', () => {
  const d = curvy(), P = d.pieces[0];
  assert.throws(() => D.insertKnot(P, 40), (e) => e.code === 'BAD_KNOT');
  assert.throws(() => D.insertKnot(P, 300), (e) => e.code === 'BAD_KNOT');
  assert.throws(() => D.insertKnot({ type: 'flight' }, 3), (e) => e.code === 'NOT_ROAD');
  assert.throws(() => D.refineKnots(d, 'p1', 0, 10, 0.001), (e) => e.code === 'BAD_SPAN');
  assert.throws(() => D.refineKnots(d, 'p9', 0, 10, 1), (e) => e.code === 'NO_PIECE');
});

// ── the D185 limit, fixed: the three r = 20 m brushes that missed (kh at 25% and 75%, kv at 25% on generated track 0) ──
const BASE = H.docFrom(H.gen()[0]), OFF = S.pieceOffsets(BASE), OLD = toPath(BASE).path.samples, LEN = OLD[OLD.length - 1].s;
const DELTA = { kh: 0.002, kv: 0.001 };
/** 02 §3's discrete curvature from three positions. */
function kDisc(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - b[0], c[1] - b[1], c[2] - b[2]], lu = Math.hypot(...u), lw = Math.hypot(...w);
  return Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (lu * lw)))) / ((lu + lw) / 2);
}
for (const [ch, frac] of [['kh', 0.25], ['kh', 0.75], ['kv', 0.25]]) {
  test(`after refining, the r = 20 m ${ch} brush at ${frac * 100}% stays C2 at its ASKED edges s₀ ± 20 (a D185 miss)`, () => {
    const r = 20, h = 5, s0 = frac * LEN, p = OFF.findIndex((o, i) => s0 >= o && (i === OFF.length - 1 || s0 < OFF[i + 1])), P = BASE.pieces[p], sl = s0 - OFF[p];
    assert.ok(sl - r - 3 * h > 0 && sl + r + 3 * h < P.length, 'the window and its margin lie inside one piece');
    const { doc: fine } = D.refineKnots(BASE, P.id, sl - r - 3 * h, sl + r + 3 * h, h), Pf = fine.pieces[p];
    // the brush at r = 20 exactly, by sculpt's own control-point rule (no widening): whole supports now fit inside the window
    const { ctrl, changed } = S.brushControls(Pf.channels[ch], D.knotVector(Pf), { s0: sl, r, delta: DELTA[ch] });
    assert.ok(changed.length >= 3, `${changed.length} control points carry the bump`);
    const pieces = fine.pieces.slice(); pieces[p] = { ...Pf, channels: { ...Pf.channels, [ch]: ctrl.map((v) => Number(v.toFixed(D.DEC[ch]))) } };
    const doc = D.checkDoc({ ...fine, pieces });
    // C2 at the asked edges: the change and its first two derivatives vanish there (the changed supports lie inside W)
    for (const e of [sl - r, sl + r]) {
      const a = D.channelAt(doc.pieces[p], ch, e), b = D.channelAt(Pf, ch, e);
      assert.ok(Math.abs(a.v - b.v) < 1e-12 && Math.abs(a.d1 - b.d1) < 1e-12 && Math.abs(a.d2 - b.d2) < 1e-12, `${ch} at ${e}: Δ ${a.v - b.v}, Δ′ ${a.d1 - b.d1}, Δ″ ${a.d2 - b.d2}`);
    }
    // and the sculpt test's geometric rule on the brush's own change, at the ASKED edges: within ±5 m of s₀ ± r no step of (κ_new − κ_old)
    // larger than the largest in the window's middle half (02 §3 κ at the adapter's samples)
    const NEW = toPath(doc).path.samples, REF = toPath(fine).path.samples;
    assert.equal(NEW.length, REF.length);
    const KD = []; for (let i = 1; i + 1 < NEW.length; i++) KD.push({ s: NEW[i].s, k: kDisc(NEW[i - 1].pos, NEW[i].pos, NEW[i + 1].pos) - kDisc(REF[i - 1].pos, REF[i].pos, REF[i + 1].pos) });
    let mid = 0; for (let i = 1; i < KD.length; i++) if (Math.abs(KD[i].s - s0) <= r / 2) mid = Math.max(mid, Math.abs(KD[i].k - KD[i - 1].k));
    for (const e of [s0 - r, s0 + r]) { let edge = 0; for (let i = 1; i < KD.length; i++) if (Math.abs(KD[i].s - e) <= 5) edge = Math.max(edge, Math.abs(KD[i].k - KD[i - 1].k)); assert.ok(edge <= mid + 1e-12, `κ-change step ${edge} near the edge ${e}; the middle's largest ${mid}`); }
  });
}

test('refining first does not move the track: the refined base\'s path is within 1 mm of the unrefined one', () => {
  const s0 = 0.25 * LEN, p = OFF.findIndex((o, i) => s0 >= o && (i === OFF.length - 1 || s0 < OFF[i + 1])), sl = s0 - OFF[p];
  const { doc: fine } = D.refineKnots(BASE, BASE.pieces[p].id, sl - 35, sl + 35, 5), A = toPath(fine).path.samples;
  let worst = 0; A.forEach((x, i) => { worst = Math.max(worst, Math.hypot(...[0, 1, 2].map((k) => x.pos[k] - OLD[i].pos[k]))); });
  assert.ok(worst < 1e-3, `moved ${worst} m`);
});
