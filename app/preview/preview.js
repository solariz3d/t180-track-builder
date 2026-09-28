// preview.js: the 3D preview in the app window. Thin DOM glue over the headless parts:
//   app/preview/trackmodel.js   the document → path + mesh, incrementally, in this (UI) process
//   app/preview/renderer.js     the batches → WebGL
//   app/camera/cameras.js       the build view (default), overhead, side, chase, free
//
//   const p = createPreview({ canvas, shell, win: window, hud, onMode })   shell = app/shell.js createShell(...)
//   p.setMode('overhead')   p.dispose()                  onMode(mode) is called whenever the camera mode changes
//   onTrack(t) is called after every change that moved the track, with the ONE shared path (trackmodel.js):
//       t = { path, segments, closed, how, g, fromS }   how: 'extend' | 'sculpt' | 'full' | 'empty'
//   p.track()   the same object for the current track, or null (for a reader that arrives later)
//
// KEYS (keyAction below, tested headless):  C  next camera      B  the build view, from anywhere
//   free mode:  W / S forward and back,  A / D left and right,  Q / E down and up,  arrow keys or a mouse drag turn,
//   Shift flies faster.
// No mesh data crosses Tauri IPC here (ARCHITECTURE §9): the geometry runs in this process and hands the renderer its
// own arrays.
'use strict';

const { createRig, KEYS } = require('../camera/cameras.js');
const { createTrackModel } = require('./trackmodel.js');
const { createRenderer } = require('./renderer.js');
const { gridLines, headMarker } = require('./look.js');

const FLY = { w: [1, 0, 0], s: [-1, 0, 0], d: [0, 1, 0], a: [0, -1, 0], e: [0, 0, 1], q: [0, 0, -1] };
const TURN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/**
 * What a key does: { camera: 'c' | 'b' } for the switch keys, { fly: [fwd, right, up] } or { turn: [yaw, pitch] }.
 * With Ctrl, Alt or Meta held a key belongs to the app or the system (Ctrl+C is copy), never to the camera: null.
 */
function keyAction(key, mods = {}) {
  if (mods && (mods.ctrlKey || mods.altKey || mods.metaKey)) return null;
  const k = String(key).length === 1 ? String(key).toLowerCase() : String(key);
  if (k === KEYS.cycle || k === KEYS.build) return { camera: k };
  if (FLY[k]) return { fly: FLY[k] };
  if (TURN[k]) return { turn: TURN[k] };
  return null;
}

