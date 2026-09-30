// core_cup_seam.test.js: node --test test/core_cup_seam.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D190 round 3, R3 (B's score, X1-X3 and bprobe4): the cup -> legacy LAP SEAM. Stated before the code (the chair's ruling, all three parts):
//   (a) a reverse morph at a lap seam (mirror of morphZone): the cup fades into the legacy start's rendered profile over its last 10 m, so the
//       zip at s = 0 meets within 1 mm on the WHOLE curve (B measured 23.2 mm on a 16 m bowl, 148.2 mm on a 24 m half-pipe, 9,488 mm when the cup is
//       not returned, 2.3-5.3 mm of fit ringing on a 20 m closing straight)
//   (b) close() holds c at the seam to the legacy start's rendered edge; if it cannot (no room) it REFUSES by name, never converged over a step
//   (c) validation reds any lap seam or joint whose curve steps more than 1 mm, so the panel never says "lap proved" over a cliff
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend, channelFn } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const PF = require('../src/geom/profile.js');
const { buildMesh } = require('../src/geom/mesh.js');

const Rr = 180, Q = (Math.PI * Rr) / 2;
function rowGap(a, b) {
  const P = (r) => r.map((v) => v.p), sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]], dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const near = (q, poly) => { let best = Infinity; for (let i = 0; i + 1 < poly.length; i++) { const d = sub(poly[i + 1], poly[i]), w = sub(q, poly[i]), t = Math.max(0, Math.min(1, dot(w, d) / (dot(d, d) || 1))), r = sub(w, d.map((x) => x * t)); best = Math.min(best, Math.hypot(r[0], r[1], r[2])); } return best; };
  const A1 = P(a), B1 = P(b); return Math.max(...A1.map((q) => near(q, B1)), ...B1.map((q) => near(q, A1)));
}
/** The lap seam's gap in mm: the zip at s = 0 joins the LAST row of the last road segment to the FIRST row of the first. */
function seamMm(doc) {
  const segs = A.toSegments(doc), path = A.toPath(doc).path, mesh = buildMesh(path, segs), pcs = mesh._state.pieces;
  let last = pcs.length - 1; while (last > 0 && !(pcs[last] && pcs[last].last)) last--;
  return rowGap(pcs[last].last, pcs[0].first) * 1000;
}
/** B's laps: a legacy start straight (width w), four turns at cup c, a closing straight of `tail` m; `ret` = the last turn returns the cup to the start's edge. */
function lap(family, w, c, { ret = true, tail = 60, tailC = null } = {}) {
  let d = extend(D.createDoc('seam'), { length: 300, family, ...(w ? { first: { w } } : {}) });
  const edge = D.legacyEdgeDeg(family, D.channelAt(d.pieces[0], 'w', 300).v, D.channelAt(d.pieces[0], 'r', 300).v);
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c: i === 3 && ret ? edge : c } });
  d = extend(d, { length: tail, transition: Math.min(40, tail), targets: { kh: 0, ...(tailC == null ? {} : { c: tailC }) } });
  return { d, edge };
}
const closed = (d) => close(d, { edited: [0] });

