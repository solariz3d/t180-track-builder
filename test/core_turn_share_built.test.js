// core_turn_share_built.test.js: node --test test/core_turn_share_built.test.js. O1 (pane E's plan, lighthouse exo_memory/loop/plan_t180_faster_turn_rows_2026-11-26.md,
// section 3 "O1"; the librarian's read, 2026-11-26, and the chair's order D677 BUILD 3): a turn or climb change on a piece whose own first ramp still runs under it (D642,
// the change ADDS) was held to the closed-form ceiling, its own shortest over (1 − the first ramp's share), the share capped at 0.5, so up to TWICE its own (10.3 m per
// °/100m where its own is 5.15). Measured on the built road, the change and the ramp together read 0.48-0.73 of the bar at the change's own shortest (the plan, 2d). So,
// as the bank already is (E's 9a1a566f §5), a span between the change's own shortest and that ceiling is decided by ONE probe of the road as built: it lays where the
// built turn (or climb) rate changes no faster than the bar. The bar is unchanged (ROUTE_BAR, 3 g over 10 m at 170 m/s). A change with no first ramp under it, and one at or
// past the ceiling, are laid and refused exactly as before (rows R1c, R1e: today's messages and documents, captured on ceb21f5).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend, secondMinM } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');

const DEG = Math.PI / 180, BAR = 29.4 / (10 * 170 * 170), R = (x) => (x * DEG) / 100;   // °/100m → rad/m
/** A 200 m lead piece at `lead` (°/100m), then an L m piece typed `first` with one change to `to` from `from`: the head is at `lead`, so the piece's first ramp runs from
 *  `lead` to `first` over the whole piece (none when they are equal). */
const lay = (ch, lead, first, to, from, L = 300) => {
  const d = extend(D.createDoc('g'), { length: 200, targets: { [ch]: R(lead) } });
  return extend(d, { length: L, targets: { [ch]: R(first) }, changes: { [ch]: [{ from, target: R(to) }] } });
};
const sha = (d) => crypto.createHash('sha256').update(D.serialize(d)).digest('hex');
/** The BUILT heading's (or pitch's) second difference over 1 m, peak over [a, b] in metres along the track, ÷ the bar (core_additive.test.js builtTurnPeak, read off
 *  the adapter's path, not the document: the rate of change of the built turn or climb). */
function builtPeak(d, a, b, pitch = false) {
  const S = A.toPath(d).path.samples; let prev = null, off = 0;
  const H = S.map((x) => { let v = pitch ? Math.asin(Math.max(-1, Math.min(1, x.T[1]))) : Math.atan2(x.T[2], x.T[0]); if (prev !== null) { while (v + off - prev > Math.PI) off -= 2 * Math.PI; while (v + off - prev < -Math.PI) off += 2 * Math.PI; } prev = v + off; return { s: x.s, v: v + off }; });
  const atS = (s) => { let lo = 0, hi = H.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (H[m].s <= s) lo = m; else hi = m; } const f = (s - H[lo].s) / (H[hi].s - H[lo].s); return H[lo].v + f * (H[hi].v - H[lo].v); };
  let m = 0; for (let s = a; s <= b; s += 0.5) m = Math.max(m, Math.abs(atS(s + 1) - 2 * atS(s) + atS(s - 1))); return m / BAR;
}
const endRate = (d, ch) => { const P = d.pieces[d.pieces.length - 1]; return D.channelValue(P, ch, P.length); };

test('O1 R1a: a turn change −80 → −60 °/100m over 103 m on a 300 m piece whose first ramp (0 → −80) runs under it is laid (the capped ceiling asked 205.9 m), reaching −60 with its built turn changing under the bar (× 1.05)', () => {
  const d = lay('kh', 0, -80, -60, 197);
  assert.ok(Math.abs(endRate(d, 'kh') - R(-60)) < 1e-6, `the turn ends at ${(endRate(d, 'kh') / R(1)).toFixed(4)} °/100m`);
  const p = builtPeak(d, 200 + 197 - 20, 200 + 300 + 20);
  assert.ok(p <= 1.05, `built turn peak ${p.toFixed(3)} × the bar`);
});

test('O1 R1a climb: a climb change −30 → −20 °/100m over 80 m on a 300 m piece whose first ramp (0 → −30) runs under it is laid (the capped ceiling asked 102.9 m), reaching −20 with its built climb changing under the bar (× 1.05)', () => {
  const d = lay('kv', 0, -30, -20, 220);
  assert.ok(Math.abs(endRate(d, 'kv') - R(-20)) < 1e-6, `the climb ends at ${(endRate(d, 'kv') / R(1)).toFixed(4)} °/100m`);
  const p = builtPeak(d, 200 + 220 - 20, 200 + 300 + 20, true);
  assert.ok(p <= 1.05, `built climb peak ${p.toFixed(3)} × the bar`);
});

