// core_sculpt_modes.test.js: node --test test/core_sculpt_modes.test.js   (heavy: run under the heavy-run lock at 4 GB)
// src/core/sculpt.js `brush` (D186, pane E): the brush MODES. A hill and a swerve are local brushes on the OFFSET channels
// (height, lateral); a rate brush is explicit and re-closes a closed lap; bank, width and rise are value channels, local already.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./core_helpers.js');
const D = require('../src/core/document.js');
const { toPath } = require('../src/core/adapter.js');
const S = require('../src/core/sculpt.js');
const C = require('../src/core/close.js');

const OPEN = H.docFrom(H.gen()[0]);
const CLOSED = C.close(H.docFrom(H.gen()[1])).doc;
const samples = (doc) => toPath({ ...doc, closed: false }).path.samples;
const span = (doc) => Math.max(...doc.pieces.map((P) => { const t = [0, ...P.knots, P.length]; return Math.max(...t.slice(1).map((x, k) => x - t[k])); }));
const FIELDS = ['pos', 'T', 'L', 'U', 'kvec', 'roll', 'bankG', 'grade'];
const same = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((v, i) => Object.is(v, b[i])) : Object.is(a, b));

const OFFSETS = D.CHANNELS.includes('h') && D.CHANNELS.includes('l');
const NO_OFFSETS = !OFFSETS && 'the document has no offset channels h and l yet (A: src/core/README.md); these run once it does';
test('the default brush is a HILL, and while the document has no height channel it is refused by name (never faked through the rate)', { skip: OFFSETS && 'the offset channels are in: the hill tests below run instead' }, () => {
  assert.throws(() => S.brush(OPEN, { s0: 2000, r: 100, delta: 5 }), /NOT_YET.*"h"/);
  assert.throws(() => S.brush(OPEN, { mode: 'swerve', s0: 2000, r: 100, delta: 3 }), /NOT_YET.*"l"/);
});
test('a value brush (bank) leaves every sample past W⁺ bit for bit, and calls no close', () => {
  const s0 = 2000, r = 100, hi = s0 + r + 2 * span(OPEN), res = S.brush(OPEN, { mode: 'value', channel: 'phi', s0, r, delta: 0.1 });
  assert.equal(res.close, undefined);
  const a = samples(OPEN), b = samples(res.doc);
  b.forEach((x, i) => { if (x.s > hi) for (const f of FIELDS) assert.ok(same(x[f], a[i][f]), `${f} at ${x.s}`); });
});
test('a RATE brush must be asked for: a heading-rate channel under the hill or value mode is refused', () => {
  assert.throws(() => S.brush(OPEN, { mode: 'value', channel: 'kh', s0: 2000, r: 100, delta: 0.001 }), /BAD_CHANNEL/);
  assert.throws(() => S.brush(OPEN, { mode: 'dig', s0: 2000, r: 100, delta: 1 }), /BAD_MODE/);
});
test('a RATE brush on an OPEN track changes the track downstream and does not close it', () => {
  const res = S.brush(OPEN, { mode: 'rate', channel: 'kh', s0: 2000, r: 100, delta: 0.001 });
  assert.equal(res.close, undefined);
  assert.equal(res.doc.closed, false);
  const a = samples(OPEN).at(-1).pos, b = samples(res.doc).at(-1).pos;
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1, 'the end did not move');
});
test('a RATE brush on a CLOSED track re-closes it, with the brushed stretch protected', () => {
  assert.ok(CLOSED.closed);
  const s0 = 1500, res = S.brush(CLOSED, { mode: 'rate', channel: 'kh', s0, r: 100, delta: 0.001 });
  assert.ok(res.close && res.close.converged, res.close && res.close.report);
  assert.ok(res.doc.closed);
  const sm = samples(res.doc), a = sm[0].pos, z = sm.at(-1).pos;
  assert.ok(Math.hypot(a[0] - z[0], a[1] - z[1], a[2] - z[2]) < 0.01, 'the re-closed lap is open');
  // the user's brush survives the re-close: the brushed pieces' heading rate moved by less than 1% of the brush itself
  for (const { piece } of res.changed) {
    const before = S.sculpt({ ...CLOSED, closed: false }, { channel: 'kh', s0, r: 100, delta: 0.001 }).doc.pieces[piece].channels.kh;
    const worst = Math.max(...res.doc.pieces[piece].channels.kh.map((v, i) => Math.abs(v - before[i])));
    assert.ok(worst < 0.01 * 0.001, `piece ${piece}: the close moved the brushed stretch by ${worst}`);
  }
});
test('a RATE brush has no kink at its edges: κ_new − κ_old steps no more at the edges than inside', () => {
  const s0 = 2000, r = 100, res = S.brush(OPEN, { mode: 'rate', channel: 'kv', s0, r, delta: 0.0005 }), ru = res.radiusUsed;
  const a = samples(OPEN), b = samples(res.doc);
  const k = (sm, i) => { const u = [0, 1, 2].map((j) => sm[i].pos[j] - sm[i - 1].pos[j]), w = [0, 1, 2].map((j) => sm[i + 1].pos[j] - sm[i].pos[j]), lu = Math.hypot(...u), lw = Math.hypot(...w); return Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (lu * lw)))) / ((lu + lw) / 2); };
  const KD = []; for (let i = 1; i + 1 < b.length; i++) KD.push({ s: b[i].s, k: k(b, i) - k(a, i) });
  let mid = 0; for (let i = 1; i < KD.length; i++) if (Math.abs(KD[i].s - s0) <= ru / 2) mid = Math.max(mid, Math.abs(KD[i].k - KD[i - 1].k));
  for (const e of [s0 - ru, s0 + ru]) { let edge = 0; for (let i = 1; i < KD.length; i++) if (Math.abs(KD[i].s - e) <= 5) edge = Math.max(edge, Math.abs(KD[i].k - KD[i - 1].k)); assert.ok(edge <= mid + 1e-12, `edge ${e}: ${edge} > ${mid}`); }
});

