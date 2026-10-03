// core_xsec.test.js (D225, the cross-section lap): the core's edge curve (channels e, s), tube (channel t) and the schema /4, against the seal
// (exo_memory/loop/cross_section_seal_registration_2026-10-03.md) row by row. node --test, under the heavy-run lock, --test-concurrency=1.
// The document, extend, readout, close and adapter rows are here; the validator's (roll rate, tube-too-narrow, the spiral's loads) are in validate_xsec.test.js,
// the e = 0 byte identity is core_cup_fixtures.test.js row 5 (unchanged), and the formulas are core_xsec_math.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const R = require('../src/core/readout.js');
const { close } = require('../src/core/close.js');
const { sculpt } = require('../src/core/sculpt.js');
const P = require('../src/geom/profile.js');
const { buildMesh } = require('../src/geom/mesh.js');

const DEG = Math.PI / 180;
const throwsCode = (fn, code, re) => assert.throws(fn, (e) => e.code === code && (!re || re.test(e.message)), `expected ${code}`);
/** A started track: one plain 100 m piece (legacy bowl, 31 m), then whatever extends it. */
const start = (opts = {}) => extend(D.createDoc('x'), { length: 100, ...opts });
const last = (d) => d.pieces[d.pieces.length - 1];
/** A hand-built copy of piece `i` with channel `ch` set to `arr` (control points), the way a hand-edited file would be. */
const withChannel = (d, i, ch, arr, flags = {}) => ({ ...d, pieces: d.pieces.map((p, k) => (k === i ? { ...p, ...flags, channels: { ...p.channels, [ch]: arr } } : p)) });
const fill = (p, v) => new Array(p.knots.length + 4).fill(v);

