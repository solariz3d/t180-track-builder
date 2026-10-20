// core_sculpt_stretch.test.js: node --test test/core_sculpt_stretch.test.js
// src/core/sculpt.js `stretch` and `smooth` (D421 Part 1 of the Sculpt build, pane C; the design is P's, exo_memory/loop/design_d421_sculpt_P_2026-10-20.md
// §3.2 and §3.7, its rows §4.4 5 (the core half) and 6), and the sharp brush's zero-width refinement range (C's D421 freeze hand-back §5).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./core_helpers.js');
const D = require('../src/core/document.js');
const { toPath } = require('../src/core/adapter.js');
const { extend: EXT } = require('../src/core/extend.js');
const { jumpHere } = require('../src/core/jump.js');
const S = require('../src/core/sculpt.js');
const C = require('../src/core/close.js');

const extend0 = () => EXT(D.createDoc('d421'), { length: 200, family: 'bowl' });
// n corners of 200 m after a 200 m straight, turning left and right in turn (D421a's track)
const longTrack = (n) => { let d = extend0(); for (let i = 0; i < n; i++) d = EXT(d, { length: 200, transition: 40, targets: { kh: (i % 2 ? -1 : 1) / 400 } }); return d; };
const lapLength = (doc) => { const off = S.pieceOffsets(doc), p = doc.pieces.length - 1; return off[p] + doc.pieces[p].length; };
// ∫ channel ds over a road piece (the turn of kh, the climb of kv): a piecewise cubic, read at 4,000 stations by Simpson's rule
const integral = (P, ch) => { const n = 4000, h = P.length / n; let a = 0; for (let k = 0; k <= n; k++) a += (k === 0 || k === n ? 1 : k % 2 ? 4 : 2) * D.channelAt(P, ch, k * h).v; return (a * h) / 3; };
const samples = (doc) => toPath({ ...doc, closed: false }).path.samples;
const FIELDS = ['pos', 'T', 'L', 'U', 'kvec', 'roll', 'bankG', 'grade'];
const same = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((v, i) => Object.is(v, b[i])) : Object.is(a, b));
const roughness = (c, lo, hi) => { let x = 0; for (let i = Math.max(1, lo); i <= Math.min(c.length - 2, hi); i++) x += (c[i - 1] - 2 * c[i] + c[i + 1]) ** 2; return x; };

// ── the leftover: the sharp brush at r ≥ 500 on a 10 km track ──────────────────────────────────────────────────────────────────────────────────────────────────
test('a SHARP brush whose refinement range ends exactly on a piece end is not refused (it was BAD_RANGE [200, 200] at r 500 and 1000 on 10 km)', () => {
  const doc = longTrack(49), s0 = doc.pieces.length * 100;   // 5,000 m: s0 − 2r lands on a joint for every r a multiple of 100
  for (const r of [500, 1000]) {
    const res = S.brush(doc, { mode: 'hill', s0, r, delta: 1, sharp: true });
    assert.ok(res.changed.length, `r ${r}: the sharp hill moved nothing`);
    assert.doesNotThrow(() => D.checkDoc(res.doc));
  }
});

