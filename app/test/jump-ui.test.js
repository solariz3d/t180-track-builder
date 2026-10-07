// jump-ui.test.js: node --test app/test/jump-ui.test.js   (under the heavy-run lock)
// D258, THE FREE JUMP, UI HALF (the keeper's way: "instead of clicking extend, it says jump ... it then lets the user move around a blank straight piece ... through testing in the game trial and error
// driving it themselves"; the core is src/core/jump.js, E's; this half is app/core/landing.js, jumpwords.js, flightlayer.js, the shell's jump / landing API and the panel's Jump button, landing boxes and
// handles, whose rows are 14 to 14c of app/test/core-pieces-ui.test.js). It REPLACES D243's Add-jump control (gap, drop, landing angle, ballistic arcs: jumpplan.js is gone). FEEL tier: rows on the shell and
// pure modules, fake hosts for the panel; NO real window (no pointer lock or focus while the keeper is at the PC: the rule of 2026-10-06). Rows:
//   1  shell.jump: the take-off as Extend would place it, a free flight, a 60 m landing, ONE undo step, the default landing 40 m ahead, lined up; the null take-off; the ghost is flagged a jump's
//   1b every refusal in plain words (no code name), nothing changed, no undo step
//   2  the landing while it is the head: its values in the boxes' units; moveLanding is one undo step; a drag (begin / to / end) is ONE undo step from the document it began on, a step the core refuses
//      leaves it at the last good one; LANDING_NOT_HEAD after an Extend, in words, and deleting back to it moves it again
//   3  the handles' frames: the arrows ARE the pose's axes (forward moves the landing along the take-off's heading, sideways along its left, height straight up), on a turning and on a climbing take-off
//   4  the flight layer: the centreline of each flight from the take-off station to the landing, broken behind the camera; the ghost's flights while one shows
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const LD = require('../core/landing.js');
const JW = require('../core/jumpwords.js');
const FLY = require('../core/flightlayer.js');
const G = require('../../src/geom/index.js');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { close } = require('../../src/core/close.js');

