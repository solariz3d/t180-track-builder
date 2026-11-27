// ghost-offset.test.js: node --test app/test/ghost-offset.test.js
// D678 N5 (pane B's read of Even, exo_memory/handback/p-d678-even-read-B_2026-11-27.md 2.1, "the lavender wash"): after a grab (or an Even) on a BANKED road, the next piece's ghost
// lay up to 2 m beside the placed road, and 0.72 m off in height, as soon as Sculpt was switched off. On c522ea6 too, so older than Even. The cause: on a banked road the next
// piece re-lays the last placed piece's bank (D642), so app/preview/trackmodel.js ghostSteps takes its re-laid branch, which lifts the ghost by `candidate.lift`; the shell's
// candidate (app/core/coreshell.js) carried none, so the ghost ran from the first place the road had an offset and drew the road as it would be with NO offset there, see-through
// over the placed one. The candidate now hands on its own document's lift, as resolvedOf hands on the placed track's. Rows:
//   1  his D642 bank (88.45° over 1,000 m, still rolling at its end) with a sideways grab (lateral 2 m) in its middle: the next 100 m piece's ghost lies on the road placing builds,
//      station for station, and starts where the same road with no grab re-lays (the re-laid tail, not the grab)
//   2  the same with a height grab (a hill, 2 m): the same
//   3  a road that ends at rest (no re-laid tail) with a sideways grab: the copy-and-extend ghost, which placing matches, as before (a control; green before the mend too)
//   4  (the chair's addition, from B's read 2.4: 1.94 m after an Even to the head) a FLAT road with a sideways grab whose window reaches the head, so the head's middle moved:
//      placing lays the next piece from the offset head (the new piece carries the head's l), and its ghost, a copy-and-extend one with no re-laid tail, lies there too
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const DEG = Math.PI / 180;

const HIS = [{ length: 1000 }, { length: 1000, targets: { phi: 88.45 * DEG }, bankShape: 'rounded' }];
const REST = [{ length: 1000 }, { length: 1000, targets: { phi: 30 * DEG } }];
const NEXT = { length: 100 };

/** A shell with the pieces placed and, when `grab` is given, one local brush (the core's hill or swerve) of `delta` metres centred at s0 over r, committed as one step. */
async function placed(pieces, grab) {
  const s = await createCoreShell({ autosaveMs: 0 });
  for (const o of pieces) s.extend({ family: 'bowl', ...o });
  if (grab) {
    s.beginBrush({ mode: 'local', channel: grab.channel, s0: grab.s0, r: grab.r });
    s.brushTo(grab.delta); s.endBrush();
    const m = s.getState().message; assert.ok(!m, `the grab is taken: ${m}`);
  }
  return s;
}
/** The preview's model of the placed track, built from the shell's resolved state as the preview hands it over (its lift included). */
const modelOf = (resolved) => { const tm = createTrackModel(); tm.update(resolved); return tm; };
/** The largest distance between the ghost's stations and the road placing builds, from segment `from` on, and the same for the head. */
function farthest(ghost, placedPath, from) {
  const g = ghost.path, k0 = placedPath.segFirst[from];
  assert.equal(g.samples.length, placedPath.samples.length, 'as many stations as placing builds');
  let worst = 0, at = -1;
  for (let k = k0; k < placedPath.samples.length; k++) {
    const a = g.samples[k].pos, b = placedPath.samples[k].pos, d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (d > worst) { worst = d; at = placedPath.samples[k].s; }
  }
  const h = ghost.head.pos, e = placedPath.head.pos;
  return { worst, at, head: Math.hypot(h[0] - e[0], h[1] - e[1], h[2] - e[2]) };
}

