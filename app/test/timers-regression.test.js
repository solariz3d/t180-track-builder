// Proposed for A (app/test/): the shell's default timers must work where setTimeout insists on being called on the
// global, as a browser's does (WebView2: "Illegal invocation"). Node's setTimeout does not care, so without this the
// headless tests pass while the real window cannot place a word.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createShell } = require('../shell.js');
const memAuto = () => { let auto = null; return { saveDoc: async () => {}, openDoc: async () => null, listDocs: async () => [], saveLibrary: async () => {}, openLibrary: async () => null, saveAutosave: async (t) => { auto = t; }, openAutosave: async () => auto, clearAutosave: async () => { auto = null; } }; };
test('placing a word with the DEFAULT timers works where setTimeout must be called on the global (a browser)', async () => {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const strict = (fn) => function (...a) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); return fn(...a); };
  globalThis.setTimeout = strict(realSet); globalThis.clearTimeout = strict(realClear);
  try {
    const s = await createShell({ storage: memAuto() });
    s.place('straight'); s.place('turn');
    assert.deepStrictEqual([s.getState().message, s.getState().history.present.words.length], [null, 2]);
  } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
});
