// core_changes.test.js: node --test test/core_changes.test.js. L139, MORE THAN ONE CHANGE PER FIELD (the keeper, 2026-11-05 00:34: "We could just build the second move
// feature before. Remember its more than just the banking, its the turns, climb, etc."; 06:49Z: "what if i want the climb to change more than once per piece, the same with
// turns? With turns you can create multiple snaking curves with one piece"). extend(..., { changes: { kh|kv|phi|w|c|e|er: [{ from, target }, ...] } }) and, read as
// corners, extendCorner(..., { turnDeg, changes: { turnDeg: [{ from, deg }, ...] } }). The bar is pane E's registration (lighthouse exo_memory/loop/
// l139_registration_2026-11-05.md, fc21dcdd, and the plan's "AMENDED AGAIN"): each change holds the value before it to its own mark within 1% of its change (docLeak),
// the minimums are E's (A) and refused by name, the S and the snake end straight on their heading, no change leaves the bytes as they were.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const X = require('../src/core/extend.js');
const { extend } = X;
const A = require('../src/core/adapter.js');
const TB = require('../src/core/turnby.js');

const DEG = Math.PI / 180, ROUTE_BAR = 29.4 / (10 * 170 * 170);
const flat = () => extend(D.createDoc('g'), { length: 1000, family: 'bowl' });
const head = (d) => d.pieces[d.pieces.length - 1];
const at = (d, ch, s) => D.channelAt(head(d), ch, s).v;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
/** docLeak (E's M1): the most a channel moves before `upTo` against the same piece without that change, every 0.5 m. */
function leak(withIt, without, ch, upTo) { let m = 0; for (let s = 0; s < upTo; s += 0.5) m = Math.max(m, Math.abs(at(withIt, ch, s) - at(without, ch, s))); return m; }
/** The angle ∫ch ds over [0, s] on the adapter's rule (the trapezoid on 2 m segments, src/core/adapter.js toSegments), rad. */
function integral(d, ch, s1) { const P = head(d), n = Math.max(1, Math.ceil(s1 / 2 - 1e-9)); let a = 0, prev = at(d, ch, 0); for (let j = 1; j <= n; j++) { const s = (s1 * j) / n, v = at(d, ch, s); a += ((prev + v) / 2) * (s1 / n); prev = v; } return a; }
/** At a later change's mark: the value before it reached, within 1% of that change, and its slope at most 1% of that ramp's peak slope (the blend's 1.5·|Δ|/segment).
 *  (E's addendum wrote the slope bar as 1e-6·|Δ| per m; E's own emulator measured 1.8e-7 on X2 (bar 1e-8) and ≤ 1e-8 on X3 (bar 6.7e-9), so it is set here against the ramp it ends.) */
function reachedAt(d, ch, s, want, dl, seg) { const x = D.channelAt(head(d), ch, s); assert.ok(Math.abs(x.v - want) <= 0.01 * dl, `${ch} at ${s} m is ${x.v}, not ${want}`); assert.ok(Math.abs(x.d1) <= 0.01 * (1.5 * dl) / seg, `${ch}'s slope at ${s} m is ${x.d1}`); }
/** The end: value, slope and curvature of the head piece's channel (document.js channelAt at L). */
const endOf = (d, ch) => D.channelAt(head(d), ch, head(d).length);
/** The heading change over the head piece on the adapter's path, degrees (core_turnby.test.js pathTurn). */
function pathTurn(d) {
  const S = A.toPath(d).path.samples, L = head(d).length, s0 = d.pieces.slice(0, -1).reduce((a, p) => a + (p.type === 'flight' ? 0 : p.length), 0);
  const near = (s) => { let b = S[0]; for (const x of S) if (Math.abs(x.s - s) < Math.abs(b.s - s)) b = x; return Math.atan2(b.T[0], b.T[2]); };
  let a = near(s0 + L) - near(s0); while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a / DEG;
}

