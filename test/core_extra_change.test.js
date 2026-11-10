// core_extra_change.test.js: node --test test/core_extra_change.test.js
// AN EXTRA BANK, WIDTH, CUP OR EDGE CHANGE IS REFUSED ONLY WHERE THE BUILT ROAD CANNOT CARRY IT (the user, 2026-11-10, after the extra turn was freed: "now the same thing
// happens when I want to bank the turn that u fixed, it jumps to -5 degrees and then stops"; "its the extra banking btw"). An extra change was held to the route's comfort
// length (the bank 31.5·√degrees), where a first one over the whole piece is not. Now each is refused only below the span at which the BUILT road still reaches its value
// and holds the value before its mark (src/core/extend.js), measured on the built road:
//   the width: 40 m, whatever the change (shorter, the fit overshoots its target by up to 0.2 m at 37 to 39 m)
//   the cup, the left and the right edge: 26 m (shorter, the fit moves the road before the mark: 0.15° a degree of change at 25 m)
//   the bank: read on the piece being laid. The adapter (src/core/adapter.js bankPlan) re-rounds a bank that rolls faster than its bar, spreading a short change back over
//   the hold, except where the road turns, and where the change turns the bank back the other way (the adapter pins the bank's turning point); so a span the comfort
//   length passes is laid as before, and a shorter one is laid when the built road of THIS piece holds
//   (within 0.5° of the document before the mark, and of the target at the change's end, never outside the two).
// His track (test/fixtures/extra-bank-short-2026-11-10.t180track): a 1,000 m straight, then 125 m: turn −90°, an extra turn of +90° from 62.5 m, bank 0.13°, an extra bank
// to −5.49° from 47.5 m (77.5 m of room).
//   1  his 125 m piece is what his fields lay (the fixture is what the rows below lay on)
//   2  on his piece the extra bank to −20° from 47.5 m is laid: the built bank reaches −20° at the end, and before the mark the road is his piece's (the document's control
//      points and knots byte for byte, the built positions and tangents byte for byte, the built roll within 1e-6 rad)
//   3  the same to −45°
//   4  on a straight road's end, a bank change the built road rounds back over its hold is still refused by name, in the words of the real limit; at the comfort length it is laid
//   5  the width, the cup and the edges are refused only below their measured floors (40 m, 26 m), by name; at the floor they are laid
//   6  at each measured floor the built road reaches the change's value, holds the value before its mark and never leaves the two (tolerance 0.05 m, 0.5°)
//   7  the shortest the panel reads (secondMinM) is that floor for the width, the cup and the edges, whatever the change; the turn and climb RATE changes keep theirs
//   8  under a moving first ramp the comfort length (a probe of the built roll) still lays what it passed; a span it does not pass is refused only where the road as built
//      does not hold it, naming a span that holds (and, past a single-span spike, the longest shorter one)
//   9  the built bank of the piece being laid is read with the piece before it alone, and that is the whole track's (to 1e-12 rad)
//  10  the bank under its fit floor, 26 m, is refused by name, naming it (0.5 m and 25.9 m), as the width, cup and edges are under theirs
//  11  what frees his piece, read apart: on his piece an extra bank the SAME way as his first (+20°) is laid too, because the road turns there; on a straight 125 m piece
//      his −20° is laid because it turns the bank back from his +0.13°, and +20° the same way is refused
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js');
const X = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const TB = require('../src/core/turnby.js');

const DEG = Math.PI / 180;
const HIS = D.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'extra-bank-short-2026-11-10.t180track'), 'utf8'));
const straight = Object.freeze(D.checkDoc({ ...HIS, pieces: HIS.pieces.slice(0, 1) }));   // his track up to the 125 m piece
const his = (bank) => ({ length: 125, turnDeg: -90, targets: { phi: 0.13 * DEG }, bankShape: 'rounded', changes: { turnDeg: [{ from: 62.5, deg: 90 }], phi: [{ from: 47.5, target: bank * DEG }] } });
/** The built bank of piece i (the adapter's: bankPlan where it re-lays the bank, else the document's). */
const builtBank = (d, i) => { const plan = A.bankPlan(d), P = d.pieces[i]; return (t) => (plan[i].fn ? plan[i].fn(t) : D.channelValue(P, 'phi', t)); };

