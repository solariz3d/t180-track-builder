// geom_fonts.test.js: node --test --test-concurrency=4 test/geom_fonts.test.js. The MEASURED FONTS (src/geom/fonts.js,
// D182) against the library's cross-sections, and the geometry holding them at T-180 scale.
// BOUNDS, stated before the tests were run:
//   · ψ: at ¼, ½ and ¾ of each side's half-width, the font is within 1.5° of that side's median for its family
//     (src/geom/fontshape.json). The edge is the larger of the edge and ¾ medians, per side, averaged (fonts.js says why).
//   · THE CHAIR'S (D182, 01:27, from the keeper's "the rims flip up too much"), stated before these ran:
//     - the bowl, the default font of every road class (A's src/doc/vocabgen.js), sits inside EACH road class's p10-p90
//       (src/doc/corpus.json) at ¼, ½, ¾ and the edge, on both sides; the half-pipe and flat, no class's default, inside
//       their own family's p10-p90;
//     - NO LIP: each font's steepest rise across the width (°/m) at its family's median width lies inside the real words'
//       p10-p90 of the same measure, and at the family's p10 width (the narrowest it is commonly built) is at most the p90;
//     - a new word's default is no wall (fonts.js DEFAULTS), so nothing is added past the measured floor.
//   · T-180 scale: 67 m wide (the tight class's width p90, FINDINGS §7f), radii from 51 m (the tight p10) to 800 m (the
//     sweep median), pieces up to 224 m (the straight run p90), each measured font with an 8 m wall to 60°:
//     every cell under 65,536 vertices, and every path sample between two chosen stations within chordErr of the
//     mesh's edge, re-derived here from the path, at the outermost vertex (where the chord error is largest).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const G = require(path.join(R, 'src/geom/index.js'));
const { normalize, offsetAt, spanOf } = require(path.join(R, 'src/geom/profile.js'));
const { FLOORS, AT, fontProfile, isMeasured } = require(path.join(R, 'src/geom/fonts.js'));
const SHAPE = require(path.join(R, 'src/geom/fontshape.json'));

const DEG = Math.PI / 180;
const FONTS = Object.keys(FLOORS);

test('fonts: the three measured families, and nothing else is called measured (the deep half-pipe is measured, not a font)', () => {
  assert.deepEqual(FONTS.sort(), ['bowl', 'flat', 'half-pipe']);
  assert.deepEqual(Object.keys(SHAPE.families).sort(), ['bowl', 'flat', 'half-pipe', 'half-pipe-deep']);
  assert.equal(isMeasured('tube'), false);
});

for (const font of FONTS) {
  test(`fonts: ${font}'s ψ at ¼, ½, ¾ is within 1.5° of the library's median on BOTH sides`, () => {
    const fam = SHAPE.families[font].psi_deg;
    for (let i = 0; i < 3; i++) for (const side of ['inside', 'outside']) {
      const m = fam[side][i].p50;
      assert.ok(Math.abs(FLOORS[font][i] - m) <= 1.5, `${font} at ${AT[i]} (${side}): font ${FLOORS[font][i]}°, library median ${m}°`);
    }
  });
  test(`fonts: ${font}'s edge is the lip rule (max of edge and ¾ medians per side, averaged), to 0.1°`, () => {
    const fam = SHAPE.families[font].psi_deg, lip = (s) => Math.max(fam[s][3].p50, fam[s][2].p50);
    assert.ok(Math.abs(FLOORS[font][3] - (lip('inside') + lip('outside')) / 2) <= 0.05 + 1e-9, `${font}: ${FLOORS[font][3]}`);
  });
}

test('fonts: src/geom/fontshape.json is what tools/fontshape.cjs makes from the reads, when the reads are here', (t) => {
  const reads = path.join(R, 'reads');
  if (!fs.existsSync(path.join(reads, 'sakura_speedway.read.json'))) { t.skip('no reads/ on this machine: FINDINGS §7f has the commands that make them'); return; }
  const { words, families } = require(path.join(R, 'tools/fontshape.cjs'));
  assert.deepEqual(families(words(reads)), SHAPE.families);
});

