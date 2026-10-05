// core_jump_mutation.test.js: node --test test/core_jump_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096; a few minutes)
// D243 (pane E): each mutant changes the jump code in ONE way (an exact string replacement, in a temporary copy of src/, tools/ and app/), and the
// rows of test/core_jump.test.js that should notice run against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means
// at least one of those tests FAILED on the mutant. The CONTROL runs the whole file on an unmutated copy first, so a copy missing a file cannot make
// every mutant look caught. The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const TEST = 'core_jump.test.js';

const MUTANTS = [
  // src/validate/index.js: a core flight's gap is intended, a hole is not
  { id: 'J1 a core flight\'s gap is a hole again (gap-in-road)', pattern: 'row 2', file: 'src/validate/index.js', from: "g.word !== 'jump' && !isCoreFlight(segments, j) &&", to: "g.word !== 'jump' &&" },
  { id: 'J2 any core gap counts as a flight, with or without its landing', pattern: 'row 2', file: 'src/validate/index.js', from: "!!n && n.part === 'land' && n.id === g.id && n.kind === 'road'", to: 'true' },
  // src/core/close.js: a lap with jumps closes
  { id: 'J3 a track with a jump is refused again (NOT_YET)', pattern: 'row 4', file: 'src/core/close.js', from: "  if (doc.pieces.length && doc.pieces[doc.pieces.length - 1].type === 'flight')", to: "  if (doc.pieces.some((P) => P.type === 'flight')) throw new D.CoreError('NOT_YET', 'close: a jump');\n  if (doc.pieces.length && doc.pieces[doc.pieces.length - 1].type === 'flight')" },
  { id: 'J4 the road after a jump is linked across it (its level start not held)', pattern: 'row 4', file: 'src/core/close.js', from: 'flightSince && AFTER_FLIGHT_LEVEL.includes(ch)', to: 'false' },
  { id: 'J5 the close\'s model skips the flight (no displacement, no pitch reset)', pattern: 'row 4', file: 'src/core/close.js', from: "    if (P.type === 'flight') {\n      const ramp = (pp)", to: "    if (false) {\n      const ramp = (pp)" },
  { id: 'J6 the net pitch is not counted again from a jump', pattern: 'row 4', file: 'src/core/close.js', from: "if (g.part === 'gap') { out.kv = new Map(); out.kvBase = doc.pieces[byId.get(g.id)].land - doc.start.pitch; continue; }", to: '' },
  { id: 'J7 the landing pitch is left out of the net pitch', pattern: 'row 4', file: 'src/core/close.js', from: 'net = { kh: 0, kv: rows.kvBase }', to: 'net = { kh: 0, kv: 0 }' },
  { id: 'J8 the model\'s pitch is not cut at the flight', pattern: 'row 4', file: 'src/core/close.js', from: 'sT = sT.map((v, k) => v + g.Tt[k]); sP = g.Tp.slice(); continue;', to: 'sT = sT.map((v, k) => v + g.Tt[k]); continue;' },
  { id: 'J8b the model leaves out the ramp\'s dependence on the take-off pitch', pattern: 'row 4', file: 'src/core/close.js', from: 'sT = sT.map((v, k) => v + g.Tt[k]); sP = g.Tp.slice(); continue;', to: 'sT = sT.map((v, k) => v + g.Tt[k]); sP = [0, 0, 0]; continue;' },
  { id: 'J8c the ramp is taken as not reaching the end in heading (H = gap)', pattern: 'row 4', file: 'src/core/close.js', from: 'const H = P.gap + ramp(p),', to: 'const H = P.gap,' },
  { id: 'J9 a lap that ends in a jump is not refused by name', pattern: 'row 4', file: 'src/core/close.js', from: "type === 'flight') throw new D.CoreError('FLIGHT_AT_END'", to: "type === 'never') throw new D.CoreError('FLIGHT_AT_END'" },
  // (J10, "the road before a jump may move its h and l", was EQUIVALENT: no closing row reaches those control points, so the hold it removed was dead
  // code and is gone from close.js; see the D243 hand-back)
  // src/core/jump.js: the helper's refusals by name
  { id: 'J11 a jump straight after a jump is accepted', pattern: 'row 1', file: 'src/core/jump.js', from: "type === 'flight') throw new D.CoreError('JUMP_AFTER_JUMP'", to: "type === 'never') throw new D.CoreError('JUMP_AFTER_JUMP'" },
  { id: 'J12 a flight the adapter cannot fly is accepted at the click', pattern: 'row 1', file: 'src/core/jump.js', from: 'try { toSegments(out); } catch (e) {', to: 'try { } catch (e) {' },
  { id: 'J13 a landing pitch past vertical is accepted', pattern: 'row 1', file: 'src/core/jump.js', from: '&& Math.abs(land) < V))', to: '))' },
  { id: 'J14 an empty track is not refused by name', pattern: 'row 1', file: 'src/core/jump.js', from: "if (!doc.pieces.length) throw new D.CoreError('NO_TAKEOFF'", to: "if (false) throw new D.CoreError('NO_TAKEOFF'" },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-jump-mut-'));
  try {
    for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    fs.cpSync(path.join(ROOT, 'app'), path.join(dir, 'app'), { recursive: true, filter: (p) => !/[\\/]app[\\/]test([\\/]|$)/.test(p) && !/node_modules/.test(p) });
    fs.mkdirSync(path.join(dir, 'test')); fs.copyFileSync(path.join(__dirname, TEST), path.join(dir, 'test', TEST));
    let n = 1, parses = true;
    if (m.file) {
      const f = path.join(dir, m.file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); n = src.split(m.from).length - 1;
      if (n === 1) fs.writeFileSync(f, src.replace(m.from, () => m.to));
      // a mutant that does not PARSE fails every test by crashing, and would read as caught: it is reported as not applied instead
      parses = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status === 0;
      if (!parses) return { applied: false, n, parses, tests: 0, fail: 0, failed: [] };
    }
    const args = ['--max-old-space-size=4096', '--test', '--test-concurrency=1', '--test-reporter=tap', ...(m.pattern ? [`--test-name-pattern=${m.pattern}`] : []), path.join(dir, 'test', TEST)];
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', timeout: 600000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    if (r.error) throw r.error;
    const L = r.stdout.split(/\r?\n/), get = (k) => Number((L.find((l) => l.startsWith(`# ${k} `)) || '').split(' ')[2]);
    if (!Number.isFinite(get('tests'))) throw new Error('the mutant run printed no summary:\n' + (r.stdout + r.stderr).slice(0, 2000));
    return { applied: n === 1, n, parses, tests: get('tests'), fail: get('fail'), failed: L.filter((l) => /^not ok/.test(l)).map((l) => l.slice(0, 160)) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('control: the unmutated copy passes every row of core_jump.test.js', () => {
  const r = runMutant({ id: 'control', file: null });
  assert.ok(r.tests >= 12, `only ${r.tests} tests ran`); assert.equal(r.fail, 0, r.failed.join(' | '));
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
