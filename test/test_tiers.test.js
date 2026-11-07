// test_tiers.test.js: the test tiers (L153). What scripts/test-fast.cjs leaves out, the worker count both runners read
// (T180_TEST_CONCURRENCY), and what scripts/test-touched.cjs picks for a changed file and why. Every row reads the real
// repository; nothing runs a suite. The runners are required inside each row so a missing script fails only its own rows.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const fast = () => require('../scripts/test-fast.cjs');
const touched = () => require('../scripts/test-touched.cjs');
const files = (r) => r.run.map((x) => x.file);

test('T1 test-fast leaves out the two timing files L152 found it running (core-extra-bank-drag-cost, preview-lod-frame)', () => {
  const { files: all, FRAME_TIMING, MUTATION } = fast();
  const list = all().filter((f) => !MUTATION.test(f) && !FRAME_TIMING.has(f));
  assert.ok(!list.includes('app/test/core-extra-bank-drag-cost.test.js'));
  assert.ok(!list.includes('app/test/preview-lod-frame.test.js'));
});

// T2 amended (L155 amendment, 12:17Z): the worker count now also reads the machine's profile, so the row passes an empty
// profile explicitly; without it the row would read this machine's ~/.consonance.json.
test('T2 T180_TEST_CONCURRENCY: unset is 4, a whole number is read, anything else is refused by name', () => {
  const { concurrency } = fast();
  const none = { source: 'none' };
  assert.equal(concurrency({}, none), 4);
  assert.equal(concurrency({ T180_TEST_CONCURRENCY: '2' }, none), 2);
  for (const bad of ['0', '-1', '2.5', 'two', ' ']) assert.throws(() => concurrency({ T180_TEST_CONCURRENCY: bad }, none), /T180_TEST_CONCURRENCY/);
});