// ── the document ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('SCHEMA: new documents are t180b.core/4; /1, /2 and /3 text still loads; a piece without an edge or a tube carries none of e, s, t in its text', () => {
  const d = extend(start(), { length: 80, targets: { c: 30 } }), text = D.serialize(d);
  assert.strictEqual(D.SCHEMA, 't180b.core/4'); assert.strictEqual(JSON.parse(text).schema, 't180b.core/4');
  assert.ok(!/"(e|s|t)":\[/.test(text), 'a cup piece writes no edge or tube channel');
  for (const old of ['t180b.core/3', 't180b.core/2']) assert.strictEqual(D.serialize(D.parse(text.replace('t180b.core/4', old))), text, `${old} loads and saves as the same /4 text (only the schema string differs)`);
  assert.throws(() => D.parse(text.replace('t180b.core/4', 't180b.core/5')), /a newer file needs a newer builder/);
});
test('SCHEMA: an edge piece and a tube piece write their channels, read back with their flags, and save to the same text (round trip)', () => {
  let d = extend(start(), { length: 200, targets: { e: 15, s: 0.7 } }); d = extend(d, { length: 100, targets: { t: 200 } });
  const text = D.serialize(d), back = D.parse(text);
  assert.ok(back.pieces[1].edge && !back.pieces[1].tube && !back.pieces[1].cup, 'piece 1 is an edge piece'); assert.ok(back.pieces[2].tube && !back.pieces[2].cup, 'piece 2 is a tube piece');
  assert.ok(/"e":\[/.test(text) && /"s":\[/.test(text) && /"t":\[/.test(text)); assert.strictEqual(D.serialize(back), text);
  assert.strictEqual(back.pieces[0].edge, undefined); assert.strictEqual(back.pieces[0].tube, undefined);
});
test('DOMAIN (E2, V4, T1, T3): a hand-built document with e < 0, s outside [0.5, 0.95], a total past the cap, a closed tube with an edge, or a tube held in the slot is refused by name', () => {
  const base = extend(start(), { length: 200, targets: { e: 15 } }), p = last(base), i = 1;
  throwsCode(() => D.checkDoc(withChannel(base, i, 'e', fill(p, -1))), 'BAD_EDGE', /0 or more/);
  throwsCode(() => D.checkDoc(withChannel(base, i, 's', fill(p, 0.4))), 'BAD_EDGE', /0\.5 to 0\.95/);   // KE2-3
  throwsCode(() => D.checkDoc(withChannel(base, i, 's', fill(p, 0.97))), 'BAD_EDGE', /0\.5 to 0\.95/);
  throwsCode(() => D.checkDoc(withChannel(base, i, 'e', fill(p, 140))), 'BAD_EDGE', /past 150/);   // a bowl 15.5 + e 140
  // the cap is on the TOTAL, not on e alone: a bowl cup c 140 + e 30 is refused (KE2-1), c 100 + e 30 is fine
  const cup = extend(extend(start(), { length: 60, targets: { c: 140 } }), { length: 100, targets: { e: 5 } }), cp = last(cup);
  throwsCode(() => D.checkDoc(withChannel(cup, 2, 'e', fill(cp, 30))), 'BAD_EDGE', /past 150/);   // KE2-1: a bowl c 140 + e 30 is a total of 170
  assert.doesNotThrow(() => extend(extend(start(), { length: 60, targets: { c: 100 } }), { length: 100, targets: { e: 30 } }));
  // tubes: t outside [0, 360]; a closed tube takes no edge; held in the slot band
  const tube = extend(start(), { length: 200, targets: { t: 200 }, transition: 100 }), tp = last(tube);
  throwsCode(() => D.checkDoc(withChannel(tube, 1, 't', fill(tp, 361))), 'BAD_TUBE', /0 to 360/);
  throwsCode(() => extend(D.createDoc('t'), { length: 100, first: { t: 355 } }), 'BAD_TUBE', /slot/);   // KT1-2: a tube HELD at 355° on w 31 is refused at the document (a first piece: no joint to answer to)
  throwsCode(() => D.checkDoc(withChannel(tube, 1, 't', fill(tp, 355))), 'BAD_TUBE', /slot/);
  assert.doesNotThrow(() => extend(D.createDoc('t'), { length: 100, first: { t: 340 } }), 'a held 340° is open');
  assert.doesNotThrow(() => extend(D.createDoc('t'), { length: 200, transition: 100, first: { t: 200 }, targets: { t: 360 } }), 'passing THROUGH the band to 360 is the closing transition, not a held sweep');
  const closed = withChannel(withChannel(tube, 1, 't', fill(tp, 360)), 1, 'e', fill(tp, 5), { edge: true });
  closed.pieces[1].channels.s = fill(tp, 0.64);
  throwsCode(() => D.checkDoc(closed), 'BAD_TUBE', /closes/);   // T3 ii
  // an open tube takes an edge up to t/2 + e <= 180 (KT3-1: the cup cap 150 must not apply to it)
  assert.doesNotThrow(() => extend(D.createDoc('t'), { length: 100, first: { t: 300, e: 20 } }), 'tube 300 + e 20 is a total of 170 and is accepted (KT3-1: the cup cap 150 does not apply)');
  throwsCode(() => extend(D.createDoc('t'), { length: 100, first: { t: 300, e: 40 } }), 'BAD_EDGE', /past/);
  const over = withChannel(withChannel(tube, 1, 't', fill(tp, 300)), 1, 'e', fill(tp, 40), { edge: true }); over.pieces[1].channels.s = fill(tp, 0.64);
  throwsCode(() => D.checkDoc(over), 'BAD_EDGE', /past 180/);
});
test('A PIECE IS A CUP OR A TUBE: c and t together are refused, in extend and in a hand-built document', () => {
  throwsCode(() => extend(start(), { length: 50, targets: { c: 30, t: 100 } }), 'BAD_TARGET', /cup or a tube/);
  const tube = extend(start(), { length: 200, targets: { t: 200 }, transition: 100 });
  throwsCode(() => D.checkDoc(withChannel(tube, 1, 'c', fill(last(tube), 20), { cup: true })), 'BAD_TUBE', /cup or a tube/);
  throwsCode(() => D.roadPiece({ length: 10, channels: {}, cup: true, tube: true }), 'BAD_TUBE');
});
test('JOINT (E4 i, KE4-1): e and s join C1 like every channel: a 5° step in e at a joint is refused JOINT; e starts from 0 where the piece before has no edge', () => {
  const d = extend(start(), { length: 200, targets: { e: 15 } });
  const e1 = d.pieces[1].channels.e, step = withChannel(d, 1, 'e', e1.map((v, k) => (k === 0 ? v + 5 : v)));
  throwsCode(() => D.checkDoc(step), 'JOINT', /e starts at/);
  assert.ok(Math.abs(D.channelAt(d.pieces[1], 'e', 0).v) < 1e-9, 'a first edge piece starts at e = 0 (the joint with a plain piece)');
  throwsCode(() => D.checkDoc({ ...d, pieces: [d.pieces[0], { ...d.pieces[1], channels: { ...d.pieces[1].channels, e: e1.map((v, k) => (k < 2 ? 4 : v)) } }] }), 'JOINT');
});
test('A TUBE JOINT: a tube after another kind starts at the edge that piece renders (t = 2·edge); a cup after a tube starts at t/2; tube to tube is C1 in t', () => {
  const a = start(), edge0 = D.pieceEnd(a.pieces[0]).c.v, t = extend(a, { length: 100, targets: { t: 200 } });
  assert.ok(Math.abs(t.pieces[1].channels.t[0] - 2 * edge0) < 1e-5, `the tube starts at ${t.pieces[1].channels.t[0]}, twice the legacy edge ${edge0}`);
  const c = extend(t, { length: 100, targets: { c: 40 } });
  assert.ok(Math.abs(c.pieces[2].channels.c[0] - D.pieceEnd(t.pieces[1]).t.v / 2) < 1e-5, 'the cup starts at the tube edge t/2'); assert.ok(c.pieces[2].cup && !c.pieces[2].tube);
  const tt = extend(t, { length: 100 });   // continues the tube
  assert.ok(tt.pieces[2].tube && !tt.pieces[2].cup); assert.doesNotThrow(() => D.checkDoc(tt));
  const bad = withChannel(tt, 2, 't', tt.pieces[2].channels.t.map((v, k) => (k === 0 ? v + 3 : v)));
  throwsCode(() => D.checkDoc(bad), 'JOINT', /t starts at/);
});

// ── extend ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('EXTEND: e, s and t targets are range-checked by name; an e target on a plain track makes an edge piece; the edge continues while active and turns off with e = 0', () => {
  throwsCode(() => extend(start(), { length: 50, targets: { e: -1 } }), 'BAD_EDGE'); throwsCode(() => extend(start(), { length: 50, targets: { s: 0.3 } }), 'BAD_EDGE');
  throwsCode(() => extend(start(), { length: 50, targets: { t: 400 } }), 'BAD_TUBE'); throwsCode(() => extend(start(), { length: 50, targets: { e: 200 } }), 'BAD_EDGE', /past/);
  throwsCode(() => extend(extend(start(), { length: 60, targets: { c: 140 } }), { length: 50, targets: { e: 30 } }), 'BAD_EDGE', /past/);   // a bowl 140 + e 30: the cap leaves 10
  let d = extend(start(), { length: 200, targets: { e: 15 } }); assert.ok(last(d).edge && D.pieceEnd(last(d)).e.v === 15);
  d = extend(d, { length: 100 }); assert.ok(last(d).edge, 'a piece after an active edge continues it'); assert.ok(Math.abs(D.pieceEnd(last(d)).e.v - 15) < 1e-6);
  d = extend(d, { length: 200, targets: { e: 0 } }); assert.ok(Math.abs(D.pieceEnd(last(d)).e.v) < 1e-6, 'e reaches 0');
  d = extend(d, { length: 100 }); assert.strictEqual(last(d).edge, undefined, 'once the edge is off (e 0, slope 0) the next piece is a plain piece');
  assert.doesNotThrow(() => D.checkDoc(d));
});
test('EXTEND: the fit never leaves the range (D190 V5 ringing): a 30 m piece, a 10 m ramp to e = 150 − c on a cup, stays inside [0, cap] and the document is accepted (E2 iii, KE2-2)', () => {
  const c = 90, d = extend(extend(start(), { length: 120, targets: { c } }), { length: 30, transition: 10, targets: { e: 150 - c } });
  const p = last(d); assert.ok(p.channels.e.every((v) => v >= 0 && v <= 150 - c + 1e-9), `e control points ${Math.min(...p.channels.e)} to ${Math.max(...p.channels.e)}`);
  assert.ok(p.channels.c.every((v, i) => v + p.channels.e[i] <= 150 + 1e-9), 'the total stays within 150 at every control point'); assert.doesNotThrow(() => D.checkDoc(d));
  const s = extend(start(), { length: 60, transition: 10, targets: { e: 20, s: 0.95 } }); assert.ok(last(s).channels.s.every((v) => v >= 0.5 && v <= 0.95 + 1e-9));
});
test('EXTEND: the transition map takes e, s and t like the others, and the at-start `first` carries them on an empty track', () => {
  const d = extend(start(), { length: 200, transition: { e: 'start', s: 50 }, targets: { e: 12, s: 0.8 } });
  assert.ok(Math.abs(D.channelAt(last(d), 'e', 40).v - 12) < 1e-6, 'e reaches its target inside the short ramp and holds it');
  const f = extend(D.createDoc('f'), { length: 100, first: { e: 10, s: 0.7 } }); assert.ok(f.pieces[0].edge && Math.abs(f.pieces[0].channels.e[0] - 10) < 1e-9);
  const g = extend(D.createDoc('g'), { length: 100, first: { t: 120 } }); assert.ok(g.pieces[0].tube && Math.abs(g.pieces[0].channels.t[0] - 120) < 1e-9);
});

// ── the readout (E7) ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('READOUT (E7): edgeFrom/To, sliceFrom/To, tubeFrom/To come from the document; a plain piece reads 0, 0.64 and 0; candidateReadout equals the placed piece bit for bit (KE7-1)', () => {
  const d = extend(start(), { length: 200, targets: { e: 15, s: 0.8 } }), o = R.pieceReadout(d, 1), p = last(d);
  assert.strictEqual(o.edgeFromDeg, D.channelAt(p, 'e', 0).v); assert.ok(Math.abs(o.edgeToDeg - 15) < 1e-9); assert.ok(Math.abs(o.sliceTo - 0.8) < 1e-9);
  const plain = R.pieceReadout(d, 0); assert.deepStrictEqual([plain.edgeFromDeg, plain.edgeToDeg, plain.sliceFrom, plain.sliceTo, plain.tubeFromDeg, plain.tubeToDeg], [0, 0, 0.64, 0.64, 0, 0]);
  const tube = extend(d, { length: 100, targets: { t: 200 } }), to = R.pieceReadout(tube, 2); assert.ok(to.tubeToDeg > 0 && Math.abs(to.cupToDeg - to.tubeToDeg / 2) < 1e-9, 'a tube reads its rendered edge t/2 as cup');
  const opts = { length: 120, targets: { e: 40, s: 0.6 } }, cand = R.candidateReadout(d, opts), placed = R.pieceReadout(extend(d, opts), 2);
  assert.deepStrictEqual(cand, placed);
  const fl = extend(d, { length: 100 }); assert.ok(R.pieceReadout(fl, 2).edgeFromDeg > 0);
});

