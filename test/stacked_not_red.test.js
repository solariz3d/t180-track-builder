// stacked_not_red.test.js: node --test test/stacked_not_red.test.js
// D432: two passes of the road closer than 2 m are red ONLY when their geometry meets ("the tracks can be under 2m apart as long as the geometry isnt
// clipping into eachother"). Each row runs a fixture through the three checks a track meets: the validator (src/validate validate, with the mesh's folds, at
// full speed, as the export runs it), the preview's overlap check (app/core/overlapjob.js overlapCheck, an open track) and the export's own check
// (src/export/fromwords.js buildFromSegments as a TEST export, which lists every red and writes nothing). Rows:
//   1  side by side: a lead straight, a 180 deg turn and a straight back whose road edge runs 1.5 m from the lead's: no overlap red anywhere, and the
//      validator still reports the pair as information (info, 'stacked-within-2m')
//   2  one above the other: the figure-8 crossing 1.5 m over its own lead straight (test/geom_fixtures.js crossing): no overlap red anywhere
//   3  the side-by-side pair drifted until the two road edges overlap: red, as self-intersection, in all three
//   4  the crossing at 0 m (the passes meet): red, as self-intersection, in all three
//   5  a pit lane 1.5 m under the road's other pass, not touching (the export's lane check): no stacked red; the stack is information
//   6  the same lane with the other pass at its height: red, as self-intersection
//   7  without a mesh (the live checker's way): the clip test separates near (1.5 and 0.3 m) from touching, lying on, and pitching through
//   8  (AMENDED D432d) Close, with no mesh of its own, refuses a road lying on itself through the checker's clip test, and changes nothing
//   9  D432c/d: a road grazing the other's edge strip clips in the mesh (red with folds), and the mesh-free clip test sees it too (D432d)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/geom/index.js');
const { validate } = require('../src/validate/index.js');
const { overlapCheck } = require('../app/core/overlapjob.js');
const { buildFromSegments } = require('../src/export/fromwords.js');
const F = require('./geom_fixtures.js');

const HALF = 13;   // F.FLAT is 26 m wide
/** a lead straight, a 180 deg turn and a straight back, its road edge `gap` m from the lead's; `drift` (rad) turns the way back toward the lead over 10 m */
function sideBySide(gap, drift = 0) {
  const R = HALF + gap / 2, k = 1 / R;
  const out = [{ id: 'lead', kind: 'road', length: 160, profile: F.FLAT }, { id: 'turn', kind: 'road', length: Math.PI * R, k0: k, k1: k, profile: F.FLAT }];
  if (drift) out.push({ id: 'kink', kind: 'road', length: 10, k0: drift / 10, k1: drift / 10, profile: F.FLAT });
  out.push({ id: 'back', kind: 'road', length: 140, profile: F.FLAT });
  return out;
}
// the export puts its grid on a segment that says it is a straight, with every rate zero (src/markers/layout.js isStraight)
const forExport = (segs) => segs.map((g) => (g.k0 || g.k1 || g.kp0 || g.kp1 ? g : { ...g, word: 'straight', k0: 0, k1: 0, kp0: 0, kp1: 0, roll0: 0, roll1: 0 }));
const OVERLAP = /^(stacked|self-intersection)/;
/** the three checks' reds, by reason */
function checks(segs) {
  const p = G.buildPath(segs, { step: 2 }), m = G.buildMesh(p, segs, { selfCheck: true });
  const v = validate(p, segs, { csp: true, softCollision: true, folds: m.folds, fullSpeed: true });
  const oc = overlapCheck({ segments: segs }, null, { closed: false });
  const ex = buildFromSegments(forExport(segs), { name: 'd432' }, { test: true }).test.reds.map((t) => String(t).split(' ')[0]);
  return { v, validator: v.red.map((x) => x.reason), overlap: [...oc.overlaps, ...oc.others].map((x) => x.reason), exported: ex };
}
const overlapReds = (c) => ({ validator: c.validator.filter((r) => OVERLAP.test(r)), overlap: c.overlap.filter((r) => OVERLAP.test(r)), exported: c.exported.filter((r) => OVERLAP.test(r)) });

