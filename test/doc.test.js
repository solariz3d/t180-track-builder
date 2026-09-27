// doc.test.js: node --test test/*.test.js
// The document model (src/doc/*, ARCHITECTURE §2): canonical serialisation, stable ids, undo as history, resolve.
// Dependency-free.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const { flight } = require('../src/doc/resolve.js');

const DEG = Math.PI / 180;
/** A document that uses every word, both turn directions, a phrase and a jump. */
function sample() {
  let d = D.createDoc('sample');
  d = D.appendWord(d, 'straight');
  d = D.appendWord(d, 'sweep', { tempo: 'aurora', handles: { easeOut: 0 } });
  d = D.appendWord(d, 'turn');
  d = D.appendWord(d, 'tight', { dir: 'R', speed: 50 });
  d = D.appendWord(d, 'straight', { handles: { climb: 4 * DEG } });
  d = D.appendWord(d, 'jump');
  d = D.appendWord(d, 'straight', { handles: { length: 60 } });
  d = D.appendWord(d, 'wall-ride');
  d = D.appendPhrase(d, 'S', [{ word: 'turn', opts: { tempo: 'serpents' } }, { word: 'turn', opts: { dir: 'R', tempo: 'serpents' } }]);
  d = D.appendWord(d, 'inversion');
  return d;
}
const segsOf = (d, id) => D.resolve(d).segments.filter((g) => g.id === id);
const yaw = (gs) => gs.reduce((a, g) => a + ((g.k0 + g.k1) / 2) * g.length, 0);
const pitch = (gs) => gs.reduce((a, g) => a + ((g.kp0 + g.kp1) / 2) * g.length, 0);

// ── serialisation ──────────────────────────────────────────────────────────────────────────────────────────────────
test('the canonical text of a one-word document, byte for byte', () => {
  const t = D.serialize(D.appendWord(D.createDoc('t'), 'straight'));
  assert.equal(t, '{\n  "schema": 2,\n  "generator": "t180-track-builder/doc 0.1.0",\n  "name": "t",\n  "closed": false,\n  "nextId": 2,\n' +
    '  "words": [\n    {"id":"w1","word":"straight","font":"flat","tempo":"standard","speedKmh":null,"handles":{"length":100,"turn":0,"climb":0,"easeIn":0.3,"easeOut":0.3,"roll0":0,"roll1":0,"heartline":0,"psiL":0,"psiR":0,"width":20,"wall":0,"ramp":20},"textures":{}}\n  ],\n' +
    '  "constraints": {"pins":[],"free":[]}\n}\n');
});

test('load then save is byte-exact, for every word, a phrase and a jump', () => {
  const t = D.serialize(sample());
  assert.equal(D.serialize(D.parse(t)), t);
});

test('the loaded document resolves to the very same segments as the one it was saved from', () => {
  const d = sample();
  assert.deepEqual(D.resolve(D.parse(D.serialize(d))), D.resolve(d));
});

test('the same document always serialises to the same bytes, whatever order its text had its keys in', () => {
  const t = D.serialize(sample()), o = JSON.parse(t);
  const shuffled = JSON.stringify({ constraints: o.constraints, words: o.words.map((w) => Object.fromEntries(Object.entries(w).reverse())), nextId: o.nextId, closed: o.closed, name: o.name, generator: o.generator, schema: o.schema });
  assert.equal(D.serialize(D.parse(shuffled)), t);
});

test('numbers are quantised: 0.1 mm on lengths, 0.00001° on angles; a finer value is snapped when it enters', () => {
  const d = D.appendWord(D.createDoc(), 'straight', { handles: { length: 100.00004, turn: 0.000004 * DEG } });
  assert.equal(d.words[0].handles.length, 100);
  assert.equal(d.words[0].handles.turn, 0);
  assert.match(D.serialize(D.appendWord(D.createDoc(), 'straight', { handles: { length: 123.45678 } })), /"length":123\.4568/);
});

test('a hand-edited file with a value finer than its quantum loads snapped, and its next save is canonical', () => {
  const t = D.serialize(D.appendWord(D.createDoc(), 'straight')).replace('"length":100,', '"length":100.000049,');
  const d = D.parse(t);
  assert.equal(d.words[0].handles.length, 100);
  assert.match(D.serialize(d), /"length":100,/);
});

