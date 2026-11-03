// core_bank_corners.test.js: node --test test/core_bank_corners.test.js
// THE BANK'S CORNERS, as built (the user, 2026-11-03, on RIBBON CORKSCREW TEST: "EVERYTIME there is a banked piece that tries to bank back towards center or another
// banking there are rank bumps"; his picture shows a crease in the road's edge there). Each bank ramp starts and ends its roll over a short rounding (about 10 to
// 20 m: src/core/extend.js), so wherever the roll starts, stops, turns back or changes rate the roll ACCELERATION peaked: on his track 0.009 to 0.058 °/m², a
// lift of 46 to 295 m/s² at a wheel 10 m out at 170 m/s; his replay felt 62 to 134 m/s² at the joints where it turns back, holds or starts. The bar is the one
// the bank ramps were held to on another branch: 3 g at a wheel 10 m out at 170 m/s, 29.4 / (10 · 170²) rad/m² (0.0058 °/m²). The track here is his bank,
// laid as the panel lays it (app/core/panel.js extendOptions, his values and his "early" ticks): every piece's bank channel is his save's, to the bit, without his
// turns (the roll does not depend on them). Rows:
//   1  his track and ELYSIUM: wherever the bank changes, the built roll acceleration stays under the bar (before: up to 0.0585 °/m² on his)
//   2  the kinds one at a time: a roll off the straight, one that turns back, one into and one out of a hold, one through level on to a slow roll, and a short hold
//      between two quick rolls (their roundings overlap), and inside one piece a steep roll easing into a gentle one; each under the bar
//   3  the bank's targets and holds are kept: wherever the document's bank is flat or rolls steadily for 200 m either side, the built bank is the document's
//   4  a bank that never changes faster than the bar is built exactly as the document lays it, segment for segment
//   5  the per-piece cache: after the next piece is added, or a piece next to it is edited, the pieces whose corner it rounds are rebuilt (cached equals fresh)
//   6  where the bank rolls steadily, the built roll's rate holds through every 2 m segment (before: 0.225 to 0.495 °/m for a steady 0.36)
//   7  every joint keeps its own bank: the built bank at each joint is the piece's end, exactly (his track and ELYSIUM)
//   8  a change inside one piece moves no bank past its two neighbours (a rounding never crosses a joint; a neighbour moves only because its rounding
//      starts from the joint's own rate and acceleration, which both pieces share)
//   9  the document's turning points are kept: where its bank turns back inside a piece (a bump), the built bank reaches the same extreme
//  10  no rounding overshoots: in every piece the built bank stays within the bank the document gives that piece, to 0.1°
//  11  where the road turns, the rounding moves the bank by at most 4° (a curve keeps the bank it leans on; core_close_banks_lap rows 10–14)
// Rows 1 and 2 hold a point to the larger of the bar and THE FLOOR below: with every joint kept, a short piece that banks a lot cannot roll more gently
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180, BAR = 29.4 / (10 * 170 * 170);   // rad/m²
const opts = (length, bank, early) => extendOptions({ length: String(length), turn: '', climb: '', bank: bank === null ? '' : String(bank), width: '', cup: '', edge: '', start: '', tube: '', atStart: early ? { bank: true } : {}, turnAs: 'rate' });
const lay = (seq, lead = 1000) => { let d = extend(D.createDoc('bank'), { length: lead, family: 'bowl' }); for (const [L, b, e] of seq) d = extend(d, opts(L, b, e)); return d; };
// his bank, piece by piece (length, bank, early): RIBBON CORKSCREW TEST p2 to p12
const HIS = [[750, -28.47, 1], [750, 12.01, 1], [750, 55, 0], [350, null, 0], [350, null, 0], [350, 0, 0], [750, -7, 1], [250, -90, 0], [250, -180, 0], [250, -270, 0], [250, -359.99, 0]];
// the built roll per 2 m segment: its start s, bank and rate; the acceleration between neighbouring segments
const built = (doc) => { const out = []; let s = 0; for (const g of A.toSegments(doc)) { out.push({ s, roll: g.roll0, rate: (g.roll1 - g.roll0) / g.length, len: g.length }); s += g.length; } return out; };
// THE FLOOR: the joints keep their bank exactly (a piece ends where it says), so a piece that changes its bank by Δ over L can roll no more gently than a
// rest-to-rest quintic across all of it, whose roll acceleration peaks at 10/√3 · Δ/L² (a 100 m piece banking 30° cannot meet the bar: 0.0173 °/m²). The
// bar a point is held to is the larger of the 3 g bar and that floor, for its own piece and for a piece within that piece's own length of it: the joint's rate
// and acceleration are shared, so a hard short piece's roll is eased in partly from its neighbour (ELYSIUM p41 banks 54° in 87 m, floor 0.0412 °/m², and peaks at
// 0.0338 because p40's last 60 m start the roll at 0.013), which lowers the pair's peak rather than holding the neighbour at the bar
// The same holds between any two points the build keeps: a joint, and a turning point of the bank inside a piece (row 9), so the floor is counted per stretch
// between kept points (a dip that turns back 20 m before a joint banks no more gently than its stretch to the joint allows)
const keptSpans = (doc) => {
  const out = []; let o = 0;
  for (const P of doc.pieces) {
    const pts = [0], has = P.type === 'road' && P.channels.phi;
    if (has) { let last = null; for (let s = 0; s <= P.length; s += 0.5) { const r = D.channelAt(P, 'phi', s).d1; if (Math.abs(r) < 1e-7) continue; if (last && Math.sign(r) !== last.sign) pts.push((last.s + s) / 2); last = { s, sign: Math.sign(r) }; } }
    pts.push(P.length);
    for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k], len = b - a; if (len <= 0) continue; const dv = has ? Math.abs(D.channelAt(P, 'phi', b).v - D.channelAt(P, 'phi', a).v) : 0; out.push({ a: o + a, b: o + b, floor: (10 / Math.sqrt(3)) * dv / (len * len) }); }
    o += P.length;
  }
  return out;
};
const spansOf = new WeakMap();
const allowedAt = (doc, s) => { let sp = spansOf.get(doc); if (!sp) spansOf.set(doc, (sp = keptSpans(doc))); let m = BAR; for (const q of sp) { const len = q.b - q.a; if (s >= q.a - len && s <= q.b + len) m = Math.max(m, q.floor); } return m; };
const peakAcc = (B, doc) => { let worst = { acc: 0, s: 0, ratio: 0, allowed: BAR }; for (let k = 1; k < B.length; k++) { const a = Math.abs(B[k].rate - B[k - 1].rate) / ((B[k].len + B[k - 1].len) / 2), al = allowedAt(doc, B[k].s); if (a / al > worst.ratio) worst = { acc: a, s: B[k].s, ratio: a / al, allowed: al }; } return worst; };
const docAt = (doc, s) => { let o = 0; for (const P of doc.pieces) { if (s <= o + P.length + 1e-9) return D.channelAt(P, 'phi', Math.min(P.length, s - o)); o += P.length; } return null; };

