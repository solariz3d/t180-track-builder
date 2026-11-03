// markers_sectors.test.js: node --test test/markers_sectors.test.js
// A closed lap's sector gates (src/markers/layout.js lapSectors, 2026-10-14; ELYSIUM's export had only the start gate, and its sector gates were added by
// hand): AC_TIME_1 and AC_TIME_2 a third and two thirds of the lap past the start line; none on an open track.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js'), AD = require('../src/core/adapter.js');
const Lay = require('../src/markers/layout.js'), { segStarts } = require('../src/markers/place.js');
const { startLayout } = require('../app/core/coreshell.js');   // the layout the export places (as test/fixtures/fixtures.js renders it)

const FX = path.join(__dirname, 'fixtures');
const docOf = (file) => D.parse(fs.readFileSync(path.join(FX, file), 'utf8'));
const lapOf = (doc) => {
  const segs = AD.toSegments(doc), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }, lift = (q) => AD.offsetPath(doc, segs, q);
  const p = AD.toPath(doc, { step: 2 }).path; return { segs, p, starts: segStarts(p, segs), layout: () => startLayout(segs, lift, start) };
};

test('a closed lap: AC_TIME_1 and AC_TIME_2 a third and two thirds of the lap past the start line, on road', () => {
  const { segs, p, starts, layout } = lapOf(docOf('F1-bowl-default-lap-closed.core2.json'));
  const L = layout(), sLine = Lay.anchorS(L.line, segs, starts), len = p.lengthM, s0 = p.samples[0].s;
  assert.equal(L.sectors.length, 2);
  L.sectors.forEach((a, i) => {
    const s = Lay.anchorS(a, segs, starts), want = ((sLine + ((i + 1) * len) / 3 - s0) % len + len) % len + s0;
    assert.ok(Math.abs(s - want) < 1e-6, `sector ${i + 1} at ${s.toFixed(2)} m, a third of the lap on is ${want.toFixed(2)} m`);
    const seg = segs[starts.findLastIndex((x) => x <= s + 1e-9)]; assert.equal(seg.kind, 'road', 'on road');
  });
  const r = Lay.resolveLayout(L, p, segs);
  assert.deepEqual(r.markers.filter((m) => m.kind === 'sector').map((m) => m.name).sort(), ['AC_TIME_1_L', 'AC_TIME_1_R', 'AC_TIME_2_L', 'AC_TIME_2_R']);
});

test('an open track has no sector gates', () => {
  const { segs, p } = lapOf(docOf('F3-bowl-narrow-12m-cap-binds.core2.json'));
  assert.equal(p.closed, false);
  assert.deepEqual(Lay.lapSectors(p, segs, 10), []);
});

// 2026-10-30 (the user: "did a complete lap and didnt register a laptime or ghost"): on ELYSIUM, his saved document of 2026-10-22, a third of the lap fell
// inside a loop (climbing 68°, the road facing down) and two thirds on a 30° bank. Each sector gate now goes to the nearest station where the road is flat
// enough (layout.js gateFlatAt), searched both ways; with none within a quarter lap, the gate is left out and the layout says so.
const Pl = require('../src/markers/place.js'), Prof = require('../src/geom/profile.js');
const ELYSIUM = 'elysium-2026-10-22.t180track', DEG = Math.PI / 180;
const gatesOf = (lap) => { const L = lap.layout(), r = Lay.resolveLayout(L, lap.p, lap.segs), by = (n) => r.markers.find((m) => m.name === n); return { L, r, sLine: Lay.anchorS(L.line, lap.segs, lap.starts), g: [1, 2].map((i) => [by(`AC_TIME_${i}_L`), by(`AC_TIME_${i}_R`)]) }; };

