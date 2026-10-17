// inner_run.test.js: node --test test/inner_run.test.js. The mutation harnesses' crash reading (test/inner_run.js, D352), on real child runs:
// small test files in a temp dir that pass, fail a row, throw on load, or die the way node.exe dies on this machine (exit 3221225477).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('./inner_run.js');

const FILES = {
  'pass.test.js': "require('node:test')('a row that passes', () => {});\n",
  'failrow.test.js': "require('node:test')('a row that fails', () => { require('node:assert').equal(1, 2); });\n",
  'loadthrow.test.js': "throw new Error('the module throws on load');\n",
  'crash.test.js': IR.STANDIN + "require('node:test')('a row that never runs', () => {});\n",
  'afterfail.test.js': "require('./afterfail_mod.js'); require('node:test')('the named row', () => {});\n",   // D353: the module fails a row, then dies
  'f1a.test.js': "require('./f1_mod.js'); require('node:test')('the named row', () => {});\n",   // D354, F1: this one throws on load
  'f1b.test.js': "require('./f1_mod.js'); require('node:test')('the named row', () => {});\n",   // ... and this one fails a row, then dies
  'crashlater.test.js': "const test = require('node:test'); test('a row that passes first', () => {});\ntest('a row that crashes', () => { " + IR.STANDIN.trim() + " });\n",
};
function run(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-inner-run-')), tap = path.join(dir, 'run.tap');
  try {
    for (const n of names) fs.writeFileSync(path.join(dir, n), FILES[n]);
    fs.writeFileSync(path.join(dir, 'afterfail_mod.js'), IR.STANDIN_AFTER_FAIL);
    fs.writeFileSync(path.join(dir, 'f1_mod.js'), IR.STANDIN_LOAD_THEN_CRASH('f1a.test.js'));
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...IR.reporterArgs(tap), ...names.map((n) => path.join(dir, n))],
      { cwd: dir, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), encoding: 'utf8', timeout: 60000 });
    if (r.error) throw r.error;
    return { out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), crashed: IR.crashesIn(tap), exits: IR.fileExitsIn(tap), status: r.status };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a test file that dies natively is a crash, with its code, and reads NOT TESTED; spec alone shows only its ✖ line', () => {
  const r = run(['crash.test.js']);
  assert.equal(r.crashed.length, 1);
  assert.equal(path.basename(r.crashed[0].file), 'crash.test.js');
  assert.ok(r.crashed[0].code === 3221225477 || r.crashed[0].code === 'SIGSEGV', `code ${r.crashed[0].code}`);
  assert.match(IR.notTested(r.crashed), IR.NOT_TESTED);
  assert.match(r.out, /ℹ tests 1\b/, 'the spec summary is still on stdout');
  assert.ok(!/3221225477|SIGSEGV/.test(r.out), 'the spec output carries no exit code (why the TAP copy is needed)');
});
test('a crash after a passing row is still a crash: no failing test of its own', () => {
  const r = run(['crashlater.test.js']);
  assert.deepEqual(r.crashed.map((c) => path.basename(c.file)), ['crashlater.test.js']);
});
test('a failing row, a module that throws on load, and a passing file are not crashes (exit 1 is a verdict, as before)', () => {
  const r = run(['pass.test.js', 'failrow.test.js', 'loadthrow.test.js']);
  assert.equal(r.status, 1, 'the run fails');
  assert.deepEqual(r.crashed, []);
});
test('in a run of several files only the dead one is named; the others still report', () => {
  const r = run(['failrow.test.js', 'crash.test.js', 'pass.test.js']);
  assert.deepEqual(r.crashed.map((c) => path.basename(c.file)), ['crash.test.js']);
  assert.match(r.out, /✖ a row that fails/);
  assert.match(IR.notTested(r.crashed), /^native crash \S+ in crash\.test\.js: the mutant was NOT TESTED$/);
});
test('boundaries: empty TAP has no crash; a missing TAP copy, a non-string and an empty list throw', () => {
  assert.deepEqual(IR.crashes(''), []);
  assert.throws(() => IR.crashes(undefined), /not a string/);
  assert.throws(() => IR.crashesIn(path.join(os.tmpdir(), 't180-no-such-dir', 'run.tap')), /wrote no TAP copy.*NOT TESTED/);
  assert.throws(() => IR.notTested([]), /no crash/);
});
test('the code is read from TAP as node writes it: exitCode 3221225477 or a fault signal is native; exitCode 1 and a SIGTERM kill are not', () => {
  const tap = (code, signal) => `TAP version 13\nnot ok 1 - C:\\\\x\\\\a.test.js\n  ---\n  location: 'C:\\\\x\\\\a.test.js:1:1'\n  exitCode: ${code}\n  signal: ${signal}\n  error: 'test failed'\n  ...\n1..1\n`;
  assert.deepEqual(IR.crashes(tap(3221225477, '~')), [{ file: 'C:\\x\\a.test.js', code: 3221225477 }]);
  assert.deepEqual(IR.crashes(tap('~', "'SIGSEGV'")), [{ file: 'C:\\x\\a.test.js', code: 'SIGSEGV' }]);
  assert.deepEqual(IR.crashes(tap(1, '~')), []);
  assert.deepEqual(IR.crashes(tap('~', "'SIGTERM'")), []);
});
test('a file that reported a failing test of its own before it died was tested: it is not a crash to report', () => {
  const tap = "TAP version 13\nnot ok 1 - a row that fails\n  ---\n  location: 'C:\\\\x\\\\a.test.js:4:1'\n  error: '1 == 2'\n  ...\n" +
    "not ok 2 - C:\\\\x\\\\a.test.js\n  ---\n  location: 'C:\\\\x\\\\a.test.js:1:1'\n  exitCode: 3221225477\n  signal: ~\n  ...\n" +
    "not ok 3 - C:\\\\x\\\\b.test.js\n  ---\n  location: 'C:\\\\x\\\\b.test.js:1:1'\n  exitCode: 3221225477\n  signal: ~\n  ...\n1..3\n";
  assert.deepEqual(IR.crashes(tap), [{ file: 'C:\\x\\b.test.js', code: 3221225477 }]);
});
// D353
test('a crash after an unrelated failing row: the named row never reports, and no exit of the file is left to read', () => {
  const r = run(['afterfail.test.js']);
  assert.match(r.out, /✖ D353 stand-in: an unrelated row that fails/);
  assert.equal(IR.reported(r.out, 'the named row'), false, 'the named row reported');
  assert.deepEqual(r.exits, [], 'a non-native exit of the file was read');
});
test('a module that throws on load leaves its file\'s own exit (exitCode 1), which is a verdict as before; a passing file leaves none', () => {
  const r = run(['loadthrow.test.js', 'pass.test.js']);
  assert.deepEqual(r.exits.map((e) => [path.basename(e.location.replace(/:\d+:\d+$/, '')), e.exitCode]), [['loadthrow.test.js', '1']]);
  assert.equal(IR.reported(r.out, 'a row that passes'), true);
});
test('reported: a top-level ✔ or ✖ line naming the test; an indented subtest line, another name or no output is not', () => {
  assert.equal(IR.reported('✔ the named row (1ms)\n', 'the named row'), true);
  assert.equal(IR.reported('✖ the named row (1ms)\r\n', 'the named row'), true);
  assert.equal(IR.reported('  ✔ the named row (1ms)\n', 'the named row'), false);
  assert.equal(IR.reported('✔ another row (1ms)\n', 'the named row'), false);
  assert.equal(IR.reported('', 'the named row'), false);
  assert.equal(IR.neverReported(), 'the named test never reported: the mutant was NOT TESTED');
  assert.equal(IR.neverReported([{ file: 'C:\\x\\a.test.js', code: 3221225477 }]), 'the named test never reported (native crash 3221225477 in a.test.js): the mutant was NOT TESTED');
  assert.match(IR.neverReported(), IR.NOT_TESTED_ANY);
});
// D354 (pane E, review 4, F1)
test('F1\'s shape: one file throws on load, another fails a row and dies; only the first leaves an exit, and the message names it', () => {
  const r = run(['f1a.test.js', 'f1b.test.js']);
  assert.deepEqual(r.exits.map((e) => [path.basename(e.location.replace(/:\d+:\d+$/, '')), e.exitCode]), [['f1a.test.js', '1']]);
  assert.deepEqual(r.crashed, [], 'the crash after a failing row left an entry after all');
  assert.match(r.out, /✖ D353 stand-in: an unrelated row that fails/);
  assert.equal(IR.reported(r.out, 'the named row'), false, 'the named row reported');
  assert.equal(IR.neverReported(r.crashed, r.exits, 2), 'the named test never reported (a load throw in f1a.test.js (exit 1); the run had 2 files): the mutant was NOT TESTED');
});
test('neverReported names every file that ended on its own and the file count, beside any crash; with none it reads as before (D354)', () => {
  const ex = (n, code = '1') => ({ name: `C:\\x\\${n}`, location: `C:\\x\\${n}:1:1`, exitCode: code });
  const two = IR.neverReported([], [ex('a.test.js'), ex('b.test.js', '7')], 9);
  assert.equal(two, 'the named test never reported (a load throw in a.test.js (exit 1), b.test.js (exit 7); the run had 9 files): the mutant was NOT TESTED');
  assert.match(two, IR.NOT_TESTED_LOAD);
  assert.equal(IR.neverReported([{ file: 'C:\\x\\c.test.js', code: 3221225477 }], [ex('a.test.js')], 2),
    'the named test never reported (native crash 3221225477 in c.test.js; a load throw in a.test.js (exit 1); the run had 2 files): the mutant was NOT TESTED');
  assert.equal(IR.neverReported([], [], 2), 'the named test never reported: the mutant was NOT TESTED');
  assert.doesNotMatch(IR.neverReported(), IR.NOT_TESTED_LOAD);
});
