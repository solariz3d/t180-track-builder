// core_right_width.test.js: node --test test/core_right_width.test.js. D677 (b), THE RIGHT SIDE'S OWN WIDTH (the user, 2026-11-26 23:00: "yes, old tracks stay the
// same, it allows for new tracks to have the individual sides of width"). The plan: lighthouse exo_memory/loop/plan_t180_cross_section_2026-11-26.md (b), route B2.
// The read it answers: a road that widens 3 to 3.5 m on ONE side within about 5 m, its driven line unmoved (another author's track, kept local; made synthetic here
// from its shape alone: a width near 19.1 m stepping to 22.6 m on one side). The rule his answer sets: a track made before opens and saves byte for byte, and the new
// field is written only by a piece that uses it.
// Stored as wd, the right side's width less the width (document.js): the left half is w/2 and the right (w + wd)/2, so every edit of the width moves both sides
// as before, and a piece with no wd reads 0.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const FW = require('../src/export/fromwords.js');
const { startLayout } = require('../app/core/coreshell.js');

const W = 19.1, WR = 22.6, STEP = WR - W;   // 3.5 m on one side, the read's step
const refusal = (fn) => { try { fn(); } catch (e) { return e; } return null; };
/** A straight at width W, then a 300 m left-hand turn at R 400 m banked 8 degrees: the road the step is laid on. */
function road() {
  let d = extend(D.createDoc('right width'), { length: 120, first: { w: W }, targets: { kh: 0 } });
  d = extend(d, { length: 300, transition: 60, targets: { kh: 1 / 400, phi: 8 * Math.PI / 180 } });
  return d;
}
/** The same road with the right side stepped STEP m over `over` m at `at` m into the turn, and back to the width over `over` m at `back` m. */
const stepped = (over = 5) => extend(extend(road(), { length: 100, transition: { wd: over }, targets: { wd: STEP } }), { length: 100, transition: { wd: over }, targets: { wd: 0 } });
/** The same two pieces with no step: wd left out, so held at 0. */
const unstepped = (over = 5) => extend(extend(road(), { length: 100, transition: { wd: over }, targets: { kh: 1 / 400 } }), { length: 100, transition: { wd: over }, targets: { kh: 1 / 400 } });
/** The document with every piece's wd set to 0 and its split flag taken off: the same knots, so the same line exactly if the line does not read the width. */
const flattened = (d) => ({ ...d, pieces: d.pieces.map((P) => (P.type !== 'road' ? P : (({ split, ...rest }) => ({ ...rest, channels: { ...P.channels, wd: P.channels.wd.map(() => 0) } }))(P))) });
/** The cross-section's two half-widths at the end of segment g: left (u > 0) and right (u < 0). */
const sides = (g) => ({ left: g.profile.u[g.profile.u.length - 1], right: -g.profile.u[0] });

test('a piece whose right side differs is written as core/7 with its wd, reads back the same text, and only that piece carries wd', () => {
  const d = stepped(), text = D.serialize(d), o = JSON.parse(text);
  assert.equal(o.schema, 't180b.core/7', 'the schema');
  assert.ok(Array.isArray(o.pieces[2].channels.wd), 'the stepped piece writes wd');
  for (const k of [0, 1]) assert.equal(o.pieces[k].channels.wd, undefined, `piece ${k} has no split: no wd`);
  assert.equal(D.serialize(D.parse(text)), text, 'parse then serialize is the same text');
  assert.equal(D.parse(text).pieces[2].split, true, 'it reads back as a split piece');
});

test('a track with no split writes today\'s schema and no wd, byte for byte as it was laid', () => {
  const d = road(), text = D.serialize(d), o = JSON.parse(text);
  assert.equal(o.schema, 't180b.core/4');
  assert.ok(!/"wd"/.test(text), 'no wd anywhere');
  assert.equal(D.serialize(D.parse(text)), text);
});

test('a piece flagged split whose wd is 0 everywhere writes no wd and today\'s schema: the field is written only when it is used', () => {
  const d = flattened(stepped()), withFlag = { ...d, pieces: d.pieces.map((P) => (P.type === 'road' ? { ...P, split: true } : P)) };
  const text = D.serialize(withFlag);
  assert.equal(JSON.parse(text).schema, 't180b.core/4');
  assert.ok(!/"wd"/.test(text));
});

