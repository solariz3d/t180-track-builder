// core_edgeapron.test.js: node --test test/core_edgeapron.test.js. D572 Part B: the edge apron's width is saved WITH THE TRACK (src/core/document.js edgeApronM), the
// width the export lays outside every open road edge (src/export/apron.js). A track that never set one carries no field, in memory and in the file, and exports at the
// exporter's own default (2.0 m); a set width, 0 included, survives Save and Open; a width the exporter would refuse is refused here first.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { APRON_WIDTH_M } = require('../src/export/apron.js');

const doc = () => extend(D.createDoc('Apron'), { length: 200, family: 'bowl' });

test('a track that never set the apron has no edgeApronM field, and its saved text is as it was', () => {
  const d = doc(), text = D.serialize(d);
  assert.equal(d.edgeApronM, undefined);
  assert.ok(!/edgeApronM/.test(text), 'no field in the file');
  assert.equal(D.parse(text).edgeApronM, undefined, 'and none after Open');
  assert.equal(D.serialize(D.parse(text)), text);
});

test('a set width, 0 and 10 included, is kept through Save and Open, to the millimetre', () => {
  for (const w of [0, 1.5, 2, 3.25, 10]) {
    const d = D.setEdgeApron(doc(), w), back = D.parse(D.serialize(d));
    assert.equal(d.edgeApronM, w); assert.equal(back.edgeApronM, w, `width ${w}`);
  }
  assert.equal(D.setEdgeApron(doc(), 1.23456).edgeApronM, 1.2346, 'quantised as every length is');
});

test('setting null takes the field off again, so the track exports at the default', () => {
  const d = D.setEdgeApron(D.setEdgeApron(doc(), 1.5), null);
  assert.ok(!('edgeApronM' in d));
  assert.equal(D.serialize(d), D.serialize(doc()));
});

test('a width the exporter would refuse is refused by name, and a file carrying one does not open', () => {
  for (const w of [-0.1, 10.01, NaN, Infinity, '2', true]) {
    assert.throws(() => D.setEdgeApron(doc(), w), (e) => e.name === 'CoreError' && e.code === 'BAD_APRON' && /from 0 to 10 m/.test(e.message), JSON.stringify(w));
  }
  const text = D.serialize(doc()).replace('"nextId"', '"edgeApronM": -1,\n  "nextId"');
  assert.throws(() => D.parse(text), (e) => e.code === 'BAD_APRON');
});

test('the default a track without the field exports at is the exporter\'s own, 2.0 m, and the document\'s limits are the exporter\'s', () => {
  assert.equal(APRON_WIDTH_M, 2.0);
  assert.equal(D.APRON_MAX_M, 10);
});