test('fontProfile: symmetric, ψ(0) = 0, the floor at ¼ ½ ¾ 1 of the half-width, the wall beyond it to ψL / ψR', () => {
  const P = fontProfile('half-pipe', { width: 40, wall: 8, psiL: 70 * DEG, psiR: 50 * DEG });
  assert.deepEqual(P.u, [-28, -20, -15, -10, -5, 0, 5, 10, 15, 20, 28]);
  assert.equal(P.psi[5], 0);
  for (let i = 1; i <= 4; i++) assert.equal(P.psi[5 + i], P.psi[5 - i]);
  assert.ok(Math.abs(P.psi[8] - 14.1 * DEG) < 1e-12);   // at 40 m no quarter reaches the half-pipe's rate cap
  assert.equal(P.psi[10], 70 * DEG); assert.equal(P.psi[0], 50 * DEG);
  assert.deepEqual(normalize(P).u, P.u);   // profile.js takes it as it is
  const bare = fontProfile('bowl', { width: 30 });
  assert.deepEqual([bare.u[0], bare.u[bare.u.length - 1]], [-15, 15]);   // wall 0: the floor alone
});

test('fontProfile: refuses an unknown font, a non-positive width, a negative wall, a non-finite angle', () => {
  assert.throws(() => fontProfile('tube', { width: 10 }), /not a measured font/);
  assert.throws(() => fontProfile('bowl', { width: 0 }), /width/);
  assert.throws(() => fontProfile('bowl', { width: 30, wall: -1 }), /wall/);
  assert.throws(() => fontProfile('bowl', { width: 30, psiL: NaN }), /finite/);
});

test('spanOf: the flat font at 67 m spans ~67 m; a wall past vertical folds back, so the span is the extreme X', () => {
  const s = spanOf(normalize(fontProfile('flat', { width: 67 })));
  assert.ok(s > 66.9 && s <= 67, `${s}`);
  const over = normalize({ u: [-10, 0, 10, 30], psi: [0, 0, 0, 150 * DEG] });
  assert.ok(spanOf(over) < offsetAt(over, 30)[0] + 10 + 1e-9 && spanOf(over) > 20, `${spanOf(over)}`);
});

// a T-180-scale stretch: every measured font at 67 m with an 8 m wall to 60°, corners from the corpus
function t180Stretch() {
  const p = (font) => fontProfile(font, { width: 67, wall: 8, psiL: 60 * DEG, psiR: 60 * DEG });
  const arc = (id, Rm, deg, font) => ({ id, kind: 'road', length: Rm * Math.abs(deg) * DEG, k0: Math.sign(deg) / Rm, k1: Math.sign(deg) / Rm, profile: p(font) });
  return [
    { id: 'st', kind: 'road', length: 224, k0: 0, k1: 0, profile: p('flat') },
    arc('sw', 800, 30, 'half-pipe'),
    arc('tu', 296, 60, 'bowl'),
    arc('ti', 51, 90, 'bowl'),
    arc('t2', 51, -90, 'half-pipe'),
  ];
}

test('T-180 scale: 67 m wide, radii 51-800 m, pieces to 224 m: every cell is under 65,536 vertices', () => {
  const segs = t180Stretch(), m = G.buildMesh(G.buildPath(segs), segs);
  const most = Math.max(...m.cells.map((c) => c.vertices));
  for (const c of m.cells) assert.ok(c.vertices < 65536, `${c.name}: ${c.vertices}`);
  assert.ok(m.folds.length === 0, `folds: ${JSON.stringify(m.folds.slice(0, 3))}`);
  assert.ok(most > 1000, `the fixture should be heavy enough to mean something (largest cell ${most})`);
});

test('T-180 scale: the mesh\'s chord error at the outermost vertex, re-derived from the path, is within chordErr (0.02 m)', () => {
  const segs = t180Stretch(), P = G.buildPath(segs), m = G.buildMesh(P, segs), S = P.samples;
  const at = (smp) => { const pr = normalize(segs[smp.seg].profile), u = pr.u[0], [X, Y] = offsetAt(pr, u); return smp.pos.map((v, k) => v + smp.L[k] * X + smp.U[k] * Y); };
  const idx = new Map(); for (let i = 0; i < S.length; i++) idx.set(S[i].s, i);
  const st = m.stats.stationS; let worst = 0, checked = 0;
  for (let j = 1; j < st.length; j++) {
    const a = idx.get(st[j - 1]), b = idx.get(st[j]);
    if (a === undefined || b === undefined || S[a].seg !== S[b].seg) continue;   // across a piece boundary the rows are the pieces' own
    const A = at(S[a]), B = at(S[b]), d = B.map((v, k) => v - A[k]), dd = d.reduce((x, v) => x + v * v, 0);
    for (let i = a + 1; i < b; i++) {
      const w = at(S[i]).map((v, k) => v - A[k]), t = Math.max(0, Math.min(1, w.reduce((x, v, k) => x + v * d[k], 0) / dd));
      worst = Math.max(worst, Math.hypot(...w.map((v, k) => v - d[k] * t))); checked++;
    }
  }
  assert.ok(checked > 100, `too few samples checked: ${checked}`);
  assert.ok(worst <= 0.02 + 1e-9, `worst chord error ${worst} m`);
});


