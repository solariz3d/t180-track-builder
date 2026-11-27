// core-pitgap-mutation.test.js: node --test app/test/core-pitgap-mutation.test.js
// The pit lane's smallest gap from the road (D677: src/doc/pitlane.js PIT_GAP_MIN_M, app/core/coreshell.js setPitLane, app/core/pitui.js put), mutated, as
// export-isolated-mutation.test.js does it. Each mutation copies app/ (core, preview, camera, export, install, lib, testhook, validate-ui, and
// core-pitgap.test.js), src/ and tools/ to a temp folder, applies ONE source patch, and runs the COPIED core-pitgap.test.js there. "Applied" means the
// patch text was found exactly once; "caught" means the named row FAILED on the mutant. A CONTROL runs the unmutated copy first. A run whose file died
// natively tested nothing and reads NOT TESTED (test/inner_run.js). The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('../../test/inner_run.js');
const ROOT = path.join(__dirname, '..', '..');
const TEST = 'core-pitgap.test.js';

const MUTATIONS = [
  // the shell's refusal (app/core/coreshell.js setPitLane)
  { id: 'P1 the shell lays any gap', file: 'core/coreshell.js', from: "if (lane && typeof lane.offsetM === 'number' && lane.offsetM !== gapNow && lane.offsetM < PL.PIT_GAP_MIN_M) return set(", to: 'if (false) return set(', caughtBy: 'every pit-lane gap the panel accepts' },
  // the repair round (pane O's read): only a gap that CHANGES is judged, and the panel draws the stored lane again after a refusal (app/core/pitui.js put)
  { id: 'P9 an unchanged gap under the smallest is judged too (every edit of a saved lane under it refused)', file: 'core/coreshell.js', from: 'lane.offsetM !== gapNow && ', to: '', caughtBy: 'still takes a width edit in the panel' },
  { id: 'P10 the gap is compared with the NEW lane\'s own (an existing lane\'s gap never judged)', file: 'core/coreshell.js', from: 'const gapNow = d.pitLane ? d.pitLane.offsetM : undefined;', to: 'const gapNow = d.pitLane ? lane.offsetM : undefined;', caughtBy: 'a gap changed to another value under it is refused' },
  { id: 'P11 the panel does not draw the stored lane after a refusal', file: 'core/pitui.js', from: 'if (cur() === c) { shownFor = null; update(shell.getState()); }', to: '', caughtBy: 'a refused gap puts the gap box back' },
  { id: 'P12 the panel redraws only when the document changed (the refused value stays)', file: 'core/pitui.js', from: 'shownFor = null; update(shell.getState());', to: 'update(shell.getState());', caughtBy: 'a refused gap puts the gap box back' },
  { id: 'P2 the smallest gap itself is refused', file: 'core/coreshell.js', from: 'lane.offsetM < PL.PIT_GAP_MIN_M', to: 'lane.offsetM <= PL.PIT_GAP_MIN_M', caughtBy: 'a gap just under the smallest is refused' },
  { id: 'P5 the refusal says why and lays the lane anyway', file: 'core/coreshell.js', from: 'return set({ message: `PIT_GAP_TOO_SMALL', to: 'set({ message: `PIT_GAP_TOO_SMALL', caughtBy: 'a gap of 0 is refused by name' },
  { id: 'P6 the refusal does not give the smallest gap', file: 'core/coreshell.js', from: 'must be at least ${PL.PIT_GAP_MIN_M} m;', to: 'must be larger;', caughtBy: 'a gap of 0 is refused by name' },
  { id: 'P7 removing the lane (null) reads its gap', file: 'core/coreshell.js', from: "if (lane && typeof lane.offsetM === 'number' && lane.offsetM !== gapNow", to: "if (typeof lane.offsetM === 'number' && lane.offsetM !== gapNow", caughtBy: 'still removed by unticking' },
  // the floor (src/doc/pitlane.js)
  { id: 'P3 the smallest gap is 0', root: 'src', file: 'doc/pitlane.js', from: 'const PIT_GAP_MIN_M = 0.1;', to: 'const PIT_GAP_MIN_M = 0;', caughtBy: 'every pit-lane gap the panel accepts' },
  { id: 'P4 the smallest gap is 0.01 m (a gap the export refuses on the flat control)', root: 'src', file: 'doc/pitlane.js', from: 'const PIT_GAP_MIN_M = 0.1;', to: 'const PIT_GAP_MIN_M = 0.01;', caughtBy: 'every pit-lane gap the panel accepts' },
  { id: 'P8 stored lanes are re-judged by the floor', root: 'src', file: 'doc/pitlane.js', from: 'offsetM: [0, 200]', to: 'offsetM: [0.1, 200]', caughtBy: 'a stored document whose lane has a gap of 0 still loads' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-pitgap-mut-')), app = path.join(dir, 'app');
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

test('control: the unmutated temp copy passes every pit-gap row', () => {
  const r = runMutant({ id: 'control', file: 'core/coreshell.js', from: null, to: null, caughtBy: '(no test is named this)' });
  assert.deepEqual(r.failed, [], `the unmutated copy fails: ${r.failed.join(' | ')}`);
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" occurs ${r.n} times in ${m.root === 'src' ? 'src' : 'app'}/${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
