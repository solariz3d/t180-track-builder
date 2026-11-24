// core_bank_flow_lap4.test.js: node --test test/core_bank_flow_lap4.test.js
// THE FLOWING BANK, LAP 4 (src/core/extend.js flowBank, flowRefined, flowRefusal, flowRoom), from the second reader's findings 2 and 3 (pane C, lighthouse
// exo_memory/handback/p-smooth-bank-read2-C_2026-11-24.md), with the reader's own lists as the rows:
//   b  a list the solve refuses for want of free control points is tried again with knots added between the marks either side of the mark it refused (every span
//      there split to 10 m, then 5, then 2.5) before it is refused: the reader laid 43 of its 72 refusals with knotM 5. A list that lays today is the same bytes (the
//      knots are added only after a refusal), the joint stays C2, and the saved document grows by a bounded few hundred bytes.
//   c  laying is not monotone in the move (the reader's q2 list lays at +27, +65..+67 and +72 on, and was told +65; another was told +58 where +0.5 lays), so the
//      message no longer says "at least", and the search tries every whole metre up to 10 first: where one of those lays, the room named is the least that lays.
//      Past 10 m the room is found as before (5 m steps up, back by the metre) and lays, but a smaller move can: the exact least cost 1.2 s a whole ask (LAP 4).
// The pins (core_bank_flow_lap4.pins.json) were taken on 15b1306, before this lap's change, by lighthouse's pane O work script lap4_pins.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const TB = require('../src/core/turnby.js');
const { extend } = require('../src/core/extend.js');
const PINS = require('./core_bank_flow_lap4.pins.json');

