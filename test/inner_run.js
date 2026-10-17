// inner_run.js: shared by the mutation harnesses (D352). Not a test file.
// A harness runs the tests again in a child `node --test`, on a mutated copy. When a child test file dies natively (on this machine: node.exe
// exit 3221225477, 0xC0000005, an access violation; see exo_memory/handback/p-d351-filedeath-E_2026-10-17.md), its tests never ran, and the spec
// reporter shows only "✖ <file> (N ms)" with no exit code. Read as spec, that line made a mutant "NOT CAUGHT" (a harness that looks for its
// catching test) or "caught" (one that counts failures). Neither is true: the mutant was NOT TESTED.
// - reporterArgs(file): spec on stdout as before, plus a TAP copy in `file`; only TAP carries a dead file's exitCode and signal.
// - crashes(tap): the files that died natively with no failing test of their own, as [{ file, code }].
// - crashesIn(file): the same, read from a TAP copy; a missing copy throws (the child run never wrote one, which is no verdict either).
// - notTested(list): the one message every harness fails with: "native crash <code> in <file>: the mutant was NOT TESTED".
// A file that exits 1 (a test failed, or the module threw on load) is not a crash: a mutant that breaks loading is a real catch, as before.
// Native means a Windows exception status (0xC0000000 and up) or a POSIX fault signal. Nothing is retried and nothing is skipped: the run stays red.
'use strict';
const fs = require('fs'), path = require('path');

const FAULT_SIGNALS = new Set(['SIGSEGV', 'SIGBUS', 'SIGILL', 'SIGFPE', 'SIGABRT']);
const reporterArgs = (file) => ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=tap', `--test-reporter-destination=${file}`];
const unq = (s) => (s === undefined ? undefined : s.replace(/^'(.*)'$/, '$1').replace(/\\\\/g, '\\'));

/** Every `not ok` entry of a TAP stream, with its location, exitCode and signal (any depth). */
function failures(tap) {
  const L = tap.split(/\r?\n/), out = [];
  for (let i = 0; i < L.length; i++) {
    const m = /^(\s*)not ok \d+ - (.*)$/.exec(L[i]);
    if (!m) continue;
    const e = { name: m[2] };
    if (L[i + 1] !== undefined && L[i + 1].trim() === '---') {
      for (let j = i + 2; j < L.length && L[j].trim() !== '...'; j++) {
        const kv = /^\s*(location|exitCode|signal):\s*(.*)$/.exec(L[j]);
        if (kv && !(kv[1] in e)) e[kv[1]] = kv[2];
      }
    }
    e.location = unq(e.location);
    out.push(e);
  }
  return out;
}
const isNative = (e) => (e.exitCode !== undefined && Number(e.exitCode) >= 0xC0000000) || FAULT_SIGNALS.has(unq(e.signal || ''));

function crashes(tap) {
  if (typeof tap !== 'string') throw new TypeError('crashes(tap): the TAP text is not a string');
  const all = failures(tap), dead = [];
  for (const e of all.filter(isNative)) {
    const file = (e.location || e.name).replace(/:\d+:\d+$/, '');
    const own = all.some((o) => o !== e && !isNative(o) && o.location && o.location.startsWith(file + ':'));   // a failing test of its own = it was tested
    if (!own) dead.push({ file, code: e.exitCode !== undefined && e.exitCode !== '~' ? Number(e.exitCode) : unq(e.signal) });
  }
  return dead;
}
function crashesIn(file) {
  let tap;
  try { tap = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`the inner test run wrote no TAP copy (${file}): ${e.code || e.message}; the mutant was NOT TESTED`); }
  return crashes(tap);
}
function notTested(list) {
  if (!Array.isArray(list) || !list.length) throw new TypeError('notTested(list): no crash to report');
  return `native crash ${[...new Set(list.map((c) => c.code))].join(', ')} in ${list.map((c) => path.basename(c.file)).join(', ')}: the mutant was NOT TESTED`;
}

// THE STAND-IN, for each harness's own row: one line put at the top of a module the inner run loads, so every test file that loads it dies the way
// the machine's crash does (exit 3221225477 on Windows, SIGSEGV elsewhere), before any test of its own reports
const STANDIN = "process.platform === 'win32' ? process.reallyExit(3221225477) : process.kill(process.pid, 'SIGSEGV');\n";
const NOT_TESTED = /^native crash (3221225477|SIGSEGV) in .+: the mutant was NOT TESTED$/;
/** What a harness row would say: the verdict fn() returns, or the message it throws. */
function reading(fn) { try { return String(fn()); } catch (e) { return e.message; } }

