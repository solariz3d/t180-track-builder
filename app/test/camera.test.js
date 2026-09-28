// camera.test.js: node --test app/test/camera.test.js. The preview's cameras, headless (app/camera/cameras.js).
// Stated before these tests were written:
//   · BUILD (the default) is src/geom's headCamera exactly: 15 m behind the head along T, 6 m above along U, looking
//     along T, up = U; on a banked, climbing head too.
//   · OVERHEAD is 80 m straight up, the growth direction up the screen, and that direction stays level inside a loop.
//   · SIDE is level with the head, 40 m off its right side (against L), 6 m up, looking at the head.
//   · CHASE rides the road 25 m behind the head, 3 m along the road's own up, and stays on the drivable side through a
//     loop-the-loop.
//   · The switch key walks build → overhead → side → chase → free → build; the build key reaches build in ONE press
//     from every mode.
//   · After an append the follow modes follow the new head; free does not move.
//   · Entering free keeps the view; free flies and turns only in free mode; its pitch stays within ±89°.
//   · The shown pose eases toward the exact pose without a snap on a mode switch, and converges.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const C = require(path.join(ADIR, 'camera', 'cameras.js'));
const G = require('../../src/geom/index.js');
const F = require('../../test/geom_fixtures.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const near = (a, b, tol = 1e-9) => len(sub(a, b)) <= tol;
const unit = (a) => a.map((x) => x / len(a));

/** A climbing, banked, turning open track: its head is a frame with every component non-trivial. */
function track() {
  const segs = [{ id: 'a', kind: 'road', length: 40, profile: F.FLAT }, { id: 'b', kind: 'road', length: 50, k0: 0.01, k1: 0.02, kp0: 0.002, kp1: 0.002, roll0: 0, roll1: 0.2, profile: F.HALFPIPE }];
  return { segs, path: G.buildPath(segs) };
}

test('build view (default): the geometry\'s own head camera, 15 m behind along T and 6 m up along U, looking along T', () => {
  const { path: p } = track(), h = p.head, rig = C.createRig(), pose = rig.pose({ head: h, path: p });
  assert.equal(rig.mode, 'build');
  const rel = sub(pose.eye, h.pos);
  assert.ok(Math.abs(dot(rel, h.T) + 15) < 1e-9 && Math.abs(dot(rel, h.U) - 6) < 1e-9 && Math.abs(dot(rel, h.L)) < 1e-9, `eye offset ${rel}`);
  assert.ok(near(pose.up, h.U), 'up is the head\'s U (the view banks with the road)');
  assert.ok(dot(unit(sub(pose.target, pose.eye)), h.T) > 0.9, 'it looks along the growth direction');
  const c = G.headCamera(h);
  assert.ok(near(pose.eye, c.eye) && near(pose.target, c.target));
});
test('overhead: 80 m straight up, the growth direction up the screen', () => {
  const { path: p } = track(), h = p.head, pose = C.poseFor('overhead', { head: h, path: p });
  assert.ok(near(pose.eye, [h.pos[0], h.pos[1] + 80, h.pos[2]]) && near(pose.target, h.pos));
  const f = unit([h.T[0], 0, h.T[2]]);
  assert.ok(near(pose.up, f, 1e-12), 'screen-up is the head\'s heading on the ground');
});
test('overhead: inside a loop (T vertical) the screen-up stays the loop\'s heading, level', () => {
  // the loop heads 0.7 rad off +z, so a fixed "north" fallback cannot pass for the loop's heading
  const p = G.buildPath(F.loopTheLoop(), { start: { pos: [0, 0, 0], theta: 0.7, p: 0 } }), up = p.samples.find((s) => s.seg === 1 && s.T[1] > 0.9999), f = C.groundForward(up);
  assert.ok(Math.abs(f[1]) < 1e-12 && dot(f, [Math.sin(0.7), 0, Math.cos(0.7)]) > 0.999, `forward ${f}`);
});
test('side: level with the head, 40 m off its right side, 6 m up, looking at the head', () => {
  const { path: p } = track(), h = p.head, pose = C.poseFor('side', { head: h, path: p }), rel = sub(pose.eye, h.pos);
  const f = unit([h.T[0], 0, h.T[2]]), right = [-f[2], 0, f[0]];            // forward × up
  assert.ok(Math.abs(dot(rel, right) - 40) < 1e-9 && Math.abs(rel[1] - 6) < 1e-9 && Math.abs(dot(rel, f)) < 1e-9, `offset ${rel}`);
  assert.ok(dot(rel, h.L) < 0, 'on the right, against L');
  assert.ok(near(pose.target, h.pos) && near(pose.up, [0, 1, 0]));
});
test('chase: 25 m behind the head on the road, 3 m along the road\'s up, looking toward the head', () => {
  const { path: p } = track(), h = p.head, pose = C.poseFor('chase', { head: h, path: p }), e = C.sampleAt(p, h.s - 25);
  assert.ok(near(pose.eye, e.pos.map((x, i) => x + e.U[i] * 3), 1e-9));
  assert.ok(near(pose.up, e.U), 'it banks and pitches with the road');
  assert.ok(dot(unit(sub(pose.target, pose.eye)), e.T) > 0.9, 'it looks along the road');
});
test('chase through a loop-the-loop: the eye stays on the drivable side of the road the whole way round', () => {
  const p = G.buildPath(F.loopTheLoop());
  for (const s of p.samples.filter((x) => x.seg === 1)) {
    const pose = C.poseFor('chase', { head: s, path: p }), e = C.sampleAt(p, s.s - 25);
    assert.ok(dot(sub(pose.eye, e.pos), e.U) > 2.99, `at s ${s.s}`);
  }
});
test('chase on a track shorter than its lag: clamped to the start of the road, still a valid pose', () => {
  const segs = [{ id: 'a', kind: 'road', length: 10, profile: F.FLAT }], p = G.buildPath(segs), pose = C.poseFor('chase', { head: p.head, path: p });
  assert.ok(near(pose.eye, [p.samples[0].pos[0], p.samples[0].pos[1] + 3, p.samples[0].pos[2]]));
  assert.ok(len(sub(pose.target, pose.eye)) > 1e-3);
});
test('the switch key walks build → overhead → side → chase → free → build', () => {
  const { path: p } = track(), rig = C.createRig(), ctx = { head: p.head, path: p }, seen = [rig.mode];
  for (let i = 0; i < 5; i++) seen.push(rig.key('c', ctx));
  assert.deepEqual(seen, ['build', 'overhead', 'side', 'chase', 'free', 'build']);
});
test('the build view is ONE key away from every mode', () => {
  const { path: p } = track(), ctx = { head: p.head, path: p };
  for (const m of C.MODES) { const rig = C.createRig(); rig.setMode(m, ctx); assert.equal(rig.key('b', ctx), 'build', `from ${m}`); }
});
test('other keys change nothing', () => {
  const rig = C.createRig(); for (const k of ['x', 'Escape', ' ', 'B']) rig.key(k); assert.equal(rig.mode, 'build');
});
test('after an append every follow mode follows the new head; free does not move', () => {
  const segs = [{ id: 'a', kind: 'road', length: 40, profile: F.FLAT }], p = G.buildPath(segs);
  const before = {}; for (const m of ['build', 'overhead', 'side', 'chase']) before[m] = C.poseFor(m, { head: p.head, path: p });
  const rigF = C.createRig(); rigF.setMode('free', { head: p.head, path: p }); const f0 = rigF.pose({ head: p.head, path: p });
  G.extendPath(p, [...segs, { id: 'b', kind: 'road', length: 30, k0: 0.02, k1: 0.02, profile: F.FLAT }]);
  for (const m of ['build', 'overhead', 'side', 'chase']) {
    const after = C.poseFor(m, { head: p.head, path: p });
    assert.ok(len(sub(after.eye, before[m].eye)) > 5, `${m} moved with the head`);
    assert.deepEqual(after, C.poseFor(m, { head: G.buildPath([...segs, { id: 'b', kind: 'road', length: 30, k0: 0.02, k1: 0.02, profile: F.FLAT }]).head, path: p }), `${m} is the pose of the new head`);
  }
  assert.deepEqual(rigF.pose({ head: p.head, path: p }), f0, 'free stays where the user flew it');
});
test('entering free keeps the view; it flies and turns only in free mode; pitch stays within ±89°', () => {
  const { path: p } = track(), ctx = { head: p.head, path: p }, rig = C.createRig();
  assert.equal(rig.free.move(10, 0, 0), false, 'no flying in the build view');
  const b = rig.update(ctx, 0);
  rig.key('b', ctx); for (let i = 0; i < 4; i++) rig.key('c', ctx);
  assert.equal(rig.mode, 'free');
  const f = rig.pose(ctx);
  assert.ok(near(f.eye, b.eye, 1e-9) && dot(unit(sub(f.target, f.eye)), unit(sub(b.target, b.eye))) > 1 - 1e-9, 'the same view');
  assert.ok(rig.free.move(10, 0, 0)); assert.ok(Math.abs(len(sub(rig.pose(ctx).eye, f.eye)) - 10) < 1e-9);
  rig.free.look(0, 10); assert.ok(Math.abs(rig.free.state().pitch - 89 * Math.PI / 180) < 1e-12);
});
test('the shown pose eases toward the exact pose: no snap on a switch, and it converges', () => {
  const { path: p } = track(), ctx = { head: p.head, path: p }, rig = C.createRig();
  const a = rig.update(ctx, 0.016);
  rig.key('c', ctx);                                                       // → overhead, 80 m up
  const b = rig.update(ctx, 0.016), want = rig.pose(ctx);
  assert.ok(len(sub(b.eye, a.eye)) < 0.2 * len(sub(want.eye, a.eye)), 'the first frame after a switch moves only part of the way');
  let s = b; for (let i = 0; i < 400; i++) s = rig.update(ctx, 0.05);
  assert.ok(near(s.eye, want.eye, 1e-6) && near(s.target, want.target, 1e-6));
});
test('edges: a missing head, an unknown mode and a rig without the build view are refused', () => {
  assert.throws(() => C.poseFor('build', {}), /needs a head/);
  assert.throws(() => C.poseFor('orbit', { head: track().path.head }), /no follow pose/);
  assert.throws(() => C.createRig({ order: ['overhead', 'free'], start: 'overhead' }), /build view/);
  assert.throws(() => C.createRig().setMode('orbit'), /unknown mode/);
});

// D182: the build view FRAMES the road. T-180 roads are 31-37 m wide at the median and 67 m at the tight class's p90
// (FINDINGS §7f). Stated before the test: every point of a 67 m cross-section at the head, walls included, projects
// inside the view at the aspects 16:9, 1:1 and 9:16; the fixed 15 m / 6 m pose does NOT (so the test can fail); and a
// road narrow enough for 15 m / 6 m keeps exactly that pose.
const { fontProfile } = require('../../src/geom/fonts.js');
const { normalize, offsetAt, spanOf } = require('../../src/geom/profile.js');
/** Where p lands in the pose's view, as a fraction of the half-width (x) and half-height (y): inside when both ≤ 1. */
function inView(pose, aspect, p) {
  const f = unit(sub(pose.target, pose.eye)), cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const right = unit(cr(f, pose.up)), up = cr(right, f), d = sub(p, pose.eye), z = dot(d, f), t = Math.tan(pose.fov / 2);
  return { z, x: Math.abs(dot(d, right)) / (z * t * aspect), y: Math.abs(dot(d, up)) / (z * t) };
}
function wideRoad(width) {
  const prof = fontProfile('half-pipe', { width, wall: 8, psiL: 60 * Math.PI / 180, psiR: 60 * Math.PI / 180 });
  const segs = [{ id: 'w', kind: 'road', length: 120, k0: 0, k1: 1 / 300, profile: prof }], p = G.buildPath(segs), h = p.head, P = normalize(prof);
  const pts = P.u.map((u) => { const [X, Y] = offsetAt(P, u); return h.pos.map((v, k) => v + h.L[k] * X + h.U[k] * Y); });
  return { h, p, pts, span: spanOf(P) };
}

test('build view frames a 67 m road: every cross-section point at the head is in view at 16:9, 1:1 and 9:16', () => {
  const { h, p, pts, span } = wideRoad(67);
  assert.ok(span > 67, `the cross-section spans ${span} m with its walls`);
  for (const aspect of [16 / 9, 1, 9 / 16]) {
    const pose = C.createRig().pose({ head: h, path: p, width: span, aspect });
    for (const q of pts) { const v = inView(pose, aspect, q); assert.ok(v.z > 0 && v.x <= 1 && v.y <= 1, `aspect ${aspect.toFixed(2)}: ${JSON.stringify(v)}`); }
  }
});

test('build view: without the road\'s width, 15 m behind does NOT frame a 67 m road (what the framing fixes)', () => {
  const { h, p, pts } = wideRoad(67), pose = C.createRig().pose({ head: h, path: p, aspect: 16 / 9 });
  assert.ok(pts.some((q) => { const v = inView(pose, 16 / 9, q); return v.x > 1; }), 'some edge should be out of view');
});

test('build view: a road narrow enough keeps exactly 15 m behind and 6 m up; the backed-off view keeps the same angle', () => {
  const { path: p } = track(), h = p.head, rig = C.createRig();
  const narrow = sub(rig.pose({ head: h, path: p, width: 20, aspect: 16 / 9 }).eye, h.pos);
  assert.ok(Math.abs(dot(narrow, h.T) + 15) < 1e-9 && Math.abs(dot(narrow, h.U) - 6) < 1e-9, `${narrow}`);
  const wide = sub(rig.pose({ head: h, path: p, width: 67, aspect: 1 }).eye, h.pos);
  assert.ok(-dot(wide, h.T) > 15 && Math.abs(dot(wide, h.U) / -dot(wide, h.T) - 6 / 15) < 1e-12, `${wide}`);
});

test('the preview gives the build view the LAST road piece\'s span (a jump after it has no profile), and null with no road', () => {
  const { widthAtHead } = require(path.join(ADIR, 'preview', 'preview.js'));
  const wide = fontProfile('half-pipe', { width: 67, wall: 8, psiL: 1, psiR: 1 });
  const segs = [{ id: 'a', kind: 'road', length: 40, profile: F.FLAT }, { id: 'b', kind: 'road', length: 40, profile: wide }, { id: 'j', kind: 'gap', length: 81 }];
  assert.equal(widthAtHead(segs), spanOf(normalize(wide)));
  assert.equal(widthAtHead([{ id: 'j', kind: 'gap', length: 81 }]), null);
  assert.equal(widthAtHead([]), null);
});

test('the ghost (the first word before anything is placed) carries its segments, so the build view frames it too', () => {
  const TM = require(path.join(ADIR, 'preview', 'trackmodel.js')), tm = TM.createTrackModel();
  tm.update({ segments: [] });
  const g = tm.ghostFor({ segments: [{ id: 'b', kind: 'road', length: 40, profile: fontProfile('flat', { width: 67 }) }] });
  assert.equal(g.segments.length, 1);
});
