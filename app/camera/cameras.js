// cameras.js: the preview's cameras, with no DOM and no GL, so they run headless under node --test and unchanged in the
// webview. The keeper, 2026-09-27 12:20: "the perspective can be like looking forward where you are placing the track
// as it grows, maybe even different camera angles too or free came mode with the mode that looks in the direction the
// track is being built".
//
//   MODES, in the order the switch key walks them:
//     build     THE DEFAULT. Behind and above the build head, looking along the growth direction T, following the head.
//               It is src/geom's own headCamera (path.js), so the camera and the geometry agree on the head's frame.
//     overhead  straight down on the head, the growth direction pointing up the screen
//     side      level with the head, off its right side, looking at it
//     chase     riding the road itself `lag` metres behind the head, in the road's frame (through loops and banking),
//               looking along the road toward the head
//     free      flown by the user; it starts where the previous camera was, and does NOT follow the head
//
//   const rig = createRig();
//   rig.key('c')               the switch key: the next mode (free → build closes the cycle)
//   rig.key('b')               the build view, from any mode, in one key
//   rig.pose(ctx)              the exact pose for ctx = { head, path, width?, aspect? } ({ eye, target, up, fov }), no smoothing
//   rig.update(ctx, dt)        the pose shown this frame, eased toward rig.pose(ctx) (no snap on a mode switch)
//   rig.free.move(fwd, right, up)   rig.free.look(dYaw, dPitch)     only in free mode (dYaw + turns RIGHT on screen)
//   rig.zoom(steps)            the scroll wheel, + nearer: a follow view scales its distance (kept per mode), free dollies
//
// `head` is path.head (src/geom/path.js buildHead): { s, pos, T, L, U } with L = U × T, u + = left. `path` is needed
// only by chase (it reads the road behind the head).
//
// THE BUILD VIEW FRAMES THE ROAD (D182: T-180 roads are 31-37 m wide at the median and 67 m at the tight p90, FINDINGS
// §7f). `width` is the cross-section's span at the head (src/geom/profile.js spanOf). The build view keeps its 15 m / 6 m
// on a narrow road and backs off, at the same angle, until the whole width sits inside FRAME of the view's half-width:
// the edges pos ± L·width/2 lie at depth back·k along the view direction, k = (2 + r²) / √(4 + r²) with r = up / back
// (the eye is at −T·back + U·up, looking at +T·back), so back ≥ (width / 2) / (FRAME · tan(fov / 2) · aspect · k).
// With no aspect known, 1 is assumed (a square view, the narrowest the window is given), so the road is never cut off.
'use strict';

const { headCamera } = require('../../src/geom/index.js');

const MODES = Object.freeze(['build', 'overhead', 'side', 'chase', 'free']);
const KEYS = Object.freeze({ cycle: 'c', build: 'b' });
const DEFAULTS = Object.freeze({
  build: { back: 15, up: 6 },                   // the geometry's own headCamera defaults (path.js)
  overhead: { height: 80 },
  side: { dist: 40, height: 6 },
  chase: { lag: 25, height: 3, lookAhead: 25 },
  fov: 60 * Math.PI / 180,
  rate: 8,                                       // 1/s: the ease toward the target pose (≈ 95% in 0.37 s)
});
const WORLD_UP = [0, 1, 0];
const FRAME = 0.85;   // the road's edges sit inside 85% of the view's half-width
const ZOOM = Object.freeze({ step: 1.15, min: 0.05, max: 50, freeStep: 4 });   // one wheel notch: ×1.15 nearer; in free, 4 m

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return l > 0 ? mul(a, 1 / l) : null; };
const horiz = (a) => unit([a[0], 0, a[2]]);
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));

function checkHead(head) {
  if (!head || ![head.pos, head.T, head.L, head.U].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)))
    throw new Error('camera: needs a head { pos, T, L, U } (src/geom/path.js buildHead)');
}
/**
 * The growth direction on the ground. T's horizontal part while the road is not near vertical; inside a loop, where T
 * is (nearly) vertical, the direction the loop is heading, L × up, which stays level through the inversion.
 */
function groundForward(head) {
  const t = [head.T[0], 0, head.T[2]];
  if (len(t) > 0.1) return unit(t);
  return horiz(cross(head.L, WORLD_UP)) || [0, 0, 1];
}
/** The path sample at arc length s (clamped to the path), interpolated; frames re-normalised. */
function sampleAt(path, s) {
  const S = path.samples, a = Math.max(S[0].s, Math.min(S[S.length - 1].s, s));
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= a) lo = m; else hi = m; }
  const A = S[lo], B = S[hi], t = B.s > A.s ? (a - A.s) / (B.s - A.s) : 0;
  return { s: a, pos: lerp(A.pos, B.pos, t), T: unit(lerp(A.T, B.T, t)), U: unit(lerp(A.U, B.U, t)) };
}

