// core_mirror_refusal.test.js: node --test test/core_mirror_refusal.test.js
// The bank +34.78 -> -34.78 with a 500 m mark on a 1,000 m rounded-bank piece was refused with
// "needs at least 371.5 m ... from at most 628.5, got 500": the refusal named a limit that allowed the mark it refused.
// MEASURED (probePeak, the built road's peak roll acceleration over the bar): on that change the peak is NOT monotone in the span:
// it holds from about 264 m to about 440 m (0.91 to 0.99) and is over the bar from about 450 m up (1.0112 at 500 m). So the refusal
// is right, and its stated limit (the ceiling, 371.5 m, a span that does hold) was an incomplete one: a longer span is over the bar.
// Stated first: (1) the refusal stands for the span the road does not hold; (2) the limit it states, applied, is ACCEPTED; (3) a
// refusal that says "from at most N" never has the asked mark inside it; (4) +-30 and +-40 are unmoved.
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

test('the mirrored bank +34.78 -> -34.78 at 500 m is refused, and the refusal does not name a limit that allows 500', () => {
  const r = tryLay(34.78, -34.78, 500);
  assert.ok(r.e && r.e.code === 'BAD_SECOND', 'refused by name');
  const s = stated(r.e); assert.ok(s, r.e.message);
  assert.ok(!(s.kind === 'most' && 500 <= s.v + 1e-9), `says "from at most ${s.v}" yet 500 is inside it: ${r.e.message}`);
});
test('the limit a refusal states, applied, is accepted (both signs, both mirrors)', () => {
  for (const [a, b] of [[34.78, -34.78], [-34.78, 34.78], [34.78, 0], [30, -30]]) {
    const r = tryLay(a, b, 500); if (!r.e) continue;
    const s = stated(r.e); assert.ok(s, r.e.message);
    const from = s.kind === 'most' ? Math.floor(s.v) : Math.ceil(s.v), again = tryLay(a, b, from);
    assert.ok(!again.e, `${a} -> ${b}: stated "from at ${s.kind} ${s.v}", laid at ${from}: ${again.e && again.e.message}`);
  }
});
test('+-30 and +-40 at 500 m are accepted, as they were', () => {
  for (const a of [30, -30, 40, -40]) assert.ok(!tryLay(a, -a, 500).e, `${a} -> ${-a}`);
});
test('a mark inside the holding window of the mirrored bank is accepted (span 300 to 425 m, from 575 to 700)', () => {
  for (const from of [575, 600, 650, 700]) assert.ok(!tryLay(34.78, -34.78, from).e, `from ${from}`);
});
test('a too-short span is still named by the shortest: "needs at least N m ... from at most M", and M applied is accepted', () => {
  const r = tryLay(34.78, -34.78, 900); assert.ok(r.e && r.e.code === 'BAD_SECOND');
  const s = stated(r.e); assert.equal(s.kind, 'most'); assert.ok(s.v < 900); assert.ok(!tryLay(34.78, -34.78, Math.floor(s.v)).e);
});
