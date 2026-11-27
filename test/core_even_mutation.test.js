// core_even_mutation.test.js: node --test test/core_even_mutation.test.js   (under the heavy-run lock; a few minutes)
// Each mutant changes src/core/even.js or the shell's Even (app/core/coreshell.js) in ONE way (one exact string replacement, in a temporary copy of src/, tools/ and
// the app folders the shell loads), and the Even rows run against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one
// test FAILED on the mutant. The CONTROL runs the files whole on an unmutated copy, so a copy missing a file cannot make every mutant look caught. A crashed inner
// run reads NOT TESTED (test/inner_run.js, D352).
// Left out on purpose: the fitted height's own quantising (settle quantises every changed value as it builds the joints, so a mutant there changes no document);
// and the banked rows from the width brush's starts (app/test/sculpt-even-banked.test.js), which take minutes per start: the core's K2 and K3 rows from the
// untouched road cover the same lines.
// Left out after they were run (D678; the numbers are scratch measures beside the hand-back): H6, the height fit not carrying a whole joint from the piece before,
// changes the height by at most 0.0019 m on the fixtures and a 31 m straight into a banked turn, and K3 by under 0.0004 m (either way), so no row at the 0.01 m
// bar can see it; H7, the fit freeing a joint the window covers in part, changes nothing on any of them (no window end falls in a joint's last spans); S6, a typed
// width with no run selected, is refused by the core as well (EVEN_RUN for a run of undefined), so the shell's own check is a second guard, not a behaviour.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const EV = 'src/core/even.js', CS = 'app/core/coreshell.js';
const CORE = ['test/core_even.test.js'], SHELL = ['app/test/sculpt-even.test.js'];

