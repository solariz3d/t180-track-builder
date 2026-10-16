// readout_corner.test.js: node --test test/readout_corner.test.js
// D331 (ledger D332), readouts A and D (src/core/readout.js). A turn's degrees are a piece's, and a piece eased to a turn RATE ends still turning, so a
// hand-made "90°" corner on ELYSIUM turned 99.6° (p41 90.00° + p42's ease-out 9.64°) with nothing on screen summing it; and a steep banked corner past an
// inversion read its bank in the flipped form (−234°) where the road is banked 53.5° against gravity. Rows:
//   1  A: a corner made the save's way (a 100 m straight, a piece eased to the rate that reads 90°, then turn 0 at start): the turning piece's corner reads
//      90°, ends turning at its rate in °/100 m, and cornerNext says the next piece adds the degrees its ease-out turns; the next piece's corner reads the
//      whole corner (what comes AFTER a piece is cornerNext's, never pieceReadout's: the shell reuses a piece's readout while the pieces up to it are unchanged)
//   1b A: a next piece that turns again after easing out adds only its ease-out to this corner
//   2  A: a piece that is straight to its end and after a straight has no corner; a corner that ends straight says it ends straight
//   3  A: with no next piece, what "turn 0 at start" (the panel's 20 m ramp) would add is predicted, and is what placing that piece then turns
//   4  D: the gravity bank is path.js's bankG at the piece's ends (asin of the road's left, vertical): flat 0, a 30° bank 30°, and past an inversion
//      (pitch 186°, bank −234°) 53.5°, equal to the built path's bankG
//   5  the keeper's save (fixtures-d332, uncommitted: his track, not for a public repository; skipped with the reason when absent): p41's corner 90.00°,
//      171°/100 m at its end, +9.64° from p42; p42's corner 99.64°; the gravity bank −53.5°
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const RO = require('../src/core/readout.js');

