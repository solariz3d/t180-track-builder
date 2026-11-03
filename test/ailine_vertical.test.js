// ailine_vertical.test.js: node --test test/ailine_vertical.test.js
// A road that goes through vertical (2026-11-01: a lap falling through 90° crashed AC as it loaded its AI line; AISpline::calculateNormals recomputes each
// point's direction from its neighbours, crosses it with world up and divides by that length, and one point lay 1e-6 off vertical). src/export/ailine.js
// moves such a point along the road until every tangent it touches clears 1e-4 (ELYSIUM's line, which AC loads, has 1.93e-4 at least, and does not move);
// a road that STAYS vertical cannot be cleared: VERTICAL_TANGENT, and src/export/fromwords.js finishes the export without ai/fast_lane.ai and says so.
// Every folder is written under the OS temp directory and removed.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { generateAiLine, encodeAiLine, readAiLine, AiLineError } = require('../src/export/ailine.js');
const D = require('../src/core/document.js'), AD = require('../src/core/adapter.js'), FW = require('../src/export/fromwords.js');
const { buildPath } = require('../src/geom/path.js');
const { startLayout } = require('../app/core/coreshell.js');
const { exportWarningsWords } = require('../app/core/exportwords.js');
const pt = require('../scripts/platform_test.js');

const DEG = Math.PI / 180;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// |tangent × up| of a written line, as AC reads it: from the float32 positions, to the next point, from the previous one and across both; the least
function leastUp(bytes) {
  const P = readAiLine(bytes).points.map((p) => p.pos), n = P.length;
  const h = (a, b) => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d); return Math.hypot(d[0], d[2]) / l; };
  let m = Infinity; for (let k = 1; k < n - 1; k++) m = Math.min(m, h(P[k], P[k + 1]), h(P[k - 1], P[k]), h(P[k - 1], P[k + 1]));
  return m;
}

// A design up a vertical circle of radius R, a station every `stepDeg` of pitch from 0 to topDeg, all of it turned back by `phase` radians (so a station sits
// `phase` short of vertical), with a flat 3-point section across (left = +z). An open line.
function climb(topDeg, { stepDeg = 1, R = 60, phase = 0 } = {}) {
  const stations = [], secs = [];
  for (let g = 0; g <= topDeg + 1e-9; g += stepDeg) {
    const a = g * DEG - phase, pos = [R * Math.sin(a), R * (1 - Math.cos(a)), 0], nrm = [-Math.sin(a), Math.cos(a), 0];
    stations.push({ s: R * a, kappa: 0, gapNext: false });
    secs.push({ P: [[pos[0], pos[1], -5], pos, [pos[0], pos[1], 5]], N: [nrm, nrm, nrm], font: [0, 0] });
  }
  return { dsn: { stations, length: R * topDeg * DEG }, secs };
}
const lineOf = (d) => encodeAiLine(generateAiLine(d.dsn, d.secs, { mode: 'floor', every: 3, open: true }));

test('a line through vertical (a station exactly on 90°) is written, and no tangent AC reads is nearer vertical than 1e-4', () => {
  const d = climb(120);
  assert.ok(d.dsn.stations.length > 100);
  assert.ok(leastUp(lineOf(d)) >= 1e-4, `least |t × up| ${leastUp(lineOf(d))}`);
});

test('a point 5e-5 off vertical (between the 1e-6 that crashed and the bar) is moved: the least tangent clears 1e-4', () => {
  const d = climb(120, { phase: 5e-5 });
  assert.ok(leastUp(lineOf(d)) >= 1e-4, `least |t × up| ${leastUp(lineOf(d))}`);
});

test('a road that stays vertical (a straight up) cannot be cleared: refused by name, VERTICAL_TANGENT', () => {
  const stations = [], secs = [];
  for (let i = 0; i < 60; i++) { const pos = [0, i, 0], nrm = [-1, 0, 0]; stations.push({ s: i, kappa: 0, gapNext: false }); secs.push({ P: [[0, i, -5], pos, [0, i, 5]], N: [nrm, nrm, nrm], font: [0, 0] }); }
  assert.throws(() => generateAiLine({ stations, length: 59 }, secs, { mode: 'floor', every: 3, open: true }), (e) => e instanceof AiLineError && e.code === 'VERTICAL_TANGENT');
});

test('a climb to 80° (no station near vertical) is not touched: every point stays on its own station', () => {
  const d = climb(80), moved = generateAiLine(d.dsn, d.secs, { mode: 'floor', every: 3, open: true });
  const want = d.dsn.stations.map((s, i) => i).filter((i) => i % 3 === 0).map((i) => d.secs[i].P[1]);
  assert.deepEqual(moved.points.map((p) => p.pos), want);
});

// pinned on 8b573dd, before the change: the platform test's two lines, byte for byte
const PINNED = { floor: 'bd83dfe83b97972cbcaa29c9c0322b90f154dcd230470c80bb9725e99d38cc77', wall: '039ab97bcd548a8c6978674f4c0fb6eb688db8938c7edabd1e3cbb3f3aee646b' };
test('an ordinary track\'s AI line is byte-identical to before (the platform test, floor and wall lines)', () => {
  const T = pt.buildTrack();
  assert.equal(sha(encodeAiLine(generateAiLine(T.dsn, T.secs, { mode: 'floor' }))), PINNED.floor);
  assert.equal(sha(encodeAiLine(generateAiLine(T.dsn, T.secs, { mode: 'wall' }))), PINNED.wall);
});

