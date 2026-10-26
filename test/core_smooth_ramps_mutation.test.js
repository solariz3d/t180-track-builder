// core_smooth_ramps_mutation.test.js: node --test test/core_smooth_ramps_mutation.test.js   (under the heavy-run lock)
// D465: the mutation harness for src/core/smoothramps.js (Track ▸ Smooth ramps), the whole file. Each mutation copies src/ and tools/ to a temp folder, applies
// ONE source patch to the copy's smoothramps.js, and runs the named row of test/core_smooth_ramps.test.js (copied beside it) against the mutant. "Applied" means
// the patch text was found and changed. "Caught" means the named test FAILED on the mutant, judged by its own line, run alone (geom_mutation.test.js's judge,
// D181; acready_mutation.test.js's shape). The original src is never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const ROOT = path.join(__dirname, '..');

const MUTATIONS = [
  // the blend and the steps extend.js lays a ramp with
  { id: 'S1 the Bloss cubic instead of the quintic', from: 'X.channelFn({ v: v0, m: 0 }, v1, Lt, ch)', to: "X.channelFn({ v: v0, m: 0 }, v1, Lt, 'kh')", caughtBy: 'row 9: the shape is the quintic' },
  { id: 'S2 the ends not pinned to zero curvature', from: '  X.c2Ends(fit, ch);', to: '', caughtBy: 'row 1: Smooth ramps takes every bank' },
  { id: 'S14 the fit used even where it turns back (uneven knots)', from: 'if (monotone(fit.channels[ch], ch)) return fit.channels[ch];', to: 'return fit.channels[ch];', caughtBy: 'row 3: each re-laid ramp' },
  { id: 'S15 the knot-average read not pinned at its ends', from: '  X.c2Ends(read, ch);', to: '', caughtBy: 'row 3: each re-laid ramp' },
  { id: 'S16 the monotone test reads every ramp as rising', from: 'up = c[c.length - 1] >= c[0];', to: 'up = true;', caughtBy: 'row 5: a track laid by this build is already smooth' },
  { id: 'S3 the blend aimed at the start value (the ramp left to its pinned end)', from: 'X.channelFn({ v: v0, m: 0 }, v1, Lt, ch)', to: 'X.channelFn({ v: v0, m: 0 }, v0, Lt, ch)', caughtBy: 'row 9: the shape is the quintic' },
  // where a ramp ends
  { id: 'S4 a held ramp laid over the whole piece', from: 'return { v0, v1, Lt: Math.min(P.length, U[j + 3]) };', to: 'return { v0, v1, Lt: P.length };', caughtBy: 'row 3: each re-laid ramp' },
  { id: 'S5 the hold read one knot early', from: 'return { v0, v1, Lt: Math.min(P.length, U[j + 3]) };', to: 'return { v0, v1, Lt: Math.min(P.length, U[j + 2]) };', caughtBy: 'row 3: each re-laid ramp' },
  // what counts as a ramp
  { id: 'S6 a channel that leaves with a slope counts as a ramp', from: 'if (Math.abs(c[1] - v0) > q / 2 || Math.abs(c[n - 2] - v1) > q / 2)', to: 'if (Math.abs(c[n - 2] - v1) > q / 2)', caughtBy: 'row 8: a channel that changes' },
  { id: 'S7 a channel that arrives with a slope counts as a ramp', from: 'if (Math.abs(c[1] - v0) > q / 2 || Math.abs(c[n - 2] - v1) > q / 2)', to: 'if (Math.abs(c[1] - v0) > q / 2)', caughtBy: 'row 8: a channel that changes' },
  { id: 'S8 a bump counts as a ramp', from: "  if (Math.abs(v1 - v0) < q / 2) return { why: 'it comes back", to: "  if (false) return { why: 'it comes back", caughtBy: 'row 8: a channel that changes' },
  { id: 'S9 a piece too short is re-laid anyway', from: '  if (n < MIN_POINTS) return', to: '  if (false) return', caughtBy: 'row 8: a channel that changes' },
  { id: 'S10 the route channels re-laid too', from: 'for (const ch of X.C2_CHANNELS) {', to: 'for (const ch of D.CHANNELS) {', caughtBy: 'row 2: the route is the same bytes' },
  // what comes back
  { id: 'S11 every ramp counts as moved (a smooth track is rewritten)', from: 'moved = now.some((x, i) => x !== P.channels[ch][i]);', to: 'moved = true;', caughtBy: 'row 5: a track laid by this build is already smooth' },
  { id: 'S12 a re-laid channel is not kept', from: 'if (moved) (channels = channels || { ...P.channels })[ch] = now;', to: 'if (moved) channels = channels || { ...P.channels };', caughtBy: 'row 1: Smooth ramps takes every bank' },
  { id: 'S13 nothing moved, but a new document anyway', from: '  if (!moved) return { doc, ramps, moved, left };', to: '', caughtBy: 'row 6: an empty track' },
];

