// core_bank_flow_drawn.test.js: node --test test/core_bank_flow_drawn.test.js
// THE FLOWING BANK OVER DRAWN MARK LISTS (src/core/extend.js, bankShape 'flow'). The rows in core_bank_flow.test.js lay one list, the banked S. A second reader
// (pane C, lighthouse exo_memory/handback/p-smooth-bank-read-C_2026-11-24.md, its probe5.js) drew lists the way a hand would and found three defects there:
// a list flowMarks accepts laid far past its marks (to −93.8°, past vertical), a valid list crashing the solve with an untyped Error, and a joint losing C2
// without a word when the transition is one number. The librarian's ruling: every list flowMarks accepts lays a bank inside its marks' range plus 0.5°, on the
// document AND on the built road, never banking the wrong way between two marks of the same sign; a list that cannot is refused by name before laying,
// naming the mark and the room it needs. No untyped throw, and a constraint the solve cannot carry is a refusal, never a skip.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const RP = require('./roll_profile.js');

const DEG = Math.PI / 180;
const ROOM = 0.5;   // °: the ruling's bar past the marks' range
const LEAD = 300, LEN = 300;
const lead = () => extend(D.createDoc('drawn'), { length: LEAD, family: 'bowl', first: { w: 33 } });

/** probe5's lists (the reader's generator, seed 11): a transition at 20-100 m, a first target within ±30°, then 1-3 marks at least `gap` m apart. */
function drawn(gap, count, seed = 11) {
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), out = [];
  for (let k = 0; k < count; k++) {
    const tr = +(20 + rnd() * 80).toFixed(1), nm = 1 + Math.floor(rnd() * 3), marks = []; let at = tr;
    for (let i = 0; i < nm; i++) { at = +(at + gap + rnd() * 40).toFixed(1); if (at > LEN) break; marks.push({ at, target: (rnd() * 60 - 30) * DEG }); }
    out.push({ first: { at: tr, target: (rnd() * 60 - 30) * DEG }, marks });
  }
  return out;
}
const optsOf = (L) => ({ length: LEN, targets: { phi: L.first.target }, transition: { phi: L.first.at }, bankShape: 'flow', through: { phi: L.marks } });

/** What is wrong with a laid piece's bank, read every 0.5 m by `read(s)` (degrees): past the marks' range by more than ROOM, or the wrong way between two
 *  marks of the same sign. The start (the bank the piece starts from) counts as a mark at 0. null when nothing is. */
function wrongWith(read, L, v0) {
  const all = [{ at: 0, target: v0 }, L.first, ...L.marks].map((m) => ({ at: m.at, deg: m.target / DEG }));
  const hi = Math.max(...all.map((m) => m.deg)), lo = Math.min(...all.map((m) => m.deg));
  for (let s = 0; s <= LEN; s += 0.5) {
    const v = read(s);
    if (v > hi + ROOM || v < lo - ROOM) return `${v.toFixed(3)}° at ${s} m, outside ${lo.toFixed(3)}..${hi.toFixed(3)} by more than ${ROOM}°`;
    const j = all.findIndex((m) => m.at > s);
    if (j > 0) { const a = all[j - 1].deg, b = all[j].deg; if (a * b > 0 && Math.sign(v) === -Math.sign(a) && Math.abs(v) > 1e-6) return `${v.toFixed(3)}° at ${s} m, the wrong way between ${a.toFixed(2)}° and ${b.toFixed(2)}°`; }
  }
  return null;
}
/** Lay one list: { laid: true, doc } or { laid: false, error }. Anything thrown that is not the core's own refusal fails the row where it is read. */
function lay(L, base = lead()) {
  try { return { laid: true, doc: extend(base, optsOf(L)) }; } catch (e) { return { laid: false, error: e }; }
}
/** A refusal by name: BAD_SECOND, naming a mark (or the joint) and the room it needs. */
function assertNamedRefusal(e, where) {
  assert.ok(e instanceof D.CoreError, `${where}: an untyped throw (${e && e.message})`);
  assert.equal(e.code, 'BAD_SECOND', `${where}: ${e.message}`);
  assert.match(e.message, /(mark \d+|first target|joint)/, `${where}: the refusal names no mark: ${e.message}`);
  assert.match(e.message, /needs/, `${where}: the refusal names no room: ${e.message}`);
}
function checkList(L, where) {
  const r = lay(L);
  if (!r.laid) { assertNamedRefusal(r.error, where); return 'refused'; }
  const P = r.doc.pieces[1], v0 = D.channelValue(r.doc.pieces[0], 'phi', LEAD);
  const onDoc = wrongWith((s) => D.channelValue(P, 'phi', s) / DEG, L, v0);
  assert.equal(onDoc, null, `${where}, on the document: ${onDoc}`);
  const built = RP.builtBank(r.doc, 0.5), at = (s) => RP.near(built, LEAD + s).v;
  const onRoad = wrongWith((s) => at(s), L, v0);
  assert.equal(onRoad, null, `${where}, on the built road: ${onRoad}`);
  return 'laid';
}

