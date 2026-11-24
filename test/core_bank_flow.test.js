// core_bank_flow.test.js: node --test test/core_bank_flow.test.js
// THE FLOWING BANK (src/core/extend.js, bankShape 'flow' with through: { phi: [{ at, target }, …] }). Every bank change the core lays otherwise starts and ends at
// rest (S′ = S″ = 0 at both ends of every ramp), so a long, varying roll laid as a chain of changes halts at every mark. A flowing bank PASSES THROUGH its marks as
// one curve over the piece: it starts as the piece before it ends, passes each target at its mark, arrives at the last one at rest, and carries its roll across
// every mark between. Plan: lighthouse exo_memory/loop/plan_t180_smooth_banked_turns_2026-11-24.md, Parts 2 and 3. The road read here is the BANKED S, two turns
// of about 90° in round numbers (turn A left over 120 m, turn B right over 100 m, after an 80 m run-in, all in ONE piece, so no joint falls inside the crossing).
// Its bars: each turn's size (Part 1 of the plan), the roll rate (a 30 m mean of at most 0.70 °/m, a 20 m peak of at most 0.89, an 8 m peak of at most 1.08)
// and no halt inside a roll (test/roll_profile.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const X = require('../src/core/extend.js');
const { extend } = X;
const TB = require('../src/core/turnby.js');
const PC = require('../src/core/piece.js');
const RP = require('./roll_profile.js');

const DEG = Math.PI / 180;
const LEAD = 300;
const lead = () => extend(D.createDoc('flow'), { length: LEAD, family: 'bowl', first: { w: 33 } });
// the banked S's bank marks, in metres from the S piece's start (degrees; turn A is a LEFT turn, so the bank into it is negative, left side down)
const FIRST = { at: 80, deg: -20 };
const MARKS = [{ at: 145, deg: -27 }, { at: 200, deg: 0 }, { at: 255, deg: 25 }, { at: 300, deg: 26 }];
const through = (marks = MARKS) => ({ phi: marks.map((m) => ({ at: m.at, target: m.deg * DEG })) });
const S_OPTS = { length: 300, turnDeg: 0, changes: { turnDeg: [{ from: 80, deg: 92 }, { from: 200, deg: -91 }] }, targets: { phi: FIRST.deg * DEG }, transition: { phi: FIRST.at }, bankShape: 'flow', through: through() };
const EASE_OUT = { length: 150, targets: { phi: 0 }, transition: { phi: 100 }, bankShape: 'flow' };
/** The banked S: the lead straight, the S in one piece (its corners by extendCorner), and the bank eased out over the next 100 m. */
const bankedS = () => extend(TB.extendCorner(lead(), S_OPTS), EASE_OUT);
/**
 * The same marks with today's bank: a rounded first ramp and a bank change at each mark, each from rest to rest, on the document. Today's corners cannot carry it at
 * all: through extendCorner the as-built check refuses the crossing in one piece (27° back to level needs 163.7 m, and the mark it names lies before the first
 * ramp's end, which no one can set; measured 2026-11-24), and extend's own turn changes are refused there too (861 m). So it is laid on a straight piece with the
 * check left out, as extend allows, and read on the DOCUMENT, where the S's bank and today's differ only in their shape.
 */
const todayS = () => extend(lead(), { length: 300, targets: { phi: FIRST.deg * DEG }, transition: { phi: FIRST.at }, bankShape: 'rounded',
  changes: { phi: MARKS.map((m, k) => ({ from: k ? MARKS[k - 1].at : FIRST.at, target: m.deg * DEG })) }, bankCheck: false });