const TEST_NAME = 'core_smooth_ramps.test.js';
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-smooth-mut-'));
  for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  fs.mkdirSync(path.join(dir, 'test')); fs.copyFileSync(path.join(__dirname, TEST_NAME), path.join(dir, 'test', TEST_NAME));
  return { dir, file: path.join(dir, 'src', 'core', 'smoothramps.js') };
}
function runOnce(dir, pattern) {
  const tap = path.join(dir, '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, ['--test', ...IR.reporterArgs(tap), ...(pattern ? [`--test-name-pattern=${pattern}`] : []), path.join(dir, 'test', TEST_NAME)],
    { cwd: dir, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
  if (r.error) throw r.error;
  return { out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), crashed: IR.crashesIn(tap) };
}
/** The named test's verdict in one run's output: 'fail', 'pass', or null (it never reported). */
function verdictOf(out, name) {
  let v = null;
  for (const l of out.split('\n')) if (/^[✔✖] /.test(l) && l.slice(2).startsWith(name)) { if (l[0] === '✖') return 'fail'; v = 'pass'; }
  return v;
}
function runMutant(m) {
  const { dir, file } = copyTree();
  try {
    const src = fs.readFileSync(file, 'utf8'), applied = src.includes(m.from);
    if (applied) fs.writeFileSync(file, src.replace(m.from, m.to));
    const attempts = [];
    for (let k = 0; k < 3; k++) {
      const { out, crashed } = runOnce(dir, `^${escapeRe(m.caughtBy)}`), v = verdictOf(out, m.caughtBy);
      attempts.push({ verdict: v, crashed, tail: v ? '' : out.slice(-1500) });
      if (v) break;
    }
    const last = attempts[attempts.length - 1];
    if (last.verdict === null && last.crashed.length) throw new Error(IR.notTested(last.crashed));
    return { applied, caught: last.verdict === 'fail', verdict: last.verdict, attempts };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// THE CONTROL: the unmutated copy passes every row the mutants are judged by, so a catch means something
test('control: the unmutated copy of smoothramps.js passes every row of core_smooth_ramps.test.js', () => {
  const { dir } = copyTree();
  try {
    const { out, crashed } = runOnce(dir, null);
    if (crashed.length) throw new Error(IR.notTested(crashed));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l));
    assert.ok(/ℹ tests \d+/.test(out), 'the control printed no summary');
    assert.deepEqual(failed, [], `the unmutated copy fails: ${failed.join(' | ')}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" is not in src/core/smoothramps.js`);
    assert.notEqual(r.verdict, null, `NO VERDICT in ${r.attempts.length} runs: the named test never reported. Last output:\n${r.attempts[r.attempts.length - 1].tail}`);
    assert.ok(r.caught, `NOT CAUGHT: "${m.caughtBy}…" passed on the mutant (${r.attempts.length} run(s))`);
  });
}
module.exports = { MUTATIONS, runMutant };
