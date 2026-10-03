// core_ramp.test.js: node --test test/core_ramp.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D194b (lap D195): Extend's `transition` is a number (as ever) OR a per-channel map { w: 20, phi: 'start', ... } in metres. A channel missing from the map
// uses the piece's length; 'start' is the short ramp at the start (startRampM: the first knot span, at most 20 m). A channel with a SHORT ramp reaches its
// target inside it and holds it (a later piece cannot jump: C1 joints), and its fit cannot ring: the control points are the ideal ramp at the Greville
// abscissae (ref 03 §1, §1b, ref 09 §2), so the curve stays between its start and its target. Stated before the code:
//   1  a number (or no) transition is unchanged: the same document, byte for byte, as at 4ccdd58 (GOLDEN, digests taken there)
//   2  a per-channel ramp reaches its target by its length R and holds it exactly, for w, phi and c, up and down, on pieces from 15 to 200 m
//   3  it never leaves [start, target] (no overshoot, no undershoot), w stays > 0; a slope continued from the joint may carry the first two points out (held)
//   4  channels not in the map keep the whole-piece blend; 'start' on a piece no longer than one span is the whole-piece blend
//   5  joints stay C1 (value and slope) into the ramped piece and out of it, and the document validates
//   6  a bad map is refused by name (BAD_TRANSITION)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend, startRampM, rampKnots, RAMP_KNOTS } = require('../src/core/extend.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const run = (steps) => steps.reduce((d, a) => extend(d, a), D.createDoc('t'));
// ── 1 · a number transition is unchanged ──
const GOLDEN_CASES = [
  [{ length: 100, family: 'bowl' }, { length: 100, targets: { w: 12 } }],
  [{ length: 100, family: 'half-pipe', first: { w: 24 } }, { length: 60, transition: 20, targets: { w: 12, phi: 0.3 } }],
  [{ length: 120 }, { length: 80, transition: 40, targets: { kh: 0.005, kv: 0.01 } }, { length: 50, targets: { phi: 0.2 } }],
  [{ length: 100, first: { c: 60 } }, { length: 40, transition: 20, targets: { c: 150 } }, { length: 100, transition: 100, targets: { c: 0 } }],
  [{ length: 45, family: 'flat', first: { w: 20 } }, { length: 45, transition: 45, targets: { w: 8, r: 2 } }],
  [{ length: 100, family: 'bowl' }, { length: 100, transition: undefined, targets: { w: 20 }, knotM: 10 }],
];
const GOLDEN = ['6fe0da0b925df898', 'f9445c2f24202487', 'e3b479ab7eee115d', '0d4bc61fbd13d3d3', 'bd27d8e6adcffbbb', 'f4109c3835754b16'];   // sha256 (first 16) of D.serialize at 4ccdd58
GOLDEN_CASES.forEach((steps, i) => test(`1 · a number (or no) transition is unchanged: case ${i} serialises exactly as it did at 4ccdd58`, () => {
  assert.equal(sha(D.serialize(run(steps))), GOLDEN[i]);
}));

// ── helpers ──
const DEG = Math.PI / 180;
/** A later piece: a 100 m bowl straight at width w0 (or with a slope, hand-built), then a piece of length L with the given transition and target. */
function later({ w0 = 31, L = 100, transition, targets, fam = 'bowl', slope = 0 }) {
  let d = extend(D.createDoc('later'), { length: 100, family: fam, first: { w: w0 } });
  if (slope) {   // a previous piece that ENDS with a slope on w (a hand-built linear width), so the joint has a slope to continue
    const from = null, ch = Object.fromEntries(D.CHANNELS.map((c) => [c, c === 'w' ? (s) => w0 + slope * s : c === 'r' ? () => 8 : () => 0]));
    d = D.appendPiece(D.createDoc('later'), D.roadPiece({ length: 100, family: fam, from, channels: ch }));
  }
  return extend(d, { length: L, transition, targets });
}
const at = (P, ch, s) => D.channelAt(P, ch, s).v;
const sample = (P, ch, step = 0.05) => { const out = []; for (let s = 0; s <= P.length + 1e-9; s += step) out.push([s, at(P, ch, s)]); return out; };

