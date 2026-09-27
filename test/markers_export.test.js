// D171: the markers layout through the export (src/export/fromwords.js opts.markers): a custom layout lands in the kn5,
// the paint is written as visual meshes, pitboxes follows the real count, and a red layout refuses with its check named.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/doc/index.js');
const { closeLoop } = require('../src/doc/connector.js');
const { buildPath } = require('../src/geom/index.js');
const { exportTrack } = require('../src/export/fromwords.js');
const M = require('../src/markers/index.js');
const { readKn5 } = require('../tools/kn5.cjs');

const kmh = (v) => v / 3.6;   // every export here runs with the self-check ON (the default)
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-markers-test-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

let d = D.createDoc('Marker Loop');
for (const w of ['straight', 'straight', 'tight', 'straight', 'tight']) d = D.appendWord(d, w, { speed: kmh(200) });
d = D.editWord(d, 'w3', { handles: { length: 50 } });
const c = closeLoop(d);
const LOOP = c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
/** The default layout for the loop, made the way the export makes its path. */
function layoutFor(doc) {
  const segs = D.resolve({ ...doc, closed: false }).segments, p = buildPath(segs, { step: 2, closed: true });
  return M.defaultLayout(p, segs);
}

test('a custom layout (a 3-abreast grid of 6, 3 pit boxes, sectors) is what the kn5 carries, and pitboxes counts it', () => {
  const base = layoutFor(LOOP);
  const layout = { ...base, grid: { ...base.grid, pattern: '3-abreast', count: 6, rowGapM: 12, colGapM: 5 }, pits: { ...base.pits, count: 3 },
    sectors: [{ word: 'w3', along: 20 }, { word: 'w5', along: 20 }] };
  const out = tmp(), r = exportTrack(LOOP, { outDir: out, markers: layout }), f = r.folders[0];
  const names = readKn5(path.join(f.dir, `${f.folder}.kn5`)).dummies.map((x) => x.name).filter((n) => /^AC_/.test(n)).sort();
  assert.deepStrictEqual(names, ['AC_HOTLAP_START_0', 'AC_PIT_0', 'AC_PIT_1', 'AC_PIT_2', 'AC_START_0', 'AC_START_1', 'AC_START_2', 'AC_START_3', 'AC_START_4', 'AC_START_5',
    'AC_TIME_0_L', 'AC_TIME_0_R', 'AC_TIME_1_L', 'AC_TIME_1_R', 'AC_TIME_2_L', 'AC_TIME_2_R']);
  const ui = JSON.parse(fs.readFileSync(path.join(f.dir, 'ui', 'ui_track.json'), 'utf8'));
  assert.strictEqual(+ui.pitboxes, 3);
});

test('the paint is written into the kn5 as visual meshes, one per mark, none of them physics', () => {
  const out = tmp(), r = exportTrack(LOOP, { outDir: out }), f = r.folders[0];
  const meshes = readKn5(path.join(f.dir, `${f.folder}.kn5`)).meshes.map((m) => m.name).filter((n) => /^PAINT_/.test(n)).sort();
  assert.deepStrictEqual(meshes, ['PAINT_GRID_0', 'PAINT_GRID_1', 'PAINT_GRID_2', 'PAINT_GRID_3', 'PAINT_PIT_0', 'PAINT_PIT_1', 'PAINT_START_LINE']);
  assert.ok(meshes.every((n) => !/^\d/.test(n)), 'a digit-led name would be physics in AC (ARCHITECTURE §6)');
  assert.deepStrictEqual(r.paint.map((p) => p.name).sort(), meshes);
});

test('a red layout refuses the export, names the check, and writes nothing', () => {
  const out = tmp(), layout = { ...layoutFor(LOOP), height: 3 };
  assert.throws(() => exportTrack(LOOP, { outDir: out, markers: layout }), (e) => e.code === 'MARKERS' && /height-and-heading: .*3\.00 m above the surface \(1–2 m required\)/.test(e.message));
  assert.deepStrictEqual(fs.readdirSync(out), []);
});

test('a layout whose word is gone refuses the export: anchors', () => {
  const out = tmp(), layout = { ...layoutFor(LOOP), pits: { ...layoutFor(LOOP).pits, at: { word: 'w99', along: 0 } } };
  assert.throws(() => exportTrack(LOOP, { outDir: out, markers: layout }), (e) => e.code === 'MARKERS' && /anchors: the pit boxes was placed on word w99/.test(e.message));
});
