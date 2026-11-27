// core-bank-carry-mutation.test.js: node --test app/test/core-bank-carry-mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D677, the bank past a full turn: each mutant changes app/core/panel.js (B7, B8: app/core/coreshell.js; B11 to B13: app/core/handles.js) in ONE way (one exact string replacement, in a temporary copy of src/, tools/, the
// app folders the panel loads and test/fixtures), and the rows run against the copy: app/test/core-bank-carry.test.js, and for B6 the amended D641 (f) row in
// app/test/core-extra-bank-wind.test.js; B10 to B13 (Sculpt's bank handle past ±720, app/core/handles.js and panel.js) run their rows in app/test/core-pieces-ui.test.js,
// which drives the handles through the panel's own handle host. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one test FAILED on the mutant.
// The CONTROL runs the files whole on an unmutated copy, so a copy that is missing a file cannot make every mutant look caught. Built as
// test/core_sharp_mutation.test.js is (D194b, D352).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('../../test/inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const P = 'app/core/panel.js';
// D677 (2): Sculpt's bank handle and the bank brush send the delta as given (coreshell.js brushTo); WRAP_BACK puts back the delta that lands within one turn,
// bankWithinTurn as it was at 2067c88 (his 2026-10-06 rule), for the drags `when` names
const C = 'app/core/coreshell.js';
const H = 'app/core/handles.js';
const CARRY = 'const delta = b.sculpt && (Number.isInteger(b.sculptPiece) || b.ratioAt) ? delta0 / sculptRatio(b) : delta0;';
const WRAP_BACK = (when) => `const wrapped = ${when} ? ((d) => { const offs = SC.pieceOffsets(b.base), i = offs.findIndex((o, k) => b.s0 >= o && (k === offs.length - 1 || b.s0 < offs[k + 1])), P = i >= 0 ? b.base.pieces[i] : null; if (!P || P.type !== 'road' || !Number.isFinite(d)) return d; const b0 = D.channelAt(P, 'phi', Math.min(P.length, Math.max(0, b.s0 - offs[i]))).v, TURN = 2 * Math.PI, w = (b0 + d) % TURN; return Math.abs(b0 + d) < TURN ? d : w - b0; })(delta0) : delta0; const delta = b.sculpt && (Number.isInteger(b.sculptPiece) || b.ratioAt) ? wrapped / sculptRatio(b) : wrapped;`;