test('row 1: his 125 m piece is what his fields lay', () => {
  const d = TB.extendCorner(straight, his(-5.49));
  assert.deepEqual(d.pieces[1].knots, HIS.pieces[1].knots); assert.deepEqual(d.pieces[1].channels, HIS.pieces[1].channels);
});

for (const [row, bank] of [[2, -20], [3, -45]]) {
  test(`row ${row}: on his piece the extra bank to ${bank}° from 47.5 m is laid, reaches ${bank}° as built, and before the mark the road is his piece's`, () => {
    const d = TB.extendCorner(straight, his(bank)), mine = TB.extendCorner(straight, his(-5.49)), b = builtBank(d, 1);
    assert.ok(Math.abs(b(125) / DEG - bank) < 0.01, `the built bank at the end: ${b(125) / DEG}°`);
    const P = d.pieces[1], Q = mine.pieces[1], U = D.knotVector(P);
    assert.deepEqual(P.knots, Q.knots, 'the same knots');
    for (const ch of Object.keys(P.channels)) assert.deepEqual(P.channels[ch].filter((x, i) => U[i] < 47.5 - 1e-9), Q.channels[ch].filter((x, i) => U[i] < 47.5 - 1e-9), `${ch}: every control point whose basis starts before the mark`);
    // the built road: positions and tangents byte for byte; the roll within 1e-6 rad, because once the adapter re-rounds a piece's bank it reads that piece's roll
    // through its own plan (5.6e-8 rad at −20°, 1.5e-7 at −45° measured), not because anything before the mark moved
    const S = A.toPath(d).path.samples, S0 = A.toPath(mine).path.samples; let n = 0, roll = 0;
    for (let i = 0; i < S.length && S[i].s <= 1000 + 47.5; i++) { n++; assert.deepEqual([S[i].s, S[i].pos, S[i].T], [S0[i].s, S0[i].pos, S0[i].T], `the built road at ${S[i].s} m`); roll = Math.max(roll, Math.abs(S[i].roll - S0[i].roll)); }
    assert.ok(n > 1000 && roll <= 1e-6, `${n} stations to the mark; the roll within ${roll.toExponential(2)} rad`);
  });
}

// a straight road: a 300 m piece holding bank 0, the change at its end, the head after it a straight
const flat = () => X.extend(D.createDoc('flat'), { length: 400, family: 'bowl' });
const bankAtEnd = (target, span, L = 300) => X.extend(flat(), { length: L, targets: { phi: 0 }, changes: { phi: [{ from: L - span, target: target * DEG }] } });
test('row 4: on a straight road\'s end a bank change the built road rounds back over its hold is refused by name; at the comfort length it is laid', () => {
  assert.throws(() => bankAtEnd(-20, 77.5), (e) => e.code === 'BAD_SECOND' && e.message.includes('change 1') && /the built road rounds/.test(e.message), 'his −20° over 77.5 m on a straight road');
  // and laid through a corner (src/core/turnby.js) whose ease has let go by then, the same: the corner's piece is checked as it is returned
  assert.throws(() => TB.extendCorner(flat(), { length: 300, turnDeg: 10, targets: { phi: 0 }, changes: { phi: [{ from: 300 - 77.5, target: -20 * DEG }] } }), (e) => e.code === 'BAD_SECOND' && /the built road rounds/.test(e.message), 'through a 10° corner');
  const min = X.secondMinM('phi', 0, -20 * DEG);
  assert.doesNotThrow(() => bankAtEnd(-20, Math.ceil(min * 10) / 10), `laid at the comfort length, ${min} m`);
});

