// core_extra_corner.test.js: node --test test/core_extra_corner.test.js
// AN EXTRA CORNER IS AS FREE AS THE FIRST (the user, 2026-11-10, on 0.4.40: "making a short turn, say a 90 degree, you cannot then add the extra turn to bend it 45
// degrees ahead to then make a straight, it doesnt let you go past 2.64ish degrees"; his picture: "it should be free to continue bending even on a shorter section").
// The first corner of a piece is laid at any angle over any span that has a free control point; an extra corner (the turn and the climb lists, src/core/turnby.js) was
// also held to the route's comfort bar, 31.5·√(degrees), so on his 125 m piece an extra past about 2 degrees was refused. Now an extra corner is refused only for what
// the same corner laid first over its span would be: having no room for its ease (the knot floor, cornerMinM). His track (test/fixtures/extra-turn-short-2026-11-10.t180track):
// a 1,000 m straight, then a 125 m piece turning −90°.
//   1  his 125 m piece is the −90° corner laid on his straight (the fixture is what the rows below lay on)
//   2  −90° in 125 m with an extra −45° from 62.5 m is laid: the built road turns −135° exactly, the piece ends straight, and before the mark it is the −90° corner's own
//   3  the same with an extra +45°: −45° in all, ending straight
//   4  every extra his drag passed through is laid exact: 1.96° (where it held), 2.64° (what he could not pass), 5°, 20°, 90°
//   5  the climb list the same: +30° in 125 m with an extra −20° from 62.5 m is laid, pitching +10° in all and ending at a steady pitch
//   6  a span under the knot floor is still refused by name, turn and climb, with the length it needs; at the floor it is laid
//   7  the shortest the panel reads for an extra corner (cornerChangeMinM: its offers, default marks and drag hold) is the knot floor, whatever the degrees
//   8  bank, width and cup changes keep their bar: a bank change shorter than its shortest is still refused by name
// and three the mutation harness over turnby.js (test/core_turnby_mutation.test.js) found no row for:
//   9  Turn by with no number for its angle is refused by name (BAD_TARGET), not solved
//  10  an extra corner from the piece's start (0 m) or from its end is refused by name (BAD_SECOND)
//  11  on a document the shell would hand it (frozen through), the corner's kept answers are kept by its fields: two extras are two pieces, the same call the same one
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js');
const X = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const TB = require('../src/core/turnby.js');

const DEG = Math.PI / 180;
const HIS = D.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'extra-turn-short-2026-11-10.t180track'), 'utf8'));
const straight = Object.freeze(D.checkDoc({ ...HIS, pieces: HIS.pieces.slice(0, 1) }));   // his track up to the 125 m piece
const head = (d) => d.pieces[d.pieces.length - 1];
const corner = (k, deg, extra, from = 62.5, L = 125) => TB.extendCorner(straight, { length: L, [k]: deg, changes: { [k]: [{ from, deg: extra }] } });
/** The heading (or pitch) change over the head piece on the adapter's built path, degrees (core_additive.test.js pathTurn). */
function pathTurn(d, pitch = false) {
  const S = A.toPath(d).path.samples, L = head(d).length, s0 = d.pieces.slice(0, -1).reduce((a, p) => a + (p.type === 'flight' ? 0 : p.length), 0);
  const near = (s) => { let b = S[0]; for (const x of S) if (Math.abs(x.s - s) < Math.abs(b.s - s)) b = x; return b; };
  const ang = (x) => (pitch ? Math.asin(Math.max(-1, Math.min(1, x.T[1]))) : Math.atan2(x.T[0], x.T[2]));
  let a = ang(near(s0 + L)) - ang(near(s0)); while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a / DEG;
}
/** It ends at a rate of 0 with a slope of 0: the last two control points of the channel are 0 (src/core/turnby.js), and the rate read there is 0. */
function endsStill(d, ch) {
  const c = head(d).channels[ch];
  return c[c.length - 1] === 0 && c[c.length - 2] === 0 && Math.abs(D.channelAt(head(d), ch, head(d).length).v) < 1e-12;
}

test('row 1: his 125 m piece is the −90° corner laid on his straight', () => {
  const d = TB.extendCorner(straight, { length: 125, turnDeg: -90 });
  assert.deepEqual(head(d).knots, HIS.pieces[1].knots); assert.deepEqual(head(d).channels, HIS.pieces[1].channels);
  assert.ok(Math.abs(pathTurn(d) + 90) < 0.01, `turns ${pathTurn(d)}°`);
});

for (const [row, extra, total] of [[2, -45, -135], [3, 45, -45]]) {
  test(`row ${row}: −90° in 125 m with an extra ${extra > 0 ? '+' : ''}${extra}° from 62.5 m is laid, turns ${total}° exactly, ends straight, and is the −90° corner before the mark`, () => {
    const d = corner('turnDeg', -90, extra), base = TB.extendCorner(straight, { length: 125, turnDeg: -90 });
    assert.ok(Math.abs(pathTurn(d) - total) < 0.01, `the built road turns ${pathTurn(d).toFixed(4)}°, asked ${total}°`);
    assert.ok(endsStill(d, 'kh'), `ends straight: ${head(d).channels.kh.slice(-3)}`);
    let lk = 0; for (let s = 0; s <= 62.5; s += 0.25) lk = Math.max(lk, Math.abs(D.channelAt(head(d), 'kh', s).v - D.channelAt(head(base), 'kh', s).v));
    assert.ok(lk <= 2e-9, `before the mark the turn rate is the corner's own (off by ${lk} rad/m at most)`);
  });
}

