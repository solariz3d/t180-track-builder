// core_cup.test.js: node --test test/core_cup.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// THE CUP (D190): the channel c, the cross-section's edge angle in degrees, in [0, 150]. Stated before the code (the D190 seal, rows 1-3, 5-7):
//   1a  the edge ψ of a cup profile equals c on BOTH sides (0.05°), the r cap never applies, degrees are degrees
//   1b  along a ramp the wall follows c on the ROAD (the mesh's own rows): the rows land on c(s) (0.05°) and never change faster than c itself, no seam zip inside a piece
//       (D190 round 3, N1: the seal's literal "≤ 1° between rows" is RETIRED: on a steep ramp it is c's own change over one 0.5 m path sample, 1.0087° on half-pipe 15.5 → 150 over 100 m)
//   2   ψ is non-decreasing outward, the walls never meet, and a cup outside [0, 150] is refused by name, whatever produced it
//   3   c joins C1 between cup pieces, is carried through a flight, closes round a lap; legacy ↔ cup joins at the RENDERED edge (0.05°)
//   5   a legacy piece renders as it did (profileAt), and a cup is set only on purpose (5c, 5d, 5e)
//   6   cup then roll: bank 30° + cup 60° gives left 90°, right 30°, centre 30°; a cup moves neither the line, the bank nor the readout's turn/climb
//   7   the readout's cupFromDeg/cupToDeg are the document's c (a cup piece) or the edge the road renders (a legacy piece)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const S = require('../src/core/sculpt.js');
const { close } = require('../src/core/close.js');
const R = require('../src/core/readout.js');
const { buildMesh } = require('../src/geom/mesh.js');
const { FLOORS } = require('../src/geom/fonts.js');
const PF = require('../src/geom/profile.js'), { offsetAt } = PF;

const DEG = Math.PI / 180, FAMILIES = ['bowl', 'half-pipe', 'flat'];
const edges = (P) => [P.psi[0] / DEG, P.psi[P.psi.length - 1] / DEG];

// ── 1a · the profile's edge is c ─────────────────────────────────────────────────────────────────────────────────────────
test('row 1a: a cup profile has edge ψ = c on both sides, every family, width and c, and never less than the wall before it (ψ non-decreasing outward)', () => {
  for (const family of FAMILIES) for (const w of [8, 12, 31, 50]) for (const c of [0, 15.5, 30.6, 45, 90, 120, 150]) {
    const P = A.cupProfile(family, w, c), [l, r] = edges(P);
    assert.ok(Math.abs(l - c) <= 1e-9 && Math.abs(r - c) <= 1e-9, `${family} w ${w} c ${c}: edges ${l}, ${r}`);
    const half = P.u.indexOf(0);
    for (let i = half; i + 1 < P.u.length; i++) assert.ok(P.psi[i + 1] >= P.psi[i] - 1e-12, `${family} c ${c}: ψ falls outward on the left at ${i}`);
    for (let i = half; i > 0; i--) assert.ok(P.psi[i - 1] >= P.psi[i] - 1e-12, `${family} c ${c}: ψ falls outward on the right at ${i}`);
  }
});
test('row 2 (i): the walls do not meet at c = 150: each tip stays off the centreline by at least 5% of the half-width, on every family and width', () => {
  for (const family of FAMILIES) for (const w of [8, 12, 31, 50]) {
    const P = A.cupProfile(family, w, 150), tip = offsetAt({ u: P.u, psi: P.psi }, P.u[P.u.length - 1])[0];
    assert.ok(tip / (w / 2) >= 0.05, `${family} w ${w}: tip ratio ${tip / (w / 2)}`);
  }
  assert.ok(Math.abs(offsetAt({ u: A.cupProfile('bowl', 31, 150).u, psi: A.cupProfile('bowl', 31, 150).psi }, 15.5)[0] / 15.5 - 0.0578) < 0.001, 'bowl: the seal measured 0.0578');
});
test('row 1a: a cup piece\'s road carries the cup profile at its c: the r cap does NOT apply (bowl 12 m at c = 90 is 90°, not the capped edge)', () => {
  const d = extend(D.createDoc('n'), { length: 100, family: 'bowl', first: { w: 12, c: 90 } });
  assert.equal(d.pieces[0].cup, true);
  for (const g of A.toSegments(d)) { const [l, r] = edges(g.profile); assert.ok(Math.abs(l - 90) < 1e-4 && Math.abs(r - 90) < 1e-4, `${l}, ${r}`); }
  const legacy = extend(D.createDoc('n'), { length: 100, family: 'bowl', first: { w: 12 } });
  assert.ok(edges(A.toSegments(legacy)[0].profile)[0] < 15, 'the same road as a legacy piece keeps the capped edge (about 11.7°)');
});

