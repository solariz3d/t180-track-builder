// core_water.test.js: node --test --test-concurrency=4 test/core_water.test.js
// The water (src/core/water.js; the core spec §5, D185, pane C), held to known answers. Every surface is built by the
// builder's own geometry (src/geom/path.js buildPath), so the water rides the SAME sample shape the adapter emits
// ({ s, pos, T, L, U, kvec, ... } plus the cross-section), until A's src/core/adapter.js exists.
// TEST 5 is B's registration, verbatim in its numbers: exo_memory/loop/d185_registration_2026-09-28.md (sha256
// 978be18b57033d6d), its theory water_theory.json (sha256 0ce5dcec01f7d39d), computed from references/06 §7 in the graph form.
// The other checks hold the formulas the water uses to references/06 §7–§8.
// The checks are a list (exported for core_water_mutation.test.js): each takes the water module and throws on a failure.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPath } = require('../src/geom/path.js');

const g = 9.81;
const flat = (W) => ({ u: [-W / 2, 0, W / 2], psi: [0, 0, 0] });
// a closed LEFT circle of radius R banked INTO the turn by theta (the inside, +u, down), cross-section `profile`
function ring(W, R, theta, profile, pieces = 1) {
  const segs = Array.from({ length: pieces }, (_, i) => ({ length: 2 * Math.PI * R / pieces, k0: 1 / R, k1: 1 / R, roll0: -theta, roll1: -theta,
    profile: Array.isArray(profile) ? profile[i] : profile }));
  const path = buildPath(segs, { closed: true });
  return W.surfaceFrom({ samples: path.samples, closed: true, lengthM: path.lengthM, profileAt: (m) => segs[m.seg].profile });
}
const open = (W, segs, start) => { const path = buildPath(segs, { start }); return W.surfaceFrom({ samples: path.samples, profileAt: (m) => segs[m.seg].profile }); };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} (±${tol})`);

// B's sealed theory (water_theory.json), d outward +; on a LEFT ring the outside is −u, so d = −u
const T5A = [[-14, -14, -4.6874], [-7, -7, -2.3385], [0, 0, 0], [7, 2.3282, 7], [14, 4.6463, 14]];
const T5B = [[-14, 187.24], [-7, 163.02], [0, 134.56], [7, 98.23], [14, 34.72]];
const V5 = 70.0357, R5 = 500, W5 = 30;
const pour5 = (W, theta, opts) => W.pour(ring(W, R5, theta, flat(W5)), { speed: V5, streams: T5A.map(([d]) => ({ u: -d })), ...opts });

const CHECKS = [
  { name: 'TEST 5a (B, sealed): balanced 45° ring at v = √(gR tan θ): the centre rides one height, none spills or lifts, ranges and energy as registered', run(W) {
    const r = pour5(W, Math.PI / 4, { laps: 1 });
    assert.deepEqual(r.reds.filter((x) => x.type !== 'shock'), [], 'no spill and no lift-off');
    r.streams.forEach((st, k) => {
      const [d0, dMin, dMax] = T5A[k], d = st.track.u.map((u) => -u);
      assert.equal(st.outcome, 'ran', `d0 ${d0}: ran the lap`);
      assert.ok(st.track.s.at(-1) - st.track.s[0] >= 2 * Math.PI * R5 - 1, `d0 ${d0}: a whole lap`);
      assert.ok(Math.min(...st.track.N) > 0, `d0 ${d0}: N > 0 throughout`);
      assert.ok(Math.max(...d.map(Math.abs)) < 15, `d0 ${d0}: on the road`);
      if (d0 === 0) assert.ok(Math.max(...d.map(Math.abs)) <= 0.10, `centre: |d| ≤ 0.10 m, got ${Math.max(...d.map(Math.abs))}`);
      else { close(Math.min(...d), dMin, 0.5, `d0 ${d0}: dMin`); close(Math.max(...d), dMax, 0.5, `d0 ${d0}: dMax`); }
      assert.ok(st.energy.maxAbsDrift / Math.abs(st.energy.E0) <= 0.005, `d0 ${d0}: energy within 0.5% of |E0|`);
    });
  } },
  { name: 'TEST 5b (B, sealed): the same v on a 10° ring: every stream spills over the OUTER lip, RED, within ±5% / ±5 m of the theory', run(W) {
    const r = pour5(W, 10 * Math.PI / 180, { distance: 400 });
    r.streams.forEach((st, k) => {
      const [d0, want] = T5B[k];
      assert.equal(st.outcome, 'spill', `d0 ${d0}: spills`);
      close(-st.at.u, 15, 1e-9, `d0 ${d0}: over the OUTER lip`);
      close(st.at.s, want, Math.max(0.05 * want, 5), `d0 ${d0}: spill station`);
      assert.ok(Math.min(...st.track.N) > 0, `d0 ${d0}: no lift-off before the spill`);
      assert.ok(r.reds.some((x) => x.type === 'spill' && x.streams[0] === k), `d0 ${d0}: flagged RED`);
    });
  } },
  { name: 'TEST 5b, tighter than the seal (pane C\'s own bar): each spill station within 0.1 m of B\'s sealed theory, located INSIDE the step', run(W) {
    const r = pour5(W, 10 * Math.PI / 180, { distance: 400 });
    r.streams.forEach((st, k) => close(st.at.s, T5B[k][1], 0.1, `d0 ${T5B[k][0]}: spill station`));
  } },
  { name: '06 §8 (cone, too slow): on a 45° ring at the balance speed of 400 m the centre stream slides down and spills over the INNER lip, as the turning radius predicts', run(W) {
    const th = Math.PI / 4, t = Math.tan(th), v = Math.sqrt(g * 400 * t), other = (v * v + Math.sqrt(v ** 4 + 8 * g * t * v * v * R5)) / (4 * g * t);
    assert.ok(other < R5 - 15 * Math.cos(th), 'the theory puts the turn inside the inner lip');
    const st = W.pour(ring(W, R5, th, flat(W5)), { speed: v, streams: [{ u: 0 }], laps: 1 }).streams[0];
    assert.equal(st.outcome, 'spill'); close(st.at.u, 15, 1e-9, 'over the INNER lip (+u on a left ring)');
  } },
  { name: '06 §8 (cone turning radius): on a 45° ring at the balance speed of 495 m, each stream swings between its start and the radius energy + angular momentum give', run(W) {
    const th = Math.PI / 4, t = Math.tan(th), v = Math.sqrt(g * 495 * t);
    const r = W.pour(ring(W, R5, th, flat(W5)), { speed: v, streams: [{ u: -10 }, { u: 0 }, { u: 10 }], laps: 1 });
    assert.deepEqual(r.reds.filter((x) => x.type !== 'shock'), [], 'none spills');
    for (const st of r.streams) {
      const r0 = R5 - st.u0 * Math.cos(th), other = (v * v + Math.sqrt(v ** 4 + 8 * g * t * v * v * r0)) / (4 * g * t), radii = st.track.u.map((u) => R5 - u * Math.cos(th));
      close(Math.min(...radii), Math.min(r0, other), 0.3, `u0 ${st.u0}: inner turning radius`);
      close(Math.max(...radii), Math.max(r0, other), 0.3, `u0 ${st.u0}: outer turning radius`);
    }
  } },
  { name: '06 §8 (crest): over a vertical crest of radius 50 m the stream lifts off where cos p = (v0²/R + 2g·cos p0)/(3g), RED', run(W) {
    const Rv = 50, p0 = 0.3, v0 = 15, surf = open(W, [{ length: Rv * 1.4, kp0: -1 / Rv, kp1: -1 / Rv, profile: flat(20) }], { p: p0 });
    const r = W.pour(surf, { speed: v0, streams: [{ u: 0 }] }), st = r.streams[0], c = (v0 * v0 / Rv + 2 * g * Math.cos(p0)) / (3 * g);
    assert.equal(st.outcome, 'liftoff'); close(st.at.s, Rv * (p0 + Math.acos(c)), 0.2, 'lift-off station');
    assert.ok(r.reds.some((x) => x.type === 'liftoff'));
  } },
  { name: 'the normal force matches the cone\'s closed form N = g·cos β + (v_φ²/r)·sin β at EVERY step of a 45° lap, across the closing seam\'s short span too', run(W) {
    // found by pane C on 2026-09-28: the builder's last span before a closed seam is 0.093 m, not 0.5, and an equal-spacing
    // central difference for the frame's slope put N 0.215 m/s² low there, at an off-centre stream only
    const th = Math.PI / 4, r = W.pour(ring(W, R5, th, flat(W5)), { speed: V5, streams: [{ u: -14 }, { u: 7 }], laps: 1 });
    for (const st of r.streams) {
      const r0 = R5 - st.u0 * Math.cos(th);
      st.track.N.forEach((N, i) => { const rr = R5 - st.track.u[i] * Math.cos(th), vphi = V5 * r0 / rr;
        close(N, g * Math.cos(th) + vphi * vphi / rr * Math.sin(th), 0.01 * g, `u0 ${st.u0}, s ${st.track.s[i].toFixed(2)}: N`); });
    }
  } },
  { name: 'SHOCK: two streams angled toward each other on a flat straight cross at s = gap/(2·tan a), RED; parallel streams do not', run(W) {
    const surf = () => open(W, [{ length: 200, profile: flat(20) }]), a = 0.05;
    const r = W.pour(surf(), { speed: 20, streams: [{ u: -3, angle: a }, { u: 3, angle: -a }] }), sh = r.reds.filter((x) => x.type === 'shock');
    assert.equal(sh.length, 1); close(sh[0].s, 3 / Math.tan(a), 0.05, 'shock station'); close(sh[0].u, 0, 0.01, 'on the centre line');
    assert.deepEqual(W.pour(surf(), { speed: 20, streams: [{ u: -3 }, { u: 3 }] }).reds, [], 'parallel: no red');
  } },
  { name: 'ENERGY: on a banked ring whose dish deepens and widens smoothly around the lap (a different cross-section at every sample), a lap conserves ½v² + g·y within 0.5%', run(W) {
    const R = 300, Lap = 2 * Math.PI * R, seg = { length: Lap, k0: 1 / R, k1: 1 / R, roll0: -0.3, roll1: -0.3 };
    const path = buildPath([seg], { closed: true }), at = (s) => 0.5 + 0.5 * Math.sin(2 * Math.PI * s / Lap);   // 0 … 1, closed
    const prof = (m) => { const a = at(m.s), w = 15 + 2 * a, e = 0.35 + 0.15 * a; return { u: [-w, -w / 2, 0, w / 2, w], psi: [e, e / 3, 0, e / 3, e] }; };
    const r = W.pour(W.surfaceFrom({ samples: path.samples, closed: true, lengthM: path.lengthM, profileAt: prof }), { speed: 30, count: 3, laps: 1 });
    assert.deepEqual(r.reds.filter((x) => x.type !== 'shock'), [], 'stays on');
    for (const st of r.streams) { assert.equal(st.outcome, 'ran'); assert.ok(st.energy.maxRelDrift <= 0.005, `drift ${st.energy.maxRelDrift}`); }
    assert.ok(r.energy.ok);
    // the instrument is live: the same pour at a coarse step (h 0.3 s, 9 m) shows a drift it can report
    const coarse = W.pour(W.surfaceFrom({ samples: path.samples, closed: true, lengthM: path.lengthM, profileAt: prof }), { speed: 30, streams: [{ u: -8 }], laps: 1, h: 0.3 });
    assert.ok(coarse.streams[0].energy.maxAbsDrift > 1e-4, `a coarse step must show drift (${coarse.streams[0].energy.maxAbsDrift})`);
  } },
  { name: 'a cross-section that STEPS between two samples is a real kink in the surface, and the water reads it (lift-off at the step), never smooths it away', run(W) {
    const dishA = { u: [-15, -8, 0, 8, 15], psi: [0.35, 0.1, 0, 0.1, 0.35] }, dishB = { u: [-16, -6, 0, 6, 16], psi: [0.5, 0.15, 0, 0.15, 0.5] };
    const r = W.pour(ring(W, 300, 0.2, [dishA, dishB], 2), { speed: 30, streams: [{ u: -2 }], laps: 1 });
    assert.equal(r.streams[0].outcome, 'liftoff'); close(r.streams[0].at.s, Math.PI * 300, 1, 'at the half-lap step');
  } },
  // The next two hold the integrator's CONSISTENCY to a bar far below the spec's 0.5%: a wrong term in the normal force or the
  // surface's derivatives leaves the particle off the surface each step, and the projection then bleeds energy. The bars are
  // pane C's own, set from the correct code's measured drift (twist 9.6e-8; ramp 1.5e-6, against 7.2e-4 with the blend's
  // s-derivative removed; scratchpad d185/gaps.log, gaps2.log) with margin, and they are what makes the cross term S_su and
  // the blend's s-derivative visible (mutants W2, W12).
  { name: 'ENERGY on a TWISTING straight (roll 0 → 0.6 over 120 m), streams crossing it: drift ≤ 1e-5 (the cross term S_su at work)', run(W) {
    const tw = [{ length: 120, roll0: 0, roll1: 0.6, profile: flat(30) }], r = W.pour(open(W, tw), { speed: 25, streams: [{ u: -8, angle: 0.08 }, { u: 5, angle: -0.05 }] });
    for (const st of r.streams) assert.ok(st.energy.maxRelDrift <= 1e-5, `drift ${st.energy.maxRelDrift}`);
  } },
  { name: 'ENERGY where the dish DEEPENS over 40 m (a different cross-section at every sample), streams crossing it: drift ≤ 1e-4 (the blend\'s s-derivatives at work)', run(W) {
    const segs = [{ length: 120, profile: flat(30) }], path = buildPath(segs), dep = (s) => { const x = Math.min(1, Math.max(0, (s - 40) / 40)); return x * x * (3 - 2 * x); };
    const prof = (m) => { const e = 0.1 + 0.5 * dep(m.s); return { u: [-15, -7, 0, 7, 15], psi: [e, e / 3, 0, e / 3, e] }; };
    const r = W.pour(W.surfaceFrom({ samples: path.samples, profileAt: prof }), { speed: 12, streams: [{ u: -4, angle: 0.02 }, { u: 3, angle: -0.02 }] });
    for (const st of r.streams) { assert.ok(st.track.s.at(-1) > 90, 'it crossed the ramp'); assert.ok(st.energy.maxRelDrift <= 1e-4, `drift ${st.energy.maxRelDrift}`); }
  } },
  // a 20 m gap on a 100 m ring: extrapolating the last span that far is visibly wrong, so the first sample one lap on must
  // close it (on a 500 m ring with a 5 m gap the extrapolation was still good to 2e-5 g, and hid the difference: gaps2.log)
  { name: 'a closed loop whose samples stop 20 m short of the seam is closed by the first sample one lap on: the centre rides one height, N as the cone says', run(W) {
    const R = 100, th = Math.PI / 4, v = Math.sqrt(g * R), segs = [{ length: 2 * Math.PI * R, k0: 1 / R, k1: 1 / R, roll0: -th, roll1: -th, profile: flat(W5) }];
    const p = buildPath(segs, { closed: true }), cut = p.samples.filter((m) => m.s <= p.lengthM - 20);
    const r = W.pour(W.surfaceFrom({ samples: cut, closed: true, lengthM: p.lengthM, profileAt: () => segs[0].profile }), { speed: v, streams: [{ u: 0 }, { u: -12 }], laps: 1 });
    assert.ok(Math.max(...r.streams[0].track.u.map(Math.abs)) <= 0.10, 'centre: one height');
    const r0 = R + 12 * Math.cos(th); r.streams[1].track.N.forEach((N, i) => { const rr = R - r.streams[1].track.u[i] * Math.cos(th), vp = v * r0 / rr;
      close(N, g * Math.cos(th) + vp * vp / rr * Math.sin(th), 0.01 * g, `s ${r.streams[1].track.s[i].toFixed(2)}: N`); });
  } },
  { name: 'an open road\'s end stops the water as "end", not red', run(W) {
    const r = W.pour(open(W, [{ length: 60, profile: flat(20) }]), { speed: 30, count: 3 });
    assert.deepEqual(r.streams.map((s) => s.outcome), ['end', 'end', 'end']); assert.deepEqual(r.reds, []);
  } },
  { name: 'a road whose s is NOT arc length (a lifted sample, D186) rides right when its samples carry d1 = dpos/ds and d2; without them it is refused', run(W) {
    // the 06 §8 crest, re-parameterised by s' = s/σ (σ = 1.3 m of road per unit of s'): d1 = σ·T, d2 = σ²·kvec, exact
    const Rv = 50, p0 = 0.3, v0 = 15, sig = 1.3, segs = [{ length: Rv * 1.4, kp0: -1 / Rv, kp1: -1 / Rv, profile: flat(20) }], p = buildPath(segs, { start: { p: p0 } });
    const re = p.samples.map((m) => ({ s: m.s / sig, seg: m.seg, pos: m.pos, T: m.T, L: m.L, U: m.U, kvec: m.kvec, d1: m.T.map((x) => x * sig), d2: m.kvec.map((x) => x * sig * sig) }));
    const st = W.pour(W.surfaceFrom({ samples: re, profileAt: () => segs[0].profile }), { speed: v0, streams: [{ u: 0 }] }).streams[0], c = (v0 * v0 / Rv + 2 * g * Math.cos(p0)) / (3 * g);
    assert.equal(st.outcome, 'liftoff'); close(st.at.s * sig, Rv * (p0 + Math.acos(c)), 0.2, 'lift-off station, in metres of road');
    assert.ok(st.energy.maxRelDrift < 1e-6, `energy ${st.energy.maxRelDrift}`);
    assert.throws(() => W.surfaceFrom({ samples: re.map(({ d1, d2, ...m }) => m), profileAt: () => segs[0].profile }), /not ∫T ds/, 'without d1, d2');
    assert.throws(() => W.surfaceFrom({ samples: re.map(({ d2, ...m }) => m), profileAt: () => segs[0].profile }), /come together/);
  } },
  { name: 'refused loudly: no speed, zero speed, no profile, no streams, and samples whose pos is not ∫T ds (a heartline offset)', run(W) {
    const segs = [{ length: 60, profile: flat(20) }], s = open(W, segs);
    assert.throws(() => W.pour(s, {}), /speed/); assert.throws(() => W.pour(s, { speed: 0 }), /speed/);
    assert.throws(() => W.pour(s, { speed: 10, streams: [] }), /no streams/);
    assert.throws(() => W.surfaceFrom({ samples: buildPath(segs).samples }), /profileAt/);
    const gap = [{ length: 50, profile: flat(20) }, { length: 20, kind: 'gap', profile: null }, { length: 50, profile: flat(20) }];
    assert.throws(() => W.surfaceFrom({ samples: buildPath(gap).samples, profileAt: (m) => gap[m.seg].profile }), /no road under it/, 'a flight\'s gap');
    const hl = [{ length: 60, kp0: 0.05, kp1: 0.05, heartline: 1.2, profile: flat(20) }];
    assert.throws(() => W.surfaceFrom({ samples: buildPath(hl).samples, profileAt: () => hl[0].profile }), /not ∫T ds/);
  } },
];
module.exports = CHECKS;

if (require.main === module) {
  const W = require('../src/core/water.js');
  for (const c of CHECKS) test(c.name, () => c.run(W));
}
