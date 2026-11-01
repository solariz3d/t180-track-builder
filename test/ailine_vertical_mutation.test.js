// ailine_vertical_mutation.test.js: node --test test/ailine_vertical_mutation.test.js   (under the heavy-run lock; a few minutes)
// A road that goes vertical has no AI line (src/export/ailine.js generateAiLine VERTICAL_TANGENT; src/export/fromwords.js and layouts.js leave the file out;
// app/core/exportwords.js says so): each mutant changes it in ONE way, by an exact string replacement in a temporary copy of src/, tools/, app/ and scripts/,
// and test/ailine_vertical.test.js runs against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one of those
// tests FAILED on the mutant. The CONTROL runs the file on an unmutated copy, so a copy that is missing a file cannot make every mutant look caught.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILE = 'ailine_vertical.test.js', FIXTURES = ['F1-bowl-default-lap-closed.core2.json'];

const MUTANTS = [
  { id: 'V1 the vertical test is dropped (the line is written with a camber of ±π)', edits: [['src/export/ailine.js', "if (Math.hypot(fwd[0], fwd[2]) < Math.sin(VERTICAL_DEG * DEG) && Math.hypot(fwd[0], fwd[1], fwd[2]) > 0) throw", 'if (false) throw']] },
  { id: 'V2 the test reads the wrong axis (x and y, not the horizontal x and z)', edits: [['src/export/ailine.js', 'if (Math.hypot(fwd[0], fwd[2]) < Math.sin(VERTICAL_DEG * DEG)', 'if (Math.hypot(fwd[0], fwd[1]) < Math.sin(VERTICAL_DEG * DEG)']] },
  { id: 'V3 the bar is 1° from vertical, not 6°', edits: [['src/export/ailine.js', 'const VERTICAL_DEG = 6;', 'const VERTICAL_DEG = 1;']] },
  { id: 'V4 the bar is 15° from vertical (refuses ordinary steep roads)', edits: [['src/export/ailine.js', 'const VERTICAL_DEG = 6;', 'const VERTICAL_DEG = 15;']] },
  { id: 'V5 the export does not catch the refusal (it fails instead of finishing)', edits: [['src/export/fromwords.js', "catch (e) { if (e.code !== 'VERTICAL_TANGENT') throw e; warnings.push(`${NO_AI_LINE} (${e.message})`); }", 'catch (e) { throw e; }']] },
  { id: 'V6 the export finishes without saying why', edits: [['src/export/fromwords.js', 'warnings.push(`${NO_AI_LINE} (${e.message})`);', '']] },
  { id: 'V7 the folder writes an AI line it does not have', edits: [['src/export/fromwords.js', "  if (b.ai) {   // none when the road goes vertical (buildFromSegments)", '  if (true) {']] },
  { id: 'V8 the layout folder lists an AI line it does not have', edits: [['src/export/layouts.js', "...(b.ai ? { [`${L}/ai/fast_lane.ai`]: b.ai } : {}),", '[`${L}/ai/fast_lane.ai`]: b.ai,']] },
  { id: 'V9 the banner shows the builders\' note, not the words', edits: [['app/core/exportwords.js', "if (/^no-ai-line:/.test(s)) return 'this track goes vertical, so it has no AI line; it drives and times normally';", '']] },
];

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-vertical-mut-'));
  for (const d of ['src', 'tools', 'app', 'scripts']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true, filter: (p) => !/[\\/]app[\\/]test([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test', 'fixtures'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, FILE), path.join(dir, 'test', FILE));
  for (const f of FIXTURES) fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(dir, 'test', 'fixtures', f));
  return dir;
}
function runTests(dir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), '--test', path.join(dir, 'test', FILE)], { cwd: dir, env, encoding: 'utf8', timeout: 10 * 60 * 1000 });
  const crashed = IR.crashesIn(tap);
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), out };
}

test(`CONTROL: the whole of ${FILE} passes on an unmutated copy of src/, tools/, app/ and scripts/`, () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 6 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS) {
  test(`mutant ${m.id}: applied, and caught by ${FILE}`, (t) => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = path.join(dir, file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
        assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in ${file}: ${from.slice(0, 80)}`);
        fs.writeFileSync(f, src.replace(from, () => to));
      }
      const r = runTests(dir);
      t.diagnostic(`${m.id}: ${r.fail} of ${r.tests} tests failed`);
      assert.ok(r.tests > 0, 'no test ran');
      assert.ok(r.fail > 0, `NOT CAUGHT: ${r.pass} pass, 0 fail`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
module.exports = { MUTANTS };
