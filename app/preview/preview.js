// preview.js: the 3D preview in the app window. Thin DOM glue over the headless parts:
//   app/preview/trackmodel.js   the document → path + mesh, incrementally, in this (UI) process
//   app/preview/renderer.js     the batches → WebGL
//   app/camera/cameras.js       the build view (default), overhead, side, chase, free
//
//   const p = createPreview({ canvas, shell, win: window, hud, onMode })   shell = app/shell.js createShell(...)
//   p.setMode('overhead')   p.dispose()                  onMode(mode) is called whenever the camera mode changes
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

const FLY = { w: [1, 0, 0], s: [-1, 0, 0], d: [0, 1, 0], a: [0, -1, 0], e: [0, 0, 1], q: [0, 0, -1] };
const TURN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/** What a key does: { camera: 'c' | 'b' } for the switch keys, { fly: [fwd, right, up] } or { turn: [yaw, pitch] }. */
function keyAction(key) {
  const k = String(key).length === 1 ? String(key).toLowerCase() : String(key);
  if (k === KEYS.cycle || k === KEYS.build) return { camera: k };
  if (FLY[k]) return { fly: FLY[k] };
  if (TURN[k]) return { turn: TURN[k] };
  return null;
}

function createPreview({ canvas, shell, win, hud = null, onMode = null, flySpeed = 30, turnSpeed = 1.6 }) {
  if (!canvas || !shell || !win) throw new Error('preview: needs { canvas, shell, win }');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) throw new Error('preview: WebGL is not available in this window');
  const renderer = createRenderer(gl), model = createTrackModel(), rig = createRig();
  let track = null, err = null, raf = 0, prev = 0;
  const held = new Set();
  const refresh = (st) => { try { track = model.update(st.resolved); err = track.stale ? st.resolveError : null; } catch (e) { err = e.message; } };
  const unsub = shell.subscribe(refresh);
  refresh(shell.getState());
  const ctx = () => (track && track.path ? { head: track.path.head, path: track.path } : null);

  const said = () => { if (onMode) onMode(rig.mode); };
  const onKey = (e) => {
    if (e.target && typeof e.target.matches === 'function' && e.target.matches('input, select, textarea')) return;   // typing, not flying
    const a = keyAction(e.key); if (!a) return;
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
    const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c = ctx();
    if (c && w > 0 && h > 0) renderer.draw(track.batches, rig.update(c, dt), { width: w, height: h });
    if (hud) hud.textContent = `${rig.mode} view${err ? ` · ${err}` : ''}`;
  }
  raf = win.requestAnimationFrame(frame);
  said();
  return {
    rig, model, renderer,
    setMode(m) { const c = ctx(); if (m === 'free' && !c) return rig.mode; rig.setMode(m, c); said(); return rig.mode; },
    dispose() {
      win.cancelAnimationFrame(raf); unsub();
      win.removeEventListener('keydown', onKey); win.removeEventListener('keyup', onUp);
      canvas.removeEventListener('mousedown', onDown); win.removeEventListener('mousemove', onMove); win.removeEventListener('mouseup', onRelease);
      renderer.dispose();
    },
  };
}

module.exports = { createPreview, keyAction };