const deg = (at, d) => ({ at, target: d * DEG });
// the reader's three lists from finding 1 (probe4, probe7): −93.8° past vertical, +37.0° the wrong way first, −52.1° with every mark within 21°
const READER_1 = [
  { first: deg(72.9, -26.5), marks: [deg(123.7, -25.5), deg(178.6, -17.4), deg(193.3, 29.6)] },
  { first: deg(88, -30), marks: [deg(102.6, 7)] },
  { first: deg(48.3, 20.6), marks: [deg(91.6, -4.1), deg(115, 0.6), deg(132.7, -12.5)] },
];
// finding 2's lists (probe1/probe4): a valid list the solve could not carry, thrown as a plain Error
const READER_2 = [
  { first: deg(80, -20), marks: [deg(100, 20)] },
  { first: deg(58.4, 25.4), marks: [deg(67, 10.4)] },
];

test('drawn 1: the reader\'s three lists (finding 1) lay inside their marks\' range plus 0.5° on the document and the built road, or are refused by name', () => {
  READER_1.forEach((L, k) => checkList(L, `list ${k + 1}`));
});

test('drawn 2: the reader\'s lists the solve could not carry (finding 2) are refused by name (BAD_SECOND, the mark and its room), never an untyped throw', () => {
  READER_2.forEach((L, k) => { const r = lay(L); assert.equal(r.laid, false, `list ${k + 1} laid`); assertNamedRefusal(r.error, `list ${k + 1}`); });
});

test('drawn 3: 160 lists drawn with marks at least 5 m apart (flowMarks\' own floor) each lay inside the bar on the document and the built road, or are refused by name', () => {
  const n = { laid: 0, refused: 0 };
  drawn(5, 160).forEach((L, k) => n[checkList(L, `5 m list ${k}`)]++);
  assert.ok(n.laid >= 80, `only ${n.laid} of 160 laid (${n.refused} refused)`);
});

test('drawn 4: 80 lists drawn with marks at least 20 m apart each lay inside the bar on the document and the built road, or are refused by name', () => {
  const n = { laid: 0, refused: 0 };
  drawn(20, 80, 23).forEach((L, k) => n[checkList(L, `20 m list ${k}`)]++);
  assert.ok(n.laid >= 60, `only ${n.laid} of 80 laid (${n.refused} refused)`);
});

test('drawn 5: a fast rise into a slow one (0 → 20° at 50 m → 21° at 150 m) lays inside the bar: more room made its overshoot worse (5.3° at 100 m, 13.9° at 200)', () => {
  for (const gap of [100, 200]) assert.equal(checkList({ first: deg(50, 20), marks: [deg(50 + gap, 21)] }, `gap ${gap}`), 'laid');
});

test('drawn 6: the room a refusal names is honest: the list with that mark moved to it lays', () => {
  let tried = 0;
  for (const L of [...READER_2, ...drawn(5, 160)]) {
    const r = lay(L); if (r.laid) continue;
    const m = /mark (\d+) at ([\d.]+) m needs at least ([\d.]+) m after/.exec(r.error.message);
    if (!m) continue;   // a refusal naming the first target or the joint is read in drawn 7 and 8
    const k = +m[1], need = +m[3], prev = k === 1 ? L.first.at : L.marks[k - 2].at, shift = prev + need - L.marks[k - 1].at;
    const moved = { first: L.first, marks: L.marks.map((x, j) => (j >= k - 1 ? { at: +(x.at + shift).toFixed(4), target: x.target } : x)) };
    assert.equal(checkList(moved, `moved per "${r.error.message}"`), 'laid', r.error.message);
    if (++tried === 8) break;
  }
  assert.ok(tried >= 3, `only ${tried} refusals named a mark's room`);
});

