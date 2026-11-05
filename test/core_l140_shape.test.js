// core_l140_shape.test.js: node --test test/core_l140_shape.test.js. L140 Part 1, "the shape" (the keeper drove L139 on 2026-11-05 and called it "broken … glitchy and non
// intuitive", lighthouse exo_memory/briefs/t180_second_bank.md 10:06Z; the plan exo_memory/loop/plan_l140_second_change_feels_right_2026-11-05.md, Part 1). His save
// (eq-TEST BANKING, read on 35feaf9): on a 1,000 m piece the bank climbed 0 → 80° across the whole first 500 m and never held, and every change started at the even split.
// What he means (his picture): the bank comes in, HOLDS through the turn, and comes back at the marks, near the end. So:
//   1. a field with later changes reaches its first value over its own smooth minimum (secondMinM; cornerChangeMinM for a corner) and HOLDS it to its mark;
//   2. a mark left blank sits toward the END: the last change at L − its minimum, each earlier one before the next by its own minimum;
//   3. the end is the typed target.
// Replayed the way he lays it: app/core/panel.js extendOptions, then extendCorner; 9′ (pane E's registration) read on the BUILT road.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const X = require('../src/core/extend.js');
const { extend } = X;
const A = require('../src/core/adapter.js');
const TB = require('../src/core/turnby.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180, BAR = 29.4 / (10 * 170 * 170);
const flat = () => extend(D.createDoc('l140'), { length: 1000, family: 'bowl' });
const down2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
const cornerMin = (deg) => TB.cornerChangeMinM(flat(), {}, deg);
const fields = (f) => ({ length: '1000', turn: '', climb: '', bank: '', width: '', cup: '', edge: '', start: '', tube: '', atStart: {}, turnAs: 'corner', ...f, secondMinM: X.secondMinM, cornerChangeMinM: cornerMin });
/** His save's shape, typed: a 1,000 m piece, a −60° corner then −56.84° (his save turns −116.84° in two same-way corners), bank 80° then back to level, marks left blank. */
const HIS = { turn: '-60', bank: '80', changes: { turn: [{ then: '-56.84', from: '' }], bank: [{ then: '0', from: '' }] } };
const lay = (f) => { const o = extendOptions(fields(f)); return { o, d: TB.extendCorner(flat(), o) }; };
const at = (d, ch, s) => D.channelAt(d.pieces[1], ch, s).v;
/** The built road's roll acceleration (2 m second differences of the adapter's roll, joints() b) and heading rate of change, peak over [a, b] on the track, ÷ the bar. */
function builtPeaks(d, a, b) {
  const S = A.toPath(d).path.samples, idx = (s) => { let lo = 0, hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; } return lo; };
  let prev = null, off = 0; const H = S.map((x) => { let v = Math.atan2(x.T[2], x.T[0]); if (prev !== null) { while (v + off - prev > Math.PI) off -= 2 * Math.PI; while (v + off - prev < -Math.PI) off += 2 * Math.PI; } v += off; prev = v; return v; });
  const roll = (s) => S[idx(s)].roll, head = (s) => { const i = idx(s), j = Math.min(S.length - 1, i + 1), f = S[j].s > S[i].s ? (s - S[i].s) / (S[j].s - S[i].s) : 0; return H[i] + f * (H[j] - H[i]); };
  let r = 0, h = 0; for (let s = a; s <= b; s += 0.5) { r = Math.max(r, Math.abs(roll(s + 2) - 2 * roll(s) + roll(s - 2)) / 4); h = Math.max(h, Math.abs(head(s + 1) - 2 * head(s) + head(s - 1))); }
  return { roll: r / BAR, heading: h / BAR };
}

