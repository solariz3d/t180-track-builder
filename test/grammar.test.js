// grammar.test.js: node --test test/grammar.test.js. The next-word suggestion (src/doc/grammar.js), on the fixture's
// transitions (test/fixtures/corpus.fixture.json, not measurements).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const { suggestNext } = require('../src/doc/grammar.js');
const { generate } = require('../src/doc/vocabgen.js');
const G = generate(require('./fixtures/corpus.fixture.json')).grammar;

const docOf = (...words) => words.reduce((d, w) => D.appendWord(d, w), D.createDoc('g'));

test('after a turn, the suggestions are the words seen after a turn, most seen first', () => {
  assert.deepEqual(suggestNext(docOf('straight', 'turn'), G).suggestions.map((s) => s.word), ['sweep', 'tight', 'straight']);
});

test('the wall-ride and the inversion are classes of their own, suggested and suggesting', () => {
  assert.equal(suggestNext(docOf('wall-ride'), G, 9).suggestions[0].word, 'turn');
  assert.ok(suggestNext(docOf('wall-ride'), G, 9).suggestions.some((s) => s.word === 'inversion'));
  assert.equal(suggestNext(docOf('inversion'), G).suggestions[0].word, 'wall-ride');
});

test('a phrase at the head is read by its last word', () => {
  const d = D.appendPhrase(D.createDoc('p'), 'x', [{ word: 'sweep' }, { word: 'tight' }]);
  assert.equal(suggestNext(d, G).after, 'tight');
  assert.equal(suggestNext(d, G).suggestions[0].word, 'turn');
});

test('an empty document, and a corpus with no grammar, get no suggestion, not a guess', () => {
  assert.deepEqual(suggestNext(D.createDoc('e'), G).suggestions, []);
  assert.deepEqual(suggestNext(docOf('turn'), null).suggestions, []);
});

test('the grammar only suggests: a word it never suggests after the head still appends', () => {
  const d = docOf('straight');
  assert.ok(!suggestNext(d, G, 9).suggestions.some((s) => s.word === 'straight'));
  assert.equal(D.appendWord(d, 'straight').words.length, 2);
});
