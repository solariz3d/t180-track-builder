// handles.js: DRAG HANDLES on the preview (D244 and D244b, asked for with a marked-up screenshot: every control shows an arrow where to drag, on both sides like width or turn, and dragging the highlighted part
// changes the value up or down).
//
// TWO PLACES, one machinery:
//   EXTEND (D244): small marks with a double arrow on the GHOST of the piece Extend would add: length, width, bank, cup, turn and climb, each that has sides on BOTH sides. A drag sets
//        the matching Extend field as if it were typed (the field's own handler runs, so the ghost, the readout and the cup-or-tube rule follow); nothing reaches Undo until Extend.
//   SCULPT (D244b; D421 part 3: a selected RUN, its marks on the run's middle piece and its drag over the whole run, shell.sculptInfo from/to): the same marks on the selected placed piece (bank, cup, width, both edges). A drag reshapes it in place (shell.beginSculpt / sculptTo / endSculpt: the
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
const { tokensOf } = require('../lib/tokens.js');   // D381: the skin's colours (app/lib/tokens.js)

const DEG = Math.PI / 180;
/**
 * One row per kind. `at` is where along the piece (0 its start, 1 its far end), `lat` how far out sideways in halves of the road's width (0 the centreline, 1 the edge), `axis` which of the
 * road's own directions a drag runs along (T along the road, L sideways, U up), and `sides` the signs of the sideways positions (+1 the LEFT side). `sign`: how a side's drag counts:
 * 'out' = away from the centre is positive (width, cup), 'left' = toward the left is positive on both sides (turn), 'up' = the left edge going up and the right edge going down are positive (bank).
 * `perPx` is the value change per PIXEL of the pointer's travel along the handle's on-screen axis (D251: the same at any zoom; it was per metre of the world, so zoomed out one pixel jumped a lot). The numbers are TODAY's per-metre speeds divided by the px a metre takes at the default Build camera (measured in the window), so the feel is the same there; LENGTH is 5x that (asked for); the Extend fields'
 * units (the core's channels are the same, degrees and metres). `zero`: a kind whose natural rest is 0 (bank, turn, climb): the drag holds there, and a double-click resets to it.
 */
