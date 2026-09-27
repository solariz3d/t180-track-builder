#!/usr/bin/env node
// build_platform_test.js: milestone 1's platform test (docs/ARCHITECTURE.md §10.1) as two installable AC track folders.
//
//   node scripts/build_platform_test.js                 build into out/ (git-ignored)
//   node scripts/build_platform_test.js --install       build, then copy into <AC>/content/tracks/
//   node scripts/build_platform_test.js --install --ac "<assettocorsa dir>"
//
// It glues three packets together: the scene from scripts/platform_test.js, the kn5 from src/export/kn5write.js, and
// every other file from src/export/trackfiles.js. The §5c marker checks (src/export/markers.js) and the scene validator
// (src/export/scene.js) run first; a red check stops the build before anything is written.
//
// THE TWO VARIANTS ARE TWO FOLDERS, NOT TWO LAYOUTS, and this is why. The registered soft-road prediction (FINDINGS §4c,
// verbatim in ARCHITECTURE §10.1) compares the same geometry with and without the soft-collision block in
// data/surfaces.ini. All eleven T-180 tracks that carry the block keep it in the track ROOT's data/surfaces.ini. As
// layouts, the block would sit in a layout's own data/ folder, and whether CSP reads [COLLISION_PARAMS_...] from a
// layout's surfaces.ini is unverified here. A "no difference" result could then mean either "the block does nothing" or
// "the block was never read", and the prediction could not be scored. As folders, each variant is an ordinary track
// shaped like the eleven that work. The geometry stays identical because both folders get the SAME kn5 bytes (checked
// below by sha256).
//   t180b_platform_test          WITH the block (the T-180 default)
//   t180b_platform_test_noblock  WITHOUT it
//
// INSTALL SAFETY (the overnight plan's Rule 1: never overwrite or delete anything in the AC install):
//   · it only ever writes to content/tracks/t180b_* folders; any other name is refused before touching the disk;
//   · a folder we wrote carries `.t180b-builder.json`. A target that exists WITHOUT that file is refused, untouched;
//   · on a folder we own, only the files we write are replaced; nothing is deleted.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { checkMarkers } = require('../src/export/markers.js');
const trackfiles = require('../src/export/trackfiles.js');

const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'out');
const MARKER_FILE = '.t180b-builder.json';
const DEFAULT_AC = 'G:\\SteamLibrary\\steamapps\\common\\assettocorsa';   // the path docs/FINDINGS.md:283 already names
const KN5_NAME = 't180b_platform_test.kn5';
const VARIANTS = [
  { folder: 't180b_platform_test', softCollision: true, title: 'T-180B Platform Test (soft road)' },
  { folder: 't180b_platform_test_noblock', softCollision: false, title: 'T-180B Platform Test (no soft-road block)' },
];
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** Find the kn5 writer's entry point without guessing silently: a missing or renamed export is a loud error. */
function loadKn5Writer() {
  let mod;
  try { mod = require('../src/export/kn5write.js'); } catch (e) { throw new Error(`src/export/kn5write.js could not be loaded: ${e.message}`); }
  const fn = ['writeKn5', 'write', 'encodeKn5'].map((k) => mod[k]).find((f) => typeof f === 'function');
  if (!fn) throw new Error(`src/export/kn5write.js exports none of writeKn5 / write / encodeKn5 (it exports: ${Object.keys(mod).join(', ') || 'nothing'})`);
  return fn;
}

