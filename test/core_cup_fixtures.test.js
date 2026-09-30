// core_cup_fixtures.test.js: node --test test/core_cup_fixtures.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D190 seal, row 5: the nine /2 documents in test/fixtures/ (F1-F9, made at t180 c964c2d, the last code that wrote /2) render BYTE-IDENTICALLY
// through the /3 code. test/fixtures/fixtures.js is the seal's Appendix A verbatim (sha256 d24dcf49...), manifest.json its Appendix B
// (sha256 05be6acc...). "Identically" means the digests it computes: every segment the adapter emits, every path sample, every mesh, the kn5.
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

test('the fixture kit is the seal\'s: fixtures.js and manifest.json carry the sha256 the seal registered', () => {
  assert.equal(sha(fs.readFileSync(path.join(FX, 'fixtures.js'))), 'd24dcf49f8826d2b366df0ea33d393445cb0828a5053419901556cce15de1352');
  assert.equal(sha(fs.readFileSync(path.join(FX, 'manifest.json'))), '05be6acc0351a7fc191b73233c7e9e92aaf10e055cfbdd71b513e7c5e940b59a');
  assert.equal(Object.keys(MANIFEST.fixtures).length, 9); assert.equal(MANIFEST.schema, 't180b.core/2');
});
test('row 5a: every /2 fixture renders identically as /3: "0 of 9 differ"', () => {
  const r = check(FX); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\n0 of 9 differ\n?$/); assert.equal((r.stdout.match(/: identical/g) || []).length, 9, r.stdout);
});
test('row 5b: each fixture parsed, saved as /3 text and read again renders to the same digests (the /3 round trip), and its text is /3', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-cup-fx-'));
  try {
    const man = JSON.parse(JSON.stringify(MANIFEST));
    for (const [name, m] of Object.entries(man.fixtures)) {
      const text = D.serialize(D.parse(fs.readFileSync(path.join(FX, m.file), 'utf8')));
      assert.match(text, /"schema": "t180b\.core\/3"/, `${name} is saved as /3`);
      fs.writeFileSync(path.join(dir, m.file), text); m.text_sha256 = sha(text);
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
    const r = check(dir); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /\n0 of 9 differ\n?$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('row 5 CONTROL: the check has teeth: a manifest with one digest altered reads "1 of 9 differ", and a changed fixture file is reported as changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-cup-fx-'));
  try {
    const man = JSON.parse(JSON.stringify(MANIFEST)); for (const m of Object.values(man.fixtures)) fs.copyFileSync(path.join(FX, m.file), path.join(dir, m.file));
    man.fixtures['F3-bowl-narrow-12m-cap-binds'].render.segs = '0'.repeat(64);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
    let r = check(dir); assert.equal(r.status, 1); assert.match(r.stdout, /F3-bowl-narrow-12m-cap-binds: DIFFERS in segs/); assert.match(r.stdout, /\n1 of 9 differ\n?$/);
    fs.appendFileSync(path.join(dir, man.fixtures['F5-flat-20m-bank-30'].file), ' ');
    r = check(dir); assert.match(r.stdout, /F5-flat-20m-bank-30: FIXTURE FILE CHANGED/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
