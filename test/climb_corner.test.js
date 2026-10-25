// climb_corner.test.js: node --test test/climb_corner.test.js
// D331 (ledger D332), the climb too (the user, 2026-10-15: "i wonder, the climb might need to do the same?"; ruled at plan :387-399). The climb channel kv is
// a RATE exactly like the turn (src/geom/path.js:10, the pitch curvature kp(s); readout.js climbDeg = ∫κv ds), so a piece eased to a climb rate ends still
// climbing and the next piece's ease-out adds pitch nobody read. The same three answers as the turn's (test/turn_corner.test.js):
//   1  B: the climb field as a corner (the panel's default, the same "turn and climb as" switch), typed 10, changes the pitch by exactly 10.00° and ends at a
//      climb rate of 0 (a steady pitch); flat and banked 53.5°
//   1b B: the rate meaning is one switch away and makes today's piece exactly; 1c a typed 0 still eases to a climb rate of 0
//   2  C: the climb eases in and out symmetrically: the peak within 10% of the middle, the let-go no faster than the build-up (Extend's climb corner, Climb by,
//      and a turn and a climb in one corner piece, which are each exact)
//   3  A: the readout's climb corner: the pitch change since the climb rate was last 0, where it began, and "ends climbing at …" while it does
//   4  past an inversion heading and pitch still compose (path.js:14, θ keeps its meaning past ±90°): a 180° climb corner turns the road over and ends at a
//      steady pitch, a 90° turn corner on the far side turns θ by exactly 90°, and the built road's direction is T = (cos p sin θ, sin p, cos p cos θ) there;
//      a second 180° climb closes the loop's pitch to 360°
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const RO = require('../src/core/readout.js');
const TB = require('../src/core/turnby.js');
const { endHeadingDeg } = require('../src/core/gridturn.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180;
const BANKS = [['flat', 0], ['banked 53.5°', 53.5]];
const lead = (bankDeg) => extend(D.createDoc('c'), { length: 100, family: 'bowl', first: { phi: bankDeg * DEG } });
const fields = (length, climb, turnAs, turn = '') => extendOptions({ length: String(length), turn: String(turn), climb: String(climb), bank: '', width: '', cup: '', edge: '', start: '', tube: '', atStart: {}, turnAs });
/** The pitch the document reaches at its end: the start pitch plus ∫κv over every road piece (the adapter's own sum, src/core/adapter.js:311). */
const pitchDeg = (d) => (d.start.pitch + A.toSegments(d).reduce((a, g) => a + (g.kind === 'gap' ? 0 : ((g.kp0 + g.kp1) / 2) * g.length), 0)) / DEG;
function shape(P, ch) {
  let pk = 0, at = 0; for (let s = 0; s <= P.length; s += 0.05) { const v = Math.abs(D.channelAt(P, ch, s).v); if (v > pk) { pk = v; at = s; } }
  const sg = Math.sign(D.channelAt(P, ch, at).v); let up = 0, down = 0;
  for (let s = 0; s <= P.length; s += 0.05) { const g = D.channelAt(P, ch, s).d1 * sg; if (s < at) up = Math.max(up, g); else down = Math.max(down, -g); }
  return { peakAt: at / P.length, up, down };
}

for (const [name, bank] of BANKS) {
  test(`row 1 (B), ${name}: the climb field as a corner, typed 10, changes the pitch by 10.00° and ends at a climb rate of 0`, () => {
    const d0 = lead(bank), p0 = pitchDeg(d0), o = fields(105.05, 10, 'corner');
    assert.equal(o.climbDeg, 10); assert.equal(o.targets.kv, undefined, 'no rate target');
    const d = TB.extendCorner(d0, o), P = d.pieces[1];
    assert.ok(Math.abs(pitchDeg(d) - p0 - 10) <= 0.01, `the pitch changes ${(pitchDeg(d) - p0).toFixed(4)}°`);
    assert.ok(Math.abs(RO.pieceReadout(d, 1).climbDeg - 10) <= 0.01, 'the readout reads 10.00°');
    assert.equal(D.channelAt(P, 'kv', P.length).v, 0, 'it ends at a climb rate of 0');
    const S = A.toPath(d).path.samples, Tend = S[S.length - 1].T; assert.ok(Math.abs(Math.asin(Tend[1]) / DEG - 10) < 0.02, `the built road ends ${(Math.asin(Tend[1]) / DEG).toFixed(3)}° up`);
  });
}
test('row 1b (B): the climb as a rate, one switch away, is today\'s option and piece exactly', () => {
  const d0 = lead(0), o = fields(105.05, 5, 'rate');
  assert.deepEqual(Object.keys(o), ['length', 'targets']); assert.ok(Math.abs(o.targets.kv - 5 * DEG / 100) < 1e-15);
  assert.deepEqual(TB.extendCorner(d0, o), extend(d0, o));
});
test('row 1c (B): as a corner, a typed climb 0 still eases to a climb rate of 0; a turn and a climb typed together are both corners', () => {
  assert.deepEqual(fields(100, 0, 'corner'), { length: 100, targets: { kv: 0 } });
  assert.deepEqual(fields(100, 8, 'corner', 45), { length: 100, targets: {}, turnDeg: 45, climbDeg: 8 });
});
for (const [name, bank] of BANKS) {
  test(`row 2 (C), ${name}: the climb eases in and out symmetrically; a turn and a climb in one piece are each exact and each symmetric`, () => {
    const d0 = lead(bank), made = {
      'Extend\'s climb corner': [TB.extendCorner(d0, fields(105.05, 10, 'corner')), ['kv']],
      'Climb by': [TB.extendClimbBy(d0, { length: 105.05 }, 10 * DEG), ['kv']],
      'a turn and a climb corner together': [TB.extendCorner(d0, fields(105.05, 10, 'corner', 90)), ['kh', 'kv']] };
    for (const [what, [d, chs]] of Object.entries(made)) {
      const P = d.pieces[d.pieces.length - 1];
      for (const ch of chs) {
        const s = shape(P, ch);
        assert.ok(Math.abs(s.peakAt - 0.5) <= 0.1, `${what}, ${ch}: the peak is at ${(s.peakAt * 100).toFixed(1)}%`);
        assert.ok(s.down <= s.up * 1.001 + 1e-12, `${what}, ${ch}: lets go at ${s.down.toExponential(3)}, built up at ${s.up.toExponential(3)}`);
        assert.equal(D.channelAt(P, ch, P.length).v, 0, `${what}, ${ch}: ends at rate 0`);
      }
    }
    const both = made['a turn and a climb corner together'][0], r = RO.pieceReadout(both, 1);
    assert.ok(Math.abs(r.turnDeg - 90) <= 0.01 && Math.abs(r.climbDeg - 10) <= 0.01, `the turn ${r.turnDeg}° and the climb ${r.climbDeg}°`);
  });
}
test('row 2b (B): Turn by keeps a climb typed as a corner (as it keeps a climb rate typed in the fields): its piece turns its own angle and climbs the corner', () => {
  const d = TB.extendTurnBy(lead(0), fields(105.05, 10, 'corner', 45), 90 * DEG), r = RO.pieceReadout(d, 1);
  assert.ok(Math.abs(r.turnDeg - 90) <= 0.01, `Turn by's own angle: ${r.turnDeg}° (the turn field's 45 is not Turn by's)`);
  assert.ok(Math.abs(r.climbDeg - 10) <= 0.01, `the climb corner: ${r.climbDeg}°`);
});
test('row 3 (A): the climb corner: the pitch change since the climb rate was last 0, where it began, and "ends climbing at" its rate while it does', () => {
  let d = extend(lead(0), { length: 80, targets: { kv: 0.003 } }); d = extend(d, { length: 60, targets: { kv: 0.003 }, transition: { kv: 'start' } });
  const r1 = RO.pieceReadout(d, 1), r2 = RO.pieceReadout(d, 2);
  assert.ok(Math.abs(r1.climbCorner.climbDeg - r1.climbDeg) < 1e-6, 'the first climbing piece: its own climb');
  assert.ok(Math.abs(r2.climbCorner.climbDeg - (r1.climbDeg + r2.climbDeg)) < 1e-6, 'the second: the whole climb so far');
  assert.equal(r2.climbCorner.fromId, d.pieces[1].id);
  assert.ok(Math.abs(r2.climbCorner.endsClimbingDegPer100m - 0.003 / DEG * 100) < 1e-4, `ends climbing at ${r2.climbCorner.endsClimbingDegPer100m}°/100 m`);
  const e = TB.extendCorner(d, fields(100, -12, 'corner')), r3 = RO.pieceReadout(e, 3);
  assert.equal(r3.climbCorner.endsClimbingDegPer100m, null, 'a climb corner ends at a steady pitch');
  assert.equal(RO.pieceReadout(lead(0), 0).climbCorner, null, 'a level straight has none');
});
test('row 4: past an inversion heading and pitch still compose: a 180° climb turns the road over, a 90° turn on the far side turns θ by 90°, and T is (cos p sin θ, sin p, cos p cos θ)', () => {
  const d0 = lead(0), h0 = endHeadingDeg(A.toSegments(d0), d0.start.heading);
  const over = TB.extendCorner(d0, fields(300, 180, 'corner'));
  assert.ok(Math.abs(pitchDeg(over) - 180) <= 0.01, `over the top: pitch ${pitchDeg(over)}°`);
  assert.equal(D.pieceEnd(over.pieces[1]).kv.v, 0, 'ending at a steady pitch, upside down');
  const turned = TB.extendCorner(over, fields(200, '', 'corner', 90)), th = endHeadingDeg(A.toSegments(turned), turned.start.heading);
  assert.ok(Math.abs(th - h0 - 90) <= 0.01, `θ turns ${(th - h0).toFixed(4)}° on the far side`);
  const S = A.toPath(turned).path.samples, T = S[S.length - 1].T, p = pitchDeg(turned) * DEG, t = th * DEG;
  const want = [Math.cos(p) * Math.sin(t), Math.sin(p), Math.cos(p) * Math.cos(t)];
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(T[k] - want[k]) < 1e-4, `T[${k}] ${T[k]} against ${want[k]}`);
  const loop = TB.extendCorner(turned, fields(300, 180, 'corner'));
  assert.ok(Math.abs(pitchDeg(loop) - 360) <= 0.01, `the second half closes the pitch: ${pitchDeg(loop)}°`);
});
