// core_readout.test.js: node --test test/core_readout.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// THE READOUT (src/core/readout.js; ref 09 §8): a piece's length in metres and its change in turn, climb and bank in degrees,
// for placed pieces and for the extend candidate (the ghost). Expected values are integrals of KNOWN channels.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { toPath, toSegments } = require('../src/core/adapter.js');
const S = require('../src/core/sculpt.js');
const { pieceReadout, candidateReadout, channelIntegral } = require('../src/core/readout.js');

const DEG = 180 / Math.PI, RAD = Math.PI / 180;
/** Quantisation allows a channel's integral to move by at most half its step per metre (partition of unity, ref 03 §1). */
const qTol = (ch, L) => 0.5 * 10 ** -D.DEC[ch] * L + 1e-12;

test('a constant-κ piece turns κ·L exactly (ref 09 §8)', () => {
  const k = 1 / 200, d = extend(D.createDoc('c'), { length: 300, first: { kh: k } }), r = pieceReadout(d, 0);
  assert.ok(Math.abs(r.turnDeg * RAD - k * 300) <= qTol('kh', 300), `${r.turnDeg}° vs ${k * 300 * DEG}°`);
  assert.equal(r.lengthM, 300);
});

test('a Bloss ramp 0 → T turns T·L/2 (∫₀¹ 3u² − 2u³ = ½; ref 09 §8, ref 02 §4)', () => {
  const T = 1 / 150, L = 200;
  let d = extend(D.createDoc('b'), { length: 50 });
  d = extend(d, { length: L, transition: L, targets: { kh: T } });
  const r = pieceReadout(d, 1);
  assert.ok(Math.abs(r.turnDeg * RAD - (T * L) / 2) <= qTol('kh', L), `${r.turnDeg}° vs ${(T * L * DEG) / 2}°`);
});

test('a flat piece climbs 0, and its pitch stays where it was', () => {
  const r = pieceReadout(extend(D.createDoc('f'), { length: 120 }), 0);
  assert.deepEqual([r.climbDeg, r.pitchFromDeg, r.pitchToDeg, r.turnDeg], [0, 0, 0, 0]);
});

test('a bank ramp reports its two ends (from 0° to 20°)', () => {
  let d = extend(D.createDoc('bk'), { length: 80 });
  d = extend(d, { length: 120, transition: 120, targets: { phi: 20 * RAD } });
  const r = pieceReadout(d, 1);
  assert.ok(Math.abs(r.bankFromDeg) < 1e-6 && Math.abs(r.bankToDeg - 20) < 1e-6, `${r.bankFromDeg}° → ${r.bankToDeg}°`);
});

test('the extend candidate\'s readout (the ghost) equals the placed piece\'s readout after placing', () => {
  let d = extend(D.createDoc('g'), { length: 150, first: { kh: 1 / 300, kv: 0.001 } });
  const opts = { length: 90, transition: 60, targets: { kh: -1 / 180, phi: 12 * RAD, kv: 0 } };
  assert.deepEqual(candidateReadout(d, opts), pieceReadout(extend(d, opts), 1));
});

test('edge cases, refused by name: an empty track, an index out of range; a candidate on an empty track reads the first piece', () => {
  const e = D.createDoc('e');
  assert.throws(() => pieceReadout(e, 0), (x) => x.code === 'EMPTY');
  const d = extend(e, { length: 50 });
  for (const i of [-1, 1, 0.5, NaN, undefined]) assert.throws(() => pieceReadout(d, i), (x) => x.code === 'BAD_INDEX', String(i));
  assert.equal(candidateReadout(e, { length: 40 }).lengthM, 40);
});

test('the integral is exact: it agrees with an independent composite Simpson rule (20,000 panels) on a curving channel', () => {
  let d = extend(D.createDoc('x'), { length: 100, first: { kh: 1 / 250 } });
  d = extend(d, { length: 173.5, transition: 120, targets: { kh: -1 / 90 } });
  const P = d.pieces[1], n = 20000, h = P.length / n; let simp = 0;
  for (let j = 0; j <= n; j++) simp += (j === 0 || j === n ? 1 : j % 2 ? 4 : 2) * D.channelAt(P, 'kh', j * h).v;
  simp *= h / 3;
  assert.ok(Math.abs(channelIntegral(P, 'kh') - simp) < 1e-12, `${channelIntegral(P, 'kh')} vs ${simp}`);
});

