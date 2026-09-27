// doc-head.test.js: node --test test/*.test.js
// The build head (the keeper, 12:20: "youre not the one who builds the track, the user does"; docs/INTERFACES.md §4):
// the user grows an OPEN track from its end. Append, remove and replace at the head are the core edits, each one
// undo step, and resolveFrom re-resolves only from the first changed word. Dependency-free.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');

const DEG = Math.PI / 180;
function grown() {
  let d = D.createDoc('head');
  for (const [w, o] of [['straight'], ['turn'], ['tight', { dir: 'R' }], ['straight', { handles: { climb: 3 * DEG } }], ['jump'], ['straight'],
    ['wall-ride']]) d = D.appendWord(d, w, o || {});
  return D.appendPhrase(d, 'S', [{ word: 'turn' }, { word: 'turn', opts: { dir: 'R' } }]);
}
/** A result without its bookkeeping, for comparing an incremental resolve with a full one. */
const plain = (r) => ({ segments: r.segments, head: r.head, closed: r.closed });

test('appending one word and then undoing gives back the byte-identical document', () => {
  let h = D.createHistory(grown());
  const before = D.serialize(h.present);
  h = D.commit(h, D.appendWord(h.present, 'sweep'));
  assert.notEqual(D.serialize(h.present), before);
  h = D.undo(h);
  assert.equal(D.serialize(h.present), before);
});

test('remove and replace at the head are one undo step each, and undo is byte-identical', () => {
  for (const edit of [(d) => D.removeHead(d), (d) => D.replaceHead(d, 'tight')]) {
    let h = D.createHistory(grown());
    const before = D.serialize(h.present);
    h = D.commit(h, edit(h.present));
    assert.equal(h.past.length, 1);
    h = D.undo(h);
    assert.equal(D.serialize(h.present), before);
  }
});

test('the replaced head gets a new id; every earlier word keeps its id and its object', () => {
  const d = grown(), r = D.replaceHead(d, 'tight');
  assert.deepEqual(r.words.slice(0, -1).map((w) => w.id), d.words.slice(0, -1).map((w) => w.id));
  r.words.slice(0, -1).forEach((w, i) => assert.equal(w, d.words[i]));
  assert.equal(r.words[r.words.length - 1].id, `w${d.nextId}`);
  assert.equal(r.words[r.words.length - 1].word, 'tight');
});

test('the document records whether the track is open, and the head word', () => {
  const d = grown();
  assert.deepEqual(D.head(d), { id: d.words[d.words.length - 1].id, closed: false });
  assert.deepEqual(D.head(D.createDoc()), { id: null, closed: false });
});

test('an append re-resolves only the new word: the earlier segments are the previous result\'s own objects', () => {
  const d = grown(), r0 = D.resolve(d), d1 = D.appendWord(d, 'sweep'), r1 = D.resolveFrom(r0, d1);
  assert.equal(r1.resolvedFrom, d.words.length);
  r0.segments.forEach((g, i) => assert.equal(r1.segments[i], g, `segment ${i} was rebuilt`));
  assert.deepEqual(plain(r1), plain(D.resolve(d1)));
});

test('incremental resolve equals a full resolve after every kind of edit', () => {
  const d = grown(), r0 = D.resolve(d);
  const edits = {
    append: D.appendWord(d, 'straight'),
    removeHead: D.removeHead(d),
    replaceHead: D.replaceHead(d, 'inversion'),
    'sculpt a middle word': D.editWord(d, 'w3', { handles: { turn: -70 * DEG } }),
    'sculpt a phrase word': D.editPhraseWord(d, 'w8', 2, { handles: { easeOut: 0 } }),
  };
  for (const [name, e] of Object.entries(edits)) assert.deepEqual(plain(D.resolveFrom(r0, e)), plain(D.resolve(e)), name);
});

test('incremental resolve restarts from the state BEFORE the changed word: after a climb, and after a handed-on curve', () => {
  // The jump (w5) follows a 3° climb, so it opens at pitch 3°, not at its own landing pitch; and a sweep with easeOut 0
  // hands its curvature to the word after it. Edits there are where a wrong restart state shows.
  let d = grown(); const r0 = D.resolve(d);
  const jump = D.editWord(d, 'w5', { handles: { gap: 20 } });
  assert.deepEqual(plain(D.resolveFrom(r0, jump)), plain(D.resolve(jump)), 'the jump after a climb');
  d = D.appendWord(D.appendWord(D.createDoc(), 'sweep', { handles: { easeOut: 0 } }), 'turn');
  const r1 = D.resolve(d), e = D.editWord(d, 'w2', { handles: { turn: 80 * DEG } });
  assert.deepEqual(plain(D.resolveFrom(r1, e)), plain(D.resolve(e)), 'the turn after a handed-on sweep');
  assert.deepEqual(plain(D.resolveFrom(r1, D.removeHead(d))), plain(D.resolve(D.removeHead(d))), 'removing the word a curve was handed to');
});

test('sculpting a middle word re-resolves from that word, not from the start', () => {
  const d = grown(), r0 = D.resolve(d), r1 = D.resolveFrom(r0, D.editWord(d, 'w3', { handles: { turn: -70 * DEG } }));
  assert.equal(r1.resolvedFrom, 2);
  const keep = r0.marks[2].segStart;
  for (let i = 0; i < keep; i++) assert.equal(r1.segments[i], r0.segments[i]);
});

test('an unchanged document resolves to the previous result itself', () => {
  const d = grown(), r0 = D.resolve(d);
  assert.equal(D.resolveFrom(r0, d), r0);
});

test('growing a track word by word through resolveFrom matches resolving it whole', () => {
  let d = D.createDoc(), r = D.resolve(d);
  for (const w of ['straight', 'sweep', 'turn', 'tight', 'jump', 'straight', 'wall-ride', 'inversion']) { d = D.appendWord(d, w); r = D.resolveFrom(r, d); }
  assert.deepEqual(plain(r), plain(D.resolve(d)));
});
