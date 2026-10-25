// release-ghost.test.js: node --test app/test/release-ghost.test.js   (under the heavy-run lock)
// D407 (the user: "even turning a 1000m straight isnt smooth and laggy as hell"; the measurement of 2026-10-19, exo_memory/handback/p-d407-measure-A_2026-10-19.md): the full ghost of the
// next piece (built when a handle is let go, on every field change and on a hover over Extend) cost about 0.06 ms a metre (60 ms at 1,000 m), and 45% of that was one function:
// samplesAcross, 4,000 fine samples of the cross-section, run again for every 2 m chord of the piece (500 walks, 5 different cross-sections). The walk is a function of the numbers alone, so it
// is now kept under them (profile.js samplesAcrossFor). The work here is counted and compared, not timed (the frame times are app/test/release-frame.test.js). Rows:
//   1  the mesh is byte for byte what it was: the sha256 of the placed mesh, of the mesh after four more pieces, and of full ghosts of 100, 1,000 and 2,000 m, on a bowl track and a tube
//      track, taken at v0.4.8 (b306309), before this change
//   2  samplesAcrossFor(profile, limits) is samplesAcross(profile, limits) exactly, for a bowl, a tube and a wall-and-edge profile, at the default limits and at others, and the same
//      numbers asked 50 more times do no more walks (counted through samplesAcross.runs)
//   3  the answer follows the numbers: an edited knot or angle, a -0 for a 0 and other limits are each a fresh walk, and the array handed back is the caller's own (changing it changes nothing kept)
//   4  the work in a ghost: a full ghost of 1,000 m (500 chords) walks the cross-section at most 10 times (500 before), and the oldest answers go first (the cache is bounded)
//   5  the exact ghost in slices (the release): ghostSteps yields at least once per new chord, on an empty track and on a placed one, and what it returns is ghostFor's to the byte (the batches,
//      the path's stations, the head); buildPathSteps / extendPathSteps / buildMeshSteps / extendMeshSteps run to the end are buildPath / extendPath / buildMesh / extendMesh
//   6  the road lines (look.js linesFor, written straight into its arrays) are byte for byte what v0.4.8 made, for the placed track and a 1,000 m ghost, bowl and tube
//   7  the adapter's profileAt keeps one frozen profile per family, width and rate: the same numbers as fonts.fontProfile, the same object asked twice, a -0 rate its own, and a bad
//      width or family refused every time
//   8  placing the piece whose full ghost is on show takes the ghost's path and mesh: the placed track is byte for byte what a model that built it afresh makes (batches, path, bounds), it is built
//      without meshing the piece again (counted: no cross-section walk, no chord meshed), an undo puts back the track as it was and placing again after it is still the same; a cheap ghost, or a
//      ghost of other fields, is never taken
//   9  the start and its marks (spawnsInfo) on a growing track: asked after every piece (its path grown, not rebuilt) it is what a shell asked only at the end makes (layout, placed marks,
//      checks, notes, the path's stations), on an automatic start and on hand-placed spawns, and the path it handed out before a growth is not changed by it
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const PR = require('../../src/geom/profile.js');

const hashBatches = (bs) => {
  const h = crypto.createHash('sha256');
  for (const b of bs) { for (const k of ['positions', 'normals', 'uvs', 'indices']) if (b[k]) h.update(Buffer.from(b[k].buffer, b[k].byteOffset, b[k].byteLength)); if (b.model) h.update(Buffer.from(new Float64Array(b.model).buffer)); }
  return h.digest('hex').slice(0, 16);
};
async function bowl() { const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.extend({ length: 300 }); return s; }
async function tubeTrack() { const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.extend({ length: 200, first: { w: 31, t: 360 } }); s.extend({ length: 150, transition: 40, targets: { kh: 1 / 180 } }); return s; }

// taken at b306309 (v0.4.8) with tools of the D407 session (golden407.js)
const GOLDEN = {
  bowl: { placed: 'badfad7806627f9c', 'ghost 100/12': '84bb6a987b3a9de7 201', 'ghost 1000/30': 'f6bd715663bc45d4 651', 'ghost 2000/90': 'd42d1186582f3262 1151', 'placed+4': '2aa0ce6f5b95cd7b' },
  tube: { placed: 'aff718cba672ce27', 'ghost 100/12': 'aa18e76c4a68cdd4 226', 'ghost 1000/30': '7e53577987da9d55 676', 'ghost 2000/90': 'da82ca9bd994f83c 1176', 'placed+4': 'c8291a0d60bfca9c' },
};