for (const [family, w] of [['bowl', 16], ['half-pipe', 24]]) for (const c of [90, 150]) {
  test(`R3 (a) X3: a ${family} ${w} m lap with the cup at ${c} returned exactly closes with the seam within 1 mm on the whole curve (B: 23.2 mm bowl 16, 148.2 mm half-pipe 24)`, () => {
    const { d } = lap(family, w, c), r = closed(d);
    assert.equal(r.converged, true, r.report);
    const mm = seamMm(r.doc); assert.ok(mm <= 1, `the lap seam is ${mm.toFixed(2)} mm`);
  });
}
test('R3 (a) X2: a 20 m closing straight after the cup returns (the fit\'s ringing left 0.02-0.03°) closes with the seam within 1 mm (B: 2.3-5.3 mm)', () => {
  for (const [family, w] of [['bowl', 31], ['half-pipe', 31.5], ['bowl', 16]]) {
    const { d } = lap(family, w, 150, { tail: 20 }), r = closed(d); assert.equal(r.converged, true, `${family}: ${r.report}`);
    const mm = seamMm(r.doc); assert.ok(mm <= 1, `${family} ${w}: the lap seam is ${mm.toFixed(2)} mm`);
  }
});
test('R3 (b) X1: a cup NOT returned before closing (B: 150° against an edge of 15.5°, a 9,488 mm cliff) is never reported converged over a step: it closes with the seam within 1 mm, or it is refused by name', () => {
  const { d } = lap('bowl', null, 150, { ret: false });
  let r; try { r = closed(d); } catch (e) { assert.equal(e.code, 'CUP_SEAM', `refused, but not by name: ${e.code} ${e.message}`); return; }
  if (r.converged) { const mm = seamMm(r.doc); assert.ok(mm <= 1, `close said converged over a ${mm.toFixed(1)} mm seam: ${r.report}`); assert.ok(r.cupSeamStepDeg <= D.CUP_JOINT_DEG, `cupSeamStepDeg ${r.cupSeamStepDeg}`); }
});
test('R3 (b): close() holds the cup\'s last value at the legacy start\'s rendered edge (0.05°), for a returned cup and for one that was not', () => {
  for (const [family, w, ret] of [['bowl', 16, true], ['half-pipe', 24, true], ['bowl', null, false]]) {
    const { d } = lap(family, w, 150, { ret }); let r; try { r = closed(d); } catch (e) { assert.equal(e.code, 'CUP_SEAM'); continue; }
    const P = r.doc.pieces[r.doc.pieces.length - 1], end = D.pieceEnd(P).c.v, F = r.doc.pieces[0];
    const want = D.legacyEdgeDeg(family, F.channels.w[0], F.channels.r[0]);
    assert.ok(Math.abs(end - want) <= D.CUP_JOINT_DEG, `${family} ${w}: the cup ends at ${end}° against the start's edge ${want}°`);
  }
});
/** A file can hold a LEGACY piece after a cup piece (Extend never makes one): cup start straight and turns, the last cup turn returning to the edge the legacy piece renders, then a legacy last piece. */
function mirrorDoc(fam, w) {
  let d = extend(D.createDoc('m'), { length: 60, family: fam, first: { w, c: 60 } });
  d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c: 60 } }); d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c: 60 } });
  const P = d.pieces[d.pieces.length - 1], e = D.legacyEdgeDeg(fam, D.channelAt(P, 'w', P.length).v, D.channelAt(P, 'r', P.length).v);
  d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c: e } });
  const from = D.endState(d), channels = Object.fromEntries(D.CHANNELS.map((ch) => [ch, channelFn(from[ch], ch === 'kh' ? 1 / Rr : undefined, 40)]));
  return D.appendPiece(d, D.roadPiece({ length: Q, family: fam, from, channels, knotM: undefined, cup: false }));
}
test('R3 (a) mirror: a lap that STARTS in a cup and ends on a legacy piece meets within 1 mm at the lap seam, and so does the cup -> legacy joint inside it (B-class step: 148 mm half-pipe 24, 23 mm bowl 16 before)', () => {
  for (const [fam, w] of [['half-pipe', 24], ['bowl', 16]]) {
    const d = mirrorDoc(fam, w); assert.deepEqual(d.pieces.map((p) => !!p.cup), [true, true, true, true, false], 'built: cup pieces then a legacy last piece');
    const r = close(d, { edited: [d.pieces.length - 1] }); assert.equal(r.converged, true, r.report);
    const worst = PF.jointSteps(A.toSegments(r.doc), true).reduce((m, x) => Math.max(m, x.m), 0);
    assert.ok(worst <= 1e-3, `${fam} ${w}: a joint steps ${(worst * 1000).toFixed(2)} mm`);
    const mm = seamMm(r.doc); assert.ok(mm <= 1, `${fam} ${w}: the lap seam is ${mm.toFixed(2)} mm`);
  }
});
test('R3 (b): a closing cup piece too short to fade (8 m, straight after a legacy piece) is REFUSED by name with the seam real step (B: 148.2 mm half-pipe 24, 23.2 mm bowl 16), never closed over it; at 12 m it closes and the seam is matched', () => {
  const build = (fam, w, len) => { let d = extend(D.createDoc('short'), { length: 300, family: fam, first: { w } }); const edge = D.legacyEdgeDeg(fam, w, D.channelAt(d.pieces[0], 'r', 300).v);
    for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } }); return extend(d, { length: len, transition: Math.min(6, len), targets: { kh: 0, c: edge } }); };
  for (const [fam, w, mm] of [['half-pipe', 24, 148.2], ['bowl', 16, 23.2]]) {
    assert.throws(() => closed(build(fam, w, 8)), (e) => e.code === 'CUP_SEAM' && new RegExp(String(mm).replace('.', '\.')).test(e.message), `${fam}: not refused by name with the step`);
    const r = closed(build(fam, w, 12)); assert.equal(r.converged, true, r.report); assert.ok(seamMm(r.doc) <= 1, `${fam}: 12 m closes but the seam is ${seamMm(r.doc)} mm`);
  }
});
test('R3 (c): validation reds a lap seam whose curve steps more than 1 mm (drawn with the local scheme, which has no reverse morph: the panel would otherwise read "0 red · lap proved" over the cliff), and does not red the same lap drawn by default', () => {
  const rg = closed(lap('half-pipe', 24, 90).d); assert.equal(rg.converged, true);
  const bad = A.toPath(rg.doc, { cupRuns: false }), res = V.validate(bad.path, bad.segments, { designSpeed: 100 });
  const red = res.red.filter((x) => x.reason === 'joint-step'); assert.ok(red.length > 0, `no joint-step red: ${JSON.stringify(res.red.map((x) => x.reason))}`);
  assert.ok(red.some((x) => x.s0 === 0), 'the red is at the lap seam (s = 0)');
  const ok = A.toPath(rg.doc), res2 = V.validate(ok.path, ok.segments, { designSpeed: 100 });
  assert.ok(!res2.red.some((x) => x.reason === 'joint-step'), 'a matched seam is not red');
});
test('R3 (c): the panel has words for the joint-step red (labels reasonText)', () => {
  const L = require('../app/validate-ui/labels.js'); assert.ok(!/no description yet/.test(L.reasonText('joint-step', { seamP90Deg: 5 })), 'reasonText has no line for joint-step');
});
test('R3 (c): a legacy → cup JOINT the R2 morph matched is not red', () => {
  const d0 = extend(D.createDoc('j'), { length: 100, family: 'bowl', first: { w: 12 } }), d = extend(d0, { length: 120, transition: 60, targets: { c: 60 } });
  const res = V.validate(A.toPath(d).path, A.toSegments(d), { designSpeed: 100 });
  assert.ok(!res.red.some((x) => x.reason === 'joint-step'), 'the morphed joint is not red');
});
