// core_turnby_mutation.test.js: node --test test/core_turnby_mutation.test.js   (under the heavy-run lock; a few minutes)
// Each mutant changes src/core/turnby.js in ONE way (one exact string replacement, in a temporary copy of src/ and tools/), and the turn and corner tests run
// against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one test FAILED on the mutant. The CONTROL runs the files
// whole on an unmutated copy, so a copy that is missing a file cannot make every mutant look caught. The whole file: the weights, the solve and its ease, the
// refusals and their lengths, the corner lists, the extra corners' rule (an extra is refused only below the knot floor, test/core_extra_corner.test.js) and the memos.
// No mutant on weightsTo and dense: neither is called anywhere (they are left from the corner lists before the extras were added on top), so no change to them can
// change a document.
// EQUIVALENT, found in the first run (2026-11-10) and left out on purpose: the CLOSING STEP of both solves (solve's and solveList's least-norm step, its tolerance, its
// iterations and the free columns it moves) never runs. The ease's height is solved exactly (the angle is linear in it), so what is left is the stored rounding of the
// control points: measured over these six files, 137 first checks, the largest 1.52e-7 rad against TURN_TOL 1e-5, and none over it (a counted copy of this file). So a
// tolerance of 1e-2, a step the wrong way, no step, the end's or the joint's points made free (freeOf is read only by that step, and its emptiness check is the same for
// every m that has a free point), or the step on every column: no document changes. Nor does searching the shortest length from one metre on: the length asked has
// already failed (extendBy), and cornerMinM starts at 1 m, which never has a free point.
// NOT CAUGHT, and kept out of the run so the harness stays a gate: "the ease ignores what the head still turning already turns" (A = aim / t1). The closing step
// then runs and makes the angle exact again, so the piece is exact, ends straight and does not dip, and only its shape between differs; nothing yet says what that
// shape must be from a head still turning (row 6 of core_turnby holds it symmetric from a straight head only).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const T = 'core/turnby.js';

