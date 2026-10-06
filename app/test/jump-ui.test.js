// jump-ui.test.js: node --test app/test/jump-ui.test.js   (under the heavy-run lock)
// D243 item 1, THE ADD-JUMP CONTROL (the core is src/core/jump.js, E's; the UI half is app/core/jumpplan.js, flightlayer.js, the shell's addJump / candidateJump, and the panel's Jump block, whose rows are
// 14 to 16 of app/test/core-pieces-ui.test.js). FEEL tier: targeted rows, no mutation harness (the librarian runs them once at install). Rows:
//   1  the flight model: the lip, the gap, the drop and the landing pitch read off a real path; the dashed arc IS the core's ballistic model (flightY) at the design speed, one per measured fall; it ends ON the landing
//      ramp; where there is no model it is a straight line and says so; a fall that does not reach the landing is marked and says what speed it needs
//   2  addJump: one undo step; the next Extend lays the landing road; every refusal of the core in plain words, with nothing changed
//   3  the overlay: the arcs on screen, broken behind the camera; the ghost's flights while one shows, the placed track's otherwise
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const JP = require('../core/jumpplan.js');
const FLY = require('../core/flightlayer.js');
const G = require('../../src/geom/index.js');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { close } = require('../../src/core/close.js');
const { flightY, minSpeed } = require('../../src/validate/jumps.js');
const { MACH6 } = require('../../src/validate/limits.js');

const DEG = Math.PI / 180, R = 180, Q = (Math.PI * R) / 2;
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what || ''}: ${a} is not within ${eps} of ${b}`);
/** An open track: a 300 m bowl straight, then 100 m climbing a little (so the take-off has a ramp angle). */
async function base() { const s = await createCoreShell({ autosaveMs: 0 }); s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 100, targets: { kv: 0.002 } }); return s; }
const pathOf = (s) => { const r = s.getState().resolved; return { path: G.buildPath(r.segments, { step: 2, closed: false, start: r.start }), segments: r.segments }; };
const flightsOf = (s, opts) => { const { path, segments } = pathOf(s); return JP.flightsOfPath(path, segments, opts); };

test('row 1: the flight model: the lip, gap, drop and landing pitch read off a path; the dashed arc is the core\'s ballistic flight at the design speed, one per fall, and it ends ON the landing ramp', async () => {
  const s = await base(); s.addJump({ gap: 30, drop: 1, landDeg: -2 }); assert.match(s.getState().message, /^Jump added/, s.getState().message);
  const fl = flightsOf(s), f = fl[0]; assert.equal(fl.length, 1); assert.equal(f.model, 'ballistic'); assert.equal(f.speedKmh, MACH6.designSpeedKmh, 'drawn at the design speed the ramp is sized for'); assert.equal(JP.DESIGN_KMH, MACH6.designSpeedKmh); assert.deepEqual([...JP.FALLS], [...MACH6.jumpG]);
  near(f.D, 30, 1e-6, 'the gap'); near(f.dh, -1, 1e-6, 'the drop (+ down) as a change of height'); near(f.landRad, -2 * DEG, 1e-3, 'the landing pitch'); assert.ok(f.lip.theta > 0.001, `the take-off is the climbing road's pitch: ${f.lip.theta}`);
  const { path } = pathOf(s), segs = s.getState().resolved.segments, gi = segs.findIndex((g) => g.kind === 'gap'), first = path.samples.findIndex((m) => m.seg === gi);
  assert.deepEqual(f.lip.pos, path.samples[first].pos, 'the lip is the road\'s last station, where the gap starts');
  const v = MACH6.designSpeedKmh / 3.6, ramp = Math.tan(f.landRad);
  assert.equal(f.falls.length, 2); f.falls.forEach((fall, k) => {
    assert.equal(fall.g, MACH6.jumpG[k]); assert.deepEqual(fall.arc[0], [0, 0], 'the arc starts at the lip'); assert.equal(fall.clear, true, `${fall.g} g clears at 460 km/h`);
    for (const [x, y] of fall.arc) near(y, flightY(x, v, f.lip.theta, fall.g), 1e-9, `the arc is flightY at x ${x}`);
    const [xe, ye] = fall.arc[fall.arc.length - 1]; near(xe, fall.x, 1e-9, 'the arc ends at the touchdown'); near(ye, f.dh + (xe - f.D) * ramp, 1e-6, `${fall.g} g: the arc ends ON the landing ramp`); assert.ok(xe > f.D, 'past the landing lip');
    near(fall.minKmh, minSpeed(f.D, f.dh, f.lip.theta, fall.g) * 3.6, 1e-9, 'the speed it needs');
  });
  assert.ok(f.falls[0].x > f.falls[1].x, 'the lighter fall (3.2 g) carries farther'); assert.ok(f.rampM >= f.falls[0].x - f.D, 'the ramp is long enough for the farthest touchdown');
  // the arc in the world: from the lip, along the ground heading, up by y
  const w = JP.arcWorld(f, f.falls[0]); assert.deepEqual(w[0], f.lip.pos);
  w.forEach((p, i) => { const [x, y] = f.falls[0].arc[i]; near((p[0] - f.lip.pos[0]) * f.lip.h[0] + (p[2] - f.lip.pos[2]) * f.lip.h[2], x, 1e-9, 'distance along the heading'); near(p[1] - f.lip.pos[1], y, 1e-9, 'height above the lip'); });
  // the words say which line it is, the speed and the ramp
  const w2 = JP.describe(f); assert.match(w2.drew, /ballistic, at 460 km\/h, falling at 3\.2 g and 6\.3 g/); assert.match(w2.speed, /ramp is sized for 460 km\/h, fixed today/); assert.equal(w2.lines.length, 3); assert.match(w2.lines[0], /^3\.2 g: comes down \d+\.\d m after the lip, \d+\.\d m onto the ramp\.$/); assert.match(w2.lines[2], /^The ramp is \d+\.\d m long\.$/);
});

