// core_jump.test.js: node --test test/core_jump.test.js   (under the heavy-run lock, --max-old-space-size=4096; about a minute)
// D258, A JUMP THE USER'S WAY (pane E; the plan: exo_memory/loop/plan_t180_free_jump_2026-10-06.md). It REPLACES D243's jump (a solved gap and a
// generated landing ramp): a FREE flight (src/core/document.js flightPiece) carries the landing's start pose relative to the take-off end, and the
// landing is ordinary road that starts there; the user places it by hand and tunes it by driving. CHANGED D258: every row below is restated for the
// free jump; the D243 rows about the ramp's landing zone (row 3, row 5b) are REMOVED with it (nothing is computed about where the car lands). Rows:
//   1  the ops: Jump (jumpHere), the exact pose, the landing's own start (not C1), moving it while it is the head, refusals by name, LAND ON ROAD FIRST, round trip
//   2  validation: the free jump's gap is intended; no arcs, zone or reach; a landing behind the take-off WARNS; a planted hole and a flight with no landing are red
//   4  close(): a lap with a free jump closes, whole and local; the flight and the landing's start are the user's; the model predicts across the jump; FLIGHT_AT_END
//   5  export: a closed free-jump lap exports (kn5, AI line, no jump warning); an open one is still refused
//   6  saved pieces and old files: a run with a free flight re-adds and mirrors; an OLD document jump opens at the end of its old ramp; an old saved one is refused
//   7  readout: the flight's pose for the UI's number boxes
//   8  a jump from a lip the brush raised or shifted: the take-off is the road as built, the mesh has no step, a clean lip is byte-identical, the lap closes
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const J = require('../src/core/jump.js');
const PC = require('../src/core/piece.js');
const RO = require('../src/core/readout.js');
const { close, closeWindow, positionJacobian } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const { buildPath } = require('../src/geom/index.js');
const FW = require('../src/export/fromwords.js');
const { createCoreShell, startLayout } = require('../app/core/coreshell.js');

const R = 180, Q = (Math.PI * R) / 2, DEG = Math.PI / 180;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
/** A take-off: 300 m of bowl, the last 80 m climbing (the user gave it climb), the open end where the jump starts. */
const takeoff = () => extend(extend(D.createDoc('j'), { length: 220, family: 'bowl' }), { length: 80, targets: { kv: 0.002 } });
/** A lap with a free jump: a 300 m take-off straight, the jump to a 300 m landing, four quarter turns at R 180, a 60 m straightening. Open. */
function jumpLap(pose = {}) {
  let d = J.jumpHere(extend(D.createDoc('jump lap'), { length: 300, family: 'bowl' }), null, { landing: { forward: 40, ...pose }, landingM: 300 });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  return extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
}
// a LEVEL landing off to the side and turned (row 5): a sloped one makes the close bend the landing road back to level, which at the ghost lap's 970 km/h is a
// crest the car leaves (a real lap-proof red, not this row's subject)
const SIDE = { forward: 50, left: 3, up: -2, heading: 2 * DEG };
const SLOPE = { forward: 50, left: 3, up: -2, heading: 2 * DEG, pitch: -2 * DEG, bank: 0.05 };   // a landing off to the side, turned, down a slope, banked
const pathOf = (d, closed, segs = A.toSegments({ ...d, closed })) => buildPath(segs, { step: 1, closed, start: { pos: d.start.pos, theta: d.start.heading, p: d.start.pitch } });
const validateDoc = (d, closed = d.closed, opts = {}) => { const segs = A.toSegments({ ...d, closed }); return V.validate(pathOf(d, closed, segs), segs, opts); };
const reasons = (r) => r.red.map((x) => x.reason);
const gapIndex = (doc) => A.toSegments(doc).findIndex((g) => g.part === 'gap');
/** The landing's start in the take-off's heading frame, read off the adapter's own built path: [forward, left, up], the heading turn and the pitch. */
function landingRead(doc) {
  const { path: P } = A.toPath(doc), k = gapIndex(doc), a = P.starts[k], b = P.starts[k + 1], d = [b.x[0] - a.x[0], b.x[1] - a.x[1], b.x[2] - a.x[2]];
  return { forward: d[0] * Math.sin(a.theta) + d[2] * Math.cos(a.theta), left: d[0] * Math.cos(a.theta) - d[2] * Math.sin(a.theta), up: d[1], heading: b.theta - a.theta, pitch: b.p, roll: P.samples[P.segFirst[k + 1]].roll };
}