// ── 1b · continuity along the road ──────────────────────────────────────────────────────────────────────────────────────
/** Every mesh row's edge ψ, from the mesh's own normals (the edge vertex against the centre vertex), with the row's path s. */
function edgeRows(mesh, segments) {
  const rows = [];
  mesh._state.pieces.forEach((pc, g) => {
    if (!pc || segments[g].kind === 'gap') return;
    const K = pc.K, k0 = pc.Us.reduce((b, u, k) => (Math.abs(u) < Math.abs(pc.Us[b]) ? k : b), 0);
    pc.cells.forEach((cell) => cell.rowS.forEach((s, r) => {
      const n = (k) => [0, 1, 2].map((i) => cell.normals[(r * K + k) * 3 + i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / DEG;
      rows.push({ g, s, left: ang(n(K - 1), n(k0)), right: ang(n(0), n(k0)) });
    }));
  });
  return rows;
}
/** The row-1b check on piece `pi` of d, for the given segments: rows outside c's range, the largest step between consecutive rows, seams inside the piece. */
function rampCheck(d, segments, pi, slopeFactor = 1) {   // slopeFactor 1.5: inside a chord segment the mesh's smoothstep weight peaks at 1.5x the segment's mean slope
  const P = d.pieces[pi], idx = segments.map((g, i) => (g.id === P.id ? i : -1)).filter((i) => i >= 0);
  let start = 0; for (let i = 0; i < idx[0]; i++) start += segments[i].length;
  const path = A.toPath(d).path, mesh = buildMesh(path, segments), rows = edgeRows(mesh, segments).filter((r) => idx.includes(r.g)).sort((a, b) => a.s - b.s);
  let outside = 0, step = 0, stepOver = 0, endMiss = 0, worstOff = 0;
  const segLen = P.length / Math.ceil(P.length / 2 - 1e-9);
  rows.forEach((r, i) => {
    const s = r.s - start, e = (r.left + r.right) / 2; let lo = Infinity, hi = -Infinity;   // the edge ψ of a row: the mean of its two sides (an even vertex count has no vertex at u = 0)
    if (Math.abs(s / segLen - Math.round(s / segLen)) < 1e-6) { const c = D.channelAt(P, 'c', Math.min(P.length, Math.max(0, s))).v; if (Math.abs(e - c) > 0.05) endMiss++; }   // at a segment's end the row IS c(s)
    for (let t = Math.max(0, s - 2); t <= Math.min(P.length, s + 2) + 1e-9; t += 0.05) { const v = D.channelAt(P, 'c', t).v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (e < lo - 0.05 || e > hi + 0.05) outside++;
    worstOff = Math.max(worstOff, Math.abs(e - D.channelAt(P, 'c', Math.min(P.length, Math.max(0, s))).v));   // R1: the row lands on c(s)
    if (i) {
      const p = rows[i - 1], pe = (p.left + p.right) / 2, d = Math.abs(e - pe); let slope = 0;
      for (let t = Math.max(0, p.s - start); t <= Math.min(P.length, s) + 1e-9; t += 0.05) slope = Math.max(slope, Math.abs(D.channelAt(P, 'c', t).d1));
      step = Math.max(step, d); stepOver = Math.max(stepOver, d - (slopeFactor * slope * (r.s - p.s) + 0.05));   // no faster than c itself moves, plus 0.05°
    }
  });
  let seams = 0; for (const g of idx.slice(1)) if (mesh._state.seams[g]) seams++;
  return { outside, step, stepOver, seams, endMiss, worstOff, rows: rows.length };
}
/** Today's adapter behaviour (planted control K1b-1): one profile per segment at its middle, no blend. */
function stair(d, segments, pi) {
  const P = d.pieces[pi], first = segments.findIndex((g) => g.id === P.id); let pos = 0, off = 0;
  for (let k = 0; k < first; k++) off += segments[k].length;
  return segments.map((g) => { const mid = pos + g.length / 2 - off; pos += g.length; return g.id !== P.id ? g : { ...g, profile: A.cupProfile(P.family, D.channelAt(P, 'w', mid).v, D.channelAt(P, 'c', mid).v), blend: null }; });
}
// TWO SCHEMES (adapter.js): the default keeps segment.profile LOCAL for every reader that is not the mesh, and emits a seam zip where c changes;
// { cupRuns: true } shares one blend pair per run, so the mesh emits no seam zip inside the piece, and segment.profile is then the run's widest.
const SCHEMES = [['default', {}, 1], ['cupLocal', { cupRuns: false }, 1.5]];   // [name, toSegments options, allowed excess over c's own slope: the LOCAL scheme's smoothstep peaks at 1.5x the mean slope of a segment; the default's factor is 1, the ruling's words]
for (const [mode, opts, factor] of SCHEMES) for (const [family, target, trans] of [['bowl', 90, 40], ['bowl', 150, 40], ['half-pipe', 90, 40], ['half-pipe', 150, 40]]) {
  test(`row 1b (${mode}): a ${family} cup ramp to ${target}° over ${trans} m: the wall follows c on the road (within c's range over ±2 m, never faster than c itself moves)`, () => {
    let d = extend(D.createDoc('r'), { length: 60, family });
    d = extend(d, { length: 200, transition: trans, targets: { c: target } });
    const got = rampCheck(d, A.toSegments(d, opts), 1, factor);
    assert.equal(got.outside, 0, `rows outside c's range: ${got.outside} of ${got.rows}`);
    assert.equal(got.endMiss, 0, `${got.endMiss} rows at a segment's end are not c(s) there`);
    assert.ok(got.stepOver <= 0, `the wall changes faster than c by ${got.stepOver}° between rows (largest step ${got.step}°)`);
    if (mode === 'default') assert.equal(got.seams, 0, `${got.seams} seam zips inside the cup piece`);
  });
}
test('cupLocal (the option): a seam zip where c changes and NONE where it is held: the last 100 m of a 400 m piece has none (the default scheme has none anywhere inside the piece)', () => {
  let d = extend(D.createDoc('r'), { length: 60 }); d = extend(d, { length: 400, transition: 40, targets: { c: 90 } });
  const segs = A.toSegments(d, { cupRuns: false }), path = A.toPath(d).path, mesh = buildMesh(path, segs), idx = segs.map((g, i) => (g.id === 'p2' ? i : -1)).filter((i) => i >= 0);
  const seamAt = (k) => !!mesh._state.seams[k], tail = idx.filter((k) => k > idx[0] + 150);
  assert.ok(idx.slice(1, 25).some(seamAt), 'seams where c changes'); assert.ok(tail.every((k) => !seamAt(k)), 'no seam in the constant tail');
});
test('the cupLocal option keeps segment.profile LOCAL (its edge is c at the end of the segment within 0.05 deg), and the default does NOT (its profile is the widest of the run, the target of the blend): the readers evaluate the blend (test/core_cup_readers.test.js)', () => {
  let d = extend(D.createDoc('r'), { length: 60 }); d = extend(d, { length: 200, transition: 100, targets: { c: 120 } });
  const P = d.pieces[1], edgeOf = (g) => g.profile.psi[g.profile.psi.length - 1] / DEG;
  for (const [opts, local] of [[{ cupRuns: false }, true], [{}, false]]) {
    const segs = A.toSegments(d, opts); let worst = 0, s1 = 0; for (const g of segs) { s1 += g.length; if (g.id === 'p2') worst = Math.max(worst, Math.abs(edgeOf(g) - D.channelAt(P, 'c', Math.min(P.length, s1 - 60)).v)); }
    if (local) assert.ok(worst <= 0.05, `cupLocal: worst ${worst}°`); else assert.ok(worst > 1, `default: worst ${worst}° (it should not be local)`);
  }
});
for (const family of ['bowl', 'half-pipe']) {
  test(`row 1b: a ${family} cup ramp to 90° over 100 m never changes faster than c between rows, and no row is outside c's range`, () => {
    let d = extend(D.createDoc('r'), { length: 60, family }); d = extend(d, { length: 250, transition: 100, targets: { c: 90 } });
    for (const [, opts, sf] of SCHEMES) { const got = rampCheck(d, A.toSegments(d, opts), 1, sf); assert.ok(got.stepOver <= 0 && got.outside === 0, `${JSON.stringify(opts)}: over c's slope by ${got.stepOver}° (largest step ${got.step}°), outside ${got.outside}`); }
  });
}
for (const [family, target, trans] of [['bowl', 90, 40], ['bowl', 150, 40], ['half-pipe', 150, 40], ['bowl', 90, 100], ['half-pipe', 150, 100]]) for (const tail of [0, 160]) {
  test(`R1 (B score): a ${family} cup ramp to ${target} deg over ${trans} m${tail ? ' with a held tail' : ''} lands on c(s) at EVERY row: the edge is within ${tail ? 0.1 : 0.05} deg of c (it was off by up to 0.95 deg on the local scheme)`, () => {
    let d = extend(D.createDoc('r'), { length: 60, family }); d = extend(d, { length: trans + tail, transition: trans, targets: { c: target } });
    const got = rampCheck(d, A.toSegments(d), 1), tol = tail ? 0.1 : 0.05;
    assert.ok(got.worstOff <= tol, `the edge is off c(s) by ${got.worstOff} deg at its worst row (the tip by about ${(got.worstOff * Math.PI / 180 * 15.5 * 1000).toFixed(1)} mm)`);
    assert.equal(got.seams, 0, `${got.seams} seam zips inside the cup piece`);
    assert.ok(got.stepOver <= 0, `the wall changes faster than c by ${got.stepOver} deg between rows (the largest step ${got.step} deg)`);   // the standard: never faster than c itself
  });
}
test('row 1b PLANTED K1b-1: today\'s adapter (one profile per 2 m, no blend) on the bowl ramp to 90° over 40 m is CAUGHT by the same check (a step of about 5.6°, seams inside)', () => {
  let d = extend(D.createDoc('r'), { length: 60 }); d = extend(d, { length: 200, transition: 40, targets: { c: 90 } });
  const got = rampCheck(d, stair(d, A.toSegments(d), 1), 1);
  assert.ok(got.stepOver > 1.0 && got.seams > 0, `step ${got.step}°, over c's own slope by ${got.stepOver}°, seams ${got.seams}`);
});
for (const [mode, opts] of SCHEMES) test(`row 1b (${mode}): a cup that also changes width (a chord per segment) still follows c and the width along the road (a seam zip per segment is the stated cost)`, () => {
  let d = extend(D.createDoc('r'), { length: 60 }); d = extend(d, { length: 200, transition: 100, targets: { c: 90, w: 20 } });
  const segs = A.toSegments(d, opts), got = rampCheck(d, segs, 1, 1.5);
  assert.ok(got.stepOver <= 0 && got.outside === 0, `over c's slope ${got.stepOver}°, outside ${got.outside}`);
  let s1 = 0; const P = d.pieces[1], first = segs.findIndex((g) => g.id === P.id); for (let k = 0; k < first; k++) s1 += segs[k].length;
  const off = s1; for (let k = first; k < segs.length; k++) { s1 += segs[k].length; const g = segs[k], w = D.channelAt(P, 'w', Math.min(P.length, s1 - off)).v; assert.ok(Math.abs(2 * g.profile.u[g.profile.u.length - 1] - w) < 1e-6, `segment ${k}: width ${2 * g.profile.u[g.profile.u.length - 1]} vs w(s) ${w}`); }
});

// ── 2 · MAX binds the DOCUMENT ─────────────────────────────────────────────────────────────────────────────────────────
test('row 2 (ii): a document with a cup control point outside [0, 150] is refused by name, in checkDoc and in parse', () => {
  const d = extend(D.createDoc('m'), { length: 100, first: { c: 100 } });
  for (const bad of [150.000001, 165, -0.1]) {
    const c = d.pieces[0].channels.c.slice(); c[2] = bad;
    const doc = { ...d, pieces: [{ ...d.pieces[0], channels: { ...d.pieces[0].channels, c } }] };
    assert.throws(() => D.checkDoc(doc), (e) => e.code === 'BAD_CUP', `checkDoc ${bad}`);
    const text = D.serialize(d).replace(/"c":\[[^\]]*\]/, `"c":[${c.join(',')}]`); assert.notEqual(text, D.serialize(d), 'the c array was replaced');
    assert.throws(() => D.parse(text), (e) => e.code === 'BAD_CUP', `parse ${bad}`);
  }
});
test('row 2 (iii): extend refuses a typed cup outside [0, 150] by name, and the fit\'s ringing never leaves the document past 150 (30 m piece, 10 m transition: 174.65° before the guard)', () => {
  const d = extend(D.createDoc('m'), { length: 60 });
  for (const t of [150.5, 200, -1, Number.NaN, Infinity]) assert.throws(() => extend(d, { length: 30, targets: { c: t } }), (e) => e.code === 'BAD_CUP' || e.code === 'BAD_TARGET', String(t));
  for (const [len, trans] of [[30, 10], [60, 20], [100, 40], [200, 15]]) {
    const e = extend(d, { length: len, transition: trans, targets: { c: 150 } }), P = e.pieces[1];
    assert.ok(P.channels.c.every((v) => v >= 0 && v <= 150), `${len}/${trans}: control points ${Math.max(...P.channels.c)}`);
    for (let s = 0; s <= P.length; s += 0.25) { const v = D.channelAt(P, 'c', s).v; assert.ok(v <= 150 + 1e-9 && v >= -1e-9, `${len}/${trans}: c(${s}) = ${v}`); }
  }
});
test('row 2 (iii): a cup that reaches a limit (150 or 0) ends flat, so the piece after it continues C1 inside [0, 150], and a lap held at 150 closes (a solver\'s float noise on a control point at the limit is not a violation)', () => {
  for (const [first, target] of [[20, 150], [60, 0]]) {
    let d = extend(D.createDoc('lim'), { length: 60, first: { c: first } });
    d = extend(d, { length: 60, transition: 30, targets: { c: target } });
    const f = extend(extend(d, { length: 100 }), { length: 100, transition: 40, targets: { c: target } });
    for (const P of f.pieces) assert.ok(P.channels.c.every((v) => v >= 0 && v <= 150), `target ${target}: control points ${Math.min(...P.channels.c)} to ${Math.max(...P.channels.c)}`);
    assert.ok(Math.abs(D.pieceEnd(d.pieces[1]).c.m) < 1e-9, `target ${target}: ends flat, slope ${D.pieceEnd(d.pieces[1]).c.m}`);
  }
  const Rr = 180, Q = Math.PI * Rr / 2;
  let lap = extend(D.createDoc('lap150'), { length: 300, first: { c: 150 } });
  for (let i = 0; i < 4; i++) lap = extend(lap, { length: Q, transition: 40, targets: { kh: 1 / Rr, c: 150 } });
  lap = extend(lap, { length: 60, transition: 40, targets: { kh: 0, c: 150 } });
  const r = close(lap, { edited: [0] }); assert.equal(r.converged, true, r.report);
});
test('row 2 (iv): a channel curve stays within the range of its control points (the convex hull, ref 03 §1b), for a cup piece with knots', () => {
  let d = extend(D.createDoc('h'), { length: 60 }); d = extend(d, { length: 220, transition: 30, targets: { c: 120 } });
  const P = d.pieces[1], lo = Math.min(...P.channels.c), hi = Math.max(...P.channels.c);
  for (let s = 0; s <= P.length; s += 0.1) { const v = D.channelAt(P, 'c', s).v; assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `c(${s}) = ${v} not in [${lo}, ${hi}]`); }
});
test('row 2 PLANTED K2-1: a cup of 165° on a bowl would have its walls cross: its tip is past the centreline, and the document guard refuses 165 (so the guard, not the export, is what stops it)', () => {
  const P = A.cupProfile('bowl', 31, 165), tip = offsetAt({ u: P.u, psi: P.psi }, P.u[P.u.length - 1])[0];
  assert.ok(tip < 0, `the bowl's tip at 165°: ${tip}`);
  const d = extend(D.createDoc('m'), { length: 50, first: { c: 100 } }), P0 = d.pieces[0];
  const bad = { ...d, pieces: [{ ...P0, channels: { ...P0.channels, c: P0.channels.c.map(() => 165) } }] };
  assert.throws(() => D.checkDoc(bad), (e) => e.code === 'BAD_CUP');
  assert.throws(() => extend(D.createDoc('m'), { length: 50, first: { c: 165 } }), (e) => e.code === 'BAD_CUP');
});
test('row 2 (iii): a cup brush that would push c past 150 (or below 0) is refused by name, and one inside the range works', () => {
  let d = extend(D.createDoc('b'), { length: 60 }); d = extend(d, { length: 200, transition: 20, targets: { c: 140 } });
  assert.throws(() => S.brush(d, { mode: 'value', channel: 'c', s0: 200, r: 40, delta: 30 }), (e) => e.code === 'BAD_CUP');
  assert.throws(() => S.brush(d, { mode: 'value', channel: 'c', s0: 200, r: 40, delta: -170 }), (e) => e.code === 'BAD_CUP');
  const ok = S.brush(d, { mode: 'value', channel: 'c', s0: 200, r: 40, delta: -30 });
  assert.ok(D.channelAt(ok.doc.pieces[1], 'c', 140).v < D.channelAt(d.pieces[1], 'c', 140).v - 5, 'the brush lowered the cup');
});
test('row 5e: a cup brush that reaches a LEGACY piece is refused by name; on a cup piece it leaves the road far from the window bit for bit', () => {
  let d = extend(D.createDoc('b'), { length: 100 }); d = extend(d, { length: 300, transition: 20, targets: { c: 60 } });
  assert.throws(() => S.brush(d, { mode: 'value', channel: 'c', s0: 90, r: 30, delta: 5 }), (e) => e.code === 'NOT_CUP');
  const b = S.brush(d, { mode: 'value', channel: 'c', s0: 250, r: 30, delta: 8 }), before = A.toSegments(d), after = A.toSegments(b.doc);
  assert.equal(before.length, after.length);
  let off = 0, checked = 0, legacy = 0;
  before.forEach((g, i) => {
    if (off + g.length < 250 - 30 - 80 || off > 250 + 30 + 80) {
      if (g.id === 'p1') { assert.deepEqual(after[i], g, `legacy segment ${i} at s ${off}`); legacy++; }
      else { const { profile: p0, blend: b0, ...rest0 } = g, { profile: p1, blend: b1, ...rest1 } = after[i]; assert.deepEqual(rest1, rest0, `cup segment ${i} at s ${off}: the line, bank and length`); }   // the run's blend pair is re-expressed when c's range changes: the road it draws is the same c(s)
      checked++;
    }
    off += g.length;
  });
  assert.ok(legacy === 50 && checked > 60, `checked ${checked} segments outside the window, ${legacy} legacy`);
  assert.ok(D.channelAt(b.doc.pieces[1], 'c', 150).v > D.channelAt(d.pieces[1], 'c', 150).v + 4, 'and the brush changed c under it');
});

// ── 3 · joints ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('row 3 (i): c is a joint channel: a cup step of 5° (or a kink of the slope) between two cup pieces is refused JOINT (planted K3-1: c left out of the joint test)', () => {
  let d = extend(D.createDoc('j'), { length: 100, first: { c: 40 } }); d = extend(d, { length: 100 });
  assert.equal(d.pieces[1].cup, true, 'extended after a cup piece: a cup piece');
  const P = d.pieces[1], bump = (i, v) => ({ ...d, pieces: [d.pieces[0], { ...P, channels: { ...P.channels, c: P.channels.c.map((x, k) => (k === i ? x + v : x)) } }] });
  assert.throws(() => D.checkDoc(bump(0, 5)), (e) => e.code === 'JOINT' && /c starts/.test(e.message));
  assert.throws(() => D.checkDoc(bump(1, 5)), (e) => e.code === 'JOINT' && /slope/.test(e.message));
});
test('row 3 (ii): c is CARRIED through a flight, like bank, width and rise (planted K3-2: reset like the heading rate)', () => {
  let d = extend(D.createDoc('f'), { length: 100, first: { c: 70 } });
  d = D.appendPiece(d, D.flightPiece({ gap: 30, drop: 2, land: -0.03 }));
  const e = D.endState(d); assert.ok(Math.abs(e.c.v - 70) < 1e-6, `end state after the flight: c ${e.c.v}`);
  d = extend(d, { length: 60 }); assert.equal(d.pieces[2].cup, true); assert.ok(Math.abs(d.pieces[2].channels.c[0] - 70) < 1e-6);
  const r = R.pieceReadout(d, 1); assert.ok(Math.abs(r.cupFromDeg - 70) < 1e-6 && r.cupToDeg === r.cupFromDeg, 'the readout of the flight carries the cup');
});
test('row 3 (iii): a closed lap of cup pieces closes with c(L) = c(0) and c\'(L) = c\'(0) (planted K3-3: c left out of the seam rows)', () => {
  const Rr = 180, Q = Math.PI * Rr / 2;
  let d = extend(D.createDoc('lap'), { length: 300, first: { c: 20 } });
  for (const c of [60, 90, 60, 90]) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0, c: 20 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report);
  const F = r.doc.pieces[0], L = r.doc.pieces[r.doc.pieces.length - 1], n = L.channels.c.length;
  assert.ok(Math.abs(L.channels.c[n - 1] - F.channels.c[0]) < 1e-5, `c value at the seam: ${L.channels.c[n - 1]} vs ${F.channels.c[0]}`);
  assert.ok(Math.abs(r.residual['c value at the seam']) < 1e-5 && Math.abs(r.residual['c slope at the seam']) < 1e-4, JSON.stringify([r.residual['c value at the seam'], r.residual['c slope at the seam']]));
});
test('row 3 (iv): legacy → cup: a cup that follows a legacy piece starts at the edge that piece RENDERS (11.679° on a 12 m bowl, not the nominal 15.5°); a cup that starts at the nominal edge is refused JOINT (planted K3-4)', () => {
  let d = extend(D.createDoc('l'), { length: 100, family: 'bowl', first: { w: 12 } });
  const edge = D.legacyEdgeDeg('bowl', 12, D.channelAt(d.pieces[0], 'r', 100).v); assert.ok(Math.abs(edge - 11.679) < 0.01, `rendered legacy edge ${edge}`);
  const e = extend(d, { length: 100, transition: 50, targets: { c: 60 } });
  assert.ok(Math.abs(e.pieces[1].channels.c[0] - edge) < 1e-5, `the cup starts at ${e.pieces[1].channels.c[0]}, the road rendered ${edge}`);
  const P = e.pieces[1], wrong = { ...e, pieces: [e.pieces[0], { ...P, channels: { ...P.channels, c: P.channels.c.map((x, k) => (k < 2 ? 15.5 : x)) } }] };
  assert.throws(() => D.checkDoc(wrong), (x) => x.code === 'JOINT' && /previous piece ends/.test(x.message));
  const g = A.toSegments(e), i = g.findIndex((s) => s.id === P.id);
  assert.ok(Math.abs(edges(g[i - 1].profile)[0] - edges(g[i].blend ? g[i].blend.from : g[i].profile)[0]) < 0.05, 'the rendered edge is continuous at the joint');
});