test('row 1b: no flight model: a STRAIGHT dashed line, and it says so; a fall that does not reach the landing is marked and says the speed it needs; two flights; none; no landing yet', async () => {
  const s = await base(); s.addJump({ gap: 40, drop: 1, landDeg: -2 });
  const st = flightsOf(s, { model: null })[0]; assert.equal(st.model, 'straight'); assert.equal(st.falls.length, 1); assert.deepEqual(st.falls[0].arc[0], [0, 0]); near(st.falls[0].arc[1][0], st.D, 1e-9); near(st.falls[0].arc[1][1], st.dh, 1e-9); assert.equal(st.rampM, null);
  const w = JP.describe(st); assert.equal(w.drew, 'straight'); assert.match(w.lines[0], /straight from the take-off lip to the landing lip: this build has no flight model/);
  // a long gap: the heavier fall does not reach it at 460 km/h
  const l = await base(); l.addJump({ gap: 120, drop: 3, landDeg: -3 }); const lf = flightsOf(l)[0]; assert.equal(lf.falls[0].clear, true); assert.equal(lf.falls[1].clear, false, '6.3 g falls short');
  const short = lf.falls[1], [xs, ys] = short.arc[short.arc.length - 1]; assert.ok(xs < lf.D, `it comes down short of the landing lip (${xs} of ${lf.D})`); near(ys, lf.dh, 1, 'at the level of the landing lip'); assert.equal(short.x, null);
  const lw = JP.describe(lf); assert.match(lw.lines[1], /^6\.3 g: does NOT reach the landing at 460 km\/h \(it needs 62\d km\/h\): a warning, not a red \(tune it by driving it in AC\)\.$/, lw.lines[1]);   // D257 (amended): a missed fall is a WARNING since D250, not "the jump is red"
  // two flights on one track; each its own lip
  const t = await base(); t.addJump({ gap: 30, drop: 1, landDeg: -2 }); t.extend({ length: 200 }); t.addJump({ gap: 25, drop: 0, landDeg: -1 }); const two = flightsOf(t); assert.equal(two.length, 2); assert.notDeepEqual(two[0].lip.pos, two[1].lip.pos); assert.deepEqual(two.map((x) => x.id), ['p3', 'p5']);
  // none, an empty path, and a flight with no landing yet (the path cut after the gap)
  assert.deepEqual(flightsOf(await base()), []); assert.deepEqual(JP.flightsOfPath({ samples: [] }, []), []); assert.deepEqual(JP.flightsOfPath(null, null), []);
  const { path, segments } = pathOf(s), gi = segments.findIndex((g) => g.kind === 'gap'), cut = segments.slice(0, gi + 1), keep = path.samples.filter((m) => m.seg <= gi); assert.deepEqual(JP.flightsOfPath({ samples: keep }, cut), [], 'a gap with nothing after it is left out');
});