test('row 1: the mesh is byte for byte what v0.4.8 made: placed, placed after four more pieces, and the full ghosts', async () => {
  for (const [name, mk] of [['bowl', bowl], ['tube', tubeTrack]]) {
    const sh = await mk(), tm = createTrackModel(), got = {};
    got.placed = hashBatches(tm.update(sh.getState().resolved).batches);
    for (const [L, turn] of [[100, 12], [1000, 30], [2000, 90]]) { const g = tm.ghostFor(sh.candidate({ length: L, turnDeg: turn })); got[`ghost ${L}/${turn}`] = hashBatches(g.batches) + ' ' + g.path.samples.length; }
    for (let i = 0; i < 4; i++) sh.extend({ length: 150, turnDeg: i % 2 ? 20 : -20 });
    got['placed+4'] = hashBatches(tm.update(sh.getState().resolved).batches);
    assert.deepEqual(got, GOLDEN[name], `${name}: what the track model builds`);
  }
});

const PROFILES = () => {
  const frozen = (P) => Object.freeze({ ...P, u: Object.freeze(P.u.slice()), psi: Object.freeze(P.psi.slice()) });
  return {
    bowl: frozen({ u: [-15.5, 0, 15.5], psi: [0.3, 0, -0.3], font: 'x', material: 'ROAD' }),
    tube: frozen({ u: [-20, -10, 0, 10, 20], psi: [1.2, 0.5, 0, -0.5, -1.2], font: 'x', material: 'ROAD' }),
    wall: frozen({ u: [-16, -15, -14, 0, 14, 15, 16], psi: [1.5, 0.8, 0.02, 0, -0.02, -0.8, -1.5], font: 'x', material: 'ROAD' }),
  };
};

test('row 2: samplesAcrossFor is samplesAcross exactly, and a frozen profile is worked out once', () => {
  assert.equal(typeof PR.samplesAcrossFor, 'function', 'profile.js exports samplesAcrossFor');
  for (const [name, P] of Object.entries(PROFILES())) {
    for (const lim of [{}, { maxSeam: 0.05, maxAcross: 0.5 }, { maxSeam: Math.PI / 90, maxAcross: 2 }]) {
      const want = PR.samplesAcross(P, lim), a = PR.samplesAcrossFor(P, lim), b = PR.samplesAcrossFor(P, lim);
      assert.deepEqual(a, want, `${name} ${JSON.stringify(lim)}: the same samples and the same need`);
      assert.deepEqual(b, want, `${name}: the second answer is the same`);
    }
  }
  const P = PROFILES().tube, before = PR.samplesAcross.runs || 0;
  PR.samplesAcrossFor(P, { maxSeam: 0.011, maxAcross: 0.77 }); const once = (PR.samplesAcross.runs || 0) - before;
  for (let i = 0; i < 50; i++) PR.samplesAcrossFor(P, { maxSeam: 0.011, maxAcross: 0.77 });
  assert.equal((PR.samplesAcross.runs || 0) - before, once, '50 more asks for the same profile and limits do no more work');
  assert.ok(once >= 1, 'and the first ask did the work (the counter counts)');
});

test('row 3: the answer follows the numbers; the array handed back is the caller own', () => {
  const P = { u: [-10, 0, 10], psi: [0.4, 0, -0.4], font: 'x', material: 'ROAD' };
  const a = PR.samplesAcrossFor(P, {}); P.psi[0] = 1.1; P.u[0] = -12;
  assert.deepEqual(PR.samplesAcrossFor(P, {}), PR.samplesAcross(P, {}), 'an edited profile is answered afresh');
  assert.notDeepEqual(PR.samplesAcrossFor(P, {}).u, a.u, 'and it is not the first answer');
  const Z = { u: [-8, 0, 8], psi: [0.2, 0, -0.2] }, Zn = { u: [-8, 0, 8], psi: [0.2, -0, -0.2] }, r0 = PR.samplesAcross.runs;
  PR.samplesAcrossFor(Z, {}); PR.samplesAcrossFor(Zn, {});
  assert.equal(PR.samplesAcross.runs - r0, 2, 'a -0 is not told from a 0 by the cache key (each is its own walk)');
  const w0 = PR.samplesAcross.runs; PR.samplesAcrossFor(Z, { maxAcross: 0.5 }); assert.equal(PR.samplesAcross.runs - w0, 1, 'other limits are a fresh walk');
  const x = PR.samplesAcrossFor(Z, {}), keep = x.u.slice(); x.u[3] = 999; x.u.push(1);
  assert.deepEqual(PR.samplesAcrossFor(Z, {}).u, keep, 'changing the array handed back changes nothing kept');
});

