// passclear.test.js: node --test test/passclear.test.js
// THE PASS CLEARANCE (src/validate/passclear.js): a road may not pass over another closer than its underside's depth plus a car's room. Rows:
//   1  a road crossing over another (test/geom_fixtures.js crossing, flat, at right angles) is found within the bound and not past it: the road gap at the
//      crossing, measured on the path, set just inside and just outside the underside's depth plus the car's room (bisected on the fixture's height)
//   2  that finding is where the bound says: the upper road's underside, its depth there, and how far it comes over the lower road add up to the road gap
//   3  a road crossing level with the other (they meet) is a clip: the other road's own surface is on this one
//   4  a BANKED road over another brings its low edge down: at a height a flat crossing clears, the banked one is found, and the other road's surface there is
//      the road gap less its lateral offset times the sine of the bank (the road itself, before any underside)
//   5  an INVERTED road over another keeps only the car's room: its underside hangs on its far side, so a gap a flat crossing breaks is clear upside down, and
//      under the car's room it is found at the road's own surface
//   6  two roads side by side, their edges 1.5 m apart, at one height: their aprons reach under each other's (an apron over an apron, the class of his ELYSIUM's
//      older 0.88 m overlap); with no apron (width 0) there is nothing over anything
//   7  one pass of a road is never measured against itself: a wide road round a tight hairpin and a closed stadium find nothing; left open, its end on its start,
//      and a last piece laid along the first (how a lap is built before Close), are the seam; run on past the first piece, the last piece is found
//      (row 1's crossing is a last piece over the first ACROSS it, and is found)
//   8  `from`: only stations from that index lead, each against all the others, so a crossing is found from either of its two passes and not from past both
//   9  the bad inputs are refused by name
//  10  the solid is the export's: on a cup whose rim rises 30°, the hull's depth across the road is underskin.js rowDepths' rule and the apron's box reaches
//      the edge's own depth (computed here from the export's constants)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/geom/index.js');
const F = require('./geom_fixtures.js');
const { passClearance, CAR_MARGIN_M } = require('../src/validate/passclear.js');
const { hullDepth, UNDERSKIN_OFFSET_M } = require('../src/export/underskin.js');

const pathOf = (segs) => G.buildPath(segs, { step: 2 });
/** the road gap at a crossing(h): the height of the 'over' road over the 'lead' road where they cross in plan */
function roadGap(segs) {
  const S = pathOf(segs).samples, lead = S.filter((q) => segs[q.seg].id === 'lead'), over = S.filter((q) => segs[q.seg].id === 'over');
  let best = null;
  for (const a of over) for (const b of lead) { const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]); if (!best || d < best.d) best = { d, gap: a.pos[1] - b.pos[1] }; }
  return best.gap;
}
/** the fixture's height h whose real road gap is `want` (the fixture's h is approximate: its tests read the real height), by bisection */
function crossingAt(want, opts = {}) {
  let lo = 0, hi = 2 * want + 2;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (roadGap(F.crossing(m, opts)) < want) lo = m; else hi = m; }
  const segs = F.crossing((lo + hi) / 2, opts);
  return { segs, gap: roadGap(segs) };
}
// the bound over a flat road: the flat fixture's edges do not rise, so its underside hangs UNDERSKIN_OFFSET_M everywhere and hullDepth(0) at its edges
const FLAT_DEPTH = Math.max(UNDERSKIN_OFFSET_M, hullDepth(0)), BOUND = FLAT_DEPTH + CAR_MARGIN_M;

test('row 1: a road over another is found within its underside\'s depth plus the car\'s room, and not past it', () => {
  assert.ok(BOUND > 4 && BOUND < 5, `control: the flat bound is ${BOUND} m`);
  const inside = crossingAt(BOUND - 0.05), outside = crossingAt(BOUND + 0.05);
  assert.ok(Math.abs(inside.gap - (BOUND - 0.05)) < 1e-3 && Math.abs(outside.gap - (BOUND + 0.05)) < 1e-3, `control: gaps ${inside.gap}, ${outside.gap}`);
  const fi = passClearance(pathOf(inside.segs), inside.segs), fo = passClearance(pathOf(outside.segs), outside.segs);
  assert.ok(fi.length > 0, `${(BOUND - 0.05).toFixed(3)} m: found`);
  assert.deepEqual(fo, [], `${(BOUND + 0.05).toFixed(3)} m: nothing`);
  const worst = Math.max(...fi.map((f) => f.shortM));
  assert.ok(Math.abs(worst - 0.05) < 0.01, `short by the 5 cm it was set inside the bound: ${worst}`);
});