// ── the rate mode: each field, one change after its first, holds to its own mark and ends at its target with slope 0 (C2 fields with curvature 0)
const FIELDS = [
  // [field, first target, then, from, tolerance on the end value]
  ['kh', 1 / 300, -1 / 300, 550, 1e-9],
  ['kv', 4 * DEG / 100, 0, 800, 1e-9],
  ['phi', 30 * DEG, 0, 700, 1e-6],
  ['w', 30, 40, 600, 1e-3],
  ['c', 40, 10, 600, 1e-3],
  ['e', 20, 0, 500, 1e-3],
  ['er', 10, 25, 500, 1e-3],
];
for (const [ch, T1, T2, F, tol] of FIELDS) {
  test(`L139 1 ${ch}: a change of ${ch} from ${F} m holds the first value to its mark (docLeak ≤ 1% of the change), then ends at ${T2} with slope 0${X.C2_CHANNELS.has(ch) ? ' and curvature 0' : ''}`, () => {
    const base = { length: 1000, targets: { [ch]: T1, ...(ch === 'er' ? { e: 10 } : {}) }, transition: 120 };
    const one = extend(flat(), base), two = extend(flat(), { ...base, changes: { [ch]: [{ from: F, target: T2 }] } });
    const lk = leak(two, one, ch, F), d = Math.abs(T2 - T1);
    assert.ok(lk <= 0.01 * d, `docLeak ${lk} against 1% of ${d}`);
    const e = endOf(two, ch);
    assert.ok(Math.abs(e.v - T2) <= tol, `ends at ${e.v}, not ${T2}`);
    assert.ok(Math.abs(e.d1) <= 1e-9 * Math.max(1, d), `end slope ${e.d1}`);
    if (X.C2_CHANNELS.has(ch)) assert.ok(Math.abs(e.d2) <= 1e-9 * Math.max(1, d), `end curvature ${e.d2}`);   // endC2 makes it 0 to rounding (~1e-17); without it a 400 m cup change ends at 1.2e-5 (CH2)
  });
}

test('L139 2: two changes on the turn (1/300 → −1/300 from 450, → 0 from 750): the first value holds to mark 1, −1/300 is reached at 750 with slope ~0, and the piece ends straight', () => {
  const base = { length: 1000, targets: { kh: 1 / 300 }, transition: 120 }, c1 = { from: 450, target: -1 / 300 }, c2 = { from: 750, target: 0 };
  const one = extend(flat(), base), three = extend(flat(), { ...base, changes: { kh: [c1, c2] } });
  assert.ok(leak(three, one, 'kh', 450) <= 0.01 * (2 / 300), `the first value leaks ${leak(three, one, 'kh', 450)} before 450`);
  reachedAt(three, 'kh', 750, -1 / 300, 2 / 300, 300);
  const e = endOf(three, 'kh'); assert.ok(Math.abs(e.v) <= 1e-9 && Math.abs(e.d1) <= 1e-9, `ends at ${e.v}, slope ${e.d1}`);
});

test('L139 3: the L135 form `second: { phi: { from, target } }` is a one-item list: the same document as `changes: { phi: [{ from, target }] }`', () => {
  const base = { length: 750, targets: { phi: 30 * DEG }, transition: 300 };
  assert.equal(D.serialize(extend(flat(), { ...base, second: { phi: { from: 609, target: 10 * DEG } } })), D.serialize(extend(flat(), { ...base, changes: { phi: [{ from: 609, target: 10 * DEG }] } })));
});

// E's §M3: bank 30° → 0 from 700, turn 1/300 → −1/300 from 550, climb 4°/100 m → 0 from 800, first ramps over 120 m, on 1,000 m, in all six orders
const M3 = { phi: [{ from: 700, target: 0 }], kh: [{ from: 550, target: -1 / 300 }], kv: [{ from: 800, target: 0 }] };
const M3_FIRST = { phi: 30 * DEG, kh: 1 / 300, kv: 4 * DEG / 100 };
const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
test('L139 4 (E §M3): three fields, three marks; each holds to its own mark within 1% of its change, and the six orders of the fields give the same document', () => {
  const base = { length: 1000, targets: M3_FIRST, transition: 120 }, none = extend(flat(), base), docs = new Set();
  for (const order of perms(Object.keys(M3))) {
    const d = extend(flat(), { ...base, changes: Object.fromEntries(order.map((k) => [k, M3[k]])) });
    for (const ch of order) { const lk = leak(d, none, ch, M3[ch][0].from), dl = Math.abs(M3[ch][0].target - M3_FIRST[ch]); assert.ok(lk <= 0.01 * dl, `${order.join(',')}: ${ch} leaks ${lk} against ${0.01 * dl}`); }
    for (const ch of order) assert.ok(Math.abs(endOf(d, ch).v - M3[ch][0].target) <= 1e-6, `${order.join(',')}: ${ch} ends at ${endOf(d, ch).v}, not its change's ${M3[ch][0].target}`);   // the changes are laid at all (a core that ignores them is order-blind too)
    docs.add(D.serialize(d));
  }
  assert.equal(docs.size, 1, 'the order of the fields in `changes` moves nothing');
});
test('L139 4b (the amendment): M3 with two changes on the turn (→ −1/300 from 450, → 0 from 650) holds every field to every mark', () => {
  const base = { length: 1000, targets: M3_FIRST, transition: 120 }, ch2 = { ...M3, kh: [{ from: 450, target: -1 / 300 }, { from: 650, target: 0 }] };
  const d = extend(flat(), { ...base, changes: ch2 }), none = extend(flat(), base);
  assert.ok(leak(d, none, 'kh', 450) <= 0.01 * (2 / 300), `the turn leaks ${leak(d, none, 'kh', 450)} before 450`);
  reachedAt(d, 'kh', 650, -1 / 300, 2 / 300, 200);
  for (const ch of ['phi', 'kv']) assert.ok(leak(d, none, ch, ch2[ch][0].from) <= 0.01 * Math.abs(M3_FIRST[ch]), `${ch} leaks`);
  assert.ok(Math.abs(endOf(d, 'kh').v) <= 1e-9, 'the turn ends at 0');
});

