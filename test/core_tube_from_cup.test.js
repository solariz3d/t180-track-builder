// core_tube_from_cup.test.js: node --test test/core_tube_from_cup.test.js   (under the heavy-run lock)
// D274 (the keeper, 2026-10-08 13:33: "it wont let me project and build a tube correctly, it bugs the track and then eventually turns into a tube"): a cup
// piece's last metres FADE into the next piece's first profile when that piece is a legacy road (src/core/adapter.js toSegments, the tail rule), and a tube
// was taken for a legacy road: the fade rendered it as a legacy bowl and bent the PLACED cup's last 10 m into it (17.9° of surface on his FIRST TRACK) before
// the tube morphed out of that. A tube or an edge piece makes its own handover from the previous piece's end (xsecSegments, MORPH_M). Rows:
//   1  adding a tube after a cup leaves every placed segment byte for byte as it was (the track you have does not move when you project)
//   2  the handover is seamless: the tube's first profile morphs out of the cup's OWN end, the two rows meet (≤ 1 mm), the centre stays on the curve, and the
//      piece has no self-intersection, stacking or red, at 125 and 1000 m
//   3  the same for an EDGE piece after a cup
//   (a cup followed by a LEGACY road still fades into it, as before: that is pinned by test/core_cup_seam.test.js "R3 (a) mirror" and core_cup_mutation M41/M42)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const G = require('../src/geom/index.js');
const V = require('../src/validate/index.js');
const P = require('../src/geom/profile.js');

/** A straight bowl, then a cup road like the keeper's head (cup 33.4°, width 35), held to its end. */
function cupHead() {
  let d = extend(D.createDoc('cup head'), { length: 200, targets: { w: 35 } });
  return extend(d, { length: 300, transition: 60, targets: { c: 33.4, w: 35 } });
}
const H = cupHead(), segsH = A.toSegments(H), sH = H.pieces.reduce((a, Q) => a + Q.length, 0);
const same = (a, b) => JSON.stringify([a.profile, a.blend, a.fractions, a.k0, a.k1, a.kp0, a.kp1, a.roll0, a.roll1, a.length]) === JSON.stringify([b.profile, b.blend, b.fractions, b.k0, b.k1, b.kp0, b.kp1, b.roll0, b.roll1, b.length]);
/** Two profiles are the same SHAPE: the same span, and ψ equal to 1e-6 rad at 41 points across (a blend at weight 0 carries both profiles' knots, so its arrays differ). */
const sameShape = (a, b) => { const A0 = P.normalize(a), B0 = P.normalize(b), lo = A0.u[0], hi = A0.u[A0.u.length - 1]; if (Math.abs(lo - B0.u[0]) > 1e-9 || Math.abs(hi - B0.u[B0.u.length - 1]) > 1e-9) return false; for (let k = 0; k <= 40; k++) { const u = lo + ((hi - lo) * k) / 40; if (Math.abs(P.psiAt(A0, u) - P.psiAt(B0, u)) > 1e-6) return false; } return true; };
/** The cup's actual END shape (a cup segment's `profile` is one end of a blend pair, not its end): the cup profile at the piece's end values. */
const E0 = D.pieceEnd(H.pieces[1]), CUP_END = A.cupProfile(H.pieces[1].family, E0.w.v, E0.c.v);
const placedChanged = (d) => { const s = A.toSegments(d); return segsH.map((g, i) => (same(g, s[i]) ? -1 : i)).filter((i) => i >= 0); };

test('row 1: adding a tube after a cup leaves every placed segment byte for byte as it was', () => {
  assert.equal(D.kindOf(H.pieces[1]), 'cup');
  for (const L of [125, 250, 1000]) assert.deepEqual(placedChanged(extend(H, { length: L, targets: { t: 360, w: 35 } })), [], `${L} m: the placed cup's segments moved`);
});

test('row 2: the handover is seamless: the tube morphs out of the cup\'s own end, the rows meet, the centre is on the curve, no self-intersection, stacking or red', () => {
  for (const L of [125, 1000]) {
    const d = extend(H, { length: L, targets: { t: 360, w: 35 } }), s = A.toSegments(d), g0 = s[segsH.length];
    assert.equal(D.kindOf(d.pieces[2]), 'tube');
    assert.ok(sameShape(g0.blend.from, CUP_END), `${L} m: the tube starts from the cup's own last profile`);
    const p = A.offsetPath(d, s, G.buildPath(s, { step: 2, closed: false, start: { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch } }));
    const m = G.buildMesh(p, s, { selfCheck: true }), inP = (x) => x.s >= sH - 1e-6;
    assert.deepEqual([m.selfCheck.intersections.filter(inP).length, m.selfCheck.stacked.filter(inP).length], [0, 0], `${L} m: the self-check`);
    const S = p.samples.filter((x) => x.s >= sH - 1e-9); assert.ok(Math.max(...S.map((x) => Math.hypot(x.pos[0] - x._x[0], x.pos[1] - x._x[1], x.pos[2] - x._x[2]))) <= 0.01, 'the centre on the curve');
    const v = V.validate(p, s, { csp: true, softCollision: true, folds: m.folds, fullSpeed: true });
    assert.deepEqual(v.red.filter((x) => x.s >= sH - 1).map((x) => x.reason), [], `${L} m: no red in the piece (joint-step included)`);
  }
});

test('row 3: an EDGE piece after a cup leaves the placed cup as it was and morphs out of the cup\'s own end', () => {
  const d = extend(H, { length: 250, targets: { e: 20, w: 35 } });
  assert.ok(d.pieces[2].edge, 'control: the new piece carries an edge');
  assert.deepEqual(placedChanged(d), []);
  const s = A.toSegments(d), g0 = s[segsH.length];
  assert.ok(sameShape(g0.blend.from, CUP_END), 'the edge piece starts from the cup\'s own last profile');
});
