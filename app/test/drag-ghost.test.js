// drag-ghost.test.js: node --test app/test/drag-ghost.test.js   (under the heavy-run lock)
// D404 (the user: "even turning a 1000m straight isnt smooth and laggy as hell"): a handle drag rebuilt the ghost of the next piece on every pointer move, in 2 m chords, so a
// 1,000 m piece cost about 20 ms a move and a 5,000 m one 100 ms. While a handle is dragged the ghost is now cut into a few dozen chords with a few dozen path stations (the
// shell's candidate(opts, { coarse }) and the track model's cheap ghost); what is placed, what is exported and the full ghost built when the drag stops are what they were.
// The work here is counted, not timed (the frame times are app/test/drag-frame.test.js). Rows:
//   1  the adapter: segMFor absent, or answering undefined, is toSegments exactly (a bowl and a tube track); a piece given its own chord length is that many chords of the same total length
//   2  the coarse ghost of a piece: at most GHOST_CHORDS chords (never under 2 m, never turning the heading more than 0.03 rad in one), the placed pieces' segments the very same objects,
//      the end of the road where the full one ends (a centimetre or two on a kilometre: the heading is the same), and a piece of 96 m or less is not changed at all
//   3  the release is byte for byte what it was: the sha256 of the placed mesh and of two full ghosts, taken at c2d7cb5 (0.4.7), before this change
//   4  the cheap ghost: its path has at most 64 stations (plus its chords) on a 5,000 m piece, it is a ghost of the same piece (end where the full one's is), the placed path and mesh are
//      untouched, a full ghost after it is the full ghost, and the handles sit where the full ghost's would put them
//   5  the maths under it, and the documents it makes: a placed track and three corner solves hash to what c2d7cb5 made (the fit shares its system across channels, the solve its start); the maths under it: basisN is basis (the same doubles), channelValue is channelAt(...).v, extendCorner answers the same fields with the same object and a changed field with a new one
//   6  (E's review §0, §1e) a kept answer is never handed back across a non-finite number: on one document, kh null is accepted and kept, and kh NaN after it is refused
//      (BAD_TARGET) as on a fresh document, through extendCorner (its memo) and through Turn by alone (solve's start memo); Infinity and -Infinity likewise
//   7  (E's review §1b) a document frozen at the top only, its pieces array still open, keeps no answer: an edit in place is answered afresh
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const AD = require('../../src/core/adapter.js');
const D = require('../../src/core/document.js');
const TB = require('../../src/core/turnby.js');
const PW = require('../../tools/piecewise.cjs');
const HD = require('../core/handles.js');

const hashBatches = (bs) => {
  const h = crypto.createHash('sha256');
  for (const b of bs) { for (const k of ['positions', 'normals', 'uvs', 'indices']) if (b[k]) h.update(Buffer.from(b[k].buffer, b[k].byteOffset, b[k].byteLength)); if (b.model) h.update(Buffer.from(new Float64Array(b.model).buffer)); }
  return h.digest('hex').slice(0, 16);
};
async function bowl() { const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.extend({ length: 300 }); return s; }
async function tubeTrack() { const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.extend({ length: 200, first: { w: 31, t: 360 } }); s.extend({ length: 150, transition: 40, targets: { kh: 1 / 180 } }); return s; }
const vertsOf = (g) => g.batches.reduce((a, b) => a + (b.positions ? b.positions.length / 3 : 0), 0);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('row 1: toSegments: segMFor absent or undefined is the same segments; a piece with its own chord length is that many chords of the same length in all', async () => {
  for (const sh of [await bowl(), await tubeTrack()]) {
    const doc = sh.exportDoc(), plain = AD.toSegments(doc), same = AD.toSegments(doc, { segMFor: () => undefined });
    assert.deepEqual(same, plain, 'answering undefined for every piece changes nothing');
    const last = doc.pieces.length - 1, coarse = AD.toSegments(doc, { segMFor: (P, pi) => (pi === last ? 20 : undefined) });
    const mine = (segs) => segs.filter((g) => g.id === doc.pieces[last].id), n = Math.ceil(doc.pieces[last].length / 20 - 1e-9);
    assert.equal(mine(coarse).length, n, 'the last piece is cut by 20 m');
    assert.ok(Math.abs(mine(coarse).reduce((a, g) => a + g.length, 0) - doc.pieces[last].length) < 1e-9, 'and is as long as it was');
    assert.deepEqual(coarse.slice(0, coarse.length - n), plain.slice(0, plain.length - mine(plain).length), 'every piece before it is as it was');
  }
});