// ── the minimums (E's (A)): exported, refused by name at min − 0.1 m, laid at the minimum
// The minimums are the keeper's ruling of 07:00Z ("smooth all around", pane E 711d7d10): every change's own peak under its bar on the built road (scratch smooth.js, the hand-back).
// AMENDED 2026-11-10 (rule changed: the width, cup and edges are refused only below the floor measured on the built road, 40 m and 26 m, or their old comfort length where that is
// shorter, so a tiny change keeps 20 m; the user, 2026-11-10, on the extra bank: "now the same thing happens when I want to bank the turn that u fixed"). Was: the width ∛(30·Δw/(0.9·BAR)) (148.5 m for 10 m) and the cup and edges
// ∛(60·8.4·Δ/BAR) (137.4 m for 30°). The bank, the turn and the climb are as they were here (the bank's comfort length is what always holds; the core reads its built road under it)
test('L139 5a: secondMinM is the core\'s, one function: bank 31.5·√Δ°, turn and climb max(20, 3·|Δ|/ROUTE_BAR), width 40 m, cup and edges 26 m (or less for a tiny change), never under 20 m', () => {
  assert.equal(X.SECOND_MIN_K, 31.5);
  assert.equal(X.SECOND_FLOOR_M, 20);
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 0.05, `${what}: ${a}, not ${b}`);
  near(X.secondMinM('phi', 30 * DEG, 0), 31.5 * Math.sqrt(30), 'bank 30° → 0');
  near(X.secondMinM('kh', 1 / 300, 0), 98.3, 'turn 1/300 → 0');
  near(X.secondMinM('kh', 1 / 300, -1 / 300), 196.6, 'the S rate');   // 3·(2/300)/ROUTE_BAR = 196.598 (E's fc21dcdd wrote 196.7; 2 × 98.299)
  near(X.secondMinM('kv', 4 * DEG / 100, 0), 20.6, 'climb 4°/100 m → 0');
  near(X.secondMinM('kv', 1e-4, 0), 20, 'a small climb change: the 20 m floor');
  near(X.secondMinM('w', 30, 40), 40, 'width 30 → 40 (40 m, the measured floor)');
  near(X.secondMinM('w', 30, 30.1), Math.cbrt((30 * 0.1) / (0.9 * ROUTE_BAR)), 'width 30 → 30.1: its old comfort length (32.0 m), shorter than the floor');
  for (const ch of ['c', 'e', 'er']) near(X.secondMinM(ch, 40, 10), 26, `${ch} 40 → 10 (26 m, the measured floor)`);
  for (const ch of ['w', 'c', 'e', 'er']) assert.equal(X.secondMinM(ch, 30, 30.0001), 20, `${ch}: a tiny change, the 20 m floor`);
  assert.throws(() => X.secondMinM('s', 0, 1), (e) => e.code === 'BAD_TARGET');
});
for (const [ch, T1, T2, extra] of [['kh', 1 / 300, -1 / 300, {}], ['kv', 4 * DEG / 100, 0, {}], ['phi', 30 * DEG, 0, {}], ['w', 30, 40, {}], ['c', 40, 10, {}]]) {
  // AMENDED 2026-11-10 (rule changed, the user, 2026-11-10, on the extra bank: "now the same thing happens when I want to bank the turn that u fixed"): for the bank, the minimum refused by name is its fit floor, 26 m; its comfort length (secondMinM) is
  // where it is always laid, and between the two the road as built decides (test/core_extra_change.test.js). On this straight road's end the built road rounds a 26 m change
  // back over its hold, so at the floor it is refused too, by the built road, naming the comfort length
  test(`L139 5b ${ch}: a change shorter than its minimum by 0.1 m is refused by name (BAD_SECOND, the field, the change and the minimum); at the minimum it is laid`, () => {
    const min = ch === 'phi' ? 26 : X.secondMinM(ch, T1, T2), make = (L2) => () => extend(flat(), { length: 1000, targets: { [ch]: T1, ...extra }, transition: 120, changes: { [ch]: [{ from: 1000 - L2, target: T2 }] } });
    assert.throws(make(min - 0.1), (e) => e.code === 'BAD_SECOND' && e.message.includes(ch) && e.message.includes('change 1') && e.message.includes(min.toFixed(1)), `refused at ${min - 0.1}`);
    if (ch !== 'phi') assert.doesNotThrow(make(min + 1e-6), `laid at ${min}`);
    else {
      const comfort = X.secondMinM(ch, T1, T2);
      assert.throws(make(min + 1e-6), (e) => e.code === 'BAD_SECOND' && /the built road rounds/.test(e.message) && e.message.includes(comfort.toFixed(1)), 'at the fit floor this straight road\'s built bank does not hold: refused, naming the comfort length');
      assert.doesNotThrow(make(comfort + 1e-6), 'at the comfort length: laid');
    }
  });
}
test('L139 5c: a segment between two marks is held to the minimum as well (a change 10 m after the one before it is refused, naming change 1, the segment it starts)', () => {
  assert.throws(() => extend(flat(), { length: 1000, targets: { w: 30 }, transition: 120, changes: { w: [{ from: 500, target: 40 }, { from: 510, target: 30 }] } }),
    (e) => e.code === 'BAD_SECOND' && e.message.includes('change 1') && e.message.includes(X.secondMinM('w', 30, 40).toFixed(1)));
});

