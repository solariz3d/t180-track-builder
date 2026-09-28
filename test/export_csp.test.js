// Tests for CSP's extended-physics switch in the export (ARCHITECTURE §6: the soft-collision block "plus CSP's
// WAV_PITCH=extended-0 opt-in with a CSP-only warning"; R1, docs/research/04_ac_physics_drivability.md §2): the "T-180 track"
// toggle ON writes the block AND the switch and says the CSP-only warning; OFF writes neither; the soft-road control
// (noblock) and the platform test's two variants differ by the block ALONE, so FINDINGS §4c's prediction tests one thing.
// Run: node --test --test-concurrency=4 test/export_csp.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../src/export/trackfiles.js');
const D = require('../src/doc/index.js');
const { closeLoop } = require('../src/doc/connector.js');
const { exportTrack } = require('../src/export/fromwords.js');

const REPO = path.resolve(__dirname, '..'), made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-csp-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const SWITCH = /^WAV_PITCH=extended-0$/m, BLOCK = /^\[COLLISION_PARAMS_\.\.\.\]$/m;
// The ripple (p-d182-ripple-E): the sample's words are named explicitly (the pre-D182 words), because this file tests
// that a closed loop EXPORTS, not what the defaults are. Under the measured vocabulary a 50 m tight on a 31 m road folds.
const { appendOld } = require('./pre_d182_words.js');
const kmh = (v) => v / 3.6;
function sample() {
  let d = D.createDoc('Csp Loop');
  for (const w of ['straight', 'straight', 'tight', 'straight', 'tight']) d = appendOld(D, d, w, { speed: kmh(200) });
  d = D.editWord(d, 'w3', { handles: { length: 50 } });
  const c = closeLoop(d); assert.ok(c.candidates.length, c.reason);
  const doc = c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
  return doc.words.reduce((x, w) => D.editWord(x, w.id, { speed: kmh(200) }), doc);
}
let SAMPLE; const doc = () => SAMPLE || (SAMPLE = sample());
const ini = (dir) => fs.readFileSync(path.join(dir, 'data', 'surfaces.ini'), 'utf8');

test('surfaces.ini, T-180 (the default): the block AND one extended-0 surface, on SURFACE_0 keyed PIT', () => {
  const s = T.surfacesIni();
  assert.match(s, BLOCK); assert.match(s, SWITCH);
  assert.equal(s.match(/WAV_PITCH=/g).length, 1);
  const sec = s.slice(s.indexOf('[SURFACE_0]')).split('\n\n')[0];
  assert.match(sec, /^KEY=PIT$/m); assert.match(sec, SWITCH);
  assert.doesNotMatch(s, /^KEY=ROAD$/m, 'the road surface is not redefined');
});

test('surfaces.ini, "T-180 track" off: neither the block nor the switch', () => {
  const s = T.surfacesIni({ softCollision: false, extendedPhysics: false });
  assert.doesNotMatch(s, BLOCK); assert.doesNotMatch(s, SWITCH); assert.doesNotMatch(s, /\[SURFACE_/);
});

test('the soft-road control keeps the switch and differs from the T-180 file by the block alone', () => {
  const soft = T.surfacesIni(), control = T.surfacesIni({ softCollision: false });
  assert.match(control, SWITCH);
  assert.equal(soft, control + '\n' + T.SOFT_COLLISION_BLOCK);
});

test('export with "T-180 track" on (the default): the folder has both, and the CSP-only warning is in the warnings', () => {
  const r = exportTrack(doc(), { outDir: tmp() }), s = ini(r.folders[0].dir);
  assert.match(s, BLOCK); assert.match(s, SWITCH);
  assert.ok(r.warnings.includes(T.CSP_ONLY_WARNING), r.warnings.join('\n'));
  assert.match(T.CSP_ONLY_WARNING, /without Custom Shaders Patch can crash/);
});

test('export with "T-180 track" off: neither is written, and no CSP-only warning', () => {
  const r = exportTrack(doc(), { outDir: tmp(), t180: false }), s = ini(r.folders[0].dir);
  assert.doesNotMatch(s, BLOCK); assert.doesNotMatch(s, SWITCH);
  assert.ok(!r.warnings.some((w) => /^csp-only/.test(w)));
});

test('export both variants: both carry the switch, and only the block differs', () => {
  const r = exportTrack(doc(), { outDir: tmp(), variant: 'both' }), [a, b] = r.folders.map((f) => ini(f.dir));
  assert.ok([a, b].every((s) => SWITCH.test(s)));
  assert.equal(a, b + '\n' + T.SOFT_COLLISION_BLOCK);
});

test('the soft-road control is refused with "T-180 track" off (it has nothing to control for)', () => {
  assert.throws(() => exportTrack(doc(), { outDir: tmp(), t180: false, variant: 'noblock' }), (e) => e.code === 'BAD_VARIANT' && /needs "T-180 track" on/.test(e.message));
});

test('the platform test\'s two variants both set the switch, and differ by the block alone', () => {
  const top = tmp();
  const cp = (src, dst) => { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const a = path.join(src, e.name), b = path.join(dst, e.name); if (e.isDirectory()) cp(a, b); else fs.copyFileSync(a, b); } };
  for (const d of ['scripts', 'src', 'tools']) cp(path.join(REPO, d), path.join(top, d));
  const r = require(path.join(top, 'scripts/build_platform_test.js')).build(), [a, b] = r.built.map((x) => ini(x.dir));
  assert.ok(SWITCH.test(a) && SWITCH.test(b), 'both variants carry extended-0');
  assert.equal(a, b + '\n' + T.SOFT_COLLISION_BLOCK);
});
