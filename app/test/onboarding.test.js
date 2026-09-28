// Headless tests for app/onboarding (D177, ARCHITECTURE §11.7): the guide's step machine, the moves it sees through A's
// real shell, the first-run flag, and the cited defaults. Run: node --test --test-concurrency=4 "app/test/*.test.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createShell } = require('../shell.js');
const { loadCjs } = require('../lib/cjs.js');
const { STEPS, createGuide, PLACE_AT_LEAST } = require('../onboarding/guide.js');
const { firstRun, webStore, KEY } = require('../onboarding/firstrun.js');
const { DEFAULTS, apply } = require('../onboarding/defaults.js');
const { MACH6 } = require('../../src/validate/limits.js');

const REPO = path.resolve(__dirname, '..', '..');
const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
const ids = (g) => g.state.step && g.state.step.id;

// ── the step machine ──
test('five steps in order: place, sculpt, close, colours, export', () => {
  assert.deepStrictEqual(STEPS.map((s) => s.id), ['place', 'sculpt', 'close', 'colours', 'export']);
  assert.ok(STEPS.every((s) => s.title && s.text && s.target));
});
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
  assert.deepStrictEqual([ids(g), g.state.skipped.place, g.state.done.place], ['sculpt', true, undefined]);
});
test('back returns one step, and stops at the first', () => {
  const g = createGuide();
  g.back(); assert.strictEqual(ids(g), 'place');
  g.skip(); g.skip(); g.back();
  assert.strictEqual(ids(g), 'sculpt');
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

// ── the user's moves, seen through A's real shell: the guide never makes them ──
test(`placing ${PLACE_AT_LEAST} words (a starter phrase counts word by word) completes "place" and moves on`, async () => {
  const s = await createShell({ storage: mem() }), g = createGuide();
  s.subscribe((st) => g.observe(st));
  s.place('straight'); s.place('turn');
  assert.strictEqual(ids(g), 'place', 'two is not yet a few');
  s.place('straight');
  assert.deepStrictEqual([g.state.done.place, ids(g)], [true, 'sculpt']);
});
test('ONE starter phrase ("sakura flow", five words) completes "place": a phrase counts word by word, not as one entry', async () => {
  const s = await createShell({ storage: mem() }), g = createGuide();
  s.subscribe((st) => g.observe(st));
  s.place(DEFAULTS.firstPiece.value);
  const doc = s.getState().history.present;
  assert.strictEqual(doc.words.length, 1, `one entry on the track (${s.getState().message})`);
  assert.ok(doc.words[0].words.length >= PLACE_AT_LEAST, 'the phrase holds enough words on its own');
  assert.deepStrictEqual([g.state.done.place, ids(g)], [true, 'sculpt']);
});
test('a handle dragged on a placed word completes "sculpt"; placing more words does not', async () => {
  const s = await createShell({ storage: mem() }), g = createGuide();
  s.subscribe((st) => g.observe(st));
  for (const w of ['straight', 'turn', 'straight']) s.place(w);
  s.place('straight');
  assert.strictEqual(ids(g), 'sculpt', 'another placement is not a sculpt');
  s.beginDrag(); s.dragTo('w2', { handles: { length: 250 } }); s.endDrag();
  assert.deepStrictEqual([g.state.done.sculpt, ids(g)], [true, 'close']);
});
test('closing the loop with the connector completes "close", and the guide waits on the reading step', async () => {
  const s = await createShell({ storage: mem() }), g = createGuide();
  s.subscribe((st) => g.observe(st));
  for (const w of ['straight', 'straight', 'turn', 'straight', 'turn']) s.place(w);
  s.beginDrag(); s.dragTo('w1', { handles: { length: 120 } }); s.endDrag();
  s.closeLoop();
  assert.strictEqual(s.getState().history.present.closed, true, s.getState().message);
  assert.deepStrictEqual([g.state.done.close, ids(g)], [true, 'colours']);
});
test('an export (the shell\'s state.lastExport) completes "export" and finishes the guide', () => {
  const g = createGuide();
  for (let k = 0; k < 4; k++) g.skip();
  const doc = { words: [], closed: true };
  g.observe({ history: { present: doc } });
  assert.strictEqual(ids(g), 'export');
  g.observe({ history: { present: doc }, lastExport: { dir: 'x', folders: ['t180b_x'] } });
  assert.deepStrictEqual([g.state.done.export, g.state.status], [true, 'finished']);
});
test('a move made early is remembered: closing before sculpting completes "close" when the guide reaches it', () => {
  const g = createGuide(), doc = { words: [1, 2, 3].map(() => ({})), closed: true };
  g.observe({ history: { present: doc } });
  assert.deepStrictEqual([g.state.done.place, g.state.done.close, ids(g)], [true, true, 'sculpt']);
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

// ── the defaults, cited ──
test('the defaults are the program\'s own: the font and tempo pickers, the design speed of FINDINGS.md:476', async () => {
  assert.strictEqual(DEFAULTS.designSpeedKmh.value, MACH6.designSpeedKmh);
  const s = await createShell({ storage: mem() });
  s.setPicker('font', 'bowl'); s.setPicker('tempo', 'serpents');
  const st = apply(s);
  assert.deepStrictEqual([st.pickers.font, st.pickers.tempo], [DEFAULTS.font.value, DEFAULTS.tempo.value]);
  assert.ok(s.palette().some((p) => p.name === DEFAULTS.firstPiece.value) || !require('../../src/doc/library.js').builtinLibrary().pieces.some((p) => p.kind === 'phrase'),
    'the first piece is in the palette once the phrasebook is registered');
});
test('every default says where it comes from, and every line it cites says what it quotes', () => {
  for (const [k, d] of Object.entries(DEFAULTS)) {
    assert.ok(/FINDINGS\.md:\d|ARCHITECTURE\.md:\d|inferred/.test(d.source), `${k}: ${d.source}`);
    for (const m of d.source.matchAll(/(FINDINGS|ARCHITECTURE)\.md:(\d+)(?:-(\d+))? (?:names |measures as |, )?"([^"]+)"/g)) {
      const lines = fs.readFileSync(path.join(REPO, 'docs', `${m[1]}.md`), 'utf8').split('\n').slice(+m[2] - 1, +(m[3] || m[2])).join(' ');
      for (const part of m[4].split(' … ')) assert.ok(lines.includes(part), `${m[1]}.md:${m[2]} does not say "${part}"`);
    }
  }
  assert.match(DEFAULTS.tempo.source, /^inferred/);
});

test('the guide loads through A\'s webview loader and exports mount(root, shell)', async () => {
  const m = await loadCjs('app/onboarding/index.js', async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));
  assert.strictEqual(typeof m.mount, 'function');
});

test('the guide names one starter phrase, its first piece, once: it never leads into bowl hairpin after bowl hairpin (D180)', () => {
  // bowl hairpin → bowl hairpin is the one chain of two phrases that comes out red (test/phrasebook.test.js)
  const { PHRASES } = require('../../src/doc/phrasebook.js');
  const named = new Set();
  for (const s of STEPS) for (const p of PHRASES) if (new RegExp(`"${p.name}"`).test(s.text)) named.add(p.name);
  assert.deepStrictEqual([...named], [DEFAULTS.firstPiece.value]);
  assert.notStrictEqual(DEFAULTS.firstPiece.value, 'bowl hairpin');
});
