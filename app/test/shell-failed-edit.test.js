// shell-failed-edit.test.js: node --test app/test/shell-failed-edit.test.js. The shell's contract, "a FAILED action
// changes nothing and says why", for an edit that is valid as a document but cannot be RESOLVED into a track (the soak's
// find, seed 1 op #71: an end roll that would tear the surface at the next word).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createShell } = require('../shell.js');
const D = require('../../src/doc/index.js');

const mem = () => ({ saveDoc: async () => {}, openDoc: async () => null, listDocs: async () => [], saveLibrary: async () => {}, openLibrary: async () => null, saveAutosave: async () => {}, openAutosave: async () => null });

test('place straight, straight; sculpt w1 roll1 = 0.74: refused, no history entry, the document byte-identical, a message', async () => {
  const s = await createShell({ storage: mem(), autosaveMs: 0 });
  s.place('straight'); s.place('straight');
  const before = D.serialize(s.getState().history.present), past = s.getState().history.past.length;
  s.sculpt('w1', { handles: { roll1: 0.74 } });
  const st = s.getState();
  assert.strictEqual(st.history.past.length, past, 'no history entry');
  assert.strictEqual(D.serialize(st.history.present), before, 'the document is unchanged');
  assert.match(String(st.message), /ROLL_STEP/);
  assert.strictEqual(st.resolveError, null, 'the track still resolves');
  assert.ok(st.resolved && st.resolved.segments.length > 0);
});

test('the same edit as a DRAG changes nothing either: the drag keeps its last good frame and adds no history', async () => {
  const s = await createShell({ storage: mem(), autosaveMs: 0 });
  s.place('straight'); s.place('straight');
  const before = D.serialize(s.getState().history.present), past = s.getState().history.past.length;
  s.beginDrag(); s.dragTo('w1', { handles: { roll1: 0.74 } });
  assert.match(String(s.getState().message), /ROLL_STEP/);
  assert.strictEqual(D.serialize(s.getState().history.present), before);
  s.endDrag();
  assert.strictEqual(s.getState().history.past.length, past);
  assert.strictEqual(s.getState().resolveError, null);
});

test('a good edit after a refused one commits normally and clears the message', async () => {
  const s = await createShell({ storage: mem(), autosaveMs: 0 });
  s.place('straight'); s.place('straight');
  s.sculpt('w1', { handles: { roll1: 0.74 } });
  s.sculpt('w1', { handles: { length: 120 } });
  assert.deepStrictEqual([s.getState().message, s.getState().history.present.words[0].handles.length], [null, 120]);
});