test('row 4: a full ghost of 1,000 m walks the cross-section a handful of times, and the cache is bounded', async () => {
  const sh = await bowl(), tm = createTrackModel(); tm.update(sh.getState().resolved);
  const c = sh.candidate({ length: 1000, turnDeg: 30 }), r0 = PR.samplesAcross.runs;
  tm.ghostFor(c);
  const walks = PR.samplesAcross.runs - r0;
  assert.ok(c.segments.length - sh.getState().resolved.segments.length >= 500, 'the ghost is cut into 2 m chords');
  assert.ok(walks <= 10, `${walks} walks for 500 chords`);
  for (let i = 0; i < 200; i++) PR.samplesAcrossFor({ u: [-5 - i * 0.01, 0, 5], psi: [0.1, 0, -0.1] }, {});   // 200 different profiles: the cache stays bounded and still answers
  const r1 = PR.samplesAcross.runs; PR.samplesAcrossFor({ u: [-5, 0, 5], psi: [0.1, 0, -0.1] }, {}); PR.samplesAcrossFor({ u: [-5, 0, 5], psi: [0.1, 0, -0.1] }, {});
  assert.ok(PR.samplesAcross.runs - r1 <= 1, 'a profile asked twice in a row is walked at most once');
});

const run = (it) => { let r = it.next(), n = 0; while (!r.done) { r = it.next(); n++; } return { value: r.value, yields: n }; };
const pathKey = (p) => crypto.createHash('sha256').update(JSON.stringify(p.samples.map((m) => [m.s, ...m.pos, ...m.T]))).digest('hex').slice(0, 16);

test('row 5: the exact ghost in slices is ghostFor to the byte, and yields at least once a chord', async () => {
  for (const placed of [false, true]) {
    const sh = await bowl(), tm = createTrackModel(), tm2 = createTrackModel();
    if (placed) { tm.update(sh.getState().resolved); tm2.update(sh.getState().resolved); }
    const c = placed ? sh.candidate({ length: 1000, turnDeg: 30 }) : { segments: sh.candidate({ length: 1000, turnDeg: 30 }).segments };
    const nNew = c.segments.length - (placed ? sh.getState().resolved.segments.length : 0);
    const whole = tm.ghostFor(c), { value: sliced, yields } = run(tm2.ghostSteps(c));
    assert.ok(yields >= nNew, `${placed ? 'placed' : 'empty'}: ${yields} yields for ${nNew} new chords`);
    assert.equal(hashBatches(sliced.batches), hashBatches(whole.batches), 'the same batches to the byte');
    assert.equal(pathKey(sliced.path), pathKey(whole.path), 'the same path stations');
    assert.deepEqual(sliced.head.pos, whole.head.pos, 'the same head');
  }
  const G = require('../../src/geom/index.js'), segs = (await bowl()).getState().resolved.segments;
  assert.equal(pathKey(run(G.buildPathSteps(segs, { step: 2 })).value), pathKey(G.buildPath(segs, { step: 2 })), 'buildPathSteps is buildPath');
  const p = G.buildPath(segs, { step: 2 });
  assert.equal(hashBatches(require('../preview/batches.js').batchesOf(run(G.buildMeshSteps(p, segs)).value)), hashBatches(require('../preview/batches.js').batchesOf(G.buildMesh(p, segs))), 'buildMeshSteps is buildMesh');
});

