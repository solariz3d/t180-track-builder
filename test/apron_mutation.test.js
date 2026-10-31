// apron_mutation.test.js: node --test test/apron_mutation.test.js   (under the heavy-run lock: each mutant runs the apron's tests on a copy of the tree)
// D572: src/export/apron.js's mutation harness, in the frame of acready_mutation.test.js. Each mutation copies src/, app/ (without sounds/ and test/), tools/ and
// test/export_apron.test.js to a temp folder, applies ONE source patch to the copy's src/export/apron.js, and runs the named row against the mutant. "Applied" means the
// patch text was found and changed; "caught" means the named row FAILED, judged by its own line, run alone. The CONTROL runs the whole file on an unmutated copy, so a copy
// missing a file cannot make every mutant look caught. The original tree is never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const ROOT = path.join(__dirname, '..');

const MUTATIONS = [
  // the plan's three (plan_wheel_under_the_road_2026-10-30.md, Part A)
  { id: 'P1 the slope sign flipped (the apron rises from the edge)', from: 'mul(q.N, -drop))', to: 'mul(q.N, drop))', caughtBy: 'row 1:' },
  { id: 'P2 the join row dropped (the wedge is left open under the apron)', from: 'return { top, side: join };', to: 'return { top, side: null };', caughtBy: 'row 2:' },
  { id: 'P3 the wall test dropped (a 90° cup gets an apron)', from: 'if (rows.some((q) => q.rim >= WALL_DEG)) return null;', to: '', caughtBy: 'row 4:' },
  // the two the build added: the pit lane's span and the piece's own surface
  { id: 'P4 the pit lane\'s side keeps its apron over the lane\'s span', from: 'if (lane && lane.side === tag && inLaneSpan(mesh.cells[k], lane)) continue;', to: '', caughtBy: 'row 10:' },
  { id: 'P5 every apron is 1ROAD_ (a gripped piece\'s loses its grip)', from: 'top: `${prefix}${APRON_TAG}_${rest}_${tag}`', to: 'top: `1ROAD_${APRON_TAG}_${rest}_${tag}`', caughtBy: 'row 11:' },
];

const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-apron-mut-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'app'), path.join(dir, 'app'), { recursive: true, filter: (p) => !/[\\/]app[\\/](sounds|test)([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test')); fs.copyFileSync(path.join(__dirname, 'export_apron.test.js'), path.join(dir, 'test', 'export_apron.test.js'));
  return { dir, file: path.join(dir, 'src', 'export', 'apron.js'), test: path.join(dir, 'test', 'export_apron.test.js') };
}
function runOnce(t, pattern) {
  const tap = path.join(path.dirname(path.dirname(t)), '.inner-run.tap');
  const r = spawnSync(process.execPath, ['--max-old-space-size=4096', '--test', ...IR.reporterArgs(tap), ...(pattern ? [`--test-name-pattern=${pattern}`] : []), t],
    { env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), encoding: 'utf8', timeout: 600000, maxBuffer: 1 << 26 });
  if (r.error) throw r.error;
  return { out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), crashed: IR.crashesIn(tap) };
}
function verdictOf(out, name) {
  let v = null;
  for (const l of out.split('\n')) if (/^[✔✖] /.test(l) && l.slice(2).startsWith(name)) { if (l[0] === '✖') return 'fail'; v = 'pass'; }
  return v;
}

test('control: the unmutated copy passes every row of export_apron.test.js', () => {
  const c = copyTree();
  try {
    const { out, crashed } = runOnce(c.test, null);
    if (crashed.length) throw new Error(IR.notTested(crashed));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l));
    assert.ok(/ℹ tests \d+/.test(out), 'the control printed no summary');
    assert.deepEqual(failed, [], `the unmutated copy fails: ${failed.join(' | ')}`);
  } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const c = copyTree();
    try {
      const src = fs.readFileSync(c.file, 'utf8'), n = src.split(m.from).length - 1;
      assert.equal(n, 1, `NOT APPLIED: the patch text occurs ${n} times`);
      fs.writeFileSync(c.file, src.replace(m.from, m.to));
      const { out, crashed } = runOnce(c.test, `^${escapeRe(m.caughtBy)}`), v = verdictOf(out, m.caughtBy);
      if (v === null && crashed.length) throw new Error(IR.notTested(crashed));
      assert.equal(v, 'fail', `NOT CAUGHT: "${m.caughtBy}" ${v === null ? 'never reported' : 'passed'} on the mutant\n${out.slice(-1200)}`);
    } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
  });
}
