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
  // AMENDED (D678, the packet's "Amended 17:4x" item 1): outside the window every channel within one stored step, no longer bit for bit; Even cuts the knots over
  // the window's reaches and the cut spans' new points are stored at each channel's step (it read w, l, h and the bank, Object.is, before the ruling)
  assert.deepEqual(F.outsideChanges(r.doc, base, r.window.w0, r.window.w1).slice(0, 5), [], 'outside the window');
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
  // AMENDED (D678, the packet's "Amended 17:4x" item 1). Even now cuts the straight's last spans to 3.75 m before it levels, so they carry no slope into the run and
  // the level's own window is the 20 m margin and the 30 m ramp: 250, where it was 220. The reach back is still the window's on the track as given, where the shell
  // reads Even's refusals when a drag opens (a jump in it is refused). And outside the window: within one stored step, no longer bit for bit
  assert.equal(EV.evenWindow(d, { from: 1, to: 2 }).win.w0, 220, 'on the uncut track the window reaches back to the support of the straight\'s last span\'s first control point (260 at the value)');
  assert.equal(r.window.w0, 250, 'the level\'s window, on the cut track: the 20 m margin and the 30 m ramp');
  assert.equal(r.window.w1, 650, 'and after the run it is the 20 m margin and 30 m ramp');
  assert.deepEqual(F.outsideChanges(r.doc, d, r.window.w0, r.window.w1).slice(0, 5), [], 'outside the window');
});

