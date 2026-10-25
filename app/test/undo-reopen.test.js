// undo-reopen.test.js: node --test app/test/undo-reopen.test.js
// The user, 2026-10-13, ELYSIUM reopened: "when I do undo and control z, it freezes like its trying to do something, but then when it releases its the same".
// Measured on his 24 km track: each undo took 54 to 102 s, the last steps were start-line moves (nothing visible), and one step changed nothing at all. Rows:
//   1  the history never keeps a step whose document has the same content as the one before (a commit, or a drag moved and put back)
//   2  a reopened history shares every unchanged piece between its steps (the same object), as one made in this session does
//   3  undo and redo say what they changed; with nothing to undo or redo they say so
//   4  the checker keeps its result when the road is unchanged (a start-line move), and still re-checks when it changed
//   5  removing pieces from the end in a history not made in this session (no undo copy) builds no full mesh, and equals a fresh full build
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('util');
const D = require('../../src/core/document.js');
const G = require('../../src/geom/index.js');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const { createValidationController } = require('../validate-ui/panel.js');

const R = 180, Q = (Math.PI * R) / 2;
function memStorage() {
  const files = new Map();
  return { files, saveDoc: async (n, t) => files.set(n, t), openDoc: async (n) => files.get(n), listDocs: async () => [...files.keys()], saveUndo: async (n, t) => files.set(n + '.undo', t), openUndo: async (n) => (files.has(n + '.undo') ? files.get(n + '.undo') : null), saveAutosave: async () => {}, clearAutosave: async () => {}, backupNow: async () => {} };
}
async function built(storage = null) {
  const s = await createCoreShell(storage ? { storage, autosaveMs: 0 } : {});
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 3; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 200, targets: { e: 20 } });
  assert.equal(s.getState().message, null, s.getState().message);
  return s;
}

test('row 1: a commit or a drag that leaves the document as it was adds no undo step', async () => {
  const s = await built(), h0 = s.getState().history, d = h0.present;
  s.commitDoc(D.parse(D.serialize(d)));   // a new object, the same text
  assert.equal(s.getState().history.past.length, h0.past.length, 'a same-content commit is no step');
  let h = D.beginDrag(s.getState().history); h = D.dragTo(h, D.parse(D.serialize(d))); h = D.endDrag(h);
  assert.equal(h.past.length, h0.past.length, 'a drag that ends where it began is no step');
  assert.equal(h.present, d, 'and keeps the very document it began with');
});

test('row 2: a reopened history shares unchanged pieces between its steps, as a history made in this session does', async () => {
  const storage = memStorage(), s = await built(storage);
  await s.save('T'); const t = await createCoreShell({ storage, autosaveMs: 0 }); await t.open('T');
  const h = t.getState().history; assert.ok(h.past.length >= 4, `the history came back (${h.past.length} steps)`);
  const prev = h.past[h.past.length - 1];
  for (let j = 0; j < prev.pieces.length; j++) assert.equal(prev.pieces[j], h.present.pieces[j], `piece ${j + 1} is the same object in both steps`);
});

test('row 3: undo and redo say what they changed, and say so when there is nothing', async () => {
  const s = await built();
  s.undo(); assert.match(s.getState().message, /^undid: piece p\d+ placed$/);
  s.redo(); assert.match(s.getState().message, /^redid: piece p\d+ placed$/);
  const e = await createCoreShell({}); e.undo(); assert.equal(e.getState().message, 'nothing to undo'); e.redo(); assert.equal(e.getState().message, 'nothing to redo');
});

test('row 4: the checker keeps its result when only the start moved, and re-checks when the road changed', async () => {
  const s = await built(), m = createTrackModel(); let track = m.update(s.getState().resolved);
  s.subscribe((st) => { track = m.update(st.resolved); });
  const hows = [], ctl = createValidationController(s, { onUpdate: (o) => hows.push(o.how), sharedPath: () => ({ path: track.path, segments: track.segments, closed: !!track.path.closed, how: track.how }) });
  const before = hows.length;
  s.commitDoc({ ...s.getState().history.present, name: 'renamed' });
  assert.equal(hows.slice(before).pop(), 'same', 'nothing in the road changed: the result stands');
  s.extend({ length: 100 });
  assert.notEqual(hows.slice(before).pop(), 'same', 'a new piece is checked');
  ctl.dispose();
});

test('row 5: removing pieces from the end without an undo copy builds no full mesh, and equals a fresh full build', async () => {
  const storage = memStorage(), s = await built(storage);
  await s.save('T'); const t = await createCoreShell({ storage, autosaveMs: 0 }); await t.open('T');
  let n = 0; const geom = { ...G, buildMesh: (...a) => { n++; return G.buildMesh(...a); } }, m = createTrackModel({ geom });
  m.update(t.getState().resolved); const after = n;
  t.undo(); const r = m.update(t.getState().resolved);
  assert.equal(n, after, 'no full mesh was built for the removal');
  const fresh = createTrackModel().update(t.getState().resolved);
  assert.equal(r.batches.length, fresh.batches.length);
  for (let i = 0; i < r.batches.length; i++) {
    const a = r.batches[i].positions, b = fresh.batches[i].positions; assert.equal(a.length, b.length, `batch ${i} vertex count`);
    let worst = 0; for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
    assert.ok(worst < 1e-3, `batch ${i}: within a millimetre of a fresh build (${worst} m)`);
  }
  assert.ok(isDeepStrictEqual(r.path.samples.map((x) => x.pos), fresh.path.samples.map((x) => x.pos)), 'the path is the fresh one');
});
