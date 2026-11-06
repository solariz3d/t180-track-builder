// core_additive.test.js: node --test test/core_additive.test.js. D642, THE EXTRA CHANGE ADDS (the keeper, 2026-11-05 19:54Z, trying d641-c df62d6f: "here is a basic 1km
// turn 90 degrees by itself ... now look what happens to it when I try the second turn even a little bit, even turnin it to 0 ... The first part of the turn bankes correctly,
// but then for the second 180 section i cant even add extra banking back to the other way it is inverted"; his picture 2: "it makes it more sharp and takes the original shape
// away"). His ruling: the extra change ADDS on top of the piece's own change and never squeezes it. Extra 0 is the piece with no extra, byte for byte; a −90 corner keeps its
// whole-piece shape and the extra turn is added over its own span; the bank the same, the base following the whole piece and the extra adding from its own start.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const X = require('../src/core/extend.js');
const { extend } = X;
const A = require('../src/core/adapter.js');
const TB = require('../src/core/turnby.js');

const DEG = Math.PI / 180, BAR = 29.4 / (10 * 170 * 170);
const flat = () => extend(D.createDoc('g'), { length: 1000, family: 'bowl' });
const head = (d) => d.pieces[d.pieces.length - 1];
const at = (d, ch, s) => D.channelAt(head(d), ch, s).v;
/** The angle ∫ch ds over [0, s1] on the adapter's rule (the trapezoid on 2 m segments, src/core/adapter.js toSegments), rad. */
function integral(d, ch, s1) { const n = Math.max(1, Math.ceil(s1 / 2 - 1e-9)); let a = 0, prev = at(d, ch, 0); for (let j = 1; j <= n; j++) { const s = (s1 * j) / n, v = at(d, ch, s); a += ((prev + v) / 2) * (s1 / n); prev = v; } return a; }
/** The heading change over the head piece on the adapter's path, degrees (core_changes.test.js pathTurn). */
function pathTurn(d) {
  const S = A.toPath(d).path.samples, L = head(d).length, s0 = d.pieces.slice(0, -1).reduce((a, p) => a + (p.type === 'flight' ? 0 : p.length), 0);
  const near = (s) => { let b = S[0]; for (const x of S) if (Math.abs(x.s - s) < Math.abs(b.s - s)) b = x; return Math.atan2(b.T[0], b.T[2]); };
  let a = near(s0 + L) - near(s0); while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a / DEG;
}
/** The built heading's (or pitch's) second difference over 1 m, peak over [a, b], ÷ the bar (core_changes.test.js builtTurnPeak, pane E's l139slope.js reader). */
function builtTurnPeak(d, a, b, pitch = false) {
  const S = A.toPath(d).path.samples; let prev = null, off = 0;
  const H = S.map((x) => { let v = pitch ? Math.asin(Math.max(-1, Math.min(1, x.T[1]))) : Math.atan2(x.T[2], x.T[0]); if (prev !== null) { while (v + off - prev > Math.PI) off -= 2 * Math.PI; while (v + off - prev < -Math.PI) off += 2 * Math.PI; } v += off; prev = v; return { s: x.s, v }; });
  const atS = (s) => { let lo = 0, hi = H.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (H[m].s <= s) lo = m; else hi = m; } const f = (s - H[lo].s) / (H[hi].s - H[lo].s); return H[lo].v + f * (H[hi].v - H[lo].v); };
  let m = 0; for (let s = a; s <= b; s += 0.5) m = Math.max(m, Math.abs(atS(s + 1) - 2 * atS(s) + atS(s - 1))); return m / BAR;
}
/** The built road's roll acceleration (2 m second differences of the adapter's roll), peak over [a, b] in track metres, ÷ the bar (core_changes.test.js builtRollPeak). */
function builtRollPeak(d, a, b) {
  const S = A.toPath(d).path.samples, r = (s) => { let lo = 0, hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; } return S[lo].roll; };
  let m = 0; for (let s = a; s <= b; s += 0.5) m = Math.max(m, Math.abs(r(s + 2) - 2 * r(s) + r(s - 2)) / 4); return m / BAR;
}

// his piece: a 1,000 m corner of −90° after a 1,000 m straight (picture 1, "by itself no extra turn")
const HIS = { length: 1000, turnDeg: -90 };

