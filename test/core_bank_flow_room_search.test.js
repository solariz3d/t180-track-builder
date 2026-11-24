// core_bank_flow_room_search.test.js: node --test test/core_bank_flow_room_search.test.js
// A FLOWING BANK ASKED WITHOUT ITS ROOM SEARCH (smooth banked turns, the panel's drag; the second reader's finding 5, lighthouse
// exo_memory/handback/p-smooth-bank-read2-C_2026-11-24.md): a refused list pays for the room search (flowRoom lays the list again at every trial), a median of 30-61 ms
// and up to 549 ms against 5-6 ms for one that lays, so a drag across a refused region stalls every frame. `roomSearch: false` asks only whether the list lays:
//   a list that lays is the same bytes; a refused one is refused by name (BAD_SECOND, its mark) with no room searched, through extend and through a corner's relay
//   (turnby.js checked → extend.js checkBankAsBuilt); left out or true, and on any call without a flowing bank, nothing changes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const TB = require('../src/core/turnby.js');
const { extend } = require('../src/core/extend.js');

const DEG = Math.PI / 180;
const LEAD = extend(D.createDoc('room'), { length: 300, family: 'bowl', first: { w: 33 } });
const flow = ([first, ...marks], more = {}) => ({ length: 300, targets: { phi: first[1] * DEG }, bankShape: 'flow', transition: { phi: first[0] }, through: { phi: marks.map(([at, deg]) => ({ at, target: deg * DEG })) }, ...more });
const bytes = (lay) => D.serialize(lay());
const refusal = (lay) => { try { lay(); } catch (e) { return e; } return null; };
const CORNER = { turnDeg: 90 };

// lists that lay (the flow layout's S, rounded; two the second reader drew), straight and as a 90° corner
const LAYS = [[[80, -20], [150, 27], [230, -28]], [[72.2, 18.5], [110.5, -10.8], [131, 10.9]], [[40, 30], [120, -30], [200, 30]]];
// refused lists, each with the mark its refusal names: on a straight, the second reader's drawn lists 4, 64 and 49 (seed 11, 5 m floor; 49 is one it found over-asked;
// LAP 4: the lists here before, READER_2, a row's mark and the reader's q2 list, lay since knots are added before refusing),
// and on the road as built through a corner's relay (found by a drawn search on this lead) and through extend's own read on a straight (mutant R7 survived without it)
const REFUSED = [
  { list: [[69.8, -2.6], [95.9, -12.3], [109.1, 15.2]], more: {}, mark: 2 },
  { list: [[74.4, 4.1], [83.1, 23.7]], more: {}, mark: 1 },
  { list: [[90.6, 19.1], [126.2, -19.6], [148.7, 8.5], [193.5, 19.2]], more: {}, mark: 2 },
  { list: [[44, -0.1], [104.3, -27.3]], more: CORNER, mark: 1, built: true },
  { list: [[48, 8], [58.1, 28.8], [72.7, -6.3], [83.6, -12.3]], more: {}, mark: 2, built: true },   // the reader's drawn lists (seed 11, 5 m floor): refused by extend's own built read, on a straight
];
const markOf = (msg) => { const m = /the bank's mark (\d+) at|the first target at/.exec(msg); return m ? (m[1] ? Number(m[1]) : 0) : null; };

test('a list that lays is the same bytes asked without its room search, through extend and through a corner', () => {
  for (const L of LAYS) {
    assert.equal(bytes(() => extend(LEAD, flow(L, { roomSearch: false }))), bytes(() => extend(LEAD, flow(L))), `extend ${JSON.stringify(L)}`);
    for (const more of [{}, CORNER]) assert.equal(bytes(() => TB.extendCorner(LEAD, flow(L, { ...more, roomSearch: false }))), bytes(() => TB.extendCorner(LEAD, flow(L, more))), `extendCorner ${JSON.stringify(more)} ${JSON.stringify(L)}`);
  }
});

test('a refused list asked without its room search is refused by name, BAD_SECOND naming its mark, with no room in the message (the search did not run)', () => {
  for (const R of REFUSED) {
    const lays = [(o) => TB.extendCorner(LEAD, o)].concat(R.more === CORNER ? [] : [(o) => extend(LEAD, o)]);
    for (const lay of lays) {
      const full = refusal(() => lay(flow(R.list, R.more))), bare = refusal(() => lay(flow(R.list, { ...R.more, roomSearch: false })));
      assert.ok(full && full.code === 'BAD_SECOND' && /needs [\d.]+ m after/.test(full.message), `asked whole, the room is named (${full && full.message})`);
      assert.equal(markOf(full.message), R.mark, `the whole refusal names mark ${R.mark}`);
      assert.ok(bare instanceof D.CoreError, `refused as a CoreError (${bare})`);
      assert.equal(bare.code, 'BAD_SECOND');
      assert.match(bare.message, new RegExp(`^BAD_SECOND: a flowing bank .+ \\(mark ${R.mark}\\)$`), 'by name: its mark, and no room');
      if (R.built) assert.match(bare.message, /the road as built/, 'the built road\'s refusal is its own');
    }
  }
});

test('roomSearch: true, or left out, is the refusal as it was, word for word', () => {
  for (const R of REFUSED) {
    const a = refusal(() => TB.extendCorner(LEAD, flow(R.list, R.more))), b = refusal(() => TB.extendCorner(LEAD, flow(R.list, { ...R.more, roomSearch: true })));
    assert.equal(b.message, a.message);
  }
});

test('a call with no flowing bank is the same bytes, or the same refusal, with roomSearch: false', () => {
  const PLAIN = [
    { length: 200 }, { length: 300, targets: { phi: 30 * DEG } }, { length: 300, targets: { phi: 30 * DEG }, bankShape: 'rounded' },
    { length: 300, targets: { phi: 30 * DEG }, changes: { phi: [{ from: 200, target: 0 }] } }, { length: 300, targets: { phi: 30 * DEG }, changes: { phi: [{ from: 60, target: 0 }] } },
    { length: 300, turnDeg: 90, targets: { phi: 20 * DEG } }, { length: 300, targets: { kh: 0.004, phi: -15 * DEG }, transition: { phi: 120 } },
  ];
  const out = (lay) => { try { return D.serialize(lay()); } catch (e) { return `refused ${e.code}: ${e.message}`; } };
  for (const o of PLAIN) {
    assert.equal(out(() => TB.extendCorner(LEAD, { ...o, roomSearch: false })), out(() => TB.extendCorner(LEAD, o)), `extendCorner ${JSON.stringify(o)}`);
    if (!('turnDeg' in o)) assert.equal(out(() => extend(LEAD, { ...o, roomSearch: false })), out(() => extend(LEAD, o)), `extend ${JSON.stringify(o)}`);
  }
});