const EXTEND_KINDS = Object.freeze({
  // D250 item 3 put LENGTH and WIDTH at the piece's NEAR end; since 2026-10-14 they are at its FRONT (below). The width marks sit at the TARGET half-width
  // (`target: true`: the field's value, not the head's width the piece starts from), so they follow the pointer as the width changes. Turn and climb are three
  // quarters along, bank and cup mid-piece.
  // 2026-10-14: LENGTH and WIDTH moved to the FRONT of the piece (its far end, where the piece grows to), a suggestion from a track maker who tried the
  // builder: the white length mark at the centreline there, dragged FORWARD to lengthen (`sign: 'forward'`, it follows the front end as it moves), and the red
  // width marks at that end's edges. The width the field sets is the width the piece ENDS at, so its marks now sit where that width is reached
  length: Object.freeze({ label: 'length', unit: 'm', colour: '#ffffff', at: 1, lat: 0, axis: 'T', sides: Object.freeze([0]), sign: 'forward', perPx: 0.42, min: 1, max: 5000, step: 0.01, snap: 10 }),
  // 2026-10-14, the second move: WIDTH to the middle of the piece, BANK three quarters along, TURN at the front edges (the length mark stays at the front centre)
  width: Object.freeze({ label: 'width', unit: 'm', colour: '#ff5a5a', at: 0.5, lat: 1, axis: 'L', sides: Object.freeze([1, -1]), sign: 'out', target: true, perPx: 0.068, min: 0.5, max: 400, step: 0.01, snap: 5 }),
  bank: Object.freeze({ label: 'bank', unit: '°', colour: '#4d86ff', at: 0.75, lat: 1, axis: 'U', sides: Object.freeze([1, -1]), sign: 'up', perPx: 0.45, zero: true, min: -720, max: 720, step: 0.01, snap: 5 }),
  cup: Object.freeze({ label: 'cup', unit: '°', colour: '#3ddc6e', at: 0.5, lat: 0.3, axis: 'L', sides: Object.freeze([1, -1]), sign: 'out', perPx: 0.24, min: 0, max: 150, step: 0.01, snap: 5 }),
  // 2026-10-14, reported: a turn could not go past 90 degrees unless Turn by 90 was chosen first, so there is no clamp (Turn by and Turn to grid
  // are the exact-angle tools); and the camera orientation changed which way a drag had to go, which should be the same from every view: `screen: 'x'`, the
  // pointer's own left and right (a drag to the right is a right turn, from any view), not the road's left as it happens to lie on screen
  turn: Object.freeze({ label: 'turn', unit: '°/100 m', colour: '#b968ff', at: 1, lat: 1, axis: 'L', sides: Object.freeze([1, -1]), sign: 'left', screen: 'x', perPx: 0.083, zero: true, min: -Infinity, max: Infinity, step: 0.01, snap: 5 }),
  climb: Object.freeze({ label: 'climb', unit: '°/100 m', colour: '#ffd23d', at: 0.75, lat: 0, axis: 'U', sides: Object.freeze([0]), sign: 'up1', perPx: 0.082, zero: true, min: -45, max: 45, step: 0.01, snap: 5 }),
  // D331 (plan :417-426, turns are scrubbed with these): with the turn and climb fields read as CORNERS (app/core/panel.js "turn & climb as", the default) the
  // panel offers these two in place of turn and climb. They sit and move as those do, with A2's precise rules unchanged (Shift one pixel = 0.01, the wheel and the
  // arrows one step, Ctrl snaps to 5), but the value is the corner's DEGREES, and it is labelled so. The climb's range is a pitch change of a full loop either way
  turnDeg: Object.freeze({ label: 'turn', unit: '°', colour: '#b968ff', at: 1, lat: 1, axis: 'L', sides: Object.freeze([1, -1]), sign: 'left', screen: 'x', perPx: 0.083, zero: true, min: -Infinity, max: Infinity, step: 0.01, snap: 5 }),
  climbDeg: Object.freeze({ label: 'climb', unit: '°', colour: '#ffd23d', at: 0.75, lat: 0, axis: 'U', sides: Object.freeze([0]), sign: 'up1', perPx: 0.082, zero: true, min: -360, max: 360, step: 0.01, snap: 5 }),
});
// D258, THE FREE JUMP'S LANDING (asked for: drag it in the 3D view AND type it in number boxes). `free: true` kinds sit at the LANDING's start (model.free.pos), not along a piece, and their axes are the
// TAKE-OFF's heading frame (T0 forward, L0 left, U0 up), because that is the frame the landing's pose is given in (src/core/document.js flightPiece), so the arrow moves the number of its box. Each mark sits `leadM` m out along its own
// arrow from the landing's start, so the four are not on one point and can be picked apart (forward 10 m ahead, sideways 8 m to the left, height 6 m up); the HEADING mark sits 15 m ahead along the landing's own
// direction (T1) and drags sideways along its own left (L1): turning the landing about its start.
// The speeds are per pixel like the Extend handles' (D251), first guesses to be tuned by hand: forward 0.15 m, sideways 0.1 m, height 0.05 m, heading 0.1 degree a pixel.
const LANDING = Object.freeze({
  landfwd: Object.freeze({ label: 'forward', unit: 'm', colour: '#ffffff', free: true, axis: 'T', frame: 'T0', lead: 'T0', leadM: 10, perPx: 0.15, min: -2000, max: 2000, step: 0.01, snap: 5 }),
  landleft: Object.freeze({ label: 'sideways', unit: 'm', colour: '#ff9f43', free: true, axis: 'L', frame: 'L0', lead: 'L0', leadM: 8, zero: true, perPx: 0.1, min: -1000, max: 1000, step: 0.01, snap: 1 }),
  landup: Object.freeze({ label: 'height', unit: 'm', colour: '#ffd23d', free: true, axis: 'U', frame: 'U0', lead: 'U0', leadM: 6, zero: true, perPx: 0.05, min: -500, max: 500, step: 0.01, snap: 0.5 }),
  landturn: Object.freeze({ label: 'heading', unit: '°', colour: '#b968ff', free: true, axis: 'L', frame: 'L1', lead: 'T1', leadM: 15, zero: true, perPx: 0.1, min: -180, max: 180, step: 0.01, snap: 5 }),
});
const ORDER = Object.freeze(['length', 'width', 'bank', 'cup', 'turn', 'climb']);
const KINDS = Object.freeze({ ...EXTEND_KINDS, ...LANDING });
const LANDING_ORDER = Object.freeze(['landfwd', 'landleft', 'landup', 'landturn']);
// D330 (2026-10-15, reported: scrubbing a turn from a 1000 m straight jumped 0.08 instead of 0.01, so every handle has to be precisely scrubbable): the PRECISE
// gesture. While this modifier is held one pixel of drag is exactly one step (0.01), with no hold, for every handle: every value is reachable. It is ONE constant, so the gesture can be changed in one place
// ('shift' or 'alt'; Ctrl is the snap). The wheel over a handle and the arrow keys while one is held are exactly one step too.
const PRECISE_MOD = 'shift';
const DOUBLE_MS = 400;       // two presses on one handle this close are a double-click
const WARP_PX = 120;         // 2026-10-14: how far the hidden cursor may go from the grab before it is put back there (the drag never runs out of screen)
const WARP_WAIT_MS = 250;    // and how long a drag waits to see it arrive back before it asks again
const WARP_MISSES = 3;       // D330: how many times IN A ROW the cursor may fail to come back (or the window refuse) before the drag stops putting it back; one miss never does
const SPEED_SLOW = 0.1;      // D335: pointer speed (px per ms) at and below which a drag is exact: one pixel is the kind's step (0.01)
const SPEED_FAST = 1.0;      // and at and above which it is the kind's own perPx a pixel; between the two the rate is eased (smoothstep), as a pointer's acceleration is
const SPEED_WINDOW_MS = 60;  // the speed is the pointer's path over this long, so one fast event in a slow scrub (or the reverse) does not jump the rate
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
  const S = KINDS[kind];
  if (S && S.screen === 'x') return 0 - dx;   // + is left: a drag to the left, whatever the view (0 - dx: no negative zero)
  if (axis && axis.len >= EDGE_ON_PX_PER_M) return (dx * axis.dx + dy * axis.dy) / axis.len;
  const K = KINDS[kind];
  return K && K.axis === 'U' ? -dy : dx;
}