const DEG = Math.PI / 180, LEN = 300, sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const lead = () => extend(D.createDoc('drawn'), { length: 300, family: 'bowl', first: { w: 33 } });
const LEAD = lead();
/** The reader's generator (seed 11; as test/core_bank_flow_drawn.test.js): a transition at 20-100 m, a first target within ±30°, then 1-3 marks at least `gap` m apart. */
function drawn(gap, count, seed = 11) {
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), out = [];
  for (let k = 0; k < count; k++) {
    const tr = +(20 + rnd() * 80).toFixed(1), nm = 1 + Math.floor(rnd() * 3), marks = []; let at = tr;
    for (let i = 0; i < nm; i++) { at = +(at + gap + rnd() * 40).toFixed(1); if (at > LEN) break; marks.push({ at, target: (rnd() * 60 - 30) * DEG }); }
    out.push({ first: { at: tr, target: (rnd() * 60 - 30) * DEG }, marks });
  }
  return out;
}
const list = (s) => { const [first, ...marks] = s.split(' ').map((x) => { const [at, deg] = x.split(':').map(Number); return { at, target: deg * DEG }; }); return { first, marks }; };
const optsOf = (L, more = {}) => ({ length: LEN, targets: { phi: L.first.target }, transition: { phi: L.first.at }, bankShape: 'flow', through: { phi: L.marks }, ...more });
const lay = (L, more) => { try { return { doc: extend(LEAD, optsOf(L, more)) }; } catch (e) { if (!(e instanceof D.CoreError)) throw e; return { error: e }; } };
const pieceOf = (doc) => doc.pieces[doc.pieces.length - 1];
/** The list with mark k (0 the first target) and every mark after it moved on by dm metres, as flowRoom moves them. */
const moved = (L, k, dm) => { const all = [L.first, ...L.marks].map((m, j) => (j >= k ? { at: +(m.at + dm).toFixed(4), target: m.target } : m)); return { first: all[0], marks: all.slice(1) }; };
/** A refusal's room: { k, need, gap } from "the bank's mark k at … m needs N m after … (it has G m…" (or the first target's), null when it names none. */
const roomOf = (msg) => { const m = /(?:the bank's mark (\d+)|the first target) at [\d.]+ m needs (?:at least )?([\d.]+) m after .*?\(it has ([\d.]+) m/.exec(msg); return m ? { k: m[1] ? +m[1] : 0, need: +m[2], gap: +m[3] } : null; };
/** Each mark passed on the document within 0.05°, flow 1's bar (test/core_bank_flow.test.js); lists that lay with no knot added miss by up to 1.0e-3° (measured, LAP 4). */
function passesMarks(doc, L) {
  const P = pieceOf(doc);
  for (const m of [L.first, ...L.marks]) { const v = D.channelValue(P, 'phi', Math.min(m.at, P.length)); assert.ok(Math.abs(v - m.target) / DEG < 0.05, `${(v / DEG).toFixed(4)}° at ${m.at} m, asked ${(m.target / DEG).toFixed(4)}°`); }
}
// the reader's refusals at the 5 m floor (72 on 15b1306, by index into drawn(5, 160)), and those that lay with knots added
const D5 = drawn(5, 160), REFUSED5 = D5.map((L, i) => i).filter((i) => !(i in PINS.drawn[5].laid));
let KNOTTED = null;
const knotted = () => KNOTTED || (KNOTTED = REFUSED5.map((i) => ({ i, L: D5[i], r: lay(D5[i]) })).filter((x) => x.r.doc));

test('b1: the reader\'s list 21.2:4.2 40.8:20.8 56.6:-0.7, refused on 15b1306 ("needs +5 m"), lays as drawn with knots added between its marks, through each mark', () => {
  const L = list('21.2:4.2 40.8:20.8 56.6:-0.7'), r = lay(L);
  assert.ok(r.doc, `refused: ${r.error && r.error.message}`);
  passesMarks(r.doc, L);
});

test('b2: of the reader\'s 72 refusals at the 5 m floor, at least 48 (the reader laid 43 with knotM 5; knots around the mark first refused lay 48, around each try\'s own 46) now lay as drawn, each through its marks; the rest are still refused by name', () => {
  assert.equal(REFUSED5.length, 72, 'the pins hold the reader\'s 72');
  const K = knotted();
  assert.ok(K.length >= 48, `only ${K.length} of 72 lay`);
  for (const { i, L, r } of K) { try { passesMarks(r.doc, L); } catch (e) { e.message = `list ${i}: ${e.message}`; throw e; } }
  for (const i of REFUSED5) { const r = lay(D5[i]); if (r.error) { assert.equal(r.error.code, 'BAD_SECOND'); assert.match(r.error.message, /mark \d+|first target|joint/); } }
});

test('b3: unmoved: the banked S, and every drawn list that laid on 15b1306 (88 at the 5 m floor, 142 at 20 m), lay to the same bytes', () => {
  const MARKS = [{ at: 145, deg: -27 }, { at: 200, deg: 0 }, { at: 255, deg: 25 }, { at: 300, deg: 26 }];
  const S_OPTS = { length: 300, turnDeg: 0, changes: { turnDeg: [{ from: 80, deg: 92 }, { from: 200, deg: -91 }] }, targets: { phi: -20 * DEG }, transition: { phi: 80 }, bankShape: 'flow', through: { phi: MARKS.map((m) => ({ at: m.at, target: m.deg * DEG })) } };
  const S = extend(TB.extendCorner(lead(), S_OPTS), { length: 150, targets: { phi: 0 }, transition: { phi: 100 }, bankShape: 'flow' });
  assert.equal(sha(D.serialize(S)), PINS.bankedS.sha256, 'the banked S');
  for (const gap of [5, 20]) {
    const lists = gap === 5 ? D5 : drawn(20, 160), pinned = PINS.drawn[gap].laid;
    assert.ok(Object.keys(pinned).length >= (gap === 5 ? 88 : 142));
    for (const [i, h] of Object.entries(pinned)) { const r = lay(lists[i]); assert.ok(r.doc, `gap ${gap} list ${i} refused: ${r.error && r.error.message}`); assert.equal(sha(D.serialize(r.doc)), h, `gap ${gap} list ${i}`); }
  }
});

test('b4: every list that lays only with knots added is C2 at the joint: the bank, its roll rate and its roll acceleration carry on from the road before', () => {
  const K = knotted(); assert.ok(K.length >= 43, `only ${K.length} lay`);
  const prev = LEAD.pieces[LEAD.pieces.length - 1], end = D.channelAt(prev, 'phi', prev.length);
  for (const { i, r } of K) {
    const a = D.channelAt(pieceOf(r.doc), 'phi', 0);
    assert.ok(Math.abs(a.v - end.v) < 1e-9 && Math.abs(a.d1 - end.d1) < 1e-9 && Math.abs(a.d2 - end.d2) < 1e-9, `list ${i}: ${JSON.stringify(a)} after ${JSON.stringify(end)}`);
  }
});

test('b5: the save size: a list laid with knots added saves at most 600 bytes more than the same piece with the plain bank, and its added knots lie between the marks either side of one mark', () => {
  const K = knotted(); assert.ok(K.length >= 43, `only ${K.length} lay`);
  for (const { i, L, r } of K) {
    const o = optsOf(L); delete o.bankShape; delete o.through;
    const plain = extend(LEAD, o), grown = D.serialize(r.doc).length - D.serialize(plain).length;
    assert.ok(grown <= 600, `list ${i}: ${grown} bytes more`);
    const all = [0, L.first.at, ...L.marks.map((m) => m.at)], own = new Set([...pieceOf(plain).knots, ...all].map((x) => x.toFixed(3)));
    const added = pieceOf(r.doc).knots.filter((x) => !own.has(x.toFixed(3)));
    assert.ok(added.length > 0, `list ${i}: no knot added`);
    // one stretch pair: from some mark (or the joint) to two marks on
    const lo = Math.min(...added), hi = Math.max(...added), j = all.findIndex((x) => x > lo) - 1;
    assert.ok(j >= 0 && hi <= all[Math.min(j + 2, all.length - 1)] + 1e-9, `list ${i}: knots ${added.map((x) => x.toFixed(1))} span more than two stretches`);
  }
});

const NEAR = 10;   // m: the whole metres the search tries first (extend.js FLOW_NEAR_M)
/** The room named: it lays; where a whole metre up to NEAR lays, it is the least that does (every whole metre below it refused); and the message does not say
 *  "at least". Returns 'laid', 'near' (named within NEAR) or 'far'. */
function assertNamedRoom(L, where) {
  const r = lay(L); if (r.doc) return 'laid';
  const room = roomOf(r.error.message);
  assert.ok(room, `${where}: no room named: ${r.error.message}`);
  const dm = +(room.need - room.gap).toFixed(4);
  assert.ok(lay(moved(L, room.k, dm), { roomSearch: false }).doc, `${where}: the named room does not lay (${r.error.message})`);
  for (let d = 1; d < Math.min(dm, NEAR + 1); d++) assert.ok(lay(moved(L, room.k, d), { roomSearch: false }).error, `${where}: +${d} m lays, and the refusal names +${dm} (${r.error.message})`);
  // past NEAR the search steps back by the metre while it lays, so the metre below the room named is refused
  if (dm > NEAR + 1) assert.ok(lay(moved(L, room.k, dm - 1), { roomSearch: false }).error, `${where}: +${dm - 1} m lays, a metre below the +${dm} named (${r.error.message})`);
  assert.doesNotMatch(r.error.message, /at least/, `${where}: a smaller move can lay, so not "at least": ${r.error.message}`);
  return dm <= NEAR ? 'near' : 'far';
}

test('c1: the reader\'s three over-asked lists lay or are told the least whole metre that lays (told +65 where +27 lays; +58 where +0.5 lays; +10 where +1 lays)', () => {
  for (const s of ['23.2:29.2 40.9:-11.2 70.6:25.2 88:20.6', '90.6:19.1 126.2:-19.6 148.7:8.5 193.5:19.2', '61.7:11.1 102.1:5.4 111:-19.9 141.1:13.8']) assert.notEqual(assertNamedRoom(list(s), s), 'far', s);
});

test('c2: every refusal of the reader\'s lists (160 at the 5 m floor, 160 at 20 m) names a room that lays, the least whole metre where one up to 10 m lays, never "at least"', () => {
  const n = { near: 0, far: 0 };
  for (const i of REFUSED5) { const r = assertNamedRoom(D5[i], `5 m list ${i}`); if (r !== 'laid') n[r]++; }
  const D20 = drawn(20, 160); D20.forEach((L, i) => { if (!(i in PINS.drawn[20].laid)) { const r = assertNamedRoom(L, `20 m list ${i}`); if (r !== 'laid') n[r]++; } });
  assert.ok(n.near >= 10, `only ${n.near} refusals named a room within ${NEAR} m (${n.far} past it)`);
});