const DEG = Math.PI / 180, R = 180, Q = (Math.PI * R) / 2;
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what || ''}: ${a} is not within ${eps} of ${b}`);
/** An open track: a 300 m bowl straight, then 100 m climbing a little (so the take-off has a pitch). */
async function base() { const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 100, targets: { kv: 0.002 } }); return s; }
const trackOf = (s) => { const r = s.getState().resolved; return { path: G.buildPath(r.segments, { step: 2, closed: false, start: r.start }), segments: r.segments }; };
const types = (s) => s.getState().history.present.pieces.map((p) => p.type);

test('row 1: shell.jump: the take-off as Extend would place it, a free flight, a 60 m straight landing, ONE undo step; the landing 40 m ahead at the same height, lined up; the ghost is a jump\'s', async () => {
  const s = await base(), d0 = s.getState().history.present, past0 = s.getState().history.past.length;
  s.jump({ length: 80 }); const d1 = s.getState().history.present;
  assert.deepEqual(types(s), [...d0.pieces.map((p) => p.type), 'road', 'flight', 'road'], 'the piece the fields describe, then the flight and the landing');
  assert.equal(d1.pieces[d1.pieces.length - 3].length, 80, 'the take-off is what Extend would place'); assert.equal(d1.pieces[d1.pieces.length - 1].length, 60, 'a 60 m landing');
  assert.equal(s.getState().history.past.length, past0 + 1, 'ONE undo step'); assert.match(s.getState().message, /^Jump placed: move its landing by hand\.$/); assert.equal(s.getState().messageKind, 'ok'); assert.ok(s.getState().dirty);
  assert.deepEqual(s.landing().pose, { forward: 40, left: 0, up: 0, heading: 0, pitch: 0, bank: 0 }, 'lined up, 40 m ahead, the same height'); assert.equal(s.landing().index, d1.pieces.length - 2);
  s.undo(); assert.equal(s.getState().history.present, d0, 'Undo gives the very same document back'); s.redo(); assert.equal(s.getState().history.present, d1);
  // null: take off from the track's end as it is
  const t = await base(); t.jump(null); assert.deepEqual(types(t).slice(-2), ['flight', 'road']); assert.equal(types(t).length, 4);
  // the ghost: flagged a jump's, built from the same core call, and it throws the core's refusal
  const c = (await base()).candidateJump({ length: 80 }); assert.equal(c.jump, true); assert.equal(c.closed, false); assert.ok(c.segments.some((g) => g.kind === 'gap')); assert.ok(c.start);
  // no landing on a track without a jump, and none once it is closed
  assert.equal((await base()).landing(), null);
});

const REFUSALS = [
  ['NO_TAKEOFF', async () => createCoreShell({ brushFn: null, autosaveMs: 0 }), null, /^A jump needs road to take off from: press Extend first, then Jump\.$/],
  ['CLOSED', async () => { const c = await createCoreShell({ brushFn: null, autosaveMs: 0 }); let d = extend(D.createDoc('lap'), { length: 300, family: 'bowl' }); for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } }); d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } }); const r = close(d, { edited: [0] }); assert.ok(r.converged); c.commitDoc(r.doc); return c; }, { length: 50 }, /^The loop is closed, so there is no open end to add a jump to\. Undo the close first\.$/],
  ['JUMP_AFTER_JUMP', async () => { const s = await base(); s.commitDoc(D.appendPiece(s.getState().history.present, D.flightPiece({ forward: 30, left: 0, up: 0, heading: 0, pitch: 0, bank: 0 }))); return s; }, null, /^The track already ends in a jump\. Extend from its landing first/],
  ['FLIGHT_OFFSET', async () => { const s = await createCoreShell({ autosaveMs: 0 }); s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 100, targets: { kv: 0.002 } }); s.beginBrush({ mode: 'local', channel: 'height', s0: 380, r: 60 }); s.brushTo(3); s.endBrush(); assert.equal(s.getState().message, null); return s; }, null, /^The road at the end still carries a height or sideways offset \(from the local brush/],
];
test('row 1b: every refusal of the core is said in plain words, with nothing changed and no undo step', async () => {
  for (const [name, make, o, re] of REFUSALS) {
    const t = await make(), before = t.getState().history.present, n = t.getState().history.past.length; t.jump(o);
    assert.match(t.getState().message, re, `${name}: ${t.getState().message}`); assert.equal(t.getState().messageKind, 'error', name);
    assert.doesNotMatch(t.getState().message, /\b(?:NO_TAKEOFF|CLOSED|JUMP_AFTER_JUMP|FLIGHT_OFFSET|BAD_FLIGHT|LANDING_NOT_HEAD)\b/, `${name}: no code name`);
    assert.equal(t.getState().history.present, before, `${name}: nothing changed`); assert.equal(t.getState().history.past.length, n, `${name}: no undo step`);
    assert.throws(() => t.candidateJump(o), (e) => e.name === 'CoreError', `${name}: the ghost throws the core's refusal`);
  }
  // the words alone: the ones the shell reaches only through a move
  assert.match(JW.jumpWords({ code: 'LANDING_NOT_HEAD' }), /^The landing can only be moved while it is the last piece of the track\./); assert.match(JW.jumpWords({ code: 'FLIGHT_TOO_SHORT', message: 'FLIGHT_TOO_SHORT: p2: the landing starts 0.5 m from the take-off' }), /^The landing is too close to the take-off: put it at least 1 m away\.$/);
  assert.equal(JW.jumpWords({ code: 'SOMETHING', message: 'SOMETHING: the core\'s own sentence' }), 'the core\'s own sentence', 'an unknown refusal keeps the core\'s sentence minus its code'); assert.equal(JW.jumpWords(null), '');
});

