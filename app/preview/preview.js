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
//   p.setTextureSet(set, kind)   with the surface the panel has CHOSEN: 'asphalt' or 'solid' draw the SIGIL surface (below), 'image' (the user's picture) draws the set;
//                           with no kind (a set handed over by anything else) the set is drawn as before
//   p.pick(x, y)            the track station under a canvas point (css px): { s, pos, px } or null (D186: the brush)
//   p.setLook('ac' | 'words')   'ac' (the default): the AC shaders with the exported materials and textures
//                               (app/preview/aclook.js, acshaders.js); 'words': the D170 colour per placed word
//
// KEYS (keyAction below, tested headless):  C  next camera      B  the build view, from anywhere
//   L  the look: the AC shaders (default) or the colour per placed word (ARCHITECTURE §4's feedback layer)
//   flying:  W / S forward and back,  A / D left and right,  Q / E or Left Ctrl / Space down and up,  Shift sprints (×4, rising to ×20 over 2.5 s held). Movement is PER AXIS
//   (reported, D188): W/S, A/D and Q/E each resolve on their own, the NEWER key of an axis winning and the other taking over on its
//   release, and the axes combine, so W+D goes diagonally at the same speed as a straight line. From any view the first move takes the view over
//   into free mode, once (C and B after it are not undone by a key still held). Looking: the RIGHT-button drag, in every view (D255, reported: "right click
//   turn only, left click will be used for clicking things": the left button never turns the camera; it is the pieces', the handles' and the brush's), or
//   the arrow keys; drag right turns right. Moving and looking work at the same time. The scroll wheel zooms every view (free mode
//   dollies); Ctrl + wheel is the LENS (the field of view, 10° to 100°, in every view) and a middle click resets it to 60°.
//   A text field swallows the camera keys; a number field lets them through; Enter or Esc in a field, or a click on the canvas, lets go of it.
//   D252 (reported: "space bar to go up, lft control to go down?"): Space and LEFT Ctrl, by the physical key (Right Ctrl does not fly). Left Ctrl
//   flies down TOGETHER with the movement keys (W A S D, Q E, Space, Shift, the arrows) and a RIGHT-button look drag (D257, reported: "cant even click drag
//   look around and go down"); Ctrl+Space nets zero. Only a SHORTCUT key (one app/core/keys.js acts on with Ctrl: Z, Y, S, Backspace), the wheel (Ctrl+wheel,
//   the lens) or a LEFT-button press (a handle drag, Ctrl to snap) stops it, and that press's descent is undone, so a Ctrl shortcut leaves the camera where it was. It descends
//   INSTANTLY, like Space (D255, reported: "space works instantly to go up, but control lags before going down": D252's 200 ms hold is removed;
//   a shortcut's brief dip is accepted, and undone when its key joins). Space is taken
//   (it never clicks a focused button) except in a text field, where it types.
//   No ground grid unless createPreview({ ground: true }): just the track (reported, 2026-09-29).
//   D237 (reported: "a 3D grid ... a 2D grid if the track has no height, but as soon as the track turns up or downward the grid becomes 3D", and symmetry): createPreview({ gridMode })
//   'auto' | 'ground' | '3d' | 'off' starts the grid in that mode (the app's mount asks for 'auto'; with neither gridMode nor ground the preview starts with NO grid, as before). At run time:
//   p.setGuides({ grid, mirror, centre })   grid: auto | ground | 3d | off;  mirror: off | x | z | both;  centre: { x, z } | null (the box's middle)
//   p.guides()                              what is asked and what is drawn: { grid, drawn, flat, range, mirror, centre, gap, lines, levels, spacing }
//   onGuides(state) is called whenever that changes; `layer` ({ update({ plan, pose, aspect, cssWidth, cssHeight }), dispose() }) draws the labels and the centre handle (app/preview/guideslayer.js).
//   app/preview/guides.js has the maths; none of it reads or writes the document or the export.
// No mesh data crosses Tauri IPC here (ARCHITECTURE §9): the geometry runs in this process and hands the renderer its
// own arrays.
'use strict';

const { createRig, KEYS, sampleAt } = require('../camera/cameras.js');
const { createTrackModel, washOf } = require('./trackmodel.js');
const { createRenderer, themeFrom } = require('./renderer.js');
const { tokensOf } = require('../lib/tokens.js');
const { gridLines, headMarker, linesFor, tangentsFor } = require('./look.js');
const { guidePlan, MODES: GRID_MODES, MIRRORS } = require('./guides.js');
const { resolveLook } = require('./aclook.js');
const { flowCell } = require('../../src/texture/flow.js');
const { previewTextures } = require('../../src/texture/set.js');
const { normalize, sealed, spanOf, readAt, offsetAt, psiAt } = require('../../src/geom/profile.js');
const M = require('../camera/math.js');
const { keyAction: shortcutOf } = require('../core/keys.js');   // D257: what Ctrl+key does in the app (undo, redo, save, remove the head): the keys that stop Left Ctrl
const { acrossAt } = require('../core/zonegrab.js');   // D519 Part 2: a point on the road's surface across it

// the Sigil surface's one material and its 2×2 texture (warm near-black; the lighting does the rest)
const SIGIL_TEX = 't180_sigil_surface';
const SIGIL_MAT = Object.freeze({ name: 't180_sigil', shader: 'ksPerPixel', alphaTested: false, samplers: [{ name: 'txDiffuse', slot: 0, texture: SIGIL_TEX }],
  props: [{ name: 'ksAmbient', value: [0.9] }, { name: 'ksDiffuse', value: [1.5] }, { name: 'ksSpecular', value: [0.06] }, { name: 'ksSpecularEXP', value: [28] }, { name: 'ksEmissive', value: [0, 0, 0] }, { name: 'ksAlphaRef', value: [0] }] });
const SIGIL_LOOK = Object.freeze({ materialOf: () => SIGIL_MAT, textures: new Map([[SIGIL_TEX, { width: 2, height: 2, rgba: new Uint8Array([17, 14, 11, 255, 17, 14, 11, 255, 17, 14, 11, 255, 17, 14, 11, 255]) }]]) });

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
// SHIFT'S SPRINT RAMPS (reported, 2026-09-29 06:22: "should go faster the longer you hold it down"): ×4 at the press, rising along a
// smoothstep to ×20 over 2.5 s held; ×1 the moment it is released, and reset when the window loses focus.
const BOOST = { from: 4, to: 20, secs: 2.5 };
function boostAt(t) { const u = Number.isFinite(t) ? Math.max(0, Math.min(1, t / BOOST.secs)) : 0; return BOOST.from + (BOOST.to - BOOST.from) * u * u * (3 - 2 * u); }

/** A field that takes TEXT swallows the camera keys (typing a name never moves the camera); a NUMBER field does not, so the camera flies while a value is edited. */
function swallowsKeys(t) { return !!t && typeof t.matches === 'function' && t.matches('input, select, textarea') && !t.matches('input[type="number"]'); }

