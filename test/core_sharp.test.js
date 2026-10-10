// core_sharp.test.js: node --test test/core_sharp.test.js. D282 part 1, SHARP, a second turn type (the keeper, 2026-10-09 18:55: "i also want to be able to make
// thunderhead 90 degrees too"; the broad curve stays as it is). Thunderhead's turns after the jump: about R 22 m, ~88°, entries and exits 0–8 m 10–90%, width ~24
// (exo_memory/loop/sharp_turns_measure_B_2026-10-09.md §1). B registers its own bar and checks it blind (plan_t180_sharp_turn_type_2026-10-09.md lines 29–39);
// these are E's rows: the angle on the path the app draws, the exit dead straight, short entries and exits, green at full speed, the minimum radius named by
// the geometry, a round trip through a save, and refusals that change nothing.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const RD = require('../src/core/readout.js');
const V = require('../src/validate/index.js');
const SH = require('../src/core/sharp.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180;
const wrap = (a) => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };
/** A 200 m straight at width W, as the panel places it (B's base, d280/knots.js). */
const base = (W) => extend(D.createDoc('sharp'), extendOptions({ length: 200, turn: 0, width: W, empty: true }));
const straightAfter = (d, L = 100) => extend(d, extendOptions({ length: String(L), turn: '0', climb: '0', bank: '', width: '', cup: '', edge: '', start: '', tube: '', atStart: { turn: true, climb: true } }));
/** The corner, a 100 m Straight after it, and what the app's path and validator say about it. */
function corner(W, R, deg, ramp = 4) {
  const c = SH.extendSharp(base(W), {}, { angle: deg * DEG, R, ramp }), d = straightAfter(c), S = A.toPath(d).path.samples;
  const s0 = 200, s1 = s0 + c.pieces[1].length + c.pieces[2].length, s2 = s1 + 100;
  const at = (s) => S.reduce((b, x) => (Math.abs(x.s - s) < Math.abs(b.s - s) ? x : b)), hd = (s) => { const x = at(s); return Math.atan2(x.T[0], x.T[2]) / DEG; };
  const k = (x) => Math.hypot(x.kvec[0], x.kvec[2]), inT = S.filter((x) => x.s >= s0 - 5 && x.s <= s2); let km = 0; for (const x of inT) km = Math.max(km, k(x));
  const first = (f) => inT.find((x) => k(x) >= f * km).s, last = (f) => [...inT].reverse().find((x) => k(x) >= f * km).s;
  const res = V.validate(A.toPath(d).path, A.toSegments(d), { csp: true, fullSpeed: true });
  const on = (xs) => (xs || []).filter((x) => { const a = x.s0 != null ? x.s0 : x.s, b = x.s1 != null ? x.s1 : a; return b >= s0 - 5 && a <= s2; }).map((x) => x.reason);
  return { c, d, turn: wrap(hd(s1) - hd(s0)), straight: RD.pieceReadout(d, d.pieces.length - 1).turnDeg, last50: wrap(hd(s2) - hd(s2 - 50)), Rbuilt: 1 / km,
    entry: first(0.9) - first(0.1), exit: last(0.1) - last(0.9), red: on(res.red), amber: on(res.amber) };
}
const refusal = (fn) => { try { fn(); } catch (e) { return e; } return null; };

for (const [W, R] of [[24, 22], [45, 24.25]]) {
  test(`Sharp 90° at R ${R}, width ${W}: turns 90° within 0.01° on the path, holds R, enters and exits within 8 m, the Straight after it turns 0.0°, and is green at full speed`, () => {
    const m = corner(W, R, 90), kh = m.c.pieces[2].channels.kh;
    assert.ok(Math.abs(m.turn - 90) <= 0.01, `turn ${m.turn.toFixed(5)}°`);
    assert.ok(Math.abs(m.Rbuilt - R) <= 0.05 * R, `radius built ${m.Rbuilt.toFixed(2)} m`);
    assert.ok(m.entry <= 8 && m.exit <= 8, `entry ${m.entry} m, exit ${m.exit} m (10–90%)`);
    assert.deepEqual([kh[kh.length - 2], kh[kh.length - 1]], [0, 0], 'the corner ends with turn rate 0 and slope 0');
    assert.equal(Math.abs(m.straight).toFixed(1), '0.0', `the Straight after it turns ${m.straight}°`);
    assert.ok(Math.abs(m.last50) <= 0.01, `the last 50 m of the Straight turn ${m.last50}°`);
    assert.deepEqual([m.red, m.amber], [[], []], 'no red, no amber on the corner');
  });
}