// AMENDED BY NAME (L271; the hand-back p-l271-even-a0-A_2026-11-28.md 1.3, its WC1, and the keeper's call, L271): with A1 this road's ends do not support a
// reading, so the rim is held where it is now, B's line (measured 0.0043 m, so the bar is 0.01 m, was 0.1 m for A0's 0.077), and Even says it kept it.
test('where the road\'s own width changes across the window (a 31 m straight into a 12 m turn), the held rim is held where it is now (A1B), not read back from the window\'s ends', () => {
  // a plain Extend's 200 m straight keeps the empty track's 31 m; the turn's four pieces are laid at 12 m and the road narrows over the turn's first 60 m. Reading the
  // road back from the window's ends (31 m and 12 m) would put the held rim 6.7 m off (D678, found after the registration). Measured 0.077 m: the sideways offset is set
  // at its control points from the rim read on the road, and a 19 m narrowing in 60 m bends between them (a fit of the offset, as the height has, is not built)
  let d = extend(D.createDoc('narrows'), { length: 200 });
  for (const p of [...[1, 2, 3, 4].map(() => ({ length: 60, turn: 30 })), { length: 150, turn: 0 }]) d = require('../src/core/turnby.js').extendCorner(d, require('../app/core/panel.js').extendOptions({ length: p.length, turn: p.turn, climb: 0, bank: 0, width: 12, turnAs: 'corner' }));
  assert.ok(F.at(d, 'w', 150) > 30 && Math.abs(F.at(d, 'w', 500) - 12) < 1e-6, 'control: 31 m before the turn, 12 m after it');
  const r = EV.even(d, { from: 1, to: 4, value: 16, hold: 'left' }), S = F.stations(200, 440);
  const held = Math.max(...S.map((s) => Math.abs(F.rimAcross(r.doc, s, 'left') - F.rimAcross(d, s, 'left'))));
  assert.ok(held <= 0.01, `the held rim moved ${held} m`);
  assert.equal(r.reading, 'kept', 'no reading: the edge kept');
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

// AMENDED (D678, the packet's "Amended 17:4x" item 1): the bank within one stored step (1e-9 rad) every metre, the channel and as built, no longer the same values and
// bits. Even cuts the knots over the window's reaches, so the bank channel has new control points there, stored at its step (measured on B-: the channel 4.5e-10, the
// bank as built 6.3e-10)
test('K5: Even keeps the bank as found: the bank channel and the bank as built within one stored step every metre', () => {
  const base = F.fixture('B-'), run = F.runPieces(base), r = EV.even(base, { ...run, value: 16, hold: 'left' }), step = F.stepOf('phi') * (1 + 1e-9);
  for (const s of F.stations(0, F.endOf(base))) {
    assert.ok(Math.abs(F.at(r.doc, 'phi', s) - F.at(base, 'phi', s)) <= step, `the bank channel at ${s}`);
    assert.ok(Math.abs(F.builtBank(r.doc, s) - F.builtBank(base, s)) <= step, `the built bank at ${s}`);
  }
});

// ── THE WINDOW'S ENDS (D678, the packet's "Amended 17:4x" item 1; the rows X1 to X8 of lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, section 5.1).
// Even cuts the knots over the window's two reaches to spans of at most 3.75 m before it levels (even.js EVEN_END_SPAN_M), so no control point a margin or the
// height's fit needs is left as it was because its support reached past the window. Before it, the flat turn's exit margin read 13.28 m for a value of 16 (R1) and
// the centre's height stood 0.05 m off its target after a grab near the window's end (R2).
const inMargins = (s) => (s >= F.WIN.lo && s <= F.RUN.lo) || (s >= F.RUN.hi && s <= F.WIN.hi);
for (const fx of ['flat', 'B-']) for (const hold of ['left', 'right']) {
  test(`X1, X4, X8: on ${fx}, the ${hold} edge kept, the width is within 0.01 m of the value over both 20 m margins, nothing outside moves past one stored step and no joint steps`, () => {
    const base = F.fixture(fx), r = EV.even(base, { ...F.runPieces(base), value: 16, hold });
    const worst = Math.max(...F.stations(F.WIN.lo, F.WIN.hi).filter(inMargins).map((s) => Math.abs(F.at(r.doc, 'w', s) - 16)));
    assert.ok(worst <= 0.01, `X1: the width is ${worst} m off 16 in the margins`);
    assert.deepEqual([r.window.w0, r.window.w1], [F.WIN.w0, F.WIN.w1], 'the window is the registration\'s');
    assert.deepEqual(F.outsideChanges(r.doc, base).slice(0, 5), [], 'X4: outside the window');
    assert.deepEqual(F.jointBreaks(r.doc), [], 'X8: no joint steps');
  });
}
// X2 on B- only. On the flat fixture the lead at s 180 is still in its taper from the empty track's 31 m head, and Even as built (A0) lays the kept edge on the 12 m
// road it reads from the window's far end, about 0.25 m from the edge there (section 5.1, X2f): that is the reading, not the knots, and it is item 3's question.
for (const hold of ['left', 'right']) {
  test(`X2: on B-, the ${hold} edge kept, the kept edge is within 0.01 m of where it was over both margins`, () => {
    const base = F.fixture('B-'), r = EV.even(base, { ...F.runPieces(base), value: 16, hold });
    const worst = Math.max(...F.stations(F.WIN.lo, F.WIN.hi).filter(inMargins).map((s) => Math.abs(F.rimAcross(r.doc, s, hold) - F.rimAcross(base, s, hold))));
    assert.ok(worst <= 0.01, `the kept edge moved ${worst} m in the margins`);
  });
}
// L271: these rows measure the height, the outside and the joints, not the reading. After a grab at 470 the window's far end (490) sits on the grab, so A1 does
// not read the road there and keeps the edge where it is (A1B); after 485, and 175 with 465, it reads the road.
for (const grabs of [[470], [485], [175, 465]]) {
  test(`X3, X4, X8: on B- after a grab at ${grabs.join(' and ')}, K3: the centre's height is within 0.01 m of its target over the window, nothing outside moves past one stored step and no joint steps`, async () => {
    const sh = await F.shellOn(F.fixture('B-')); for (const s of grabs) F.grab(sh, s, 16);
    const st = F.present(sh), r = EV.even(st, { ...F.runPieces(st), value: 16, hold: 'left' }), c = F.centreOff(r.doc, st);
    assert.ok(c.off <= 0.01, `X3 (K3): ${c.off} m at ${c.at}`);
    assert.deepEqual(F.outsideChanges(r.doc, st).slice(0, 5), [], 'X4: outside the window');
    assert.deepEqual(F.jointBreaks(r.doc), [], 'X8: no joint steps');
  });
}

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

// B4 (D678, the 23:26Z order's item 2; lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, 5.4): Even's result is frozen all the way down, as every
// document the core returns is. The segment caches (sculpt.js pieceOffsets, Even's rim reader) are used only on a document whose pieces are all frozen; with its
// changed pieces left unfrozen, every offset read on a 27.6 km lap converted the whole lap again (an Even drag step 5.2 s there, 5.4)
const frozenDown = (o, at = 'doc') => { if (!o || typeof o !== 'object') return null; if (!Object.isFrozen(o)) return at; for (const k of Object.keys(o)) { const w = frozenDown(o[k], `${at}.${k}`); if (w) return w; } return null; };
for (const hold of ['left', 'right', 'centre']) {
  test(`B4: Even's result, the ${hold} kept, is frozen all the way down: the document, every piece, its channels and their control points`, async () => {
    const sh = await F.startOf(F.fixture('B-'), 'T1'), st = F.present(sh), r = EV.even(st, { ...F.runPieces(st), value: 16, hold });
    assert.ok(r.changed.length > 0, 'control: Even changed pieces');
    assert.equal(frozenDown(r.doc), null, `not frozen: ${frozenDown(r.doc)}`);
  });
}

// C1 (L271 item 2 (b); lighthouse exo_memory/loop/packet_t180_even_a0_and_slope_grab_on_L_2026-11-28.md, its "item 5"): a drag re-runs Even on the SAME base at every
// step; the window's reaches are cut once per drag, not once per step, so the cut pieces (and the road read from the window's ends, and its bank plan) stay one
// set of objects and the segment caches hold them. Two calls on one base with different values reuse the same cut track and the same reference road; the results
// are the same bytes as with nothing memoised (C2, the fixture rows).
test('C1: two Even calls on one base reuse one cut track and one reference road (the reaches cut once per drag)', () => {
  const base = F.fixture('flat'), run = F.runPieces(base), I = EV._internal;
  assert.equal(typeof I.cutOf, 'function', 'the cut track is memoised (cutOf)');
  const a = I.cutOf(base, run), b = I.cutOf(base, run);
  assert.equal(a.doc, b.doc, 'the same cut track');
  const r1 = EV.even(base, { ...run, value: 16, hold: 'left' }), r2 = EV.even(base, { ...run, value: 17, hold: 'left' });
  assert.equal(I.cutOf(base, run).doc, a.doc, 'still the same after two levels');
  assert.notEqual(I.cutOf(base, { from: run.from, to: run.from }).doc, a.doc, 'another run of the same base is cut afresh');
  assert.notEqual(r1.doc, r2.doc);
});
test('C2: Even with its cut and reference memoised gives the same bytes as Even run on a fresh copy of the base (no memo hit)', () => {
  for (const fx of ['flat', 'B-']) for (const hold of ['left', 'right', 'centre']) {
    const base = F.fixture(fx), run = F.runPieces(base), copy = JSON.parse(JSON.stringify(base));
    const a = EV.even(base, { ...run, value: 16, hold }), a2 = EV.even(base, { ...run, value: 16, hold }), b = EV.even(D.checkDoc(copy), { ...run, value: 16, hold });
    assert.equal(JSON.stringify(a.doc), JSON.stringify(b.doc), `${fx} ${hold}: memoised against fresh`);
    assert.equal(JSON.stringify(a2.doc), JSON.stringify(b.doc), `${fx} ${hold}: a second call on the same base`);
  }
});

// ── L271 (lighthouse exo_memory/loop/packet_t180_even_a0_and_slope_grab_on_L_2026-11-28.md, "Amended 02:5x"; the hand-back p-l271-even-a0-A_2026-11-28.md 1.1 to
// 1.3): A1, the road under the stretch read from the window's ends ONLY where they support it; where they do not, the edge kept where it is now, B's line
// (A1B, the keeper's call, L271; A1R, a refusal, is not built); how far the kept edge moved (keptMove); the banked claim ("under the bank as Even finds it"). The figures are the hand-back's table (a1_271.out, a1_built.out).
const edgeMove = (after, before, hold, a, b) => Math.max(...F.stations(Math.ceil(a), Math.floor(b)).map((s) => Math.abs(F.rimAcross(after, s, hold) - F.rimAcross(before, s, hold))));
const runEnd = (doc, p) => SC.pieceOffsets(doc)[p] + doc.pieces[p].length;
// WC3 of the table: a road whose own width steps 12 -> 18 m inside the turn, with no grab; its window's near end is still in the lead's taper from the empty
// track's 31 m head (14.97 m at s 150, the hand-back's why271.out), its far end at rest at 18 m, and the near end does not head toward it
const wc3 = () => { let d = D.createDoc('wc3'); for (const p of [[200, 0, 12], [60, 30, 12], [60, 30, 12], [60, 30, 18], [60, 30, 18], [150, 0, 18]]) d = require('../src/core/turnby.js').extendCorner(d, require('../app/core/panel.js').extendOptions({ length: p[0], turn: p[1], climb: 0, bank: 0, width: p[2], turnAs: 'corner' })); return Object.freeze(d); };

test('A1-1: no stretch is refused for the road under it (A1R is not built): from the track\'s start, a width stepping inside the run, and a window end on a grab, the edge is kept and Even says so', async () => {
  const sh = await F.shellOn(F.fixture('B-')); F.grab(sh, 470, 16); const g = F.present(sh);
  for (const [id, d, run] of [['start', F.fixture('flat'), { from: 0, to: 1 }], ['WC3', wc3(), { from: 1, to: 4 }], ['B- a grab at 470', g, F.runPieces(g)]]) {
    for (const hold of ['left', 'right']) {
      const r = EV.even(d, { ...run, value: 16, hold });
      assert.equal(r.reading, 'kept', `${id} ${hold}`); assert.ok(typeof r.why === 'string' && r.why.length > 0, `${id} ${hold}: the reason`);
    }
  }
});

test('A1-3: a run from the track\'s start (A0: 9.31 m off, silently): Even says it kept the edge, and the edge is where it was within 0.01 m over the run', () => {
  const base = F.fixture('flat');
  for (const hold of ['left', 'right']) {
    const r = EV.even(base, { from: 0, to: 1, value: 16, hold });
    assert.equal(r.reading, 'kept', hold);
    const m = edgeMove(r.doc, base, hold, 0, runEnd(base, 1));
    assert.ok(m <= 0.01, `${hold}: the kept edge moved ${m} m over the run`);
  }
});

test('A1-4: a road whose own width steps inside the run (WC3, no grab): the edge stays within 0.01 m (A0: 2.92 m off, silently)', () => {
  const d = wc3(), run = { from: 1, to: 4 };
  assert.ok(Math.abs(F.at(d, 'w', 290) - 12) < 1e-6 && Math.abs(F.at(d, 'w', 500) - 18) < 1e-6, `control: 12 m in the run's first half, 18 m after it (${F.at(d, 'w', 290)}, ${F.at(d, 'w', 500)})`);
  for (const hold of ['left', 'right']) {
    const r = EV.even(d, { ...run, value: 16, hold }), m = edgeMove(r.doc, d, hold, SC.pieceOffsets(d)[1], runEnd(d, 4));
    assert.ok(m <= 0.01, `${hold}: ${m} m`);
  }
});

test('A1-5: where the ends support a reading (flat, after one grab, T1), Even reads the road: the kept edge goes back to the untouched road within 0.01 m, and its own figure for the move is the move measured', async () => {
  const base = F.fixture('flat'), start = F.present(await F.startOf(base, 'T1')), run = F.runPieces(start);
  for (const hold of ['left', 'right']) {
    const r = EV.even(start, { ...run, value: 16, hold });
    assert.equal(r.reading, 'road', hold);
    const back = edgeMove(r.doc, base, hold, F.RUN.lo, F.RUN.hi);
    assert.ok(back <= 0.01, `${hold}: ${back} m from the untouched road`);
    const k = r.keptMove(), moved = edgeMove(r.doc, start, hold, F.WIN.w0, F.WIN.w1);
    assert.ok(Math.abs(k.m - moved) <= 0.01, `${hold}: Even says ${k.m} m, measured ${moved} m`);
  }
});

test('A1-6: a grab centred 5 m outside the window\'s start (B-, at 145) fools a 10 m test but not A1\'s 10, 20 and 30 m: that end reads as moving; the track\'s start reads as an edge', async () => {
  const sh = await F.shellOn(F.fixture('B-')); F.grab(sh, 145, 16);
  const d = F.present(sh), off = SC.pieceOffsets(d), L = runEnd(d, d.pieces.length - 1), I = EV._internal, x0 = EV.evenWindow(d, F.runPieces(d)).win.w0;
  assert.ok(Math.abs(F.at(d, 'w', x0) - F.at(d, 'w', x0 - 10)) <= 1e-3, `control: the width 10 m beyond the end equals the end's (${F.at(d, 'w', x0)}, ${F.at(d, 'w', x0 - 10)})`);
  assert.equal(I.endState(d, off, 'w', x0, -1, L).kind, 'moving');
  assert.equal(I.endState(d, off, 'w', 0, -1, L).kind, 'edge', 'the track\'s start has no road before it');
});

for (const id of ['T1', 'T2b']) {
  test(`A1-7: B- ${id}: the road is read "under the bank as Even finds it": Even says the stretch is banked, and the kept edge is within 0.01 m of that road (L271 point 4)`, async () => {
    const start = F.present(await F.startOf(F.fixture('B-'), id)), run = F.runPieces(start), I = EV._internal;
    const C = I.cutOf(start, run), rd = I.readSupported(C.doc, C.W.off, C.W.win, C.W.L), ref = I.levelTo(C.doc, { w: rd.w, l: rd.l }, C.W.win);
    for (const hold of ['left', 'right']) {
      const r = EV.even(start, { ...run, value: 16, hold });
      assert.equal(r.reading, 'road'); assert.equal(r.banked, true);
      const m = edgeMove(r.doc, ref, hold, F.RUN.lo, F.RUN.hi);
      assert.ok(m <= 0.01, `${hold}: ${m} m from the road read under the bank`);
    }
  });
}
test('A1-7: an unbanked stretch is not said to be banked', () => {
  const base = F.fixture('flat'); assert.equal(EV.even(base, { ...F.runPieces(base), value: 16, hold: 'left' }).banked, false);
});

test("A1-8: the middle kept ('centre') reads nothing: a run from the track's start is levelled, with no kept edge to measure", () => {
  const base = F.fixture('flat'), r = EV.even(base, { from: 0, to: 1, value: 16, hold: 'centre' });
  assert.equal(r.reading, 'centre'); assert.equal(r.keptMove, null);
});