for (const [row, what, grab] of [
  ['1', 'a sideways grab (lateral 2 m)', { channel: 'lateral', s0: 1500, r: 200, delta: 2 }],
  ['2', 'a height grab (a hill, 2 m)', { channel: 'height', s0: 1500, r: 200, delta: 2 }],
]) {
  test(`N5 ${row}: on his D642 bank with ${what} in its middle, the next piece's ghost lies on the road placing builds, and starts at the re-laid tail, not at the grab`, async () => {
    const s = await placed(HIS, grab), st = s.getState(), tm = modelOf(st.resolved);
    assert.equal(typeof st.resolved.lift, 'function', 'the grab gave the road an offset (the placed track is lifted)');
    const ghost = tm.ghostFor(s.candidate(NEXT));
    // where the same road with no grab re-lays: the ghost of a grabbed road starts there too (the re-laid tail and the new piece, as D642 lays them)
    const bare = await placed(HIS), plain = modelOf(bare.getState().resolved).ghostFor(bare.candidate(NEXT));
    assert.ok(Number.isInteger(plain.relaid), 'the bare road re-lays its tail (D642), so this is the re-laid branch');
    assert.equal(ghost.relaid, plain.relaid, `the ghost starts at the re-laid tail (segment ${plain.relaid}), not at the first segment with an offset`);
    // the road placing builds: the piece placed, and a model built afresh from the shell's state
    s.extend({ family: 'bowl', ...NEXT });
    const after = modelOf(s.getState().resolved).path, f = farthest(ghost, after, ghost.relaid);
    assert.ok(f.worst <= 1e-9, `the ghost lies on the placed road: ${f.worst.toFixed(4)} m off at s ${f.at.toFixed(0)}`);
    assert.ok(f.head <= 1e-9, `the ghost's head is where placing puts it: ${f.head.toFixed(4)} m off`);
  });
}

test('N5 3: a road that ends at rest, with a sideways grab, keeps the copy-and-extend ghost, and placing matches it (a control)', async () => {
  const s = await placed(REST, { channel: 'lateral', s0: 1500, r: 200, delta: 2 }), st = s.getState(), n = st.resolved.segments.length;
  assert.equal(typeof st.resolved.lift, 'function', 'the grab gave the road an offset');
  const ghost = modelOf(st.resolved).ghostFor(s.candidate(NEXT));
  assert.equal(ghost.relaid, undefined, 'no re-laid tail');
  s.extend({ family: 'bowl', ...NEXT });
  const after = modelOf(s.getState().resolved).path, f = farthest(ghost, after, n);
  assert.ok(f.worst <= 1e-9, `the new piece's ghost lies where it is placed: ${f.worst.toFixed(4)} m off at s ${f.at.toFixed(0)}`);
});

test('N5 4: on a flat road with a sideways grab that moves the head\'s middle, the next piece\'s ghost starts at the offset head, where placing lays the piece', async () => {
  const s = await placed([{ length: 1000 }, { length: 1000 }], { channel: 'lateral', s0: 1980, r: 60, delta: 2 }), st = s.getState(), n = st.resolved.segments.length;
  const d = st.history.present, head = d.pieces[d.pieces.length - 1], D = require('../../src/core/document.js');
  assert.ok(Math.abs(D.channelAt(head, 'l', head.length).v) > 1, `the grab moved the head's middle sideways: l ${D.channelAt(head, 'l', head.length).v.toFixed(4)} m at the head`);
  const ghost = modelOf(st.resolved).ghostFor(s.candidate(NEXT));
  assert.equal(ghost.relaid, undefined, 'a flat road: no re-laid tail, the copy-and-extend ghost');
  s.extend({ family: 'bowl', ...NEXT });
  const after = modelOf(s.getState().resolved).path, f = farthest(ghost, after, n);
  assert.ok(f.worst <= 1e-9, `the new piece's ghost lies where it is placed: ${f.worst.toFixed(4)} m off at s ${f.at.toFixed(0)}`);
  assert.ok(f.head <= 1e-9, `the ghost's head is where placing puts it: ${f.head.toFixed(4)} m off`);
});