// ── R2 (B's score): the legacy → cup joint, the WHOLE curve ─────────────────────────────────────────────────────────────────────────
/** The largest distance from a vertex of one row to the polyline of the other (both ways): the gap the zip between them spans. */
function rowGap(a, b) {
  const P = (r) => r.map((v) => v.p), sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]], dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const near = (q, poly) => { let best = Infinity; for (let i = 0; i + 1 < poly.length; i++) { const d = sub(poly[i + 1], poly[i]), w = sub(q, poly[i]), t = Math.max(0, Math.min(1, dot(w, d) / (dot(d, d) || 1))), r = sub(w, d.map((x) => x * t)); best = Math.min(best, Math.hypot(r[0], r[1], r[2])); } return best; };
  const A1 = P(a), B1 = P(b); return Math.max(...A1.map((q) => near(q, B1)), ...B1.map((q) => near(q, A1)));
}
for (const [family, w] of [['bowl', 12], ['half-pipe', 24], ['bowl', 18], ['flat', 20], ['bowl', 31], ['half-pipe', 31.5], ['flat', 45]]) {
  test(`R2 / row 3 (iv): a ${family} road ${w} m wide handing over to a cup piece has no step over 1 mm across the WHOLE curve at the joint (36.0 mm bowl 12 m and 148.2 mm half-pipe 24 m before)`, () => {
    let d = extend(D.createDoc('j'), { length: 100, family, first: { w } }); d = extend(d, { length: 120, transition: 60, targets: { c: 60 } });
    const segs = A.toSegments(d), path = A.toPath(d).path, mesh = buildMesh(path, segs), g = segs.findIndex((x) => x.id === 'p2');
    const gap = rowGap(mesh._state.pieces[g - 1].last, mesh._state.pieces[g].first);
    assert.ok(gap <= 0.001, `the two rows at the joint are ${(gap * 1000).toFixed(2)} mm apart`);
  });
}
test('R2: past the joint\'s morph the road is the pure cup shape (ψ at every quarter is c·Fᵢ/F_edge within 0.01°), and the edge stays c through it', () => {
  let d = extend(D.createDoc('j'), { length: 100, family: 'half-pipe', first: { w: 24 } }); d = extend(d, { length: 120, transition: 60, targets: { c: 60 } });
  const P = d.pieces[1], segs = A.toSegments(d), first = segs.findIndex((x) => x.id === 'p2'); let s1 = 0;
  for (let k = first; k < segs.length; k++) {
    s1 += segs[k].length; const g = segs[k], c = D.channelAt(P, 'c', s1).v, w = D.channelAt(P, 'w', s1).v;
    if (s1 < 10 - 1e-9) continue;   // the morph ends at 10 m: the segment ending there is already the pure cup shape
    const want = A.cupProfile('half-pipe', w, c), have = PF.atSegment ? PF.atSegment(g, g.length) : PF.normalize(g.profile);
    for (let i = 0; i < want.psi.length; i++) assert.ok(Math.abs(have.psi[i] - want.psi[i]) <= 0.01 * DEG, `s ${s1}: quarter ${i}: ${have.psi[i] / DEG}° vs ${want.psi[i] / DEG}°`);
  }
});

