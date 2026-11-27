// core_right_width_mutation.test.js: node --test test/core_right_width_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D677 (b), THE RIGHT SIDE'S OWN WIDTH: each mutant changes the new code in ONE way (one exact string replacement, in a temporary copy of src/, tools/ and app/
// without its tests), and the right width's rows (test/core_right_width.test.js and app/test/core-right-width-panel.test.js) run against the copy, whole.
// "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one row FAILED on the mutant. The CONTROL runs both files on an unmutated
// copy, so a copy that is missing a file cannot make every mutant look caught. Built as core_sharp_mutation.test.js is (D194b, D352).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DOC = 'src/core/document.js', AD = 'src/core/adapter.js', EX = 'src/core/extend.js', CL = 'src/core/close.js', PI = 'src/core/piece.js', SH = 'src/core/sharp.js';
const PA = 'app/core/panel.js', CS = 'app/core/coreshell.js';

const MUTANTS = [
  // the stored field: written only when used, read back as written
  { id: 'R1 a piece flagged split with wd 0 everywhere counts as split', edits: [[DOC, 'P.split && P.channels.wd && P.channels.wd.some((v) => v !== 0));', 'P.split && P.channels.wd);']] },
  { id: 'R2 a split track is written with the schema before core/7', edits: [[DOC, 'doc.pieces.some(isWidthSplit) ? SCHEMA_WIDTH : ', '']] },
  { id: 'R3 every split piece writes its wd, used or not', edits: [[DOC, " && (ch !== 'wd' || isWidthSplit(P))", '']] },
  { id: 'R4 a text with wd reads back without its split flag', edits: [[DOC, "...(has('wd') ? { split: true } : {})", '']] },
  { id: 'R5 roadPiece drops the split flag', edits: [[DOC, '...(tube ? { tube: true } : {}), ...(split ? { split: true } : {})', '...(tube ? { tube: true } : {})']] },
  { id: 'R6 an unspecified wd on a split piece does not continue from the piece before', edits: [[DOC, "(OFFSETS.includes(ch) || ch === 'wd')", 'OFFSETS.includes(ch)']] },
  // LEFT OUT (L258, pane B): R7 'a piece with no split has no wd at its end' (pieceEnd's `if (!P.split) out.wd = { v: 0, m: 0 };` removed) is EQUIVALENT
  // on every road piece the core makes: roadPiece, parse (parseChannel: an optional channel the text lacks takes its default) and a placed saved piece
  // (piece.js, the defaults filled) each give a piece with no split a wd of 0s, from which pieceEnd reads { v: 0, m: 0 } itself. It differs only on a road
  // object made by hand with no wd array (pane B's scratch survivors.js), which none of pieceEnd's callers is given. The other six survivors of the first run
  // (R6, R18 to R22) each have a row now, seen red against it
  // the document's own domain
  { id: 'R8 a split piece is not checked at all', edits: [[DOC, '    if (P.split) checkSplit(P, at);', '']] },
  { id: 'R9 a right side of 0 m or less is not refused', edits: [[DOC, "  if (!(worst > 0)) throw new CoreError('BAD_WIDTH'", "  if (false) throw new CoreError('BAD_WIDTH'"]] },
  { id: 'R10 a split tube is not refused by the document', edits: [[DOC, '  if (P.tube && wd.some((v) => v !== 0)) throw', '  if (false) throw']] },
  // the cross-section: the right side widened, the left and the line untouched
  { id: 'R11 the cross-section ignores wd', edits: [[AD, 'return P.split && x.wd ? rightWidened(b, x.w, x.wd) : b;', 'return b;']] },
  { id: 'R12 the LEFT side is widened instead', edits: [[AD, 'u: b.u.map((v) => (v < 0 ? v * k : v))', 'u: b.u.map((v) => (v > 0 ? v * k : v))']] },
  { id: 'R13 the right side is narrowed by the same ratio', edits: [[AD, 'const k = (w + wd) / w;', 'const k = w / (w + wd);']] },
  { id: 'R14 a width-split piece is not built on the cross-section path', edits: [[AD, ' || D.isWidthSplit(P);', ';']] },
  // Extend: when a piece is split, and how its wd is laid
  { id: 'R15 a typed right width does not split the piece', edits: [[EX, 'const split = given(targets.wd) ||', 'const split = false ||']] },
  { id: 'R16 a split head does not carry its split on', edits: [[EX, ' || live(lastWd);', ';']] },
  { id: 'R17 a right width brought back to the width is not ended at 0', edits: [[EX, 'if (endAsked === 0 && (', 'if (false && (']] },
  { id: 'R18 the right width has no change floor of its own (1 m)', edits: [[EX, 'er: 26, wd: 40 });', 'er: 26, wd: 1 });']] },
  { id: 'R19 a right width with no start shape does not follow the width\'s', edits: [[EX, 'if (startShapes.w && !startShapes.wd)', 'if (false)']] },
  { id: 'R20 the right width\'s two-share ramp is not the width\'s', edits: [[EX, "(C2_CHANNELS.has(ch) || ch === 'w' || ch === 'wd') && isShares(shape)", "(C2_CHANNELS.has(ch) || ch === 'w') && isShares(shape)"]] },
  { id: 'R21 Extend does not refuse a split tube itself (the document still does)', edits: [[EX, 'if (split && tube) throw', 'if (false) throw']] },
  // the consumers
  { id: 'R22 close does not join wd at the seam', edits: [[CL, ", ...(sm.splitBoth ? ['wd'] : [])];", '];']] },
  { id: 'R23 close joins a split end to an unsplit one', edits: [[CL, 'if (!!F.split !== !!L.split) {', 'if (false) {']] },
  { id: 'R24 a run with a right width is saved', edits: [[PI, 'if (roads.some(D.isWidthSplit)) throw', 'if (false) throw']] },
  { id: 'R25 Sharp probes a split head with its sides equal', edits: [[SH, 'if (from.wd && from.wd.v) first.wd = from.wd.v;', '']] },
  // the panel and the shell
  { id: 'P1 the right width is sent as typed, not as its difference from the width', edits: [[PA, 'targets.wd = wR - ref;', 'targets.wd = wR;']] },
  { id: 'P2 a right width\'s change is sent against the head\'s width, not the width at its mark', edits: [[PA, 'return L.length ? L[L.length - 1].target : targets.w', 'return false ? 0 : targets.w']] },
  { id: 'P3 the shell\'s head reads no wd', edits: [[CS, 'wd: end && end.wd && Number.isFinite(end.wd.v) ? end.wd.v : 0 });', 'wd: 0 });']] },
  { id: 'P4 the field shows the width, not the right width', edits: [[PA, '(h) => h.w + (Number.isFinite(h.wd) ? h.wd : 0)', '(h) => h.w']] },
  { id: 'P5 the right width\'s early ramp is not the width\'s', edits: [[PA, "ch === 'w' || ch === 'wd' ? Math.min(F_RAMP_M", "ch === 'w' ? Math.min(F_RAMP_M"]] },
];
const FILES = [['test', 'core_right_width.test.js'], ['app/test', 'core-right-width-panel.test.js']];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-wd-mut-'));
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
test('CONTROL: both right-width row files pass on an unmutated copy of src/, tools/ and app/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests >= 20 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