const MUTANTS = [
  // the heading as weights on the control points (the adapter's trapezoid on its 2 m segments)
  { id: 'W1 the trapezoid drops the far end of each segment', pattern: 'row 2|row 4', edits: [[T, 'w[prev.first + k] += (h / 2) * prev.N[k]; w[cur.first + k] += (h / 2) * cur.N[k];', 'w[prev.first + k] += h * prev.N[k];']] },
  // the solve
  { id: "S5 a head still turning is cut off at once, not faded over the first half", pattern: 'row 4|row 3b', edits: [[T, 'base[i] = u < 0.5 ? k0 * (1 - bloss(2 * u)) : 0;', 'base[i] = 0;']] },
  { id: 'S6 the ease does not come back down (it holds its peak over the second half)', pattern: 'row 6|row 2 \\(C\\)|row 3 \\(C\\)', edits: [[T, 'u <= 0.5 ? bloss(2 * u) : bloss(2 - 2 * u));', 'u <= 0.5 ? bloss(2 * u) : 1);']] },
  { id: 'S9 a non-finite angle is solved anyway', pattern: 'row 9', edits: [[T, "if (!Number.isFinite(a)) throw new D.CoreError('BAD_TARGET', `${ch === 'kh' ? 'Turn by' : 'Climb by'} needs a finite angle", "if (false) throw new D.CoreError('BAD_TARGET', `${ch === 'kh' ? 'Turn by' : 'Climb by'} needs a finite angle"]] },
  // the refusal of a piece too short, and the length it names
  { id: 'B1 a turn too short is refused as a climb (the codes swapped)', pattern: 'row 5|L139 12', edits: [[T, "throw Object.assign(new D.CoreError(aims.kh !== undefined ? 'TURN_TOO_SHORT' : 'CLIMB_TOO_SHORT', need", "throw Object.assign(new D.CoreError(aims.kh !== undefined ? 'CLIMB_TOO_SHORT' : 'TURN_TOO_SHORT', need"]] },
  { id: "B3 the refusal names no length (needM dropped)", pattern: 'row 5', edits: [[T, "`a ${opts.length} m piece is too short to ${what} and ${ends}: it needs at least ${need} m`), { needM: need });", "`a ${opts.length} m piece is too short to ${what} and ${ends}: it needs at least ${need} m`), {});"]] },
  // THE EXTRA CORNERS' RULE (the user, 2026-11-10): refused only below the knot floor, as the first corner laid over that span would be
  { id: "C1 the route's comfort bar is back on an extra corner (31.5·√degrees)", pattern: 'row [2-7]:|L139 12|L139 R1|D642 3', edits: [[T, '  return cornerMinM(doc, opts);\n}', '  return Math.max(cornerMinM(doc, opts), 31.5 * Math.sqrt(Math.abs(deg)));\n}']] },
  { id: "C2 a corner's minimum with no number of degrees is answered", pattern: 'row 7', edits: [[T, "if (!Number.isFinite(deg)) throw new D.CoreError('BAD_TARGET', `a corner's minimum", "if (false) throw new D.CoreError('BAD_TARGET', `a corner's minimum"]] },
  { id: 'C3 an extra corner under the knot floor is not refused', pattern: 'row 6|L139 12|L139 R1|D642 3', edits: [[T, 'if (end - F < min - 1e-9) throw', 'if (false) throw']] },
  { id: 'C4 the refusal names a length 1 m over the floor', pattern: 'row 6', edits: [[T, "`), { needM: min });", "`), { needM: min + 1 });"]] },
  { id: 'C5 an extra corner AT the knot floor is refused', pattern: 'row 6|L139 12|L139 R1|D642 3', edits: [[T, 'if (end - F < min - 1e-9) throw', 'if (end - F < min + 1e-6) throw']] },
  { id: "C6 the floor is read for a different family's knots (always the bowl's)", pattern: 'row 6|row 7|L139 12', edits: [[T, "CORNER_MIN.set(key, shortestTurnBy(freeze(straight), { length: 1, family: fam,", "CORNER_MIN.set(key, 1 + shortestTurnBy(freeze(straight), { length: 1, family: fam,"]] },
  // the corner lists
  { id: 'L1 an extra corner in degrees is laid as radians', pattern: 'row [2-5]|L139 (9|10|11) |D642 2', edits: [[T, 'marks.push(F); angles.push((deg * Math.PI) / 180);', 'marks.push(F); angles.push(deg);']] },
  { id: 'L2 a mark at the piece\'s start is accepted', pattern: 'L139 13|row 10', edits: [[T, 'if (!(Number.isFinite(F) && F > lo && F < L))', 'if (!(Number.isFinite(F) && F >= lo && F < L))']] },
  { id: 'L3 an extra corner of 0 at the end is laid anyway (its knots move the bytes)', pattern: 'D642 1a|D642 1b|L139 14', edits: [[T, 'while (marks.length && angles[angles.length - 1] === 0) { marks.pop(); angles.pop(); }', '']] },
  // solveList: the extras added over their own spans
  { id: 'SL1 an extra rides every basis function, not only those inside its span (it leaks before its mark)', pattern: 'row 2|D642 2a|D642 2b', edits: [[T, 'U[i] >= b[j] - 1e-9 && U[i + 4] <= b[j + 1] + 1e-9 ? ', 'true ? ']] },
  { id: "SL4 no knots are inserted across the extras' spans", pattern: 'row 6|L139 R1|D642 3', edits: [[T, 'const P = add.length ? D.insertKnots(P0, add) : P0,', 'const P = P0,']] },
  { id: 'SL5 the whole change aimed at is the first corner alone (the extras are not counted)', pattern: 'row [2-5]|L139 (9|10|11) |D642 2', edits: [[T, 'want[ch] = angles.reduce((x, y) => x + y, 0);', 'want[ch] = angles[0];']] },
  { id: 'SL6 each extra turns half its own angle (a later one takes up the rest)', pattern: 'L139 (9|10) |D642 2a', edits: [[T, 'const Aj = angles[j + 1] / t1;', 'const Aj = angles[j + 1] / t1 / 2;']] },
  // the corner read from the fields, and the memos
  { id: 'O1 a corner in degrees is aimed at as radians', pattern: 'row|L139', edits: [[T, 'aims[ch] = (v * Math.PI) / 180;', 'aims[ch] = v;']] },
  { id: 'O2 Turn by drops a climb typed as a corner', pattern: 'row 2b', edits: [[T, '...(opts && Number.isFinite(opts.climbDeg) ? { kv: (opts.climbDeg * Math.PI) / 180 } : {})', '...{}']] },
  { id: "O3 the corner's answers are kept by the document alone (a new extra gets the last one's piece)", pattern: 'row 11', edits: [[T, 'let memo = key === null || !keepable(doc) ? null : MEMO.get(doc);\n  if (memo && memo.has(key)) return memo.get(key);\n  const out = cornerOf(doc, opts);', 'let memo = key === null || !keepable(doc) ? null : MEMO.get(doc);\n  if (memo && memo.size) return memo.values().next().value;\n  const out = cornerOf(doc, opts);']] },
];
const FILES = ['core_extra_corner.test.js', 'core_turnby.test.js', 'turn_corner.test.js', 'climb_corner.test.js', 'core_changes.test.js', 'core_additive.test.js'];
const FIXTURES = ['extra-turn-short-2026-11-10.t180track'];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-turnby-mut-'));
  for (const d of ['src', 'tools', 'app/core', 'app/camera', 'app/lib', 'app/validate-ui', 'app/preview']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });   // core_changes reads the panel's extendOptions
  fs.mkdirSync(path.join(dir, 'test', 'fixtures'), { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'test', f));
  for (const f of FIXTURES) fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(dir, 'test', 'fixtures', f));
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
test('CONTROL: the turn and corner test files pass whole on an unmutated copy of src/ and tools/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests > 80 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
