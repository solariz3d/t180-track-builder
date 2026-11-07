#!/usr/bin/env node
// test-fast.cjs: the FAST SUBSET of the suite, the one CI runs on every push and pull request (.github/workflows/ci.yml), and
// the one to run locally before pushing:
//
//   node scripts/test-fast.cjs            (prints the files it leaves out, then runs node --test on the rest)
//   node scripts/test-fast.cjs --list     (prints the files it would run, and runs nothing)
//   node scripts/test-fast.cjs --mutation (runs ONLY the mutation harnesses: CI's weekly job)
//
// It is `npm test` (every test/*.test.js and app/test/*.test.js) minus three groups, each left out for a
// stated reason. Every other file runs, including the page tests in headless Chrome (they skip, with the reason, where there
// is no Chrome) and the Blender rows (they skip where Blender is absent):
//   1. THE MUTATION HARNESSES (*mutation*.test.js): each copies a module, applies one patch at a time and runs inner suites
//      against it; together they are most of the full run's tens of minutes. They run weekly and on demand (--mutation).
//   2. THE FRAME-TIMING PAGES (drag-frame, release-frame, sculpt-frame, core-extra-bank-drag-cost, preview-lod-frame): they
//      time real frames or drags against a bar set for the user's machine (165 Hz, 6.0 ms) and are meant to run alone under
//      the heavy-run lock (CLAUDE.md, "Tests"); another machine's speed, or a busy one, is not that machine's, so a red there
//      says nothing about the code. The last two were added at L153: L152 found this list running them.
//   3. Nothing else is left out. A file is added to these lists by name with its reason, never by a pattern that could
//      silently catch a new test.
//
// Workers: T180_TEST_CONCURRENCY (a whole number, default 4) sets --test-concurrency here and in scripts/test-touched.cjs.
// A machine that runs hot sets it lower for itself (the laptop: 2, L153); CI leaves it unset.
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIRS = ['test', 'app/test'];
const MUTATION = /mutation\.test\.js$/;   // group 1, by the harnesses' own naming (CLAUDE.md: "*_mutation.test.js"; app/test also has mutation.test.js and *-mutation.test.js)
const FRAME_TIMING = new Set(['app/test/drag-frame.test.js', 'app/test/release-frame.test.js', 'app/test/sculpt-frame.test.js',
  'app/test/core-extra-bank-drag-cost.test.js', 'app/test/preview-lod-frame.test.js']);   // group 2

// The worker count, from T180_TEST_CONCURRENCY; anything but a whole number from 1 up is refused by name, never defaulted.
function concurrency(env = process.env) {
  const v = env.T180_TEST_CONCURRENCY;
  if (v === undefined || v === '') return 4;
  if (!/^[1-9][0-9]*$/.test(v)) throw new Error(`T180_TEST_CONCURRENCY must be a whole number from 1 up, got "${v}"`);
  return Number(v);
}

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
  const n = concurrency();
  console.log(`test-fast: --test-concurrency=${n}${process.env.T180_TEST_CONCURRENCY ? ' (T180_TEST_CONCURRENCY)' : ''}`);
  const r = spawnSync(process.execPath, ['--test', `--test-concurrency=${n}`, ...run], { cwd: ROOT, stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status === null ? 1 : r.status;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { files, MUTATION, FRAME_TIMING, concurrency, main };
