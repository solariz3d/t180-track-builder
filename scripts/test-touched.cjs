#!/usr/bin/env node
// test-touched.cjs: the test files that load what you changed, for the runs you make WHILE you work. It is not the check a
// change is handed back or landed on: that is still scripts/test-fast.cjs, the whole base, once (CLAUDE.md, "Tests").
//
//   node scripts/test-touched.cjs                 (the files changed since the merge base with main, committed or not,
//                                                  untracked included; prints each picked test with its reason, then runs them)
//   node scripts/test-touched.cjs --list          (prints the picks and reasons, runs nothing)
//   node scripts/test-touched.cjs --base <ref>    (diff against <ref> instead of the merge base with main)
//   node scripts/test-touched.cjs --mutation      (also runs the mutation harnesses whose module changed)
//   node scripts/test-touched.cjs <file> …        (these files instead of the diff)
//
// How a test is picked, for each changed file:
//   - a changed test file runs itself;
//   - a test runs when it requires the file, directly or through any chain of relative require()s (the reason names the chain);
//   - a page test (one that opens app/index.html) runs when the page loads the file: index.html's loadCjs('…') entries and
//     <script src>, then their require()s, the way app/lib/cjs.js fetches them;
//   - a mutation harness is matched by the module paths it names in its source (they copy a module, they do not require it),
//     and runs only with --mutation: the harnesses run weekly on CI (L153);
//   - the frame-timing files (test-fast's list) are named and never run here: they run alone, under the heavy-run lock;
//   - documentation (.md, .txt) picks nothing.
// A changed file that is not code the graph can read (a stylesheet, an image, the Rust side, package.json…), or code that no
// test reaches, FALLS BACK: the whole of test-fast runs instead, and the reason is printed.
//
// WHAT IT CANNOT SEE, so a green here is not a green for the base. The require graph sees only who loads whom. It does not
// see coupling through data or behaviour: the panel asking for something other than what the core lays (D642 R2), geometry
// the renderer reads, a saved track a test loads as a fixture, a file read with fs and evaluated, a string a test greps for in
// another module's source, or a page that reaches a module some other way than loadCjs and require. A test that checks the
// code around yours through any of those is not picked. That is why the hand-back runs test-fast, the whole base, once.
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const fast = require('./test-fast.cjs');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'gen']);
const CODE = /\.(c|m)?js$|\.json$/;
const DOCS = /\.(md|txt)$/i;
const PAGE = 'app/index.html';
const IS_TEST = (f) => /^(test|app\/test)\/[^/]+\.test\.js$/.test(f);
const REQ = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const LOADCJS = /loadCjs\(\s*['"]([^'"]+)['"]/g;
const SCRIPT_SRC = /<script[^>]*\bsrc=["']([^"']+)["']/g;
const LITERAL = /['"`]([\w./-]+\.c?js)['"`]/g;
const posix = (p) => p.split(path.sep).join('/');

function walk(root) {
  const out = [];
  (function go(rel) {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) go(r); } else if (/\.(c|m)?js$/.test(e.name) || r === PAGE) out.push(r);
    }
  })('');
  return out;
}

// a relative require from `from`, as the repo path it names (an existing file, X.js, X/index.js, or the bare name when absent)
function resolve(root, from, spec) {
  const p = path.posix.normalize(`${path.posix.dirname(from)}/${spec}`);
  for (const c of [p, `${p}.js`, `${p}/index.js`]) { try { if (fs.statSync(path.join(root, c)).isFile()) return c; } catch { /* next */ } }
  return path.extname(p) ? p : `${p}.js`;
}

// who-loads-whom, reversed: loadedBy.get(x) = the files that load x, each with how
function graph(root) {
  const loadedBy = new Map(), sources = new Map();
  const edge = (to, from, how) => { if (!loadedBy.has(to)) loadedBy.set(to, []); loadedBy.get(to).push({ from, how }); };
  for (const f of walk(root)) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    sources.set(f, text);
    if (f === PAGE) {
      for (const m of text.matchAll(LOADCJS)) edge(path.posix.normalize(m[1]), f, 'loadCjs');
      for (const m of text.matchAll(SCRIPT_SRC)) if (!/^[a-z]+:/.test(m[1])) edge(path.posix.normalize(`app/${m[1]}`), f, '<script>');
      continue;
    }
    for (const m of text.matchAll(REQ)) if (m[1].startsWith('.')) edge(resolve(root, f, m[1]), f, 'require');
    if (IS_TEST(f) && text.includes('index.html')) edge(PAGE, f, 'opens');
  }
  return { loadedBy, sources };
}

// the tests that load `file`, each with the chain from the test down to it (shortest first, breadth-first)
function testsLoading(g, file) {
  const via = new Map([[file, null]]), queue = [file], found = new Map();
  while (queue.length) {
    const x = queue.shift();
    for (const { from } of g.loadedBy.get(x) || []) {
      if (via.has(from)) continue;
      via.set(from, x); queue.push(from);
      if (IS_TEST(from)) {
        const chain = [];
        for (let y = x; y !== null; y = via.get(y)) chain.push(y);
        found.set(from, `loads ${chain.join(' → ')}`);
      }
    }
  }
  return found;
}

