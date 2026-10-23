// export-isolated-mutation.test.js: node --test app/test/export-isolated-mutation.test.js
// D437b, the export in its own process, mutated (as core-mutation.test.js does it). Each mutation copies app/ (core, preview, camera, export, install, lib,
// testhook, validate-ui, and export-isolated.test.js), src/ and tools/ to a temp folder, applies ONE source patch, and runs the COPIED export-isolated.test.js
// there (its host threads load the copy's files too). "Applied" means the patch text was found exactly once; "caught" means the named row FAILED on the mutant.
// A CONTROL runs the unmutated copy first. A run whose file died natively tested nothing and reads NOT TESTED (test/inner_run.js, D352). The originals are
// never touched. The real browser's half (a real out-of-memory, the page still drawn) is export-isolated-page.test.js, not mutated here.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('../../test/inner_run.js');
const ROOT = path.join(__dirname, '..', '..');
const TEST = 'export-isolated.test.js';

const MUTATIONS = [
  // the runner (app/export/exportrunner.js)
  { id: 'X1 a host that goes silent is never given up', file: 'export/exportrunner.js', from: 'if (Date.now() - heard > lostMs) return fail(', to: 'if (false) return fail(', caughtBy: 'row 4:' },
  { id: 'X2 the stage the host reports is not kept', file: 'export/exportrunner.js', from: 'if (m.stage) { stage = m.stage; return; }', to: 'if (m.stage) return;', caughtBy: 'row 4:' },
  { id: 'X3 a failure inside the host reads as a finished export', file: 'export/exportrunner.js', from: 'if (m.ok) resolve({ out: m.out, stage });', to: 'if (true) resolve({ out: m.out, stage });', caughtBy: 'row 3:' },
  { id: 'X4 a host that died is used again', file: 'export/exportrunner.js', from: 'const fail = (err) => { if (settled) return; finish(); drop(); reject(err); };', to: 'const fail = (err) => { if (settled) return; finish(); reject(err); };', caughtBy: 'row 4b' },
  { id: 'X11 a refusal throws the host away', file: 'export/exportrunner.js', from: "else { if (!m.error || m.error.name !== 'ExportError') drop();", to: 'else { drop();', caughtBy: 'row 6:' },
  // the job (app/export/exportjob.js)
  { id: 'X5 the road surface\'s slots do not cross', file: 'export/exportjob.js', from: 'out.slotsById = ids.map(', to: 'out.slotsById = [].map(', caughtBy: 'row 2:' },
  { id: 'X6 the core\'s lift does not cross', file: 'export/exportjob.js', from: 'meta.liftPath = (p) => adapter.offsetPath(liftDoc, job.segments, p);', to: 'meta.liftPath = (p) => p;', caughtBy: 'row 2b:' },
  // the exporter (app/export/export.js)
  { id: 'X9 the lost export\'s words name no stage', file: 'export/export.js', from: '`the export ran out of memory ${e.stage}: its process stopped`', to: '`the export ran out of memory: its process stopped`', caughtBy: 'row 4:' },
  { id: 'X10 the exporter\'s own refusal comes back as a failure', file: 'export/export.js', from: "if (e.name === 'ExportError') throw new fromwords.ExportError(", to: 'if (false) throw new fromwords.ExportError(', caughtBy: 'row 6:' },
  // the callers: Export (app/core/coreshell.js) and Export to Assetto Corsa (app/install/install.js)
  { id: 'X7 Export builds on the page again', file: 'core/coreshell.js', from: 'try { out = await api.buildExportAsync(opts); } catch (e) {', to: 'try { out = api.buildExport(opts); } catch (e) {', caughtBy: 'row 3:' },
  { id: 'X8 Export to Assetto Corsa does not wait for the build', file: 'install/install.js', from: 'try { out = await build(test ? { textures, test: true } : { textures }); } catch (e) {', to: 'try { out = build(test ? { textures, test: true } : { textures }); } catch (e) {', caughtBy: 'row 3:' },
  // the stages (src/export/fromwords.js)
  { id: 'X12 the export never says it is building the pit-lane check', root: 'src', file: 'export/fromwords.js', from: "    stage('building the pit-lane check');\n", to: '', caughtBy: 'row 4:' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-export-mut-')), app = path.join(dir, 'app');
  try {
    for (const d of ['core', 'preview', 'camera', 'export', 'install', 'lib', 'testhook', 'validate-ui']) fs.cpSync(path.join(ROOT, 'app', d), path.join(app, d), { recursive: true });
    fs.mkdirSync(path.join(app, 'test'));
    fs.copyFileSync(path.join(__dirname, TEST), path.join(app, 'test', TEST));
    fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });
    const f = m.root === 'src' ? path.join(dir, 'src', m.file) : path.join(app, m.file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const n = m.from === null ? 1 : src.split(m.from).length - 1, applied = n === 1;
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const tap = path.join(dir, '.inner-run.tap');
    const r = spawnSync(process.execPath, ['--test', ...IR.reporterArgs(tap), path.join(app, 'test', TEST)],
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

test('control: the unmutated temp copy passes every export-isolated row', () => {
  const r = runMutant({ id: 'control', file: 'export/exportrunner.js', from: null, to: null, caughtBy: '(no test is named this)' });
  assert.deepEqual(r.failed, [], `the unmutated copy fails: ${r.failed.join(' | ')}`);
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" occurs ${r.n} times in ${m.root === 'src' ? 'src' : 'app'}/${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