test('ELYSIUM: both sector gates stand on flat road (level across within 15°, climbing under 20°, the road facing up, neither end past vertical)', () => {
  const lap = lapOf(docOf(ELYSIUM)), { g } = gatesOf(lap);
  g.forEach(([l, r], i) => {
    assert.ok(l && r, `AC_TIME_${i + 1} is placed`);
    const a = Pl.placeMarker(lap.p, lap.segs, l, lap.starts).surface, b = Pl.placeMarker(lap.p, lap.segs, r, lap.starts).surface, c = Pl.surfaceAt(lap.p, lap.segs, l.s, 0, lap.starts);
    const v = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], tilt = Math.asin(Math.abs(v[1]) / Math.hypot(...v)) / DEG, climb = Math.asin(Math.abs(c.T[1])) / DEG;
    assert.ok(tilt <= 15 + 1e-9, `AC_TIME_${i + 1} at s ${l.s.toFixed(0)} m tilts ${tilt.toFixed(1)}° from level`);
    assert.ok(climb < 20, `AC_TIME_${i + 1} at s ${l.s.toFixed(0)} m climbs ${climb.toFixed(1)}°`);
    assert.ok(c.n[1] > 0, `AC_TIME_${i + 1} at s ${l.s.toFixed(0)} m: the road faces down (inside a loop)`);
    for (const m of [l, r]) assert.ok(Prof.normalAt(c.P, m.u)[1] > 0, `${m.name}: its end is past vertical`);
  });
});

test('ELYSIUM: each sector gate is at the NEAREST flat station to its third, looking both ways (no flat station is nearer on either side)', () => {
  const lap = lapOf(docOf(ELYSIUM)), { L, sLine, g } = gatesOf(lap), len = lap.p.lengthM, s0 = lap.p.samples[0].s, wrap = (s) => ((s - s0) % len + len) % len + s0;
  const inset = L.gateInsetM, flat = (s) => Lay.gateFlatAt(lap.p, lap.segs, s, inset, lap.starts);
  g.forEach(([l], i) => {
    const target = wrap(sLine + ((i + 1) * len) / 3), off = ((l.s - target) % len + 1.5 * len) % len - len / 2;   // signed, the short way round
    assert.ok(Math.abs(off) > 1, `AC_TIME_${i + 1} moved off its third (ELYSIUM's third is not flat): ${off.toFixed(1)} m`);
    for (let d = 0; d < Math.abs(off) - 1e-6; d += Lay.GATE_STEP_M) for (const sg of [1, -1]) assert.ok(!flat(wrap(target + sg * d)), `AC_TIME_${i + 1}: s ${wrap(target + sg * d).toFixed(0)} m is flat and nearer (${d} m) than the gate (${Math.abs(off).toFixed(0)} m)`);
  });
  const offs = g.map(([l], i) => ((l.s - wrap(sLine + ((i + 1) * len) / 3)) % len + 1.5 * len) % len - len / 2);
  assert.ok(offs.some((o) => o > 0) && offs.some((o) => o < 0), `one gate moved forward and one back, so the search looks both ways: ${offs.map((o) => o.toFixed(0)).join(', ')} m`);
});

test('a lap with no flat road within a quarter lap of a third: the gate is left out, and the layout says so in an amber note', () => {
  const doc = docOf('F1-bowl-default-lap-closed.core2.json'), B = 30 * DEG;   // the same lap banked 30° all the way round
  const banked = { ...doc, pieces: doc.pieces.map((P) => ({ ...P, channels: { ...P.channels, phi: P.channels.phi.map(() => B) } })) };
  const segs = AD.toSegments(banked), p = AD.toPath(banked, { step: 2 }).path;
  const sectors = Lay.lapSectors(p, segs, p.samples[0].s);
  assert.equal(sectors.length, 2);
  sectors.forEach((a, i) => { assert.ok(a.omitted, `sector ${i + 1} is left out`); assert.match(a.omitted, /not flat enough/); });
  const flatLap = lapOf(doc), L = flatLap.layout(), r = Lay.resolveLayout({ ...L, sectors }, flatLap.p, flatLap.segs);
  assert.deepEqual(r.markers.filter((m) => m.kind === 'sector'), [], 'no sector gate is placed');
  assert.deepEqual(r.notes.filter((n) => n.id === 'sector-omitted').map((n) => n.level), ['amber', 'amber'], 'each omission is said');
});

