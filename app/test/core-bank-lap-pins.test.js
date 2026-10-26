// core-bank-lap-pins.test.js: node --test app/test/core-bank-lap-pins.test.js
// D477 (pane P): THE SINGLE PRESS IS BYTE FOR BYTE D473's. Bank the lap's second press was made to change nothing by planning against the bank the lap carries
// (src/core/finish.js bankPlan `carried`, bankLapRun's fixed point), and the plan ruled that Close's own press (app/core/closejob.js runCloseBest, which banks the
// lap it closes through the same bankLapWith) keeps its output byte-equal. These rows pin that: the sha256 of the serialized document, as a4bfe52 (D473 part 2)
// produced it, for bankLapWith over four public laps closed by close(), and for closejob's press on the two of them that close that way. The laps' own digests are
// pinned beside them, so a change in extend or close reads as "the lap changed", not "the bank changed". Re-pin by name, with a note here, when the bank plan is
// meant to change (D447's rate or acceleration bound, the share, the sweeps); a pin that moves otherwise is the press changing what it banks.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { extendTurnBy } = require('../../src/core/turnby.js');
const { close } = require('../../src/core/close.js');
const { bankLapWith } = require('../../src/core/finish.js');
const { runCloseBest } = require('../core/closejob.js');

const DEG = Math.PI / 180, R = 180, Q = (Math.PI * R) / 2, QQ = (300 * Math.PI) / 2;
const sha = (d) => crypto.createHash('sha256').update(D.serialize(d)).digest('hex');
/** core-bank-lap.test.js row 1's lap, open. */
function flatOpen() {
  let d = extend(D.createDoc('flat closer'), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  return extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
}
/** core-bank-lap.test.js row 2's lap (test/core_close_banks_lap.test.js row 7's), open. */
function loopOpen() {
  let d = extend(D.createDoc('looped'), { length: 100, family: 'bowl' }); d = extendTurnBy(d, { length: QQ }, 90 * DEG); d = extend(d, { length: 100 });
  d = extendTurnBy(d, { length: 700, climbDeg: 360 }, 30 * DEG); d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: QQ }, 60 * DEG); d = extend(d, { length: 200 });
  d = extendTurnBy(d, { length: QQ }, 90 * DEG); d = extend(d, { length: 100 }); return extendTurnBy(d, { length: QQ }, 90 * DEG);
}
/** core-bank-lap.test.js rows 3 and 4's lap (TEST 10's shape in public words), open. */
function t10Open(loopM, loopDeg) {
  let d = extend(D.createDoc('t10 shape'), { length: 200, family: 'bowl' });
  d = extend(d, { length: 100, transition: 40, targets: { phi: 30 * DEG } });
  d = extend(d, { length: QQ, transition: 40, targets: { kh: 1 / 300 } });
  d = extend(d, { length: 100, transition: 40, targets: { phi: 0, kh: 0 } });
  d = extendTurnBy(d, { length: loopM, climbDeg: 360 }, loopDeg * DEG);
  d = extend(d, { length: 100 }); d = extendTurnBy(d, { length: QQ }, (140 - loopDeg) * DEG); d = extend(d, { length: 200 });
  d = extendTurnBy(d, { length: QQ }, 90 * DEG); d = extend(d, { length: 100 }); return extendTurnBy(d, { length: QQ }, 90 * DEG);
}
const closed = (open) => { const c = close(open, { edited: [open.pieces.length - 1] }); assert.equal(c.converged, true, c.report); return c.doc; };

// a4bfe52's digests (T=C:/…/t180-wt-e473 node pins.js, exo_memory/handback/p-d477-P_2026-10-26_evidence/pins-old.out)
const PINS = {
  flat: { lap: '40000038fa963aeaefb1a66cdc231094cef4a71c5e5888b67f8af14613f2925a', bank: '4893c25fdd539ef6c211fca5c68b82c9e26119c22e85c5d227eb743eef36749f', press: 'c5cff905d422e75f00d85149f095d3e22f6b304120fc155d5ae6679e605a2d4f' },
  loop: { lap: '2571f9567d124a470f531b9fd251f0500284cc6b1eca25bc52ded5a456e53d08', bank: 'a712f84f84d977e8bd70fb8b3b9b7111c64cb838df53625d74411ef891f83aa3', press: 'a712f84f84d977e8bd70fb8b3b9b7111c64cb838df53625d74411ef891f83aa3' },
  t10a: { lap: 'cbe20b141d40cad46332882054b0f0283db10a88f2cb007926500acdbcdd3bc9', bank: 'dd552a6d5f5adbd2d0253296f6ec5b6ab7c889113fd306b7850a7dd5fdd8a7cb' },
  t10b: { lap: 'f0479b79e5ba16543e6001d9bbfff0494754aa6303c55870d5f562bf3705963a', bank: '01083cc64dec8a06b058314a658906e6ba480d13fdc63e137a6958e11512deab' },
};
const OPEN = { flat: flatOpen, loop: loopOpen, t10a: () => t10Open(600, 40), t10b: () => t10Open(700, 25) };

test('row 1: bankLapWith over a lap closed by close() is byte for byte D473\'s (a4bfe52) on four public laps', () => {
  for (const [name, mk] of Object.entries(OPEN)) {
    const lap = closed(mk());
    assert.equal(sha(lap), PINS[name].lap, `${name}: the lap itself (extend and close unchanged)`);
    assert.equal(sha(bankLapWith(lap).doc), PINS[name].bank, `${name}: the single press's bank`);
  }
});

test('row 2: Close\'s own press (runCloseBest, which banks the lap it closes) is byte for byte D473\'s (a4bfe52) on the two public laps that close that way', () => {
  for (const name of ['flat', 'loop']) {
    const r = runCloseBest({ doc: OPEN[name]() });
    assert.equal(r.converged, true, `${name}: ${r.report}`);
    assert.equal(sha(r.doc), PINS[name].press, `${name}: closejob's press`);
  }
});
