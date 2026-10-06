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
//   p.setTextureSet(set)    A's texture set (src/texture/set.js; the textures panel sends it as 't180:textures'), or null
//   p.pick(x, y)            the track station under a canvas point (css px): { s, pos, px } or null (D186: the brush)
//   p.setLook('ac' | 'words')   'ac' (the default): the AC shaders with the exported materials and textures
//                               (app/preview/aclook.js, acshaders.js); 'words': the D170 colour per placed word
//
// KEYS (keyAction below, tested headless):  C  next camera      B  the build view, from anywhere
//   L  the look: the AC shaders (default) or the colour per placed word (ARCHITECTURE §4's feedback layer)
//   flying:  W / S forward and back,  A / D left and right,  Q / E or Left Ctrl / Space down and up,  Shift sprints (×4, rising to ×20 over 2.5 s held). Movement is PER AXIS
//   (the keeper, D188): W/S, A/D and Q/E each resolve on their own, the NEWER key of an axis winning and the other taking over on its
//   release, and the axes combine, so W+D goes diagonally at the same speed as a straight line. From any view the first move takes the view over
//   into free mode, once (C and B after it are not undone by a key still held). Looking: the right-button drag (any view) or the left in free mode, or
//   the arrow keys; drag right turns right. Moving and looking work at the same time. The scroll wheel zooms every view (free mode
//   dollies); Ctrl + wheel is the LENS (the field of view, 10° to 100°, in every view) and a middle click resets it to 60°.
//   A text field swallows the camera keys; a number field lets them through; Enter or Esc in a field, or a click on the canvas, lets go of it.
//   D252 (the keeper: "space bar to go up, lft control to go down?"): Space and LEFT Ctrl, by the physical key (Right Ctrl does not fly). Left Ctrl
//   flies only while it is the ONLY key down and no mouse button is: when another key (Ctrl+Z/Y/S/Backspace), the wheel (Ctrl+wheel, the lens) or
//   a button (a handle drag, Ctrl to snap) joins it, that press's descent is undone, so a Ctrl shortcut never moves the camera. And it starts only
//   after Ctrl has been held ALONE for CTRL_HOLD_S (~200 ms, the chair's ruling): a shortcut pressed inside that window never dips the camera at
//   all, a deliberate hold still flies, and the undo is the backstop for a slower shortcut. Space is taken
//   (it never clicks a focused button) except in a text field, where it types.
//   No ground grid unless createPreview({ ground: true }): just the track (the keeper, 2026-09-29).
//   D237 (the keeper: "a 3D grid ... a 2D grid if the track has no height, but as soon as the track turns up or downward the grid becomes 3D", and symmetry): createPreview({ gridMode })
//   'auto' | 'ground' | '3d' | 'off' starts the grid in that mode (the app's mount asks for 'auto'; with neither gridMode nor ground the preview starts with NO grid, as before). At run time:
//   p.setGuides({ grid, mirror, centre })   grid: auto | ground | 3d | off;  mirror: off | x | z | both;  centre: { x, z } | null (the box's middle)
//   p.guides()                              what is asked and what is drawn: { grid, drawn, flat, range, mirror, centre, gap, lines, levels, spacing }
//   onGuides(state) is called whenever that changes; `layer` ({ update({ plan, pose, aspect, cssWidth, cssHeight }), dispose() }) draws the labels and the centre handle (app/preview/guideslayer.js).
//   app/preview/guides.js has the maths; none of it reads or writes the document or the export.
// No mesh data crosses Tauri IPC here (ARCHITECTURE §9): the geometry runs in this process and hands the renderer its
// own arrays.
'use strict';

const { createRig, KEYS, sampleAt } = require('../camera/cameras.js');
const { createTrackModel } = require('./trackmodel.js');
const { createRenderer } = require('./renderer.js');
const { gridLines, headMarker } = require('./look.js');
const { guidePlan, MODES: GRID_MODES, MIRRORS } = require('./guides.js');
const { resolveLook } = require('./aclook.js');
const { flowCell } = require('../../src/texture/flow.js');
const { FACTOR: DRAG_DETAIL } = require('./coarse.js');
const { previewTextures } = require('../../src/texture/set.js');
const { normalize, spanOf, readAt, offsetAt, psiAt } = require('../../src/geom/profile.js');
const M = require('../camera/math.js');

