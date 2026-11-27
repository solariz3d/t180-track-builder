// core_width_hold_mutation.test.js: node --test test/core_width_hold_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// L264, THE WIDTH HOLDS AFTER A BRUSH, L268, THE HOLD LAID AS A SHORT RAMP (rampControl), not fitted, and D678, THE HOLD LAID LAST (its knots inserted after every other
// channel, and after Turn by's solve): each mutant changes the hold's lines in src/core/extend.js or src/core/turnby.js in ONE way (one exact string replacement, in a temporary copy of src/, tools/ and
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
const EX = 'src/core/extend.js', TB = 'src/core/turnby.js';

const MUTANTS = [
  { id: 'H1 the width is never held: it goes on at the brush\'s slope, as before L264', edits: [[EX, 'const holdW = held && !given(targets.w) && from.w.m !== 0 ? from.w.v : undefined, holdR', 'const holdW = undefined, holdR']] },
  { id: 'H5 a typed width is held at the head\'s width instead', edits: [[EX, 'held && !given(targets.w) && from.w.m', 'held && from.w.m']] },
  // D678 (E's read of L268, F4; the librarian's ruling: the path a Turn or a Sharp lays must not depend on whether the width was still changing at the head):
  // the hold's knots are INSERTED (layHold) after every other channel is laid, and after Turn by's solve and the corner list's knots
  { id: "D1 Turn by and the corner list solve their turn on the hold's knots again (extend lays the hold whatever widthHold says)", edits: [[EX, "if (hold && opts.widthHold !== 'later')", 'if (hold)']] },
  { id: "D2 Sharp's turn is laid on the hold's knots again (the hold's ramp joins a short ramp's knots, as at L268)", edits: [[EX, 'shortRamps.length ? rampKnots(length, shortRamps.map((ch) => ramp[ch]), knotM, sub) :', 'shortRamps.length ? rampKnots(length, [...shortRamps.map((ch) => ramp[ch]), ...(hold ? [hold.R] : [])], knotM, sub) :']] },
  { id: "D3 extend never lays the hold (the placeholder, L264's fitted hold, is left)", edits: [[EX, "if (hold && opts.widthHold !== 'later') laid = layHold(laid, hold);", '']] },
  { id: "D4 the hold's knots are not inserted (the width laid on the piece's own knots)", edits: [[EX, 'const P = ts.length ? D.insertKnots(piece, ts) : piece,', 'const P = piece,']] },
  { id: "D5 the joint is not held: rampControl overwrites the head's value and slope too", edits: [[EX, "rampControl(Q, 'w', h.from, h.w, h.R, true, h.sub);", "rampControl(Q, 'w', h.from, h.w, h.R, false, h.sub);"]] },
  { id: "D6 the hold's ramp is the whole piece, not the first knot span", edits: [[EX, '{ from: from.w, w: holdW, R: holdR, sub }', '{ from: from.w, w: holdW, R: length, sub }']] },
  { id: "D7 Turn by is told of no hold (extend's plan returns none)", edits: [[EX, "if (opts.widthHold === 'plan') return hold;", "if (opts.widthHold === 'plan') return null;"]] },
  { id: "D8 Turn by never lays the hold after its solve", edits: [[TB, 'const withHold = (d, hold) => (hold ?', 'const withHold = (d, hold) => (false ?']] },
  { id: "D9 the corner list lays the hold before its corners' knots go in", edits: [[TB, 'extendBy(doc, opts, aims, true), P0', '({ doc: extendBy(doc, opts, aims), hold: null }), P0']] },
  { id: "D10 the corner list never lays the hold", edits: [[TB, 'if (r.converged) return withHold(r.doc, r.hold);', 'if (r.converged) return r.doc;']] },
  // LEFT OUT (L264, pane B): 'a level head is held too' (`&& from.w.m !== 0` taken out) is EQUIVALENT: at a level head the hold's target is the head's own width
  // and its slope is 0, so every control point is that width, which is what going on at a slope of 0 lays (pane B's scratch h6check.js: every row passes on it,
  // at L264 and again at L268). The condition is kept so that a level head is not touched by construction, not by rounding.
  // LEFT OUT (L268, pane B): L264's H2 (the hold's blend spread over the whole piece) and H4 (the blend starting level) are EQUIVALENT now: they change only the
  // width function roadPiece fits, and rampControl then overwrites every free control point (the first two carry the head's value and slope from `from`, not
  // from that function), so the piece is the same (precheck268.txt: 8 of 8 rows pass on each). L264's H3 and H6 mutated the end pin, which L268 removed
  // (rampControl ends the hold at the head's width itself: pincheck.txt: with the pin out, the last two control points exact on all 8 paths tried: plain, two shaped banks,
  // a flowing bank, a second bank, changes on the bank and cup, a cup on 30 m, an edge at start).
  // RETIRED (D678, pane B): L268's N1 to N6. Their lines are gone: the hold's knots are no longer merged into the piece's (N2, N3 and rampKnots' `base`, N6), and
  // the width is laid on them by layHold, whose mutants D3 to D6 are N1, N4 and N5 on the new lines.
  // D11 (D678, pane B) was first LEFT OUT here as EQUIVALENT, on ripple268's 110 rows laying the same width without it (resetcheck678.js), and the line removed.
  // That was wrong: E's d678 heads laid a different width in 64 of 610 rows without it (the insertion carries the placeholder's pair onto the new first knot and
  // rounds it a second time: one step of w, resetstep678.js), so the line is back and the held-pair row in core-width-hold.test.js reads what it does.
  { id: "D11 the held pair is not set again on the new first knot (the insertion's twice-rounded pair is kept)", edits: [[EX, 'w[0] = Number(h.from.v.toFixed(D.DEC.w)) + 0; w[1] = Number((h.from.v + (h.from.m * K0) / 3).toFixed(D.DEC.w)) + 0;', '']] },
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