function build() {
  const pt = require('./platform_test.js');
  const { scene, dsn } = pt.buildTrack();
  try { require('../src/export/scene.js').validateScene(scene); } catch (e) { if (e.name === 'SceneError') throw e; if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  const mc = checkMarkers(scene);
  const red = mc.checks.filter((c) => !c.ok);
  if (red.length) throw new Error('marker checks are RED, nothing written:\n' + red.map((c) => `  ${c.id}: ${c.problems.join('; ')}`).join('\n'));
  const kn5 = Buffer.from(loadKn5Writer()(scene));
  // self-test (ARCHITECTURE §6): our own reader must read the kn5 back
  const tmp = path.join(OUT, '.readback.kn5');
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(tmp, kn5);
  let back; try { back = require('../tools/kn5.cjs').readKn5(tmp); } finally { fs.rmSync(tmp, { force: true }); }
  const built = [];
  for (const v of VARIANTS) {
    const dir = path.join(OUT, v.folder);
    fs.rmSync(dir, { recursive: true, force: true });   // out/ is ours alone
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, KN5_NAME), kn5);
    const desc = { name: v.title, description: 'Milestone 1 platform test: a half-pipe, a wall-ride above 90 degrees and one small jump. Built by t180-track-builder.', length: dsn.length, run: 'counterclockwise' /* C's loop turns left only (hand-back p-d165-geometry-C §1) */, tags: ['t180', 'original', 'test'], author: 't180-track-builder', version: '0.1' };
    const files = [KN5_NAME, ...trackfiles.writeTrackFiles(dir, scene, { softCollision: v.softCollision, kn5Files: [KN5_NAME], desc })];
    built.push({ ...v, dir, files });
  }
  const shas = built.map((b) => sha256(fs.readFileSync(path.join(b.dir, KN5_NAME))));
  if (new Set(shas).size !== 1) throw new Error('the two variants carry different kn5 bytes; the geometry must be identical');
  return { built, kn5Sha: shas[0], kn5Bytes: kn5.length, readback: { version: back.version, meshes: back.meshes.length, dummies: back.dummies.map((d) => d.name) }, markers: mc };
}

/** Copy one built folder into <ac>/content/tracks/<folder>, under the safety rules above. Returns what it did. */
function installOne(b, acRoot) {
  if (!/^t180b_[a-z0-9_]+$/.test(b.folder)) throw new Error(`refusing to install "${b.folder}": only t180b_* folders may be written`);
  const tracks = path.join(acRoot, 'content', 'tracks');
  if (!fs.existsSync(tracks)) throw new Error(`no content/tracks under ${acRoot}`);
  const target = path.join(tracks, b.folder);
  if (path.dirname(target) !== tracks) throw new Error(`refusing: ${target} is not directly under ${tracks}`);
  const markerPath = path.join(target, MARKER_FILE);
  const existed = fs.existsSync(target);
  if (existed && !fs.existsSync(markerPath)) throw new Error(`refusing: ${target} exists and was not written by t180-track-builder (no ${MARKER_FILE}); nothing touched`);
  for (const rel of b.files) {
    const dst = path.join(target, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(b.dir, rel), dst);
  }
  fs.writeFileSync(markerPath, JSON.stringify({ tool: 't180-track-builder', script: 'scripts/build_platform_test.js', written: new Date().toISOString(), files: b.files }, null, 2) + '\n');
  return { target, existed, files: b.files.length };
}

function main(argv) {
  const install = argv.includes('--install');
  const ai = argv.indexOf('--ac');
  const acRoot = ai >= 0 ? argv[ai + 1] : (process.env.AC_ROOT || DEFAULT_AC);
  const r = build();
  console.log(`built ${r.built.length} folders in ${path.relative(REPO, OUT)}/, kn5 ${r.kn5Bytes} B sha256 ${r.kn5Sha.slice(0, 16)}… (identical in both)`);
  console.log(`  read back by tools/kn5.cjs: version ${r.readback.version}, ${r.readback.meshes} meshes, markers ${r.readback.dummies.join(' ')}`);
  console.log(`  marker checks: ${r.markers.checks.map((c) => `${c.id} ${c.ok ? 'ok' : 'RED'}`).join(', ')}`);
  for (const b of r.built) console.log(`  ${b.folder}: ${b.files.length} files, surfaces.ini ${b.softCollision ? 'WITH' : 'WITHOUT'} the soft-collision block`);
  if (install) for (const b of r.built) { const i = installOne(b, acRoot); console.log(`installed ${i.target} (${i.files} files, ${i.existed ? 'updated our own folder' : 'new folder'})`); }
}

module.exports = { build, installOne, VARIANTS, MARKER_FILE, KN5_NAME };
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`build_platform_test: ${e.message}`); process.exitCode = 1; }
}