test('row 2: the finding is the upper road\'s underside: its depth and how far it comes over the lower road add up to the road gap', () => {
  const { segs, gap } = crossingAt(4), f = passClearance(pathOf(segs), segs);
  const lead = f.filter((x) => x.s < 100);   // the lead road's stations (the crossing is about 55 m along it)
  assert.ok(lead.length > 0, 'the lead road under the crossing is found');
  const DROP = 2 * Math.sin(25 * Math.PI / 180);   // the default plank's drop below its edge (src/export/apron.js: 2 m out at 25°)
  for (const x of lead) {
    assert.ok(Math.abs(x.gapM + x.hullM - x.surfaceGapM) < 0.02, `the underside hangs its depth under the upper surface: gap ${x.gapM} + hull ${x.hullM} vs surface ${x.surfaceGapM}`);
    // the upper surface over this road is its road, at the road gap, or its plank, up to the plank's drop under it
    if (x.apron) assert.ok(x.surfaceGapM <= gap + 0.05 && x.surfaceGapM >= gap - DROP - 0.05, `a plank: ${x.surfaceGapM} within ${gap} − ${DROP.toFixed(2)}`);
    else assert.ok(Math.abs(x.surfaceGapM - gap) < 0.05, `the upper road is the road gap over this road: ${x.surfaceGapM} vs ${gap}`);
    assert.equal(x.needM, CAR_MARGIN_M);
    assert.ok(Math.abs(x.shortM - (CAR_MARGIN_M - x.gapM)) < 1e-9);
    assert.equal(x.clip, false);
  }
  assert.ok(Math.abs(Math.max(...lead.map((x) => x.shortM)) - (BOUND - gap)) < 0.01, 'the worst is short by the bound less the gap');
});

test('row 3: a road crossing level with the other is a clip', () => {
  const segs = F.crossing(0), f = passClearance(pathOf(segs), segs);
  assert.ok(f.some((x) => x.clip && Math.abs(x.surfaceGapM) < 0.01), `a finding where the other road's surface is on this one: ${JSON.stringify(f.slice(0, 2))}`);
  assert.ok(Math.abs(Math.max(...f.map((x) => x.shortM)) - BOUND) < 0.01, 'short by the whole bound');
});

test('row 4: a banked road over another brings its low edge down: the other road\'s surface is the road gap less the edge\'s drop', () => {
  const bank = 45 * Math.PI / 180, flat = crossingAt(5), banked = crossingAt(5, { tailRoll: bank });
  assert.deepEqual(passClearance(pathOf(flat.segs), flat.segs), [], 'control: the flat crossing at 5 m is clear');
  const f = passClearance(pathOf(banked.segs), banked.segs).filter((x) => x.s < 100 && !x.apron);
  assert.ok(f.length > 0, 'the banked crossing at 5 m is found');
  for (const x of f) assert.ok(Math.abs(x.surfaceGapM - (banked.gap - Math.abs(x.otherU) * Math.sin(bank))) < 0.15, `u ${x.otherU}: surface ${x.surfaceGapM} vs ${banked.gap} − |u|·sin 45°`);
});

test('row 5: an inverted road over another keeps only the car\'s room: its underside hangs on its far side', () => {
  const up = Math.PI, clearUpright = crossingAt(BOUND - 0.5), inv = crossingAt(BOUND - 0.5, { tailRoll: up });
  assert.ok(passClearance(pathOf(clearUpright.segs), clearUpright.segs).length > 0, 'control: upright, this gap breaks the bound');
  assert.deepEqual(passClearance(pathOf(inv.segs), inv.segs), [], 'upside down it is clear');
  const low = crossingAt(CAR_MARGIN_M - 0.2, { tailRoll: up }), f = passClearance(pathOf(low.segs), low.segs).filter((x) => x.s < 100);
  assert.ok(f.length > 0, 'under the car\'s room it is found');
  for (const x of f) assert.ok(Math.abs(x.gapM - x.surfaceGapM) < 1e-9 && Math.abs(x.gapM - low.gap) < 0.05, `the nearest is the road itself: gap ${x.gapM}, surface ${x.surfaceGapM}, road gap ${low.gap}`);
});

test('row 6: two roads side by side 1.5 m apart: their aprons reach under each other\'s; with no apron nothing is over anything', () => {
  // test/stacked_not_red.test.js's side by side: a lead straight, a 180° turn and a straight back, its road edge 1.5 m from the lead's, at one height
  const HALF = 13, R = HALF + 1.5 / 2, k = 1 / R;
  const segs = [{ id: 'lead', kind: 'road', length: 160, profile: F.FLAT }, { id: 'turn', kind: 'road', length: Math.PI * R, k0: k, k1: k, profile: F.FLAT }, { id: 'back', kind: 'road', length: 140, profile: F.FLAT }];
  const p = pathOf(segs), withApron = passClearance(p, segs, { apronM: 2 }), without = passClearance(p, segs, { apronM: 0 });
  assert.ok(withApron.length > 0 && withApron.every((x) => x.apron || x.onApron), `each finding is an apron's: one road over the other's apron, or an apron over its road: ${JSON.stringify(withApron.slice(0, 1))}`);
  assert.deepEqual(without, [], 'no apron: nothing');
});