test('O1 R1b: a turn change −80 → −75 over 13 m on that moving ramp is still refused, naming a shortest under the capped 51.5 m and never under its own 25.7 m; laid there, its built turn changes under the bar (× 1.05)', () => {
  let err = null;
  try { lay('kh', 0, -80, -75, 287); } catch (e) { err = e; }
  assert.ok(err && err.code === 'BAD_SECOND' && /needs at least/.test(err.message), `refused by name: ${err && err.message}`);
  assert.ok(err.needM < 51.5 - 0.05, `it names the built road's shortest, not the capped ceiling: ${err.needM}`);
  assert.ok(err.needM >= 25.7, `never under the change's own shortest (3·Δ/ROUTE_BAR, 25.7 m): ${err.needM}`);
  const from = +(300 - err.needM).toFixed(1), d = lay('kh', 0, -80, -75, from), p = builtPeak(d, 200 + from - 20, 200 + 300 + 20);
  assert.ok(p <= 1.05, `laid at the named mark ${from}, built turn peak ${p.toFixed(3)} × the bar`);
});

test('O1 R1b sharp ramp: where the first ramp itself changes the turn faster than the bar near the mark (0 → −80 over 120 m), a span between the change\'s own shortest and the ceiling is refused, naming the ceiling', () => {
  let err = null;
  try { lay('kh', 0, -80, -75, 90, 120); } catch (e) { err = e; }
  assert.ok(err && err.code === 'BAD_SECOND', `refused: ${err && err.message}`);
  assert.ok(Math.abs(err.needM - 51.47) < 0.05, `the closed-form ceiling, as before: ${err.needM}`);
});

// R1c: TODAY'S BYTES, captured on ceb21f5 (pane E's scratch capture.cjs, run on a clean worktree at that commit). No first ramp under the change: share 0, no probe.
const TODAY = {
  c1: { msg: "BAD_SECOND: the turn (kh) change 1 (its second turn), from -0.0139626 to -0.01309, needs at least 25.7 m before the piece's end (the built road rounds a shorter one back over the hold): from at most 274.3, got 299", needM: 25.73470176619519 },
  c2: { msg: "BAD_SECOND: the turn (kh) change 1 (its second turn), from -0.0139626 to -0.010472, needs at least 102.9 m before the piece's end (the built road rounds a shorter one back over the hold): from at most 197.1, got 200", needM: 102.93880706478102 },
  c3: '5177e4b08db16c05bd1b3bcb88ad82d8e3e744167552a9e5f51e300f7ae06b97',
  c4: { msg: "BAD_SECOND: the climb (kv) change 1 (its second climb), from -0.00174533 to -0.000872665, needs at least 25.7 m before the piece's end (the built road rounds a shorter one back over the hold): from at most 274.3, got 299", needM: 25.73470236330575 },
  c5: '200db99f8d32ea7071cd8a4559e3004336c033728182dab04f0eb8c6359da066',
  e1: 'aa973648fce8f8ac3ded559699738ee6713d0caabd57e3e7d0379cf269d3dda6',
  e2: 'f55fd8e9e5e180b874f1b52cb7c5543bc44f02821a72eb3b632009cb1a3e8d8e',
};
const refusal = (f) => { try { f(); } catch (e) { return { msg: e.message, needM: e.needM }; } return null; };

test('O1 R1c: with no first ramp under the change, the refusals and the laid documents are today\'s, byte for byte (turn and climb)', () => {
  assert.deepEqual(refusal(() => lay('kh', -80, -80, -75, 299)), TODAY.c1);
  assert.deepEqual(refusal(() => lay('kh', -80, -80, -60, 200)), TODAY.c2);
  assert.equal(sha(lay('kh', -80, -80, -60, 190)), TODAY.c3);
  assert.deepEqual(refusal(() => lay('kv', -10, -10, -5, 299)), TODAY.c4);
  assert.equal(sha(lay('kv', -10, -10, -5, 270)), TODAY.c5);
});

test('O1 R1e: a change at or past the closed-form ceiling over a moving first ramp lays today\'s document, byte for byte (turn and climb)', () => {
  assert.equal(sha(lay('kh', 0, -80, -75, 240)), TODAY.e1);
  assert.equal(sha(lay('kv', 0, -20, -10, 150)), TODAY.e2);
});