// on ELYSIUM (the fixture) corners close together inside one piece take one rounding between them (4 such on this track)
test('row 1: on his track and on ELYSIUM, wherever the bank changes, the built roll acceleration stays under the 3 g bar at a wheel 10 m out at 170 m/s, or as gently as its piece allows', () => {
  const ely = D.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'), 'utf8'));
  for (const [name, doc] of [['his track', lay(HIS)], ['ELYSIUM', ely]]) {
    const w = peakAcc(built(doc), doc);
    assert.ok(w.ratio <= 1.02, `${name}: the roll accelerates at ${(w.acc / DEG).toFixed(5)} °/m² at s ${w.s.toFixed(0)}, over the ${(w.allowed / DEG).toFixed(5)} allowed there (a wheel 10 m out at 170 m/s feels ${(10 * w.acc * 170 * 170).toFixed(1)} m/s²)`);
  }
});

test('row 2: each kind of corner on its own stays under the bar, or as gently as its piece allows: off the straight, turning back, into and out of a hold, through level on to a slow roll', () => {
  const kinds = {
    'a roll off the straight': [[750, -28.47, 1]],
    'a roll that turns back': [[750, -28.47, 1], [750, 12.01, 1]],
    'into a hold, and out of it back toward level': [[750, 55, 0], [350, null, 0], [350, 0, 0]],
    'through level on to a slow roll': [[350, 55, 0], [350, 0, 0], [750, -7, 1]],
    // corners close enough that their roundings overlap (TEST 10's p6 to p8): one window takes both
    'a short hold between two quick rolls': [[100, 30, 0], [100, null, 0], [100, 0, 0]],
  };
  // and two inside one 1000 m piece, the same way and close together (its control points from 20 on: a steep rise, a gentle one, a hold): the corners either
  // side of the steep part are one rounding, and a rounding centred where the runs either side would meet missed the corner (1.64 times the bar)
  const twoStep = (steep, ns, gentle, ng) => { const d = lay([[1000, 0, 0]]), P = d.pieces[1], c = P.channels.phi.slice(); let v = 0; for (let i = 20; i < c.length; i++) { v += i < 20 + ns ? steep : i < 20 + ns + ng ? gentle : 0; c[i] = v * DEG; } return { ...d, pieces: d.pieces.map((Q, i) => (i === 1 ? { ...Q, channels: { ...Q.channels, phi: c } } : Q)) }; };
  const docs = Object.entries(kinds).map(([name, seq]) => [name, lay(seq)]);
  for (const t of [[4, 1, 1, 3], [5, 2, 2, 1], [3, 2, 1, 2]]) docs.push([`a steep roll easing into a gentle one inside a piece (${t.join(', ')})`, twoStep(...t)]);
  // a dip that turns back just before a joint, then a hard roll from rest after it: the zone reaches two kept points, the dip's turn and the joint, and both
  // round their sides (rounding at the first only left the hard roll as laid: 4.46 times what its stretch allows)
  { const d = lay([[1000, 0, 0]]), P = d.pieces[1], c = P.channels.phi.slice(); c[c.length - 3] = -2 * DEG; docs.push(['a dip turning back just before a joint, then a hard roll from rest', extend({ ...d, pieces: d.pieces.map((Q, i) => (i === 1 ? { ...Q, channels: { ...Q.channels, phi: c } } : Q)) }, opts(250, -40, 0))]); }
  for (const [name, doc] of docs) {
    const w = peakAcc(built(doc), doc);
    assert.ok(w.ratio <= 1.02, `${name}: ${(w.acc / DEG).toFixed(5)} °/m² at s ${w.s.toFixed(0)}, over the ${(w.allowed / DEG).toFixed(5)} allowed there`);
  }
});