test('L139 6: refusals by name: no first target, marks out of order, a mark before the first ramp ends, a channel with no change, a target out of range', () => {
  const base = { length: 1000, transition: 120 };
  assert.throws(() => extend(flat(), { ...base, targets: {}, changes: { kh: [{ from: 500, target: 0 }] } }), (e) => e.code === 'BAD_SECOND' && e.message.includes('kh'), 'no first target');
  assert.throws(() => extend(flat(), { ...base, targets: { w: 30 }, changes: { w: [{ from: 700, target: 40 }, { from: 500, target: 30 }] } }), (e) => e.code === 'BAD_SECOND', 'out of order');
  assert.throws(() => extend(flat(), { ...base, targets: { w: 30 }, changes: { w: [{ from: 100, target: 40 }] } }), (e) => e.code === 'BAD_SECOND' && e.message.includes('120'), 'before the first ramp ends');
  assert.throws(() => extend(flat(), { ...base, targets: { r: 1 }, changes: { r: [{ from: 500, target: 2 }] } }), (e) => e.code === 'BAD_TARGET', 'r has no change');
  assert.throws(() => extend(flat(), { ...base, targets: { c: 40 }, changes: { c: [{ from: 500, target: 170 }] } }), (e) => e.code === 'BAD_CUP', 'a cup past 150');
  assert.throws(() => extend(flat(), { ...base, targets: { w: 30 }, changes: { w: { from: 500, target: 40 } } }), (e) => e.code === 'BAD_SECOND', 'not a list');
});

// ── nothing asked, nothing moved: the bytes
/** AMENDED 2026-11-10 (helper): the built bank of the piece at index i (the adapter's, bankPlan) against its document from 250 m before the mark F to the change's end E:
 *  { hold: the most it leaves the document before F, reach: how far it is from the document at E } in degrees. A bank change is now refused only where these pass 0.5°. */