test('the markers check flags a gate narrower than half the road seen from above (across a steep bank), and passes a level one', () => {
  const { checkPlaced } = require('../src/markers/checks.js');
  const mk = (name, x, y, u) => ({ name, kind: 'sector', s: 50, u, h: 1.5, surface: [x, y, 50], fwd: [0, 0, 1], T: [0, 0, 1], normal: [0, 1, 0], left: [1, 0, 0], span: [-15, 15] });
  // R at the road's right edge (x -14.5), L 29 m from it along the surface, risen yL: level, it is 29 m across in plan; risen 28 m, about 7.5 m
  const run = (yL) => checkPlaced([mk('AC_TIME_1_L', -14.5 + Math.sqrt(29 * 29 - yL * yL), yL, 14.5), mk('AC_TIME_1_R', -14.5, 0, -14.5)], { pits: { count: 0 } }, { lengthM: 100, closed: true }).checks.find((c) => c.id === 'gate-width');
  assert.equal(run(0).ok, true, 'a level gate spans the road from above');
  const wall = run(28);   // ends 28 m apart in height: 7.5 m apart in plan on a 30 m road
  assert.equal(wall.ok, false);
  assert.match(wall.problems.join(' '), /AC_TIME_1 is 7\.5 m wide seen from above on a road 30\.0 m wide/);
});

// 2026-11-01 (a lap whose third fell in a bank's exit; its export refused "AC_TIME_1 tilts 15° from level" from every start line): the search measured a gate
// at the road, the export's check measures its two dummies, 1.5 m up each end's own normal, and on an edged or cupped road those differ. Here F1's lap with p3's
// bank easing from 60° to 0 and a 40° edge on its right side only: the gate the search took tilted 14.55° at the road and its dummies 15.6°, over the check's bar.
// AMENDED BY NAME (2026-11-03, the rounded bank corners): rounded, that 60° exit leans out sooner, so at the first station flat at the road the dummies were flat
// too (13.06° and 14.11°) and the row went blind to a search at the road. Now 66° and a 60° edge: the road-level search takes s 784 (dummies 16.6°), the dummies'
// search s 790; and the row first checks that the two searches still differ here, so a change to the road that blinds it again fails here, not silently.
test('the sector gate the search picks passes the export\'s own gate check (its dummies, as checkMarkers reads them), on a bank exit with a one-sided edge', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(FX, 'F1-bowl-default-lap-closed.core2.json'), 'utf8')), ch = raw.pieces[2].channels, n = ch.phi.length;
  const ease = (i) => (i < 2 ? 1 : i >= n - 2 ? 0 : 1 - (i - 1) / (n - 3)), mid = (i) => (i < 2 || i >= n - 2 ? 0 : 1);
  raw.pieces[1].channels.phi = raw.pieces[1].channels.phi.map((_, i, a) => (i >= a.length - 2 ? 66 * DEG : 0));   // the bank meets the joint at 66°
  Object.assign(ch, { phi: ch.phi.map((_, i) => 66 * DEG * ease(i)), e: ch.phi.map(() => 0), er: ch.phi.map((_, i) => 60 * mid(i)) });
  const doc = D.parse(JSON.stringify(raw)), segs = AD.toSegments(doc), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }, lift = (q) => AD.offsetPath(doc, segs, q);
  const L = startLayout(segs, lift, start), p = lift(require('../src/geom/path.js').buildPath(segs, { step: 2, closed: true, start }));   // the export's own path (fromwords.js)
  assert.ok(L.sectors.every((a) => !a.omitted), 'both gates are placed');
  const st = segStarts(p, segs), sL = Lay.anchorS(L.line, segs, st), atRoad = Lay.lapSectors(p, segs, sL, { height: 0 });
  assert.notDeepEqual(atRoad, L.sectors, 'the row sees the difference: a search at the road takes another gate on this road than a search at the dummies');
  const mk = require('../src/markers/index.js').placeAll(L, p, segs, { paintMaterial: 0, lane: null });
  const scene = { root: { type: 'dummy', name: 'root', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: mk.nodes } };
  const gate = require('../src/export/markers.js').checkMarkers(scene).checks.find((c) => c.id === 'gate-tilt');
  assert.ok(gate.ok, gate.problems.join(' | '));
  // spawnsLayout (a start placed by hand) asks lapSectors with no options: its default height must be the markers' own, so it picks the same gates
  const starts = segStarts(p, segs);
  assert.deepEqual(Lay.lapSectors(p, segs, Lay.anchorS(L.line, segs, starts)), L.sectors);
});