test('L140 1: his shape through the panel, the first bank reaches 80° over its own smooth minimum and HOLDS within 0.5° from there to its mark', () => {
  const { o, d } = lay(HIS), F = o.changes.phi[0].from, R = X.secondMinM('phi', 0, 80 * DEG);
  assert.ok(F > R, `the mark ${F} is after the first ramp's ${R.toFixed(1)} m`);
  let worst = 0; for (let s = R; s <= F; s += 1) worst = Math.max(worst, Math.abs(at(d, 'phi', s) / DEG - 80));
  assert.ok(worst <= 0.5, `the bank leaves 80° by ${worst.toFixed(3)}° between its ramp's end (${R.toFixed(1)} m) and its mark (${F} m)`);
});
test('L140 2: his shape through the panel, a blank mark sits at the END: the bank\'s at L − its minimum, the later corner\'s at L − that corner\'s minimum', () => {
  const { o } = lay(HIS);
  assert.equal(o.changes.phi[0].from, down2(1000 - X.secondMinM('phi', 80 * DEG, 0)), 'the bank\'s mark');
  assert.equal(o.changes.turnDeg[0].from, down2(1000 - cornerMin(-56.84)), 'the later corner\'s mark');
});
test('L140 3: the end is the typed target: his bank typed back to 0 ends at 0 (value and slope), and the turn ends straight', () => {
  const { d } = lay(HIS), P = d.pieces[1], e = D.channelAt(P, 'phi', P.length), k = D.channelAt(P, 'kh', P.length);
  assert.ok(Math.abs(e.v) <= 1e-9 && Math.abs(e.d1) <= 1e-9, `the bank ends at ${e.v / DEG}°, slope ${e.d1}`);
  assert.ok(Math.abs(k.v) <= 1e-9 && Math.abs(k.d1) <= 1e-9, `the turn ends at ${k.v}, slope ${k.d1}`);
});
test('L140 4: a first CORNER with a later one turns over its own smooth minimum and runs STRAIGHT to the next mark (no turn left in the hold)', () => {
  const { o, d } = lay(HIS), F = o.changes.turnDeg[0].from, R = cornerMin(-60);
  assert.ok(F > R + 20, `the mark ${F} leaves room after the first corner's ${R.toFixed(1)} m`);
  // read outside the cubic spline's reach of either corner (2 knot spans, D.KNOT_M each): a control point's support runs 4 spans, so a corner's rate fades over ~36 m past
  // its end (8.1e-5 /m at its end, 0 by 36 m after) and the next one's starts ~1 span before its mark
  const reach = 2 * D.KNOT_M; let worst = 0; for (let s = R + reach; s <= F - reach; s += 1) worst = Math.max(worst, Math.abs(at(d, 'kh', s)));
  assert.ok(worst <= 1e-5, `the road still turns at ${worst} /m between the first corner (${R.toFixed(1)} m) and the next mark (${F} m)`);
  // and the corner is exact: −60° by the mark, −116.84° by the end (the adapter's 2 m trapezoid of kh)
  const P = d.pieces[1], ang = (s1) => { const n = Math.ceil(s1 / 2); let a = 0, p = D.channelAt(P, 'kh', 0).v; for (let j = 1; j <= n; j++) { const v = D.channelAt(P, 'kh', (s1 * j) / n).v; a += ((p + v) / 2) * (s1 / n); p = v; } return a / DEG; };
  assert.ok(Math.abs(ang(F) + 60) <= 0.01 && Math.abs(ang(1000) + 116.84) <= 0.01, `the corners turn ${ang(F)}° to the mark and ${ang(1000)}° in all`);
});
test('L140 5 (9′): his shape through the panel rides under the bar on the BUILT road, roll and heading (× 1.05), over the whole piece and 20 m into the next', () => {
  const { d } = lay(HIS), p = builtPeaks(extend(d, { length: 200 }), 1002, 1000 + 1000 + 20);
  assert.ok(p.roll <= 1.05 && p.heading <= 1.05, `the built road reads roll ${p.roll.toFixed(3)} and heading ${p.heading.toFixed(3)} × the bar`);
});
test('L140 6: three bank changes left blank are laid back from the end, each its own minimum before the next (30° → 10° → 0)', () => {
  const { o } = lay({ bank: '30', turnAs: 'rate', changes: { bank: [{ then: '10', from: '' }, { then: '0', from: '' }] } }), [c1, c2] = o.changes.phi;
  const m2 = X.secondMinM('phi', 10 * DEG, 0), m1 = X.secondMinM('phi', 30 * DEG, 10 * DEG);
  assert.equal(c2.from, down2(1000 - m2), 'the last change at L − its minimum');
  assert.equal(c1.from, down2(c2.from - m1), 'the one before it, its own minimum earlier');
});
test('L140 7: a mark the keeper typed stays where he typed it, and "early" keeps its own short ramp', () => {
  const { o } = lay({ bank: '30', turnAs: 'rate', changes: { bank: [{ then: '0', from: '600' }] } });
  assert.equal(o.changes.phi[0].from, 600);
  const e = lay({ bank: '30', turnAs: 'rate', atStart: { bank: true }, changes: { bank: [{ then: '0', from: '' }] } });
  assert.ok(Number.isFinite(e.o.transition.phi) && e.o.transition.phi < e.o.changes.phi[0].from, `early's ramp ${e.o.transition.phi} ends before its mark ${e.o.changes.phi[0].from}`);
  assert.ok(Math.abs(at(e.d, 'phi', e.o.transition.phi + 5) / DEG - 30) <= 0.5, 'and it holds after it');
});
test('L140 8 (a guard, found by C5 and C11 on this lap): on an EMPTY track the panel starts the first piece at its typed values (`first`), so its first change is 0 → its own minimum is 0; it still lays, ramping no shorter than 20 m', () => {
  const o = extendOptions({ ...fields({ bank: '30', turnAs: 'rate', changes: { bank: [{ then: '0', from: '' }] } }), length: '750', empty: true });
  const d = TB.extendCorner(D.createDoc('empty'), o), P = d.pieces[0];
  assert.ok(Math.abs(D.channelAt(P, 'phi', 300).v / DEG - 30) <= 0.5 && Math.abs(D.channelAt(P, 'phi', 750).v) <= 1e-9, 'it holds 30° and ends level');
});