function builtBankOf(d, i, F, E) {
  const A = require('../src/core/adapter.js'), plan = A.bankPlan(d), P = d.pieces[i], v = (t) => D.channelValue(P, 'phi', t), b = (t) => (plan[i].fn ? plan[i].fn(t) : v(t));
  let hold = 0; for (let t = Math.max(0, F - 250); t <= F; t += 0.5) hold = Math.max(hold, Math.abs(b(t) - v(t)));
  return { hold: hold / (Math.PI / 180), reach: Math.abs(b(E) - v(E)) / (Math.PI / 180) };
}
test('L139 7: no change asked, the same bytes: `changes` undefined, null, {} and empty lists leave a piece as it was; his sketch with its typed from 637.5 is refused by name (E 711d7d10 item 6)', () => {
  const base = { length: 750, targets: { phi: 30 * DEG, w: 25 }, transition: { phi: 300 } }, want = D.serialize(extend(flat(), base));
  for (const changes of [undefined, null, {}, { phi: [] }]) assert.equal(D.serialize(extend(flat(), { ...base, changes })), want, `changes: ${JSON.stringify(changes)}`);
  // his sketch (L136), the options app/core/panel.js extendOptions made at 0df08db; E's registration pins its document, sha256 a33c039f…
  const sketch = { length: 750, targets: { phi: -0.4968952380427856, w: 30, c: 15 }, bankShape: { rise: 0.08888888888888889, fall: 0.9111111111111111 }, second: { phi: { from: 637.5, target: 0 } },
    turnDeg: 270, climbDeg: -6, startShapes: { c: { rise: 0.08888888888888889, fall: 0.9111111111111111 } }, transition: { phi: 300, c: 300 } };
  // E's registration pinned its 0df08db document (sha256 a33c039f…); under K = 31.5 its 28.47° second bank needs 168.1 m against the 112.5 m it was typed with, and E's
  // item 6, restated (711d7d10), was that the typed from is refused by name.
  // AMENDED 2026-11-10 (rule changed: under the comfort length a bank change is read on the road as built, the user, 2026-11-10, on the extra bank: "now the same thing happens when I want to bank the turn that u fixed"): his sketch turns 270°, and its built
  // bank holds and reaches over the 112.5 m it was typed with, so it is laid as he typed it
  const laid = TB.extendCorner(extend(D.createDoc('e'), { length: 1000, family: 'bowl' }), sketch), bb = builtBankOf(laid, 1, 637.5, 750);
  assert.ok(bb.hold <= 0.5 && bb.reach <= 0.5, `his sketch, from 637.5, is laid: its built bank leaves the document by ${bb.hold.toFixed(3)}° before the mark and ${bb.reach.toFixed(3)}° at the end`);
  assert.doesNotThrow(() => TB.extendCorner(extend(D.createDoc('e'), { length: 1000, family: 'bowl' }), { ...sketch, second: { phi: { from: 750 - 168.1, target: 0 } } }), 'at the new default it lays');
});

test('L139 8: mirror negates the turn and the bank changes and not the width or the cup; save and open round-trip them', () => {
  const PC = require('../src/core/piece.js');
  const src = extend(flat(), { length: 1000, targets: { kh: 1 / 300, phi: 20 * DEG, w: 30, c: 30 }, transition: 120,
    changes: { kh: [{ from: 500, target: -1 / 300 }], phi: [{ from: 600, target: -10 * DEG }], w: [{ from: 700, target: 40 }], c: [{ from: 650, target: 10 }] } });
  const run = PC.saveRun(src, 1, 1, { name: 'twice' }), P = PC.insert(flat(), run, { mirror: true }).pieces[1], S = src.pieces[1];
  const v = (Q, ch, s) => D.channelAt(Q, ch, s).v;
  for (const s of [400, 800, 1000]) {
    for (const ch of ['kh', 'phi']) assert.ok(Math.abs(v(P, ch, s) + v(S, ch, s)) <= 1e-6, `${ch} at ${s}`);
    for (const ch of ['w', 'c']) assert.ok(Math.abs(v(P, ch, s) - v(S, ch, s)) <= 1e-6, `${ch} at ${s}`);
  }
  assert.equal(D.serialize(D.parse(D.serialize(src))), D.serialize(src), 'save and open');
});

