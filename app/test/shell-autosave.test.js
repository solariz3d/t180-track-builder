// shell-autosave.test.js: node --test app/test/*.test.js
// Autosave and crash recovery (app/shell.js). An unsaved track is written, debounced, through storage.saveAutosave;
// the next start offers it back; saving under a name, or a clean exit, clears it. Storage is a Map here; in the app it
// is the native side, writing to the app's data folder (src-tauri/src/lib.rs), never the repository.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShell } = require('../shell.js');
const D = require('../../src/doc/index.js');

function store() {
  const s = { docs: new Map(), lib: null, auto: null, autoWrites: 0 };
  return Object.assign(s, {
    saveDoc: async (n, t) => { s.docs.set(n, t); }, openDoc: async (n) => s.docs.get(n), listDocs: async () => [...s.docs.keys()],
    saveLibrary: async (t) => { s.lib = t; }, openLibrary: async () => s.lib,
    saveAutosave: async (t) => { s.auto = t; s.autoWrites++; }, openAutosave: async () => s.auto, clearAutosave: async () => { s.auto = null; },
  });
}
const text = (sh) => D.serialize(sh.getState().history.present);

test('an edit is autosaved: the autosave holds the byte-identical document', async () => {
  const st = store(), sh = await createShell({ storage: st, autosaveMs: 0 });
  sh.place('straight'); sh.place('turn');
  await sh.flushAutosave();
  assert.ok(st.auto, 'nothing was autosaved');
  assert.equal(JSON.parse(st.auto).doc, text(sh));
});

test('after a crash, the next start offers the unsaved track, and restoring it gives it back byte for byte', async () => {
  const st = store(), a = await createShell({ storage: st, autosaveMs: 0 });
  a.place('straight'); a.place('tight'); a.place('jump');
  await a.flushAutosave();
  const lost = text(a);
  // no cleanExit: the app "crashed"
  const b = await createShell({ storage: st, autosaveMs: 0 });
  assert.ok(b.getState().recovery, 'no recovery offered');
  assert.equal(b.getState().history.present.words.length, 0, 'recovery is offered, not applied behind the user\'s back');
  b.restore();
  assert.equal(text(b), lost);
  assert.equal(b.getState().dirty, true);
  assert.equal(b.getState().recovery, null);
});

test('a clean exit clears the autosave, and the next start offers nothing', async () => {
  const st = store(), a = await createShell({ storage: st, autosaveMs: 0 });
  a.place('turn'); await a.flushAutosave();
  await a.cleanExit();
  assert.equal(st.auto, null);
  assert.equal((await createShell({ storage: st })).getState().recovery, null);
});

test('saving under a name clears the autosave: the named file holds the track now', async () => {
  const st = store(), a = await createShell({ storage: st, autosaveMs: 0 });
  a.place('turn'); await a.flushAutosave();
  await a.save('kept');
  assert.equal(st.auto, null);
});

test('the track name rides with the autosave, so a restored named track keeps its name', async () => {
  const st = store(), a = await createShell({ storage: st, autosaveMs: 0 });
  a.place('turn'); await a.save('mine'); a.place('tight'); await a.flushAutosave();
  const b = await createShell({ storage: st });
  b.restore();
  assert.equal(b.getState().name, 'mine');
  assert.equal(b.getState().history.present.words.length, 2);
});

test('discarding the offer clears the autosave', async () => {
  const st = store(), a = await createShell({ storage: st, autosaveMs: 0 });
  a.place('turn'); await a.flushAutosave();
  const b = await createShell({ storage: st });
  await b.discardRecovery();
  assert.equal(st.auto, null);
  assert.equal(b.getState().recovery, null);
});

test('a session with no edits writes no autosave', async () => {
  const st = store(), a = await createShell({ storage: st, autosaveMs: 0 });
  a.setPicker('tempo', 'aurora');
  await a.flushAutosave();
  assert.equal(st.autoWrites, 0);
});

test('a damaged autosave does not stop the app: no offer, and a message saying why', async () => {
  const st = store(); st.auto = '{"doc": "not a document"}';
  const b = await createShell({ storage: st });
  assert.equal(b.getState().recovery, null);
  assert.match(b.getState().message, /autosave/i);
});

test('edits in quick succession are written once, after the pause (debounced)', async () => {
  const st = store(), timers = [];
  const fakeTimers = { setTimeout: (fn, ms) => { timers.push(fn); return timers.length; }, clearTimeout: (id) => { timers[id - 1] = null; } };
  const a = await createShell({ storage: st, autosaveMs: 1000, timers: fakeTimers });
  a.place('straight'); a.place('turn'); a.place('tight');
  assert.equal(st.autoWrites, 0, 'written before the pause');
  for (const fn of timers) if (fn) await fn();
  assert.equal(st.autoWrites, 1);
  assert.equal(JSON.parse(st.auto).doc, text(a));
});

test('an autosave that fails to write says so, and the track is untouched', async () => {
  const st = store(); st.saveAutosave = async () => { throw new Error('disk full'); };
  const a = await createShell({ storage: st, autosaveMs: 0 });
  a.place('turn'); const before = text(a);
  await a.flushAutosave();
  assert.match(a.getState().message, /autosave failed: disk full/);
  assert.equal(text(a), before);
});
