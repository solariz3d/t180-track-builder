// sculpt-even.test.js: node --test app/test/sculpt-even.test.js
// Sculpt's EVEN through the shell (app/core/coreshell.js, D678): the selected run's width handle dragged with the Even tool, and the width typed (evenRun). The
// registration's flat rows F1 to F7 from his example after today's grab (T1, T2b), and the tool's rows: one piece, the open end, the typed value, the 0.5 m
// snap, Undo and Redo, the refusals by name (lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, section 1.3). The banked rows are
// app/test/sculpt-even-banked.test.js; the core's rows test/core_even.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const SC = require('../../src/core/sculpt.js');
const { extend } = require('../../src/core/extend.js');
const F = require('../../test/even_fixtures.js');

/** The run selected (a click, then a Shift-click), its width handle pressed with the Even tool holding `hold`, dragged to `value`, released. */
function evenDrag(sh, { from, to }, hold, value) {
  sh.selectPiece(from); if (to !== from) sh.selectPiece(to, { extend: true });
  sh.beginSculpt({ tool: 'even', hold });
  const b = sh.getState().brush; assert.ok(b && b.mode === 'even', `the drag opened: ${sh.getState().message}`);
  sh.sculptTo(value - b.value0);
  sh.endSculpt();
}
const msg = (sh) => sh.getState().message || '';

for (const start of ['T1', 'T2b']) {
  test(`F1-F7: from ${start} on his flat turn, Even (the right edge's handle, the left edge held) brings the turn to 16 m with the inner edge where the road had it`, async () => {
    const base = F.fixture('flat'), sh = await F.startOf(base, start), st0 = F.present(sh), run = F.runPieces(st0);
    evenDrag(sh, run, 'left', 16);
    const d = F.present(sh), S = F.stations(F.RUN.lo, F.RUN.hi);
    assert.notEqual(d, st0, `the level was laid: ${msg(sh)}`);
    const w = F.spread(S.map((s) => F.at(d, 'w', s)));
    assert.ok(w <= 0.01, `F1: width spread ${w}`);
    assert.ok(Math.abs(F.at(d, 'w', F.RUN.mid) - 16) <= 0.01, 'F1: at 16 m');
    const outer = F.spread(S.map((s) => F.rimAcross(d, s, 'right')));
    assert.ok(outer <= 0.01, `F2: outer edge spread ${outer}`);
    const inner = Math.max(...S.map((s) => Math.abs(F.rimAcross(d, s, 'left') - F.rimAcross(base, s, 'left'))));
    assert.ok(inner <= 0.01, `F3: the inner edge is ${inner} m from the untouched road's`);
    assert.deepEqual(F.outsideChanges(d, st0), [], 'F4: nothing outside the window');
    assert.doesNotThrow(() => D.checkDoc(d), 'F5: checkDoc');
    assert.deepEqual(F.jointBreaks(d), [], 'F5: no step at the joints in w, l or h');
    const h = F.spread(S.map((s) => F.at(d, 'h', s)));
    assert.ok(h <= 0.01, `F6: centre height spread ${h}`);
    const onRun = F.reds(d).filter((x) => x.s1 >= F.RUN.lo && x.s0 <= F.RUN.hi);
    assert.deepEqual(onRun, [], 'F7: no red on the run');
    assert.deepEqual(F.redsLacked(d, base), [], 'F7: no red in the window the untouched road lacks');
    // F5: one undo step: Undo gives the start back byte for byte, Redo the level
    const after = D.serialize(d);
    sh.undo(); assert.equal(D.serialize(F.present(sh)), D.serialize(st0), 'Undo: the start');
    sh.redo(); assert.equal(D.serialize(F.present(sh)), after, 'Redo: the level');
  });
}

test('the drag snaps to 0.5 m, keeps the run selected through every step, and its release says what it did', async () => {
  const sh = await F.shellOn(F.fixture('flat')), run = F.runPieces(F.fixture('flat'));
  sh.selectPiece(run.from); sh.selectPiece(run.to, { extend: true });
  sh.beginSculpt({ tool: 'even', hold: 'right' });
  const b = sh.getState().brush; assert.equal(b.hold, 'right'); assert.ok(Math.abs(b.value0 - 12) < 1e-6, `value0 ${b.value0}`);
  sh.sculptTo(3.3);
  assert.ok(Math.abs(F.at(F.present(sh), 'w', F.RUN.mid) - 15.5) < 1e-6, '12 + 3.3 snaps to 15.5');
  assert.ok(sh.getState().selection && sh.getState().selection.base === F.present(sh), 'the run stays selected (its handles stay)');
  sh.sculptTo(3.6);
  assert.ok(Math.abs(F.at(F.present(sh), 'w', F.RUN.mid) - 15.5) < 1e-6, '12 + 3.6 snaps to 15.5');
  sh.sculptTo(-20);
  assert.ok(Math.abs(F.at(F.present(sh), 'w', F.RUN.mid) - 0.5) < 1e-6, 'no narrower than 0.5 m');
  sh.sculptTo(4);
  sh.endSculpt();
  assert.ok(Math.abs(F.at(F.present(sh), 'w', F.RUN.mid) - 16) < 1e-6);
  assert.match(msg(sh), /^Even: 16 m wide from 0\.20 km to 0\.44 km/);
  assert.match(msg(sh), /the right edge stays where it was/);
  sh.undo(); assert.equal(D.serialize(F.present(sh)), D.serialize(F.fixture('flat')), 'the whole drag is one undo step');
});

