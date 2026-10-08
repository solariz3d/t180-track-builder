// core-undo-persist.test.js: node --test app/test/core-undo-persist.test.js
// D272 (the keeper, 11:55: "when you save a track, but then close program, reopen and go back to it, you cannot undo pieces of the track ... not cool"): the undo history survives Save, closing the
// program and reopening. Save writes a SIDECAR, eq-<name>.t180undo, beside the track (past and future, D.serialize'd, the last 200 steps; the track file itself unchanged); Open restores it only when its
// present equals the opened file byte for byte, else drops it (silently on a mismatch, with one status line when it is corrupt); the autosave carries its history the same way. Fake storage here (the
// native side is src-tauri/src/lib.rs, tested there); no real window.
//   1  save, then a FRESH shell opens the track: undo walks the same steps back, redo returns
//   2  a mismatched sidecar (the file was replaced) is dropped silently; a corrupt one (every shape) opens the track with no history and says so once; a missing one or a storage without the calls is no news
//   3  the cap: the last 200 steps of the past, the 200 nearest of the future
//   4  the track file's bytes are identical with and without the feature, and written BEFORE the sidecar; a sidecar write that fails never fails the save
//   5  the autosave keeps its history: Restore after a crash can undo; a damaged history in it restores the track without one and says so
//   6  a second Save replaces the sidecar; Save As leaves the old name's alone; the size at the cap on a real track's copy is measured in the hand-back, not asserted here
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');

/** In-memory storage with the sidecar calls (`undo: false` leaves them out, as an older host would) and the autosave. */
function store({ undo = true } = {}) {
  const s = { docs: new Map(), undos: new Map(), order: [], auto: null, failUndo: null };
  Object.assign(s, {
    saveDoc: async (n, t) => { s.order.push(`doc:${n}`); s.docs.set(n, t); }, openDoc: async (n) => { if (!s.docs.has(n)) throw new Error(`no track ${n}`); return s.docs.get(n); }, listDocs: async () => [...s.docs.keys()],
    saveAutosave: async (t) => { s.auto = t; }, openAutosave: async () => s.auto, clearAutosave: async () => { s.auto = null; },
  });
  if (undo) {
    s.saveUndo = async (n, t) => { s.order.push(`undo:${n}`); if (s.failUndo) throw new Error(s.failUndo); s.undos.set(n, t); };
    s.openUndo = async (n) => (s.undos.has(n) ? s.undos.get(n) : null);
  }
  return s;
}
const text = (sh) => D.serialize(sh.getState().history.present);
const steps = (sh) => ({ past: sh.getState().history.past.length, future: sh.getState().history.future.length });
/** A track with `n` committed steps: n pieces of different lengths, so every step is a different document. */
async function built(st, n, opts = {}) {
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0, ...opts });
  for (let i = 0; i < n; i++) s.extend({ length: 20 + i });
  assert.equal(s.getState().message, null);
  return s;
}

/** A shell with `n` committed steps that are cheap to resolve (empty documents, each its own): for the cap rows, which need hundreds of steps. */
async function cheap(st, n) {
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  for (let i = 0; i < n; i++) s.commitDoc(D.createDoc(`step ${i}`));
  assert.equal(s.getState().history.past.length, n);
  return s;
}

test('row 1: save, then a fresh shell opens the track: undo walks the same steps back, and redo returns', async () => {
  const st = store(), a = await built(st, 4), texts = [text(a)];
  for (let i = 0; i < 4; i++) { a.undo(); texts.push(text(a)); }   // the document at each step, newest first
  for (let i = 0; i < 4; i++) a.redo();
  assert.equal(text(a), texts[0]); await a.save('lap');
  assert.ok(st.undos.has('eq-lap'), 'the sidecar is written beside the track, under the track\'s stored name');
  const b = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); await b.open('lap');
  assert.equal(b.getState().message, null, 'a good sidecar says nothing'); assert.equal(b.getState().dirty, false); assert.deepEqual(steps(b), { past: 4, future: 0 });
  assert.equal(text(b), texts[0], 'present is the saved file');
  for (let i = 1; i <= 4; i++) { b.undo(); assert.equal(text(b), texts[i], `undo ${i} gives the document the first session had at that step`); }
  assert.deepEqual(steps(b), { past: 0, future: 4 });
  for (let i = 3; i >= 0; i--) { b.redo(); assert.equal(text(b), texts[i], `redo returns step ${i}`); }
  // the future the first session had when it saved comes back too
  const st3 = store(), e = await built(st3, 3); e.undo(); e.undo(); await e.save('mid');
  const f = await createCoreShell({ brushFn: null, storage: st3, autosaveMs: 0 }); await f.open('mid'); assert.deepEqual(steps(f), { past: 1, future: 2 }, 'past and future both come back'); f.redo(); f.redo(); assert.equal(text(f), D.serialize(e.getState().history.future[1]));
});