/** A piece's document bank in track metres (the piece starts at LEAD). */
const docInTrack = (P) => RP.docBank(P).map((x) => ({ s: x.s + LEAD, v: x.v }));
// every mark in track metres, the first piece's start included (the lead ends level)
const TRACK_MARKS = [{ s: LEAD, deg: 0 }, { s: LEAD + FIRST.at, deg: FIRST.deg }, ...MARKS.map((m) => ({ s: LEAD + m.at, deg: m.deg })), { s: LEAD + 300 + 100, deg: 0 }];
/** The roll the road should have between two marks (the straight line between them), 0 within 10 m of a mark where the bank turns back and outside the marks. */
function refRate(s) {
  const M = TRACK_MARKS;
  for (let k = 0; k + 1 < M.length; k++) {
    if (s < M[k].s || s > M[k + 1].s) continue;
    const turnsAt = (j) => j > 0 && j + 1 < M.length && Math.sign(M[j].deg - M[j - 1].deg) !== Math.sign(M[j + 1].deg - M[j].deg);
    if ((turnsAt(k) && s - M[k].s < 10) || (turnsAt(k + 1) && M[k + 1].s - s < 10)) return 0;
    return (M[k + 1].deg - M[k].deg) / (M[k + 1].s - M[k].s);
  }
  return 0;
}
const inS = (p) => p.filter((x) => x.s >= LEAD - 20 && x.s <= LEAD + 300 + 150);

// ── Part 2: the flowing bank on the document ──────────────────────────────────────────────────────────────────────────────

test('flow 1: the bank passes through each mark within 0.05° on the document', () => {
  const d = bankedS(), P = d.pieces[1];
  for (const m of [FIRST, ...MARKS]) { const v = D.channelValue(P, 'phi', m.at) / DEG; assert.ok(Math.abs(v - m.deg) <= 0.05, `${v.toFixed(4)}° at ${m.at}, asked ${m.deg}`); }
  assert.ok(Math.abs(D.channelValue(d.pieces[2], 'phi', 100) / DEG) <= 0.05, 'the ease-out reaches level at its mark');
});

test('flow 2: no halt inside any roll on the built road (each run where the marks go one way)', () => {
  const st = RP.stops(inS(RP.builtBank(bankedS())), refRate);
  assert.deepEqual(st.map((x) => +x.s.toFixed(1)), [], JSON.stringify(st));
});

test('flow 3: the roll-rate bars on the built road: 30 m mean at most 0.70, 20 m peak at most 0.89, 8 m peak at most 1.08 °/m', () => {
  const b = inS(RP.builtBank(bankedS()));
  for (const [chord, bar] of [[30, 0.70], [20, 0.89], [8, 1.08]]) {
    const pk = RP.rateOn(b, chord).filter((x) => x.s >= LEAD && x.s <= LEAD + 450).reduce((p, q) => (Math.abs(q.r) > Math.abs(p.r) ? q : p));
    assert.ok(Math.abs(pk.r) <= bar, `${chord} m chord: ${Math.abs(pk.r).toFixed(3)} °/m at ${pk.s}, bar ${bar}`);
  }
});

