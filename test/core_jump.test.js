// core_jump.test.js: node --test test/core_jump.test.js   (under the heavy-run lock, --max-old-space-size=4096; about a minute)
// D243, the core half of jumps you can build (pane E). A flight piece (src/core/document.js flightPiece) is a jump: the adapter builds its gap and
// its landing ramp (src/core/adapter.js toSegments). Rows:
//   1  jump(): one flight at the head, the next Extend starts level, and it ROUND-TRIPS (append, serialize, reopen); refusals by name
//   2  validation: a core flight's gap is INTENDED (no gap-in-road red in its span); a real hole outside a flight is red, and so is a gap with no landing
//   3  validation: a landing road too short for the car at the lap's speed WARNS (landing-misses-zone, amber since D250), with the both-landings-caught control
//   4  close(): a lap with a jump closes, whole lap and through a local window; the flight and the level start after it are kept; a lap that
//      ENDS in a jump is refused by name
//   5  export: a closed jump lap exports (kn5, AI line, no red) through the app's route; an open one is still refused
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { jump } = require('../src/core/jump.js');
const { close, closeWindow, positionJacobian } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const V = require('../src/validate/index.js');
const { buildPath } = require('../src/geom/index.js');
const FW = require('../src/export/fromwords.js');
const { createCoreShell, startLayout } = require('../app/core/coreshell.js');

const R = 180, Q = (Math.PI * R) / 2, DEG = Math.PI / 180;
const OK_JUMP = { gap: 10, drop: 0.3, land: 0 };   // caught at both falls at the lap's speed (row 3's control)
const LONG_JUMP = { gap: 40, drop: 2, land: -2 * DEG };   // the 3.2 g fall carries past the road it can find (row 3)
/** A lap with a jump: a 300 m take-off straight, the jump, 300 m on, four quarter turns at R 180, a 60 m straightening. Open. */
function jumpLap(j = OK_JUMP) {
  let d = extend(D.createDoc('jump lap'), { length: 300, family: 'bowl' });
  d = jump(d, j); d = extend(d, { length: 300 });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  return extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
}
const pathOf = (d, closed, segs = A.toSegments({ ...d, closed })) => buildPath(segs, { step: 1, closed, start: { pos: d.start.pos, theta: d.start.heading, p: d.start.pitch } });
const validateDoc = (d, closed = d.closed) => { const segs = A.toSegments({ ...d, closed }); return V.validate(pathOf(d, closed, segs), segs, {}); };
const reasons = (r) => r.red.map((x) => x.reason);

