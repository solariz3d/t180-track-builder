// core_landing_xsec.test.js: node --test test/core_landing_xsec.test.js
// D677 C1, THE LANDING'S CROSS-SECTION (the plan: lighthouse exo_memory/loop/plan_t180_cross_section_2026-11-26.md, section (c), rows C-1 to C-6).
// When the track ends in a flight, Extend's typed width, cup, edges and edge start are the landing's START, exactly as on an empty track
// (`first`, src/core/extend.js); a field left blank carries the take-off's, as before. The landing still starts level at its flight's bank.
//   C-1  the format already allows it: a landing whose cross-section differs from the take-off's round-trips and checks (no stored-data change)
//   C-2  the width typed after a bare flight is the landing's width at s = 0
//   C-3  the same for the cup, the edge, the right edge and the edge start, each alone; the blank ones carry the take-off's
//   C-4  the landing still starts level at the flight's bank; the take-off and the flight are byte for byte as before
//   C-5  setLanding moving the flight moves only the landing's bank; its cross-section is kept
//   C-6  the export across the gap: nothing bridges the flight, and the landing's first rim is its own width
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const J = require('../src/core/jump.js');
const A = require('../src/core/adapter.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
/** A take-off that is a cup with edges (every cross-section channel set and none at a default), ending in a bare flight 40 m on, banked 0.05. */
const cupTakeoff = () => extend(D.createDoc('landing xsec'), { length: 200, family: 'bowl', targets: { w: 26, c: 40, e: 12, er: 6, s: 0.7 }, first: { w: 26, c: 40, e: 12, er: 6, s: 0.7 } });
const flown = (t = cupTakeoff()) => J.jump(t, { forward: 40, bank: 0.05 });
const XSEC = ['w', 'c', 'e', 'er', 's'];
const startOf = (P) => Object.fromEntries(XSEC.map((ch) => [ch, P.channels[ch] ? P.channels[ch][0] : undefined]));
const headOf = (d) => d.pieces[d.pieces.length - 1];

test('C-1: a landing whose width, cup, edges and edge start differ from the take-off\'s round-trips through serialize and parse unchanged, and checks (a cup take-off and a plain landing, and the reverse)', () => {
  const c = (v) => () => v;
  const plainLanding = (F) => D.roadPiece({ length: 60, family: 'flat', channels: { kh: c(0), kv: c(0), phi: c(F.bank), w: c(45), r: c(0.2) } });
  const cupLanding = (F) => D.roadPiece({ length: 60, family: 'bowl', cup: true, edge: true, channels: { kh: c(0), kv: c(0), phi: c(F.bank), w: c(18), r: c(2.993), c: c(70), e: c(3), er: c(9), s: c(0.8) } });
  const plainTakeoff = J.jump(extend(D.createDoc('plain'), { length: 200, family: 'bowl' }), { forward: 40, bank: 0.05 });
  for (const [name, t, landing] of [['a cup take-off, a plain landing', flown(), plainLanding], ['a plain take-off, a cup landing', plainTakeoff, cupLanding]]) {
    const F = headOf(t), d = D.appendPiece(t, landing(F)), text = D.serialize(d), back = D.parse(text);
    assert.equal(D.serialize(back), text, `${name}: the same text`);
    assert.deepEqual(back, d, `${name}: the same document`);
    assert.doesNotThrow(() => D.checkDoc(back), `${name}: checkDoc passes`);
    assert.notDeepEqual(startOf(headOf(back)), startOf(d.pieces[0]), `${name}: the control, the landing's cross-section is not the take-off's`);
  }
});

test('C-2: after a bare flight, the WIDTH typed is the landing\'s width from s = 0 (as on an empty track), not a ramp from the take-off\'s', () => {
  const d = extend(flown(), { length: 60, targets: { w: 18 }, first: { w: 18 } }), L = headOf(d);
  assert.equal(L.channels.w[0], 18, 'the landing\'s width at s = 0');
  assert.ok(L.channels.w.every((v) => v === 18), 'the whole landing is the width typed (its start and its target are the same)');
});

test('C-3: the CUP, the EDGE, the RIGHT EDGE and the EDGE START typed after a bare flight, each alone, are the landing\'s start; every blank field carries the take-off\'s', () => {
  const t = flown(), end = D.pieceEnd(t.pieces[0]), carried = Object.fromEntries(XSEC.map((ch) => [ch, end[ch].v]));
  // the edge typed alone sets both sides (the core's rule since er: src/core/extend.js, "an edge angle typed without a right one sets both sides")
  for (const [ch, v, also] of [['c', 70, {}], ['e', 3, { er: 3 }], ['er', 9, {}], ['s', 0.85, {}]]) {
    const d = extend(t, { length: 60, targets: { [ch]: v }, first: { [ch]: v } }), got = startOf(headOf(d));
    assert.deepEqual(got, { ...carried, [ch]: v, ...also }, `${ch} typed ${v}: it starts the landing; the rest are the take-off's`);
  }
});

test('C-3: with NOTHING typed, the landing starts at the take-off\'s cross-section, as before (the blank case is unchanged)', () => {
  const t = flown(), end = D.pieceEnd(t.pieces[0]), d = extend(t, { length: 60 });
  assert.deepEqual(startOf(headOf(d)), Object.fromEntries(XSEC.map((ch) => [ch, end[ch].v])));
});

test('C-4: the landing still starts LEVEL at the flight\'s bank (kh, kv, h, l at 0 in value and slope; phi the flight\'s), and the take-off and the flight are byte for byte as before', () => {
  const t = flown(), before = D.serialize(t), d = extend(t, { length: 60, targets: { w: 18, c: 70, e: 3, er: 9, s: 0.85 }, first: { w: 18, c: 70, e: 3, er: 9, s: 0.85 } }), L = headOf(d), F = d.pieces[1];
  for (const ch of ['kh', 'kv', 'h', 'l']) assert.deepEqual([L.channels[ch][0], L.channels[ch][1]], [0, 0], `${ch} starts level`);
  assert.equal(L.channels.phi[0], F.bank, 'at the flight\'s bank');
  assert.equal(JSON.stringify(D.parse(before).pieces), JSON.stringify(d.pieces.slice(0, 2)), 'the take-off and the flight are unchanged');
  assert.doesNotThrow(() => D.checkDoc(d), 'checkDoc (landingProblem) passes');
});

test('C-4: a turn, climb or bank in `first` after a flight does NOT start the landing: only the cross-section does (the landing starts level at the flight\'s bank)', () => {
  const d = extend(flown(), { length: 60, targets: { w: 18 }, first: { w: 18, kh: 0.01, kv: 0.01, phi: 0.3, h: 1, l: 1 } }), L = headOf(d);
  assert.deepEqual(['kh', 'kv', 'h', 'l'].map((ch) => L.channels[ch][0]), [0, 0, 0, 0]);
  assert.equal(L.channels.phi[0], 0.05);
  assert.equal(L.channels.w[0], 18);
});

test('C-5: setLanding moving the flight moves ONLY the landing\'s bank; the cross-section typed for it is kept', () => {
  const d = extend(flown(), { length: 60, targets: { w: 18, c: 70 }, first: { w: 18, c: 70 } }), moved = J.setLanding(d, { forward: 55, bank: 0.2 });
  const L0 = headOf(d), L1 = headOf(moved);
  assert.equal(L1.channels.phi[0], 0.2, 'the landing\'s bank follows its flight');
  for (const ch of Object.keys(L0.channels)) if (ch !== 'phi') assert.deepEqual(L1.channels[ch], L0.channels[ch], `${ch} is kept`);
  assert.deepEqual(startOf(L1), { ...startOf(L0) }, 'the start typed is kept');
});

test('C-6: the export across the gap: the flight is a gap with no profile (nothing bridges it), and the landing\'s first rim is its OWN width', () => {
  const d = extend(flown(), { length: 60, targets: { w: 18 }, first: { w: 18 } }), S = A.toSegments(d), g = S.findIndex((s) => s.kind === 'gap');
  assert.ok(g > 0, 'a gap segment'); assert.equal(S[g].profile, null, 'the gap carries no profile');
  const u = S[g + 1].profile && S[g + 1].profile.u;
  assert.ok(Array.isArray(u) && u.length > 1, 'the landing\'s first segment has a profile');
  near(Math.max(...u.map(Math.abs)), 9, 1e-6, 'its half-width is the landing\'s own 18 m, not the take-off\'s 26');
});

test('C-4 (Sharp, the plan\'s site to check at src/core/sharp.js:95): after a bare flight, Sharp\'s radius probe starts at the TYPED cross-section, as the corner it lays does (not the take-off\'s)', () => {
  const SH = require('../src/core/sharp.js');
  const fl = (w) => J.jump(extend(D.createDoc('sharp'), { length: 200, family: 'bowl', first: { w } }), { forward: 40 }), q = { angle: Math.PI / 2, ramp: 4 };
  const typed = SH.tightestSharp(fl(12), { length: 100, targets: { w: 40 }, first: { w: 40 } }, q), same = SH.tightestSharp(fl(40), { length: 100, targets: { w: 40 } }, q);
  assert.equal(typed, same, 'typed 40 m after a 12 m take-off probes as a 40 m take-off does');
});

test('C-2: on a track that ends in ROAD, `first` is not the start (as before): the piece continues the head C1', () => {
  const t = cupTakeoff(), d = extend(t, { length: 60, targets: { w: 18 }, first: { w: 18 } });
  assert.equal(headOf(d).channels.w[0], D.pieceEnd(t.pieces[0]).w.v, 'the head\'s width, not the typed one');
});

test('C-3: after a PLAIN take-off\'s flight, a cup or an edge given only as the start (`first`, as on an empty track) makes the landing a cup or an edge piece at it', () => {
  const t = J.jump(extend(D.createDoc('plain'), { length: 200, family: 'bowl' }), { forward: 40 });
  const cup = headOf(extend(t, { length: 60, first: { c: 70 } }));
  assert.equal(cup.cup, true, 'a cup piece'); assert.equal(cup.channels.c[0], 70);
  const edge = headOf(extend(t, { length: 60, first: { e: 5 } }));
  assert.equal(edge.edge, true, 'an edge piece'); assert.deepEqual([edge.channels.e[0], edge.channels.er[0]], [5, 5]);
});

test('C-3: an edge typed as the landing\'s start past the cap, or under the floor, is refused BY NAME (as the first piece\'s is), and the track is unchanged', () => {
  const t = flown(), text = D.serialize(t);
  assert.throws(() => extend(t, { length: 60, first: { e: 140 } }), (e) => e.code === 'BAD_EDGE' && /first piece's edge 140° is past what/.test(e.message));
  assert.throws(() => extend(t, { length: 60, first: { e: -200 } }), (e) => e.code === 'BAD_EDGE' && /first piece's edge -200° at its start takes the rim/.test(e.message));
  assert.throws(() => extend(t, { length: 60, first: { er: 140 } }), (e) => e.code === 'BAD_EDGE' && /first piece's right edge 140° is past what/.test(e.message));
  assert.equal(D.serialize(t), text);
});
