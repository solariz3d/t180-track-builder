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
