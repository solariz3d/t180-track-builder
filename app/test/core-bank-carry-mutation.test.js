// core-bank-carry-mutation.test.js: node --test app/test/core-bank-carry-mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D677, the bank past a full turn: each mutant changes app/core/panel.js in ONE way (one exact string replacement, in a temporary copy of src/, tools/, the
// app folders the panel loads and test/fixtures), and the rows run against the copy: app/test/core-bank-carry.test.js, and for B6 the amended D641 (f) row in
// app/test/core-extra-bank-wind.test.js. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one test FAILED on the mutant.
// The CONTROL runs the files whole on an unmutated copy, so a copy that is missing a file cannot make every mutant look caught. Built as
// test/core_sharp_mutation.test.js is (D194b, D352).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('../../test/inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const P = 'app/core/panel.js';

const MUTANTS = [
  { id: 'B1 a typed bank is wrapped within one turn again (the rule before D677)', pattern: 'W1', edits: [[P, '!Number.isFinite(T) ? t : inHeadTurn(T); };', "!Number.isFinite(T) ? t : Math.abs(T) === 360 ? String(T) : String(HD.wrapTurn(T)); };"]] },
  { id: "B2 the head's whole turns are not carried", pattern: 'W3', edits: [[P, 'const inHeadTurn = (T) => String(T + headTurns());', 'const inHeadTurn = (T) => String(T);']] },
  { id: "B3 the head's turns are its nearest whole turn, not the whole turns it has made (-340 counts as -360)", pattern: 'W1', edits: [[P, 'return 360 * Math.round((h - HD.wrapTurn(h)) / 360); };', 'return 360 * Math.round(h / 360); };']] },
  { id: 'B4 an extra bank row is wrapped within one turn again', pattern: 'W2', edits: [[P, ": inHeadTurn(T); };   // a bank row in the head's own turn (D677)", ': String(HD.wrapTurn(T)); };']] },
  { id: "B5 the extra bank's offer is read in absolute degrees, not the field's turn", pattern: 'W4', edits: [[P, "const base = corner ? 0 : f === 'bank' ? Number(last ? last.target / DEG : bankTarget()) - headTurns() : last", "const base = corner ? 0 : f === 'bank' ? Number(last ? last.target / DEG : bankTarget()) : last"]] },
  { id: 'B6 a bank typed past one turn is written back into the field wrapped again (D641 (f) before D677)', pattern: 'D641 \\(f\\)', edits: [[P, '  // (bankTarget), so the field keeps what was typed until Extend, and then shows the head within one turn',
    "  // (bankTarget), so the field keeps what was typed until Extend, and then shows the head within one turn\n  { const prev = bank.onchange; bank.onchange = (e) => { const T = Number(bank.value); if (bank.value !== '' && Number.isFinite(T) && Math.abs(T) > 360) bank.value = show(HD.wrapTurn(T)); return prev(e); }; }"]] },
];
// LEFT OUT: the flowing bank's base (offersAt's flow branch, "- headTurns(), ...ST.styleOf(f) });"). No row lays a flowing bank from a head past one turn;
// the D641 R1 hold and the drags (D259) are his 2026-10-06 rule, unchanged by D677, and their own rows (core-pieces-ui, core-sculpt, core-extra-bank-wind) guard them
const FILES = ['core-bank-carry.test.js', 'core-extra-bank-wind.test.js'];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-bankcarry-mut-'));
  for (const d of ['src', 'tools', 'app/core', 'app/camera', 'app/lib', 'app/validate-ui', 'app/preview', 'test/fixtures']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'app', 'test'), { recursive: true }); for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'app', 'test', f));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...FILES.map((f) => path.join(dir, 'app', 'test', f))];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const crashed = IR.crashesIn(tap);   // D352: a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: core-bank-carry.test.js and core-extra-bank-wind.test.js pass whole on an unmutated copy', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 10 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
// D352: a crashed inner run is no verdict. The stand-in puts the machine's crash (test/inner_run.js STANDIN) at the top of the first mutant's file
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in, D352)', () => {
  const m0 = MUTANTS[0], dir = tree();
  try {
    const f = path.join(dir, m0.edits[0][0]);
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
        const f = path.join(dir, file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
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