// D336: how long a held key may go with no keydown at all, while one should be repeating, before it is let go. Windows' slowest key-repeat waits 1 s before the
// first repeat and then repeats every 400 ms, so 1.5 s never drops a key really held there; a lost key-up then stops within 1.5 s instead of never.
const HELD_NET_MS = 1500;
function createPreview({ canvas, shell, win, hud = null, onMode = null, onTrack = null, flySpeed = 30, turnSpeed = 1.6, ground = false, gridMode = null, layer = null, onGuides = null, heldNetMs = HELD_NET_MS, onInputLate = null, hover = null }) {
  if (!canvas || !shell || !win) throw new Error('preview: needs { canvas, shell, win }');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) throw new Error('preview: WebGL is not available in this window');
  const renderer = createRenderer(gl), model = createTrackModel(), rig = createRig();
  // D381: the 3D view's sky, fog, road lines and grid are the skin's (app/lib/tokens.js); read again when <html data-theme> changes, drawn on the next frame
  const tokens = tokensOf(win), skin = () => renderer.setTheme(themeFrom(tokens)), unskin = tokens.onChange(skin); skin();
  // D384: the skin's sky drifts in time, and holds still at t = 0 under prefers-reduced-motion (read each frame, so a change in the system setting is seen)
  let still = null;
  try { still = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { still = null; }
  const skyTime = (t) => (still && still.matches ? 0 : t / 1000);
  let track = null, err = null, raf = 0, prev = 0, shownPose = null;
  const held = new Map();   // the keys down, in the order pressed: physical key (e.code) → its action, fixed at key-down
  let takeover = false;     // a movement key went down in a follow view: the next frame takes the view over into free (once)
  let ghost = null, ghostJob = null, grid = null, gridFor = null, start = null, proposalShown = null;
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
  // THE SIGIL SURFACE (2026-10-14): until a picture is chosen for the road, the preview draws every batch with ONE material, a dark warm surface that the
  // AC lighting shades (so turns, banks and walls still read) under the bone edge lines. Only the preview: the export writes the chosen surface as ever
  let sigil = false;
  const lookFor = (scene) => { if (resolvedFor !== scene.materials) { resolved = sigil ? SIGIL_LOOK : resolveLook(scene, set, images); resolvedFor = scene.materials; } return resolved; };
  // D228: a textured EQUATION-CORE cell's coordinates run on the path's own arc length (src/texture/flow.js), the same coordinates the export writes.
  // Batches whose uvs are unchanged keep the very same array (the renderer keeps a GPU buffer per array), so an edit re-uploads only the new pieces.
  let flowMemo = new WeakMap(), flowSet = null, flowTrack = null, flowOut = null, dragFor = null, dragFlow = null, dragOut = null;
  const batchesFor = (tr) => {
    if (!tr || !tr.batches) return [];
    // D421 part 4: a sculpt drag's frame is the placed batches with its window hidden and the road after it moved (trackmodel.js dragFrame); the textured copy of the
    // placed batches goes through the same composition, once per frame the drag changes
    if (tr.drag) { const fb = batchesFor(tr.drag.base); if (dragFor !== tr || dragFlow !== fb) { dragOut = fb === tr.drag.base.batches ? tr.batches : tr.drag.compose(fb); dragFor = tr; dragFlow = fb; } return dragOut; }
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
  // D235 (reported: "make the changes render faster while you change it from one to the next"): while a brush drag is open (state.brush) the model meshes a COARSER
  // preview (app/preview/coarse.js: a closed tube's brush step is about 3× cheaper), and full detail comes back FULL_AFTER_MS after the drag ends, once, unless another
  // drag starts first. Nothing here touches what is exported: the model's detail changes the preview's mesh only, and the shell's resolved state is the export's.
  const FULL_AFTER_MS = 250; let fullTimer = 0;
  const clearFull = () => { if (fullTimer) { (win.clearTimeout || clearTimeout)(fullTimer); fullTimer = 0; } };
  const scheduleFull = () => { clearFull(); fullTimer = (win.setTimeout || setTimeout)(() => { fullTimer = 0; model.setDetail(1); refresh(shell.getState()); }, FULL_AFTER_MS); if (fullTimer && fullTimer.unref) fullTimer.unref(); };
  // D421 part 4 (CHANGED from D235's coarse rebuild while dragging): while a brush drag is open the model draws the drag's FRAME from the placed track (trackmodel.js
  // dragFrame: the window as a chord ghost, the road after it moved as one piece, nothing placed rebuilt), and when the drag ends the exact road is built in the NEXT
  // animation frame, never in the pointer-up handler; the drag's last frame stays on show until then, so nothing blinks. A model that cannot draw a step that way (no
  // full-detail track to start from, a close or a new start) builds it as before.
  let exactDue = null;   // the state whose exact build the next frame does
  // D421c: that build A SLICE AT A TIME (a whole-lap re-close after a sculpt release meshes a 10 km lap again: about 200 ms, which held one frame). The model's update as steps
  // (trackmodel.js updateSteps: the very work update() does, the model's state changed only at its end), then the new batches' road lines and tangents made ahead (look.js keeps
  // them by the batch's arrays, so the frame that first draws the road does not make them all), EXACT_SLICE_MS a frame, the drag's last frame on show meanwhile. A new drag
  // arriving first finishes it at once; any other state change waits for it. With no clock (a test's window) it is all done in one frame, as before.
  const EXACT_SLICE_MS = 3;
  let exactJob = null;   // { st, it, built, list, k }
  function stepExact(all = false) {
    const job = exactJob, t0 = all ? null : clockNow();
    for (;;) {
      if (!job.built) {
        let r; try { r = job.it.next(); } catch (e) { exactJob = null; refreshNow(job.st); return; }   // the geometry failed part way: as update() failing, the state is built (and fails) the plain way, its error shown
        if (r.done) { job.built = r.value; job.list = r.value.batches || []; }
      }
      else if (job.k < job.list.length) { const b = job.list[job.k++]; linesFor(b); if (b.uvs && b.normals && b.indices) tangentsFor(b); }
      else {
        exactJob = null;
        // a state that changed while this was built (an undo, an edit just after a release) supersedes it: it is not published, and the newer state gets its own sliced build
        // from the one just made (P's D421c review, item 3: it was published first and the newer state built whole in one frame)
        if (exactDue && exactDue !== job.st) { const n = exactDue; exactDue = null; startExact(n); return; }
        exactDue = null; refreshNow(job.st, job.built); return;
      }
      if (t0 !== null && clockNow() - t0 >= EXACT_SLICE_MS) return;
    }
  }
  // a sliced build of state st, begun now (its first slice this frame)
  function startExact(st) { try { exactJob = { st, it: model.updateSteps(st.resolved), built: null, list: null, k: 0 }; } catch (e) { exactJob = null; refreshNow(st); return; } stepExact(); }
  // any other state with no drag open: the model's first step now. A build that does not yield (a placement, a sculpt, an undo, the same document) is whole at once and shown
  // this frame, as before; one that yields is a full rebuild (opening a long track: 19.7 km meshed in about 1.7 s), and the rest of it is built a slice a frame, the stage
  // showing what it showed until it lands, the HUD saying the road is being built
  function startBuild(st) {
    let it, r;
    try { it = model.updateSteps(st.resolved); r = it.next(); } catch (e) { refreshNow(st); return; }   // the geometry failed: built (and failing) the plain way, its error shown
    if (r.done) { refreshNow(st, r.value); return; }
    exactJob = { st, it, built: null, list: null, k: 0, building: true }; stepExact();
  }
  const refresh = (st) => {
    if (exactJob) { if (!st.brush) { exactDue = st; return; } while (exactJob) stepExact(true); }   // a new drag: the exact road first (and any build chained after it), then its frame
    if (!st.brush && track && track.how === 'drag') { exactDue = st; return; }   // the release: the exact road in the next frame
    exactDue = null;
    if (!st.brush) { startBuild(st); return; }
    refreshNow(st);
  };
  const refreshNow = (st, built = null) => {
    start = st.resolved && st.resolved.start ? st.resolved.start : null;   // where the first piece starts (the equation core's doc.start)
    if (!st.brush && model.detail > 1) scheduleFull();   // still coarse (a detail set by a caller): full detail soon
    try { track = built || model.update(st.resolved, st.brush ? { drag: st.brush } : undefined); err = track.stale ? st.resolveError : null; if (track.how !== 'same' && track.how !== 'kept') ghost = null; if (track.how !== 'same' && track.how !== 'kept') ghostJob = null; } catch (e) { err = e.message; return; }   // D407: and the exact ghost being built for the old head goes with it
    if (track.how === 'drag') return;   // a drag's frame moves nothing the shared track's readers keep: they hear the exact road when the drag ends
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
  refreshNow(shell.getState());   // the state the preview is mounted on is built at once, as before; only the changes after it are built a slice a frame
  /** The camera's context: the head and path, the track's box (the overhead fit) and the view's aspect. With nothing
   *  placed yet but a ghost showing, the ghost's head and path stand in, so the first word can be previewed too. With
   *  NOTHING placed and no ghost, the track's START stands in (D195): before it, the context was null there, so no frame
   *  drew, the view froze, and the wheel and keys pressed meanwhile were applied late, when a ghost first appeared (as
   *  reported 2026-09-30 02:56: "very laggy ... until the first piece is put down"). */
  const ctx = (aspect) => {
    if (track && track.path) return { head: track.path.head, path: track.path, bounds: track.bounds, aspect, width: widthAtHead(track.segments) };
    if (ghost && ghost.path) return { head: ghost.head, path: ghost.path, bounds: null, aspect, width: widthAtHead(ghost.segments) };
    const head = startHead(start);
    return { head, path: { samples: [head] }, bounds: null, aspect, width: null };
  };

  const said = () => { if (onMode) onMode(rig.mode); };
  // D252: SPACE up, LEFT CTRL down (see KEYS at the top). `down` is every physical key down, camera key or not; `ctrlFly` is Left Ctrl's press while it
  // flies ({ mode: the view it found, moved: metres descended }), 'spoiled' once something joined it (no descent for the rest of that press).
  const down = new Set(), UP = Object.freeze({ fly: [0, 0, 1] }), DOWN = Object.freeze({ fly: [0, 0, -1] });
  let buttons = 0, ctrlFly = null;   // buttons: the LEFT button is down (D257: a right-button look drag flies with Left Ctrl)
  const shortcutDown = new Set();   // D257: shortcut keys down (Z, Y, S, Backspace): Left Ctrl does not start while one is
  const isShortcut = (e) => !!shortcutOf({ key: e.key, ctrlKey: true, shiftKey: !!e.shiftKey });
  const onlyLeftCtrl = (e) => !!e.ctrlKey && down.has('ControlLeft') && !down.has('ControlRight') && !e.altKey && !e.metaKey;
  /** Something joined Left Ctrl: stop its descent and UNDO it, so a Ctrl shortcut (or the lens, or a snapped handle drag) leaves the camera where it was. */
  const spoilCtrl = () => {
    if (!ctrlFly || ctrlFly === 'spoiled') return;
    const f = ctrlFly; ctrlFly = 'spoiled'; held.delete('ControlLeft');
    if (rig.mode === 'free' && f.moved) rig.free.move(0, 0, f.moved);
    // the view back only when Ctrl ALONE took it over (D257: a W held with it is a flight of its own)
    if (f.mode !== 'free' && ![...held.keys()].some((k) => k !== 'ControlLeft')) { takeover = false; if (rig.mode === 'free') { rig.setMode(f.mode, ctx()); said(); } }
  };
  // D336, THE SAFETY NET: a held key whose key-up the page never gets (any path, known or not) is let go. While a key is held the OS repeats the LAST key pressed,
  // so as long as no key has been released since the last fresh press, SOME keydown keeps arriving; when none at all arrives for heldNetMs, the key-up was lost.
  // Once any key is released the OS repeats nothing (the keys still held go silent, legitimately), so the net does not act until the next fresh press.
  let quietMs = 0, expectRepeat = false;
  // D340, LATE INPUT, an instrument for the real window: the camera "coasts ... for like 3 seconds till it stops" after its keys are let go, which a headless page
  // does not reproduce (every key-up reached it within 3 ms under load). Each key event is checked as it is handled against the time the OS stamped it
  // (e.timeStamp, the page's own clock): one handled more than LATE_MS late is kept (view().inputLate, the last LATE_KEEP) and said in the HUD for LATE_SHOW_MS,
  // with what the page was doing meanwhile, from its own frame times: 'page busy' when the frames stopped for most of the delay (the page's main thread was
  // late), 'host late' when they kept coming (the page was free; the event arrived late from WebView2 or the OS). It changes nothing the keys do.
  const LATE_MS = 250, LATE_KEEP = 20, LATE_SHOW_MS = 8000;
  const inputLate = [], frameTimes = []; let lateShown = null, frameDropped = -Infinity;   // frameDropped: the newest frame time trimmed from frameTimes
  const clockNow = () => (win.performance && typeof win.performance.now === 'function' ? win.performance.now() : null);
  const checkLate = (e, type) => {
    const now = clockNow(); if (now === null || !(e && e.timeStamp > 0)) return;
    const late = now - e.timeStamp; if (!(late > LATE_MS)) return;
    let gap = 0, from = frameDropped > e.timeStamp ? frameDropped : null;   // the longest stretch with no frame between the stamp and now (frames trimmed after the stamp count as drawn)
    for (const t of frameTimes) { if (t <= e.timeStamp) { from = e.timeStamp; continue; } gap = Math.max(gap, t - (from === null ? e.timeStamp : from)); from = t; }
    gap = Math.max(gap, now - (from === null ? e.timeStamp : from));
    const rec = { type, code: e.code || String(e.key), lateMs: Math.round(late), longestFrameGapMs: Math.round(gap), cause: gap > late / 2 ? 'page busy' : 'host late', at: Math.round(now) };
    inputLate.push(rec); if (inputLate.length > LATE_KEEP) inputLate.shift();
    lateShown = { rec, until: now + LATE_SHOW_MS };
    if (onInputLate) { try { onInputLate({ ...rec }); } catch (x) { console.warn(`preview: the late-input log failed: ${x && x.message || x}`); } }   // D340: and to disk (app/core/inputlog.js), through the mount
  };
  const onKey = (e) => {
    checkLate(e, 'keydown');
    quietMs = 0; if (!e.repeat) expectRepeat = true;   // any keydown at all re-confirms the held keys
    if (typeof e.code === 'string' && e.code) { if (isShortcut(e)) { shortcutDown.add(e.code); spoilCtrl(); } down.add(e.code); }   // D257: only a SHORTCUT stops Left Ctrl
    boost = !!e.shiftKey;   // Shift is the sprint: read on every key-down, typing included
    // ENTER or ESC in a field lets go of it, so the camera keys work again (Enter in a text area is a new line: left alone)
    if ((e.key === 'Enter' || e.key === 'Escape') && e.target && typeof e.target.blur === 'function' && typeof e.target.matches === 'function'
      && e.target.matches(e.key === 'Enter' ? 'input, select' : 'input, select, textarea')) { e.target.blur(); return; }
    if (swallowsKeys(e.target)) return;   // typing, not flying
    if (e.code === 'Space') {   // D252: up, and TAKEN, so a focused button is not clicked (a Ctrl/Alt/Meta+Space is not a move, except with LEFT Ctrl flying: D257)
      if (!(e.ctrlKey || e.altKey || e.metaKey) || onlyLeftCtrl(e)) { if (!held.has('Space')) held.set('Space', UP); if (!e.repeat) takeover = true; }
      e.preventDefault(); return;
    }
    if (e.code === 'ControlLeft') {   // D252: down; D257: with the movement keys and a right-button look too, but not with a shortcut key or the LEFT button down
      if (!e.repeat) { if (!shortcutDown.size && !buttons && !e.altKey && !e.metaKey) { ctrlFly = { mode: rig.mode, moved: 0 }; held.set('ControlLeft', DOWN); takeover = true; } else ctrlFly = 'spoiled'; }   // D255: at once, like Space
      return;
    }
    // D257: with LEFT Ctrl held, a movement key still flies or turns (its Ctrl-free action), never a shortcut, a camera switch or the look
    const viaCtrl = onlyLeftCtrl(e) && !isShortcut(e), a = keyAction(e.key, viaCtrl ? { ctrlKey: false, altKey: false, metaKey: false } : e); if (!a) return;
    if (viaCtrl && !a.fly && !a.turn) return;
    if (a.camera) { takeover = false; rig.key(a.camera, ctx()); said(); e.preventDefault(); return; }
    if (a.look) { look = look === 'ac' ? 'words' : 'ac'; e.preventDefault(); return; }
    const id = heldKey(e); if (!held.has(id)) held.set(id, a);   // a repeat of a held key keeps its place in the order
    if (!e.repeat) takeover = true;   // an OS key-REPEAT of a key already held is not a new move: after C or B it must not take the view back
    e.preventDefault();
  };
  // HELD KEYS are keyed by the PHYSICAL key (e.code), so a key pressed as 'w' and released as 'W' (Shift in between) still
  // lets go; and every held key is dropped when the window loses focus or is hidden, since the key-up then never arrives.
  // That lost key-up was the camera that kept flying forward by itself (reported, 2026-09-29).
  const onUp = (e) => {
    checkLate(e, 'keyup');
    expectRepeat = false;   // the OS stops repeating at a release (D336): the keys still held may now be silent
    held.delete(heldKey(e)); boost = !!e.shiftKey; down.delete(e.code); shortcutDown.delete(e.code);
    if (e.code === 'ControlLeft') ctrlFly = null;   // a descent that ran alone is kept
    if (e.code === 'Space' && !swallowsKeys(e.target)) e.preventDefault();   // D252: a button clicks on the key-UP of Space too
  };
  const letGo = () => { unlockLook(); held.clear(); expectRepeat = false; quietMs = 0; takeover = false; boost = false; boostT = 0; drag = null; down.clear(); shortcutDown.clear(); buttons = 0; ctrlFly = null; };
  const onVis = () => { if (win.document && win.document.hidden) letGo(); };
  let boost = false, boostT = 0;   // Shift is down; and for how long (s)
  // MOUSE LOOK: the right button drags the look from any view (it takes the view over into free); the left button never looks (D255: it is the
  // pieces', the handles' and the brush's). Keys and the mouse work at the same time.
  let drag = null;
  // D336 (the camera that stayed flying after every key was let go). A right-button LOOK that ends with the pointer over a panel fires `contextmenu` at that panel,
  // not at the canvas, so the canvas's noMenu missed it and the window opened its own menu: while that is open the page gets no key-ups and no blur, so a key let
  // go then stayed held. The release of a look the canvas started is the look's, wherever it lands: its menu is prevented (once; a right click that began on a
  // panel keeps the page's menu)
  // The same for a right release whose PRESS the page never saw (it went down while the OS had the window, a title-bar drag): it cannot be a click on a panel,
  // and its menu takes the key-ups the same way. A menu opened from the keyboard has no release, so it is untouched
  let lookMenu = false, rightSeen = false, orphanUp = false;
  // D510 (the user, 2026-10-28: "infinite mouse room in either way, so it never hits a wall or runs onto my second monitor"): a right-button look LOCKS
  // the pointer to the canvas for the drag (the Pointer Lock API: the cursor is hidden and held in place, and every move reports movementX/Y with no edge),
  // and unlocks at the release. A lock the runtime refuses, or one lost to Esc, falls back to the plain drag, which still looks but stops at the screen's edge.
  let locked = false;
  const lockLook = () => { try { const p = typeof canvas.requestPointerLock === 'function' ? canvas.requestPointerLock() : null; if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (err) { /* no lock: the plain drag */ } };
  // the lock arrives on its own event: a look let go before it lands (E's read, 2026-10-28) would stay locked, so exitPointerLock is called whenever the
  // document holds a lock, and a lock that lands after the look ended is let go at once
  const unlockLook = () => { const d = win.document; if (d && typeof d.exitPointerLock === 'function' && (locked || d.pointerLockElement)) { try { d.exitPointerLock(); } catch (err) { /* already out */ } } };
  const onLockChange = () => { locked = !!(win.document && win.document.pointerLockElement === canvas); if (locked && !drag) unlockLook(); };
  const onMenu = (e) => { if (lookMenu || orphanUp) { lookMenu = false; orphanUp = false; e.preventDefault(); } };
  const onDown = (e) => {
    const ae = win.document && win.document.activeElement;   // a click on the canvas takes focus off a field (a preventDefault below would keep it)
    if (ae && ae !== win.document.body && typeof ae.blur === 'function') ae.blur();
    if (e.button === 1) { rig.resetLens(); e.preventDefault(); return; }   // the middle click: the lens back to 60°
    if (e.button === 2) {   // D255: the RIGHT button only, in every view; the left is for clicking things (it looked in free mode before)
      if (rig.mode !== 'free') { const c = ctx(); if (!c) return; rig.setMode('free', c); said(); }
      drag = [e.clientX, e.clientY]; lookMenu = true; e.preventDefault();
      lockLook();   // D510: no wall for the look
    }
  };
  // D510: under the lock the pointer does not move, so the look reads movementX/Y; without it, the pointer's travel as before
  const onMove = (e) => { if (!drag) return; const dx = locked ? (e.movementX || 0) : e.clientX - drag[0], dy = locked ? (e.movementY || 0) : e.clientY - drag[1]; rig.free.look(dx * 0.004, -dy * 0.004); drag = [e.clientX, e.clientY]; };
  const onRelease = (e) => { drag = null; if (!e || e.button === undefined || e.button === 0) buttons = 0; if (e && e.button === 2) { unlockLook(); orphanUp = !rightSeen; rightSeen = false; } };
  // D252: a press anywhere (a handle drag included) stops Left Ctrl; D257: the LEFT button only, the right button's look drag flies with it
  // D336: a press on the title bar's drag region hands the window to the OS's move loop, which takes the key-ups with no blur, so the held keys are let go first
  const onAnyDown = (e) => {
    if (e && e.button === 2) { rightSeen = true; orphanUp = false; if (e.target !== canvas) lookMenu = false; }   // a right press that is not a look: its menu is the page's (onDown sets the flag after this, for a look)
    if (e && e.button !== undefined && e.button !== 0) return;
    if (e && e.target && typeof e.target.hasAttribute === 'function' && e.target.hasAttribute('data-tauri-drag-region')) letGo();
    buttons = 1; spoilCtrl();   // (a left press during a look leaves lookMenu: the right button's release is still the look's)
  };
  const onAnyUp = (e) => { if (!e || e.button === undefined || e.button === 0) buttons = 0; };   // D252 follow-up (C's finding 5): a handle's preventDefault on pointerdown suppresses the compatibility mousedown, so a press is read from pointerdown too
  const noMenu = (e) => e.preventDefault();
  // THE SCROLL WHEEL zooms every view: a follow view comes nearer or backs off, free mode flies along its view. CTRL + WHEEL is the
  // LENS instead (rig.lens: the field of view; the camera does not move).
  // deltaX counts only when Shift turned the wheel sideways: a trackpad's sideways swipe (deltaX, no Shift) is not a zoom, nor a lens
  const onWheel = (e) => { spoilCtrl(); const steps = -Math.sign(e.deltaY || (e.shiftKey ? e.deltaX : 0) || 0) * (e.shiftKey ? 4 : 1); if (steps) { if (e.ctrlKey) rig.lens(steps); else rig.zoom(steps); } e.preventDefault(); };
  win.addEventListener('keydown', onKey); win.addEventListener('keyup', onUp); win.addEventListener('blur', letGo);
  if (win.document) win.document.addEventListener('visibilitychange', onVis);
  if (win.document) win.document.addEventListener('pointerlockchange', onLockChange);   // D510
  canvas.addEventListener('mousedown', onDown); win.addEventListener('mousemove', onMove); win.addEventListener('mouseup', onRelease); win.addEventListener('mousedown', onAnyDown, true); win.addEventListener('pointerdown', onAnyDown, true); win.addEventListener('pointerup', onAnyUp, true);
  canvas.addEventListener('contextmenu', noMenu); canvas.addEventListener('wheel', onWheel, { passive: false }); win.addEventListener('contextmenu', onMenu, true);

  const GHOST_SLICE_MS = 2.5;   // D407: how long one frame may spend building the exact ghost (the bar is 6.0 ms a frame at 165 Hz; drawing and the handles take the rest)
  function stepGhostJob() {
    const job = ghostJob, t0 = clockNow();
    try {
      let r; do r = job.it.next(); while (!r.done && t0 !== null && clockNow() - t0 < GHOST_SLICE_MS);   // no clock: one step a frame
      if (r.done) { ghost = r.value; ghostJob = null; }
    } catch (e) { ghostJob = null; ghost = null; }   // the geometry failed part way (the candidate was checked in showGhost): as a showGhost that throws, the ghost goes
  }
  // D425: the page's Sculpt hover ({ s0, r, tool, channel? } or null), asked once a frame only in Sculpt with no drag open (`hover`, the mount's ask of 't180:sculpt-hover')
  const hoverNow = () => { if (!hover) return null; const st = shell.getState(); if (!st.sculpt || st.brush) return null; try { return hover(); } catch (x) { console.warn(`preview: the sculpt hover failed: ${x && x.message || x}`); return null; } };   // a failing answer costs the cue, never the frame
  function frame(t) {
    raf = win.requestAnimationFrame(frame);
    const dt = prev ? Math.min(0.1, (t - prev) / 1000) : 0, elapsed = prev ? t - prev : 0; prev = t;
    frameTimes.push(t); while (frameTimes.length && frameTimes[0] < t - 10000) frameDropped = frameTimes.shift();   // D340: the last 10 s of frame times, for checkLate
    if (heldNetMs > 0 && expectRepeat && held.size) { quietMs += elapsed; if (quietMs > heldNetMs) { held.clear(); down.clear(); shortcutDown.clear(); expectRepeat = false; boost = false; ctrlFly = null; } }   // D336: the net (above onKey)
    if (ghostJob) stepGhostJob();   // D407: the exact ghost, a slice of it this frame
    if (exactJob) stepExact();   // D421c: the exact road after a sculpt drag, a slice of it this frame
    else if (exactDue) { const s = exactDue; exactDue = null; startExact(s); }   // D421 part 4: the exact road after a sculpt drag, from the frame after the release
    const sprint = boost ? boostAt(boostT) : 1; boostT = boost ? boostT + dt : 0;   // the speed THIS frame, then one more frame of Shift held
    if (takeover) { if (rig.mode === 'free') takeover = false; else { const c0 = ctx(); if (c0) { rig.setMode('free', c0); said(); takeover = false; } } }   // the first move from a view takes it over, ONCE: C and B after it stay
    if (rig.mode === 'free') {
      const k = sprint * flySpeed * dt;
      // MOVEMENT IS PER AXIS (reported, 2026-09-29 13:05: "say I am W forward, then I press D, it should go diagonally"). `held` is in the order
      // pressed, so on each of forward/back, right/left and up/down the LAST key seen is the NEWER and wins; a key-up hands the axis to the other.
      // The axes combine and the direction is normalised, so a diagonal is 1.0× a straight line. The look keys all turn.
      const dir = [0, 0, 0];
      for (const a of held.values()) {
        if (a.fly) for (let i = 0; i < 3; i++) if (a.fly[i]) dir[i] = a.fly[i];
        if (a.turn) rig.free.look(a.turn[0] * turnSpeed * dt, a.turn[1] * turnSpeed * dt);
      }
      if (held.has('Space') && held.has('ControlLeft')) dir[2] = 0;   // D257: Space up and Left Ctrl down together net zero
      const n = Math.hypot(dir[0], dir[1], dir[2]);
      if (n) rig.free.move(dir[0] / n * k, dir[1] / n * k, dir[2] / n * k);
      if (n && dir[2] < 0 && ctrlFly && ctrlFly !== 'spoiled' && held.has('ControlLeft')) ctrlFly.moved -= dir[2] / n * k * rig.free.scaleOf(dir[0] / n * k, dir[1] / n * k, dir[2] / n * k);   // only the DESCENT is undone, as far as move() really took it (D257: W's travel stays)   // D252: what Left Ctrl descended, to undo if something joins it
    }
    const { width: w, height: h } = backingSize(canvas.clientWidth, canvas.clientHeight, win.devicePixelRatio);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }   // follows DPR and resizes
    const c = ctx(w > 0 && h > 0 ? w / h : 0);
    if (c && w > 0 && h > 0) {
      const tb = track && track.bounds ? track.bounds : null;
      if (gMode !== 'legacy') grid = null;   // no ground: just the track, so the camera goes anywhere with nothing to clip (reported, 2026-09-29): the legacy { ground: true } grid only
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
      renderer.draw(batchesFor(track), shownPose, { width: w, height: h }, { grid, marker: headMarker(c.head, markerSize(shownPose, c.head), clearanceAtHead(track && track.path ? track.segments : ghost && ghost.segments)), ghost: ghost ? ghost.batches : null, overlay: overlayOf(plan, track, sculptCues(track, hoverNow(), startMovedOf(shell.getState()))), depthLines: plan ? plan.depth : null,
        look, materialOf: L ? L.materialOf : null, textures: L ? L.textures : null, time: skyTime(t) });
      if (layer) layer.update({ plan, pose: shownPose, aspect: w / h, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight });
    }
    if (hud) hud.textContent = `${rig.mode.charAt(0).toUpperCase()}${rig.mode.slice(1)} view · ${look === 'ac' ? (sigil ? 'plain road' : 'AC look') : 'word colours'} (L)${rig.fov !== rig.fovDefault ? ` · fov ${Math.round(rig.fov * 180 / Math.PI)}°` : ''}${err ? ` · ${err}` : ''}${exactJob && exactJob.building ? ' · building the road…' : ''}${lateShown && t < lateShown.until ? ` · ${lateShown.rec.type === 'keyup' ? 'key-up' : 'key-down'} ${lateShown.rec.code} came ${(lateShown.rec.lateMs / 1000).toFixed(1)} s late (${lateShown.rec.cause})` : ''}`;
  }
  raf = win.requestAnimationFrame(frame);
  said();
  return {
    rig, model, renderer,
    /** What is on screen now, for the window proof (app/testhook/probe.js): read-only. */
    view: () => ({ track, detail: model.detail, pose: shownPose, mode: rig.mode, error: err, ghost: ghost ? ghost.batches.length : 0, grid: grid ? grid.positions.length / 6 : 0, guides: guidesState(), look, textures: images.length, inputLate: inputLate.map((r) => ({ ...r })) }),
    track: () => shared(),
    /** What each placed batch is drawn with, in the 'ac' look: { materialOf, textures } (aclook.js resolveLook). */
    lookNow: () => (track && track.mesh ? lookFor(track.mesh.scene) : null),
    setTextureSet(s, kind) { set = s || null; sigil = kind === 'asphalt' || kind === 'solid'; images = set && !sigil ? previewTextures(set) : []; resolvedFor = null; return images.length; },
    get surface() { return sigil ? 'sigil' : 'textures'; },
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
    /**
     * D407: opts.sliced builds the EXACT ghost a few milliseconds a frame instead of at once (the release of a handle: 60 ms at 1,000 m, 2 s at 20 km, the main thread held): the ghost on show stays
     * until the exact one is whole, then it is swapped in (the same mesh to the byte as ghostFor would have made). Any new showGhost, clearGhost or change to the placed track drops the build under way.
     */
    showGhost(candidate, opts) {
      if (opts && opts.sliced && !(candidate && candidate.jump)) {
        const it = model.ghostSteps(candidate, opts), r = it.next();   // the first step now: the candidate is checked there, so one that cannot be a ghost throws to the caller as before
        if (r.done) { ghostJob = null; ghost = r.value; return ghost.batches.length; }
        ghostJob = { it, candidate }; return ghost ? ghost.batches.length : 0;
      }
      ghostJob = null; ghost = model.ghostFor(candidate, opts); if (candidate && candidate.jump) ghost.jump = true; return ghost.batches.length;
    },   // D243: a candidate JUMP says so, so the drag handles stay off it
    clearGhost() { ghost = null; ghostJob = null; },
    /** D426: true while an exact ghost is being built a slice a frame (showGhost's opts.sliced) and is not whole yet: a caller that sees no ghost must not ask again meanwhile, or the build begins over. */
    ghostBuilding() { return !!ghostJob; },
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
    /** D186: the track station under a point of the canvas (css px from its top-left): { s, pos, px } or null. D519 Part 2: and where across the road, { u, at, axes, side } (pickAcross). */
    pick(x, y) { return shownPose && track && track.path ? pickAcross(track.path, track.segments, shownPose, x, y, canvas.clientWidth, canvas.clientHeight) : null; },
    /** D520: the pointer's ray under the pose shown NOW, kept for the drag that asks (the grab plane faces the camera as it was at the press): (x, y) -> { origin, dir, forward }, or null. */
    grabRay() { if (!shownPose) return null; const pose = shownPose, w = canvas.clientWidth, h = canvas.clientHeight; return (x, y) => rayAt(pose, x, y, w, h); },
    setMode(m) { const c = ctx(); if (m === 'free' && !c) return rig.mode; rig.setMode(m, c); said(); return rig.mode; },
    dispose() {
      win.cancelAnimationFrame(raf); clearFull(); exactJob = null; exactDue = null; unsub(); unskin(); if (layer) layer.dispose();
      win.removeEventListener('keydown', onKey); win.removeEventListener('keyup', onUp); win.removeEventListener('blur', letGo);
      unlockLook();   // D510: a look still locked when the preview goes away is let go
      if (win.document) { win.document.removeEventListener('visibilitychange', onVis); win.document.removeEventListener('pointerlockchange', onLockChange); }
      canvas.removeEventListener('mousedown', onDown); win.removeEventListener('mousemove', onMove); win.removeEventListener('mouseup', onRelease); win.removeEventListener('mousedown', onAnyDown, true); win.removeEventListener('pointerdown', onAnyDown, true); win.removeEventListener('pointerup', onAnyUp, true);
      canvas.removeEventListener('contextmenu', noMenu); canvas.removeEventListener('wheel', onWheel); win.removeEventListener('contextmenu', onMenu, true);
      renderer.dispose();
    },
  };
}

/** The lines drawn over the track: the guides' (the mirror ghost), while a sculpt drag leaves a closed lap open the line across its gap (D421 part 4), and the sculpt cues (D425, `cues`). Null when none. */
const overMemo = new WeakMap();
function overlayOf(plan, track, cues = null) {
  const over = plan && plan.over.length ? plan.over : null, gap = track && track.drag && track.drag.gap;
  if (!gap && !cues) return over;
  const key = gap || cues;
  let m = overMemo.get(key); if (!m || m.over !== over || m.cues !== cues) { m = { over, cues, list: [...(over || []), ...(cues || []), ...(gap ? [gap] : [])] }; overMemo.set(key, m); }
  return m.list;
}

// D425 (P's design, p-d425-sculpt-cues-P_2026-10-21.md §1 cue 4 and §3's E rows): WHAT A ROUTE TOOL MOVES, on the road. A route tool (Stretch, Bend, Climb, or Smooth on a rate) moves
// all the road after its window, so on HOVER (the page's `t180:sculpt-hover` answer: { s0, r, tool, channel? }, no drag open) that road is washed in the tool's colour: a line across the
// road at every station past the window's end, at WASH_ALPHA. On a CLOSED lap the release may also move the last road piece, then the first (coreshell.js, the seam tries), so those
// are HATCHED in the marker orange, a line at every other station, the first lighter. During the DRAG the moved road's wash is the renderer's tint (trackmodel.js compose), and the
// hatch of the last piece, built once from the placed path, is drawn under the drag's move (its `model`), so a step adds no line list. Lines are read from the shared path's stations.
const WASH_ALPHA = 0.18, HATCH = Object.freeze([1, 0.55, 0.15]), HATCH_ALPHA = 0.6, HATCH_FIRST_ALPHA = 0.3, LINE_LIFT = 0.05;
const halfMemo = new WeakMap();
const halfWidth = (g) => { if (!g || !g.profile) return 0; if (!Object.isFrozen(g)) return spanOf(readAt(g, 0)) / 2; if (!halfMemo.has(g)) halfMemo.set(g, spanOf(readAt(g, 0)) / 2); return halfMemo.get(g); };
/** Lines across the road at the path's stations of segments [ja, jb) with s >= sFrom, every `every`-th one: GL LINES pairs (a Float32Array), or null when there is none. */
function acrossLines(path, segments, ja, jb, sFrom = -Infinity, every = 1) {
  const out = [];
  for (let j = ja; j < jb; j++) {
    const hw = halfWidth(segments[j]); if (!(hw > 0)) continue;
    const i1 = j + 1 < path.segFirst.length ? path.segFirst[j + 1] : path.samples.length;
    for (let i = path.segFirst[j]; i < i1; i++) {
      const x = path.samples[i]; if (!(x.s >= sFrom) || (every > 1 && i % every)) continue;
      for (const k of [1, -1]) for (let d = 0; d < 3; d++) out.push(x.pos[d] + k * hw * x.L[d] + LINE_LIFT * x.U[d]);
    }
  }
  return out.length ? Float32Array.from(out) : null;
}
/** The segments [from, to) of the first and the last road piece (by the segments' piece id). D498 item 3: a flight's gap is not road, so a lap that ends (or starts)
 *  on a flight is hatched on its last (first) ROAD piece, the one the release's seam tries move (coreshell.js firstR, lastR); before, the hatch was laid on the gap
 *  and drew nothing. */
function seamSpans(segments) {
  const n = segments.length, road = (g) => !!g && g.kind !== 'gap';
  let a = 0; while (a < n && !road(segments[a])) a++;
  let b = n - 1; while (b >= 0 && !road(segments[b])) b--;
  if (a >= n || b < 0) return null;
  let f = a + 1; while (f < n && segments[f].id === segments[a].id) f++;
  let l = b; while (l > 0 && segments[l - 1].id === segments[b].id) l--;
  return { first: [a, f], last: [l, b + 1] };
}
const hatchMemo = new WeakMap();   // path -> { segments, first, last } (the hatch lines, built once for a path)
function hatchOf(path, segments) {
  let h = hatchMemo.get(path);
  if (!h || h.segments !== segments) {
    const sp = seamSpans(segments);
    h = { segments, first: sp ? acrossLines(path, segments, sp.first[0], sp.first[1], -Infinity, 2) : null, last: sp && sp.last[0] > sp.first[0] ? acrossLines(path, segments, sp.last[0], sp.last[1], -Infinity, 2) : null, firstTo: sp ? sp.first[1] : 0 };
    hatchMemo.set(path, h);
  }
  return h;
}
/** Where a route tool's window ends on this path, for a hover { s0, r, tool }: the piece under s0 for Stretch, s0 + r otherwise; null when there is none. */
function windowEnd(path, segments, h) {
  if (!Number.isFinite(h.s0)) return null;
  if (h.tool !== 'stretch') return Number.isFinite(h.r) && h.r >= 0 ? h.s0 + h.r : null;
  let j = 0; while (j + 1 < path.starts.length && path.starts[j + 1].s <= h.s0) j++;
  const id = segments[j] && segments[j].id; if (id === undefined) return null;
  while (j + 1 < segments.length && segments[j + 1].id === id) j++;
  return path.starts[j].s + segments[j].length;
}
const cueMemo = new WeakMap();   // path -> the last hover's { key, list }
/** D467: whether the last release kept the user's bend by moving the lap's start pieces, and that is still the document (an undo or any later edit ends it). */
function startMovedOf(st) { return !!(st && st.keptBend && st.history && st.keptBend.doc === st.history.present); }
/** The sculpt cues for this frame: an overlay list, or null. `h` is the page's hover (or null); the drag's own come from track.drag. `startMoved` (D467): the last release moved
 *  the start pieces to keep the bend, so they are hatched with no hover too, both at full strength. */
function sculptCues(track, h, startMoved = false) {
  if (!track || !track.path || !Array.isArray(track.segments)) return null;
  if (track.drag) {
    const d = track.drag; if (!d.gap || !d.move || !d.base || !d.base.path) return null;   // the hatch only where a closed lap was opened by the move
    let c = cueMemo.get(d); if (c) return c;
    const H = hatchOf(d.base.path, d.base.segments), list = [];
    if (H.last) list.push({ positions: H.last, colour: HATCH, alpha: HATCH_ALPHA, blend: true, model: d.move });
    if (H.first && d.window.from >= H.firstTo) list.push({ positions: H.first, colour: HATCH, alpha: HATCH_FIRST_ALPHA, blend: true });
    c = list.length ? list : null; cueMemo.set(d, c); return c;
  }
  const colour = h ? washOf(h) : null, kept = !!startMoved && !!track.path.closed; if (!colour && !kept) return null;
  const path = track.path, segs = track.segments, sEnd = colour ? windowEnd(path, segs, h) : null; if (colour && sEnd === null && !kept) return null;
  const closed = !!path.closed, key = `${sEnd}|${colour ? colour.join(',') : ''}|${closed}|${kept}`, was = cueMemo.get(path);
  if (was && was.key === key && was.segments === segs) return was.list;
  const list = [], wash = colour && sEnd !== null && sEnd < path.lengthM ? acrossLines(path, segs, 0, segs.length, sEnd) : null;
  if (wash) list.push({ positions: wash, colour, alpha: WASH_ALPHA, blend: true });
  if (closed) { const H = hatchOf(path, segs); if (H.last) list.push({ positions: H.last, colour: HATCH, alpha: HATCH_ALPHA, blend: true }); if (H.first) list.push({ positions: H.first, colour: HATCH, alpha: kept ? HATCH_ALPHA : HATCH_FIRST_ALPHA, blend: true }); }   // D467: both moved, both full
  const out = list.length ? list : null; cueMemo.set(path, { key, segments: segs, list: out }); return out;
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

// D519 Part 2 (O's design, p-d519-design-O_2026-10-28.md §2): THE PICK ACROSS THE ROAD. pickAt gives the centreline station only, and a press on the rim of a wide
// road seen close is often more than 40 px from every centreline sample, so it picks nothing. Sculpt's zone grab needs where across the road the press was.
const ACROSS_N = 41;   // the cross-section points a candidate is refined on (O's §2 item 2)
const PICK_KEEP = 4;   // the candidates kept for the refine
/**
 * THE PICK ACROSS (D519 Part 2): pickAt's three fields { s, pos, px } and four more: `u` the share across the road at the hit (signed, + left, ±1 the rims), `at` the
 * hit's world point, `axes` { U: [dx, dy], L: [dx, dy] } the on-screen px of one metre along the section's normal and its outward across direction there, and `side`
 * (+1 left, -1 right; +1 at the centreline). `s` and `pos` are the station's centreline sample, as pickAt's, so the labels read what they did.
 * 1. Candidates: every sample's centreline and its two rims (pos ± half-width·L) on screen; a candidate's distance is the pointer's to the line rim–centre–rim; the
 *    PICK_KEEP nearest within maxPx are kept (a press on the rim that pickAt misses is caught here).
 * 2. Each is refined on ACROSS_N points across its own section, then once at the half step either side of the nearest. Null when nothing lies within maxPx.
 */
function pickAcross(path, segments, pose, x, y, w, h, maxPx = 40) {
  if (!(w > 0 && h > 0) || !path || !Array.isArray(path.samples)) return null;
  const VP = M.viewProj(pose, w / h);
  const scr = (p) => { const c = M.apply(VP, p); return c[3] > 0 ? [(c[0] / c[3] * 0.5 + 0.5) * w, (1 - (c[1] / c[3] * 0.5 + 0.5)) * h] : null; };
  const toSeg = (a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], q = vx * vx + vy * vy, t = q > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / q)) : 0; return Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y); };
  const keep = [];
  for (const m of path.samples) {
    const c = scr(m.pos); if (!c) continue;
    const hw = halfWidth(segments && segments[m.seg]);
    let d = Math.hypot(c[0] - x, c[1] - y);
    if (hw > 0) for (const k of [1, -1]) { const r = scr([0, 1, 2].map((i) => m.pos[i] + k * hw * m.L[i])); if (r) d = Math.min(d, toSeg(c, r)); }
    if (!(d <= maxPx) || (keep.length === PICK_KEEP && d >= keep[PICK_KEEP - 1].d)) continue;
    keep.push({ m, d }); keep.sort((a, b) => a.d - b.d); if (keep.length > PICK_KEEP) keep.pop();
  }
  let best = null;
  const tryAt = (m, u) => { const A = acrossAt(path, segments, m, u), p = A && scr(A.pos); if (!p) return; const d = Math.hypot(p[0] - x, p[1] - y); if (d <= maxPx && (!best || d < best.d)) best = { m, u, A, d }; };
  for (const { m } of keep) {
    if (!(halfWidth(segments && segments[m.seg]) > 0)) { const c = scr(m.pos), d = Math.hypot(c[0] - x, c[1] - y); if (d <= maxPx && (!best || d < best.d)) best = { m, u: 0, A: null, d }; continue; }
    for (let i = 0; i < ACROSS_N; i++) tryAt(m, -1 + 2 * i / (ACROSS_N - 1));
  }
  if (!best) return null;
  if (best.A) { const half = 1 / (ACROSS_N - 1), b = best; for (const u of [b.u - half, b.u + half]) if (u >= -1 && u <= 1) tryAt(b.m, u); }
  const { m, u, A } = best, at = A ? A.pos : m.pos.slice(), a0 = scr(at);
  const axis = (v) => { const e = v && scr([0, 1, 2].map((k) => at[k] + v[k])); return e && a0 ? [e[0] - a0[0], e[1] - a0[1]] : [0, 0]; };
  return { s: m.s, pos: m.pos.slice(), px: best.d, u, at, axes: { U: axis(A ? A.U : m.U), L: axis(A ? A.L : m.L) }, side: u < 0 ? -1 : 1 };
}

