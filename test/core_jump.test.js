// core_jump.test.js: node --test test/core_jump.test.js   (under the heavy-run lock, --max-old-space-size=4096; about a minute)
// D258, A JUMP THE KEEPER'S WAY (pane E; the plan: exo_memory/loop/plan_t180_free_jump_2026-10-06.md). It REPLACES D243's jump (a solved gap and a
// generated landing ramp): a FREE flight (src/core/document.js flightPiece) carries the landing's start pose relative to the take-off end, and the
// landing is ordinary road that starts there; the user places it by hand and tunes it by driving. CHANGED D258: every row below is restated for the
// free jump; the D243 rows about the ramp's landing zone (row 3, row 5b) are REMOVED with it (nothing is computed about where the car lands). Rows:
//   1  the ops: Jump (jumpHere), the exact pose, the landing's own start (not C1), moving it while it is the head, refusals by name, LAND ON ROAD FIRST, round trip
//   2  validation: the free jump's gap is intended; no arcs, zone or reach; a landing behind the take-off WARNS; a planted hole and a flight with no landing are red
//   4  close(): a lap with a free jump closes, whole and local; the flight and the landing's start are the user's; the model predicts across the jump; FLIGHT_AT_END
//   5  export: a closed free-jump lap exports (kn5, AI line, no jump warning); an open one is still refused
//   6  saved pieces and old files: a run with a free flight re-adds and mirrors; an OLD document jump opens at the end of its old ramp; an old saved one is refused
//   7  readout: the flight's pose for the UI's number boxes
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