/** D335: the share of a kind's perPx that a pixel is worth at pointer speed `v` (px per ms): the kind's step over perPx when slow (so one pixel is 0.01), 1 when fast, eased between. */
function scrubGain(kind, v) {
  const K = KINDS[kind]; if (!K) throw new Error(`handles: no kind "${kind}"`);
  const lo = Math.min(1, K.step / K.perPx), t = Math.min(1, Math.max(0, ((Number.isFinite(v) ? v : 0) - SPEED_SLOW) / (SPEED_FAST - SPEED_SLOW)));
  return t >= 1 ? 1 : lo + (1 - lo) * t * t * (3 - 2 * t);   // (exactly 1 when fast: no float dust on the old rate)
}

/**
 * The new absolute value of a field for a drag of `px` pixels along the handle's on-screen axis from `base` (D251: pixels, so the speed is the same at any zoom). With the PRECISE modifier (Shift) one pixel is exactly one step (D330: 0.01, no hold),
 * Ctrl snaps to round numbers (5 degrees, 10 m of length, 5 m of width). Without Ctrl the drag HOLDS for DETENT_PX of travel at the value it started from and, for bank, turn and climb, at 0: it reads exactly that
 * value while the pointer is inside the hold. Rounded to the kind's step (0.01) with or without the precise modifier; always clamped to the kind's range.
 */