// CHANGED D258 (the free jump): the flight's landing pitch is its `pitch` (was `land`); its turn is its heading turn, 0 here
test('pitch accumulates across pieces, and a flight sets it to its landing pitch (turn 0, climb = landing pitch − take-off, length = what the adapter builds)', () => {
  let d = extend(D.createDoc('p', { start: { pitch: 0.01 } }), { length: 100, first: { kv: 0.0005 } });
  d = extend(d, { length: 60, transition: 60, targets: { kv: 0 } });
  const up = pieceReadout(d, 0).climbDeg + pieceReadout(d, 1).climbDeg;
  d = D.appendPiece(d, D.flightPiece({ forward: 30, up: -2, pitch: -2 * RAD }));
  d = extend(d, { length: 50 });
  // the reference is the STORED landing pitch: the document quantises it to 1e-9 rad (−2° is stored as −1.9999999977°)
  const f = pieceReadout(d, 2), after = pieceReadout(d, 3), land = d.pieces[2].pitch * DEG;
  assert.ok(Math.abs(f.pitchFromDeg - (0.01 * DEG + up)) < 1e-9);
  assert.ok(Math.abs(f.climbDeg - (land - f.pitchFromDeg)) < 1e-9 && f.turnDeg === 0, `climb ${f.climbDeg}° vs ${land - f.pitchFromDeg}°`);
  assert.equal(f.lengthM, toSegments(d).filter((g) => g.id === d.pieces[2].id).reduce((a, g) => a + g.length, 0));
  assert.ok(Math.abs(after.pitchFromDeg - land) < 1e-12, `${after.pitchFromDeg}° vs ${land}°`);
});

test('the geometry the adapter draws integrates by the trapezoid at 2 m: its end heading is within 1e-6 rad of the exact readout (the stated difference, measured)', () => {
  let d = extend(D.createDoc('t', { start: { heading: 0.3 } }), { length: 200, first: { kh: 1 / 120 } });
  d = extend(d, { length: 180, transition: 150, targets: { kh: -1 / 70 } });
  const { path } = toPath(d), e = path.samples[path.samples.length - 1], drawn = Math.atan2(e.T[0], e.T[2]);
  const exact = 0.3 + (pieceReadout(d, 0).turnDeg + pieceReadout(d, 1).turnDeg) * RAD, diff = Math.abs(((drawn - exact + Math.PI) % (2 * Math.PI)) - Math.PI);
  assert.ok(diff < 1e-6, `drawn ${drawn} vs exact ${exact}: ${diff} rad`);
});

// ── the offsets h and l (ref 09 §7, §8) ───────────────────────────────────────────────────────────────────────────────
function hill(doc, p, s0, r, delta) {
  const P = doc.pieces[p], { doc: fine } = D.refineKnots(doc, P.id, s0 - r - 15, s0 + r + 15, 5), Pf = fine.pieces[p];
  const { ctrl } = S.brushControls(Pf.channels.h, D.knotVector(Pf), { s0, r, delta });
  const pieces = fine.pieces.slice(); pieces[p] = { ...Pf, channels: { ...Pf.channels, h: ctrl.map((v) => Number(v.toFixed(D.DEC.h))) } };
  return D.checkDoc({ ...fine, pieces });
}

test('a hill that fades inside the piece leaves its effective turn and climb unchanged, and makes the road longer', () => {
  const d = hill(extend(D.createDoc('h'), { length: 400, first: { kh: 1 / 500 } }), 0, 200, 60, 5), r = pieceReadout(d, 0);
  assert.ok(r.offsets, 'a piece with h reports its offsets');
  assert.ok(Math.abs(r.offsets.turnDeg - r.turnDeg) < 1e-9 && Math.abs(r.offsets.climbDeg - r.climbDeg) < 1e-9);
  assert.ok(r.offsets.roadLengthM > r.lengthM + 0.01, `road ${r.offsets.roadLengthM} m vs ${r.lengthM} m`);
});

test('the road length over a hill agrees with the lifted path\'s own chords at 0.1 m (to 1 mm)', () => {
  const d = hill(extend(D.createDoc('h'), { length: 400 }), 0, 200, 60, 5), r = pieceReadout(d, 0), s = toPath(d, { step: 0.1 }).path.samples;
  let chords = 0; for (let i = 1; i < s.length; i++) chords += Math.hypot(...[0, 1, 2].map((k) => s[i].pos[k] - s[i - 1].pos[k]));
  assert.ok(Math.abs(r.offsets.roadLengthM - chords) < 1e-3, `readout ${r.offsets.roadLengthM} m vs chords ${chords} m`);
});

test('a hill still rising at the piece\'s end changes the effective end pitch by atan(h′) on a level straight', () => {
  const d0 = extend(D.createDoc('e'), { length: 200 }), P = d0.pieces[0], h = P.channels.h.slice(), n = h.length;
  h[n - 1] = 2; h[n - 2] = 1;   // h(L) = 2 m, h′(L) = 3·(2 − 1)/span
  const d = D.checkDoc({ ...d0, pieces: [{ ...P, channels: { ...P.channels, h } }] }), r = pieceReadout(d, 0);
  const slope = D.channelAt(d.pieces[0], 'h', 200).d1;
  assert.ok(Math.abs(r.offsets.pitchToDeg - Math.atan(slope) * DEG) < 1e-9, `${r.offsets.pitchToDeg}° vs ${Math.atan(slope) * DEG}°`);
  assert.ok(Math.abs(r.pitchToDeg) < 1e-12, 'the base pitch is unchanged');
});

test('with no h or l anywhere, a piece reports offsets: null', () => {
  assert.equal(pieceReadout(extend(D.createDoc('n'), { length: 60 }), 0).offsets, null);
});
