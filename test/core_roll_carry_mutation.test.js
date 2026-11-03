// core_roll_carry_mutation.test.js: node --test test/core_roll_carry_mutation.test.js   (under the heavy-run lock; a minute or two)
// The roll carried through a joint (src/core/adapter.js carryOf, carriedPhiOf): each mutant changes that code in ONE way (one exact string replacement, in a
// temporary copy of src/, tools/ and app/), and test/core_roll_carry.test.js runs against the copy. "Applied" means the replaced string occurs EXACTLY once;
// "caught" means at least one test FAILED on the mutant. The CONTROL runs the whole file on an unmutated copy, so a copy missing a file cannot make every mutant
// look caught.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const AD = 'core/adapter.js';

const MUTANTS = [
  { id: 'R1 no joint is ever carried', pattern: 'row 1', edits: [[AD, "if (!A || !B || A.type !== 'road' || B.type !== 'road' || A.tube || B.tube) return null;", 'return null;']] },
  { id: 'R2 every joint between two roads is carried (a roll that turns back, a bank held)', pattern: 'row 4', edits: [[AD, 'const A = doc.pieces[i], B = doc.pieces[i + 1];', "const A = doc.pieces[i], B = doc.pieces[i + 1]; if (A && B && A.type === 'road' && B.type === 'road') return { r: 0, key: '0' };"]] },
  { id: 'R3 the roll passes the joint at rest', pattern: 'row 1|row 3', edits: [[AD, 'const r = (deltaOf(A) + deltaOf(B)) / (A.length + B.length);', 'const r = 0 * (deltaOf(A) + deltaOf(B)) / (A.length + B.length);']] },
  { id: 'R4 the next piece\'s first half is not carried', pattern: 'row 1|row 3', edits: [[AD, 'return (s) => (s <= h ? quinticAt(c, s / h) : null);', 'return () => null;']] },
  { id: 'R5 a piece carried at both ends starts from rest', pattern: 'row 1|row 3', edits: [[AD, 'const c = [v0, left.r * L, 0, 0, right.r * L, v1];', 'const c = [v0, 0, 0, 0, right.r * L, v1];']] },
  { id: 'R6 the carried half ends at rest', pattern: 'row 1|row 3', edits: [[AD, 'const c = [m.v, m.d1 * h, m.d2 * h * h, 0, right.r * h, v1];', 'const c = [m.v, m.d1 * h, m.d2 * h * h, 0, 0, v1];']] },
  { id: 'R7 the carried half ignores the bank as built at its middle', pattern: 'row 2|row 3', edits: [[AD, 'const c = [m.v, m.d1 * h, m.d2 * h * h, 0, right.r * h, v1];', 'const c = [m.v, 0, 0, 0, right.r * h, v1];']] },
  // AMENDED BY NAME (2026-11-03): the cache key is now the bank plan's (adapter.js bankPlan), which holds the carry key; the same mutation, emptying that key, re-anchored
  { id: 'R9 the cache keeps a piece built before its next one carried it', pattern: 'row 5', edits: [[AD, '`${pi === 0}|${plan[pi].key}`', '`${pi === 0}|`']] },
];

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-carry-mut-'));
  for (const d of ['src', 'tools', 'app']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true, filter: (p) => !/[\\/]app[\\/]test([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test')); fs.copyFileSync(path.join(__dirname, 'core_roll_carry.test.js'), path.join(dir, 'test', 'core_roll_carry.test.js'));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), path.join(dir, 'test', 'core_roll_carry.test.js')];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000, windowsHide: true });
  const crashed = IR.crashesIn(tap);   // a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of core_roll_carry.test.js passes on an unmutated copy of src/, tools/ and app/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 5 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in)', () => {
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