test('row 1: side by side, 1.5 m apart and not touching: no overlap red in the validator, the preview\'s overlap check or the export; the pair is information', () => {
  const c = checks(sideBySide(1.5));
  assert.deepStrictEqual(overlapReds(c), { validator: [], overlap: [], exported: [] });
  assert.ok(c.v.info.some((x) => x.reason === 'stacked-within-2m'), 'the validator still reports the two passes as information');
});

test('row 2: one above the other, 1.5 m apart and not touching: no overlap red in the validator, the preview\'s overlap check or the export', () => {
  const segs = F.crossing(1.5), p = G.buildPath(segs, { step: 2 });
  assert.ok(Math.abs(p.samples[p.samples.length - 1].pos[1] - 1.5) < 0.01, 'the fixture really crosses 1.5 m up');
  assert.deepStrictEqual(overlapReds(checks(segs)), { validator: [], overlap: [], exported: [] });
});

test('row 3: the side-by-side pair drifted until the road edges overlap: red, as self-intersection, in all three', () => {
  const c = overlapReds(checks(sideBySide(1.5, 0.06)));
  for (const [where, reds] of Object.entries(c)) assert.ok(reds.includes('self-intersection'), `${where}: ${JSON.stringify(reds)}`);
});

test('row 4: the crossing at 0 m, where the passes meet: red, as self-intersection, in all three', () => {
  const c = overlapReds(checks(F.crossing(0)));
  for (const [where, reds] of Object.entries(c)) assert.ok(reds.includes('self-intersection'), `${where}: ${JSON.stringify(reds)}`);
});

// the pit lane against the road (src/export/pitlane.js laneForExport, src/geom/pitlane.js laneCheck): a lane beside the lead straight of a 400 m-lead crossing, which the
// road's upper pass crosses over
const PL = require('../src/export/pitlane.js'), { DEFAULTS: PIT } = require('../src/doc/pitlane.js');
function laneUnder(h) {
  const segs = F.crossing(h, { lead: 400 }), p = G.buildPath(segs, { step: 2 }), m = G.buildMesh(p, segs, { selfCheck: true });
  return PL.laneForExport(p, segs, m, { ...PIT, side: 'R', leave: { word: 'lead', along: 150 }, rejoin: { word: 'lead', along: 395 } });
}

test('row 5: a pit lane 1.5 m under the road\'s other pass, not touching: no stacked or self-intersection red; the stack is information', () => {
  const r = laneUnder(1.5);
  assert.deepStrictEqual(r.red.filter((x) => OVERLAP.test(x.reason)).map((x) => x.reason), []);
  assert.ok(r.info.some((x) => x.reason === 'stacked' && /stacked 1\.50 m/.test(x.detail)), `the lane under the bridge is reported: ${JSON.stringify(r.info.map((x) => x.detail))}`);
});

test('row 6: the same pit lane with the road\'s other pass at its height (they meet): red, as self-intersection', () => {
  const r = laneUnder(0);
  assert.ok(r.red.some((x) => x.reason === 'self-intersection'), JSON.stringify([...new Set(r.red.map((x) => x.reason))]));
});

// THE CHECKS WITHOUT A MESH (D432 build, option A): the live checker, Close's checks, the radius limit and the phrases run validate with no mesh, so no folds;
// for them the stack's own station pairs carry a clip test (src/validate/index.js stacked()), red where the gap along the normal changes sign or is zero
const meshFree = (segs) => validate(G.buildPath(segs, { step: 2 }), segs, { csp: true, fullSpeed: true }).red.map((x) => x.reason).filter((r) => OVERLAP.test(r));
const pierce = (kp) => F.crossing(1.5).map((g) => (g.id === 'over' ? { ...g, kp0: kp, kp1: kp } : g));   // the upper pass pitches down THROUGH the lead straight