// ── corners: a list of corners, each exact, the piece straight after the last
// AMENDED D642 (rule changed, the keeper's ruling of 2026-11-05 19:54Z: the extra ADDS on top of the piece's own change and never squeezes it). Rows 9-11 asserted each corner
// exact and straight at its mark (the first corner squeezed into [0, mark]); now the first corner keeps its whole-piece shape and each extra adds its own angle over its span,
// so a mark is no longer straight. What they still pin: the whole change, the end straight, and each extra's own angle over its own span (test/core_additive.test.js is the rest).
const cornerAlone = (o) => { const { changes: _c, ...a } = o; return TB.extendCorner(flat(), a); };
test('L139 9 (E §M2, the S; AMENDED D642): a corner +90 with an extra −90 from 350 on a 700 m piece ends on the heading it started on (0.01°), its turn 0 and slope 0', () => {
  // was 600 m from 300: the extra −90 now has the base's own rate under it, and needs 344.6 m on 600 m (turnby.js cornerChangeMinM with the base)
  const o = { length: 700, turnDeg: 90, changes: { turnDeg: [{ from: 350, deg: -90 }] } }, d = TB.extendCorner(flat(), o);
  assert.ok(Math.abs(pathTurn(d)) <= 0.01, `the S turns ${pathTurn(d)}°`);
  assert.ok(Math.abs((integral(d, 'kh', 350) - integral(cornerAlone(o), 'kh', 350)) / DEG) <= 0.01, `to its mark the corner is its own: ${integral(d, 'kh', 350) / DEG}°`);
  const e = endOf(d, 'kh'); assert.ok(Math.abs(e.v) <= 1e-9 && Math.abs(e.d1) <= 1e-9, `ends at ${e.v}, slope ${e.d1}`);
});
test('L139 10 (the amendment; AMENDED D642): a snake, +60 with extras −60 from 300 and +60 from 600 over 900 m, ends at +60 and straight, each extra turning its own angle over its span', () => {
  const o = { length: 900, turnDeg: 60, changes: { turnDeg: [{ from: 300, deg: -60 }, { from: 600, deg: 60 }] } }, d = TB.extendCorner(flat(), o), a = cornerAlone(o);
  assert.ok(Math.abs(pathTurn(d) - 60) <= 0.01, `the snake turns ${pathTurn(d)}°`);
  assert.ok(Math.abs((integral(d, 'kh', 300) - integral(a, 'kh', 300)) / DEG) <= 0.01, `to 300 the corner is its own: ${integral(d, 'kh', 300) / DEG}°`);
  assert.ok(Math.abs((integral(d, 'kh', 600) - integral(a, 'kh', 600)) / DEG + 60) <= 0.01, `over 300-600 the first extra adds −60: ${(integral(d, 'kh', 600) - integral(a, 'kh', 600)) / DEG}°`);
  const e = endOf(d, 'kh'); assert.ok(Math.abs(e.v) <= 1e-9 && Math.abs(e.d1) <= 1e-9, `ends at ${e.v}, slope ${e.d1}`);
});
test('L139 11 (the amendment; AMENDED D642): a climb list over an inversion (+120°, an extra −120° from 500 on 1,000 m) pitches the corner\'s own to 500 and ends at a steady pitch, 0° in all', () => {
  const o = { length: 1000, climbDeg: 120, changes: { climbDeg: [{ from: 500, deg: -120 }] } }, d = TB.extendCorner(flat(), o);
  assert.ok(Math.abs((integral(d, 'kv', 500) - integral(cornerAlone(o), 'kv', 500)) / DEG) <= 0.01, `to 500 the climb is its own: ${integral(d, 'kv', 500) / DEG}°`);
  assert.ok(Math.abs(integral(d, 'kv', 1000) / DEG) <= 0.01, `to the end: ${integral(d, 'kv', 1000) / DEG}°`);
  const e = endOf(d, 'kv'); assert.ok(Math.abs(e.v) <= 1e-9 && Math.abs(e.d1) <= 1e-9, `ends at ${e.v}, slope ${e.d1}`);
});
test('L139 12 (E §M2): a corner after a corner needs the shortest corner from the straight it starts on: 0.1 m under it is refused by name, at it it is laid', () => {
  // AMENDED L139 R1 (rule changed, pane E's review §3: a later corner at cornerMinM read 194 × the bar): the minimum is max(cornerMinM, 31.5·√|Δθ°|), 172.5 m for 30°;
  // cornerMinM, the shortest corner from a straight, is still its floor
  assert.ok(TB.cornerMinM(flat(), { length: 1000 }) >= 20 && TB.cornerMinM(flat(), { length: 1000 }) <= 25, 'the shortest corner from a straight, the floor');
  // AMENDED D642 (rule changed: the extra adds on top of the base corner, so the base's own rate under it comes out of its budget, cornerChangeMinM's baseDeg; and the base
  // corner spans the whole piece, so it no longer has to fit before the first mark: it is refused as turnDeg alone is)
  // AMENDED 2026-11-10 (rule changed: an extra corner is refused only below the knot floor, as the first corner laid over its span would be; the comfort bar and the base's share
  // in it no longer refuse it, the user, 2026-11-10: "it should be free to continue bending even on a shorter section"): the minimum is cornerMinM, with or without the base
  const min = TB.cornerChangeMinM(flat(), { length: 1000 }, 30, 90), make = (L2) => () => TB.extendCorner(flat(), { length: 1000, turnDeg: 90, changes: { turnDeg: [{ from: 1000 - L2, deg: 30 }] } });
  assert.equal(min, TB.cornerMinM(flat(), { length: 1000 }), 'the knot floor'); assert.equal(TB.cornerChangeMinM(flat(), { length: 1000 }, 30), min, 'with no base the same');
  assert.throws(make(min - 0.1), (e) => e.code === 'TURN_TOO_SHORT' && e.message.includes('change 1') && e.message.includes(min.toFixed(1)), `refused at ${min - 0.1}`);
  assert.doesNotThrow(make(min), `laid at ${min}`);
  assert.doesNotThrow(() => TB.extendCorner(flat(), { length: 1000, turnDeg: 90, changes: { turnDeg: [{ from: 5, deg: 30 }] } }), 'an extra from 5 m: the base corner spans the piece, nothing to fit before the mark');
  assert.throws(() => TB.extendCorner(flat(), { length: 10, turnDeg: 90, changes: { turnDeg: [{ from: 5, deg: 0 }] } }), (e) => e.code === 'TURN_TOO_SHORT' && /needs at least \d+ m$/.test(e.message), 'a base corner too short is refused as turnDeg alone');
});
test('L139 13: corner lists are refused by name when they make no sense: no first corner, a turn rate change on a corner, marks out of order', () => {
  assert.throws(() => TB.extendCorner(flat(), { length: 600, changes: { turnDeg: [{ from: 300, deg: -90 }] } }), (e) => e.code === 'BAD_SECOND' && e.message.includes('turnDeg'));
  assert.throws(() => TB.extendCorner(flat(), { length: 600, turnDeg: 90, changes: { kh: [{ from: 300, target: 0 }] } }), (e) => e.code === 'BAD_SECOND' && e.message.includes('kh'));
  assert.throws(() => TB.extendCorner(flat(), { length: 900, turnDeg: 60, changes: { turnDeg: [{ from: 600, deg: -60 }, { from: 300, deg: 60 }] } }), (e) => e.code === 'BAD_SECOND');
});
test('L139 14: a corner list with no change is the corner as before (the same bytes as turnDeg alone)', () => {
  const o = { length: 600, turnDeg: 90, climbDeg: -6 };
  assert.equal(D.serialize(TB.extendCorner(flat(), { ...o, changes: { turnDeg: [] } })), D.serialize(TB.extendCorner(flat(), o)));
});
test('L139 15 (E addendum X2): a climb RATE list through an inversion (0 → 0.005 /m over 120 m, → −0.005 from 500, → 0 from 800) holds each value to its mark and ends level-rate', () => {
  const base = { length: 1000, targets: { kv: 0.005 }, transition: 120 }, c1 = { from: 500, target: -0.005 }, c2 = { from: 800, target: 0 };
  const one = extend(flat(), base), three = extend(flat(), { ...base, changes: { kv: [c1, c2] } });
  assert.ok(leak(three, one, 'kv', 500) <= 0.01 * 0.01, `the first value leaks ${leak(three, one, 'kv', 500)} before 500`);
  reachedAt(three, 'kv', 800, -0.005, 0.01, 300);
  assert.ok(integral(three, 'kv', 500) / DEG > 90, `the road is past vertical by 500 m: ${integral(three, 'kv', 500) / DEG}°`);
  const e = endOf(three, 'kv'); assert.ok(Math.abs(e.v) <= 1e-9 && Math.abs(e.d1) <= 1e-9, `ends at ${e.v}, slope ${e.d1}`);
});