/**
 * OVERHEAD, FIT TO THE WHOLE TRACK (the D170 review, item 2). Straight down over the centre of the track's world
 * box, the growth direction still up the screen. The box's 8 corners are measured along the screen's up (f) and right
 * axes; the eye rises until both half-extents fit the field of view (with 8% margin) at the depth of the box's TOP, the
 * nearest any vertex can be. Every vertex of the box then lands inside the view (app/test/look.test.js projects them).
 * `far` covers the box's bottom.
 */
function fitOverhead(bounds, aspect, f, fov, zoom = 1, head = null) {
  const c = [(bounds.min[0] + bounds.max[0]) / 2, 0, (bounds.min[2] + bounds.max[2]) / 2], r = cross(f, WORLD_UP);
  let hf = 0, hr = 0;
  for (let i = 0; i < 8; i++) {
    const p = [i & 1 ? bounds.max[0] : bounds.min[0], 0, i & 4 ? bounds.max[2] : bounds.min[2]], d = sub(p, c);
    hf = Math.max(hf, Math.abs(dot(d, f))); hr = Math.max(hr, Math.abs(dot(d, r)));
  }
  const t = Math.tan(fov / 2), dist = Math.max(hf / t, hr / (t * aspect), 10) * 1.08 * zoom;
  // ZOOMED IN, THE VIEW SLIDES FROM THE BOX CENTRE TO THE HEAD (L130-R, measured): the box centre of a curved or closed track is off the
  // road, and a view shrunk around it holds no road (a black preview). With w = min(1, zoom) the centre lies w of the way from the head to
  // the box centre: at zoom ≥ 1 it is the box centre (the whole track, unchanged), and the head's offset from the view's centre is
  // ≤ w·(its offset in the box) ≤ zoom·hf, inside the view's half-extent 1.08·zoom·hf, so the head is in view at every zoom.
  const w = head ? Math.min(1, zoom) : 1, ex = head ? head.pos[0] + (c[0] - head.pos[0]) * w : c[0], ez = head ? head.pos[2] + (c[2] - head.pos[2]) * w : c[2];
  const eye = [ex, bounds.max[1] + dist, ez];
  return { eye, target: [ex, bounds.min[1], ez], up: f, fov, far: dist + (bounds.max[1] - bounds.min[1]) + 100 };
}

/**
 * The exact pose of a follow mode for a head (and a path, for chase). Free mode's pose is the rig's own state.
 * `bounds` (the track's world box) and `aspect` (width / height of the view) switch overhead to fit the whole track.
 */
/** The build view's offsets for a road `width` m wide: the defaults, or backed off at the same angle to frame it. */
function buildOffsets(o, width, fov, aspect) {
  if (!(Number.isFinite(width) && width > 0)) return o;
  const r = o.up / o.back, k = (2 + r * r) / Math.sqrt(4 + r * r), a = aspect > 0 ? aspect : 1;
  const back = Math.max(o.back, (width / 2) / (FRAME * Math.tan(fov / 2) * a * k));
  return { back, up: back * r };
}

/** `zoom` (the scroll wheel, rig.zoom) scales each follow view's distance: < 1 nearer, > 1 farther. */
function poseFor(mode, { head, path, bounds, aspect, width, zoom = 1 } = {}, opts = DEFAULTS) {
  checkHead(head);
  const fov = opts.fov || DEFAULTS.fov, z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  if (mode === 'build') {
    const o = buildOffsets(opts.build || DEFAULTS.build, width, fov, aspect), c = headCamera(head, { back: o.back * z, up: o.up * z });
    return { eye: c.eye, target: c.target, up: c.up, fov };
  }
  if (mode === 'overhead') {
    const o = opts.overhead || DEFAULTS.overhead, f = groundForward(head);
    if (bounds && aspect > 0) return fitOverhead(bounds, aspect, f, fov, z, head);
    return { eye: add(head.pos, mul(WORLD_UP, o.height * z)), target: head.pos.slice(), up: f, fov };   // no bounds: over the head
  }
  if (mode === 'side') {
    const o = opts.side || DEFAULTS.side, right = cross(groundForward(head), WORLD_UP);   // forward × up = right
    return { eye: add(add(head.pos, mul(right, o.dist * z)), mul(WORLD_UP, o.height * z)), target: head.pos.slice(), up: WORLD_UP.slice(), fov };
  }
  if (mode === 'chase') {
    if (!path || !Array.isArray(path.samples) || !path.samples.length) throw new Error('camera: chase needs the path');
    const oc = opts.chase || DEFAULTS.chase, o = { ...oc, lag: oc.lag * z, height: oc.height * z }, e = sampleAt(path, head.s - o.lag), t = sampleAt(path, Math.min(head.s, e.s + o.lookAhead));
    let target = add(t.pos, mul(t.U, o.height / 3));
    if (len(sub(target, add(e.pos, mul(e.U, o.height)))) < 1e-6) target = add(target, e.T);   // a path shorter than nothing
    return { eye: add(e.pos, mul(e.U, o.height)), target, up: e.U, fov };
  }
  throw new Error(`camera: no follow pose for mode "${mode}"`);
}