const REFUSALS = [
  ['NO_TAKEOFF', async () => createCoreShell({ autosaveMs: 0 }), { gap: 30, drop: 1, landDeg: -2 }, /^A jump needs road to take off from: press Extend first, then Add jump\.$/],
  ['CLOSED', async () => { const c = await createCoreShell({ brushFn: null, autosaveMs: 0 }); let d = extend(D.createDoc('lap'), { length: 300, family: 'bowl' }); for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } }); d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } }); const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); c.adopt(r.doc); return c; }, { gap: 30, drop: 1, landDeg: -2 }, /^The loop is closed, so there is no open end to add a jump to\. Undo the close first\.$/],
  ['BAD_JUMP gap', base, { gap: 0, drop: 1, landDeg: 0 }, /^The gap must be more than 0 m: it is how far the car flies along the ground\.$/], ['BAD_JUMP gap blank', base, { gap: '', drop: 1, landDeg: 0 }, /^The gap must be more than 0 m/],
  ['BAD_JUMP drop', base, { gap: 30, drop: 'abc', landDeg: 0 }, /^The drop must be a number of metres \(\+ is down/], ['BAD_JUMP landing', base, { gap: 30, drop: 1, landDeg: 95 }, /^The landing angle must be between −90° and \+90°/],
  ['JUMP_AFTER_JUMP', async () => { const s = await base(); s.addJump({ gap: 30, drop: 1, landDeg: -2 }); return s; }, { gap: 30, drop: 1, landDeg: -2 }, /^The track already ends in a jump\. Press Extend first, so the car has road to land on, then add the next one\.$/],
  ['FLIGHT_OFFSET', async () => { const s = await base(); s.beginBrush({ mode: 'local', channel: 'height', s0: 380, r: 60 }); s.brushTo(3); s.endBrush(); assert.equal(s.getState().message, null); return s; }, { gap: 30, drop: 1, landDeg: -2 }, /^The road at the end still carries a height or sideways offset \(from the local brush\)/],
  ['JUMP_UNSOLVABLE', base, { gap: 20, drop: 500, landDeg: 80 }, /^No flight covers a gap of 20 m, dropping 500 m and arriving at 80°\. Try a shorter gap, a smaller drop or a gentler landing angle\.$/],
  ['JUMP_PAST_VERTICAL (the flight)', base, { gap: 1, drop: 300, landDeg: -80 }, /^To land there the flight would have to turn through vertical \(the car would fly backwards\)\./],
  ['JUMP_PAST_VERTICAL (the take-off)', async () => { const s = await createCoreShell({ autosaveMs: 0 }); s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 200, targets: { kv: 0.05 } }); s.extend({ length: 200, targets: { kv: 0.05 } }); return s; }, { gap: 30, drop: 1, landDeg: -2 }, /^The road at the end points almost straight up or down, so a jump cannot take off from it\./],
];
test('row 2: addJump is ONE undo step, the NEXT Extend lays the landing road, and every refusal of the core is said in plain words with nothing changed', async () => {
  const s = await base(), d0 = s.getState().history.present, past0 = s.getState().history.past.length;
  s.addJump({ gap: 30, drop: 1, landDeg: -2 }); const d1 = s.getState().history.present; assert.equal(d1.pieces.length, 3); assert.deepEqual(d1.pieces.map((p) => p.type), ['road', 'road', 'flight']); assert.deepEqual([d1.pieces[2].gap, d1.pieces[2].drop], [30, 1]); near(d1.pieces[2].land, -2 * DEG, 1e-6);
  assert.equal(s.getState().history.past.length, past0 + 1, 'ONE undo step'); assert.match(s.getState().message, /^Jump added\. Press Extend to lay the road it lands on\.$/); assert.equal(s.getState().messageKind, 'ok'); assert.ok(s.getState().dirty);
  s.undo(); assert.equal(s.getState().history.present, d0, 'Undo gives the very same document back'); s.redo(); assert.equal(s.getState().history.present, d1);
  // the next Extend starts the landing road: after the flight, at the landing pitch, joined
  s.extend({ length: 100 }); const d2 = s.getState().history.present; assert.deepEqual(d2.pieces.map((p) => p.type), ['road', 'road', 'flight', 'road']); assert.equal(s.getState().message, null, s.getState().message); D.checkDoc(d2);
  const { path, segments } = pathOf(s), gi = segments.findIndex((g) => g.kind === 'gap'); assert.ok(gi > 0 && segments[gi].id === 'p3' && segments[gi + 1].part === 'land' && segments[segments.length - 1].id === 'p4', 'a flight, its landing ramp, then the new road');
  const lipI = path.samples.findIndex((m) => m.seg === gi), landI = path.samples.findIndex((m) => m.seg === gi + 1), nextI = path.samples.findIndex((m) => segments[m.seg] && segments[m.seg].id === 'p4');
  near(Math.asin(path.samples[nextI].T[1]), -2 * DEG, 5e-3, 'the road after the flight starts at the landing pitch'); assert.ok(landI > lipI);
  // the candidate (the ghost): flagged as a jump, built from the same core call
  const c = (await base()).candidateJump({ gap: 30, drop: 1, landDeg: -2 }); assert.equal(c.jump, true); assert.equal(c.closed, false); assert.ok(c.segments.some((g) => g.kind === 'gap')); assert.ok(c.start);
  // every refusal: plain words, no code name, nothing changed, no undo step
  for (const [name, make, o, re] of REFUSALS) {
    const t = await make(), before = t.getState().history.present, n = t.getState().history.past.length; t.addJump(o);
    assert.match(t.getState().message, re, `${name}: ${t.getState().message}`); assert.equal(t.getState().messageKind, 'error', name); assert.doesNotMatch(t.getState().message, /\b(?:NO_TAKEOFF|CLOSED|BAD_JUMP|JUMP_AFTER_JUMP|FLIGHT_OFFSET|JUMP_PAST_VERTICAL|JUMP_UNSOLVABLE)\b/, `${name}: no code name`);
    assert.equal(t.getState().history.present, before, `${name}: nothing changed`); assert.equal(t.getState().history.past.length, n, `${name}: no undo step`);
    assert.throws(() => t.candidateJump(o), (e) => e.name === 'CoreError', `${name}: the ghost throws the core's refusal`);
  }
  // blanks are 0 for the drop and the landing; gap is needed
  const b = await base(); b.addJump({ gap: '40', drop: '', landDeg: '' }); assert.match(b.getState().message, /^Jump added/); assert.deepEqual([b.getState().history.present.pieces[2].drop, b.getState().history.present.pieces[2].land], [0, 0]);
});

