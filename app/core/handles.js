// handles.js: DRAG HANDLES on the preview (D244 and D244b; the keeper, 09:13, with a marked-up screenshot: "alternative controls, every one shows the arrow where you drag and where
// you should click, should be on both sides like width or turn ... you click and drag like the part that is highlighted and it changes the value up or down").
//
// TWO PLACES, one machinery:
//   EXTEND (D244): small marks with a double arrow on the GHOST of the piece Extend would add: length, width, bank, cup, turn and climb, each that has sides on BOTH sides. A drag sets
//        the matching Extend field as if it were typed (the field's own handler runs, so the ghost, the readout and the cup-or-tube rule follow); nothing reaches Undo until Extend.
//   SCULPT (D244b): the same marks on the ONE selected placed piece (bank, cup, width, both edges). A drag reshapes that piece in place (shell.beginSculpt / sculptTo / endSculpt: the
//        shape channels only, the centreline guarded), and is ONE undo step.
//
// The numbers are all here, pure and tested (app/test/handles.test.js):
//   placeHandles(model)            -> [{ id, kind, side, pos, axis }]   the world position of every handle and the unit world vector a positive drag moves along
//   screenOf(VP, W, H, p)          -> { x, y } | null                   css px of the preview; null behind the camera
//   screenAxis(VP, W, H, pos, ax)  -> { x, y, dx, dy, len }             where the handle is on screen and what one metre along its axis is, in px
//   dragPixels(axis, dx, dy)       -> px moved along the handle's axis by a pointer drag of (dx, dy) px
//   targetFor(kind, base, d, ctx, mods) -> the new absolute value, in the Extend field's own unit (m, or degrees), clamped, rounded, with Shift (fine) and Ctrl (snap)
//   hitTest(list, x, y, r)         -> the nearest handle within r px, or null
//   mount(stage, win, host)        the overlay canvas: draws the handles every animation frame, hover shows the name and value, a drag calls host.apply
'use strict';

const M = require('../camera/math.js');

const DEG = Math.PI / 180;
/**
 * One row per kind. `at` is where along the piece (0 its start, 1 its far end), `lat` how far out sideways in halves of the road's width (0 the centreline, 1 the edge), `axis` which of the
 * road's own directions a drag runs along (T along the road, L sideways, U up), and `sides` the signs of the sideways positions (+1 the LEFT side). `sign`: how a side's drag counts:
 * 'out' = away from the centre is positive (width, cup), 'left' = toward the left is positive on both sides (turn), 'up' = the left edge going up and the right edge going down are positive (bank).
 * `perPx` is the value change per PIXEL of the pointer's travel along the handle's on-screen axis (D251: the same at any zoom; it was per metre of the world, so zoomed out one pixel jumped a lot). The numbers are TODAY's per-metre speeds divided by the px a metre takes at the default Build camera (measured in the window), so the feel is the same there; LENGTH is 5x that (the keeper, 11:29/11:30); the Extend fields'
 * units (the core's channels are the same, degrees and metres). `zero`: a kind whose natural rest is 0 (bank, turn, climb): the drag holds there, and a double-click resets to it.
 */
