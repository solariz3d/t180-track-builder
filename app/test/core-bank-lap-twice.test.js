// core-bank-lap-twice.test.js (C, D474 review of d473-e a4bfe52): RED ROW, no fix. Track ▸ Bank the lap pressed a second time on a lap it has just banked changes
// nothing. On core-bank-lap.test.js row 2's looped lap it banks p3 again (+0.86° a press, sampled, for three more presses): bankLapRun reads a piece whose bank
// stayed within ROLL_FREE (5°) as upright (src/core/finish.js `flat`), and bankPlan's targets are the whole share bank of its kh, added by banked() onto the
// bank it already has. Dropped into app/test/ it runs as it stands; from elsewhere: T=<t180 tree> node --test core-bank-lap-twice.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const T = process.env.T || path.join(__dirname, '..', '..'), r = (f) => require(path.join(T, f));
const { createCoreShell } = r('app/core/coreshell.js');
const D = r('src/core/document.js'), { extend } = r('src/core/extend.js'), { extendTurnBy } = r('src/core/turnby.js'), { close } = r('src/core/close.js');
const DEG = Math.PI / 180, QQ = (300 * Math.PI) / 2;
/** core-bank-lap.test.js row 2's lap (test/core_close_banks_lap.test.js row 7's): a loop that turns, between level curves. */
function loopLap() {
  let d = extend(D.createDoc('looped'), { length: 100, family: 'bowl' }); d = extendTurnBy(d, { length: QQ }, 90 * DEG); d = extend(d, { length: 100 });
  d = extendTurnBy(d, { length: 700, climbDeg: 360 }, 30 * DEG); d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: QQ }, 60 * DEG); d = extend(d, { length: 200 });
  d = extendTurnBy(d, { length: QQ }, 90 * DEG); d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: QQ }, 90 * DEG);
  const c = close(d, { edited: [d.pieces.length - 1] }); assert.equal(c.converged, true, c.report);
  return c.doc;
}

test('Bank the lap pressed again on a lap it has just banked changes nothing (no second undo step, every bank channel as the first press left it)', async () => {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.adopt(loopLap());
  await s.bankLap();
  const once = s.getState().history.present, depth = s.getState().history.past.length;
  assert.equal(depth, 1, `control: the first press banks the lap (${s.getState().message})`);
  await s.bankLap();
  const twice = s.getState().history.present;
  const moved = twice.pieces.filter((P, i) => JSON.stringify(P.channels.phi) !== JSON.stringify(once.pieces[i].channels.phi)).map((P) => P.id);
  assert.deepEqual(moved, [], `the second press re-banked ${moved.join(', ')}: ${s.getState().message}`);
  assert.equal(s.getState().history.past.length, depth, 'no second undo step');
});