function targetFor(kind, base, px, ctx = {}, mods = {}) {
  const K = KINDS[kind]; if (!K) throw new Error(`handles: no kind "${kind}"`);
  const precise = !!mods[PRECISE_MOD], r = precise ? K.step : K.perPx;
  let v = base + px * r;
  if (mods.ctrl) v = round(v, K.snap);
  else if (precise) v = round(v, K.step);   // one pixel, one step: nothing held back, nothing skipped, through 0 as well
  else if (ctx.hold === false) v = round(v, K.step);   // D335: the overlay's own drags hold nothing: a slow pixel is 0.01 and nothing is skipped
  else {
    // THE HOLDS ARE DEAD TRAVEL (2026-10-14, reported: on a 1000 m piece a turn drag jumped from 0 straight to 0.5, then moved in steps): the DETENT_PX inside a hold
    // no longer count, so leaving it continues from the held value at the next step (0.1, 0.2, ...). Before, the value was measured from where the drag started,
    // so leaving the hold landed DETENT_PX * perPx away: 0.5 for turn and climb, 2.7 degrees of bank, 2.5 m of length.
    const H = DETENT_PX * r, dir = Math.sign(px);
    v = base + dir * Math.max(0, Math.abs(px) * r - H);                         // the hold at the starting value
    if (K.zero && base !== 0 && Math.sign(v) !== Math.sign(base)) {              // crossed (or reached) 0: the hold there
      const past = Math.abs(v);
      v = past < H ? 0 : Math.sign(v) * (past - H);
    }
    v = round(v, K.step);
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

/** "bank 12.00°", "width 31.00 m", "turn 0.00°/100 m": the name and the value, to two decimals. */
function format(kind, value) {
  const K = KINDS[kind];
  // D259 (reported: the bank went on past 360 forever instead of resetting to 0, and the same for -360): the bank label keeps within one turn, sign kept (370 reads 10)
  const v = kind === 'bank' ? wrapTurn(Number(value)) : Number(value);
  return `${K.label} ${v.toFixed(2)}${K.unit === 'm' ? ' m' : K.unit}`;   // two decimals (2026-10-15: every number reads to 0.00)
}
/** D259: a bank in degrees kept within ONE turn, its sign kept: 370 -> 10, -370 -> -10, 300 stays 300, 360 -> 0; no "-0". */
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
  const T = tokensOf(win);
  const doc = stage.ownerDocument, canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'drag handles');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6';
  stage.append(canvas);
  let raf = 0, sized = '', drawn = [], model = null, hover = null, drag = null, waiting = null, frameReq = 0, pre = null, onKeyDown = null, lastClick = null;   // lastClick: { id, t } the last press-and-release on a handle that changed nothing (the first half of a double-click)   // pre: { kind, from, to } the last drag that moved a value (the double-click's "before the drag")
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const layout = (m = host.model(), pose = host.pose()) => {
    model = m; const W = stage.clientWidth, H = stage.clientHeight;
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
      for (const [w, c] of [[5, T.css('--ink', '#0b0d11')], [2.2, K.colour]]) {
        ctx.lineWidth = w; ctx.strokeStyle = c; ctx.beginPath();
        for (const sg of [-1, 1]) { const ex = s.x + ux * reach * sg, ey = s.y + uy * reach * sg; ctx.moveTo(s.x + ux * (size + 2) * sg, s.y + uy * (size + 2) * sg); ctx.lineTo(ex, ey); ctx.moveTo(ex, ey); ctx.lineTo(ex - (ux * 5 + -uy * 4) * sg, ey - (uy * 5 + ux * 4) * sg); ctx.moveTo(ex, ey); ctx.lineTo(ex - (ux * 5 - -uy * 4) * sg, ey - (uy * 5 - ux * 4) * sg); }
        ctx.stroke();
      }
      ctx.fillStyle = K.colour; ctx.strokeStyle = T.css('--ink', '#0b0d11'); ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(s.x - size, s.y - size / 2, size * 2, size); ctx.fill(); ctx.stroke();
      if (on) {
        const text = drag ? format(h.kind, drag.value) : format(h.kind, model.base(h.kind)) + (K.zero ? ' · double-click: 0' : pre && pre.kind === h.kind && pre.to === model.base(h.kind) ? ` · double-click: ${Number(pre.from).toFixed(2)}` : ''); ctx.font = 'bold 14px system-ui, "Segoe UI", sans-serif';
        const w = ctx.measureText(text).width + 12, bx = clamp(s.x + 14, 4, W - w - 4), by = clamp(s.y - 34, 4, H - 24);
        ctx.fillStyle = T.alpha('--veil', 0.92, '#0b0d11'); ctx.fillRect(bx, by, w, 22); ctx.strokeStyle = K.colour; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, w, 22);
        ctx.fillStyle = T.css('--on-ink', '#eef1f6'); ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 6, by + 11);
      }
    }
  };
  // D407: THE LAYOUT IS DONE WHEN SOMETHING IT READS CHANGED, not every frame (it ran on every frame, the model, every handle placed and drawn: about a third of an idle frame's script, the measurement of
  // 2026-10-19). What a frame draws follows from the model's numbers (the ghost's stations, the fields' values and widths, the mode), the camera, the stage's size, and the hover and drag; when all of
  // them are what they were, the canvas already shows it.
  let lastKey = null;
  const frameKey = (m, pose) => {
    const W = stage.clientWidth, H = stage.clientHeight, k = [W, H, win.devicePixelRatio || 1, pose ? JSON.stringify(pose) : null, hover ? hover.id : null, drag ? `${drag.h.id}:${drag.value}` : null, pre ? `${pre.kind}:${pre.from}:${pre.to}` : null, T.css('--ink', '#0b0d11')];
    if (m) { k.push(m.mode, m.samples, m.s0, m.s1, m.halfTarget, m.free, m.info, m.kinds.join(',')); for (const kind of m.kinds) { const c = m.ctx(kind); k.push(m.base(kind), c && c.half, c && c.free); } }
    return k;
  };
  const sameKey = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const frame = () => {
    raf = win.requestAnimationFrame(frame);
    if (!canvas.isConnected && stage.isConnected !== false) stage.append(canvas);   // the preview's mount clears #preview after the panel mounted
    const m = host.model(), pose = host.pose(), k = frameKey(m, pose);
    if (sameKey(k, lastKey)) return;
    lastKey = k; layout(m, pose); draw();
  };
  // D335: each pointer step adds to two sums of pixels along the handle's axis AS IT IS NOW (the road rolls under the pointer, so the axis the mark moves on turns: measured against the
  // axis at the grab the bank stalled near 165 degrees and would have gone back). `pxFine` is the raw pixels (Shift: one is a step); `px` is the pixels weighted by the pointer's speed
  // (scrubGain), so a slow scrub is 0.01 a pixel and a flick is the kind's own perPx.
  const track = (x, y, t, ctrl) => {
    const d = drag, cur = drawn.find((c) => c.id === d.h.id), ax = cur && cur.screen ? cur.screen : d.axis;
    const raw = dragPixels(ax, x - d.last.x, y - d.last.y, d.h.kind); d.last = { x, y };
    d.trail.push({ x, y, t }); while (d.trail.length > 2 && t - d.trail[1].t >= SPEED_WINDOW_MS) d.trail.shift();
    let len = 0; for (let i = 1; i < d.trail.length; i++) len += Math.hypot(d.trail[i].x - d.trail[i - 1].x, d.trail[i].y - d.trail[i - 1].y);
    const span = Math.max(t - d.trail[0].t, 1), g = ctrl ? 1 : scrubGain(d.h.kind, len / span);
    d.pxFine += raw; d.px += raw * g;
  };
  const stamp = (e) => (e && typeof e.timeStamp === 'number' ? e.timeStamp : Date.now());
  // the drag tick (app/sound.js): one event each time a handle's value moves a step. D345: every path that moves a value sends it from here, the drag (and the
  // arrows, through apply) and the wheel, which sent nothing: a scroll was silent and sound.js's last value went stale, so the next drag ticked from it
  // `single` (D345 addition 2): a DELIBERATE single step, the wheel's notch, an arrow's nudge or a reset, which sound.js ticks whatever its size; a drag's steps
  // carry no flag and tick only on a whole number. singleNext marks the arrow's step, which goes through apply like a drag's
  let singleNext = false;
  const stepped = (kind, was, value, single = false) => {
    if (value !== was && doc.dispatchEvent && win.CustomEvent) { try { doc.dispatchEvent(new win.CustomEvent('t180:handle-step', { detail: single ? { kind, value, single: true } : { kind, value } })); } catch (e) { /* a sound is never worth a drag */ } }
  };
  const apply = (final) => {
    if (!drag || !waiting) return; const w = waiting; waiting = null;
    const mods = { shift: w.shift, ctrl: w.ctrl, alt: w.alt }, d = mods.shift ? drag.pxFine : drag.px;
    const was = drag.value; drag.value = targetFor(drag.h.kind, drag.base, d, { ...drag.ctx, hold: false }, mods); drag.mods = mods;
    host.apply(drag.h, drag.value, mods, final);
    if (drag) stepped(drag.h.kind, was, drag.value, singleNext);
  };
  const flush = () => { frameReq = 0; apply(false); };
  const onDown = (e) => {
    if (e.button !== 0 || drag) return;
    const [x, y] = rel(e), h = hitTest(drawn, x, y); if (!h) return;
    e.preventDefault(); e.stopImmediatePropagation();   // a handle wins over the brush and the camera, only where the pointer is ON one
    const m = model; if (!m) return;
    const now = typeof e.timeStamp === 'number' ? e.timeStamp : Date.now();
    if (lastClick && lastClick.id === h.id && now - lastClick.t < DOUBLE_MS) { lastClick = null; resetHandle(h); return; }
    drag = { h, x0: x, y0: y, cx: e.clientX, cy: e.clientY, moved: false, v: { x, y }, acc: { x: 0, y: 0 }, warp: null, noWarp: false, misses: 0, axis: h.screen, px: 0, pxFine: 0, last: { x, y }, trail: [{ x, y, t: now }], base: m.base(h.kind), base0: m.base(h.kind), mods: {}, ctx: m.ctx(h.kind), value: m.base(h.kind) };
    host.begin(h); stage.style.cursor = 'none';
    if (stage.setPointerCapture && e.pointerId !== undefined) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone */ } }
  };
  // D270 (reported: no "to show your cursor press ESC" window): NO POINTER LOCK. D251 locked the pointer on a press so a drag never stopped at the screen edge, but Chromium draws that notice itself whenever a
  // page locks the pointer, and no WebView2 or Tauri setting turns it off. A grab now holds the pointer with setPointerCapture (above: it keeps reporting its position outside the stage), hides the cursor for
  // the drag, and on release puts it back at the handle that was grabbed through the native window (Tauri's setCursorPosition, when there is one; a browser or a test host has none and the cursor simply stays
  // where the drag ended). Esc ends the drag where it is, as a release does. The value is the pointer's own position, so the per-pixel speeds are D251's to the pixel.
  const putCursorBack = (d) => {
    const T = win.__TAURI__, w = T && T.window && T.window.getCurrentWindow && T.window.getCurrentWindow(), P = T && T.dpi && T.dpi.LogicalPosition;
    if (!d.moved || !w || !w.setCursorPosition || !P) return;
    const failed = (err) => console.warn('handles: the cursor could not be put back at the handle:', err && err.message ? err.message : err);   // cosmetic: the drag is already over
    try { const r = w.setCursorPosition(new P(d.cx, d.cy)); if (r && typeof r.catch === 'function') r.catch(failed); } catch (err) { failed(err); }
  };
  // D330: while a handle is held each arrow key is exactly one step of its value (Up and Right add, Down and Left take away), on top of wherever the drag is; the page does not get the key
  const NUDGE = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
  onKeyDown = (e) => {
    if (!drag || !e) return;
    if (e.key === 'Escape') { onUp(null); return; }
    const dir = NUDGE[e.key]; if (!dir) return;
    if (e.preventDefault) e.preventDefault();
    const K = KINDS[drag.h.kind]; drag.base = round(drag.base + dir * K.step, K.step);
    drag.moved = true; waiting = { x: drag.v.x, y: drag.v.y, shift: !!drag.mods.shift, ctrl: !!drag.mods.ctrl, alt: !!drag.mods.alt }; singleNext = true; try { apply(false); } finally { singleNext = false; }
  };
  if (doc.addEventListener) doc.addEventListener('keydown', onKeyDown);
  // A DRAG NEVER RUNS OUT OF SCREEN (2026-10-14, reported: zoomed out, a length drag stopped at about 400 to 600 m and would go no further in one go). The hidden
  // cursor ran into the edge of the screen unseen (0.42 m a pixel over 1,000 to 1,400 px). Whenever it has gone WARP_PX from where it was grabbed, it is put back
  // there through the native window (as on release) and the travel so far is kept in `acc`, so the value is the whole travel.
  // D330 (2026-10-15, reported: "sometimes my mouse move gets interrupted ... i have to let go of click, and click the drag again"). The first rule waited for an event showing the cursor within 2 px of the
  // grab and ignored every move until then; if none came in WARP_WAIT_MS it gave the travel back and stopped putting the cursor back for the rest of the grab, so the drag then stalled at the screen
  // edge. Simulated (headless, no browser) both a busy window thread (the warp applied late) and plain hand motion (the first event after the warp is already more than 2 px away: any drag
  // faster than 2 px an event) switched it off for good on the second warp. Now:
  //   - the return is SEEN by where the cursor is: an event nearer the grab than the place it was warped from is back (a hand already some px on is fine); no 2 px test;
  //   - until it is seen, events are STALE (from before the jump) but real hand motion: they count at the old reading (the warp not yet in), so no move in the gap is lost and the value does not stall;
  //   - a return that is late is asked for again (WARP_WAIT_MS later), up to WARP_MISSES times; only then is the travel given back, and the drag only stops putting the cursor back after
  //     WARP_MISSES misses in a row. One miss never does; a return that does come resets the count.
  // With no native window (a browser, a test host) nothing changes.
  const nativeCursor = () => { const T = win.__TAURI__, w = T && T.window && T.window.getCurrentWindow && T.window.getCurrentWindow(), P = T && T.dpi && T.dpi.LogicalPosition; return w && w.setCursorPosition && P ? { w, P } : null; };
  const giveBack = (d) => { if (!d.warp) return; d.acc.x -= d.warp.dx; d.acc.y -= d.warp.dy; d.warp = null; if (++d.misses >= WARP_MISSES) d.noWarp = true; };
  const callNative = (d) => {
    const n = nativeCursor(); if (!n) { giveBack(d); d.noWarp = true; return; }
    const w = d.warp, failed = (err) => { if (drag === d && d.warp === w) giveBack(d); console.warn('handles: the cursor could not be put back during the drag:', err && err.message ? err.message : err); };
    try { const r = n.w.setCursorPosition(new n.P(d.cx, d.cy)); if (r && typeof r.catch === 'function') r.catch(failed); } catch (err) { failed(err); }
  };
  const warpBack = (d, x, y) => {
    if (d.noWarp || d.warp || !nativeCursor() || Math.hypot(x - d.x0, y - d.y0) < WARP_PX) return;
    d.warp = { dx: x - d.x0, dy: y - d.y0, ox: x, oy: y, lx: x, ly: y, until: Date.now() + WARP_WAIT_MS, asked: 1 }; d.acc.x += d.warp.dx; d.acc.y += d.warp.dy;
    callNative(d);
  };
  const onMove = (e) => {
    const [x, y] = rel(e);
    if (drag) {
      let stale = null;
      if (drag.warp) {
        if (Math.hypot(x - drag.x0, y - drag.y0) < Math.hypot(x - drag.warp.ox, y - drag.warp.oy)) { drag.acc.x += drag.warp.lx - drag.warp.ox; drag.acc.y += drag.warp.ly - drag.warp.oy; drag.warp = null; drag.misses = 0; }   // nearer the grab than where it was warped from: it is back; the hand motion between the ask and the jump (the last stale reading) is travel too
        else if (Date.now() > drag.warp.until) {                                                                                         // still not back, and late: ask again, and after WARP_MISSES asks give the travel back
          if (drag.warp.asked >= WARP_MISSES) giveBack(drag); else { drag.warp.asked++; drag.warp.until = Date.now() + WARP_WAIT_MS; callNative(drag); }
        }
        if (drag.warp) { stale = drag.warp; stale.lx = x; stale.ly = y; }
      }
      drag.v = { x: x + drag.acc.x - (stale ? stale.dx : 0), y: y + drag.acc.y - (stale ? stale.dy : 0) }; drag.moved = true; track(drag.v.x, drag.v.y, stamp(e), !!e.ctrlKey);
      waiting = { x: drag.v.x, y: drag.v.y, shift: !!e.shiftKey, ctrl: !!e.ctrlKey, alt: !!e.altKey }; if (!frameReq) frameReq = win.requestAnimationFrame(flush);
      warpBack(drag, x, y); return; }
    const h = hitTest(drawn, x, y); hover = h; stage.style.cursor = h ? cursorFor(h.screen) : '';
  };
  const onUp = (e) => {
    if (!drag) return;
    if (frameReq) { win.cancelAnimationFrame(frameReq); frameReq = 0; }
    // a release while the cursor is being put back carries a position from before the jump: the drag ends where the last move left it
    if (e && e.clientX !== undefined && !drag.warp) { const [x0, y0] = rel(e), x = x0 + drag.acc.x, y = y0 + drag.acc.y; drag.v = { x, y }; drag.moved = drag.moved || x !== drag.x0 || y !== drag.y0; track(x, y, stamp(e), !!e.ctrlKey); waiting = { x: drag.v.x, y: drag.v.y, shift: !!e.shiftKey, ctrl: !!e.ctrlKey, alt: !!e.altKey }; }
    else if (drag.warp) waiting = { x: drag.v.x, y: drag.v.y, shift: !!(e && e.shiftKey), ctrl: !!(e && e.ctrlKey), alt: !!(e && e.altKey) };
    apply(true); const h = drag.h, d = drag; if (drag.value !== drag.base0) { pre = { kind: h.kind, from: drag.base0, to: drag.value }; lastClick = null; } else lastClick = { id: h.id, t: e && typeof e.timeStamp === 'number' ? e.timeStamp : Date.now() };
    drag = null; stage.style.cursor = ''; putCursorBack(d); host.end(h);
  };
  // D251: a double-click ON a handle resets it: 0 for bank, turn and climb; the value before the last drag for length, width and cup (kept only while the field still reads what that drag set, so a value typed
  // since, or another piece, is not "put back" to a stale one). Taken in the capture phase like the press, so the camera's own double-click does not also fire.
  const resetHandle = (h) => {
    const m = model; if (!m) return;
    const now = m.base(h.kind), v = resetValue(h.kind, pre && pre.kind === h.kind && pre.to === now ? pre.from : null);
    if (v === null || v === now) return;
    host.begin(h); host.apply(h, v, {}, true); host.end(h); stepped(h.kind, now, v, true); pre = null;
  };
  const onDouble = (e) => {
    if (drag) return;
    const [x, y] = rel(e), h = hitTest(drawn, x, y); if (!h) return;
    e.preventDefault(); e.stopImmediatePropagation(); resetHandle(h);   // (the same reset again after the press has done it is a no-op)
  };
  // D330: the wheel over a handle is one step of its value a notch (up adds), and the camera does not also zoom. One undo step a notch, as a double-click's reset is.
  const onWheel = (e) => {
    if (drag || !e.deltaY) return;
    const [x, y] = rel(e), h = hitTest(drawn, x, y), m = model; if (!h || !m) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const K = KINDS[h.kind], now = m.base(h.kind), v = clamp(round(now + (e.deltaY < 0 ? 1 : -1) * K.step, K.step), K.min, K.max);
    if (v === now) return;
    host.begin(h); host.apply(h, v, {}, true); host.end(h); stepped(h.kind, now, v, true); pre = { kind: h.kind, from: now, to: v }; lastClick = null;
  };
  stage.addEventListener('pointerdown', onDown, true); stage.addEventListener('wheel', onWheel, { capture: true, passive: false }); stage.addEventListener('dblclick', onDouble, true); stage.addEventListener('pointermove', onMove); stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onUp);
  raf = win.requestAnimationFrame(frame);
  return {
    handles: () => drawn.slice(), hovered: () => hover, dragging: () => !!drag,
    unmount() { win.cancelAnimationFrame(raf); if (frameReq) win.cancelAnimationFrame(frameReq); stage.removeEventListener('pointerdown', onDown, true); stage.removeEventListener('wheel', onWheel, true); stage.removeEventListener('dblclick', onDouble, true); if (doc.removeEventListener) doc.removeEventListener('keydown', onKeyDown); stage.removeEventListener('pointermove', onMove); stage.removeEventListener('pointerup', onUp); stage.removeEventListener('pointercancel', onUp); canvas.remove(); stage.style.cursor = ''; },
  };
}

module.exports = { wrapTurn, KINDS, ORDER, LANDING_ORDER, DEG, PRECISE_MOD, WARP_WAIT_MS, WARP_MISSES, placeHandles, sampleNear, screenOf, screenAxis, dragPixels, scrubGain, SPEED_SLOW, SPEED_FAST, targetFor, resetValue, DETENT_PX, hitTest, format, cursorFor, mount };
