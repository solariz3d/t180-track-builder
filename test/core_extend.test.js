// core_extend.test.js: node --test test/core_extend.test.js. EXTEND (the spec's GO §2), judged as the sealed registration
// judges it (the core's registered test 2, written before this code): through the ADAPTER's samples, curvature from positions by ref 02 §3 at
// 1 m chords AND from |kvec|. A continued circle stays a circle and a continued clothoid stays a clothoid, with no handle
// touched; a handle's target is reached by the Bloss blend with no step in the channel's rate (ref 09 §2).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend, bloss } = require('../src/core/extend.js');
const { toPath } = require('../src/core/adapter.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], lenv = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** ref 02 §3: κ ≈ ∠(u, w) / ((|u| + |w|)/2). */
const kappa3 = (a, b, c) => { const u = sub(b, a), w = sub(c, b), cos = Math.max(-1, Math.min(1, dot(u, w) / (lenv(u) * lenv(w)))); return Math.acos(cos) / ((lenv(u) + lenv(w)) / 2); };
/** The extension's samples at 1 m spacing (s ≥ the join), with both curvature measures at each interior one. */
function extension(doc, joinS) {
  const { path } = toPath(doc, { step: 1, segM: 2 }), S = path.samples.filter((x) => Math.abs(x.s - Math.round(x.s)) < 1e-9);
  const out = []; for (let i = 1; i + 1 < S.length; i++) if (S[i].s > joinS + 1e-9) out.push({ s: S[i].s - joinS, pos: S[i].pos, T: S[i].T, k3: kappa3(S[i - 1].pos, S[i].pos, S[i + 1].pos), kv: lenv(S[i].kvec) });
  return { path, S, ext: out };
}

for (const R of [50, 200, 1000]) for (const dir of [1, -1]) {
  test(`2a: a ${R} m circle turning ${dir > 0 ? 'left' : 'right'}, extended 500 m with no handle, stays that circle (both κ within 1%, R̂ within 1%, level, heading continuous)`, () => {
    let d = extend(D.createDoc('c'), { length: 300, first: { kh: dir / R, phi: 0 } });
    d = extend(d, { length: 500 });
    const { S, ext } = extension(d, 300);
    for (const e of ext) for (const k of [e.k3, e.kv]) assert.ok(Math.abs(k * R - 1) < 0.01, `at s′ ${e.s}: κ ${k} vs ${1 / R}`);
    const Rhat = 1 / (ext.reduce((a, e) => a + e.k3, 0) / ext.length);
    assert.ok(Math.abs(Rhat - R) / R < 0.01, `R̂ ${Rhat}`);
    const j = S.findIndex((x) => Math.abs(x.s - 300) < 1e-9), y0 = S[j].pos[1];
    for (const x of S.slice(j)) assert.ok(Math.abs(x.pos[1] - y0) < 0.01, `height ${x.pos[1]} at ${x.s}`);
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(S[j].T, S[j + 1].T)))), expect = 1 / R;   // over one 1 m step
    assert.ok(Math.abs(turn - expect) < 1e-6, `tangent turn at the join ${turn} vs the circle's own ${expect}`);
  });
}

for (const dir of [1, -1]) {
  test(`2b: a clothoid (κ = s/A², A² = 80,000 m², to 1/200) turning ${dir > 0 ? 'left' : 'right'}, extended 200 m with no handle, keeps growing at 1/A²`, () => {
    const A2 = 80000;
    let d = D.appendPiece(D.createDoc('k'), D.roadPiece({ length: 400, channels: { kh: (s) => (dir * s) / A2, kv: () => 0, phi: () => 0, w: () => 31, r: () => 2.993 } }));
    d = extend(d, { length: 200 });
    const { ext } = extension(d, 400);
    for (const key of ['k3', 'kv']) {
      const xs = ext.map((e) => e.s), ys = ext.map((e) => e[key]), n = xs.length, mx = xs.reduce((a, x) => a + x, 0) / n, my = ys.reduce((a, y) => a + y, 0) / n;
      const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0), a = my - b * mx;
      assert.ok(Math.abs(b - 1 / A2) / (1 / A2) < 0.01, `${key} slope ${b} vs ${1 / A2}`);
      assert.ok(Math.abs(a - 1 / 200) < 1e-5, `${key} intercept ${a}`);
      const resid = Math.max(...xs.map((x, i) => Math.abs(ys[i] - (a + b * x))));
      assert.ok(resid < Math.max(0.01 * b * 200, 2e-6), `${key} shape residual ${resid}`);
    }
  });
}