// ── the adapter: segments and meshes ─────────────────────────────────────────────────────────────────────────────────────
/** The segments of a doc's piece `pi`. */
const segsOf = (d, pi) => A.toSegments(d).filter((g) => g.id === d.pieces[pi].id);
test('E1 (i): the rendered edge of an edge piece is ψ_mid(edge) + e on BOTH sides, within 0.05°; bank and a closed lap do not change that (E6)', () => {
  const d = extend(extend(start(), { length: 60, targets: { c: 60 } }), { length: 100, transition: 10, targets: { e: 15, phi: 30 * DEG } });
  const seg = segsOf(d, 2).at(-1), prof = P.normalize(seg.profile), l = P.psiAt(prof, prof.u.at(-1)) / DEG, r = P.psiAt(prof, prof.u[0]) / DEG, p = d.pieces[2];
  const want = D.channelAt(p, 'c', p.length).v + D.channelAt(p, 'e', p.length).v;   // the document's own c (the fit of the 60 m ramp ends a hair under 60) plus its e
  assert.ok(Math.abs(want - 75) < 0.5, `control: c + e is ${want}`);
  assert.ok(Math.abs(l - want) < 0.05 && Math.abs(r - want) < 0.05, `the edges are ${l}° and ${r}° (the document says ${want}°)`);
});
test('E6: edge THEN roll: at φ = +30° the left edge surface is 105° from gravity and the right 45°; a −30° bank mirrors it; e changes no readout and no path sample', () => {
  const mk = (phi, e) => extend(extend(start(), { length: 60, targets: { c: 60, w: 30 } }), { length: 100, transition: 10, targets: { phi: phi * DEG, ...(e ? { e } : {}) } });
  const probe = (phi) => {
    const d = mk(phi, 15), t = A.toPath(d), g = t.segments.at(-1), s = t.path.samples.filter((x) => x.seg === t.segments.length - 1).at(-1), prof = P.normalize(g.profile);
    const angle = (u) => { const [nl, nu] = P.normalAt(prof, u), n = [0, 1, 2].map((k) => s.L[k] * nl + s.U[k] * nu); return Math.acos(Math.max(-1, Math.min(1, n[1]))) / DEG; };
    return [angle(prof.u.at(-1)), angle(prof.u[0]), s.roll / DEG];   // the sample's own roll: extend's short ramp fits to within a degree of its target and holds that, so the test reads what the road actually carries
  };
  const dd = mk(30, 15), pp = dd.pieces[2], tot = D.channelAt(pp, 'c', pp.length).v + D.channelAt(pp, 'e', pp.length).v;   // the document's own edge angle at the end of the piece (≈ 75)
  const [l, r, ph] = probe(30); assert.ok(Math.abs(ph - 30) < 2, `control: the road is banked ${ph}°`); assert.ok(Math.abs(l - (tot + ph)) < 0.1 && Math.abs(r - (tot - ph)) < 0.1, `φ +${ph}: left ${l}°, right ${r}° (the edge is ${tot}°)`);
  const [l2, r2, ph2] = probe(-30); assert.ok(Math.abs(l2 - (tot + ph2)) < 0.1 && Math.abs(r2 - (tot - ph2)) < 0.1, `φ ${ph2}: left ${l2}°, right ${r2}°`);
  const a = mk(30, 0), b = mk(30, 15), ra = R.pieceReadout(a, 2), rb = R.pieceReadout(b, 2);
  for (const k of ['turnDeg', 'climbDeg', 'bankFromDeg', 'bankToDeg', 'pitchFromDeg', 'pitchToDeg', 'lengthM']) assert.strictEqual(ra[k], rb[k], k);
  const pa = A.toPath(a).path.samples, pb = A.toPath(b).path.samples; assert.strictEqual(pa.length, pb.length);
  for (let i = 0; i < pa.length; i++) assert.deepStrictEqual([pa[i].pos, pa[i].T, pa[i].U], [pb[i].pos, pb[i].T, pb[i].U], 'the edge never moves the centreline or its frame (KE6-2)');
});
test('E4 (ii): e, s and t are CARRIED across a flight like c, and an edge continues after the jump', () => {
  const d = extend(start(), { length: 200, targets: { e: 15, s: 0.8 } }), fl = D.appendPiece(d, D.flightPiece({ gap: 30, drop: 0, land: 0 })), after = extend(fl, { length: 100 }), p = last(after);
  assert.ok(p.edge, 'the piece after the jump continues the edge'); assert.ok(Math.abs(D.channelAt(p, 'e', 0).v - 15) < 1e-6 && Math.abs(D.channelAt(p, 's', 0).v - 0.8) < 1e-6, 'e and s are carried through the flight');
  assert.doesNotThrow(() => D.checkDoc(after));
  const t = extend(extend(start(), { length: 100, targets: { t: 200 }, transition: 100 }), { length: 60 }), tf = extend(D.appendPiece(t, D.flightPiece({ gap: 30, drop: 0, land: 0 })), { length: 50 });
  assert.ok(last(tf).tube && Math.abs(D.channelAt(last(tf), 't', 0).v - D.pieceEnd(t.pieces[2]).t.v) < 1e-6, 't is carried through the flight');
});
test('E4 (vi, vii): inside an edge piece every segment is a chord that shares ONE row grid and meets the next on the same profile, so the mesh emits no seam zip; the joint from a plain piece steps ≤ 1 mm', () => {
  const d = extend(extend(start({ length: 40 }), { length: 40 }), { length: 60, transition: 40, targets: { e: 30, s: 0.9 } });
  const segs = segsOf(d, 2); assert.ok(segs.length >= 25 && segs.every((g) => g.chord && g.fractions === segs[0].fractions), 'chords sharing one fraction array');
  for (let j = 1; j < segs.length; j++) assert.deepStrictEqual(segs[j].blend.from, segs[j - 1].profile, `segment ${j} starts on the profile segment ${j - 1} ends on`);
  const { path, segments } = A.toPath(d), m = buildMesh(path, segments);
  const seamsIn = m.cells.filter((c) => c.seam && segments[c.piece].id === d.pieces[2].id && c.piece > segments.findIndex((g) => g.id === d.pieces[2].id));
  assert.strictEqual(seamsIn.length, 0, `${seamsIn.length} seam zips inside the edge piece`);   // KE4-4
  const steps = P.jointSteps(segments, false).filter((x) => segments[x.j].id === d.pieces[2].id); assert.ok(steps.every((x) => x.m <= 1e-3), `a joint steps ${Math.max(...steps.map((x) => x.m))} m`);
});
test('E4 (v): along a moving slice (s 0.5 → 0.95 over 40 m, e 15) every row at a segment boundary is within 0.05° of the analytic profile and every row inside a segment within 0.5° (KE4-3)', () => {
  const d = extend(start({ length: 40 }), { length: 80, transition: 40, targets: { e: 15, s: 0.95 } }), p = last(d), segs = segsOf(d, 1);
  let worstB = 0, worstI = 0, s0 = 0;
  for (const g of segs) {
    for (const w of [0, 0.25, 0.5, 0.75, 1]) {
      const prof = P.normalize(P.blend(P.normalize(g.blend.from), P.normalize(g.profile), P.smoothstep(w))), at = s0 + w * g.length;
      const x = Object.fromEntries(D.CHANNELS.map((ch) => [ch, D.channelAt(p, ch, at).v])), exact = A.edgeProfile(A.profileAt(p.family, x.w, x.r), x.e, x.s, 64);
      let worst = 0; for (let i = -100; i <= 100; i++) { const u = (x.w / 2) * (i / 100); worst = Math.max(worst, Math.abs(P.psiAt(prof, u) - P.psiAt(exact, u)) / DEG); }
      if (w === 0 || w === 1) worstB = Math.max(worstB, worst); else worstI = Math.max(worstI, worst);
    }
    s0 += g.length;
  }
  assert.ok(worstB <= 0.05, `a boundary row is ${worstB}° off the analytic profile`); assert.ok(worstI <= 0.5, `an interior row is ${worstI}° off`);
});
test('E5: a lap with an edge exports end to end: mesh, markers and kn5 write and read back, with no NaN in any buffer (the F1-style lap, edge 15 on the turns)', () => {
  const d = D.createDoc('lap'); let doc = extend(d, { length: 150 });
  for (let i = 0; i < 2; i++) { doc = extend(doc, { length: 200, transition: 100, targets: { kh: 1 / 60, e: 15 } }); doc = extend(doc, { length: 150, transition: 100, targets: { kh: 0, e: 0 } }); }
  const t = A.toPath(doc), m = buildMesh(t.path, t.segments);
  for (const c of m.scene.root.children) for (const k of c.children) { for (const buf of [k.positions, k.normals]) for (let i = 0; i < buf.length; i++) assert.ok(Number.isFinite(buf[i]), 'NaN in a mesh buffer'); }
  assert.ok(m.scene.root.children.length > 10);
});

