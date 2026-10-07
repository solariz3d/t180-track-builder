// core_jump_mutation.test.js: node --test test/core_jump_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096; a few minutes)
// D243, re-anchored for D258 (pane E): each mutant changes the jump code in ONE way (an exact string replacement, in a temporary copy of src/, tools/ and app/), and the
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
  // D258: RE-ANCHORED for the free jump (the D243 ramp mutants J8b, J8c, J12 and J13's old anchors went with the ramp and the solved gap; each line says what it guards now)
  // src/validate/index.js: the free jump's gap is intended, a hole is not; a landing behind its take-off warns
  { id: 'J1 a core flight\'s gap is a hole again (gap-in-road)', pattern: 'row 2', file: 'src/validate/index.js', from: "g.word !== 'jump' && !isCoreFlight(segments, j) &&", to: "g.word !== 'jump' &&" },
  { id: 'J2 any core gap followed by road counts as a flight, with no pose on it (a planted hole is exempt)', pattern: 'row 2', file: 'src/validate/index.js', from: "g.part === 'gap' && !!g.to && !!n", to: "g.part === 'gap' && !!n" },
  { id: 'J2b a landing behind its take-off is red again', pattern: 'row 2', file: 'src/validate/index.js', from: "if (!(D > 0)) amber.push({ s: A.s, s1: S[last].s, u: null, reason: 'jump-gap-not-forward'", to: "if (!(D > 0)) red.push({ s: A.s, s1: S[last].s, u: null, reason: 'jump-gap-not-forward'" },
  // src/core/close.js: a lap with a free jump closes, the jump's pose untouched
  { id: 'J3 a track with a jump is refused again (NOT_YET)', pattern: 'row 4', file: 'src/core/close.js', from: "  if (doc.pieces.length && doc.pieces[doc.pieces.length - 1].type === 'flight')", to: "  if (doc.pieces.some((P) => P.type === 'flight')) throw new D.CoreError('NOT_YET', 'close: a jump');\n  if (doc.pieces.length && doc.pieces[doc.pieces.length - 1].type === 'flight')" },
  { id: 'J4 the landing is linked across the jump (its start not held)', pattern: 'row 4', file: 'src/core/close.js', from: 'if (prev >= 0 && i < 2 && flightSince) {', to: 'if (false) {' },
  { id: 'J5 the close\'s model skips the flight (no displacement, no heading or pitch reset)', pattern: 'row 4', file: 'src/core/close.js', from: "    if (P.type === 'flight') {\n      const F = [Math.sin(th)", to: "    if (false) {\n      const F = [Math.sin(th)" },
  { id: 'J6 the net pitch is not counted again from a jump, nor its turn added', pattern: 'row 4', file: 'src/core/close.js', from: "out.kv = new Map(); out.kvBase = F.pitch - doc.start.pitch; out.khBase += F.heading; continue;", to: 'continue;' },
  { id: 'J7 the landing pitch and the jumps\' turns are left out of the net angles', pattern: 'row 4', file: 'src/core/close.js', from: 'net = { kh: rows.khBase, kv: rows.kvBase }', to: 'net = { kh: 0, kv: 0 }' },
  { id: 'J8 the model\'s pitch is not cut at the flight', pattern: 'row 4', file: 'src/core/close.js', from: 'sT = sT.map((v, k) => v + g.Tt[k]); sP = [0, 0, 0]; continue;', to: 'sT = sT.map((v, k) => v + g.Tt[k]); continue;' },
  { id: 'J8c the model leaves out the landing\'s sideways offset turning with the take-off', pattern: 'row 4', file: 'src/core/close.js', from: 'P.forward * Lh[k] - P.left * F[k]', to: 'P.forward * Lh[k]' },
  { id: 'J9 a lap that ends in a jump is not refused by name', pattern: 'row 4', file: 'src/core/close.js', from: "type === 'flight') throw new D.CoreError('FLIGHT_AT_END'", to: "type === 'never') throw new D.CoreError('FLIGHT_AT_END'" },
  // src/core/document.js, adapter.js, jump.js: the document's rules and the ops' refusals by name
  { id: 'J11 two jumps in a row are accepted by the document (land on road first not enforced)', pattern: 'row 1', file: 'src/core/document.js', from: "if (flight) throw new CoreError('JUMP_AFTER_JUMP'", to: "if (false) throw new CoreError('JUMP_AFTER_JUMP'" },
  { id: 'J12 a landing that does not start level at its flight\'s bank is accepted', pattern: 'row 1', file: 'src/core/document.js', from: 'const p = landingProblem(flight, P); if (p)', to: 'const p = null; if (p)' },
  { id: 'J13 a landing pitch past vertical is accepted', pattern: 'row 1', file: 'src/core/document.js', from: 'if (!(Math.abs(P.pitch) <= FLIGHT_PITCH_MAX))', to: 'if (false)' },
  { id: 'J14 an empty track is not refused by name', pattern: 'row 1', file: 'src/core/jump.js', from: "if (!doc.pieces.length) throw new D.CoreError('NO_TAKEOFF'", to: "if (false) throw new D.CoreError('NO_TAKEOFF'" },
  { id: 'J15 a landing that is not the head is moved anyway', pattern: 'row 1', file: 'src/core/jump.js', from: "if (!L) throw new D.CoreError('LANDING_NOT_HEAD'", to: "if (false) throw new D.CoreError('LANDING_NOT_HEAD'" },
  { id: 'J16 the landing is not where its pose says (a metre further on)', pattern: 'row 1', file: 'src/core/adapter.js', from: 'const to = { x: [P.left, P.up, P.forward]', to: 'const to = { x: [P.left, P.up, P.forward + 1]' },
  // src/core/document.js, piece.js: old files and saved pieces
  { id: 'J17 an old jump opens at its lip, its ramp forgotten (the roads after it move)', pattern: 'row 6', file: 'src/core/document.js', from: 'forward: gap + r,', to: 'forward: gap,' },
  { id: 'J18 the mirror of a saved jump does not cross to the other side', pattern: 'row 6', file: 'src/core/piece.js', from: 'left: P.left === 0 ? 0 : -P.left,', to: 'left: P.left,' },
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