const FLY = { w: [1, 0, 0], s: [-1, 0, 0], d: [0, 1, 0], a: [0, -1, 0], e: [0, 0, 1], q: [0, 0, -1] };
const TURN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/**
 * What a key does: { camera: 'c' | 'b' } for the switch keys, { look: true } for L, { fly: [fwd, right, up] } or
 * { turn: [yaw, pitch] }.
 * With Ctrl, Alt or Meta held a key belongs to the app or the system (Ctrl+C is copy), never to the camera: null.
 */
function keyAction(key, mods = {}) {
  if (mods && (mods.ctrlKey || mods.altKey || mods.metaKey)) return null;
  const k = String(key).length === 1 ? String(key).toLowerCase() : String(key);
  if (k === KEYS.cycle || k === KEYS.build) return { camera: k };
  if (k === 'l') return { look: true };
  if (FLY[k]) return { fly: FLY[k] };
  if (TURN[k]) return { turn: TURN[k] };
  return null;
}

/** The held-key name of a key event: the physical key (e.code 'KeyW' → 'w'; arrows as they are), else e.key. */
function heldKey(e) {
  if (e && (e.code === 'Space' || e.code === 'ControlLeft')) return e.code;   // D252: the up and down keys, by the physical key
  if (e && typeof e.code === 'string' && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (e && typeof e.code === 'string' && /^Arrow/.test(e.code)) return e.code;
  const k = String(e && e.key); return k.length === 1 ? k.toLowerCase() : k;
}
// SHIFT'S SPRINT RAMPS (the keeper, 2026-09-29 06:22: "should go faster the longer you hold it down"): ×4 at the press, rising along a
// smoothstep to ×20 over 2.5 s held; ×1 the moment it is released, and reset when the window loses focus.
const BOOST = { from: 4, to: 20, secs: 2.5 };
function boostAt(t) { const u = Number.isFinite(t) ? Math.max(0, Math.min(1, t / BOOST.secs)) : 0; return BOOST.from + (BOOST.to - BOOST.from) * u * u * (3 - 2 * u); }

/** A field that takes TEXT swallows the camera keys (typing a name never moves the camera); a NUMBER field does not, so the camera flies while a value is edited. */
function swallowsKeys(t) { return !!t && typeof t.matches === 'function' && t.matches('input, select, textarea') && !t.matches('input[type="number"]'); }

function createPreview({ canvas, shell, win, hud = null, onMode = null, onTrack = null, flySpeed = 30, turnSpeed = 1.6, ground = false, gridMode = null, layer = null, onGuides = null }) {
  if (!canvas || !shell || !win) throw new Error('preview: needs { canvas, shell, win }');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) throw new Error('preview: WebGL is not available in this window');
  const renderer = createRenderer(gl), model = createTrackModel(), rig = createRig();
  let track = null, err = null, raf = 0, prev = 0, shownPose = null;
  const held = new Map();   // the keys down, in the order pressed: physical key (e.code) → its action, fixed at key-down
  let takeover = false;     // a movement key went down in a follow view: the next frame takes the view over into free (once)
  let ghost = null, grid = null, gridFor = null, start = null, proposalShown = null;
  // D237: the 3D grid and the symmetry guides. `gMode` 'legacy' is the old { ground: true } grid at y = 0; the plan is rebuilt only when its inputs change, never per frame.
  if (gridMode !== null && !GRID_MODES.includes(gridMode)) throw new Error(`preview: unknown gridMode ${gridMode}`);
  let gMode = gridMode || (ground ? 'legacy' : 'off'), gMirror = 'off', gCentre = null, plan = null, planDeps = null;
  const guidesState = () => ({
    grid: gMode === 'legacy' ? 'ground' : gMode, drawn: plan && plan.mode !== 'off' ? plan.mode : gMode === 'legacy' && grid ? 'ground' : 'off', flat: plan ? plan.flat : null, range: plan ? plan.range : null,
    mirror: gMirror, centre: plan && plan.centre ? { x: plan.centre.x, z: plan.centre.z, set: plan.centre.set } : gCentre ? { x: gCentre.x, z: gCentre.z, set: true } : null,
    gap: plan ? plan.gap : null, lines: plan ? plan.lines : 0, levels: plan ? plan.levels.length : 0, spacing: plan ? plan.spacing : null,
  });
  const sayGuides = () => { if (onGuides) onGuides(guidesState()); };
  let set = null, images = [], look = 'ac', resolved = null, resolvedFor = null;
  // the look is resolved again only when the scene's materials or the set change, never per frame
  const lookFor = (scene) => { if (resolvedFor !== scene.materials) { resolved = resolveLook(scene, set, images); resolvedFor = scene.materials; } return resolved; };
  // D228: a textured EQUATION-CORE cell's coordinates run on the path's own arc length (src/texture/flow.js), the same coordinates the export writes.
  // Batches whose uvs are unchanged keep the very same array (the renderer keeps a GPU buffer per array), so an edit re-uploads only the new pieces.
  let flowMemo = new WeakMap(), flowSet = null, flowTrack = null, flowOut = null;
  const batchesFor = (tr) => {
    if (!tr || !tr.batches) return [];
    if (!set || look !== 'ac' || !tr.mesh) return tr.batches;
    if (flowTrack === tr.batches && flowSet === set) return flowOut;
    if (flowSet !== set) flowMemo = new WeakMap();
    const kids = tr.mesh.scene.root.children;   // batches, cells and the root's children are in one order; mesh names repeat, so position is the key
    flowOut = tr.batches.map((b, k) => {
      const cell = tr.mesh.cells[k]; if (!cell) return b;
      let u = flowMemo.get(b.uvs);
      if (u === undefined) { u = flowCell(tr.mesh, tr.segments, set, cell, kids[k].children[0]); flowMemo.set(b.uvs, u); }
      return u ? { ...b, uvs: u } : b;
    });
    flowTrack = tr.batches; flowSet = set;
    return flowOut;
  };
  // a change to the placed track retires the ghost: it was built on the old head (the palette shows it again on hover)
  const shared = () => (track && track.how !== 'kept' ? { path: track.path, segments: track.segments, closed: !!(track.path && track.path.closed), how: track.how, g: track.g, fromS: track.fromS } : null);
  // D235 (the keeper: "make the changes render faster while you change it from one to the next"): while a brush drag is open (state.brush) the model meshes a COARSER
  // preview (app/preview/coarse.js: a closed tube's brush step is about 3× cheaper), and full detail comes back FULL_AFTER_MS after the drag ends, once, unless another
  // drag starts first. Nothing here touches what is exported: the model's detail changes the preview's mesh only, and the shell's resolved state is the export's.
  const FULL_AFTER_MS = 250; let fullTimer = 0;
  const clearFull = () => { if (fullTimer) { (win.clearTimeout || clearTimeout)(fullTimer); fullTimer = 0; } };
  const scheduleFull = () => { clearFull(); fullTimer = (win.setTimeout || setTimeout)(() => { fullTimer = 0; model.setDetail(1); refresh(shell.getState()); }, FULL_AFTER_MS); if (fullTimer && fullTimer.unref) fullTimer.unref(); };
  const refresh = (st) => {
    start = st.resolved && st.resolved.start ? st.resolved.start : null;   // where the first piece starts (the equation core's doc.start)
    if (st.brush) { clearFull(); model.setDetail(DRAG_DETAIL); } else if (model.detail > 1) scheduleFull();   // dragging: coarse now; not dragging but still coarse: full detail soon
    try { track = model.update(st.resolved); err = track.stale ? st.resolveError : null; if (track.how !== 'same' && track.how !== 'kept') ghost = null; } catch (e) { err = e.message; return; }
    // D242: a close PROPOSAL (the core shell's closeProposal, for the document on screen) is the ghost: the pieces it moves, see-through over the placed ones
    // D240: a middle DELETE's preview (the core shell's deleteProposal) is shown the same way: the track as it would be, see-through over the placed one
    const propOf = (p) => (p && st.history && p.base === st.history.present ? p : null), prop = propOf(st.closeProposal) || propOf(st.deleteProposal);
    if (prop !== proposalShown) {
      if (ghost && ghost.proposal) ghost = null;
      proposalShown = prop;
      if (prop) { try { ghost = { ...model.proposalGhost(prop.resolved), proposal: true }; } catch (e) { ghost = null; } }
    }
    if (onTrack && track.how !== 'same' && track.how !== 'kept') onTrack(shared());
  };
  const unsub = shell.subscribe(refresh);
  refresh(shell.getState());
  /** The camera's context: the head and path, the track's box (the overhead fit) and the view's aspect. With nothing
   *  placed yet but a ghost showing, the ghost's head and path stand in, so the first word can be previewed too. With
   *  NOTHING placed and no ghost, the track's START stands in (D195): before it, the context was null there, so no frame
   *  drew, the view froze, and the wheel and keys pressed meanwhile were applied late, when a ghost first appeared (the
   *  keeper, 2026-09-30 02:56: "very laggy ... until the first piece is put down"). */
  const ctx = (aspect) => {
    if (track && track.path) return { head: track.path.head, path: track.path, bounds: track.bounds, aspect, width: widthAtHead(track.segments) };
    if (ghost && ghost.path) return { head: ghost.head, path: ghost.path, bounds: null, aspect, width: widthAtHead(ghost.segments) };
    const head = startHead(start);
    return { head, path: { samples: [head] }, bounds: null, aspect, width: null };
  };

  const said = () => { if (onMode) onMode(rig.mode); };
  // D252: SPACE up, LEFT CTRL down (see KEYS at the top). `down` is every physical key down, camera key or not; `ctrlFly` is Left Ctrl's press while it
  // flies ({ mode: the view it found, moved: metres descended, wait: seconds still to hold alone before it descends }), 'spoiled' once something
  // joined it (no descent for the rest of that press).
  const down = new Set(), UP = Object.freeze({ fly: [0, 0, 1] }), DOWN = Object.freeze({ fly: [0, 0, -1] }), CTRL_HOLD_S = 0.2;
  let buttons = 0, ctrlFly = null;
  /** Something joined Left Ctrl: stop its descent and UNDO it, so a Ctrl shortcut (or the lens, or a snapped handle drag) leaves the camera where it was. */
  const spoilCtrl = () => {
    if (!ctrlFly || ctrlFly === 'spoiled') return;
    const f = ctrlFly; ctrlFly = 'spoiled'; held.delete('ControlLeft');
    if (rig.mode === 'free' && f.moved) rig.free.move(0, 0, f.moved);
    if (f.mode !== 'free') { takeover = false; if (rig.mode === 'free') { rig.setMode(f.mode, ctx()); said(); } }
  };
  const onKey = (e) => {
    if (typeof e.code === 'string' && e.code) { if (e.code !== 'ControlLeft') spoilCtrl(); down.add(e.code); }
    boost = !!e.shiftKey;   // Shift is the sprint: read on every key-down, typing included
    // ENTER or ESC in a field lets go of it, so the camera keys work again (Enter in a text area is a new line: left alone)
    if ((e.key === 'Enter' || e.key === 'Escape') && e.target && typeof e.target.blur === 'function' && typeof e.target.matches === 'function'
      && e.target.matches(e.key === 'Enter' ? 'input, select' : 'input, select, textarea')) { e.target.blur(); return; }
    if (swallowsKeys(e.target)) return;   // typing, not flying
    if (e.code === 'Space') {   // D252: up, and TAKEN, so a focused button is not clicked (a Ctrl/Alt/Meta+Space is not a move)
      if (!(e.ctrlKey || e.altKey || e.metaKey)) { if (!held.has('Space')) held.set('Space', UP); if (!e.repeat) takeover = true; }
      e.preventDefault(); return;
    }
    if (e.code === 'ControlLeft') {   // D252: down, only as the ONLY key down with no mouse button
      if (!e.repeat) { if (down.size === 1 && !buttons && !e.altKey && !e.metaKey) { ctrlFly = { mode: rig.mode, moved: 0, wait: CTRL_HOLD_S }; } else ctrlFly = 'spoiled'; }   // it descends once held alone for CTRL_HOLD_S (the frame loop)
      return;
    }
    const a = keyAction(e.key, e); if (!a) return;
    if (a.camera) { takeover = false; rig.key(a.camera, ctx()); said(); e.preventDefault(); return; }
    if (a.look) { look = look === 'ac' ? 'words' : 'ac'; e.preventDefault(); return; }
    const id = heldKey(e); if (!held.has(id)) held.set(id, a);   // a repeat of a held key keeps its place in the order
    if (!e.repeat) takeover = true;   // an OS key-REPEAT of a key already held is not a new move: after C or B it must not take the view back
    e.preventDefault();
  };
  // HELD KEYS are keyed by the PHYSICAL key (e.code), so a key pressed as 'w' and released as 'W' (Shift in between) still
  // lets go; and every held key is dropped when the window loses focus or is hidden, since the key-up then never arrives.
  // That lost key-up was the camera that kept flying forward by itself (the keeper, 2026-09-29).
  const onUp = (e) => {
    held.delete(heldKey(e)); boost = !!e.shiftKey; down.delete(e.code);
    if (e.code === 'ControlLeft') ctrlFly = null;   // a descent that ran alone is kept
    if (e.code === 'Space' && !swallowsKeys(e.target)) e.preventDefault();   // D252: a button clicks on the key-UP of Space too
  };
  const letGo = () => { held.clear(); takeover = false; boost = false; boostT = 0; drag = null; down.clear(); buttons = 0; ctrlFly = null; };
  const onVis = () => { if (win.document && win.document.hidden) letGo(); };
  let boost = false, boostT = 0;   // Shift is down; and for how long (s)
  // MOUSE LOOK: the right button drags the look from any view (it takes the view over into free); the left button does in
  // free mode (outside it, the left button is the brush's). Keys and the mouse work at the same time.
  let drag = null;
  const onDown = (e) => {
    const ae = win.document && win.document.activeElement;   // a click on the canvas takes focus off a field (a preventDefault below would keep it)
    if (ae && ae !== win.document.body && typeof ae.blur === 'function') ae.blur();
    if (e.button === 1) { rig.resetLens(); e.preventDefault(); return; }   // the middle click: the lens back to 60°
    if (e.button === 2 || (e.button === 0 && rig.mode === 'free')) {
      if (rig.mode !== 'free') { const c = ctx(); if (!c) return; rig.setMode('free', c); said(); }
      drag = [e.clientX, e.clientY]; e.preventDefault();
    }
  };
  const onMove = (e) => { if (!drag) return; rig.free.look((e.clientX - drag[0]) * 0.004, -(e.clientY - drag[1]) * 0.004); drag = [e.clientX, e.clientY]; };
  const onRelease = () => { drag = null; buttons = 0; };
  const onAnyDown = () => { buttons = 1; spoilCtrl(); };   // D252: any button anywhere (a handle drag included) joins Left Ctrl
  const onAnyUp = () => { buttons = 0; };   // D252 follow-up (C's finding 5): a handle's preventDefault on pointerdown suppresses the compatibility mousedown, so a press is read from pointerdown too
  const noMenu = (e) => e.preventDefault();
  // THE SCROLL WHEEL zooms every view: a follow view comes nearer or backs off, free mode flies along its view. CTRL + WHEEL is the
  // LENS instead (rig.lens: the field of view; the camera does not move).
  // deltaX counts only when Shift turned the wheel sideways: a trackpad's sideways swipe (deltaX, no Shift) is not a zoom, nor a lens
  const onWheel = (e) => { spoilCtrl(); const steps = -Math.sign(e.deltaY || (e.shiftKey ? e.deltaX : 0) || 0) * (e.shiftKey ? 4 : 1); if (steps) { if (e.ctrlKey) rig.lens(steps); else rig.zoom(steps); } e.preventDefault(); };
  win.addEventListener('keydown', onKey); win.addEventListener('keyup', onUp); win.addEventListener('blur', letGo);
  if (win.document) win.document.addEventListener('visibilitychange', onVis);
  canvas.addEventListener('mousedown', onDown); win.addEventListener('mousemove', onMove); win.addEventListener('mouseup', onRelease); win.addEventListener('mousedown', onAnyDown, true); win.addEventListener('pointerdown', onAnyDown, true); win.addEventListener('pointerup', onAnyUp, true);
  canvas.addEventListener('contextmenu', noMenu); canvas.addEventListener('wheel', onWheel, { passive: false });

  function frame(t) {
    raf = win.requestAnimationFrame(frame);
    const dt = prev ? Math.min(0.1, (t - prev) / 1000) : 0; prev = t;
    const sprint = boost ? boostAt(boostT) : 1; boostT = boost ? boostT + dt : 0;   // the speed THIS frame, then one more frame of Shift held
    // D252: Left Ctrl held ALONE for CTRL_HOLD_S starts descending now (and takes the view over, as any move key does); a shortcut inside the window never gets here
    if (ctrlFly && ctrlFly !== 'spoiled' && ctrlFly.wait > 0) { ctrlFly.wait -= dt; if (ctrlFly.wait <= 1e-9) { ctrlFly.wait = 0; held.set('ControlLeft', DOWN); takeover = true; } }
    if (takeover) { if (rig.mode === 'free') takeover = false; else { const c0 = ctx(); if (c0) { rig.setMode('free', c0); said(); takeover = false; } } }   // the first move from a view takes it over, ONCE: C and B after it stay
    if (rig.mode === 'free') {
      const k = sprint * flySpeed * dt;
      // MOVEMENT IS PER AXIS (the keeper, 2026-09-29 13:05: "say I am W forward, then I press D, it should go diagonally"). `held` is in the order
      // pressed, so on each of forward/back, right/left and up/down the LAST key seen is the NEWER and wins; a key-up hands the axis to the other.
      // The axes combine and the direction is normalised, so a diagonal is 1.0× a straight line. The look keys all turn.
      const dir = [0, 0, 0];
      for (const a of held.values()) {
        if (a.fly) for (let i = 0; i < 3; i++) if (a.fly[i]) dir[i] = a.fly[i];
        if (a.turn) rig.free.look(a.turn[0] * turnSpeed * dt, a.turn[1] * turnSpeed * dt);
      }
      const n = Math.hypot(dir[0], dir[1], dir[2]);
      if (n) rig.free.move(dir[0] / n * k, dir[1] / n * k, dir[2] / n * k);
      if (n && ctrlFly && ctrlFly !== 'spoiled' && held.has('ControlLeft')) ctrlFly.moved -= dir[2] / n * k;   // D252: what Left Ctrl descended, to undo if something joins it
    }
    const { width: w, height: h } = backingSize(canvas.clientWidth, canvas.clientHeight, win.devicePixelRatio);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }   // follows DPR and resizes
    const c = ctx(w > 0 && h > 0 ? w / h : 0);
    if (c && w > 0 && h > 0) {
      const tb = track && track.bounds ? track.bounds : null;
      if (gMode !== 'legacy') grid = null;   // no ground: just the track, so the camera goes anywhere with nothing to clip (the keeper, 2026-09-29): the legacy { ground: true } grid only
      else if (tb !== gridFor) { grid = gridLines(tb); gridFor = tb; }       // the grid follows the track's box, rebuilt only when it changes
      // D237: the plan (the 3D grid, the axes, the mirror ghost) follows the track's box and centreline, the mode, the mirror and the centre, and is rebuilt only when one of them changes
      const pathNow = track && track.path ? track.path : null, deps = planDeps;
      if (!deps || deps.tb !== tb || deps.path !== pathNow || deps.mode !== gMode || deps.mirror !== gMirror || deps.cx !== (gCentre && gCentre.x) || deps.cz !== (gCentre && gCentre.z)) {
        planDeps = { tb, path: pathNow, mode: gMode, mirror: gMirror, cx: gCentre && gCentre.x, cz: gCentre && gCentre.z };
        plan = tb ? guidePlan({ bounds: tb, path: pathNow, mode: gMode === 'legacy' ? 'off' : gMode, mirror: gMirror, centre: gCentre }) : null;
        sayGuides();
      }
      shownPose = rig.update(c, dt);
      const L = look === 'ac' && track && track.mesh ? lookFor(track.mesh.scene) : null;
      renderer.draw(batchesFor(track), shownPose, { width: w, height: h }, { grid, marker: headMarker(c.head, markerSize(shownPose, c.head), clearanceAtHead(track && track.path ? track.segments : ghost && ghost.segments)), ghost: ghost ? ghost.batches : null, overlay: plan && plan.over.length ? plan.over : null, depthLines: plan ? plan.depth : null,
        look, materialOf: L ? L.materialOf : null, textures: L ? L.textures : null });
      if (layer) layer.update({ plan, pose: shownPose, aspect: w / h, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight });
    }
    if (hud) hud.textContent = `${rig.mode} view · ${look === 'ac' ? 'AC look' : 'word colours'} (L)${rig.fov !== rig.fovDefault ? ` · fov ${Math.round(rig.fov * 180 / Math.PI)}°` : ''}${err ? ` · ${err}` : ''}`;
  }
  raf = win.requestAnimationFrame(frame);
  said();
  return {
    rig, model, renderer,
    /** What is on screen now, for the window proof (app/testhook/probe.js): read-only. */
    view: () => ({ track, detail: model.detail, pose: shownPose, mode: rig.mode, error: err, ghost: ghost ? ghost.batches.length : 0, grid: grid ? grid.positions.length / 6 : 0, guides: guidesState(), look, textures: images.length }),
    track: () => shared(),
    /** What each placed batch is drawn with, in the 'ac' look: { materialOf, textures } (aclook.js resolveLook). */
    lookNow: () => (track && track.mesh ? lookFor(track.mesh.scene) : null),
    setTextureSet(s) { set = s || null; images = set ? previewTextures(set) : []; resolvedFor = null; return images.length; },
    setLook(l) { if (l !== 'ac' && l !== 'words') throw new Error(`preview: unknown look ${l}`); look = l; return look; },
    /** D237: the grid mode, the mirror and the centre of the symmetry guides (each optional): grid auto | ground | 3d | off, mirror off | x | z | both, centre { x, z } or null for the box's middle. */
    setGuides({ grid: g, mirror: m, centre: c } = {}) {
      if (g !== undefined && !GRID_MODES.includes(g)) throw new Error(`preview: unknown grid mode ${g}`);
      if (m !== undefined && !MIRRORS.includes(m)) throw new Error(`preview: unknown mirror ${m}`);
      if (c !== undefined && c !== null && !(Number.isFinite(c.x) && Number.isFinite(c.z))) throw new Error('preview: the centre needs { x, z } in metres, or null');
      if (g !== undefined) gMode = g; if (m !== undefined) gMirror = m; if (c !== undefined) gCentre = c === null ? null : { x: c.x, z: c.z };
      planDeps = null; sayGuides(); return guidesState();
    },
    guides: guidesState,
    /**
     * Show the GHOST of the next piece (the D170 review, item 6): `candidate` is the resolved document with the
     * word appended (A's shell: the same appendWord that place() uses, not committed). It is drawn see-through at the
     * head until clearGhost(), a new showGhost(), or any change to the placed track. Throws if the candidate does not
     * extend the placed track. Returns the number of batches shown.
     */
    showGhost(candidate) { ghost = model.ghostFor(candidate); if (candidate && candidate.jump) ghost.jump = true; return ghost.batches.length; },   // D243: a candidate JUMP says so, so the drag handles stay off it
    clearGhost() { ghost = null; },
    /** D244, the drag handles: the ghost of the next piece as { samples, s0 }: the path's samples (the placed track's, then the new piece's) and the s where the new piece starts (the placed track's end). Null when there is no ghost, or it is a close or delete PREVIEW (those are not Extend's). */
    ghostInfo() { if (!ghost || ghost.proposal || !ghost.path) return null; const tp = track && track.path; return { samples: ghost.path.samples, segments: ghost.segments, jump: !!ghost.jump, s0: tp && tp.samples.length ? tp.samples[tp.samples.length - 1].s : 0 }; },
    /**
     * D242: show a place on the track: the camera goes to free mode above and behind the station at `s` (m along the placed track; a closed lap's s
     * wraps), looking at it. A click on a red in a list calls this. Returns false when there is no track to look at.
     */
    focus(s) {
      const p = track && track.path; if (!p || !Number.isFinite(s) || !p.samples.length) return false;
      const L = p.lengthM || p.samples[p.samples.length - 1].s, x = p.closed && L > 0 ? ((s % L) + L) % L : Math.max(0, Math.min(L, s)), m = sampleAt(p, x);
      const eye = [0, 1, 2].map((k) => m.pos[k] + m.U[k] * 35 - m.T[k] * 45);
      const c = ctx(canvas.clientWidth > 0 && canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1.6); if (rig.mode !== 'free' && c) rig.setMode('free', c);
      const ok = rig.free.lookFrom(eye, m.pos.slice()); said(); return ok;
    },
    /** D186: the track station under a point of the canvas (css px from its top-left): { s, pos, px } or null (pickAt). */
    pick(x, y) { return shownPose && track && track.path ? pickAt(track.path, shownPose, x, y, canvas.clientWidth, canvas.clientHeight) : null; },
    setMode(m) { const c = ctx(); if (m === 'free' && !c) return rig.mode; rig.setMode(m, c); said(); return rig.mode; },
    dispose() {
      win.cancelAnimationFrame(raf); clearFull(); unsub(); if (layer) layer.dispose();
      win.removeEventListener('keydown', onKey); win.removeEventListener('keyup', onUp); win.removeEventListener('blur', letGo);
      if (win.document) win.document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('mousedown', onDown); win.removeEventListener('mousemove', onMove); win.removeEventListener('mouseup', onRelease); win.removeEventListener('mousedown', onAnyDown, true); win.removeEventListener('pointerdown', onAnyDown, true); win.removeEventListener('pointerup', onAnyUp, true);
      canvas.removeEventListener('contextmenu', noMenu); canvas.removeEventListener('wheel', onWheel);
      renderer.dispose();
    },
  };
}