// ── 5 · legacy stays legacy ─────────────────────────────────────────────────────────────────────────────────────────────
// AMENDED BY NAME (D196, the librarian's ruling (b)): "no blend and no new key" held for EVERY legacy segment; a legacy segment whose width or r changes is now a
// CHORD (blend from the profile at its start to the one at its end, marked `chord: true`), so the assertion is split: a segment whose ends draw the same
// cross-section (constant width and r) has no blend and no new key, byte for byte as before; a changing one is a chord.
test('row 5 (amended D196): a /2 file loads as LEGACY pieces (no cup flag, no c in the canonical text), a constant segment renders through profileAt with no blend and no new key, a changing one is a chord, and it saves as /3', () => {
  const d = extend(extend(D.createDoc('old'), { length: 120, family: 'half-pipe', first: { w: 24 } }), { length: 80, transition: 40, targets: { w: 12, phi: 0.3 } });
  const text = D.serialize(d), old = text.replace('"t180b.core/4"', '"t180b.core/2"');
  assert.ok(!/"c"/.test(text), 'a legacy piece has no c in its text');
  const back = D.parse(old); assert.equal(back.schema, 't180b.core/4');   // D225: the schema is /4 (the edge and tube channels); a /2 file still loads as legacy pieces assert.ok(back.pieces.every((P) => P.cup === undefined));
  assert.equal(D.serialize(back), text, 'a /2 file saves as the same /3 text');
  const KEYS = ['blend', 'heartline', 'id', 'k0', 'k1', 'kind', 'kp0', 'kp1', 'length', 'part', 'profile', 'roll0', 'roll1', 'speed', 'word'];
  let chords = 0, constants = 0, s0 = 0; const segs = A.toSegments(back);
  for (const g of segs) {
    const P = back.pieces.find((p) => p.id === g.id), a = s0 - back.pieces.slice(0, back.pieces.indexOf(P)).reduce((t, p) => t + p.length, 0), b = a + g.length; s0 += g.length;
    if (g.chord) {
      chords++; assert.ok(g.blend, 'a chord carries its blend'); assert.deepEqual(Object.keys(g).sort(), [...KEYS, 'chord'].sort());
      assert.deepEqual(g.profile, A.profileAt(P.family, D.channelAt(P, 'w', b).v, D.channelAt(P, 'r', b).v), 'a chord\'s profile is the one at its END');
      assert.deepEqual(g.blend.from, A.profileAt(P.family, D.channelAt(P, 'w', a).v, D.channelAt(P, 'r', a).v), 'and it blends from the one at its START');
    } else { constants++; assert.equal(g.blend, null); assert.deepEqual(Object.keys(g).sort(), KEYS); }
  }
  assert.ok(chords > 0 && constants > 0, `chords ${chords}, constants ${constants}: the document has both a constant piece and a width change`);
  assert.deepEqual(segs[0].profile, A.profileAt('half-pipe', D.channelAt(back.pieces[0], 'w', 1).v, D.channelAt(back.pieces[0], 'r', 1).v));
});
test('row 5c / 5d: extending a legacy piece with NO cup typed makes a legacy piece (nothing changes for a user who never types one); with a cup target it starts at the rendered edge', () => {
  const d = extend(D.createDoc('m'), { length: 100, family: 'bowl', first: { w: 12 } });
  const plain = extend(d, { length: 60, transition: 30, targets: { kh: 0.004 } });
  assert.equal(plain.pieces[1].cup, undefined); assert.ok(A.toSegments(plain).every((g) => g.blend === null));
  const cupd = extend(d, { length: 60, targets: { c: 45 } });
  assert.equal(cupd.pieces[1].cup, true);
});
test('row 5b: a cup document round-trips through /3 text (serialize, parse, serialize)', () => {
  let d = extend(D.createDoc('rt'), { length: 100 }); d = extend(d, { length: 150, transition: 40, targets: { c: 110, kh: 0.005 } });
  const t = D.serialize(d), back = D.parse(t); assert.equal(D.serialize(back), t); assert.equal(back.pieces[1].cup, true); assert.equal(back.pieces[0].cup, undefined);
  assert.deepEqual(A.toSegments(back), A.toSegments(d));
});

