// core_chord.test.js: node --test test/core_chord.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D196 (the librarian's ruling (b) on D195's NOT MET): a LEGACY segment whose width or r changes is drawn as a CHORD, like the cup's chord segments: the
// profile at its END, blended from the profile at its START (src/core/adapter.js legacySeg), marked `chord: true` so the readers evaluate the blend
// (src/geom/profile.js readsBlend/readAt). Stated before the code:
//   1  a segment whose two ends draw the same cross-section (constant width and r, or an r that does not bind the cap) is EXACTLY today's: byte for byte
//   2  a width or binding-r change has no staircase: neighbouring segments share their row (the widths agree, the mesh rows meet within 1 mm), inside a piece and at a joint
//   3  D195's short ramp into a later piece: the joint into it was 262 mm, now within 1 mm; the whole-piece ramp likewise
//   4  the readers evaluate a chord's blend as they do a cup's, and never a word document's font transition
//   5  a cup after a legacy chord piece, and a legacy chord piece at a lap's seam, meet within 1 mm (the morphs read the chord's own rows)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend, channelFn } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const PF = require('../src/geom/profile.js');
const V = require('../src/validate/index.js');
const { buildMesh } = require('../src/geom/mesh.js');
const { profilerOf } = require('../app/core/coreshell.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const run = (steps) => steps.reduce((d, a) => extend(d, a), D.createDoc('t'));
function rowGap(a, b) {
  const P = (r) => r.map((v) => v.p), sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]], dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const near = (q, poly) => { let best = Infinity; for (let i = 0; i + 1 < poly.length; i++) { const d = sub(poly[i + 1], poly[i]), w = sub(q, poly[i]), t = Math.max(0, Math.min(1, dot(w, d) / (dot(d, d) || 1))), r = sub(w, d.map((x) => x * t)); best = Math.min(best, Math.hypot(r[0], r[1], r[2])); } return best; };
  const A1 = P(a), B1 = P(b); return Math.max(...A1.map((q) => near(q, B1)), ...B1.map((q) => near(q, A1)));
}
/** Every neighbouring pair of road segments: the width step between them (m) and the mesh row gap (mm), split into inside a piece and at a joint between pieces. */
function measure(doc) {
  const segs = A.toSegments(doc), path = A.toPath(doc).path, mesh = buildMesh(path, segs), pcs = mesh._state.pieces, out = { step: 0, inside: 0, joint: 0, chords: segs.filter((g) => g.chord).length };
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1], b = segs[i]; if (a.kind !== 'road' || b.kind !== 'road' || !pcs[i - 1] || !pcs[i] || !pcs[i - 1].last || !pcs[i].first) continue;
    const pa = PF.readAt(a, a.length), pb = PF.readAt(b, 0), gap = rowGap(pcs[i - 1].last, pcs[i].first) * 1000;
    if (a.id === b.id) { out.inside = Math.max(out.inside, gap); out.step = Math.max(out.step, Math.abs((pa.u[pa.u.length - 1] - pa.u[0]) - (pb.u[pb.u.length - 1] - pb.u[0]))); } else out.joint = Math.max(out.joint, gap);
  }
  return out;
}

// ── 1 · a segment whose ends draw the same cross-section is exactly today's ──
const GOLDEN_CASES = [
  [{ length: 100, family: 'bowl' }, { length: 100, targets: { kh: 0.004 } }],
  [{ length: 150, family: 'half-pipe', first: { w: 24 } }, { length: 60, targets: { phi: 0.3, kv: 0.002 } }],
  [{ length: 80, family: 'flat', first: { w: 20 } }, { length: 60, transition: 20, targets: { kh: 0.01, phi: 0.2 } }],
  [{ length: 100, family: 'bowl', first: { w: 31 } }, { length: 100, transition: 40, targets: { r: 60 } }],
];
const GOLDEN = ['faba667241f3eaf3', '2bb0422e0e0c7582', '0d7751f2f6e054f9', '756a4327f1ef626f'];   // sha256 (first 16) of JSON.stringify(toSegments) at b7c7676
GOLDEN_CASES.forEach((steps, i) => test(`1 · constant width and r (or an r that does not bind the cap): case ${i} draws exactly the segments it drew at b7c7676, byte for byte`, () => {
  const segs = A.toSegments(run(steps));
  assert.ok(segs.every((g) => !g.chord && g.blend === null), 'no chord, no blend');
  assert.equal(sha(JSON.stringify(segs)), GOLDEN[i]);
}));