test('typed: Even takes the value as typed (no snap), with the edge picked, as one undo step; the picks read the road either side of the run', async () => {
  const base = F.fixture('flat'), sh = await F.shellOn(base), run = F.runPieces(base);
  sh.selectPiece(run.from); sh.selectPiece(run.to, { extend: true });
  const p = sh.evenPicks();
  assert.ok(Math.abs(p.before - F.at(base, 'w', F.RUN.lo)) < 1e-9 && Math.abs(p.after - F.at(base, 'w', F.RUN.hi)) < 1e-9, JSON.stringify(p));
  sh.evenRun({ value: '13.25', hold: 'right' });
  const d = F.present(sh);
  assert.ok(Math.abs(F.at(d, 'w', F.RUN.mid) - 13.25) < 1e-6, `typed 13.25, got ${F.at(d, 'w', F.RUN.mid)}`);
  const S = F.stations(F.RUN.lo, F.RUN.hi), held = Math.max(...S.map((s) => Math.abs(F.rimAcross(d, s, 'right') - F.rimAcross(base, s, 'right'))));
  assert.ok(held <= 0.01, `the right edge held: ${held}`);
  assert.ok(sh.getState().selection && sh.getState().selection.base === d, 'the run stays selected');
  sh.undo(); assert.equal(D.serialize(F.present(sh)), D.serialize(base));
  sh.redo(); assert.equal(D.serialize(F.present(sh)), D.serialize(d));
});

test('one piece: its width handle under Even levels that piece alone, eased into its neighbours', async () => {
  const base = F.fixture('flat'), sh = await F.shellOn(base), off = SC.pieceOffsets(base), p = 2;
  evenDrag(sh, { from: p, to: p }, 'centre', 9);
  const d = F.present(sh), S = F.stations(off[p], off[p] + base.pieces[p].length);
  assert.ok(F.spread(S.map((s) => F.at(d, 'w', s))) <= 1e-4 && Math.abs(F.at(d, 'w', off[p] + 30) - 9) < 1e-6);
  assert.deepEqual(F.jointBreaks(d), []);
});

test('the open end: a run ending at the head is levelled to its end, the head taking the value', async () => {
  const base = F.fixture('flat'), sh = await F.shellOn(base), last = base.pieces.length - 1;
  sh.selectPiece(last - 1); sh.selectPiece(last, { extend: true });
  sh.evenRun({ value: 18 });
  assert.ok(Math.abs(F.at(F.present(sh), 'w', F.endOf(base)) - 18) < 1e-6, msg(sh));
});

test('Even refuses by name and changes nothing: no run selected, a drag on the road, an empty or wrong width, a jump within reach', async () => {
  const base = F.fixture('flat'), sh = await F.shellOn(base);
  sh.evenRun({ value: 16 }); assert.match(msg(sh), /^EVEN_RUN/); assert.equal(F.present(sh), base);
  sh.beginBrush({ tool: 'even', s0: 320, r: 60 }); assert.match(msg(sh), /^EVEN_RUN/); assert.equal(sh.getState().brush, null); assert.equal(F.present(sh), base);
  sh.selectPiece(2);
  for (const value of ['', '  ', 'abc', 0.2, 1000]) { sh.evenRun({ value }); assert.match(msg(sh), /EVEN_VALUE/, String(value)); assert.equal(F.present(sh), base, String(value)); }
  sh.evenRun({ value: 16, hold: 'up' }); assert.match(msg(sh), /EVEN_HOLD/); assert.equal(F.present(sh), base);
  // a jump within reach: refused as the drag opens, and typed
  const J = require('../../src/core/jump.js');
  let j = extend(D.createDoc('jump'), { length: 200 }); j = extend(j, { length: 100 }); j = J.jumpHere(j, null, { landingM: 100 }); j = extend(j, { length: 200 });
  const sj = await F.shellOn(j), fl = j.pieces.findIndex((P) => P.type === 'flight');
  sj.selectPiece(fl - 1); sj.beginSculpt({ tool: 'even', hold: 'left' });
  assert.match(msg(sj), /EVEN_JUMP/); assert.equal(sj.getState().brush, null); assert.equal(F.present(sj), j);
  sj.evenRun({ value: 16 }); assert.match(msg(sj), /EVEN_JUMP/); assert.equal(F.present(sj), j);
});