test('row 2: the coarse ghost: few chords whatever the length, the placed pieces\' segments the same objects, the same end of road, and a short piece unchanged', async () => {
  const sh = await bowl(), placed = sh.getState().resolved.segments;
  for (const [L, turn] of [[1000, 30], [1000, 90], [2000, 90], [5000, 90], [20000, 90]]) {
    const o = { length: L, turnDeg: turn }, fine = sh.candidate(o), coarse = sh.candidate(o, { coarse: true });
    const nNew = coarse.segments.length - placed.length;
    assert.ok(nNew <= 130, `${L} m, ${turn}°: ${nNew} new chords (a full ghost has ${fine.segments.length - placed.length})`);
    assert.ok(coarse.segments.slice(0, placed.length).every((g, i) => g === placed[i]), 'the placed segments are the very same objects');
    assert.ok(coarse.segments.slice(placed.length).every((g) => g.length >= 2 - 1e-9), 'no chord is shorter than 2 m');
    assert.ok(Math.abs(coarse.segments.reduce((a, g) => a + g.length, 0) - fine.segments.reduce((a, g) => a + g.length, 0)) < 1e-6, 'the same length of road');
    const tm = createTrackModel(); tm.update(sh.getState().resolved);
    const f = tm.ghostFor(fine).head, c = tm.ghostFor(coarse, { cheap: true }).head;
    assert.ok(dist(f.pos, c.pos) < 0.03 * (L / 1000) + 0.02, `${L} m: the end of the road is ${dist(f.pos, c.pos).toFixed(3)} m from the full ghost's`);
    assert.ok(Math.acos(Math.min(1, f.T[0] * c.T[0] + f.T[1] * c.T[1] + f.T[2] * c.T[2])) < 1e-6, 'and points the same way');
  }
  for (const L of [60, 96]) { const o = { length: L, turnDeg: 20 }; assert.deepEqual(sh.candidate(o, { coarse: true }).segments, sh.candidate(o).segments, `${L} m is cut as it always was`); }
  // a tight turn is cut finer than L / 48 so the heading does not turn more than 0.03 rad in one chord
  const tight = sh.candidate({ length: 600, turnDeg: 360 }, { coarse: true }).segments.slice(placed.length);
  assert.ok(tight.every((g) => Math.abs(g.k0 * g.length) <= 0.05 && Math.abs(g.k1 * g.length) <= 0.05), 'no chord turns the heading by much more than 0.03 rad (the curvature is read at 17 stations, so a peak between two can be a little over)');
  // the cache: a coarse candidate does not change what a full one is
  const again = sh.candidate({ length: 1000, turnDeg: 30 });
  assert.deepEqual(again.segments, sh.candidate({ length: 1000, turnDeg: 30 }).segments);
});

test('row 3: the release is byte for byte what it was: the placed mesh and two full ghosts hash to what c2d7cb5 (0.4.7) made', async () => {
  const sh = await bowl(); sh.extend({ length: 1000, targets: { kh: 1 / 700 } });
  const tm = createTrackModel(), t = tm.update(sh.getState().resolved);
  const ghost = tm.ghostFor(sh.candidate({ length: 1000, turnDeg: 40 })), ghost2 = tm.ghostFor(sh.candidate({ length: 700, turnDeg: -25 }));
  // taken at c2d7cb5: node golden.js on a worktree of the 0.4.7 head
  assert.equal(hashBatches(t.batches), '452e72d72eaf731a', 'the placed track\'s mesh');
  assert.equal(hashBatches(ghost.batches), '9fa9a8d4bb63e4dd', 'the full ghost of a 1000 m corner');
  assert.equal(hashBatches(ghost2.batches), '93b1e4b611250fda', 'the full ghost of a 700 m corner the other way');
  // and a cheap ghost between two full ones leaves the second what the first was
  tm.ghostFor(sh.candidate({ length: 1000, turnDeg: 41 }, { coarse: true }), { cheap: true });
  assert.equal(hashBatches(tm.ghostFor(sh.candidate({ length: 1000, turnDeg: 40 })).batches), '9fa9a8d4bb63e4dd');
});

