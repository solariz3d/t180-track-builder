#!/usr/bin/env node
// test-fast.cjs: the FAST SUBSET of the suite, the one CI runs on every push and pull request (.github/workflows/ci.yml), and
// the one to run locally before pushing:
//
//   node scripts/test-fast.cjs            (prints the files it leaves out, then runs node --test on the rest)
//   node scripts/test-fast.cjs --list     (prints the files it would run, and runs nothing)
//   node scripts/test-fast.cjs --mutation (runs ONLY the mutation harnesses: CI's weekly job)
//   node scripts/test-fast.cjs --timing   (runs ONLY the timing files, one at a time, and only on a machine whose profile
//                                          says heavy.timing: true; anywhere else it prints the skip and runs nothing)
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
// THE MACHINE'S PROFILE (L153, his words: "what may work on my desktop … might work differently than our laptop"): the
// "heavy" object in this machine's own ~/.consonance.json, which is never synced between machines, e.g.
//   "heavy": { "concurrency": 2, "timing": false }
// - concurrency: --test-concurrency here and in scripts/test-touched.cjs. T180_TEST_CONCURRENCY overrides it for one run;
//   with neither it is 4, as before. Each machine's number is measured on that machine, not picked.
// - timing: true only on the machine the timing bars are set for (the one he plays on, 165 Hz). Anywhere else, absent
//   included, --timing prints the skip and runs nothing: a timing red read on the wrong machine says nothing about the code.
// No file, or no "heavy", is today's behaviour. A file or a value the runners cannot read is refused by name, never defaulted.
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

const os = require('os');
const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(os.homedir(), '.consonance.json');
const DIRS = ['test', 'app/test'];
const MUTATION = /mutation\.test\.js$/;   // group 1, by the harnesses' own naming (CLAUDE.md: "*_mutation.test.js"; app/test also has mutation.test.js and *-mutation.test.js)
const FRAME_TIMING = new Set(['app/test/drag-frame.test.js', 'app/test/release-frame.test.js', 'app/test/sculpt-frame.test.js',
  'app/test/core-extra-bank-drag-cost.test.js', 'app/test/preview-lod-frame.test.js']);   // group 2

// this machine's profile: { concurrency?, timing?, source } from the file's "heavy" object; source names where it came from
function profile(file = CONFIG) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { source: `no ${file}` }; throw e; }
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error(`test-fast: ${file} is not JSON (${e.message}); fix it or move it, the runners do not guess`); }
  const h = j && j.heavy;
  if (h === undefined) return { source: `${file} (no "heavy")` };
  if (!h || typeof h !== 'object' || Array.isArray(h)) throw new Error(`test-fast: ${file} "heavy" must be an object`);
  if (h.concurrency !== undefined && !(Number.isInteger(h.concurrency) && h.concurrency >= 1)) throw new Error(`test-fast: ${file} heavy.concurrency must be a whole number from 1 up, got ${JSON.stringify(h.concurrency)}`);
  if (h.timing !== undefined && typeof h.timing !== 'boolean') throw new Error(`test-fast: ${file} heavy.timing must be true or false, got ${JSON.stringify(h.timing)}`);
  return { concurrency: h.concurrency, timing: h.timing, source: file };
}

// The worker count: T180_TEST_CONCURRENCY, else the profile's heavy.concurrency, else 4. A bad env value is refused by name.
function concurrency(env = process.env, prof = profile()) {
  const v = env.T180_TEST_CONCURRENCY;
  if (v !== undefined && v !== '') {
    if (!/^[1-9][0-9]*$/.test(v)) throw new Error(`T180_TEST_CONCURRENCY must be a whole number from 1 up, got "${v}"`);
    return Number(v);
  }
  return prof.concurrency !== undefined ? prof.concurrency : 4;
}
const concurrencyFrom = (env, prof) => (env.T180_TEST_CONCURRENCY ? 'T180_TEST_CONCURRENCY' : prof.concurrency !== undefined ? `heavy.concurrency in ${prof.source}` : 'default');

// whether the timing files run on this machine, and the line that says so
// L156 lift 3: the line names the machine (its host name), so a timing result in a log says which machine it was read on
function timingPlan(prof, host = os.hostname()) {
  if (prof.timing === true) return { run: true, line: `timing files: run here on ${host}, one at a time (heavy.timing: true in ${prof.source})` };
  const why = prof.timing === false ? `heavy.timing: false in ${prof.source}` : `heavy.timing is not set (${prof.source})`;
  return { run: false, line: `timing files: skipped on this machine (${host}), ${why}; they run only where the timing bars are set` };
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
  const prof = profile();
  if (argv.includes('--timing')) {
    const t = timingPlan(prof), timing = [...FRAME_TIMING];
    console.log(`test-fast --timing: ${t.line}`);
    if (argv.includes('--list')) { for (const f of timing) console.log(f); return 0; }
    if (!t.run) return 0;
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...timing], { cwd: ROOT, stdio: 'inherit' });
    if (r.error) throw r.error;
    console.log(`test-fast --timing: the timing group ran on ${os.hostname()}, exit ${r.status === null ? 'killed' : r.status}`);
    return r.status === null ? 1 : r.status;
  }
  const run = argv.includes('--mutation') ? mutation : fast;
  if (argv.includes('--list')) { for (const f of run) console.log(f); return 0; }
  if (!argv.includes('--mutation')) {
    console.log(`test-fast: ${fast.length} of ${all.length} test files; left out: ${mutation.length} mutation harnesses (weekly), ${FRAME_TIMING.size} frame-timing pages (${[...FRAME_TIMING].map((f) => path.basename(f)).join(', ')})`);
  } else console.log(`test-fast --mutation: the ${mutation.length} mutation harnesses`);
  if (!argv.includes('--mutation')) console.log(`test-fast: ${timingPlan(prof).line}`);
  const n = concurrency(process.env, prof);
  console.log(`test-fast: --test-concurrency=${n} (${concurrencyFrom(process.env, prof)})`);
  const r = spawnSync(process.execPath, ['--test', `--test-concurrency=${n}`, ...run], { cwd: ROOT, stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status === null ? 1 : r.status;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { files, MUTATION, FRAME_TIMING, CONFIG, profile, concurrency, concurrencyFrom, timingPlan, main };