// ── row 1 ──
test('row 1: jump() appends ONE flight at the head with the gap, drop and landing pitch given; the next Extend starts level, the rest carried', () => {
  const d0 = extend(D.createDoc('j'), { length: 300, targets: { phi: 0.1 } }), d = jump(d0, { gap: 25, drop: 1.5, land: -3 * DEG });
  assert.equal(d.pieces.length, 2); const F = d.pieces[1];
  assert.deepEqual({ type: F.type, gap: F.gap, drop: F.drop, land: F.land }, { type: 'flight', gap: 25, drop: 1.5, land: D.flightPiece({ gap: 25, drop: 1.5, land: -3 * DEG }).land });
  const e = D.endState(d);
  assert.deepEqual([e.kh.v, e.kh.m, e.kv.v, e.kv.m], [0, 0, 0, 0], 'the landing road starts level');
  assert.ok(Math.abs(e.phi.v - D.pieceEnd(d0.pieces[0]).phi.v) < 1e-9, 'bank is carried across the flight');
  assert.equal(d0.pieces.length, 1, 'the input is untouched');
});
test('row 1: a jump ROUND-TRIPS: append, serialize, reopen gives the same text and the same track, and the reopened one extends the same', () => {
  const d = jump(extend(D.createDoc('rt'), { length: 300 }), { gap: 33.3333, drop: 1.23456, land: -0.0412345 }), text = D.serialize(d), back = D.parse(text);
  assert.equal(D.serialize(back), text, 'serialize → parse → serialize is byte-identical');
  assert.deepEqual(back.pieces, d.pieces, 'the reopened pieces are the ones written');
  assert.equal(JSON.stringify(A.toSegments(back)), JSON.stringify(A.toSegments(d)), 'and they build the same segments');
  assert.equal(D.serialize(extend(back, { length: 100 })), D.serialize(extend(d, { length: 100 })), 'the landing road extends the same from the reopened file');
});
test('row 1: jump() refuses by name: no road to take off from, a closed track, a jump straight after a jump, a bad number, a flight no clothoid can fly', () => {
  const road = extend(D.createDoc('r'), { length: 300 });
  assert.throws(() => jump(D.createDoc('e'), { gap: 20 }), (e) => e.code === 'NO_TAKEOFF');
  assert.throws(() => jump({ ...road, closed: true }, { gap: 20 }), (e) => e.code === 'CLOSED');
  assert.throws(() => jump(jump(road, { gap: 20 }), { gap: 20 }), (e) => e.code === 'JUMP_AFTER_JUMP');
  for (const bad of [{ gap: 0 }, { gap: -5 }, { gap: NaN }, { gap: 20, drop: Infinity }, { gap: 20, land: Math.PI / 2 }, { gap: 20, land: NaN }]) assert.throws(() => jump(road, bad), (e) => e.code === 'BAD_JUMP', JSON.stringify(bad));
  assert.throws(() => jump(road, { gap: 1, drop: -100 }), (e) => e.code === 'JUMP_PAST_VERTICAL' || e.code === 'JUMP_UNSOLVABLE', 'rising 100 m in 1 m');
  assert.equal(jump(road, { gap: 20 }).pieces[1].type, 'flight', 'control: a plain jump is accepted');
});
test('row 1: LAND ON ROAD FIRST is a rule of the document: an opened or hand-edited file with two flights in a row is refused by name; road between them is accepted', () => {
  const one = jump(extend(D.createDoc('two'), { length: 300 }), { gap: 20 }), o = JSON.parse(D.serialize(one));
  o.pieces.push({ ...o.pieces[1], id: `p${o.nextId}` }); o.nextId += 1;   // a second flight straight after the first, as a hand edit would write it
  assert.throws(() => D.parse(JSON.stringify(o)), (e) => e.code === 'JUMP_AFTER_JUMP' && /land on road/.test(e.message));
  assert.throws(() => D.checkDoc({ ...one, nextId: one.nextId + 1, pieces: [...one.pieces, { ...one.pieces[1], id: `p${one.nextId}` }] }), (e) => e.code === 'JUMP_AFTER_JUMP');
  const ok = jump(extend(one, { length: 100 }), { gap: 20 });
  assert.deepEqual(D.parse(D.serialize(ok)).pieces.map((P) => P.type), ['road', 'flight', 'road', 'flight'], 'control: two jumps with road between them open as written');
});

// ── row 2 ──
test('row 2: a core flight\'s gap is INTENDED: the open jump lap has no gap-in-road red, and no red at all inside the flight\'s span', () => {
  const d = jumpLap(), segs = A.toSegments(d), j = segs.findIndex((g) => g.kind === 'gap');
  assert.ok(j > 0 && segs[j].word === 'core' && segs[j + 1].part === 'land', 'control: the adapter writes the flight and its landing ramp');
  const s0 = segs.slice(0, j).reduce((a, g) => a + g.length, 0), s1 = s0 + segs[j].length, r = validateDoc(d, false);
  assert.ok(!reasons(r).includes('gap-in-road'), JSON.stringify(r.red));
  assert.ok(r.red.every((x) => Number.isFinite(x.s0) && Number.isFinite(x.s1)), 'control: validate\'s reds are ranges (s0, s1), so the span test below reads real numbers');
  assert.deepEqual(r.red.filter((x) => x.s1 >= s0 && x.s0 <= s1), [], 'nothing red over the flight');
  assert.equal(r.jumps.length, 1, 'the jump is still checked as a jump');
});
test('row 2: a real HOLE outside a flight is still red: a stretch of the landing road made into a gap', () => {
  const d = jumpLap(), segs = A.toSegments(d).map((g) => ({ ...g })), i = segs.findIndex((g) => g.part === 'body' && g.id === d.pieces[3].id);
  segs.splice(i, 1, { ...segs[i], kind: 'gap', part: 'gap', profile: null });
  const s0 = segs.slice(0, i).reduce((a, g) => a + g.length, 0), r = V.validate(pathOf(d, false, segs), segs, {});
  const holes = r.red.filter((x) => x.reason === 'gap-in-road');
  assert.equal(holes.length, 1, JSON.stringify(r.red)); assert.ok(Math.abs(holes[0].s0 - s0) < 2, `at ${holes[0].s0}, the hole is at ${s0}`);
});
test('row 2: a flight with NO landing is red: the core\'s gap without its landing ramp after it is a hole', () => {
  const d = jumpLap(), segs = A.toSegments(d), j = segs.findIndex((g) => g.kind === 'gap'), cut = [...segs.slice(0, j + 1), ...segs.slice(j + 2)];
  const r = V.validate(pathOf(d, false, cut), cut, {}), s0 = segs.slice(0, j).reduce((a, g) => a + g.length, 0), s1 = s0 + segs[j].length;
  assert.ok(reasons(r).includes('gap-in-road'), JSON.stringify(r.red));
  assert.ok(r.red.some((x) => x.reason === 'gap-in-road' && x.s1 >= s0 && x.s0 <= s1), 'the red is over the flight: the span test of the row above can see one');
});