const DEG = Math.PI / 180, RATE = 0.02991;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} (want ${b} ± ${tol})`);
function corner3() {
  let d = extend(D.createDoc('c'), { length: 100, family: 'bowl' });
  d = extend(d, { length: 105.05, targets: { kh: RATE } });
  return extend(d, { length: 105.05, targets: { kh: 0 }, transition: { kh: 20 } });
}

test('row 1 (A): the turning piece reads its corner (90°), "ends turning at" its rate, and what the next piece\'s ease-out adds; the next piece reads the whole corner', () => {
  const d = corner3(), r1 = RO.pieceReadout(d, 1), r2 = RO.pieceReadout(d, 2), added = r2.turnDeg;
  near(r1.corner.turnDeg, r1.turnDeg, 1e-6, 'the turning piece\'s corner so far is its own turn (it starts after a straight)');
  near(r1.corner.endsTurningDegPer100m, RATE / DEG * 100, 1e-3, 'ends turning at its rate, in degrees per 100 m');
  const n1 = RO.cornerNext(d, 1); near(n1.nextAddsDeg, added, 1e-6, 'the next piece adds the degrees it turns before it goes straight');
  assert.equal(n1.nextFrom, 'next piece');
  near(r2.corner.turnDeg, r1.turnDeg + added, 1e-6, 'the next piece reads the whole corner');
  assert.equal(r2.corner.fromId, d.pieces[1].id, 'the corner started in the turning piece');
  assert.equal(r2.corner.endsTurningDegPer100m, null, 'and it ends straight'); assert.equal(RO.cornerNext(d, 2), null);
});
test('row 1b (A): a next piece that eases out, goes straight, then turns again adds only its ease-out, not its whole turn', () => {
  const d = corner3(), e = JSON.parse(JSON.stringify(d)), k = e.pieces[2].channels.kh; k[k.length - 1] = 0.02;   // its last control point only: a new turn at its end
  assert.ok(RO.pieceReadout(e, 2).turnDeg > RO.pieceReadout(d, 2).turnDeg + 1, 'the next piece now turns again after its straight');
  near(RO.cornerNext(e, 1).nextAddsDeg, RO.pieceReadout(d, 2).turnDeg, 1e-6, 'what it adds to this corner is its ease-out alone');
});
test('row 2 (A): a straight piece after a straight has no corner', () => {
  const d = extend(extend(D.createDoc('s'), { length: 100 }), { length: 50 });
  assert.equal(RO.pieceReadout(d, 1).corner, null);
});
test('row 2b (A): when the next piece never goes straight, the corner goes on (no ease-out degrees are claimed)', () => {
  let d = extend(D.createDoc('g'), { length: 100, family: 'bowl' }); d = extend(d, { length: 105.05, targets: { kh: RATE } }); d = extend(d, { length: 60, targets: { kh: RATE / 2 } });
  const r = RO.pieceReadout(d, 1);
  assert.deepEqual(RO.cornerNext(d, 1), { nextAddsDeg: null, nextFrom: 'the corner goes on' });
  near(RO.pieceReadout(d, 2).corner.turnDeg, r.turnDeg + RO.pieceReadout(d, 2).turnDeg, 1e-6, 'the next piece carries the whole corner on');
});
test('row 3 (A): with no next piece, the ease-out "turn 0 at start" would add is predicted, and placing that piece turns it', () => {
  let d = extend(D.createDoc('p'), { length: 100, family: 'bowl' }); d = extend(d, { length: 105.05, targets: { kh: RATE } });
  const n = RO.cornerNext(d, 1);
  assert.equal(n.nextFrom, 'turn 0 at start');
  const placed = extend(d, { length: 105.05, targets: { kh: 0 }, transition: { kh: 20 } });
  near(n.nextAddsDeg, RO.pieceReadout(placed, 2).turnDeg, 0.05, 'the prediction against the piece placed');
});
test('row 4 (D): the gravity bank is the road\'s bank against gravity at each end (path.js bankG): flat 0, 30° bank 30°, past an inversion 53.5° not −234°', () => {
  const flat = extend(D.createDoc('f'), { length: 50 }), r0 = RO.pieceReadout(flat, 0);
  near(r0.gravityBankFromDeg, 0, 1e-9, 'flat'); near(r0.gravityBankToDeg, 0, 1e-9, 'flat');
  const b30 = extend(D.createDoc('b'), { length: 50, first: { phi: 30 * DEG } }); near(RO.pieceReadout(b30, 0).gravityBankToDeg, 30, 1e-6, '30° bank on the level');
  // past an inversion: the start pose's pitch 186.25° and a bank of −234° (the save's flipped form)
  const inv = JSON.parse(JSON.stringify(b30)); inv.start.pitch = 186.25 * DEG; inv.pieces[0].channels.phi = inv.pieces[0].channels.phi.map(() => -234 * DEG);
  const ri = RO.pieceReadout(inv, 0), S = A.toPath(inv).path.samples;
  near(ri.gravityBankFromDeg, -53.5, 0.1, 'past the inversion'); near(ri.gravityBankFromDeg, S[0].bankG / DEG, 1e-6, 'the built path\'s bankG');
});
const FX = path.join(__dirname, '..', 'fixtures-d332', 'eq-ELYSIUM.t180track');
test('row 5: the keeper\'s save: p41 corner 90.00°, ends turning at 171°/100 m, +9.64° from p42; p42 corner 99.64°; gravity bank −53.5°', { skip: fs.existsSync(FX) ? false : 'fixtures-d332/eq-ELYSIUM.t180track is the keeper\'s save, kept out of the repository; copy it in read only to run this row' }, () => {
  const doc = D.parse(fs.readFileSync(FX, 'utf8')), i = doc.pieces.findIndex((p) => p.id === 'p41'), r = RO.pieceReadout(doc, i), r2 = RO.pieceReadout(doc, i + 1);
  near(r.corner.turnDeg, 90.00, 0.01, 'p41 corner'); near(r.corner.endsTurningDegPer100m, 171.4, 0.1, 'p41 ends turning'); near(RO.cornerNext(doc, i).nextAddsDeg, 9.64, 0.01, 'p42 adds');
  near(r2.corner.turnDeg, 99.64, 0.01, 'p42 corner'); assert.equal(r2.corner.fromId, 'p41');
  near(r.gravityBankToDeg, -53.5, 0.05, 'gravity bank');
});