test('the empty document serialises, loads back byte-exact, and resolves to no segments', () => {
  const t = D.serialize(D.createDoc());
  assert.equal(D.serialize(D.parse(t)), t);
  assert.deepEqual(D.resolve(D.parse(t)).segments, []);
  assert.equal(D.resolve(D.createDoc()).head.id, null);
});

// ── schema versions ────────────────────────────────────────────────────────────────────────────────────────────────
test('a newer schema is refused as written by a newer builder; one with no migration to it is refused as unknown', () => {
  const o = JSON.parse(D.serialize(sample()));
  assert.throws(() => D.parse(JSON.stringify({ ...o, schema: 3 })), (e) => e.code === 'SCHEMA_TOO_NEW');
  assert.throws(() => D.parse(JSON.stringify({ ...o, schema: 0 })), (e) => e.code === 'SCHEMA_UNKNOWN');
  assert.throws(() => D.parse(JSON.stringify({ ...o, schema: '1' })), (e) => e.code === 'SCHEMA_UNKNOWN');
});

test('a key the schema does not have is refused, not ignored', () => {
  const o = JSON.parse(D.serialize(sample()));
  assert.throws(() => D.parse(JSON.stringify({ ...o, colour: 'red' })), (e) => e.code === 'UNKNOWN_KEY');
  o.words[0].bank = 3;
  assert.throws(() => D.parse(JSON.stringify(o)), (e) => e.code === 'UNKNOWN_KEY');
});

test('an unknown word is refused, when appended and when loaded; so are an unknown font and tempo', () => {
  assert.throws(() => D.appendWord(D.createDoc(), 'loop-de-loop'), (e) => e.code === 'UNKNOWN_WORD');
  const o = JSON.parse(D.serialize(sample())); o.words[0].word = 'loop-de-loop';
  assert.throws(() => D.parse(JSON.stringify(o)), (e) => e.code === 'UNKNOWN_WORD');
  assert.throws(() => D.appendWord(D.createDoc(), 'turn', { font: 'moebius' }), (e) => e.code === 'UNKNOWN_FONT');
  assert.throws(() => D.appendWord(D.createDoc(), 'turn', { tempo: 'presto' }), (e) => e.code === 'UNKNOWN_TEMPO');
});

test('a word carries exactly its own handles: a straight with a gap is refused', () => {
  const o = JSON.parse(D.serialize(sample())); o.words[0].handles.gap = 5;
  assert.throws(() => D.parse(JSON.stringify(o)), (e) => e.code === 'BAD_HANDLES');
  assert.throws(() => D.appendWord(D.createDoc(), 'turn', { handles: { easeIn: 0.7, easeOut: 0.6 } }), (e) => e.code === 'HANDLE_RANGE');
});

// ── stable ids ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('ids are w1, w2, … and a removed head\'s id is never handed out again', () => {
  let d = D.appendWord(D.appendWord(D.appendWord(D.createDoc(), 'straight'), 'turn'), 'tight');
  d = D.appendWord(D.removeHead(d), 'sweep');
  assert.deepEqual(d.words.map((w) => w.id), ['w1', 'w2', 'w4']);
});

test('sculpting one word changes no id and no other word', () => {
  const d = sample(), e = D.editWord(d, 'w3', { handles: { turn: 75 * DEG } });
  assert.deepEqual(e.words.map((w) => w.id), d.words.map((w) => w.id));
  e.words.forEach((w, i) => { if (w.id !== 'w3') assert.equal(w, d.words[i], `${w.id} was rebuilt`); });
  assert.notEqual(e.words[2].handles.turn, d.words[2].handles.turn);
});

test('appending at the head leaves every earlier segment as it was, same ids and same numbers (INTERFACES §4)', () => {
  const d = sample(), before = D.resolve(d).segments, after = D.resolve(D.appendWord(d, 'straight')).segments;
  assert.deepEqual(after.slice(0, before.length), before);
  assert.ok(after.length > before.length);
});

test('a phrase\'s words resolve with ids <phraseId>/<n>', () => {
  const ids = [...new Set(D.resolve(sample()).segments.map((g) => g.id))];
  assert.ok(ids.includes('w9/1') && ids.includes('w9/2'), ids.join(' '));
});