test('flow 4: C2 at both joints of the S piece: value, rate and roll acceleration continue the lead\'s at its start; rate and acceleration are 0 at its end', () => {
  const d = bankedS(), P = d.pieces[1], L0 = d.pieces[0], a = D.channelAt(L0, 'phi', L0.length), b = D.channelAt(P, 'phi', 0), e = D.channelAt(P, 'phi', P.length);
  assert.ok(Math.abs(a.v - b.v) < 1e-9 && Math.abs(a.d1 - b.d1) < 1e-9 && Math.abs(a.d2 - b.d2) < 1e-9, `start: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  assert.ok(Math.abs(e.d1) < 1e-9 && Math.abs(e.d2) < 1e-9, `end: ${JSON.stringify(e)}`);
  // C2, not only C1: near each end the rate shrinks like the square of the distance (halving the distance quarters it)
  const r = (s) => D.channelAt(P, 'phi', s).d1, n = P.length;
  const q = r(n - 1) / r(n - 0.5); assert.ok(Math.abs(q - 4) < 0.2, `the rate near the end: ${q}`);
});

test('flow 4b: after a road whose bank is still rolling at its end (fixture F5), the flowing piece continues its bank, rate and roll acceleration (C2)', () => {
  // every route of the builder ends a bank at rest, so the banked S's joint carries zeros; F5 ends rolling (-0.0204 °/m, -0.0043 °/m²): the joint a sculpted or old track gives
  const fs = require('fs'), path = require('path'), dir = path.join(__dirname, 'fixtures'), f = D.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((n) => n.startsWith('F5-'))), 'utf8'));
  const L0 = f.pieces[f.pieces.length - 1], a = D.channelAt(L0, 'phi', L0.length);
  assert.ok(Math.abs(a.d1) > 1e-4 && Math.abs(a.d2) > 1e-5, `F5 must end rolling for this row to mean anything: ${JSON.stringify(a)}`);
  const d = extend(f, { length: 200, targets: { phi: 20 * DEG }, transition: { phi: 80 }, bankShape: 'flow', through: { phi: [{ at: 150, target: 10 * DEG }] } });
  const b = D.channelAt(d.pieces[d.pieces.length - 1], 'phi', 0);
  assert.ok(Math.abs(a.v - b.v) < 1e-9 && Math.abs(a.d1 - b.d1) < 1e-9 && Math.abs(a.d2 - b.d2) < 1e-9, `joint: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
});

test('flow 4c: straight after a flight (F5, then a jump at 5°), the flowing piece lands at the flight\'s bank with no roll, whatever the take-off ended rolling with', () => {
  const fs = require('fs'), path = require('path'), J = require('../src/core/jump.js'), dir = path.join(__dirname, 'fixtures');
  const f = D.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((n) => n.startsWith('F5-'))), 'utf8')), d = J.jump(f, { bank: 5 * DEG });
  assert.equal(d.pieces[d.pieces.length - 1].type, 'flight');
  const e = extend(d, { length: 200, targets: { phi: 20 * DEG }, transition: { phi: 80 }, bankShape: 'flow', through: { phi: [{ at: 150, target: 10 * DEG }] } });
  const b = D.channelAt(e.pieces[e.pieces.length - 1], 'phi', 0);
  assert.ok(Math.abs(b.v - 5 * DEG) < 1e-9 && Math.abs(b.d1) < 1e-12 && Math.abs(b.d2) < 1e-12, JSON.stringify(b));
});

test('flow 12: the least bending: on the banked S the bank\'s roll acceleration peaks under 0.026 °/m² (1 m second difference)', () => {
  // measured 0.0234 (2026-11-24); a knot left out at the marks reads 0.0304, tension at λ = 0.03 reads 0.061, the least SLOPE reads 0.088 (mutprobe.js in the hand-back)
  const p = RP.docBank(bankedS().pieces[1], 0.5);
  let worst = 0, at = 0;
  for (let i = 2; i < p.length - 2; i++) { const a = Math.abs(p[i + 2].v - 2 * p[i].v + p[i - 2].v); if (a > worst) { worst = a; at = p[i].s; } }
  assert.ok(worst < 0.026, `${worst.toFixed(4)} °/m² at ${at} m`);
});

test('flow 5: no overshoot: between marks that go one way the bank stays in their range (+0.25°), and nowhere past the largest |target| by more than 0.5°', () => {
  const p = RP.docBank(bankedS().pieces[1]), M = [{ at: 0, deg: 0 }, FIRST, ...MARKS];
  for (let k = 0; k + 1 < M.length; k++) {
    const a = M[k], b = M[k + 1], prev = M[k - 1], next = M[k + 2];
    const monotone = (!prev || Math.sign(a.deg - prev.deg) === Math.sign(b.deg - a.deg)) && (!next || Math.sign(next.deg - b.deg) === Math.sign(b.deg - a.deg));
    if (!monotone) continue;
    const lo = Math.min(a.deg, b.deg) - 0.25, hi = Math.max(a.deg, b.deg) + 0.25;
    for (const x of p.filter((x) => x.s >= a.at && x.s <= b.at)) assert.ok(x.v >= lo && x.v <= hi, `${x.v.toFixed(3)}° at ${x.s}, between ${a.deg} and ${b.deg}`);
  }
  const most = Math.max(...M.map((m) => Math.abs(m.deg)));
  for (const x of p) assert.ok(Math.abs(x.v) <= most + 0.5, `${x.v.toFixed(3)}° at ${x.s}`);
});

