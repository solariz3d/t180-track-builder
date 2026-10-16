// core_turnby.test.js: node --test test/core_turnby.test.js. D280 part 1, "TURN BY" (the keeper, 2026-10-09 18:52: "have a subtle problem with 90 degree turns not
// coming out straight, it should be but isnt"). The turn field is a RATE (°/100 m), and a piece eased to a turn rate ENDS at that rate: on the keeper's TEST TRACK 3
// (a copy) a 750 m piece turns −90.0° and ends turning at −24.0°/100 m, so the next piece's "turn 0, at start" spends −1.35° ramping that rate down. Turn by
// places a piece that turns EXACTLY the typed angle and ENDS with turn rate 0 (src/core/turnby.js). The bar, registered before the code
// (exo_memory/handback/p-turnby-E_2026-10-09.md): B1 |heading change − θ| ≤ 0.01°; B2 the end turn rate 0 within the stored precision; B3 a following
// Straight reads 0.0° change; B4 too short is refused by name with the shortest length that works; B5 one undo step (the shell row in
// app/test/core-readout-display.test.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const RD = require('../src/core/readout.js');
const TB = require('../src/core/turnby.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
/** The heading change over piece i on the adapter's path (what the app draws and exports), in degrees. */
function pathTurn(doc, i) {
  let s0 = 0; for (let k = 0; k < i; k++) s0 += doc.pieces[k].type === 'flight' ? 0 : doc.pieces[k].length;
  const s1 = s0 + doc.pieces[i].length, S = A.toPath(doc).path.samples;
  const at = (s) => { let b = S[0]; for (const x of S) if (Math.abs(x.s - s) < Math.abs(b.s - s)) b = x; return Math.atan2(b.T[0], b.T[2]); };
  return wrap(at(s1) - at(s0)) / DEG;
}
const readTurn = (doc, i) => RD.pieceReadout(doc, i).turnDeg;
const straightAfter = (doc, L = 100) => extend(doc, extendOptions({ length: String(L), turn: '0', climb: '0', bank: '', width: '', cup: '', edge: '', start: '', tube: '', atStart: { turn: true, climb: true } }));
/** A 1500 m straight (TEST TRACK 3's first piece) and the keeper's −90° piece: 750 m, the turn rate eased from 0 to −24°/100 m over the whole piece. */
const straight = () => extend(D.createDoc('turn by'), { length: 1500, family: 'bowl' });
const eased90 = (d) => extend(d, { length: 750, targets: { kh: -24 * DEG / 100 } });

test('row 1, the cause: a piece eased to a turn rate turns −90° and ENDS at that rate, so "turn 0 at start" after it still turns about −1.35°', () => {
  const d = eased90(straight()), P = d.pieces[1];
  assert.ok(Math.abs(readTurn(d, 1) + 90) < 0.01, `the piece turns ${readTurn(d, 1)}°`);
  assert.ok(Math.abs(P.channels.kh[P.channels.kh.length - 1] * 100 / DEG + 24) < 1e-5, 'it ends at −24°/100 m (kh is stored to 1e-9 rad/m, 5.7e-6°/100 m)');
  const g = straightAfter(d), t = readTurn(g, 2);
  assert.ok(t < -1.3 && t > -1.4, `the next piece's "turn 0 at start" turns ${t.toFixed(3)}°`);
});

test('row 2 (B1, B2): Turn by −90 turns −90° within 0.01° on the path and in the readout, and ends with turn rate 0, C1 from the head', () => {
  const base = straight(), d = TB.extendTurnBy(base, { length: 750 }, -90 * DEG), i = d.pieces.length - 1, P = d.pieces[i], kh = P.channels.kh;
  assert.ok(Math.abs(pathTurn(d, i) + 90) <= 0.01, `path: ${pathTurn(d, i).toFixed(5)}°`);
  assert.ok(Math.abs(readTurn(d, i) + 90) <= 0.01, `readout: ${readTurn(d, i).toFixed(5)}°`);
  assert.equal(kh[kh.length - 1], 0); assert.equal(kh[kh.length - 2], 0);
  assert.equal(D.channelAt(P, 'kh', P.length).v, 0, 'the turn rate at the end is 0');
  const plain = extend(base, { length: 750, targets: { kh: 0 } }).pieces[1].channels.kh;
  assert.deepEqual([kh[0], kh[1]], [plain[0], plain[1]], 'the joint continues the head (C1), as Extend\'s piece does');
});

test('row 3 (B3): a Straight after Turn by reads 0.0° change', () => {
  const d = straightAfter(TB.extendTurnBy(straight(), { length: 750 }, -90 * DEG)), i = d.pieces.length - 1;
  assert.equal(Math.abs(readTurn(d, i)).toFixed(1), '0.0', `the straight turns ${readTurn(d, i)}°`);
  assert.equal(Math.abs(pathTurn(d, i)).toFixed(1), '0.0', `on the path: ${pathTurn(d, i)}°`);
});

test('row 4: from a head that is STILL TURNING (the eased −90° piece), Turn by +90 is still exact and still ends at rate 0', () => {
  const d = TB.extendTurnBy(eased90(straight()), { length: 750 }, 90 * DEG), i = d.pieces.length - 1, kh = d.pieces[i].channels.kh;
  assert.ok(Math.abs(pathTurn(d, i) - 90) <= 0.01, `path: ${pathTurn(d, i).toFixed(5)}°`);
  assert.equal(kh[kh.length - 1], 0);
  const g = straightAfter(d); assert.equal(Math.abs(readTurn(g, g.pieces.length - 1)).toFixed(1), '0.0');
});

test('row 5 (B4): a piece too short to shape is refused by name with the shortest length that works, which then works; a closed loop is refused', () => {
  let err = null; try { TB.extendTurnBy(straight(), { length: 5 }, -90 * DEG); } catch (e) { err = e; }
  assert.ok(err && err.code === 'TURN_TOO_SHORT', `refused: ${err && err.code}`);
  assert.ok(Number.isFinite(err.needM) && err.needM > 5, `names a length: ${err.needM}`);
  assert.match(err.message, new RegExp(`at least ${err.needM} m`));
  const d = TB.extendTurnBy(straight(), { length: err.needM }, -90 * DEG);
  assert.ok(Math.abs(pathTurn(d, d.pieces.length - 1) + 90) <= 0.01);
  assert.throws(() => TB.extendTurnBy({ ...straight(), closed: true }, { length: 750 }, -90 * DEG), (e) => e.code === 'CLOSED');
});

// AMENDED D331 C (ledger D332, 2026-10-15). This row was B6, the keeper's 18:55 "THERE is nothign wrong with the 90 degree curves that can be made now": Turn by
// kept today's broad curve (Extend's piece eased to an end rate) within 1°/100 m outside its last two knot spans. That curve peaks late and lets go about four times
// as fast as it builds up (a 90° Turn by over 105 m peaked at 74%), which on a steep bank is the "crooked" twist-and-dip the keeper reported on ELYSIUM, and his
// word of 2026-10-15 (plan :367-369, ruled :373-385) replaces it with a symmetric ease. The new rule, the same piece: the peak within 10% of the middle, the
// let-go no steeper than the build-up, and no tighter than today's curve was at its end (a symmetric ease peaks at about twice the average rate, which is the
// rate an eased piece ends at). test/turn_corner.test.js row 3 holds the same rule on a 105 m corner, flat and banked 53.5°, and for Turn to grid.
test('row 6 (B6, amended D331 C): Turn by −90 over 750 m eases in and out symmetrically: its peak within 10% of the middle, its let-go no steeper than its build-up, no tighter than today\'s curve ended', () => {
  const base = straight(), T = TB.extendTurnBy(base, { length: 750 }, -90 * DEG).pieces[1];
  let pk = 0, at = 0; for (let s = 0; s <= T.length; s += 0.5) { const v = -D.channelAt(T, 'kh', s).v; if (v > pk) { pk = v; at = s; } }
  let up = 0, down = 0; for (let s = 0; s <= T.length; s += 0.5) { const g = -D.channelAt(T, 'kh', s).d1; if (s < at) up = Math.max(up, g); else down = Math.max(down, -g); }
  assert.ok(Math.abs(at / T.length - 0.5) <= 0.1, `the peak is at ${(100 * at / T.length).toFixed(1)}% of the piece`);
  assert.ok(down <= up * 1.001, `lets go at ${down.toExponential(3)} rad/m², builds up at ${up.toExponential(3)}`);
  assert.ok(pk * 100 / DEG <= 24 * 1.02, `the peak rate ${(pk * 100 / DEG).toFixed(2)}°/100 m against the −24°/100 m today's −90° piece ends at`);
});
