// jumpwarn_refusals.test.js: node --test test/jumpwarn_refusals.test.js   (under the heavy-run lock; about half a minute)
// D250 item 2 (the keeper: "the jumps are going to have to be tested by the user through trial and error driving it in assetto themselves"): a jump the
// car may fly past WARNS and exports. These rows pin the other side, from pane B's look at E's 6047714: ONLY a jump's reach moved to the warnings.
//   1  the lap proof's split, through the exported lapOf: a lap whose only findings are a jump's reach PASSES, with them in `warn`; a stall, the car
//      leaving the surface, and a jump whose landing is not ahead of its take-off each still FAIL it (`where`), which the export turns into the
//      lap-proof red (src/export/fromwords.js; export.test.js row 51 pins that refusal)
//   2  export: a real HOLE (a gap with no landing ramp) in a closed jump lap is still RED and refused, nothing built; the same lap without it exports
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { jump } = require('../src/core/jump.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const FW = require('../src/export/fromwords.js');
const { startLayout } = require('../app/core/coreshell.js');

// ── row 1: the lap proof's split ──
/** A deferred result over a 100 m straight (stations every 10 m, one road segment), with the speeds, lines and jumps given: lapOf proves it now. */
function lap({ v = 50, lines = [], jumps = [] } = {}) {
  const samples = Array.from({ length: 11 }, (_, i) => ({ s: i * 10, seg: 0 }));
  const speeds = samples.map((m, i) => ({ v: typeof v === 'function' ? v(i) : v }));
  return V.lapOf({ samples }, [{ kind: 'road' }], { lap: { ok: null, reason: 'deferred' }, speed: speeds, lines, jumps });
}
const missed = { s: 40, speed: 50, landings: [{ g: 3.2, caught: true, minSpeed: 30 }, { g: 6.3, caught: false, minSpeed: 80 }], reachable: false };
const reasonsOf = (xs) => xs.map((x) => x.reason).sort();

test('row 1a: a lap whose ONLY findings are a jump\'s reach (a fall not caught, a landing too deep) PASSES, and they are warnings', () => {
  const r = lap({ jumps: [missed] });
  assert.equal(r.ok, true, JSON.stringify(r.where));
  assert.deepEqual(r.where, []);
  assert.deepEqual(reasonsOf(r.warn), ['jump-not-caught-6.3g', 'landing-unreachable']);
});

for (const [what, opts, reason] of [
  ['a STALL (a road station at 0 km/h)', { v: (i) => (i === 5 ? 0 : 50), jumps: [missed] }, 'stall'],
  ['the car LEAVING THE SURFACE (a negative normal load on the centreline)', { lines: [{ s: 60, u: 0, fN_g: -0.4 }], jumps: [missed] }, 'leaves-surface'],
  ['a jump whose landing is NOT AHEAD of its take-off', { jumps: [{ s: 40, speed: 50, landings: [], reachable: false, badGap: true, gap: -5 }] }, 'jump-gap-not-forward'],
]) {
  test(`row 1b: ${what} still FAILS the lap proof, in where (not a warning)`, () => {
    const r = lap(opts);
    assert.equal(r.ok, false);
    assert.ok(r.where.some((w) => w.reason === reason), JSON.stringify(r.where));
    assert.ok(!r.warn.some((w) => w.reason === reason), 'never only a warning');
  });
}

// ── row 2: a real hole is still refused at export ──
const R = 180, Q = (Math.PI * R) / 2;
const MISS_JUMP = { gap: 60, drop: 1, land: 0 };   // E's row 5b lap: its 6.3 g fall misses, nothing else found
function shutLap() {
  let d = extend(D.createDoc('jump lap'), { length: 300, family: 'bowl' });
  d = jump(d, MISS_JUMP); d = extend(d, { length: 300 });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const shut = close(d, { edited: [0] }); assert.equal(shut.converged, true, shut.report);
  return shut.doc;
}
const build = (doc, segs) => {
  const lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  return FW.buildFromSegments(segs, { name: 'jump', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start) });
};

test('row 2: a real HOLE (a road segment of the landing road made a gap, no ramp) in a closed jump lap is RED and refused; the lap without it exports', () => {
  const doc = shutLap(), segs = A.toSegments(doc);
  const fine = build(doc, segs);
  assert.ok(fine.kn5.length > 1000, 'control: the jump lap alone exports (its miss is a warning)');
  const holed = segs.map((g) => ({ ...g })), i = holed.findIndex((g, k) => k > 0 && holed[k - 1].part === 'land' && g.part === 'body');
  assert.ok(i > 0, 'control: there is road after the landing ramp to hole');
  holed.splice(i, 1, { ...holed[i], kind: 'gap', part: 'gap', profile: null });
  assert.throws(() => build(doc, holed), (e) => e.code === 'RED' && e.red.some((x) => x.reason === 'gap-in-road'));
});