const EXTEND_KINDS = Object.freeze({
  // D250 item 3 (the keeper chose "Near end, like my picture"): LENGTH and WIDTH are at the piece's NEAR end, as in his marked-up screenshot. The near end stays where it is when the value changes, so
  // length is dragged AWAY from the piece (back toward the camera, `sign: 'back'`: stretching the near edge toward you is longer), and the width marks sit at the TARGET half-width (`target: true`: the
  // field's value, not the head's width the piece starts from), so they follow the pointer as the width changes. Turn and climb stay at the far side, bank and cup mid-piece.
  length: Object.freeze({ label: 'length', unit: 'm', colour: '#ffffff', at: 0, lat: 0, axis: 'T', sides: Object.freeze([0]), sign: 'back', perPx: 0.42, min: 1, max: 5000, step: 0.1, snap: 10 }),
  width: Object.freeze({ label: 'width', unit: 'm', colour: '#ff5a5a', at: 0, lat: 1, axis: 'L', sides: Object.freeze([1, -1]), sign: 'out', target: true, perPx: 0.068, min: 0.5, max: 400, step: 0.1, snap: 5 }),
  bank: Object.freeze({ label: 'bank', unit: '°', colour: '#4d86ff', at: 0.5, lat: 1, axis: 'U', sides: Object.freeze([1, -1]), sign: 'up', perPx: 0.45, zero: true, min: -720, max: 720, step: 0.1, snap: 5 }),
  cup: Object.freeze({ label: 'cup', unit: '°', colour: '#3ddc6e', at: 0.5, lat: 0.3, axis: 'L', sides: Object.freeze([1, -1]), sign: 'out', perPx: 0.24, min: 0, max: 150, step: 0.1, snap: 5 }),
  turn: Object.freeze({ label: 'turn', unit: '°/100 m', colour: '#b968ff', at: 0.75, lat: 1, axis: 'L', sides: Object.freeze([1, -1]), sign: 'left', perPx: 0.083, zero: true, min: -90, max: 90, step: 0.1, snap: 5 }),
  climb: Object.freeze({ label: 'climb', unit: '°/100 m', colour: '#ffd23d', at: 0.75, lat: 0, axis: 'U', sides: Object.freeze([0]), sign: 'up1', perPx: 0.082, zero: true, min: -45, max: 45, step: 0.1, snap: 5 }),
});
// D258, THE FREE JUMP'S LANDING (the keeper: drag it in the 3D view AND type it in number boxes). `free: true` kinds sit at the LANDING's start (model.free.pos), not along a piece, and their axes are the
// TAKE-OFF's heading frame (T0 forward, L0 left, U0 up), because that is the frame the landing's pose is given in (src/core/document.js flightPiece), so the arrow moves the number of its box. Each mark sits `leadM` m out along its own
// arrow from the landing's start, so the four are not on one point and can be picked apart (forward 10 m ahead, sideways 8 m to the left, height 6 m up); the HEADING mark sits 15 m ahead along the landing's own
// direction (T1) and drags sideways along its own left (L1): turning the landing about its start.
// The speeds are per pixel like the Extend handles' (D251), first guesses to be tuned by hand: forward 0.15 m, sideways 0.1 m, height 0.05 m, heading 0.1 degree a pixel.
const LANDING = Object.freeze({
  landfwd: Object.freeze({ label: 'forward', unit: 'm', colour: '#ffffff', free: true, axis: 'T', frame: 'T0', lead: 'T0', leadM: 10, perPx: 0.15, min: -2000, max: 2000, step: 0.1, snap: 5 }),
  landleft: Object.freeze({ label: 'sideways', unit: 'm', colour: '#ff9f43', free: true, axis: 'L', frame: 'L0', lead: 'L0', leadM: 8, zero: true, perPx: 0.1, min: -1000, max: 1000, step: 0.1, snap: 1 }),
  landup: Object.freeze({ label: 'height', unit: 'm', colour: '#ffd23d', free: true, axis: 'U', frame: 'U0', lead: 'U0', leadM: 6, zero: true, perPx: 0.05, min: -500, max: 500, step: 0.1, snap: 0.5 }),
  landturn: Object.freeze({ label: 'heading', unit: '°', colour: '#b968ff', free: true, axis: 'L', frame: 'L1', lead: 'T1', leadM: 15, zero: true, perPx: 0.1, min: -180, max: 180, step: 0.1, snap: 5 }),
});
const ORDER = Object.freeze(['length', 'width', 'bank', 'cup', 'turn', 'climb']);
const KINDS = Object.freeze({ ...EXTEND_KINDS, ...LANDING });
const LANDING_ORDER = Object.freeze(['landfwd', 'landleft', 'landup', 'landturn']);
const FINE = 0.1;            // Shift: a tenth of the speed
const DOUBLE_MS = 400;       // two presses on one handle this close are a double-click
const DETENT_PX = 6;         // D251: the pointer travel a drag holds at 0 (bank, turn, climb) and at the value it started from
const EDGE_ON_PX_PER_M = 0.05;   // an axis shorter than this on screen (a view straight along it) is edge-on: the pointer's own motion is used instead. A FAR handle's axis is short too (the far end of a ghost seen from behind: 0.3 px/m, found in the window) but has a direction, so it is not edge-on
const HIT_PX = 12;

const round = (x, step) => { const v = Math.round(x / step + 1e-9) * step; return Number(v.toFixed(Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)))) || 0; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** The sample nearest to path distance `s` (samples are in order of s), with its position moved onto s by the tangent. Null for no samples. */
function sampleNear(samples, s) {
  if (!samples || !samples.length) return null;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid].s < s) lo = mid + 1; else hi = mid; }
  const a = samples[lo], b = lo > 0 ? samples[lo - 1] : a, m = Math.abs(a.s - s) <= Math.abs(b.s - s) ? a : b;
  return { s: m.s, pos: add(m.pos, m.T, s - m.s), T: m.T, L: m.L, U: m.U };
}