// ── row 1: the ops ──
test('row 1: Jump (the button) places the current piece as Extend would, then a landing 40 m ahead at the same height, lined up, level: a 60 m straight', () => {
  const t = takeoff(), d = J.jumpHere(t, { length: 40 });
  assert.deepEqual(d.pieces.map((P) => P.type), ['road', 'road', 'road', 'flight', 'road']);
  assert.deepEqual(d.pieces[2], extend(t, { length: 40 }).pieces[2], 'the current piece is exactly Extend\'s');
  const F = d.pieces[3], L = d.pieces[4];
  assert.deepEqual([F.forward, F.left, F.up, F.heading, F.pitch, F.bank], [40, 0, 0, 0, 0, 0]);
  assert.equal(L.length, 60); assert.ok(['kh', 'kv'].every((ch) => L.channels[ch].every((v) => v === 0)), 'a straight, level');
  const r = landingRead(d);
  near(r.forward, 40, 1e-9, 'forward'); near(r.left, 0, 1e-9, 'left'); near(r.up, 0, 1e-9, 'the same height, whatever the take-off\'s climb'); near(r.heading, 0, 1e-12); near(r.pitch, 0, 1e-12);
  assert.equal(t.pieces.length, 2, 'the input is untouched');
});
test('row 1: the landing starts EXACTLY at its pose: forward, left and up in the take-off\'s heading frame, its heading turn, its pitch and its bank', () => {
  const pose = { forward: 52.5, left: -7.25, up: -4.5, heading: 0.31, pitch: -0.08, bank: 0.12 }, r = landingRead(J.jumpHere(takeoff(), null, { landing: pose }));
  for (const k of ['forward', 'left', 'up']) near(r[k], pose[k], 1e-9, k);
  near(r.heading, pose.heading, 1e-12, 'heading'); near(r.pitch, pose.pitch, 1e-12, 'pitch'); near(r.roll, pose.bank, 1e-12, 'bank');
});
test('row 1: the landing is ordinary road NOT C1 with the take-off: its own width and cross-section; only a level start at the flight\'s bank is asked (LANDING)', () => {
  const t = J.jump(takeoff(), { forward: 40, bank: 0.05 }), F = t.pieces[t.pieces.length - 1], c = (v) => () => v;
  assert.doesNotThrow(() => D.appendPiece(t, D.roadPiece({ length: 60, family: 'flat', channels: { kh: c(0), kv: c(0), phi: c(F.bank), w: c(45), r: c(0.2) } })), 'a flat 45 m landing after a 31 m bowl');
  assert.throws(() => D.appendPiece(t, D.roadPiece({ length: 60, family: 'bowl', channels: { kh: c(0), kv: c(0), phi: c(0.3), w: c(31), r: c(2.993) } })), (e) => e.code === 'LANDING' && /bank/.test(e.message));
  assert.throws(() => D.appendPiece(t, D.roadPiece({ length: 60, family: 'bowl', channels: { kh: c(0.01), kv: c(0), phi: c(0.05), w: c(31), r: c(2.993) } })), (e) => e.code === 'LANDING' && /level/.test(e.message));
  const e = D.endState(t); assert.deepEqual([e.kh.v, e.kv.v, e.h.v, e.l.v, e.phi.v], [0, 0, 0, 0, 0.05], 'Extend after a flight starts level at its bank');
});
test('row 1: the landing MOVES while it is the head (a partial pose keeps the rest, the bank follows); LANDING_NOT_HEAD once road is extended from it; deleting back frees it', () => {
  const moved = J.setLanding(J.jumpHere(takeoff(), null), { forward: 70, up: -6, bank: 0.2 }), r = landingRead(moved);
  near(r.forward, 70, 1e-9); near(r.up, -6, 1e-9);
  assert.equal(moved.pieces[moved.pieces.length - 1].channels.phi[0], 0.2, 'the landing\'s bank follows its flight');
  assert.deepEqual(J.landingOf(moved).pose, { forward: 70, left: 0, up: -6, heading: 0, pitch: 0, bank: 0.2 });
  const on = extend(moved, { length: 50 });
  assert.equal(J.landingOf(on), null);
  assert.throws(() => J.setLanding(on, { forward: 30 }), (e) => e.code === 'LANDING_NOT_HEAD');
  assert.doesNotThrow(() => J.setLanding(PC.deleteRun(on, on.pieces.length - 1), { forward: 30 }), 'the landing is the head again');
});
test('row 1: deleting the LANDING itself leaves the jump waiting for one: the flight is the head, movable, and Jump\'s landing can be laid again', () => {
  const d = J.jumpHere(takeoff(), null, { landing: { forward: 45, left: 4 } }), gone = PC.deleteRun(d, d.pieces.length - 1);
  assert.equal(gone.pieces[gone.pieces.length - 1].type, 'flight');
  assert.deepEqual(J.landingOf(gone).pose, { forward: 45, left: 4, up: 0, heading: 0, pitch: 0, bank: 0 }, 'the flight keeps its pose');
  const again = extend(J.setLanding(gone, { forward: 55 }), { length: 60 }), r = landingRead(again);
  near(r.forward, 55, 1e-9); near(r.left, 4, 1e-9);
});
test('row 1: refused by name: no road to take off from, a closed track, a landing too close, pitched to vertical, a turn past 180°, not a number', () => {
  const t = takeoff();
  assert.throws(() => J.jump(D.createDoc('e'), {}), (e) => e.code === 'NO_TAKEOFF');
  assert.throws(() => J.jump({ ...t, closed: true }, {}), (e) => e.code === 'CLOSED');
  assert.throws(() => J.jump(t, { forward: 0.5 }), (e) => e.code === 'FLIGHT_TOO_SHORT');
  assert.throws(() => J.jump(t, { pitch: Math.PI / 2 }), (e) => e.code === 'BAD_FLIGHT');
  assert.throws(() => J.jump(t, { heading: 4 }), (e) => e.code === 'BAD_FLIGHT');
  assert.throws(() => J.jump(t, { up: 'x' }), (e) => e.code === 'BAD_FLIGHT');
  assert.equal(J.jump(t, {}).pieces[2].type, 'flight', 'control: the default pose is accepted');
});
test('row 1: LAND ON ROAD FIRST is a rule of the document: two flights in a row are refused by name; road between them is accepted', () => {
  const one = J.jump(takeoff(), {});
  assert.throws(() => J.jump(one, {}), (e) => e.code === 'JUMP_AFTER_JUMP');
  const o = JSON.parse(D.serialize(one)); o.pieces.push({ ...o.pieces[2], id: `p${o.nextId}` }); o.nextId += 1;
  assert.throws(() => D.parse(JSON.stringify(o)), (e) => e.code === 'JUMP_AFTER_JUMP' && /land on road/.test(e.message));
  const ok = J.jumpHere(extend(J.jumpHere(takeoff(), null), { length: 100 }), null);
  assert.deepEqual(D.parse(D.serialize(ok)).pieces.map((P) => P.type), ['road', 'road', 'flight', 'road', 'road', 'flight', 'road']);
});
test('row 1: a free jump ROUND-TRIPS: serialize, reopen gives the same text and track, and the reopened one extends the same', () => {
  const d = J.jumpHere(takeoff(), null, { landing: { forward: 33.25, left: 2, up: -1.5, heading: -0.2, pitch: 0.05, bank: -0.1 } }), text = D.serialize(d), back = D.parse(text);
  assert.equal(D.serialize(back), text); assert.deepEqual(back, d);
  assert.match(text, /"type":"flight","forward":33\.25,"left":2,"up":-1\.5,"heading":-0\.2,"pitch":0\.05,"bank":-0\.1/);
  assert.equal(JSON.stringify(A.toSegments(back)), JSON.stringify(A.toSegments(d)));
  assert.equal(D.serialize(extend(back, { length: 100 })), D.serialize(extend(d, { length: 100 })));
});

