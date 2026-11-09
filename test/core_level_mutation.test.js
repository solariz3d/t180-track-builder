// core_level_mutation.test.js: node --test test/core_level_mutation.test.js   (under the heavy-run lock; a minute or two)
// Each mutant changes src/core/level.js in ONE way (one exact string replacement, in a temporary copy of src/ and tools/), and the Level tests run against
// the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one test FAILED on the mutant. The CONTROL runs the files
// whole on an unmutated copy, so a copy that is missing a file cannot make every mutant look caught.
// Equivalent, left out on purpose: the next piece's re-join carries the levelled end's slope on (value + slope·span/3), but levelEnd always ends with
// rate 0 and slope 0, so a mutant of the span or the divisor there cannot change a document.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const LV = 'core/level.js';

const MUTANTS = [
  // levelEnd
  { id: 'E1 the levelled piece keeps its end slope (only the rate is set to 0)', pattern: 'row 1|row 4', edits: [[LV, 'let c = Float64Array.from(P.channels.kv); c[m - 1] = 0; c[m - 2] = 0;', 'let c = Float64Array.from(P.channels.kv); c[m - 1] = 0;']] },
  { id: 'E2 the flipped frame is ignored (the correction goes the wrong way past the top of a loop)', pattern: 'row 5', edits: [[LV, 'sgn = flipOf(before) ? -1 : 1;', 'sgn = 1;']] },
  { id: 'E3 the pitch is read from the track\'s start, not the end of the piece before', pattern: 'row 1|row 4', edits: [[LV, 'head = headOf(before), sgn', 'head = headOf({ ...doc, pieces: [] }), sgn']] },
  { id: 'E4 the next piece is not re-joined (its joint keeps the old climb)', pattern: 'row 4', edits: [[LV, "if (N && N.type === 'road') {", 'if (false) {']] },
  { id: 'E5 the step goes the wrong way', pattern: 'row 1', edits: [[LV, 'c = Float64Array.from(c, (x, k) => q(x + dl[k], D.DEC.kv));', 'c = Float64Array.from(c, (x, k) => q(x - dl[k], D.DEC.kv));']] },
  { id: 'E6 the climb is not quantised as stored (a save and a load change it)', pattern: 'row 9', edits: [[LV, 'c = Float64Array.from(c, (x, k) => q(x + dl[k], D.DEC.kv));', 'c = Float64Array.from(c, (x, k) => x + dl[k]);']] },
  { id: 'E7 an index one past the last piece is accepted', pattern: 'row 7', edits: [[LV, 'if (!Number.isInteger(i) || i < 0 || i >= n)', 'if (!Number.isInteger(i) || i < 0 || i > n)']] },
  { id: 'E8 a fractional index is accepted', pattern: 'row 7', edits: [[LV, 'if (!Number.isInteger(i) || i < 0 || i >= n)', 'if (i < 0 || i >= n)']] },
  { id: 'E9 a flight is levelled as if it were road', pattern: 'row 7', edits: [[LV, "if (P.type !== 'road') throw new D.CoreError('LEVEL_NOT_ROAD'", "if (false) throw new D.CoreError('LEVEL_NOT_ROAD'"]] },
  { id: 'E10 a closed loop is levelled (its seam opens)', pattern: 'row 7', edits: [[LV, "if (doc.closed) throw new D.CoreError('CLOSED', 'the loop is closed: levelling a piece", "if (false) throw new D.CoreError('CLOSED', 'the loop is closed: levelling a piece"]] },
  { id: 'E11 the joint\'s first two control points are free too (C1 with the piece before is lost)', pattern: 'row 3|row 1', edits: [[LV, 'for (let i = 2; i <= m - 3; i++) free.push(i);', 'for (let i = 0; i <= m - 3; i++) free.push(i);']] },
  { id: 'E12 the end\'s two control points are free too (it no longer ends straight)', pattern: 'row 1', edits: [[LV, 'for (let i = 2; i <= m - 3; i++) free.push(i);', 'for (let i = 2; i <= m - 1; i++) free.push(i);']] },
  { id: 'E13 a piece with no free point is not refused by name', pattern: 'row 6', edits: [[LV, "if (!free.length) throw new D.CoreError('LEVEL_TOO_SHORT'", "if (false) throw new D.CoreError('LEVEL_TOO_SHORT'"]] },
  // Level as Extend
  { id: 'X1 a climb read as a corner is refused again', pattern: 'row 8', edits: [[LV, 'const { climbDeg, ...given } = opts;', "if ('climbDeg' in opts) throw new D.CoreError('CLIMB_AS_CORNER', 'refused'); const given = opts;"]] },
  { id: 'X2 Level as Extend ignores the flipped frame', pattern: 'flipped-frame end', edits: [[LV, 'const sgn = (flip === null ? flipOf(doc) : flip) ? -1 : 1;', 'const sgn = 1;']] },
  { id: 'X3 To floor places a piece that did not reach the floor', pattern: 'row 3', edits: [[LV, 'if (r.converged && r.crest >= 0) return r.doc;', 'return r.doc;']] },
];
const FILES = ['core_level.test.js', 'core_level_end.test.js', 'core_close_flip.test.js'];
const HELPERS = ['core_close_flip_lap.js'];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-level-mut-'));
  for (const d of ['src', 'tools', 'app/core', 'app/camera', 'app/lib', 'app/validate-ui', 'app/preview']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });   // the shell (core_level row 8) loads the app folders
  fs.mkdirSync(path.join(dir, 'test', 'fixtures'), { recursive: true });
  for (const f of [...FILES, ...HELPERS]) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'test', f));
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'level-end-2026-11-09.t180track'), path.join(dir, 'test', 'fixtures', 'level-end-2026-11-09.t180track'));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...FILES.map((f) => path.join(dir, 'test', f))];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000, windowsHide: true });
  const crashed = IR.crashesIn(tap);   // a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the Level test files pass whole on an unmutated copy of src/ and tools/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests > 20 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