const MUTANTS = [
  { id: 'B1 a typed bank is wrapped within one turn again (the rule before D677)', pattern: 'W1', edits: [[P, '!Number.isFinite(T) ? t : inHeadTurn(T); };', "!Number.isFinite(T) ? t : Math.abs(T) === 360 ? String(T) : String(HD.wrapTurn(T)); };"]] },
  { id: "B2 the head's whole turns are not carried", pattern: 'W3', edits: [[P, 'const inHeadTurn = (T) => String(T + headTurns());', 'const inHeadTurn = (T) => String(T);']] },
  { id: "B3 the head's turns are its nearest whole turn, not the whole turns it has made (-340 counts as -360)", pattern: 'W1', edits: [[P, 'return 360 * Math.round((h - HD.wrapTurn(h)) / 360); };', 'return 360 * Math.round(h / 360); };']] },
  { id: 'B4 an extra bank row is wrapped within one turn again', pattern: 'W2', edits: [[P, ": inHeadTurn(T); };   // a bank row in the head's own turn (D677)", ': String(HD.wrapTurn(T)); };']] },
  { id: "B5 the extra bank's offer is read in absolute degrees, not the field's turn", pattern: 'W4', edits: [[P, "const base = corner ? 0 : f === 'bank' ? Number(last ? last.target / DEG : bankTarget()) - headTurns() : last", "const base = corner ? 0 : f === 'bank' ? Number(last ? last.target / DEG : bankTarget()) : last"]] },
  { id: 'B6 a bank typed past one turn is written back into the field wrapped again (D641 (f) before D677)', pattern: 'D641 \\(f\\)', edits: [[P, '  // (bankTarget), so the field keeps what was typed until Extend, and then shows the head within one turn',
    "  // (bankTarget), so the field keeps what was typed until Extend, and then shows the head within one turn\n  { const prev = bank.onchange; bank.onchange = (e) => { const T = Number(bank.value); if (bank.value !== '' && Number.isFinite(T) && Math.abs(T) > 360) bank.value = show(HD.wrapTurn(T)); return prev(e); }; }"]] },
  { id: 'B7 a Sculpt bank drag past a turn is wrapped within one turn again (his 2026-10-06 rule, before D677 (2))', pattern: 'S1', edits: [[C, CARRY, WRAP_BACK("b.channel === 'phi'")]] },
  { id: 'B8 the bank brush alone is wrapped within one turn again (Sculpt\'s handle carries)', pattern: 'S3', edits: [[C, CARRY, WRAP_BACK("b.channel === 'phi' && !b.sculpt")]] },
  { id: "B9 the flowing bank's offer is read in absolute degrees (E's mutant F1 on 2067c88: the flow branch's - headTurns() removed)", pattern: 'W5', edits: [[P, 'bankTarget()) - headTurns(), ...ST.styleOf(f) });', 'bankTarget()), ...ST.styleOf(f) });']] },
  // D677 (2), completed after E's read of 7b3926e: Sculpt's bank handle has no range (handles.js rangeOf, lifted by panel.js sculptModel), so it rolls on past ±720; the ghost's keeps it
  { id: "B10 Sculpt's bank handle is held at the bank kind's ±720 again (the Sculpt model no longer lifts its range)", pattern: 'row 720[a-d]', files: ['core-pieces-ui.test.js'], edits: [[P, "ctx: (k) => ({ half: si.halfAt(HD.KINDS[k].at), ...(k === 'bank' ? { range: false } : {}) })", 'ctx: (k) => ({ half: si.halfAt(HD.KINDS[k].at) })']] },
  { id: "B11 a drag's value is held at its kind's range whatever the model says (targetFor)", pattern: 'row 720[a-d]', files: ['core-pieces-ui.test.js'], edits: [[H, 'return clamp(v, ...rangeOf(K, ctx));', 'return clamp(v, K.min, K.max);']] },
  { id: "B12 a wheel notch is held at its kind's range whatever the model says", pattern: 'row 720e', files: ['core-pieces-ui.test.js'], edits: [[H, '...rangeOf(K, m.ctx(h.kind)));', 'K.min, K.max);']] },
  { id: "B13 every bank handle loses its range, the ghost's too (which is his to rule on)", pattern: 'row 720g', files: ['core-pieces-ui.test.js'], edits: [[H, 'perPx: 0.45, zero: true, min: -720, max: 720,', 'perPx: 0.45, zero: true, min: -Infinity, max: Infinity,']] },
];
// (The flowing bank's base, offersAt's flow branch, was LEFT OUT here until D677 (2): no row caught it, E's F1. It is B9 now, caught by W5.)
// From a head past a turn every bank drag lays in the head's turn: the ghost and extra handles since 2067c88 (they write the field and its rows; W4, W5 and
// core-pieces-ui's D677 ghost row), Sculpt's bank handle and the bank brush since D677 (2) (B7, B8; core-sculpt's two D259 rows amended). Two holds at one
// turn stay, guarded by their own rows: the ghost handle crossing a full turn from inside one (core-pieces-ui D259) and the extra handle's hold (D641 R1). And
// the ghost's bank handle keeps the bank kind's ±720 (core-pieces-ui row 720g, B13), where Sculpt's bank handle has none since its completion (B10 to B12)
const ROWS = ['core-bank-carry.test.js', 'core-extra-bank-wind.test.js'];   // the files a mutant's rows run in unless it names its own (`files`)
const FILES = [...ROWS, 'core-pieces-ui.test.js'];                           // every file a mutant names; the CONTROL runs them all whole on the copy
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-bankcarry-mut-'));
  // D678 (amended by name): test/even_fixtures.js, which core-pieces-ui.test.js's Even rows require; without it the CONTROL fails and every mutant reads caught
  for (const d of ['src', 'tools', 'app/core', 'app/camera', 'app/lib', 'app/validate-ui', 'app/preview', 'app/export', 'app/share', 'app/testhook', 'app/settings.js', 'app/index.html', 'test/fixtures', 'test/even_fixtures.js']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'app', 'test'), { recursive: true }); for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'app', 'test', f));
  return dir;
}
function runTests(dir, pattern, files = FILES) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...files.map((f) => path.join(dir, 'app', 'test', f))];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const crashed = IR.crashesIn(tap);   // D352: a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: core-bank-carry.test.js, core-extra-bank-wind.test.js and core-pieces-ui.test.js pass whole on an unmutated copy', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 10 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
// D352: a crashed inner run is no verdict. The stand-in puts the machine's crash (test/inner_run.js STANDIN) at the top of the first mutant's file
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in, D352)', () => {
  const m0 = MUTANTS[0], dir = tree();
  try {
    const f = path.join(dir, m0.edits[0][0]);
    fs.writeFileSync(f, IR.STANDIN + fs.readFileSync(f, 'utf8'));
    const said = IR.reading(() => { const r = runTests(dir, m0.pattern, m0.files || ROWS); return r.fail > 0 ? `caught: ${r.fail} of ${r.tests} failed` : `NOT CAUGHT: ${r.pass} pass, 0 fail`; });
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
      const r = runTests(dir, m.pattern, m.files || ROWS);
      t.diagnostic(`${m.id}: ${r.fail} of ${r.tests - r.skipped} run tests failed`);
      assert.ok(r.tests - r.skipped > 0, `the pattern "${m.pattern}" ran no test`);
      assert.ok(r.fail > 0, `NOT CAUGHT: ${r.pass} pass, 0 fail with the pattern "${m.pattern}"`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
module.exports = { MUTANTS };
