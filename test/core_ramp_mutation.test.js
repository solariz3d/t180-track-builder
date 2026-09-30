// core_ramp_mutation.test.js: node --test test/core_ramp_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096; a minute or two)
// D194b: each mutant changes src/core/extend.js in ONE way (one exact string replacement, in a temporary copy of src/ and tools/), and test/core_ramp.test.js
// runs against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one test FAILED on the mutant. The CONTROL runs
// the whole file on an unmutated copy, so a copy that is missing a file cannot make every mutant look caught.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const X = 'core/extend.js';

const MUTANTS = [
  // (no mutant on Lof's map branch: a short-ramp channel's fitted curve is overwritten by rampControl, so the length it is fitted over cannot change the document;
  //  the mutant 'the map is ignored' is equivalent, found in the first run and left out on purpose)
  { id: "R2 'start' is the whole piece, not the first span", pattern: '2/3', edits: [[X, "const R = v === 'start' ? startRampM(length, knotM) : v;", "const R = v === 'start' ? length : v;"]] },
  { id: 'R3 startRampM is a fixed 20 m even on a short piece', pattern: '4 ·', edits: [[X, 'return K.length ? K[0] : length; }', 'return 20; }']] },
  { id: 'R4 the extra ramp knots are not added', pattern: '4 ·|2/3', edits: [[X, 'const knots = shortRamps.length ? rampKnots(length, shortRamps.map((ch) => ramp[ch]), knotM) : undefined;', 'const knots = undefined;']] },
  { id: 'R5 the short-ramp channel is left as the least-squares fit (it rings)', pattern: '2/3', edits: [[X, 'for (const ch of shortRamps) rampControl(', 'for (const ch of []) rampControl(']] },
  { id: 'R6 the ideal ramp is not compressed (the curve completes later than R)', pattern: '2/3', edits: [[X, 'Math.max(R - (2 * R) / RAMP_KNOTS, R / RAMP_KNOTS)', 'R']] },
  { id: 'R7 the Greville abscissae are shifted (the hold is not exact and the ramp lags)', pattern: '2 ·|2/3', edits: [[X, 'const xi = (U[i + 1] + U[i + 2] + U[i + 3]) / 3', 'const xi = (U[i] + U[i + 1] + U[i + 2]) / 3']] },
  { id: "R8 the joint's first two control points are overwritten too (C1 lost)", pattern: '3 ·|5 ·', edits: [[X, 'const P = piece.channels[ch], U = D.knotVector(piece), free = held ? 2 : 0, dec', 'const P = piece.channels[ch], U = D.knotVector(piece), free = 0, dec']] },
  { id: 'R9 the range clamp is dropped (a continued slope can carry the ramp past its target)', pattern: '3 ·', edits: [[X, 'v = Math.min(hi, Math.max(lo, f(xi)));', 'v = f(xi);']] },
  { id: 'R10 a ramp as long as the piece counts as short (the whole-piece blend is replaced)', pattern: '4 ·', edits: [[X, 'ramp[ch] < length - 1e-9 && targets[ch]', 'ramp[ch] <= length + 1e-9 && targets[ch]']] },
  { id: 'R11 a channel with no target still gets the ramp treatment', pattern: '4 ·', edits: [[X, 'ramp[ch] < length - 1e-9 && targets[ch] !== undefined && targets[ch] !== null', 'ramp[ch] < length - 1e-9']] },
  { id: 'R12 an unknown channel in the map is accepted', pattern: '6 ·', edits: [[X, "if (!D.CHANNELS.includes(ch)) throw new D.CoreError('BAD_TRANSITION', `the transition map has no channel", "if (false) throw new D.CoreError('BAD_TRANSITION', `the transition map has no channel"]] },
  { id: 'R13 a map value longer than the piece is accepted', pattern: '6 ·', edits: [[X, 'Number.isFinite(R) && R > 0 && R <= length', 'Number.isFinite(R) && R > 0']] },
  { id: 'R14 a map value of zero or less is accepted', pattern: '6 ·', edits: [[X, 'Number.isFinite(R) && R > 0 && R <= length', 'Number.isFinite(R) && R <= length']] },
  { id: 'R15 the number path no longer refuses a transition past the length', pattern: '6 ·|1 ·', edits: [[X, 'if (!(Lt > 0 && Lt <= length)) throw', 'if (!(Lt > 0)) throw']] },
  { id: 'R16 the number path uses a different default (half the piece) for no transition', pattern: '1 ·', edits: [[X, ': transition === undefined ? length : transition);', ': transition === undefined ? length / 2 : transition);']] },
  { id: 'R17 the ramp control points are not rounded to the channel quantum (the document would not round-trip)', pattern: '5 ·', edits: [[X, 'P[i] = Number(v.toFixed(dec)) + 0;', 'P[i] = v;']] },
];

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-ramp-mut-'));
  for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test')); fs.copyFileSync(path.join(__dirname, 'core_ramp.test.js'), path.join(dir, 'test', 'core_ramp.test.js'));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), path.join(dir, 'test', 'core_ramp.test.js')];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of core_ramp.test.js passes on an unmutated copy of src/ and tools/', () => {
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