test('row 2: a mismatched sidecar is dropped silently; a corrupt one opens the track with no history and says so once; a missing one, or a host without the calls, is no news', async () => {
  const st = store(), a = await built(st, 3); await a.save('lap'); const good = st.undos.get('eq-lap');
  const openWith = async (sidecar, host = st) => { if (sidecar === null) host.undos.delete('eq-lap'); else host.undos.set('eq-lap', sidecar); const b = await createCoreShell({ brushFn: null, storage: host, autosaveMs: 0 }); await b.open('lap'); return b; };
  // the file was replaced after the sidecar was written (another build, a paste, a hand edit): its history is not this file's
  const other = await built(store(), 2); st.docs.set('eq-lap', text(other));
  let b = await openWith(good); assert.equal(text(b), text(other), 'the file wins'); assert.deepEqual(steps(b), { past: 0, future: 0 }, 'never mixed'); assert.equal(b.getState().message, null, 'silent: this is not damage'); st.docs.set('eq-lap', text(a));
  // one byte of difference is a mismatch
  st.docs.set('eq-lap', text(a) + ' '); b = await openWith(good); assert.deepEqual(steps(b), { past: 0, future: 0 }); st.docs.set('eq-lap', text(a));
  // corrupt, every shape: the track still opens, with no history, and the status line says so
  const parsed = JSON.parse(good);
  const bad = { 'not JSON': '{{{', 'not an object': '[1,2]', 'wrong kind': JSON.stringify({ ...parsed, kind: 'other' }), 'wrong schema': JSON.stringify({ ...parsed, schema: 99 }), 'past is not a list': JSON.stringify({ ...parsed, past: 'x' }),
    'a past step that is not a document': JSON.stringify({ ...parsed, past: [parsed.past[0], 'not a document'] }), 'a future step that is not text': JSON.stringify({ ...parsed, future: [7] }), 'empty': '' };
  for (const [why, sidecar] of Object.entries(bad)) {
    b = await openWith(sidecar); assert.equal(text(b), text(a), `${why}: the track opens`); assert.deepEqual(steps(b), { past: 0, future: 0 }, `${why}: no history, none half-kept`);
    assert.match(b.getState().message, /undo history/, `${why}: said once`); assert.equal(b.getState().messageKind, 'error');
  }
  // one-time: the next thing the user does clears it
  b.extend({ length: 30 }); assert.equal(b.getState().message, null);
  // missing: no news; and a host without the calls opens exactly as before
  b = await openWith(null); assert.equal(b.getState().message, null); assert.deepEqual(steps(b), { past: 0, future: 0 });
  const old = store({ undo: false }); old.docs.set('eq-lap', text(a)); const c = await createCoreShell({ brushFn: null, storage: old, autosaveMs: 0 }); await c.open('lap'); assert.equal(c.getState().message, null); assert.equal(text(c), text(a));
  // a sidecar that cannot be READ never blocks the open either
  const thrower = store(); thrower.docs.set('eq-lap', text(a)); thrower.openUndo = async () => { throw new Error('disk gone'); };
  const d = await createCoreShell({ brushFn: null, storage: thrower, autosaveMs: 0 }); await d.open('lap'); assert.equal(text(d), text(a)); assert.match(d.getState().message, /undo history.*disk gone/);
});

test('row 3: the cap holds: the last 200 steps of the past, and the 200 nearest of the future', async () => {
  const st = store(), a = await cheap(st, 230), first = a.getState().history.past[30], head = text(a);
  await a.save('long'); const side = JSON.parse(st.undos.get('eq-long')); assert.equal(side.past.length, 200, 'past is capped'); assert.equal(side.future.length, 0);
  const b = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); await b.open('long'); assert.deepEqual(steps(b), { past: 200, future: 0 }); assert.equal(text(b), head);
  for (let i = 0; i < 200; i++) b.undo(); assert.equal(text(b), D.serialize(first), 'the oldest kept step is the 31st of 230: the newest 200 are what is kept'); b.undo(); assert.equal(steps(b).past, 0, 'and nothing older');
  // the future: undo 210 of 230 (past 20, future 210): 200 nearest the present are kept, the 10 farthest go
  const st2 = store(), c = await cheap(st2, 230); for (let i = 0; i < 210; i++) c.undo(); assert.deepEqual(steps(c), { past: 20, future: 210 });
  const nearest = c.getState().history.future.slice(0, 200); await c.save('far');
  const d = await createCoreShell({ brushFn: null, storage: st2, autosaveMs: 0 }); await d.open('far'); assert.deepEqual(steps(d), { past: 20, future: 200 }); for (let i = 0; i < 200; i++) d.redo(); assert.equal(text(d), D.serialize(nearest[199]));
  // a session that opens a capped history and saves again keeps capping at 200
  const e2 = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); await e2.open('long'); e2.commitDoc(D.createDoc('one more')); assert.equal(steps(e2).past, 201); await e2.save('long'); assert.equal(JSON.parse(st.undos.get('eq-long')).past.length, 200, 'saving again keeps it at 200');
});

