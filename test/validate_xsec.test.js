// validate_xsec.test.js (D225): the cross-section lap's validator rows, the spiral, the export and the water, against the seal
// (exo_memory/loop/cross_section_seal_registration_2026-10-03.md): S1 bank winds, S2 the heartline and the smooth floor, S3 the roll-rate bar, S4 the spiral's loads,
// T1 iv the narrowest tube, T2 iv the closing slot, E5 edge exports, X1 the closed tube's ceiling. node --test, under the heavy-run lock, --test-concurrency=1.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const R = require('../src/core/readout.js');
const V = require('../src/validate/index.js');
const W = require('../src/core/water.js');
const FW = require('../src/export/fromwords.js');
const P = require('../src/geom/profile.js');
const { buildMesh } = require('../src/geom/mesh.js');
const { startLayout } = require('../app/core/coreshell.js');

const DEG = Math.PI / 180, V460 = 460 / 3.6;
const start = (o = {}) => extend(D.createDoc('x'), { length: 100, ...o });
const check = (doc, opts = {}) => { const { path, segments } = A.toPath(doc), v = V.validate(path, segments, { designSpeed: V460, ...opts }); return { path, segments, v }; };
const reasons = (v, kind = 'red') => v[kind].map((r) => r.reason);

// ── S1: bank winds through ±180 (regression, V5) ─────────────────────────────────────────────────────────────────────────
test('S1: bank 360° over 300 m is accepted and read back as 360, then −540 (nothing wraps, clamps or refuses); the adapter rolls continuously', () => {
  let d = extend(start(), { length: 300, targets: { phi: 2 * Math.PI } }); d = extend(d, { length: 200, targets: { phi: -3 * Math.PI } });
  assert.ok(Math.abs(R.pieceReadout(d, 1).bankToDeg - 360) < 1e-6); assert.ok(Math.abs(R.pieceReadout(d, 2).bankToDeg + 540) < 1e-6); assert.ok(Math.abs(R.pieceReadout(d, 2).bankFromDeg - 360) < 1e-6);
  const phi = D.channelAt(d.pieces[1], 'phi', 0); let prev = phi.v; for (let s = 1; s <= 300; s += 1) { const v = D.channelAt(d.pieces[1], 'phi', s).v; assert.ok(v >= prev - 1e-9 && v - prev < 0.05, 'monotone and continuous'); prev = v; }
  const segs = A.toSegments(d); for (let j = 1; j < segs.length; j++) assert.ok(Math.abs(segs[j].roll0 - segs[j - 1].roll1) < 1e-9, `the roll steps ${segs[j].roll0 - segs[j - 1].roll1} at joint ${j}`);
});

// ── S3: the roll-rate bar ───────────────────────────────────────────────────────────────────────────────────────────────
const spin = (L) => check(extend(start({ length: 60 }), { length: L, targets: { phi: 2 * Math.PI } }));
test('S3: a full 360° of bank is RED over 300 m (the keeper\'s own example, 1.80°/m), AMBER over 450 m (1.20), clear over 600 m (0.90): the bar is 1.2144 red, 0.9338 amber, read over a 20 m chord', () => {
  const rate = (r) => Math.max(0, ...r.map((x) => x.worst)), want = { 300: 1.7973, 450: 1.1992, 600: 0.8997 };
  for (const L of [300, 450, 600]) {
    const { v } = spin(L), reds = v.red.filter((x) => x.reason === 'roll-rate'), ambers = v.amber.filter((x) => x.reason === 'roll-rate'), peak = rate([...reds, ...ambers]);
    if (L === 300) assert.ok(reds.length && !ambers.length || reds.length, '300 m is red'); if (L === 450) assert.ok(!reds.length && ambers.length, '450 m is amber, not red'); if (L === 600) assert.ok(!reds.length && !ambers.length, '600 m is clear');
    if (peak > 0) assert.ok(Math.abs(peak - want[L]) / want[L] < 0.02, `${L} m: the peak ${peak} against the seal's ${want[L]}`);
  }
  assert.strictEqual(V.ROLL_RED_DEG_M, 1.2144); assert.strictEqual(V.ROLL_AMBER_DEG_M, 0.9338); assert.strictEqual(V.ROLL_CHORD_M, 20);
});
test('S3: the rate is the frame-intrinsic one: a plain climbing turn (constant bank, the frame twisting) reads 0, and revalidate equals validate (the check is recomputed whole)', () => {
  const d = extend(extend(start(), { length: 200, transition: 50, targets: { kh: 1 / 150, kv: 0.002 } }), { length: 200 });
  const { path, segments, v } = check(d); assert.ok(!reasons(v).includes('roll-rate') && !reasons(v, 'amber').includes('roll-rate'), 'a plain turn has no roll rate');
  const half = Math.floor(path.samples.length / 2), a = V.validate({ ...path, samples: path.samples.slice(0, half) }, segments, { designSpeed: V460 });
  const rv = V.revalidate(a, path, segments, path.samples[half].s, { designSpeed: V460 }); assert.deepStrictEqual(rv.red, v.red); assert.deepStrictEqual(rv.amber, v.amber);
});

