// core_tube_open.test.js: node --test test/core_tube_open.test.js   (under the heavy-run lock)
// D268 (the keeper, 2026-10-07 10:20: "when you make the full 360 degree tube, but then try to transition back into a flatter track, there is this weird hump"):
// a closed tube's roll axis (its heartline, w/2π: src/core/adapter.js heartlineOf) used to be the integrated curve itself, with the road's centre hl BELOW it
// (src/geom/path.js: x − hl·U), so closing a tube dropped the floor 7 m under the curve the user drew and opening it lifted the floor back: the hump, and the
// wall tips rising 9 m over the tube's ceiling. Now the axis is hl ABOVE the curve and the road's centre is x + hl·(U0 − U): on the curve while the road is not
// rolled, turned about the axis when it is. The keeper's track, rebuilt from his readout: a straight, a piece closing a full tube, 254.1 m opening it, width 44. Rows:
//   1  the road's centre is ON THE CURVE the user drew at every station of the closing and opening pieces (≤ 1 cm)
//   2  the floor is level through both: its centre's height moves ≤ 1 cm (the track has no climb anywhere)
//   3  the walls rise above the floor no more than a fixed-width circular arc must: (w/θ)(1 − cos θ/2) at the row's own sweep θ (+ 1 cm), and the export's
//      self-check finds no self-intersection
//   4  the cross-sections are the ones the adapter gave before (the segments are not touched), and the open end is on the curve as before
//   5  a ROLLED closed tube still turns about its own axis: the road's centre is hl from the axis (x + hl·U0), and the word builder's constant heartline is as it was
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const AD = require('../src/core/adapter.js');
const G = require('../src/geom/index.js');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** The keeper's track from his readout (10:20): a straight, a piece closing a full tube, then 254.1 m with the sweep from 360 to 0, width 44. */
function keeperTrack() {
  let d = extend(D.createDoc('tube open'), { length: 300, targets: { w: 44 }, transition: 20 });
  d = extend(d, { length: 300, targets: { t: 360 } });
  return extend(d, { length: 254.1, targets: { t: 0 } });
}
function built(d) {
  const segs = AD.toSegments(d), start = { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch };
  const p = AD.offsetPath(d, segs, G.buildPath(segs, { step: 2, closed: false, start }));
  return { segs, p, mesh: G.buildMesh(p, segs, { selfCheck: true }) };
}
const D0 = keeperTrack(), B0 = built(D0), S1 = D0.pieces[0].length, S3 = S1 + D0.pieces[1].length + D0.pieces[2].length;
const tubeSamples = B0.p.samples.filter((x) => x.s >= S1 - 1e-9 && x.s <= S3 + 1e-9);

test('row 1: the road\'s centre stays on the curve the user drew at every station of the closing and opening pieces (≤ 1 cm)', () => {
  assert.ok(B0.segs.some((g) => g.heartline1 > 6.9), 'control: the closed tube has its heartline (w/2π ≈ 7 m)');
  let worst = 0, at = null; for (const x of tubeSamples) { const e = dist(x.pos, x._x); if (e > worst) { worst = e; at = x.s - S1; } }
  assert.ok(worst <= 0.01, `the centre leaves the curve by ${worst.toFixed(3)} m at s ${at && at.toFixed(1)} m into the tube pieces`);
});

test('row 2: the floor is level through the closing and opening pieces: its centre\'s height moves ≤ 1 cm (no climb anywhere, no hump)', () => {
  const ys = tubeSamples.map((x) => x.pos[1]), lo = Math.min(...ys), hi = Math.max(...ys);
  assert.ok(hi - lo <= 0.01, `the floor's centre moves ${(hi - lo).toFixed(3)} m (from ${lo.toFixed(3)} to ${hi.toFixed(3)})`);
});

/** Each mesh row of the opening piece in world space: { s, top (highest point above the floor's centre, along the unrolled up), w, t }. */
function rows(B, d) {
  const st = B.mesh._state, kids = B.mesh.scene.root.children, out = [], P2 = d.pieces[1], P3 = d.pieces[2], s2 = S1 + P2.length;
  kids.forEach((node, k) => {
    const rec = B.mesh.cells[k]; if (rec.seam) return;
    const pc = st.pieces[rec.piece], m = node.children[0], M = node.matrix, K = pc.K, c = pc.cells[Number(m.name.slice(m.name.lastIndexOf('_') + 1))], mid = pc.Us.findIndex((u) => Math.abs(u) < 1e-9);
    const w = (i) => { const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2]; return [x * M[0] + y * M[4] + z * M[8] + M[12], x * M[1] + y * M[5] + z * M[9] + M[13], x * M[2] + y * M[6] + z * M[10] + M[14]]; };
    for (let r = 0; r < c.rowS.length; r++) {
      const s = c.rowS[r]; if (s < s2 - 1e-9 || s > S3 + 1e-9 || mid < 0) continue;   // the OPENING piece (the bar's): the closing one starts from the straight's bowl, which is no arc
      const floor = w(r * K + mid); let top = -Infinity; for (let i = 0; i < K; i++) top = Math.max(top, w(r * K + i)[1] - floor[1]);
      const x = D.valuesAt(P3, Math.min(P3.length, s - s2));
      out.push({ s, top, w: x.w, t: x.t });
    }
  });
  return out;
}

