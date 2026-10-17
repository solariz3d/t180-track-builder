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

module.exports = { reporterArgs, crashes, crashesIn, notTested, failures, STANDIN, NOT_TESTED, reading };
