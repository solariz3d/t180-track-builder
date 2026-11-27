// core-width-hold.test.js: node --test app/test/core-width-hold.test.js
// L264, THE WIDTH HOLDS AFTER A BRUSH (his choice, 2026-11-27, the first of two options: Extend holds the width, as the width field says, "left as shown, it keeps
// it"). A width brush at the head leaves the open end on the brush's falloff, still narrowing: 19.1 m brushed +1.37 at the head (s0 = end - 5, r 20) ends 20.463 m,
// -0.001005 m per m. Extend with the width left as shown CONTINUED that slope (src/core/extend.js: a channel with no target goes on as v + m*s, ref 09 §2), about
// 10 cm every 100 m, before L264. Now a width with no target, at a head where the width is still changing, is brought to rest at the head's own width within the
// piece's first knot span (at most 20 m), by the blend a typed width takes, and ends there level. The width only: the turn and climb keep going, and the bank, cup,
// edges and right width are as they were (measured, not changed).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');

const BLANK = { length: 100, turn: '', climb: '', bank: '', width: '', cup: '', edge: '', edgeR: '', widthR: '', start: '', tube: '' };
const ROADS = {
  plain: () => extend(extend(D.createDoc('hold'), { length: 120, first: { w: 19.1 }, targets: { kh: 0 } }), { length: 300, transition: 60, targets: { kh: 1 / 400, phi: 8 * Math.PI / 180 } }),
  cup: () => extend(extend(D.createDoc('hold'), { length: 120, first: { w: 19.1, c: 20 }, targets: { kh: 0 } }), { length: 300, transition: 60, targets: { kh: 1 / 400 } }),
  edge: () => extend(extend(D.createDoc('hold'), { length: 120, first: { w: 19.1, e: 10 }, targets: { kh: 0 } }), { length: 300, transition: 60, targets: { kh: 1 / 400 } }),
  split: () => extend(extend(extend(D.createDoc('hold'), { length: 120, first: { w: 19.1 }, targets: { kh: 0 } }), { length: 300, transition: 60, targets: { kh: 1 / 400 } }), { length: 100, targets: { wd: 3.5 } }),
};
/** A shell on `road`, brushed at the head as B's F3 case is: the rate brush, centred 5 m before the end, radius 20 m, so the open end sits on its falloff. */
async function brushedAtHead(channel = 'w', delta = 1.37, road = 'plain') {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.commitDoc(ROADS[road]());
  const L = s.getState().history.present.pieces.reduce((a, P) => a + P.length, 0);
  s.beginBrush({ mode: 'rate', channel, s0: L - 5, r: 20 }); s.brushTo(delta); s.endBrush();
  return s;
}
const lastOf = (s) => s.getState().history.present.pieces.slice(-1)[0];
const piecesOf = (s) => s.getState().history.present.pieces.length;
/** Extend through the panel's own options, every field left as shown unless `typed` gives one. */
const extendAsShown = (s, length = 100, typed = {}) => s.extend(extendOptions({ ...BLANK, length, ...typed, head: s.headState() }));

test('L264: after a width brush at the head, three Extends with the width left as shown each end at the head\'s width, level (19.1 brushed +1.37: 20.463 m)', async () => {
  const s = await brushedAtHead(), head = D.endState(s.getState().history.present).w;
  assert.ok(Math.abs(head.v - 20.463) < 1e-9 && head.m < -0.001, `the brush leaves the head still narrowing: ${head.v} m, ${head.m} m per m`);
  for (let i = 1; i <= 3; i++) {
    const n = piecesOf(s); extendAsShown(s);
    assert.equal(piecesOf(s), n + 1, `Extend ${i} laid: ${s.getState().message}`);
    assert.deepEqual(D.pieceEnd(lastOf(s)).w, { v: head.v, m: 0 }, `Extend ${i} ends at the head's width, level`);
  }
});