// ── 2 · no staircase ──
test('2 · a whole-piece width ramp (31 → 12 over 100 m): the width steps between segments are gone (was 0.57 m) and the mesh rows meet within 1 mm inside the piece and at both joints', () => {
  const m = measure(run([{ length: 100, family: 'bowl', first: { w: 31 } }, { length: 100, targets: { w: 12 } }, { length: 60, targets: { kh: 0.004 } }]));
  assert.ok(m.chords > 0); assert.ok(m.step < 1e-9, `width step ${m.step} m`); assert.ok(m.inside <= 1, `inside ${m.inside} mm`); assert.ok(m.joint <= 1, `joint ${m.joint} mm`);
});
test('2 · a binding r changing (a narrow half-pipe whose rise rate is brushed): rows meet within 1 mm', () => {
  const S = require('../src/core/sculpt.js');
  let d = run([{ length: 200, family: 'bowl' }, { length: 200 }]); d = S.brush(d, { mode: 'value', channel: 'r', s0: 210, r: 60, delta: -2.2 }).doc;   // F6's own brush
  const m = measure(d); assert.ok(m.chords > 0, `chords ${m.chords}`); assert.ok(m.step < 1e-9 && m.inside <= 1 && m.joint <= 1, JSON.stringify(m));
});

// ── 3 · D195's short ramp into a later piece ──
for (const [w0, w1, L] of [[31, 12, 100], [12, 31, 100], [31, 12, 45], [31, 20, 100]]) {
  test(`3 · w ${w0} → ${w1} with the ramp 'start' on a ${L} m piece after a straight: the joint into it is within 1 mm (was 262 mm for 31 → 12 on 100 m) and the steps between segments are gone (was 4.8 m)`, () => {
    const m = measure(run([{ length: 100, family: 'bowl', first: { w: w0 } }, { length: L, transition: { w: 'start' }, targets: { w: w1 } }]));
    assert.ok(m.chords > 0); assert.ok(m.step < 1e-9, `width step ${m.step} m`); assert.ok(m.inside <= 1, `inside ${m.inside} mm`); assert.ok(m.joint <= 1, `joint ${m.joint} mm`);
  });
}

// ── 4 · the readers ──
function rampDoc() { return run([{ length: 100, family: 'bowl', first: { w: 31 } }, { length: 100, targets: { w: 12 } }]); }
test('4 · readAt of a chord gives the profile at its START at d = 0 and at its END at d = its length; a segment with no chord is its own profile', () => {
  const segs = A.toSegments(rampDoc()), g = segs.find((x) => x.chord), k = segs.find((x) => !x.chord);
  const near = (x, y) => x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) < 1e-9);
  assert.ok(near(PF.readAt(g, 0).psi, PF.normalize(g.blend.from).psi) && near(PF.readAt(g, 0).u, PF.normalize(g.blend.from).u), 'd = 0 is the start profile');
  assert.ok(near(PF.readAt(g, g.length).psi, PF.normalize(g.profile).psi) && near(PF.readAt(g, g.length).u, PF.normalize(g.profile).u), 'd = length is the end profile');
  assert.deepEqual(PF.readAt(k, 0), PF.normalize(k.profile)); assert.ok(PF.readsBlend(g) && !PF.readsBlend(k));
});
test('4 · the water (profilerOf) reads a chord\'s blend, and a word document\'s font-transition blend (no chord, no cup) as its own profile', () => {
  const doc = rampDoc(), { segments, path } = A.toPath(doc), profile = profilerOf(path, segments), g = segments.findIndex((x) => x.chord);
  const at = (d) => profile({ seg: g, s: segments.slice(0, g).reduce((t, x) => t + x.length, 0) + d });
  assert.ok(Math.abs(at(0).u[0] - PF.normalize(segments[g].blend.from).u[0]) < 1e-9, 'the water under the segment\'s start is the start profile');
  const own = { kind: 'road', length: 2, profile: segments[g].profile, blend: segments[g].blend };   // the same blend, but no chord mark: a font transition
  assert.equal(PF.readsBlend(own), false); assert.deepEqual(PF.readAt(own, 0), PF.normalize(own.profile));
});
test('4 · validation reads the road as drawn: the wall constants at a chord\'s start are its start profile\'s (no steep-without-raycast red at 35° walls that are not there)', () => {
  const doc = rampDoc(), { segments, path } = A.toPath(doc), res = V.validate(path, segments, { designSpeed: 100 });
  assert.ok(!res.red.some((x) => x.reason === 'joint-step'), 'a chord is not a joint step'); assert.ok(res.red.every((x) => x.reason !== 'steep-without-raycast'));
  const js = PF.jointSteps(segments, false); assert.ok(js.length > 0 && js.every((x) => x.m <= 1e-3), `the chord joints are inspected (${js.length}) and none steps more than 1 mm`);
});