test('flow 6: mirror negates every mark: the mirrored bank is the exact negative', () => {
  const src = bankedS(), run = PC.saveRun(src, 1, 1, { name: 'flow' }), P = PC.insert(lead(), run, { mirror: true }).pieces[1], S = src.pieces[1];
  for (let s = 0; s <= S.length; s += 2.5) assert.equal(D.channelValue(P, 'phi', s), -D.channelValue(S, 'phi', s) + 0, `at ${s}`);
});

test('flow 7: save and open give the same bytes, and the reopened piece lays the same bank', () => {
  const d = bankedS(), text = D.serialize(d), back = D.parse(text);
  assert.equal(D.serialize(back), text);
  for (let s = 0; s <= 300; s += 5) assert.equal(D.channelValue(back.pieces[1], 'phi', s), D.channelValue(d.pieces[1], 'phi', s));
});

test('flow 8: the refusals, each by its code', () => {
  const base = { length: 300, targets: { phi: -20 * DEG }, transition: { phi: 80 }, bankShape: 'flow' };
  const r = (o, code, word) => assert.throws(() => extend(lead(), o), (e) => e.code === code && e.message.includes(word), `${code} ${word}`);
  r({ ...base, through: through(), changes: { phi: [{ from: 200, target: 0 }] } }, 'BAD_TARGET', 'one or the other');
  r({ ...base, through: through(), second: { phi: { from: 200, target: 0 } } }, 'BAD_TARGET', 'one or the other');
  r({ ...base, through: { w: [{ at: 200, target: 30 }] } }, 'BAD_TARGET', 'bank only');
  r({ ...base, bankShape: 'rounded', through: through() }, 'BAD_TARGET', "bankShape 'flow'");
  r({ length: 300, bankShape: 'flow', through: through() }, 'BAD_TARGET', 'first target');
  r({ ...base, through: { phi: [{ at: 200, target: 0 }, { at: 150, target: 0.1 }] } }, 'BAD_SECOND', 'must come after');   // not the 5 m refusal, which a backward step also trips
  r({ ...base, through: { phi: [{ at: 83, target: 0 }] } }, 'BAD_SECOND', 'under 5 m');   // the floor's own words: the room search's "needs 5 m after" also holds "5 m" (LAP 4, mutant R9)
  r({ ...base, through: { phi: [{ at: 301, target: 0 }] } }, 'BAD_SECOND', 'length');
  r({ ...base, through: { phi: [{ at: 200, target: NaN }] } }, 'BAD_SECOND', 'number');
  r({ ...base, through: { phi: { at: 200, target: 0 } } }, 'BAD_SECOND', 'list');
});

test('flow 9: on the same marks, today\'s bank halts at every mark inside a roll and the flowing bank at none (the document, so only the shape differs)', () => {
  const today = RP.stops(docInTrack(todayS().pieces[1]), refRate), flow = RP.stops(docInTrack(bankedS().pieces[1]), refRate);
  assert.ok(today.length >= 3, `today's bank halts ${today.length} times: ${JSON.stringify(today)}`);
  assert.deepEqual(flow, []);
});

test('flow 11: a mark where the bank turns back is its peak: the roll there is 0, and the bank goes no further than 0.05° past it', () => {
  const P = bankedS().pieces[1];
  for (const m of [MARKS[0], MARKS[1]]) {   // -27° at 145 (in from -20, out to 0) and 0° at 200 is NOT a turn (from -27 up through 0 to 25): only 145 is held at rest
    const a = D.channelAt(P, 'phi', m.at);
    if (m.at === 145) assert.ok(Math.abs(a.d1) < 1e-9, `the roll at the -27° peak is ${a.d1 / DEG} °/m`);
    else assert.ok(Math.abs(a.d1 / DEG) > 0.3, `the roll through 0° at 200 m carries on: ${a.d1 / DEG} °/m`);
  }
  const lo = Math.min(...RP.docBank(P).filter((x) => x.s >= 80 && x.s <= 200).map((x) => x.v));
  assert.ok(lo >= -27.05, `the bank reaches ${lo.toFixed(3)}° around the -27° peak`);
});