test('L264: the held width joins the brushed road with no kink (value and slope continuous), stays within 5 mm of the head\'s width and is on it from 40 m; 400 m and 10 m pieces too', async () => {
  for (const length of [100, 400, 10]) {
    const s = await brushedAtHead(), prev = lastOf(s), a = D.pieceEnd(prev).w;
    extendAsShown(s, length);
    const P = lastOf(s);
    assert.notEqual(P, prev, `${length} m laid: ${s.getState().message}`);
    assert.equal(D.jointProblem(D.pieceEnd(prev), P, D.kindOf(prev)), null, `${length} m: the document's own joint check`);
    const c = P.channels.w, h = P.knots.length ? P.knots[0] : P.length, startSlope = (3 * (c[1] - c[0])) / h;
    assert.equal(c[0], a.v, `${length} m: the width at the joint`);
    // AMENDED, L268, pane B: the slope at the joint is stored in the second control point, rounded to the width's 4 decimals (D.DEC.w), so it is the head's to within
    // half that quantum over a third of the first span: 1.5e-4 / h. The fixed 2e-5 held for the old first spans (20 m and 10 m) only. Laid as a short ramp (L268)
    // the hold's first span is a quarter of its ramp, 2.5 m on a 10 m piece, where the two nearest storable slopes are -0.00096 and -0.00108 against -0.001005: no
    // stored piece meets 2e-5 there. The bound below is that rounding exactly: tighter than 2e-5 on a 20 m span (7.5e-6), and the document's own joint check allows 6e-4
    assert.ok(Math.abs(startSlope - a.m) <= (1.5 * 10 ** -D.DEC.w) / h + 1e-12, `${length} m: the width's slope at the joint, ${startSlope} against the brushed road's ${a.m}, more than its storage rounding (${((1.5 * 10 ** -D.DEC.w) / h).toExponential(2)}) apart`);
    for (let k = 0; k <= 400; k++) {
      const x = (P.length * k) / 400, v = D.channelValue(P, 'w', x);
      assert.ok(Math.abs(v - a.v) <= 0.005, `${length} m: at ${x} m the width is ${v}, more than 5 mm off the head's ${a.v}`);
      if (x >= 40) assert.ok(Math.abs(v - a.v) <= 5e-4, `${length} m: at ${x} m the width is ${v}, not yet back at the head's ${a.v}`);
    }
    assert.deepEqual(D.pieceEnd(P).w, { v: a.v, m: 0 }, `${length} m: ends at the head's width, level`);
  }
});

test('L264: a width TYPED after a brush still goes where it is typed (22, and 20.46 as the field shows it)', async () => {
  for (const typed of ['22', '20.46']) {
    const s = await brushedAtHead(); extendAsShown(s, 100, { width: typed });
    const e = D.pieceEnd(lastOf(s)).w;
    assert.ok(Math.abs(e.v - Number(typed)) < 1e-4 && Math.abs(e.m) < 1e-6, `typed ${typed}: ends ${e.v}, slope ${e.m}`);
  }
});

test('L264: a level head is not touched: Extend with the width left as shown lays every width control point at the head\'s width, as before', async () => {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.commitDoc(ROADS.plain());
  const head = D.endState(s.getState().history.present).w; assert.equal(head.m, 0, 'a level head');
  extendAsShown(s);
  assert.ok(lastOf(s).channels.w.every((x) => x === head.v), `every control point ${head.v}: ${lastOf(s).channels.w}`);
});

test('L264: only the width is held: the turn and the climb, and the bank, cup, edges and right width, brushed at the head, go on at the head\'s rate as before', async () => {
  for (const [ch, delta, road] of [['kh', 0.0005, 'plain'], ['kv', 0.0005, 'plain'], ['phi', 0.1, 'plain'], ['c', 10, 'cup'], ['e', 10, 'edge'], ['er', 10, 'edge'], ['wd', 1, 'split']]) {
    const s = await brushedAtHead(ch, delta, road), head = D.endState(s.getState().history.present)[ch];
    assert.ok(head.m !== 0, `${ch}: the brush leaves a slope at the head (${head.m})`);
    extendAsShown(s);
    const e = D.pieceEnd(lastOf(s))[ch];
    const q = 10 ** -D.DEC[ch], cont = head.v + head.m * 100;   // to 2 % of what the slope moves it, and the channel's own stored decimals
    assert.ok(Math.abs(e.v - cont) <= 0.02 * Math.abs(head.m) * 100 + 2 * q && Math.abs(e.m - head.m) <= 0.02 * Math.abs(head.m) + (6 * q) / 20, `${ch}: goes on from ${head.v} at ${head.m} per m to ${cont}; ends ${e.v} at ${e.m}`);
  }
});