// ── the hill and the swerve (they need the offset channels; the rules follow B's sealed hill test, amendment 2 A2-4) ──
for (const [mode, ch, dy] of [['hill', 'h', 5], ['hill', 'h', -5], ['swerve', 'l', 3]]) for (const r of [20, 100]) {
  test(`a ${mode} of ${dy} m, r ${r} m: upstream and downstream bit for bit, no close, the other channels untouched, the peak as asked`, { skip: NO_OFFSETS }, () => {
    const s0 = 2050, res = S.brush(OPEN, { mode, s0, r, delta: dy }), doc = res.doc, off = S.pieceOffsets(doc);
    assert.equal(res.close, undefined);
    let h = 0; doc.pieces.forEach((Q, p) => { const t = [0, ...Q.knots, Q.length]; for (let k = 0; k + 1 < t.length; k++) if (off[p] + t[k + 1] >= s0 - r && off[p] + t[k] <= s0 + r) h = Math.max(h, t[k + 1] - t[k]); });
    const loP = s0 - r - 2 * h, hiP = s0 + r + 2 * h, a = toPath(OPEN).path, b = toPath(doc).path;
    assert.equal(b.samples.length, a.samples.length); assert.ok(Math.abs(b.lengthM - a.lengthM) < 1e-6, 'the path length changed');
    b.samples.forEach((x, i) => { if (x.s >= loP && x.s <= hiP) return; for (const f of FIELDS) assert.ok(same(x[f], a.samples[i][f]), `${f} at ${x.s}`); });
    doc.pieces.forEach((Q, p) => { for (const c of D.CHANNELS) if (c !== ch) assert.ok(same(Q.channels[c], OPEN.pieces[p].channels[c]), `${c} of piece ${p} changed`); });
    // the peak: along world up for a hill, along the horizontal left for a swerve
    let best = 0; b.samples.forEach((x, i) => { if (Math.abs(x.s - s0) > r + 2 * h) return; const d = [0, 1, 2].map((k) => x.pos[k] - a.samples[i].pos[k]); const v = mode === 'hill' ? d[1] : Math.hypot(d[0], d[2]) * Math.sign(dy); if (Math.abs(v) > Math.abs(best)) best = v; });
    assert.ok(Math.abs(best - dy) < 1e-3, `peak ${best} for ${dy}`);
  });
}
test('a SHARP brush (refine first) acts at the asked radius, and costs what the hand-back says: it is opt-in', { skip: typeof D.refineKnots !== 'function' && 'document.js has no refineKnots yet (A)' }, () => {
  const res = S.brush(OPEN, { mode: 'value', channel: 'phi', s0: 2050, r: 20, delta: 0.1, sharp: true });
  assert.ok(Math.abs(res.radiusUsed - 20) < 0.01, `radius ${res.radiusUsed}`);   // 3 refined spans; knots are quantised to 0.1 mm
  assert.ok(S.brush(OPEN, { mode: 'value', channel: 'phi', s0: 2050, r: 20, delta: 0.1 }).radiusUsed > 20, 'the default widens');
});