/**
 * D520: THE POINTER'S RAY (the grab plane's other half, app/core/zonegrab.js planePoint): the canvas point (x, y), css px from the top-left of a `w` × `h` view under `pose`
 * (app/camera/math.js lookAt and perspective, fovy), as a world ray { origin: the eye, dir: unit, toward the scene, forward: the camera's unit view direction }. Its point at
 * any depth projects back onto (x, y) (app/test/zonegrab.test.js). Null for a view with no size or a pose with no direction.
 */
function rayAt(pose, x, y, w, h) {
  if (!(w > 0 && h > 0) || !pose) return null;
  const z = [0, 1, 2].map((k) => pose.eye[k] - pose.target[k]), zl = Math.hypot(...z); if (!(zl > 0)) return null;
  const Z = z.map((v) => v / zl), up = pose.up, X0 = [up[1] * Z[2] - up[2] * Z[1], up[2] * Z[0] - up[0] * Z[2], up[0] * Z[1] - up[1] * Z[0]], xl = Math.hypot(...X0); if (!(xl > 0)) return null;
  const X = X0.map((v) => v / xl), Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  const t = Math.tan(pose.fov / 2), nx = (2 * x) / w - 1, ny = 1 - (2 * y) / h, a = w / h;
  const d = [0, 1, 2].map((k) => -Z[k] + X[k] * nx * t * a + Y[k] * ny * t), dl = Math.hypot(...d);
  return { origin: pose.eye.slice(), dir: d.map((v) => v / dl), forward: Z.map((v) => -v) };
}

