// turn_corner.test.js: node --test test/turn_corner.test.js
// D331 (ledger D332), B and C. A hand-made 90° turn on ELYSIUM came out 99.6° and crooked. Measured on the keeper's save (fixtures-d332, sha256 2e3642f7…): the
// heading follows the readout to the degree and the bank does not change it (the curve turns about WORLD up, src/geom/path.js:9-14); a piece eased to a turn RATE
// ends still turning, so the next piece's "turn 0 at start" adds degrees the "90°" never said (p41 90.00°, p42 +9.64°), and the let-go is about eight times faster
// than the build-up, which on a 53.5° bank shows as a sudden twist-and-dip. The keeper's word (plan :367-369): "the turn angle should take into account the
// banking ... but then turns that have less banking or no banking also just work how it should to convey the proper degrees to line up with the grid". Ruled
// (plan :373-385): B, Extend's turn number is the corner's exact map heading change, ending straight, by default, with the rate meaning one switch away; C, the
// corner eases in and out symmetrically, for Extend with B, Turn by and Turn to grid. Rows (each on a flat road AND on a road banked 53.5°, where it says so):
//   1  a piece's heading change is the same on a road banked 126° as on a flat road (the turn is about world up; the frame hypothesis refuted as code)
//   2  B: the panel's turn field, as a corner (its default), typed 90 makes a corner that turns the heading by 90.00° and ends straight: "turn 0 at start"
//      after it adds 0.00°, and the corner readout reads 90.00° from the piece. Flat and banked
//   2b B: the rate meaning is one switch away and makes today's piece exactly (the save's way: 99.65° with the ease-out), so nothing the keeper built changes
//   2c B: a typed 0 keeps easing to straight (a "corner of 0°" after a road still turning would be an S-bend); blank continues, as ever
//   3  C: the corner Extend (with B), Turn by and Turn to grid make peaks within 10% of the piece's middle and lets go no faster than it built up. Flat and banked
//   4  old documents open unchanged: the keeper's save (uncommitted; skipped with the reason when absent) round-trips byte for byte and builds the identical
//      track, pinned on the code before B and C (cb3a7ff + readouts A and D)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const RO = require('../src/core/readout.js');
const TB = require('../src/core/turnby.js');
const { endHeadingDeg, gridTurnDeg } = require('../src/core/gridturn.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180, RATE = 0.02991, AT_START_M = 20;   // the save's p41 rate (171°/100 m) and the panel's "at start" ramp (app/core/panel.js:49)
const headingDeg = (d) => endHeadingDeg(A.toSegments(d), d.start.heading);
const BANKS = [['flat', 0], ['banked 53.5°', 53.5]];
const lead = (bankDeg) => extend(D.createDoc('c'), { length: 100, family: 'bowl', first: { phi: bankDeg * DEG } });
/** The panel's options for a piece of `length` with the turn field typed `turn` (every other field left as shown), the turn read as `turnAs`. */
const fields = (length, turn, turnAs, atStart = {}) => extendOptions({ length: String(length), turn: String(turn), climb: '', bank: '', width: '', cup: '', edge: '', start: '', tube: '', atStart, turnAs });
const turn0AtStart = (d) => extend(d, fields(105.05, 0, 'rate', { turn: true }));
/** The turn rate's peak (where, as a share of the piece) and its steepest build-up and let-go (rad/m²), read off the piece every 5 cm. */
function shape(P) {
  let pk = 0, at = 0; for (let s = 0; s <= P.length; s += 0.05) { const v = Math.abs(D.channelAt(P, 'kh', s).v); if (v > pk) { pk = v; at = s; } }
  let up = 0, down = 0; for (let s = 0; s <= P.length; s += 0.05) { const g = D.channelAt(P, 'kh', s).d1 * Math.sign(D.channelAt(P, 'kh', at).v); if (s < at) up = Math.max(up, g); else down = Math.max(down, -g); }
  return { peakAt: at / P.length, up, down };
}

test('row 1: the heading change of a turning piece is the same on a road banked 126° as on a flat road (the turn is about world up)', () => {
  const flat = extend(lead(0), { length: 105.05, targets: { kh: RATE } }), banked = extend(lead(126), { length: 105.05, targets: { kh: RATE } });
  const a = RO.pieceReadout(flat, 1).turnDeg, b = RO.pieceReadout(banked, 1).turnDeg;
  assert.ok(Math.abs(a - b) < 1e-9, `flat ${a}° vs banked 126° ${b}°`);
  assert.ok(Math.abs((headingDeg(banked) - headingDeg(flat))) < 1e-6, 'the built path turns the same');
});
for (const [name, bank] of BANKS) {
  test(`row 2 (B), ${name}: the turn field as a corner (the panel's default), typed 90, turns the heading by 90.00° and ends straight; turn 0 at start after it adds 0.00°`, () => {
    const d0 = lead(bank), h0 = headingDeg(d0), d = TB.extendCorner(d0, fields(105.05, 90, 'corner')), P = d.pieces[1];
    assert.ok(Math.abs(headingDeg(d) - h0 - 90) <= 0.01, `the corner turns ${(headingDeg(d) - h0).toFixed(4)}°`);
    assert.equal(D.channelAt(P, 'kh', P.length).v, 0, 'it ends straight: turn rate 0');
    assert.equal(RO.cornerNext(d, 1), null, 'so there is nothing for the next piece to ease out');
    const g = turn0AtStart(d); assert.ok(Math.abs(headingDeg(g) - h0 - 90) <= 0.01, `with turn 0 at start after it: ${(headingDeg(g) - h0).toFixed(4)}°`);
    assert.ok(Math.abs(RO.pieceReadout(d, 1).corner.turnDeg - 90) <= 0.01, 'the corner readout reads 90.00°');
  });
}
test('row 2b (B): the rate meaning, one switch away, makes today\'s piece exactly: the save\'s way still turns 99.65° with its ease-out', () => {
  const d0 = lead(0), h0 = headingDeg(d0), o = fields(105.05, RATE * 100 / DEG, 'rate');
  assert.deepEqual(Object.keys(o), ['length', 'targets'], 'the options are today\'s: a rate target, no corner'); assert.ok(Math.abs(o.targets.kh - RATE) < 1e-12, `kh ${o.targets.kh}`);
  const d = TB.extendCorner(d0, o); assert.deepEqual(d, extend(d0, o), 'the piece is Extend\'s own');
  const g = turn0AtStart(d); assert.ok(Math.abs(headingDeg(g) - h0 - 99.65) < 0.01, `today's corner: ${(headingDeg(g) - h0).toFixed(3)}°`);
});
test('row 2c (B): as a corner, a typed 0 still eases to straight (a rate of 0, not an S-bend back), and a field left as shown continues', () => {
  assert.deepEqual(fields(100, 0, 'corner'), { length: 100, targets: { kh: 0 } });
  assert.deepEqual(extendOptions({ length: '100', turn: '', climb: '', bank: '', width: '', cup: '', edge: '', start: '', tube: '', turnAs: 'corner' }), { length: 100, targets: {} });
  assert.deepEqual(fields(100, -45, 'corner', { turn: true }), { length: 100, targets: {}, turnDeg: -45 }, 'a corner has no "at start" ramp: its ease is its own');
});
for (const [name, bank] of BANKS) {
  test(`row 3 (C), ${name}: Extend's corner, Turn by and Turn to grid peak within 10% of the middle and let go no faster than they built up`, () => {
    const d0 = lead(bank), made = {
      'Extend as a corner': TB.extendCorner(d0, fields(105.05, 90, 'corner')),
      'Turn by': TB.extendTurnBy(d0, { length: 105.05 }, 90 * DEG),
      // the shell's Turn to grid (app/core/coreshell.js extendTurnToGrid): Turn by the angle gridturn.js says brings the end onto the grid; here from 30° off it
      'Turn to grid (from 30° off)': (() => { const d = TB.extendTurnBy(d0, { length: 60 }, 30 * DEG); return TB.extendTurnBy(d, { length: 105.05 }, gridTurnDeg(headingDeg(d), 90, 1) * DEG); })() };
    for (const [what, d] of Object.entries(made)) {
      const P = d.pieces[d.pieces.length - 1], s = shape(P);
      assert.ok(Math.abs(s.peakAt - 0.5) <= 0.1, `${what}: the peak is at ${(s.peakAt * 100).toFixed(1)}% of the piece`);
      assert.ok(s.down <= s.up * 1.001 + 1e-12, `${what}: lets go at ${s.down.toExponential(3)} rad/m², built up at ${s.up.toExponential(3)}`);
    }
  });
}
test('row 3b (C): from a head still turning the same way, the turn rate rises to its peak without first dipping (the head\'s rate fades into the ease, not out of it)', () => {
  const d0 = extend(lead(0), { length: 60, targets: { kh: 0.01 } }), P = TB.extendTurnBy(d0, { length: 105.05 }, 90 * DEG).pieces[2];
  let prev = -Infinity, at = 0, pk = 0; for (let s = 0; s <= P.length; s += 0.05) { const v = D.channelAt(P, 'kh', s).v; if (v > pk) { pk = v; at = s; } }
  for (let s = 0; s <= at; s += 0.05) { const v = D.channelAt(P, 'kh', s).v; assert.ok(v >= prev - 1e-9, `the rate falls at ${s.toFixed(2)} m on the way up: ${prev} → ${v}`); prev = v; }
});
const FX = path.join(__dirname, '..', 'fixtures-d332', 'eq-ELYSIUM.t180track');
test('row 4: the keeper\'s save opens unchanged: it round-trips byte for byte and builds the identical track (pinned before B and C)', { skip: fs.existsSync(FX) ? false : 'fixtures-d332/eq-ELYSIUM.t180track is the keeper\'s save, kept out of the repository; copy it in read only to run this row' }, () => {
  const raw = fs.readFileSync(FX, 'utf8'), doc = D.parse(raw), sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
  assert.equal(D.serialize(doc), raw, 'byte for byte');
  assert.equal(sha(JSON.stringify(A.toSegments(doc))), 'caeb25442228e159c73ad8f9c6368ebb08ff35f50b23db817a3abaffaf72283e', 'the segments');
  const h = crypto.createHash('sha256'); for (const x of A.toPath(doc).path.samples) h.update(new Float64Array([x.s, ...x.T, ...x.L, ...x.U, x.bankG]));
  assert.equal(h.digest('hex'), '2775e9934cf00c86bb8cca2c756aa6c1ab2d56838f5b53a3973005191db6545c', 'the path: every sample\'s s, T, L, U and gravity bank');
});
