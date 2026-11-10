// core_mirror_refusal.test.js: node --test test/core_mirror_refusal.test.js
// The bank +34.78 -> -34.78 with a 500 m mark on a 1,000 m rounded-bank piece was refused with
// "needs at least 371.5 m ... from at most 628.5, got 500": the refusal named a limit that allowed the mark it refused.
// MEASURED (probePeak, the built road's peak roll acceleration over the bar): on that change the peak is NOT monotone in the span:
// it holds from about 264 m to about 440 m (0.91 to 0.99) and is over the bar from about 450 m up (1.0112 at 500 m). So the refusal
// is right, and its stated limit (the ceiling, 371.5 m, a span that does hold) was an incomplete one: a longer span is over the bar.
// Stated first: (1) the refusal stands for the span the road does not hold; (2) the limit it states, applied, is ACCEPTED; (3) a
// refusal that says "from at most N" never has the asked mark inside it; (4) +-30 and +-40 are unmoved.
// AMENDED 2026-11-10 (rule changed: the user's 2026-11-10 rule: an extra bank change is refused only where the road AS BUILT cannot carry it, src/core/extend.js bankAsBuilt). The bank is no longer refused for its peak roll acceleration over the bar (the
// probe): under its comfort length it is read on the road as built, and this change turns the bank back, which the builder pins, so it holds at 500 m and at 900 m;
// both are now laid, and the rows prove the lay honest (the built bank holds before the mark and reaches the target within 0.5°). What the file exists for, (2) and
// (3), is kept on the marks that are still refused: under the 26 m fit floor, where the road as built rounds the change back (the reversing change from 765 m on, a
// 235 m span, on this straight piece), and a change the same way as the bank before it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const R = Math.PI / 180, BASE = extend(D.createDoc('m'), { length: 400 });
const lay = (a, b, from, L = 1000) => extend(BASE, { length: L, targets: { phi: a * R }, bankShape: 'rounded', changes: { phi: [{ from, target: b * R }] } });
const tryLay = (a, b, from) => { try { return { doc: lay(a, b, from) }; } catch (e) { return { e }; } };
/** The mark the refusal states: { kind: 'most' | 'least', v } */
const stated = (e) => { const m = /from at (most|least) ([\d.]+)/.exec(e.message); return m && { kind: m[1], v: Number(m[2]) }; };
/** The built bank of the laid piece (the adapter's, bankPlan) against its document, from 250 m before the mark F to the piece's end: the most it leaves the document before F,
 *  and how far it is from it at the end, in degrees (core_changes.test.js builtBankOf) */
function builtBankOf(d, F) {
  const A = require('../src/core/adapter.js'), plan = A.bankPlan(d), P = d.pieces[1], v = (t) => D.channelValue(P, 'phi', t), b = (t) => (plan[1].fn ? plan[1].fn(t) : v(t));
  let hold = 0; for (let t = Math.max(0, F - 250); t <= F; t += 0.5) hold = Math.max(hold, Math.abs(b(t) - v(t)));
  return { hold: hold / R, reach: Math.abs(b(P.length) - v(P.length)) / R, end: b(P.length) / R };
}