function createRig({ order = MODES, keys = KEYS, opts = DEFAULTS, start = 'build' } = {}) {
  if (!order.includes('build')) throw new Error('camera: the build view must be one of the modes');
  if (!order.includes(start)) throw new Error(`camera: unknown start mode "${start}"`);
  let mode = start, shown = null;
  const zooms = Object.fromEntries(order.map((m) => [m, 1]));   // each view keeps its own zoom while you visit the others
  const free = { eye: [0, 10, -20], yaw: 0, pitch: 0 };
  const freeDir = () => [Math.cos(free.pitch) * Math.sin(free.yaw), Math.sin(free.pitch), Math.cos(free.pitch) * Math.cos(free.yaw)];
  const freePose = () => ({ eye: free.eye.slice(), target: add(free.eye, freeDir()), up: WORLD_UP.slice(), fov: opts.fov || DEFAULTS.fov });
  /** Entering free mode: take over the pose on screen (or the last exact one), so the view does not jump. */
  function enterFree(from) {
    const d = unit(sub(from.target, from.eye)) || [0, 0, 1];
    free.eye = from.eye.slice(); free.pitch = Math.asin(Math.max(-1, Math.min(1, d[1]))); free.yaw = Math.atan2(d[0], d[2]);
  }
  let lastExact = null;
  const rig = {
    get mode() { return mode; },
    modes: () => order.slice(),
    /** A key press: the switch key cycles, the build key returns to the build view. Other keys change nothing. */
    key(k, ctx) {
      const was = mode;
      if (k === keys.build) mode = 'build';
      else if (k === keys.cycle) mode = order[(order.indexOf(mode) + 1) % order.length];
      if (mode === 'free' && was !== 'free') enterFree(shown || lastExact || (ctx && ctx.head ? poseFor('build', ctx, opts) : freePose()));
      return mode;
    },
    setMode(m, ctx) { if (!order.includes(m)) throw new Error(`camera: unknown mode "${m}"`); const was = mode; mode = m; if (m === 'free' && was !== 'free') enterFree(shown || lastExact || poseFor('build', ctx, opts)); return mode; },
    pose(ctx) {
      if (ctx) ctx = { ...ctx, zoom: zooms[mode] };
      const p = mode === 'free' ? freePose() : poseFor(mode, ctx, opts); lastExact = p; return p; },
    /** The pose shown this frame: eased toward the exact pose (free mode is flown directly, not eased). */
    update(ctx, dt) {
      const want = rig.pose(ctx);
      if (!shown || mode === 'free') { shown = { ...want, eye: want.eye.slice(), target: want.target.slice(), up: want.up.slice() }; return shown; }
      const k = 1 - Math.exp(-(opts.rate || DEFAULTS.rate) * Math.max(0, Math.min(0.1, dt)));
      shown = { eye: lerp(shown.eye, want.eye, k), target: lerp(shown.target, want.target, k), up: unit(lerp(shown.up, want.up, k)) || want.up, fov: want.fov, far: want.far };
      return shown;
    },
    /** The scroll wheel: `steps` notches, + nearer. A follow view scales its distance (returns its zoom factor); free
     *  mode flies along its view instead (returns 1). */
    zoom(steps) {
      if (!Number.isFinite(steps) || steps === 0) return mode === 'free' ? 1 : zooms[mode];
      if (mode === 'free') { rig.free.move(steps * ZOOM.freeStep, 0, 0); return 1; }
      zooms[mode] = Math.max(ZOOM.min, Math.min(ZOOM.max, zooms[mode] * Math.pow(ZOOM.step, -steps)));
      return zooms[mode];
    },
    zoomOf: (m = mode) => zooms[m],
    free: {
      /** Fly in the camera's own frame (metres): forward along the view, right, and world up. */
      move(fwd = 0, right = 0, up = 0) {
        if (mode !== 'free') return false;
        const d = freeDir(), r = unit(cross(d, WORLD_UP)) || [1, 0, 0];
        free.eye = add(add(add(free.eye, mul(d, fwd)), mul(r, right)), mul(WORLD_UP, up)); return true;
      },
      /** Turn the view (radians): dYaw + turns RIGHT on screen, dPitch + looks up; the pitch stays within ±89° so up never
       *  flips. (yaw + swings the view toward +x, which is screen LEFT here (math.js lookAt), hence the minus.) */
      look(dYaw = 0, dPitch = 0) {
        if (mode !== 'free') return false;
        const lim = 89 * Math.PI / 180; free.yaw -= dYaw; free.pitch = Math.max(-lim, Math.min(lim, free.pitch + dPitch)); return true;
      },
      state: () => ({ eye: free.eye.slice(), yaw: free.yaw, pitch: free.pitch }),
    },
  };
  return rig;
}

module.exports = { MODES, KEYS, DEFAULTS, ZOOM, createRig, poseFor, groundForward, sampleAt, fitOverhead };