/**
 * THE PICK (D186, the brush on the preview): the path station drawn nearest the canvas point (x, y), css px from the top-left,
 * for a view `w` × `h` css px under `pose` (the matrices the renderer draws with, app/camera/math.js viewProj). Stations behind
 * the camera are skipped. Returns { s, pos, px } (px: its distance on screen), or null when none lies within `maxPx`.
 */
function pickAt(path, pose, x, y, w, h, maxPx = 40) {
  if (!(w > 0 && h > 0)) return null;
  const VP = M.viewProj(pose, w / h); let best = null;
  for (const m of path.samples) {
    const c = M.apply(VP, m.pos); if (!(c[3] > 0)) continue;
    const sx = (c[0] / c[3] * 0.5 + 0.5) * w, sy = (1 - (c[1] / c[3] * 0.5 + 0.5)) * h, d = Math.hypot(sx - x, sy - y);
    if (d <= maxPx && (!best || d < best.px)) best = { s: m.s, pos: m.pos.slice(), px: d };
  }
  return best;
}

/** The road's span at the head (m): the last road segment's cross-section (profile.js spanOf), for the build view's framing. */
function widthAtHead(segments) {
  for (let i = (segments || []).length - 1; i >= 0; i--) if (segments[i] && segments[i].profile) return spanOf(readAt(segments[i], segments[i].length));   // at the HEAD: the end of the last segment (a cup's segments carry a blend)
  return null;
}

