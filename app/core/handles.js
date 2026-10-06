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
//   dragMetres(axis, dx, dy)       -> metres moved along the handle's axis by a pointer drag of (dx, dy) px
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
 * `rate` is the value change per metre of drag; the Extend fields' units (the core's channels are the same, degrees and metres).
 */
const KINDS = Object.freeze({
  length: Object.freeze({ label: 'length', unit: 'm', colour: '#ffffff', at: 1, lat: 0, axis: 'T', sides: Object.freeze([0]), sign: 'fwd', rate: 1, min: 1, max: 5000, step: 0.1, snap: 10 }),
  width: Object.freeze({ label: 'width', unit: 'm', colour: '#ff5a5a', at: 1, lat: 1, axis: 'L', sides: Object.freeze([1, -1]), sign: 'out', rate: 2, min: 0.5, max: 400, step: 0.1, snap: 5 }),
  bank: Object.freeze({ label: 'bank', unit: '°', colour: '#4d86ff', at: 0.5, lat: 1, axis: 'U', sides: Object.freeze([1, -1]), sign: 'up', rate: null, min: -720, max: 720, step: 0.1, snap: 5 }),
  cup: Object.freeze({ label: 'cup', unit: '°', colour: '#3ddc6e', at: 0.5, lat: 0.3, axis: 'L', sides: Object.freeze([1, -1]), sign: 'out', rate: 2, min: 0, max: 150, step: 0.1, snap: 5 }),
  turn: Object.freeze({ label: 'turn', unit: '°/100 m', colour: '#b968ff', at: 0.85, lat: 1, axis: 'L', sides: Object.freeze([1, -1]), sign: 'left', rate: 0.5, min: -90, max: 90, step: 0.1, snap: 5 }),
  climb: Object.freeze({ label: 'climb', unit: '°/100 m', colour: '#ffd23d', at: 0.85, lat: 0, axis: 'U', sides: Object.freeze([0]), sign: 'up1', rate: 0.5, min: -45, max: 45, step: 0.1, snap: 5 }),
});
const ORDER = Object.freeze(['length', 'width', 'bank', 'cup', 'turn', 'climb']);
const FINE = 0.1;            // Shift: a tenth of the speed
const EDGE_ON_PX_PER_M = 0.8;   // an axis shorter than this on screen (a view straight along it) is edge-on: the pointer's own motion is used instead
const EDGE_ON_M_PER_PX = 0.05;
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
 * Where the handles are. `model`: { samples, s0, s1, half(f), kinds } with the path samples of the piece (from s0 to s1), `half(f)` the road's half-width in metres at the fraction f of the
 * piece, and `kinds` which kinds to place. Each handle: { id: 'width:1', kind, side, pos: [x, y, z], axis: [x, y, z] (the unit vector a POSITIVE drag moves along) }.
 */
