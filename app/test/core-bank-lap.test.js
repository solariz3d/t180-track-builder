// core-bank-lap.test.js: node --test app/test/core-bank-lap.test.js
// D473 part 2 (pane E): Track ▸ Bank the lap in the app. Since D447 Close banks the lap it closes; a lap closed before that (a flat closer) had no command that
// banks it. This is the shell's action (app/core/coreshell.js bankLap), on the core's finish.js bankLapWith. Rows:
//   1  a closed lap with a flat closer is banked as ONE undo step, and the route does not move: kh and kv byte-equal on every piece
//   2  a loop held back by the level rule is named in the status line, and a level curve on the same lap is banked
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { extendTurnBy } = require('../../src/core/turnby.js');
const { close } = require('../../src/core/close.js');

const DEG = Math.PI / 180, R = 180, Q = (Math.PI * R) / 2, QQ = (300 * Math.PI) / 2;
/** A lap closed by close() on its last piece, which does not bank (the press does): every curve upright, as a lap closed before D434. */
function flatLap() {
  let d = extend(D.createDoc('flat closer'), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const c = close(d, { edited: [d.pieces.length - 1] }); assert.equal(c.converged, true, c.report);
  return c.doc;
}
/** test/core_close_banks_lap.test.js row 7's lap: a loop that turns, between level curves. */
function loopLap() {
  let d = extend(D.createDoc('looped'), { length: 100, family: 'bowl' }); d = extendTurnBy(d, { length: QQ }, 90 * DEG); d = extend(d, { length: 100 });
  d = extendTurnBy(d, { length: 700, climbDeg: 360 }, 30 * DEG); d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: QQ }, 60 * DEG); d = extend(d, { length: 200 });
  d = extendTurnBy(d, { length: QQ }, 90 * DEG); d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: QQ }, 90 * DEG);
  const c = close(d, { edited: [d.pieces.length - 1] }); assert.equal(c.converged, true, c.report);
  return c.doc;
}
async function shellWith(d) { const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.adopt(d); return s; }
const present = (s) => s.getState().history.present;

test('row 1: a closed lap with a flat closer is banked as one undo step, and the route does not move (kh and kv byte-equal)', async () => {
  const before = flatLap(), s = await shellWith(before), past = s.getState().history.past.length;
  await s.bankLap();
  const after = present(s);
  assert.notEqual(after, before, s.getState().message);
  assert.equal(s.getState().history.past.length, past + 1, 'one undo step');
  assert.equal(after.pieces.length, before.pieces.length);
  for (let i = 0; i < before.pieces.length; i++) {
    assert.deepEqual(after.pieces[i].channels.kh, before.pieces[i].channels.kh, `${before.pieces[i].id}: kh byte-equal`);
    assert.deepEqual(after.pieces[i].channels.kv, before.pieces[i].channels.kv, `${before.pieces[i].id}: kv byte-equal`);
    assert.equal(after.pieces[i].length, before.pieces[i].length, `${before.pieces[i].id}: length`);
  }
  assert.ok(after.pieces.some((P, i) => P.channels.phi.some((x, j) => Math.abs(x - before.pieces[i].channels.phi[j]) > 10 * DEG)), 'control: the curves are banked');
  assert.match(s.getState().message, /^banked the lap: \d+ pieces? \(.+\), up to \d+(\.\d)?° into (its turn|their turns); the route did not move \(Ctrl\+Z takes the bank back\)/);
  s.undo(); assert.equal(present(s), before, 'Ctrl+Z gives back the flat lap');
});

test('row 2: a loop held back by the level rule is named in the status line, and a level curve on the same lap is banked', async () => {
  const before = loopLap(), LOOP = before.pieces[3].id, s = await shellWith(before);
  await s.bankLap();
  const msg = s.getState().message;
  assert.match(msg, /^banked the lap: /);
  assert.ok(msg.includes(`no bank on ${LOOP}: it climbs or dives too steeply to bank (a loop or a steep ramp)`), msg);
  assert.deepEqual(present(s).pieces[3].channels.phi, before.pieces[3].channels.phi, 'the loop keeps its bank channel');
  assert.ok(present(s).pieces[1].channels.phi.some((x, j) => Math.abs(x - before.pieces[1].channels.phi[j]) > 10 * DEG), 'control: the level curve before it is banked');
});