test('row 2: the landing while it is the head: values in the boxes\' units; moveLanding is ONE undo step; a drag is ONE step from where it began; a refused step leaves the last good one; fixed after an Extend, movable again after deleting back', async () => {
  const s = await base(); s.jump(null); const d1 = s.getState().history.present, past0 = s.getState().history.past.length;
  s.moveLanding({ forward: 60, left: 5, up: -3, heading: 10, pitch: -2, bank: 4 }); assert.equal(s.getState().history.past.length, past0 + 1, 'ONE undo step for a typed move');
  assert.deepEqual(s.landing().pose, { forward: 60, left: 5, up: -3, heading: 10, pitch: -2, bank: 4 }, 'metres stay metres, degrees come back as degrees');
  const f = s.getState().history.present.pieces.find((p) => p.type === 'flight'); near(f.heading, 10 * DEG, 1e-9, 'heading in radians in the document'); near(f.pitch, -2 * DEG, 1e-9); near(f.bank, 4 * DEG, 1e-9); assert.deepEqual([f.forward, f.left, f.up], [60, 5, -3]);
  s.moveLanding({ forward: 60 }); assert.equal(s.getState().history.past.length, past0 + 1, 'the same value is no step'); s.undo(); assert.equal(s.getState().history.present, d1, 'Undo gives the jump as placed');
  // a drag: many steps, one undo
  s.beginLanding(); assert.ok(s.getState().landingDrag); const n0 = s.getState().history.past.length;
  for (const v of [41, 42, 45, 50]) s.landingTo({ forward: v }); assert.equal(s.landing().pose.forward, 50); assert.equal(s.getState().history.past.length, n0, 'nothing in Undo until the drag ends');
  s.landingTo({ forward: 0.5 }); assert.match(s.getState().message, /^The landing is too close to the take-off: put it at least 1 m away\.$/); assert.equal(s.landing().pose.forward, 50, 'a step the core refuses leaves the drag at its last good step');
  s.landingTo({ left: 7 }); assert.deepEqual([s.landing().pose.forward, s.landing().pose.left], [40, 7], 'each step is the values given ON THE DOCUMENT THE DRAG BEGAN ON (a handle drags one value: the forward of the earlier steps is not kept)');
  s.endLanding(); assert.equal(s.getState().landingDrag, null); assert.equal(s.getState().history.past.length, n0 + 1, 'ONE undo step for the whole drag'); s.undo(); assert.equal(s.getState().history.present, d1);
  // fixed after an Extend, in words
  s.extend({ length: 50 }); assert.equal(s.landing(), null, 'the landing is not the head any more'); const d2 = s.getState().history.present; s.moveLanding({ forward: 70 });
  assert.match(s.getState().message, /^The landing can only be moved while it is the last piece of the track\. Once road is extended from it, it is fixed: delete back to it \(Ctrl\+Backspace\) to move it again\.$/); assert.equal(s.getState().history.present, d2);
  s.beginLanding(); assert.match(s.getState().message, /^The landing can only be moved/); assert.equal(s.getState().landingDrag, null, 'no drag opens');
  // deleting back to it makes it the head again
  s.removeHead(); assert.ok(s.landing(), 'the landing is the head again'); s.moveLanding({ forward: 70 }); assert.equal(s.landing().pose.forward, 70);
  // no drag open: the drag verbs say so and change nothing
  const t = await base(); t.jump(null); const h = t.getState().history.present; t.landingTo({ forward: 50 }); assert.equal(t.getState().history.present, h); assert.match(t.getState().message, /no landing drag is open/); assert.equal(t.endLanding(), t.getState());
});

