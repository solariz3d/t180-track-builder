// core-bank-lap.test.js: node --test app/test/core-bank-lap.test.js
// D473 part 2 (pane E): Track ▸ Bank the lap in the app. Since D447 Close banks the lap it closes; a lap closed before that (a flat closer) had no command that
// banks it. This is the shell's action (app/core/coreshell.js bankLap), on the core's finish.js bankLapWith. Rows:
//   1  a closed lap with a flat closer is banked as ONE undo step, and the route does not move: kh and kv byte-equal on every piece
//   2  a loop held back by the level rule is named in the status line, and a level curve on the same lap is banked
// D477 (pane P; C's D474 review): a second press changes nothing, the level words by the plan-bank test, a copy of the track first. Rows:
//   3  on a lap shaped like TEST 10 (his own bank into a corner he banked himself, a loop that turns beside the curves the press banks), a second press changes
//      nothing: no undo step, every bank channel as the first press left it, and the status line says so (the first press left two pieces banked under 5°)
//   4  a loop whose stored turn is under 1/600 is named in the status line when the level rule holds it back (the plan would have banked it about 48°)
//   5  the press copies the track to its backups first, as it was; a second press, which changes nothing, writes no second copy
//   6  a copy that cannot be written refuses by name, and nothing changes: no undo step, the lap as it was
//   7  a bank he laid on purpose under 5° is kept: a straight at 3° is unchanged but for the roll-off tail of the curve after it (D468's tail, one point, raised
//      and never lowered; a4bfe52 raises it too), and a gentle curve at 3° is never taken below 3° (the chair's row, D477 read)
// The second press's row on core-bank-lap.test.js row 2's looped lap is C's red row, app/test/core-bank-lap-twice.test.js, as C wrote it.
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
/** TEST 10's shape in public words: his own 30° bank over 100 m into a corner he banked himself and a roll back, a loop that turns (loopDeg over loopM, climbing
 *  360°), then upright corners. `loopDeg` 40 over 600 m: the loop's stored turn is over 1/600 and two pieces beside it (p6, p10) are banked under 5° by the first
 *  press (the second re-banked them, +3.8° each, before D477); 25 over 700 m: the loop's stored turn peaks at 1.23e-3, under 1/600. */
function t10Lap(loopM, loopDeg) {
  let d = extend(D.createDoc('t10 shape'), { length: 200, family: 'bowl' });
  d = extend(d, { length: 100, transition: 40, targets: { phi: 30 * DEG } });
  d = extend(d, { length: QQ, transition: 40, targets: { kh: 1 / 300 } });
  d = extend(d, { length: 100, transition: 40, targets: { phi: 0, kh: 0 } });
  d = extendTurnBy(d, { length: loopM, climbDeg: 360 }, loopDeg * DEG);
  d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: QQ }, (140 - loopDeg) * DEG); d = extend(d, { length: 200 });
  d = extendTurnBy(d, { length: QQ }, 90 * DEG); d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: QQ }, 90 * DEG);
  const c = close(d, { edited: [d.pieces.length - 1] }); assert.equal(c.converged, true, c.report);
  return c.doc;
}
/** A storage for the shell, as core-smooth-ramps.test.js has it: the copies it was asked to keep, and whether the copy fails. */
function store({ backupFails = false } = {}) {
  const st = { docs: new Map(), backups: [], log: [] };
  return Object.assign(st, {
    listDocs: async () => [...st.docs.keys()],
    openDoc: async (n) => { if (!st.docs.has(n)) throw new Error(`not found: ${n}`); return st.docs.get(n); },
    saveDoc: async (n, t) => { st.log.push('save'); st.docs.set(n, t); },
    backupDoc: async (name, text) => { st.log.push('backup'); if (backupFails) throw new Error('the disk is full'); st.backups.push({ name, text }); return `${name}.bak`; },
  });
}
async function shellWith(d, storage = undefined) { const s = await createCoreShell({ brushFn: null, autosaveMs: 0, ...(storage ? { storage } : {}) }); s.adopt(d); return s; }
const present = (s) => s.getState().history.present;
const ROLL_FREE = 5 * DEG;

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

test('row 3: on a lap shaped like TEST 10, a second press changes nothing (no undo step, every bank channel as the first press left it, and the status line says so)', async () => {
  const before = t10Lap(600, 40), s = await shellWith(before), up = D.valuesAt(before.pieces[0], 0).phi;
  await s.bankLap();
  const once = present(s), depth = s.getState().history.past.length;
  assert.equal(depth, 1, `control: the first press banks the lap (${s.getState().message})`);
  const under = once.pieces.filter((P, i) => JSON.stringify(P.channels.phi) !== JSON.stringify(before.pieces[i].channels.phi) && P.channels.phi.every((x) => Math.abs(x - up) <= ROLL_FREE)).map((P) => P.id);
  assert.ok(under.length >= 2, `control: the first press left pieces banked under 5° beside the loop (the ones a second press re-banked): ${under.join(', ') || 'none'}`);
  await s.bankLap();
  const twice = present(s), moved = twice.pieces.filter((P, i) => JSON.stringify(P.channels.phi) !== JSON.stringify(once.pieces[i].channels.phi)).map((P) => P.id);
  assert.deepEqual(moved, [], `the second press re-banked ${moved.join(', ')}: ${s.getState().message}`);
  assert.equal(s.getState().history.past.length, depth, 'no second undo step');
  assert.equal(twice, once, 'the document the first press made, the same object');
  assert.equal(s.getState().message, 'nothing banked, nothing changed: no bank on p5: it climbs or dives too steeply to bank (a loop or a steep ramp)', 'the no-op words, with the loop still named');
});