/**
 * THE ROOM INSIDE A CLOSED TUBE at the head (D225, E's seal X2 ii), for the head marker: { up, lat } in metres, or null when the section
 * at the head does not close (any open road, an open tube, a cup: the marker is drawn at its full size as before). A section CLOSES when
 * both edges have turned to 180° (a tube of sweep 360: E's §1, ψ edge = t/2). `up` is 0.9 of the lower edge tip's height above the floor
 * (the roof, 2R for a circle), `lat` 0.9 of the section's widest reach to either side (R for a circle), both read from the profile the
 * mesh draws there (profile.js readAt, offsetAt), so they hold for whatever closed shape the core builds.
 */
function clearanceAtHead(segments) {
  for (let i = (segments || []).length - 1; i >= 0; i--) {
    const g = segments[i]; if (!g || !g.profile) continue;
    const P = readAt(g, g.length), uL = Math.max(...P.u), uR = Math.min(...P.u);
    if (!(psiAt(P, uL) >= Math.PI - 1e-6 && psiAt(P, uR) >= Math.PI - 1e-6)) return null;
    let lat = 0; for (let k = 1; k <= 64; k++) for (const u of [uL * k / 64, uR * k / 64]) lat = Math.max(lat, Math.abs(offsetAt(P, u)[0]));
    return { up: 0.9 * Math.min(offsetAt(P, uL)[1], offsetAt(P, uR)[1]), lat: 0.9 * lat };
  }
  return null;
}

/**
 * THE HEAD OF AN EMPTY TRACK (D195): where its first piece will start, `start` = { pos, theta, p } (the equation core's doc.start,
 * as src/geom buildPath takes it), or the origin, heading 0, level when there is none (buildPath's own default). The frame is the
 * geometry's gravity frame at zero roll (src/geom/path.js): T = (cos p sin θ, sin p, cos p cos θ), L = (cos θ, 0, −sin θ),
 * U = T × L; so it is the frame the first piece's first sample will have, before anything is placed.
 */
function startHead(start) {
  const s = { pos: [0, 0, 0], theta: 0, p: 0, ...(start || {}) }, th = s.theta, p = s.p;
  const T = [Math.cos(p) * Math.sin(th), Math.sin(p), Math.cos(p) * Math.cos(th)], L = [Math.cos(th), 0, -Math.sin(th)];
  const U = [T[1] * L[2] - T[2] * L[1], T[2] * L[0] - T[0] * L[2], T[0] * L[1] - T[1] * L[0]];
  return { s: 0, seg: 0, pos: s.pos.slice(), T, L, U };
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

module.exports = { createPreview, keyAction, boostAt, backingSize, MAX_SIDE, markerSize, widthAtHead, clearanceAtHead, pickAt, startHead };