test('row 4: every extra his drag passed through is laid exact on his piece', () => {
  // not −90: −180° in all reads ±180 on the built heading, which pathTurn wraps
  for (const extra of [1.96, 2.64, 5, 20, 90, -60]) {
    const d = corner('turnDeg', -90, extra);
    assert.ok(Math.abs(pathTurn(d) - (-90 + extra)) < 0.01, `${extra}°: the built road turns ${pathTurn(d).toFixed(4)}°`);
    assert.ok(endsStill(d, 'kh'), `${extra}°: ends straight`);
  }
});

test('row 5: the climb list the same: +30° in 125 m with an extra −20° from 62.5 m is laid, pitching +10° in all and ending at a steady pitch', () => {
  const d = corner('climbDeg', 30, -20);
  assert.ok(Math.abs(pathTurn(d, true) - 10) < 0.01, `the built road pitches ${pathTurn(d, true).toFixed(4)}°`);
  assert.ok(endsStill(d, 'kv'), 'ends at a steady pitch');
});

test('row 6: a span under the knot floor is still refused by name with the length it needs, turn and climb; at the floor it is laid', () => {
  const floor = TB.cornerMinM(straight, { length: 125 });
  assert.equal(floor, 21, 'the knot floor on his road (the shortest corner from a straight)');
  for (const [k, code, deg] of [['turnDeg', 'TURN_TOO_SHORT', -90], ['climbDeg', 'CLIMB_TOO_SHORT', 30]]) {
    assert.throws(() => corner(k, deg, 45, 125 - floor + 0.5), (e) => e.code === code && e.needM === floor && e.message.includes('change 1') && e.message.includes(`${floor.toFixed(1)} m`), `${k}: refused just under ${floor} m`);
    assert.doesNotThrow(() => corner(k, deg, 45, 125 - floor), `${k}: laid at ${floor} m`);
  }
});

test('row 7: the shortest the panel reads for an extra corner is the knot floor, whatever its degrees and the first corner\'s', () => {
  const floor = TB.cornerMinM(straight, { length: 125 });
  for (const [deg, base] of [[1.96, -90], [45, -90], [-45, -90], [180, 90], [5, undefined]]) assert.equal(TB.cornerChangeMinM(straight, { length: 125 }, deg, base), floor, `${deg}° on ${base}°`);
  assert.throws(() => TB.cornerChangeMinM(straight, { length: 125 }, NaN), (e) => e.code === 'BAD_TARGET', 'a corner with no number of degrees is still refused by name');
});

test('row 8: bank, width and cup changes keep their bar: a bank change shorter than its shortest is still refused by name', () => {
  const min = X.secondMinM('phi', 0, 30 * DEG);
  assert.ok(min > 21, `the bank's own shortest is its bar's, not the knot floor: ${min} m`);
  assert.throws(() => X.extend(straight, { length: 125, targets: { phi: 0 }, changes: { phi: [{ from: 125 - min + 2, target: 30 * DEG }] } }), (e) => /SECOND|SHORT/.test(e.code) && e.message.includes('change 1'), 'refused by name');
});

test('row 9: Turn by with no number for its angle is refused by name, not solved', () => {
  for (const a of [NaN, Infinity]) assert.throws(() => TB.extendTurnBy(straight, { length: 125 }, a), (e) => e.code === 'BAD_TARGET' && /finite angle/.test(e.message), `${a}`);
});

test('row 10: an extra corner from the piece\'s start or from its end is refused by name', () => {
  for (const from of [0, 125]) assert.throws(() => corner('turnDeg', -90, 45, from), (e) => e.code === 'BAD_SECOND' && e.message.includes('change 1'), `from ${from} m`);
});

test('row 11: on a document frozen through, the corner\'s kept answers are kept by its fields: two extras are two pieces, the same call the same one', () => {
  const deep = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deep(o[k]); } return o; };
  const kept = deep(D.checkDoc({ ...HIS, pieces: HIS.pieces.slice(0, 1) })), at = (extra) => TB.extendCorner(kept, { length: 125, turnDeg: -90, changes: { turnDeg: [{ from: 62.5, deg: extra }] } });
  const a = at(10), b = at(20);
  assert.ok(Math.abs(pathTurn(a) + 80) < 0.01 && Math.abs(pathTurn(b) + 70) < 0.01, `−80° and −70°: ${pathTurn(a).toFixed(3)}°, ${pathTurn(b).toFixed(3)}°`);
  assert.equal(at(10), a, 'the same call: the same document');
});
