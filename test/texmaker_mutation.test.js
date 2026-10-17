// texmaker_mutation.test.js: node --test --test-concurrency=4 test/texmaker_mutation.test.js
// Each mutation copies src/texmaker to a temp folder, applies ONE source patch, and runs test/texmaker.test.js against the
// mutant (TEXMAKER_DIR). "Applied" = the patch text was found; "caught" = the NAMED test failed (the pinned digest alone
// does not count). A CONTROL comes first: the unmutated copy must pass every test, or a catch means nothing.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const SRC = path.join(__dirname, '..', 'src', 'texmaker');

const MUTATIONS = [
  { id: 'X1 stripes ignore their width', file: 'make.js', from: 'periodicCover(a0, a1, P, l.width * P, l.offset * P)', to: 'periodicCover(a0, a1, P, 0.5 * P, l.offset * P)', caughtBy: 'stripes:' },
  { id: 'X2 stripes ignore their offset', file: 'make.js', from: 'periodicCover(a0, a1, P, l.width * P, l.offset * P)', to: 'periodicCover(a0, a1, P, l.width * P, 0)', caughtBy: 'stripes:' },
  { id: 'X3 stripes point-sampled instead of integrated', file: 'make.js', from: 'const periodicCover = (a, b, P, on, start) => (on <= 0 ? 0 : on >= P ? 1 : (periodicF(b, P, on, start) - periodicF(a, P, on, start)) / (b - a));',
    to: 'const periodicCover = (a, b, P, on, start) => { const m = (a + b) / 2 - start; const r = m - Math.floor(m / P) * P; return r < on ? 1 : 0; };', caughtBy: 'resolution: each exactly-integrated layer alone' },
  { id: 'X4 lane lines ignore their dashes', file: 'make.js', from: 'const cv = l.dashes === 0 ? 1 :', to: 'const cv = true ? 1 :', caughtBy: 'lines:' },
  { id: 'X5 grain cells do not follow the pixels (one sample per pixel)', file: 'make.js', from: 'for (const [j, wj] of wv) for (const [i, wi] of wu) s += wi * wj * hash(mod(i, l.cells), mod(j, l.cells), 7, l.seed);',
    to: 's = hash(Math.floor(u0 * l.cells + 0.37), Math.floor(v0 * l.cells + 0.37), 7, l.seed);', caughtBy: 'grain:' },
  { id: 'X6 gradient bands point-sampled instead of integrated', file: 'make.js', from: "const col = l.mode === 'bands' ? bandsAverage(l.stops, l.repeat, a0, a1) : stopAt(l.stops, mod(ac * l.repeat, 1), false);",
    to: "const col = stopAt(l.stops, mod(ac * l.repeat, 1), l.mode === 'bands');", caughtBy: 'resolution: each exactly-integrated layer alone' },
  { id: 'X7 panel seams not centred on the boundaries', file: 'make.js', from: 'periodicCover(u0, u1, Pu, su, -su / 2)', to: 'periodicCover(u0, u1, Pu, su, 0)', caughtBy: 'panels:' },
  { id: 'X8 the glow falloff ignored (a hard strip)', file: 'make.js', from: 'l.falloff > 0 && d < core + l.falloff', to: 'false && d < core + l.falloff', caughtBy: 'glow:' },
  { id: 'X9 the emissive flag ignored', file: 'make.js', from: "const glowsEmissive = L.some((l) => l.type === 'glow' && l.emissive);", to: "const glowsEmissive = L.some((l) => l.type === 'glow');", caughtBy: 'glow:' },
  { id: 'X10 a decal ignores its quarter turn', file: 'make.js', from: 'for (let q = 0; q < l.turn; q++) { const t2 = ox;', to: 'for (let q = 0; q < 0; q++) { const t2 = ox;', caughtBy: 'decal:' },
  { id: 'X11 "along" stamps only one copy', file: 'make.js', from: "copies = l.place === 'once' ? 1 : l.count", to: 'copies = 1', caughtBy: 'decal:' },
  { id: 'X12 the noise lattice does not wrap (the texture would not tile)', file: 'make.js', from: 'const at = (p, q) => hash(mod(p, cells), mod(q, cells), o, l.seed);', to: 'const at = (p, q) => hash(p, q, o, l.seed);', caughtBy: 'noise:' },
  { id: 'X13 numbers printed by float formatting', file: 'text.js', from: "    case 'frac': case 'num': return fmt(v);", to: "    case 'frac': case 'num': return String(v + 1e-12);", caughtBy: 'text: a hand-edited texture' },
  { id: 'X14 unknown keys in a layer accepted', file: 'text.js', from: "for (const key of Object.keys(l)) if (!keys.has(key)) bad('UNKNOWN_KEY'", to: "for (const key of Object.keys(l)) if (false) bad('UNKNOWN_KEY'", caughtBy: 'refusals name their reason' },
  { id: 'X15 gradient stops need not ascend', file: 'text.js', from: "if (!(out[k].at > out[k - 1].at)) bad(", to: 'if (false) bad(', caughtBy: 'refusals name their reason' },
  { id: 'X16 no upper limit on the render size', file: 'make.js', from: 'v < 1 || v > MAX_SIDE', to: 'v < 1', caughtBy: 'refusals name their reason' },
  { id: 'X17 the hash is not deterministic', file: 'make.js', from: 'return (h >>> 0) / 4294967296;', to: 'return ((h >>> 0) / 4294967296 + Math.random() * 1e-3) % 1;', caughtBy: 'determinism: the same text gives identical bytes' },
  { id: 'X18 the noise amount ignored', file: 'make.js', from: "case 'noise': blend(l.blend, c[0], c[1], c[2], l.amount * c[3] * fbm(l, uc, vc, size)); break;", to: "case 'noise': blend(l.blend, c[0], c[1], c[2], 0.3 * c[3] * fbm(l, uc, vc, size)); break;", caughtBy: 'noise:' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-texmaker-mut-')), tm = path.join(dir, 'texmaker');
  try {
    fs.cpSync(SRC, tm, { recursive: true });
    const f = path.join(tm, m.file), src = fs.readFileSync(f, 'utf8'), applied = m.from === null || src.includes(m.from);
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, m.to));
    const tap = path.join(dir, '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
    const r = spawnSync(process.execPath, ['--test', ...IR.reporterArgs(tap), '--test-concurrency=4', path.join(__dirname, 'texmaker.test.js')],
      { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), TEXMAKER_DIR: tm }, encoding: 'utf8', timeout: 300000 });
    if (r.error) throw r.error;
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    if (!/ℹ tests \d+/.test(out)) throw new Error('the mutant test run printed no summary:\n' + out.slice(0, 2000));
    // a todo's failure is not a failure, and "✖ failing tests:" is only the summary's header
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l) && !/# TODO/.test(l)).map((l) => l.slice(2));
    // D352: a file that died natively ran none of its tests; its own ✖ line is no catch, and a run with no catch but a dead file tested nothing
    const crashed = IR.crashesIn(tap), caught = failed.some((l) => !crashed.some((c) => l.startsWith(c.file + ' (')) && l.includes(m.caughtBy));
    if (crashed.length && !caught) throw new Error(IR.notTested(crashed));
    // D353: a crash after a failing row leaves no trace in the TAP, only the named test's silence; a file that exited on its own (a module that
    // threw on load, exit 1) reads as before, and a control (from: null) names no test
    if (!caught && m.from !== null && !IR.reported(out, m.caughtBy) && !IR.fileExitsIn(tap).length) throw new Error(IR.neverReported(crashed));
    return { applied, caught, failed: [...new Set(failed)] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('control: the unmutated copy passes every texmaker test', () => {
  const r = runMutant({ file: 'make.js', from: null, to: null, caughtBy: '(no test is named this)' });
  assert.deepEqual(r.failed, [], `the unmutated copy fails: ${r.failed.join(' | ')}`);
});
// D352: a crashed inner run is no verdict. The stand-in puts the machine's crash (test/inner_run.js STANDIN) at the top of the first mutant's file;
// it looks for '.test.js', which every dead file's own ✖ line contains, so a dead file's line must not count as the catch
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in, D352)', () => {
  const m0 = MUTATIONS[0], first = fs.readFileSync(path.join(SRC, m0.file), 'utf8').split(/\r?\n/)[0];
  const said = IR.reading(() => { const r = runMutant({ ...m0, id: 'crash stand-in', caughtBy: '.test.js', from: first, to: IR.STANDIN + first }); return r.caught ? 'caught' : `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`; });
  assert.match(said, IR.NOT_TESTED);
});
// D353: a crash AFTER an unrelated failing row leaves no file-level entry in the TAP, so only the named test's silence shows it. The second
// stand-in (test/inner_run.js STANDIN_AFTER_FAIL) fails a row and then dies, in every file that loads the first mutant's file; caughtBy is the real one
test('a crash after an unrelated failing row reads NOT TESTED, never NOT CAUGHT (the second stand-in, D353)', () => {
  const m0 = MUTATIONS[0], first = fs.readFileSync(path.join(SRC, m0.file), 'utf8').split(/\r?\n/)[0];
  const said = IR.reading(() => { const r = runMutant({ ...m0, id: 'crash after a failing row', from: first, to: IR.STANDIN_AFTER_FAIL + first }); return r.caught ? 'caught' : `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`; });
  assert.match(said, IR.NOT_TESTED_ANY);
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" is not in src/texmaker/${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