test('row 3: the bank\'s targets and holds are kept: where the document\'s bank is flat or rolls steadily for 200 m either side, the built bank is the document\'s', () => {
  const doc = lay(HIS), B = built(doc), total = B[B.length - 1].s;
  let checked = 0;
  for (const x of B) {
    if (x.s < 200 || x.s > total - 200) continue;
    let steady = true; const a0 = docAt(doc, x.s).d1;
    for (let t = x.s - 200; t <= x.s + 200 && steady; t += 2) if (Math.abs(docAt(doc, t).d1 - a0) > 1e-9) steady = false;
    if (!steady) continue;
    checked++;
    assert.ok(Math.abs(x.roll - docAt(doc, x.s).v) < 1e-9, `at s ${x.s}: built ${(x.roll / DEG).toFixed(4)}°, the document ${(docAt(doc, x.s).v / DEG).toFixed(4)}°`);
  }
  assert.ok(checked > 100, `the row looked at ${checked} steady samples`);
});

test('row 4: a bank that never changes faster than the bar is built exactly as the document lays it', () => {
  const doc = lay([[1000, 20, 0], [1000, 20, 0]]), w0 = (() => { let o = 0, worst = 0; for (const P of doc.pieces) { for (let s = 0; s <= P.length; s += 1) worst = Math.max(worst, Math.abs(D.channelAt(P, 'phi', s).d2)); o += P.length; } return worst; })();
  assert.ok(w0 < BAR, `the control: this document's own roll acceleration peaks at ${(w0 / DEG).toFixed(5)} °/m², under the bar`);
  let s = 0, worst = 0;
  for (const g of A.toSegments(doc)) { const pi = doc.pieces.findIndex((P) => P.id === g.id), o = doc.pieces.slice(0, pi).reduce((a, P) => a + P.length, 0), P = doc.pieces[pi]; worst = Math.max(worst, Math.abs(g.roll0 - D.valuesAt(P, s - o).phi)); s += g.length; }
  assert.ok(worst < 1e-12, `the built roll differs from the document by ${worst} rad`);
});

