// export_geometry.test.js: node --test test/export_geometry.test.js
// D372 (the plan's D363): Assetto Corsa keys a track's ghost and the CMRT HUD's laps by the FOLDER NAME, not by its shape, so a re-export that changes the
// shape left a ghost driving through the air (ELYSIUM, 2026-10-17). The export now writes the road's GEOMETRY HASH into its marker (.t180b-builder.json),
// and the install compares it with the previous marker's (src-tauri/src/ac.rs retire_stale_laps). Rows:
//   1  the marker carries the geometry hash, as "sha256:<64 hex>", the same as the build's own
//   2  a texture-only change (a textured floor, its set handed to the export) keeps the hash; the kn5 differs (the control)
//   3  a change of shape (both straights 20 m longer) changes the hash
//   4  the hash is the same on two builds of one track (it is a pure function of the road)
// Every folder is written under the OS temp directory and removed.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const D = require('../src/doc/index.js');
const T = require('../src/texture/index.js');
const TM = require('../src/texmaker/index.js');
const FW = require('../src/export/fromwords.js');
const { appendOld } = require('./pre_d182_words.js');

const kmh = (v) => v / 3.6, RAINBOW = TM.serialize(TM.PRESETS.rainbow);
/** export-textures.test.js's stadium; `long` adds 20 m to both its straights (so it still closes) */
function stadium(long = 0) {
  let d = D.createDoc('Geo');
  for (const [w, o] of [['straight', { handles: { length: 600 + long } }], ['tight', { font: 'flat' }], ['tight', { font: 'flat' }], ['straight', { handles: { length: 600 + long } }], ['tight', { font: 'flat' }], ['tight', { font: 'flat' }]]) d = appendOld(D, d, w, { ...o, speed: kmh(200) });
  return D.checkDoc({ ...d, closed: true });
}
const withFloor = (d) => D.editWord(d, 'w1', { textures: { floor: { make: RAINBOW, size: 64 } } });
const HASH = /^sha256:[0-9a-f]{64}$/;

test('row 1: the marker carries the geometry hash, "sha256:<64 hex>", the same as the build\'s own', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-geo-'));
  try {
    const d = stadium(), b = FW.buildExport(d), r = FW.exportTrack(d, { outDir: dir });
    assert.match(b.geometry, HASH);
    const m = JSON.parse(fs.readFileSync(path.join(r.folders[0].dir, FW.MARKER_FILE), 'utf8'));
    assert.equal(m.geometry, b.geometry, 'the marker\'s hash is the build\'s');
    assert.equal(r.geometry, b.geometry, 'and the export reports it');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('row 2: a texture-only change keeps the geometry hash; the kn5 differs (control)', () => {
  const d = stadium(), t = withFloor(d), set = T.buildTextureSet(t, {});
  const a = FW.buildExport(d), b = FW.buildExport(t, { textures: set });
  assert.ok(!Buffer.from(a.kn5).equals(Buffer.from(b.kn5)), 'control: the textured kn5 is different');
  assert.equal(b.geometry, a.geometry, 'the same road, the same hash');
});

test('row 3: a change of shape (both straights 20 m longer) changes the geometry hash', () => {
  assert.notEqual(FW.buildExport(stadium(20)).geometry, FW.buildExport(stadium()).geometry);
});

test('row 4: the hash is the same on two builds of one track', () => {
  assert.equal(FW.buildExport(stadium()).geometry, FW.buildExport(stadium()).geometry);
});
