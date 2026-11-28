// validate_lines_between.test.js: node --test test/validate_lines_between.test.js
// src/validate linesBetween (D678 repair, item 1; lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, section 3.2, row E3): the load lines at the
// stations between two lap distances, without checking the rest of the track, are the very lines a whole validate makes there, every field the same bits. Even's
// sentence reads the centre line's load inside the level's window through it, so a difference here would be a different sentence.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const AD = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const EV = require('../src/core/even.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const F = require('./even_fixtures.js');

const OPTS = Object.freeze({ csp: true, fullSpeed: true, leanLines: true });   // app/core/evenwords.js VOPTS

/** Every line validate gives with lap distance in [a, b], against linesBetween's for the same span: the same stations, in order, each field Object.is. */
function sameLines(doc, a, b) {
  const tp = AD.toPath(doc, { step: 2 });
  const whole = V.validate(tp.path, tp.segments, OPTS).lines.filter((l) => l.s >= a - 1e-9 && l.s <= b + 1e-9);
  const part = V.linesBetween(tp.path, tp.segments, a, b, OPTS);
  assert.ok(whole.length > 0, 'control: the span has stations');
  assert.equal(part.length, whole.length, 'the same number of lines');
  whole.forEach((x, k) => { for (const key of Object.keys(x)) assert.ok(Object.is(part[k][key], x[key]), `line ${k} at s ${x.s} u ${x.u}: ${key} ${part[k][key]} against ${x[key]}`); });
  return whole.length;
}

test('E3: on B+ levelled, the lines inside the level\'s window are the whole validate\'s, every field the same bits', () => {
  const base = F.fixture('B+'), r = EV.even(base, { ...F.runPieces(base), value: 16, hold: 'left' });
  sameLines(r.doc, r.window.w0, r.window.w1);
});

test('E3: on a closed lap, a span in its middle gives the whole validate\'s lines there (the speed profile is the lap\'s)', () => {
  const R = 180, Q = (Math.PI * R) / 2;
  let d = extend(D.createDoc('lap'), { length: 600, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const c = close(d, { edited: [0] }); assert.equal(c.converged, true, c.report); assert.equal(c.doc.closed, true);
  sameLines(c.doc, 700, 1100);
});

test('linesBetween refuses a span that is not one, and gives nothing past the last station', () => {
  const tp = AD.toPath(F.fixture('flat'), { step: 2 });
  assert.throws(() => V.linesBetween(tp.path, tp.segments, 300, 200, OPTS), /fromS <= toS/);
  assert.throws(() => V.linesBetween(tp.path, tp.segments, NaN, 200, OPTS), /fromS <= toS/);
  assert.deepEqual(V.linesBetween(tp.path, tp.segments, 1e7, 1e7 + 10, OPTS), []);
});