// The geometry rolls through each 2 m segment between its two end values; by default by a smoothstep, which brings the roll RATE to rest at both ends of every
// segment, so a bank rolling at a steady 0.36 °/m was built as 0.225 to 0.495 °/m every 2 m (a small joint bump every 2 m, felt at speed as a buzz). The
// segments now carry their rate (rollRate0/1, the cubic Hermite in src/geom/path.js), so the roll's rate runs through them
test('row 6: where the bank rolls steadily, the built roll\'s rate holds through every 2 m segment, never sagging at a segment\'s ends', () => {
  const doc = lay(HIS), S = A.toPath(doc).path.samples.map((x) => ({ s: x.s, roll: x.roll })), J = [];
  let o = 0; for (const P of doc.pieces) J.push((o += P.length));
  // his ribbon's middle two pieces (s 5300 to 5800 on this lay): the document rolls there at a steady rate between the corners
  const from = J[J.length - 4] + 60, to = J[J.length - 2] - 60, rates = [];
  for (let i = 1; i < S.length; i++) if (S[i].s > from && S[i].s < to) rates.push((S[i].roll - S[i - 1].roll) / (S[i].s - S[i - 1].s));
  const lo = Math.min(...rates.map(Math.abs)), hi = Math.max(...rates.map(Math.abs));
  assert.ok(rates.length > 100 && lo >= 0.95 * hi, `the rate over 0.5 m swings from ${(lo / DEG).toFixed(4)} to ${(hi / DEG).toFixed(4)} °/m on a steady roll`);
});

test('row 7: every joint keeps its own bank: the built bank at each joint is the bank the piece ends at, on his track and on ELYSIUM', () => {
  const ely = D.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'), 'utf8'));
  for (const [name, doc] of [['his track', lay(HIS)], ['ELYSIUM', ely]]) {
    let o = 0, s = 0, worst = 0, at = 0; const B = A.toSegments(doc).map((g) => { const r = { s, a: g.roll0 }; s += g.length; return r; });
    for (const P of doc.pieces) { o += P.length; if (P.type !== 'road') continue; const x = B.find((q) => Math.abs(q.s - o) < 1e-6); if (!x) continue; const d = Math.abs(x.a - D.channelAt(P, 'phi', P.length).v); if (d > worst) { worst = d; at = o; } }
    assert.ok(worst < 1e-9, `${name}: the built bank at the joint at s ${at.toFixed(0)} is ${(worst / DEG).toFixed(4)}° off the piece's own end`);
  }
});