const MUTANTS = [
  // the held rim and the centre
  { id: 'H1 the held rim\'s reference eases from a window end still in a taper (the registered C1b rule, U4)', pattern: 'F1-F7: from T1', files: SHELL, edits: [[EV, 'if (ma === mb) return easeOf(doc, off, ch, win);', 'return easeOf(doc, off, ch, win);']] },
  { id: 'H2 the held rim is read on the other side of the section', pattern: 'rim held|K2 and K3', edits: [[EV, 'PR.offsetAt(X, side > 0 ? E[1] : E[0])', 'PR.offsetAt(X, side > 0 ? E[0] : E[1])']] },
  { id: 'H3 the held rim is read unturned by the bank (flat-road arithmetic on a banked road)', pattern: 'K2 and K3', edits: [[EV, 'return o[0] * Math.cos(phi) - o[1] * Math.sin(phi);', 'return o[0];']] },
  { id: 'H4 the centre does not rise or fall with the bank as it moves sideways', pattern: 'K2 and K3', edits: [[EV, '+ Math.tan(phiAt(s)) * (', '+ 0 * (']] },
  { id: 'H5 the centre moves in the plane of the bank channel, not the road as built (call 10)', pattern: 'K2 and K3', edits: [[EV, "const phiAt = (s) => { const a = pieceAt(doc, off, s); return builtPhi(doc, plan, a.p, a.sl); };", "const phiAt = (s) => { const a = pieceAt(doc, off, s); return D.channelAt(doc.pieces[a.p], 'phi', a.sl).v; };"]] },
  { id: 'H9 the held rim is read back from the window\'s ends even where they disagree (the road\'s own width changing across the window)', pattern: 'changes across', edits: [[EV, 'one = [rw, rl].every((f) => Math.abs(f(w0) - f(w1)) <= EVEN_AGREE_M);', 'one = true;']] },
  { id: 'H8 the centre is not moved to hold the rim (hold is read as centre)', pattern: 'rim held', edits: [[EV, "const side = hold === 'left' ? 1 : hold === 'right' ? -1 : 0;", 'const side = 0;']] },
  // the window and the width
  { id: 'W1 no margin at the value beyond the run (its first span still ramping)', pattern: 'first metre|one piece', edits: [[EV, 'let vlo = lo - margin, w0', 'let vlo = lo, w0'], [EV, 'const win = { lo: vlo, hi: hi + margin, ramp, w0, w1 };', 'const win = { lo: vlo, hi, ramp, w0, w1 };']] },
  { id: 'W5 the window does not reach back over a coarse piece before the run (the carry side: its last span\'s slope carried into the run)', pattern: 'coarse knots', edits: [[EV, "if (PV && PV.type === 'road' && SC.isLinked(doc, pv, from, 'w')) {", 'if (false) {']] },
  { id: 'W2 the ramp is a step: every control point in the window set to the value', pattern: 'one piece|designed ease', edits: [[EV, 'ctrl[i] = c[i] + g * (v - c[i]); changed.push(i);', 'ctrl[i] = v; changed.push(i);']] },
  { id: 'W3 the window is not stopped at the open end', pattern: 'open end', edits: [[EV, 'w0 = Math.max(0, w0); w1 = Math.min(L, w1);', '']] },
  { id: 'W4 the bank is levelled too', pattern: 'K5', edits: [[EV, 'const d1 = levelTo(doc, { w: value }, win);', 'const d1 = levelTo(doc, { w: value, phi: 0 }, win);']] },
  // refusals by name
  { id: 'R1 a closed lap\'s start line inside the window is not refused', pattern: 'closed lap', edits: [[EV, 'if (doc.closed && (w0 < 0 || w1 > L)) refuse(', 'if (false) refuse(']] },
  { id: 'R2 a run across the start line is refused as no run, not by the line', pattern: 'closed lap', edits: [[EV, 'if (doc.closed && Number.isInteger(from) && Number.isInteger(to) && from > to', 'if (false && Number.isInteger(from) && Number.isInteger(to) && from > to']] },
  { id: 'R3 a jump within reach is not refused', pattern: 'jump', edits: [[EV, "if (P.type === 'flight') refuse('EVEN_JUMP'", "if (false) refuse('EVEN_JUMP'"]] },
  { id: 'R4 a tube is not refused', pattern: 'tube', edits: [[EV, "if (D.kindOf(P) === 'tube') refuse(", 'if (false) refuse(']] },
  { id: 'R5 a split width is not refused', pattern: 'tube', edits: [[EV, 'if (D.isWidthSplit(P)) refuse(', 'if (false) refuse(']] },
  { id: 'R6 a width under 0.5 m is taken', pattern: 'refuses by name, and changes nothing', edits: [[EV, 'if (value < EVEN_MIN_M || value > EVEN_MAX_M)', 'if (value < 0 || value > EVEN_MAX_M)']] },
  { id: 'R7 a width over 400 m is taken', pattern: 'refuses by name, and changes nothing', edits: [[EV, 'if (value < EVEN_MIN_M || value > EVEN_MAX_M)', 'if (value < EVEN_MIN_M)']] },
  { id: 'R8 a width that is not a number is taken', pattern: 'refuses by name, and changes nothing', edits: [[EV, "if (!isNum(value)) refuse('EVEN_VALUE'", "if (value == null) refuse('EVEN_VALUE'"]] },
  { id: 'R9 a run that ends on a jump is taken', pattern: 'jump', edits: [[EV, "if (doc.pieces[from].type !== 'road' || doc.pieces[to].type !== 'road') refuse(", 'if (false) refuse(']] },
  // the shell
  { id: 'S1 the drag is not snapped to 0.5 m', pattern: 'snaps', files: SHELL, edits: [[CS, 'Math.round((b.value0 + delta) / EV.EVEN_SNAP_M) * EV.EVEN_SNAP_M', '(b.value0 + delta)']] },
  { id: 'S2 the typed width is snapped', pattern: 'typed', files: SHELL, edits: [[CS, "const v = typeof value === 'string' ? Number(value) : value;", 'const v = Math.round(Number(value) / EV.EVEN_SNAP_M) * EV.EVEN_SNAP_M;']] },
  { id: 'S3 the drag drops the run\'s selection (its handles go)', pattern: 'snaps', files: SHELL, edits: [[CS, "(b.sculpt || b.mode === 'follow' || b.mode === 'even') && st.selection", "(b.sculpt || b.mode === 'follow') && st.selection"]] },
  { id: 'S4 a jump within reach opens the drag anyway', pattern: 'refuses by name and changes nothing', files: SHELL, edits: [[CS, "if (T.mode === 'even' && attempt(() => EV.evenWindow(", "if (false && attempt(() => EV.evenWindow("]] },
  { id: 'S5 the drag forgets the rim it holds (both rims move)', pattern: 'snaps', files: SHELL, edits: [[CS, 'value: evenValue(b, delta), hold: b.hold });', "value: evenValue(b, delta), hold: 'centre' });"]] },
];
const FILES = [...CORE, ...SHELL];
const HELPERS = ['test/even_fixtures.js', 'test/inner_run.js'];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-even-mut-'));
  for (const d of ['src', 'tools', 'app/core', 'app/camera', 'app/lib', 'app/validate-ui', 'app/preview', 'app/export', 'app/share', 'app/testhook', 'app/menubar', 'app/texture', 'app/settings.js', 'app/index.html'])
    if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  for (const f of [...FILES, ...HELPERS]) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); }
  return dir;
}
function runTests(dir, pattern, files = FILES) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...files.map((f) => path.join(dir, f))];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000, windowsHide: true });
  const crashed = IR.crashesIn(tap);
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: core_even.test.js and sculpt-even.test.js pass whole on an unmutated copy', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 20 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in, D352)', () => {
  const m0 = MUTANTS[0], dir = tree();
  try {
    const f = path.join(dir, m0.edits[0][0]);
    fs.writeFileSync(f, IR.STANDIN + fs.readFileSync(f, 'utf8'));
    const said = IR.reading(() => { const r = runTests(dir, m0.pattern, m0.files || CORE); return r.fail > 0 ? `caught: ${r.fail} of ${r.tests} failed` : `NOT CAUGHT: ${r.pass} pass, 0 fail`; });
    assert.match(said, IR.NOT_TESTED);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS) {
  test(`mutant ${m.id}: applied, and caught by "${m.pattern}"`, (t) => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = path.join(dir, file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
        assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in ${file}: ${from.slice(0, 80)}`);
        fs.writeFileSync(f, src.replace(from, () => to));
      }
      const r = runTests(dir, m.pattern, m.files || CORE);
      t.diagnostic(`${m.id}: ${r.fail} of ${r.tests - r.skipped} run tests failed`);
      assert.ok(r.tests - r.skipped > 0, `the pattern "${m.pattern}" ran no test`);
      assert.ok(r.fail > 0, `NOT CAUGHT: ${r.pass} pass, 0 fail with the pattern "${m.pattern}"`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
module.exports = { MUTANTS };