// ── the chair's D186 tests for a refined (sharp) brush, on the three D185 misses (r = 20 m on kh and kv) ──
const NO_REFINE = typeof D.refineKnots !== 'function' && 'document.js has no refineKnots yet (A)';
const kappaChangeEdges = (before, after, s0, r) => {
  const a = samples(before), b = samples(after);
  const k = (sm, i) => { const u = [0, 1, 2].map((j) => sm[i].pos[j] - sm[i - 1].pos[j]), w = [0, 1, 2].map((j) => sm[i + 1].pos[j] - sm[i].pos[j]), lu = Math.hypot(...u), lw = Math.hypot(...w); return Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (lu * lw)))) / ((lu + lw) / 2); };
  const KD = []; for (let i = 1; i + 1 < b.length; i++) KD.push({ s: b[i].s, k: k(b, i) - k(a, i) });
  let mid = 0; for (let i = 1; i < KD.length; i++) if (Math.abs(KD[i].s - s0) <= r / 2) mid = Math.max(mid, Math.abs(KD[i].k - KD[i - 1].k));
  return [s0 - r, s0 + r].map((e) => { let edge = 0; for (let i = 1; i < KD.length; i++) if (Math.abs(KD[i].s - e) <= 5) edge = Math.max(edge, Math.abs(KD[i].k - KD[i - 1].k)); return { e, edge, mid }; });
};
for (const [ch, frac, delta] of [['kh', 0.25, 0.002], ['kh', 0.75, 0.002], ['kv', 0.25, 0.001]]) {
  test(`a SHARP rate brush on ${ch} at ${frac * 100}%, r 20 m (a D185 miss): C2 at s₀ ± 20 on κ_new − κ_old, at the asked radius`, { skip: NO_REFINE }, () => {
    const L = samples(OPEN).at(-1).s, s0 = frac * L, res = S.brush(OPEN, { mode: 'rate', channel: ch, s0, r: 20, delta, sharp: true });
    assert.ok(Math.abs(res.radiusUsed - 20) < 0.01, `radius ${res.radiusUsed}`);   // 3 refined spans; knots are quantised to 0.1 mm
    for (const { e, edge, mid } of kappaChangeEdges(OPEN, res.doc, s0, 20)) assert.ok(edge <= mid + 1e-12, `edge ${e}: ${edge} > ${mid}`);
  });
}
test('a refinement ALONE leaves the curve unchanged up to its stored step: every channel within 2 of its quanta, everywhere (1.69 measured)', { skip: NO_REFINE }, () => {
  const P = OPEN.pieces[4], ref = D.refineKnots(OPEN, P.id, 0, P.length, 5).doc, Q = ref.pieces[4];
  assert.ok(Q.knots.length > P.knots.length, 'nothing was inserted');
  for (const c of D.CHANNELS) for (let k = 0; k <= 400; k++) { const s = (k * P.length) / 400, d = Math.abs(D.channelAt(Q, c, s).v - D.channelAt(P, c, s).v);
    assert.ok(d <= 2 * 10 ** -D.DEC[c], `${c} at ${s}: ${d}`); }
});
test('undo removes both the brush and its knots: one commit, one undo, the document as it was', { skip: NO_REFINE }, () => {
  let h = D.createHistory(OPEN);
  h = D.commit(h, S.brush(OPEN, { mode: 'value', channel: 'phi', s0: 2050, r: 20, delta: 0.1, sharp: true }).doc);
  assert.notEqual(D.serialize(h.present), D.serialize(OPEN));
  h = D.undo(h);
  assert.equal(D.serialize(h.present), D.serialize(OPEN));
});