test('row 4: a loop whose stored turn is under 1/600 is named in the status line when the level rule holds it back', async () => {
  const before = t10Lap(700, 25), LOOP = before.pieces[4];
  const kmax = Math.max(...LOOP.channels.kh.map(Math.abs));
  assert.ok(kmax < 1 / 600, `control: the loop's stored turn is under 1/600 (${kmax.toExponential(3)})`);
  const s = await shellWith(before);
  await s.bankLap();
  const msg = s.getState().message;
  assert.match(msg, /^banked the lap: /);
  assert.ok(msg.includes(`no bank on ${LOOP.id}: it climbs or dives too steeply to bank (a loop or a steep ramp)`), msg);
  assert.deepEqual(present(s).pieces[4].channels.phi, before.pieces[4].channels.phi, 'the loop keeps its bank channel');
});

test('row 5: the press copies the track to its backups first, as it was; a press that changes nothing writes no copy', async () => {
  const before = flatLap(), st = store(), s = await shellWith(before, st);
  await s.bankLap();
  assert.match(s.getState().message, /^banked the lap: /);
  assert.deepEqual(st.backups.map((b) => [b.name, b.text]), [['eq-unsaved', D.serialize(before)]], 'one copy, of the track as it was');
  assert.deepEqual(st.log, ['backup'], 'the copy, and no save');
  await s.bankLap();
  assert.equal(st.backups.length, 1, 'a second press, which changes nothing, writes no copy');
  assert.equal(s.getState().history.past.length, 1);
});

test('row 6: a copy that cannot be written refuses by name, and nothing changes', async () => {
  const before = flatLap(), st = store({ backupFails: true }), s = await shellWith(before, st), past = s.getState().history.past.length;
  await s.bankLap();
  assert.equal(s.getState().message, 'not banked: the copy from before could not be written (the disk is full); nothing changed');
  assert.equal(present(s), before, 'the lap as it was');
  assert.equal(s.getState().history.past.length, past, 'no undo step');
  assert.deepEqual(st.log, ['backup']);
  assert.deepEqual(st.backups, []);
});

/** A lap with a deliberate 3° bank under ROLL_FREE: a roll to 3°, a 300 m straight carried at 3°, a gentle right-hand curve (R 10 km) carried at 3° (its share
 *  bank is about 7°, the same way), a roll back to 0, then a rectangle of upright corners the same way, closed by close() on its last two pieces only (a close
 *  on `edited` bends a fifth of the lap and would have bent the straight into a curve). */
function deliberateLap() {
  let d = extend(D.createDoc('deliberate 3'), { length: 200, family: 'bowl' });
  d = extend(d, { length: 100, targets: { phi: 3 * DEG } });
  d = extend(d, { length: 300 });
  d = extend(d, { length: 500, transition: 40, targets: { kh: -1 / 10000 } });
  d = extend(d, { length: 100, transition: 40, targets: { phi: 0, kh: 0 } });
  d = extendTurnBy(d, { length: QQ }, -90 * DEG); d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: QQ }, -90 * DEG); d = extend(d, { length: 1200 });
  d = extendTurnBy(d, { length: QQ }, -90 * DEG); d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: QQ }, -90 * DEG);
  const c = close(d, { window: [d.pieces.length - 2, d.pieces.length - 1] }); assert.equal(c.converged, true, c.report);
  return c.doc;
}

test('row 7: a bank he laid on purpose under 5° is kept: a straight at 3° is unchanged but for the roll-off tail into the curve, a gentle curve at 3° is never taken below 3°', async () => {
  const before = deliberateLap(), STRAIGHT = before.pieces[2], CURVE = before.pieces[3], q = 10 ** -D.DEC.phi;
  assert.ok(STRAIGHT.channels.phi.every((x) => Math.abs(x - 3 * DEG) <= q), 'control: the straight carries 3° at every point');
  assert.ok(STRAIGHT.channels.kh.every((k) => k === 0), 'control: the straight is straight (the close did not bend it)');
  assert.ok(CURVE.channels.phi.every((x) => Math.abs(x - 3 * DEG) <= q), 'control: the curve carries 3° at every point');
  assert.ok(CURVE.channels.kh.some((k) => k < -1 / 20000), 'control: the curve turns the way its bank leans');
  const s = await shellWith(before);
  await s.bankLap();
  const after = present(s), msg = s.getState().message;
  assert.match(msg, /^banked the lap: /);
  const n = STRAIGHT.channels.phi.length;
  assert.deepEqual(after.pieces[2].channels.phi.slice(0, n - 3), STRAIGHT.channels.phi.slice(0, n - 3), `the straight at 3° is unchanged up to the curve's roll-off tail (${msg})`);
  assert.ok(after.pieces[2].channels.phi.every((x) => x >= 3 * DEG - 1e-9), 'the straight is never taken below its 3°, its tail included');
  const low = Math.min(...after.pieces[3].channels.phi) / DEG, high = Math.max(...after.pieces[3].channels.phi) / DEG;
  assert.ok(low >= 3 - 1e-7, `the curve is never taken below its 3°: lowest point ${low.toFixed(4)}° (${msg})`);
  assert.ok(high > 3 + 0.5, `control: the curve is banked further into its turn, to ${high.toFixed(2)}°`);
});