// F1 (pane C's read of bfa6732, 2026-11-26): a change FOLLOWED BY ANOTHER ends at the next mark, earlier on the first ramp, where the ramp's own rate moves fastest; the probe
// laid it out to the ramp's end instead, so it passed spans the built road carries over the bar (C's worst: −80 → −95 from 120 to 200 m, then −90 from 200 m, 1.287 × the
// bar, turn and climb alike). The probe now lays the change where it sits, from its mark to the next mark (or the piece's end).
const lay2 = (ch, first, to1, from1, to2, from2, L = 300) => {
  const d = extend(D.createDoc('g'), { length: 200, targets: { [ch]: 0 } });
  return extend(d, { length: L, targets: { [ch]: R(first) }, changes: { [ch]: [{ from: from1, target: R(to1) }, { from: from2, target: R(to2) }] } });
};
/** The built climb as the unwrapped angle in the road's vertical plane (a climb ramp this steep passes vertical, where asin of the tangent's height folds), its change over
 *  1 m, peak over [a, b] ÷ the bar. The road holds one heading (no turn), so the plane is the first sample's. */
function builtClimbPeak(d, a, b) {
  const S = A.toPath(d).path.samples, h = Math.hypot(S[0].T[0], S[0].T[2]), hx = S[0].T[0] / h, hz = S[0].T[2] / h; let prev = null, off = 0;
  const H = S.map((x) => { const v = Math.atan2(x.T[1], x.T[0] * hx + x.T[2] * hz); if (prev !== null) { while (v + off - prev > Math.PI) off -= 2 * Math.PI; while (v + off - prev < -Math.PI) off += 2 * Math.PI; } prev = v + off; return { s: x.s, v: v + off }; });
  const atS = (s) => { let lo = 0, hi = H.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (H[m].s <= s) lo = m; else hi = m; } const f = (s - H[lo].s) / (H[hi].s - H[lo].s); return H[lo].v + f * (H[hi].v - H[lo].v); };
  let m = 0; for (let s = a; s <= b; s += 0.5) m = Math.max(m, Math.abs(atS(s + 1) - 2 * atS(s) + atS(s - 1))); return m / BAR;
}
for (const [ch, peak] of [['kh', (d, a, b) => builtPeak(d, a, b)], ['kv', builtClimbPeak]]) {
  test(`O1 F1 ${ch}: a change −80 → −95 from 120 m to the next mark at 200 m (then −90), on a 0 → −80 ramp over 300 m, is refused, and laid at the mark it names its built rate changes under the bar (× 1.05)`, () => {
    let err = null;
    try { lay2(ch, -80, -95, 120, -90, 200); } catch (e) { err = e; }
    assert.ok(err && err.code === 'BAD_SECOND' && /change 1 .*needs at least .* before change 2's mark/.test(err.message), `refused by name: ${err ? err.message : 'laid'}`);
    const from = +(200 - err.needM).toFixed(1), d = lay2(ch, -80, -95, from, -90, 200), p = peak(d, 200 + from - 20, 200 + 300 + 20);
    assert.ok(p <= 1.05, `laid at the named mark ${from}, built peak ${p.toFixed(3)} × the bar`);
  });
}

// F2 (pane C's read of bfa6732): no row pinned the probe's bar or the shortest it names, so the bar raised to 1.3 (C's N9), the search with no step back by the metre (N3)
// or stepping by 50 m (N8) all survived. This change's shortest lies strictly between its own (77.3 m) and the ceiling (154.4 m), where the bar binds: 148.3 m, searched
// from its own in 5 m steps and back by the metre (measured on the repair's tip, 2026-11-26). At that mark it lays under the bar; a metre shorter it is refused.
for (const [ch, peak] of [['kh', (d, a, b) => builtPeak(d, a, b)], ['kv', builtClimbPeak]]) {
  test(`O1 F2 ${ch}: the probe's bar and the shortest it names: −80 → −95 ending at the next mark (200 m) on a 0 → −80 ramp needs 148.3 m; laid there it is under the bar, a metre shorter it is refused`, () => {
    const M = secondMinM(ch, R(-80), R(-95), { step: R(-80), length: 300 }, 200);
    assert.ok(Math.abs(M - 148.3) < 0.05, `secondMinM names ${M}`);
    assert.equal(secondMinM(ch, R(-80), R(-95), { step: R(-80), length: 300 }), secondMinM(ch, R(-80), R(-95), { step: R(-80), length: 300 }, 300), 'no end is the piece\'s end');
    const d = lay2(ch, -80, -95, 51.7, -90, 200), p = peak(d, 200 + 51.7 - 20, 520);
    assert.ok(p <= 1.05, `laid at 51.7 (148.3 m), built peak ${p.toFixed(3)} × the bar`);
    assert.throws(() => lay2(ch, -80, -95, 52.7, -90, 200), (e) => e.code === 'BAD_SECOND' && /needs at least 148\.3 m before change 2's mark/.test(e.message));
  });
}
