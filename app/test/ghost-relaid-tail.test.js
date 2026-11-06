// ghost-relaid-tail.test.js: node --test app/test/ghost-relaid-tail.test.js
// D642 (pane C's finding, e61e36ce; the chair's reorder of 2026-11-05 20:02Z): after a piece whose bank eases over its whole length and still rolls at its end, NO next piece
// got a ghost ("ghost: the candidate must extend the placed track (the same segments, then more)"), not even a plain 100 m straight, so he could not extend his track. Laying a
// next piece re-lays the placed piece's built tail BY DESIGN (src/core/adapter.js bankPlan: the joint's bank corner is rounded up to the joint from each side once the joint has
// two sides; and D626's carry rolls through a joint where both pieces roll the same way), and the preview's ghost refused any candidate whose placed prefix was not its own
// to the byte. Red on main d10eacf (0.4.39) for his case and for a D626 corkscrew. The ghost now builds what placing builds, the re-laid tail included, and the placed track
// is left as it was. Rows:
//   1  his case: a 1,000 m piece banking 88.45° over its whole length (the panel's rounded shape) ends still rolling; the next 100 m straight gets a ghost, and the ghost's
//      path, from the first re-laid segment on, and its head are what placing the piece builds (a model built afresh from the placed document)
//   2  a D626 corkscrew: −90° over 250 m placed, the next −90° more over 250 m (a carried joint): the same
//   3  the placed track is not touched by such a ghost: the model's path and mesh are the same objects with the same stations, and the placed document updates as 'same'
//   4  a candidate that changes a piece before the last placed one is still refused by name (it is not an extension)
//   5  a placed piece that ends at rest keeps the copy-and-extend ghost as before (no re-laid tail is reported)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');   // app/test/mutation.test.js runs this file against a mutant copy of app/preview
const { createTrackModel } = require(path.join(ADIR, 'preview', 'trackmodel.js'));
const DEG = Math.PI / 180;

async function placed(pieces) { const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); for (const o of pieces) s.extend({ family: 'bowl', ...o }); return s; }
const modelOf = (resolved) => { const tm = createTrackModel(); tm.update({ segments: resolved.segments, closed: !!resolved.closed, start: resolved.start }); return tm; };
const HIS = [{ length: 1000 }, { length: 1000, targets: { phi: 88.45 * DEG }, bankShape: 'rounded' }];
const CORK = [{ length: 1000 }, { length: 250, targets: { phi: -90 * DEG } }];
/** The ghost's stations from segment `from` on, and its head, against the path a model builds afresh from the candidate placed: equal to the byte. */
function samePlaced(ghost, cand, from) {
  const fresh = modelOf(cand).path, g = ghost.path, s0 = fresh.segFirst[from];
  assert.equal(g.samples.length, fresh.samples.length, 'as many stations as placing builds');
  for (let k = s0; k < fresh.samples.length; k++) for (const f of ['pos', 'T', 'L', 'U']) assert.deepEqual(Array.from(g.samples[k][f]), Array.from(fresh.samples[k][f]), `station ${k} ${f}`);
  for (const f of ['pos', 'T']) assert.deepEqual(Array.from(ghost.head[f]), Array.from(fresh.head[f]), `the head's ${f}`);
}