test('at width 19.1 and right width 22.6 the left half is 9.55 m and the right 11.3 m, and the line is the same sample for sample as with the sides equal', () => {
  const d = stepped(), segs = A.toSegments(d), P = d.pieces[2];
  const held = segs.filter((g) => g.id === P.id).slice(-10);   // the piece's last 20 m: the step held at 3.5 m
  for (const g of held) { const x = sides(g); assert.ok(Math.abs(x.left - W / 2) < 1e-9, `left ${x.left}`); assert.ok(Math.abs(x.right - WR / 2) < 1e-6, `right ${x.right}`); }
  const a = A.toPath(d).path.samples, b = A.toPath(flattened(d)).path.samples;
  assert.equal(a.length, b.length, 'as many samples');
  for (let i = 0; i < a.length; i++) for (const k of ['s', 'roll']) assert.ok(Object.is(a[i][k], b[i][k]), `${k} at ${i}`);
  for (let i = 0; i < a.length; i++) for (const k of ['pos', 'T', 'L', 'U']) for (let j = 0; j < 3; j++) assert.ok(Object.is(a[i][k][j], b[i][k][j]), `${k}[${j}] at sample ${i}`);
});

test('a 3.5 m one-sided step over 5 m adds no red and no amber: the checker reads the same faults with and without it', () => {
  const d = stepped(), f = flattened(d);
  const faults = (x) => { const r = V.validate(A.toPath(x).path, A.toSegments(x), { csp: true, fullSpeed: true }); return { red: [...new Set(r.red.map((y) => y.reason))].sort(), amber: [...new Set(r.amber.map((y) => y.reason))].sort() }; };
  assert.deepEqual(faults(d), faults(f));
});

test('Extend: a typed right width splits the sides; the width typed alone moves both sides and keeps the step; on a track with no split, the width alone splits nothing', () => {
  const a = extend(road(), { length: 100, targets: { wd: STEP } }), P = a.pieces[2], end = D.pieceEnd(P);
  assert.equal(P.split, true, 'split');
  assert.ok(Math.abs(end.wd.v - STEP) < 1e-6 && Math.abs(end.w.v - W) < 1e-6, `w ${end.w.v}, wd ${end.wd.v}`);
  const b = extend(a, { length: 100, targets: { w: 25 } }), e2 = D.pieceEnd(b.pieces[3]);
  assert.ok(Math.abs(e2.w.v - 25) < 1e-6 && Math.abs(e2.wd.v - STEP) < 1e-6, `the right side follows the width, its step kept: w ${e2.w.v}, wd ${e2.wd.v}`);
  const c = extend(road(), { length: 100, targets: { w: 25 } });
  assert.ok(!c.pieces[2].split, 'no split');
  assert.ok(!/"wd"/.test(D.serialize(c)), 'no wd written');
});

test('Extend: the right side\'s change at a mark is held to the mark and made after it, and early reaches it within the start, where the width\'s own early ramp reaches its own', () => {
  const m = extend(road(), { length: 200, targets: { wd: STEP }, transition: { wd: 'start' }, changes: { wd: [{ from: 120, target: 0 }] } }), P = m.pieces[2];
  const at = (s) => D.channelValue(P, 'wd', s);
  assert.ok(Math.abs(at(100) - STEP) < 1e-3, `held to the mark: ${at(100)}`);
  assert.ok(Math.abs(at(200)) < 1e-6, `made after it: ${at(200)}`);
  // the right width is a WIDTH (the route's blend, not the cross-section's C2 one), so its peer is the width's own early ramp, the same 3.5 m laid the same way
  const wm = extend(road(), { length: 200, targets: { w: WR }, transition: { w: 'start' }, changes: { w: [{ from: 120, target: W }] } }), R = wm.pieces[2];
  const rampEnd = (ch, P2, v0, T) => { for (let s = 0; s <= 200; s += 0.5) if (Math.abs(D.channelValue(P2, ch, s) - v0 - T) < 0.005) return s; return null; };
  const a = rampEnd('wd', P, 0, STEP), b = rampEnd('w', R, W, STEP);
  assert.ok(a !== null && a <= 20, `early: reached within the start's 20 m (${a} m)`);
  assert.ok(Math.abs(a - b) <= 0.5, `early: the right width is reached where the width is (${a} m, ${b} m)`);
});

