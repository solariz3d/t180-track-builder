// core_bank_corners_mutation.test.js: node --test test/core_bank_corners_mutation.test.js   (under the heavy-run lock; a minute or two)
// The bank's corners rounded as built (src/core/adapter.js bankPlan): each mutant changes that code in ONE way (one exact string replacement, in a temporary copy
// of src/, tools/ and app/), and test/core_bank_corners.test.js runs against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at
// least one test FAILED on the mutant. The CONTROL runs the whole file on an unmutated copy, so a copy missing a file cannot make every mutant look caught.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const AD = 'core/adapter.js';

const MUTANTS = [
  { id: 'C1 no corner is rounded', pattern: 'row 1|row 2', edits: [[AD, 'if (Math.abs(acc(k)) > BANK_BAR) over.push(k);', 'if (Math.abs(acc(k)) > BANK_BAR) void k;']] },
  { id: 'C2 a window never grows past its first try', pattern: 'row 1|row 2', edits: [[AD, 'H = Math.min(CORNER_MAX, H * 1.15);', 'break;']] },
  { id: 'C3 the bar is ten times looser', pattern: 'row 1|row 2', edits: [[AD, 'const BANK_BAR = 29.4 / (10 * 170 * 170);', 'const BANK_BAR = 10 * 29.4 / (10 * 170 * 170);']] },
  { id: 'C4 windows that would overlap are kept apart', pattern: 'row 1|row 2|row 3', edits: [[AD, 'if (q.a < p.b - 1e-9 && p.a >= lo - 1e-9 && p.b <= hi + 1e-9) {', 'if (false) {']] },
  { id: 'C6 the segments carry no roll rate, so each eases its roll to rest at its ends', pattern: 'row 6', edits: [[AD, '...rollRates(s0, s1), ', '']] },
  { id: 'C7 a window may cross a joint', pattern: 'row 7|row 8', edits: [[AD, 'const spanOf = (x) => {', 'const spanOf = (x) => [0, S[N - 1]], spanOf0 = (x) => {']] },
  { id: 'C8 a corner at a joint is rounded as if inside a piece', pattern: 'row 1|row 2|row 7|row 8', edits: [[AD, 'if (js.length) for (const j of js) {', 'if (false) for (const j of js) {'], [AD, '      if (js.length) continue;', '']] },
  { id: 'C13 a corner that reaches two pins is rounded at the first only', pattern: 'row 2', edits: [[AD, 'if (js.length) for (const j of js) {', 'if (js.length) for (const j of js.slice(0, 1)) {']] },
  { id: 'C9 the bank\'s own turning points are not pinned', pattern: 'row 9', edits: [[AD, 'if (!bounds.some((x) => Math.abs(x - t) < 1)) turns.push(t);', 'void t;']] },
  { id: 'C11 at a joint a window starts from whatever acceleration the bank has there', pattern: 'row 2|row 10', edits: [[AD, 'r2At = (x) => (isPin(x) ?', 'r2At = (x) => (isTurn(x) ?']] },
  { id: 'C12 a window that overshoots is used', pattern: 'row 2|row 10', edits: [[AD, '      const wild = qlo < lo - BANK_WILD || qhi > hi + BANK_WILD;', '      const wild = false;']] },
  { id: 'C14 a window may re-lay a turning road\'s bank by any amount', pattern: 'row 11', edits: [[AD, 'held: td > BANK_TURN_KEEP };', 'held: false };']] },
  { id: 'C10 a corner inside a piece is first tried where the runs meet, whether or not that covers it', pattern: 'row 2', edits: [[AD, 'let H = Math.max(H0, mid - S[k0] + BANK_DS, S[k1] - mid + BANK_DS), w, ok = null;', 'let H = H0, w, ok = null;']] },
  { id: 'C5 the cache keeps a piece whose corner the next piece rounds', pattern: 'row 5', edits: [[AD, "key: `${out[i].key}#${mine.map((w) => [w.a, w.b, ...w.c].join(',')).join(';')}`", 'key: out[i].key']] },
];

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-corner-mut-'));
  for (const d of ['src', 'tools', 'app']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true, filter: (p) => !/[\\/]app[\\/]test([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test', 'fixtures'), { recursive: true }); fs.copyFileSync(path.join(__dirname, 'core_bank_corners.test.js'), path.join(dir, 'test', 'core_bank_corners.test.js'));
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'), path.join(dir, 'test', 'fixtures', 'elysium-2026-10-22.t180track'));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), path.join(dir, 'test', 'core_bank_corners.test.js')];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000, windowsHide: true });
  const crashed = IR.crashesIn(tap);   // a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of core_bank_corners.test.js passes on an unmutated copy of src/, tools/ and app/', () => {
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