test('drawn 7: after fixture F5 (a road that ends rolling), a flowing bank with the transition given as ONE number is refused by name, not laid with its joint C1', () => {
  const dir = path.join(__dirname, 'fixtures'), f = D.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((n) => n.startsWith('F5-'))), 'utf8'));
  let e = null; try { extend(f, { length: 300, targets: { phi: 10 * DEG }, transition: 15, bankShape: 'flow' }); } catch (x) { e = x; }
  assert.ok(e, 'laid');
  assertNamedRefusal(e, 'one-number transition');
  assert.match(e.message, /joint/, e.message);
});

test('drawn 8: the same with the transition given for the bank alone lays, C2 at the joint (the case flow 4b covers, kept beside its refusal)', () => {
  const dir = path.join(__dirname, 'fixtures'), f = D.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((n) => n.startsWith('F5-'))), 'utf8'));
  const d = extend(f, { length: 300, targets: { phi: 10 * DEG }, transition: { phi: 15 }, bankShape: 'flow' });
  const a = D.channelAt(f.pieces[f.pieces.length - 1], 'phi', f.pieces[f.pieces.length - 1].length), b = D.channelAt(d.pieces[d.pieces.length - 1], 'phi', 0);
  assert.ok(Math.abs(a.v - b.v) < 1e-9 && Math.abs(a.d1 - b.d1) < 1e-9 && Math.abs(a.d2 - b.d2) < 1e-9, `${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
});

test('drawn 9: 40 lists laid through extendCorner on a turning piece (90° over the piece, the as-built check on) lay inside the bar on the document and the built road, or are refused by name', () => {
  const TB = require('../src/core/turnby.js'), n = { laid: 0, refused: 0 };
  drawn(20, 40, 31).forEach((L, k) => {
    let r; try { r = { laid: true, doc: TB.extendCorner(lead(), { ...optsOf(L), turnDeg: 90 }) }; } catch (e) { r = { laid: false, error: e }; }
    if (!r.laid) { assertNamedRefusal(r.error, `corner list ${k}`); n.refused++; return; }
    const P = r.doc.pieces[1], v0 = D.channelValue(r.doc.pieces[0], 'phi', LEAD);
    const onDoc = wrongWith((s) => D.channelValue(P, 'phi', s) / DEG, L, v0);
    assert.equal(onDoc, null, `corner list ${k}, on the document: ${onDoc}`);
    const built = RP.builtBank(r.doc, 0.5), onRoad = wrongWith((s) => RP.near(built, LEAD + s).v, L, v0);
    assert.equal(onRoad, null, `corner list ${k}, on the built road: ${onRoad}`);
    n.laid++;
  });
  assert.ok(n.laid >= 20, `only ${n.laid} of 40 laid (${n.refused} refused)`);
});

// Two lists the mutation harness found (LAP 2): each lays only because the curve is held on the marks' side between two of one sign, and held every 0.25 m;
// a solve without either refuses it. A refusal there is wrong: the room is there.
const NEEDS_HOLD = [
  { way: 'corner', L: { first: deg(51.4, 8.36), marks: [deg(61.8, 2.33), deg(93.7, 5.15), deg(120, 27.23)] } },
  { way: 'plain', L: { first: deg(55, -12.82), marks: [deg(74.6, 20.28)] } },
];
test('drawn 10: two lists whose least bending leaves the marks between samples or crosses zero between two of one sign are laid inside them, not refused', () => {
  const TB = require('../src/core/turnby.js');
  NEEDS_HOLD.forEach(({ way, L }, k) => {
    const doc = way === 'corner' ? TB.extendCorner(lead(), { ...optsOf(L), turnDeg: 90 }) : extend(lead(), optsOf(L));
    const P = doc.pieces[1], v0 = D.channelValue(doc.pieces[0], 'phi', LEAD);
    assert.equal(wrongWith((s) => D.channelValue(P, 'phi', s) / DEG, L, v0), null, `list ${k}, on the document`);
    const built = RP.builtBank(doc, 0.5);
    assert.equal(wrongWith((s) => RP.near(built, LEAD + s).v, L, v0), null, `list ${k}, on the built road`);
  });
});
test('drawn 11: through a 90° corner, a list whose built road would bank the wrong way by a thousandth of a degree between two marks of one sign is refused by name', () => {
  const TB = require('../src/core/turnby.js'), L = { first: deg(84.7, 5.41), marks: [deg(125.6, 13.42), deg(136.9, 18.16)] };
  assert.throws(() => TB.extendCorner(lead(), { ...optsOf(L), turnDeg: 90 }), (e) => { assertNamedRefusal(e, 'the corner list'); return true; });
});