test('row 8: a change inside one piece moves no bank past its two neighbours, on his track and on ELYSIUM', () => {
  const ely = D.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'), 'utf8'));
  for (const [name, doc] of [['his track', lay(HIS)], ['ELYSIUM', ely]]) {
    const before = A.toSegments(doc); let tried = 0, self = 0;
    doc.pieces.forEach((P, k) => {
      if (P.type !== 'road' || !P.channels.phi || P.channels.phi.length < 3) return;
      const c = P.channels.phi.slice(); c[Math.floor(c.length / 2)] += 1 * DEG; tried++;
      const after = A.toSegments({ ...doc, pieces: doc.pieces.map((Q, i) => (i === k ? { ...Q, channels: { ...Q.channels, phi: c } } : Q)) });
      const moved = new Set(); before.forEach((g, i) => { if (g.roll0 !== after[i].roll0 || g.roll1 !== after[i].roll1) moved.add(g.id); });
      if (moved.has(P.id)) self++;   // a piece lying wholly in one corner's rounding is built from its ends, so its middle knot moves nothing
      const near = new Set([doc.pieces[k - 1], P, doc.pieces[k + 1]].filter(Boolean).map((Q) => Q.id)), far = [...moved].filter((id) => !near.has(id));
      assert.deepEqual(far, [], `${name}: the edit to ${P.id} moved the built bank of ${far.join(', ')}`);
    });
    assert.ok(tried > 5 && self >= tried / 2, `${name}: the control: ${self} of ${tried} edited pieces moved themselves`);
  }
});

// A bank that goes out and back inside one piece (a sculpted bump, or a fitted track's: his TEST 10 has seven such turning points, ELYSIUM NEW two). Rounding
// its corners as one window joined the bump's two feet and erased it (a 5° bump built as 0.00°, 20° as 0.10°; on his TEST 10 p22, 5.19° built as 3.14°)
const bump = (deg, from, to) => {
  const d = lay([[1000, 0, 0]]), P = d.pieces[1], c = P.channels.phi.slice(); for (let i = from; i <= to; i++) c[i] = deg * DEG;
  return { ...d, pieces: d.pieces.map((Q, i) => (i === 1 ? { ...Q, channels: { ...Q.channels, phi: c } } : Q)) };
};
test("row 9: the document's turning points are kept: where its bank turns back inside a piece, the built bank reaches the same extreme", () => {
  for (const [deg, from, to] of [[5, 21, 23], [10, 20, 24], [20, 21, 23], [-12, 22, 22]]) {
    const doc = bump(deg, from, to), P = doc.pieces[1], o = doc.pieces[0].length, S = A.toPath(doc).path.samples, ds = S[1].s - S[0].s;
    // a turning point: the rate's sign flips between two places it is not zero (a flat top between them: its middle)
    let turns = 0, last = null;
    for (let s = 0; s <= P.length; s += 0.5) {
      const r = D.channelAt(P, 'phi', s).d1; if (Math.abs(r) < 1e-7) continue;
      if (last && Math.sign(r) !== last.sign) {
        const t = (last.s + s) / 2, want = D.channelAt(P, 'phi', t).v, got = S[Math.round((o + t) / ds)].roll; turns++;
        assert.ok(Math.abs(got - want) < 0.05 * DEG, `a ${deg}° bump: at its turning point s ${(o + t).toFixed(1)} the document banks ${(want / DEG).toFixed(3)}°, the build ${(got / DEG).toFixed(3)}°`);
      }
      last = { s, sign: Math.sign(r) };
    }
    assert.ok(turns >= 1, `a ${deg}° bump: the control: ${turns} turning points`);
  }
});