// L268 (E's read of L264, handback/p-l264-read-E_2026-11-27.md §2 and §3): FITTED by least squares the hold rang. After a steep head the width swung about 3.7 × the
// head's slope past the head's and was over 1 mm off until 88 to 96 m of a 100 m piece. The hold is now laid as a typed width's short ramp is (extend.js rampControl).
// The heads of E's table, built as E built them: the app's brush (createCoreShell's default brushFn), Sculpt's grab (beginFollow), and a width ramp given to the core
// as one number transition, which the fit ends off level (drag-ghost row 5's head).
const sumOf = (s) => s.getState().history.present.pieces.reduce((a, P) => a + P.length, 0);
async function appShell() { const s = await createCoreShell({ autosaveMs: 0 }); s.commitDoc(ROADS.plain()); return s; }
const brushAt = (d, r, delta) => async () => { const s = await appShell(); s.beginBrush({ mode: 'rate', channel: 'w', s0: sumOf(s) - d, r }); s.brushTo(delta); s.endBrush(); return s; };
const grabAt = (d, r, dw) => async () => { const s = await appShell(); s.setSculpt(true); s.beginFollow({ s0: sumOf(s) - d, r }); s.brushTo({ w: dw }); s.endBrush(); return s; };
async function numberTransition() {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.extend({ length: 300 });
  s.extend({ length: 1000, targets: { kh: 1 / 700, kv: 0.0004, phi: 0.2, w: 40, c: 20 } }); s.extend({ length: 75, transition: 30, targets: { w: 25 } });
  return s;
}
const E_HEADS = [
  ['the brush, +1.37 at end-5, r 20', brushAt(5, 20, 1.37)], ['the brush, +1.37 at end-10, r 20', brushAt(10, 20, 1.37)],
  ['the brush, +5 at end-19, r 20', brushAt(19, 20, 5)], ['the brush, +5 at end-30, r 40', brushAt(30, 40, 5)],
  ['grab, w +1.37 at end-5, r 20', grabAt(5, 20, 1.37)], ['grab, w +2 at end-10, r 20', grabAt(10, 20, 2)], ['grab, w -2 at end-20, r 30', grabAt(20, 30, -2)],
  ['a width ramp ended off level by a number transition', numberTransition],
];
/** One Extend of 100 m as shown from the head `make` leaves: the head, the new piece, and E's measure (the largest w − head, and the last station, every 0.1 m,
 *  where |w − head| is over 1 mm). */
async function heldAfter(make) {
  const s = await make(), prev = lastOf(s), head = D.pieceEnd(prev).w;
  extendAsShown(s); const P = lastOf(s);
  let swing = 0, off = 0; for (let k = 0; k <= 1000; k++) { const x = (P.length * k) / 1000, dv = D.channelValue(P, 'w', x) - head.v; if (Math.abs(dv) > Math.abs(swing)) swing = dv; if (Math.abs(dv) > 1e-3) off = x; }
  return { prev, head, P, swing, off };
}

test('L268: after every head of E\'s table the held width is within 1 mm of the head\'s from the end of its ramp (the first knot span, 20 m) on', async () => {
  for (const [name, make] of E_HEADS) {
    const { head, off } = await heldAfter(make);
    assert.ok(off <= 20, `${name} (head slope ${head.m.toExponential(2)} per m): the held width is more than 1 mm off the head's until ${off} m, past the ramp's end at 20 m`);
  }
});

test('L268: after every head of E\'s table the hold keeps a smooth joint, ends exactly at the head\'s width, level, and still goes past it the way the head was heading', async () => {
  for (const [name, make] of E_HEADS) {
    const { prev, head, P, swing } = await heldAfter(make);
    assert.equal(D.jointProblem(D.pieceEnd(prev), P, D.kindOf(prev)), null, `${name}: the joint is smooth`);
    assert.deepEqual(D.pieceEnd(P).w, { v: head.v, m: 0 }, `${name}: the piece ends at the head's width, level`);
    assert.ok(swing !== 0 && Math.sign(swing) === Math.sign(head.m), `${name}: the width goes past the head's the way it was heading (${swing} m, head slope ${head.m})`);
  }
});