test('row 7: one pass of a road is never measured against itself', () => {
  // (not the fixture's loop-the-loop: with no yaw its exit straight lies on its entry, 0.3 to 2.3 m over it, which this rule finds, rightly)
  for (const [name, segs] of [['a 26 m road round a 16 m hairpin', F.hairpin('h', 16, 10, F.FLAT)]]) assert.deepEqual(passClearance(pathOf(segs), segs), [], name);
  // the stadium is a lap: closed, its seam is one pass; left OPEN, its end lies on its start 428 m on, which is the seam a Close joins, not a pass over it
  const st = F.stadium(), closed = G.buildPath(st, { step: 2, closed: true }), open = pathOf(st);
  assert.deepEqual(passClearance(closed, st), [], 'the stadium, closed');
  assert.deepEqual(passClearance(open, st), [], 'the stadium left open: its two ends are the seam');
  // a lap is built by laying its last piece onto its start, along it, then Close: that last piece on the first is the seam too (60 m along the 100 m first straight).
  // Only the first piece: run on past it, onto the turn after it (160 m), the last piece lies on a second pass and is found there
  const onto = (L) => { const segs = [...st, { id: 'on', word: 'straight', kind: 'road', length: L, profile: F.FLAT }], p = pathOf(segs); return { segs, f: passClearance(p, segs), p }; };
  assert.deepEqual(onto(60).f, [], 'the last piece laid 60 m along the first: the seam');
  const past = onto(160), on = (x) => past.segs[past.p.samples.find((q) => Math.abs(q.s - x.s) < 1.01).seg].id;
  assert.ok(past.f.some((x) => x.clip && /^T1/.test(on(x))), 'control: 160 m runs past the first piece onto the turn after it, and is found there');
});

test('row 8: from: only stations from that index lead, each against every other', () => {
  const segs = F.crossing(0), p = pathOf(segs), all = passClearance(p, segs), S = p.samples;
  const firstOver = S.findIndex((q) => segs[q.seg].id === 'over'), lastLead = S.findIndex((q) => segs[q.seg].id !== 'lead');
  assert.deepEqual(passClearance(p, segs, { from: firstOver }), all, 'from the upper pass: the same findings');
  assert.ok(lastLead > 0 && passClearance(p, segs, { from: 0 }).length === all.length, 'control: from 0 is the whole read');
  assert.deepEqual(passClearance(p, segs, { from: S.length }), [], 'from past every station: nothing');
});

// row 10 reads the section the rule builds against the export's own rule for the hull's depth (src/export/underskin.js rowDepths: UNDERSKIN_OFFSET_M, deepened toward
// an edge that rises by hullDepth(rim) times x², x = 1 − (distance in from the edge) / HULL_EDGE_SPAN_M) and the apron (src/export/apron.js: 2 m out at 25° down,
// its box down to the edge's own depth), on a cup whose rim rises 30°, computed here from those constants
test('row 10: the solid is the export\'s: the hull deepens toward a rising edge by the square of the distance in, and the apron\'s box reaches the edge\'s depth', () => {
  const P = require('../src/geom/profile.js'), { HULL_EDGE_SPAN_M } = require('../src/export/underskin.js'), { _internal } = require('../src/validate/passclear.js');
  const cup = P.normalize(F.prof('cup', [-13, -9, 0, 9, 13], [30, 0, 0, 0, 30])), sec = _internal.sectionOf(cup, 2);
  const dE = hullDepth(30), [XL] = P.offsetAt(cup, -13), [XR] = P.offsetAt(cup, 13);
  assert.ok(dE > UNDERSKIN_OFFSET_M + 0.5, `control: a 30° rim hangs deeper than the flat offset (${dE} m)`);
  let road = 0, apron = 0;
  for (const p of sec.pts) {
    if (!p.apron) {
      const t = Math.min(Math.abs(p.X - XL), Math.abs(p.X - XR)), x = Math.max(0, 1 - t / HULL_EDGE_SPAN_M);
      assert.ok(Math.abs(p.depth - (UNDERSKIN_OFFSET_M + (dE - UNDERSKIN_OFFSET_M) * x * x)) < 1e-9, `u ${p.u}: depth ${p.depth}, ${t} m in from the edge`);
      road++;
    } else {
      const drop = p.w * Math.sin(25 * Math.PI / 180);
      assert.ok(Math.abs(p.depth - (dE - drop)) < 1e-9, `the apron ${p.w} m out: its box ${p.depth} m reaches the edge's depth (${dE} − ${drop})`);
      apron++;
    }
  }
  assert.ok(road >= 27 && apron === 4, `control: the road across at most 1 m apart, and two points on each apron (${road}, ${apron})`);
});

test('row 9: bad inputs are refused by name', () => {
  const segs = F.crossing(0), p = pathOf(segs);
  assert.throws(() => passClearance(p, segs, { marginM: 0 }), /marginM must be above 0/);
  assert.throws(() => passClearance(p, segs, { apronM: -1 }), /apronM must be 0 or more/);
  assert.deepEqual(passClearance({ samples: [], closed: false }, []), [], 'an empty path: nothing');
});
