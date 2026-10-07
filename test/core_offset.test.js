// core_offset.test.js: node --test test/core_offset.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// THE OFFSET CHANNELS h (height) and l (lateral), applied by the adapter AFTER the base geometry (ref 09 §7). The adapter must
// RECOMPUTE tangent, frame, curvature, bankG and grade from the lifted centreline, never only shift positions, or validation,
// the loads and the water would read the un-hilled road. A hill is built as the brush will build it: knots refined under the
// window (refineKnots), then the h control points brushed (sculpt.js brushControls), so outside the window h is exactly 0.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { toPath, offsetPath, toSegments } = require('../src/core/adapter.js');
const { buildPath } = require('../src/geom/path.js');
const G = require('../src/geom/index.js');
const S = require('../src/core/sculpt.js');

const DEG = Math.PI / 180;
/** A doc with channel ch of piece p brushed by +delta over [s0 − r, s0 + r] (the piece's own s), knots refined to h = 5 m first. */
function brushed(doc, p, ch, s0, r, delta) {
  const P = doc.pieces[p], { doc: fine } = D.refineKnots(doc, P.id, s0 - r - 15, s0 + r + 15, 5), Pf = fine.pieces[p];
  const { ctrl } = S.brushControls(Pf.channels[ch], D.knotVector(Pf), { s0, r, delta });
  const pieces = fine.pieces.slice(); pieces[p] = { ...Pf, channels: { ...Pf.channels, [ch]: ctrl.map((v) => Number(v.toFixed(D.DEC[ch]))) } };
  return { base: fine, doc: D.checkDoc({ ...fine, pieces }) };
}
const straight = () => extend(D.createDoc('flat', { start: { heading: 0.4 } }), { length: 400 });

test('a 5 m hill on a level straight: grade = h′ and |κ| = |h″|/(1 + h′²)^{3/2} at every sample (ref 09 §7, the plane-graph curvature of ref 02 §1)', () => {
  const { doc } = brushed(straight(), 0, 'h', 200, 60, 5), P = doc.pieces[0], { path } = toPath(doc, { step: 0.5 });
  let lifted = 0, peak = 0;
  for (const x of path.samples) {
    const h = D.channelAt(P, 'h', x.s); peak = Math.max(peak, h.v);
    if (!(h.v || h.d1 || h.d2)) continue; lifted++;
    assert.ok(Math.abs(x.grade - h.d1) < 1e-12, `grade ${x.grade} vs h′ ${h.d1} at ${x.s}`);
    const k = Math.hypot(...x.kvec), want = Math.abs(h.d2) / (1 + h.d1 * h.d1) ** 1.5;
    assert.ok(Math.abs(k - want) < 1e-12 + 1e-9 * want, `|κ| ${k} vs ${want} at ${x.s}`);
  }
  assert.ok(lifted > 100 && peak > 3, `${lifted} samples lifted, peak ${peak} m`);
});

test('outside the hill NOTHING changes: every sample is the SAME object (bit for bit), and the path length is the base\'s', () => {
  const { base, doc } = brushed(straight(), 0, 'h', 200, 60, 5), P = doc.pieces[0];
  const segs = toSegments(doc), raw = buildPath(segs, { step: 0.5, start: { pos: [0, 0, 0], theta: 0.4, p: 0 } }), lifted = offsetPath(doc, segs, raw);
  let same = 0;
  lifted.samples.forEach((x, i) => { const h = D.channelAt(P, 'h', x.s); if (!(h.v || h.d1 || h.d2)) { assert.ok(Object.is(x, raw.samples[i]), `sample ${i} at ${x.s} was rebuilt`); same++; } });
  assert.ok(same > 300, `${same} samples untouched`);
  assert.equal(lifted.lengthM, raw.lengthM);
  // and against the UNBRUSHED document's own path: identical numbers outside
  const B = toPath(base).path.samples;
  lifted.samples.forEach((x, i) => { const h = D.channelAt(P, 'h', x.s); if (!(h.v || h.d1 || h.d2)) for (const f of ['pos', 'T', 'L', 'U', 'kvec', 'roll', 'bankG', 'grade']) assert.deepEqual(x[f], B[i][f], `${f} at ${x.s}`); });
});

