// nativefiles-mutation.test.js: node --test app/test/nativefiles-mutation.test.js
// Two fixes for long tracks, mutated (as export-isolated-mutation.test.js does it): the export's files handed to the native side as bytes (app/lib/nativefiles.js,
// and app/index.html sending through it), and the track checker's worker meshing nothing (app/validate-ui/checkjob.js PATH_ONLY). Each mutation copies
// app/ (its test folder left out, but for the test it runs), src/ and tools/ to a temp folder, applies ONE source patch, and runs the COPIED test file it
// names there. "Applied" means the patch text was found exactly once; "caught" means the named row FAILED on the mutant. A CONTROL runs each unmutated
// copy first. A run whose file died natively tested nothing and reads NOT TESTED (test/inner_run.js). The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('../../test/inner_run.js');
const ROOT = path.join(__dirname, '..', '..');
const BYTES = 'nativefiles.test.js', LEAN = 'core-check-lean.test.js';

const MUTATIONS = [
  // the body (app/lib/nativefiles.js)
  { id: 'N1 the header length is written big-endian', test: BYTES, file: 'lib/nativefiles.js', from: 'new DataView(prefix.buffer).setUint32(0, text.length, true)', to: 'new DataView(prefix.buffer).setUint32(0, text.length, false)', caughtBy: 'row 1:' },
  { id: 'N2 the files\' bytes are left out of the body', test: BYTES, file: 'lib/nativefiles.js', from: 'out.set(f.bytes, at); at += f.bytes.length;', to: 'at += f.bytes.length;', caughtBy: 'row 1:' },
  { id: 'N3 a file without bytes is taken', test: BYTES, file: 'lib/nativefiles.js', from: 'if (!(f.bytes instanceof Uint8Array)) throw', to: 'if (false) throw', caughtBy: 'row 2:' },
  { id: 'N4 a head that carries files is taken', test: BYTES, file: 'lib/nativefiles.js', from: "if ('files' in head) throw", to: 'if (false) throw', caughtBy: 'row 2:' },
  { id: 'N5 the body holds each file twice', test: BYTES, file: 'lib/nativefiles.js', from: 'list.reduce((a, f) => a + f.len, 0)', to: 'list.reduce((a, f) => a + 2 * f.len, 0)', caughtBy: 'row 1:' },
  { id: 'N10 a long body goes in one call', test: BYTES, file: 'lib/nativefiles.js', from: 'if (total <= piece) return invoke(cmd, packFiles(head, files));', to: 'if (true) return invoke(cmd, packFiles(head, files));', caughtBy: 'row 5:' },
  { id: 'N11 the command is not told the staged id', test: BYTES, file: 'lib/nativefiles.js', from: "{ headers: { 'T180-Staged': id } }", to: '{}', caughtBy: 'row 5:' },
  { id: 'N12 every piece says it starts at 0', test: BYTES, file: 'lib/nativefiles.js', from: 'stageBody(id, at, total, p)', to: 'stageBody(id, 0, total, p)', caughtBy: 'row 5:' },
  { id: 'N13 a full piece is reused for the next', test: BYTES, file: 'lib/nativefiles.js', from: 'yield piece; piece = new Uint8Array(size); fill = 0;', to: 'yield piece; fill = 0;', caughtBy: 'row 5:' },
  { id: 'N14 the page drops the staged id on its way to the native side', test: BYTES, file: 'index.html', from: '(c, body, options) => tauri.invoke(c, body, options)', to: '(c, body) => tauri.invoke(c, body)', caughtBy: 'row 4:' },
  // the page (app/index.html)
  { id: 'N6 Export to Assetto Corsa sends JSON again', test: BYTES, file: 'index.html', from: "installTrack: (folder, files) => sendFiles('install_track', { folder }, files),", to: "installTrack: (folder, files) => call('install_track', { folder, files }),", caughtBy: 'row 4:' },
  { id: 'N7 Export for Blender sends JSON again', test: BYTES, file: 'index.html', from: "sendFiles('write_blender_export', { dir, folder, fbx }, files)", to: "call('write_blender_export', { dir, folder, fbx, files })", caughtBy: 'row 4:' },
  // the track checker's worker (app/validate-ui/checkjob.js)
  { id: 'N8 the checker builds the mesh through buildMeshSteps', test: LEAN, file: 'validate-ui/checkjob.js', from: '*buildMeshSteps() { return emptyMesh(); }, ', to: '', caughtBy: 'meshes nothing' },
  { id: 'N9 the checker reuses a closed lap\'s mesh through reuseMeshSteps', test: LEAN, file: 'validate-ui/checkjob.js', from: ', *reuseMeshSteps() { return emptyMesh(); }', to: '', caughtBy: 'meshes nothing' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-nativefiles-mut-')), app = path.join(dir, 'app');
  try {
    fs.cpSync(path.join(ROOT, 'app'), app, { recursive: true, filter: (p) => path.relative(path.join(ROOT, 'app'), p).split(path.sep)[0] !== 'test' });
    fs.mkdirSync(path.join(app, 'test'));
    fs.copyFileSync(path.join(__dirname, m.test), path.join(app, 'test', m.test));
    fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'test')); fs.copyFileSync(path.join(ROOT, 'test', 'inner_run.js'), path.join(dir, 'test', 'inner_run.js'));
    const f = path.join(app, m.file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const n = m.from === null ? 1 : src.split(m.from).length - 1, applied = n === 1;
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const tap = path.join(dir, '.inner-run.tap');
    const r = spawnSync(process.execPath, ['--test', ...IR.reporterArgs(tap), path.join(app, 'test', m.test)],
      { env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), encoding: 'utf8', timeout: 900000 });
    if (r.error) throw r.error;
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    if (!/ℹ tests \d+/.test(out)) throw new Error('the mutant test run printed no summary:\n' + out.slice(0, 2000));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l)).map((l) => l.slice(2));
    const crashed = IR.crashesIn(tap), caught = failed.some((l) => !crashed.some((c) => l.startsWith(c.file + ' (')) && l.includes(m.caughtBy));
    if (crashed.length && !caught) throw new Error(IR.notTested(crashed));
    if (!caught && m.from !== null && !IR.reported(out, m.caughtBy)) throw new Error(IR.neverReported(crashed, IR.fileExitsIn(tap), 1));
    return { applied, n, caught, failed: [...new Set(failed)] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

for (const t of [BYTES, LEAN]) {
  test(`control: the unmutated temp copy passes every row of ${t}`, () => {
    const r = runMutant({ id: 'control', test: t, file: 'lib/nativefiles.js', from: null, to: null, caughtBy: '(no test is named this)' });
    assert.deepEqual(r.failed, [], `the unmutated copy fails: ${r.failed.join(' | ')}`);
  });
}
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" occurs ${r.n} times in app/${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