/**
 * Where the handles are. `model`: { samples, s0, s1, half(f), kinds, halfTarget?, at? } with the path samples of the piece (from s0 to s1), `half(f)` the road's half-width in metres at the fraction f of the
 * piece, and `kinds` which kinds to place. `halfTarget`, when given, is the half-width a `target` kind (width) sits at (the field's value); `at` overrides a kind's place along the piece (Sculpt keeps the
 * width mark where it was). Each handle: { id: 'width:1', kind, side, pos: [x, y, z], axis: [x, y, z] (the unit vector a POSITIVE drag moves along) }.
 */
function placeHandles(model) {
  const out = [];
  for (const kind of model.kinds) {
    const K = KINDS[kind]; if (!K) continue;
    if (K.free) {   // D258: at the landing's start, in the take-off's heading frame (model.free = { pos, T0, L0, U0, T1, L1 })
      const F = model.free; if (!F || !F.pos || !F[K.frame]) continue;
      const pos = K.lead && F[K.lead] ? add(F.pos, F[K.lead], K.leadM) : F.pos.slice(), dir = F[K.frame];
      out.push({ id: `${kind}:0`, kind, side: 0, pos, axis: [dir[0] || 0, dir[1] || 0, dir[2] || 0] });
      continue;
    }
    const at = model.at && model.at[kind] !== undefined ? model.at[kind] : K.at;
    const m = sampleNear(model.samples, model.s0 + at * (model.s1 - model.s0)); if (!m) continue;
    const half = K.target && Number.isFinite(model.halfTarget) ? model.halfTarget : model.half(at);
    for (const side of K.sides) {
      const lat = K.lat * half * side, pos = add(m.pos, m.L, lat);
      const dir = K.axis === 'T' ? m.T : K.axis === 'L' ? m.L : m.U, sgn = K.sign === 'out' || K.sign === 'up' ? side : K.sign === 'back' ? -1 : 1;
      out.push({ id: `${kind}:${side}`, kind, side, pos, axis: [dir[0] * sgn || 0, dir[1] * sgn || 0, dir[2] * sgn || 0] });   // (|| 0: no negative zeros)
    }
  }
  return out;
}

const screenOf = (VP, W, H, p) => { const c = M.apply(VP, p); return c[3] > 0 ? { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * H } : null; };

/** The handle on screen, and one metre along its axis in px: { x, y, dx, dy, len } (len 0 when the axis cannot be projected). Null when the handle is behind the camera. */
function screenAxis(VP, W, H, pos, ax) {
  const a = screenOf(VP, W, H, pos); if (!a) return null;
  const b = screenOf(VP, W, H, add(pos, ax));
  const dx = b ? b.x - a.x : 0, dy = b ? b.y - a.y : 0;
  return { x: a.x, y: a.y, dx, dy, len: Math.hypot(dx, dy) };
}

/** Pixels along the handle's axis for a pointer drag of (dx, dy) px: the pointer's travel projected on the axis as it was when the drag began, + when it runs the way a positive drag moves. Edge-on (a view along the axis) the pointer's own motion stands in. */
function dragPixels(axis, dx, dy, kind) {
  if (axis && axis.len >= EDGE_ON_PX_PER_M) return (dx * axis.dx + dy * axis.dy) / axis.len;
  const K = KINDS[kind];
  return K && K.axis === 'U' ? -dy : dx;
}

/**
 * The new absolute value of a field for a drag of `px` pixels along the handle's on-screen axis from `base` (D251: pixels, so the speed is the same at any zoom). Shift is fine (a tenth of the speed),
 * Ctrl snaps to round numbers (5 degrees, 10 m of length, 5 m of width). Without Ctrl the drag HOLDS for DETENT_PX of travel at the value it started from and, for bank, turn and climb, at 0: it reads exactly that
 * value while the pointer is inside the hold. Rounded to the kind's step (0.1) with or without Shift, so a fine drag lands on 0.0 and not 0.03; always clamped to the kind's range.
 */