// CHANGED D433b (local-0.4.14): the centre line moved to u = 0 on purpose, so this row now holds the two EDGE lines and the TIES to v0.4.8's bytes (the hashes re-derived from 6261a22's
// look.js, whose lines were v0.4.8's: this row passed there) and pins the CENTRE line to D433b's own bytes, each part on its own. It was one hash of all three lines and the centre's index.
test('row 6: the road\'s edge lines and ties are byte for byte what v0.4.8 made, and the centre line is D433b\'s', async () => {
  const LK = require('../preview/look.js'), want = { 'bowl placed': 'a3a81e0e754b6342 150', 'bowl ghost': 'a3fd450da154a39b 500', 'tube placed': 'fb3af30bafc07c72 175', 'tube ghost': '216fb71f36aa5235 500' }, wantCentre = { 'bowl placed': '82b2ca97fc6a7ab7', 'bowl ghost': 'c0d0ab08d21cee15', 'tube placed': 'a1093d8f334de6e5', 'tube ghost': '87322ae7a47eeaf8' }, got = {}, gotCentre = {};
  for (const [name, mk] of [['bowl', bowl], ['tube', tubeTrack]]) {
    const sh = await mk(), tm = createTrackModel(), u = tm.update(sh.getState().resolved), g = tm.ghostFor(sh.candidate({ length: 1000, turnDeg: 30 }));
    for (const [k, bs] of [['placed', u.batches], ['ghost', g.batches]]) {
      const h = crypto.createHash('sha256'), hc = crypto.createHash('sha256'); let n = 0;
      for (const b of bs) {
        const L = LK.linesFor(b); if (!L) { h.update('-'); hc.update('-'); continue; } n++;
        for (let j = 0; j < L.edges.length / 6; j++) (j % 3 === 1 ? hc : h).update(Buffer.from(L.edges.buffer, L.edges.byteOffset + j * 24, 24));   // per row: edge 0, centre, edge K - 1
        h.update('|'); h.update(Buffer.from(L.ties.buffer));
      }
      got[name + ' ' + k] = h.digest('hex').slice(0, 16) + ' ' + n; gotCentre[name + ' ' + k] = hc.digest('hex').slice(0, 16);
    }
  }
  assert.deepEqual(got, want, 'the edge lines and the ties are v0.4.8\'s');
  assert.deepEqual(gotCentre, wantCentre, 'the centre line is D433b\'s, at u = 0');
});

test('row 7: profileAt keeps one frozen profile per family, width and rate, and refuses bad input every time', () => {
  const AD = require('../../src/core/adapter.js'), fonts = require('../../src/geom/fonts.js');
  for (const fam of ['bowl', 'half-pipe', 'flat']) for (const w of [24, 31, 45]) {
    const a = AD.profileAt(fam, w, fonts.RATES[fam]);
    assert.deepEqual(a, fonts.fontProfile(fam, { width: w }), `${fam} ${w} m: the same numbers`);
    assert.equal(AD.profileAt(fam, w, fonts.RATES[fam]), a, 'asked again: the same object');
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.u) && Object.isFrozen(a.psi), 'and it is frozen');
  }
  assert.notEqual(AD.profileAt('bowl', 31, -0), AD.profileAt('bowl', 31, 0), 'a -0 rate is its own entry');
  for (let i = 0; i < 2; i++) {
    assert.throws(() => AD.profileAt('bowl', 0, 1), (e) => e.code === 'BAD_WIDTH', 'a zero width is refused, every time');
    assert.throws(() => AD.profileAt('bowl', NaN, 1), (e) => e.code === 'BAD_WIDTH', 'NaN too');
    assert.throws(() => AD.profileAt('nope', 31, 1), (e) => e.code === 'BAD_FAMILY', 'and an unknown family');
  }
});