// D353: a crash AFTER a failing row of the same file leaves no file-level entry in the TAP at all (pane E measured 9 of 9 real children), so
// crashes() cannot see it. What still shows is that the named test never reported a line of its own. For the six harnesses that look for a named test.
/** Whether the named test reported a top-level ✔ or ✖ line of its own in a spec output. */
// D354 (pane E, review 4, F2): this is a SUBSTRING match, so a passing test in another file whose name contains caughtBy counts as the named one;
// if the catching test died in a crash after a failing row, its twin hides that and the mutant reads NOT CAUGHT, not NOT TESTED (message only: the
// row is red either way). Five caughtBy strings have twins today ('extendOptions', 'the rate brush', 'the layout', 'soak:', 'renderer: after a
// sculpt'); they stay as they are, since making them unique would rewrite what each row claims as its catch
const reported = (out, name) => out.split(/\r?\n/).some((l) => /^[✔✖] /.test(l) && l.slice(2).includes(name));
/** The files that ended with an exit code of their own that is not native (a module that threw on load, exit 1): a verdict, read as before D353. */
function fileExitsIn(file) {
  let tap;
  try { tap = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`the inner test run wrote no TAP copy (${file}): ${e.code || e.message}; the mutant was NOT TESTED`); }
  return failures(tap).filter((e) => e.exitCode !== undefined && e.exitCode !== '~' && !isNative(e));
}
// D354: `loadThrows` (from fileExitsIn) and `files` (how many test files the run had) name the files that ended on their own when a load throw
// cannot be the verdict: in a run of more than one file, another file's load throw says nothing about the named test's file (pane E, review 4, F1)
function neverReported(crashed = [], loadThrows = [], files = 0) {
  const why = [];
  if (crashed.length) why.push(notTested(crashed).replace(/: the mutant was NOT TESTED$/, ''));
  if (loadThrows.length) {
    why.push(`a load throw in ${loadThrows.map((e) => `${path.basename((e.location || e.name).replace(/:\d+:\d+$/, ''))} (exit ${e.exitCode})`).join(', ')}; ` +
      `the run had ${files} files`);
  }
  return `the named test never reported${why.length ? ` (${why.join('; ')})` : ''}: the mutant was NOT TESTED`;
}
// THE LOAD-THROW STAND-IN (D354): one line at the top of a module, so every test file that loads it throws on load (exit 1), as a mutant that
// breaks loading does. In a run of one file that is a verdict, as before D353; in a run of more it reads NOT TESTED and names the files
const LOAD_THROW = "throw new Error('D354 stand-in: the module throws on load');\n";
// F1's shape (pane E, review 4): the test file named `throwIn` throws on load; every other file that loads the module fails a row, then dies
const STANDIN_LOAD_THEN_CRASH = (throwIn) => `if (process.getBuiltinModule('node:path').basename(String(process.argv[1])) === ${JSON.stringify(throwIn)}) ` +
  `throw new Error('D354 stand-in: this file throws on load'); else ${STANDIN_AFTER_FAIL}`;
// a load throw usually exits 1; a file whose own exception handler then fails exits 7 (seen in mutation.test.js's run), so any code is named
const NOT_TESTED_LOAD = /^the named test never reported \(a load throw in \S+\.test\.js \(exit \d+\)(, \S+\.test\.js \(exit \d+\))*; the run had \d+ files\): the mutant was NOT TESTED$/;
const NOT_CAUGHT_LOAD = /^NOT CAUGHT; failing tests on the mutant: \S.*\.test\.js \(/;
// THE SECOND STAND-IN: one line at the top of a module, which registers a row that fails and then a row that dies 300 ms later, in every test file
// that loads the module, before that file's own rows run (pane E's form: an unrelated failure, then the crash)
const STANDIN_AFTER_FAIL = "{ const T = process.getBuiltinModule('node:test'); T.test('D353 stand-in: an unrelated row that fails', () => { throw new Error('the stand-in fails first'); }); " +
  "T.test('D353 stand-in: the row that dies', () => new Promise((r) => setTimeout(r, 300)).then(() => (process.platform === 'win32' ? process.reallyExit(3221225477) : process.kill(process.pid, 'SIGSEGV')))); }\n";
// either NOT TESTED message: which one shows depends on whether the failed row's report reached the parent before the death (E's two timings)
const NOT_TESTED_ANY = /^(the named test never reported( \(native crash .+\))?|native crash (3221225477|SIGSEGV) in .+): the mutant was NOT TESTED$/;

module.exports = { reporterArgs, crashes, crashesIn, notTested, failures, STANDIN, NOT_TESTED, reading, reported, fileExitsIn, neverReported, STANDIN_AFTER_FAIL, NOT_TESTED_ANY,
  LOAD_THROW, STANDIN_LOAD_THEN_CRASH, NOT_TESTED_LOAD, NOT_CAUGHT_LOAD };