test('flow 10: no `through`, no flow: an extend without them is the same bytes as before (the option is opt-in)', () => {
  const o = { length: 300, targets: { phi: -20 * DEG }, transition: { phi: 80 }, bankShape: 'rounded' };
  assert.equal(D.serialize(extend(lead(), { ...o, through: undefined })), D.serialize(extend(lead(), o)));
  assert.equal(D.serialize(extend(lead(), { ...o, through: null })), D.serialize(extend(lead(), o)));
});

// ── Part 3: built as laid, and the as-built check as it is ────────────────────────────────────────────────────────────────

/** The largest gap between the built bank and the document over track metres [a, b] of the banked S: { g (degrees), s }. */
function builtGap(d, a, b) {
  let worst = { g: 0, s: null };
  for (const x of RP.builtBank(d)) {
    if (x.s < a || x.s > b) continue;
    const i = x.s < LEAD + 300 ? 1 : 2, P = d.pieces[i], t = x.s - (i === 1 ? LEAD : LEAD + 300), g = Math.abs(x.v - D.channelValue(P, 'phi', Math.min(t, P.length)) / DEG);
    if (g > worst.g) worst = { g, s: x.s };
  }
  return worst;
}

test('built 1: through the crossing (turn A\'s peak to the end of turn B) the adapter builds the bank as laid, within 0.1°', () => {
  // turn A's corner eases over [80, 200] of the S piece and peaks at its middle, 140 m; turn B's over [200, 300]. Where the road turns, bankPlan moves the bank by at most 4°.
  const w = builtGap(bankedS(), LEAD + 140, LEAD + 300);
  assert.ok(w.g <= 0.1, `the built bank leaves the document by ${w.g.toFixed(3)}° at ${w.s}`);
});

// THE STRAIGHT ROAD, A FINDING AND NOT A PASS (plan Part 3: "If row 1 fails, the adapter is NOT changed in this lap"). On the run-in and the ease-out the road is straight,
// and bankPlan re-rounds any roll faster than its bar there (BANK_BAR, about 0.0058 °/m²), so the built bank lags the document: measured 2026-11-24, by 3.82° at 360 m
// (the run-in, 0 to -20° over 80 m) and by 9.58° at 673 m (the ease-out, 26° to 0 over 100 m; built, it takes about 140 m). The fix owed is in the solve (lay on a straight
// what the adapter builds there), not in the adapter, whose change would move every saved track's export. Kept as a todo so the gap stays in sight.
test('built 1, straight road: the built bank on the run-in and the ease-out is within 0.1° of the document', { todo: 'the adapter re-rounds a straight road\'s bank (3.82° and 9.58°, measured); the fix is owed in the solve, next lap' }, () => {
  const d = bankedS(), a = builtGap(d, LEAD, LEAD + 140), b = builtGap(d, LEAD + 300, LEAD + 450);
  assert.ok(a.g <= 0.1 && b.g <= 0.1, `run-in ${a.g.toFixed(3)}° at ${a.s}; ease-out ${b.g.toFixed(3)}° at ${b.s}`);
});

test('built 2: the as-built check refuses nothing on a flowing bank (it judges bank CHANGES, and a flowing bank lays none)', () => {
  const opts = { ...S_OPTS }; delete opts.turnDeg; delete opts.changes;
  assert.deepEqual(extend(lead(), { ...opts, bankCheck: 'list' }), []);
  assert.doesNotThrow(() => X.checkBankAsBuilt(lead(), opts, extend(lead(), opts)));
});

test('built 3: extendCorner with the as-built check ON lays the whole banked S in one piece: two corners and a flowing bank, no refusal', () => {
  const d = TB.extendCorner(lead(), S_OPTS);
  assert.equal(d.pieces.length, 2);
  const tA = RP.turnOf(d, LEAD + 70, LEAD + 200), tB = RP.turnOf(extend(d, { length: 50 }), LEAD + 200, LEAD + 310);
  assert.ok(Math.abs(tA.deg - 92) <= 0.5 && tA.span >= 51 && tA.radius >= 40, `turn A ${JSON.stringify(tA)}`);
  assert.ok(Math.abs(tB.deg + 91) <= 0.5 && tB.span >= 41 && tB.radius >= 32, `turn B ${JSON.stringify(tB)}`);
});