// ELYSIUM's loop comes within 1.93e-4 of vertical and AC loads its line: the bar must not move a point of it. The line the export makes (fromwords.js:
// aiInput on the lifted path, the floor line at the road's speed), pinned on 8b573dd, where the whole export wrote it (ely-base.txt, ai/fast_lane.ai)
// AMENDED BY NAME (2026-11-02, the roll carried through a joint, src/core/adapter.js carryOf): three of this ELYSIUM's joints roll on the same way through a
// rest, and are now carried, so the line's camber, normal and side widths move at those three stretches only (s 2128–2176, 2994–3076, 3828–3950); not one of its
// 4,600 points moves, and the vertical bar still moves nothing. It was 'edeb7e54f72f8e034d63f7a81bc72587d6617fdc8f79e3d142b9c6b6b05cd12a'.
// AMENDED BY NAME again (2026-11-03, the bank's corners rounded within each piece, adapter.js bankPlan): where this ELYSIUM's bank changed faster than the
// 3 g bar the built bank is re-laid, so the line's camber, normal and side widths move there; not one of its 4,600 points moves (checked against b865be11…'s
// line point for point, largest move 0.0000 m), and the vertical bar still moves nothing. It was 'b865be114c0cc18c32ccfa3df125367157cbe00b5be703acafa15a47012e7971'.
const ELYSIUM_AI = 'b1eafad274d5410862cbc29e57076ec79494d9ffd548badbf61c809c165b833b';
test('ELYSIUM\'s AI line (a loop through vertical that AC loads) is byte-identical to before', () => {
  const doc = D.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'), 'utf8')), segs = AD.toSegments(doc);
  const start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }, p = AD.offsetPath(doc, segs, buildPath(segs, { step: 2, closed: true, start }));
  const speeds = segs.filter((g) => g.kind === 'road').map((g) => g.speed), speedKmh = speeds.every((x) => Number.isFinite(x) && x > 0) ? Math.min(...speeds) * 3.6 : undefined;
  const { dsn, secs } = FW._internal.aiInput(segs, p);
  assert.equal(sha(encodeAiLine(generateAiLine(dsn, secs, { mode: 'floor', speedKmh, DS: 2 }))), ELYSIUM_AI);
});

// An OPEN track that climbs to vertical and STAYS there: a level straight, a piece whose pitch rate rises and falls back to 0 so it ends pointing straight up
// (the rate scaled so its pitch sums to exactly 90°), then a vertical straight. The test export, as the page's own button makes it.
function stayVerticalDoc() {
  const F1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'F1-bowl-default-lap-closed.core2.json'), 'utf8'));
  const p1 = F1.pieces[0], n = p1.channels.kv.length, flat = { ...p1, channels: { ...p1.channels, kh: p1.channels.kh.map(() => 0) } };
  const build = (scale) => D.parse(JSON.stringify({ ...F1, closed: false, nextId: 4, pieces: [flat, { ...flat, id: 'p2', channels: { ...flat.channels, kv: Array.from({ length: n }, (_, i) => (i < 2 || i >= n - 2 ? 0 : scale)) } }, { ...flat, id: 'p3' }] }));
  const pitchAt = (doc, s) => { const sm = AD.toPath(doc, { step: 2 }).path.samples.reduce((a, b) => (Math.abs(b.s - s) < Math.abs(a.s - s) ? b : a)); return Math.asin(Math.max(-1, Math.min(1, sm.T[1]))); };
  const unit = 0.005, end = 2 * p1.length;
  return build(Number(((unit * (Math.PI / 2)) / pitchAt(build(unit), end)).toFixed(9)));   // pitch is linear in the rate
}
const exportOf = (doc, dir) => { const segs = AD.toSegments(doc), lift = (q) => AD.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }; return FW.exportSegments(segs, { name: 'vertical', liftPath: lift, start }, { outDir: dir, variant: 'block', markers: startLayout(segs, lift, start, { open: true }), test: true }); };

test('the export of a track that stays vertical finishes WITHOUT ai/fast_lane.ai, and the banner says why in plain words', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-vertical-'));
  try {
    const r = exportOf(stayVerticalDoc(), dir), f = r.folders[0];
    assert.ok(!f.files.includes('ai/fast_lane.ai'), `the files written: ${f.files.join(', ')}`);
    assert.ok(!fs.existsSync(path.join(f.dir, 'ai', 'fast_lane.ai')), 'no fast_lane.ai on disk');
    assert.ok(f.files.some((x) => /\.kn5$/.test(x)), 'the kn5 is written');
    assert.equal(r.aiSha, null); assert.equal(r.aiLine, null);
    assert.ok(exportWarningsWords(r.warnings).includes('this track goes vertical, so it has no AI line; it drives and times normally'), exportWarningsWords(r.warnings).join(' | '));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a layout folder of a track that stays vertical lists no AI line (src/export/layouts.js layoutSet)', () => {
  const doc = stayVerticalDoc(), segs = AD.toSegments(doc), lift = (q) => AD.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const b = FW.buildFromSegments(segs, { name: 'vertical', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: true }), test: true });
  const { files } = require('../src/export/layouts.js').layoutSet('t180b_vertical', [{ layout: 'main', name: 'vertical', main: true, b }]);
  assert.ok(Object.keys(files).length > 0 && !Object.keys(files).some((k) => /fast_lane\.ai$/.test(k)), Object.keys(files).join(', '));
});