// AMENDED 2026-11-10 (the user's 2026-11-10 rule: an extra bank change is refused only where the road AS BUILT cannot carry it, src/core/extend.js bankAsBuilt). Was: refused at 500 m (the probe's peak roll acceleration, 1.0112 of the bar), without naming
// a limit that allows 500. Now: laid, and the road as built holds the bank before the mark and reaches −34.78° (within 0.5°)
test('the mirrored bank +34.78 -> -34.78 at 500 m is laid, and as built its bank holds before the mark and reaches -34.78', () => {
  const r = tryLay(34.78, -34.78, 500);
  assert.ok(r.doc, `laid: ${r.e && r.e.message}`);
  const b = builtBankOf(r.doc, 500);
  assert.ok(b.hold <= 0.5 && b.reach <= 0.5 && Math.abs(b.end + 34.78) <= 0.5, `as built: ${b.hold.toFixed(3)}° off before the mark, ${b.reach.toFixed(3)}° off at the end, ${b.end.toFixed(3)}° there`);
});
// AMENDED 2026-11-10 (the user's 2026-11-10 rule: an extra bank change is refused only where the road AS BUILT cannot carry it, src/core/extend.js bankAsBuilt). Was: the refusals at 500 m of four changes, each re-laid at the limit it stated; at 500 m none of
// them is refused any more, so the row asked nothing. Now: every mark from 750 to 990 m that is still refused, for both mirrors, +34.78 -> 0 and a change the same way
// as the bank before it (0 -> 34.78), states a limit that does not allow the refused mark, and that limit, applied, is laid
test('the limit a refusal states, applied, is accepted, and never allows the mark it refused (both signs, both mirrors, and the same way), on every mark still refused', () => {
  let refusals = 0;
  for (const [a, b] of [[34.78, -34.78], [-34.78, 34.78], [34.78, 0], [0, 34.78]]) for (let F = 750; F <= 990; F += 10) {
    const r = tryLay(a, b, F); if (!r.e) continue;
    refusals++; assert.equal(r.e.code, 'BAD_SECOND', r.e.message);
    const s = stated(r.e); assert.ok(s, r.e.message);
    assert.ok(s.kind === 'most' ? F > s.v + 1e-9 : F < s.v - 1e-9, `${a} -> ${b} from ${F}: says "from at ${s.kind} ${s.v}", which allows ${F}`);
    const from = s.kind === 'most' ? Math.floor(s.v) : Math.ceil(s.v), again = tryLay(a, b, from);
    assert.ok(!again.e, `${a} -> ${b} from ${F}: stated "from at ${s.kind} ${s.v}", laid at ${from}: ${again.e && again.e.message}`);
  }
  assert.ok(refusals >= 30, `the row asked ${refusals} refusals (33 measured: each change is refused from about 770 to 830 m on); fewer, and it is asking nothing`);
});
test('+-30 and +-40 at 500 m are accepted, as they were', () => {
  for (const a of [30, -30, 40, -40]) assert.ok(!tryLay(a, -a, 500).e, `${a} -> ${-a}`);
});
test('a mark inside the holding window of the mirrored bank is accepted (span 300 to 425 m, from 575 to 700)', () => {
  for (const from of [575, 600, 650, 700]) assert.ok(!tryLay(34.78, -34.78, from).e, `from ${from}`);
});
// AMENDED 2026-11-10 (the user's 2026-11-10 rule: an extra bank change is refused only where the road AS BUILT cannot carry it, src/core/extend.js bankAsBuilt). Was: the mirrored change from 900 m (a 100 m span, under its comfort length) refused, naming the
// shortest, and that applied accepted. Now: from 900 m it is laid, and the road as built holds and reaches it (0.42° off before the mark measured, against 0.5°); the
// "too short" refusal and its named limit are the next row's, on spans still refused
test('the mirrored bank from 900 m (a 100 m span) is laid, and as built its bank holds before the mark and reaches -34.78', () => {
  const r = tryLay(34.78, -34.78, 900);
  assert.ok(r.doc, `laid: ${r.e && r.e.message}`);
  const b = builtBankOf(r.doc, 900);
  assert.ok(b.hold <= 0.5 && b.reach <= 0.5 && Math.abs(b.end + 34.78) <= 0.5, `as built: ${b.hold.toFixed(3)}° off before the mark, ${b.reach.toFixed(3)}° off at the end, ${b.end.toFixed(3)}° there`);
});
// (2026-11-10) the refusals that remain, by name: under the bank's fit floor, and a change the same way as the bank before it on this straight piece
test('a span still too short is named by its limit, "from at most M", and M applied is accepted: under the 26 m fit floor, and the same way on the straight', () => {
  const floor = tryLay(34.78, -34.78, 975); assert.ok(floor.e && floor.e.code === 'BAD_SECOND' && floor.e.message.includes('26.0 m'), `from 975: ${floor.e && floor.e.message}`);
  const same = tryLay(0, 34.78, 900); assert.ok(same.e && same.e.code === 'BAD_SECOND' && /the built road rounds a shorter one back over the hold/.test(same.e.message), `0 -> 34.78 from 900: ${same.e && same.e.message}`);
  for (const [r, a, b] of [[floor, 34.78, -34.78], [same, 0, 34.78]]) {
    const s = stated(r.e); assert.equal(s.kind, 'most', r.e.message);
    assert.ok(!tryLay(a, b, Math.floor(s.v)).e, `${a} -> ${b} at ${Math.floor(s.v)}, the limit it stated`);
  }
});
