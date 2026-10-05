// export_test_unfinished.test.js: node --test test/export_test_unfinished.test.js
// D243a, the TEST export of an UNFINISHED track (the keeper: "it should allow to export even without it being completed"), src/export/fromwords.js opts.test:
// an OPEN track exports into a t180b_*_test folder named "(test, unfinished)", its reds are listed and do not block, the AI line is open, point-to-point
// gates AC_AB_START/FINISH are placed, and the road ends in a named wall (1WALL_T180_END). A NORMAL export of an open track still refuses, unchanged.
// The track used is fixture F7 (a hill, a core jump, the landing road; OPEN). Since D243 its jump is not red (a core flight's gap is intended), so
// the row that needs a red plants a real hole in its landing road.
// Every folder is written under the OS temp directory and removed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/core/document.js');
const AD = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const { startLayout } = require('../app/core/coreshell.js');
const { readKn5 } = require('../tools/kn5.cjs');
const { generateAiLine, encodeAiLine, readAiLine } = require('../src/export/ailine.js');
const pt = require('../scripts/platform_test.js');

const F7 = D.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'F7-hill-then-jump.core2.json'), 'utf8'));
const segs = AD.toSegments(F7), lift = (q) => AD.offsetPath(F7, segs, q), start = { pos: F7.start.pos.slice(), theta: F7.start.heading, p: F7.start.pitch };
const meta = { name: 'F7 test', description: 'test', via: 'test', liftPath: lift, start };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 't180b-test-unfinished-'));

let built = null;
function testExport() {
  if (built) return built;
  const dir = tmp();
  const r = FW.exportSegments(segs, meta, { outDir: dir, variant: 'block', markers: startLayout(segs, lift, start, { open: true }), test: true });
  const f = r.folders[0];
  built = { dir, r, f, kn5: readKn5(path.join(f.dir, `${path.basename(f.dir)}.kn5`)), ai: fs.readFileSync(path.join(f.dir, 'ai', 'fast_lane.ai')), ui: JSON.parse(fs.readFileSync(path.join(f.dir, 'ui', 'ui_track.json'), 'utf8')) };
  return built;
}
test.after(() => { if (built) fs.rmSync(built.dir, { recursive: true, force: true }); });

test('a NORMAL export of an open track still refuses (unchanged): NOT_CLOSED, nothing written', () => {
  const dir = tmp();
  try {
    assert.throws(() => FW.exportSegments(segs, meta, { outDir: dir, variant: 'block' }), (e) => e.code === 'NOT_CLOSED');
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the TEST export of the same open track writes a folder marked unfinished, in name and folder', () => {
  const b = testExport();
  assert.match(path.basename(b.f.dir), /^t180b_f7_test_test$/);   // folderName("F7 test") + the test suffix
  assert.equal(b.ui.name, 'F7 test (test, unfinished)');
  assert.ok(b.f.files.includes('t180b_TEST_UNFINISHED.txt'), b.f.files.join(', '));
});

// D243 changed this row's red: F7's jump was red gap-in-road until D243 made a core flight's gap intended, so the red is now a real HOLE planted in
// F7's landing road (a road segment made a gap), which must stay red; the rule the row tests, a red listed and not blocking, is unchanged
test('in TEST mode a red is LISTED and does not block: a hole\'s gap-in-road red is in the TEST file and the warnings', () => {
  const holed = segs.map((g) => ({ ...g })), i = holed.findIndex((g, k) => k > 0 && holed[k - 1].part === 'land' && g.part === 'body');
  assert.ok(i > 0, 'control: F7 has road after its landing ramp to hole'); holed.splice(i, 1, { ...holed[i], kind: 'gap', part: 'gap', profile: null });
  const dir = tmp();
  try {
    const r = FW.exportSegments(holed, meta, { outDir: dir, variant: 'block', markers: startLayout(holed, lift, start, { open: true }), test: true });
    assert.match(fs.readFileSync(path.join(r.folders[0].dir, 't180b_TEST_UNFINISHED.txt'), 'utf8'), /gap-in-road/);
    assert.ok(r.warnings.some((w) => /TEST EXPORT \(unfinished\): \d+ red finding\(s\) NOT blocking/.test(w)), r.warnings.join(' | '));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the TEST folder carries point-to-point gates and the named end wall in its kn5', () => {
  const b = testExport(), names = b.kn5.dummies.map((d) => d.name);
  for (const nm of ['AC_AB_START_L', 'AC_AB_START_R', 'AC_AB_FINISH_L', 'AC_AB_FINISH_R']) assert.ok(names.includes(nm), `${nm} missing: ${names.join(', ')}`);
  assert.ok(b.kn5.meshes.some((m) => /^1WALL_T180_END/.test(m.name)), 'no 1WALL_T180_END mesh');
  // the finish gate sits before the end (a run-off), not past it: its distance to the AI line's last point is at least 100 m on this 400 m road
  const n = b.ai.readInt32LE(4), last = [b.ai.readFloatLE(16 + (n - 1) * 20), b.ai.readFloatLE(20 + (n - 1) * 20), b.ai.readFloatLE(24 + (n - 1) * 20)];
  const fin = b.kn5.dummies.find((d) => d.name === 'AC_AB_FINISH_L').pos;
  assert.ok(Math.hypot(fin[0] - last[0], fin[2] - last[2]) >= 90, `finish ${Math.hypot(fin[0] - last[0], fin[2] - last[2])} m from the end`);
});

test('the TEST folder\'s AI line is OPEN and reads back', () => {
  const b = testExport(), line = readAiLine(b.ai), P = line.points, n = P.length;
  const gap = Math.hypot(P[n - 1].pos[0] - P[0].pos[0], P[n - 1].pos[1] - P[0].pos[1], P[n - 1].pos[2] - P[0].pos[2]);
  assert.ok(gap > 100, `the open line's ends are ${gap} m apart`);
  assert.equal(line.extra[n - 1].length, 0);   // the last point has no next
});

test('an open AI line is written only when asked for: the same line without open still refuses NOT_CLOSED', () => {
  const T = pt.buildTrack(), half = Math.floor(T.dsn.stations.length / 2);
  const dsn = { ...T.dsn, stations: T.dsn.stations.slice(0, half) }, secs = T.secs.slice(0, half);
  assert.throws(() => encodeAiLine(generateAiLine(dsn, secs, { mode: 'floor' })), (e) => e.code === 'NOT_CLOSED');
  const open = generateAiLine(dsn, secs, { mode: 'floor', open: true });
  assert.equal(readAiLine(encodeAiLine(open)).points.length, open.points.length);
});