const FLOORS = { w: 40, c: 26, e: 26, er: 26 };
const at0 = { w: 31, c: 20, e: 10, er: 10 };
const fieldAtEnd = (ch, delta, span, L = 300) => {
  const t = { [ch]: at0[ch], ...(ch === 'er' ? { e: at0.e } : {}) };
  return X.extend(X.extend(D.createDoc('x'), { length: 400, family: 'bowl', targets: t }), { length: L, targets: t, changes: { [ch]: [{ from: L - span, target: at0[ch] + delta }] } });
};
test('row 5: the width, the cup and the edges are refused only below their measured floors, by name; at the floor they are laid', () => {
  for (const [ch, delta] of [['w', 10], ['w', -10], ['c', 30], ['e', 20], ['er', -8]]) {
    assert.doesNotThrow(() => fieldAtEnd(ch, delta, FLOORS[ch]), `${ch} ${delta} over ${FLOORS[ch]} m`);
    assert.throws(() => fieldAtEnd(ch, delta, FLOORS[ch] - 1), (e) => e.code === 'BAD_SECOND' && e.message.includes('change 1') && e.message.includes(`${FLOORS[ch].toFixed(1)} m`) && /the built road rounds/.test(e.message), `${ch} ${delta} over ${FLOORS[ch] - 1} m: refused, naming ${FLOORS[ch]} m`);
  }
});

test('row 6: at each measured floor the built road reaches the change\'s value, holds the value before its mark, and never leaves the two', () => {
  const TOL = { w: 0.05, c: 0.5, e: 0.5, er: 0.5 };
  for (const [ch, deltas] of [['w', [1, 5, -10, 20, -25]], ['c', [1, 5, 10, -15, 40]], ['e', [1, 10, -8, 40]], ['er', [1, 10, -8, 40]]]) for (const delta of deltas) for (const span of [FLOORS[ch], FLOORS[ch] + 7, FLOORS[ch] + 30]) {
    const d = fieldAtEnd(ch, delta, span), P = d.pieces[1], F = 300 - span, a = at0[ch], b = a + delta, v = (t) => D.channelValue(P, ch, t), tol = TOL[ch];
    let hold = 0; for (let t = 0; t <= F; t += 0.25) hold = Math.max(hold, Math.abs(v(t) - a));
    let out = 0; for (let t = F; t <= 300; t += 0.25) out = Math.max(out, Math.min(a, b) - tol - v(t), v(t) - Math.max(a, b) - tol);
    assert.ok(hold <= tol && Math.abs(v(300) - b) <= tol && out <= 0, `${ch} ${delta} over ${span} m: hold ${hold}, end ${v(300)} for ${b}, outside by ${out}`);
  }
});

test('row 7: the shortest the panel reads is the measured floor for the width, the cup and the edges, whatever the change; the turn and climb rate changes keep theirs', () => {
  for (const [ch, a, b] of [['w', 31, 41], ['w', 31, 131], ['c', 20, 30], ['c', 0, 150], ['e', 10, 70], ['er', 10, -50]]) assert.equal(X.secondMinM(ch, a, b), FLOORS[ch], `${ch} ${a} → ${b}`);
  assert.ok(X.secondMinM('kh', 0, 0.01) > 100, `a turn rate change keeps its own: ${X.secondMinM('kh', 0, 0.01)} m`);
  assert.ok(X.spanHolds('w', 31, 131, null, 40) && !X.spanHolds('w', 31, 131, null, 39.9), 'spanHolds says the same');
});

