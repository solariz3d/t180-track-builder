// core_sculpt.test.js: node --test test/core_sculpt.test.js   (heavy: run under the heavy-run lock, --max-old-space-size=4096)
// src/core/sculpt.js (D185, pane E; the spec's GO §3, ref 10 §1–§2), and TEST 3 of the D185 registration (pane B, sealed
// 2026-09-28 07:34, sha256 978be18b…): 30 brushes (5 channels × 25/50/75% of the length × r ∈ {20, 100} m) on generated track 0,
// left OPEN, each on a fresh copy. W = [s₀ − r, s₀ + r]; W⁺ = W widened by 2 knot spans each side.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./core_helpers.js');
const D = require('../src/core/document.js');
const { toPath } = require('../src/core/adapter.js');
const S = require('../src/core/sculpt.js');

const BASE = H.docFrom(H.gen()[0]);
const DELTA = { kh: 0.002, kv: 0.001, phi: 10 * Math.PI / 180, w: 5, r: 0.5 };
const samples = (doc) => toPath(doc).path.samples;
const OLD = samples(BASE), LEN = OLD[OLD.length - 1].s;
const OFF = S.pieceOffsets(BASE);
const SPAN = Math.max(...BASE.pieces.map((P) => { const t = [0, ...P.knots, P.length]; return Math.max(...t.slice(1).map((x, k) => x - t[k])); }));
/** A channel's value at lap distance s (the piece holding s; at a joint, the later piece). */
function chAt(doc, ch, s, side = 0) {
  let p = OFF.findIndex((o, i) => s >= o && (i === OFF.length - 1 || s < OFF[i + 1])); if (p < 0) p = 0;
  return D.channelAt(doc.pieces[p], ch, Math.min(s - OFF[p], doc.pieces[p].length));
}
const same = (a, b) => Object.is(a, b);
const sameVec = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const FIELDS = ['pos', 'T', 'L', 'U', 'kvec', 'roll', 'bankG', 'grade'];

/** 02 §3's discrete curvature from three positions. */
function kDisc(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - b[0], c[1] - b[1], c[2] - b[2]], lu = Math.hypot(...u), lw = Math.hypot(...w);
  return Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (lu * lw)))) / ((lu + lw) / 2);
}

for (const ch of Object.keys(DELTA)) for (const frac of [0.25, 0.5, 0.75]) for (const r of [20, 100]) {
  const s0 = frac * LEN, lo = s0 - r, hi = s0 + r, loP = lo - 2 * SPAN, hiP = hi + 2 * SPAN;
  test(`test 3: brush ${ch} +${DELTA[ch]} at ${frac * 100}% (s₀ ${s0.toFixed(0)} m), r ${r} m: bit for bit outside, no kink`, () => {
    const res = S.sculpt(BASE, { channel: ch, s0, r, delta: DELTA[ch] }), doc = res.doc;
    assert.ok(res.changed.length, `the brush changed nothing (${res.note})`);
    // 3a · control points whose support does not meet W: identical doubles, every channel
    doc.pieces.forEach((P, p) => { if (P.type !== 'road') return; const t = D.knotVector(P);
      for (const c of D.CHANNELS) P.channels[c].forEach((v, i) => { if (OFF[p] + t[i + 4] < lo || OFF[p] + t[i] > hi) assert.ok(same(v, BASE.pieces[p].channels[c][i]), `${c} piece ${p} control point ${i} moved`); }); });
    // 3a · channel values at every sample outside W⁺
    const NEW = samples(doc);
    assert.equal(NEW.length, OLD.length);
    for (const x of NEW) if (x.s < loP || x.s > hiP) for (const c of D.CHANNELS) assert.ok(same(chAt(doc, c, x.s).v, chAt(BASE, c, x.s).v), `${c} value at s ${x.s}`);
    // 3a · geometry
    if (ch === 'phi' || ch === 'w' || ch === 'r') {
      NEW.forEach((x, i) => { if (x.s >= loP && x.s <= hiP) return; for (const f of FIELDS) { const a = x[f], b = OLD[i][f]; assert.ok(Array.isArray(a) ? sameVec(a, b) : same(a, b), `${f} at s ${x.s}`); } });
    } else {
      NEW.forEach((x, i) => { if (x.s < loP) for (const f of FIELDS) { const a = x[f], b = OLD[i][f]; assert.ok(Array.isArray(a) ? sameVec(a, b) : same(a, b), `before: ${f} at s ${x.s}`); } });
      const after = []; NEW.forEach((x, i) => { if (x.s > hiP && Math.abs(x.s / 10 - Math.round(x.s / 10)) < 1e-9) after.push(i); });
      let worst = 0;
      for (let a = 0; a < after.length; a++) for (let b = a + 1; b < after.length; b++) {
        const i = after[a], j = after[b], dn = Math.hypot(...[0, 1, 2].map((k) => NEW[i].pos[k] - NEW[j].pos[k])), dd = Math.hypot(...[0, 1, 2].map((k) => OLD[i].pos[k] - OLD[j].pos[k]));
        worst = Math.max(worst, Math.abs(dn - dd));
      }
      assert.ok(worst < 1e-6, `after the window the track moved non-rigidly: a pairwise distance changed by ${worst} m`);
    }
    // 3b · no kink at s₀ ± r and at the edges of W⁺: value C0 and slope C1, one-sided, δ = 1e-4 m
    const d = 1e-4; let steep = 0; for (let s = lo; s <= hi; s += 0.5) steep = Math.max(steep, Math.abs(chAt(doc, ch, s).d1 - chAt(BASE, ch, s).d1));
    assert.ok(steep > 0, 'the bump has no slope');
    for (const e of [lo, hi, loP, hiP]) {
      const f = (s) => chAt(doc, ch, s).v, jump = Math.abs(f(e + d) - f(e - d)), explained = Math.abs(chAt(doc, ch, e).d1) * 2 * d;
      assert.ok(jump - explained < 1e-9 * Math.abs(DELTA[ch]) + 1e-15, `${ch} value jump ${jump} at ${e}`);
      const right = (f(e + 2 * d) - f(e + d)) / d, left = (f(e - d) - f(e - 2 * d)) / d;
      assert.ok(Math.abs(right - left) < 1e-4 * steep + 1e-12, `${ch} slope jump ${Math.abs(right - left)} at ${e} (bump's steepest ${steep})`);
    }
    // 3b · geometric, on the BRUSH'S OWN CHANGE: the 02 §3 κ at 0.5 m chords, new minus old. Within ±5 m of each edge the brush
    // actually used (s₀ ± radiusUsed) and of W⁺, no step larger than the largest in the used window's middle half. (The sealed
    // rule reads κ of the brushed track itself, which also measures the BASE's own curvature slope: the D185 hand-back §3 shows
    // it fails with no brush at all, and on brushes that move no position. Its numbers are reported there, not asserted here.)
    const KD = []; for (let i = 1; i + 1 < NEW.length; i++) KD.push({ s: NEW[i].s, k: kDisc(NEW[i - 1].pos, NEW[i].pos, NEW[i + 1].pos) - kDisc(OLD[i - 1].pos, OLD[i].pos, OLD[i + 1].pos) });
    const ru = res.radiusUsed; let mid = 0; for (let i = 1; i < KD.length; i++) if (KD[i].s >= s0 - ru / 2 && KD[i].s <= s0 + ru / 2) mid = Math.max(mid, Math.abs(KD[i].k - KD[i - 1].k));
    for (const e of [s0 - ru, s0 + ru, loP, hiP]) { let edge = 0; for (let i = 1; i < KD.length; i++) if (Math.abs(KD[i].s - e) <= 5) edge = Math.max(edge, Math.abs(KD[i].k - KD[i - 1].k)); assert.ok(edge <= mid + 1e-12, `κ-change step ${edge} near the edge ${e}, the brush's interior largest ${mid}`); }
  });
}