function targetFor(kind, base, px, ctx = {}, mods = {}) {
  const K = KINDS[kind]; if (!K) throw new Error(`handles: no kind "${kind}"`);
  const r = K.perPx * (mods.shift ? FINE : 1);
  let v = base + px * r;
  if (mods.ctrl) v = round(v, K.snap);
  else {
    let best = null;
    for (const t of K.zero ? [0, base] : [base]) { const e = Math.abs(v - t); if (e < DETENT_PX * r && (best === null || e < best.e)) best = { t, e }; }
    v = round(best ? best.t : v, K.step);
  }
  return clamp(v, K.min, K.max);
}

/** What a double-click on a handle sets: 0 for bank, turn and climb, else `pre` (the value before the drag), or null when there is none. */
function resetValue(kind, pre) { const K = KINDS[kind]; if (!K) throw new Error(`handles: no kind "${kind}"`); return K.zero ? 0 : (Number.isFinite(pre) ? pre : null); }

function hitTest(list, x, y, r = HIT_PX) {
  let best = null, bd = Infinity;
  for (const h of list) { if (!h.screen) continue; const d = (h.screen.x - x) ** 2 + (h.screen.y - y) ** 2; if (d <= r * r && d < bd) { bd = d; best = h; } }
  return best;
}

/** "bank 12.0°", "width 31.0 m", "turn 0.0°/100 m": the name and the value, as the field would show it. */
function format(kind, value) {
  const K = KINDS[kind];
  // D259 (the keeper: "it continues after 360 forever instead of resetting back to 0"; "same for -360"): the bank label keeps within one turn, sign kept (370 reads 10)
  const v = kind === 'bank' ? wrapTurn(Number(value)) : Number(value);
  return `${K.label} ${v.toFixed(kind === 'length' || kind === 'width' ? 1 : 1)}${K.unit === 'm' ? ' m' : K.unit}`;
}
/** D259: a bank in degrees kept within ONE turn, its sign kept (the keeper, 18:24): 370 -> 10, -370 -> -10, 300 stays 300, 360 -> 0; no "-0". */
function wrapTurn(x) { const w = x % 360; return Object.is(w, -0) ? 0 : w; }

/** The pointer cursor for a handle: the way a drag runs on screen. */
function cursorFor(axis) { return !axis || axis.len < EDGE_ON_PX_PER_M ? 'move' : Math.abs(axis.dx) >= Math.abs(axis.dy) ? 'ew-resize' : 'ns-resize'; }

/**
 * The overlay. `host`:
 *   host.model()                       -> null | { samples, s0, s1, half(f), kinds, base(kind), ctx(kind) } what to draw now (null: no handles)
 *   host.pose()                        -> the camera pose of the preview, or null
 *   host.begin(handle)                 a drag opens on `handle` (sculpt opens its undo step here)
 *   host.apply(handle, value, mods)    the drag's value (absolute, in the field's unit); called at most once per animation frame, and once more on release
 *   host.end(handle)                   the drag is over
 * Returns { handles() (what was drawn last, with their screen positions), hovered(), unmount() }.
 */