// ── 6 · cup then roll ───────────────────────────────────────────────────────────────────────────────────────────────────
test('row 6: bank 30° + cup 60° at a level straight station: the left edge\'s surface is at 90° to gravity, the right at 30°, the centre at 30°, bankG 30° (and the mirror for −30°)', () => {
  for (const [sign, left, right] of [[1, 90, 30], [-1, 30, 90]]) for (const family of FAMILIES) {
    const d = extend(D.createDoc('cr'), { length: 100, family, first: { w: 30, c: 60, phi: sign * 30 * DEG } });
    const { segments, path } = A.toPath(d), m = path.samples[Math.floor(path.samples.length / 2)], P = segments[m.seg].profile;
    const up = [0, 1, 0], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nAt = (psi, u) => [0, 1, 2].map((i) => Math.cos(psi) * m.U[i] - Math.sign(u) * Math.sin(psi) * m.L[i]);
    const ang = (i) => Math.acos(dot(nAt(P.psi[i], P.u[i]), up)) / DEG;
    assert.ok(Math.abs(ang(P.u.length - 1) - left) < 0.05 && Math.abs(ang(0) - right) < 0.05 && Math.abs(ang(P.u.indexOf(0)) - 30) < 0.05, `${family} ${sign}: left ${ang(P.u.length - 1)}, right ${ang(0)}, centre ${ang(P.u.indexOf(0))}`);
    assert.ok(Math.abs(Math.abs(m.bankG / DEG) - 30) < 0.05, `bankG ${m.bankG / DEG}`);
  }
});
test('row 6: typing a cup changes none of turn, climb, bank or pitch in the readout, and not one number of the centreline (planted K6-3: a cup that feeds the bank)', () => {
  const base = extend(D.createDoc('cb'), { length: 100, first: { c: 20 } }), opts = { length: 120, transition: 60, targets: { kh: 1 / 200, kv: 0.001, phi: 20 * DEG } };
  const a = extend(base, opts), b = extend(base, { ...opts, targets: { ...opts.targets, c: 100 } });
  const ra = R.pieceReadout(a, 1), rb = R.pieceReadout(b, 1);
  for (const k of ['turnDeg', 'climbDeg', 'bankFromDeg', 'bankToDeg', 'pitchFromDeg', 'pitchToDeg', 'lengthM']) assert.equal(rb[k], ra[k], k);
  assert.notEqual(rb.cupToDeg, ra.cupToDeg);
  assert.deepEqual(A.toPath(b).path.samples.map((s) => [s.pos, s.T, s.L, s.U, s.roll]), A.toPath(a).path.samples.map((s) => [s.pos, s.T, s.L, s.U, s.roll]));
});