test('the document refuses a right side of 0 m or less by name (BAD_WIDTH), and a split tube (BAD_TUBE)', () => {
  const d = road(), P = d.pieces[1];
  const bad = { ...d, pieces: [d.pieces[0], { ...P, split: true, channels: { ...P.channels, wd: P.channels.w.map((w) => -w) } }] };
  const e = refusal(() => D.checkDoc(bad));
  assert.equal(e && e.code, 'BAD_WIDTH', e && e.message);
  assert.match(e.message, /right/);
  const t = extend(D.createDoc('tube'), { length: 120, first: { w: W, t: 200 }, targets: { kh: 0 } }), T = t.pieces[0];
  const e2 = refusal(() => D.checkDoc({ ...t, pieces: [{ ...T, split: true, channels: { ...T.channels, wd: T.channels.w.map(() => 1) } }] }));
  assert.equal(e2 && e2.code, 'BAD_TUBE', e2 && e2.message);
});

test('the export: the road mesh\'s right side reaches 22.6/19.1 of the left\'s where the step is held, and both sides are equal where it is not', () => {
  const d = stepped(), segs = A.toSegments(d), lift = (q) => A.offsetPath(d, segs, q), start = { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch };
  // an open track: the TEST export (fromwords.js), as export_apron.test.js lays one; the road's own cells are 1ROAD_<piece>_body_<n>[_<cell>]
  const out = FW.buildFromSegments(segs, { name: 'wr', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: true }), test: true, mergeMeshes: false });
  const S = A.toPath(d).path.samples, road = out.acScene.root.children.filter((n) => n.type === 'mesh' && /^1ROAD_p\d+_body(_\d+)*$/.test(n.name));
  assert.ok(road.length, 'a road mesh');
  // the furthest road vertex each side, over the stations [a, b]: each vertex is read across the road at the path sample nearest it (the mesh is welded, so its rows are sparse)
  const extentOver = (a, b) => {
    const near = S.filter((x) => x.s >= a - 5 && x.s <= b + 5); let lo = 0, hi = 0;
    for (const m of road) for (let i = 0; i < m.positions.length; i += 3) {
      const P3 = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
      const p = near.reduce((q, x) => (Math.hypot(x.pos[0] - P3[0], x.pos[1] - P3[1], x.pos[2] - P3[2]) < Math.hypot(q.pos[0] - P3[0], q.pos[1] - P3[1], q.pos[2] - P3[2]) ? x : q));
      if (p.s < a || p.s > b) continue;
      const v = [P3[0] - p.pos[0], P3[1] - p.pos[1], P3[2] - p.pos[2]];
      if (Math.abs(v[0] * p.T[0] + v[1] * p.T[1] + v[2] * p.T[2]) > 2) continue;
      const lat = v[0] * p.L[0] + v[1] * p.L[1] + v[2] * p.L[2]; if (Math.abs(lat) > 20) continue; lo = Math.min(lo, lat); hi = Math.max(hi, lat);
    }
    return { left: hi, right: -lo };
  };
  const s0 = 120 + 300, held = extentOver(s0 + 20, s0 + 90), plain = extentOver(s0 - 80, s0 - 20);
  assert.ok(Math.abs(held.right / held.left - WR / W) < 0.01, `held: right ${held.right.toFixed(3)} left ${held.left.toFixed(3)}`);
  assert.ok(Math.abs(plain.right / plain.left - 1) < 0.01, `plain: right ${plain.right.toFixed(3)} left ${plain.left.toFixed(3)}`);
});

// ── the consumers (the plan's list, :227 onward): each reads a split road as it is, or refuses it by name ──
const { close } = require('../src/core/close.js');
const SH = require('../src/core/sharp.js');
const PC = require('../src/core/piece.js');
const WT = require('../src/core/water.js');

/** A lap: a straight, four quarter turns at R 180 m with the right side stepped STEP m on the second, a closing straight; closed. */
function lap({ endSplit = false } = {}) {
  const Q = (Math.PI * 180) / 2;
  let d = extend(D.createDoc('lap'), { length: 300, first: { w: W }, targets: { kh: 0 } });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / 180, ...(i === 1 ? { wd: STEP } : i === 2 ? { wd: 0 } : {}) } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0, ...(endSplit ? { wd: STEP } : {}) } });
  return d;
}