/** The road's span at the head (m): the last road segment's cross-section (profile.js spanOf), for the build view's framing. */
// THE HEAD'S SECTION IS READ ONCE PER SEGMENT (2026-10-13, ELYSIUM's preview): widthAtHead and clearanceAtHead run on every frame, and a cup's
// section at the head is a blend made afresh by readAt, so offsetAt summed it from scratch each time: about 0.6 s of every 4 s of frames.
// Both depend on the head segment alone, so for a FROZEN segment (the core shell's, src/core/adapter.js) the answer is remembered; any
// other segment is read each time, as before.
// D483: and an unfrozen one is read through a FROZEN COPY of its section (profile.js sealed), so offsetAt takes the running sums: the dragged ghost's head is a fresh unfrozen
// copy on every move (coarse.js), and with an edge typed its 137 knots were each summed from the centre out on every frame (91.9% of the preview frame, D482 §5). The copy has
// the same numbers and the sums add the same pieces in the same order, so the span is the same to the bit.
const headMemo = { width: new WeakMap(), clearance: new WeakMap() };
const perHead = (memo, g, f) => { if (!Object.isFrozen(g)) return f(g); if (!memo.has(g)) memo.set(g, f(g)); return memo.get(g); };
function widthAtHead(segments) {
  for (let i = (segments || []).length - 1; i >= 0; i--) if (segments[i] && segments[i].profile) return perHead(headMemo.width, segments[i], (g) => spanOf(sealed(readAt(g, g.length))));   // at the HEAD: the end of the last segment (a cup's segments carry a blend)
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
    return perHead(headMemo.clearance, g, clearanceOf);
  }
  return null;
}
/** clearanceAtHead's reading of one segment's section at its end. */
function clearanceOf(g) {
  const P = readAt(g, g.length), uL = Math.max(...P.u), uR = Math.min(...P.u);
  if (!(psiAt(P, uL) >= Math.PI - 1e-6 && psiAt(P, uR) >= Math.PI - 1e-6)) return null;
  let lat = 0; for (let k = 1; k <= 64; k++) for (const u of [uL * k / 64, uR * k / 64]) lat = Math.max(lat, Math.abs(offsetAt(P, u)[0]));
  return { up: 0.9 * Math.min(offsetAt(P, uL)[1], offsetAt(P, uR)[1]), lat: 0.9 * lat };
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

module.exports = { createPreview, keyAction, boostAt, backingSize, MAX_SIDE, markerSize, widthAtHead, clearanceAtHead, pickAt, pickAcross, rayAt, startHead, sculptCues, startMovedOf };
