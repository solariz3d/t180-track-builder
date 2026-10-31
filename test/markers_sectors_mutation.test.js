// markers_sectors_mutation.test.js: node --test test/markers_sectors_mutation.test.js   (under the heavy-run lock; about a minute)
// The sector gates' flat-road rule (src/markers/layout.js lapSectors and gateFlatAt, resolveLayout's omission note, src/markers/checks.js gate-width): each mutant changes it in ONE way, by
// an exact string replacement in a temporary copy of src/, tools/ and app/, and test/markers_sectors.test.js runs against the copy. "Applied" means the
// replaced string occurs EXACTLY once; "caught" means at least one of those tests FAILED on the mutant. The CONTROL runs the file on an unmutated copy, so a
// copy that is missing a file cannot make every mutant look caught.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILE = 'markers_sectors.test.js', FIXTURES = ['F1-bowl-default-lap-closed.core2.json', 'F3-bowl-narrow-12m-cap-binds.core2.json', 'elysium-2026-10-22.t180track'];

const MUTANTS = [
  { id: 'S1 the tilt test is dropped (a gate may stand across a bank)', edits: [['markers/layout.js', 'if (!(len > 0) || Math.abs(v[1]) / len > Math.sin(GATE_TILT_MAX_DEG * DEG)) return false;', 'if (!(len > 0)) return false;']] },
  { id: 'S2 the search looks one way only (forward from each third)', edits: [['markers/layout.js', 'for (const sg of d ? [1, -1] : [1])', 'for (const sg of [1])']] },
  { id: 'S3 an omitted gate is left out silently (no note)', edits: [['markers/layout.js', "if (a.omitted) { notes.push({ id: 'sector-omitted', level: 'amber', text: a.omitted }); return; }", 'if (a.omitted) return;']] },
  { id: 'S4 the markers check does not read a gate\'s width seen from above', edits: [['markers/checks.js', 'if (plan < GATE_TOPDOWN_MIN * width) p.push(', 'if (false) p.push(']] },
];

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-sectors-mut-'));
  for (const d of ['src', 'tools', 'app']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true, filter: (p) => !/[\\/]app[\\/]test([\\/]|$)/.test(p) });
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

test(`CONTROL: the whole of ${FILE} passes on an unmutated copy of src/, tools/ and app/`, () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 5 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS) {
  test(`mutant ${m.id}: applied, and caught by ${FILE}`, (t) => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = path.join(dir, 'src', file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
        assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in src/${file}: ${from.slice(0, 80)}`);
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