test('the frame is RECOMPUTED, not shifted: T, L, U orthonormal, the roll about T kept, and bankG and grade read from the new frame', () => {
  let d = extend(D.createDoc('bank'), { length: 150, first: { kh: 1 / 400, phi: 12 * DEG } });
  const { doc } = brushed(d, 0, 'h', 75, 40, 4), { path } = toPath(doc), base = toPath(d).path.samples;
  let checked = 0;
  path.samples.forEach((x, i) => {
    if (Object.is(x.T, base[i].T) || !(Math.abs(x.T[1] - base[i].T[1]) > 1e-9)) return; checked++;
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const [a, b] of [[x.T, x.L], [x.T, x.U], [x.L, x.U]]) assert.ok(Math.abs(dot(a, b)) < 1e-12);
    for (const v of [x.T, x.L, x.U]) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-12);
    const th = Math.atan2(x.T[0], x.T[2]), R = [Math.cos(th), 0, -Math.sin(th)];
    const U0 = [x.T[1] * R[2] - x.T[2] * R[1], x.T[2] * R[0] - x.T[0] * R[2], x.T[0] * R[1] - x.T[1] * R[0]];
    assert.ok(Math.abs(Math.atan2(dot(x.L, U0), dot(x.L, R)) - base[i].roll) < 1e-12, 'the roll about T is the base geometry\'s (the channel\'s), not changed by the lift');
    assert.ok(Math.abs(x.bankG - Math.asin(x.L[1])) < 1e-15 && Math.abs(x.grade - x.T[1] / Math.hypot(x.T[0], x.T[2])) < 1e-15);
  });
  assert.ok(checked > 50, `${checked} lifted samples checked`);
});

test('a swerve (l) on a CURVED base: the exact κ̃ agrees with a finite difference of the lifted tangent (the R′ and R″ terms, ref 09 §7)', () => {
  let d = extend(D.createDoc('curve'), { length: 200, first: { kh: 1 / 150 } });
  d = extend(d, { length: 150, transition: 150, targets: { kh: -1 / 300 } });
  const { doc } = brushed(d, 1, 'l', 75, 50, 3), { path } = toPath(doc, { step: 0.05 }), S2 = path.samples;
  // A cubic spline is only C2: l‴ jumps at its knots, so a centred difference straddling a knot (or a segment boundary, where
  // the base's θ″ jumps) is first order there, not second. Those triples are skipped; everywhere else the difference is
  // second order and must agree closely. (Measured: straddling triples err ~ 4e-5 at a 0.05 m step and 8e-6 at 0.01 m.)
  const P1 = doc.pieces[1], off1 = d.pieces[0].length, knots = P1.knots.map((t) => off1 + t);
  let worst = 0, n = 0;
  for (let i = 1; i + 1 < S2.length; i++) {
    const a = S2[i - 1], b = S2[i + 1], x = S2[i];
    if (a.seg !== b.seg || knots.some((t) => t >= a.s && t <= b.s)) continue;
    const dl = Math.hypot(...[0, 1, 2].map((k) => b.pos[k] - a.pos[k])); if (!(dl > 0)) continue;
    const fd = [0, 1, 2].map((k) => (b.T[k] - a.T[k]) / dl);
    worst = Math.max(worst, Math.hypot(...[0, 1, 2].map((k) => fd[k] - x.kvec[k]))); n++;
  }
  assert.ok(n > 1000 && worst < 1e-7, `${n} samples, worst |κ̃ − finite difference| ${worst}`);
});