// ── L139 R1/R2 (pane E's review of d750353, exo_memory/handback/p-l139-E_2026-11-05.md §2, §3; the chair's 02:30 packet): 9′ read on the BUILT road, on the path the
// keeper uses (app/core/panel.js extendOptions, then extendCorner), and the corner lists' own smooth length
const BANK_BAR = 29.4 / (10 * 170 * 170);
const { extendOptions } = require('../app/core/panel.js');
/** The built road's roll acceleration (the adapter's roll, 2 m second differences, as joints() b reads it), peak over [a, b] in track metres, ÷ the bar. */
function builtRollPeak(d, a, b) {
  const S = A.toPath(d).path.samples, r = (s) => { let lo = 0, hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; } return S[lo].roll; };
  let m = 0; for (let s = a; s <= b; s += 0.5) m = Math.max(m, Math.abs(r(s + 2) - 2 * r(s) + r(s - 2)) / 4); return m / BANK_BAR;
}
/** The built heading's (or pitch's) second difference over 1 m, peak over [a, b], ÷ the bar (pane E's l139slope.js reader). */
function builtTurnPeak(d, a, b, pitch = false) {
  const S = A.toPath(d).path.samples; let prev = null, off = 0;
  const H = S.map((x) => { let v = pitch ? Math.asin(Math.max(-1, Math.min(1, x.T[1]))) : Math.atan2(x.T[2], x.T[0]); if (prev !== null) { while (v + off - prev > Math.PI) off -= 2 * Math.PI; while (v + off - prev < -Math.PI) off += 2 * Math.PI; } v += off; prev = v; return { s: x.s, v }; });
  const atS = (s) => { let lo = 0, hi = H.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (H[m].s <= s) lo = m; else hi = m; } const f = (s - H[lo].s) / (H[hi].s - H[lo].s); return H[lo].v + f * (H[hi].v - H[lo].v); };
  let m = 0; for (let s = a; s <= b; s += 0.5) m = Math.max(m, Math.abs(atS(s + 1) - 2 * atS(s) + atS(s - 1))); return m / BANK_BAR;
}
const panelPiece = (f) => extendOptions({ length: '750', turn: '', climb: '', bank: '', width: '', cup: '', edge: '', start: '', tube: '', atStart: {}, turnAs: 'corner', ...f, secondMinM: X.secondMinM });
for (const [what, f] of [
  ['his 11-05 picture (750 m assumed): a −90° corner, bank 66.14° then 0, cup 15.5, the panel\'s default from', { turn: '-90', bank: '66.14', cup: '15.5', changes: { bank: [{ then: '0', from: '' }] } }],
  ['the same, bank "early"', { turn: '-90', bank: '66.14', cup: '15.5', atStart: { bank: true }, changes: { bank: [{ then: '0', from: '' }] } }],
  ['the same on a straight road (turn as a rate, none typed)', { turnAs: 'rate', bank: '66.14', cup: '15.5', changes: { bank: [{ then: '0', from: '' }] } }],
  ['his sketch (L136): 270° corner, climb −6, bank −28.47 early then 0, width 30, cup 15 early', { turn: '270', climb: '-6', bank: '-28.47', width: '30', cup: '15', atStart: { bank: true, cup: true }, changes: { bank: [{ then: '0', from: '' }] } }],
]) {
  test(`L139 R2: laid BY THE PANEL, ${what}: the built road's roll accelerates under the bar (× 1.05) from 20 m before the change's mark to 20 m into the next piece`, () => {
    const o = panelPiece(f), d = extend(TB.extendCorner(flat(), o), { length: 200 }), F = o.changes.phi[0].from;
    const pk = builtRollPeak(d, 1000 + F - 20, 1750 + 20);
    assert.ok(pk <= 1.05, `the built roll reads ${pk.toFixed(3)} × the bar after the mark at ${F} m`);
  });
}
// R1: a corner after the first is a symmetric ease over its own segment. AMENDED 2026-11-10 (rule changed: its shortest is the knot floor, cornerMinM, as the first corner laid over
// its span; the comfort bar max(cornerMinM, SECOND_MIN_K·√|Δθ in degrees|), with the base's share, no longer refuses it, the user, 2026-11-10: "it should be free to continue bending even on a shorter section").
// Was: refused 0.2 m under the comfort length, and the built rate under the bar at it. Now: refused 0.2 m under the floor by name, laid at it, exact in all, ending at rate 0
for (const [k, deg] of [['turnDeg', 90], ['turnDeg', 30], ['climbDeg', 40]]) {
  test(`L139 R1 ${k} ${deg}°: a corner change shorter than the knot floor by 0.2 m is refused by name; at it, the corners are laid exact and end at a rate of 0`, () => {
    const ch = k === 'turnDeg' ? 'kh' : 'kv', floor = TB.cornerMinM(flat(), { length: 1000 }), seg = (L2, late = 0) => ({ length: 3 * L2, [k]: deg, changes: { [k]: [{ from: L2, deg: -deg }, { from: 2 * L2 + late, deg }] } });
    assert.ok(typeof TB.cornerChangeMinM === 'function' && TB.cornerChangeMinM(flat(), { length: 1000 }, deg) === floor && TB.cornerChangeMinM(flat(), { length: 3 * floor }, deg, deg) === floor, 'exported, for the panel (the shell): the floor, with or without a base');
    assert.throws(() => TB.extendCorner(flat(), seg(floor, 0.2)), (e) => /TOO_SHORT/.test(e.code) && e.message.includes('change 2') && e.message.includes(floor.toFixed(1)), `refused 0.2 m under ${floor}`);
    const d = TB.extendCorner(flat(), seg(floor)), a = integral(d, ch, 3 * floor) / DEG, e = endOf(d, ch);
    assert.ok(Math.abs(a - deg) <= 0.01, `${deg}°, then ${-deg}° and ${deg}° over ${floor} m each: ${a.toFixed(4)}° in all`);
    assert.ok(Math.abs(e.v) <= 1e-9 && Math.abs(e.d1) <= 1e-9, `ends at ${e.v}, slope ${e.d1}`);
  });
}