// ── the tube ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('T1 (ii, iii): a closed tube meshes with its two edge rows within 1 mm; the tube profile is the circle; a transition cup → tube has no seam zip and every row X_tip >= 0 (T2)', () => {
  const d = extend(extend(start({ length: 60 }), { length: 120, transition: 60, targets: { t: 360 } }), { length: 100 }), segs = segsOf(d, 2);
  const closedSeg = segs.at(-1), prof = P.normalize(closedSeg.profile), [xl, yl] = P.offsetAt(prof, prof.u.at(-1)), [xr, yr] = P.offsetAt(prof, prof.u[0]);
  assert.ok(Math.hypot(xl - xr, yl - yr) < 1e-3, 'the tube closes within 1 mm');
  for (const g of segsOf(d, 1)) { const pr = P.normalize(P.atSegment(g, g.length)), [x] = P.offsetAt(pr, pr.u.at(-1)); assert.ok(x >= -1e-9, `a transition row has X_tip ${x}`); }
  const { path, segments } = A.toPath(d), m = buildMesh(path, segments), first = segments.findIndex((g) => g.id === d.pieces[1].id);
  assert.strictEqual(m.cells.filter((c) => c.seam && c.piece > first && segments[c.piece].id === d.pieces[1].id).length, 0, 'no seam zip inside the tube transition');
  const joint = P.jointSteps(segments, false).filter((x) => segments[x.j].id === d.pieces[1].id && x.j === first); assert.ok(joint.every((x) => x.m <= 1e-3), 'the legacy → tube joint steps ≤ 1 mm (the first row IS the legacy row)');
});

