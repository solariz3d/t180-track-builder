// core_even_mutation.test.js: node --test test/core_even_mutation.test.js   (under the heavy-run lock; a few minutes)
// Each mutant changes src/core/even.js or the shell's Even (app/core/coreshell.js) in ONE way (one exact string replacement, in a temporary copy of src/, tools/ and
// the app folders the shell loads), and the Even rows run against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one
// test FAILED on the mutant. The CONTROL runs the files whole on an unmutated copy, so a copy missing a file cannot make every mutant look caught. A crashed inner
// run reads NOT TESTED (test/inner_run.js, D352).
// Left out on purpose: the fitted height's own quantising (settle quantises every changed value as it builds the joints, so a mutant there changes no document);
// and the banked rows from the width brush's starts (app/test/sculpt-even-banked.test.js), which take minutes per start: the core's K2 and K3 rows from the
// untouched road cover the same lines.
// Left out after they were run (D678; the numbers are scratch measures beside the hand-back, lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md):
// - H6, NAMED EQUIVALENT BELOW THE BAR (the repair round's item 3, accepted by the librarian): the height fit not carrying a whole joint from the piece before
//   (fitHeight: "if (before === 'all') {" read as "if (false) {"). Measured: it moves the height by at most 0.0019 m on the fixtures and on a 31 m straight into a
//   banked turn, and K3 by under 0.0004 m either way, so no row at the 0.01 m bar can see it; a row pinned tighter would test the fit's arithmetic, not a road.
//   On H7's fixture below with a 3 m dip at 175 m it moves the height by 0.012 m, where the build's own K3 is already 0.039 m, over its bar.
// - H7, NOT CAUGHT, ITS FIXTURE MADE (the repair round's item 3): the fit freeing a joint the window covers in part ("} else if (before === 'part') { fixed.add(0);
//   fixed.add(1); }" read as "}"). The fixture: a joint at 155 m, inside the window's first ramp (a lead, a 90 m piece ending at 155, a 45 or 30 m piece to the run
//   at 200, the run 200-440 of four 30-degree pieces, the window 150-490), flat or banked -20 degrees, with a hill or dip on the height (the core's brush, centred
//   150-172 m, radius 10-30 m, 1-3 m up or down): 192 variants. H7 changes the height in 96 of them, by up to 0.0277 m; but in all 105 where the build's own K3 is
//   within its 0.01 m bar, H7 moves K3 by -0.00006 to +0.00025 m and the height by at most 0.00225 m, so no row at the bar can catch it there; where it moves
//   more, the build's own K3 is already over the bar (the height fit missing its in-plane target near a height feature in the ramps, reported in the hand-back).
// - S6, a typed width with no run selected, is refused by the core as well (EVEN_RUN for a run of undefined), so the shell's own check is a second guard, not a
//   behaviour.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const EV = 'src/core/even.js', CS = 'app/core/coreshell.js', VI = 'src/validate/index.js', DOC = 'src/core/document.js';
const PCLT = ['test/passclear.test.js'], CORE = ['test/core_even.test.js'], SHELL = ['app/test/sculpt-even.test.js'], SENT = ['app/test/sculpt-even-sentence.test.js'], LINES = ['test/validate_lines_between.test.js'], KNOTS = ['test/core_knots.test.js'];

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
  // the window's ends (D678, the packet's "Amended 17:4x" item 1; the hand-back's section 5.1): the knots over the reaches cut to 3.75 m, rounded once
  { id: 'X1m the knots over the window\'s reaches are not cut', pattern: 'X1|X3', edits: [[EV, 'const cut = refineEnds(doc, off, L, lo, hi, margin + ramp);', 'const cut = doc;']] },
  { id: 'X2m the reaches are cut to 7.5 m, not 3.75', pattern: 'X1|X3', edits: [[EV, 'const EVEN_END_SPAN_M = 3.75;', 'const EVEN_END_SPAN_M = 7.5;']] },
  { id: 'X3m the near reach is not cut', pattern: 'X1', edits: [[EV, 'for (const [a, b] of [[Math.max(0, lo - reach), lo], [hi, Math.min(L, hi + reach)]])', 'for (const [a, b] of [[hi, Math.min(L, hi + reach)]])']] },
  { id: 'X4m the far reach is not cut', pattern: 'X1', edits: [[EV, 'for (const [a, b] of [[Math.max(0, lo - reach), lo], [hi, Math.min(L, hi + reach)]])', 'for (const [a, b] of [[Math.max(0, lo - reach), lo]])']] },
  { id: 'X5m the window is not taken again on the cut track (the carry side still reaches back)', pattern: 'coarse knots', edits: [[EV, 'const W = cut === doc ? W0 : evenWindow(cut, { from, to, ramp, margin });', 'const W = W0;']] },
  { id: 'X6m Even does not ask for one rounding (each knot rounds its new points)', pattern: 'X1', edits: [[EV, 'EVEN_END_SPAN_M, { roundOnce: true }).doc', 'EVEN_END_SPAN_M).doc']] },
  { id: 'X7m refineKnots ignores roundOnce', pattern: 'roundOnce', files: KNOTS, edits: [[DOC, 'pieces[i] = roundOnce ? insertKnotsRoundOnce(P, add) : insertKnots(P, add);', 'pieces[i] = insertKnots(P, add);']] },
  { id: 'X8m the round-once insertion leaves its new points unrounded', pattern: 'roundOnce', files: KNOTS, edits: [[DOC, 'kept = [...kept.slice(0, k - 2), false, false, false, ...kept.slice(k)];', 'kept = [...kept.slice(0, k - 2), true, true, true, ...kept.slice(k)];']] },
  { id: 'X9m the round-once insertion reads every knot\'s span on the knots it started with', pattern: 'roundOnce', files: KNOTS, edits: [[DOC, '      U = [...U.slice(0, k + 1), t, ...U.slice(k + 1)];\n', '']] },
  { id: 'X10m the first sentence does not say what holds beyond the stretch', pattern: 'W3', files: SENT, edits: [['app/core/evenwords.js', '; beyond the stretch the road\'s width, line and height are as they were, to a tenth of a millimetre (Ctrl+Z', ' (Ctrl+Z']] },
  { id: 'X11m the release\'s check reads the old road on its own knots (the middle\'s l and h laid on the wrong control points)', pattern: 'E1 and E2|E5', files: SENT, edits: [['app/core/evenwords.js', 'const C = D.insertKnotsRoundOnce(P, A.knots.filter((k) => !P.knots.includes(k)));', 'const C = P;']] },
  // Even's step bounded to its window (D678, the 23:26Z order's item 2; the hand-back's 5.2b): the guard reads only the window's stations, each against every station
  { id: 'B1m the pass clearance ignores `to` (every station from `from` to the end leads)', pattern: 'row 11', files: PCLT, edits: [['src/validate/passclear.js', 'for (let i = from; i <= to; i++) {', 'for (let i = from; i < n; i++) {']] },
  { id: 'B2m the guard on Even\'s step reads only the window\'s first station', pattern: 'B2', files: SHELL, edits: [[CS, '      while (to >= 0 && S[to].s > win.w1 + 1e-9) to--;', '      to = from;']] },
  { id: 'B3m the guard on Even\'s step starts its read at the window\'s end', pattern: 'B2', files: SHELL, edits: [[CS, 'while (from < S.length && S[from].s < win.w0 - 1e-9) from++;', 'while (from < S.length && S[from].s < win.w1 - 1e-9) from++;']] },
  { id: 'B4m Even\'s result is frozen shallow again (its changed pieces left unfrozen, so every offset read converts the whole lap)', pattern: 'B4', edits: [[EV, 'const out = freeze(D.checkDoc({ ...c1,', 'const out = Object.freeze(D.checkDoc({ ...c1,']] },
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
  // the sentence after the release, off the page (D678 repair, item 1)
  { id: 'E1m the release starts no check (the second sentence is never said)', pattern: 'E1 and E2', files: SENT, edits: [[CS, '...(res ? { evenCheck: beginEvenCheck(b.base, doc(), res) } : {})', '']] },
  { id: 'E4m the check\'s words are said on a track changed since (an Undo meanwhile)', pattern: 'E4', files: SENT, edits: [[CS, 'if (doc() !== after) return set({ evenCheck: null });   // the track changed', '//']] },
  { id: 'E2m the job does not read the middle\'s move between the two tracks (it says 0.0 m)', pattern: 'E1 and E2|E5', files: SENT, edits: [['app/core/evenwords.js', 'shiftAt: EV.shiftOf(before, after) }', 'shiftAt: EV.shiftOf(before, before) }']] },
  { id: 'E3m linesBetween stops a station short of its end', pattern: 'E3', files: LINES, edits: [[VI, 'b < 0 ? S.length : b).lines;', 'b < 0 ? S.length : b - 1).lines;']] },
  { id: 'E3n linesBetween reads the speed from its own stations, not the lap', pattern: 'E3', files: LINES, edits: [[VI, 'return core(path, segments, { ...opts, lap: false }, a, null, b < 0 ? S.length : b).lines;', 'const sub = { ...path, samples: S.slice(a, b < 0 ? S.length : b) }; return core(sub, segments, { ...opts, lap: false }, 0, null, sub.samples.length).lines;']] },
];
const FILES = [...CORE, ...SHELL, ...SENT, ...LINES, ...KNOTS, ...PCLT];
const HELPERS = ['test/even_fixtures.js', 'test/inner_run.js', 'test/core_helpers.js', 'test/geom_fixtures.js'];
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
test('CONTROL: core_even.test.js, sculpt-even.test.js, sculpt-even-sentence.test.js, validate_lines_between.test.js, core_knots.test.js and passclear.test.js pass whole on an unmutated copy', () => {   // AMENDED BY NAME (D678 repair): the sentence's two files joined it; (17:4x item 1) and core_knots.test.js, for refineKnots' roundOnce; (23:26Z item 2) and passclear.test.js, for the bounded read's `to`
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