// ── the brush's own contract ──
test('ref 10 §1: the smootherstep is 0, ½, 1 at 0, ½, 1, and its falloff is 1 at the centre and 0 at the edge and beyond', () => {
  assert.deepEqual([S.smootherstep(0), S.smootherstep(0.5), S.smootherstep(1), S.smootherstep(-1), S.smootherstep(2)], [0, 0.5, 1, 0, 1]);
  assert.deepEqual([S.falloff(0, 10), S.falloff(10, 10), S.falloff(-25, 10)], [1, 0, 0]);
});
test('a brush never reaches a control point whose support leaves the window (the rule, on a bare knot vector)', () => {
  const t = [0, 0, 0, 0, 10, 20, 30, 40, 50, 60, 70, 80, 80, 80, 80], c = Array.from({ length: 11 }, (_, i) => i);
  const { ctrl, changed } = S.brushControls(c, t, { s0: 40, r: 25, delta: 1 });
  assert.deepEqual(changed, [5]);                           // control point 5's support [t₅, t₉] = [20, 60] is the only one inside [15, 65]
  ctrl.forEach((v, i) => { if (i !== 5) assert.ok(Object.is(v, c[i])); });
});
test('a brush smaller than 3 knot spans is widened to 3 of the spans UNDER it, and says so', () => {
  const s0 = LEN / 2, res = S.sculpt(BASE, { channel: 'phi', s0, r: 5, delta: 0.1 }), ru = res.radiusUsed;
  // the spans that overlap the window actually used (A's catch, D186: not the whole piece's largest span)
  let under = 0; BASE.pieces.forEach((P, p) => { const t = [0, ...P.knots, P.length]; for (let k = 0; k + 1 < t.length; k++) if (OFF[p] + t[k + 1] >= s0 - ru && OFF[p] + t[k] <= s0 + ru) under = Math.max(under, t[k + 1] - t[k]); });
  assert.ok(res.changed.length && ru === 3 * under, `radius ${ru}, 3 spans under it ${3 * under}`);
  assert.match(res.note, /widened/);
});
test('the joints stay C1: a brush across a joint passes the document\'s own joint check, and the input is untouched', () => {
  const before = D.serialize(BASE), s0 = OFF[3];
  const res = S.sculpt(BASE, { channel: 'kh', s0, r: 100, delta: 0.002 });
  assert.ok(res.changed.some((c) => c.piece === 3) && res.changed.some((c) => c.piece === 2), JSON.stringify(res.changed));
  D.checkDoc(res.doc);
  assert.equal(D.serialize(BASE), before);
});
test('an unknown channel and a bad brush are refused by name', () => {
  assert.throws(() => S.sculpt(BASE, { channel: 'bank', s0: 100, r: 50, delta: 1 }), /BAD_CHANNEL/);
  assert.throws(() => S.sculpt(BASE, { channel: 'kh', s0: 100, r: 0, delta: 1 }), /BAD_BRUSH/);
});
