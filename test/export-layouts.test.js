// export-layouts.test.js: node --test test/export-layouts.test.js. A project of two layouts exports as ONE track folder
// with two layout sets, laid out as AC's multi-layout tracks are (src/export/layouts.js names the tracks it was read
// from), and a layout's pit lane reaches the kn5 with its pit boxes on it, the self-check ON throughout.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/doc/index.js');
const Pr = require('../src/doc/project.js');
const { exportProject } = require('../src/export/layouts.js');
const { buildExport } = require('../src/export/fromwords.js');
const { readKn5 } = require('../tools/kn5.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-layouts-')); made.push(d); return d; };
const kmh = (v) => v / 3.6;

/** A stadium that closes by symmetry: straight, 180° of flat turn, straight, 180° of flat turn. */
function stadium(name, straightM) {
  let d = D.createDoc(name);
  for (const [w, o] of [['straight', { handles: { length: straightM } }], ['tight', { font: 'flat' }], ['tight', { font: 'flat' }], ['straight', { handles: { length: straightM } }], ['tight', { font: 'flat' }], ['tight', { font: 'flat' }]]) d = D.appendWord(d, w, { ...o, speed: kmh(200) });
  return D.checkDoc({ ...d, closed: true });
}
const withLane = (d) => D.setPitLane(d, { side: 'R', leave: { word: 'w1', along: 60 }, rejoin: { word: 'w1', along: 540 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80 });

test('a pit lane reaches the export: its cells in the kn5, the pit boxes on it, the self-check ON', () => {
  const b = buildExport(withLane(stadium('Lane', 600)));
  assert.ok(!b.warnings.some((w) => /NOT checked/.test(w)), 'selfCheck on');
  assert.ok(b.pitLane && b.pitLane.path.lengthM > 400);
  const dir = tmp(), f = path.join(dir, 'x.kn5'); fs.writeFileSync(f, b.kn5);
  const back = readKn5(f), lane = back.meshes.filter((m) => /^1ROAD_PIT_/.test(m.name));
  assert.ok(lane.length >= 3, `lane cells in the kn5: ${lane.map((m) => m.name)}`);
  assert.ok(lane.every((m) => m.material === 't180b_road'), 'the lane wears the road\'s material, so it is drivable road');
  const pits = b.markers.placed.filter((m) => m.kind === 'pit');
  assert.ok(pits.length > 0 && pits.every((m) => m.onLane), 'every pit box is on the lane');
  for (const m of pits) assert.ok(back.dummies.some((d) => d.name === m.name), `${m.name} in the kn5`);
});

test('two layouts export to two layout sets in one folder, as AC lays layouts out', () => {
  const p = Pr.addLayout(Pr.addLayout(Pr.createProject('Two Ways'), 'long', withLane(stadium('Long', 600))), 'short', stadium('Short', 300));
  const out = tmp(), r = exportProject(p, { outDir: out });
  assert.equal(r.folder, 't180b_two_ways');
  const has = (rel) => fs.existsSync(path.join(r.dir, rel));
  for (const L of ['long', 'short']) {
    for (const rel of [`t180b_two_ways_${L}.kn5`, `models_${L}.ini`, `${L}/data/surfaces.ini`, `${L}/data/map.ini`, `${L}/map.png`, `${L}/ai/fast_lane.ai`,
      `ui/${L}/ui_track.json`, `ui/${L}/preview.png`, `ui/${L}/outline.png`]) assert.ok(has(rel), `${rel} written`);
    assert.match(fs.readFileSync(path.join(r.dir, `models_${L}.ini`), 'utf8'), new RegExp(`FILE=t180b_two_ways_${L}\\.kn5`));
    const pits = readKn5(path.join(r.dir, `t180b_two_ways_${L}.kn5`)).dummies.filter((d) => /^AC_PIT_\d+$/.test(d.name)).length;
    assert.equal(+JSON.parse(fs.readFileSync(path.join(r.dir, `ui/${L}/ui_track.json`), 'utf8')).pitboxes, pits);
  }
  assert.ok(!has('models.ini') && !has('data') && !has('ui/ui_track.json'), 'no no-layout set beside the layouts');
  const k = (L) => readKn5(path.join(r.dir, `t180b_two_ways_${L}.kn5`)).meshes.some((m) => /^1ROAD_PIT_/.test(m.name));
  assert.deepEqual([k('long'), k('short')], [true, false], 'each layout is its own model: the lane is only in the layout that has one');
  assert.notEqual(r.layouts[0].kn5Sha, r.layouts[1].kn5Sha);
  const marker = JSON.parse(fs.readFileSync(path.join(r.dir, '.t180b-builder.json'), 'utf8'));
  assert.deepEqual(marker.files.slice().sort(), r.files.slice().sort());
});

test('one red layout writes nothing at all, and a folder the builder did not write is refused untouched', () => {
  const bad = D.setPitLane(stadium('Bad', 600), { side: 'R', leave: { word: 'w1', along: 60 }, rejoin: { word: 'w9', along: 0 } });
  const p = Pr.addLayout(Pr.addLayout(Pr.createProject('Half'), 'a', stadium('A', 600)), 'b', bad), out = tmp();
  assert.throws(() => exportProject(p, { outDir: out }), (e) => e.code === 'PIT_LANE' && /layout b/.test(e.message));
  assert.deepEqual(fs.readdirSync(out), []);
  fs.mkdirSync(path.join(out, 't180b_theirs')); fs.writeFileSync(path.join(out, 't180b_theirs', 'keep.txt'), 'x');
  assert.throws(() => exportProject(Pr.addLayout(Pr.createProject('Theirs'), 'a', stadium('A', 600)), { outDir: out }), (e) => e.code === 'NOT_OURS');
  assert.deepEqual(fs.readdirSync(path.join(out, 't180b_theirs')), ['keep.txt']);
});

test('a lane laid across another pass of the road is RED: the lane\'s findings refuse the export', () => {
  let d = D.createDoc('Cross');
  for (const [w, o] of [['straight', { handles: { length: 600 } }], ['tight', { font: 'flat', handles: { length: 150 } }], ['tight', { font: 'flat', handles: { length: 150 } }],
    ['straight', { handles: { length: 600 } }], ['tight', { font: 'flat', handles: { length: 150 } }], ['tight', { font: 'flat', handles: { length: 150 } }]]) d = D.appendWord(d, w, { ...o, speed: kmh(200) });
  // the straights are 181 m apart (centre to centre, measured): a lane on the inside, 167 m out, lies on the far straight
  d = D.setPitLane(D.checkDoc({ ...d, closed: true }), { side: 'L', leave: { word: 'w1', along: 60 }, rejoin: { word: 'w1', along: 540 }, offsetM: 167, width: 8, divergeM: 80, mergeM: 80 });
  assert.throws(() => buildExport(d), (e) => e.code === 'RED' && e.red.some((x) => /pit lane/.test(x.detail || '')));
});
