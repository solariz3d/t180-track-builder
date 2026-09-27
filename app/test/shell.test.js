// shell.test.js: node --test app/test/*.test.js
// The app shell's logic, headless: no DOM, no WebView, no Tauri. Storage is an in-memory Map standing in for the Tauri
// commands. Dependency-free.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShell } = require('../shell.js');
const D = require('../../src/doc/index.js');

function memoryStorage() {
  const docs = new Map(); let library = null;
  return {
    docs, get library() { return library; },
    saveDoc: async (name, text) => { docs.set(name, text); },
    openDoc: async (name) => { if (!docs.has(name)) throw new Error(`no track ${name}`); return docs.get(name); },
    listDocs: async () => [...docs.keys()].sort(),
    saveLibrary: async (text) => { library = text; },
    openLibrary: async () => library,
  };
}
const text = (s) => D.serialize(s.getState().history.present);

test('place appends the palette word at the head, and undo restores the byte-identical document', async () => {
  const s = await createShell({ storage: memoryStorage() });
  const before = text(s);
  s.place('turn');
  const words = s.getState().history.present.words;
  assert.deepEqual(words.map((w) => w.word), ['turn']);
  s.undo();
  assert.equal(text(s), before);
  s.redo();
  assert.equal(s.getState().history.present.words.length, 1);
});

test('each placement is one undo step, and the head grows in order', async () => {
  const s = await createShell({ storage: memoryStorage() });
  for (const w of ['straight', 'sweep', 'tight', 'jump', 'straight']) s.place(w);
  assert.deepEqual(s.getState().history.present.words.map((w) => w.word), ['straight', 'sweep', 'tight', 'jump', 'straight']);
  assert.equal(s.getState().history.past.length, 5);
});

test('the pickers shape a built-in word: tempo, font and direction', async () => {
  const s = await createShell({ storage: memoryStorage() });
  s.setPicker('tempo', 'aurora'); s.setPicker('font', 'half-pipe'); s.setPicker('dir', 'R');
  s.place('sweep');
  const w = s.getState().history.present.words[0];
  assert.deepEqual([w.tempo, w.font, Math.sign(w.handles.turn)], ['aurora', 'half-pipe', -1]);
  assert.equal(JSON.stringify(w), JSON.stringify(D.appendWord(D.createDoc(), 'sweep', { tempo: 'aurora', font: 'half-pipe', dir: 'R' }).words[0]));
});

test('a picker value that does not exist is refused with a message, and changes nothing', async () => {
  const s = await createShell({ storage: memoryStorage() });
  s.setPicker('tempo', 'presto');
  assert.equal(s.getState().pickers.tempo, 'standard');
  assert.match(s.getState().message, /presto/);
});

test('a failed placement says why and leaves the document and history as they were', async () => {
  const s = await createShell({ storage: memoryStorage() });
  s.place('straight');
  const before = text(s), past = s.getState().history.past.length;
  s.place('no-such-piece');
  assert.equal(text(s), before);
  assert.equal(s.getState().history.past.length, past);
  assert.match(s.getState().message, /NO_SUCH_PIECE/);
});

test('undo with nothing to undo says so and changes nothing', async () => {
  const s = await createShell({ storage: memoryStorage() });
  s.undo();
  assert.match(s.getState().message, /NOTHING_TO_UNDO/);
});

test('the app\'s document round-trips through save and open, byte for byte', async () => {
  const store = memoryStorage(), s = await createShell({ storage: store });
  for (const w of ['straight', 'turn', 'jump', 'straight', 'wall-ride']) s.place(w);
  const before = text(s);
  await s.save('my track');
  assert.equal(store.docs.get('my track'), before);
  s.newDoc();
  assert.equal(s.getState().history.present.words.length, 0);
  await s.open('my track');
  assert.equal(text(s), before);
  assert.deepEqual(await s.list(), ['my track']);
  assert.equal(s.getState().dirty, false);
});