test('a handle target is reached at the transition with zero channel slope, and the start still holds value and slope (ref 09 §2)', () => {
  let d = extend(D.createDoc('h'), { length: 200, first: { kh: 1 / 300 } });
  d = extend(d, { length: 150, transition: 100, targets: { kh: -1 / 200, phi: 20 * Math.PI / 180, w: 40 } });
  const P = d.pieces[1], h = 1e-3;
  assert.ok(Math.abs(D.channelAt(P, 'kh', 0).v - 1 / 300) < 1e-8);
  assert.ok(Math.abs(D.channelAt(P, 'kh', 0).d1) < 1e-6, `start slope ${D.channelAt(P, 'kh', 0).d1}`);
  for (const [ch, T] of [['kh', -1 / 200], ['phi', 20 * Math.PI / 180], ['w', 40]]) {
    assert.ok(Math.abs(D.channelAt(P, ch, 100).v - T) < 1e-3 * Math.max(1, Math.abs(T)), `${ch} at the transition: ${D.channelAt(P, ch, 100).v} vs ${T}`);
    assert.ok(Math.abs(D.channelAt(P, ch, 120).v - T) < 1e-3 * Math.max(1, Math.abs(T)), `${ch} holds past it`);
  }
  assert.ok(Math.abs(bloss(0.5) - 0.5) < 1e-15 && bloss(0) === 0 && bloss(1) === 1);
  const d1 = (u) => (bloss(u + h) - bloss(u - h)) / (2 * h);
  assert.ok(Math.abs(d1(0.5) - 1.5) < 1e-5, 'the Bloss slope is 1.5 at ½ (ref 02 §4); a central difference at h = 1e-3 is off by h²·S‴/6 = 2e-6');
});

test('extend refuses a closed track, a bad length and an unknown channel, by name', () => {
  const d = extend(D.createDoc('x'), { length: 50 });
  assert.throws(() => extend(d, { length: 0 }), (e) => e.code === 'BAD_LENGTH');
  assert.throws(() => extend(d, { length: 10, targets: { speed: 3 } }), (e) => e.code === 'BAD_TARGET');
  assert.throws(() => extend(d, { length: 10, transition: 20 }), (e) => e.code === 'BAD_TRANSITION');
  assert.throws(() => extend(D.checkDoc({ ...d, closed: true }), { length: 10 }), (e) => e.code === 'CLOSED');
});

// D521 (the user, 2026-10-28 15:18-15:31, his piece: a 100 m straight, then 100 m turning +11.70° as a corner with the bank at −54.05°, width 31 m, no ticks: "start banking where
// the red circle is at the start of the next piece vs where it does further down"; "i just want the banking to be more smooth without that bump"). Today's quintic banked 0.33° by
// 10 m and 2.68° by 20 m, then rolled at 1.02 °/m mid-piece (the hand-back, his.js). bankShape 'rounded' (the panel's Extend) lays the bank's RATE rounded over ℓ = min(10 m,
// a quarter of the ramp) at each end and steady between: C2 at both joints, as D459 asks of the bank.
const { extendCorner } = require('../src/core/turnby.js');
const { roundedLinear } = require('../src/core/extend.js');
const DEGR = Math.PI / 180, H5 = 0.5;
const PIN_HIS = '9f28319aad54a0a3', PIN_PLAIN = '983fb7ff292d7f93';   // sha256 (first 16) of D.serialize at 9069bd4, before D521 (his.js / the hand-back)
const his = (shape) => extendCorner(extend(D.createDoc('d521'), { length: 100 }), { length: 100, turnDeg: 11.70, targets: { phi: -54.05 * DEGR, w: 31 }, ...(shape ? { bankShape: shape } : {}) });
const phiAt = (P, s) => D.valuesAt(P, Math.max(0, Math.min(P.length, s))).phi / DEGR;
const peakRate = (P) => { let b = 0; for (let s = 0.1; s <= P.length + 1e-9; s += 0.1) b = Math.max(b, Math.abs(phiAt(P, s) - phiAt(P, s - 0.1)) / 0.1); return b; };
const d2At = (P, s, dir) => { const g = (x) => phiAt(P, s + dir * x); return (2 * g(0) - 5 * g(H5) + 4 * g(2 * H5) - g(3 * H5)) / (H5 * H5); };