// ── undo as history ────────────────────────────────────────────────────────────────────────────────────────────────
test('undo and redo return to byte-identical states', () => {
  let h = D.createHistory(D.createDoc('u'));
  const texts = [D.serialize(h.present)];
  for (const w of ['straight', 'turn', 'jump', 'straight']) { h = D.commit(h, D.appendWord(h.present, w)); texts.push(D.serialize(h.present)); }
  for (let i = texts.length - 2; i >= 0; i--) { h = D.undo(h); assert.equal(D.serialize(h.present), texts[i]); }
  for (let i = 1; i < texts.length; i++) { h = D.redo(h); assert.equal(D.serialize(h.present), texts[i]); }
});

test('a whole drag is one undo entry, and undo goes back to before the drag began', () => {
  let h = D.createHistory(D.appendWord(D.createDoc(), 'turn'));
  const start = D.serialize(h.present);
  h = D.beginDrag(h);
  for (const deg of [61, 62, 63, 64, 65]) h = D.dragTo(h, D.editWord(h.present, 'w1', { handles: { turn: deg * DEG } }));
  h = D.endDrag(h);
  assert.equal(h.past.length, 1);
  h = D.undo(h);
  assert.equal(D.serialize(h.present), start);
});

test('a drag that ends where it began adds no entry; a new commit clears the redo side', () => {
  let h = D.createHistory(D.createDoc());
  h = D.endDrag(D.beginDrag(h));
  assert.equal(h.past.length, 0);
  h = D.commit(h, D.appendWord(h.present, 'straight'));
  h = D.undo(h);
  h = D.commit(h, D.appendWord(h.present, 'turn'));
  assert.throws(() => D.redo(h), (e) => e.code === 'NOTHING_TO_REDO');
});

test('documents are immutable: an edit cannot reach into a state the history holds', () => {
  const d = sample();
  assert.throws(() => { d.words[0].handles.length = 1; }, TypeError);
  assert.throws(() => { d.words.push({}); }, TypeError);
});

// ── resolve ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a turn word turns by exactly its turn handle, and climbs by exactly its climb handle', () => {
  const d = sample();
  for (const e of d.words.filter((w) => w.phrase === undefined && w.word !== 'jump')) {
    const gs = segsOf(d, e.id);
    assert.ok(Math.abs(yaw(gs) - e.handles.turn) < 1e-12, `${e.id} ${e.word}: yaw ${yaw(gs)} vs ${e.handles.turn}`);
    assert.ok(Math.abs(pitch(gs) - e.handles.climb) < 1e-12, `${e.id}: pitch`);
  }
});

test('a default turn peaks at its word\'s radius: 300 m for turn, 1,200 m for an aurora sweep', () => {
  const d = D.appendWord(D.appendWord(D.createDoc(), 'turn'), 'sweep', { tempo: 'aurora' });
  // Within 0.02 m, not exactly: length is quantised to 1 mm and turn to 0.001°, which moves a 1,200 m peak by up to ~0.01 m.
  assert.ok(Math.abs(1 / segsOf(d, 'w1').find((g) => g.part === 'body').k0 - 300) < 0.02);
  assert.ok(Math.abs(1 / segsOf(d, 'w2').find((g) => g.part === 'body').k0 - 1200) < 0.02);
});

test('curvature is continuous everywhere on the road: across parts and across words', () => {
  const gs = D.resolve(sample()).segments;
  for (let i = 1; i < gs.length; i++) {
    if (gs[i].kind === 'gap' || gs[i - 1].kind === 'gap') continue;
    assert.ok(Math.abs(gs[i].k0 - gs[i - 1].k1) < 1e-12, `yaw step at ${gs[i].id} ${gs[i].part}`);
    assert.ok(Math.abs(gs[i].kp0 - gs[i - 1].kp1) < 1e-12, `pitch step at ${gs[i].id} ${gs[i].part}`);
  }
});

test('easeOut 0 hands the peak on: the next word opens from it (sweep → turn)', () => {
  const d = sample(), sweep = segsOf(d, 'w2'), turn = segsOf(d, 'w3');
  assert.equal(sweep[sweep.length - 1].part, 'body');
  assert.ok(sweep[sweep.length - 1].k1 > 0 && Math.abs(turn[0].k0 - sweep[sweep.length - 1].k1) < 1e-15);
});