test('row 4: the track file is byte-identical with and without the feature, and is written before its sidecar; a sidecar that cannot be written never fails the save', async () => {
  const withIt = store(), without = store({ undo: false }), a = await built(withIt, 5), b = await built(without, 5);
  await a.save('t'); await b.save('t');
  assert.equal(withIt.docs.get('eq-t'), without.docs.get('eq-t'), 'the same bytes with and without the sidecar'); assert.equal(withIt.docs.get('eq-t'), D.serialize(a.getState().history.present), 'and they are the document\'s canonical text, as before');
  assert.deepEqual(withIt.order, ['doc:eq-t', 'undo:eq-t'], 'the track first, then its history');
  // a failing sidecar: the track is saved, the shell is clean, and the one line says what was not kept
  const bad = store(); bad.failUndo = 'disk full'; const c = await built(bad, 3); await c.save('t');
  assert.equal(bad.docs.get('eq-t'), D.serialize(c.getState().history.present), 'the track was saved'); assert.equal(c.getState().dirty, false); assert.equal(c.getState().name, 't');
  assert.match(c.getState().message, /saved.*undo history.*disk full/i);
  // a failing TRACK write still fails the save and writes no sidecar for it
  const bad2 = store(); bad2.saveDoc = async () => { throw new Error('read-only'); }; const d = await built(bad2, 2); await assert.rejects(d.save('t'), /read-only/); assert.equal(bad2.undos.size, 0);
});

test('row 5: the autosave keeps its history: Restore after a crash can undo; a damaged history in it restores the track without one and says so', async () => {
  const st = store(), a = await built(st, 4); await a.flushAutosave(); const lost = text(a), texts = [lost];
  for (let i = 0; i < 4; i++) { a.undo(); texts.push(text(a)); }
  // (the crash: the last autosave is the one written after the 4 edits; undoing after it wrote nothing more)
  const b = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); assert.ok(b.getState().recovery); assert.equal(b.getState().history.past.length, 0, 'offered, not applied');
  b.restore(); assert.equal(text(b), lost); assert.equal(b.getState().dirty, true); assert.deepEqual(steps(b), { past: 4, future: 0 }, 'the history came with it'); b.undo(); assert.equal(text(b), texts[1]); b.redo(); assert.equal(text(b), lost);
  // the name and the old record shape still work: an autosave with no history is today's fresh-history restore
  const o = JSON.parse(st.auto); delete o.undo; st.auto = JSON.stringify(o); const c = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); c.restore(); assert.equal(text(c), lost); assert.deepEqual(steps(c), { past: 0, future: 0 }); assert.equal(c.getState().message, null, 'an older autosave is not damage');
  // damaged history inside the autosave
  for (const undo of ['{{{', JSON.stringify({ schema: 1, kind: 'core-undo', present: 'other', past: [], future: [] }), JSON.stringify({ schema: 1, kind: 'core-undo', present: lost, past: ['nope'], future: [] })]) {
    st.auto = JSON.stringify({ ...o, undo }); const d = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); assert.ok(d.getState().recovery, 'the track is still offered'); d.restore();
    assert.equal(text(d), lost); assert.deepEqual(steps(d), { past: 0, future: 0 }); assert.match(d.getState().message, /undo history/);
  }
  // the cap holds in the autosave too
  const st2 = store(), e = await cheap(st2, 230); await e.flushAutosave(); assert.equal(JSON.parse(JSON.parse(st2.auto).undo).past.length, 200);
});

test('row 6: a second Save replaces the sidecar; Save As leaves the first name\'s alone; the undo of an edit made after the open is on top of the restored history', async () => {
  const st = store(), a = await built(st, 3); await a.save('one'); const first = st.undos.get('eq-one');
  a.extend({ length: 77 }); await a.save('one'); assert.notEqual(st.undos.get('eq-one'), first, 'replaced'); assert.equal(JSON.parse(st.undos.get('eq-one')).past.length, 4);
  await a.save('two'); assert.ok(st.undos.has('eq-one') && st.undos.has('eq-two'), 'Save As writes beside the new name and leaves the old name\'s sidecar and track as they were');
  const b = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); await b.open('one'); b.extend({ length: 90 }); assert.deepEqual(steps(b), { past: 5, future: 0 }); b.undo(); b.undo(); assert.equal(text(b), D.serialize(a.getState().history.past[3]), 'two undos: past the new edit, then the last step of the first session');
  // opening another track, a version or a new document does not carry this history along
  await b.open('two'); assert.equal(steps(b).past, 4); b.newDoc(); assert.deepEqual(steps(b), { past: 0, future: 0 });
});