function mount(stage, win, host) {
  const doc = stage.ownerDocument, canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'drag handles');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6';
  stage.append(canvas);
  let raf = 0, sized = '', drawn = [], model = null, hover = null, drag = null, waiting = null, frameReq = 0, pre = null, lockChanged = null, lockFailed = null, lastClick = null;   // lastClick: { id, t } the last press-and-release on a handle that changed nothing (the first half of a double-click)   // pre: { kind, from, to } the last drag that moved a value (the double-click's "before the drag")
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const layout = () => {
    model = host.model(); const pose = host.pose(), W = stage.clientWidth, H = stage.clientHeight;
    if (!model || !pose || !(W > 0 && H > 0)) { drawn = []; return; }
    const VP = M.viewProj(pose, W / H);
    drawn = placeHandles(model).map((h) => ({ ...h, screen: screenAxis(VP, W, H, h.pos, h.axis) }));
  };
  const draw = () => {
    const ctx = canvas.getContext ? canvas.getContext('2d') : null; if (!ctx) return;
    const W = stage.clientWidth, H = stage.clientHeight, dpr = win.devicePixelRatio || 1, key = `${W}x${H}@${dpr}`;
    if (key !== sized) { canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr)); sized = key; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    for (const h of drawn) {
      const s = h.screen; if (!s) continue;
      const K = KINDS[h.kind], on = (drag && drag.h.id === h.id) || (!drag && hover && hover.id === h.id), size = on ? 8 : 6;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // the double arrow: along the way a drag runs on screen
      const ang = s.len >= EDGE_ON_PX_PER_M ? Math.atan2(s.dy, s.dx) : (K.axis === 'U' ? -Math.PI / 2 : 0), ux = Math.cos(ang), uy = Math.sin(ang), reach = on ? 22 : 17;
      for (const [w, c] of [[5, '#0b0d11'], [2.2, K.colour]]) {
        ctx.lineWidth = w; ctx.strokeStyle = c; ctx.beginPath();
        for (const sg of [-1, 1]) { const ex = s.x + ux * reach * sg, ey = s.y + uy * reach * sg; ctx.moveTo(s.x + ux * (size + 2) * sg, s.y + uy * (size + 2) * sg); ctx.lineTo(ex, ey); ctx.moveTo(ex, ey); ctx.lineTo(ex - (ux * 5 + -uy * 4) * sg, ey - (uy * 5 + ux * 4) * sg); ctx.moveTo(ex, ey); ctx.lineTo(ex - (ux * 5 - -uy * 4) * sg, ey - (uy * 5 - ux * 4) * sg); }
        ctx.stroke();
      }
      ctx.fillStyle = K.colour; ctx.strokeStyle = '#0b0d11'; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(s.x - size, s.y - size / 2, size * 2, size); ctx.fill(); ctx.stroke();
      if (on) {
        const text = drag ? format(h.kind, drag.value) : format(h.kind, model.base(h.kind)) + (K.zero ? ' · double-click: 0' : pre && pre.kind === h.kind && pre.to === model.base(h.kind) ? ` · double-click: ${Number(pre.from).toFixed(1)}` : ''); ctx.font = 'bold 14px system-ui, "Segoe UI", sans-serif';
        const w = ctx.measureText(text).width + 12, bx = clamp(s.x + 14, 4, W - w - 4), by = clamp(s.y - 34, 4, H - 24);
        ctx.fillStyle = 'rgba(11,13,17,0.92)'; ctx.fillRect(bx, by, w, 22); ctx.strokeStyle = K.colour; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, w, 22);
        ctx.fillStyle = '#eef1f6'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 6, by + 11);
      }
    }
  };
  const frame = () => {
    raf = win.requestAnimationFrame(frame);
    if (!canvas.isConnected && stage.isConnected !== false) stage.append(canvas);   // the preview's mount clears #preview after the panel mounted
    layout(); draw();
  };
  const apply = (final) => {
    if (!drag || !waiting) return; const w = waiting; waiting = null;
    const d = dragPixels(drag.axis, w.x - drag.x0, w.y - drag.y0, drag.h.kind), mods = { shift: w.shift, ctrl: w.ctrl };
    drag.value = targetFor(drag.h.kind, drag.base, d, drag.ctx, mods);
    host.apply(drag.h, drag.value, mods, final);
  };
  const flush = () => { frameReq = 0; apply(false); };
  const onDown = (e) => {
    if (e.button !== 0 || drag) return;
    const [x, y] = rel(e), h = hitTest(drawn, x, y); if (!h) return;
    e.preventDefault(); e.stopImmediatePropagation();   // a handle wins over the brush and the camera, only where the pointer is ON one
    const m = model; if (!m) return;
    const now = typeof e.timeStamp === 'number' ? e.timeStamp : Date.now();
    if (lastClick && lastClick.id === h.id && now - lastClick.t < DOUBLE_MS) { lastClick = null; resetHandle(h); return; }
    drag = { h, x0: x, y0: y, v: { x, y }, lock: 'none', axis: h.screen, base: m.base(h.kind), ctx: m.ctx(h.kind), value: m.base(h.kind) };
    host.begin(h); wantLock();
    if (stage.setPointerCapture && e.pointerId !== undefined) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone */ } }
  };
  // D251 item 5 (the keeper, 11:29): POINTER LOCK. Pressing a handle locks the pointer where it clicked, so the cursor does not travel and a drag never stops at the screen edge; the drag then runs on movementX/Y
  // (the virtual position `drag.v` is the click point plus the movement so far). If the lock is refused, or the WebView has none, the drag is today's (the pointer's own position). Release unlocks; Esc (the
  // browser's own unlock) ends the drag where it is, as a release does.
  const wantLock = () => {
    if (typeof stage.requestPointerLock !== 'function') { drag.lock = 'none'; return; }
    drag.lock = 'pending';
    try { const p = stage.requestPointerLock(); if (p && typeof p.catch === 'function') p.catch(() => { if (drag && drag.lock === 'pending') drag.lock = 'refused'; }); } catch (err) { drag.lock = 'refused'; }
  };
  const onLockChange = () => {
    if (!drag) return;
    if (doc.pointerLockElement === stage) { drag.lock = 'on'; drag.skip = true; }
    else if (drag.lock === 'on') { drag.lock = 'lost'; onUp(null); }   // Esc, or the window lost focus: the drag ends here
  };
  const onLockError = () => { if (drag && drag.lock === 'pending') drag.lock = 'refused'; };
  const unlock = () => { if (doc.exitPointerLock && doc.pointerLockElement === stage) { try { doc.exitPointerLock(); } catch (err) { /* already unlocked */ } } };
  lockChanged = onLockChange; lockFailed = onLockError;
  if (doc.addEventListener) { doc.addEventListener('pointerlockchange', lockChanged); doc.addEventListener('pointerlockerror', lockFailed); }
  const onMove = (e) => {
    const [x, y] = rel(e);
    if (drag) {
      if (drag.lock === 'on') { const mx = e.movementX || 0, my = e.movementY || 0; if (drag.skip && (mx || my)) { drag.skip = false; return; } drag.v.x += mx; drag.v.y += my; } else drag.v = { x, y };
      waiting = { x: drag.v.x, y: drag.v.y, shift: !!e.shiftKey, ctrl: !!e.ctrlKey }; if (!frameReq) frameReq = win.requestAnimationFrame(flush); return; }
    const h = hitTest(drawn, x, y); hover = h; stage.style.cursor = h ? cursorFor(h.screen) : '';
  };
  const onUp = (e) => {
    if (!drag) return;
    if (frameReq) { win.cancelAnimationFrame(frameReq); frameReq = 0; }
    if (e && e.clientX !== undefined) { if (drag.lock !== 'on') { const [x, y] = rel(e); drag.v = { x, y }; } waiting = { x: drag.v.x, y: drag.v.y, shift: !!e.shiftKey, ctrl: !!e.ctrlKey }; }
    const wasLocked = drag.lock === 'on'; apply(true); const h = drag.h; if (drag.value !== drag.base) { pre = { kind: h.kind, from: drag.base, to: drag.value }; lastClick = null; } else lastClick = { id: h.id, t: e && typeof e.timeStamp === 'number' ? e.timeStamp : Date.now() };
    drag = null; if (wasLocked) unlock(); host.end(h); stage.style.cursor = '';
  };
  // D251: a double-click ON a handle resets it: 0 for bank, turn and climb; the value before the last drag for length, width and cup (kept only while the field still reads what that drag set, so a value typed
  // since, or another piece, is not "put back" to a stale one). Taken in the capture phase like the press, so the camera's own double-click does not also fire.
  const resetHandle = (h) => {
    const m = model; if (!m) return;
    const now = m.base(h.kind), v = resetValue(h.kind, pre && pre.kind === h.kind && pre.to === now ? pre.from : null);
    if (v === null || v === now) return;
    host.begin(h); host.apply(h, v, {}, true); host.end(h); pre = null;
  };
  const onDouble = (e) => {
    if (drag) return;
    const [x, y] = rel(e), h = hitTest(drawn, x, y); if (!h) return;
    e.preventDefault(); e.stopImmediatePropagation(); resetHandle(h);   // (the same reset again after the press has done it is a no-op)
  };
  stage.addEventListener('pointerdown', onDown, true); stage.addEventListener('dblclick', onDouble, true); stage.addEventListener('pointermove', onMove); stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onUp);
  raf = win.requestAnimationFrame(frame);
  return {
    handles: () => drawn.slice(), hovered: () => hover, dragging: () => !!drag,
    unmount() { win.cancelAnimationFrame(raf); if (frameReq) win.cancelAnimationFrame(frameReq); stage.removeEventListener('pointerdown', onDown, true); stage.removeEventListener('dblclick', onDouble, true); if (doc.removeEventListener) { doc.removeEventListener('pointerlockchange', lockChanged); doc.removeEventListener('pointerlockerror', lockFailed); } if (drag && drag.lock === 'on') unlock(); stage.removeEventListener('pointermove', onMove); stage.removeEventListener('pointerup', onUp); stage.removeEventListener('pointercancel', onUp); canvas.remove(); stage.style.cursor = ''; },
  };
}

module.exports = { wrapTurn, KINDS, ORDER, LANDING_ORDER, DEG, placeHandles, sampleNear, screenOf, screenAxis, dragPixels, targetFor, resetValue, DETENT_PX, hitTest, format, cursorFor, mount };