test('row 3: the handles\' frames: the arrows ARE the pose\'s axes: forward moves the landing along the take-off\'s heading, sideways along its left, height straight up (a turning, climbing take-off too)', async () => {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0 }); s.extend({ length: 200, family: 'bowl' }); s.extend({ length: 150, transition: 40, targets: { kh: 1 / 400, kv: 0.002 } }); s.jump(null);
  const flight = s.landing().flightId, at = (pose) => { s.moveLanding(pose); const F = LD.framesOf(trackOf(s), flight); assert.ok(F, 'the landing is on the path'); return F; };
  const F0 = at({ forward: 40, left: 0, up: 0, heading: 0, pitch: 0, bank: 0 });
  near(Math.hypot(...F0.T0), 1, 1e-9, 'unit'); assert.equal(F0.T0[1], 0, 'the take-off\'s heading is HORIZONTAL (it climbs, its frame does not)'); assert.deepEqual(F0.U0, [0, 1, 0]); near(F0.L0[0] * F0.T0[0] + F0.L0[2] * F0.T0[2], 0, 1e-12, 'left is across the heading');
  near(F0.T0[2] * F0.L0[0] - F0.T0[0] * F0.L0[2], 1, 1e-12, 'left is U x T (with forward +z, left is +x)');
  const d = (a, b) => [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const Ff = at({ forward: 50, left: 0, up: 0, heading: 0, pitch: 0, bank: 0 }), df = d(F0, Ff); near(dot(df, F0.T0), 10, 1e-3, '+10 forward is 10 m along the heading'); near(dot(df, F0.L0), 0, 1e-3, 'and no sideways'); near(df[1], 0, 1e-3, 'and no height');
  const Fl = at({ forward: 50, left: 6, up: 0, heading: 0, pitch: 0, bank: 0 }), dl = d(Ff, Fl); near(dot(dl, F0.L0), 6, 1e-3, '+6 sideways is 6 m to the left'); near(dot(dl, F0.T0), 0, 1e-3); near(dl[1], 0, 1e-3);
  const Fu = at({ forward: 50, left: 6, up: 4, heading: 0, pitch: 0, bank: 0 }), du = d(Fl, Fu); near(du[1], 4, 1e-3, '+4 height is 4 m up, whatever the take-off\'s climb'); near(dot(du, F0.T0), 0, 1e-3); near(dot(du, F0.L0), 0, 1e-3);
  // heading: the landing turns left by that many degrees from the take-off's heading (its own direction T1)
  const Fh = at({ forward: 50, left: 6, up: 4, heading: 30, pitch: 0, bank: 0 }), h1 = Math.hypot(Fh.T1[0], Fh.T1[2]), ang = Math.atan2(dot(Fh.T1, F0.L0), dot(Fh.T1, F0.T0));
  near(ang, 30 * DEG, 1e-3, 'a heading of +30 is 30 degrees to the LEFT of the take-off'); assert.ok(h1 > 0.99, 'level landing'); near(Fh.T1[1], 0, 1e-6, 'pitch 0 is level');
  const Fp = at({ forward: 50, left: 6, up: 4, heading: 30, pitch: 5, bank: 0 }); near(Math.asin(Fp.T1[1]), 5 * DEG, 1e-3, 'a pitch of 5 is nose up 5 degrees');
  assert.equal(LD.framesOf(trackOf(s), 'nope'), null, 'a piece that is not on the path'); assert.equal(LD.framesOf(null, 'p1'), null); assert.equal(LD.framesOf({ path: { samples: [] }, segments: [] }, 'p1'), null);
  // the number boxes' units
  assert.deepEqual(LD.BOXES.map((b) => b.field), ['forward', 'left', 'up', 'heading', 'pitch', 'bank']); assert.deepEqual(LD.poseOf('heading', 90), { heading: Math.PI / 2 }); assert.deepEqual(LD.poseOf('forward', 12.5), { forward: 12.5 });
  assert.deepEqual(LD.boxValues({ forwardM: 40.004, leftM: -0.001, upM: 1.234, headingDeg: -0, pitchDeg: 2.5, bankDeg: 0 }), { forward: 40, left: 0, up: 1.23, heading: 0, pitch: 2.5, bank: 0 }, 'two decimals, no "-0"'); assert.equal(LD.boxValues(null), null);
});

