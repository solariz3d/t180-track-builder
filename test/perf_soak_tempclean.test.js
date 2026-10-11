// perf_soak_tempclean.test.js: node --test test/perf_soak_tempclean.test.js. The soak's --progress test makes a `t180-soak-` folder in the
// system temp folder; 1,260 of them had piled up by 2026-10-11, one per run of the suite and of every mutation harness that runs it. This
// runs that test in a child whose temp folder (TEMP, TMP and TMPDIR) is a private one, then counts what is left in it: nothing, after a
// passing run AND after a run made to fail on purpose (T180_SOAK_TEMPCHECK_THROW, read by that test after it has made its folder).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SOAK_TEST = path.join(__dirname, 'perf_soak.test.js');

function runProgressTest(extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't180-tempcheck-'));
  try {
    const env = { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, ...extraEnv };
    delete env.T180_SOAK;   // the short soak only
    delete env.NODE_TEST_CONTEXT;   // inherited from this runner, it makes the child skip its files ("run() is being called recursively")
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=progress holds the LAST op', SOAK_TEST], { env, encoding: 'utf8', timeout: 120000 });
    const left = fs.readdirSync(tmp).filter((n) => n.startsWith('t180-soak-'));
    return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), left };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('the soak --progress test leaves no t180-soak- folder in temp after a passing run', () => {
  const r = runProgressTest({});
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /# pass 1/, 'control: the progress test actually ran and passed');
  assert.deepEqual(r.left, []);
});

test('the soak --progress test leaves no t180-soak- folder in temp when it fails', () => {
  const r = runProgressTest({ T180_SOAK_TEMPCHECK_THROW: '1' });
  assert.notEqual(r.status, 0, 'control: the run failed, as asked');
  assert.match(r.out, /T180_SOAK_TEMPCHECK_THROW/, 'control: it failed for the planted reason, after the folder was made');
  assert.deepEqual(r.left, []);
});