test('row 3: the overlay: the arcs on screen with the dashed fall marked, broken behind the camera; the ghost\'s flights while one shows, the placed track\'s otherwise', async () => {
  const s = await base(); s.addJump({ gap: 30, drop: 1, landDeg: -2 }); const { path, segments } = pathOf(s), fl = JP.flightsOfPath(path, segments), f = fl[0], lip = f.lip.pos;
  const pose = { eye: [lip[0] - f.lip.h[0] * 60, lip[1] + 25, lip[2] - f.lip.h[2] * 60], target: [lip[0] + f.lip.h[0] * 30, lip[1], lip[2] + f.lip.h[2] * 30], up: [0, 1, 0], fov: 60 * DEG };
  const lines = FLY.flightLines(fl, pose, 900, 600); assert.equal(lines.length, 2, 'one dashed line per fall'); assert.deepEqual(lines.map((l) => l.g), [3.2, 6.3]); assert.ok(lines.every((l) => l.points.length === 49 && l.clear === true && l.model === 'ballistic'));
  for (const l of lines) for (const p of l.points) assert.ok(p.x >= -50 && p.x <= 950 && p.y >= -50 && p.y <= 650, `on screen: ${p.x},${p.y}`);
  assert.ok(lines[0].points[48].x !== lines[1].points[48].x || lines[0].points[48].y !== lines[1].points[48].y, 'the two falls come down in different places');
  // from the other side of the camera: the arc is behind it and is broken off
  const back = FLY.flightLines(fl, { ...pose, eye: [lip[0] + f.lip.h[0] * 400, lip[1] + 25, lip[2] + f.lip.h[2] * 400], target: [lip[0] + f.lip.h[0] * 500, lip[1], lip[2] + f.lip.h[2] * 500] }, 900, 600); assert.deepEqual(back, [], 'a camera looking away draws nothing');
  assert.deepEqual(FLY.flightLines([], pose, 900, 600), []); assert.deepEqual(FLY.flightLines(fl, null, 900, 600), []); assert.deepEqual(FLY.flightLines(fl, pose, 0, 0), []);
  // a straight line is drawn as one line, marked straight
  const sl = FLY.flightLines(JP.flightsOfPath(path, segments, { model: null }), pose, 900, 600); assert.equal(sl.length, 1); assert.equal(sl[0].model, 'straight'); assert.equal(sl[0].g, null);
  // the mounted layer, on a stage that answers the preview's three requests
  const listeners = {}, frames = [], canvas = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getContext: () => null, remove() { this.gone = true; }, isConnected: true };
  const docu = { createElement: () => canvas, addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); }, dispatchEvent: (ev) => { for (const f of listeners[ev.type] || []) f(ev); return true; } };
  const stage = { clientWidth: 900, clientHeight: 600, ownerDocument: docu, isConnected: true, append() {} };
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, devicePixelRatio: 1, requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; }, cancelAnimationFrame() {} };
  let ghost = null; docu.addEventListener('t180:view', (ev) => ev.detail.reply({ pose })); docu.addEventListener('t180:track-request', (ev) => ev.detail.reply({ path, segments })); docu.addEventListener('t180:ghost-request', (ev) => ev.detail.reply(ghost));
  const layer = FLY.mount(stage, win), tick = () => frames.splice(0).forEach((cb) => cb(0)); tick();
  assert.equal(layer.flights().length, 1, 'the placed track\'s flight'); assert.equal(layer.lines().length, 2);
  // a ghost with a second (candidate) flight: the ghost's path holds the placed flights AND the candidate's, so it is the one read
  const t = await base(); t.addJump({ gap: 30, drop: 1, landDeg: -2 }); t.extend({ length: 200 }); const gp = (() => { const c = t.candidateJump({ gap: 25, drop: 0, landDeg: -1 }); return { path: G.buildPath(c.segments, { step: 2, closed: false, start: c.start }), segments: c.segments }; })();
  ghost = { samples: gp.path.samples, segments: gp.segments, jump: true, s0: 0 }; tick(); assert.equal(layer.flights().length, 2, 'the ghost\'s path: the placed flight and the candidate'); assert.equal(layer.lines().length, 4);
  ghost = null; tick(); assert.equal(layer.flights().length, 1, 'no ghost: the placed track again'); layer.unmount(); assert.equal(canvas.gone, true);
});