test('Sharp at 45°, 135°, 180° and −90° (R 22, width 24): each exact within 0.01° and exiting straight', () => {
  for (const deg of [45, 135, 180, -90]) {
    const m = corner(24, 22, deg);
    assert.ok(Math.abs(m.turn - deg) <= 0.01, `${deg}°: turned ${m.turn.toFixed(5)}°`);
    assert.ok(Math.abs(m.last50) <= 0.01, `${deg}°: the Straight after it turns ${m.last50}° over its last 50 m`);
  }
});

test('the minimum radius is the geometry\'s: width 45 refuses R 24 (stacked) and names the tightest, which is green, and 0.2 m under it is refused; nothing changes', () => {
  const b = base(45), e = refusal(() => SH.extendSharp(b, {}, { angle: 90 * DEG, R: 24 }));
  assert.ok(e && e.code === 'SHARP_TOO_TIGHT', `refused: ${e && e.code}`);
  assert.match(e.message, new RegExp(`tightest at this width: ${e.needR.toFixed(1)} m`));
  assert.ok(e.needR > 24 && e.needR <= 24.5, `tightest ${e.needR} m (B measured 24.25 on the broad build)`);
  assert.equal(b.pieces.length, 1, 'the document is untouched');
  assert.equal(SH.extendSharp(b, {}, { angle: 90 * DEG, R: e.needR }).pieces.length, 3, 'the tightest named works');
  assert.equal(refusal(() => SH.extendSharp(b, {}, { angle: 90 * DEG, R: e.needR - 0.2 })).code, 'SHARP_TOO_TIGHT', 'and is the edge');
});

test('width 24: R 11 is refused for the fold, and the tightest named is green with 0.2 m under it refused', () => {
  const b = base(24), e = refusal(() => SH.extendSharp(b, {}, { angle: 90 * DEG, R: 11 }));
  assert.ok(e && e.code === 'SHARP_TOO_TIGHT' && e.faults.red.includes('fold'), `refused: ${e && e.message}`);
  assert.ok(Number.isFinite(e.needR) && e.needR > 11, `tightest ${e.needR} m`);
  assert.deepEqual((({ red, amber }) => [red, amber])(corner(24, e.needR, 90)), [[], []], 'the tightest named is green');
  assert.equal(refusal(() => SH.extendSharp(b, {}, { angle: 90 * DEG, R: e.needR - 0.2 })).code, 'SHARP_TOO_TIGHT');
});

test('a corner smaller than its own ramps, a zero angle, a bad radius and a closed loop are refused by name', () => {
  assert.equal(refusal(() => SH.extendSharp(base(24), {}, { angle: 2 * DEG, R: 22, ramp: 4 })).code, 'SHARP_TOO_SMALL');
  assert.equal(refusal(() => SH.extendSharp(base(24), {}, { angle: 0, R: 22 })).code, 'BAD_TARGET');
  assert.equal(refusal(() => SH.extendSharp(base(24), {}, { angle: 90 * DEG, R: 0 })).code, 'BAD_TARGET');
  assert.equal(refusal(() => SH.extendSharp({ ...base(24), closed: true }, {}, { angle: 90 * DEG, R: 22 })).code, 'CLOSED');
});

test('a track with a Sharp corner survives a save and reopen: the same pieces, knots and path', () => {
  const d = straightAfter(SH.extendSharp(base(24), {}, { angle: -90 * DEG, R: 22 })), back = D.parse(D.serialize(d));
  assert.deepEqual(back.pieces.map((P) => P.knots), d.pieces.map((P) => P.knots));
  assert.deepEqual(back.pieces.map((P) => P.channels.kh), d.pieces.map((P) => P.channels.kh));
  const a = A.toPath(d).path.samples, b = A.toPath(back).path.samples;
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 7) assert.deepEqual(b[i].pos, a[i].pos);
});

test('the broad curve is not Sharp\'s: placing a Sharp corner leaves what Extend\'s eased turn and Turn by build byte-identical', () => {
  // sharp.js only ADDS a call (it edits no shared module); this row catches it starting to leave state behind. "Every saved track rebuilds as on 3025a5e" is B's row
  const TB = require('../src/core/turnby.js'), b = base(24);
  const broad = D.serialize(extend(b, { length: 750, targets: { kh: -24 * DEG / 100 } })), tb = D.serialize(TB.extendTurnBy(b, { length: 750 }, -90 * DEG));
  SH.extendSharp(b, {}, { angle: 90 * DEG, R: 22 });
  assert.equal(D.serialize(extend(b, { length: 750, targets: { kh: -24 * DEG / 100 } })), broad);
  assert.equal(D.serialize(TB.extendTurnBy(b, { length: 750 }, -90 * DEG)), tb);
});