// ── row 2: validation ──
test('row 2: the free jump\'s gap is INTENDED: no red over the flight; no arcs, no landing zone, no reach; the lap proof says nothing about it', () => {
  const d = jumpLap(), segs = A.toSegments(d), j = segs.findIndex((g) => g.kind === 'gap');
  assert.ok(j > 0 && segs[j].word === 'core' && segs[j].to && segs[j + 1].kind === 'road', 'control: the adapter writes the flight, its pose, and road after it');
  const s0 = segs.slice(0, j).reduce((a, g) => a + g.length, 0), s1 = s0 + segs[j].length, r = validateDoc(d, false, { fullSpeed: true });
  assert.ok(!reasons(r).includes('gap-in-road'), JSON.stringify(r.red));
  assert.deepEqual(r.red.filter((x) => x.s1 >= s0 && x.s0 <= s1), [], 'nothing red over the flight');
  assert.equal(r.jumps.length, 1); assert.equal(r.jumps[0].free, true); assert.deepEqual(r.jumps[0].landings, [], 'no arcs: nothing computed about where the car lands');
  assert.ok(!r.amber.some((x) => x.reason === 'landing-misses-zone'));
  const shut = validateDoc(close(jumpLap(), { edited: [0] }).doc);
  assert.equal(shut.lap.ok, true, JSON.stringify(shut.lap)); assert.ok(!(shut.lap.warn || []).some((w) => /jump|landing/.test(w.reason)), 'no jump finding in the lap proof');
});
test('row 2: a landing placed BEHIND its take-off WARNS (jump-gap-not-forward, amber): he put it there; it is not red', () => {
  const r = validateDoc(J.jumpHere(takeoff(), null, { landing: { forward: -30, left: 40, heading: Math.PI } }), false, { fullSpeed: true });
  assert.ok(r.amber.some((x) => x.reason === 'jump-gap-not-forward'), JSON.stringify(r.amber));
  assert.ok(!reasons(r).includes('jump-gap-not-forward'));
});
test('row 2: a real HOLE in the core\'s road is still red: a stretch of the landing road made into a gap (no flight pose on it)', () => {
  const d = jumpLap(), segs = A.toSegments(d).map((g) => ({ ...g })), i = segs.findIndex((g) => g.part === 'body' && g.id === d.pieces[3].id);
  segs.splice(i, 1, { ...segs[i], kind: 'gap', part: 'gap', profile: null });
  const s0 = segs.slice(0, i).reduce((a, g) => a + g.length, 0), r = V.validate(pathOf(d, false, segs), segs, {});
  const holes = r.red.filter((x) => x.reason === 'gap-in-road');
  assert.equal(holes.length, 1, JSON.stringify(r.red)); assert.ok(Math.abs(holes[0].s0 - s0) < 2, `at ${holes[0].s0}, the hole is at ${s0}`);
});
test('row 2: a flight with NO landing yet is red: the open end is over nothing (head-in-the-air)', () => {
  const r = validateDoc(J.jump(takeoff(), {}), false);
  assert.ok(reasons(r).includes('head-in-the-air'), JSON.stringify(r.red));
});

