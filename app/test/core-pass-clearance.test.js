// core-pass-clearance.test.js: node --test app/test/core-pass-clearance.test.js
// THE BUILDER REFUSES A PIECE THAT PASSES TOO CLOSE OVER THE TRACK (the user, 2026-11-02: "all you had to do was forbid building the track a little bit closer
// because of the bulk of the underside"; the rule is src/validate/passclear.js). A crossing made with the core's own pieces: a straight, two 135° turns, a straight
// back across the first. Rows:
//   1  the straight back placed level with the first (they meet) is refused by name, saying where (km and piece of both passes) and how close, and nothing
//      changes: no undo step, the same document
//   2  the same straight placed high enough (the turns climbing at 2° and back, 8.4 m over the first) is placed
//   3  a track that already breaks the rule (opened that way) is still edited elsewhere: a straight added at its far end is placed, and the old break is not
//      what refuses anything
//   4  the checker shows the break red ('pass-clearance'), at both passes, in plain words
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { extendTurnBy } = require('../../src/core/turnby.js');
const AD = require('../../src/core/adapter.js');
const { validate } = require('../../src/validate/index.js');
const { reasonText } = require('../validate-ui/labels.js');

const DEG = Math.PI / 180;
/** a straight and two 135° turns (climbing at climbDeg and back, or level); the straight back across the first is the caller's to place */
function beforeCrossing(climbDeg = 0) {
  let d = extend(D.createDoc('crossing'), { length: 200, family: 'bowl' });
  d = extendTurnBy(d, { length: 240, ...(climbDeg ? { climbDeg } : {}) }, 135 * DEG);
  return extendTurnBy(d, { length: 240, ...(climbDeg ? { climbDeg: -climbDeg } : {}) }, 135 * DEG);
}
async function shellWith(d) { const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.adopt(d); return s; }
const present = (s) => s.getState().history.present;

test('row 1: a straight back placed level across the first is refused by name, saying where and how close, and nothing changes', async () => {
  const s = await shellWith(beforeCrossing(0)), before = present(s), past = s.getState().history.past.length;
  s.extend({ length: 300 });
  assert.equal(present(s), before, 'the same document');
  assert.equal(s.getState().history.past.length, past, 'no undo step');
  const msg = s.getState().message;
  // the shell keeps the core's code on its message; the panel shows it without (app/validate-ui/labels.js refusalText)
  assert.match(msg, /^PASS_CLEARANCE: too close to another pass of the road: the road at \d+\.\d\d km \(p\d+\) meets the road at \d+\.\d\d km \(p\d+\); a road over another must keep its underside 3\.1 m clear for a car( \(\d+ places\))?\. Nothing changed\.$/, msg);
  assert.ok(/\(p1\)/.test(msg) && /\(p4\)/.test(msg), `names the first straight and the new one: ${msg}`);
});

test('row 2: the same straight placed high enough over the first is placed', async () => {
  const s = await shellWith(beforeCrossing(2)), n = present(s).pieces.length;
  s.extend({ length: 300 });
  assert.equal(present(s).pieces.length, n + 1, s.getState().message || 'placed');
  assert.doesNotMatch(s.getState().message || '', /too close/);
});

test('row 3: a track that already breaks the rule is still edited elsewhere', async () => {
  const broken = extend(beforeCrossing(0), { length: 300 });   // made with the core's own pieces, as a track saved before the rule would be
  const s = await shellWith(broken), n = present(s).pieces.length;
  s.extend({ length: 100 });
  assert.equal(present(s).pieces.length, n + 1, s.getState().message || 'placed');
});

test('row 4: the checker shows the break red at both passes, in plain words', () => {
  const d = extend(beforeCrossing(0), { length: 300 }), { segments, path: p0 } = AD.toPath(d, { step: 2 }), path = AD.offsetPath(d, segments, p0);
  const v = validate(path, segments, { passClearance: true, fullSpeed: true });
  const red = v.red.filter((x) => x.reason === 'pass-clearance');
  const ids = new Set(red.map((x) => { const L = segments.reduce((a, g) => a + g.length, 0); let acc = 0; for (const g of segments) { if (x.s0 < acc + g.length) return g.id; acc += g.length; } return segments[segments.length - 1].id; }));
  assert.ok(ids.has('p1') && ids.has('p4'), `red on both passes: ${[...ids].join(', ')}`);
  assert.ok(red.every((x) => x.worst > 0), 'worst: the metres short');
  assert.equal(validate(path, segments, { fullSpeed: true }).red.filter((x) => x.reason === 'pass-clearance').length, 0, 'not asked: not checked');
  assert.match(reasonText('pass-clearance'), /^another pass of the road is too close over this one here: the road above needs its underside's depth plus 3\.1 m for a car under it$/);
});