// ── 1. an extra that changes nothing is no extra, byte for byte
test('D642 1a: his −90° corner with an extra turn of 0 from 500 is byte-equal to the corner with no extra', () => {
  assert.equal(D.serialize(TB.extendCorner(flat(), { ...HIS, changes: { turnDeg: [{ from: 500, deg: 0 }] } })), D.serialize(TB.extendCorner(flat(), HIS)));
});
test('D642 1b: a climb corner of +20° with an extra climb of 0 from 600 is byte-equal to the climb corner alone', () => {
  const o = { length: 1000, climbDeg: 20 };
  assert.equal(D.serialize(TB.extendCorner(flat(), { ...o, changes: { climbDeg: [{ from: 600, deg: 0 }] } })), D.serialize(TB.extendCorner(flat(), o)));
});
for (const [ch, T1] of [['kh', 1 / 300], ['kv', 4 * DEG / 100], ['phi', 30 * DEG], ['w', 30], ['c', 40], ['e', 20]]) {
  test(`D642 1c ${ch}: a whole-piece ${ch} with an extra that ends where it already is (target ${+T1.toPrecision(6)} from 500) is byte-equal to the piece with no extra`, () => {
    const base = { length: 1000, targets: { [ch]: T1 } };
    assert.equal(D.serialize(extend(flat(), { ...base, changes: { [ch]: [{ from: 500, target: T1 }] } })), D.serialize(extend(flat(), base)));
  });
}

// ── 2. the base keeps its whole-piece shape; the extra adds over its own span
test('D642 2a: his −90° corner with an extra +180° from 500: the heading up to 500 is the corner\'s own (0.01°), the piece turns +90° in all and ends straight', () => {
  const none = TB.extendCorner(flat(), HIS), d = TB.extendCorner(flat(), { ...HIS, changes: { turnDeg: [{ from: 500, deg: 180 }] } });
  let worst = 0; for (let s = 2; s <= 500; s += 2) worst = Math.max(worst, Math.abs(integral(d, 'kh', s) - integral(none, 'kh', s)) / DEG);
  assert.ok(worst <= 0.01, `the heading before the extra's mark moves ${worst.toFixed(4)}° against the corner alone`);
  assert.ok(Math.abs(integral(none, 'kh', 500) / DEG + 45) <= 1, `the corner alone is about halfway round at 500 m: ${(integral(none, 'kh', 500) / DEG).toFixed(2)}°`);
  assert.ok(Math.abs(pathTurn(d) - 90) <= 0.01, `the piece turns ${pathTurn(d)}° on the built path, not −90 + 180`);
  const e = D.channelAt(head(d), 'kh', 1000); assert.ok(Math.abs(e.v) <= 1e-9 && Math.abs(e.d1) <= 1e-9, `ends at ${e.v}, slope ${e.d1}`);
});
test('D642 2b: a climb corner of +40° with an extra −80° from 500 keeps the corner\'s own pitch to 500 (0.01°) and pitches −40° in all', () => {
  const o = { length: 1000, climbDeg: 40 }, none = TB.extendCorner(flat(), o), d = TB.extendCorner(flat(), { ...o, changes: { climbDeg: [{ from: 500, deg: -80 }] } });
  let worst = 0; for (let s = 2; s <= 500; s += 2) worst = Math.max(worst, Math.abs(integral(d, 'kv', s) - integral(none, 'kv', s)) / DEG);
  assert.ok(worst <= 0.01, `the pitch before the mark moves ${worst.toFixed(4)}°`);
  assert.ok(Math.abs(integral(d, 'kv', 1000) / DEG + 40) <= 0.01, `pitches ${integral(d, 'kv', 1000) / DEG}° in all`);
});
test('D642 2c: his bank, 88.45° over the whole piece with an extra back the other way (to −30° from 500): the bank up to 500 is the whole-piece ramp\'s (1% of its change), and it ends at −30°', () => {
  const base = { length: 1000, targets: { phi: 88.45 * DEG } }, none = extend(flat(), base), d = extend(flat(), { ...base, changes: { phi: [{ from: 500, target: -30 * DEG }] } });
  let lk = 0; for (let s = 0; s <= 500; s += 0.5) lk = Math.max(lk, Math.abs(at(d, 'phi', s) - at(none, 'phi', s)));
  assert.ok(lk <= 0.01 * 88.45 * DEG, `the bank before the mark leaks ${(lk / DEG).toFixed(3)}° against the whole-piece ramp`);
  assert.ok(Math.abs(at(none, 'phi', 500) / DEG - 44.2) <= 1, `the whole-piece ramp is about halfway at 500 m: ${(at(none, 'phi', 500) / DEG).toFixed(2)}°`);
  const e = D.channelAt(head(d), 'phi', 1000); assert.ok(Math.abs(e.v + 30 * DEG) <= 1e-6 && Math.abs(e.d1) <= 1e-9, `ends at ${e.v / DEG}°, slope ${e.d1}`);
});
test('D642 2d: a rate field, the width 30 over the whole piece with an extra to 40 from 600: the width to 600 is the whole-piece ramp\'s (1% of its change), and it ends at 40', () => {
  const base = { length: 1000, targets: { w: 30 } }, none = extend(flat(), base), d = extend(flat(), { ...base, changes: { w: [{ from: 600, target: 40 }] } });
  const w0 = at(none, 'w', 0); let lk = 0; for (let s = 0; s <= 600; s += 0.5) lk = Math.max(lk, Math.abs(at(d, 'w', s) - at(none, 'w', s)));
  assert.ok(lk <= 0.01 * Math.abs(30 - w0), `the width before the mark leaks ${lk} against the whole-piece ramp from ${w0}`);
  assert.ok(Math.abs(at(d, 'w', 1000) - 40) <= 1e-3, `ends at ${at(d, 'w', 1000)}`);
});