// ── row 4: close ──
test('row 4: a lap with a free jump CLOSES (whole lap): the flight is the very same piece, the landing\'s start is held in every channel, it is stored closed', () => {
  const d = jumpLap(SLOPE), r = close(d);
  assert.equal(r.converged, true, r.report); assert.equal(r.doc.closed, true); assert.ok(r.gapM < 1e-3, `${r.gapM} m`);
  const f = d.pieces.findIndex((P) => P.type === 'flight');
  assert.equal(r.doc.pieces[f], d.pieces[f], 'the flight is returned as it was (the same object): the pose is the user\'s');
  for (const ch of D.CHANNELS) assert.deepEqual(r.doc.pieces[f + 1].channels[ch].slice(0, 2), d.pieces[f + 1].channels[ch].slice(0, 2), `${ch}: the landing's start is held`);
  D.checkDoc(r.doc);
});
test('row 4: a free-jump lap closes through B\'s LOCAL window too: only the window moves, every piece before it is the same object', () => {
  const shut = close(jumpLap(), { edited: [0] }).doc, open = D.checkDoc({ ...shut, closed: false, pieces: shut.pieces.slice(0, -1) });
  const L = shut.pieces[shut.pieces.length - 1], d = extend(open, { length: L.length + 1, transition: 40, targets: { kh: 0 } });
  const win = closeWindow(d), r = close(d, { window: win });
  assert.equal(r.converged, true, r.report); assert.ok(!win.includes(1), 'control: the jump is outside the window');
  d.pieces.forEach((P, i) => { if (!win.includes(i)) assert.equal(r.doc.pieces[i], P, `${P.id} is outside the window: the same object`); });
});
test('row 4: a jump that LANDS turned, to the side and ON A SLOPE closes in pitch and heading too: the measured tangent at the seam closes', () => {
  const r = close(jumpLap(SLOPE));
  assert.equal(r.converged, true, r.report); assert.ok(r.gapM < 1e-3, `${r.gapM} m`);
  assert.ok(r.tangentRad < 1e-6, `the tangent at the seam is ${r.tangentRad} rad (measured on the adapter's path)`);
});
test('row 4: the close\'s position model predicts the adapter ACROSS a free jump: a control point bumped before it (heading and pitch) and after it moves the end as J says', () => {
  const d = jumpLap(SLOPE), Jc = positionJacobian(d), endOf = (x) => { const S = A.toPath({ ...x, closed: false }).path.samples; return S[S.length - 1].pos; }, e0 = endOf(d), eps = 1e-6;
  const f = d.pieces.findIndex((P) => P.type === 'flight');
  for (const [p, ch, i] of [[0, 'kh', 3], [0, 'kv', 3], [f + 1, 'kh', 3], [f + 1, 'kv', 3]]) {
    const c = d.pieces[p].channels[ch].slice(); c[i] += eps;
    const e1 = endOf({ ...d, pieces: d.pieces.map((X, k) => (k === p ? { ...X, channels: { ...X.channels, [ch]: c } } : X)) });
    const act = [0, 1, 2].map((k) => (e1[k] - e0[k]) / eps), pred = Jc[ch].get(`${p}:${i}`) || [0, 0, 0], scale = Math.max(1, Math.hypot(...act)), err = Math.hypot(...act.map((v, k) => v - pred[k])) / scale;
    assert.ok(err < 1e-3, `${ch} of p${p}[${i}] (${p < f ? 'before' : 'after'} the jump): the adapter moves the end ${act.map((v) => v.toFixed(2))}, the model says ${pred.map((v) => v.toFixed(2))} (relative ${err.toExponential(2)})`);
  }
});
test('row 4: a lap that ENDS in a jump is refused by name, FLIGHT_AT_END (its seam would join the air to the start)', () => {
  assert.throws(() => close(J.jump(jumpLap(), {})), (e) => e.code === 'FLIGHT_AT_END');
});

