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
    assert.ok(Math.abs(startSlope - a.m) < 2e-5, `${length} m: the width's slope at the joint, ${startSlope} against the brushed road's ${a.m}`);
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