test('the mesh closes every segment on a LIFTED end sample (path.segEnd), and the build head is the lifted last sample', () => {
  const { doc } = brushed(straight(), 0, 'h', 200, 60, 5), P = doc.pieces[0], { path, segments } = toPath(doc);
  let raised = 0;
  path.segEnd.forEach((e) => { const h = D.channelAt(P, 'h', e.s).v; if (h > 0.5) { raised++; assert.ok(Math.abs(e.pos[1] - h) < 1e-9, `segment end at ${e.s}: y ${e.pos[1]} vs h ${h}`); } });
  assert.ok(raised > 10);
  const last = path.samples[path.samples.length - 1]; assert.deepEqual(path.head.pos, last.pos);
  // a hill that runs to the OPEN END lifts the build head too (the camera sits on the road as brushed)
  const d2 = straight(), P2 = d2.pieces[0], hEnd = P2.channels.h.slice(); hEnd[hEnd.length - 1] = 3; hEnd[hEnd.length - 2] = 3;
  const up = toPath(D.checkDoc({ ...d2, pieces: [{ ...P2, channels: { ...P2.channels, h: hEnd } }] })).path, e = up.samples[up.samples.length - 1];
  assert.ok(Math.abs(up.head.pos[1] - 3) < 1e-9, `head y ${up.head.pos[1]}`);
  assert.deepEqual([up.head.pos, up.head.T, up.head.U], [e.pos, e.T, e.U]);
  const m = G.buildMesh(path, segments, {}); assert.equal(m.folds.length, 0);
});

test('h and l serialise canonically, undo removes a hill, and a core/1 file opens with both at zero', () => {
  const { base, doc } = brushed(straight(), 0, 'h', 200, 60, 5), t = D.serialize(doc);
  assert.equal(D.serialize(D.parse(t)), t);
  assert.match(t, /"h":\[/); assert.match(t, /"l":\[/);
  const hist = D.commit(D.createHistory(base), doc);
  assert.equal(D.serialize(D.undo(hist).present), D.serialize(base));
  const old = JSON.parse(D.serialize(base)); old.schema = 't180b.core/1'; for (const P of old.pieces) { delete P.channels.h; delete P.channels.l; }
  const up = D.parse(JSON.stringify(old));
  assert.equal(up.schema, D.SCHEMA); assert.ok(up.pieces[0].channels.h.every((v) => v === 0) && up.pieces[0].channels.l.every((v) => v === 0));
});

test('checkDoc: an offset channel of the wrong length is refused; offsets must fade to 0 before a jump (FLIGHT_OFFSET) and start at 0 after it', () => {
  const d = straight(), P = d.pieces[0];
  assert.throws(() => D.checkDoc({ ...d, pieces: [{ ...P, channels: { ...P.channels, h: [0, 0] } }] }), (e) => e.code === 'BAD_DOC' && /channel h/.test(e.message));
  // a hill that has not faded at the piece's end: its last two control points raised (a brush never touches them, since their
  // support reaches the end; this is the state a sculpt that ran off the end would leave)
  const hEnd = P.channels.h.slice(); hEnd[hEnd.length - 1] = 2; hEnd[hEnd.length - 2] = 2;
  const doc = D.checkDoc({ ...d, pieces: [{ ...P, channels: { ...P.channels, h: hEnd } }] });
  assert.throws(() => D.appendPiece(doc, D.flightPiece({ forward: 20, up: -1, pitch: -2 * DEG })), (e) => e.code === 'FLIGHT_OFFSET');
  // a take-off 0.1 mm up (one quantum: inside the fade rule's tolerance) still lands the next road at exactly 0
  const hTiny = P.channels.h.slice(); hTiny[hTiny.length - 1] = 1e-4; hTiny[hTiny.length - 2] = 1e-4;
  const tiny = D.checkDoc({ ...d, pieces: [{ ...P, channels: { ...P.channels, h: hTiny } }] });
  const j = D.appendPiece(tiny, D.flightPiece({ forward: 20, up: -1, pitch: -2 * DEG })), e = D.endState(j);
  assert.deepEqual([e.h.v, e.h.m, e.l.v, e.l.m], [0, 0, 0, 0]);
});

test('with no offset set anywhere the adapter returns the geometry\'s own path object untouched', () => {
  const d = straight(), segs = toSegments(d), raw = buildPath(segs, { step: 0.5, start: { pos: [0, 0, 0], theta: 0.4, p: 0 } });
  assert.equal(offsetPath(d, segs, raw), raw);
});
