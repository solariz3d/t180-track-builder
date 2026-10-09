// core_cup_fixtures.test.js: node --test test/core_cup_fixtures.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D190 seal, row 5: the nine /2 documents in test/fixtures/ (F1-F9, made at t180 c964c2d, the last code that wrote /2) render BYTE-IDENTICALLY
// through the /3 code. test/fixtures/fixtures.js is the seal's Appendix A verbatim (sha256 d24dcf49...), manifest.json its Appendix B
// (sha256 05be6acc...). "Identically" means the digests it computes: every segment the adapter emits, every path sample, every mesh, the kn5.
// AMENDED BY NAME (D196, the librarian's ruling (b)): a legacy segment whose width or r changes is now drawn as a CHORD instead of one profile at its
// middle width, so the staircase of width steps is gone. That changes three fixtures, F4 F6 F8 (segs and mesh digests; the PATH, the geometry, is
// byte-identical in all nine), and NOTHING ELSE: F1 F2 F3 F5 F7 F9 stay byte-identical to c964c2d in every digest. The seal's two files are untouched
// (fixtures.js and manifest.json keep the sha256 above); test/fixtures/manifest.d196.json records the three fixtures' digests before (c964c2d) and
// after (D196) with the measure.
// AMENDED BY NAME AGAIN (D222, the Third Place's AC export merged with D195+D196): the export now writes the kn5 the way Assetto Corsa loads it
// (world-space meshes with unique names, a txDiffuse on every material) and welds piece joins. That changes the kn5 digest of the two CLOSED
// fixtures, F1 F2, and NOTHING ELSE: their segs, path and mesh are identical to the D196 baseline, and the open fixtures have no kn5.
// test/fixtures/manifest.d222.json records F1 F2's digests before (the seal) and after (D222) with the measured kn5 change. The seal's two
// files and the D196 record stay untouched.
// AMENDED BY NAME A THIRD TIME (D230, at the keeper's word, 2026-10-04 02:22 and 02:25): every core export now carries an UNDERSIDE SKIN under every road cell
// (src/export/underskin.js) so the closed tube is enclosed and the track's underside casts shadows. That changes the kn5 digest of the two CLOSED fixtures,
// F1 F2, and NOTHING ELSE: their segs, path and mesh digests are identical to the D222 baseline, and the ROAD nodes of the exported scene are byte-identical
// (roadNodesSha256 before = after, measured by one script in both trees). test/fixtures/manifest.d230.json records F1 F2's kn5 digests before (D222) and after,
// the road-node digests, the skin count and the measured kn5 growth. The seal's two files and the D196 and D222 records stay untouched.
// AMENDED BY NAME FOR D260 (the keeper, 2026-10-06 18:31: "is the track geometry like too complex"): the export joins the road cells and the skins into chunks
// (src/export/acready.js mergeForAc), so the kn5 holds a few dozen meshes instead of one per 2 m. That changes the kn5 digest of the two CLOSED fixtures, F1 F2,
// and NOTHING ELSE: their segs, path and mesh digests are the D230 record's, and the kn5's TRIANGLE SET (every triangle's world-space vertices as float32 bits,
// winding kept, with its material) is equal before and after. test/fixtures/manifest.d260.json records F1 F2's kn5 digests before (D230) and after with the measure.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const D = require('../src/core/document.js');

