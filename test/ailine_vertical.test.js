// ailine_vertical.test.js: node --test test/ailine_vertical.test.js
// A road that goes vertical has no AI line AC can load (2026-11-01: a lap falling through 90° crashed the game in AISpline::calculateNormals, which
// recomputes each point's normal from the tangent crossed with world up and divides by its length). src/export/ailine.js generateAiLine refuses such a
// line by name (VERTICAL_TANGENT) instead of writing a camber of ±π, and src/export/fromwords.js finishes the export without ai/fast_lane.ai and says so.
// An ordinary track's line is byte for byte what it was. Every folder is written under the OS temp directory and removed.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { generateAiLine, encodeAiLine, AiLineError } = require('../src/export/ailine.js');
const D = require('../src/core/document.js'), AD = require('../src/core/adapter.js'), FW = require('../src/export/fromwords.js');
const { startLayout } = require('../app/core/coreshell.js');
const { exportWarningsWords } = require('../app/core/exportwords.js');
const pt = require('../scripts/platform_test.js');

const DEG = Math.PI / 180;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// A design that climbs a vertical circle of radius R from level up to `topDeg` of pitch, 1 m stations, a flat 3-point section across (left = +z).
function climb(topDeg, R = 60) {
  const n = Math.max(3, Math.round((R * topDeg * DEG) / 1) + 1), stations = [], secs = [];
  for (let i = 0; i < n; i++) {
    const a = ((topDeg * DEG) * i) / (n - 1), pos = [R * Math.sin(a), R * (1 - Math.cos(a)), 0], nrm = [-Math.sin(a), Math.cos(a), 0];
    stations.push({ s: R * a, kappa: 0, gapNext: false });
    secs.push({ P: [[pos[0], pos[1], -5], pos, [pos[0], pos[1], 5]], N: [nrm, nrm, nrm], font: [0, 0] });
  }
  return { dsn: { stations, length: R * topDeg * DEG }, secs };
}

test('a line that reaches vertical is refused by name, VERTICAL_TANGENT, not written with a camber of ±π', () => {
  const { dsn, secs } = climb(100);
  assert.throws(() => generateAiLine(dsn, secs, { mode: 'floor', every: 1, open: true }), (e) => e instanceof AiLineError && e.code === 'VERTICAL_TANGENT' && /within 6° of vertical/.test(e.message));
});

test('a climb to 86° (4° short of vertical, inside the 6° that AC cannot take) is refused too', () => {
  const { dsn, secs } = climb(86);
  assert.throws(() => generateAiLine(dsn, secs, { mode: 'floor', every: 1, open: true }), (e) => e.code === 'VERTICAL_TANGENT');
});

test('the edge: a climb to 80° (10° short of vertical) still makes a line, with every camber finite and well inside ±π/2', () => {
  const { dsn, secs } = climb(80);
  const line = generateAiLine(dsn, secs, { mode: 'floor', every: 1, open: true });
  assert.ok(line.extra.every((e) => Number.isFinite(e.camber) && Math.abs(e.camber) < Math.PI / 2), 'every camber finite and under 90°');
});

// pinned on 8b573dd, before the change: the platform test's two lines, byte for byte
const PINNED = { floor: 'bd83dfe83b97972cbcaa29c9c0322b90f154dcd230470c80bb9725e99d38cc77', wall: '039ab97bcd548a8c6978674f4c0fb6eb688db8938c7edabd1e3cbb3f3aee646b' };
test('an ordinary track\'s AI line is byte-identical to before (the platform test, floor and wall lines)', () => {
  const T = pt.buildTrack();
  assert.equal(sha(encodeAiLine(generateAiLine(T.dsn, T.secs, { mode: 'floor' }))), PINNED.floor);
  assert.equal(sha(encodeAiLine(generateAiLine(T.dsn, T.secs, { mode: 'wall' }))), PINNED.wall);
});

// An OPEN track that climbs past vertical: a level straight, then a piece that pitches up 100° (the test export, as the page's own button makes it).
function verticalDoc() {
  const F1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'F1-bowl-default-lap-closed.core2.json'), 'utf8'));
  const p1 = F1.pieces[0], n = p1.channels.kv.length, up = (110 * DEG) / (p1.length - 40);   // the pitch rate rises from 0 at the joint (it must meet smoothly)
  const flat = { ...p1, channels: { ...p1.channels, kh: p1.channels.kh.map(() => 0) } };
  return D.parse(JSON.stringify({ ...F1, closed: false, nextId: 3, pieces: [flat, { ...flat, id: 'p2', channels: { ...flat.channels, kv: Array.from({ length: n }, (_, i) => (i < 2 ? 0 : up)) } }] }));
}

test('the export of a track that goes vertical finishes WITHOUT ai/fast_lane.ai, and the banner says why in plain words', () => {
  const doc = verticalDoc(), segs = AD.toSegments(doc), lift = (q) => AD.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-vertical-'));
  try {
    const r = FW.exportSegments(segs, { name: 'vertical', liftPath: lift, start }, { outDir: dir, variant: 'block', markers: startLayout(segs, lift, start, { open: true }), test: true });
    const f = r.folders[0];
    assert.ok(!f.files.includes('ai/fast_lane.ai'), `the files written: ${f.files.join(', ')}`);
    assert.ok(!fs.existsSync(path.join(f.dir, 'ai', 'fast_lane.ai')), 'no fast_lane.ai on disk');
    assert.ok(f.files.some((x) => /\.kn5$/.test(x)), 'the kn5 is written');
    assert.equal(r.aiSha, null); assert.equal(r.aiLine, null);
    assert.ok(exportWarningsWords(r.warnings).includes('this track goes vertical, so it has no AI line; it drives and times normally'), exportWarningsWords(r.warnings).join(' | '));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a layout folder of a track that goes vertical lists no AI line (src/export/layouts.js layoutSet)', () => {
  const doc = verticalDoc(), segs = AD.toSegments(doc), lift = (q) => AD.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const b = FW.buildFromSegments(segs, { name: 'vertical', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: true }), test: true });
  const { files } = require('../src/export/layouts.js').layoutSet('t180b_vertical', [{ layout: 'main', name: 'vertical', main: true, b }]);
  assert.ok(Object.keys(files).length > 0 && !Object.keys(files).some((k) => /fast_lane\.ai$/.test(k)), Object.keys(files).join(', '));
});
