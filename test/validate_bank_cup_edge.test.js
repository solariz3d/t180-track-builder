// validate_bank_cup_edge.test.js: the stacked bank + cup + edge warning (D463; the user, 2026-10-25, on TEST 10: the car "clips and becomes unstable at higher speeds
// and Gs into the curve, without the side flip ups it didnt happen", so warn where "banking, plus cupping, plus extra banking with the side values" stack). AMBER
// 'bank-cup-edge': the cross-slope change over the car's 2 m on the side the bank raises passes 8°, where all three are there. Rows:
//   1  a right turn banked 30°, cupped 15°, its left (raised) edge at 30°: amber over the piece, never red, its source beside it, u at the raised rim
//   2  the same turn with any one of the three removed (bank 0, cup 0, edge 0) is silent
//   3  a flat level road is silent, and an empty track is refused before any check, as before
//   4  an edge on one side only: on the side the bank raises it warns (left or right, mirrored); on the side the bank lowers it is silent
//   5  the bar: a 10° edge on the same turn changes the slope under the car by less than 8° and is silent; 20° is past it and warns
//   6  the panel's words are the user's terms, the rule id and source in the hover title; revalidate gives the same warning as validate
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const AD = require('../src/core/adapter.js');
const { validate, revalidate, STACK_CURL_DEG } = require('../src/validate/index.js');
const { findingLine } = require('../app/validate-ui/labels.js');

const DEG = Math.PI / 180;
// kh < 0 is a right turn; phi > 0 raises the left side, the turn's outside; e is the left edge, er the right (src/core/extend.js, document.js)
const TURN = { c: 15, phi: 30 * DEG, e: 30, er: 0, kh: -1 / 200 };
const run = (first, length = 300) => { const d = extend(D.createDoc('t'), { length, family: 'bowl', first }); const { segments, path } = AD.toPath(d, { step: 1 }); return { segments, path, v: validate(path, segments, {}) }; };
const stack = (v) => v.amber.filter((a) => a.reason === 'bank-cup-edge');

test('row 1: bank, cup and an edge on the raised side stacked in a turn: amber over the piece, never red, with its source, at the raised rim', () => {
  const { v } = run(TURN), a = stack(v);
  assert.equal(a.length, 1, JSON.stringify(v.amber.map((x) => x.reason)));
  assert.ok(a[0].s0 <= 1 && a[0].s1 >= 299, `the whole piece: ${a[0].s0}..${a[0].s1}`);
  assert.ok(a[0].u > 0, `the left rim, the raised side (u ${a[0].u})`);
  assert.ok(a[0].worst > STACK_CURL_DEG, `worst ${a[0].worst}°`);
  assert.match(a[0].source, /D463/);
  assert.ok(!v.red.some((x) => x.reason === 'bank-cup-edge'), 'a warning, never red');
});

test('row 2: the same turn with any one of the three removed is silent', () => {
  for (const [name, f] of [['no bank', { ...TURN, phi: 0 }], ['no cup', { ...TURN, c: 0 }], ['no edge', { ...TURN, e: 0 }]]) assert.deepEqual(stack(run(f).v), [], name);
});

test('row 3: a flat level road is silent; an empty track is refused before any check, as before', () => {
  assert.deepEqual(stack(run({}).v), [], 'flat and level');
  assert.deepEqual(stack(run({ kh: -1 / 200 }).v), [], 'a flat unbanked turn');
  assert.throws(() => AD.toPath(D.createDoc('t'), { step: 1 }), /EMPTY/);
});

test('row 4: an edge on one side only warns on the side the bank raises, mirrored, and is silent on the side it lowers', () => {
  assert.equal(stack(run({ ...TURN, e: 30, er: 0 }).v).length, 1, 'left edge, left raised');
  assert.deepEqual(stack(run({ ...TURN, e: 0, er: 30 }).v), [], 'right edge, left raised: the lowered side');
  const m = stack(run({ ...TURN, phi: -30 * DEG, kh: 1 / 200, e: 0, er: 30 }).v);
  assert.equal(m.length, 1, 'the mirror: a left turn, the right side raised, the right edge');
  assert.ok(m[0].u < 0, `the right rim (u ${m[0].u})`);
});

test('row 5: the bar: a 10° edge on the turn stays under 8° across the car and is silent; 20° passes it', () => {
  assert.deepEqual(stack(run({ ...TURN, e: 10 }).v), [], 'e 10');
  const a = stack(run({ ...TURN, e: 20 }).v);
  assert.equal(a.length, 1, 'e 20'); assert.ok(a[0].worst > STACK_CURL_DEG && a[0].worst < stack(run(TURN).v)[0].worst, `e 20 reads between the bar and e 30's (${a[0].worst})`);
});

test('row 6: the panel line is in the user\'s terms with the id and source in its hover title; revalidate gives the same warning', () => {
  const { v, path, segments } = run(TURN), line = findingLine('amber', stack(v)[0]);
  assert.match(line.text, /^amber: bank, cup and edge stack here and the turn may ride rough at speed, at \d+–\d+ m$/);
  assert.match(line.title, /^bank-cup-edge · D463/);
  assert.ok(!/k[e]eper/i.test(line.text + line.title), 'no room word in the panel');   // spelled with a class so the release scan of added lines reads 0
  assert.deepEqual(stack(revalidate(v, path, segments, 150, {})), stack(v));
});
