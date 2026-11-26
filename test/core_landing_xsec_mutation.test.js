// core_landing_xsec_mutation.test.js: node --test test/core_landing_xsec_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096; a few minutes)
// D677 C1, THE LANDING'S CROSS-SECTION (pane O): each mutant changes the code C1 added in ONE way (an exact string replacement, in a temporary copy of src/, tools/
// and app/), and the rows of test/core_landing_xsec.test.js or app/test/core-landing-xsec-panel.test.js that should notice run against the copy. "Applied" means the
// replaced string occurs EXACTLY once; "caught" means at least one of the tests the pattern selects FAILED on the mutant. The CONTROL runs both files whole on an
// unmutated copy first, so a copy missing a file cannot make every mutant look caught. The originals are never touched. (The machinery is core_jump_mutation.test.js's.)
// NOT A MUTANT HERE, because no row can catch it: extend.js `head0 = landingStart(doc, first)` put back to `D.endState(doc)`. head0 is only the start a CHANGE row's
// first ramp is read from (changeLists startV), and the width, cup and edges take their shortest change from CHANGE_FLOOR_M whatever the first ramp under it
// (extend.js secondMinM), so the output is the same (measured: every mark from 20 to 120 m on 60, 100 and 150 m pieces, w, c and e, identical). It is kept so the
// core reads one start; the panel's same question (rampStart) is P4 below, observed where the panel asks it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { core: ['test', 'core_landing_xsec.test.js'], panel: ['app/test', 'core-landing-xsec-panel.test.js'] };
const X = 'src/core/extend.js', P = 'app/core/panel.js', S = 'src/core/sharp.js';