// ── T1 iv and the cap ───────────────────────────────────────────────────────────────────────────────────────────────────
const tubeTrack = (w, { closedLen = 120 } = {}) => extend(extend(start({ length: 80, first: { w } }), { length: 100, transition: 100, targets: { t: 360 } }), { length: closedLen });
test('T1 iv (ruling 1): a CLOSED tube narrower than 9.43 m is red by name (tube-too-narrow); 12 m and 31 m are not', () => {
  const reds = (w) => check(tubeTrack(w)).v.red.filter((r) => r.reason === 'tube-too-narrow');
  assert.ok(reds(8).length >= 1 && reds(8)[0].worst < 9.43, 'w 8 is refused by name');
  assert.strictEqual(reds(12).length, 0); assert.strictEqual(reds(31).length, 0);
});
test('E2: the validator reds an edge past the cap by name (edge-past-cap) on a segment built past it, and not on any a document can hold', () => {
  const ok = extend(extend(start({ length: 60 }), { length: 60, targets: { c: 100 } }), { length: 100, transition: 20, targets: { e: 40 } });
  assert.ok(!reasons(check(ok).v).includes('edge-past-cap'));
  const { path, segments } = A.toPath(ok), bad = segments.map((g) => (g.profile && g.profile.font === 'edge' ? { ...g, profile: { ...g.profile, psi: g.profile.psi.map((x, i, a) => (i === a.length - 1 || i === 0 ? 160 * DEG : x)) }, blend: null } : g));
  assert.ok(V.validate(path, bad, { designSpeed: V460 }).red.some((r) => r.reason === 'edge-past-cap'), 'a 160° edge is refused');
});

