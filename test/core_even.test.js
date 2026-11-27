// core_even.test.js: node --test test/core_even.test.js
// Sculpt's EVEN in the core (src/core/even.js, D678): a run's width brought to one value, the held rim, the centre in the plane of the road as built, the bank as
// found. The rows of the registration (lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, section 1.3) that need no shell and no checker: the tool's
// own rows (one piece, a window across a joint, the open end), the refusals by name, nothing outside the window, and the bank (K5). The rows through the shell,
// the checker and the panel are app/test/sculpt-even.test.js and app/test/core-pieces-ui.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const SC = require('../src/core/sculpt.js');
const AD = require('../src/core/adapter.js');
const J = require('../src/core/jump.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const EV = require('../src/core/even.js');
const F = require('./even_fixtures.js');

const refusedAs = (code) => (e) => e.name === 'CoreError' && e.code === code && /Nothing changed/.test(e.message);
const widthSpread = (doc, a, b) => F.spread(F.stations(a, b).map((s) => F.at(doc, 'w', s)));

test('Even brings the run to the value from its first metre to its last, and the input document is not changed', () => {
  const base = F.fixture('flat'), before = D.serialize(base), run = F.runPieces(base);
  const r = EV.even(base, { ...run, value: 16, hold: 'left' });
  assert.equal(D.serialize(base), before, 'the input is as it was');
  assert.ok(widthSpread(r.doc, F.RUN.lo, F.RUN.hi) <= 1e-4, `width spread ${widthSpread(r.doc, F.RUN.lo, F.RUN.hi)}`);
  assert.ok(Math.abs(F.at(r.doc, 'w', F.RUN.mid) - 16) <= 1e-4);
  assert.doesNotThrow(() => D.checkDoc(r.doc));
});

test('Even on a run of one piece levels that piece, eases into its neighbours and moves nothing outside its window', () => {
  const base = F.fixture('flat'), off = SC.pieceOffsets(base), p = 2, lo = off[p], hi = off[p] + base.pieces[p].length;
  const r = EV.even(base, { from: p, to: p, value: 9, hold: 'centre' });
  assert.ok(widthSpread(r.doc, lo, hi) <= 1e-4, `the piece's width spread ${widthSpread(r.doc, lo, hi)}`);
  assert.ok(Math.abs(F.at(r.doc, 'w', (lo + hi) / 2) - 9) <= 1e-4);
  assert.deepEqual([r.window.w0, r.window.w1], [lo - 50, hi + 50], 'the window: 20 m at the value and a 30 m ramp beyond each end');
  // the ramps lie in the neighbours (pieces 1 and 3), and the window's joints are whole: value and slope continuous in w, l and h
  assert.ok(r.changed.includes(1) && r.changed.includes(3), `changed ${r.changed}`);
  const breaks = require('../src/core/continuity.js').jointSteps(r.doc, { channels: ['w', 'l', 'h'] }).filter((j) => Math.abs(j.dv) > 1e-4 || Math.abs(j.dm) > 1e-3);
  assert.deepEqual(breaks, [], 'no step at any joint');
  for (const s of F.stations(0, F.endOf(base))) if (s < r.window.w0 || s > r.window.w1) for (const ch of ['w', 'l', 'h', 'phi']) assert.ok(Object.is(F.at(r.doc, ch, s), F.at(base, ch, s)), `${ch} at ${s}`);
  base.pieces.forEach((P, i) => { if (off[i] + P.length < r.window.w0 || off[i] > r.window.w1) assert.equal(r.doc.pieces[i], P, `piece ${i} the same object`); });
  // the ramps EASE: halfway along each ramp the width is near halfway between the road's and the value, and it never passes either
  for (const [mid, road] of [[lo - 35, F.at(base, 'w', lo - 50)], [hi + 35, F.at(base, 'w', hi + 50)]]) {
    const w = F.at(r.doc, 'w', mid), half = (road + 9) / 2;
    assert.ok(Math.abs(w - half) <= 0.25 * Math.abs(road - 9), `the ramp at ${mid}: ${w}, halfway is ${half}`);
  }
  for (const s of F.stations(r.window.w0, r.window.w1)) { const w = F.at(r.doc, 'w', s); assert.ok(w >= 9 - 1e-6 && w <= Math.max(F.at(base, 'w', s), 12) + 1e-6, `the width at ${s}: ${w}`); }
});

test('the ramp is the designed ease: where the knots are fine enough to carry it, the width before the run follows a smootherstep from the road to the value over 30 m', () => {
  // the flat fixture with piece 1 cut into 2 m spans by exact knot insertion (the road unchanged), then piece 2 levelled to 9 m; measured 0.0112 m off the design
  const base0 = F.fixture('flat'), base = D.refineKnots(base0, base0.pieces[1].id, 0, base0.pieces[1].length, 2).doc, lo = SC.pieceOffsets(base)[2];
  const r = EV.even(base, { from: 2, to: 2, value: 9, hold: 'centre' });
  const want = (s) => { const road = F.at(base, 'w', s), d = lo - 20 - s, x = Math.min(1, Math.max(0, d / 30)), g = 1 - x * x * x * (x * (x * 6 - 15) + 10); return road + g * (9 - road); };
  const off = Math.max(...F.stations(lo - 50, lo - 20).map((s) => Math.abs(F.at(r.doc, 'w', s) - want(s))));
  assert.ok(off <= 0.02, `the ramp is ${off} m off the designed ease`);
});

test('Even on a run that ends at the open end gives the head the value: no ramp after it', () => {
  const base = F.fixture('flat'), last = base.pieces.length - 1, off = SC.pieceOffsets(base), end = F.endOf(base);
  const r = EV.even(base, { from: last - 1, to: last, value: 20, hold: 'centre' });
  assert.equal(r.window.w1, end, 'the window stops at the open end');
  assert.ok(Math.abs(F.at(r.doc, 'w', end) - 20) <= 1e-4, `the head's width ${F.at(r.doc, 'w', end)}`);
  assert.ok(widthSpread(r.doc, off[last - 1], end) <= 1e-4);
});

test('Even with the left rim held keeps that rim where the road has it and puts the right rim out at the new width (flat, from the untouched road)', () => {
  const base = F.fixture('flat'), run = F.runPieces(base), r = EV.even(base, { ...run, value: 16, hold: 'left' });
  const S = F.stations(F.RUN.lo, F.RUN.hi);
  const held = Math.max(...S.map((s) => Math.abs(F.rimAcross(r.doc, s, 'left') - F.rimAcross(base, s, 'left'))));
  assert.ok(held <= 0.01, `the held rim moved ${held} m`);
  const far = S.map((s) => F.rimAcross(r.doc, s, 'right') - F.rimAcross(base, s, 'right'));
  // out by the growth of the section's span across: the builder's section is curved, so 12 m of width spans 11.88 m across here and 16 m spans 15.77 m
  assert.ok(Math.min(...far) < -3.85 && Math.max(...far) > -4 && F.spread(far) <= 0.01, `the right rim moved out by ${Math.min(...far)}..${Math.max(...far)} m`);
});

test('the held rim on the other side: with the right rim held it stays and the left rim goes out (flat, from the untouched road)', () => {
  const base = F.fixture('flat'), run = F.runPieces(base), r = EV.even(base, { ...run, value: 16, hold: 'right' }), S = F.stations(F.RUN.lo, F.RUN.hi);
  const held = Math.max(...S.map((s) => Math.abs(F.rimAcross(r.doc, s, 'right') - F.rimAcross(base, s, 'right'))));
  assert.ok(held <= 0.01, `the held rim moved ${held} m`);
  const far = S.map((s) => F.rimAcross(r.doc, s, 'left') - F.rimAcross(base, s, 'left'));
  assert.ok(Math.min(...far) > 3.85 && Math.max(...far) < 4 && F.spread(far) <= 0.01, `the left rim moved out by ${Math.min(...far)}..${Math.max(...far)} m`);
});

test('after a piece with coarse knots (a plain Extend\'s 20 m spans), the run is still one width with the held rim in place from its first metre: the window reaches back to that piece\'s last span', () => {
  // the panel rows' track (app/test/core-pieces-ui.test.js track()): a 300 m straight, two turns, a straight; 31 m wide. The run p2..p3 brought to 9.25 m. Before the
  // carry side was handled (D678, found by the panel rows) the held rim stood 0.80 m off at 9 m into the run
  let d = extend(D.createDoc('coarse'), { length: 300, family: 'bowl' });
  d = extend(d, { length: 150, transition: 60, targets: { kh: 1 / 180 } }); d = extend(d, { length: 150, transition: 60, targets: { kh: 1 / 180 } });
  d = extend(d, { length: 100, transition: 60, targets: { kh: 0 } }); d = extend(d, { length: 80 });
  assert.deepEqual(d.pieces[0].knots.slice(-3), [240, 260, 280], 'control: the straight has 20 m spans to its end');
  const r = EV.even(d, { from: 1, to: 2, value: 9.25, hold: 'left' }), S = F.stations(300, 600);
  assert.ok(widthSpread(r.doc, 300, 600) <= 1e-4 && Math.abs(F.at(r.doc, 'w', 450) - 9.25) <= 1e-4);
  const held = Math.max(...S.map((s) => Math.abs(F.rimAcross(r.doc, s, 'left') - F.rimAcross(d, s, 'left'))));
  assert.ok(held <= 0.01, `the held rim moved ${held} m`);
  assert.equal(r.window.w0, 220, 'the window reaches back to the support of the straight\'s last span\'s first control point (260 at the value)');
  assert.equal(r.window.w1, 650, 'and after the run it is the 20 m margin and 30 m ramp');
  for (const s of F.stations(0, F.endOf(d))) if (s < r.window.w0 || s > r.window.w1) for (const ch of ['w', 'l', 'h']) assert.ok(Object.is(F.at(r.doc, ch, s), F.at(d, ch, s)), `${ch} at ${s}`);
});

test('where the road\'s own width changes across the window (a 31 m straight into a 12 m turn), the held rim is held where it is now, not read back from the window\'s ends', () => {
  // a plain Extend's 200 m straight keeps the empty track's 31 m; the turn's four pieces are laid at 12 m and the road narrows over the turn's first 60 m. Reading the
  // road back from the window's ends (31 m and 12 m) would put the held rim 6.7 m off (D678, found after the registration). Measured 0.077 m: the sideways offset is set
  // at its control points from the rim read on the road, and a 19 m narrowing in 60 m bends between them (a fit of the offset, as the height has, is not built)
  let d = extend(D.createDoc('narrows'), { length: 200 });
  for (const p of [...[1, 2, 3, 4].map(() => ({ length: 60, turn: 30 })), { length: 150, turn: 0 }]) d = require('../src/core/turnby.js').extendCorner(d, require('../app/core/panel.js').extendOptions({ length: p.length, turn: p.turn, climb: 0, bank: 0, width: 12, turnAs: 'corner' }));
  assert.ok(F.at(d, 'w', 150) > 30 && Math.abs(F.at(d, 'w', 500) - 12) < 1e-6, 'control: 31 m before the turn, 12 m after it');
  const r = EV.even(d, { from: 1, to: 4, value: 16, hold: 'left' }), S = F.stations(200, 440);
  const held = Math.max(...S.map((s) => Math.abs(F.rimAcross(r.doc, s, 'left') - F.rimAcross(d, s, 'left'))));
  assert.ok(held <= 0.1, `the held rim moved ${held} m`);
  assert.ok(widthSpread(r.doc, 200, 440) <= 1e-4, 'and the run is one width');
});

for (const fx of ['Bhold', 'B-', 'B-0']) {
  test(`K2 and K3 on ${fx} from the untouched road: the held rim stays within 0.01 m, and the centre's height is within 0.01 m of its place in the plane of the road as built`, () => {
    const base = F.fixture(fx), run = F.runPieces(base), r = EV.even(base, { ...run, value: 16, hold: 'left' }), S = F.stations(F.RUN.lo, F.RUN.hi);
    const held = Math.max(...S.map((s) => Math.abs(F.rimAcross(r.doc, s, 'left') - F.rimAcross(base, s, 'left'))));
    assert.ok(held <= 0.01, `K2: the held rim moved ${held} m`);
    const c = F.centreOff(r.doc, base);
    assert.ok(c.off <= 0.01, `K3: ${c.off} m at ${c.at}`);
    assert.ok(F.spread(S.map((s) => F.at(r.doc, 'w', s))) <= 1e-4, 'K6');
  });
}

test('K5: Even keeps the bank as found: the bank channel the same values and the bank as built the same bits every metre', () => {
  const base = F.fixture('B-'), run = F.runPieces(base), r = EV.even(base, { ...run, value: 16, hold: 'left' });
  r.doc.pieces.forEach((P, i) => { if (P.type === 'road') assert.deepEqual(P.channels.phi, base.pieces[i].channels.phi, `piece ${i}`); });
  for (const s of F.stations(0, F.endOf(base))) assert.ok(Object.is(F.builtBank(r.doc, s), F.builtBank(base, s)), `the built bank at ${s}`);
});

test('Even refuses by name, and changes nothing: a run that is not one, a width out of range, a hold it does not know', () => {
  const base = F.fixture('flat'), n = base.pieces.length;
  for (const [from, to] of [[3, 2], [-1, 2], [0, n], [1.5, 2], [undefined, 2]]) assert.throws(() => EV.even(base, { from, to, value: 16 }), refusedAs('EVEN_RUN'), `${from}..${to}`);
  for (const value of [0.4, 400.5, NaN, Infinity, '16', null, undefined]) assert.throws(() => EV.even(base, { from: 1, to: 4, value }), refusedAs('EVEN_VALUE'), String(value));
  assert.throws(() => EV.even(base, { from: 1, to: 4, value: 16, hold: 'up' }), refusedAs('EVEN_HOLD'));
  assert.doesNotThrow(() => EV.even(base, { from: 1, to: 4, value: 0.5 }));
  assert.doesNotThrow(() => EV.even(base, { from: 1, to: 4, value: 400 }));
});

test('Even refuses by name a jump within reach of the run, and a run that starts or ends on the jump', () => {
  let d = extend(D.createDoc('jump'), { length: 200 }); d = extend(d, { length: 100 });
  d = J.jumpHere(d, null, { landingM: 100 }); d = extend(d, { length: 200 });
  const fl = d.pieces.findIndex((P) => P.type === 'flight'); assert.ok(fl > 0);
  assert.throws(() => EV.even(d, { from: fl - 1, to: fl - 1, value: 16 }), refusedAs('EVEN_JUMP'));
  assert.throws(() => EV.even(d, { from: fl, to: fl + 1, value: 16 }), refusedAs('EVEN_RUN'));
  assert.doesNotThrow(() => EV.even(d, { from: 0, to: 0, value: 16 }), 'a run whose window ends before the jump');
});

test('Even refuses by name a tube and a split width in the window', () => {
  let t = extend(D.createDoc('tube'), { length: 300 }); t = extend(t, { length: 300, targets: { t: 200 } });
  assert.equal(D.kindOf(t.pieces[1]), 'tube');
  assert.throws(() => EV.even(t, { from: 0, to: 0, value: 16 }), refusedAs('EVEN_TUBE'));
  let s = extend(D.createDoc('split'), { length: 300 }); s = extend(s, { length: 200, targets: { wd: 3 } });
  assert.ok(D.isWidthSplit(s.pieces[1]), 'the fixture has a split width');
  assert.throws(() => EV.even(s, { from: 0, to: 0, value: 16 }), refusedAs('EVEN_SPLIT'));
});

test('Even refuses by name on a closed lap when the run or its ramps reach the start line, and levels a run clear of it', () => {
  const R = 180, Q = (Math.PI * R) / 2;
  let d = extend(D.createDoc('lap'), { length: 600, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const c = close(d, { edited: [0] }); assert.equal(c.converged, true, c.report); const lap = c.doc; assert.equal(lap.closed, true);
  const last = lap.pieces.length - 1;
  assert.throws(() => EV.even(lap, { from: 0, to: 0, value: 16 }), refusedAs('EVEN_START_LINE'));
  assert.throws(() => EV.even(lap, { from: last, to: last, value: 16 }), refusedAs('EVEN_START_LINE'));
  assert.throws(() => EV.even(lap, { from: last, to: 1, value: 16 }), refusedAs('EVEN_START_LINE'), 'a run across the line (the shell\'s short way: from > to)');
  const r = EV.even(lap, { from: 2, to: 2, value: 16 });
  assert.equal(r.doc.closed, true);
  assert.equal(r.doc.pieces[0], lap.pieces[0], 'the lap\'s first piece is the same object');
});