// ── row 3 ──
// "too short" is not a length: the landing road is long enough when BOTH measured falls (MACH6.jumpG, 3.2 g and 6.3 g) touch down on road within
// the landing search, at the take-off speed validation computes for the lap. The adapter sizes the ramp at the DESIGN speed (460 km/h), so a jump
// taken faster can fly past it: that WARNS (amber; it was red before D250).
// CHANGED D250 (the keeper: jumps are tuned by driving them in AC): a landing too short for the lap's speed is a WARNING (amber), not a red.
test('row 3: a landing road too short for the lap\'s speed WARNS (landing-misses-zone, amber since D250) and is not red; a jump both falls land on does not warn', () => {
  const long = validateDoc(close(jumpLap(LONG_JUMP), { edited: [0] }).doc), jl = long.jumps[0];
  assert.ok(jl.speed * 3.6 > 600, `control: the lap takes the jump fast, at ${(jl.speed * 3.6).toFixed(0)} km/h, past the ramp's 460`);
  assert.ok(jl.landings.some((L) => !L.caught), JSON.stringify(jl.landings));
  assert.ok(long.amber.some((x) => x.reason === 'landing-misses-zone'), JSON.stringify(long.amber)); assert.ok(!reasons(long).includes('landing-misses-zone'), 'not a red');
  const ok = validateDoc(close(jumpLap(OK_JUMP), { edited: [0] }).doc);
  assert.ok(ok.jumps[0].landings.every((L) => L.caught), JSON.stringify(ok.jumps[0].landings)); assert.deepEqual(ok.red, []);
  assert.ok(!ok.amber.some((x) => x.reason === 'landing-misses-zone'), 'and no landing warning');
});

// ── row 4 ──
test('row 4: a lap with a jump CLOSES (whole lap): the flight is the very same piece, the road after it still starts level, and it is stored closed', () => {
  const d = jumpLap(), r = close(d);
  assert.equal(r.converged, true, r.report); assert.equal(r.doc.closed, true); assert.ok(r.gapM < 1e-3, `${r.gapM} m`);
  assert.equal(r.doc.pieces[1], d.pieces[1], 'the flight is returned as it was (the same object)');
  const after = r.doc.pieces[2];
  for (const ch of ['kh', 'kv', 'h', 'l']) assert.deepEqual(after.channels[ch].slice(0, 2), d.pieces[2].channels[ch].slice(0, 2), `${ch}: the level start after the jump is held`);
  D.checkDoc(r.doc);
});
test('row 4: a jump lap closes through B\'s LOCAL window too: only the window moves, every piece before it is the same object', () => {
  // one metre more on the last straight than a closed lap needs: the default window (the last ~20%) has a short gap to close
  const shut = close(jumpLap(), { edited: [0] }).doc, open = D.checkDoc({ ...shut, closed: false, pieces: shut.pieces.slice(0, -1) });
  const L = shut.pieces[shut.pieces.length - 1], d = extend(open, { length: L.length + 1, transition: 40, targets: { kh: 0 } });
  const win = closeWindow(d), r = close(d, { window: win });
  assert.equal(r.converged, true, r.report); assert.ok(!win.includes(1), 'control: the jump is outside the window');
  d.pieces.forEach((P, i) => { if (!win.includes(i)) assert.equal(r.doc.pieces[i], P, `${P.id} is outside the window: the same object`); });
});
test('row 4: a jump that LANDS ON A SLOPE (−2°, 2 m down) closes in pitch too: the measured tangent at the seam closes, not only the position', () => {
  const r = close(jumpLap(LONG_JUMP));
  assert.equal(r.converged, true, r.report); assert.ok(r.gapM < 1e-3, `${r.gapM} m`);
  assert.ok(r.tangentRad < 1e-6, `the tangent at the seam is ${r.tangentRad} rad (measured on the adapter's path)`);
});
test('row 4: the close\'s position model predicts the adapter ACROSS a jump: one control point bumped before it (heading and pitch) and after it moves the end as J says', () => {
  const d = jumpLap(LONG_JUMP), J = positionJacobian(d), endOf = (x) => { const S = A.toPath({ ...x, closed: false }).path.samples; return S[S.length - 1].pos; }, e0 = endOf(d), eps = 1e-6;
  for (const [p, ch, i] of [[0, 'kh', 3], [0, 'kv', 3], [2, 'kh', 3], [2, 'kv', 3]]) {
    const c = d.pieces[p].channels[ch].slice(); c[i] += eps;
    const e1 = endOf({ ...d, pieces: d.pieces.map((X, k) => (k === p ? { ...X, channels: { ...X.channels, [ch]: c } } : X)) });
    const act = [0, 1, 2].map((k) => (e1[k] - e0[k]) / eps), pred = J[ch].get(`${p}:${i}`), err = Math.hypot(...act.map((v, k) => v - pred[k])) / Math.hypot(...act);
    assert.ok(err < 1e-3, `${ch} of p${p}[${i}] (${p === 0 ? 'before' : 'after'} the jump): the adapter moves the end ${act.map((v) => v.toFixed(1))}, the model says ${pred.map((v) => v.toFixed(1))} (relative ${err.toExponential(2)})`);
  }
});
test('row 4: a lap that ENDS in a jump is refused by name (its seam would join the landing ramp to the start)', () => {
  assert.throws(() => close(jump(jumpLap(), { gap: 20 })), (e) => e.code === 'FLIGHT_AT_END');
});