test('opening a track starts a fresh history: undo does not reach back into the track that was open before', async () => {
  const store = memoryStorage(), s = await createShell({ storage: store });
  s.place('turn'); await s.save('one');
  s.newDoc(); s.place('straight'); s.place('tight');
  await s.open('one');
  s.undo();
  assert.match(s.getState().message, /NOTHING_TO_UNDO/);
  assert.equal(s.getState().history.present.words.length, 1);
});

test('a track name that could escape the tracks folder is refused before anything is written', async () => {
  const store = memoryStorage(), s = await createShell({ storage: store });
  for (const bad of ['../evil', 'a/b', '', ' lead', 'x'.repeat(65), 'a\\b']) {
    await s.save(bad);
    assert.match(s.getState().message, /track name/, bad);
  }
  assert.equal(store.docs.size, 0);
});

test('opening a file that is not a canonical document says why and keeps the open track', async () => {
  const store = memoryStorage(), s = await createShell({ storage: store });
  s.place('turn'); const before = text(s);
  store.docs.set('broken', '{"schema": 9}');
  await s.open('broken');
  assert.equal(text(s), before);
  assert.match(s.getState().message, /SCHEMA_TOO_NEW/);
});

test('saving a selection as a piece puts it in the palette and the library file, and it places back', async () => {
  const store = memoryStorage(), s = await createShell({ storage: store });
  for (const w of ['straight', 'turn', 'tight']) s.place(w);
  s.select('w2', 'w3');
  await s.saveSelectionAsPiece('my-bend', 'me');
  assert.ok(s.palette().some((p) => p.name === 'my-bend' && !p.builtin && p.kind === 'phrase'));
  assert.match(store.library, /"name":"my-bend"/);
  s.place('my-bend');
  assert.equal(s.getState().history.present.words.slice(-1)[0].phrase, 'my-bend');
});

test('the saved library comes back when the app starts again', async () => {
  const store = memoryStorage(), s = await createShell({ storage: store });
  s.place('turn'); s.select('w1'); await s.saveSelectionAsPiece('kept');
  const again = await createShell({ storage: store });
  assert.ok(again.palette().some((p) => p.name === 'kept'));
});

test('saving a piece needs a selection, and a built-in name is refused', async () => {
  const s = await createShell({ storage: memoryStorage() });
  s.place('turn');
  await s.saveSelectionAsPiece('x');
  assert.match(s.getState().message, /select/);
  s.select('w1');
  await s.saveSelectionAsPiece('Turn');
  assert.match(s.getState().message, /NAME_IS_BUILTIN/);
});

test('a selection is always a consecutive run in track order, whichever end is clicked first', async () => {
  const s = await createShell({ storage: memoryStorage() });
  for (const w of ['straight', 'turn', 'tight', 'straight']) s.place(w);
  s.select('w4', 'w2');
  assert.deepEqual(s.getState().selection, ['w2', 'w3', 'w4']);
});

test('the resolved track follows every edit, re-resolving only from the change', async () => {
  const s = await createShell({ storage: memoryStorage() });
  s.place('straight'); s.place('turn');
  const r1 = s.getState().resolved;
  s.place('tight');
  const r2 = s.getState().resolved;
  assert.equal(r2.resolvedFrom, 2);
  assert.equal(r2.segments[0], r1.segments[0]);
  assert.deepEqual(r2.segments.map((g) => g.id), D.resolve(s.getState().history.present).segments.map((g) => g.id));
});

test('sculpting is one undo step; a drag is one undo step however many moves it has', async () => {
  const s = await createShell({ storage: memoryStorage() });
  s.place('turn');
  s.sculpt('w1', { handles: { width: 24 } });
  assert.equal(s.getState().history.past.length, 2);
  s.beginDrag();
  for (const w of [25, 26, 27]) s.dragTo('w1', { handles: { width: w } });
  s.endDrag();
  assert.equal(s.getState().history.past.length, 3);
  assert.equal(s.getState().history.present.words[0].handles.width, 27);
});

test('subscribers hear every change', async () => {
  const s = await createShell({ storage: memoryStorage() });
  let n = 0; s.subscribe(() => n++);
  s.place('turn'); s.undo(); s.setPicker('dir', 'R');
  assert.equal(n, 3);
});