// ── 5 · the morphs read a chord's own rows ──
test('5 · a cup after a legacy piece that is still ramping at its end: the legacy chord\'s last row is the join, the joint is within 1 mm', () => {
  let d = run([{ length: 100, family: 'bowl', first: { w: 12 } }, { length: 100, targets: { w: 16 } }]);
  d = extend(d, { length: 120, transition: 60, targets: { c: 60 } });
  const m = measure(d); assert.ok(m.chords > 0); assert.ok(m.joint <= 1, `joint ${m.joint} mm`); assert.ok(m.inside <= 1, `inside ${m.inside} mm`);
});
test('5 · a lap whose legacy START has a width ramp and whose last piece is a cup: close() converges and the lap seam meets within 1 mm', () => {
  const Rr = 180, Q = (Math.PI * Rr) / 2, edgeOf = (fam, w, r) => D.legacyEdgeDeg(fam, w, r);
  let d = extend(D.createDoc('lap'), { length: 300, family: 'bowl', first: { w: 31 }, transition: { w: 'start' }, targets: { w: 12 } });
  const P = d.pieces[0], edge = edgeOf('bowl', D.channelAt(P, 'w', 300).v, D.channelAt(P, 'r', 300).v);
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c: i === 3 ? edge : 60 } });
  d = extend(d, { length: 80, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report);
  const segs = A.toSegments(r.doc), path = A.toPath(r.doc).path, mesh = buildMesh(path, segs), pcs = mesh._state.pieces; let last = pcs.length - 1; while (last > 0 && !(pcs[last] && pcs[last].last)) last--;
  const mm = rowGap(pcs[last].last, pcs[0].first) * 1000; assert.ok(mm <= 1, `the lap seam is ${mm.toFixed(2)} mm`);
});