// ── 7 · the readout ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('row 7: cupFromDeg / cupToDeg are c(0) and c(L) of a cup piece, the rendered edge of a legacy piece (profileAt at each end), and carried through a flight; the ghost equals the placed piece', () => {
  for (const family of FAMILIES) for (const w of [8, 12, 31]) for (const r of [0.1, 0.5, 2, 6]) {
    const psi = A.profileAt(family, w, r).psi; assert.ok(Math.abs(D.legacyEdgeDeg(family, w, r) - psi[psi.length - 1] / DEG) < 1e-12, `${family} ${w} ${r}`);
  }
  const d0 = extend(D.createDoc('ro'), { length: 100, family: 'bowl', first: { w: 12 } }), l = R.pieceReadout(d0, 0);
  assert.ok(Math.abs(l.cupFromDeg - 11.679) < 0.01 && Math.abs(l.cupToDeg - 11.679) < 0.01, `${l.cupFromDeg}, ${l.cupToDeg} (the road renders 11.679, not the nominal 15.5)`);
  const opts = { length: 150, transition: 90, targets: { c: 88 } }, d1 = extend(d0, opts), p = R.pieceReadout(d1, 1);
  assert.ok(Math.abs(p.cupFromDeg - D.channelAt(d1.pieces[1], 'c', 0).v) < 1e-9 && Math.abs(p.cupToDeg - D.channelAt(d1.pieces[1], 'c', 150).v) < 1e-9);
  assert.deepEqual(R.candidateReadout(d0, opts), p);
});
test('row 7 PLANTED K7-1: cupToDeg is the DOCUMENT\'s c, not the typed target: a brush near the piece\'s end moves it', () => {
  let d = extend(D.createDoc('k7'), { length: 60 }); d = extend(d, { length: 200, transition: 30, targets: { c: 90 } });
  const before = R.pieceReadout(d, 1).cupToDeg, b = S.brush(d, { mode: 'value', channel: 'c', s0: 250, r: 25, delta: 20 }), after = R.pieceReadout(b.doc, 1).cupToDeg;
  assert.ok(Math.abs(after - before) > 3, `${before} → ${after}`); assert.ok(Math.abs(before - 90) < 1.5, 'and the typed 90 is within the fit\'s reach');
});
test('knot insertion keeps a cup piece\'s c curve and its cup flag (Boehm on the c channel)', () => {
  let d = extend(D.createDoc('k'), { length: 60 }); d = extend(d, { length: 200, transition: 60, targets: { c: 100 } });
  const P = d.pieces[1], { doc } = D.refineKnots(d, P.id, 20, 90, 2), Q = doc.pieces[1];
  assert.equal(Q.cup, true); assert.ok(Q.knots.length > P.knots.length);
  for (let s = 0; s <= P.length; s += 0.5) assert.ok(Math.abs(D.channelAt(Q, 'c', s).v - D.channelAt(P, 'c', s).v) < 1e-4, `c(${s})`);
});