test('row 4: the flight layer: each flight\'s centreline from the take-off station to the landing, broken behind the camera; the ghost\'s flights while one shows, the placed track\'s otherwise', async () => {
  const s = await base(); s.jump({ length: 60 }); const { path, segments } = trackOf(s), fl = FLY.flightsOfPath(path, segments), f = fl[0];
  assert.equal(fl.length, 1); assert.equal(f.id, s.landing().flightId); assert.ok(f.points.length >= 3, 'a curve across the air, with the stations either side');
  const F = LD.framesOf({ path, segments }, f.id); assert.deepEqual(f.points[f.points.length - 1], F.pos, 'it ends at the landing\'s start'); assert.ok(Math.hypot(f.points[0][0] - F.pos[0], f.points[0][2] - F.pos[2]) > 30, 'and starts back at the take-off');
  const lip = f.points[0], pose = { eye: [lip[0] - 60, lip[1] + 25, lip[2] - 60], target: F.pos, up: [0, 1, 0], fov: 60 * DEG };
  const lines = FLY.flightLines(fl, pose, 900, 600); assert.equal(lines.length, 1, 'one dashed line'); assert.equal(lines[0].points.length, f.points.length); for (const p of lines[0].points) assert.ok(p.x > -200 && p.x < 1100, `on screen: ${p.x}`);
  const away = { ...pose, eye: [F.pos[0] + 400, F.pos[1] + 25, F.pos[2] + 400], target: [F.pos[0] + 500, F.pos[1], F.pos[2] + 500] }; assert.deepEqual(FLY.flightLines(fl, away, 900, 600), [], 'a camera looking away draws nothing');
  assert.deepEqual(FLY.flightLines([], pose, 900, 600), []); assert.deepEqual(FLY.flightLines(fl, null, 900, 600), []); assert.deepEqual(FLY.flightLines(fl, pose, 0, 0), []);
  assert.deepEqual(FLY.flightsOfPath(trackOf(await base()).path, trackOf(await base()).segments), [], 'none on a track without a jump'); assert.deepEqual(FLY.flightsOfPath({ samples: [] }, []), []); assert.deepEqual(FLY.flightsOfPath(null, null), []);
  // the mounted layer, on a stage that answers the preview's three requests
  const listeners = {}, frames = [], canvas = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getContext: () => null, remove() { this.gone = true; }, isConnected: true };
  const docu = { createElement: () => canvas, addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); }, dispatchEvent: (ev) => { for (const fn of listeners[ev.type] || []) fn(ev); return true; } };
  const stage = { clientWidth: 900, clientHeight: 600, ownerDocument: docu, isConnected: true, append() {} };
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, devicePixelRatio: 1, requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; }, cancelAnimationFrame() {} };
  let ghost = null; docu.addEventListener('t180:view', (ev) => ev.detail.reply({ pose })); docu.addEventListener('t180:track-request', (ev) => ev.detail.reply({ path, segments })); docu.addEventListener('t180:ghost-request', (ev) => ev.detail.reply(ghost));
  const layer = FLY.mount(stage, win), tick = () => frames.splice(0).forEach((cb) => cb(0)); tick();
  assert.equal(layer.flights().length, 1, 'the placed track\'s flight'); assert.equal(layer.lines().length, 1);
  // a ghost with a second (candidate) flight: the ghost's path holds the placed flights AND the candidate's, so it is the one read
  const t = await base(); t.jump({ length: 60 }); t.extend({ length: 200 }); const c = t.candidateJump({ length: 50 }), gp = { path: G.buildPath(c.segments, { step: 2, closed: false, start: c.start }), segments: c.segments };
  ghost = { samples: gp.path.samples, segments: gp.segments, jump: true, s0: 0 }; tick(); assert.equal(layer.flights().length, 2, 'the ghost\'s path: the placed flight and the candidate'); assert.equal(layer.lines().length, 2);
  ghost = null; tick(); assert.equal(layer.flights().length, 1, 'no ghost: the placed track again'); layer.unmount(); assert.equal(canvas.gone, true);
});