// the mutation harnesses whose source names `file` (a literal like 'core/extend.js' that ends the changed path)
function harnessesNaming(g, file) {
  const out = [];
  for (const [f, text] of g.sources) {
    if (!IS_TEST(f) || !fast.MUTATION.test(f)) continue;
    for (const m of text.matchAll(LITERAL)) {
      const lit = m[1].replace(/^(\.\.?\/)+/, '');
      if (file === lit || file.endsWith(`/${lit}`)) { out.push([f, `mutation harness naming '${m[1]}'`]); break; }
    }
  }
  return out;
}

/**
 * select(changed, { root, mutation }) → { run, left, fallback, skipped }
 *   run:      [{ file, reasons }]  the test files to run, sorted
 *   left:     [{ file, why }]      reached but not run here (frame-timing; mutation harnesses without --mutation)
 *   fallback: [{ file, why }]      changed files the graph cannot answer for; any one means run test-fast instead
 *   skipped:  [{ file, why }]      changed files that pick nothing (documentation)
 */
function select(changed, { root = ROOT, mutation = false } = {}) {
  const g = graph(root);
  const picks = new Map(), fallback = [], skipped = [];
  const pick = (t, why) => { if (!picks.has(t)) picks.set(t, []); if (!picks.get(t).includes(why)) picks.get(t).push(why); };
  for (const raw of changed) {
    const file = posix(raw);
    if (DOCS.test(file)) { skipped.push({ file, why: 'documentation' }); continue; }
    if (IS_TEST(file)) { pick(file, 'changed'); continue; }
    if (!CODE.test(file) && file !== PAGE) { fallback.push({ file, why: 'not code the require graph can read' }); continue; }
    const hits = [...testsLoading(g, file), ...harnessesNaming(g, file)];
    if (!hits.length) { fallback.push({ file, why: 'no test loads it through require() or the page' }); continue; }
    for (const [t, why] of hits) pick(t, `${why}`);
  }
  const run = [], left = [];
  for (const file of [...picks.keys()].sort()) {
    const reasons = picks.get(file);
    if (fast.FRAME_TIMING.has(file)) left.push({ file, why: 'frame-timing: run alone under the heavy-run lock, never here' });
    else if (fast.MUTATION.test(file) && !mutation) left.push({ file, why: 'mutation harness: weekly on CI, or --mutation' });
    else run.push({ file, reasons });
  }
  return { run, left, fallback, skipped };
}

function git(args, root) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`test-touched: git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

function changedFiles(root, base) {
  const ref = base || git(['merge-base', 'HEAD', 'main'], root)[0];
  return [...new Set([...git(['diff', '--name-only', ref], root), ...git(['ls-files', '--others', '--exclude-standard'], root)])].sort();
}

function main(argv) {
  const opt = { list: false, mutation: false, base: null, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opt.list = true;
    else if (a === '--mutation') opt.mutation = true;
    else if (a === '--base') { opt.base = argv[++i]; if (!opt.base) throw new Error('test-touched: --base needs a ref'); }
    else if (a.startsWith('--')) throw new Error(`test-touched: unknown option ${a}`);
    else opt.files.push(a);
  }
  const changed = opt.files.length ? opt.files : changedFiles(ROOT, opt.base);
  const r = select(changed, { root: ROOT, mutation: opt.mutation });
  console.log(`test-touched: ${changed.length} changed file(s)${opt.files.length ? ' (named)' : ` (since ${opt.base || 'the merge base with main'})`}`);
  for (const x of r.skipped) console.log(`  skip ${x.file}: ${x.why}`);
  for (const x of r.run) console.log(`  run  ${x.file}: ${x.reasons.join('; ')}`);
  for (const x of r.left) console.log(`  out  ${x.file}: ${x.why}`);
  for (const x of r.fallback) console.log(`  FALLBACK ${x.file}: ${x.why}`);
  console.log('  not seen: coupling through data and behaviour (see this file\'s header); the hand-back runs test-fast.');
  if (r.fallback.length) {
    console.log(`test-touched: ${r.fallback.length} file(s) the graph cannot answer for, so the whole of test-fast runs instead`);
    return opt.list ? 0 : fast.main([]);
  }
  if (opt.list) return 0;
  if (!r.run.length) { console.log('test-touched: nothing to run'); return 0; }
  const n = fast.concurrency();
  console.log(`test-touched: ${r.run.length} test file(s), --test-concurrency=${n}`);
  const p = spawnSync(process.execPath, ['--test', `--test-concurrency=${n}`, ...r.run.map((x) => x.file)], { cwd: ROOT, stdio: 'inherit' });
  if (p.error) throw p.error;
  return p.status === null ? 1 : p.status;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { select, graph, changedFiles, main };