function createPreview({ canvas, shell, win, hud = null, onMode = null, onTrack = null, flySpeed = 30, turnSpeed = 1.6 }) {
  if (!canvas || !shell || !win) throw new Error('preview: needs { canvas, shell, win }');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) throw new Error('preview: WebGL is not available in this window');
  const renderer = createRenderer(gl), model = createTrackModel(), rig = createRig();
  let track = null, err = null, raf = 0, prev = 0, shownPose = null;
  const held = new Set();
  let ghost = null, grid = null, gridFor = null;
  // a change to the placed track retires the ghost: it was built on the old head (the palette shows it again on hover)
  const shared = () => (track && track.how !== 'kept' ? { path: track.path, segments: track.segments, closed: !!(track.path && track.path.closed), how: track.how, g: track.g, fromS: track.fromS } : null);
  const refresh = (st) => {
    try { track = model.update(st.resolved); err = track.stale ? st.resolveError : null; if (track.how !== 'same' && track.how !== 'kept') ghost = null; } catch (e) { err = e.message; return; }
    if (onTrack && track.how !== 'same' && track.how !== 'kept') onTrack(shared());
  };
  const unsub = shell.subscribe(refresh);
  refresh(shell.getState());
  /** The camera's context: the head and path, the track's box (the overhead fit) and the view's aspect. With nothing
   *  placed yet but a ghost showing, the ghost's head and path stand in, so the first word can be previewed too. */
  const ctx = (aspect) => {
    if (track && track.path) return { head: track.path.head, path: track.path, bounds: track.bounds, aspect };
    if (ghost && ghost.path) return { head: ghost.head, path: ghost.path, bounds: null, aspect };
    return null;
  };

  const said = () => { if (onMode) onMode(rig.mode); };
  const onKey = (e) => {
    if (e.target && typeof e.target.matches === 'function' && e.target.matches('input, select, textarea')) return;   // typing, not flying
    const a = keyAction(e.key, e); if (!a) return;
    if (a.camera) { rig.key(a.camera, ctx()); said(); e.preventDefault(); return; }
    held.add(e.key.length === 1 ? e.key.toLowerCase() : e.key); if (rig.mode === 'free') e.preventDefault();
  };
  const onUp = (e) => held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  let drag = null;
  const onDown = (e) => { if (rig.mode === 'free') drag = [e.clientX, e.clientY]; };
  const onMove = (e) => { if (!drag) return; rig.free.look((e.clientX - drag[0]) * 0.004, -(e.clientY - drag[1]) * 0.004); drag = [e.clientX, e.clientY]; };
  const onRelease = () => { drag = null; };
  win.addEventListener('keydown', onKey); win.addEventListener('keyup', onUp);
  canvas.addEventListener('mousedown', onDown); win.addEventListener('mousemove', onMove); win.addEventListener('mouseup', onRelease);

  function frame(t) {
    raf = win.requestAnimationFrame(frame);
    const dt = prev ? Math.min(0.1, (t - prev) / 1000) : 0; prev = t;
    if (rig.mode === 'free') {
      const k = (held.has('Shift') ? 4 : 1) * flySpeed * dt;
      for (const h of held) { const a = keyAction(h); if (a && a.fly) rig.free.move(a.fly[0] * k, a.fly[1] * k, a.fly[2] * k); if (a && a.turn) rig.free.look(a.turn[0] * turnSpeed * dt, a.turn[1] * turnSpeed * dt); }
    }
    const { width: w, height: h } = backingSize(canvas.clientWidth, canvas.clientHeight, win.devicePixelRatio);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }   // follows DPR and resizes
    const c = ctx(w > 0 && h > 0 ? w / h : 0);
    if (c && w > 0 && h > 0) {
      const tb = track && track.bounds ? track.bounds : null;
      if (tb !== gridFor) { grid = gridLines(tb); gridFor = tb; }       // the grid follows the track's box, rebuilt only when it changes
      shownPose = rig.update(c, dt);
      renderer.draw(track && track.batches ? track.batches : [], shownPose, { width: w, height: h }, { grid, marker: headMarker(c.head, markerSize(shownPose, c.head)), ghost: ghost ? ghost.batches : null });
    }
    if (hud) hud.textContent = `${rig.mode} view${err ? ` · ${err}` : ''}`;
  }
  raf = win.requestAnimationFrame(frame);
  said();
  return {
    rig, model, renderer,
    /** What is on screen now, for the window proof (app/testhook/probe.js): read-only. */
    view: () => ({ track, pose: shownPose, mode: rig.mode, error: err, ghost: ghost ? ghost.batches.length : 0, grid: grid ? grid.positions.length / 6 : 0 }),
    track: () => shared(),
    /**
     * Show the GHOST of the next piece (the D170 review, item 6): `candidate` is the resolved document with the
     * word appended (A's shell: the same appendWord that place() uses, not committed). It is drawn see-through at the
     * head until clearGhost(), a new showGhost(), or any change to the placed track. Throws if the candidate does not
     * extend the placed track. Returns the number of batches shown.
     */
    showGhost(candidate) { ghost = model.ghostFor(candidate); return ghost.batches.length; },
    clearGhost() { ghost = null; },
    setMode(m) { const c = ctx(); if (m === 'free' && !c) return rig.mode; rig.setMode(m, c); said(); return rig.mode; },
    dispose() {
      win.cancelAnimationFrame(raf); unsub();
      win.removeEventListener('keydown', onKey); win.removeEventListener('keyup', onUp);
      canvas.removeEventListener('mousedown', onDown); win.removeEventListener('mousemove', onMove); win.removeEventListener('mouseup', onRelease);
      renderer.dispose();
    },
  };
}

/** The head marker's size: 3 m up close, growing with the camera's distance (2%) so it stays readable from overhead. */
const markerSize = (pose, head) => Math.max(3, 0.02 * Math.hypot(pose.eye[0] - head.pos[0], pose.eye[1] - head.pos[1], pose.eye[2] - head.pos[2]));

/**
 * The canvas backing store for a css size and a devicePixelRatio: round(css × dpr) per side, so the picture is sharp on
 * a scaled display. A missing or nonsense DPR counts as 1. A side never exceeds MAX_SIDE (a safe WebGL drawing-buffer
 * size); past it both sides scale down together, keeping the aspect.
 */
const MAX_SIDE = 8192;
function backingSize(cssW, cssH, dpr) {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  let w = Math.round(Math.max(0, cssW || 0) * d), h = Math.round(Math.max(0, cssH || 0) * d);
  const over = Math.max(w, h) / MAX_SIDE;
  if (over > 1) { w = Math.round(w / over); h = Math.round(h / over); }
  return { width: w, height: h };
}

module.exports = { createPreview, keyAction, backingSize, MAX_SIDE, markerSize };