// ── row 5: export ──
const fromDisk = async (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
test('row 5: a CLOSED free-jump lap exports through the app\'s route (kn5, AI line, no red, no jump warning); an OPEN one is still refused, by name', async () => {
  const { makeExporter } = require('../app/export/export.js'), s = await createCoreShell({ brushFn: null, exporter: await makeExporter(fromDisk) });
  s.adopt(jumpLap(SIDE));
  assert.throws(() => s.buildExport(), (e) => e.code === 'OPEN_LOOP');
  const shut = close(jumpLap(SIDE), { edited: [0] }); assert.equal(shut.converged, true, shut.report);
  s.adopt(shut.doc); const out = s.buildExport();
  assert.ok(out.folders.length && out.folders[0].files.some((f) => /\.kn5$/.test(f.path)), 'a kn5 is written');
  assert.ok(out.folders[0].files.some((f) => /fast_lane\.ai$/.test(f.path)), 'and an AI line');
  const segs = A.toSegments(shut.doc), lift = (q) => A.offsetPath(shut.doc, segs, q), start = { pos: shut.doc.start.pos.slice(), theta: shut.doc.start.heading, p: shut.doc.start.pitch };
  const fw = FW.buildFromSegments(segs, { name: 'jump', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start) });
  assert.ok(fw.kn5.length > 1000 && fw.ai, 'buildFromSegments: a kn5 and an AI line');
  assert.ok(!fw.warnings.some((w) => /^jump: /.test(w)), `nothing is said about where the car lands: ${fw.warnings.join(' | ')}`);
});

// ── row 6: saved pieces and old files ──
test('row 6: a saved run with a free flight re-adds as the same pieces, and its mirror lands on the other side, turned and banked the other way', () => {
  let d = J.jumpHere(takeoff(), null, { landing: { forward: 45, left: 6, heading: 0.2, bank: 0.1 } }); d = extend(d, { length: 40 });
  const sp = PC.parse(PC.serialize(PC.saveRun(d, 2, d.pieces.length - 1, { name: 'jumprun' })));
  const head = takeoff().pieces.slice(0, 2).reduce((x, P) => D.appendPiece(x, { ...P }), D.createDoc('h'));
  const strip = (P) => ({ ...P, id: null });
  assert.deepEqual(PC.insert(head, sp).pieces.slice(2).map(strip), d.pieces.slice(2).map(strip));
  const m = PC.insert(head, sp, { mirror: true }).pieces.find((P) => P.type === 'flight');
  assert.deepEqual([m.left, m.heading, m.bank], [-6, -0.2, -0.1]);
});
test('row 6: a saved piece with an OLD jump (gap, drop, land) is refused by name, OLD_FLIGHT', () => {
  const sp = JSON.parse(PC.serialize(PC.saveRun(takeoff(), 0, 1, { name: 'two' })));
  sp.pieces.splice(1, 0, { type: 'flight', gap: 20, drop: 1, land: 0 });
  assert.throws(() => PC.checkPiece(sp), (e) => e.code === 'OLD_FLIGHT');
});
test('row 6: an OLD document jump opens as the free flight that lands where the road after it was, the end of its generated ramp, and saves as one', () => {
  const F7 = fs.readFileSync(path.join(__dirname, 'fixtures', 'F7-hill-then-jump.core2.json'), 'utf8');
  const old = JSON.parse(F7).pieces.find((P) => P.type === 'flight'), d = D.parse(F7), F = d.pieces.find((P) => P.type === 'flight');
  assert.deepEqual([F.left, F.heading, F.pitch], [0, 0, old.land]);
  assert.ok(F.forward > old.gap + 10, `the landing is past the old lip by the ramp: ${F.forward} m vs a ${old.gap} m gap`);
  assert.deepEqual(D.parse(D.serialize(d)), d);
});