test('D521 row 1: on his piece the rounded bank starts at the joint: 3.0° by 10 m, 9.0° by 20 m, 27.0° at the middle, -54.05° at the end, and rolls no faster than real tracks', () => {
  const P = his('rounded').pieces[1];
  assert.ok(Math.abs(phiAt(P, 10) + 3.0) < 0.3, `at 10 m: ${phiAt(P, 10)}°`);
  assert.ok(Math.abs(phiAt(P, 20) + 9.0) < 0.4, `at 20 m: ${phiAt(P, 20)}°`);
  assert.ok(Math.abs(phiAt(P, 50) + 27.025) < 0.1, `at 50 m: ${phiAt(P, 50)}°`);
  assert.ok(Math.abs(phiAt(P, 100) + 54.05) < 1e-6, 'it ends at the bank asked');
  const { BANK_RATE } = require('../src/doc/vocab.js');
  assert.ok(peakRate(P) <= BANK_RATE, `peak ${peakRate(P).toFixed(3)} °/m, real tracks' p90 ${BANK_RATE}`);
});
test('D521 row 2: the rounded bank is C2 at both joints: value, slope and second derivative continue across the straight\'s end and are steady at its own end', () => {
  const d = his('rounded'), A = d.pieces[0], P = d.pieces[1], H1 = 1e-3;
  assert.ok(Math.abs(phiAt(P, 0) - phiAt(A, 100)) < 1e-6, 'value');
  assert.ok(Math.abs((phiAt(P, H1) - phiAt(P, 0)) / H1 - (phiAt(A, 100) - phiAt(A, 100 - H1)) / H1) < 1e-3, 'slope');
  assert.ok(Math.abs(d2At(P, 0, 1) - d2At(A, 100, -1)) < 1e-3, `second derivative at the start: ${d2At(P, 0, 1)} against ${d2At(A, 100, -1)}`);
  assert.ok(Math.abs(d2At(P, 100, -1)) < 1e-3 && Math.abs((phiAt(P, 100) - phiAt(P, 100 - H1)) / H1) < 1e-3, 'steady at its end: no slope, no curvature');
});
test('D521 row 3: his corner still turns exactly 11.70°, and the other channels keep their ramps (the turn rate within 1e-4 rad/m of today\'s)', () => {
  const r = his('rounded'), t = his(null), { toPath } = require('../src/core/adapter.js');
  const turned = (d) => { const S = toPath(d, { step: 0.5 }).path.samples, a = S.find((m) => m.s >= 100), b = S.filter((m) => m.s <= 200).pop(); return Math.atan2(-(b.T[2] * a.T[0] - b.T[0] * a.T[2]), b.T[0] * a.T[0] + b.T[2] * a.T[2]) / DEGR; };
  assert.ok(Math.abs(turned(r) - 11.70) < 1e-3, `turned ${turned(r)}°`);
  for (let s = 0; s <= 100; s += 0.5) assert.ok(Math.abs(D.valuesAt(r.pieces[1], s).kh - D.valuesAt(t.pieces[1], s).kh) < 1e-4, `kh at ${s}`);
  // only the bank is rounded: a cup typed beside it keeps its curve exactly (the bank's knots are INSERTED, Boehm: 2.9e-7 at most, its stored step)
  const cupBy = (shape) => extend(extend(D.createDoc('d521'), { length: 100, first: { c: 10 } }), { length: 100, targets: { phi: -30 * DEGR, c: 40 }, ...(shape ? { bankShape: shape } : {}) }).pieces[1];
  const cr = cupBy('rounded'), ct = cupBy(null);
  for (let s = 0; s <= 100; s += 0.5) assert.ok(Math.abs(D.valuesAt(cr, s).c - D.valuesAt(ct, s).c) < 1e-6, `cup at ${s}: ${D.valuesAt(cr, s).c} against ${D.valuesAt(ct, s).c}`);
});
test('D521 row 4: without bankShape the bank is laid exactly as before (Close, Finish and every caller but the panel): his piece and a plain bank ramp keep their bytes', () => {
  const sha = (x) => require('crypto').createHash('sha256').update(D.serialize(x)).digest('hex').slice(0, 16);
  assert.equal(sha(his(null)), PIN_HIS);
  assert.equal(sha(extend(extend(D.createDoc('d521'), { length: 100 }), { length: 200, targets: { phi: -30 * DEGR } })), PIN_PLAIN);
  assert.throws(() => extend(D.createDoc('d521'), { length: 50, bankShape: 'square' }), (e) => e.code === 'BAD_SHAPE');
});
test('D521 row 5: the rounding is a quarter of a short ramp, so a 24 m bank still has its steady middle, and the shape itself is C2 with S(0) = 0, S(1) = 1', () => {
  const P = extend(extend(D.createDoc('d521'), { length: 100 }), { length: 24, targets: { phi: 20 * DEGR }, bankShape: 'rounded' }).pieces[1];
  assert.ok(Math.abs(phiAt(P, 12) - 10) < 0.3, `the middle is half the bank: ${phiAt(P, 12)}°`);
  const mid = (phiAt(P, 13) - phiAt(P, 11)) / 2; assert.ok(Math.abs(mid - 20 / 18) < 0.06, `the steady rate is 20° over 24 − 6 m: ${mid.toFixed(3)} °/m`);
  assert.ok(Math.abs(d2At(P, 0, 1)) < 1e-3 && Math.abs(d2At(P, 24, -1)) < 1e-3, 'C2 at both ends');
  for (const a of [0.1, 0.25]) { assert.equal(roundedLinear(0, a), 0); assert.equal(roundedLinear(1, a), 1); assert.ok(Math.abs(roundedLinear(0.5, a) - 0.5) < 1e-12, 'symmetric'); }
  // the shape's own second derivative goes to 0 at both ends (6u/(a²(1 − a)): 0.067 at u = 1e-4 for a = 0.1, where a rate rising linearly would hold 1/(a(1 − a)) = 11.1) (the rate rises on the Bloss cubic, so the bank is C2 by its shape, not only by the spline's end pinning)
  for (const a of [0.1, 0.25]) { const h = 1e-4, d2 = (u) => (roundedLinear(u + h, a) - 2 * roundedLinear(u, a) + roundedLinear(u - h, a)) / (h * h); assert.ok(Math.abs(d2(h)) < 1 && Math.abs(d2(1 - h)) < 1, `S'' at the ends: ${d2(h)}, ${d2(1 - h)}`); assert.ok(Math.abs(d2(0.5) ) < 1e-6, 'none on the plateau'); }
});
