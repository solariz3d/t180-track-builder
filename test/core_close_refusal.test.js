// core_close_refusal.test.js: node --test test/core_close_refusal.test.js
// D239 (pane C, the librarian's fold-in of C's D238 finding): closing a lap whose closure system is SINGULAR (two straights: nothing can
// bend round to meet the start) used to throw a plain Error from the solver (tools/piecewise.cjs denseSolve, called at close.js), which
// the app's shell does not catch, so the keeper saw nothing at all. It is now a NAMED refusal, a CoreError the shell shows.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const C = require('../src/core/close.js');

const twoStraights = () => extend(extend(D.createDoc('two straights'), { length: 100, targets: {} }), { length: 100, targets: {} });

test('close on two straights is a NAMED refusal (CoreError CLOSE_SINGULAR), never a plain Error', () => {
  const doc = twoStraights();
  assert.throws(() => C.close(doc, { edited: [0, 1] }), (e) => e.name === 'CoreError' && e.code === 'CLOSE_SINGULAR' && /nothing to close yet/.test(e.message) && /turn/.test(e.message),
    'the refusal is a CoreError named CLOSE_SINGULAR that says what to do');
  assert.throws(() => C.close(doc), (e) => e.name === 'CoreError' && e.code === 'CLOSE_SINGULAR', 'and so it is with close\'s own default weights');
});

test('control: a lap that CAN close still closes (a turning track is not refused)', () => {
  let d = D.createDoc('three turns');
  for (let i = 0; i < 4; i++) d = extend(d, { length: 300, targets: { kh: Math.PI / 2 / 300 } });
  const res = C.close(d);
  assert.equal(res.converged, true, res.report);
});

test('the app shows the refusal by its name: the shell\'s message carries CLOSE_SINGULAR, and the track stays open', async () => {
  const { createCoreShell } = require('../app/core/coreshell.js');
  const sh = await createCoreShell({ brushFn: null });
  sh.extend({ length: 100, targets: {} }); sh.extend({ length: 100, targets: {} });
  assert.doesNotThrow(() => sh.close(), 'the shell no longer lets the solver\'s error escape');
  assert.match(sh.getState().message || '', /^CLOSE_SINGULAR: nothing to close yet/);
  assert.equal(sh.getState().history.present.closed, false);
});