// ── row 7: readout ──
test('row 7: the readout of a flight gives its pose for the number boxes, its turn, climb and the landing\'s bank', () => {
  const d = J.jumpHere(takeoff(), null, { landing: SLOPE }), f = d.pieces.findIndex((P) => P.type === 'flight'), o = RO.pieceReadout(d, f);
  assert.equal(o.type, 'flight');
  near(o.landing.forwardM, 50, 1e-9); near(o.landing.leftM, 3, 1e-9); near(o.landing.upM, -2, 1e-9);
  near(o.landing.headingDeg, 2, 1e-6); near(o.landing.pitchDeg, -2, 1e-6); near(o.landing.bankDeg, 0.05 / DEG, 1e-6);
  near(o.turnDeg, 2, 1e-6); near(o.bankToDeg, 0.05 / DEG, 1e-6);
});
// ── row 8: a jump takes off from a lip the brush raised or shifted (the user: "you should be able to add the climb to create the jump, then place the jump from it") ──
// The take-off is the road's end AS BUILT: the route's end moved by h along world up and l along the heading's left, leaving along the lifted road's own tangent (its pitch
// tilted by the h slope, its heading by the l slope); the landing is that pose plus the flight's own. Before, the document refused a jump after an offset (FLIGHT_OFFSET).
const SC = require('../src/core/sculpt.js');
const { buildMesh } = require('../src/geom/mesh.js');
const crypto = require('crypto');
/** 200 m of bowl whose end the brush moved: 'hill' writes h, 'swerve' writes l, centred at s0 with radius r, by delta m. */
const lipped = (mode, { s0 = 200, r = 40, delta = 2 } = {}, first = { length: 200, family: 'bowl' }) => SC.brush(extend(D.createDoc('lip'), first), { mode, s0, r, delta }).doc;
/** The same lip made LEVEL at the end: its last two control points equal, so on the clamped spline the end's slope is exactly 0 and the lift there is a pure translation. */
const flatLip = (d, ch = 'h') => { const P = d.pieces[d.pieces.length - 1], c = P.channels[ch].slice(); c[c.length - 2] = c[c.length - 1]; return D.checkDoc({ ...d, pieces: [...d.pieces.slice(0, -1), { ...P, channels: { ...P.channels, [ch]: c } }] }); };
/** The take-off and landing as built, on the adapter's own (lifted) path: the road's last row, the flight's first sample, the landing's first sample. */
function lipRead(doc) {
  const segs = A.toSegments(doc), { path: P } = A.toPath(doc), k = segs.findIndex((g) => g.part === 'gap');
  return { segs, P, k, road: P.segEnd[k - 1], gap0: P.samples[P.segFirst[k]], land0: P.samples[P.segFirst[k + 1]] };
}
const vnear = (a, b, eps, msg) => { for (let i = 0; i < 3; i++) near(a[i], b[i], eps, `${msg} [${i}]`); };
const headingOf = (T) => Math.atan2(T[0], T[2]), pitchOf = (T) => Math.asin(Math.max(-1, Math.min(1, T[1])));
/** A pose { forward, left, up } from point p in the heading frame th (forward and left horizontal, up world up), as the flight's landing is placed. */
const poseFrom = (p, th, o) => [p[0] + o.forward * Math.sin(th) + o.left * Math.cos(th), p[1] + o.up, p[2] + o.forward * Math.cos(th) - o.left * Math.sin(th)];