// ── close ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CLOSE (E4 iii, T2): a lap whose seam would join a tube to a different cross-section is refused TUBE_SEAM; an edge still active at only one end is refused EDGE_SEAM', () => {
  const tubeEnd = extend(start(), { length: 200, targets: { t: 200 } });   // starts legacy, ends tube
  throwsCode(() => close(tubeEnd), 'TUBE_SEAM');
  const edgeEnd = extend(start(), { length: 200, targets: { e: 15 } });   // starts plain, ends with an active edge
  throwsCode(() => close(edgeEnd), 'EDGE_SEAM');
});
test('CLOSE: a lap whose edge ends at 0.004° (under the 0.01° seam tolerance) at a plain start closes, and the close leaves every edge array exactly as built (no row reaches e where only one end has it)', () => {
  const Rr = 180, Q = (Math.PI * Rr) / 2;
  let d = extend(D.createDoc('lap'), { length: 300 });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: { e: 'start', kh: 40 }, targets: { kh: 1 / Rr, e: i === 3 ? 0.004 : 12 } });
  d = extend(d, { length: 60, transition: { e: 'start' }, targets: { kh: 0 } });
  assert.ok(last(d).edge && Math.abs(D.pieceEnd(last(d)).e.v - 0.004) < 1e-9, 'control: the lap ends with an edge of 0.004°');
  const before = d.pieces.filter((p) => p.edge).map((p) => p.channels.e.slice()), r = close(d, { edited: [0] });
  assert.equal(r.converged, true, r.report);
  assert.deepStrictEqual(r.doc.pieces.filter((p) => p.edge).map((p) => p.channels.e), before, 'e is untouched by the close'); assert.doesNotThrow(() => D.checkDoc(r.doc));
});

// ── the brush ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('BRUSH (E2 iii): a brush on e, s or t reaching a piece without them is refused by name; one that takes e outside its range is refused BAD_EDGE', () => {
  const d = extend(start(), { length: 300, targets: { e: 15 } });
  throwsCode(() => sculpt(d, { channel: 'e', s0: 50, r: 30, delta: 5 }), 'NOT_EDGE');   // piece 0 is plain
  throwsCode(() => sculpt(d, { channel: 't', s0: 200, r: 30, delta: 5 }), 'NOT_TUBE');
  throwsCode(() => sculpt(d, { channel: 'e', s0: 200, r: 30, delta: 200 }), 'BAD_EDGE');
  throwsCode(() => sculpt(d, { channel: 's', s0: 200, r: 30, delta: 0.9 }), 'BAD_EDGE');
  assert.doesNotThrow(() => sculpt(d, { channel: 'e', s0: 250, r: 30, delta: 3 }));
});