// ── S2 and S4: the spiral of a closed tube ──────────────────────────────────────────────────────────────────────────────
/** A straight legacy start, a 100 m closing transition, then 700 m of closed tube rolling a full turn: the keeper's spiral. */
function spiral() {
  let d = extend(start({ length: 60 }), { length: 100, transition: 100, targets: { t: 360 } });
  d = extend(d, { length: 700, targets: { phi: 2 * Math.PI } }); return d;
}
test('S2 (i, ii): every segment of the closed tube carries the heartline R = w/2π, and the road centre steps at most 1 mm at every segment joint, including where the tube closes', () => {
  const d = spiral(), t = A.toPath(d), R0 = 31 / (2 * Math.PI), tubeSegs = t.segments.filter((g) => g.id === d.pieces[2].id);
  for (const g of tubeSegs) assert.ok(Math.abs(g.heartline - R0) < 1e-3 && Math.abs(g.heartline1 - R0) < 1e-3, `a closed segment's heartline is ${g.heartline}, ${g.heartline1}, not ${R0}`);
  let worst = 0; for (let j = 1; j < t.segments.length; j++) { const a = t.path.segEnd[j - 1].pos, b = t.path.samples[t.path.segFirst[j]].pos; worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
  assert.ok(worst <= 1e-3, `the road centre steps ${worst} m at a segment joint`);
});
test('S2 (iii): the floor of the spiral is a smooth helix: the road centre has curvature (finite differences) at most 1.1 × the helix R·ω²/(1 + R²ω²) + 1e-3, and lies at radius R from the tube axis within 5 mm', () => {
  const d = spiral(), t = A.toPath(d), R0 = 31 / (2 * Math.PI), off = d.pieces[0].length + d.pieces[1].length, S = t.path.samples, P2 = d.pieces[2];
  let worstK = -Infinity, n = 0;
  for (let i = 1; i < S.length - 1; i++) {
    const s = S[i].s - off; if (s < 10 || s > P2.length - 10) continue;
    const a = S[i - 1], b = S[i], c = S[i + 1], h1 = b.s - a.s, h2 = c.s - b.s; if (!(h1 > 0.3 && h2 > 0.3)) continue;
    const d2 = [0, 1, 2].map((k) => (2 * ((c.pos[k] - b.pos[k]) / h2 - (b.pos[k] - a.pos[k]) / h1)) / (h1 + h2)), kappa = Math.hypot(...d2);
    const om = D.channelAt(P2, 'phi', s).d1, helix = (R0 * om * om) / (1 + R0 * R0 * om * om);
    worstK = Math.max(worstK, kappa - (1.1 * helix + 1e-3)); n++;
  }
  assert.ok(n > 800, 'sampled the spiral'); assert.ok(worstK <= 0, `the road centre curvature exceeds the helix by ${worstK} /m`);
  // the floor centre is at radius R from the tube axis, the straight line through (a road-centre point + R·U) along T
  const b0 = S.find((x) => x.s - off > 20), o = [0, 1, 2].map((k) => b0.pos[k] + R0 * b0.U[k]); let worstR = 0;
  for (const x of S) { const s = x.s - off; if (s < 20 || s > P2.length - 5) continue; const q = [0, 1, 2].map((k) => x.pos[k] - o[k]), al = q[0] * b0.T[0] + q[1] * b0.T[1] + q[2] * b0.T[2], pp = Math.hypot(...q.map((v, k) => v - al * b0.T[k])); worstR = Math.max(worstR, Math.abs(pp - R0)); }
  assert.ok(worstR <= 5e-3, `the floor centre is ${worstR} m off the radius R from the tube axis`);
});
test('S4: the validator reads the spiral\'s load: the floor centre\'s normal load is 1 g·(gravity along the floor normal) + v²·κ_helix/g within 0.05 g at 460 km/h (KS4-1: from kvec of the integrated curve it would read 1 g)', () => {
  const d = spiral(), { path, v } = check(d), R0 = 31 / (2 * Math.PI), off = d.pieces[0].length + d.pieces[1].length, P2 = d.pieces[2], bys = new Map(path.samples.map((x) => [x.s, x]));
  const lines = v.lines.filter((l) => l.u === 0 && l.s - off > 30 && l.s - off < P2.length - 30); assert.ok(lines.length > 500);
  let worst = 0, centripetal = 0;
  for (const l of lines) {
    const x = bys.get(l.s), om = D.channelAt(P2, 'phi', l.s - off).d1, kh = (R0 * om * om) / (1 + R0 * R0 * om * om), want = x.U[1] + (V460 * V460 * kh) / 9.80665 * 1;
    worst = Math.max(worst, Math.abs(l.fN_g - want)); centripetal = Math.max(centripetal, (V460 * V460 * kh) / 9.80665);
  }
  assert.ok(centripetal > 0.5, `control: the spiral's centripetal load peaks at ${centripetal} g, so the check can fail`); assert.ok(worst <= 0.05, `the normal load is ${worst} g off the helix prediction`);
});
test('S2 (iv): water over a heartline offset is refused BY NAME (WATER_HEARTLINE), never an anonymous throw', () => {
  const t = A.toPath(spiral());
  assert.throws(() => W.surfaceFrom({ samples: t.path.samples, closed: false, lengthM: t.path.lengthM, profileAt: (sm) => P.normalize(t.segments[sm.seg].profile) }), (e) => e.code === 'WATER_HEARTLINE' && e.name === 'CoreError');
});

// ── the export ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const Rr = 180, Q = (Math.PI * Rr) / 2;
function exportDoc(doc, opts = {}) {
  const segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), st = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  return FW.buildFromSegments(segs, { name: 'xsec', via: 'test', liftPath: lift, start: st }, { markers: startLayout(segs, lift, st), ...opts });
}
/** The seal's F1-style lap: a plain start straight, four turns carrying cup c, edge e, start s (the last returns both to the start's: the grid's straight stays plain), a closing straight. */
function edgeLap(family, c, e, s) {
  let d = extend(D.createDoc('edge lap'), { length: 300, family });
  const edge = D.legacyEdgeDeg(family, D.channelAt(d.pieces[0], 'w', 300).v, D.channelAt(d.pieces[0], 'r', 300).v);
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: { e: 'start', c: 40, kh: 40 }, targets: { kh: 1 / Rr, ...(c > 0 ? { c: i === 3 ? edge : c } : {}), e: i === 3 ? 0 : e, s } });
  d = extend(d, { length: 60, transition: { e: 'start', c: 40 }, targets: { kh: 0, ...(c > 0 ? { c: edge } : {}), e: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
for (const [name, family, c, e, s] of [['(a) bowl c 135 + e 15 at s 0.64', 'bowl', 135, 15, 0.64], ['(b) flat + e 147 at s 0.5', 'flat', 0, 147, 0.5], ['(c) flat + e 147 at s 0.95', 'flat', 0, 147, 0.95], ['(d) half-pipe c 120 + e 30 at s 0.95', 'half-pipe', 120, 30, 0.95]]) {
  test(`E5 ${name}: the closed lap goes through the app's export route (csp on) with no red, a kn5 read back and no NaN; with csp off it is refused by steep-without-raycast`, () => {
    const doc = edgeLap(family, c, e, s), out = exportDoc(doc);
    assert.ok(out.kn5 && out.kn5.length > 1000, 'a kn5 came out'); assert.ok(out.ai, 'an AI line'); for (const m of require('../src/export/markers.js').walkScene(out.scene).meshes) assert.ok(Array.from(m.positions).every(Number.isFinite), `NaN in ${m.name}`);
    assert.throws(() => exportDoc(doc, { csp: false }), (x) => x.name === 'ExportError' && x.code === 'RED' && /steep/i.test(x.message + JSON.stringify(x.red)), 'csp off');
  });
}
/** The seal's X1 lap: a plain start straight, four quarter turns; in the second the tube CLOSES (140 m), stays closed (143 m); in the third it opens to 280° and then becomes a cup (the cup cannot hold a closed tube's 180° edge); the fourth returns to the start's edge; the lap is closed. */
function tubeLap() {
  let d = extend(D.createDoc('tube lap'), { length: 300 });
  const edge = D.legacyEdgeDeg('bowl', 31, D.channelAt(d.pieces[0], 'r', 300).v), turn = (length, targets, transition) => extend(d, { length, transition, targets: { kh: 1 / Rr, ...targets } });
  d = turn(Q, {}, 40);                                       // A: plain
  d = turn(140, { t: 360 }, 140);                            // B1: the tube closes
  d = turn(Q - 140, {}, undefined);                          // B2: closed
  assert.throws(() => turn(140, { c: edge }, 140), (e) => e.code === 'BAD_CUP' && /open the tube/.test(e.message), 'a cup cannot start where a closed tube ends (named, with the way out)');
  d = turn(140, { t: 280 }, 140);                            // C1: the tube opens
  d = turn(Q - 140, { c: edge }, 140);                       // C2: the cup, back to the start's edge
  d = turn(Q, { c: edge }, 40);                              // D
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0, c: edge } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
test('X1 and T2 iv (ruling 3): a lap whose tube CLOSES along the road is refused by downforce-ray-gap over the slot zone ONLY (no exemption, no other red); the ceiling meshes of a closed tube are drivable road (1ROAD), not wall', () => {
  const doc = tubeLap(), { path, segments } = A.toPath(doc), m = buildMesh(path, segments), tall = [];
  const walk = (n) => { if (n.type === 'mesh') { let lo = Infinity, hi = -Infinity; for (let i = 1; i < n.positions.length; i += 3) { lo = Math.min(lo, n.positions[i]); hi = Math.max(hi, n.positions[i]); } if (hi - lo > 9) tall.push(n.name); } (n.children || []).forEach(walk); };
  walk(m.scene.root); assert.ok(tall.length > 20, `control: ${tall.length} tall meshes (the closed tube)`); assert.ok(tall.every((nm) => /^1ROAD_/.test(nm)), 'every mesh of the closed tube is drivable road, none is a wall');
  let err = null; try { exportDoc(doc); } catch (e) { err = e; }
  assert.ok(err && err.code === 'RED', `a closing tube does not export green under today's raygap (got ${err && err.code}: ${err && String(err.message).slice(0, 120)})`);
  const why = [...new Set((err.red || []).map((x) => x.reason))]; assert.deepStrictEqual(why, ['downforce-ray-gap'], `the reds are ${why.join(',')}`);
  // the reds lie in the slot zone: where the sweep is between t1m(w) and 360 (±2 m), on the closing piece (B1) and the opening piece (C1)
  const off = (i) => doc.pieces.slice(0, i).reduce((a, p) => a + p.length, 0), zones = [];
  doc.pieces.forEach((p, i) => { if (!p.tube) return; for (let s = 0; s <= p.length; s += 0.25) { const t = D.channelAt(p, 't', s).v; if (t > D.tubeSlotMinDeg(D.channelAt(p, 'w', s).v) && t < 360 - 1e-6) zones.push(off(i) + s); } });
  assert.ok(zones.length > 0, 'control: the lap has a slot zone');
  for (const x of err.red) assert.ok(zones.some((z) => Math.abs(z - x.s0) <= 2.5), `a red at ${x.s0} m lies outside every slot zone (±2.5 m)`);
});