test('5 · a cup after a legacy piece that ENDS ON A WIDTH SLOPE (a hand-built linear width: 0.1 m/m at the joint): the join is the chord END row, the joint is within 1 mm', () => {
  const ch = Object.fromEntries(D.CHANNELS.map((c) => [c, c === 'w' ? (s) => 20 + 0.1 * s : c === 'r' ? () => 8 : () => 0]));
  const legacy = D.appendPiece(D.createDoc('slope'), D.roadPiece({ length: 100, family: 'bowl', from: null, channels: ch }));
  const d = extend(legacy, { length: 120, transition: 60, targets: { c: 60 } }), m = measure(d);
  assert.ok(m.chords > 0); assert.ok(m.joint <= 1, `joint ${m.joint} mm`); assert.ok(m.inside <= 1, `inside ${m.inside} mm`);
});
test('5 · a lap that STARTS in a cup and ENDS on a legacy piece that is still narrowing (31 → 12 over its last 40 m): the lap seam and every joint meet within 1 mm', () => {
  const Rr = 180, Q = (Math.PI * Rr) / 2, fam = 'bowl', W1 = 12, W2 = 31;
  const legacyEdge = (w, r) => D.legacyEdgeDeg(fam, w, r);
  let d = extend(D.createDoc('mirror'), { length: 60, family: fam, first: { w: W1, c: 40 } });
  d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, w: W2, c: 40 } }); d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c: 40 } });
  const P = d.pieces[d.pieces.length - 1], e = legacyEdge(W2, D.channelAt(P, 'r', P.length).v);
  d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c: e } });
  const from = D.endState(d), chs = Object.fromEntries(D.CHANNELS.map((c) => [c, channelFn(from[c], c === 'kh' ? 1 / Rr : c === 'w' ? W1 : undefined, c === 'w' ? Q : 40)]));
  d = D.appendPiece(d, D.roadPiece({ length: Q, family: fam, from, channels: chs, knotM: undefined, cup: false }));
  const r = close(d, { edited: [d.pieces.length - 1] }); assert.equal(r.converged, true, r.report);
  const m = measure(r.doc); assert.ok(m.chords > 0, `chords ${m.chords}`); assert.ok(m.joint <= 1, `joint ${m.joint} mm`);
  const segs = A.toSegments(r.doc), path = A.toPath(r.doc).path, mesh = buildMesh(path, segs), pcs = mesh._state.pieces; let last = pcs.length - 1; while (last > 0 && !(pcs[last] && pcs[last].last)) last--;
  const mm = rowGap(pcs[last].last, pcs[0].first) * 1000; assert.ok(mm <= 1, `the lap seam is ${mm.toFixed(2)} mm`);
});

// the two cases above need a rise rate that BINDS the cap (so the profile really depends on the width) and a legacy piece whose LAST segment is still changing fast
test('5 · a cup after a legacy piece whose last segment is still widening (0.25 m/m, r = 2 binds the cap): the cup\'s first row IS the chord\'s END row (0 mm, a mutant that takes the start row gives 18 mm)', () => {
  const ch = Object.fromEntries(D.CHANNELS.map((c) => [c, c === 'w' ? (s) => 4 + 0.25 * s : c === 'r' ? () => 2 : () => 0]));
  const legacy = D.appendPiece(D.createDoc('s'), D.roadPiece({ length: 20, family: 'bowl', from: null, channels: ch }));
  const segs = A.toSegments(extend(legacy, { length: 80, transition: 40, targets: { c: 60 } })), li = segs.findIndex((g) => g.id === 'p2') - 1;
  assert.ok(segs[li].chord, 'the last legacy segment is a chord');
  assert.ok(PF.stepBetween(PF.readAt(segs[li], segs[li].length), PF.readAt(segs[li + 1], 0)) * 1000 <= 1, 'the joint steps more than 1 mm');
});
test('5 · a closed lap whose cup START follows a legacy END that is still widening fast in its last segment: the seam rows are the same cross-section (0 mm; a mutant that takes the start row gives 64 mm)', () => {
  let e = extend(D.createDoc('m'), { length: 100, family: 'bowl', first: { w: 10, r: 2, c: 30 }, transition: 100, targets: { w: 4 } });
  const P = e.pieces[0], edge = D.legacyEdgeDeg('bowl', D.channelAt(P, 'w', 100).v, D.channelAt(P, 'r', 100).v);
  e = extend(D.createDoc('m'), { length: 100, family: 'bowl', first: { w: 10, r: 2, c: 30 }, transition: 100, targets: { w: 4, c: edge } });
  const from = D.endState(e), chs = Object.fromEntries(D.CHANNELS.map((c) => [c, channelFn(from[c], c === 'w' ? 10 : undefined, 6)]));
  const lap = { ...D.appendPiece(e, D.roadPiece({ length: 6, family: 'bowl', from, channels: chs, cup: false })), closed: true };
  const segs = A.toSegments(lap), last = segs[segs.length - 1], first = segs[0];
  assert.ok(last.chord, 'the last segment is a chord');
  assert.ok(PF.stepBetween(PF.readAt(last, last.length), PF.readAt(first, 0)) * 1000 <= 1, 'the lap seam steps more than 1 mm');
});