const MUTANTS = [
  // the core's start after a bare flight (extend.js landingStart)
  { id: 'X1 the landing ignores the typed start (endState as before)', file: X, test: 'core', pattern: 'C-2|C-3|C-6',
    from: 'if (!e || !first || !endsInFlight(doc)) return e;', to: 'return e;' },
  { id: 'X2 every channel of first starts the landing (a turn, climb, offset or bank too)', file: X, test: 'core', pattern: 'C-4',
    from: 'const typed = LANDING_FIRST.filter((ch) => first[ch] !== undefined && first[ch] !== null);', to: 'const typed = Object.keys(first).filter((ch) => first[ch] !== undefined && first[ch] !== null);' },
  { id: 'X3 the typed start keeps the take-off\'s slope (not at rest)', file: X, test: 'core', pattern: 'C-2',
    from: '[ch, { v: first[ch], m: 0 }]', to: '[ch, { v: first[ch], m: e[ch].m - 0.05 }]' },
  { id: 'X4 any track counts as ending in a flight (first read after road)', file: X, test: 'core', pattern: 'ROAD',
    from: "const endsInFlight = (doc) => doc.pieces.length > 0 && doc.pieces[doc.pieces.length - 1].type === 'flight';", to: 'const endsInFlight = (doc) => doc.pieces.length > 0;' },
  { id: 'X5 startTyped is the empty track only (as before)', file: X, test: 'core', pattern: 'PLAIN|BY NAME',
    from: 'const startTyped = !from0 || endsInFlight(doc);', to: 'const startTyped = !from0;' },
  { id: 'X6 a cup given as the landing\'s start does not make it a cup piece', file: X, test: 'core', pattern: 'PLAIN',
    from: "startTyped && given(f0.c) ? 'cup'", to: "!from0 && given(f0.c) ? 'cup'" },
  { id: 'X7 an edge given as the landing\'s start does not make it an edge piece', file: X, test: 'core', pattern: 'PLAIN',
    from: '(startTyped && (given(f0.e) || given(f0.er) || given(f0.s)))', to: '(!from0 && (given(f0.e) || given(f0.er) || given(f0.s)))' },
  { id: 'X8 the landing\'s start edge is not checked against the cap by name', file: X, test: 'core', pattern: 'BY NAME',
    from: 'if (startTyped && given(f0.e) && f0.e > cap(0) + 1e-6)', to: 'if (!from0 && given(f0.e) && f0.e > cap(0) + 1e-6)' },
  { id: 'X9 the landing\'s start right edge is not checked against the cap by name', file: X, test: 'core', pattern: 'BY NAME',
    from: 'if (startTyped && given(f0.er) && f0.er > cap(0) + 1e-6)', to: 'if (!from0 && given(f0.er) && f0.er > cap(0) + 1e-6)' },
  { id: 'X10 the landing\'s start edges are not checked against the floor by name', file: X, test: 'core', pattern: 'BY NAME',
    from: 'if (startTyped) { under("first piece\'s edge"', to: 'if (!from0) { under("first piece\'s edge"' },
  // Sharp's probe (the plan's site to check, sharp.js:95)
  { id: 'S1 Sharp\'s radius probe starts at the take-off\'s cross-section after a flight', file: S, test: 'core', pattern: 'Sharp',
    from: 'from = landingStart(doc, opts.first);', to: 'from = D.endState(doc);' },
  // the panel
  { id: 'P1 the panel sends no first after a flight', file: P, test: 'panel', pattern: 'panel',
    from: 'else if (afterFlight && Object.keys(landingFirst(targets)).length) out.first = landingFirst(targets);', to: 'else if (false) out.first = landingFirst(targets);' },
  { id: 'P2 the panel sends every typed target as the landing\'s start (the turn, climb and bank too)', file: P, test: 'panel', pattern: 'C-4 \\(panel',
    from: 'Object.fromEntries(LANDING_FIRST.filter((ch) => targets[ch] !== undefined)', to: 'Object.fromEntries(Object.keys(targets).filter((ch) => targets[ch] !== undefined)' },
  { id: 'P3 the mounted panel never says the track ends in a flight', file: P, test: 'panel', pattern: 'mounted',
    from: 'afterFlight: endsInFlight(shell.getState().history.present.pieces), turnAs:', to: 'afterFlight: false, turnAs:' },
  { id: 'P4 a later change after a flight is asked with the head\'s start (a ramp from the take-off)', file: P, test: 'panel', pattern: 'later width change',
    from: 'rampStart(empty ? targets : afterFlight ? landingFirst(targets) : null, head, ch)', to: 'rampStart(empty ? targets : null, head, ch)' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-landing-xsec-mut-'));
  try {
    for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    fs.cpSync(path.join(ROOT, 'app'), path.join(dir, 'app'), { recursive: true, filter: (p) => !/[\\/]app[\\/]test([\\/]|$)/.test(p) && !/node_modules/.test(p) });
    for (const [d, f] of Object.values(FILES)) { fs.mkdirSync(path.join(dir, d), { recursive: true }); fs.copyFileSync(path.join(ROOT, d, f), path.join(dir, d, f)); }
    let n = 1, parses = true;
    if (m.file) {
      const f = path.join(dir, m.file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); n = src.split(m.from).length - 1;
      if (n === 1) fs.writeFileSync(f, src.replace(m.from, () => m.to));
      // a mutant that does not PARSE fails every test by crashing, and would read as caught: it is reported as not applied instead
      parses = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status === 0;
      if (!parses) return { applied: false, n, parses, tests: 0, fail: 0, failed: [] };
    }
    const which = m.test ? [FILES[m.test]] : Object.values(FILES);
    const args = ['--max-old-space-size=4096', '--test', '--test-concurrency=1', '--test-reporter=tap', ...(m.pattern ? [`--test-name-pattern=${m.pattern}`] : []), ...which.map(([d, f]) => path.join(dir, d, f))];
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', timeout: 600000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    if (r.error) throw r.error;
    const crashed = IR.crashes(r.stdout);   // D352: a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
    if (crashed.length) throw new Error(IR.notTested(crashed));
    const L = r.stdout.split(/\r?\n/), get = (k) => Number((L.find((l) => l.startsWith(`# ${k} `)) || '').split(' ')[2]);
    if (!Number.isFinite(get('tests'))) throw new Error('the mutant run printed no summary:\n' + (r.stdout + r.stderr).slice(0, 2000));
    return { applied: n === 1, n, parses, tests: get('tests'), fail: get('fail'), failed: L.filter((l) => /^not ok/.test(l)).map((l) => l.slice(0, 160)) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('control: the unmutated copy passes every row of both files', () => {
  const r = runMutant({ id: 'control', file: null });
  assert.ok(r.tests >= 17, `only ${r.tests} tests ran`); assert.equal(r.fail, 0, r.failed.join(' | '));
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