const FX = path.join(__dirname, 'fixtures'), ROOT = path.join(__dirname, '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const check = (dir) => spawnSync(process.execPath, ['--max-old-space-size=4096', path.join(FX, 'fixtures.js'), ROOT, dir, '--check'], { encoding: 'utf8', timeout: 20 * 60 * 1000 });
const MANIFEST = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.json'), 'utf8'));
const AMEND = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.d196.json'), 'utf8'));
const CHANGED = ['F4-halfpipe-width-31.5-to-12-along-s', 'F6-bowl-r-brushed', 'F8-mixed-families'];
const AMEND2 = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.d222.json'), 'utf8'));
const KN5_CHANGED = ['F1-bowl-default-lap-closed', 'F2-halfpipe-default-lap-closed'];
const AMEND3 = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.d230.json'), 'utf8'));
// D258 (the free jump): F7's old jump opens as a free flight to the end of its old ramp (the ramp becomes air), so F7 renders differently; manifest.d258.json records it
const AMEND4 = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.d258.json'), 'utf8'));
const JUMP_CHANGED = ['F7-hill-then-jump'];
// D260 (the draw calls): the road cells and the skins are exported in chunks, so F1 F2's kn5 changes and nothing else; manifest.d260.json records it
const AMEND5 = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.d260.json'), 'utf8'));
// D279 (the painted pit boxes wear the road): each closed fixture's two PAINT_PIT_n move from t180b_paint to the road's t180b_road with the road's coordinates, so F1 F2's kn5 changes and nothing else; manifest.d279.json records it
const AMEND6 = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.d279.json'), 'utf8'));
/** The seal's manifest with the D196 digests put in for the three amended fixtures, and the D222 digests for the two closed ones (a deep copy). */
function amendedManifest() {
  const man = JSON.parse(JSON.stringify(MANIFEST));
  for (const [k, v] of Object.entries(AMEND.fixtures)) man.fixtures[k].render = JSON.parse(JSON.stringify(v.after_d196));
  for (const [k, v] of Object.entries(AMEND2.fixtures)) man.fixtures[k].render = JSON.parse(JSON.stringify(v.after_d222));
  for (const [k, v] of Object.entries(AMEND3.fixtures)) { const { kn5Bytes, ...digests } = v.after_d230; man.fixtures[k].render = JSON.parse(JSON.stringify(digests)); }   // kn5Bytes is the record's measure, not a digest the check computes
  for (const [k, v] of Object.entries(AMEND4.fixtures)) man.fixtures[k].render = JSON.parse(JSON.stringify(v.after_d258));   // D258
  for (const [k, v] of Object.entries(AMEND5.fixtures)) { const { kn5Bytes, ...digests } = v.after_d260; man.fixtures[k].render = JSON.parse(JSON.stringify(digests)); }   // D260
  for (const [k, v] of Object.entries(AMEND6.fixtures)) { const { kn5Bytes, ...digests } = v.after_d279; man.fixtures[k].render = JSON.parse(JSON.stringify(digests)); }   // D279
  return man;
}

test('the fixture kit is the seal\'s: fixtures.js and manifest.json carry the sha256 the seal registered (and the D196 amendment record is the one registered)', () => {
  assert.equal(sha(fs.readFileSync(path.join(FX, 'fixtures.js'))), 'd24dcf49f8826d2b366df0ea33d393445cb0828a5053419901556cce15de1352');
  assert.equal(sha(fs.readFileSync(path.join(FX, 'manifest.json'))), '05be6acc0351a7fc191b73233c7e9e92aaf10e055cfbdd71b513e7c5e940b59a');
  assert.equal(Object.keys(MANIFEST.fixtures).length, 9); assert.equal(MANIFEST.schema, 't180b.core/2');
  assert.equal(sha(fs.readFileSync(path.join(FX, 'manifest.d196.json'))), '399e008280d1e260b8277a2fd87b2fd2ae69b76e3b53df2e549f9c5ad6cabe49');
  assert.deepEqual(Object.keys(AMEND.fixtures), CHANGED);
  assert.deepEqual([...AMEND.unchanged].sort(), Object.keys(MANIFEST.fixtures).filter((k) => !CHANGED.includes(k)).sort());
  assert.equal(sha(fs.readFileSync(path.join(FX, 'manifest.d222.json'))), '1d659a956ee31a6a25243da9d45401dd7cc243abdcee60de2ca1e75f04f88024');
  assert.deepEqual(Object.keys(AMEND2.fixtures), KN5_CHANGED);
  assert.deepEqual([...AMEND2.unchanged].sort(), Object.keys(MANIFEST.fixtures).filter((k) => !KN5_CHANGED.includes(k)).sort());
  assert.equal(sha(fs.readFileSync(path.join(FX, 'manifest.d230.json'))), '8feef64205e1255eaa4ae4581a4c6392bb131e9a8f5568cd85d6ce03314cf16c');
  assert.deepEqual(Object.keys(AMEND3.fixtures), KN5_CHANGED);
  assert.deepEqual([...AMEND3.unchanged].sort(), Object.keys(MANIFEST.fixtures).filter((k) => !KN5_CHANGED.includes(k)).sort());
  assert.equal(sha(fs.readFileSync(path.join(FX, 'manifest.d258.json'))), '5b5b38e619117ab414b7cdeb196cf44a4cce873336e38c9886d69f36ddb07ae6');   // D258
  assert.deepEqual(Object.keys(AMEND4.fixtures), JUMP_CHANGED);
  assert.deepEqual([...AMEND4.unchanged].sort(), Object.keys(MANIFEST.fixtures).filter((k) => !JUMP_CHANGED.includes(k)).sort());
  assert.deepEqual(AMEND4.fixtures['F7-hill-then-jump'].before, MANIFEST.fixtures['F7-hill-then-jump'].render, 'D258: "before" is the seal\'s F7 (F7 was in no earlier amendment)');
  assert.equal(sha(fs.readFileSync(path.join(FX, 'manifest.d260.json'))), '58ce2577d0fcf5c30e7094e5e1238b2219f0108035a666fabbf0511b1715ae1f');   // D260
  assert.deepEqual(Object.keys(AMEND5.fixtures), KN5_CHANGED);
  assert.deepEqual([...AMEND5.unchanged].sort(), Object.keys(MANIFEST.fixtures).filter((k) => !KN5_CHANGED.includes(k)).sort());
  assert.equal(sha(fs.readFileSync(path.join(FX, 'manifest.d279.json'))), '544395e3d53eb61ee042d98a11e6c83134a67376dc2a9bd565393696149e131c');   // D279
  assert.deepEqual(Object.keys(AMEND6.fixtures), KN5_CHANGED);
  assert.deepEqual([...AMEND6.unchanged].sort(), Object.keys(MANIFEST.fixtures).filter((k) => !KN5_CHANGED.includes(k)).sort());
});
// CHANGED D258: F7 (the old jump, now a free flight to the end of its old ramp) differs in segs, path and mesh; the path is byte-identical in every OTHER fixture
test('row 5a (amended D196, D222, D258): against the SEAL\'s manifest (c964c2d) F4, F6, F8 differ in segs and mesh only, F1, F2 in kn5 only, F7 in segs, path and mesh, and the three others are identical', () => {
  const r = check(FX); assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /\n6 of 9 differ\n?$/);
  for (const k of JUMP_CHANGED) assert.ok(r.stdout.includes(`${k}: DIFFERS in segs, path, mesh, meshParts\n`), `${k} should differ in segs, path, mesh, meshParts:\n${r.stdout}`);
  for (const k of CHANGED) assert.ok(r.stdout.includes(`${k}: DIFFERS in segs, mesh, meshParts\n`), `${k} should differ in segs, mesh, meshParts only:\n${r.stdout}`);
  for (const k of KN5_CHANGED) assert.ok(r.stdout.includes(`${k}: DIFFERS in kn5\n`), `${k} should differ in kn5 only:\n${r.stdout}`);
  for (const k of Object.keys(MANIFEST.fixtures).filter((n) => !CHANGED.includes(n) && !KN5_CHANGED.includes(n) && !JUMP_CHANGED.includes(n))) assert.ok(r.stdout.includes(`${k}: identical`), `${k} should be byte-identical to c964c2d`);
  assert.equal((r.stdout.match(/: identical/g) || []).length, 3, r.stdout);
  assert.equal((r.stdout.match(/DIFFERS in [^\n]*path/g) || []).length, 1, 'the geometry (path) changed outside F7');
});
test('row 5a (amended D196): against the D196 baseline every fixture renders identically: "0 of 9 differ"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-cup-fx-'));
  try {
    const man = amendedManifest(); for (const m of Object.values(man.fixtures)) fs.copyFileSync(path.join(FX, m.file), path.join(dir, m.file));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
    const r = check(dir); assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\n0 of 9 differ\n?$/); assert.equal((r.stdout.match(/: identical/g) || []).length, 9, r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('row 5b (D225, /4): each fixture parsed, saved as /4 text and read again renders to the same digests (the round trip), its text is /4 and carries no edge or tube channel (seal E3c)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-cup-fx-'));
  try {
    const man = amendedManifest();
    for (const [name, m] of Object.entries(man.fixtures)) {
      const text = D.serialize(D.parse(fs.readFileSync(path.join(FX, m.file), 'utf8')));
      assert.match(text, /"schema": "t180b\.core\/4"/, `${name} is saved as /4`);
      assert.ok(!/"(e|s|t)":\[/.test(text), `${name}: a piece that uses no edge and no tube carries none of e, s, t in its text (E3c)`);
      fs.writeFileSync(path.join(dir, m.file), text); m.text_sha256 = sha(text);
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
    const r = check(dir); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /\n0 of 9 differ\n?$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('row 5 CONTROL: the check has teeth: a manifest with one digest altered reads "1 of 9 differ", and a changed fixture file is reported as changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-cup-fx-'));
  try {
    const man = amendedManifest(); for (const m of Object.values(man.fixtures)) fs.copyFileSync(path.join(FX, m.file), path.join(dir, m.file));
    man.fixtures['F3-bowl-narrow-12m-cap-binds'].render.segs = '0'.repeat(64);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
    let r = check(dir); assert.equal(r.status, 1); assert.match(r.stdout, /F3-bowl-narrow-12m-cap-binds: DIFFERS in segs/); assert.match(r.stdout, /\n1 of 9 differ\n?$/);
    fs.appendFileSync(path.join(dir, man.fixtures['F5-flat-20m-bank-30'].file), ' ');
    r = check(dir); assert.match(r.stdout, /F5-flat-20m-bank-30: FIXTURE FILE CHANGED/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('D279 amendment record: F1 F2 keep every digest but the kn5, and the measure says only their pit boxes changed, in material and coordinates', () => {
  for (const k of KN5_CHANGED) {
    const v = AMEND6.fixtures[k], prev = AMEND5.fixtures[k].after_d260;
    for (const d of ['segs', 'path', 'mesh', 'meshParts', 'kn5', 'kn5Bytes']) assert.equal(v.before_d260[d], prev[d], `${k}: "before" is the D260 record's ${d}`);
    for (const d of ['segs', 'path', 'mesh', 'meshParts', 'kn5Bytes']) assert.equal(v.after_d279[d], prev[d], `${k}: ${d} changed`);
    assert.notEqual(v.after_d279.kn5, v.before_d260.kn5, `${k}: the kn5 did not change`);
    const m = v.measure;
    assert.ok(m.pitBoxes > 0, `${k}: the fixture has pit boxes`);
    assert.deepEqual(m.changedNodes, { PAINT_PIT_n: m.pitBoxes }, `${k}: only the pit boxes changed`);
    assert.deepEqual(m.fieldsChanged, { 'material t180b_paint -> t180b_road': m.pitBoxes, uvs: m.pitBoxes }, `${k}: in material and coordinates only`);
  }
});
test('D260 amendment record: F1 F2 keep their segs, path and mesh digests, only the kn5 moved, and its triangle set and markers are the same in far fewer meshes', () => {
  for (const k of KN5_CHANGED) {
    const v = AMEND5.fixtures[k], prev = AMEND3.fixtures[k].after_d230;
    for (const d of ['segs', 'path', 'mesh', 'meshParts', 'kn5', 'kn5Bytes']) assert.equal(v.before_d230[d], prev[d], `${k}: "before" is the D230 record's ${d}`);
    for (const d of ['segs', 'path', 'mesh', 'meshParts']) assert.equal(v.after_d260[d], prev[d], `${k}: ${d} changed`);
    assert.notEqual(v.after_d260.kn5, v.before_d230.kn5, `${k}: the kn5 did not change`);
    const m = v.measure, ts = m.triangleSet;
    assert.equal(ts.equal, true); assert.equal(ts.missingFromAfter, 0); assert.equal(ts.extraInAfter, 0); assert.equal(m.meshesAfter.triangles, m.meshesBefore.triangles); assert.equal(ts.triangles, m.meshesBefore.triangles);
    assert.equal(m.markersEqual, true); assert.equal(m.meshesAfter.other, m.meshesBefore.other, `${k}: a mesh that is not a road cell or a skin was joined`);
    assert.ok(m.meshesAfter.meshes * 10 < m.meshesBefore.meshes, `${k}: ${m.meshesBefore.meshes} -> ${m.meshesAfter.meshes} meshes`);
    assert.equal(v.after_d260.kn5Bytes - v.before_d230.kn5Bytes, m.kn5ChangeBytes);
  }
});
test('D230 amendment record: F1 F2 keep their segs, path and mesh digests and their ROAD nodes byte for byte, only the kn5 moved (the skin nodes are added), and the measure says so', () => {
  for (const k of KN5_CHANGED) {
    const v = AMEND3.fixtures[k], prev = AMEND2.fixtures[k].after_d222;
    for (const d of ['segs', 'path', 'mesh', 'meshParts']) assert.equal(v.after_d230[d], prev[d], `${k}: ${d} changed`);
    assert.equal(v.before_d222.kn5, prev.kn5, `${k}: "before" is the D222 record's kn5`); assert.notEqual(v.after_d230.kn5, v.before_d222.kn5, `${k}: the kn5 did not change`);
    const m = v.measure; assert.equal(m.roadNodesSha256.equal, true); assert.equal(m.roadNodesSha256.before, m.roadNodesSha256.after, `${k}: the road nodes moved`);
    assert.equal(m.skinNodes.before, 0); assert.ok(m.skinNodes.after >= 700, `${k}: ${m.skinNodes.after} skin nodes (one under every cell)`);
    assert.equal(v.after_d230.kn5Bytes - v.before_d222.kn5Bytes, m.kn5GrowthBytes); assert.ok(m.kn5GrowthBytes > 0 && m.kn5GrowthBytes < 4e6, `${k}: the kn5 grows ${m.kn5GrowthBytes} bytes`);
    assert.equal(m.underskinOffsetM, 0.5);
  }
});
test('D222 amendment record: F1 F2 keep their segs, path and mesh digests, only the kn5 moved, and the measure shows the AC-ready export (unique names, world space, a diffuse, no sliver seam)', () => {
  for (const k of KN5_CHANGED) {
    const v = AMEND2.fixtures[k];
    for (const d of ['segs', 'path', 'mesh', 'meshParts']) assert.equal(v.after_d222[d], v.before_d196[d], `${k}: ${d} changed`);
    assert.notEqual(v.after_d222.kn5, v.before_d196.kn5, `${k}: the kn5 did not change`);
    assert.equal(v.before_d196.kn5, MANIFEST.fixtures[k].render.kn5, `${k}: "before" is the seal's kn5`);
    const a = v.measure.after;
    assert.equal(a.uniqueMeshNames, a.meshes); assert.equal(a.roadMeshesUnderANestedNode, 0); assert.equal(a.txDiffuseWritten, true); assert.equal(a.seamSliversUnder4mm, 0);
  }
});
test('D196 amendment record: every changed fixture keeps its path digest, its segs and mesh digests moved, and the measure shows the steps gone', () => {
  for (const k of CHANGED) {
    const v = AMEND.fixtures[k]; assert.equal(v.after_d196.path, v.before_c964c2d.path, `${k}: the geometry changed`);
    assert.notEqual(v.after_d196.segs, v.before_c964c2d.segs); assert.notEqual(v.after_d196.mesh, v.before_c964c2d.mesh);
    assert.equal(v.measure.after.widthStepM, 0); assert.ok(v.measure.after.rowGapInsidePiecesMm <= 1, `${k}: ${v.measure.after.rowGapInsidePiecesMm} mm inside a piece`);
    assert.ok((v.measure.after.sameFamilyJointGapMm ?? v.measure.after.jointGapMm) <= 1, `${k}: a same-family joint steps more than 1 mm`);
  }
});