test('row 8: a jump takes off from a lip RAISED with the brush (h): the flight starts at the lifted lip, along the road\'s own tangent, and the landing sits at that pose plus its own', () => {
  const t = lipped('hill'), P0 = t.pieces[0];
  near(D.channelAt(P0, 'h', P0.length).v, 2, 1e-9, 'control: the lip is lifted 2 m');
  const d = J.jumpHere(t, null), r = lipRead(d), base = pathOf(d, false), F = d.pieces[1];
  vnear(r.gap0.pos, r.road.pos, 1e-9, 'the flight starts at the road\'s last row');
  vnear(r.road.pos, [0, 1, 2].map((i) => base.segEnd[r.k - 1].pos[i] + (i === 1 ? 2 : 0)), 1e-9, 'which is the unlifted end 2 m up');
  vnear(r.gap0.T, r.road.T, 1e-9, 'it leaves along the lifted road\'s tangent: no kink at the lip');
  const th = headingOf(r.gap0.T);
  vnear(r.land0.pos, poseFrom(r.gap0.pos, th, F), 1e-9, 'the landing starts at the lip\'s pose plus the flight\'s');
  near(headingOf(r.land0.T), th + F.heading, 1e-9, 'its heading'); near(pitchOf(r.land0.T), F.pitch, 1e-9, 'its pitch');
  assert.ok(['h', 'l'].every((ch) => d.pieces[2].channels[ch].every((v) => v === 0)), 'the landing\'s own h and l are 0: the air resets them');
});
test('row 8: the MESH has no step at a raised lip: the road\'s last row is the unlifted one moved 2 m up, and the landing\'s first row stands on its pose', () => {
  const t = flatLip(lipped('hill')), P0 = t.pieces[0]; assert.equal(D.channelAt(P0, 'h', P0.length).d1, 0, 'control: a level lip');
  const d = J.jumpHere(t, null), r = lipRead(d), base = pathOf(d, false);
  const M = buildMesh(r.P, r.segs), M0 = buildMesh(base, r.segs), last = M._state.pieces[r.k - 1].last, last0 = M0._state.pieces[r.k - 1].last;
  assert.ok(last && last0 && last.length === last0.length && last.length >= 12, 'control: both meshes keep the lip\'s row');
  for (let o = 0; o < last.length; o += 6) vnear([last[o], last[o + 1], last[o + 2]], [last0[o], last0[o + 1] + 2, last0[o + 2]], 1e-9, `the lip row's vertex ${o / 6}`);
  const off = (row, sm) => { const n = row.length / 6, c = [0, 0, 0]; for (let o = 0; o < row.length; o += 6) for (let i = 0; i < 3; i++) c[i] += row[o + i] / n; const q = c.map((v, i) => v - sm.pos[i]); return Math.abs(q[0] * sm.L[0] + q[1] * sm.L[1] + q[2] * sm.L[2]) + Math.abs(q[0] * sm.T[0] + q[1] * sm.T[1] + q[2] * sm.T[2]); };
  near(off(last, r.road), 0, 1e-6, 'the road\'s last row is centred on the lifted lip');
  near(off(M._state.pieces[r.k + 1].first, r.land0), 0, 1e-6, 'the landing\'s first row is centred on its start');
});
test('row 8: a lip SHIFTED sideways (l) and still moving: the flight starts at the shifted lip, turned by atan(dl/ds), and the landing turns with it', () => {
  const t = lipped('swerve', { s0: 215, r: 40, delta: 3 }), P0 = t.pieces[0], l = D.channelAt(P0, 'l', P0.length);
  assert.ok(Math.abs(l.v) > 0.5 && Math.abs(l.d1) > 0.01, `control: a shifted lip still moving, l ${l.v}, dl/ds ${l.d1}`);
  const d = J.jumpHere(t, null, { landing: { forward: 45, left: 2, up: -1, heading: 0.1 } }), r = lipRead(d), F = d.pieces[1], base = pathOf(d, false);
  vnear(r.gap0.pos, r.road.pos, 1e-9, 'the flight starts at the shifted lip'); vnear(r.gap0.T, r.road.T, 1e-9, 'along the shifted road\'s tangent');
  const th = headingOf(r.gap0.T);
  near(th - headingOf(base.segEnd[r.k - 1].T), Math.atan(l.d1), 1e-9, 'the heading tilted by atan(dl/ds) (a straight: no curvature term)');
  vnear(r.land0.pos, poseFrom(r.gap0.pos, th, F), 1e-9, 'the landing at the tilted pose plus the flight\'s'); near(headingOf(r.land0.T), th + F.heading, 1e-9, 'its heading');
});
test('row 8: a RISING lip (h still climbing at the end) keeps rising into the air: the flight\'s pitch is the lifted road\'s, atan(dh/ds) on a level piece', () => {
  const t = lipped('hill', { s0: 215, r: 40, delta: 2 }), P0 = t.pieces[0], h = D.channelAt(P0, 'h', P0.length);
  assert.ok(h.d1 > 0.01, `control: the lip still rises, dh/ds ${h.d1}`);
  const r = lipRead(J.jumpHere(t, null));
  near(pitchOf(r.gap0.T), Math.atan(h.d1), 1e-9, 'the take-off pitch: the piece\'s 0 tilted by the lip\'s slope');
  vnear(r.gap0.T, r.road.T, 1e-9, 'the same tangent as the lifted road\'s last row');
});
test('row 8: on a CLIMBING piece a raised lip tilts the climb: the take-off pitch is the lifted road\'s at the lip, above the piece\'s own', () => {
  const t = SC.brush(takeoff(), { mode: 'hill', s0: 315, r: 40, delta: 2 }).doc, Pn = t.pieces[t.pieces.length - 1], h = D.channelAt(Pn, 'h', Pn.length);
  assert.ok(h.d1 > 0.01, 'control: a rising lip on a climbing piece');
  const d = J.jumpHere(t, null), r = lipRead(d), own = pitchOf(pathOf(d, false).segEnd[r.k - 1].T);
  vnear(r.gap0.T, r.road.T, 1e-9, 'it leaves along the lifted road\'s tangent');
  assert.ok(pitchOf(r.gap0.T) > own + 0.9 * Math.atan(h.d1), `the pitch ${pitchOf(r.gap0.T)} rad is the piece's ${own} tilted up by the lip's slope (about ${Math.atan(h.d1)})`);
});
test('row 8: a jump from a lip with NO offset is BYTE-IDENTICAL to before (segments, path, saved text), on a climbing take-off, by the button and posed', () => {
  const sha = (o) => crypto.createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex'), t = takeoff();
  const want = { button: ['36797e3e521119b7c673eeeee252a0d748501e58b986f7e29d7f76459131161c', '33d341fafa50f09afdef15bb0dbbed598bf75b69ed1cbafc1c9cb1fa1533a563', '6f400c6a1ed525d423b4d8c3f955dd15cea0415eb606588ff9dfe8bb5e3839f9'],
    posed: ['fd31d333e874cdd4db042608cd7471f15b89190c55f1827c68e49d24bca1baca', '438fe31edc32c9b8e962b187eb6fc060d0d52c32e4da74652def4bca81b4099c', 'a305a770fecb0d45b583b6e972d30254e49ed7c8a52c317a3cc39b44093fd232'] };   // read off 98e3d81, before a jump could take off from a moved lip
  for (const [name, d] of [['button', J.jumpHere(t, null)], ['posed', J.jumpHere(t, null, { landing: { forward: 52.5, left: -7.25, up: -4.5, heading: 0.31, pitch: -0.08, bank: 0.12 } })]]) {
    const segs = A.toSegments(d), P = A.toPath(d).path;
    assert.deepEqual([sha(segs), sha(P.samples.map((x) => [x.s, x.pos, x.T, x.L, x.U])), sha(D.serialize(d))], want[name], `${name}: segments, path samples, saved text`);
  }
});
test('row 8: a lap with a jump from a SHIFTED lip closes, and the close\'s model predicts the adapter across it (a control point before the lip and after the landing)', () => {
  let d = J.jumpHere(lipped('swerve', { s0: 315, r: 40, delta: 3 }, { length: 300, family: 'bowl' }), null, { landing: { forward: 40 }, landingM: 300 });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const Jc = positionJacobian(d), endOf = (x) => { const S = A.toPath({ ...x, closed: false }).path.samples; return S[S.length - 1].pos; }, e0 = endOf(d), eps = 1e-6;
  const f = d.pieces.findIndex((P) => P.type === 'flight');
  for (const [p, ch, i] of [[0, 'kh', 3], [0, 'kv', 3], [f + 1, 'kh', 3]]) {
    const c = d.pieces[p].channels[ch].slice(); c[i] += eps;
    const e1 = endOf({ ...d, pieces: d.pieces.map((X, k) => (k === p ? { ...X, channels: { ...X.channels, [ch]: c } } : X)) });
    const act = [0, 1, 2].map((k) => (e1[k] - e0[k]) / eps), pred = Jc[ch].get(`${p}:${i}`) || [0, 0, 0], scale = Math.max(1, Math.hypot(...act)), err = Math.hypot(...act.map((v, k) => v - pred[k])) / scale;
    assert.ok(err < 1e-3, `${ch} of p${p}[${i}] (${p < f ? 'before' : 'after'} the jump): the adapter moves the end ${act.map((v) => v.toFixed(2))}, the model says ${pred.map((v) => v.toFixed(2))} (relative ${err.toExponential(2)})`);
  }
  const r = close(d);
  assert.equal(r.converged, true, r.report); assert.ok(r.gapM < 1e-3, `${r.gapM} m`); assert.ok(r.tangentRad < 1e-6, `${r.tangentRad} rad`);
});
test('row 8: the document no longer refuses a jump after an offset; a value that is not a number at the lip is still refused', () => {
  const t = lipped('hill');
  assert.doesNotThrow(() => J.jump(t, { forward: 40 }), 'a jump after a raised lip is a document');
  const bad = { ...t, pieces: [{ ...t.pieces[0], channels: { ...t.pieces[0].channels, h: t.pieces[0].channels.h.map((v, i, a) => (i === a.length - 1 ? NaN : v)) } }] };
  assert.throws(() => D.checkDoc(bad), (e) => e.name === 'CoreError', 'a NaN offset is refused by the document\'s own checks');
});
test('row 8: the SEGMENT CACHE sees the lip: re-brushing the lip under a placed jump rebuilds the flight (the flight piece itself is unchanged), the same as an uncached build', () => {
  const d1 = J.jumpHere(lipped('hill', { s0: 215, r: 40, delta: 2 }), null), cache = new WeakMap(), first = A.toSegments(d1, { cache });
  const d2 = SC.brush(d1, { mode: 'hill', s0: 190, r: 30, delta: 1.5 }).doc;
  assert.equal(d2.pieces[1], d1.pieces[1], 'control: the flight piece is the very same object after the brush');
  const cached = A.toSegments(d2, { cache }), fresh = A.toSegments(d2), k = fresh.findIndex((g) => g.part === 'gap');
  assert.notDeepEqual(fresh[k].to, first[k].to, 'control: the new lip moves the take-off');
  assert.deepEqual(cached[k].to, fresh[k].to, 'the cached build takes off from the new lip'); assert.equal(cached[k].length, fresh[k].length);
});
