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
  test(`F1-F7: from ${start} on his flat turn, Even (the right edge's handle, the left edge held) brings the turn to 16 m with the inner edge where it is (B; amended by name below)`, async () => {
    const base = F.fixture('flat'), sh = await F.startOf(base, start), st0 = F.present(sh), run = F.runPieces(st0);
    evenDrag(sh, run, 'left', 16);
    const d = F.present(sh), S = F.stations(F.RUN.lo, F.RUN.hi);
    assert.notEqual(d, st0, `the level was laid: ${msg(sh)}`);
    const w = F.spread(S.map((s) => F.at(d, 'w', s)));
    assert.ok(w <= 0.01, `F1: width spread ${w}`);
    assert.ok(Math.abs(F.at(d, 'w', F.RUN.mid) - 16) <= 0.01, 'F1: at 16 m');
    // F2, F3, F6 and F7 AMENDED BY NAME (D678, the packet's "Amended 17:4x" item 3, B on d678-even-b; the hand-back's section 6.2). B keeps the inner edge where the
    // grabs left it (st0), where A0 laid it where the untouched road had it (base); the outer edge follows it at the new width; the centre's height stays as the
    // grabs left it, moved only in the plane of the road (F.centreInPlane), where A0 eased it between the window's ends; and the start's own reds on the run stay.
    // F2 is therefore the span across one over the run and the outer edge no more uneven than the inner edge as it was, NOT the example's outer edge even (A0
    // meets that): each grab of the outer edge also moved the inner one, and B keeps it
    const across = F.spread(S.map((s) => F.rimAcross(d, s, 'left') - F.rimAcross(d, s, 'right')));
    assert.ok(across <= 0.01, `F2: the span across is ${across} m uneven`);
    const outer = F.spread(S.map((s) => F.rimAcross(d, s, 'right'))), innerNow = F.spread(S.map((s) => F.rimAcross(st0, s, 'left')));
    assert.ok(outer <= innerNow + 0.01, `F2: outer edge spread ${outer}, the inner edge's as it was ${innerNow}`);
    const inner = Math.max(...S.map((s) => Math.abs(F.rimAcross(d, s, 'left') - F.rimAcross(st0, s, 'left'))));
    assert.ok(inner <= 0.01, `F3: the inner edge is ${inner} m from where it was`);
    // F4 AMENDED (D678, the packet's "Amended 17:4x" item 1): outside the window every channel within one stored step, no longer bit for bit (test/even_fixtures.js outsideChanges)
    assert.deepEqual(F.outsideChanges(d, st0).slice(0, 5), [], 'F4: outside the window, nothing past one stored step');
    assert.doesNotThrow(() => D.checkDoc(d), 'F5: checkDoc');
    assert.deepEqual(F.jointBreaks(d), [], 'F5: no step at the joints in w, l or h');
    const h = F.centreInPlane(d, st0);
    assert.ok(h.off <= 0.01, `F6: the centre's height is ${h.off} m off the start's in the plane of the road at ${h.at}`);
    assert.deepEqual(F.redsLacked(d, st0), [], 'F7: no red in the window the start lacks (B keeps the start\'s own reds on the run, which A0 cleared)');
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
  // AMENDED BY NAME (D678 repair, the librarian's 15:4x ruling item 3): the words are made true to the code. The kept edge is laid where Even reads the road's
  // own edge from the stretch's ends and can move (B's read, 2.5: 3.96 m on the flat turn after a grab), so "stays where it was" is withdrawn.
  // AMENDED BY NAME again (D678, the packet's "Amended 17:4x" item 3, B on d678-even-b): B keeps the edge where it is (Y1, within 0.01 m), so the words say so
  assert.match(msg(sh), /the right edge stays where it is and the left edge moves/);
  assert.doesNotMatch(msg(sh), /reads the road/);
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

// B2 (D678, the 23:26Z order's item 2; lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, 5.2b): the guard on Even's step reads only the stations
// inside the level's window, each against every station of the lap. A straight laid back over the first at 1.5° (the core's own pieces, as
// core-pass-clearance.test.js lays it), banked 0.15 rad in its middle, then widened from 31 m by Even: kept on one edge, the other rises toward the pass below
// and is refused; kept on the other, it moves. bcedaaf's whole read gave the same verdicts on these cases and their mirrors (the hand-back's 5.3).
test('B2: an Even step that brings the road too close to another pass inside its window is refused by name, and the drag stays at its last good step', async () => {
  const { extendTurnBy } = require('../../src/core/turnby.js');
  let d = extend(D.createDoc('crossing'), { length: 200, family: 'bowl' });
  d = extendTurnBy(d, { length: 240, climbDeg: 1.5 }, (135 * Math.PI) / 180);
  d = extendTurnBy(d, { length: 240, climbDeg: -1.5 }, (135 * Math.PI) / 180);
  d = extend(d, { length: 300 });
  d = D.refineKnots(d, d.pieces[3].id, 0, d.pieces[3].length, 20).doc;
  d = D.checkDoc({ ...d, pieces: d.pieces.map((P, i) => (i === 3 ? { ...P, channels: { ...P.channels, phi: P.channels.phi.map((x, k, c) => (k < 2 || k >= c.length - 2 ? x : 0.15)) } } : P)) });
  for (const [hold, refused] of [['left', true], ['right', false]]) {
    const sh = await F.shellOn(d);
    sh.selectPiece(3); sh.beginSculpt({ tool: 'even', hold });
    assert.ok(sh.getState().brush && sh.getState().brush.mode === 'even', `${hold}: the drag opened: ${msg(sh)}`);
    sh.sculptTo(4);
    if (refused) {
      assert.match(msg(sh), /^PASS_CLEARANCE: too close to another pass of the road: /, `${hold}: ${msg(sh)}`);
      assert.equal(F.present(sh), d, `${hold}: the drag stays at its last good step`);
    } else {
      assert.doesNotMatch(msg(sh), /PASS_CLEARANCE/, `${hold}: control, the other edge kept is laid`);
      assert.notEqual(F.present(sh), d, `${hold}: control, the step was laid`);
    }
    sh.endSculpt();
  }
});
