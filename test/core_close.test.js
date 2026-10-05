// core_close.test.js: node --test test/core_close.test.js   (heavy: run under the heavy-run lock, --max-old-space-size=4096)
// src/core/close.js (D185, pane E; the spec's GO §4, ref 10 §3), and TEST 4 of the D185 registration (pane B, sealed
// 2026-09-28 07:34, sha256 978be18b…): the 20 seeded tracks (seed 185), each built with the core's extend and closed by ONE
// call, re-measured on the adapter's own path, not taken from close's report.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./core_helpers.js');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { toPath } = require('../src/core/adapter.js');
const C = require('../src/core/close.js');

const ends = (doc) => { const S = toPath({ ...doc, closed: false }).path.samples; return { a: S[0], z: S[S.length - 1] }; };
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const TRACKS = H.gen();
const DEG = Math.PI / 180;

// ── TEST 4, all 20 ──
const results = TRACKS.map((t) => { const doc = H.docFrom(t); return { t, doc, res: C.close(doc) }; });
for (const { t, doc, res } of results) {
  test(`test 4, track ${t.id} (${t.pieces.length} pieces, ${Math.round(t.lengthM)} m, ε ${t.eps}): one call closes it`, () => {
    const { a, z } = ends(res.doc), gap = Math.hypot(z.pos[0] - a.pos[0], z.pos[1] - a.pos[1], z.pos[2] - a.pos[2]);
    const tang = Math.acos(Math.min(1, dot(a.T, z.T)));
    const road = res.doc.pieces, dphi = road.at(-1).channels.phi.at(-1) - road[0].channels.phi[0], bank = Math.abs(dphi - 2 * Math.PI * Math.round(dphi / (2 * Math.PI)));
    assert.ok(res.converged && res.doc.closed, res.report);
    assert.ok(gap < 0.01, `position ${gap} m`);
    assert.ok(tang < 1e-3, `tangent ${tang} rad`);
    assert.ok(bank < 0.1 * DEG, `bank ${bank / DEG}°`);
    assert.ok(dot(a.L, z.L) > Math.cos(1e-3), `L·L ${dot(a.L, z.L)}`);
    // the user's work is not moved: the last piece's share of the change, per channel (the registration's measure)
    for (const ch of D.CHANNELS) {
      let all = 0, last = 0;
      res.doc.pieces.forEach((P, p) => P.channels[ch].forEach((v, i) => { const d2 = (v - doc.pieces[p].channels[ch][i]) ** 2; all += d2; if (p === doc.pieces.length - 1) last += d2; }));
      if (all > 0) assert.ok(Math.sqrt(last / all) <= 0.10, `${ch}: the last piece carries ${Math.sqrt(last / all)} of the change`);
    }
  });
}

// ── the rest of close's contract ──
test('close REPORTS a closure it did not reach: one step on the hardest track says NOT CLOSED and leaves closed false', () => {
  const hard = results.reduce((a, b) => (Math.abs(b.t.eps) > Math.abs(a.t.eps) ? b : a));
  const res = C.close(hard.doc, { maxIter: 1, tolM: 1e-12 });
  assert.equal(res.converged, false);
  assert.equal(res.doc.closed, false);
  assert.match(res.report, /^NOT CLOSED/);
});
test('the input document is not changed (it is frozen, and deep-equal afterwards)', () => {
  const doc = H.docFrom(TRACKS[1]), before = D.serialize(doc);
  C.close(doc);
  assert.equal(D.serialize(doc), before);
});
test('a lap that already closes (a full circle, R = 200 m) is left where it is: no steps', () => {
  const R = 200, L = 2 * Math.PI * R;
  let d = extend(D.createDoc('circle'), { length: L / 2, first: { kh: 1 / R } }); d = extend(d, { length: L / 2 });
  const res = C.close(d, { tolM: 0.005 });
  assert.ok(res.converged, res.report);
  assert.ok(res.iterations <= 1, `${res.iterations} steps`);
});
test('the position Jacobian predicts the adapter: bumping one interior control point moves the end as J says (relative 5e-4)', () => {
  // measured on 2026-09-28 (hand-back §4): the model agrees with the adapter to ≤ 1.2e-4 on these five; dropping the rebuild's
  // half-step term (mutant C7) makes it ≥ 9.6e-4 on the three heading ones. 5e-4 sits between, with a margin of 4 each way.
  const doc = results[0].doc, { cols, expand } = C.parameters(doc, new Set()), J = C.positionJacobian(doc), e0 = ends(doc).z.pos;
  for (const [ch, p, i] of [['kh', 2, 4], ['kh', 6, 3], ['kh', 9, 7], ['kv', 3, 5], ['kv', 8, 3]]) {
    const k = cols.findIndex((c) => c.ch === ch && c.p === p && c.i === i), row = [0, 0, 0];
    for (const [key, v] of J[ch]) { const [pp, ii] = key.split(':').map(Number); for (const [c, coef] of expand[ch][pp][ii]) if (c === k) for (let a = 0; a < 3; a++) row[a] += coef * v[a]; }
    const eps = 1e-7, bumped = { ...doc, pieces: doc.pieces.map((P, q) => (q === p ? { ...P, channels: { ...P.channels, [ch]: P.channels[ch].map((v, j) => (j === i ? v + eps : v)) } } : P)) };
    const e1 = ends(bumped).z.pos, fd = [0, 1, 2].map((a) => (e1[a] - e0[a]) / eps);
    const err = Math.hypot(fd[0] - row[0], fd[1] - row[1], fd[2] - row[2]) / Math.hypot(...fd);
    assert.ok(err < 5e-4, `${ch} piece ${p} point ${i}: J ${row} against the adapter ${fd} (relative ${err})`);
  }
});
test('the seam is a joint like any other: after the close it passes the document’s own C1 joint check, last piece into first', () => {
  for (const { res } of results.slice(0, 5)) {
    const P = res.doc.pieces, loop = D.checkDoc({ ...res.doc, closed: false, nextId: res.doc.nextId + 1, pieces: [...P, { ...P[0], id: `p${res.doc.nextId}` }] });
    assert.ok(loop);
  }
});
test('with no stretch protected (every weight 1) close still closes, seam included', () => {
  const res = C.close(results[3].doc, { edited: [] });
  assert.ok(res.converged, res.report);
  const P = res.doc.pieces; D.checkDoc({ ...res.doc, closed: false, nextId: res.doc.nextId + 1, pieces: [...P, { ...P[0], id: `p${res.doc.nextId}` }] });
});
// D243 changed this row: a track with a jump was refused as not built (NOT_YET). Jumps now close (test/core_jump.test.js row 4), so this track,
// two straights and a jump with no turn, meets the refusal every turnless track meets, by its own name, and never NOT_YET
test('a track with a jump and no turn is refused as any turnless track is (CLOSE_SINGULAR), not as an unbuilt jump (D243)', () => {
  let d = extend(D.createDoc('j'), { length: 300 });
  d = D.appendPiece(d, D.flightPiece({ gap: 40, drop: 0, land: 0 }));
  d = extend(d, { length: 300 });
  assert.throws(() => C.close(d), (e) => e.code === 'CLOSE_SINGULAR' && !/NOT_YET/.test(e.message));
});