test('roll is continuous, and an inversion rolls through a full turn', () => {
  const gs = D.resolve(sample()).segments;
  for (let i = 1; i < gs.length; i++) assert.ok(Math.abs(gs[i].roll0 - gs[i - 1].roll1) < 1e-12, `roll step at ${gs[i].id}`);
  const inv = segsOf(sample(), 'w10');
  assert.ok(Math.abs(inv[inv.length - 1].roll1 - inv[0].roll0 - 2 * Math.PI) < 1e-12);
});

test('roll follows one smoothstep over the whole word: at the end of the ease-in it is smoothstep(easeIn) of the way', () => {
  const inv = segsOf(sample(), 'w10'), a = 0.3, s = a * a * (3 - 2 * a);   // the inversion's easeIn is the standard 0.3
  assert.equal(inv[0].part, 'in');
  assert.ok(Math.abs(inv[0].roll1 - inv[0].roll0 - 2 * Math.PI * s) < 1e-12, `${inv[0].roll1 - inv[0].roll0} vs ${2 * Math.PI * s}`);
});

test('a roll step between words is refused, not resolved into a torn surface', () => {
  const d = D.editWord(sample(), 'w3', { handles: { roll0: 10 * DEG } });
  assert.throws(() => D.resolve(d), (e) => e.code === 'ROLL_STEP');
});

test('a heartline step between words is refused', () => {
  const d = D.editWord(sample(), 'w3', { handles: { heartline: 1 } });
  assert.throws(() => D.resolve(d), (e) => e.code === 'HEARTLINE_STEP');
});

// Changed at D170 by the ruling that a jump carries its landing ramp (test/doc-jump.test.js): the word is its gap
// and then its ramp. Everything this test checks of the flight is unchanged; only the segment count is.
test('a jump\x27s flight is one gap segment that covers the gap, comes down the drop, and lands at its pitch', () => {
  const d = sample(), j = d.words.find((w) => w.word === 'jump'), g = segsOf(d, j.id);
  assert.deepEqual(g.map((x) => x.part), ['gap', 'land']); assert.equal(g[0].kind, 'gap'); assert.equal(g[0].profile, null);
  const p0 = 4 * DEG;   // the straight before it climbs 4°
  const [X, Y] = flight(p0, g[0].length, g[0].kp0, g[0].kp1);
  assert.ok(Math.abs(X - j.handles.gap) < 1e-9 && Math.abs(Y + j.handles.drop) < 1e-9, `flight ${X}, ${Y}`);
  assert.ok(Math.abs(p0 + ((g[0].kp0 + g[0].kp1) / 2) * g[0].length - j.handles.land) < 1e-12);
  const next = D.resolve(d).segments[D.resolve(d).segments.indexOf(D.resolve(d).segments.find((x) => x.id === j.id)) + 1];
  assert.deepEqual([next.k0, next.kp0], [0, 0]);
});

test('an outside wall goes on the outside of the turn: the right for a left turn, the left for a right turn', () => {
  const d = D.appendWord(D.appendWord(D.createDoc(), 'turn'), 'turn', { dir: 'R' });
  const [l, r] = [segsOf(d, 'w1')[0].profile, segsOf(d, 'w2')[0].profile];
  assert.deepEqual([l.psi[0], l.psi[4]].map((x) => Math.round(x / DEG)), [60, 15]);
  assert.deepEqual([r.psi[0], r.psi[4]].map((x) => Math.round(x / DEG)), [15, 60]);
  assert.deepEqual(l.u, [-16, -8, 0, 8, 16]);
  const wr = D.resolve(D.appendWord(D.createDoc(), 'wall-ride')).segments[0].profile;
  assert.equal(Math.round(wr.psi[0] / DEG), 110);
});

test('a closed document is refused until the closing connector exists', () => {
  const o = JSON.parse(D.serialize(sample())); o.closed = true;
  assert.throws(() => D.resolve(D.parse(JSON.stringify(o))), (e) => e.code === 'CLOSE_NOT_BUILT');
});

test('every segment has a positive length and the fields INTERFACES §1 names', () => {
  for (const g of D.resolve(sample()).segments) {
    assert.ok(g.length > 0);
    for (const f of ['id', 'word', 'kind', 'length', 'k0', 'k1', 'kp0', 'kp1', 'roll0', 'roll1', 'heartline', 'profile', 'speed', 'tempo']) assert.ok(f in g, `${g.id} lacks ${f}`);
  }
});

test('removing the head of an empty document is refused', () => {
  assert.throws(() => D.removeHead(D.createDoc()), (e) => e.code === 'EMPTY_DOC');
});
