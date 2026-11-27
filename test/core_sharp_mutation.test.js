// core_sharp_mutation.test.js: node --test test/core_sharp_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D677: each mutant changes src/core/sharp.js in ONE way (one exact string replacement, in a temporary copy of src/ and tools/ and the app folders the panel
// loads), and test/core_sharp.test.js runs against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one test FAILED
// on the mutant. The CONTROL runs the whole file on an unmutated copy, so a copy that is missing a file cannot make every mutant look caught. Built as
// core_ramp_mutation.test.js is (D194b, D352).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const S = 'core/sharp.js';

const MUTANTS = [
  // D677, the rule itself: only a red refuses, and tightestSharp is set by reds alone
  { id: 'S1 an amber refuses again (the rule before D677)', pattern: 'D677 row 1', edits: [[S, 'if (f.red.length) {', 'if (f.red.length || f.amber.length) {']] },
  { id: 'S2 a red no longer refuses', pattern: 'D677 row 2', edits: [[S, 'if (f.red.length) {', 'if (false) {']] },
  { id: 'S3 tightestSharp counts the ambers again', pattern: 'D677 row 3', edits: [[S, 'const clear = (doc, opts, sharp) => !faults(doc, opts, sharp).red.length;', 'const clear = (doc, opts, sharp) => { const f = faults(doc, opts, sharp); return !f.red.length && !f.amber.length; };']] },
  { id: 'S4 tightestSharp ignores the reds too (every radius is clear)', pattern: 'D677 row 3|the minimum radius', edits: [[S, 'const clear = (doc, opts, sharp) => !faults(doc, opts, sharp).red.length;', 'const clear = () => true;']] },
  { id: 'S5 the refusal names no tightest radius', pattern: 'the minimum radius|width 24', edits: [[S, 'const need = tightestSharp(doc, opts, s, s.R);', 'const need = null;']] },
  { id: 'S6 the refusal names an amber as its cause, not the red', pattern: 'D677 row 2', edits: [[S, "const why = f.red.join(', ');", "const why = f.amber.join(', ');"]] },
  // the probe: what the corner is judged on
  // LEFT OUT, NOT CAUGHT in the second run and NOT shown equivalent: S7 'a fault anywhere on the probe counts, not only on the corner' (the NEAR_M window
  // returns true). No row puts a fault on the probe's straights, in or out; a row that does would measure the window
  { id: 'S8 no fault counts (the window misses the corner)', pattern: 'D677 row 2', edits: [[S, 'return b >= s0 - NEAR_M && a <= s1 + NEAR_M; }).map((x) => x.reason);', 'return false; }).map((x) => x.reason);']] },
  { id: "S9 the probe is not the head's width (a fixed 24 m)", pattern: 'the minimum radius', edits: [[S, 'phi: from.phi.v, w: from.w.v,', 'phi: from.phi.v, w: 24,']] },
  { id: "S10 the probe is not banked as the head is", pattern: 'D677 row', edits: [[S, 'phi: from.phi.v, w: from.w.v,', 'phi: 0, w: from.w.v,']] },
  { id: 'S11 the probe is judged at design speed, not full speed', pattern: 'D677 row|the minimum radius', edits: [[S, '{ csp: true, fullSpeed: true });\n  const on', '{ csp: true });\n  const on']] },
  // the corner: exact angle, the refusals by name
  // S15 and S16 were left out as EQUIVALENT in the first build; pane A's read of d80c96a (F2) showed neither is: a negative radius LAYS a corner turned the
  // other way, and a closed track at a radius too tight is refused SHARP_TOO_TIGHT, not CLOSED. Each now has its own row, seen red against it first
  { id: 'S15 a closed loop is not refused by Sharp (the fold is named first)', pattern: 'closed track is refused CLOSED', edits: [[S, "if (doc.closed) throw new D.CoreError('CLOSED',", "if (false) throw new D.CoreError('CLOSED',"]] },
  { id: 'S16 a radius at or under 0 is not refused by Sharp (a negative one lays)', pattern: 'negative radius', edits: [[S, 'if (!(Number.isFinite(R) && R > 0))', 'if (!(Number.isFinite(R)))']] },
  // LEFT OUT, found in the first run (2026-11-26) and named in pane B's D677 hand-back. NOT CAUGHT, and NOT shown equivalent (untested here, outside D677's
  // change, left for a row that measures them):
  // S12 the exit's last rate and slope not set to 0 (build), S13 the least-norm correction of the hold skipped (its comment measures 0.02° short at R 12,
  // width 24; the rows turn at R 22 and up, where the bisection alone is within TURN_TOL), S17 the knots 4 m apart on a 4 m ramp, not 2
  { id: 'S14 a corner smaller than its ramps is not refused by name', pattern: 'smaller than its own ramps', edits: [[S, 'if (f(lo) > want + TURN_TOL) {', 'if (false) {']] },
];
const FILES = ['core_sharp.test.js'];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-sharp-mut-'));
  for (const d of ['src', 'tools', 'app/core', 'app/camera', 'app/lib', 'app/validate-ui']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });   // the app folders app/core/panel.js loads
  fs.mkdirSync(path.join(dir, 'test')); for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'test', f));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...FILES.map((f) => path.join(dir, 'test', f))];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const crashed = IR.crashesIn(tap);   // D352: a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of core_sharp.test.js passes on an unmutated copy of src/ and tools/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 10 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
// D352: a crashed inner run is no verdict. The stand-in puts the machine's crash (test/inner_run.js STANDIN) at the top of the first mutant's file
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in, D352)', () => {
  const m0 = MUTANTS[0], dir = tree();
  try {
    const f = path.join(dir, 'src', m0.edits[0][0]);
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