// ── stretch (design §3.2) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('row 6: Stretch keeps the next joint C1 (checkDoc passes) and the lap\'s length changes by exactly the stretch', () => {
  const doc = longTrack(9), i = 4, L0 = doc.pieces[i].length;
  for (const L1 of [260, 140, 200.1234]) {
    const res = S.stretch(doc, i, L1);
    assert.doesNotThrow(() => D.checkDoc(res.doc), `L1 ${L1}`);
    assert.equal(res.doc.pieces[i].length, L1);
    assert.equal(res.lengthChange, +(L1 - L0).toFixed(4));
    assert.ok(Math.abs(lapLength(res.doc) - lapLength(doc) - (L1 - L0)) < 1e-9, `L1 ${L1}: the lap is ${lapLength(res.doc)} m, was ${lapLength(doc)} m`);
    assert.ok(Object.isFrozen(res.doc) && Object.isFrozen(res.doc.pieces[i].channels.kh));
    doc.pieces.forEach((P, p) => { if (p !== i && p !== i + 1) assert.equal(res.doc.pieces[p], P, `L1 ${L1}: piece ${p} is not the same object`); });
  }
});
test('Stretch keeps the BEND by default (the piece turns as much as it did, over its new length); keepRate keeps the rates, so it turns more', () => {
  const doc = longTrack(9), i = 4, P = doc.pieces[i], turn0 = integral(P, 'kh');
  assert.ok(Math.abs(turn0) > 0.3, `control: piece ${i} is a corner (turns ${turn0} rad)`);
  const bend = S.stretch(doc, i, 300).doc.pieces[i], rate = S.stretch(doc, i, 300, { keepRate: true }).doc.pieces[i];
  assert.ok(Math.abs(integral(bend, 'kh') - turn0) < 1e-6, `keep the bend: turned ${integral(bend, 'kh')} rad, was ${turn0}`);
  assert.equal(bend.channels.kh[0], P.channels.kh[0], 'the rate the piece before hands over is kept');
  assert.equal(bend.channels.kh.at(-1), P.channels.kh.at(-1), 'the rate the piece after starts from is kept');
  assert.deepEqual(rate.channels.kh.slice(2), P.channels.kh.slice(2), 'keepRate: the rate control points are the ones it had (but the first two, which the joint before rebuilds)');
  assert.ok(integral(rate, 'kh') / turn0 > 1.4, `keepRate: a 1.5x longer piece at the same rate turns about 1.5x as much, got ${integral(rate, 'kh') / turn0}`);
  for (const ch of ['phi', 'w', 'r']) assert.deepEqual(bend.channels[ch].slice(2), P.channels[ch].slice(2), `${ch} is a value: not scaled`);
});
test('keeping the bend keeps the rate\'s SLOPE at both ends: at the end the piece after builds from, and at an unlinked start (the lap\'s first piece)', () => {
  const doc = longTrack(9), i = 4, P = doc.pieces[i], d1End = D.channelAt(P, 'kh', P.length).d1;
  assert.ok(Math.abs(d1End) > 1e-8, `control: piece ${i}'s kh has a slope at its end (${d1End})`);
  for (const L1 of [300, 120]) {
    const B = S.stretch(doc, i, L1).doc.pieces[i];
    assert.ok(Math.abs(D.channelAt(B, 'kh', L1).d1 - d1End) < 1e-9, `L1 ${L1}: the end slope went ${d1End} -> ${D.channelAt(B, 'kh', L1).d1}`);
  }
  const first = EXT(D.createDoc('d421'), { length: 200, transition: 40, targets: { kh: 1 / 400 } }), F = first.pieces[0], d1Start = D.channelAt(F, 'kh', 0).d1;
  assert.ok(Math.abs(d1Start) > 1e-7, `control: the first piece's kh has a slope at its start (${d1Start})`);
  for (const L1 of [300, 120]) {
    const B = S.stretch(first, 0, L1).doc.pieces[0];
    assert.ok(Math.abs(D.channelAt(B, 'kh', 0).d1 - d1Start) < 1e-9, `L1 ${L1}: the start slope went ${d1Start} -> ${D.channelAt(B, 'kh', 0).d1}`);
    assert.equal(B.channels.kh[0], F.channels.kh[0]);
  }
});
test('Stretch to the length it has is the same document; stretched and stretched back, the length is what it was', () => {
  const doc = longTrack(4);
  assert.equal(S.stretch(doc, 2, doc.pieces[2].length).doc, doc);
  assert.equal(S.stretch(doc, { from: 1, to: 3 }, 600).doc, doc, 'a run of 3 x 200 m stretched to 600 m');
  const back = S.stretch(S.stretch(doc, 2, 250).doc, 2, 200).doc;
  assert.equal(back.pieces[2].length, 200);
  assert.ok(Math.abs(lapLength(back) - lapLength(doc)) < 1e-9);
});
test('Stretch has a minimum length, refused by name below it, and refuses a length that is not a number', () => {
  const doc = longTrack(4);
  const res = S.stretch(doc, 2, S.STRETCH_MIN_M);
  assert.equal(res.doc.pieces[2].length, S.STRETCH_MIN_M);
  assert.doesNotThrow(() => D.checkDoc(res.doc));
  for (const L1 of [S.STRETCH_MIN_M - 0.01, 0, -5, NaN, Infinity]) assert.throws(() => S.stretch(doc, 2, L1), /BAD_LENGTH/, `L1 ${L1}`);
  // a piece of 2 m with knots 1 cm apart (refined) cannot be shrunk to 1 m: its spans would fall under a centimetre
  // (on the straight, piece 0: refining a steep piece re-quantises its points in every channel and can break its joint, refineKnots' declared cost)
  const fine = D.refineKnots(S.stretch(doc, 0, 2).doc, doc.pieces[0].id, 0, 2, 0.01).doc;
  assert.throws(() => S.stretch(fine, 0, 1.5), /BAD_LENGTH.*span/);
  assert.throws(() => S.stretch(doc, 9, 100), /NO_PIECE/);
  assert.throws(() => S.stretch(jumpHere(longTrack(1), null, {}), 2, 100), /NOT_ROAD/, 'a flight alone has no length to stretch');
});
test('Stretch on a CLOSED lap leaves the lap with its gap and says it needs a re-close; the re-close then converges', () => {
  const CLOSED = C.close(H.docFrom(H.gen()[1])).doc, i = 3;
  assert.ok(CLOSED.closed);
  const res = S.stretch(CLOSED, i, CLOSED.pieces[i].length * 1.1);
  assert.equal(res.reclose, true);
  assert.equal(res.doc.closed, true);
  const sm = samples(res.doc), a = sm[0].pos, z = sm.at(-1).pos;
  assert.ok(Math.hypot(a[0] - z[0], a[1] - z[1], a[2] - z[2]) > 0.01, 'the stretch moved nothing past the piece');
  const c = C.close({ ...res.doc, closed: false }, { edited: [i] });
  assert.ok(c.converged, c.report);
  assert.equal(S.stretch(longTrack(3), 1, 220).reclose, false, 'an open track needs no re-close');
  const n = CLOSED.pieces.length, across = S.stretch(CLOSED, { from: n - 1, to: 0 }, (CLOSED.pieces[n - 1].length + CLOSED.pieces[0].length) * 0.9);   // a run across the start line
  assert.deepEqual(across.pieces.slice(0, 2), [0, 1]);
  assert.ok(across.pieces.includes(n - 1) && across.reclose);
  assert.throws(() => S.stretch(longTrack(3), { from: 2, to: 0 }, 300), /BAD_RUN/, 'backwards on an open track');
});
test('a RUN is stretched by one factor; a flight inside it is left as it is, and the landing still starts level', () => {
  let doc = jumpHere(longTrack(2), null, {});
  doc = EXT(EXT(doc, { length: 200, transition: 40, targets: { kh: 1 / 300 } }), { length: 200, transition: 40, targets: { kh: 0 } });
  assert.deepEqual(doc.pieces.map((P) => P.type), ['road', 'road', 'road', 'flight', 'road', 'road', 'road']);
  const roadIn = [2, 4, 5].map((p) => doc.pieces[p].length), L0 = roadIn.reduce((a, b) => a + b), L1 = L0 * 1.3;
  const res = S.stretch(doc, { from: 2, to: 5 }, L1);
  assert.doesNotThrow(() => D.checkDoc(res.doc));
  assert.equal(res.doc.pieces[3], doc.pieces[3], 'the flight is the same object');
  [2, 4, 5].forEach((p, k) => assert.ok(Math.abs(res.doc.pieces[p].length - roadIn[k] * 1.3) <= 5e-5, `piece ${p}: ${res.doc.pieces[p].length}, asked ${roadIn[k] * 1.3}`));
  assert.ok(Math.abs(res.lengthChange - (L1 - L0)) <= 3 * 5e-5, `the run grew by ${res.lengthChange}, asked ${L1 - L0}`);
  assert.equal(res.doc.pieces[0], doc.pieces[0]);
  assert.equal(res.doc.pieces[1], doc.pieces[1]);
  assert.throws(() => S.stretch(doc, { from: 5, to: 2 }, 900), /BAD_RUN/, 'from after to on an open track');
});
test('row 5, the core half: Stretch and Smooth are pure: the base untouched, the result frozen, and a drag\'s last step is the document one call from the base gives, bit for bit', () => {
  const base = longTrack(9), snap = JSON.stringify(base);
  for (const L of [210, 240, 255]) S.stretch(base, 4, L);   // the drag's earlier steps (warm caches)
  for (const lam of [0.2, 0.5]) S.smooth(base, 'kh', 900, 150, lam);
  const fresh = longTrack(9);
  assert.deepEqual(S.stretch(base, 4, 260).doc, S.stretch(fresh, 4, 260).doc);
  assert.deepEqual(S.smooth(base, 'kh', 900, 150, 0.8).doc, S.smooth(fresh, 'kh', 900, 150, 0.8).doc);
  assert.equal(JSON.stringify(base), snap, 'the base document was written');
  assert.ok(Object.isFrozen(S.smooth(base, 'phi', 900, 150, 0.8).doc.pieces[4].channels.phi));
});

