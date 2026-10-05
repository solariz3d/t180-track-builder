// Headless tests for app/onboarding (D177, ARCHITECTURE §11.7): the guide's step machine, the moves it sees through the real
// shell, and the first-run flag. Run: node --test --test-concurrency=4 "app/test/*.test.js"
// D239 (the keeper: "can we keep only the equation mode?"): the steps are the EQUATION builder's (extend, brush, close, colours, export,
// grid), seen through the core shell (app/core/coreshell.js); the step-machine tests are restated on those ids, unchanged in what they
// check. RETIRED D239, by name, each the piece builder's: 'five steps in order: place, sculpt, close, colours, export' (now six, the
// equation builder's: app/test/core-eqonly.test.js), 'placing 3 words (a starter phrase counts word by word) completes "place" and moves
// on', 'ONE starter phrase ("sakura flow", five words) completes "place": a phrase counts word by word, not as one entry', 'a handle
// dragged on a placed word completes "sculpt"; placing more words does not', 'closing the loop with the connector completes "close", and
// the guide waits on the reading step' (the core's own: app/test/core-eqonly.test.js), 'the defaults are the program's own: the font and
// tempo pickers, the design speed of FINDINGS.md:476', 'every default says where it comes from, and every line it cites says what it
// quotes' (app/onboarding/defaults.js is removed: it set the piece palette's pickers), 'the guide names one starter phrase, its first
// piece, once: it never leads into bowl hairpin after bowl hairpin (D180)' (the guide names no phrase).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createCoreShell } = require('../core/coreshell.js');
const { loadCjs } = require('../lib/cjs.js');
const { STEPS, createGuide, EXTEND_AT_LEAST } = require('../onboarding/guide.js');
const { firstRun, webStore, KEY } = require('../onboarding/firstrun.js');

const REPO = path.resolve(__dirname, '..', '..');
const ids = (g) => g.state.step && g.state.step.id;

// ── the step machine ──
test('next moves on; on the reading step (colours) it marks it done', () => {
  const g = createGuide();
  for (let k = 0; k < 3; k++) g.skip();
  assert.strictEqual(ids(g), 'colours');
  g.next();
  assert.deepStrictEqual([ids(g), g.state.done.colours], ['export', true]);
});
test('skip moves on and records the step as skipped, never as done', () => {
  const g = createGuide();
  g.skip();
  assert.deepStrictEqual([ids(g), g.state.skipped.extend, g.state.done.extend], ['brush', true, undefined]);
});
test('back returns one step, and stops at the first', () => {
  const g = createGuide();
  g.back(); assert.strictEqual(ids(g), 'extend');
  g.skip(); g.skip(); g.back();
  assert.strictEqual(ids(g), 'brush');
});
test('finish ends the guide at any step; past the last step it is finished too', () => {
  const a = createGuide(); a.skip(); a.finish();
  assert.deepStrictEqual([a.state.status, a.state.step], ['finished', null]);
  const b = createGuide(); for (let k = 0; k < STEPS.length; k++) b.skip();
  assert.strictEqual(b.state.status, 'finished');
  assert.strictEqual(b.next().status, 'finished', 'nothing moves after the end');
});
test('onChange is told every move', () => {
  const seen = [], g = createGuide({ onChange: (s) => seen.push(s.index) });
  g.skip(); g.back(); g.skip();
  assert.deepStrictEqual(seen, [1, 0, 1]);
});

// ── the user's moves, seen through the real core shell: the guide never makes them ──
test(`extending ${EXTEND_AT_LEAST} pieces completes "extend" and moves on; two is not yet a few`, async () => {
  const s = await createCoreShell({ brushFn: null }), g = createGuide();
  s.subscribe((st) => g.observe(st));
  s.extend({ length: 200 }); s.extend({ length: 200 });
  assert.strictEqual(ids(g), 'extend', 'two is not yet a few');
  s.extend({ length: 200 });
  assert.deepStrictEqual([g.state.done.extend, ids(g)], [true, 'brush']);
});
test('a brush stroke completes "brush"; extending more does not', async () => {
  const s = await createCoreShell({ brushFn: null }), g = createGuide();
  s.subscribe((st) => g.observe(st));
  for (let k = 0; k < EXTEND_AT_LEAST + 1; k++) s.extend({ length: 200 });
  assert.strictEqual(ids(g), 'brush', 'another piece is not a brush stroke');
  s.beginBrush({ mode: 'rate', channel: 'kv', s0: 300, r: 80 }); s.brushTo(0.001); s.endBrush();
  assert.deepStrictEqual([g.state.done.brush, ids(g)], [true, 'close']);
});
test('an export (the shell\'s state.lastExport) completes "export" and moves to the last step', () => {
  const g = createGuide();
  for (let k = 0; k < 4; k++) g.skip();
  const doc = { pieces: [], closed: true };
  g.observe({ history: { present: doc } });
  assert.strictEqual(ids(g), 'export');
  g.observe({ history: { present: doc }, lastExport: { dir: 'x', folders: ['t180b_x'] } });
  assert.deepStrictEqual([g.state.done.export, ids(g)], [true, 'grid']);
});
test('a move made early is remembered: closing before brushing completes "close" when the guide reaches it', () => {
  const g = createGuide(), doc = { pieces: [1, 2, 3].map(() => ({})), closed: true };
  g.observe({ history: { present: doc } });
  assert.deepStrictEqual([g.state.done.extend, g.state.done.close, ids(g)], [true, true, 'brush']);
  g.skip();
  assert.strictEqual(ids(g), 'colours', 'close was already done, so the guide passes it');
});

// ── the first-run flag ──
const memStore = () => { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) }; };
test('first run until the guide is finished or skipped; then remembered, with how and when', () => {
  const st = memStore(), fr = firstRun(st);
  assert.strictEqual(fr.isFirst(), true);
  assert.strictEqual(fr.remember('skipped'), true);
  assert.strictEqual(firstRun(st).isFirst(), false, 'a new session reads it back');
  assert.strictEqual(JSON.parse(st.m.get(KEY)).how, 'skipped');
  assert.throws(() => fr.remember('maybe'), /not finished or skipped/);
});
test('"Show the guide" forgets the flag, so it opens again', () => {
  const st = memStore(), fr = firstRun(st);
  fr.remember('finished'); fr.forget();
  assert.strictEqual(fr.isFirst(), true);
});
test('storage that is missing or throws means "not remembered": the guide shows, nothing breaks', () => {
  assert.strictEqual(firstRun(null).isFirst(), true);
  const broken = { get: () => { throw new Error('denied'); }, set: () => { throw new Error('denied'); } };
  assert.strictEqual(firstRun(broken).isFirst(), true);
  assert.strictEqual(firstRun(broken).remember('finished'), false);
  assert.strictEqual(webStore(null), null);
});
test('webStore wraps localStorage: an empty value removes the key', () => {
  const m = new Map(), ls = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const s = webStore({ localStorage: ls });
  s.set('a', '1'); assert.strictEqual(s.get('a'), '1');
  s.set('a', ''); assert.strictEqual(m.has('a'), false);
});

test('the guide loads through A\'s webview loader and exports mount(root, shell)', async () => {
  const m = await loadCjs('app/onboarding/index.js', async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));
  assert.strictEqual(typeof m.mount, 'function');
});
