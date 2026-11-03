// core_early_turn_climb_mutation.test.js: node --test test/core_early_turn_climb_mutation.test.js   (under the heavy-run lock; a minute or two)
// A turn or climb reached early, sized to its change (app/core/panel.js routeStartM): each mutant changes that code in ONE way (one exact string replacement, in a
// temporary copy of src/, tools/ and app/), and test/core_early_turn_climb.test.js runs against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at
// least one test FAILED on the mutant. The CONTROL runs the whole file on an unmutated copy, so a copy missing a file cannot make every mutant look caught.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PN = 'core/panel.js';   // app/core/panel.js, by the copy's app/ folder (edits name a path under app/ with an 'app:' prefix)

const MUTANTS = [
  { id: 'E1 the early turn and climb are back to a flat 20 m', pattern: 'row 1|row 2|row 3', edits: [['app:' + PN, ": ch === 'kh' || ch === 'kv' ? routeStartM(fromDeg(ch), targets[ch], out.length) : Math.min(AT_START_M, out.length);", ': Math.min(AT_START_M, out.length);']] },
  { id: 'E2 the change is measured from 0, not from where the track is', pattern: 'row 3', edits: [['app:' + PN, 'routeStartM(fromDeg(ch), targets[ch], out.length)', 'routeStartM(0, targets[ch], out.length)']] },
  { id: 'E3 no half-piece cap', pattern: 'row 3', edits: [['app:' + PN, 'cap = Math.max(Math.min(AT_START_M, length), length / 2);', 'cap = length;']] },
  { id: 'E4 the spread loosened to 2', pattern: 'row 1|row 2', edits: [['app:' + PN, 'ROUTE_SPREAD = 3;', 'ROUTE_SPREAD = 2;']] },
  { id: 'E5 a piece shorter than 20 m gets 20 m', pattern: 'row 3', edits: [['app:' + PN, 'cap = Math.max(Math.min(AT_START_M, length), length / 2);', 'cap = Math.max(AT_START_M, length / 2);']] },
];

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-corner-mut-'));
  for (const d of ['src', 'tools', 'app']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true, filter: (p) => !/[\\/]app[\\/]test([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test', 'fixtures'), { recursive: true }); fs.copyFileSync(path.join(__dirname, 'core_early_turn_climb.test.js'), path.join(dir, 'test', 'core_early_turn_climb.test.js'));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), path.join(dir, 'test', 'core_early_turn_climb.test.js')];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000, windowsHide: true });
  const crashed = IR.crashesIn(tap);   // a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of core_early_turn_climb.test.js passes on an unmutated copy of src/, tools/ and app/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 5 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in)', () => {
  const m0 = MUTANTS[0], dir = tree();
  try {
    const f = path.join(dir, m0.edits[0][0].startsWith('app:') ? 'app' : 'src', m0.edits[0][0].replace(/^app:/, ''));
    fs.writeFileSync(f, IR.STANDIN + fs.readFileSync(f, 'utf8'));
    const said = IR.reading(() => { const r = runTests(dir, m0.pattern); return r.fail > 0 ? `caught: ${r.fail} of ${r.tests} failed` : `NOT CAUGHT: ${r.pass} pass, 0 fail`; });
    assert.match(said, IR.NOT_TESTED);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS) {
  test(`mutant ${m.id}: applied, and caught by "${m.pattern}"`, (t) => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = path.join(dir, file.startsWith('app:') ? 'app' : 'src', file.replace(/^app:/, '')), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
        assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in ${file}: ${from.slice(0, 80)}`);
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
