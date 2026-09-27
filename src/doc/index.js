// index.js: the document model (ARCHITECTURE §2), in one require.
'use strict';
const vocab = require('./vocab.js');
const serial = require('./serial.js');
const document = require('./document.js');
const history = require('./history.js');
const { resolve, resolveFrom, ResolveError } = require('./resolve.js');

module.exports = {
  ...document,
  serialize: serial.serialize, parse: serial.parse, checkDoc: serial.checkDoc, DocError: serial.DocError,
  SCHEMA: serial.SCHEMA, GENERATOR: serial.GENERATOR,
  resolve, resolveFrom, ResolveError,
  ...history,
  WORDS: vocab.WORDS, FONTS: vocab.FONTS, TEMPOS: vocab.TEMPOS,
};