// ── 2 & 3 · a short ramp reaches its target by R, holds it, and never leaves [start, target] ──
for (const [L, w0, w1] of [[100, 31, 12], [100, 12, 31], [200, 31, 8], [45, 31, 12], [60, 20, 8], [30, 31, 12], [100, 31, 31.5], [25, 12, 30]]) {
  test(`2/3 · w ${w0} → ${w1} on a ${L} m piece with the ramp 'start': it reaches the target by R = ${startRampM(L)} m and holds exactly, and never leaves [${Math.min(w0, w1)}, ${Math.max(w0, w1)}]`, () => {
    const d = later({ w0, L, transition: { w: 'start' }, targets: { w: w1 } }), P = d.pieces[1], R = startRampM(L), lo = Math.min(w0, w1), hi = Math.max(w0, w1);
    assert.ok(Math.abs(at(P, 'w', 0) - w0) < 1e-3, `starts at ${at(P, 'w', 0)}`);
    let prev = w0;
    for (const [s, v] of sample(P, 'w')) {
      assert.ok(v >= lo - 1e-3 && v <= hi + 1e-3 && v > 0, `w(${s.toFixed(2)}) = ${v} leaves [${lo}, ${hi}]`);
      assert.ok(w1 < w0 ? v <= prev + 1e-6 : v >= prev - 1e-6, `w(${s.toFixed(2)}) = ${v} turns back (was ${prev}): the ramp is not monotone`); prev = v;
      if (s >= R + 1e-9) assert.ok(Math.abs(v - w1) < 1e-3, `w(${s.toFixed(2)}) = ${v}, not the target ${w1} after the ramp (R ${R})`);
    }
    assert.ok(Math.abs(D.channelAt(P, 'w', P.length).d1) < 1e-6, 'the hold ends flat');
  });
}
test('2 · an explicit number of metres in the map is the ramp: w reaches the target by 30 m and holds', () => {
  const d = later({ L: 100, transition: { w: 30 }, targets: { w: 12 } }), P = d.pieces[1];
  for (const [s, v] of sample(P, 'w')) { if (s >= 30) assert.ok(Math.abs(v - 12) < 1e-3, `w(${s}) = ${v}`); assert.ok(v >= 12 - 1e-3 && v <= 31 + 1e-3); }
  assert.ok(at(P, 'w', 10) > 12.5 && at(P, 'w', 10) < 30.5, 'the ramp is still under way at 10 m');
});
test('2/3 · the same holds for the bank (phi) and the cup (c): a short ramp reaches its target and never leaves the range', () => {
  const d = later({ L: 100, transition: { phi: 'start', c: 'start' }, targets: { phi: 0.5, c: 90 } }), P = d.pieces[1], R = startRampM(100);
  const e0 = D.legacyEdgeDeg('bowl', 31, at(d.pieces[0], 'r', 100));
  for (const [s, v] of sample(P, 'phi')) { assert.ok(v >= -1e-6 && v <= 0.5 + 1e-6, `phi(${s}) = ${v}`); if (s >= R) assert.ok(Math.abs(v - 0.5) < 1e-4, `phi(${s}) = ${v}`); }
  for (const [s, v] of sample(P, 'c')) { assert.ok(v >= e0 - 1e-3 && v <= 90 + 1e-3, `c(${s}) = ${v}`); if (s >= R) assert.ok(Math.abs(v - 90) < 1e-3, `c(${s}) = ${v}`); }
});
test('3 · a joint that carries a slope on w (0.5 m/m, a target just below the joint value: the ideal ramp rises past the joint\'s own first two points): C1 at the joint, and no control point outside the range of start, target and those two', () => {
  const d = later({ w0: 20, slope: 0.5, L: 100, transition: { w: 'start' }, targets: { w: 69.5 } }), P = d.pieces[1], prev = d.pieces[0];
  const e = D.pieceEnd(prev).w, c0 = D.channelAt(P, 'w', 0); assert.ok(Math.abs(e.v - 70) < 1e-3 && Math.abs(e.m - 0.5) < 1e-4, `the joint value ${e.v}, slope ${e.m}`);
  assert.ok(Math.abs(c0.v - e.v) < 1e-3 && Math.abs(c0.d1 - e.m) < 1e-3, `value ${c0.v} vs ${e.v}, slope ${c0.d1} vs ${e.m}`);
  const cp = P.channels.w, lo = Math.min(e.v, 69.5, cp[0], cp[1]) - 1e-3, hi = Math.max(e.v, 69.5, cp[0], cp[1]) + 1e-3;
  for (const v of cp) assert.ok(v >= lo && v <= hi, `control point ${v} outside [${lo}, ${hi}]`);
  for (const [s, v] of sample(P, 'w')) if (s >= startRampM(100)) assert.ok(Math.abs(v - 69.5) < 1e-3, `w(${s}) = ${v}`);
});
test('2 · the ramp SHAPE: the curve stays within 15% of the change of the smooth ramp it is built from (Bloss over R/2), measured 11.9% (the price of building from control points, ref 09 §9)', () => {
  for (const [L, w0, w1] of [[100, 31, 12], [45, 31, 12], [200, 12, 31], [60, 20, 8]]) {
    const P = later({ w0, L, transition: { w: 'start' }, targets: { w: w1 } }).pieces[1], Rc = startRampM(L) / 2; let worst = 0;
    for (let s = 0; s <= L; s += 0.1) { const u = Math.min(1, s / Rc), S = u * u * (3 - 2 * u); worst = Math.max(worst, Math.abs(at(P, 'w', s) - ((1 - S) * w0 + S * w1))); }
    assert.ok(worst <= 0.15 * Math.abs(w1 - w0), `L ${L}: the curve is ${worst} m from the ideal ramp (${(100 * worst / Math.abs(w1 - w0)).toFixed(1)}% of the change)`);
  }
});
test('5 · a ramped piece is stored on the channel quantum (every control point is a multiple of it), so the document round-trips byte for byte', () => {
  const d = later({ L: 100, transition: { w: 'start', phi: 'start' }, targets: { w: 12.123456789, phi: 0.3141592653589 } });
  for (const ch of ['w', 'phi']) for (const v of d.pieces[1].channels[ch]) assert.equal(v, Number(v.toFixed(D.DEC[ch])), `${ch} control point ${v} is off the quantum`);
  assert.equal(D.serialize(D.parse(D.serialize(d))), D.serialize(d));
});

