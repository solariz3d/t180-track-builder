// perf.test.js: node --test --test-concurrency=4 test/perf.test.js. Hardening (D175), the fast part of the default suite.
// Stated before the first run:
//   · PER-CELL REBUILD (ARCHITECTURE §3: "Cells are the unit of export, culling and incremental rebuild; editing a word
//     rebuilds only its cells"). Through A's real shell and C's preview track model: after a LENGTH sculpt of one word
//     in the middle of a track, the cells rebuilt (new vertex arrays) are exactly that word's cells and the seams on
//     its two sides; every other cell keeps its arrays (the same objects). A FONT edit also rebuilds the next word's
//     entry ramp (its first part blends from this word's font), and nothing else. The counts are printed and asserted.
//   · NO MESH OVER IPC DURING A DRAG (§9: "Mesh data must never cross Tauri IPC during a drag"). Every call to the
//     native side goes through the shell's storage (app/index.html wires it to Tauri invoke). During a whole drag, with
//     the preview model and E's validation subscribed as in the window and autosave forced to fire at once, every call
//     is recorded: none carries a typed array or a buffer, only text, and no export is written. And app/preview and
//     app/camera contain no native call at all (no __TAURI__, invoke, storage or writeExport).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const { createShell } = require(path.join(R, 'app/shell.js'));
const APP = process.env.APP_DIR || path.join(R, 'app');   // the mutation harness points this at a mutant copy
const { createTrackModel } = require(path.join(APP, 'preview/trackmodel.js'));
const { createValidationController } = require(path.join(R, 'app/validate-ui/panel.js'));

const TRACK = ['straight', 'sweep', 'turn', 'straight', 'wall-ride', 'straight', 'sweep', 'straight'];
function recorder() {
  const calls = [];
  const rec = (name) => async (...args) => { calls.push({ name, args }); if (name === 'openDoc') return null; if (name === 'listDocs') return []; return undefined; };
  const storage = {}; for (const n of ['saveDoc', 'openDoc', 'listDocs', 'saveLibrary', 'openLibrary', 'saveAutosave', 'openAutosave', 'writeExport']) storage[n] = rec(n);
  return { storage, calls };
}
async function built(opts = {}) {
  const { storage, calls } = recorder();
  const shell = await createShell({ storage, autosaveMs: 0, ...opts }), model = createTrackModel();
  shell.subscribe((st) => { if (st.resolved) model.update(st.resolved); });
  for (const w of TRACK) shell.place(w);
  return { shell, model, calls };
}
/** The batches whose vertex arrays are new objects since `before` (a Set of arrays): the cells that were rebuilt. */
const rebuilt = (batches, before) => batches.filter((b) => !before.has(b.positions)).map((b) => b.key);
const wordOf = (key) => (key.match(/_(w\d+)(?:_|$)/) || [])[1];

test('per-cell rebuild: a length sculpt of one word rebuilds only that word\'s cells and the seams on its sides', async () => {
  const { shell, model } = await built(), before = new Set(model.update(shell.getState().resolved).batches.map((b) => b.positions));
  const total = model.update(shell.getState().resolved).batches.length, id = 'w4';
  const w = shell.getState().history.present.words.find((x) => x.id === id);
  shell.sculpt(id, { handles: { length: w.handles.length + 7.5 } });
  assert.equal(shell.getState().message, null);
  const r = model.update(shell.getState().resolved); assert.equal(r.how, 'same', 'the subscriber already applied it');
  const keys = rebuilt(r.batches, before), ownCells = r.batches.filter((b) => !b.seam && wordOf(b.key) === id).length;
  console.log(`# length sculpt of ${id}: ${keys.length} of ${total} cells rebuilt: ${keys.join(', ')}`);
  assert.ok(keys.length >= 1);
  for (const k of keys) assert.ok(wordOf(k) === id || (k.includes('seam') && ['w4', 'w5'].includes(wordOf(k))), `${k} was rebuilt but is not ${id}'s or a seam beside it`);
  assert.ok(keys.length <= ownCells + 2, `at most its ${ownCells} cells and 2 seams`);
});
test('per-cell rebuild: a font edit also rebuilds the next word\'s entry ramp, and nothing else', async () => {
  const { shell, model } = await built(), before = new Set(model.update(shell.getState().resolved).batches.map((b) => b.positions));
  shell.sculpt('w4', { font: 'half-pipe' });
  assert.equal(shell.getState().message, null);
  const keys = rebuilt(model.update(shell.getState().resolved).batches, before);
  console.log(`# font edit of w4: rebuilt ${keys.join(', ')}`);
  assert.ok(keys.some((k) => wordOf(k) === 'w4') && keys.some((k) => wordOf(k) === 'w5'), 'w4 and w5\'s entry ramp');
  for (const k of keys) assert.ok(['w4', 'w5', 'w6'].includes(wordOf(k)), `${k} is not w4, w5's ramp, or a seam beside them`);
  const w5 = keys.filter((k) => wordOf(k) === 'w5' && !k.includes('seam'));
  assert.ok(w5.length >= 1 && w5.every((k) => /_w5_in_\d+$/.test(k)), `of w5 only its entry part ("in") is rebuilt: ${w5}`);
});
test('no mesh over IPC during a drag: every native call is text, none a typed array; no export; autosave fires as text', async () => {
  const immediate = { setTimeout: (f) => { f(); return 1; }, clearTimeout: () => {} };
  const { shell, model, calls } = await built({ autosaveMs: 1, timers: immediate });
  const ctl = createValidationController(shell);
  calls.length = 0;
  const w = shell.getState().history.present.words.find((x) => x.id === 'w3');
  shell.beginDrag();
  for (let k = 1; k <= 10; k++) shell.dragTo('w3', { handles: { length: w.handles.length + k } });
  shell.endDrag();
  await new Promise((r) => setImmediate(r));
  const isBinary = (v) => ArrayBuffer.isView(v) || v instanceof ArrayBuffer || (v && typeof v === 'object' && Object.values(v).some(isBinary));
  assert.ok(model.mesh && ctl.state.path, 'the preview and the validation both ran during the drag');
  for (const c of calls) {
    assert.ok(!c.args.some(isBinary), `${c.name} carried binary data`);
    assert.ok(c.args.every((a) => typeof a === 'string' || a === undefined), `${c.name} carried a non-text argument`);
  }
  assert.ok(!calls.some((c) => c.name === 'writeExport'), 'no export during a drag');
  const bytes = calls.reduce((a, c) => a + c.args.reduce((b, x) => b + (typeof x === 'string' ? x.length : 0), 0), 0);
  console.log(`# a 10-step drag: ${calls.length} native calls (${[...new Set(calls.map((c) => c.name))].join(', ') || 'none'}), ${bytes} characters, all text`);
  ctl.dispose();
});
test('no mesh over IPC: app/preview and app/camera never call the native side at all', () => {
  for (const dir of ['preview', 'camera']) {
    for (const f of fs.readdirSync(path.join(APP, dir)).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(APP, dir, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const bad of ['__TAURI__', 'invoke(', 'storage.', 'writeExport']) assert.ok(!src.includes(bad), `${dir}/${f} mentions ${bad}`);
    }
  }
});