// ── the chair's D186 ruling 2: the sharp brush's spill stays within its DECLARED bound, and the brush reports it ──
for (const ch of ['phi', 'w', 'h']) {
  test(`a SHARP ${ch} brush, r 20 m: outside W⁺ every channel moves under half a quantum and the track past it under 0.1 mm, as declared`, { skip: NO_REFINE }, () => {
    const L = samples(OPEN).at(-1).s, s0 = 0.25 * L, r = 20, sp = span(OPEN), loP = s0 - r - 2 * sp, hiP = s0 + r + 2 * sp;
    const res = S.brush(OPEN, { mode: 'value', channel: ch, s0, r, delta: ch === 'phi' ? 0.17 : 2, sharp: true });
    assert.equal(res.note, S.SHARP_NOTE); assert.deepEqual(res.sharp, S.SHARP_BOUND);
    const offN = S.pieceOffsets(res.doc), offO = S.pieceOffsets(OPEN);
    const at = (doc, off, c, s) => { let p = off.findIndex((o, i) => s >= o && (i === off.length - 1 || s < off[i + 1])); return D.channelAt(doc.pieces[p], c, Math.min(s - off[p], doc.pieces[p].length)).v; };
    const a = samples(OPEN), b = samples(res.doc);
    b.forEach((x, i) => { if (x.s >= loP && x.s <= hiP) return;
      for (const c of D.CHANNELS) assert.ok(Math.abs(at(res.doc, offN, c, x.s) - at(OPEN, offO, c, x.s)) < S.SHARP_BOUND.quantaOutside * 10 ** -D.DEC[c], `${c} at ${x.s}`);
      if (x.s > hiP) assert.ok(Math.hypot(...[0, 1, 2].map((k) => x.pos[k] - a[i].pos[k])) < S.SHARP_BOUND.pathM, `the track at ${x.s}`); });
  });
}
test('the brush always reports the radius it used (the default widens, and says how far)', () => {
  const res = S.brush(OPEN, { mode: 'value', channel: 'w', s0: 2050, r: 5, delta: 1 });
  assert.ok(res.radiusUsed > 5); assert.match(res.note, /widened from 5 m/);
  assert.equal(S.brush(OPEN, { mode: 'value', channel: 'w', s0: 2050, r: 100, delta: 1 }).radiusUsed, 100);
});
// ── D421 (the user, 2026-10-20 01:32: "brush mode froze the program"): THE BRUSH STEP FITS A FRAME. A drag reruns the brush on its base document at every
// step; the hill and the swerve find their peak by reading the channel every 0.25 m over the window, and each reading used to segment the WHOLE track again
// (pieceOffsets through toSegments, uncached): 962 segmentations a step, 3.4 s on a 2 km track and 21 s on 10 km at the default 60 m radius (C's D421 hand-back §1)
const { extend: EXT } = require('../src/core/extend.js');
const FRAME_MS = 6.9;   // one frame at 144 Hz (the preview-at-refresh-rate rule)
// the row's bar is three frames: measured alone a warm step is about 2 ms on 10 km, but with 18 test files running beside it 10.7 to 11.4 ms (C's D421 run), and a
// row that fails whenever a suite shares the machine teaches people to ignore it. Three frames still catches the freeze (seconds) and a brush with no segment cache (88 ms)
const STEP_BAR_MS = 3 * FRAME_MS;
const longTrack = (n) => { let d = extend0(); for (let i = 0; i < n; i++) d = EXT(d, { length: 200, transition: 40, targets: { kh: (i % 2 ? -1 : 1) / 400 } }); return d; };
const extend0 = () => EXT(D.createDoc('d421'), { length: 200, family: 'bowl' });
const msOf = (f) => { const t = process.hrtime.bigint(); f(); return Number(process.hrtime.bigint() - t) / 1e6; };
test('D421a: a hill and a swerve brush step fits three frames (one alone) on a 2 km and a 10 km track (warm), and the first, cold step stays under 100 ms', () => {
  for (const [name, n] of [['2 km', 9], ['10 km', 49]]) for (const mode of ['hill', 'swerve']) {
    const doc = longTrack(n);
    assert.ok(Object.isFrozen(doc.pieces[0]), 'control: the core returns frozen pieces, as the shell holds them');
    const s0 = doc.pieces.length * 100, runs = [];
    for (let run = 0; run < 3; run++) {   // a case passes when any of its runs does, so a seat running beside it does not fail the row
      const base = run ? longTrack(n) : doc;   // pieces the brush has never seen: the first step is cold
      const cold = msOf(() => S.brush(base, { mode, s0, r: 60, delta: 1 }));
      if (cold >= 1000) { runs.push({ cold: +cold.toFixed(0), warm: 'not run: a cold step of a second or more is no seat\'s noise' }); break; }
      const warm = [2, 3, 4].map((k) => msOf(() => S.brush(base, { mode, s0, r: 60, delta: k }))).sort((a, b) => a - b)[1];
      runs.push({ cold: +cold.toFixed(1), warm: +warm.toFixed(2) });
      if (cold < 100 && warm <= STEP_BAR_MS) break;
    }
    assert.ok(runs.some((x) => x.cold < 100 && x.warm <= STEP_BAR_MS), `${name} ${mode} at r 60: a step must fit ${STEP_BAR_MS.toFixed(1)} ms warm (three frames at 144 Hz) and 100 ms cold; runs ${JSON.stringify(runs)}`);
  }
});
test('D421b: the peak scan finds the same peak as reading the whole track again at every 0.25 m, so the brushed document is bit for bit the same', () => {
  const offsOld = (d) => { const len = new Map(); for (const g of toSegmentsUncached(d)) len.set(g.id, (len.get(g.id) || 0) + g.length); let o = 0; return d.pieces.map((P) => { const x = o; o += len.get(P.id) || 0; return x; }); };
  const valueOld = (d, ch, s) => { const off = offsOld(d); let p = -1; d.pieces.forEach((P, i) => { if (P.type === 'road' && s >= off[i] && s <= off[i] + P.length) p = i; }); if (p < 0) throw new D.CoreError('BAD_BRUSH', 'no road'); return D.channelAt(d.pieces[p], ch, s - off[p]).v; };
  const doc = longTrack(3);
  for (const [mode, ch] of [['hill', 'h'], ['swerve', 'l']]) for (const [s0, r] of [[400, 60], [200, 20], [799, 90]]) {   // 200 and 799: the window over a joint, and at the end of the track
    const unit = S.sculpt(doc, { channel: ch, s0, r, delta: 1 }), ru = unit.radiusUsed;
    let got = 0; for (let s = Math.max(0, s0 - ru); s <= s0 + ru; s += 0.25) { let v; try { v = valueOld(unit.doc, ch, s) - valueOld(doc, ch, s); } catch (e) { continue; } if (Math.abs(v) > Math.abs(got)) got = v; }
    const want = S.sculpt(doc, { channel: ch, s0, r, delta: 3 / got }).doc, res = S.brush(doc, { mode, s0, r, delta: 3 });
    assert.deepEqual(res.doc, want, `${mode} at ${s0} m, r ${r}: the same document as the per-sample scan gives`);
    assert.deepEqual(S.pieceOffsets(res.doc), offsOld(res.doc), `${mode} at ${s0} m: the offsets of the brushed document are the uncached ones`);
  }
  // an unfrozen document (one read from a file, say) is converted afresh, never from the cache: its pieces could be written in place
  // (piece 0 is a straight with every channel constant, so stretching its knots with its length keeps every joint C1)
  const loose = JSON.parse(JSON.stringify(doc)); S.pieceOffsets(loose); const P0 = loose.pieces[0]; P0.knots = P0.knots.map((k) => k * 1.25); P0.length *= 1.25;
  assert.deepEqual(S.pieceOffsets(loose), offsOld(loose), 'a piece written in place after a first read: the offsets follow it');
});
const toSegmentsUncached = (d) => require('../src/core/adapter.js').toSegments(d);