test('row 8: placing the ghost on show takes its work, and the track is the same to the byte; undo and a second placement too; a cheap or stale ghost is never taken', async () => {
  const G = require('../../src/geom/index.js');
  for (const [name, mk] of [['bowl', bowl], ['tube', tubeTrack]]) {
    const sh = await mk(), tm = createTrackModel(), ref = createTrackModel(); tm.update(sh.getState().resolved); ref.update(sh.getState().resolved);
    const o = { length: 1000, turnDeg: 25 }; tm.ghostFor(sh.candidate(o));
    const before = hashBatches(tm.update(sh.getState().resolved).batches);
    sh.extend(o);
    const u = tm.update(sh.getState().resolved), r = ref.update(sh.getState().resolved);
    assert.equal(hashBatches(u.batches), hashBatches(r.batches), `${name}: the placed batches are the fresh model's`);
    assert.equal(pathKey(u.path), pathKey(r.path), 'the placed path too');
    assert.deepEqual(u.bounds, r.bounds, 'and its box');
    assert.equal(u.how, 'extend', 'a growth of the track');
    assert.equal(hashBatches(batchesOfAll(u.mesh)), hashBatches(u.batches), 'the batches are the whole mesh of the track');
    sh.undo(); const back = tm.update(sh.getState().resolved);
    assert.equal(hashBatches(back.batches), before, `${name}: undo puts back the track as it was`);
    sh.redo(); const again = tm.update(sh.getState().resolved), r2 = createTrackModel(); 
    assert.equal(hashBatches(again.batches), hashBatches(r2.update(sh.getState().resolved).batches), 'redo: the same track again');
    sh.extend({ length: 300, turnDeg: -10 }); const third = tm.update(sh.getState().resolved), r3 = createTrackModel();
    assert.equal(hashBatches(third.batches), hashBatches(r3.update(sh.getState().resolved).batches), 'and a piece placed after it, with no ghost');
  }
  // it is the ghost's work that is taken: the same objects
  {
    const sh = await bowl(), tm = createTrackModel(); tm.update(sh.getState().resolved);
    const o = { length: 1000, turnDeg: 25 }, g = tm.ghostFor(sh.candidate(o)); sh.extend(o);
    const u = tm.update(sh.getState().resolved);
    assert.equal(u.path, g.path, 'the placed path IS the ghost path (taken, not built again)');
    assert.ok(g.batches.every((b) => u.batches.includes(b)), 'and the ghost batches are the placed track batches');
  }
  // never taken: a cheap ghost, a ghost of other fields
  for (const [what, ghostOf] of [['a cheap ghost', (sh, tm, o) => tm.ghostFor(sh.candidate(o, { coarse: true }), { cheap: true })], ['a ghost of other fields', (sh, tm) => tm.ghostFor(sh.candidate({ length: 1000, turnDeg: 40 }))]]) {
    const sh = await bowl(), tm = createTrackModel(), ref = createTrackModel(); tm.update(sh.getState().resolved); ref.update(sh.getState().resolved);
    const o = { length: 1000, turnDeg: 25 }; ghostOf(sh, tm, o); sh.extend(o);
    assert.equal(hashBatches(tm.update(sh.getState().resolved).batches), hashBatches(ref.update(sh.getState().resolved).batches), `${what}: the track is built, and is the fresh model's`);
  }
});
const batchesOfAll = (m) => require('../preview/batches.js').batchesOf(m);

test('row 9: spawnsInfo on a growing track is what it is built afresh, and an answer given is never changed by a growth', async () => {
  const strip = (info) => JSON.stringify(info, (k, v) => (k === 'path' ? (v && v.samples ? v.samples.map((m) => [m.s, ...m.pos]) : v) : typeof v === 'function' ? undefined : v));
  for (const spawns of [false, true]) {
    const a = await createCoreShell({ brushFn: null, autosaveMs: 0 }), b = await createCoreShell({ brushFn: null, autosaveMs: 0 });
    const steps = [{ length: 300 }, { length: 100, turnDeg: 12 }, { length: 1000, turnDeg: -20 }, { length: 2000, turnDeg: 30 }];
    let held = null, heldKey = null;
    for (const [i, o] of steps.entries()) {
      a.extend(o); b.extend(o);
      if (spawns && i === 0) for (const sh of [a, b]) { sh.setSpawns({ line: { along: 40 }, grid: { count: 8, rowGapM: 8, colGapM: 6 } }); assert.ok(sh.exportDoc().spawns, 'the hand-placed spawns are set: ' + sh.getState().message); }
      const info = a.spawnsInfo({ auto: true });
      if (held) assert.equal(strip(held), heldKey, 'the answer given before this growth is unchanged');
      held = info; heldKey = strip(info);
    }
    assert.equal(strip(a.spawnsInfo({ auto: true })), strip(b.spawnsInfo({ auto: true })), `${spawns ? 'hand-placed' : 'automatic'} start: grown is built`);
  }
});