const C = require(path.join(R, 'src/doc/corpus.json'));
const { DEFAULTS, WIDTHS, steepestRise } = require(path.join(R, 'src/geom/fonts.js'));
const inBand = (v, b, what) => assert.ok(v >= b.p10 - 1e-9 && v <= b.p90 + 1e-9, `${what}: ${v} outside p10-p90 [${b.p10}, ${b.p90}]`);

for (const k of ['straight', 'sweep', 'turn', 'tight']) {
  test(`fonts: the bowl (every road class's default) is inside ${k}'s p10-p90 at ¼, ½, ¾ and the edge, both sides`, () => {
    const P = C.classes[k].psi_deg, sides = k === 'straight' ? ['low', 'high'] : ['inside', 'outside'];
    for (const sd of sides) for (let i = 0; i < 4; i++) inBand(FLOORS.bowl[i], P[sd][i], `bowl vs ${k} ${sd} at ${AT[i]}`);
  });
}
for (const font of ['half-pipe', 'flat']) {
  test(`fonts: the ${font} is inside its own family's p10-p90 at ¼, ½, ¾ and the edge, both sides`, () => {
    const P = SHAPE.families[font].psi_deg;
    for (const sd of ['inside', 'outside']) for (let i = 0; i < 4; i++) inBand(FLOORS[font][i], P[sd][i], `${font} ${sd} at ${AT[i]}`);
  });
}
for (const font of FONTS) {
  test(`NO LIP: the ${font}'s steepest rise across the width is inside the real p10-p90 at its median width, and ≤ p90 at its p10 width`, () => {
    const fam = SHAPE.families[font], r = fam.rate_deg_per_m;
    assert.equal(WIDTHS[font], fam.width_m.p50);
    inBand(steepestRise(font, fam.width_m.p50), r, `${font} at ${fam.width_m.p50} m`);
    const narrow = steepestRise(font, fam.width_m.p10);
    assert.ok(narrow <= r.p90 + 1e-9, `${font} at its p10 width ${fam.width_m.p10} m rises ${narrow.toFixed(2)}°/m, past the real p90 ${r.p90}`);
  });
}
test('NO LIP: the old half-pipe (a flat floor, then an 8 m wall to 60°) rises past every real half-pipe, so this test can fail', () => {
  const rise = 60 / 8, r = SHAPE.families['half-pipe'].rate_deg_per_m;   // the old font's wall: 0 → 60° over its 8 m arc
  assert.ok(rise > r.p90, `old wall ${rise}°/m against the real p90 ${r.p90}`);
});
test('fonts: a new word in a measured font gets no wall, its family\'s median width, and a wall top at the floor\'s edge', () => {
  for (const font of FONTS) {
    const d = DEFAULTS[font], P = fontProfile(font, d);
    assert.equal(d.wall, 0); assert.equal(d.width, WIDTHS[font]);
    assert.deepEqual([P.u[0], P.u[P.u.length - 1]], [-d.width / 2, d.width / 2]);
    assert.ok(Math.abs(d.psiL - FLOORS[font][3] * Math.PI / 180) < 1e-12 && d.psiL === d.psiR);
  }
});

test('NO LIP at ANY width a user sets, 16-67 m in 1 m steps: no font rises faster than its family\'s real p90', () => {
  for (const font of FONTS) for (let w = 16; w <= 67; w++) {
    const r = SHAPE.families[font].rate_deg_per_m.p90, rise = steepestRise(font, w);
    assert.ok(rise <= r + 1e-9, `${font} at ${w} m: ${rise.toFixed(2)}°/m past the real p90 ${r}`);
  }
});

test('fonts: RATES (the rim-rate cap) are each family\'s measured median steepest rise, from fontshape.json', () => {
  const { RATES } = require(path.join(R, 'src/geom/fonts.js'));
  for (const font of FONTS) assert.equal(RATES[font], SHAPE.families[font].rate_deg_per_m.p50, font);
});