test('row 4: the cheap ghost: at most 64 stations on its new piece, the same end, the placed path and mesh untouched, a full ghost after it the full ghost, the handles where the full ghost\'s are', async () => {
  const sh = await bowl(), tm = createTrackModel(); tm.update(sh.getState().resolved);
  const placedPath = tm.path, placedMesh = tm.mesh, placedSamples = placedPath.samples.length, placedStep = placedPath.step;
  const fine = sh.candidate({ length: 5000, turnDeg: 60 }), coarse = sh.candidate({ length: 5000, turnDeg: 60 }, { coarse: true });
  const full = tm.ghostFor(fine), cheap = tm.ghostFor(coarse, { cheap: true });
  assert.ok(cheap.path.samples.length - placedSamples <= 64 + (coarse.segments.length - sh.getState().resolved.segments.length) + 2, `the cheap ghost's new stations: ${cheap.path.samples.length - placedSamples}`);
  assert.ok(full.path.samples.length - placedSamples > 2000, 'control: the full ghost has a station every 2 m');
  assert.ok(vertsOf(cheap) * 20 < vertsOf(full), `the cheap ghost's vertices: ${vertsOf(cheap)} against ${vertsOf(full)}`);
  assert.ok(dist(cheap.head.pos, full.head.pos) < 0.2, `the cheap ghost ends ${dist(cheap.head.pos, full.head.pos).toFixed(3)} m from the full one's`);
  assert.equal(tm.path, placedPath); assert.equal(tm.mesh, placedMesh); assert.equal(placedPath.step, placedStep, 'the placed path keeps its 2 m stations'); assert.equal(placedPath.substep, undefined);
  assert.equal(hashBatches(tm.ghostFor(fine).batches), hashBatches(full.batches), 'a full ghost after a cheap one is the full ghost');
  // the handles read the ghost's path: at the same places to well under a metre
  const model = (g, segs) => ({ kinds: ['length', 'turn'], samples: g.path.samples, s0: sh.getState().resolved.segments.reduce((a, x) => a + x.length, 0), s1: g.path.samples[g.path.samples.length - 1].s, half: () => 15.5, at: {} });
  const hf = HD.placeHandles(model(full)), hc = HD.placeHandles(model(cheap));
  assert.equal(hf.length, hc.length); hf.forEach((h, i) => assert.ok(dist(h.pos, hc[i].pos) < 0.6, `handle ${h.id}: ${dist(h.pos, hc[i].pos).toFixed(3)} m apart`));
  // a short ghost is built in the old way: a piece of 96 m or less keeps its 2 m chords and stations (so the same mesh)
  const small = tm.ghostFor(sh.candidate({ length: 90, turnDeg: 20 }, { coarse: true }), { cheap: true }), smallFull = tm.ghostFor(sh.candidate({ length: 90, turnDeg: 20 }), { cheap: true });
  assert.equal(small.path.samples.length, smallFull.path.samples.length, 'a ghost of 96 m or less keeps its chords and stations');
});