// THE COMFORT LENGTH STILL LAYS WHAT IT PASSED; UNDER IT THE ROAD AS BUILT DECIDES. With a first ramp still moving under the change (30° over 300 m, the panel's rounded ramp,
// back to 0 at the end), the comfort length is a probe of the built road's roll (src/core/extend.js spanHolds), and it is not monotone in the span:
test('row 8: under a moving first ramp, a span the comfort probe passes is laid as before; one it does not pass is refused where the road as built does not hold it, naming a span that holds', () => {
  const at = (L2) => () => X.extend(flat(), { length: 300, targets: { phi: 30 * DEG }, bankShape: 'rounded', changes: { phi: [{ from: 300 - L2, target: 0 }] } });
  assert.doesNotThrow(at(237), '237 m: the probe passes it (0.995 of the bar), laid as before');
  let named = null;
  assert.throws(at(200), (e) => { named = e.needM; return e.code === 'BAD_SECOND' && /the built road rounds a shorter one back over the hold/.test(e.message) && e.message.includes(`${e.needM.toFixed(1)} m holds`); }, '200 m: refused, naming a length that holds');
  assert.doesNotThrow(at(Math.ceil(named * 10) / 10), `and that length, ${named} m, is laid`);
  assert.throws(at(256), (e) => e.code === 'BAD_SECOND' && /the built road rounds a longer one back over the hold; 255 m still holds/.test(e.message), '256 m, a single-span spike past it: refused, naming the longest shorter span that holds');
  assert.doesNotThrow(at(255), '255 m: laid');
});

test('row 9: the built bank of the piece being laid is read with the piece before it alone; on a longer track it is the same as the whole track\'s', () => {
  const A2 = require('../src/core/adapter.js');
  let d = X.extend(flat(), { length: 300, targets: { phi: 20 * DEG } });
  d = TB.extendCorner(d, { length: 400, turnDeg: 60, targets: { phi: -10 * DEG } });
  d = TB.extendCorner(d, his(-45));   // his piece, after two more
  const n = d.pieces.length, whole = A2.bankPlan(d)[n - 1], mini = A2.bankPlan({ closed: false, start: d.start, pieces: d.pieces.slice(-2) })[1], P = d.pieces[n - 1];
  const b = (pl) => (t) => (pl.fn ? pl.fn(t) : D.channelValue(P, 'phi', t));
  // the same within 1e-12 rad: the run's stations are summed from a different start (4e-13° measured), against the 0.5° the check reads to
  for (let t = 0; t <= 125; t += 0.5) assert.ok(Math.abs(b(mini)(t) - b(whole)(t)) <= 1e-12, `at ${t} m: ${b(mini)(t)} against ${b(whole)(t)}`);
});

test('row 10: the bank under its fit floor, 26 m, is refused by name, naming it', () => {
  for (const L2 of [0.5, 25.9]) assert.throws(() => bankAtEnd(-30, L2), (e) => e.code === 'BAD_SECOND' && e.message.includes('change 1') && e.message.includes('26.0 m') && /the built road rounds/.test(e.message), `${L2} m`);
});

test('row 11: what frees his piece, read apart: the road turns there (the same way as his first bank, +20°, is laid too); on a straight piece his −20° turns the bank back, and +20° is refused', () => {
  const sameWay = { ...his(-20), changes: { ...his(-20).changes, phi: [{ from: 47.5, target: 20 * DEG }] } };
  const d = TB.extendCorner(straight, sameWay), b = builtBank(d, 1);
  assert.ok(Math.abs(b(125) / DEG - 20) < 0.01, `+20° on his turning piece: laid, built ${b(125) / DEG}° at the end`);
  const plain = (bank) => () => X.extend(straight, { length: 125, targets: { phi: 0.13 * DEG }, bankShape: 'rounded', changes: { phi: [{ from: 47.5, target: bank * DEG }] } });
  assert.doesNotThrow(plain(-20), 'on a straight 125 m piece his −20° (back from +0.13°) is laid');
  assert.throws(plain(20), (e) => e.code === 'BAD_SECOND' && /the built road rounds/.test(e.message), 'on a straight 125 m piece +20° (on the same way) is refused');
});