// ── 3. the smoothness bar: the base and the extra together, on the built road, at the extra's shortest
for (const [what, k, deg, extra] of [['his −90° with an extra +180°', 'turnDeg', -90, 180], ['a +90° with an extra +90° the same way', 'turnDeg', 90, 90], ['a climb +40° with an extra −80°', 'climbDeg', 40, -80]]) {
  test(`D642 3 ${what} laid at the extra's shortest: the built ${k === 'turnDeg' ? 'heading' : 'pitch'} rate stays under the bar (× 1.05) through the piece and 20 m on`, () => {
    const L = 1000, min = Math.ceil(TB.cornerChangeMinM(flat(), { length: L }, extra, deg) * 10) / 10, make = (L2) => () => TB.extendCorner(flat(), { length: L, [k]: deg, changes: { [k]: [{ from: L - L2, deg: extra }] } });
    assert.ok(min > 31.5 * Math.sqrt(Math.abs(extra)), `the base's own rate is taken out of the extra's budget: ${min} m against ${(31.5 * Math.sqrt(Math.abs(extra))).toFixed(1)} alone`);
    assert.throws(make(min - 0.2), (e) => /TOO_SHORT/.test(e.code) && e.message.includes('change 1'), `refused just under ${min} m`);
    const d = extend(make(min)(), { length: 200 }), pk = builtTurnPeak(d, 1000 + 20, 1000 + L + 20, k === 'climbDeg');
    assert.ok(pk <= 1.05, `the built rate reads ${pk.toFixed(3)} × the bar (extra over its shortest, ${min} m, on a ${L} m piece)`);
  });
}
test('D642 3d: his bank 88.45° over 1,000 m with an extra back to −30° at the extra\'s shortest: the built roll accelerates under the bar (× 1.05)', () => {
  // AMENDED (D642 C's 35ef2eb6, by name: a base with no shape named is now the panel's rounded ramp): this row lays the quintic, so it names it (shape null)
  const raw = X.secondMinM('phi', 88.45 * DEG, -30 * DEG, { step: 88.45 * DEG, length: 1000, shape: null }), min = Math.ceil(raw * 10) / 10;
  assert.ok(raw > X.secondMinM('phi', 88.45 * DEG, -30 * DEG), `the first ramp's own roll is taken out of the change's budget: ${raw} m against ${X.secondMinM('phi', 88.45 * DEG, -30 * DEG).toFixed(1)} alone`);
  const make = (L2) => () => extend(flat(), { length: 1000, targets: { phi: 88.45 * DEG }, changes: { phi: [{ from: 1000 - L2, target: -30 * DEG }] } });
  // AMENDED (the librarian's ruling on B's §9, by name: the probe's bar is the adapter's 1.0, and the shortest is the built-road search's, on whole metres: the span a metre
  // under it is the one the search found refused; 0.2 m under it now holds)
  assert.throws(make(raw - 1), (e) => e.code === 'BAD_SECOND' && e.message.includes(raw.toFixed(1)), `refused a metre under ${raw} m, naming it`);
  const d = extend(make(min)(), { length: 200 }), pk = builtRollPeak(d, 1000 + 20, 2000 + 20);
  assert.ok(pk <= 1.05, `the built roll reads ${pk.toFixed(3)} × the bar (extra over its shortest, ${min} m)`);
});
// ── 2e. the field before the mark is the first lay's to the last bit: every control point whose basis starts before the mark is the piece's without the change, given the same
// knots (document.js insertKnots, so the curve is the same and only the knot vector grows)
for (const [ch, o, F] of [['phi', { targets: { phi: 88.45 * DEG } }, 500], ['w', { targets: { w: 30 } }, 600], ['kh', { targets: { kh: 1 / 300 }, transition: 120 }, 550]]) {
  test(`D642 2e ${ch}: every control point whose basis starts before the mark (${F} m) is the piece's without the change, byte for byte`, () => {
    const T = ch === 'phi' ? -30 * DEG : ch === 'w' ? 40 : -1 / 300, P = head(extend(flat(), { length: 1000, ...o, changes: { [ch]: [{ from: F, target: T }] } })), P0 = head(extend(flat(), { length: 1000, ...o }));
    const Q = D.insertKnots(P0, P.knots.filter((k) => !P0.knots.includes(k))), U = D.knotVector(P);
    assert.deepEqual(Q.knots, P.knots, 'the same knots');
    let n = 0; for (let i = 0; U[i] < F - 1e-9; i++) { n++; assert.equal(P.channels[ch][i], Q.channels[ch][i], `control point ${i} (its basis starts at ${U[i]} m)`); }
    assert.ok(n > 10, `${n} control points before the mark`);
  });
}
// ── 2f. the step blends by the C2 quintic (extend.js: every change, whatever the first ramp's shape): 10 m past the mark the change's own curvature (the piece's less the
// piece's without it) is the quintic's there, within 25% (his L135 piece, 30° over 750 m back to 0 from 572: the quintic −2.67e-3 °/m², the fit −2.52e-3; the route cubic doubles it)
test('D642 2f: 10 m past the mark the bank change\'s own curvature is the C2 quintic\'s within 25%', () => {
  const P = head(extend(flat(), { length: 750, targets: { phi: 30 * DEG }, changes: { phi: [{ from: 572, target: 0 }] } })), N = head(extend(flat(), { length: 750, targets: { phi: 30 * DEG } }));
  const u = 10 / 178, want = (60 * u - 180 * u * u + 120 * u ** 3) * (-30) / (178 * 178), got = (D.channelAt(P, 'phi', 582).d2 - D.channelAt(N, 'phi', 582).d2) / DEG;
  assert.ok(Math.abs(got - want) <= 0.25 * Math.abs(want), `the change's curvature 10 m past the mark is ${got.toExponential(3)} °/m², the quintic's ${want.toExponential(3)}`);
});
// ── 3e. (C's 35ef2eb6, the R2 reds after C's pass-through) the first ramp under the change is the panel's ROUNDED bank (extend.js roundedLinear): its rate holds and drops in
// its last metres, so it already rolls near the bar at its end, inside the change's span; the change's shortest must take that, not a quintic's share (R2 read 1.174 × the bar)
for (const [what, T1, L, T2] of [['his picture: 66.14° over 750 m, back to 0', 66.14, 750, 0], ['88.45° over 1,000 m, back to −30°', 88.45, 1000, -30], ['30° over 600 m, on to 60°', 30, 600, 60]]) {
  test(`D642 3e ${what}, the panel's rounded bank, the change at its shortest: the built roll accelerates under the bar (× 1.05)`, () => {
    const o = { length: L, targets: { phi: T1 * DEG }, bankShape: 'rounded' }, raw = X.secondMinM('phi', T1 * DEG, T2 * DEG, { step: T1 * DEG, length: L, shape: 'rounded' }), min = Math.ceil(raw * 10) / 10;
    assert.equal(X.secondMinM('phi', T1 * DEG, T2 * DEG, { step: T1 * DEG, length: L }), raw, 'a base with no shape named is the panel\'s own bank, the rounded ramp');
    const d = extend(extend(flat(), { ...o, changes: { phi: [{ from: L - min, target: T2 * DEG }] } }), { length: 200 }), pk = builtRollPeak(d, 1000 + L - min - 20, 1000 + L + 20);
    assert.ok(pk <= 1.05, `the built roll reads ${pk.toFixed(3)} × the bar (the change over its shortest, ${min} m)`);
  });
}
// ── 3f. (pane E's tip review 9a1a566f §5) THE MINIMUM IS TIGHT: a fixed share sized on the worst picture refused his own p2 bank-back (88.45° → −88.45° from 500 on 1,000 m:
// it asked 592.5 m where there is 500), though 923e0a3 laid that piece at 0.955 × the bar. The bank's shortest under a moving first ramp is now read off the BUILT road
// (extend.js secondMinM probes bankPlan), so his p2 lays, and what it admits stays under the bar.
const HIS_P2 = { length: 1000, turnDeg: -90, targets: { phi: 88.45 * DEG, c: 15.5, w: 31 }, bankShape: 'rounded', changes: { turnDeg: [{ from: 500, deg: 180 }], phi: [{ from: 500, target: -88.45 * DEG }] } };
test('D642 3f: his p2 (−90, extra +180 from 500, the rounded bank 88.45° back to −88.45° from 500) is laid, and its built roll accelerates under the bar (× 1.05)', () => {
  const d = extend(TB.extendCorner(flat(), HIS_P2), { length: 200 }), pk = builtRollPeak(d, 1000 + 500 - 20, 2000 + 20);
  assert.ok(pk <= 1.05, `the built roll reads ${pk.toFixed(3)} × the bar`);
  assert.ok(Math.abs(D.channelAt(d.pieces[1], 'phi', 1000).v + 88.45 * DEG) <= 1e-6, 'it ends at −88.45°');
});
test('D642 3g: the bank\'s shortest under a moving first ramp is no longer than the capped share asks, and laid at it the built roll stays under the bar (× 1.05), for his p2 and his picture', () => {
  for (const [what, T1, L, T2] of [['his p2', 88.45, 1000, -88.45], ['his picture', 66.14, 750, 0]]) {
    const own = X.secondMinM('phi', T1 * DEG, T2 * DEG), min = X.secondMinM('phi', T1 * DEG, T2 * DEG, { step: T1 * DEG, length: L, shape: 'rounded' });
    assert.ok(min >= own - 1e-9 && min <= own / Math.sqrt(0.5) + 1e-9, `${what}: ${min} m between its own ${own} and the capped share's ${own / Math.sqrt(0.5)}`);
    const L2 = Math.ceil(min * 10) / 10, d = extend(extend(flat(), { length: L, targets: { phi: T1 * DEG }, bankShape: 'rounded', changes: { phi: [{ from: L - L2, target: T2 * DEG }] } }), { length: 200 });
    const pk = builtRollPeak(d, 1000 + L - L2 - 20, 1000 + L + 20);
    assert.ok(pk <= 1.05, `${what} at its shortest, ${L2} m: the built roll reads ${pk.toFixed(3)} × the bar`);
  }
});
// ── 3h. and the other side of tight: a span past the change's own minimum that the built road cannot carry is still refused by name (his picture, the panel's rounded bank:
// at 262 m, its own 256.2 m plus 6, the road reads well over the bar), naming a shortest that does hold
test('D642 3h: a span the built road cannot carry, past the change\'s own minimum, is refused by name, and the shortest it names holds', () => {
  const own = X.secondMinM('phi', 66.14 * DEG, 0), make = (L2) => () => extend(flat(), { length: 750, targets: { phi: 66.14 * DEG }, bankShape: 'rounded', changes: { phi: [{ from: 750 - L2, target: 0 }] } });
  let named = null;
  assert.throws(make(Math.ceil(own) + 6), (e) => { named = Number((e.message.match(/needs at least ([\d.]+) m/) || [])[1]); return e.code === 'BAD_SECOND' && named > Math.ceil(own) + 6; }, `refused at ${Math.ceil(own) + 6} m`);
  const d = extend(make(Math.ceil(named * 10) / 10)(), { length: 200 }), pk = builtRollPeak(d, 1000 + 750 - named - 20, 1000 + 750 + 20);
  assert.ok(pk <= 1.05, `at the named ${named} m the built roll reads ${pk.toFixed(3)} × the bar`);
});
// ── 3i. (pane E's review 48b2ccf3) A DRAG REUSES THE BUILT ROAD: dragging his bank back asked the core's shortest 13 times a move and built 12-18 probe roads each move
// (106 ms a move), because every target was a new key. The probes are now kept by a 1° grid of the change, rounded up, and a new step starts from its neighbour's answer.
// A drag of 40 moves of 0.5° toward level (13 asks a move, as the panel asks, and one extend) builds at most 120 probe roads (639 before); a target between two steps asks
// what the bigger step asks. Its own bank (77° over 900 m), so no row before it has kept these probes.
test('D642 3i: a drag of the extra bank, 40 moves of 0.5° with 13 asks a move, builds at most 120 probe roads, and a target between grid steps asks what the bigger step asks', () => {
  const A = require('../src/core/adapter.js'), bp = A.bankPlan; let roads = 0;
  A.bankPlan = (d) => { if (d.name === 'probe') roads++; return bp(d); };
  try {
    const base = { step: 77 * DEG, length: 900 };
    for (let k = 0; k < 40; k++) {
      const T2 = (-50 + 0.5 * k) * DEG;
      for (let c = 0; c < 13; c++) X.secondMinM('phi', 77 * DEG, T2, base);
      try { extend(flat(), { length: 900, targets: { phi: 77 * DEG }, bankShape: 'rounded', changes: { phi: [{ from: 450, target: T2 }] } }); } catch (e) { if (e.code !== 'BAD_SECOND') throw e; }
    }
    assert.ok(roads <= 120, `the drag built ${roads} probe roads`);
    assert.ok(roads > 0, 'the drag probed the built road at all');
    // the grid rounds the change's size UP: −40.3° from 77° (a change of 117.3°) asks what −41° (118°) asks, never what −40° (117°) does
    assert.equal(X.secondMinM('phi', 77 * DEG, -40.3 * DEG, base), X.secondMinM('phi', 77 * DEG, -41 * DEG, base));
    assert.ok(X.secondMinM('phi', 77 * DEG, -41 * DEG, base) >= X.secondMinM('phi', 77 * DEG, -40 * DEG, base), 'the bigger change needs no less');
  } finally { A.bankPlan = bp; }
});
// ── 3k. (the librarian's ruling on pane B's §9) THE PROBE'S BAR IS THE ADAPTER'S OWN, 1.0 (src/core/adapter.js BANK_BAR: the bar its rounding brings every corner under), not
// pane B's 0.97 margin, which sat on the ~0.97 plateau his rounded bank keeps whatever the span. Of E's 15 marks of his p2 the panel kept and the core refused (a99775ef §1),
// the bar alone clears 14; 521 (a span of 479 m, a single-span spike of the bank rounding: 1.044 x on the built path) stays refused by name, for the panel's walk (pane C).
test('D642 3k: his p2\'s marks that the bar of 1.0 clears are laid (441-525 but 521), and 521, a single-span spike, is still refused by name', () => {
  const at = (F) => () => TB.extendCorner(flat(), { ...HIS_P2, changes: { ...HIS_P2.changes, phi: [{ from: F, target: -88.45 * DEG }] } });
  for (const F of [441, 442, 445, 462, 482, 483, 484, 485, 501, 503, 504, 522, 523, 525]) assert.doesNotThrow(at(F), `the mark at ${F} is laid`);
  assert.throws(at(521), (e) => e.code === 'BAD_SECOND', 'the mark at 521 (a span of 479 m) is refused by name');
});
// ── 3l. (pane E's review 72b9faf4 §2) THE PROBE ASKS PAST THE CEILING TOO: spanHolds took any span at or past the closed-form ceiling without a probe, and on the rounded ramp
// single-metre spikes sit past it: his picture's 66.14° back to 0 laid a span of 373 m at 1.059 x the bar and 331 at 1.003. Every from of his picture's mark slid 360-470 (a span
// of 390-280 m) that the core lays builds under the bar on the built path (× 1.05).
test('D642 3l: every from of his picture\'s mark from 360 to 470 that the core lays builds under the bar (× 1.05)', () => {
  const over = [];
  for (let F = 360; F <= 470; F++) {
    let d;
    try { d = extend(flat(), { length: 750, targets: { phi: 66.14 * DEG }, bankShape: 'rounded', changes: { phi: [{ from: F, target: 0 }] } }); } catch (e) { if (e.code !== 'BAD_SECOND') throw e; continue; }
    const pk = builtRollPeak(extend(d, { length: 200 }), 1000 + F - 20, 1000 + 750 + 20);
    if (pk > 1.05) over.push(`${F} (a span of ${750 - F} m): ${pk.toFixed(3)}`);
  }
  assert.deepEqual(over, [], `laid over the bar: ${over.join('; ')}`);
});