test('row 5: the documents are byte for byte what they were: pieces placed and corners solved, hashed (taken at c2d7cb5), and basisN is basis, channelValue is channelAt(...).v, and extendCorner answers the same fields with the same object', async () => {
  const sh0 = await bowl(); sh0.extend({ length: 1000, targets: { kh: 1 / 700, kv: 0.0004, phi: 0.2, w: 40, c: 20 } }); sh0.extend({ length: 75, transition: 30, targets: { w: 25 } });
  const doc0 = sh0.exportDoc(), parts = [doc0.pieces, TB.extendCorner(doc0, { length: 1500, turnDeg: 33, targets: { phi: 0.1 } }).pieces.at(-1), TB.extendCorner(doc0, { length: 400, turnDeg: -75, climbDeg: 4 }).pieces.at(-1), TB.extendCorner(doc0, { length: 2200 }).pieces.at(-1)];
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16), '78e077051e6b33e1', 'the placed pieces and three solved corners, as c2d7cb5 made them');
  let n = 0;
  for (let t = 0; t < 120; t++) {
    const L = 10 + ((t * 7919) % 3000), m = 1 + (t % 90), kn = []; for (let j = 1; j < m; j++) kn.push((j * L) / m);
    if (t % 5 === 0 && kn.length > 3) kn.splice(2, 0, kn[2]);
    const U = [0, 0, 0, 0, ...kn, L, L, L, L];
    for (let q = 0; q < 40; q++) { const s = q === 0 ? 0 : q === 1 ? L : q === 2 ? (kn[0] || 0) : ((q * 2654435761 + t * 40503) % 100000) / 100000 * L; const a = PW.basis(U, s), b = PW.basisN(U, s); n++; assert.equal(a.first, b.first); a.N.forEach((v, i) => assert.ok(Object.is(v, b.N[i]), `basisN differs at s ${s}`)); }
  }
  assert.ok(n > 4000);
  const sh = await bowl(), doc = sh.exportDoc(), P = TB.extendCorner(doc, { length: 400, turnDeg: 45 }).pieces.at(-1);
  for (const ch of D.CHANNELS) for (const s of [0, 1.5, P.length / 3, P.length - 0.01, P.length]) assert.ok(Object.is(D.channelValue(P, ch, s), D.channelAt(P, ch, s).v), `${ch} at ${s}`);
  const a = TB.extendCorner(doc, { length: 400, turnDeg: 45 }), b = TB.extendCorner(doc, { length: 400, turnDeg: 45 }), c = TB.extendCorner(doc, { length: 400, turnDeg: 46 });
  assert.equal(a, b, 'the same document and fields are one answer'); assert.notEqual(a, c); assert.notEqual(a.pieces.at(-1).channels.kh.join(), c.pieces.at(-1).channels.kh.join());
  assert.throws(() => TB.extendCorner(doc, { length: 5, turnDeg: 900 }), /TURN_TOO_SHORT|short/i); assert.throws(() => TB.extendCorner(doc, { length: 5, turnDeg: 900 }), /TURN_TOO_SHORT|short/i, 'an answer that throws is not kept: it throws again');
});
test('row 6 (E\'s review §0): a kept answer is never handed back across a non-finite number: kh null kept, then kh NaN, Infinity or -Infinity refused by name, as on a fresh document', async () => {
  const fresh = async () => (await bowl()).exportDoc();
  for (const bad of [NaN, Infinity, -Infinity]) {
    const doc = await fresh();
    assert.equal(TB.extendCorner(doc, { length: 400, targets: { kh: null } }).pieces.length, 2, 'kh null is no target: accepted');
    assert.throws(() => TB.extendCorner(doc, { length: 400, targets: { kh: bad } }), (e) => e.code === 'BAD_TARGET', `extendCorner, kh ${bad} after kh null on the same document`);
    const other = await fresh();
    assert.throws(() => TB.extendCorner(other, { length: 400, targets: { kh: bad } }), (e) => e.code === 'BAD_TARGET', `extendCorner, kh ${bad} on a fresh document (control)`);
    const d2 = await fresh();
    assert.equal(TB.extendTurnBy(d2, { length: 400, targets: { w: null } }, 0.5).pieces.length, 2, 'Turn by with w null: accepted');
    assert.throws(() => TB.extendTurnBy(d2, { length: 400, targets: { w: bad } }, 0.5), (e) => e.code === 'BAD_TARGET', `Turn by, w ${bad} after w null on the same document (solve's start memo)`);
  }
});

test('row 7 (E\'s review §1b): a document frozen at the top only, its pieces array open, keeps no answer, so an edit in place is answered afresh', async () => {
  const doc = (await bowl()).exportDoc(), top = Object.freeze({ ...doc, pieces: [...doc.pieces] });
  const a = TB.extendCorner(top, { length: 400, turnDeg: 30 });
  top.pieces.push(a.pieces.at(-1));   // the same object, edited in place
  // what that content is worth afresh, the answer the edited document is owed: a frozen copy of it is refused (its last piece repeats an id)
  const copy = Object.freeze({ ...top, pieces: Object.freeze([...top.pieces]) });
  assert.throws(() => TB.extendCorner(copy, { length: 400, turnDeg: 30 }), (e) => e.code === 'BAD_DOC', 'a frozen copy of the edited content is refused');
  assert.throws(() => TB.extendCorner(top, { length: 400, turnDeg: 30 }), (e) => e.code === 'BAD_DOC', 'the edited document is answered afresh, as its copy is, not with the answer kept before the edit');
  assert.equal(TB.extendCorner(doc, { length: 400, turnDeg: 30 }), TB.extendCorner(doc, { length: 400, turnDeg: 30 }), 'a document frozen all the way down still keeps its answer (control)');
});