test('L268: a held width beside a typed bank, cup or edge on a short piece keeps the knots the bank piece has, so the ramp lays within a few tenths of its quintic', () => {
  const DEG = Math.PI / 180, smoother = (u) => (u >= 1 ? 1 : u * u * u * (10 + u * (-15 + 6 * u)));
  const headDoc = () => extend(extend(D.createDoc('hold'), { length: 120, first: { w: 19.1 } }), { length: 60, transition: 30, targets: { w: 25 } });   // its width ends off level
  for (const L of [30, 40, 60]) for (const [ch, target, most] of [['phi', 20 * DEG, 0.5 * DEG], ['c', 25, 0.25], ['e', 15, 0.35]]) {
    const d0 = headDoc(), from = D.endState(d0); assert.ok(Math.abs(from.w.m) > 0.01, 'the head is still widening, so the width is held');
    const P = extend(d0, { length: L, targets: { [ch]: target } }).pieces.slice(-1)[0];
    let worst = 0; for (let k = 0; k <= 200; k++) { const s = (L * k) / 200; worst = Math.max(worst, Math.abs(D.channelValue(P, ch, s) - (from[ch].v + (target - from[ch].v) * smoother(s / L)))); }
    assert.ok(worst <= most, `${ch} to ${ch === 'phi' ? '20°' : target} over ${L} m beside a held width: ${worst.toFixed(4)} from its quintic, over ${most.toFixed(4)}`);
  }
});

// D678 (E's read of L268, handback/p-d678-ripple-read-E_2026-11-27.md §5 F4; the librarian's ruling: the path a Turn or a Sharp lays must not depend on whether the
// width was still changing at the head). The hold's extra knots were the whole piece's, and Turn by's ease, the corner list's and Sharp's turn ramp were laid on them:
// after a width brush, Turn by -90 over 200 ended 31.7 cm from where it ends from a level head, a corner of 30 with an extra 20 from 50 1.9 cm, Sharp -60 R40 ramp 8
// 13.9 cm. The path's measure: the new pieces' count and lengths, the turn and climb every 0.05 m to one step of their stored decimals (1e-9 rad per m), and the
// end point (the adapter's path, its last sample) to one step of a length (1e-4 m). The head is E's E4, the app's brush +5 at 30 m before the end, r 40.
const A = require('../../src/core/adapter.js');
const endPoint = (d) => A.toPath(d, { step: 0.25 }).path.samples.at(-1).pos;
async function pathFrom(call) {
  const out = [];
  for (const make of [appShell, brushAt(30, 40, 5)]) {
    const s = await make(), n = piecesOf(s), head = D.endState(s.getState().history.present).w; call(s);
    const d = s.getState().history.present; out.push({ head, n, pieces: d.pieces.slice(n), end: endPoint(d), message: s.getState().message });
  }
  return out;
}
function samePath([level, held], what) {
  assert.ok(level.head.m === 0 && held.head.m !== 0, `${what}: the level head is level and the brushed one is still changing (${held.head.m})`);
  assert.ok(held.pieces.length > 0 && held.pieces.length === level.pieces.length, `${what}: laid the same number of pieces (${level.pieces.length}, ${held.pieces.length}: ${held.message})`);
  held.pieces.forEach((P, i) => {
    const Q = level.pieces[i];
    assert.equal(P.length, Q.length, `${what}, piece ${i + 1}: the same length`);
    for (const ch of ['kh', 'kv']) { let worst = 0; for (let x = 0; x <= P.length; x += 0.05) worst = Math.max(worst, Math.abs(D.channelValue(P, ch, x) - D.channelValue(Q, ch, x))); assert.ok(worst <= 1e-9, `${what}, piece ${i + 1}: ${ch} is ${worst.toExponential(2)} from the level head's, over one step`); }
  });
  const apart = Math.hypot(...held.end.map((v, k) => v - level.end[k]));
  assert.ok(apart <= 1e-4, `${what}: ends ${apart.toFixed(4)} m from where it ends from a level head`);
}
const asShownOpts = (s, length = 100) => extendOptions({ ...BLANK, length, head: s.headState() });

test('D678: after a width brush, Turn by -90 over 200 lays the same path as from a level head (the hold does not move the turn)', async () => {
  samePath(await pathFrom((s) => s.extendTurnBy(asShownOpts(s, 200), -90)), 'Turn by -90 over 200');
});

