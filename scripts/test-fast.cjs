#!/usr/bin/env node
// test-fast.cjs: the FAST SUBSET of the suite, the one CI runs on every push and pull request (.github/workflows/ci.yml), and
// the one to run locally before pushing:
//
//   node scripts/test-fast.cjs            (prints the files it leaves out, then runs node --test on the rest)
//   node scripts/test-fast.cjs --list     (prints the files it would run, and runs nothing)
//   node scripts/test-fast.cjs --mutation (runs ONLY the mutation harnesses: CI's weekly job)
//
// It is `npm test` (every test/*.test.js and app/test/*.test.js, --test-concurrency=4) minus three groups, each left out for a
// stated reason. Every other file runs, including the page tests in headless Chrome (they skip, with the reason, where there
// is no Chrome) and the Blender rows (they skip where Blender is absent):
//   1. THE MUTATION HARNESSES (*mutation*.test.js): each copies a module, applies one patch at a time and runs inner suites
//      against it; together they are most of the full run's tens of minutes. They run weekly and on demand (--mutation).
//   2. THE FRAME-TIMING PAGES (drag-frame, release-frame, sculpt-frame): they time real frames in headless Chrome against the
//      user's 165 Hz bar (6.0 ms) and are meant to run alone under the heavy-run lock (CLAUDE.md, "Tests"); a shared CI runner's
//      speed is not that machine's, so a red there says nothing about the code.
//   3. Nothing else is left out. A file is added to these lists by name with its reason, never by a pattern that could
//      silently catch a new test.
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIRS = ['test', 'app/test'];
const MUTATION = /mutation\.test\.js$/;   // group 1, by the harnesses' own naming (CLAUDE.md: "*_mutation.test.js"; app/test also has mutation.test.js and *-mutation.test.js)
const FRAME_TIMING = new Set(['app/test/drag-frame.test.js', 'app/test/release-frame.test.js', 'app/test/sculpt-frame.test.js']);   // group 2

function files() {
  const all = [];
  for (const d of DIRS) for (const f of fs.readdirSync(path.join(ROOT, d)).sort()) if (f.endsWith('.test.js')) all.push(`${d}/${f}`);
  return all;
}

function main(argv) {
  const all = files(), mutation = all.filter((f) => MUTATION.test(f));
  for (const f of FRAME_TIMING) if (!all.includes(f)) throw new Error(`test-fast: ${f} is listed as frame-timing but does not exist; update the list`);
  const fast = all.filter((f) => !MUTATION.test(f) && !FRAME_TIMING.has(f));
  const run = argv.includes('--mutation') ? mutation : fast;
  if (argv.includes('--list')) { for (const f of run) console.log(f); return 0; }
  if (!argv.includes('--mutation')) {
    console.log(`test-fast: ${fast.length} of ${all.length} test files; left out: ${mutation.length} mutation harnesses (weekly), ${FRAME_TIMING.size} frame-timing pages (${[...FRAME_TIMING].map((f) => path.basename(f)).join(', ')})`);
  } else console.log(`test-fast --mutation: the ${mutation.length} mutation harnesses`);
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...run], { cwd: ROOT, stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status === null ? 1 : r.status;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { files, MUTATION, FRAME_TIMING };
