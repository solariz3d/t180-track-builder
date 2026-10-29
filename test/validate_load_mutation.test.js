// validate_load_mutation.test.js: node --test test/validate_load_mutation.test.js   (under the heavy-run lock; about a minute)
// D517 (pane E): the load path of src/validate/index.js had no mutant in any harness (core_cup_mutation's M35 reaches the cross-section the loads read,
// M48 the joint step, core_jump_mutation's J1-J2b the jumps; none the load lines). Each mutant changes the D515 rules in ONE way (an exact string
// replacement, in a temporary copy of src/ and app/validate-ui/), and the rows of test/validate_chassis.test.js that should notice run against the copy.
// "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one of those tests FAILED on the mutant. The CONTROL runs the whole
// file on an unmutated copy first, so a copy missing a file cannot make every mutant look caught. The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const TEST = 'validate_chassis.test.js';
const V = 'src/validate/index.js', LIM = 'src/validate/limits.js', LAB = 'app/validate-ui/labels.js';

const MUTANTS = [
  // rule 1: the suspension stop
  { id: 'L1 the stop is back at 20 g', pattern: 'row 1', file: LIM, from: 'suspensionStopG: 25,', to: 'suspensionStopG: 20,' },
  { id: 'L2 the stop is an amber, not information', pattern: 'row 1', file: V, from: "kind: 'info', s: p.s, u, reason: 'on-the-stops'", to: "kind: 'amber', s: p.s, u, reason: 'on-the-stops'" },
  // rules 2 and 3: the chassis line
  { id: 'L3 no chassis amber', pattern: 'row 2', file: V, from: 'if (line.fN_g >= car.chassisG && line.fN_g <= car.provenG) raw.pts.push', to: 'if (false) raw.pts.push' },
  { id: 'L4 the chassis line is 45 g, D515 rule 2 without rule 3\'s margin', pattern: 'row 2', file: LIM, from: 'chassisG: 40,', to: 'chassisG: 45,' },
  { id: 'L5 the chassis edge is strict and late (over 40.001 g)', pattern: 'row 2b', file: V, from: 'line.fN_g >= car.chassisG &&', to: 'line.fN_g > car.chassisG + 1e-3 &&' },
  { id: 'L6 the chassis line has no top: it speaks past the proven 90 g too', pattern: 'row 2c', file: V, from: ' && line.fN_g <= car.provenG) raw.pts.push', to: ') raw.pts.push' },
  // rule 5: the wall swerve
  { id: 'L7 no wall-swerve amber', pattern: 'row 3', file: V, from: 'if (side > car.wallSwerve.sideG && line.fN_g < car.wallSwerve.holdG) raw.pts.push', to: 'if (false) raw.pts.push' },
  { id: 'L8 the swerve is not wall-only (no tilt gate)', pattern: 'row 3c', file: V, from: 'car.wallSwerve && n1 < Math.cos(car.wallSwerve.tiltDeg * DEG)', to: 'car.wallSwerve' },
  { id: 'L9 the swerve ignores the load into the road', pattern: 'row 3d', file: V, from: ' && line.fN_g < car.wallSwerve.holdG) raw.pts.push', to: ') raw.pts.push' },
  { id: 'L10 the sideways ask reads the curvature INTO the road, not in its plane', pattern: 'row 3', file: V, from: 'Math.abs(K[0] * l0 + K[1] * l1 + K[2] * l2) * w / G', to: 'Math.abs(K[0] * n0 + K[1] * n1 + K[2] * n2) * w / G' },
  { id: 'L11 the sideways edge is 2.5 g, not the 3 g driven', pattern: 'row 3b', file: V, from: 'side > car.wallSwerve.sideG &&', to: 'side > car.wallSwerve.sideG - 0.5 &&' },
  // the words and the sources
  { id: 'L12 the chassis words read as a fault', pattern: 'row 4', file: LAB, from: 'It has held up to 63 g', to: 'It fails past 63 g' },
  { id: 'L13 the stop\'s source loses D515', pattern: 'row 4', file: V, from: "'on-the-stops': 'D515 bands.txt", to: "'on-the-stops': 'bands.txt" },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-load-mut-'));
  try {
    fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'app', 'validate-ui'), path.join(dir, 'app', 'validate-ui'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'test'));
    for (const f of [TEST, 'validate_paths.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'test', f));
    let n = 1, parses = true;
    if (m.file) {
      const f = path.join(dir, m.file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); n = src.split(m.from).length - 1;
      if (n === 1) fs.writeFileSync(f, src.replace(m.from, () => m.to));
      // a mutant that does not PARSE fails every test by crashing, and would read as caught: it is reported as not applied instead
      parses = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status === 0;
      if (!parses) return { applied: false, n, parses, tests: 0, fail: 0, failed: [] };
    }
    const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', ...(m.pattern ? [`--test-name-pattern=${m.pattern}`] : []), path.join(dir, 'test', TEST)];
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', timeout: 300000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    if (r.error) throw r.error;
    const crashed = IR.crashes(r.stdout);   // D352: a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
    if (crashed.length) throw new Error(IR.notTested(crashed));
    const L = r.stdout.split(/\r?\n/), get = (k) => Number((L.find((l) => l.startsWith(`# ${k} `)) || '').split(' ')[2]);
    if (!Number.isFinite(get('tests'))) throw new Error('the mutant run printed no summary:\n' + (r.stdout + r.stderr).slice(0, 2000));
    return { applied: n === 1, n, parses, tests: get('tests'), fail: get('fail'), failed: L.filter((l) => /^not ok/.test(l)).map((l) => l.slice(0, 160)) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('control: the unmutated copy passes every row of validate_chassis.test.js', () => {
  const r = runMutant({ id: 'control', file: null });
  assert.ok(r.tests >= 9, `only ${r.tests} tests ran`); assert.equal(r.fail, 0, r.failed.join(' | '));
});
// D352: a crashed inner run is no verdict. The stand-in puts the machine's crash (test/inner_run.js STANDIN) at the top of the first mutant's file
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in, D352)', () => {
  const m0 = MUTANTS[0], first = fs.readFileSync(path.join(ROOT, m0.file), 'utf8').split(/\r?\n/)[0];
  const said = IR.reading(() => { const r = runMutant({ ...m0, id: 'crash stand-in', from: first, to: IR.STANDIN + first }); return r.fail > 0 ? `caught: ${r.fail} of ${r.tests} failed` : `NOT CAUGHT: ${r.tests} test(s) all pass`; });
  assert.match(said, IR.NOT_TESTED);
});
for (const m of MUTANTS) {
  test(`mutation ${m.id}: applied, and caught by ${m.pattern}`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, r.parses === false ? `NOT APPLIED: the mutant of ${m.file} does not parse` : `NOT APPLIED: "${m.from}" occurs ${r.n} times in ${m.file}`);
    assert.ok(r.tests > 0, `the pattern ${m.pattern} ran no test`);
    assert.ok(r.fail > 0, `NOT CAUGHT: ${r.tests} test(s) of ${m.pattern} all pass on the mutant`);
  });
}
module.exports = { MUTANTS, runMutant };