test('row 7: without a mesh, the clip test: 1.5 and 0.3 m apart (side by side, or one above the other) are not red; touching, lying on, or pitching through is self-intersection', () => {
  for (const [what, segs] of [['side 1.5', sideBySide(1.5)], ['side 0.3', sideBySide(0.3)], ['above 1.5', F.crossing(1.5)], ['above 0.3', F.crossing(0.3)]]) assert.deepStrictEqual(meshFree(segs), [], what);
  for (const [what, segs] of [['side touching', sideBySide(1.5, 0.06)], ['above 0', F.crossing(0)], ['pitching through', pierce(-0.008)]]) {
    const p = G.buildPath(segs, { step: 2 });
    assert.ok(G.buildMesh(p, segs, { selfCheck: true }).selfCheck.intersections.length > 0, `${what}: the mesh really meets itself`);
    assert.ok(meshFree(segs).includes('self-intersection'), `${what}: ${JSON.stringify(meshFree(segs))}`);
  }
});

// AMENDED (D432d, the librarian's ruling 2026-10-22 12:5x): this row tested Close's own mesh self-check (closejob.js clipsOf), which is removed: the clip test sees
// the edge graze it was kept for (row 9), and the export and the overlap check keep the mesh as the final authority (rows 3, 4 and 9). It now holds that Close,
// with no mesh of its own, refuses a road that lies on itself through the checker's clip test, and changes nothing
test('row 8: Close refuses a road that lies on itself through the checker\'s clip test alone (no mesh of its own), and changes nothing', () => {
  const { runCloseBest } = require('../app/core/closejob.js'), D = require('../src/core/document.js'), { extend } = require('../src/core/extend.js');
  const R = 180, Q = (Math.PI * R) / 2;   // two flat circles, one on the other, then 60 m (core_close_best row 4's coil)
  let coil = extend(D.createDoc('coil'), { length: 300, family: 'bowl' }); for (let i = 0; i < 8; i++) coil = extend(coil, { length: Q, transition: 40, targets: { kh: 1 / R } });
  coil = extend(coil, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = runCloseBest({ doc: coil });
  assert.equal(r.converged, false, r.report); assert.equal(r.doc, null);
  assert.ok(r.tried.some((t) => /self-intersection/.test(t.miss || '')), `a way of closing it was refused for the road meeting itself: ${JSON.stringify(r.tried.map((t) => t.miss))}`);
});

// D432c: A CLIP ONLY THE MESH SAW. Two roads whose edge strips cross each other BETWEEN stations: every sampled point of one lies on one side of the other, or beyond
// its edge, so no sign change was seen at 2 m stations (at 0.25 m it was); the mesh's triangles do meet there. Found by E's sagscan.js: the crossing fixture with the
// lead bending down then up over 10 m each (pitch rate 0.01 /m) under a tail bending up, the upper pass at h = -1.5. D432d: the clip test now also signs the rows
// linearly between a station and its neighbours, as the mesh's triangles run between its rows, so it sees it.
const graze = () => { const s = F.crossing(-1.5, { lead: 80 }), lead = s[0], tail = s[s.length - 1];
  return [{ ...lead, length: 60 }, { ...lead, id: 'crest', length: 10, kp0: 0.01, kp1: 0.01 }, { ...lead, id: 'dip', length: 10, kp0: -0.01, kp1: -0.01 }, ...s.slice(1, -1), { ...tail, kp0: 0.01, kp1: 0.01 }]; };

test('row 9: a road grazing the other\'s edge strip clips in the mesh (red with the mesh\'s folds), and the mesh-free clip test sees it too', () => {
  const segs = graze(), p = G.buildPath(segs, { step: 2 }), m = G.buildMesh(p, segs, { selfCheck: true });
  const x = m.selfCheck.intersections;
  assert.ok(x.length > 0 && x.every((y) => Math.abs(Math.abs(y.u) - HALF) < 1e-6), `the mesh meets itself at the lead's edge (u = ±${HALF}): ${JSON.stringify(x.map((y) => [y.s, y.u]))}`);
  assert.ok(validate(p, segs, { csp: true, fullSpeed: true, folds: m.folds }).red.some((r) => r.reason === 'self-intersection'), 'with the mesh\'s folds (export, overlap check), it is red');
  // AMENDED (D432d, the librarian's ruling 2026-10-22 12:5x): this line pinned the clip test's blind spot (it did not see the graze); the clip test now signs the
  // rows between stations too, so the graze is red without a mesh
  assert.ok(meshFree(segs).includes('self-intersection'), `the mesh-free clip test sees it: ${JSON.stringify(meshFree(segs))}`);
});