// ── 4 · what the map does not touch ──
test('4 · a channel not in the map keeps the whole-piece blend: phi follows the number-transition document within 0.1% of its change', () => {
  const a = later({ L: 100, transition: { w: 'start' }, targets: { w: 12, phi: 0.3 } }).pieces[1], b = later({ L: 100, targets: { w: 12, phi: 0.3 } }).pieces[1];
  for (let s = 0; s <= 100; s += 0.5) assert.ok(Math.abs(at(a, 'phi', s) - at(b, 'phi', s)) <= 3e-4, `phi(${s}): ${at(a, 'phi', s)} vs ${at(b, 'phi', s)}`);
  assert.ok(at(a, 'phi', 50) > 0.1 && at(a, 'phi', 50) < 0.2, 'phi is still blending at 50 m (it did not take the short ramp)');
});
test('4 · a map naming only a channel with no target changes nothing: the document equals the number-transition one', () => {
  assert.equal(D.serialize(later({ L: 100, transition: { w: 'start' }, targets: { phi: 0.3 } })), D.serialize(later({ L: 100, targets: { phi: 0.3 } })));
});
test("4 · 'start' on a piece no longer than one span is the whole-piece blend (nothing to ramp inside the piece)", () => {
  assert.equal(startRampM(15), 15); assert.equal(D.serialize(later({ L: 15, transition: { w: 'start' }, targets: { w: 12 } })), D.serialize(later({ L: 15, targets: { w: 12 } })));
});
test('4 · startRampM is the first knot span: 20 m for a long piece, the piece for a short one, and follows knotM', () => {
  assert.deepEqual([100, 45, 30, 25, 15, 10].map((L) => startRampM(L)), [20, 15, 15, 12.5, 15, 10]);
  assert.equal(startRampM(100, 10), 10);
});
test('4 · the extra knots: RAMP_KNOTS subdivisions of the ramp, strictly increasing, inside the piece, and the even knots they would crowd are dropped', () => {
  const K = rampKnots(100, [20], undefined);
  assert.ok(K.length >= RAMP_KNOTS && K.every((k, i) => k > 0.5 && k < 99.5 && (i === 0 || k > K[i - 1])), JSON.stringify(K));
  assert.deepEqual(K.slice(0, RAMP_KNOTS), [5, 10, 15, 20]);
  assert.ok(K.slice(RAMP_KNOTS).every((k) => k > 20), JSON.stringify(K));
});

// ── 5 · joints ──
test('5 · joints are C1 into the ramped piece, out of it (a piece after the hold), and the document validates', () => {
  let d = later({ L: 100, transition: { w: 'start', phi: 'start' }, targets: { w: 12, phi: 0.4 } });
  d = extend(d, { length: 60, targets: { w: 20, kh: 0.004 } });   // a piece AFTER the ramped one continues its (flat) end and blends again
  assert.doesNotThrow(() => D.checkDoc(d));
  for (const [a, b] of [[0, 1], [1, 2]]) for (const ch of ['w', 'phi']) {
    const e = D.pieceEnd(d.pieces[a])[ch], c0 = D.channelAt(d.pieces[b], ch, 0);
    assert.ok(Math.abs(c0.v - e.v) < 1e-3 && Math.abs(c0.d1 - e.m) < 1e-3, `${ch} joint ${a}|${b}: value ${c0.v} vs ${e.v}, slope ${c0.d1} vs ${e.m}`);
  }
});
test('5 · a lap with ramped pieces still closes (the close reads the same control points)', () => {
  const { close } = require('../src/core/close.js'); const Rr = 180, Q = (Math.PI * Rr) / 2;
  let d = extend(D.createDoc('lap'), { length: 300, family: 'bowl' });
  d = extend(d, { length: Q, transition: { w: 'start' }, targets: { kh: 1 / Rr, w: 20 } });
  for (let i = 0; i < 3; i++) d = extend(d, { length: Q, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 100, transition: { w: 'start' }, targets: { kh: 0, w: 31 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report);
});

// ── 6 · a bad map ──
for (const [name, transition] of [['an unknown channel', { width: 20 }], ['zero', { w: 0 }], ['negative', { w: -5 }], ['longer than the piece', { w: 150 }], ['not a number', { w: NaN }], ['a string that is not start', { w: 'fast' }]]) {
  test(`6 · a map with ${name} is refused by name (BAD_TRANSITION)`, () => {
    assert.throws(() => later({ L: 100, transition, targets: { w: 12 } }), (e) => e.code === 'BAD_TRANSITION');
  });
}
test('6 · a number transition is still checked as before: 0 and a value past the length are refused', () => {
  for (const t of [0, -1, 101]) assert.throws(() => later({ L: 100, transition: t, targets: { w: 12 } }), (e) => e.code === 'BAD_TRANSITION');
});
