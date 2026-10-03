// core_chord_mutation.test.js: node --test test/core_chord_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096; a few minutes)
// D196: each mutant changes the legacy-chord code in ONE way (one exact string replacement, in a temporary copy of src/, tools/ and app/), and
// test/core_chord.test.js runs against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one test FAILED on the mutant.
// The CONTROL runs the whole file on an unmutated copy, so a copy that is missing a file cannot make every mutant look caught.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const AD = 'core/adapter.js';

const MUTANTS = [
  { id: 'K1 every segment counts as constant (no chord is ever drawn)', pattern: '2 ·|3 ·|4 ·|5 ·', edits: [[AD, 'const sameProfile = (A, B) => A.u.length === B.u.length &&', 'const sameProfile = (A, B) => true ||']] },
  { id: 'K2 no segment counts as constant (a chord everywhere, even on a constant width)', pattern: '1 ·', edits: [[AD, 'const sameProfile = (A, B) => A.u.length === B.u.length &&', 'const sameProfile = (A, B) => false &&']] },
  { id: 'K3 a chord\'s profile is the one at its START', pattern: '2 ·|3 ·|4 ·', edits: [[AD, 'return { profile: B, blend: { from: A, s0: 0, length }, start: A, end: B, chord: true };', 'return { profile: A, blend: { from: A, s0: 0, length }, start: A, end: B, chord: true };']] },
  { id: 'K4 a chord blends from its END profile (no change across the segment)', pattern: '2 ·|3 ·|4 ·', edits: [[AD, 'blend: { from: A, s0: 0, length }, start: A, end: B, chord: true }', 'blend: { from: B, s0: 0, length }, start: A, end: B, chord: true }']] },
  { id: 'K5 the segment is not marked as a chord (the readers do not evaluate its blend)', pattern: '4 ·', edits: [[AD, ': { cup: true }) : L.chord ? { chord: true } : {})', ': { cup: true }) : {})']] },
  { id: 'K6 a chord\'s blend runs over twice the segment (its end row is not the end profile)', pattern: '2 ·|3 ·', edits: [[AD, 'blend: { from: A, s0: 0, length }, start: A, end: B, chord: true }', 'blend: { from: A, s0: 0, length: length * 2 }, start: A, end: B, chord: true }']] },
  { id: 'K7 a chord\'s weight is already 1 at its start', pattern: '2 ·|3 ·', edits: [[AD, 'blend: { from: A, s0: 0, length }, start: A, end: B, chord: true }', 'blend: { from: A, s0: length, length }, start: A, end: B, chord: true }']] },
  { id: 'K8 the next piece and a flight take a chord\'s START as the last profile', pattern: '5 ·|3 ·', edits: [[AD, 'a = b; lastProfile = cup ? cup[j].end : L.end;', 'a = b; lastProfile = cup ? cup[j].end : L.start;']] },
  { id: 'K9 a legacy piece\'s first row for the seam fade is its END', pattern: '5 ·', edits: [[AD, 'const legacyFirst = (P) => legacyAt(P, 0).start;', 'const legacyFirst = (P) => legacyAt(P, 0).end;']] },
  { id: 'K10 a legacy piece\'s last row for the seam fade is its START', pattern: '5 ·', edits: [[AD, 'const legacyLast = (P) => legacyAt(P, nOf(P) - 1).end;', 'const legacyLast = (P) => legacyAt(P, nOf(P) - 1).start;']] },
  { id: 'K11 the same-cross-section tolerance is 10 m (a width change is called constant)', pattern: '2 ·|3 ·', edits: [[AD, 'Math.abs(x - B.u[i]) <= 1e-12', 'Math.abs(x - B.u[i]) <= 10']] },
  { id: 'K12 readsBlend leaves the chord out (readAt and the joint check take the target for the whole segment)', pattern: '4 ·', edits: [['geom/profile.js', 'return !!(seg && (seg.cup || seg.chord));', 'return !!(seg && seg.cup);']] },
  { id: 'K13 the water does not evaluate a chord\'s blend', pattern: '4 ·', edits: [['app/core/coreshell.js', 'return Prof.readsBlend(g) && g.blend ?', 'return false && g.blend ?']] },
  { id: 'K14 jointSteps looks at cup segments only (a chord joint is not inspected)', pattern: '4 ·', edits: [['geom/profile.js', 'if (!segments.some(readsBlend)) return [];', 'if (!segments.some((g) => g.cup)) return [];']] },
  { id: 'K15 a constant segment takes the profile at its END, not its middle (today\'s bytes change)', pattern: '1 ·', edits: [[AD, 'if (sameProfile(A, B)) { const p = profileAt(fam, mid.w, mid.r);', 'if (sameProfile(A, B)) { const p = profileAt(fam, b.w, b.r);']] },
];

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-chord-mut-'));
  for (const d of ['src', 'tools', 'app']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true, filter: (p) => !/[\\/]app[\\/]test([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test')); fs.copyFileSync(path.join(__dirname, 'core_chord.test.js'), path.join(dir, 'test', 'core_chord.test.js'));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), path.join(dir, 'test', 'core_chord.test.js')];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of core_chord.test.js passes on an unmutated copy of src/, tools/ and app/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests > 10 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS) {
  test(`mutant ${m.id}: applied, and caught by "${m.pattern}"`, (t) => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = file.startsWith('app/') ? path.join(dir, file) : path.join(dir, 'src', file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
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