// ── smooth (design §3.7) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const wobbly = () => { let d = longTrack(9); for (const [s0, delta] of [[860, 0.08], [900, -0.08], [940, 0.08]]) d = S.sculpt(d, { channel: 'phi', s0, r: 30, delta }).doc; return d; };
test('Smooth takes a wobble out of one channel under the window and leaves the road outside it bit for bit', () => {
  const doc = wobbly(), s0 = 900;
  // r 80 is the narrowest window (four 20 m spans): its edge points weigh about 0.5 there, so a point whose support leaves the window would show outside it
  for (const r of [80, 150]) {
    const res = S.smooth(doc, 'phi', s0, r, 1);
    assert.ok(res.changed.length, res.note);
    const lo = s0 - res.radiusUsed - 1, hi = s0 + res.radiusUsed + 1, a = samples(doc), b = samples(res.doc);
    b.forEach((x, k) => { if (x.s < lo || x.s > hi) for (const f of FIELDS) assert.ok(same(x[f], a[k][f]), `r ${r}: ${f} at ${x.s}`); });
    for (const ch of D.CHANNELS) if (ch !== 'phi') res.doc.pieces.forEach((P, p) => assert.equal(P.channels[ch], doc.pieces[p].channels[ch], `r ${r}: ${ch} of piece ${p}`));
  }
  const rough = (d) => d.pieces.slice(3, 6).reduce((a, P) => a + roughness(P.channels.phi, 0, P.channels.phi.length), 0), res = S.smooth(doc, 'phi', s0, 150, 1);
  assert.ok(rough(res.doc) < 0.6 * rough(doc), `the bank's roughness went ${rough(doc)} -> ${rough(res.doc)}`);
});
test('Smooth holds the window\'s outer four control points (two at each end) and moves a joint inside it value-then-slope', () => {
  const doc = wobbly(), s0 = 900, off = S.pieceOffsets(doc);
  for (const r of [80, 250]) {   // r 80: the outer points weigh about 0.5 under the falloff; r 250: two joints (800, 1000 m) well inside
    const res = S.smooth(doc, 'phi', s0, r, 1), ru = res.radiusUsed;
    const inside = [];   // every control point whose whole support lies in the window, in lap order
    doc.pieces.forEach((P, p) => { const t = D.knotVector(P); P.channels.phi.forEach((v, i) => { if (off[p] + t[i] >= s0 - ru && off[p] + t[i + 4] <= s0 + ru) inside.push([p, i]); }); });
    const moved = ([p, i]) => res.doc.pieces[p].channels.phi[i] !== doc.pieces[p].channels.phi[i];
    for (const pt of [...inside.slice(0, 2), ...inside.slice(-2)]) assert.ok(!moved(pt), `r ${r}: the window's outer point ${pt} moved`);
    assert.ok(inside.slice(2, -2).some(moved), `r ${r}: nothing between them moved`);
    assert.doesNotThrow(() => D.checkDoc(res.doc));
    if (r === 80) continue;
    const joint = res.changed.find((x) => x.indices.includes(0) && x.indices.includes(1));
    assert.ok(joint, `no joint inside the window moved: ${JSON.stringify(res.changed)}`);
  }
});
test('one pass of Smooth (λ 1) moves each point by the design\'s rule, cᵢ + f(dᵢ)·((cᵢ₋₁ + cᵢ₊₁) / 2 − cᵢ), and past a joint cᵢ₊₁ is the later piece\'s second point', () => {
  // a bank bump just before the joint at 800 m, so the bank has a slope there and the point past the joint differs from the joint's own value
  const bumped = S.sculpt(longTrack(9), { channel: 'phi', s0: 790, r: 60, delta: 0.08 }).doc;
  for (const [doc, s0] of [[wobbly(), 900], [bumped, 800]]) {
    const r = 250, res = S.smooth(doc, 'phi', s0, r, 1), off = S.pieceOffsets(doc);
    assert.equal(res.passes, 1);
    let checked = 0, atJoint = 0;
    for (const { piece: p, indices } of res.changed) {
      const P = doc.pieces[p], c = P.channels.phi, t = D.knotVector(P), n = c.length;
      for (const i of indices) {
        if (i < 2 && p > 0 && doc.pieces[p - 1].type === 'road') continue;   // a linked joint's later side: derived from the earlier one (value, then slope)
        const right = i + 1 < n ? c[i + 1] : doc.pieces[p + 1].channels.phi[1];
        const want = c[i] + S.falloff(S.knotAverage(t, i) - (s0 - off[p]), res.radiusUsed) * ((c[i - 1] + right) / 2 - c[i]);
        assert.ok(Math.abs(res.doc.pieces[p].channels.phi[i] - want) <= 1e-9, `s0 ${s0}: piece ${p} point ${i} is ${res.doc.pieces[p].channels.phi[i]}, the rule gives ${want}`);
        checked++; if (i === n - 1) atJoint++;
      }
    }
    assert.ok(checked >= 5, `s0 ${s0}: only ${checked} points checked`);
    if (s0 === 800) {
      assert.ok(atJoint >= 1, 'control: the joint at 800 m moved');
      assert.notEqual(doc.pieces[4].channels.phi[1], doc.pieces[3].channels.phi.at(-1), 'control: the bank has a slope at the joint');
    }
  }
});
test('Smooth with λ = 0 is the same document, and says nothing changed; a larger λ smooths more (λ over 1 runs more passes)', () => {
  const doc = wobbly(), z = S.smooth(doc, 'phi', 900, 150, 0);
  assert.equal(z.doc, doc);
  assert.deepEqual(z.changed, []);
  assert.match(z.note, /nothing changed/);
  const rough = (d) => d.pieces.slice(3, 6).reduce((a, P) => a + roughness(P.channels.phi, 0, P.channels.phi.length), 0);
  const r1 = rough(S.smooth(doc, 'phi', 900, 150, 0.3).doc), r2 = rough(S.smooth(doc, 'phi', 900, 150, 1).doc), r3 = rough(S.smooth(doc, 'phi', 900, 150, 4).doc);
  assert.ok(r1 > r2 && r2 > r3, `roughness at λ 0.3, 1, 4: ${r1}, ${r2}, ${r3}`);
});
test('Smooth refuses a channel it does not know, a radius not above 0, and a λ that is negative, not finite, or above its cap', () => {
  const doc = longTrack(4);
  assert.throws(() => S.smooth(doc, 'zz', 400, 100, 0.5), /BAD_CHANNEL/);
  for (const r of [0, -1, NaN]) assert.throws(() => S.smooth(doc, 'phi', 400, r, 0.5), /BAD_BRUSH/, `r ${r}`);
  for (const lam of [-0.1, NaN, Infinity, S.SMOOTH_MAX + 1]) assert.throws(() => S.smooth(doc, 'phi', 400, 100, lam), /BAD_BRUSH/, `λ ${lam}`);
  assert.throws(() => S.smooth(doc, 'c', 400, 100, 0.5), /NOT_CUP/, 'a cup smooth on a legacy piece');
});
test('Smooth on a CLOSED lap: a route channel (kh) says it needs a re-close, a shape channel (phi) does not', () => {
  const CLOSED = C.close(H.docFrom(H.gen()[1])).doc;
  let d = CLOSED; for (const [s0, delta] of [[1460, 0.0005], [1500, -0.0005], [1540, 0.0005]]) d = S.sculpt(d, { channel: 'kh', s0, r: 30, delta }).doc;
  const kh = S.smooth(d, 'kh', 1500, 200, 1), phi = S.smooth(d, 'phi', 1500, 200, 1);
  assert.ok(kh.changed.length && kh.reclose === true && kh.doc.closed === true);
  assert.equal(phi.reclose, false);
});