function placeHandles(model) {
  const out = [];
  for (const kind of model.kinds) {
    const K = KINDS[kind]; if (!K) continue;
    const m = sampleNear(model.samples, model.s0 + K.at * (model.s1 - model.s0)); if (!m) continue;
    const half = model.half(K.at);
    for (const side of K.sides) {
      const lat = K.lat * half * side, pos = add(m.pos, m.L, lat);
      const dir = K.axis === 'T' ? m.T : K.axis === 'L' ? m.L : m.U, sgn = K.sign === 'out' || K.sign === 'up' ? side : 1;
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

/** Metres along the handle's axis for a pointer drag of (dx, dy) px, measured on the axis as it was when the drag began. Edge-on (a view along the axis), the pointer's own motion stands in. */
function dragMetres(axis, dx, dy, kind) {
  if (axis && axis.len >= EDGE_ON_PX_PER_M) return (dx * axis.dx + dy * axis.dy) / (axis.len * axis.len);
  const K = KINDS[kind];
  return (K && K.axis === 'U' ? -dy : dx) * EDGE_ON_M_PER_PX;
}

/**
 * The new absolute value of a field for a drag of `d` metres along the handle's axis from `base`. `ctx.half` is the road's half-width in m (the bank handle's lever). Shift is fine
 * (a tenth of the speed), Ctrl snaps to round numbers (5 degrees, 10 m of length, 5 m of width). Always clamped to the kind's range and rounded to its step.
 */
function targetFor(kind, base, d, ctx = {}, mods = {}) {
  const K = KINDS[kind]; if (!K) throw new Error(`handles: no kind "${kind}"`);
  const f = mods.shift ? FINE : 1;
  let v;
  if (kind === 'bank') v = base + (d * f / Math.max(0.5, Number.isFinite(ctx.half) ? ctx.half : 1)) / DEG;   // an edge raised by d at half a road's width: that many degrees of roll
  else v = base + d * f * K.rate;
  if (mods.ctrl) v = round(v, K.snap); else v = round(v, mods.shift ? K.step / 10 : K.step);
  return clamp(v, K.min, K.max);
}

function hitTest(list, x, y, r = HIT_PX) {
  let best = null, bd = Infinity;
  for (const h of list) { if (!h.screen) continue; const d = (h.screen.x - x) ** 2 + (h.screen.y - y) ** 2; if (d <= r * r && d < bd) { bd = d; best = h; } }
  return best;
}

/** "bank 12.0°", "width 31.0 m", "turn 0.0°/100 m": the name and the value, as the field would show it. */
function format(kind, value) {
  const K = KINDS[kind];
  return `${K.label} ${Number(value).toFixed(kind === 'length' || kind === 'width' ? 1 : 1)}${K.unit === 'm' ? ' m' : K.unit}`;
}

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
  let raf = 0, sized = '', drawn = [], model = null, hover = null, drag = null, waiting = null, frameReq = 0;
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
        const text = format(h.kind, drag ? drag.value : model.base(h.kind)); ctx.font = 'bold 14px system-ui, "Segoe UI", sans-serif';
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
    const d = dragMetres(drag.axis, w.x - drag.x0, w.y - drag.y0, drag.h.kind), mods = { shift: w.shift, ctrl: w.ctrl };
    drag.value = targetFor(drag.h.kind, drag.base, d, drag.ctx, mods);
    host.apply(drag.h, drag.value, mods, final);
  };
  const flush = () => { frameReq = 0; apply(false); };
  const onDown = (e) => {
    if (e.button !== 0 || drag) return;
    const [x, y] = rel(e), h = hitTest(drawn, x, y); if (!h) return;
    e.preventDefault(); e.stopImmediatePropagation();   // a handle wins over the brush and the camera, only where the pointer is ON one
    const m = model; if (!m) return;
    drag = { h, x0: x, y0: y, axis: h.screen, base: m.base(h.kind), ctx: m.ctx(h.kind), value: m.base(h.kind) };
    host.begin(h);
    if (stage.setPointerCapture && e.pointerId !== undefined) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone */ } }
  };
  const onMove = (e) => {
    const [x, y] = rel(e);
    if (drag) { waiting = { x, y, shift: !!e.shiftKey, ctrl: !!e.ctrlKey }; if (!frameReq) frameReq = win.requestAnimationFrame(flush); return; }
    const h = hitTest(drawn, x, y); hover = h; stage.style.cursor = h ? cursorFor(h.screen) : '';
  };
  const onUp = (e) => {
    if (!drag) return;
    if (frameReq) { win.cancelAnimationFrame(frameReq); frameReq = 0; }
    if (e && e.clientX !== undefined) { const [x, y] = rel(e); waiting = { x, y, shift: !!e.shiftKey, ctrl: !!e.ctrlKey }; }
    apply(true); const h = drag.h; drag = null; host.end(h); stage.style.cursor = '';
  };
  stage.addEventListener('pointerdown', onDown, true); stage.addEventListener('pointermove', onMove); stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onUp);
  raf = win.requestAnimationFrame(frame);
  return {
    handles: () => drawn.slice(), hovered: () => hover, dragging: () => !!drag,
    unmount() { win.cancelAnimationFrame(raf); if (frameReq) win.cancelAnimationFrame(frameReq); stage.removeEventListener('pointerdown', onDown, true); stage.removeEventListener('pointermove', onMove); stage.removeEventListener('pointerup', onUp); stage.removeEventListener('pointercancel', onUp); canvas.remove(); stage.style.cursor = ''; },
  };
}

module.exports = { KINDS, ORDER, DEG, placeHandles, sampleNear, screenOf, screenAxis, dragMetres, targetFor, hitTest, format, cursorFor, mount };
