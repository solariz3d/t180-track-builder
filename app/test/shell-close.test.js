// shell-close.test.js: node --test app/test/*.test.js
// Close the loop from the app (app/shell.js closeLoop, through src/doc/connector.js): an AC track must be a closed lap
// before it can be exported, and a user building from the head only ever has an open one. About 17 s: one closeLoop.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShell } = require('../shell.js');
const D = require('../../src/doc/index.js');

const DEG = Math.PI / 180;
const mem = () => ({ saveDoc: async () => {}, openDoc: async () => null, listDocs: async () => [], saveLibrary: async () => {}, openLibrary: async () => null });
function openLap() {
  let d = D.createDoc('lap');
  for (const [w, o] of [['straight', { handles: { length: 150 } }], ['tight'], ['straight', { handles: { length: 120, climb: 2 * DEG } }],
    ['tight', { handles: { climb: -2 * DEG } }], ['straight', { handles: { length: 80 } }]]) d = D.appendWord(d, w, o);
  return d;
}

let CLOSED = null;
async function closedShell() {
  if (CLOSED) return CLOSED;
  const s = await createShell({ storage: mem() });
  s.adopt(openLap());
  s.closeLoop();
  return (CLOSED = s);
}

test('closing the loop appends the safest connector as one undo step, and the track is closed', async () => {
  const s = await closedShell(), st = s.getState();
  assert.equal(st.history.present.closed, true, st.message);
  assert.ok(st.history.present.words.length > 5);
  assert.equal(st.history.past.length, 1);
  assert.match(st.message, /closed/i);
});

test('the connector the shell appends is the connector\'s FIRST-ranked candidate, the safest by its worst load', async () => {
  const st = (await closedShell()).getState();
  const first = require('../../src/doc/connector.js').closeLoop(openLap()).candidates[0];
  assert.equal(D.serialize(st.history.present), D.serialize(first.doc));
});

test('the closed track still resolves for the panels, marked closed, with no resolve error', async () => {
  const st = (await closedShell()).getState();
  assert.equal(st.resolveError, null);
  assert.equal(st.resolved.closed, true);
  assert.equal(st.resolved.segments.length, D.resolve({ ...st.history.present, closed: false }).segments.length);
});

test('undo reopens the loop: the open track comes back byte for byte', async () => {
  const s = await createShell({ storage: mem() });
  s.adopt(openLap()); const before = D.serialize(s.getState().history.present);
  s.closeLoop(); s.undo();
  assert.equal(D.serialize(s.getState().history.present), before);
});

test('closing an empty track says why and changes nothing', async () => {
  const s = await createShell({ storage: mem() });
  s.closeLoop();
  assert.match(s.getState().message, /EMPTY_DOC/);
  assert.equal(s.getState().history.past.length, 0);
});