// a throwaway ~/.consonance.json for the profile rows, removed after
function withConfig(text, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-tiers-'));
  const file = path.join(dir, '.consonance.json');
  try { if (text !== null) fs.writeFileSync(file, text); return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('T10 the machine profile (heavy.concurrency in ~/.consonance.json) sets the workers; the env var overrides it; absent is 4', () => {
  const { profile, concurrency } = fast();
  withConfig(JSON.stringify({ data_dir: 'x', heavy: { concurrency: 2, timing: false } }), (file) => {
    const p = profile(file);
    assert.equal(concurrency({}, p), 2);
    assert.equal(concurrency({ T180_TEST_CONCURRENCY: '3' }, p), 3);
  });
  withConfig(null, (file) => assert.equal(concurrency({}, profile(file)), 4));
  withConfig(JSON.stringify({ data_dir: 'x' }), (file) => assert.equal(concurrency({}, profile(file)), 4));
});

test('T11 a profile the runners cannot read is refused by name, never defaulted', () => {
  const { profile } = fast();
  withConfig('{ not json', (file) => assert.throws(() => profile(file), /consonance.json/));
  withConfig(JSON.stringify({ heavy: { concurrency: 'two' } }), (file) => assert.throws(() => profile(file), /heavy.concurrency/));
  withConfig(JSON.stringify({ heavy: { timing: 'yes' } }), (file) => assert.throws(() => profile(file), /heavy.timing/));
});

test('T12 the timing files run only where the profile says timing: true; otherwise the skip is printed with the reason', () => {
  const { profile, timingPlan } = fast();
  withConfig(JSON.stringify({ heavy: { timing: true } }), (file) => assert.equal(timingPlan(profile(file)).run, true));
  for (const text of [JSON.stringify({ heavy: { timing: false } }), JSON.stringify({}), null]) {
    withConfig(text, (file) => {
      const t = timingPlan(profile(file));
      assert.equal(t.run, false, String(text));
      assert.match(t.line, /skipped/);
      assert.match(t.line, /timing/);
    });
  }
});

test('T3 a changed panel.js picks the panel tests, with the require chain as the reason, and not an unrelated core test', () => {
  const r = touched().select(['app/core/panel.js'], { root: ROOT });
  const hit = r.run.find((x) => x.file === 'app/test/core-extra-handles.test.js');
  assert.ok(hit, 'core-extra-handles is picked');
  assert.match(hit.reasons.join(' '), /app\/core\/panel\.js/);
  assert.ok(!files(r).includes('test/geom_fonts.test.js') && !files(r).includes('test/ailine.test.js'));
  assert.equal(r.fallback.length, 0);
});

test('T4 a changed core module lists its mutation harness, and runs it only when asked (--mutation)', () => {
  const plain = touched().select(['src/core/extend.js'], { root: ROOT });
  assert.ok(!files(plain).some((f) => /mutation\.test\.js$/.test(f)), 'no harness runs by default');
  assert.ok(plain.left.some((x) => x.file === 'test/core_ramp_mutation.test.js' && /mutation/.test(x.why)), 'the harness is named as left out');
  const asked = touched().select(['src/core/extend.js'], { root: ROOT, mutation: true });
  assert.ok(files(asked).includes('test/core_ramp_mutation.test.js'));
});

test('T5 a file the graph cannot read (a stylesheet, the Rust side) falls back to test-fast', () => {
  for (const f of ['app/themes/aqua.css', 'src-tauri/Cargo.toml', 'package.json']) {
    const r = touched().select([f], { root: ROOT });
    assert.deepEqual(r.fallback.map((x) => x.file), [f], f);
  }
});

test('T6 documentation alone runs nothing and does not fall back', () => {
  const r = touched().select(['CHANGELOG.md', 'MAP.md'], { root: ROOT });
  assert.equal(r.run.length, 0);
  assert.equal(r.fallback.length, 0);
});

test('T7 a module the page loads (index.html → loadCjs) picks the page tests that open index.html', () => {
  const r = touched().select(['app/closer.js'], { root: ROOT });
  const hit = r.run.find((x) => x.file === 'app/test/core-pieces-ui.test.js');
  assert.ok(hit, 'a page test is picked');
  assert.match(hit.reasons.join(' '), /index\.html/);
});

test('T8 frame-timing files are never run by test-touched, even when the change reaches them', () => {
  const r = touched().select(['app/core/panel.js'], { root: ROOT });
  for (const f of fast().FRAME_TIMING) assert.ok(!files(r).includes(f), f);
  assert.ok(r.left.some((x) => fast().FRAME_TIMING.has(x.file) && /timing/.test(x.why)), 'a reached timing file is named as left out');
});

test('T9 a changed test file picks itself; a file no test reaches falls back', () => {
  const r = touched().select(['app/test/core-extra-handles.test.js'], { root: ROOT });
  assert.deepEqual(files(r), ['app/test/core-extra-handles.test.js']);
  const lone = touched().select(['scripts/bench.js'], { root: ROOT });
  assert.equal(lone.run.length, 0);
  assert.deepEqual(lone.fallback.map((x) => x.file), ['scripts/bench.js']);
});

// L156: E's proof (lighthouse exo_memory/handback/p-l155-proof-E_2026-11-07.md) found two of thirteen past reds the tiers would miss. #40 was a correctness row
// inside a timing file, so the rows that time nothing moved out of the five timing files into normal files (T13). #59 was a test that loads its module through
// require(path.join(ADIR, …)), which the graph could not read; 36 of 349 test files load something that way (T14-T17).
const MOVED = ['app/test/sculpt-release-exact.test.js', 'app/test/drag-release-exact.test.js', 'app/test/release-ghost-arrives.test.js', 'app/test/preview-lod-share.test.js', 'app/test/core-extra-bank-laid.test.js'];

test('T13 test-fast runs the correctness rows moved out of the timing files; none of them is a timing file', () => {
  const { files: all, FRAME_TIMING, MUTATION } = fast();
  const list = all().filter((f) => !MUTATION.test(f) && !FRAME_TIMING.has(f));
  for (const f of MOVED) assert.ok(list.includes(f), f);
});

test('T14 E\'s #59: a changed app/testhook/probe.js picks render_proof, which loads it through require(path.join(ADIR, …))', () => {
  const r = touched().select(['app/testhook/probe.js'], { root: ROOT, prof: { source: 'none' } });
  const hit = r.run.find((x) => x.file === 'app/test/render_proof.test.js');
  assert.ok(hit, 'render_proof is picked');
  assert.match(hit.reasons.join(' '), /app\/testhook\/probe\.js/);
});

test('T15 a base built on another base (SRC = path.join(ADIR, \'..\', \'src\')) is followed: a changed src/export/fromwords.js picks aclook', () => {
  const r = touched().select(['src/export/fromwords.js'], { root: ROOT, prof: { source: 'none' } });
  assert.ok(r.run.some((x) => x.file === 'app/test/aclook.test.js'));
});

test('T16 a base with an env override (T = process.env.T180_TREE ? path.resolve(…) : path.join(__dirname, \'..\')) is followed at its default', () => {
  const r = touched().select(['src/core/turnby.js'], { root: ROOT, prof: { source: 'none' } });
  assert.ok(r.run.some((x) => x.file === 'test/core_joint_c2.test.js'));
});

test('T17 require(path.resolve(__dirname, …)) is followed; a path built from a variable is not guessed at', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-graph-'));
  try {
    for (const [f, text] of [
      ['src/m.js', 'module.exports = 1;\n'],
      ['test/x.test.js', "const path = require('path');\nconst M = require(path.resolve(__dirname, '../src/m.js'));\n"],
      ['test/y.test.js', "const path = require('path');\nconst name = '../src/m.js';\nconst M = require(path.join(__dirname, name));\n"],
    ]) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); }
    const r = touched().select(['src/m.js'], { root: dir, prof: { source: 'none' } });
    assert.deepEqual(r.run.map((x) => x.file), ['test/x.test.js']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T18 L156 lift 3: the timing line names the machine that ran (or skipped) the timing group', () => {
  const { timingPlan } = fast();
  assert.match(timingPlan({ timing: true, source: 'x' }, 'PLAYBOX').line, /PLAYBOX/);
  assert.match(timingPlan({ timing: false, source: 'x' }, 'LAPBOX').line, /LAPBOX/);
});
