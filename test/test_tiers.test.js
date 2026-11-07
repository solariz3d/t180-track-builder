// test_tiers.test.js: the test tiers (L153). What scripts/test-fast.cjs leaves out, the worker count both runners read
// (T180_TEST_CONCURRENCY), and what scripts/test-touched.cjs picks for a changed file and why. Every row reads the real
// repository; nothing runs a suite. The runners are required inside each row so a missing script fails only its own rows.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

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

test('T2 T180_TEST_CONCURRENCY: unset is 4, a whole number is read, anything else is refused by name', () => {
  const { concurrency } = fast();
  assert.equal(concurrency({}), 4);
  assert.equal(concurrency({ T180_TEST_CONCURRENCY: '2' }), 2);
  for (const bad of ['0', '-1', '2.5', 'two', ' ']) assert.throws(() => concurrency({ T180_TEST_CONCURRENCY: bad }), /T180_TEST_CONCURRENCY/);
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
