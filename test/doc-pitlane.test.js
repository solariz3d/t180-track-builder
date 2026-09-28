// doc-pitlane.test.js: node --test test/doc-pitlane.test.js. The pit lane in the document (ARCHITECTURE §11.1: "a pit
// lane as a side road leaving and rejoining the loop"), schema 3 and its migration, and the project of layouts ("layouts
// as separate documents").
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const Pr = require('../src/doc/project.js');

const base = () => { let d = D.appendWord(D.createDoc('p'), 'straight', { handles: { length: 600 } }); return D.appendWord(d, 'tight', { font: 'flat' }); };
const LANE = { side: 'R', leave: { word: 'w1', along: 100 }, rejoin: { word: 'w1', along: 500 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 };

test('a new document has no pit lane, and writes pitLane: null in its canonical text', () => {
  assert.equal(D.createDoc().pitLane, null);
  assert.match(D.serialize(D.createDoc()), /\n {2}"pitLane": null,\n/);
});

test('a pit lane round-trips byte-exact, in canonical key order whatever order it was written in', () => {
  const d = D.setPitLane(base(), LANE), t = D.serialize(d);
  assert.match(t, /"pitLane": \{"side":"R","leave":\{"word":"w1","along":100\},"rejoin":\{"word":"w1","along":500\},"offsetM":12,"width":8,"divergeM":80,"mergeM":80,"speedKmh":80\},/);
  assert.equal(D.serialize(D.parse(t)), t);
  const o = JSON.parse(t); o.pitLane = Object.fromEntries(Object.entries(o.pitLane).reverse());
  assert.equal(D.serialize(D.parse(JSON.stringify(o))), t);
});

test('lane lengths are snapped to 0.1 mm and its speed to 0.01 km/h, on edit and on load', () => {
  const d = D.setPitLane(base(), { ...LANE, offsetM: 12.00004, speedKmh: 79.996 });
  assert.deepEqual([d.pitLane.offsetM, d.pitLane.speedKmh], [12, 80]);
  const t = D.serialize(D.setPitLane(base(), LANE)).replace('"width":8', '"width":8.00003');
  assert.equal(D.parse(t).pitLane.width, 8);
});

test('setting, sculpting and removing the lane are one undo step each, and undo is byte-identical', () => {
  let h = D.createHistory(base());
  const t0 = D.serialize(h.present);
  h = D.commit(h, D.setPitLane(h.present, LANE)); const t1 = D.serialize(h.present);
  h = D.commit(h, D.editPitLane(h.present, { offsetM: 20 }));
  assert.equal(h.present.pitLane.offsetM, 20);
  h = D.commit(h, D.setPitLane(h.present, null));
  assert.equal(h.present.pitLane, null);
  assert.equal(h.past.length, 3);
  h = D.undo(h); assert.equal(h.present.pitLane.offsetM, 20);
  h = D.undo(h); assert.equal(D.serialize(h.present), t1);
  h = D.undo(h); assert.equal(D.serialize(h.present), t0);
});

test('missing keys take the defaults; a bad side, anchor, range or key is refused by name', () => {
  const d = D.setPitLane(base(), { leave: { word: 'w1', along: 100 }, rejoin: { word: 'w1', along: 500 } });
  assert.deepEqual([d.pitLane.side, d.pitLane.width, d.pitLane.divergeM], ['R', 8, 80]);
  const bad = (p) => assert.throws(() => D.setPitLane(base(), { ...LANE, ...p }), (e) => e.code === 'BAD_PIT_LANE', JSON.stringify(p));
  bad({ side: 'X' }); bad({ leave: { word: 'W1', along: 0 } }); bad({ leave: { word: 'w1' } }); bad({ rejoin: { word: 'w1', along: -1 } });
  bad({ width: 1 }); bad({ offsetM: -1 }); bad({ divergeM: 0 }); bad({ speedKmh: 0 }); bad({ pits: 3 });
  assert.throws(() => D.editPitLane(base(), { width: 9 }), (e) => e.code === 'NO_PIT_LANE');
});

test('a phrase word can anchor the lane (w2/1)', () => {
  const d = D.appendPhrase(base(), 'S', [{ word: 'straight' }, { word: 'straight' }]);
  assert.equal(D.setPitLane(d, { ...LANE, rejoin: { word: 'w3/2', along: 50 } }).pitLane.rejoin.word, 'w3/2');
});

test('removing the word a lane is anchored to is not blocked: the document keeps the lane, the geometry refuses it', () => {
  const d = D.removeHead(D.setPitLane(D.appendWord(base(), 'straight'), { ...LANE, rejoin: { word: 'w3', along: 50 } }));
  assert.equal(d.pitLane.rejoin.word, 'w3');
  assert.equal(D.serialize(D.parse(D.serialize(d))), D.serialize(d));
});

test('a schema-2 document migrates to schema 3 with no pit lane, and resolves to the same track', () => {
  const t3 = D.serialize(base()), t2 = t3.replace('"schema": 3', '"schema": 2').replace('  "pitLane": null,\n', '');
  assert.ok(!t2.includes('pitLane') && t2.includes('"schema": 2'));
  const d = D.parse(t2);
  assert.equal(d.pitLane, null);
  assert.equal(D.serialize(d), t3);
  assert.deepEqual(D.resolve(d).segments.map((g) => g.length), D.resolve(base()).segments.map((g) => g.length));
});

test('a schema-1 document migrates all the way (1 -> 2 -> 3)', () => {
  const t1 = D.serialize(base()).replace('"schema": 3', '"schema": 1').replace('  "pitLane": null,\n', '').replace(/,"textures":\{\}/g, '');
  const d = D.parse(t1);
  assert.deepEqual([d.schema, d.pitLane, d.words[0].textures], [3, null, {}]);
});

test('a schema-3 document without pitLane, or a schema-2 one with it, is refused', () => {
  const t = D.serialize(base());
  assert.throws(() => D.parse(t.replace('  "pitLane": null,\n', '')), (e) => e.code === 'BAD_PIT_LANE');
  assert.throws(() => D.parse(t.replace('"schema": 3', '"schema": 2')), (e) => e.code === 'UNKNOWN_KEY' || e.code === 'BAD_PIT_LANE');
});

// ── the project of layouts ─────────────────────────────────────────────────────────────────────────────────────────
test('a project of two layouts round-trips byte-exact, and each layout\'s text is its document\'s own', () => {
  const long = D.setPitLane(base(), LANE), short = D.appendWord(D.createDoc('s'), 'straight');
  const p = Pr.addLayout(Pr.addLayout(Pr.createProject('Two Ways'), 'long', long), 'short', short), t = Pr.serializeProject(p);
  assert.equal(Pr.serializeProject(Pr.parseProject(t)), t);
  assert.ok(t.includes(D.serialize(long).trimEnd()) && t.includes(D.serialize(short).trimEnd()));
  assert.deepEqual(Pr.parseProject(t).layouts.map((l) => l.layout), ['long', 'short']);
});
test('layout names are AC folder names and unique; a missing layout is named', () => {
  const p = Pr.addLayout(Pr.createProject('x'), 'a', base());
  assert.throws(() => Pr.addLayout(p, 'a', base()), (e) => e.code === 'DUPLICATE_LAYOUT');
  assert.throws(() => Pr.addLayout(p, 'Long Way', base()), (e) => e.code === 'BAD_LAYOUT_NAME');
  assert.throws(() => Pr.setLayout(p, 'b', base()), (e) => e.code === 'NO_SUCH_LAYOUT');
  assert.equal(Pr.removeLayout(p, 'a').layouts.length, 0);
});
test('a project\'s layouts migrate like documents', () => {
  const t = Pr.serializeProject(Pr.addLayout(Pr.createProject('m'), 'a', base())).replace('"schema": 3', '"schema": 2').replace('  "pitLane": null,\n', '');
  assert.equal(Pr.parseProject(t).layouts[0].doc.pitLane, null);
});
test('a project layout entry with any key but layout and doc is refused', () => {
  const t = Pr.serializeProject(Pr.addLayout(Pr.createProject('k'), 'a', base())).replace('{"layout":"a",', '{"layout":"a","extra":1,');
  assert.throws(() => Pr.parseProject(t), (e) => e.code === 'BAD_PROJECT');
});