test('close: a lap with a right width on one turn closes, and the right width is kept as it was laid', () => {
  const d = lap(), r = close(d, { edited: [0] });
  assert.equal(r.converged, true, r.report);
  assert.equal(JSON.parse(D.serialize(r.doc)).schema, 't180b.core/7');
  assert.deepEqual(r.doc.pieces[2].channels.wd, d.pieces[2].channels.wd, 'the right width as laid');
});

test('close: a lap that ends with a right width against a start whose sides are one width is refused by name (SPLIT_SEAM)', () => {
  const e = refusal(() => close(lap({ endSplit: true }), { edited: [0] }));
  assert.equal(e && e.code, 'SPLIT_SEAM', e && e.message);
});

test('Sharp: after a right width the corner keeps it, and its tightest right-hand radius is held to the wider inner side (11.2 m, against 9.5 m with the sides equal); a left-hand one is unchanged', () => {
  const straight = extend(D.createDoc('sharp'), { length: 200, first: { w: W }, targets: { kh: 0 } });
  const split = extend(straight, { length: 100, targets: { wd: STEP } }), plain = extend(straight, { length: 100, targets: { kh: 0 } });
  const tight = (d, deg) => SH.tightestSharp(d, {}, { angle: deg * Math.PI / 180, ramp: 4 });
  assert.equal(tight(plain, -90), 9.5, 'control: the sides equal');
  assert.equal(tight(split, -90), 11.2, 'a right-hand corner: the inner side is the right, 11.3 m out');
  assert.equal(tight(split, 90), 9.5, 'a left-hand corner: the inner side is the left, as before');
  const c = SH.extendSharp(split, {}, { angle: -Math.PI / 2, R: 30, ramp: 4 });
  for (const P of c.pieces.slice(2)) { assert.equal(P.split, true, `${P.id} split`); assert.ok(Math.abs(D.pieceEnd(P).wd.v - STEP) < 1e-6, `${P.id} wd ${D.pieceEnd(P).wd.v}`); }
});

test('a saved piece: a run with a right width is refused by name (SPLIT_RUN), never saved with both sides at the width; a run with none saves as before', () => {
  const d = stepped();
  const e = refusal(() => PC.saveRun(d, 2, 2, { name: 'step' }));
  assert.equal(e && e.code, 'SPLIT_RUN', e && e.message);
  const ok = PC.saveRun(road(), 1, 1, { name: 'plain' });
  assert.ok(!/"wd"/.test(PC.serialize(ok)), 'no wd in a plain saved piece');
});

test('the water: a stream poured at u -10.5 on the stepped side runs to the right side\'s own rim, -11.3 m, where it spills', () => {
  const d = stepped(), segs = A.toSegments(d), path = A.toPath(d).path;
  const F = WT.surfaceFrom({ samples: path.samples, profileAt: (m) => segs[m.seg].profile });
  const out = WT.pour(F, { speed: 30, streams: [{ u: -10.5 }], s0: 440, laps: 1 }).streams[0];
  assert.equal(out.outcome, 'spill');
  assert.ok(Math.abs(out.at.u + WR / 2) < 1e-6, `spilled at u ${out.at.u}`);
});

test('Extend: a right width brought back to the width over a numeric transition ends exactly there, and the piece after it has its sides as one width again (no wd, no core/7)', () => {
  const back = extend(extend(road(), { length: 200, transition: 40, targets: { wd: STEP } }), { length: 282.7, transition: 40, targets: { kh: 1 / 180, wd: 0 } });
  const end = D.pieceEnd(back.pieces[3]);
  assert.ok(Object.is(end.wd.v, 0) && Object.is(end.wd.m, 0), `ends at ${end.wd.v}, slope ${end.wd.m}`);
  const next = extend(back, { length: 100, targets: { kh: 0 } });
  assert.ok(!next.pieces[4].split, 'the next piece is not split');
  assert.equal(JSON.parse(D.serialize(next)).pieces[4].channels.wd, undefined, 'and writes no wd');
});
