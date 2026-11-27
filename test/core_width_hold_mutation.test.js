// core_width_hold_mutation.test.js: node --test test/core_width_hold_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// L264, THE WIDTH HOLDS AFTER A BRUSH: each mutant changes src/core/extend.js's new lines in ONE way (one exact string replacement, in a temporary copy of src/, tools/ and
// app/ without its tests), and the hold's rows (app/test/core-width-hold.test.js) run against the copy, whole. "Applied" means the replaced string occurs EXACTLY once;
// "caught" means at least one row FAILED on the mutant. The CONTROL runs the file on an unmutated copy, so a copy that is missing a file cannot make every mutant look
// caught. Built as core_right_width_mutation.test.js is (D194b, D352).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const EX = 'src/core/extend.js';

const MUTANTS = [
  { id: 'H1 the width is never held: it goes on at the brush\'s slope, as before L264', edits: [[EX, 'const holdW = held && !given(targets.w) && from.w.m !== 0 ? from.w.v : undefined;', 'const holdW = undefined;']] },
  { id: 'H2 the hold is spread over the whole piece, not the first knot span', edits: [[EX, "channelFn(from.w, holdW, startRampM(length, knotM), 'w')", "channelFn(from.w, holdW, Lof('w'), 'w')"]] },
  { id: 'H3 a held width\'s end is not pinned level', edits: [[EX, 'if (holdW !== undefined) { const w = laid.channels.w', 'if (false) { const w = laid.channels.w']] },
  { id: 'H4 the hold\'s blend starts level, not at the head\'s slope', edits: [[EX, 'channelFn(from.w, holdW,', 'channelFn({ v: from.w.v, m: 0 }, holdW,']] },
  { id: 'H5 a typed width is held at the head\'s width instead', edits: [[EX, 'held && !given(targets.w) && from.w.m', 'held && from.w.m']] },
  { id: 'H6 the joint kinks: the second control point is put at the head\'s width', edits: [[EX, 'z[n - 1] = holdW; z[n - 2] = holdW; laid', 'z[n - 1] = holdW; z[n - 2] = holdW; z[1] = holdW; laid']] },
  // LEFT OUT (L264, pane B): 'a level head is held too' (`&& from.w.m !== 0` taken out) is EQUIVALENT: at a head whose width is level, the hold's target is the
  // head's own width, so the blend is that width all along, and the fitted, quantised piece is every control point at it, which is what going on at a slope of 0
  // lays (pane B's scratch h6check.js: 5 of 5 rows pass on it). The condition is kept so that a level head is not touched by construction, not by rounding
];
const FILES = [['app/test', 'core-width-hold.test.js']];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-hold-mut-'));
  for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.cpSync(path.join(ROOT, 'app'), path.join(dir, 'app'), { recursive: true, filter: (p) => !/[\\/]app[\\/](test|node_modules)([\\/]|$)/.test(p) });
  for (const [d, f] of FILES) { fs.mkdirSync(path.join(dir, d), { recursive: true }); fs.copyFileSync(path.join(ROOT, d, f), path.join(dir, d, f)); }
  return dir;
}
function runTests(dir) {
  const args = ['--max-old-space-size=4096', '--test', ...FILES.map(([d, f]) => path.join(dir, d, f))];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const crashed = IR.crashesIn(tap);   // D352: a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the hold\'s row file passes on an unmutated copy of src/, tools/ and app/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 5 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
// D352: a crashed inner run is no verdict. The stand-in puts the machine's crash (test/inner_run.js STANDIN) at the top of the first mutant's file
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in, D352)', () => {
  const m0 = MUTANTS[0], dir = tree();
  try {
    const f = path.join(dir, m0.edits[0][0]);
    fs.writeFileSync(f, IR.STANDIN + fs.readFileSync(f, 'utf8'));
    const said = IR.reading(() => { const r = runTests(dir); return r.fail > 0 ? `caught: ${r.fail} of ${r.tests} failed` : `NOT CAUGHT: ${r.pass} pass, 0 fail`; });
    assert.match(said, IR.NOT_TESTED);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS) {
  test(`mutant ${m.id}: applied, and caught`, (t) => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = path.join(dir, file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
        assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in ${file}: ${from.slice(0, 80)}`);
        fs.writeFileSync(f, src.replace(from, () => to));
      }
      const r = runTests(dir);
      t.diagnostic(`${m.id}: ${r.fail} of ${r.tests - r.skipped} run tests failed`);
      assert.ok(r.tests - r.skipped > 0, 'no test ran');
      assert.ok(r.fail > 0, `NOT CAUGHT: ${r.pass} pass, 0 fail`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
module.exports = { MUTANTS };