// ── row 5 ──
const fromDisk = async (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
test('row 5: a CLOSED jump lap exports through the app\'s route (kn5, AI line, no red); an OPEN one is still refused, by name', async () => {
  const { makeExporter } = require('../app/export/export.js'), s = await createCoreShell({ brushFn: null, exporter: await makeExporter(fromDisk) });
  s.adopt(jumpLap());
  assert.throws(() => s.buildExport(), (e) => e.code === 'OPEN_LOOP');
  const shut = close(jumpLap(), { edited: [0] }); assert.equal(shut.converged, true, shut.report);
  s.adopt(shut.doc); const out = s.buildExport();
  assert.ok(out.folders.length && out.folders[0].files.some((f) => /\.kn5$/.test(f.path)), 'a kn5 is written');
  assert.ok(out.folders[0].files.some((f) => /fast_lane\.ai$/.test(f.path)), 'and an AI line');
  // and the same through src/export directly, so this row does not rest on the shell alone
  const segs = A.toSegments(shut.doc), lift = (q) => A.offsetPath(shut.doc, segs, q), start = { pos: shut.doc.start.pos.slice(), theta: shut.doc.start.heading, p: shut.doc.start.pitch };
  const fw = FW.buildFromSegments(segs, { name: 'jump', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start) });
  assert.ok(fw.kn5.length > 1000 && fw.ai, 'buildFromSegments: a kn5 and an AI line');
});
// D250 (the keeper: "the jumps are going to have to be tested by the user through trial and error driving it in assetto themselves")
// (a gap with NO landing ramp staying red is row 2's "a flight with NO landing is red", unchanged by D250)
// The lap: a 60 m jump, 1 m down, landing level: at the lap's speed its 6.3 g fall misses and NOTHING else is found (checked; LONG_JUMP's lap also fails the
// lap proof on leaves-surface after its sloped landing, a red D250 does not change, so it cannot show the ruling alone)
const MISS_JUMP = { gap: 60, drop: 1, land: 0 };
test('row 5b (D250): a closed lap whose jump the car flies past at the lap\'s speed EXPORTS, with one plain warning naming it', () => {
  const shut = close(jumpLap(MISS_JUMP), { edited: [0] }); assert.equal(shut.converged, true, shut.report);
  const segs = A.toSegments(shut.doc), lift = (q) => A.offsetPath(shut.doc, segs, q), start = { pos: shut.doc.start.pos.slice(), theta: shut.doc.start.heading, p: shut.doc.start.pitch };
  const fw = FW.buildFromSegments(segs, { name: 'jump', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start) });   // before D250: RED, landing-misses-zone and lap-proof
  assert.ok(fw.kn5.length > 1000 && fw.ai, 'exported');
  const jw = fw.warnings.filter((w) => /^jump: /.test(w));
  assert.equal(jw.length, 1, `said once, not twice (the amber range, not again from the lap proof): ${fw.warnings.join(' | ')}`);
  assert.match(jw[0], /^jump: this jump may fly past its landing at the lap's speed, at s \d+–\d+ m \(the 6\.3 g fall misses\); tune it by driving it in AC$/);
});