test('row 2b: the keeper\'s own case (the panel\'s fields, widths 44 and 30): a track that is a closed 45 m tube from its start, still turning, opened in 254.1 m', () => {
  const { extendOptions } = require('../app/core/panel.js');
  // like his saved track: 1000 m of closed tube, 1000 m turning into a half turn, 300 m still turning (the turn rate he had, −0.18°/m), all 45 m wide
  let d = extend(D.createDoc('hump'), { length: 1000, first: { t: 360, w: 45 }, targets: { t: 360, w: 45 } });
  d = extend(d, { length: 1000, targets: { kh: -0.00314 } }); d = extend(d, { length: 300 });
  assert.equal(D.kindOf(d.pieces[2]), 'tube');
  for (const width of ['44', '30']) {
    const o = extendOptions({ length: '254.1', turn: '0', climb: '0', bank: '0', width, cup: '', edge: '0', start: '0.64', tube: '0', atStart: { turn: true, climb: true } });
    const e = extend(d, o), B = built(e), s0 = e.pieces.slice(0, -1).reduce((a, p) => a + p.length, 0), sm = B.p.samples.filter((x) => x.s >= s0 - 1e-9);
    const off = Math.max(...sm.map((x) => dist(x.pos, x._x))), ys = sm.map((x) => x.pos[1] - sm[0].pos[1]);
    assert.ok(off <= 0.01, `width ${width}: the centre leaves the curve by ${off.toFixed(3)} m`);
    assert.ok(Math.max(...ys) - Math.min(...ys) <= 0.01, `width ${width}: the floor rises ${Math.max(...ys).toFixed(3)} m above the head`);
    assert.equal(B.mesh.selfCheck.intersections.filter((x) => x.s >= s0).length, 0, `width ${width}: no self-intersection in the opening piece`);
  }
});

test('row 3: in the opening piece the walls rise above the floor no more than a fixed-width circular arc must at the row\'s sweep, and the self-check finds no self-intersection', () => {
  const arc = (w, t) => { const th = (t * Math.PI) / 180; return th < 1e-9 ? 0 : (w / th) * (1 - Math.cos(th / 2)); };
  const R = rows(B0, D0); assert.ok(R.length > 100, `control: ${R.length} rows`);
  let worst = -Infinity, at = null; for (const r of R) { const over = r.top - arc(r.w, r.t); if (over > worst) { worst = over; at = r; } }
  assert.ok(worst <= 0.01, `a wall rises ${worst.toFixed(3)} m above its own arc at s ${at && (at.s - S1).toFixed(1)} (sweep ${at && at.t.toFixed(1)}°)`);
  assert.deepEqual([B0.mesh.selfCheck.intersections.length, B0.mesh.selfCheck.stacked.length], [0, 0], 'the self-check is clean');
});

test('row 4: the cross-sections are the adapter\'s, untouched, and the open end is on the curve, as before', () => {
  // the segments are the adapter's: this lap changes only where the road's centre sits relative to the curve, never a profile
  const P3 = D0.pieces[2], last = B0.segs[B0.segs.length - 1], first3 = B0.segs.find((g, i) => i > 0 && g.id === P3.id);
  assert.equal(first3.profile.font, 'tube'); assert.ok(last.profile.psi.every((x) => Math.abs(x) < 1e-9), 'the open end is flat');
  const end = B0.p.samples[B0.p.samples.length - 1]; assert.ok(dist(end.pos, end._x) < 1e-9, 'the open end: the centre IS the curve');
});

test('row 5: a ROLLED closed tube still turns about its own axis, hl above the curve; the word builder\'s constant heartline is as it was', () => {
  let d = extend(D.createDoc('rolled'), { length: 200, targets: { w: 44 }, transition: 20 });
  d = extend(d, { length: 300, targets: { t: 360 } });
  d = extend(d, { length: 300, targets: { phi: Math.PI / 2 } });
  const B = built(d), s0 = d.pieces[0].length + d.pieces[1].length + 1;
  let checked = 0;
  for (let i = 0; i < B.p.samples.length - 1; i++) {
    const x = B.p.samples[i], g = B.segs[x.seg]; if (x.s < s0 || g.heartline1 === undefined) continue;
    const hl = g.heartline + (g.heartline1 - g.heartline) * ((x.s - B.p.samples.find((y) => y.seg === x.seg).s) / g.length);
    const U0 = [x.T[1] * x._R[2] - x.T[2] * x._R[1], x.T[2] * x._R[0] - x.T[0] * x._R[2], x.T[0] * x._R[1] - x.T[1] * x._R[0]];
    const axis = [x._x[0] + U0[0] * hl, x._x[1] + U0[1] * hl, x._x[2] + U0[2] * hl];
    assert.ok(Math.abs(dist(x.pos, axis) - hl) < 1e-6, `s ${x.s.toFixed(1)}: the centre is ${dist(x.pos, axis).toFixed(4)} m from the axis, the heartline is ${hl.toFixed(4)}`);
    checked++;
  }
  assert.ok(checked > 50, `control: ${checked} rolled stations checked`);
  assert.ok(Math.max(...B.p.samples.filter((x) => x.s > s0 + 200).map((x) => dist(x.pos, x._x))) > 6, 'control: rolled, the road is off the curve, turned about the axis');
  // a word's heartline: a constant heartline with no heartline1 keeps the road hl below the curve (INTERFACES §1)
  const segs = [{ word: 'w', part: 'body', kind: 'road', length: 40, k0: 0, k1: 0, kp0: 0, kp1: 0, roll0: 0, roll1: 0, heartline: 1.2, profile: null, blend: null, speed: null }];
  const p = G.buildPath(segs, { step: 2, closed: false });
  for (const x of p.samples) assert.ok(Math.abs(x._x[1] - x.pos[1] - 1.2) < 1e-12, 'the word\'s track is 1.2 m below its heartline');
});
