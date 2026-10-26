// acready_mutation.test.js: node --test test/acready_mutation.test.js
// D460: src/export/acready.js had no mutation harness. Each mutation copies acready.js (and the src/texture it requires) to a temp folder, applies ONE
// source patch, and runs the named test against the mutant (ACREADY_FILE, read by export_seam_fins.test.js and by export_acready.test.js's weldSeams
// rows). "Applied" means the patch text was found and changed. "Caught" means the named test FAILED on the mutant, judged by its own line, run alone
// (geom_mutation.test.js's judge, D181). The original src/export is never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const SRC = path.join(__dirname, '..', 'src');

const MUTATIONS = [
  // D460: a seam triangle that stands (faces along the road) is dropped, welded or not; a flat bridge across a real gap is kept
  { id: 'A1 a standing triangle never counts as standing', from: '  if (!(lf > 0 && lr > 0)) return false;', to: '  return false;', caughtBy: 'row 4: weldSeams drops a standing triangle' },
  { id: 'A2 a seam is looked at only when a point was welded (the D460 fins slip through)', from: 'if (welded || stand) seams.set(n, true);', to: 'if (welded) seams.set(n, true);', caughtBy: 'row 4: weldSeams drops a standing triangle' },
  { id: 'A3 a standing triangle is kept when its seam is looked at', from: '>= SLIVER && !stands(P, n.normals, a, b, c)) keep.push', to: '>= SLIVER) keep.push', caughtBy: 'row 4: weldSeams drops a standing triangle' },
  { id: 'A4 the stand test inverted (a triangle facing up out of the road counts as standing)', from: '/ (lf * lr) < Math.cos(STAND_DEG * Math.PI / 180);', to: '/ (lf * lr) >= Math.cos(STAND_DEG * Math.PI / 180);', caughtBy: 'row 4: weldSeams drops a standing triangle' },
  // D460: the fin guard (findFins) the export runs on the scene it is about to write
  { id: 'A5 the guard never counts a standing triangle', from: "if (thick >= SLIVER && stands(P, n.normals, 3 * a, 3 * b, 3 * c)) { standing++;", to: "if (false) { standing++;", caughtBy: 'row 6: the fin guard finds' },
  { id: 'A6 the guard never counts a triangle off the surface it bridges', from: 'if (far > OFF_TOL) { offSurface++;', to: 'if (false) { offSurface++;', caughtBy: 'row 6: the fin guard finds' },
  { id: 'A7 the surface tolerance a hundred times too loose (1 m)', from: 'const OFF_TOL = 0.01;', to: 'const OFF_TOL = 1;', caughtBy: 'row 6: the fin guard finds' },
  // the weld before D460 (2026-10-02): rows within SNAP share an edge, and slivers are dropped
  { id: 'A8 no point is welded (the next piece keeps its own edge)', from: 'if (s.d <= SNAP) { moves.set(key(...p), s.q); welded++; }', to: 'if (false) { moves.set(key(...p), s.q); welded++; }', caughtBy: 'a seam whose rows are within SNAP is dropped' },
  { id: 'A9 slivers are kept (thinness never drops a triangle)', from: 'if (longest > 0 && (2 * area) / longest >= SLIVER && !stands', to: 'if (longest > 0 && !stands', caughtBy: 'a seam whose rows are within SNAP is dropped' },
  { id: 'A10 a moved point moves only in the seam, not in the next piece', from: 'const n = moved(n0);', to: 'const n = seams.has(n0) ? moved(n0) : n0;', caughtBy: 'a seam whose rows are within SNAP is dropped' },
];

const TEST_FILES = ['export_seam_fins', 'export_acready'].map((n) => path.join(__dirname, `${n}.test.js`));
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function runOnce(file, pattern) {
  const tap = path.join(path.dirname(path.dirname(file)), '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, ['--test', ...IR.reporterArgs(tap), '--test-concurrency=2', ...(pattern ? [`--test-name-pattern=${pattern}`] : []), ...TEST_FILES],
    { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), ACREADY_FILE: file }, encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
  if (r.error) throw r.error;
  return { out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), crashed: IR.crashesIn(tap) };
}
/** The named test's verdict in one run's output: 'fail', 'pass', or null (it never reported). */
function verdictOf(out, name) {
  let v = null;
  for (const l of out.split('\n')) if (/^[✔✖] /.test(l) && l.slice(2).startsWith(name)) { if (l[0] === '✖') return 'fail'; v = 'pass'; }
  return v;
}
function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-acready-mut-'));
  fs.mkdirSync(path.join(dir, 'export')); fs.copyFileSync(path.join(SRC, 'export', 'acready.js'), path.join(dir, 'export', 'acready.js'));
  fs.cpSync(path.join(SRC, 'texture'), path.join(dir, 'texture'), { recursive: true });
  return { dir, file: path.join(dir, 'export', 'acready.js') };
}
function runMutant(m) {
  const { dir, file } = copyTree();
  try {
    const src = fs.readFileSync(file, 'utf8'), applied = src.includes(m.from);
    if (applied) fs.writeFileSync(file, src.replace(m.from, m.to));
    const attempts = [];
    for (let k = 0; k < 3; k++) {
      const { out, crashed } = runOnce(file, `^${escapeRe(m.caughtBy)}`), v = verdictOf(out, m.caughtBy);
      attempts.push({ verdict: v, crashed, tail: v ? '' : out.slice(-1500) });
      if (v) break;
    }
    const last = attempts[attempts.length - 1];
    if (last.verdict === null && last.crashed.length) throw new Error(IR.notTested(last.crashed));
    return { applied, caught: last.verdict === 'fail', verdict: last.verdict, attempts };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// THE CONTROL: the unmutated copy passes every test in both files, so a catch means something
test('control: the unmutated copy of acready.js passes every test the mutants are judged by', () => {
  const { dir, file } = copyTree();
  try {
    const { out, crashed } = runOnce(file, null);
    if (crashed.length) throw new Error(IR.notTested(crashed));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l) && !/# TODO/.test(l));
    assert.ok(/ℹ tests \d+/.test(out), 'the control printed no summary');
    assert.deepEqual(failed, [], `the unmutated copy fails: ${failed.join(' | ')}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" is not in src/export/acready.js`);
    assert.notEqual(r.verdict, null, `NO VERDICT in ${r.attempts.length} runs: the named test never reported. Last output:\n${r.attempts[r.attempts.length - 1].tail}`);
    assert.ok(r.caught, `NOT CAUGHT: "${m.caughtBy}…" passed on the mutant (${r.attempts.length} run(s))`);
  });
}
module.exports = { MUTATIONS, runMutant };