for (const [row, what, pieces, next] of [
  ['1', 'his piece, 88.45° over 1,000 m still rolling at its end, then a 100 m straight', HIS, { length: 100 }],
  ['2', 'a D626 corkscrew, −90° over 250 m, then −90° more over 250 m (a carried joint)', CORK, { length: 250, targets: { phi: -180 * DEG } }],
]) {
  test(`D642 ${row}: after ${what}, the next piece gets a ghost, and it is what placing builds from the first re-laid segment on`, async () => {
    const s = await placed(pieces), st = s.getState(), tm = modelOf(st.resolved), cand = s.candidate(next);
    const n = st.resolved.segments.length, ghost = tm.ghostFor(cand);
    assert.ok(Number.isInteger(ghost.relaid) && ghost.relaid < n, `the ghost reports the placed tail it re-lays: ${ghost.relaid} of ${n} placed segments`);
    assert.ok(ghost.batches.length > 0, 'the ghost has something to draw');
    samePlaced(ghost, cand, ghost.relaid);
  });
}
test('D642 3: such a ghost leaves the placed track as it was (the same path and mesh, the same stations; the placed document updates as \'same\')', async () => {
  const s = await placed(HIS), st = s.getState(), tm = modelOf(st.resolved), p0 = tm.path, m0 = tm.mesh, n0 = p0.samples.length, head0 = Array.from(p0.head.pos);
  tm.ghostFor(s.candidate({ length: 100 }));
  assert.equal(tm.path, p0); assert.equal(tm.mesh, m0); assert.equal(tm.path.samples.length, n0); assert.deepEqual(Array.from(tm.path.head.pos), head0);
  assert.equal(tm.update({ segments: st.resolved.segments, closed: false, start: st.resolved.start }).how, 'same');
});
test('D642 4: a candidate that changes a piece before the last placed one is refused by name', async () => {
  const s = await placed([...HIS, { length: 200 }]), st = s.getState(), tm = modelOf(st.resolved), cand = s.candidate({ length: 100 });
  const bad = { ...cand, segments: cand.segments.map((g, j) => (j === 0 ? { ...g, k1: g.k1 + 1e-4 } : g)) };
  assert.throws(() => tm.ghostFor(bad), /the candidate must extend the placed track/);
  // and one that changes only the ROLL of a piece before the last (E's review: re-laying is the roll, but only the last placed piece's): refused too
  const rolled = { ...cand, segments: cand.segments.map((g, j) => (j === 0 ? { ...g, roll1: g.roll1 + 0.5 } : g)) };
  assert.throws(() => tm.ghostFor(rolled), /the candidate must extend the placed track/, 'a roll changed on the first placed piece');
});
test('D642 5: after a piece that ends at rest the ghost is the copy-and-extend one, as before (no re-laid tail)', async () => {
  const s = await placed([{ length: 1000 }, { length: 1000, targets: { phi: 30 * DEG } }]), st = s.getState(), tm = modelOf(st.resolved), cand = s.candidate({ length: 100 });
  const ghost = tm.ghostFor(cand);
  assert.equal(ghost.relaid, undefined);
  samePlaced(ghost, cand, st.resolved.segments.length);
});
// ── D642, pane E's review (b8872153 §2-§3): the guard was wider than the cause, and the re-laid ghost rebuilt the whole path
//   6  in the re-laid stretch only the roll may differ (roll0, roll1, rollRate0, rollRate1: what bankPlan and the carry change); a candidate whose last placed piece
//      truly moves (one segment's turn k1, its climb kp1 or its length changed) is refused by name, as before the fix; one whose roll alone differs is taken
//   7  the cost: on a 21 km track the re-laid ghost grows only from the re-laid segment on, so its path's work is a small share of a full build's (it was the whole path)
test('D642 6: a candidate whose last placed piece truly moves (its turn, climb or length on one segment) is refused by name; a roll alone is taken', async () => {
  const s = await placed(HIS), st = s.getState(), n = st.resolved.segments.length, cand = s.candidate({ length: 100 }), j = n - 3;
  const tamper = (f) => ({ ...cand, segments: cand.segments.map((g, i) => (i === j ? f(g) : g)) });
  for (const [what, f] of [['its turn (k1)', (g) => ({ ...g, k1: g.k1 + 1e-3 })], ['its climb (kp1)', (g) => ({ ...g, kp1: g.kp1 + 1e-3 })], ['its length', (g) => ({ ...g, length: g.length + 10 })]]) {
    assert.throws(() => modelOf(st.resolved).ghostFor(tamper(f)), /the candidate must extend the placed track/, `${what} changed on placed segment ${j} is refused`);
  }
  const g = modelOf(st.resolved).ghostFor(tamper((x) => ({ ...x, roll1: x.roll1 + 0.5 })));
  assert.ok(Number.isInteger(g.relaid) && g.relaid <= j, `a roll alone is re-laying: taken from ${g.relaid}`);
});
test('D642 7: on a 21 km track the re-laid ghost grows its path only from the re-laid segment on (its work under a tenth of a full build)', async () => {
  const s = await placed([...Array.from({ length: 20 }, () => ({ length: 1000 })), HIS[1]]), st = s.getState(), tm = modelOf(st.resolved), cand = s.candidate({ length: 100 });
  const g = tm.ghostFor(cand), full = modelOf(cand).path;
  assert.ok(Number.isInteger(g.relaid), 'a re-laid ghost');
  assert.ok(g.path.work < 0.1 * full.work, `the ghost's path work ${g.path.work} against a full build's ${full.work}`);
  samePlaced(g, cand, g.relaid);
});