// the extra from 10 m starts inside the hold's first 20 m: laying the hold before the corner list's knots went in moved that path 6.7 cm (pane B's scratch
// d9check678.js, the width-hold harness's D9); an extra from 50 m does not reach the hold and could not see it
test('D678: after a width brush, a corner of 30 with an extra 20 from 50, or from 10 (inside the hold), lays the same path as from a level head', async () => {
  for (const from of [50, 10]) samePath(await pathFrom((s) => s.extend({ ...asShownOpts(s), turnDeg: 30, changes: { turnDeg: [{ from, deg: 20 }] } })), `the corner list, its extra from ${from} m`);
});

test('D678: after a width brush, Sharp -60 R40 ramp 8 lays the same path as from a level head', async () => {
  samePath(await pathFrom((s) => s.extendSharp(asShownOpts(s), { deg: -60, R: 40, ramp: 8 })), 'Sharp -60 R40 ramp 8');
});

test('D678: after a width brush, Turn by and the corner list still hold the width: within 1 mm of the head\'s from 20 m on, ending there level, the joint smooth', async () => {
  for (const [what, call] of [['Turn by 45', (s) => s.extendTurnBy(asShownOpts(s), 45)], ['the corner list', (s) => s.extend({ ...asShownOpts(s), turnDeg: 30, changes: { turnDeg: [{ from: 50, deg: 20 }] } })]]) {
    const s = await brushAt(30, 40, 5)(), prev = lastOf(s), head = D.pieceEnd(prev).w; call(s); const P = lastOf(s);
    assert.notEqual(P, prev, `${what} laid: ${s.getState().message}`);
    let off = 0; for (let k = 0; k <= 1000; k++) { const x = (P.length * k) / 1000; if (Math.abs(D.channelValue(P, 'w', x) - head.v) > 1e-3) off = x; }
    assert.ok(off <= 20, `${what}: the width is more than 1 mm off the head's until ${off} m`);
    assert.deepEqual(D.pieceEnd(P).w, { v: head.v, m: 0 }, `${what}: ends at the head's width, level`);
    assert.equal(D.jointProblem(D.pieceEnd(prev), P, D.kindOf(prev)), null, `${what}: the joint is smooth`);
  }
});

// D678 (pane B), the held pair: the hold leaves the head at the head's own width slope, as near as a stored width allows. A width is stored to one step (1e-4 m), so
// its second control point can be half a step off, and the slope it leaves with half a step over a third of the first knot span (1.5e-4 / the first knot, per m).
// Set from the head on the piece's first knot it is within that; carried there by the knot insertion it is rounded twice and was not: after the grab below, Sharp
// ramp 1 (its first knot 0.74 m) left 3.2e-4 per m off the head's slope, where the bound is 2.0e-4 (pane B's scratch resetstep678.js).
test('D678: after a steep grab or a brush, Sharp ramp 1 leaves the head at the head\'s width slope, within half a stored step of width over a third of its first knot span', async () => {
  for (const [what, make] of [['the grab, w +4 at the end, r 5', grabAt(0, 5, 4)], ['the brush, +1.37 at end-5, r 20', brushAt(5, 20, 1.37)]]) {
    const s = await make(), prev = lastOf(s), n = piecesOf(s), head = D.pieceEnd(prev).w; s.extendSharp(asShownOpts(s), { deg: -60, R: 40, ramp: 1 });
    const P = s.getState().history.present.pieces[n];   // Sharp lays its held piece first (and an exit after it)
    assert.ok(P && P.knots.length > 0, `${what}: Sharp laid: ${s.getState().message}`);
    assert.ok(head.m !== 0, `${what}: the head's width is still changing`);
    const h = 1e-6, leaving = (D.channelValue(P, 'w', h) - D.channelValue(P, 'w', 0)) / h, bound = 1.5e-4 / P.knots[0];
    assert.ok(Math.abs(leaving - head.m) <= bound + 1e-6, `${what}: leaves at ${leaving.toExponential(4)} per m, ${Math.abs(leaving - head.m).toExponential(2)} off the head's ${head.m.toExponential(4)}, over the bound ${bound.toExponential(2)}`);
  }
});
