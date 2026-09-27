// Headless tests for app/handles/panel.js (the handles panel's logic) against A's real shell: a drag goes through the
// shell's beginDrag/dragTo/endDrag, clamps at the physics bound, and is one undo step. Run: node --test "app/test/*.test.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createShell } = require('../shell.js');
const { createHandlesController } = require('../handles/panel.js');

const DEG = Math.PI / 180;
const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
const roll1 = (shell, id) => shell.getState().history.present.words.find((w) => w.id === id).handles.roll1;

test('no handles until exactly one placed word is selected', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createHandlesController(shell);
  shell.place('straight'); shell.place('turn');
  assert.strictEqual(ctl.target(), null);
  shell.select('w1', 'w2');
  assert.strictEqual(ctl.target(), null);
  shell.select('w2');
  const t = ctl.target();
  assert.deepStrictEqual([t.id, t.word], ['w2', 'turn']);
  assert.deepStrictEqual([...new Set(t.rows.map((r) => r.group))], ['length', 'curvature', 'ramps', 'pitch', 'bank', 'width', 'wall', 'psi', 'transition']);
});

test('through the shell: a drag clamps at the bound, and the whole drag is one undo step', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createHandlesController(shell, { csp: false });
  shell.place('straight'); shell.place('straight'); shell.select('w2');
  const undoBefore = shell.getState().history.past.length;
  const { bounds } = ctl.begin('roll1');
  for (const v of [0.2, 0.6, 3]) ctl.move(v);
  const m = ctl.move(3);
  assert.deepStrictEqual([m.clamped, m.value], [true, bounds.max]);
  assert.ok(Math.abs(bounds.max - 50 * DEG) < 2e-5);
  ctl.end();
  assert.ok(Math.abs(roll1(shell, 'w2') - bounds.max) < 1e-6);
  assert.strictEqual(shell.getState().history.past.length, undoBefore + 1);
  shell.undo();
  assert.strictEqual(roll1(shell, 'w2'), 0);
});

test('pastRed (Alt) goes through the bound and shows red', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createHandlesController(shell, { csp: false });
  shell.place('straight'); shell.place('straight'); shell.select('w2');
  ctl.begin('roll1', { pastRed: true });
  const m = ctl.move(1);
  assert.deepStrictEqual([m.clamped, m.level], [false, 'red']);
  ctl.end();
});

test('a value the document refuses is stopped at the last value it accepts, and the reason is the document\'s own', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createHandlesController(shell);
  shell.place('straight'); shell.place('straight'); shell.select('w2');
  ctl.begin('easeIn');
  const m = ctl.move(0.9);   // easeIn + easeOut over 1 is refused (src/doc)
  // the bound search already met A's refusal, so the drag stops at the last value A accepts, and says so
  assert.strictEqual(m.clamped, true);
  assert.match(m.why, /^refused by the document: .*easeIn \+ easeOut/);
  ctl.cancel();
});

test('one drag at a time', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createHandlesController(shell);
  shell.place('straight'); shell.place('straight'); shell.select('w2');
  ctl.begin('roll1');
  assert.throws(() => ctl.begin('length'), /already open/);
  ctl.end();
});

test('cancel through the shell puts the value back (the shell has no cancel, so one no-op undo entry remains: a named seam)', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createHandlesController(shell, { csp: false });
  shell.place('straight'); shell.place('straight'); shell.select('w2');
  const before = shell.getState().history.past.length;
  ctl.begin('roll1'); ctl.move(0.5);
  ctl.cancel();
  assert.strictEqual(roll1(shell, 'w2'), 0);
  assert.strictEqual(shell.getState().history.past.length, before + 1);
});

test('on a word already red there is no bound to stop at, so the document\'s own refusal stops the drag, through the shell', async () => {
  const shell = await createShell({ storage: mem() });
  shell.setPicker('font', 'half-pipe');
  const ctl = createHandlesController(shell, { csp: false });   // 60° walls: red for vanilla AC
  shell.place('straight'); shell.place('straight'); shell.select('w2');
  const { bounds } = ctl.begin('easeIn');
  assert.strictEqual(bounds.min, null);
  const m = ctl.move(0.9);
  assert.deepStrictEqual([m.level, m.clamped], ['refused', true]);
  assert.match(m.why, /easeIn \+ easeOut/);
  assert.notStrictEqual(m.value, 0.9);
  ctl.cancel();
});