// a window grown from a pin's acceleration once swung a piece's bank to -135° on its way to -40° (the dip below): a rounding may only round
test('row 10: no rounding overshoots: in every piece the built bank stays within the bank the document gives that piece, to 0.1°', () => {
  const ely = D.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'), 'utf8'));
  const d0 = lay([[1000, 0, 0]]), c = d0.pieces[1].channels.phi.slice(); c[c.length - 3] = -2 * DEG;
  const dip = extend({ ...d0, pieces: d0.pieces.map((Q, i) => (i === 1 ? { ...Q, channels: { ...Q.channels, phi: c } } : Q)) }, opts(250, -40, 0));
  for (const [name, doc] of [['his track', lay(HIS)], ['ELYSIUM', ely], ['a dip turning back just before a joint, then a hard roll from rest', dip], ['a 20° bump', bump(20, 21, 23)]]) {
    const S = A.toPath(doc).path.samples; let o = 0;
    for (const P of doc.pieces) {
      if (P.type === 'road' && P.channels.phi) {
        let lo = Infinity, hi = -Infinity; for (let s = 0; s <= P.length; s += 1) { const v = D.channelAt(P, 'phi', s).v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
        for (const x of S) if (x.s >= o && x.s <= o + P.length) assert.ok(x.roll >= lo - 0.1 * DEG && x.roll <= hi + 0.1 * DEG, `${name}: at s ${x.s.toFixed(1)} (${P.id}) the build banks ${(x.roll / DEG).toFixed(2)}°, the piece's own bank runs ${(lo / DEG).toFixed(2)}° to ${(hi / DEG).toFixed(2)}°`);
      }
      o += P.length;
    }
  }
});

// where the road turns the bank is what the curve leans on: a rounding centred at a corner near a curve's end re-laid the curve's last few hundred metres
// (core_close_banks_lap rows 10–14: a Close-banked curve's exit, 32.5°, built at 15°)
test('row 11: where the road turns, the rounding moves the bank by at most 4°, on ELYSIUM', () => {
  const ely = D.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'), 'utf8'));
  const S = A.toPath(ely).path.samples; let o = 0, worst = 0, at = 0, turning = 0;
  for (const P of ely.pieces) {
    if (P.type === 'road' && !P.tube && P.channels.phi) for (const x of S) {
      if (x.s < o || x.s > o + P.length || Math.abs(D.channelAt(P, 'kh', x.s - o).v) <= 1 / 600) continue;
      turning++; const d = Math.abs(x.roll - D.channelAt(P, 'phi', x.s - o).v); if (d > worst) { worst = d; at = x.s; }
    }
    o += P.length;
  }
  assert.ok(turning > 1000, `the control: ${turning} turning stations`);
  assert.ok(worst <= 4 * DEG + 0.05 * DEG, `at s ${at.toFixed(0)}, where the road turns, the build moved the bank by ${(worst / DEG).toFixed(2)}°`);
});

test('row 5: after the next piece is added, or a piece next to it is edited, the pieces whose corner it rounds are rebuilt: the cached build equals a fresh one', () => {
  // his p9 after p8: the -180 piece changes p8's rounding at their joint (adding p3 after p2, the old lay here, changes no earlier piece's since each joint keeps its bank)
  const cache = new Map(), three = lay(HIS.slice(0, 8));
  A.toSegments(three, { cache });
  const four = extend(three, opts(...HIS[8]));
  assert.notEqual(A.bankPlan(four)[8].key, A.bankPlan(three)[8].key, "the control: adding p9 changes p8's rounding");
  assert.deepEqual(A.toSegments(four, { cache }).map((g) => [g.id, g.roll0, g.roll1]), A.toSegments(four).map((g) => [g.id, g.roll0, g.roll1]));
  // and an edit: ELYSIUM's p12 raised 1° in its middle changes p13's rounding where they meet, and nothing else of p13 (adding a piece always rebuilds the one
  // before it for other reasons, so only an edit shows a stale rounding)
  const ely = D.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'), 'utf8'));
  const k = ely.pieces.findIndex((P) => P.id === 'p12'), c = ely.pieces[k].channels.phi.slice(); c[Math.floor(c.length / 2)] += 1 * DEG;
  const ed = { ...ely, pieces: ely.pieces.map((Q, i) => (i === k ? { ...Q, channels: { ...Q.channels, phi: c } } : Q)) }, warm = new Map();
  assert.notEqual(A.bankPlan(ed)[k + 1].key, A.bankPlan(ely)[k + 1].key, "the control: the edit changes p13's rounding");
  A.toSegments(ely, { cache: warm });
  assert.deepEqual(A.toSegments(ed, { cache: warm }).map((g) => [g.id, g.roll0, g.roll1]), A.toSegments(ed).map((g) => [g.id, g.roll0, g.roll1]));
});
