// texture_flow_mutation.test.js: node --test test/texture_flow_mutation.test.js   (under the heavy-run lock; a minute or two)
// Each mutant changes src/texture/flow.js in ONE way (one exact string replacement, in a temporary copy of src/, tools/ and the app folders the texture
// controller loads), and test/texture_ring_width.test.js runs against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at
// least one test FAILED on the mutant. The CONTROL runs the whole file on an unmutated copy. A row's own section (W1, W2, W5) shows on an OPEN section only:
// on a closed ring u is n times each column's share of the circumference, which the start arc scales with the width.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const F = 'texture/flow.js';

const MUTANTS = [
  { id: 'W1 a row never takes the segment before\'s section (every row wears its own segment\'s end arc)', pattern: 'OPEN tube narrowing', edits: [[F, 'let startArc = n === 0 && prev', 'let startArc = false && prev']] },
  { id: 'W2 the first row takes the end arc after all', pattern: 'OPEN tube narrowing', edits: [[F, 'arc[k] = r === 0 ? startArc[k] :', 'arc[k] = r === 0 ? end[k] :']] },
  { id: 'W3 each ring row takes its own whole number of repeats again', pattern: 'every row of a closed ring run', edits: [[F, 'const n = ringN || Math.max(1, Math.round(w / tileWidth));', 'const n = Math.max(1, Math.round(w / tileWidth));']] },
  { id: 'W4 the run\'s n comes from its narrowest ring, not its median', pattern: 'widens into a long tube', edits: [[F, 'ws[(ws.length - 1) >> 1]', 'ws[0]']] },
  { id: 'W5 the section must move by a metre before a row takes its own start (no real change does)', pattern: 'OPEN tube narrowing', edits: [[F, 'const SAME_ARC_M = 1e-4;', 'const SAME_ARC_M = 1;']] },
  { id: 'W6 a row takes the segment before\'s arc even where the section has not moved (floating noise reaches the bytes)', pattern: 'the same bytes as before', edits: [[F, 'if (!(d > SAME_ARC_M)) startArc = null;', '']] },
];
const FILES = ['texture_ring_width.test.js'];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-flow-mut-'));
  for (const d of ['src', 'tools', 'app/core', 'app/lib', 'app/camera', 'app/validate-ui']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test')); for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'test', f));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=8192', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...FILES.map((f) => path.join(dir, 'test', f))];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const crashed = IR.crashesIn(tap);
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of texture_ring_width.test.js passes on an unmutated copy', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 6 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
