// gltf_mutation.test.js: node --test test/gltf_mutation.test.js   (under the heavy-run lock; a few minutes)
// Each mutant changes src/export/gltf.js in ONE way (one exact string replacement, in a temporary copy of src/, tools/ and the app folders the export test
// loads), and test/export_gltf.test.js runs against the copy with Blender pointed away (T180_BLENDER), so its own strict reader judges. "Applied" means the
// replaced string occurs EXACTLY once; "caught" means at least one test FAILED on the mutant. The CONTROL runs the file on an unmutated copy.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const G = 'export/gltf.js';

const MUTANTS = [
  { id: 'G1 a bufferView\'s byteOffset is off by 4', pattern: 'strict reader', edits: [[G, 'bufferViews.push({ buffer: 0, byteOffset: len,', 'bufferViews.push({ buffer: 0, byteOffset: len + 4,']] },
  { id: 'G2 POSITION carries no min/max', pattern: 'strict reader', edits: [[G, 'if (withBounds) {', 'if (false) {']] },
  { id: 'G3 a mesh node is unnamed', pattern: 'same name with the same vertex count', edits: [[G, "nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 });", 'nodes.push({ mesh: gltfMeshes.length - 1 });']] },
  { id: 'G4 v is written as the scene holds it, not as the kn5 writes it (1 - v)', pattern: 'AI line is a polyline', edits: [[G, 'uv[i + 1] = 1 - m.uvs[i + 1];', 'uv[i + 1] = m.uvs[i + 1];']] },
  { id: 'G5 a marker loses its transform', pattern: 'AC markers are empty nodes', edits: [[G, '...(isIdentity(d.matrix) ? {} : { matrix: d.matrix.slice() })', '']] },
  { id: 'G6 the JSON chunk is padded with zeros, not spaces', pattern: 'NEEDS padding', edits: [[G, 'Buffer.alloc(jpad, 0x20)', 'Buffer.alloc(jpad, 0)']] },
  { id: 'G7 the BIN chunk is not padded to 4 bytes', pattern: 'NEEDS padding', edits: [[G, "const pad = (4 - (len % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }\n  const json", 'const json']] },
  { id: 'G8 the groups take the piece number unpadded and the kind dropped', pattern: 'same name with the same vertex count', edits: [[G, 'const g = pk.group || `p${String(pk.piece).padStart(width, \'0\')}_${pk.kind}`;', 'const g = pk.group || `p${pk.piece}`;']] },
  { id: 'G9 a mesh under a moved parent is written anyway', pattern: 'moved parent', edits: [[G, "if (moved) throw new GltfError('GLTF_NOT_FLAT',", "if (false) throw new GltfError('GLTF_NOT_FLAT',"]] },
];
const FILES = ['export_gltf.test.js'];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-gltf-mut-'));
  for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  for (const d of fs.readdirSync(path.join(ROOT, 'app'))) if (!['sounds', 'test'].includes(d)) fs.cpSync(path.join(ROOT, 'app', d), path.join(dir, 'app', d), { recursive: true });   // the app the export test loads (app/core/coreshell.js reaches far); not its sounds or tests
  fs.mkdirSync(path.join(dir, 'test')); for (const f of [...FILES, 'glb_read.js', 'inner_run.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'test', f));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=8192', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...FILES.map((f) => path.join(dir, 'test', f))];
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), T180_BLENDER: path.join(dir, 'no-blender.exe') };
  const tap = path.join(dir, '.inner-run.tap');
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const crashed = IR.crashesIn(tap);
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of export_gltf.test.js passes on an unmutated copy (its Blender rows skip: Blender is pointed away)', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 8 && r.fail === 0 && r.skipped >= 2, `tests ${r.tests}, fail ${r.fail}, skipped ${r.skipped}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS) {
  test(`mutant ${m.id}: applied, and caught by "${m.pattern}"`, (t) => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = path.join(dir, 'src', file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
        assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in src/${file}: ${from.slice(0, 80)}`);
        fs.writeFileSync(f, src.replace(from, () => to));
      }
      const r = runTests(dir, m.pattern);
      t.diagnostic(`${m.id}: ${r.fail} of ${r.tests - r.skipped} run tests failed`);
      assert.ok(r.tests - r.skipped > 0, `the pattern "${m.pattern}" ran no test`);
      assert.ok(r.fail > 0, `NOT CAUGHT: ${r.pass} pass, 0 fail with the pattern "${m.pattern}"`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
module.exports = { MUTANTS };
